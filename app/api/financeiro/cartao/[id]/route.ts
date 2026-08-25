import { FinanceUnavailableError, transaction } from "@/lib/financeiro/db";

import { autor, erro, foiRecusa, recusar } from "../_comum";

/**
 * PATCH /api/financeiro/cartao/[id] — o plástico ganha nome, cor e limite.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTA ROTA PRECISOU EXISTIR
 * ---------------------------------------------------------------------------
 * Doze dos quinze plásticos vieram do sync do Nubank e chegaram sem apelido,
 * sem bandeira e sem cor: na tela eles são nove retângulos idênticos que só se
 * distinguem por quatro dígitos. Não havia NENHUM caminho de escrita para
 * cartão no lado administrativo — `grep` por `UPDATE fin_card` no repo inteiro
 * voltava vazio. O único cadastro que existia era o do app do time, e ele só
 * cria, nunca edita.
 *
 * ---------------------------------------------------------------------------
 * O LIMITE DAQUI NÃO É O LIMITE DO EMISSOR
 * ---------------------------------------------------------------------------
 * `fin_card_account.credit_limit_cents` é fato da fonte e o sync sobrescreve a
 * cada rodada. `fin_card.limite_cents` é decisão humana sobre um plástico
 * específico ("este final não deveria passar de R$ 2 mil/mês") e nada
 * automático encosta nele. São grandezas diferentes; ver o comentário da 0174.
 *
 * ---------------------------------------------------------------------------
 * O QUE ESTA ROTA SE RECUSA A MEXER
 * ---------------------------------------------------------------------------
 * `last4`, `card_account_id`, `status` e `origem` NÃO são editáveis aqui. Os
 * quatro são identidade vinda da fonte: mudar o final de um plástico o
 * desliga das 774 transações que apontam para ele, e mudar a conta o move de
 * emissor sem mover a fatura. Um campo de texto que faz isso por engano é caro
 * demais para o ganho de tê-lo.
 */

const BANDEIRAS = new Set(["visa", "mastercard", "elo", "amex", "hipercard", "outra"]);
const CORES = new Set([
  "preto", "branco", "cinza", "prata", "dourado",
  "roxo", "azul", "verde", "vermelho", "laranja", "rosa", "transparente"
]);
const TIPOS = new Set(["fisico", "virtual", "adicional", "digital", "desconhecido"]);

type Corpo = {
  apelido?: unknown;
  bandeira?: unknown;
  cor?: unknown;
  tipo?: unknown;
  limiteCents?: unknown;
};

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cardId = Number(id);
  if (!Number.isSafeInteger(cardId) || cardId <= 0) return erro("id de cartão inválido");

  let corpo: Corpo;
  try {
    corpo = (await request.json()) as Corpo;
  } catch {
    return erro("corpo não é JSON válido");
  }

  // Cada campo é opcional, mas `undefined` e `null` significam coisas
  // diferentes: ausente é "não mexe", null é "apaga". Um PATCH que tratasse os
  // dois igual tornaria impossível remover um apelido errado.
  const mudancas: string[] = [];
  const sets: string[] = [];
  const valores: unknown[] = [];
  const push = (coluna: string, valor: unknown) => {
    valores.push(valor);
    sets.push(`${coluna} = $${valores.length}`);
    mudancas.push(coluna);
  };

  if ("apelido" in corpo) {
    if (corpo.apelido === null) push("label", null);
    else {
      const s = typeof corpo.apelido === "string" ? corpo.apelido.trim() : "";
      if (!s) return erro("apelido vazio — mande null para apagar");
      if (s.length > 60) return erro("apelido acima de 60 caracteres");
      push("label", s);
    }
  }

  if ("bandeira" in corpo) {
    if (corpo.bandeira === null) push("brand", null);
    else {
      const s = String(corpo.bandeira);
      if (!BANDEIRAS.has(s)) return erro(`bandeira inválida: ${s}`);
      push("brand", s);
    }
  }

  if ("cor" in corpo) {
    if (corpo.cor === null) push("cor", null);
    else {
      const s = String(corpo.cor);
      if (!CORES.has(s)) return erro(`cor inválida: ${s}`);
      push("cor", s);
    }
  }

  if ("tipo" in corpo) {
    const s = String(corpo.tipo);
    if (!TIPOS.has(s)) return erro(`tipo inválido: ${s}`);
    push("kind", s);
  }

  if ("limiteCents" in corpo) {
    if (corpo.limiteCents === null) {
      // Apagar o limite apaga junto quem o definiu: o CHECK
      // `fin_card_limite_tem_autor` exige os três juntos ou os três vazios, e
      // deixar o autor órfão seria dizer que alguém definiu um limite que não
      // existe.
      push("limite_cents", null);
      push("limite_definido_por", null);
      push("limite_definido_em", null);
    } else {
      const v = Number(corpo.limiteCents);
      if (!Number.isSafeInteger(v) || v <= 0) return erro("limite precisa ser um inteiro de centavos maior que zero");
      push("limite_cents", v);
      push("limite_definido_por", autor(request));
      // `now()` não é parâmetro: vai literal no SQL. Passá-lo pelo `push`
      // consumiria um `$n` sem ter valor correspondente e desalinharia todos
      // os placeholders seguintes.
      sets.push("limite_definido_em = now()");
      mudancas.push("limite_definido_em");
    }
  }

  if (!sets.length) return erro("nada para mudar");

  try {
    const resultado = await transaction(async (client) => {
      const antes = await client.query(
        `SELECT id, last4, label, brand, cor, kind, limite_cents, limite_definido_por
           FROM fin_card WHERE id = $1`,
        [cardId]
      );
      if (!antes.rows[0]) return recusar("cartão não encontrado", 404);

      valores.push(cardId);
      const depois = await client.query(
        `UPDATE fin_card SET ${sets.join(", ")}, updated_at = now()
          WHERE id = $${valores.length}
          RETURNING id, last4, label, brand, cor, kind, limite_cents, limite_definido_por, limite_definido_em`,
        valores
      );

      // Trilha antes de responder: um apelido trocado é barato de desfazer só
      // enquanto se sabe qual era o anterior.
      await client.query(
        `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, before, after, fields, actor)
         VALUES ((SELECT id FROM fin_entity WHERE slug = 'xpe'), 'fin_card', $1, 'update', $2, $3, $4, $5)`,
        [cardId, antes.rows[0], depois.rows[0], mudancas, autor(request)]
      );

      return { cartao: depois.rows[0] };
    });

    if (foiRecusa(resultado)) return erro(resultado.mensagem, resultado.status);
    return Response.json({ ok: true, cartao: resultado.cartao });
  } catch (e) {
    if (e instanceof FinanceUnavailableError) return erro(e.message, 503);
    return erro(e instanceof Error ? e.message : "falha ao salvar", 500);
  }
}

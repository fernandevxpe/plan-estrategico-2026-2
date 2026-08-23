import "server-only";

import { normalizeDescription } from "@/scripts/lib/fin-normalize.mjs";
import { query, transaction } from "./db";
import { TimeError } from "./time";
import {
  cancelarItemReembolsoInterno,
  mapEstorno,
  type EstornoReembolso
} from "./estorno-reembolso";

const ENTITY = "xpe";

/**
 * O lado ADMIN do estorno — e ele existe separado por uma razão dura.
 *
 * `estorno-reembolso.ts` é importado por `/api/time/*`, que é a superfície do
 * perfil comum. A regra do projeto (ver `AGENTS.md` e
 * `scripts/test-perfil-guard.mjs`) é que essa superfície NÃO alcança o ledger:
 * `fin_transaction`, `fin_account` e companhia.
 *
 * Só que conciliar o estorno com o extrato exige exatamente essas tabelas. A
 * auditoria mostrou o resultado de deixar as duas coisas no mesmo arquivo: o
 * guard imprimia ✓ porque o SQL proibido estava um `import` de distância —
 * "mover o SQL de arquivo até o grep parar de ver", que é o antipadrão que o
 * próprio AGENTS.md nomeia.
 *
 * A separação torna a regra verdadeira de novo em vez de contornada: o que
 * lê o ledger vive aqui, e nenhuma rota de `/api/time` importa este arquivo.
 * Quem conciliar extrato é o financeiro, que já entra por Basic Auth.
 */

export async function sugerirMatchEstorno(
  personId: number,
  valorCents: number,
  desde: string
): Promise<{ transactionId: number; confianca: "alta" | "media" | "baixa"; descricao: string } | null> {
  const [pessoa] = await query<{ name: string; normalized_name: string | null }>(
    `SELECT name, normalized_name FROM fin_person WHERE id = $1`,
    [personId]
  );
  if (!pessoa) return null;
  const prefixo = (pessoa.normalized_name ?? pessoa.name).split(/\s+/)[0]?.toLowerCase();
  if (!prefixo || prefixo.length < 3) return null;

  // `description_raw` e `posted_on` são os nomes REAIS. O código nasceu com
  // `t.description` e `t.occurred_at`, que não existem em `fin_transaction` —
  // erro 42703 no parse, ou seja, falhava mesmo sem nenhuma linha na tabela.
  // `tsc` não olha dentro de string de SQL; é a armadilha nº 4 do AGENTS.md.
  const candidatos = await query<{ id: number; description: string; amount_cents: number }>(
    `SELECT t.id, coalesce(t.description_raw, t.description_norm, '') AS description, t.amount_cents
       FROM fin_transaction t
       JOIN fin_account a ON a.id = t.account_id
       JOIN fin_entity e ON e.id = a.entity_id AND e.slug = $1
      WHERE t.amount_cents = $2
        AND t.posted_on >= $3::date
        AND t.amount_cents > 0
        AND t.transfer_status = 'nao'
      ORDER BY t.posted_on DESC
      LIMIT 20`,
    [ENTITY, valorCents, desde]
  );

  for (const c of candidatos) {
    const desc = normalizeDescription(c.description).toLowerCase();
    if (desc.includes(prefixo)) {
      return { transactionId: c.id, confianca: "alta", descricao: c.description };
    }
  }
  if (candidatos.length === 1) {
    return { transactionId: candidatos[0].id, confianca: "media", descricao: candidatos[0].description };
  }
  if (candidatos.length > 0) {
    return { transactionId: candidatos[0].id, confianca: "baixa", descricao: candidatos[0].description };
  }
  return null;
}

export async function cancelarItemReembolsoAdmin(
  personId: number,
  fonte: "app" | "planilha",
  itemId: number,
  dados: { motivoCategoria: string; motivo: string; confirmar: boolean },
  ator: string
): Promise<EstornoReembolso> {
  return cancelarItemReembolsoInterno(personId, fonte, itemId, dados, ator);
}

export type EstornoAdmin = EstornoReembolso & {
  pessoaNome: string;
  pessoaId: number;
  matchSugeridoDescricao: string | null;
};

export async function listarEstornosAdmin(): Promise<EstornoAdmin[]> {
  const rows = await query<Record<string, unknown>>(
    // Mesma correção de nome de coluna do `sugerirMatchEstorno`: era
    // `t.description`, que não existe, e isto devolvia 500 sempre — inclusive
    // com a tabela vazia, porque o erro é de parse.
    //
    // E o LEFT JOIN em `fin_account` estava faltando: `mapEstorno` lê
    // `row.conta_slug`, então a conta sugerida vinha sempre nula nesta lista,
    // que é justamente a tela onde o financeiro precisa saber em que conta o
    // PIX deve cair.
    `SELECT e.*, p.name AS pessoa_nome, p.id AS pessoa_id,
            coalesce(t.description_raw, t.description_norm) AS match_descricao,
            ct.slug AS conta_slug
       FROM fin_reembolso_estorno e
       JOIN fin_person p ON p.id = e.person_id
       LEFT JOIN fin_transaction t ON t.id = e.match_sugerido_id
       LEFT JOIN fin_account ct ON ct.id = e.conta_sugerida_id
      WHERE e.entity_id = (SELECT id FROM fin_entity WHERE slug = $1)
      ORDER BY
        CASE e.status WHEN 'aberto' THEN 0 ELSE 1 END,
        e.criado_em DESC`,
    [ENTITY]
  );
  return rows.map((row) => ({
    ...mapEstorno(row),
    pessoaNome: String(row.pessoa_nome),
    pessoaId: Number(row.pessoa_id),
    matchSugeridoDescricao: row.match_descricao ? String(row.match_descricao) : null
  }));
}

export async function confirmarEstornoAdmin(
  estornoId: number,
  dados: { transactionId?: number | null; ator: string }
): Promise<EstornoReembolso> {
  return transaction(async (client) => {
    const { rows } = await client.query<Record<string, unknown>>(
      `SELECT e.*, a.slug AS conta_slug
         FROM fin_reembolso_estorno e
         LEFT JOIN fin_account a ON a.id = e.conta_sugerida_id
        WHERE e.id = $1 FOR UPDATE`,
      [estornoId]
    );
    const atual = rows[0];
    if (!atual) throw new TimeError("estorno não encontrado", 404);
    if (atual.status === "quitado") throw new TimeError("estorno já quitado", 409);

    /*
     * O `??` ANULAVA O CUIDADO DA TELA.
     *
     * `FinEstornosReembolso` só manda `transactionId` quando a confiança do
     * match é ALTA; nos outros casos manda `undefined` de propósito. Com
     * `?? match_sugerido_id`, `undefined` caía no palpite — inclusive no de
     * confiança BAIXA, que é "qualquer entrada de valor idêntico em qualquer
     * conta, sem vínculo nenhum com a pessoa".
     *
     * O estrago concreto: estorno de R$ 450 do Gabriel, ninguém pagou; existe
     * um recebimento de cliente de R$ 450 no Inter; o financeiro clica
     * "marcar recebido" e a dívida some, quitada contra o dinheiro de um
     * cliente. E não há caminho de volta — `quitado` recusa novo PATCH com 409.
     *
     * Quem quita escolhe a transação, ou quita sem transação nenhuma.
     */
    const txId = dados.transactionId ?? null;
    await client.query(
      `UPDATE fin_reembolso_estorno
          SET status = 'quitado',
              transaction_id = $2,
              quitado_em = now(),
              quitado_por = $3
        WHERE id = $1`,
      [estornoId, txId, dados.ator]
    );

    if (atual.document_id) {
      /*
       * `liquidado`, não `confirmado` — e a diferença é dinheiro contado duas
       * vezes.
       *
       * Nesta base `confirmado` é recebível EM ABERTO: `lib/financeiro/contas.ts`
       * o lista entre os abertos e `lib/financeiro/forecast.ts` o inclui na
       * projeção de entrada. Quitar o estorno marcando `confirmado` deixava o
       * documento aberto para sempre, e depois que o PIX caísse a devolução
       * apareceria duas vezes no caixa projetado: a transação real mais o
       * recebível que nunca fecha.
       *
       * `settled_cents` acompanha, porque é dele que `contas.ts` deriva o
       * saldo em aberto (`amount_cents - settled_cents`). Sem isso o documento
       * ficaria "liquidado" com saldo aberto — outro estado incoerente.
       */
      await client.query(
        `UPDATE fin_document
            SET status = 'liquidado',
                settled_cents = amount_cents
          WHERE id = $1 AND status NOT IN ('cancelado', 'estornado')`,
        [atual.document_id]
      );
    }

    const { rows: finais } = await client.query<Record<string, unknown>>(
      `SELECT e.*, a.slug AS conta_slug FROM fin_reembolso_estorno e
        LEFT JOIN fin_account a ON a.id = e.conta_sugerida_id WHERE e.id = $1`,
      [estornoId]
    );
    return mapEstorno(finais[0]);
  });
}

export async function atualizarMatchesEstornosAbertos(): Promise<number> {
  const abertos = await query<{ id: number; person_id: number; valor_cents: number; criado_em: string }>(
    `SELECT id, person_id, valor_cents, criado_em::text
       FROM fin_reembolso_estorno
      WHERE status = 'aberto' AND valor_cents > 0`
  );
  let n = 0;
  for (const e of abertos) {
    const match = await sugerirMatchEstorno(e.person_id, e.valor_cents, e.criado_em);
    if (match) {
      await query(
        `UPDATE fin_reembolso_estorno
            SET match_sugerido_id = $2, match_confianca = $3
          WHERE id = $1 AND status = 'aberto'`,
        [e.id, match.transactionId, match.confianca]
      );
      n++;
    }
  }
  return n;
}


import "server-only";

import { query } from "@/lib/financeiro/db";

const ENTITY = "xpe";

/**
 * O lado DESCRITO do cartão: o que o time lançou pelo app.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ISTO É SEPARADO DA FATURA, E NÃO SOMADO A ELA
 * ---------------------------------------------------------------------------
 * `getCartaoDetalhe` monta o que o BANCO cobrou — fatura, itens, parcelas, tudo
 * vindo do sync. Isto aqui é o que uma PESSOA descreveu no celular: fotografou
 * a compra, marcou o cartão, disse para que era.
 *
 * Os dois falam da mesma compra por caminhos diferentes. Somar os dois conta o
 * mesmo gasto duas vezes — é o erro que a tela de cartões inteira foi desenhada
 * para não cometer, e a razão de este módulo existir separado em vez de virar
 * mais uma linha lá dentro.
 *
 * O valor de ter os dois lado a lado, sem somar, é outro: onde os dois existem,
 * dá para conferir; onde só a fatura existe, falta descrição; onde só a
 * descrição existe, a compra ainda não chegou na fatura. As três respostas são
 * úteis e nenhuma delas aparece se os números forem misturados.
 */

export type LancamentoDescrito = {
  code: string;
  titulo: string;
  descricao: string | null;
  valorCents: number;
  parcelas: number | null;
  data: string;
  status: string;
  pessoa: string;
  prova: string;
  categoria: string | null;
  centro: string | null;
  anexos: number;
};

export type CartaoDescrito = {
  chave: string;
  banco: string | null;
  final: string | null;
  apelido: string | null;
  cor: string | null;
  bandeira: string | null;
  /** `false` quando a pessoa digitou um final que não casa com plástico algum. */
  cadastrado: boolean;
  totalCents: number;
  lancamentos: LancamentoDescrito[];
};

export async function getCartoesDescritos(): Promise<{ cartoes: CartaoDescrito[]; totalCents: number }> {
  let linhas: Record<string, unknown>[];
  try {
    linhas = await query<Record<string, unknown>>(
      `SELECT v.* FROM fin_time_envio_cartao_v v
         JOIN fin_entity e ON e.id = v.entity_id AND e.slug = $1
        ORDER BY v.enviado_em DESC NULLS LAST, v.envio_id DESC`,
      [ENTITY]
    );
  } catch {
    // A view é da 0150. Num ambiente onde ela ainda não foi aplicada, a seção
    // some em vez de derrubar a página inteira de cartões — que responde outra
    // pergunta e continua válida sem esta.
    return { cartoes: [], totalCents: 0 };
  }

  const porChave = new Map<string, CartaoDescrito>();
  for (const l of linhas) {
    const chave = String(l.chave_cartao);
    if (!porChave.has(chave)) {
      porChave.set(chave, {
        chave,
        banco: (l.banco as string) ?? null,
        final: (l.card_last4 as string) ?? null,
        apelido: (l.cartao_apelido as string) ?? null,
        cor: (l.cartao_cor as string) ?? null,
        bandeira: (l.cartao_bandeira as string) ?? null,
        // Sem `card_id` o final foi digitado e não casou com plástico nenhum.
        // Isso não é erro da pessoa — é cadastro faltando —, e a tela mostra
        // como convite para cadastrar, porque um final sem plástico nunca casa
        // com a fatura.
        cadastrado: l.card_id != null,
        totalCents: 0,
        lancamentos: []
      });
    }
    const grupo = porChave.get(chave)!;
    const cents = Number(l.amount_cents ?? 0);
    grupo.totalCents += cents;
    grupo.lancamentos.push({
      code: String(l.code),
      titulo: String(l.titulo),
      descricao: (l.descricao as string) ?? null,
      valorCents: cents,
      parcelas: l.parcelas == null ? null : Number(l.parcelas),
      data: String(l.incurred_on).slice(0, 10),
      status: String(l.status),
      pessoa: String(l.pessoa),
      prova: String(l.identidade_prova),
      categoria: l.categoria ? `${l.categoria_code} ${l.categoria}` : null,
      centro: (l.centro as string) ?? null,
      anexos: Number(l.anexos ?? 0)
    });
  }

  const cartoes = [...porChave.values()].sort((a, b) => b.totalCents - a.totalCents);
  return { cartoes, totalCents: cartoes.reduce((s, c) => s + c.totalCents, 0) };
}

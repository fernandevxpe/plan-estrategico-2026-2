import "server-only";

import { isFinanceConfigured, query } from "../db";
import { contrato, contratoIndisponivel, ENTIDADE, type Contrato, type Drill } from "./base";

/**
 * Cartão de crédito.
 *
 * A regra que este contrato protege, e que é a fonte de erro mais comum em
 * ferramenta financeira caseira:
 *
 *   **NUNCA somar fatura de cartão com extrato da conta corrente.**
 *
 * A compra no cartão é CUSTO na competência; só o pagamento da fatura é CAIXA.
 * Somar os dois conta a mesma despesa duas vezes — uma quando o item aparece na
 * fatura, outra quando o débito sai da corrente. Por isso o contrato separa
 * `competencia` de `caixa` em campos diferentes e nunca oferece um "total".
 */

const DOMINIO = "cartao";

export type LinhaDeCredito = {
  id: number;
  slug: string;
  nome: string;
  instituicao: string;
  bandeira: string | null;
  limiteCents: number | null;
  usadoCents: number | null;
  disponivelCents: number | null;
  diaVencimento: number | null;
  proximoVencimento: string | null;
  contaLiquidacao: string | null;
  sincronizadoEm: string | null;
  /** Subcartões desta linha. Limite por subcartão NÃO é inventado quando a fonte só dá o consolidado. */
  subcartoes: Subcartao[];
};

export type Subcartao = {
  id: number;
  final4: string | null;
  status: string;
  principal: boolean;
  titularPessoaId: number | null;
  /** Null quando a fonte não diz de quem é. Não se atribui titular por dedução. */
  titular: string | null;
  primeiraOcorrencia: string | null;
  ultimaOcorrencia: string | null;
};

export type Fatura = {
  id: number;
  linhaId: number;
  mesReferencia: string | null;
  fechamento: string | null;
  vencimento: string | null;
  totalCents: number;
  itemizadoCents: number | null;
  naoItemizadoCents: number | null;
  pagoCents: number | null;
  pagoEm: string | null;
  status: string;
  /** Quanto da fatura o sistema consegue explicar item a item. */
  coberturaItensPct: number | null;
};

export type CompromissoMes = {
  mes: string;
  tipo: string;
  totalCents: number;
  itens: number;
};

export type PainelCartao = {
  linhas: LinhaDeCredito[];
  faturas: Fatura[];
  compromissoPorMes: CompromissoMes[];
  /** Custo por competência — NÃO é caixa. */
  competenciaMesAtualCents: number;
  /** Caixa: o que saiu da corrente pagando fatura. */
  caixaPagamentoFatura12mCents: number;
  drillCompras: Drill;
};

const VAZIO: PainelCartao = {
  linhas: [],
  faturas: [],
  compromissoPorMes: [],
  competenciaMesAtualCents: 0,
  caixaPagamentoFatura12mCents: 0,
  drillCompras: { dominio: "cartao", filtros: {} }
};

export async function getCartao(): Promise<Contrato<PainelCartao>> {
  if (!isFinanceConfigured()) return contratoIndisponivel(DOMINIO, VAZIO, "banco financeiro não configurado");

  try {
    const [linhas, cartoes, faturas, compromisso, caixa] = await Promise.all([
      query<Record<string, unknown>>(
        `SELECT ca.*, a.slug AS conta_liquidacao
           FROM fin_card_account ca
           JOIN fin_entity e ON e.id = ca.entity_id
           LEFT JOIN fin_account a ON a.id = ca.settlement_account_id
          WHERE e.slug = $1 AND ca.is_active ORDER BY ca.slug`,
        [ENTIDADE]
      ),
      query<Record<string, unknown>>(
        `SELECT c.*, p.name AS titular
           FROM fin_card c LEFT JOIN fin_person p ON p.id = c.holder_person_id
          ORDER BY c.card_account_id, c.is_primary DESC, c.last4`
      ),
      query<Record<string, unknown>>(
        `SELECT b.* FROM fin_card_bill b ORDER BY b.reference_month DESC NULLS LAST, b.id DESC LIMIT 36`
      ),
      query<{ mes: string; tipo: string; total: string; n: string }>(
        `SELECT to_char(competence_month, 'YYYY-MM-DD') AS mes, tipo,
                SUM(amount_cents)::text AS total, count(*)::text AS n
           FROM fin_card_compromisso_mensal_v
          GROUP BY 1, 2 ORDER BY 1`
      ),
      // Categoria 9.01 é o PAGAMENTO da fatura: a única linha do cartão que é
      // caixa de verdade.
      query<{ total: string }>(
        `SELECT COALESCE(SUM(-t.amount_cents), 0)::text AS total
           FROM fin_transaction t
           JOIN fin_entity e ON e.id = t.entity_id
           JOIN fin_category c ON c.id = t.category_id
          WHERE e.slug = $1 AND c.code = '9.01' AND t.amount_cents < 0
            AND t.posted_on >= (date_trunc('month', CURRENT_DATE) - interval '11 months')::date`,
        [ENTIDADE]
      )
    ]);

    const porLinha = new Map<number, Subcartao[]>();
    for (const c of cartoes) {
      const chave = Number(c.card_account_id);
      const lista = porLinha.get(chave) ?? [];
      lista.push({
        id: Number(c.id),
        final4: (c.last4 as string) ?? null,
        status: String(c.status),
        principal: Boolean(c.is_primary),
        titularPessoaId: c.holder_person_id === null ? null : Number(c.holder_person_id),
        titular: (c.titular as string) ?? null,
        primeiraOcorrencia: c.first_seen_on ? String(c.first_seen_on).slice(0, 10) : null,
        ultimaOcorrencia: c.last_seen_on ? String(c.last_seen_on).slice(0, 10) : null
      });
      porLinha.set(chave, lista);
    }

    const mesAtual = `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, "0")}-01`;

    return contrato({
      dominio: DOMINIO,
      dado: {
        linhas: linhas.map((l) => ({
          id: Number(l.id),
          slug: String(l.slug),
          nome: String(l.name),
          instituicao: String(l.institution),
          bandeira: (l.brand as string) ?? null,
          limiteCents: l.credit_limit_cents === null ? null : Number(l.credit_limit_cents),
          usadoCents: l.used_limit_cents === null ? null : Number(l.used_limit_cents),
          disponivelCents: l.available_limit_cents === null ? null : Number(l.available_limit_cents),
          diaVencimento: l.due_day === null ? null : Number(l.due_day),
          proximoVencimento: l.next_due_date ? String(l.next_due_date).slice(0, 10) : null,
          contaLiquidacao: (l.conta_liquidacao as string) ?? null,
          sincronizadoEm: l.balance_synced_at ? String(l.balance_synced_at) : null,
          subcartoes: porLinha.get(Number(l.id)) ?? []
        })),
        faturas: faturas.map((b) => {
          const total = Number(b.total_amount_cents ?? 0);
          const itemizado = b.itemized_amount_cents === null ? null : Number(b.itemized_amount_cents);
          return {
            id: Number(b.id),
            linhaId: Number(b.card_account_id),
            mesReferencia: b.reference_month ? String(b.reference_month).slice(0, 10) : null,
            fechamento: b.closing_date ? String(b.closing_date).slice(0, 10) : null,
            vencimento: b.due_date ? String(b.due_date).slice(0, 10) : null,
            totalCents: total,
            itemizadoCents: itemizado,
            naoItemizadoCents: b.unitemized_amount_cents === null ? null : Number(b.unitemized_amount_cents),
            pagoCents: b.paid_amount_cents === null ? null : Number(b.paid_amount_cents),
            pagoEm: b.paid_on ? String(b.paid_on).slice(0, 10) : null,
            status: String(b.status),
            coberturaItensPct: itemizado !== null && total > 0 ? (itemizado / total) * 100 : null
          };
        }),
        compromissoPorMes: compromisso.map((c) => ({
          mes: c.mes,
          tipo: c.tipo,
          totalCents: Number(c.total),
          itens: Number(c.n)
        })),
        competenciaMesAtualCents: compromisso
          .filter((c) => c.mes === mesAtual)
          .reduce((s, c) => s + Number(c.total), 0),
        caixaPagamentoFatura12mCents: Number(caixa[0]?.total ?? 0),
        drillCompras: { dominio: "cartao", filtros: {} }
      },
      ressalvas: [
        "NUNCA somar fatura com extrato da corrente: a compra é custo na competência, só o pagamento da fatura é caixa.",
        "Fatura pertence à linha de crédito, não ao subcartão. Limite por subcartão não é inventado quando a fonte só dá o consolidado.",
        "Titular null significa que a fonte não diz de quem é o cartão — atribuir por dedução seria invenção."
      ]
    });
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    console.error("[contrato:cartao]", mensagem);
    return contratoIndisponivel(DOMINIO, VAZIO, mensagem);
  }
}

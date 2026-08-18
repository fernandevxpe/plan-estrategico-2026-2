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
  emissorSlug: string;
  emissor: string;
  natureza: string | null;
  nivelDetalhe: string | null;
  titularidade: string | null;
  limiteCents: number | null;
  usadoCents: number | null;
  /** Verdadeiro quando a fonte só dá o limite da linha inteira. Não se rateia por subcartão. */
  limiteConsolidado: boolean;
  contaLiquidacao: string | null;
  ativa: boolean;
  subcartoes: Subcartao[];
};

export type Subcartao = {
  id: number;
  final4: string | null;
  tipo: string | null;
  status: string | null;
  principal: boolean;
  titularPessoaId: number | null;
  /** Null quando a fonte não diz de quem é. Não se atribui titular por dedução. */
  titular: string | null;
  /** O que a FONTE afirma, separado do que foi vinculado a uma pessoa aqui. */
  titularDeclaradoPelaFonte: string | null;
  primeiraOcorrencia: string | null;
  ultimaOcorrencia: string | null;
  /** Reemissão: o parcelamento atravessa a troca de final sem se quebrar. */
  substituiCartaoId: number | null;
  substituidoPorCartaoId: number | null;
};

/** O que a fonte não entrega — declarado, com o motivo. */
export type LacunaCartao = {
  lacuna: string;
  escopo: string;
  itens: number;
  valorCents: number;
  motivo: string;
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
  lacunas: LacunaCartao[];
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
  lacunas: [],
  competenciaMesAtualCents: 0,
  caixaPagamentoFatura12mCents: 0,
  drillCompras: { dominio: "cartao", filtros: {} }
};

export async function getCartao(): Promise<Contrato<PainelCartao>> {
  if (!isFinanceConfigured()) return contratoIndisponivel(DOMINIO, VAZIO, "banco financeiro não configurado");

  try {
    // A hierarquia emissor → linha → subcartão vem pronta da 0074. Refazer o
    // join aqui produziria uma segunda definição de "qual cartão pertence a
    // quem", e as duas divergiriam na primeira reemissão.
    const [hierarquia, faturas, compromisso, lacunas, caixa] = await Promise.all([
      query<Record<string, unknown>>(
        `SELECT h.* FROM fin_card_hierarquia_v h JOIN fin_entity e ON e.id = h.entity_id
          WHERE e.slug = $1 ORDER BY h.emissor_slug, h.linha_slug, h.is_primary DESC NULLS LAST, h.last4`,
        [ENTIDADE]
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
      query<Record<string, unknown>>(
        `SELECT l.* FROM fin_card_lacuna_v l JOIN fin_entity e ON e.id = l.entity_id
          WHERE e.slug = $1 AND l.itens > 0 ORDER BY l.valor_cents DESC`,
        [ENTIDADE]
      ),
      // O pagamento da fatura é a única linha do cartão que é caixa de verdade.
      //
      // A ÂNCORA É O PONTEIRO, NÃO A CATEGORIA — e isto já esteve errado aqui.
      //
      // Esta consulta filtrava `c.code = '9.01'`. Os 9 pagamentos de fatura do
      // Inter — R$ 40.862,41, 38% do que sai — têm `category_id` NULO, porque o
      // gatilho `fin_transaction_fatura_sem_itemizacao` (0094) os barrou até
      // existir `fin_card_bill` ligada. A ligação existe hoje; o carimbo de 9.01
      // continua sendo decisão humana e pode nunca vir.
      //
      // Medir caixa de cartão por rótulo, portanto, escondia mais de um terço do
      // que sai — e escondia justamente a linha cuja classificação está em
      // aberto, que é a que mais precisa aparecer. `paid_transaction_id` é o
      // ÚNICO ponto de contato entre o subledger do cartão e o ledger: é ele.
      query<{ total: string }>(
        `SELECT COALESCE(SUM(-t.amount_cents), 0)::text AS total
           FROM fin_card_bill b
           JOIN fin_transaction t ON t.id = b.paid_transaction_id
           JOIN fin_entity e ON e.id = t.entity_id
          WHERE e.slug = $1
            AND t.posted_on >= (date_trunc('month', CURRENT_DATE) - interval '11 months')::date`,
        [ENTIDADE]
      )
    ]);

    // A view é uma linha por subcartão; a tela quer uma por linha de crédito.
    // A dobra acontece aqui e não no SQL para que a hierarquia continue tendo
    // uma definição só, na 0074.
    const porLinha = new Map<number, LinhaDeCredito>();
    for (const h of hierarquia) {
      const chave = Number(h.card_account_id);
      let linha = porLinha.get(chave);
      if (!linha) {
        linha = {
          id: chave,
          slug: String(h.linha_slug),
          nome: String(h.linha),
          emissorSlug: String(h.emissor_slug),
          emissor: String(h.emissor),
          natureza: (h.natureza as string) ?? null,
          nivelDetalhe: (h.nivel_detalhe as string) ?? null,
          titularidade: (h.titularidade as string) ?? null,
          limiteCents: h.credit_limit_cents === null ? null : Number(h.credit_limit_cents),
          usadoCents: h.used_limit_cents === null ? null : Number(h.used_limit_cents),
          limiteConsolidado: Boolean(h.limit_is_consolidated),
          contaLiquidacao: (h.conta_liquidacao as string) ?? null,
          ativa: Boolean(h.linha_ativa),
          subcartoes: []
        };
        porLinha.set(chave, linha);
      }
      if (h.card_id !== null && h.card_id !== undefined) {
        linha.subcartoes.push({
          id: Number(h.card_id),
          final4: (h.last4 as string) ?? null,
          tipo: (h.tipo_cartao as string) ?? null,
          status: (h.status_cartao as string) ?? null,
          principal: Boolean(h.is_primary),
          titularPessoaId: h.holder_person_id === null ? null : Number(h.holder_person_id),
          titular: (h.titular as string) ?? null,
          titularDeclaradoPelaFonte: (h.titular_declarado_pela_fonte as string) ?? null,
          primeiraOcorrencia: h.first_seen_on ? String(h.first_seen_on).slice(0, 10) : null,
          ultimaOcorrencia: h.last_seen_on ? String(h.last_seen_on).slice(0, 10) : null,
          substituiCartaoId: h.replaces_card_id === null ? null : Number(h.replaces_card_id),
          substituidoPorCartaoId: h.replaced_by_card_id === null ? null : Number(h.replaced_by_card_id)
        });
      }
    }

    const mesAtual = `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, "0")}-01`;

    return contrato({
      dominio: DOMINIO,
      dado: {
        linhas: [...porLinha.values()],
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
        lacunas: lacunas.map((l) => ({
          lacuna: String(l.lacuna),
          escopo: String(l.escopo),
          itens: Number(l.itens ?? 0),
          valorCents: Number(l.valor_cents ?? 0),
          motivo: String(l.motivo)
        })),
        competenciaMesAtualCents: compromisso
          .filter((c) => c.mes === mesAtual)
          .reduce((s, c) => s + Number(c.total), 0),
        caixaPagamentoFatura12mCents: Number(caixa[0]?.total ?? 0),
        drillCompras: { dominio: "cartao", filtros: {} }
      },
      ressalvas: [
        "NUNCA somar fatura com extrato da corrente: a compra é custo na competência, só o pagamento da fatura é caixa.",
        "Fatura pertence à linha de crédito, não ao subcartão. Com limiteConsolidado=true a fonte só dá o limite da linha — ratear por subcartão seria invenção.",
        "Titular null significa que a fonte não diz de quem é o cartão. titularDeclaradoPelaFonte separa o que a fonte afirma do que foi vinculado a uma pessoa aqui.",
        "`lacunas` é o que nenhuma fonte explica (ex.: o cartão Inter não tem rota de API). Ignorá-las faz o custo de cartão parecer menor do que é."
      ]
    });
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    console.error("[contrato:cartao]", mensagem);
    return contratoIndisponivel(DOMINIO, VAZIO, mensagem);
  }
}

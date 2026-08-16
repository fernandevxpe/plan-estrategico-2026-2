import "server-only";

import { isFinanceConfigured, query } from "../db";
import { contrato, contratoIndisponivel, ENTIDADE, type Contrato, type Drill } from "./base";
import { getCobertura } from "./cobertura";

/**
 * Contas bancárias e conciliação.
 *
 * A tela de contas responde DUAS perguntas que o projeto insiste em não
 * confundir, e por isso o contrato tem dois campos separados:
 *
 *   `fecha`          o saldo reconstruído bate com o saldo declarado?
 *   `emDia`          o extrato cobre até ontem?
 *
 * Uma conta pode fechar aritmeticamente no dia em que o extrato termina e ainda
 * assim mentir sobre hoje. Colapsar as duas num único "ok" verde é como este
 * tipo de painel costuma enganar o dono.
 */

const DOMINIO = "bancos";

export type ContaBancaria = {
  slug: string;
  nome: string;
  instituicao: string;
  tipo: string;
  saldoCents: number;
  saldoAberturaCents: number;
  dataAbertura: string | null;
  ultimoExtrato: string | null;
  diasSemExtrato: number | null;
  emDia: boolean;
  fecha: boolean | null;
  divergenciaCents: number | null;
  lancamentos: number;
  /** Lacunas na cobertura do extrato: períodos sem nenhum lote importado. */
  lacunas: { de: string; ate: string; dias: number }[];
  adaptador: string;
  drill: Drill;
};

export type PainelBancos = {
  contas: ContaBancaria[];
  totalCents: number;
  /** Sem a conta de empréstimo, cujo saldo negativo é normal e falsearia o runway. */
  totalDisponivelCents: number;
  fecham: number;
  emDia: number;
};

const VAZIO: PainelBancos = { contas: [], totalCents: 0, totalDisponivelCents: 0, fecham: 0, emDia: 0 };

export async function getBancos(): Promise<Contrato<PainelBancos>> {
  if (!isFinanceConfigured()) return contratoIndisponivel(DOMINIO, VAZIO, "banco financeiro não configurado");

  try {
    const cobertura = await getCobertura();
    const [detalhes, coberturas] = await Promise.all([
      query<{
        slug: string;
        name: string;
        institution: string;
        kind: string;
        opening_balance_cents: string;
        opening_balance_date: string | null;
        import_adapter: string;
        lancamentos: string;
      }>(
        `SELECT a.slug, a.name, a.institution, a.kind, a.opening_balance_cents::text,
                to_char(a.opening_balance_date, 'YYYY-MM-DD') AS opening_balance_date,
                a.import_adapter,
                (SELECT count(*) FROM fin_transaction t WHERE t.account_id = a.id)::text AS lancamentos
           FROM fin_account a JOIN fin_entity e ON e.id = a.entity_id
          WHERE e.slug = $1 AND a.is_active ORDER BY a.sort_order`,
        [ENTIDADE]
      ),
      query<{ slug: string; period_start: string; period_end: string }>(
        `SELECT a.slug, to_char(sc.period_start,'YYYY-MM-DD') AS period_start,
                to_char(sc.period_end,'YYYY-MM-DD') AS period_end
           FROM fin_statement_coverage sc
           JOIN fin_account a ON a.id = sc.account_id
           JOIN fin_entity e ON e.id = a.entity_id
          WHERE e.slug = $1 ORDER BY a.slug, sc.period_start`,
        [ENTIDADE]
      )
    ]);

    const porSlug = new Map(cobertura.contas.map((c) => [c.slug, c]));
    const contas: ContaBancaria[] = detalhes.map((d) => {
      const frescor = porSlug.get(d.slug);
      return {
        slug: d.slug,
        nome: d.name,
        instituicao: d.institution,
        tipo: d.kind,
        saldoCents: frescor?.saldoCents ?? 0,
        saldoAberturaCents: Number(d.opening_balance_cents),
        dataAbertura: d.opening_balance_date,
        ultimoExtrato: frescor?.cobreAte ?? null,
        diasSemExtrato: frescor?.diasDesatualizado ?? null,
        emDia: frescor?.estado === "em_dia",
        fecha: frescor?.fechaCaixa ?? null,
        divergenciaCents: frescor?.divergenciaCents ?? null,
        lancamentos: Number(d.lancamentos),
        lacunas: lacunasDe(coberturas.filter((c) => c.slug === d.slug)),
        adaptador: d.import_adapter,
        drill: { dominio: "lancamentos", filtros: { conta: d.slug } }
      };
    });

    const totalCents = contas.reduce((s, c) => s + c.saldoCents, 0);
    return contrato({
      dominio: DOMINIO,
      dado: {
        contas,
        totalCents,
        totalDisponivelCents: contas.filter((c) => c.tipo !== "emprestimo").reduce((s, c) => s + c.saldoCents, 0),
        fecham: contas.filter((c) => c.fecha === true).length,
        emDia: contas.filter((c) => c.emDia).length
      },
      cobertura: cobertura.contas,
      ressalvas: [
        "'fecha' e 'está em dia' são verificações diferentes e ambas precisam passar.",
        "Conta sem cobertura de extrato devolve fecha=null: não fechar e não saber são estados distintos."
      ]
    });
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    console.error("[contrato:bancos]", mensagem);
    return contratoIndisponivel(DOMINIO, VAZIO, mensagem);
  }
}

/**
 * Buracos entre períodos importados.
 *
 * Cobertura contígua não é o mesmo que cobertura completa: dois lotes cobrindo
 * janeiro e março deixam fevereiro invisível, e o saldo continua fechando
 * porque o que falta simplesmente nunca entrou na conta. É a lacuna que denuncia.
 */
function lacunasDe(periodos: { period_start: string; period_end: string }[]): { de: string; ate: string; dias: number }[] {
  if (periodos.length < 2) return [];
  const ordenados = [...periodos].sort((a, b) => a.period_start.localeCompare(b.period_start));
  const lacunas: { de: string; ate: string; dias: number }[] = [];
  for (let i = 1; i < ordenados.length; i += 1) {
    const fimAnterior = new Date(`${ordenados[i - 1].period_end}T00:00:00Z`);
    const inicioAtual = new Date(`${ordenados[i].period_start}T00:00:00Z`);
    const dias = Math.round((inicioAtual.getTime() - fimAnterior.getTime()) / 86_400_000) - 1;
    if (dias > 0) {
      lacunas.push({ de: ordenados[i - 1].period_end, ate: ordenados[i].period_start, dias });
    }
  }
  return lacunas;
}

// ---------------------------------------------------------------------------
// Conciliação
// ---------------------------------------------------------------------------

export type Conciliacao = {
  /** Quanto do volume já tem liquidação casada, medido em R$ e não em linhas. */
  pctConciliado: number;
  conciliadoCents: number;
  totalCents: number;
  naoConciliados: number;
  /** Divergência entre o espelho do ERP e este ledger, mês a mês. */
  espelhoErp: { mes: string; linhasAqui: number; linhasErp: number; deltaCents: number; paridade: boolean }[];
  /** Transferências pareadas cujas pernas têm contrapartes diferentes. */
  transferenciasSuspeitas: { grupo: string; pernas: number; valorCents: number; contrapartes: string; motivo: string }[];
};

const CONCILIACAO_VAZIA: Conciliacao = {
  pctConciliado: 0,
  conciliadoCents: 0,
  totalCents: 0,
  naoConciliados: 0,
  espelhoErp: [],
  transferenciasSuspeitas: []
};

export async function getConciliacao(): Promise<Contrato<Conciliacao>> {
  if (!isFinanceConfigured()) {
    return contratoIndisponivel("conciliacao", CONCILIACAO_VAZIA, "banco financeiro não configurado");
  }
  try {
    const [resumo, espelho, suspeitas] = await Promise.all([
      // LEAST garante que liquidação parcial conte como parcial, e não como
      // zero nem como cheia.
      query<{ conciliado: string; total: string; nao: string }>(
        `SELECT COALESCE(SUM(LEAST(abs(COALESCE(s.amt, 0)), abs(t.amount_cents))), 0)::text AS conciliado,
                COALESCE(SUM(abs(t.amount_cents)), 0)::text AS total,
                count(*) FILTER (WHERE s.amt IS NULL)::text AS nao
           FROM fin_transaction t
           JOIN fin_entity e ON e.id = t.entity_id
           LEFT JOIN (SELECT transaction_id, SUM(amount_cents) AS amt FROM fin_settlement GROUP BY 1) s
                  ON s.transaction_id = t.id
          WHERE e.slug = $1 AND t.transfer_status = 'nao' AND NOT t.is_split_parent`,
        [ENTIDADE]
      ),
      query<{
        mes: string;
        linhas_aqui: string;
        linhas_erp: string;
        delta_cents: string;
        paridade: boolean;
      }>(
        `SELECT to_char(mes, 'YYYY-MM-DD') AS mes, linhas_aqui::text, linhas_erp::text,
                delta_cents::text, paridade
           FROM erp_extrato_reconciliacao_v ORDER BY mes DESC LIMIT 24`
      ),
      query<{ grupo: string; pernas: string; valor_cents: string; contrapartes: string; motivo: string }>(
        `SELECT grupo, pernas::text, valor_cents::text, contrapartes, motivo
           FROM fin_transferencia_suspeita ORDER BY valor_cents DESC LIMIT 100`
      )
    ]);

    const conciliado = Number(resumo[0]?.conciliado ?? 0);
    const total = Number(resumo[0]?.total ?? 0);

    return contrato({
      dominio: "conciliacao",
      dado: {
        pctConciliado: total > 0 ? (conciliado / total) * 100 : 0,
        conciliadoCents: conciliado,
        totalCents: total,
        naoConciliados: Number(resumo[0]?.nao ?? 0),
        espelhoErp: espelho.map((e) => ({
          mes: e.mes,
          linhasAqui: Number(e.linhas_aqui),
          linhasErp: Number(e.linhas_erp),
          deltaCents: Number(e.delta_cents),
          paridade: Boolean(e.paridade)
        })),
        transferenciasSuspeitas: suspeitas.map((s) => ({
          grupo: s.grupo,
          pernas: Number(s.pernas),
          valorCents: Number(s.valor_cents),
          contrapartes: s.contrapartes,
          motivo: s.motivo
        }))
      },
      ressalvas: [
        "Conciliação medida em R$, não em número de linhas: uma cobrança de R$ 15 mil pesa mais que trinta de R$ 60.",
        "Transferência suspeita é par casado por coincidência de valor+data unindo contrapartes distintas — já escondeu R$ 3.000 de receita e R$ 3.000 de despesa reais."
      ]
    });
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    console.error("[contrato:conciliacao]", mensagem);
    return contratoIndisponivel("conciliacao", CONCILIACAO_VAZIA, mensagem);
  }
}

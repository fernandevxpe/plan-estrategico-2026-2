import "server-only";

import { isFinanceConfigured, query } from "../db";
import {
  contrato,
  contratoIndisponivel,
  ENTIDADE,
  preencherMeses,
  type Contrato,
  type Drill,
  type Medida,
  type PontoMes,
  type SerieMensal
} from "./base";
import { getCobertura } from "./cobertura";

/**
 * Visão executiva: a primeira tela, e a que mais mente se for descuidada.
 *
 * Cada indicador aqui carrega três coisas que um KPI comum não carrega:
 *
 *   `medida`      — pode ser `null` COM motivo. Saldo de conta sem extrato não
 *                   é zero; é desconhecido, e a diferença entre as duas leituras
 *                   é a distância entre "tenho R$ 0" e "não sei quanto tenho".
 *   `drill`       — o filtro que reproduz o número linha a linha. Número que
 *                   não se abre não é auditável.
 *   `confiavel`   — falso quando a fonte que sustenta o indicador está atrasada.
 *                   É o que permite a tela apagar o número em vez de exibi-lo
 *                   com a mesma confiança de um dado fresco.
 */

const DOMINIO = "executivo";

export type IndicadorExecutivo = {
  chave: string;
  titulo: string;
  medida: Medida;
  /** Comparação com o período anterior, quando existe base para comparar. */
  variacaoPct: number | null;
  formato: "brl" | "brlCompact" | "pct" | "dias" | "numero";
  drill: Drill | null;
  confiavel: boolean;
  /** Por que não é confiável, quando não é. */
  ressalva: string | null;
};

export type VisaoExecutiva = {
  indicadores: IndicadorExecutivo[];
  receita12m: SerieMensal;
  despesa12m: SerieMensal;
  caixaPorConta: { slug: string; nome: string; saldoCents: number; diasSemExtrato: number | null; fecha: boolean | null }[];
  /** O placar do projeto: quantas das seis contas fecham. */
  regraZero: { fecham: number; total: number; aprovado: boolean };
  concentracaoTop5Pct: number | null;
};

const VAZIO: VisaoExecutiva = {
  indicadores: [],
  receita12m: { chave: "receita", rotulo: "Receita (caixa)", pontos: [], drill: null },
  despesa12m: { chave: "despesa", rotulo: "Despesa (caixa)", pontos: [], drill: null },
  caixaPorConta: [],
  regraZero: { fecham: 0, total: 0, aprovado: false },
  concentracaoTop5Pct: null
};

export async function getVisaoExecutiva(): Promise<Contrato<VisaoExecutiva>> {
  if (!isFinanceConfigured()) return contratoIndisponivel(DOMINIO, VAZIO, "banco financeiro não configurado");

  try {
    const cobertura = await getCobertura();
    const janela = janela12Meses();

    const [serie, aberto, vencido, concentracao] = await Promise.all([
      // Regime de CAIXA, declarado. A 0071 passou a oferecer competência
      // também, e a visão executiva escolhe caixa de propósito: é a única que
      // bate com o extrato, e esta é a tela onde "quanto tenho" tem de ser
      // literal. Quem quiser competência abre a DRE e escolhe a visão.
      query<{ mes: string; entrada: string; saida: string; n: string }>(
        `SELECT to_char(date_trunc('month', t.posted_on), 'YYYY-MM-DD') AS mes,
                COALESCE(SUM(t.amount_cents) FILTER (WHERE t.amount_cents > 0), 0)::text AS entrada,
                COALESCE(SUM(-t.amount_cents) FILTER (WHERE t.amount_cents < 0), 0)::text AS saida,
                count(*)::text AS n
           FROM fin_transaction t JOIN fin_entity e ON e.id = t.entity_id
          WHERE e.slug = $1 AND t.transfer_status <> 'pareado' AND NOT t.is_split_parent
            AND t.posted_on >= $2
          GROUP BY 1 ORDER BY 1`,
        [ENTIDADE, janela.de]
      ),
      query<{ total: string; n: string }>(
        `SELECT COALESCE(SUM(aberto_cents), 0)::text AS total, count(*)::text AS n
           FROM fin_receber_aberto_v r JOIN fin_entity e ON e.id = r.entity_id WHERE e.slug = $1`,
        [ENTIDADE]
      ),
      query<{ total: string; n: string }>(
        `SELECT COALESCE(SUM(aberto_cents), 0)::text AS total, count(*)::text AS n
           FROM fin_receber_aging_v r JOIN fin_entity e ON e.id = r.entity_id
          WHERE e.slug = $1 AND r.dias_atraso > 0`,
        [ENTIDADE]
      ),
      query<{ cliente: string; total: string }>(
        `SELECT cp.name AS cliente, SUM(rc.amount_cents)::text AS total
           FROM fin_revenue_cash_v rc
           JOIN fin_entity e ON e.id = rc.entity_id
           JOIN fin_counterparty cp ON cp.id = rc.counterparty_id
          WHERE e.slug = $1 AND rc.posted_on >= $2
          GROUP BY 1 ORDER BY SUM(rc.amount_cents) DESC`,
        [ENTIDADE, janela.de]
      )
    ]);

    const pontosReceita: PontoMes[] = serie.map((s) => ({
      mes: s.mes,
      valorCents: Number(s.entrada),
      n: Number(s.n),
      incompleto: false,
      motivoIncompleto: null
    }));
    const pontosDespesa: PontoMes[] = serie.map((s) => ({
      mes: s.mes,
      valorCents: Number(s.saida),
      n: Number(s.n),
      incompleto: false,
      motivoIncompleto: null
    }));

    const saldoTotal = cobertura.contas
      // "caixa" carrega o passivo do Pronampe (fundida com a antiga
      // caixa-emprestimo na 0119) e não tem extrato ainda — o saldo bruto
      // desta conta aqui é current_balance_cents, não o declarado, e somá-lo
      // faria o runway mentir por zero em vez de por dívida.
      .filter((c) => c.slug !== "caixa")
      .reduce((soma, c) => soma + c.saldoCents, 0);

    const totalReceita = concentracao.reduce((soma, c) => soma + Number(c.total), 0);
    const top5 = concentracao.slice(0, 5).reduce((soma, c) => soma + Number(c.total), 0);

    const contasAtrasadas = cobertura.contasAtrasadas;
    const extratoFresco = contasAtrasadas === 0;

    const indicadores: IndicadorExecutivo[] = [
      {
        chave: "saldo",
        titulo: "Caixa hoje",
        medida: { valorCents: saldoTotal, motivo: null },
        variacaoPct: null,
        formato: "brl",
        drill: { dominio: "bancos", filtros: {} },
        confiavel: extratoFresco,
        ressalva: extratoFresco ? null : `${contasAtrasadas} conta(s) sem extrato em D+1 — o saldo pode estar defasado`
      },
      {
        chave: "a_receber",
        titulo: "A receber em aberto",
        medida: { valorCents: Number(aberto[0]?.total ?? 0), motivo: null },
        variacaoPct: null,
        formato: "brl",
        drill: { dominio: "receber", filtros: { status: "aberto" } },
        confiavel: true,
        ressalva: null
      },
      {
        chave: "vencido",
        titulo: "Vencido e não recebido",
        medida: { valorCents: Number(vencido[0]?.total ?? 0), motivo: null },
        variacaoPct: null,
        formato: "brl",
        drill: { dominio: "receber", filtros: { vencido: true } },
        confiavel: true,
        ressalva: null
      },
      {
        chave: "a_pagar",
        titulo: "A pagar em aberto",
        // Zero aqui seria mentira: o ledger não tem NENHUM documento a pagar.
        // Não é "não devemos nada" — é "as contas a pagar nunca foram
        // carregadas". Declarar como indeterminado é o único jeito honesto.
        medida: await medidaAPagar(),
        variacaoPct: null,
        formato: "brl",
        drill: { dominio: "pagar", filtros: {} },
        confiavel: false,
        ressalva: "o ledger não tem documentos a pagar carregados"
      },
      {
        chave: "concentracao",
        titulo: "Top 5 clientes",
        medida: { valorCents: top5, motivo: null },
        variacaoPct: totalReceita ? (top5 / totalReceita) * 100 : null,
        formato: "brl",
        drill: { dominio: "receber", filtros: {} },
        confiavel: true,
        ressalva: null
      }
    ];

    return contrato({
      dominio: DOMINIO,
      dado: {
        indicadores,
        receita12m: {
          chave: "receita",
          rotulo: "Receita (regime de caixa)",
          pontos: preencherMeses(pontosReceita, janela.de, janela.ate, "sem lançamento importado neste mês"),
          drill: { dominio: "lancamentos", filtros: { natureza: "entrada" } }
        },
        despesa12m: {
          chave: "despesa",
          rotulo: "Despesa (regime de caixa)",
          pontos: preencherMeses(pontosDespesa, janela.de, janela.ate, "sem lançamento importado neste mês"),
          drill: { dominio: "lancamentos", filtros: { natureza: "saida" } }
        },
        caixaPorConta: cobertura.contas.map((c) => ({
          slug: c.slug,
          nome: c.fonte,
          saldoCents: c.saldoCents,
          diasSemExtrato: c.diasDesatualizado,
          fecha: c.fechaCaixa
        })),
        regraZero: {
          fecham: cobertura.contas.filter((c) => c.fechaCaixa === true).length,
          total: cobertura.contas.length,
          aprovado: cobertura.contasQueNaoFecham === 0 && cobertura.contas.length > 0
        },
        concentracaoTop5Pct: totalReceita ? (top5 / totalReceita) * 100 : null
      },
      cobertura: cobertura.fontes,
      ressalvas: [
        "Todos os números desta tela são REGIME DE CAIXA, por escolha: é o regime que bate com o extrato. A visão de competência existe e mora em /dre.",
        "Transferência entre contas próprias sai do cálculo (transfer_status <> 'pareado'), senão R$ 3,82 mi contariam em dobro."
      ]
    });
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    console.error("[contrato:executivo]", mensagem);
    return contratoIndisponivel(DOMINIO, VAZIO, mensagem);
  }
}

/**
 * O "a pagar" que não existe.
 *
 * `fin_document` tem 3.406 linhas e TODAS são `direction='receber'`. Um KPI
 * mostrando R$ 0,00 seria lido como "não devemos nada", que é o erro mais caro
 * possível numa tela de caixa. Enquanto o número for zero por ausência de
 * fonte, ele sai como indeterminado com o motivo escrito.
 */
async function medidaAPagar(): Promise<Medida> {
  const [linha] = await query<{ n: string; total: string }>(
    `SELECT count(*)::text AS n, COALESCE(SUM(d.amount_cents - d.settled_cents), 0)::text AS total
       FROM fin_document d JOIN fin_entity e ON e.id = d.entity_id
      WHERE e.slug = $1 AND d.direction = 'pagar' AND d.status IN ('previsto','emitido','confirmado','parcial')`,
    [ENTIDADE]
  );
  if (Number(linha?.n ?? 0) === 0) {
    return {
      valorCents: null,
      motivo:
        "nenhum documento a pagar no ledger: as contas a pagar ainda não foram carregadas. Zero aqui significaria 'não devemos nada'."
    };
  }
  return { valorCents: Number(linha.total), motivo: null };
}

function janela12Meses(): { de: string; ate: string } {
  const hoje = new Date();
  const ate = `${hoje.getUTCFullYear()}-${String(hoje.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const inicio = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - 11, 1));
  const de = `${inicio.getUTCFullYear()}-${String(inicio.getUTCMonth() + 1).padStart(2, "0")}-01`;
  return { de, ate };
}

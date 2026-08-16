import "server-only";

import { isFinanceConfigured, query } from "../db";
import { contrato, contratoIndisponivel, ENTIDADE, type Contrato, type Drill, type Medida } from "./base";

/**
 * Resultado: DRE, fluxo de caixa, orçado × realizado e margem por projeto.
 *
 * O REGIME É PARÂMETRO, NÃO SUPOSIÇÃO
 *
 * A `0071` preencheu `competence_date` em 100% dos 13.880 lançamentos, com
 * regra declarada e precedência (`fin_competencia_cobertura_v`). Antes dela a
 * competência não existia e esta tela só podia ser de caixa. Agora existem as
 * duas visões, e a decisão de qual mostrar é do usuário — nunca implícita.
 *
 * O contrato obriga a escolha (`visao: 'caixa' | 'competencia'`) e devolve a
 * COBERTURA daquela visão junto: quanto do valor veio de regra documental
 * (nota, cobrança, data de compra) e quanto veio de presunção. Um DRE de
 * competência sustentado por 5,6% de linhas presumidas é utilizável; o mesmo
 * DRE sem essa informação ao lado é uma afirmação sem lastro.
 *
 * A diferença entre as duas visões é grande e real: ago/2026 fecha com
 * −R$ 60.272,53 em caixa e +R$ 41.277,79 em competência. Não é erro; é o mês
 * em que a folha saiu e a receita ainda não entrou.
 */

const DOMINIO = "resultado";

export type Visao = "caixa" | "competencia";

export type LinhaDre = {
  linha: string;
  nome: string;
  secao: string;
  tipo: string;
  ordem: number;
  formula: string | null;
  valorCents: number;
  drill: Drill | null;
};

export type MesDre = {
  mes: string;
  receitaBrutaCents: number;
  deducoesCents: number;
  receitaLiquidaCents: number;
  custosDiretosCents: number;
  margemContribuicaoCents: number;
  despesasPessoalCents: number;
  despesasComerciaisCents: number;
  despesasAdministrativasCents: number;
  resultadoOperacionalCents: number;
  resultadoFinanceiroCents: number;
  lucroLiquidoCents: number;
  margemLiquidaPct: number | null;
  capexCents: number;
  /** O que o ledger não explica. Some do resultado se ignorado. */
  lacunaLedgerCents: number;
  lacunaCartaoCents: number;
  lucroComLacunasCents: number;
  lancamentos: number;
};

export type CoberturaDre = {
  mes: string;
  linhas: number;
  linhasPresumidas: number;
  pctValorPresumido: number;
  pctNucleo: number;
  pctCliente: number;
  pctCentroCusto: number;
  lacunasCents: number;
  lacunaSobreResultadoPct: number | null;
  folhaDoMesJaPaga: boolean;
};

export type Resultado = {
  visao: Visao;
  meses: MesDre[];
  linhasDoMes: LinhaDre[];
  mesSelecionado: string | null;
  cobertura: CoberturaDre[];
  /** Como a competência foi determinada, regra a regra. Vazio na visão de caixa. */
  regrasDeCompetencia: RegraCompetencia[];
};

export type RegraCompetencia = {
  aplicaEm: string;
  regra: string;
  nome: string;
  confianca: "documento" | "convencao" | "evento" | "presumida" | string;
  fonte: string | null;
  linhas: number;
  pctLinhas: number;
  valorCents: number;
  linhasQueMudamDeMes: number;
  valorQueMudaDeMesCents: number;
};

const VAZIO: Resultado = {
  visao: "caixa",
  meses: [],
  linhasDoMes: [],
  mesSelecionado: null,
  cobertura: [],
  regrasDeCompetencia: []
};

export async function getResultado(
  opcoes: { visao?: Visao; ano?: number; mes?: string } = {}
): Promise<Contrato<Resultado>> {
  if (!isFinanceConfigured()) return contratoIndisponivel(DOMINIO, VAZIO, "banco financeiro não configurado");

  const visao: Visao = opcoes.visao === "competencia" ? "competencia" : "caixa";
  const ano = opcoes.ano ?? new Date().getUTCFullYear();

  try {
    const [meses, cobertura, regras] = await Promise.all([
      query<Record<string, unknown>>(
        `SELECT m.* FROM fin_dre_mensal_v m JOIN fin_entity e ON e.id = m.entity_id
          WHERE e.slug = $1 AND m.visao = $2 AND EXTRACT(year FROM m.mes) = $3
          ORDER BY m.mes`,
        [ENTIDADE, visao, ano]
      ),
      query<Record<string, unknown>>(
        `SELECT c.* FROM fin_dre_cobertura_v c
          WHERE c.visao = $1 AND EXTRACT(year FROM c.mes) = $2 ORDER BY c.mes`,
        [visao, ano]
      ),
      visao === "competencia"
        ? query<Record<string, unknown>>(
            `SELECT * FROM fin_competencia_cobertura_v ORDER BY precedencia, aplica_em`
          )
        : Promise.resolve([] as Record<string, unknown>[])
    ]);

    // O mês de detalhe: o pedido, ou o último disponível. Abrir a tela sem
    // nenhuma linha selecionada obrigaria um segundo clique para ver qualquer
    // coisa.
    const mesSelecionado =
      opcoes.mes ?? (meses.length ? String(meses[meses.length - 1].mes).slice(0, 10) : null);

    const linhas = mesSelecionado
      ? await query<Record<string, unknown>>(
          `SELECT d.* FROM fin_dre_v d JOIN fin_entity e ON e.id = d.entity_id
            WHERE e.slug = $1 AND d.visao = $2 AND d.mes = $3::date ORDER BY d.ordem`,
          [ENTIDADE, visao, mesSelecionado]
        )
      : [];

    return contrato({
      dominio: DOMINIO,
      dado: {
        visao,
        meses: meses.map((m) => ({
          mes: String(m.mes).slice(0, 10),
          receitaBrutaCents: Number(m.receita_bruta_cents ?? 0),
          deducoesCents: Number(m.deducoes_cents ?? 0),
          receitaLiquidaCents: Number(m.receita_liquida_cents ?? 0),
          custosDiretosCents: Number(m.custos_diretos_cents ?? 0),
          margemContribuicaoCents: Number(m.margem_contribuicao_cents ?? 0),
          despesasPessoalCents: Number(m.despesas_pessoal_cents ?? 0),
          despesasComerciaisCents: Number(m.despesas_comerciais_cents ?? 0),
          despesasAdministrativasCents: Number(m.despesas_administrativas_cents ?? 0),
          resultadoOperacionalCents: Number(m.resultado_operacional_cents ?? 0),
          resultadoFinanceiroCents: Number(m.resultado_financeiro_cents ?? 0),
          lucroLiquidoCents: Number(m.lucro_liquido_cents ?? 0),
          margemLiquidaPct: m.margem_liquida_pct === null ? null : Number(m.margem_liquida_pct),
          capexCents: Number(m.capex_cents ?? 0),
          lacunaLedgerCents: Number(m.lacuna_ledger_cents ?? 0),
          lacunaCartaoCents: Number(m.lacuna_cartao_cents ?? 0),
          lucroComLacunasCents: Number(m.lucro_liquido_com_lacunas_cents ?? 0),
          lancamentos: Number(m.lancamentos ?? 0)
        })),
        linhasDoMes: linhas.map((l) => ({
          linha: String(l.linha),
          nome: String(l.linha_nome),
          secao: String(l.secao),
          tipo: String(l.tipo),
          ordem: Number(l.ordem),
          formula: (l.formula as string) ?? null,
          valorCents: Number(l.valor_cents ?? 0),
          // Só linha de item abre: subtotal e calculado não têm lançamento
          // próprio, e um drill que devolve vazio parece bug.
          drill:
            l.tipo === "item"
              ? { dominio: "lancamentos", filtros: { linha: String(l.linha), de: mesSelecionado } }
              : null
        })),
        mesSelecionado,
        cobertura: cobertura.map((c) => ({
          mes: String(c.mes).slice(0, 10),
          linhas: Number(c.linhas ?? 0),
          linhasPresumidas: Number(c.linhas_presumidas ?? 0),
          pctValorPresumido: Number(c.pct_valor_presumido ?? 0),
          pctNucleo: Number(c.pct_nucleo ?? 0),
          pctCliente: Number(c.pct_cliente ?? 0),
          pctCentroCusto: Number(c.pct_centro_custo ?? 0),
          lacunasCents: Number(c.lacunas_cents ?? 0),
          lacunaSobreResultadoPct:
            c.lacuna_sobre_resultado_pct === null ? null : Number(c.lacuna_sobre_resultado_pct),
          folhaDoMesJaPaga: Boolean(c.folha_do_mes_ja_paga)
        })),
        regrasDeCompetencia: regras.map((r) => ({
          aplicaEm: String(r.aplica_em),
          regra: String(r.regra),
          nome: String(r.regra_nome),
          confianca: String(r.confianca),
          fonte: (r.fonte as string) ?? null,
          linhas: Number(r.linhas ?? 0),
          pctLinhas: Number(r.pct_linhas ?? 0),
          valorCents: Number(r.valor_cents ?? 0),
          linhasQueMudamDeMes: Number(r.linhas_que_mudam_de_mes ?? 0),
          valorQueMudaDeMesCents: Number(r.valor_que_muda_de_mes_cents ?? 0)
        }))
      },
      ressalvas: [
        visao === "competencia"
          ? "Visão de COMPETÊNCIA: a data vem de regra declarada (nota, cobrança, folha), com precedência documentada. Confira pctValorPresumido antes de citar o número."
          : "Visão de CAIXA: a data é a do extrato. É o regime que bate com o banco, e o único em que 'o caixa fecha' faz sentido.",
        "lacunaLedgerCents é o que o ledger não explica. Ignorá-la faz o resultado parecer mais limpo do que é — por isso lucroComLacunasCents vem ao lado.",
        "As duas visões divergem por construção, e a divergência é informação: é o descasamento entre quando o serviço aconteceu e quando o dinheiro andou."
      ]
    });
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    console.error("[contrato:resultado]", mensagem);
    return contratoIndisponivel(DOMINIO, VAZIO, mensagem);
  }
}

// ---------------------------------------------------------------------------
// Fluxo de caixa
// ---------------------------------------------------------------------------

export type MesFluxo = {
  mes: string;
  saldoInicialCents: number;
  operacionalCents: number;
  investimentoCents: number;
  financiamentoCents: number;
  transferenciaInternaCents: number;
  naoClassificadoCents: number;
  saidaSemHistoricoCents: number;
  movimentoCents: number;
  saldoFinalCents: number;
  /** Diferença entre saldo inicial + movimento e saldo final. Deve ser zero. */
  residuoCents: number;
  fecha: boolean;
  lancamentos: number;
};

export async function getFluxoDeCaixa(ano?: number): Promise<Contrato<MesFluxo[]>> {
  if (!isFinanceConfigured()) return contratoIndisponivel("fluxo", [], "banco financeiro não configurado");
  try {
    const linhas = await query<Record<string, unknown>>(
      `SELECT f.* FROM fin_fluxo_caixa_v f JOIN fin_entity e ON e.id = f.entity_id
        WHERE e.slug = $1 AND ($2::int IS NULL OR EXTRACT(year FROM f.mes) = $2::int)
        ORDER BY f.mes`,
      [ENTIDADE, ano ?? null]
    );
    return contrato({
      dominio: "fluxo",
      dado: linhas.map((f) => ({
        mes: String(f.mes).slice(0, 10),
        saldoInicialCents: Number(f.saldo_inicial_cents ?? 0),
        operacionalCents: Number(f.operacional_cents ?? 0),
        investimentoCents: Number(f.investimento_cents ?? 0),
        financiamentoCents: Number(f.financiamento_cents ?? 0),
        transferenciaInternaCents: Number(f.transferencia_interna_cents ?? 0),
        naoClassificadoCents: Number(f.nao_classificado_cents ?? 0),
        saidaSemHistoricoCents: Number(f.saida_sem_historico_cents ?? 0),
        movimentoCents: Number(f.movimento_cents ?? 0),
        saldoFinalCents: Number(f.saldo_final_cents ?? 0),
        residuoCents: Number(f.residuo_cents ?? 0),
        // O resíduo é o teste do fluxo: ele fecha ou não fecha, e mostrar a
        // tabela sem esse carimbo convida a somar colunas que não somam.
        fecha: Number(f.residuo_cents ?? 0) === 0,
        lancamentos: Number(f.lancamentos ?? 0)
      })),
      ressalvas: [
        "Fluxo é sempre REGIME DE CAIXA — é a única visão que bate com o extrato.",
        "residuoCents ≠ 0 significa que a demonstração não fecha: some as colunas antes de citar qualquer linha dela."
      ]
    });
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    console.error("[contrato:fluxo]", mensagem);
    return contratoIndisponivel("fluxo", [], mensagem);
  }
}

// ---------------------------------------------------------------------------
// Orçado × realizado
// ---------------------------------------------------------------------------

export type LinhaOrcamento = {
  targetId: number;
  linha: string;
  slug: string;
  secao: string;
  escopo: string;
  periodicidade: string;
  ano: number;
  periodo: number;
  metaCents: number;
  realizado: Medida;
  comprometidoCents: number;
  pedidoCents: number;
  disponivel: Medida;
  consumoPct: number | null;
  drill: Drill | null;
};

export async function getOrcadoRealizado(ano?: number): Promise<Contrato<LinhaOrcamento[]>> {
  if (!isFinanceConfigured()) return contratoIndisponivel("orcamento", [], "banco financeiro não configurado");
  try {
    const linhas = await query<Record<string, unknown>>(
      `SELECT o.* FROM fin_orcamento_disponivel_v o
         JOIN fin_entity e ON e.id = o.entity_id
        WHERE e.slug = $1 AND o.ano = $2
        ORDER BY o.section, o.periodo, o.line_slug`,
      [ENTIDADE, ano ?? new Date().getUTCFullYear()]
    );

    const itens = linhas.map(mapearOrcamento);
    const semRealizado = itens.filter((i) => i.realizado.valorCents === null).length;

    return contrato({
      dominio: "orcamento",
      dado: itens,
      pendencias: semRealizado
        ? [
            {
              chave: "orcamento_escopo_obras",
              titulo: "Metas cujo realizado não mora neste ledger",
              quantidade: semRealizado,
              valorCents: itens
                .filter((i) => i.realizado.valorCents === null)
                .reduce((s, i) => s + i.metaCents, 0),
              severidade: "alerta",
              telaDeDecisao: "/financeiro/planejamento"
            }
          ]
        : [],
      ressalvas: [
        "disponivel = meta − realizado − comprometido (o que já está na fila de pagamento e ainda não virou caixa).",
        "As 114 metas de fin_budget_target são TODAS de escopo 'obras', cujo realizado mora no ledger do erp-obras. Por isso o realizado sai indeterminado com motivo, e não zero.",
        "Comparar meta de obras com realizado da holding produziria uma variação que não significa nada — o contrato se recusa a fazê-lo."
      ]
    });
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    console.error("[contrato:orcamento]", mensagem);
    return contratoIndisponivel("orcamento", [], mensagem);
  }
}

function mapearOrcamento(l: Record<string, unknown>): LinhaOrcamento {
  const meta = Number(l.meta_cents ?? 0);
  const motivo = (l.realizado_indeterminado_motivo as string) ?? null;
  const realizado = l.realizado_cents === null || l.realizado_cents === undefined ? null : Number(l.realizado_cents);
  const disponivel =
    l.disponivel_cents === null || l.disponivel_cents === undefined ? null : Number(l.disponivel_cents);

  return {
    targetId: Number(l.target_id ?? 0),
    linha: String(l.linha),
    slug: String(l.line_slug),
    secao: String(l.section),
    escopo: String(l.escopo),
    periodicidade: String(l.periodicidade),
    ano: Number(l.ano),
    periodo: Number(l.periodo),
    metaCents: meta,
    realizado: { valorCents: motivo ? null : realizado, motivo },
    comprometidoCents: Number(l.comprometido_cents ?? 0),
    pedidoCents: Number(l.pedido_cents ?? 0),
    disponivel: { valorCents: disponivel, motivo: disponivel === null ? motivo ?? "realizado indeterminado" : null },
    consumoPct: motivo || meta === 0 ? null : (Math.abs(realizado ?? 0) / meta) * 100,
    drill: { dominio: "lancamentos", filtros: { linha: String(l.line_slug) } }
  };
}

// ---------------------------------------------------------------------------
// Margem por projeto
// ---------------------------------------------------------------------------

export type MargemProjeto = {
  centroCustoId: number;
  slug: string;
  nome: string;
  tipo: string;
  nucleo: string | null;
  statusOrigem: string | null;
  contratoCents: number | null;
  receitaCents: number;
  custoCents: number;
  margemCents: number;
  margemPct: number | null;
  indefinidoCents: number;
  tesourariaCents: number;
  apontamentos: number;
  conciliadoPct: number | null;
  drill: Drill;
};

export async function getMargemPorProjeto(): Promise<Contrato<MargemProjeto[]>> {
  if (!isFinanceConfigured()) return contratoIndisponivel("margem", [], "banco financeiro não configurado");
  try {
    const linhas = await query<Record<string, unknown>>(
      `SELECT m.* FROM fin_projeto_margem_v m JOIN fin_entity e ON e.id = m.entity_id
        WHERE e.slug = $1 ORDER BY m.margem_cents DESC NULLS LAST`,
      [ENTIDADE]
    );
    return contrato({
      dominio: "margem",
      dado: linhas.map((l) => {
        const receita = Number(l.receita_cents ?? 0);
        const custo = Number(l.custo_cents ?? 0);
        const conciliado = Number(l.custo_conciliado_cents ?? 0);
        return {
          centroCustoId: Number(l.cost_center_id),
          slug: String(l.slug),
          nome: String(l.name),
          tipo: String(l.kind),
          nucleo: (l.nucleo as string) ?? null,
          statusOrigem: (l.source_status as string) ?? null,
          contratoCents: l.contract_cents === null ? null : Number(l.contract_cents),
          receitaCents: receita,
          custoCents: custo,
          margemCents: Number(l.margem_cents ?? 0),
          margemPct: receita > 0 ? (Number(l.margem_cents ?? 0) / receita) * 100 : null,
          indefinidoCents: Number(l.indefinido_cents ?? 0),
          tesourariaCents: Number(l.tesouraria_cents ?? 0),
          apontamentos: Number(l.apontamentos ?? 0),
          conciliadoPct: custo !== 0 ? (Math.abs(conciliado) / Math.abs(custo)) * 100 : null,
          drill: { dominio: "lancamentos", filtros: { centroCusto: String(l.slug) } }
        };
      }),
      ressalvas: [
        "O centro de custo vem do erp-obras, que carimba projeto majoritariamente em movimento de TESOURARIA — por isso tesourariaCents é separado: aquele valor não é custo de obra.",
        "Margem com indefinidoCents alto é margem frágil: parte do custo entrou sem natureza declarada."
      ]
    });
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    console.error("[contrato:margem]", mensagem);
    return contratoIndisponivel("margem", [], mensagem);
  }
}

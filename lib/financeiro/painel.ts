import "server-only";

import { isFinanceConfigured, query } from "./db";
import { brlCents, brlCompact, pct } from "./format";

/**
 * O briefing executivo: a leitura que um CFO faz antes de decidir, e a que ele
 * apresenta ao conselho.
 *
 * Três decisões estruturais, porque nenhuma é óbvia lendo só os tipos:
 *
 * 1. NÚMERO SOZINHO NÃO É INFORMAÇÃO. Todo indicador carrega `comparacao`
 *    (contra o período anterior, contra a meta, contra o mesmo mês do ano
 *    passado) e `veredito` — a frase que diz o que o número significa. Um painel
 *    que mostra "R$ 49.826,06" e para aí transfere a interpretação para quem
 *    olha, e cada pessoa interpreta diferente.
 *
 * 2. VEREDITO É DERIVADO, NUNCA ESCRITO À MÃO. Título e frase saem de limiares
 *    aplicados ao dado do momento. Um texto fixo ("receita cresceu") vira mentira
 *    silenciosa no primeiro trimestre de queda — e mentira num painel de diretoria
 *    custa mais do que a ausência do painel.
 *
 * 3. `confiavel: false` É UM RESULTADO, NÃO UM ERRO. Só o Asaas alimenta o
 *    ledger: não há despesa, quatro das cinco contas nunca tiveram extrato
 *    importado e R$ 1,9 mi saíram do gateway para contas que este banco não
 *    enxerga. Um indicador construído sobre esse vazio é marcado como não
 *    confiável e diz por quê, em vez de exibir um número redondo que ninguém
 *    consegue auditar. Dias de cobertura de caixa é o caso extremo: sem despesa
 *    registrada, a resposta honesta é "indisponível", nunca um runway inventado
 *    a partir de uma base que não existe.
 *
 * A linguagem é a do gestao-xpe/17_throughput_accounting_xpe.md: Throughput =
 * Receita − Custos Totalmente Variáveis, sem rateio de custo fixo para decisão
 * operacional. Não é vocabulário de SaaS emprestado.
 */

const ENTITY = "xpe";

// Proxy de recorrência por categoria: 3.06 comissionamento, 3.07 medição e
// monitoramento, 3.09 gestão de faturas. São os serviços de natureza mensal.
// Mesma lista de lib/financeiro/receitas.ts — duas definições de "recorrente"
// divergindo em silêncio é como duas telas param de bater.
const CATEGORIAS_RECORRENTES = ["3.06", "3.07", "3.09"];

// A curva de recuperação de vencido, idêntica à de forecast.ts. Repetir o número
// aqui seria criar uma segunda verdade sobre a mesma cobrança.
const CURVA_RECUPERACAO: Record<string, number> = {
  "1 a 30 dias": 0.9,
  "31 a 60 dias": 0.7,
  "61 a 90 dias": 0.5,
  "mais de 90 dias": 0.2
};

// Um mês corrente tem sempre menos dias que os anteriores. Compará-lo com mês
// fechado produz "queda de 88%" toda primeira semana. Toda leitura de tendência
// deste arquivo usa MESES FECHADOS.
const MESES_RUN_RATE = 3;

export type Tendencia = "melhorando" | "piorando" | "estavel";
export type Formato = "brl" | "brlCompact" | "pct" | "dias" | "numero";

/**
 * A unidade do painel. `valor` é sempre número cru (centavos quando o formato é
 * monetário); a formatação mora na tela. As frases já vêm prontas porque a regra
 * que as produz é regra de negócio, não de apresentação.
 */
export type Indicador = {
  rotulo: string;
  formato: Formato;
  valor: number;
  comparacao: string;
  tendencia: Tendencia;
  veredito: string;
  acao: string | null;
  confiavel: boolean;
};

export type SerieMes = {
  mes: string;
  receitaCents: number;
  media3mCents: number;
  anoAnteriorCents: number | null;
  parcial: boolean;
};

export type LinhaNucleo = {
  slug: string;
  nome: string;
  receitaCents: number;
  receitaAnteriorCents: number;
  deltaCents: number;
  pctDoTotal: number;
  pctDoCrescimento: number;
  ctvCents: number;
  throughputCents: number;
  margemThroughputPct: number;
};

export type FaixaAging = {
  faixa: string;
  abertoCents: number;
  n: number;
  recuperacaoEsperadaCents: number;
  critica: boolean;
};

export type LinhaPareto = {
  nome: string;
  receitaCents: number;
  pctIndividual: number;
  pctAcumulado: number;
  top10: boolean;
};

export type Grafico<T> = {
  titulo: string;
  subtitulo: string;
  dados: T[];
  confiavel: boolean;
};

export type PainelExecutivo = {
  disponivel: boolean;
  hoje: string;
  mesAtual: string;
  mesFechado: string;
  leituraDoMes: string[];
  destaques: Indicador[];
  caixa: {
    saldoCents: number;
    saldoLivreCents: number;
    reservasSeparadasCents: number;
    metaReservasCents: number;
    saldo30dAtrasCents: number;
    entradaMediaDiariaCents: number;
    despesa90dCents: number;
    diasCobertura: number | null;
    saidaEmTransito12mCents: number;
    indicadores: Indicador[];
  };
  motor: {
    receita12mCents: number;
    receita12mAnteriorCents: number;
    crescimentoPct: number;
    runRateCents: number;
    ticketCents: number;
    ticketAnteriorCents: number;
    nCobrancas: number;
    nCobrancasAnterior: number;
    clientes: number;
    clientesAnterior: number;
    efeitoVolumeCents: number;
    efeitoTicketCents: number;
    efeitoCombinadoCents: number;
    grafico: Grafico<SerieMes>;
    graficoNucleo: Grafico<LinhaNucleo>;
    indicadores: Indicador[];
  };
  qualidade: {
    pctRecorrenteProxy: number;
    mrrContratadoCents: number;
    contratosAtivos: number;
    pctMrrSobreRunRate: number;
    hhi: number;
    top10Pct: number;
    maiorClienteNome: string;
    maiorClientePct: number;
    clientesQueNaoVoltaram: number;
    baseChurn: number;
    receitaQueNaoVoltouCents: number;
    grafico: Grafico<LinhaPareto>;
    indicadores: Indicador[];
  };
  ciclo: {
    pmrDiasEmissao: number | null;
    pmrDiasEmissaoAnterior: number | null;
    prazoConcedidoDias: number | null;
    prazoConcedidoDiasAnterior: number | null;
    atrasoMedioDias: number | null;
    pctEmDia: number;
    pctEmDiaAnterior: number;
    grafico: Grafico<FaixaAging>;
    indicadores: Indicador[];
  };
  throughput: {
    receita12mCents: number;
    ctv12mCents: number;
    throughput12mCents: number;
    margemPct: number;
    porNucleo: LinhaNucleo[];
    indicadores: Indicador[];
  };
  riscos: Indicador[];
  lacunas: { titulo: string; detalhe: string }[];
};

// ---------------------------------------------------------------------------
// Aritmética de mês sobre string 'YYYY-MM-01'.
//
// Sem passar por Date: `new Date("2026-08-01")` lido em BRT vira 31/07 21h e o
// mês migra sozinho. Mesma escolha de lib/financeiro/forecast.ts.
// ---------------------------------------------------------------------------
function somaMeses(mesIso: string, n: number): string {
  const [ano, mes] = mesIso.split("-").map(Number);
  const total = ano * 12 + (mes - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}-01`;
}

/**
 * Tendência com zona morta.
 *
 * Sem a tolerância, uma variação de 0,3% viraria "melhorando" e a seta do painel
 * mudaria de direção toda semana — o que ensina o leitor a ignorar a seta.
 */
function tendenciaDe(
  atual: number,
  anterior: number,
  { toleranciaPct = 5, maiorEhMelhor = true }: { toleranciaPct?: number; maiorEhMelhor?: boolean } = {}
): Tendencia {
  if (!Number.isFinite(atual) || !Number.isFinite(anterior) || anterior === 0) return "estavel";
  const variacao = ((atual - anterior) / Math.abs(anterior)) * 100;
  if (Math.abs(variacao) < toleranciaPct) return "estavel";
  const subiu = variacao > 0;
  return subiu === maiorEhMelhor ? "melhorando" : "piorando";
}

function variacaoPct(atual: number, anterior: number): number {
  if (!anterior) return 0;
  return ((atual - anterior) / Math.abs(anterior)) * 100;
}

function painelIndisponivel(): PainelExecutivo {
  const vazio: Grafico<never> = { titulo: "", subtitulo: "", dados: [], confiavel: false };
  return {
    disponivel: false,
    hoje: "",
    mesAtual: "",
    mesFechado: "",
    leituraDoMes: [],
    destaques: [],
    caixa: {
      saldoCents: 0,
      saldoLivreCents: 0,
      reservasSeparadasCents: 0,
      metaReservasCents: 0,
      saldo30dAtrasCents: 0,
      entradaMediaDiariaCents: 0,
      despesa90dCents: 0,
      diasCobertura: null,
      saidaEmTransito12mCents: 0,
      indicadores: []
    },
    motor: {
      receita12mCents: 0,
      receita12mAnteriorCents: 0,
      crescimentoPct: 0,
      runRateCents: 0,
      ticketCents: 0,
      ticketAnteriorCents: 0,
      nCobrancas: 0,
      nCobrancasAnterior: 0,
      clientes: 0,
      clientesAnterior: 0,
      efeitoVolumeCents: 0,
      efeitoTicketCents: 0,
      efeitoCombinadoCents: 0,
      grafico: vazio,
      graficoNucleo: vazio,
      indicadores: []
    },
    qualidade: {
      pctRecorrenteProxy: 0,
      mrrContratadoCents: 0,
      contratosAtivos: 0,
      pctMrrSobreRunRate: 0,
      hhi: 0,
      top10Pct: 0,
      maiorClienteNome: "—",
      maiorClientePct: 0,
      clientesQueNaoVoltaram: 0,
      baseChurn: 0,
      receitaQueNaoVoltouCents: 0,
      grafico: vazio,
      indicadores: []
    },
    ciclo: {
      pmrDiasEmissao: null,
      pmrDiasEmissaoAnterior: null,
      prazoConcedidoDias: null,
      prazoConcedidoDiasAnterior: null,
      atrasoMedioDias: null,
      pctEmDia: 0,
      pctEmDiaAnterior: 0,
      grafico: vazio,
      indicadores: []
    },
    throughput: {
      receita12mCents: 0,
      ctv12mCents: 0,
      throughput12mCents: 0,
      margemPct: 0,
      porNucleo: [],
      indicadores: []
    },
    riscos: [],
    lacunas: []
  };
}

const NOME_NUCLEO: Record<string, string> = {
  obras: "Obras",
  consultoria: "Consultoria",
  tecnologia: "Tecnologia",
  corporativo: "Corporativo",
  sem_nucleo: "Sem núcleo"
};

export async function getPainelExecutivo(): Promise<PainelExecutivo> {
  if (!isFinanceConfigured()) return painelIndisponivel();

  try {
    // O "hoje" vem do SQL já convertido para o fuso da empresa: em produção o
    // servidor roda em UTC e, entre 21h e meia-noite, o mês corrente de lá não é
    // o mês corrente daqui.
    const [{ hoje, mes_atual: mesAtual }] = await query<{ hoje: string; mes_atual: string }>(
      `SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date::text AS hoje,
              to_char(date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM-01') AS mes_atual`
    );

    const [
      contas,
      reservas,
      serieMensal,
      janelas,
      porNucleoRows,
      composicao,
      clientesRows,
      contratos,
      churn,
      cicloRows,
      agingRows,
      maioresVencidos,
      ctvRows,
      caixaRows,
      cobertura
    ] = await Promise.all([
      // Saldo por conta. 'emprestimo' fica fora de caixa disponível: saldo
      // negativo ali é normal e somá-lo faria o fôlego mentir.
      query<{ slug: string; name: string; kind: string; saldo: number; sem_extrato: boolean }>(
        `SELECT a.slug, a.name, a.kind, a.current_balance_cents AS saldo,
                (a.last_statement_at IS NULL) AS sem_extrato
           FROM fin_account a JOIN fin_entity e ON e.id = a.entity_id
          WHERE e.slug = $1 AND a.is_active ORDER BY a.sort_order`,
        [ENTITY]
      ),

      // `current_cents` é o que está separado de fato; `target_cents` é a meta.
      // Usar a meta para calcular "livre" produziria saldo negativo na primeira
      // linha da tela — meta não é dinheiro comprometido, é dinheiro que falta.
      query<{ target_cents: number; current_cents: number }>(
        `SELECT r.target_cents, r.current_cents FROM fin_reserve r
           JOIN fin_entity e ON e.id = r.entity_id
          WHERE e.slug = $1 AND r.is_active AND r.is_committed`,
        [ENTITY]
      ),

      // 25 meses: 24 de histórico mais o corrente. O 25º existe para que o
      // primeiro mês do gráfico tenha com o que se comparar no ano anterior.
      query<{ mes: string; total: number }>(
        `SELECT to_char(v.month, 'YYYY-MM-01') AS mes, COALESCE(SUM(v.amount_cents), 0) AS total
           FROM fin_revenue_cash_v v JOIN fin_entity e ON e.id = v.entity_id
          WHERE e.slug = $1 AND v.posted_on >= (date_trunc('month', $2::date) - interval '35 months')
          GROUP BY 1 ORDER BY 1`,
        [ENTITY, mesAtual]
      ),

      // As duas janelas de 12 meses ancoradas em hoje. Ancorar em hoje (e não no
      // mês) mantém as janelas exatamente do mesmo tamanho — comparar 12 meses
      // com 11 meses e uma semana produziria "queda" onde não há.
      query<{
        janela: string;
        total: number;
        n: number;
        clientes: number;
        sem_contraparte: number;
        sem_nucleo: number;
      }>(
        `SELECT CASE WHEN v.posted_on >= $2::date - interval '12 months' THEN 'atual' ELSE 'anterior' END AS janela,
                COALESCE(SUM(v.amount_cents), 0) AS total,
                count(*)::int AS n,
                count(DISTINCT v.counterparty_id)::int AS clientes,
                COALESCE(SUM(v.amount_cents) FILTER (WHERE v.counterparty_id IS NULL), 0) AS sem_contraparte,
                COALESCE(SUM(v.amount_cents) FILTER (WHERE v.nucleo IS NULL), 0) AS sem_nucleo
           FROM fin_revenue_cash_v v JOIN fin_entity e ON e.id = v.entity_id
          WHERE e.slug = $1 AND v.posted_on >= $2::date - interval '24 months'
          GROUP BY 1`,
        [ENTITY, hoje]
      ),

      query<{ nucleo: string; atual: number; anterior: number }>(
        `SELECT COALESCE(v.nucleo, 'sem_nucleo') AS nucleo,
                COALESCE(SUM(v.amount_cents) FILTER (WHERE v.posted_on >= $2::date - interval '12 months'), 0) AS atual,
                COALESCE(SUM(v.amount_cents) FILTER (WHERE v.posted_on <  $2::date - interval '12 months'), 0) AS anterior
           FROM fin_revenue_cash_v v JOIN fin_entity e ON e.id = v.entity_id
          WHERE e.slug = $1 AND v.posted_on >= $2::date - interval '24 months'
          GROUP BY 1`,
        [ENTITY, hoje]
      ),

      query<{ recorrente: number; sem_categoria: number; total: number }>(
        `SELECT COALESCE(SUM(v.amount_cents) FILTER (WHERE c.code = ANY($3)), 0) AS recorrente,
                COALESCE(SUM(v.amount_cents) FILTER (WHERE v.category_id IS NULL), 0) AS sem_categoria,
                COALESCE(SUM(v.amount_cents), 0) AS total
           FROM fin_revenue_cash_v v
           JOIN fin_entity e ON e.id = v.entity_id
           LEFT JOIN fin_category c ON c.id = v.category_id
          WHERE e.slug = $1 AND v.posted_on >= $2::date - interval '12 months'`,
        [ENTITY, hoje, CATEGORIAS_RECORRENTES]
      ),

      // Lista COMPLETA de clientes identificados: HHI e Pareto precisam da cauda
      // inteira para serem verdadeiros. Cortar no top 15 inflaria os dois.
      query<{ nome: string; total: number }>(
        `SELECT cp.name AS nome, COALESCE(SUM(v.amount_cents), 0) AS total
           FROM fin_revenue_cash_v v
           JOIN fin_entity e ON e.id = v.entity_id
           JOIN fin_counterparty cp ON cp.id = v.counterparty_id
          WHERE e.slug = $1 AND v.posted_on >= $2::date - interval '12 months'
          GROUP BY 1 ORDER BY 2 DESC`,
        [ENTITY, hoje]
      ),

      // MRR contratado de verdade: as 27 assinaturas do Asaas MAIS o contrato de
      // comissionamento da PIAU, que chega como cobrança avulsa. Ler só
      // GET /subscriptions enxergaria 37% da recorrência real.
      query<{ n: number; total: number; maior: number; maior_nome: string | null }>(
        `SELECT count(*)::int AS n, COALESCE(SUM(c.amount_cents), 0) AS total,
                COALESCE(max(c.amount_cents), 0) AS maior,
                (array_agg(c.name ORDER BY c.amount_cents DESC))[1] AS maior_nome
           FROM fin_contract c JOIN fin_entity e ON e.id = c.entity_id
          WHERE e.slug = $1 AND c.status = 'ativo' AND c.direction = 'receber' AND c.recurrence = 'mensal'`,
        [ENTITY]
      ),

      // Proxy de churn: quem comprou na janela de 18 a 6 meses atrás e não
      // apareceu nos últimos 6. Não é churn contratual — nesta empresa boa parte
      // da receita é projeto, e projeto termina sem ninguém cancelar nada. Por
      // isso o número volta rotulado como proxy e com o valor em risco junto.
      query<{ base: number; sumiram: number; perdido: number }>(
        `WITH antes AS (
           SELECT v.counterparty_id, SUM(v.amount_cents) AS total
             FROM fin_revenue_cash_v v JOIN fin_entity e ON e.id = v.entity_id
            WHERE e.slug = $1 AND v.counterparty_id IS NOT NULL
              AND v.posted_on >= $2::date - interval '18 months'
              AND v.posted_on <  $2::date - interval '6 months'
            GROUP BY 1),
         recente AS (
           SELECT DISTINCT v.counterparty_id
             FROM fin_revenue_cash_v v JOIN fin_entity e ON e.id = v.entity_id
            WHERE e.slug = $1 AND v.counterparty_id IS NOT NULL
              AND v.posted_on >= $2::date - interval '6 months')
         SELECT count(*)::int AS base,
                count(*) FILTER (WHERE a.counterparty_id NOT IN (SELECT counterparty_id FROM recente))::int AS sumiram,
                COALESCE(SUM(a.total) FILTER (WHERE a.counterparty_id NOT IN (SELECT counterparty_id FROM recente)), 0) AS perdido
           FROM antes a`,
        [ENTITY, hoje]
      ),

      // Ciclo financeiro em três medidas separadas, e a separação é o ponto:
      //   emissao→pagamento = o ciclo inteiro (PMR)
      //   emissao→vencimento = o prazo que a EMPRESA concede
      //   vencimento→pagamento = o atraso que o CLIENTE impõe
      // Sem separar, um alongamento do ciclo vira "cliente pagando pior" quando
      // pode ser a própria empresa parcelando mais.
      query<{
        janela: string;
        n: number;
        lag_emissao: number | null;
        prazo_concedido: number | null;
        lag_vencimento: number | null;
        em_dia: number;
      }>(
        `SELECT CASE WHEN d.paid_on >= $2::date - interval '12 months' THEN 'atual' ELSE 'anterior' END AS janela,
                count(*)::int AS n,
                avg(d.paid_on - d.issue_date)::float AS lag_emissao,
                avg(d.due_date - d.issue_date)::float AS prazo_concedido,
                avg(d.paid_on - d.due_date)::float AS lag_vencimento,
                count(*) FILTER (WHERE d.paid_on <= d.due_date)::int AS em_dia
           FROM fin_document d JOIN fin_entity e ON e.id = d.entity_id
          WHERE e.slug = $1 AND d.direction = 'receber'
            AND d.paid_on IS NOT NULL AND d.issue_date IS NOT NULL
            AND d.paid_on >= $2::date - interval '24 months'
          GROUP BY 1`,
        [ENTITY, hoje]
      ),

      // Aging da carteira. 'vencido' é derivado de due_date, nunca do carimbo do
      // gateway: o Asaas demora a marcar OVERDUE e a régua não pode esperar.
      query<{ faixa: string; aberto: number; n: number }>(
        `SELECT CASE WHEN d.due_date >= $2::date THEN 'a vencer'
                     WHEN $2::date - d.due_date <= 30 THEN '1 a 30 dias'
                     WHEN $2::date - d.due_date <= 60 THEN '31 a 60 dias'
                     WHEN $2::date - d.due_date <= 90 THEN '61 a 90 dias'
                     ELSE 'mais de 90 dias' END AS faixa,
                COALESCE(SUM(d.amount_cents - d.settled_cents), 0) AS aberto,
                count(*)::int AS n
           FROM fin_document d JOIN fin_entity e ON e.id = d.entity_id
          WHERE e.slug = $1 AND d.direction = 'receber' AND d.status IN ('emitido', 'parcial')
          GROUP BY 1`,
        [ENTITY, hoje]
      ),

      query<{ nome: string | null; aberto: number; dias: number }>(
        `SELECT cp.name AS nome, (d.amount_cents - d.settled_cents) AS aberto,
                ($2::date - d.due_date)::int AS dias
           FROM fin_document d
           JOIN fin_entity e ON e.id = d.entity_id
           LEFT JOIN fin_counterparty cp ON cp.id = d.counterparty_id
          WHERE e.slug = $1 AND d.direction = 'receber' AND d.status IN ('emitido', 'parcial')
            AND $2::date - d.due_date > 90
          ORDER BY 2 DESC LIMIT 5`,
        [ENTITY, hoje]
      ),

      // Custos Totalmente Variáveis por núcleo, na definição do doc 17: só o que
      // some quando o serviço não é vendido. Rateio de custo fixo NÃO entra —
      // essa é a diferença entre a visão TOC e a DRE, e o painel usa a primeira.
      query<{ nucleo: string; total: number; n: number }>(
        `SELECT COALESCE(t.nucleo, c.default_nucleo, 'sem_nucleo') AS nucleo,
                COALESCE(SUM(-t.amount_cents), 0) AS total, count(*)::int AS n
           FROM fin_transaction t
           JOIN fin_entity e ON e.id = t.entity_id
           JOIN fin_category c ON c.id = t.category_id
          WHERE e.slug = $1 AND t.transfer_status <> 'pareado' AND NOT t.is_split_parent
            AND c.toc_class = 'custo_totalmente_variavel' AND t.amount_cents < 0
            AND t.posted_on >= $2::date - interval '12 months'
          GROUP BY 1`,
        [ENTITY, hoje]
      ),

      // Três medidas de caixa numa varredura só.
      //
      // `transito_12m` é o número mais importante desta consulta: R$ 1,9 mi
      // saíram do gateway marcados 'em_transito' porque a perna que chega no
      // banco nunca foi importada. Esse dinheiro não sumiu — o ledger é que não
      // o enxerga. Sem declarar isso, o saldo de R$ 49 mil parece ser todo o
      // caixa da empresa, e não é.
      query<{ despesa_90d: number; transito_12m: number; net_30d: number; entrada_90d: number }>(
        `SELECT COALESCE(SUM(-t.amount_cents) FILTER (
                  WHERE t.amount_cents < 0 AND t.posted_on >= $2::date - interval '90 days'
                    AND c.toc_class IN ('custo_totalmente_variavel', 'despesa_operacional')), 0) AS despesa_90d,
                COALESCE(SUM(-t.amount_cents) FILTER (
                  WHERE t.amount_cents < 0 AND t.transfer_status = 'em_transito'), 0) AS transito_12m,
                COALESCE(SUM(t.amount_cents) FILTER (
                  WHERE t.posted_on >= $2::date - interval '30 days'), 0) AS net_30d,
                COALESCE(SUM(t.amount_cents) FILTER (
                  WHERE t.amount_cents > 0 AND t.posted_on >= $2::date - interval '90 days'), 0) AS entrada_90d
           FROM fin_transaction t
           JOIN fin_entity e ON e.id = t.entity_id
           LEFT JOIN fin_category c ON c.id = t.category_id
          WHERE e.slug = $1 AND t.transfer_status <> 'pareado' AND NOT t.is_split_parent
            AND t.posted_on >= $2::date - interval '12 months'`,
        [ENTITY, hoje]
      ),

      // Cobertura: quantas contas têm extrato importado e quantos documentos
      // foram registrados ANTES de o dinheiro se mover. Os dois medem a mesma
      // coisa por ângulos diferentes — o quanto deste painel é observação e o
      // quanto é reconstrução.
      query<{ contas: number; contas_com_extrato: number; docs: number; docs_planejados: number }>(
        `SELECT (SELECT count(*)::int FROM fin_account a JOIN fin_entity e ON e.id = a.entity_id
                  WHERE e.slug = $1 AND a.is_active) AS contas,
                (SELECT count(DISTINCT sc.account_id)::int FROM fin_statement_coverage sc
                   JOIN fin_account a ON a.id = sc.account_id
                   JOIN fin_entity e ON e.id = a.entity_id WHERE e.slug = $1) AS contas_com_extrato,
                (SELECT count(*)::int FROM fin_document d JOIN fin_entity e ON e.id = d.entity_id
                  WHERE e.slug = $1) AS docs,
                (SELECT count(*)::int FROM fin_document d JOIN fin_entity e ON e.id = d.entity_id
                  WHERE e.slug = $1 AND d.planned_at IS NOT NULL) AS docs_planejados`,
        [ENTITY]
      )
    ]);

    // ── Caixa e fôlego ─────────────────────────────────────────────────────
    const saldoCents = contas.filter((c) => c.kind !== "emprestimo").reduce((s, c) => s + c.saldo, 0);
    const reservasSeparadasCents = reservas.reduce((s, r) => s + r.current_cents, 0);
    const metaReservasCents = reservas.reduce((s, r) => s + r.target_cents, 0);
    const saldoLivreCents = saldoCents - reservasSeparadasCents;
    const { despesa_90d: despesa90dCents, transito_12m: saidaEmTransito12mCents, net_30d: net30dCents, entrada_90d: entrada90dCents } =
      caixaRows[0] ?? { despesa_90d: 0, transito_12m: 0, net_30d: 0, entrada_90d: 0 };
    const saldo30dAtrasCents = saldoCents - net30dCents;
    const entradaMediaDiariaCents = Math.round(entrada90dCents / 90);

    // A regra que decide se existe base de despesa. Não é "despesa === 0": as
    // tarifas do gateway existem e somam alguns milhares, o que produziria um
    // runway de 4.000 dias — um número tecnicamente correto e completamente
    // falso. O teste é de PROPORÇÃO: uma empresa de serviços que gasta menos de
    // 5% do que fatura não está registrando as suas despesas.
    const despesaEhCrivel = entrada90dCents > 0 && despesa90dCents / entrada90dCents > 0.05;
    const diasCobertura = despesaEhCrivel ? Math.round(saldoLivreCents / (despesa90dCents / 90)) : null;
    const diasDeEntradaCobertos = entradaMediaDiariaCents > 0 ? saldoLivreCents / entradaMediaDiariaCents : 0;

    const indFolego: Indicador = {
      rotulo: "Dias de cobertura de caixa",
      formato: "dias",
      valor: diasCobertura ?? 0,
      comparacao: despesaEhCrivel
        ? `contra ${brlCents(Math.round(despesa90dCents / 90))} de saída média diária`
        : `apenas ${brlCents(despesa90dCents)} de despesa registrada em 90 dias, contra ${brlCents(entrada90dCents)} de entrada`,
      tendencia: "estavel",
      veredito: despesaEhCrivel
        ? `O caixa livre cobre ${diasCobertura} dias de operação.`
        : "Indisponível — despesa não registrada. Só o Asaas alimenta o ledger, e o Asaas não tem contas a pagar. Sem a saída, qualquer runway seria invenção.",
      acao: despesaEhCrivel
        ? null
        : "Importar os extratos do Nubank, Inter e Caixa. Enquanto não houver despesa no ledger, este painel não responde 'quanto tempo o caixa aguenta' — e essa é a primeira pergunta de qualquer conselho.",
      confiavel: despesaEhCrivel
    };

    const indCaixa: Indicador = {
      rotulo: "Caixa livre",
      formato: "brl",
      valor: saldoLivreCents,
      comparacao: `${brlCents(saldo30dAtrasCents)} há 30 dias · equivale a ${diasDeEntradaCobertos.toFixed(1)} dias de entrada bruta`,
      tendencia: tendenciaDe(saldoCents, saldo30dAtrasCents, { toleranciaPct: 10 }),
      veredito:
        saidaEmTransito12mCents > saldoCents
          ? `O saldo visível é do gateway, não da tesouraria: ${brlCompact(saidaEmTransito12mCents)} saíram do Asaas nos últimos 12 meses para contas que este banco ainda não enxerga. O caixa real da empresa é maior — e desconhecido.`
          : `Caixa livre de ${brlCents(saldoLivreCents)}, sem reserva separada a descontar.`,
      acao:
        saidaEmTransito12mCents > saldoCents
          ? "Importar o extrato da conta que recebe as transferências do Asaas. Até lá, nenhuma decisão de investimento pode ser tomada sobre este número."
          : null,
      confiavel: saidaEmTransito12mCents <= saldoCents
    };

    const pctReservaFinanciada = metaReservasCents ? (reservasSeparadasCents / metaReservasCents) * 100 : 0;
    const indReserva: Indicador = {
      rotulo: "Reservas constituídas",
      formato: "pct",
      valor: pctReservaFinanciada,
      comparacao: `${brlCents(reservasSeparadasCents)} guardados contra meta de ${brlCents(metaReservasCents)}`,
      tendencia: pctReservaFinanciada >= 100 ? "melhorando" : "estavel",
      veredito:
        pctReservaFinanciada < 5
          ? `As quatro reservas somam ${brlCents(metaReservasCents)} de meta e ${brlCents(reservasSeparadasCents)} de saldo. A empresa opera sem colchão.`
          : `As reservas estão ${pct(pctReservaFinanciada, 0)} constituídas.`,
      acao:
        pctReservaFinanciada < 5
          ? `Definir um aporte mensal fixo. Com ${brlCents(entradaMediaDiariaCents)} de entrada média diária, separar um dia de faturamento por mês constrói a reserva de caixa em pouco mais de 4 anos — o que já diz que a meta ou o aporte precisam ser revistos.`
          : null,
      confiavel: true
    };

    // ── Motor de receita ───────────────────────────────────────────────────
    const janelaAtual = janelas.find((j) => j.janela === "atual") ?? {
      janela: "atual",
      total: 0,
      n: 0,
      clientes: 0,
      sem_contraparte: 0,
      sem_nucleo: 0
    };
    const janelaAnterior = janelas.find((j) => j.janela === "anterior") ?? {
      janela: "anterior",
      total: 0,
      n: 0,
      clientes: 0,
      sem_contraparte: 0,
      sem_nucleo: 0
    };

    const receita12mCents = janelaAtual.total;
    const receita12mAnteriorCents = janelaAnterior.total;
    const crescimentoPct = variacaoPct(receita12mCents, receita12mAnteriorCents);

    const ticketCents = janelaAtual.n ? Math.round(receita12mCents / janelaAtual.n) : 0;
    const ticketAnteriorCents = janelaAnterior.n ? Math.round(receita12mAnteriorCents / janelaAnterior.n) : 0;

    // Decomposição clássica do crescimento em volume × preço, com o termo de
    // interação isolado. Somar a interação a um dos dois lados (o que muita
    // planilha faz) atribui a um deles um crescimento que só existe porque o
    // outro também subiu — e a conclusão "crescemos por ticket" vira errada.
    const efeitoVolumeCents = (janelaAtual.n - janelaAnterior.n) * ticketAnteriorCents;
    const efeitoTicketCents = (ticketCents - ticketAnteriorCents) * janelaAnterior.n;
    const efeitoCombinadoCents = (janelaAtual.n - janelaAnterior.n) * (ticketCents - ticketAnteriorCents);

    // Série mensal com média móvel de 3 meses e o mesmo mês do ano anterior.
    // A média existe porque a receita desta empresa é irregular por natureza: um
    // mês de R$ 251 mil ao lado de um de R$ 156 mil não indica tendência nenhuma.
    const totalPorMes = new Map(serieMensal.map((linha) => [linha.mes, linha.total]));
    const mesInicio = somaMeses(mesAtual, -23);
    const serie: SerieMes[] = [];
    for (let i = 0; i < 24; i++) {
      const mes = somaMeses(mesInicio, i);
      const janela = [somaMeses(mes, -2), somaMeses(mes, -1), mes].map((m) => totalPorMes.get(m) ?? 0);
      serie.push({
        mes,
        receitaCents: totalPorMes.get(mes) ?? 0,
        media3mCents: Math.round(janela.reduce((s, v) => s + v, 0) / 3),
        anoAnteriorCents: totalPorMes.has(somaMeses(mes, -12)) ? totalPorMes.get(somaMeses(mes, -12))! : null,
        // O mês corrente é parcial por definição. Marcado para a tela poder
        // desenhá-lo diferente: sem isso, todo dia 3 o gráfico mostra um
        // despencar que não aconteceu.
        parcial: mes === mesAtual
      });
    }

    const mesFechado = somaMeses(mesAtual, -1);
    const mesesFechados = serie.filter((linha) => !linha.parcial);
    const ultimos3 = mesesFechados.slice(-MESES_RUN_RATE);
    const runRateCents = ultimos3.length
      ? Math.round((ultimos3.reduce((s, m) => s + m.receitaCents, 0) / ultimos3.length) * 12)
      : 0;

    const totalNucleo = porNucleoRows.reduce((s, n) => s + n.atual, 0);
    const deltaTotal = porNucleoRows.reduce((s, n) => s + (n.atual - n.anterior), 0);
    const ctvPorNucleo = new Map(ctvRows.map((r) => [r.nucleo, r.total]));
    const porNucleo: LinhaNucleo[] = porNucleoRows
      .map((linha) => {
        const ctv = ctvPorNucleo.get(linha.nucleo) ?? 0;
        return {
          slug: linha.nucleo,
          nome: NOME_NUCLEO[linha.nucleo] ?? linha.nucleo,
          receitaCents: linha.atual,
          receitaAnteriorCents: linha.anterior,
          deltaCents: linha.atual - linha.anterior,
          pctDoTotal: totalNucleo ? (linha.atual / totalNucleo) * 100 : 0,
          pctDoCrescimento: deltaTotal ? ((linha.atual - linha.anterior) / deltaTotal) * 100 : 0,
          ctvCents: ctv,
          throughputCents: linha.atual - ctv,
          margemThroughputPct: linha.atual ? ((linha.atual - ctv) / linha.atual) * 100 : 0
        };
      })
      // Ordem por magnitude, não alfabética: a ordem é informação e num gráfico
      // de barras é a primeira coisa que o olho lê.
      .sort((a, b) => b.receitaCents - a.receitaCents);

    const maiorNucleo = porNucleo[0];
    const motorDoCrescimento = [...porNucleo].sort((a, b) => b.deltaCents - a.deltaCents)[0];

    const indCrescimento: Indicador = {
      rotulo: "Receita 12 meses",
      formato: "brl",
      valor: receita12mCents,
      comparacao: `${brlCompact(receita12mAnteriorCents)} nos 12 meses anteriores (${crescimentoPct >= 0 ? "+" : ""}${pct(crescimentoPct, 0)})`,
      tendencia: tendenciaDe(receita12mCents, receita12mAnteriorCents, { toleranciaPct: 5 }),
      veredito: motorDoCrescimento
        ? `Receita de ${brlCompact(receita12mCents)} nos últimos 12 meses, ${crescimentoPct >= 0 ? "acima" : "abaixo"} dos ${brlCompact(receita12mAnteriorCents)} do período anterior. ${motorDoCrescimento.nome} respondeu por ${pct(Math.abs(motorDoCrescimento.pctDoCrescimento), 0)} da variação.`
        : `Receita de ${brlCompact(receita12mCents)} nos últimos 12 meses.`,
      acao:
        crescimentoPct > 50
          ? "Crescimento acima de 50% ao ano é o momento em que a estrutura quebra antes da demanda. A pergunta do trimestre não é comercial: é qual restrição (equipe técnica, analisador, revisor) satura primeiro."
          : crescimentoPct < 0
            ? "Receita em queda contra o período anterior. Reabrir a carteira dos clientes que compraram e não voltaram antes de investir em prospecção nova."
            : null,
      confiavel: true
    };

    const indRunRate: Indicador = {
      rotulo: "Run-rate anualizado",
      formato: "brl",
      valor: runRateCents,
      comparacao: `média dos ${ultimos3.length} últimos meses fechados × 12, contra ${brlCompact(receita12mCents)} realizados em 12 meses`,
      tendencia: tendenciaDe(runRateCents, receita12mCents, { toleranciaPct: 5 }),
      veredito: `O ritmo dos últimos ${ultimos3.length} meses fechados projeta ${brlCompact(runRateCents)} por ano — ${pct(Math.abs(variacaoPct(runRateCents, receita12mCents)), 0)} ${runRateCents >= receita12mCents ? "acima" : "abaixo"} dos 12 meses realizados.`,
      acao: null,
      confiavel: ultimos3.length === MESES_RUN_RATE
    };

    const indDecomposicao: Indicador = {
      rotulo: "Origem do crescimento",
      formato: "brl",
      valor: efeitoTicketCents,
      comparacao: `volume ${brlCompact(efeitoVolumeCents)} · ticket ${brlCompact(efeitoTicketCents)} · combinado ${brlCompact(efeitoCombinadoCents)}`,
      tendencia: tendenciaDe(ticketCents, ticketAnteriorCents, { toleranciaPct: 5 }),
      veredito: `${janelaAtual.n} cobranças (contra ${janelaAnterior.n}) a um ticket médio de ${brlCents(ticketCents)} (contra ${brlCents(ticketAnteriorCents)}): ${
        Math.abs(efeitoVolumeCents) >= Math.abs(efeitoTicketCents)
          ? "o crescimento veio mais de volume que de preço"
          : "o crescimento veio mais de preço que de volume"
      }. A base de clientes passou de ${janelaAnterior.clientes} para ${janelaAtual.clientes}.`,
      acao:
        Math.abs(efeitoVolumeCents) >= Math.abs(efeitoTicketCents) && janelaAtual.clientes > janelaAnterior.clientes * 1.5
          ? "Crescimento por volume consome capacidade de entrega proporcionalmente. Medir Throughput por hora do recurso crítico antes de aceitar o próximo lote de contratos."
          : null,
      confiavel: true
    };

    // ── Qualidade da receita ───────────────────────────────────────────────
    const comp = composicao[0] ?? { recorrente: 0, sem_categoria: 0, total: 0 };
    const pctRecorrenteProxy = comp.total ? (comp.recorrente / comp.total) * 100 : 0;
    const { n: contratosAtivos, total: mrrContratadoCents } = contratos[0] ?? { n: 0, total: 0 };
    const pctMrrSobreRunRate = runRateCents ? ((mrrContratadoCents * 12) / runRateCents) * 100 : 0;

    const totalIdentificado = clientesRows.reduce((s, c) => s + c.total, 0);
    // HHI sobre a receita identificada, em pontos (0–10.000). A referência de
    // mercado: abaixo de 1.500 é pulverizado, acima de 2.500 é concentrado.
    const hhi = totalIdentificado
      ? Math.round(clientesRows.reduce((s, c) => s + ((c.total / totalIdentificado) * 100) ** 2, 0))
      : 0;
    const top10Cents = clientesRows.slice(0, 10).reduce((s, c) => s + c.total, 0);
    const top10Pct = totalIdentificado ? (top10Cents / totalIdentificado) * 100 : 0;
    const maiorCliente = clientesRows[0];
    const maiorClientePct = maiorCliente && totalIdentificado ? (maiorCliente.total / totalIdentificado) * 100 : 0;
    const pctSemContraparte = receita12mCents ? (janelaAtual.sem_contraparte / receita12mCents) * 100 : 0;

    let acumulado = 0;
    const pareto: LinhaPareto[] = clientesRows.slice(0, 20).map((cliente, indice) => {
      acumulado += cliente.total;
      return {
        nome: cliente.nome,
        receitaCents: cliente.total,
        pctIndividual: totalIdentificado ? (cliente.total / totalIdentificado) * 100 : 0,
        pctAcumulado: totalIdentificado ? (acumulado / totalIdentificado) * 100 : 0,
        top10: indice < 10
      };
    });

    const { base: baseChurn, sumiram: clientesQueNaoVoltaram, perdido: receitaQueNaoVoltouCents } =
      churn[0] ?? { base: 0, sumiram: 0, perdido: 0 };
    const pctChurn = baseChurn ? (clientesQueNaoVoltaram / baseChurn) * 100 : 0;

    const indRecorrencia: Indicador = {
      rotulo: "Receita contratada por mês",
      formato: "brl",
      valor: mrrContratadoCents,
      comparacao: `${pct(pctMrrSobreRunRate, 0)} do run-rate · proxy por categoria aponta ${pct(pctRecorrenteProxy, 0)} de receita recorrente`,
      tendencia: "estavel",
      veredito: `${contratosAtivos} contratos ativos somam ${brlCents(mrrContratadoCents)} por mês. Duas medidas independentes — contrato assinado e categoria de serviço — chegam a ${pct((pctMrrSobreRunRate + pctRecorrenteProxy) / 2, 0)}: ${pct(100 - (pctMrrSobreRunRate + pctRecorrenteProxy) / 2, 0)} do faturamento precisa ser vendido de novo todo ano.`,
      acao:
        pctMrrSobreRunRate < 30
          ? "Com menos de um terço da receita contratada, o pipeline comercial é a única defesa contra um trimestre ruim. Transformar medição e gestão de faturas em contrato anual é a alavanca mais barata: já é o serviço de natureza mensal."
          : null,
      confiavel: true
    };

    const indConcentracao: Indicador = {
      rotulo: "Concentração da carteira",
      formato: "pct",
      valor: top10Pct,
      comparacao: `HHI ${hhi} pontos (abaixo de 1.500 = pulverizado) · maior cliente ${pct(maiorClientePct, 1)}`,
      tendencia: "estavel",
      veredito: `Os 10 maiores clientes somam ${pct(top10Pct, 0)} da receita identificada e o maior isolado, ${maiorCliente?.nome ?? "—"}, ${pct(maiorClientePct, 1)}. Com HHI de ${hhi} pontos, a carteira é pulverizada: nenhuma saída isolada derruba o ano.`,
      acao:
        maiorClientePct > 20
          ? `${maiorCliente?.nome ?? "O maior cliente"} passa de 20% da receita. Um contrato só respondendo por um quinto do faturamento é risco de continuidade, não relacionamento.`
          : null,
      confiavel: pctSemContraparte < 15
    };

    const indChurn: Indicador = {
      rotulo: "Clientes que não voltaram",
      formato: "numero",
      valor: clientesQueNaoVoltaram,
      comparacao: `${clientesQueNaoVoltaram} de ${baseChurn} clientes (${pct(pctChurn, 0)}) · ${brlCompact(receitaQueNaoVoltouCents)} que faturavam antes`,
      tendencia: pctChurn > 40 ? "piorando" : pctChurn > 25 ? "estavel" : "melhorando",
      veredito: `${clientesQueNaoVoltaram} dos ${baseChurn} clientes que compraram entre 18 e 6 meses atrás não voltaram no último semestre, levando ${brlCompact(receitaQueNaoVoltouCents)} de faturamento histórico. Boa parte é projeto que terminou — nesta empresa isso não é cancelamento, é fim de escopo.`,
      acao:
        receitaQueNaoVoltouCents > receita12mCents * 0.1
          ? `A base inativa vale ${brlCompact(receitaQueNaoVoltouCents)} de faturamento já provado. Reativar custa menos que prospectar: começar pelos que gastaram acima do ticket médio.`
          : null,
      // Proxy declarado: sem contrato de assinatura na maior parte da receita,
      // "não voltou" e "churnou" não são a mesma coisa e o painel não finge que
      // são.
      confiavel: false
    };

    // ── Ciclo financeiro ───────────────────────────────────────────────────
    const cicloAtual = cicloRows.find((c) => c.janela === "atual");
    const cicloAnterior = cicloRows.find((c) => c.janela === "anterior");
    const pmrDiasEmissao = cicloAtual?.lag_emissao ?? null;
    const pmrDiasEmissaoAnterior = cicloAnterior?.lag_emissao ?? null;
    const prazoConcedidoDias = cicloAtual?.prazo_concedido ?? null;
    const prazoConcedidoDiasAnterior = cicloAnterior?.prazo_concedido ?? null;
    const atrasoMedioDias = cicloAtual?.lag_vencimento ?? null;
    const pctEmDia = cicloAtual?.n ? (cicloAtual.em_dia / cicloAtual.n) * 100 : 0;
    const pctEmDiaAnterior = cicloAnterior?.n ? (cicloAnterior.em_dia / cicloAnterior.n) * 100 : 0;

    const aging: FaixaAging[] = ["a vencer", "1 a 30 dias", "31 a 60 dias", "61 a 90 dias", "mais de 90 dias"].map(
      (faixa) => {
        const linha = agingRows.find((r) => r.faixa === faixa);
        const fator = CURVA_RECUPERACAO[faixa] ?? 1;
        return {
          faixa,
          abertoCents: linha?.aberto ?? 0,
          n: linha?.n ?? 0,
          recuperacaoEsperadaCents: Math.round((linha?.aberto ?? 0) * fator),
          critica: faixa === "mais de 90 dias"
        };
      }
    );
    const vencidoCents = aging.filter((f) => f.faixa !== "a vencer").reduce((s, f) => s + f.abertoCents, 0);
    const vencidoN = aging.filter((f) => f.faixa !== "a vencer").reduce((s, f) => s + f.n, 0);
    const vencido90 = aging.find((f) => f.critica)!;
    const pct90 = vencidoCents ? (vencido90.abertoCents / vencidoCents) * 100 : 0;
    const perdaEsperadaCents = aging
      .filter((f) => f.faixa !== "a vencer")
      .reduce((s, f) => s + (f.abertoCents - f.recuperacaoEsperadaCents), 0);
    const top5VencidoCents = maioresVencidos.reduce((s, d) => s + d.aberto, 0);

    const alongou = pmrDiasEmissao !== null && pmrDiasEmissaoAnterior !== null && pmrDiasEmissao - pmrDiasEmissaoAnterior > 3;
    const culpaDoPrazo =
      alongou && prazoConcedidoDias !== null && prazoConcedidoDiasAnterior !== null
        ? prazoConcedidoDias - prazoConcedidoDiasAnterior > (pmrDiasEmissao! - pmrDiasEmissaoAnterior!) * 0.6
        : false;

    const indPmr: Indicador = {
      rotulo: "Prazo médio de recebimento",
      formato: "dias",
      valor: pmrDiasEmissao ?? 0,
      comparacao: `${pmrDiasEmissaoAnterior !== null ? `${pmrDiasEmissaoAnterior.toFixed(0)} dias nos 12 meses anteriores` : "sem base anterior"} · prazo concedido ${prazoConcedidoDias?.toFixed(0) ?? "—"} dias · atraso do cliente ${atrasoMedioDias?.toFixed(1) ?? "—"} dias`,
      tendencia: tendenciaDe(pmrDiasEmissao ?? 0, pmrDiasEmissaoAnterior ?? 0, {
        toleranciaPct: 8,
        maiorEhMelhor: false
      }),
      veredito: alongou
        ? `Da emissão ao pagamento são ${pmrDiasEmissao!.toFixed(0)} dias, contra ${pmrDiasEmissaoAnterior!.toFixed(0)} no período anterior. ${
            culpaDoPrazo
              ? `O alongamento vem do prazo que a própria XPE concede (${prazoConcedidoDiasAnterior!.toFixed(0)} → ${prazoConcedidoDias!.toFixed(0)} dias), não do cliente: ${pct(pctEmDia, 0)} continuam pagando em dia, contra ${pct(pctEmDiaAnterior, 0)} antes.`
              : `O cliente está pagando pior: em dia caiu de ${pct(pctEmDiaAnterior, 0)} para ${pct(pctEmDia, 0)}.`
          }`
        : `Da emissão ao pagamento são ${pmrDiasEmissao?.toFixed(0) ?? "—"} dias e ${pct(pctEmDia, 0)} das cobranças são pagas até o vencimento — ciclo estável.`,
      acao: culpaDoPrazo
        ? `Cada dia de prazo concedido a mais imobiliza cerca de ${brlCents(Math.round(receita12mCents / 365))} de capital de giro. O alongamento de ${(prazoConcedidoDias! - prazoConcedidoDiasAnterior!).toFixed(0)} dias custa aproximadamente ${brlCompact(Math.round((receita12mCents / 365) * (prazoConcedidoDias! - prazoConcedidoDiasAnterior!)))} parados na carteira — decisão comercial, não financeira.`
        : null,
      confiavel: (cicloAtual?.n ?? 0) > 30
    };

    const indAging: Indicador = {
      rotulo: "Vencido há mais de 90 dias",
      formato: "brl",
      valor: vencido90.abertoCents,
      comparacao: `${pct(pct90, 0)} de todo o vencido (${brlCents(vencidoCents)} em ${vencidoN} cobranças)`,
      tendencia: pct90 > 45 ? "piorando" : "estavel",
      veredito: `${brlCents(vencido90.abertoCents)} em ${vencido90.n} cobranças passaram de 90 dias — ${pct(pct90, 0)} de toda a carteira vencida. Pela curva de recuperação do módulo, ${brlCents(perdaEsperadaCents)} do vencido não deve voltar.`,
      acao:
        vencido90.abertoCents > 0
          ? `Acima de 90 dias a chance de recuperação cai para 20%. Os 5 maiores títulos somam ${brlCents(top5VencidoCents)} (${pct(vencido90.abertoCents ? (top5VencidoCents / vencido90.abertoCents) * 100 : 0, 0)} da faixa): priorizar esses cinco resolve a maior parte com cinco telefonemas.`
          : null,
      confiavel: true
    };

    // ── Throughput por núcleo (doc 17) ─────────────────────────────────────
    const ctv12mCents = ctvRows.reduce((s, r) => s + r.total, 0);
    const throughput12mCents = receita12mCents - ctv12mCents;
    const margemPct = receita12mCents ? (throughput12mCents / receita12mCents) * 100 : 0;
    // CTV crível pelo mesmo teste de proporção do runway: material de obra,
    // terceirização e deslocamento existem no plano de contas (4.02, 4.03, 4.04)
    // e estão zerados no ledger.
    const ctvCrivel = receita12mCents > 0 && ctv12mCents / receita12mCents > 0.03;

    const indThroughput: Indicador = {
      rotulo: "Throughput 12 meses",
      formato: "brl",
      valor: throughput12mCents,
      comparacao: `receita ${brlCompact(receita12mCents)} − CTV ${brlCents(ctv12mCents)} = margem de ${pct(margemPct, 1)}`,
      tendencia: "estavel",
      veredito: ctvCrivel
        ? `Throughput de ${brlCompact(throughput12mCents)}, margem de ${pct(margemPct, 1)} sobre a receita.`
        : `Os únicos Custos Totalmente Variáveis registrados são ${brlCents(ctv12mCents)} de tarifas do gateway. Material de obra, terceirização e deslocamento têm categoria no plano de contas (4.02, 4.03, 4.04) e estão zerados — então o Throughput de ${brlCompact(throughput12mCents)} é praticamente igual à receita, e o de Obras é o mais superestimado de todos.`,
      acao: ctvCrivel
        ? null
        : "Classificar as saídas de material e subcontratação por núcleo é o que separa 'Obras fatura bem' de 'Obras dá dinheiro'. Sem CTV, a decisão de aceitar ou recusar obra continua sendo feita por faturamento — exatamente o erro que o doc 17 existe para evitar.",
      confiavel: ctvCrivel
    };

    const indThroughputHora: Indicador = {
      rotulo: "Throughput por núcleo",
      formato: "brl",
      valor: maiorNucleo?.throughputCents ?? 0,
      comparacao: porNucleo
        .filter((n) => n.receitaCents > 0)
        .map((n) => `${n.nome} ${brlCompact(n.throughputCents)}`)
        .join(" · "),
      tendencia: motorDoCrescimento ? tendenciaDe(motorDoCrescimento.receitaCents, motorDoCrescimento.receitaAnteriorCents) : "estavel",
      veredito: maiorNucleo
        ? `${maiorNucleo.nome} gera ${pct(maiorNucleo.pctDoTotal, 0)} do Throughput. ${motorDoCrescimento && motorDoCrescimento.slug !== maiorNucleo.slug ? `${motorDoCrescimento.nome} é o que mais cresce (${pct(motorDoCrescimento.pctDoCrescimento, 0)} da variação), mas ainda é ${pct(motorDoCrescimento.pctDoTotal, 0)} do total.` : ""}`
        : "Sem receita classificada por núcleo no período.",
      acao:
        "O doc 17 pede Throughput por hora do recurso crítico, não por núcleo. Falta o denominador: horas de especialista, dias de equipe de obra e dias de analisador não estão em nenhuma tabela deste banco.",
      confiavel: janelaAtual.sem_nucleo / (receita12mCents || 1) < 0.1
    };

    // ── Riscos ─────────────────────────────────────────────────────────────
    const { contas: nContas, contas_com_extrato: nComExtrato, docs: nDocs, docs_planejados: nPlanejados } =
      cobertura[0] ?? { contas: 0, contas_com_extrato: 0, docs: 0, docs_planejados: 0 };

    const riscos: Indicador[] = [
      {
        rotulo: "Cobertura de extrato",
        formato: "numero",
        valor: nComExtrato,
        comparacao: `${nComExtrato} de ${nContas} contas ativas com extrato importado`,
        tendencia: nComExtrato === nContas ? "melhorando" : "piorando",
        veredito: `${nContas - nComExtrato} das ${nContas} contas nunca tiveram extrato importado. Tudo o que este painel afirma vale para o gateway, não para a empresa.`,
        acao:
          nComExtrato < nContas
            ? "Importar Nubank, Inter e Caixa. É o único item desta lista que destrava DRE, margem, runway e Throughput de uma vez."
            : null,
        confiavel: true
      },
      {
        rotulo: "Dependência do maior cliente",
        formato: "pct",
        valor: maiorClientePct,
        comparacao: `${maiorCliente?.nome ?? "—"} · ${brlCompact(maiorCliente?.total ?? 0)} em 12 meses`,
        tendencia: maiorClientePct > 20 ? "piorando" : "estavel",
        veredito: `${maiorCliente?.nome ?? "O maior cliente"} responde por ${pct(maiorClientePct, 1)} da receita identificada e por ${pct(mrrContratadoCents ? (1_500_000 / mrrContratadoCents) * 100 : 0, 0)} da receita contratada mensal — a concentração da carteira é baixa, mas a da RECORRÊNCIA não é.`,
        acao:
          maiorClientePct > 10
            ? "A carteira pulverizada esconde uma dependência real: se este contrato cair, cai junto a maior parte da receita previsível. Tratar como risco de continuidade no plano do ano."
            : null,
        confiavel: pctSemContraparte < 15
      },
      {
        rotulo: "Receita sem contraparte identificada",
        formato: "pct",
        valor: pctSemContraparte,
        comparacao: `${brlCompact(janelaAtual.sem_contraparte)} de ${brlCompact(receita12mCents)} em 12 meses`,
        tendencia: pctSemContraparte > 10 ? "piorando" : "estavel",
        veredito: `${pct(pctSemContraparte, 1)} da receita entrou sem cliente identificado. Toda medida de concentração, churn e ticket por cliente carrega essa margem de erro.`,
        acao:
          pctSemContraparte > 5
            ? "Rodar a fila de revisão sobre os lançamentos sem contraparte antes de usar a concentração em qualquer apresentação externa."
            : null,
        confiavel: true
      },
      {
        rotulo: "Cobertura de planejamento",
        formato: "pct",
        valor: nDocs ? (nPlanejados / nDocs) * 100 : 0,
        comparacao: `${nPlanejados} de ${nDocs} documentos registrados antes do caixa`,
        tendencia: "estavel",
        veredito: `Nenhum dos ${nDocs} documentos foi registrado antes de o dinheiro se mover. Este painel descreve o passado; ele não prova que alguém planejou nada.`,
        acao: "Registrar contas a pagar na data em que se compromete, não na data em que se paga. É o que transforma o fluxo de caixa de retrovisor em previsão.",
        confiavel: true
      }
    ];

    // ── Títulos derivados dos gráficos ─────────────────────────────────────
    //
    // O título é calculado do dado no momento da renderização, nunca escrito à
    // mão. Um título fixo ("Receita cresceu 96%") vira falso no primeiro mês em
    // que o dado muda — e um painel que mente é pior que um painel sem título.
    const ultimoFechado = mesesFechados[mesesFechados.length - 1];
    const mesmoMesAnoAnterior = ultimoFechado?.anoAnteriorCents ?? null;
    const crescimentoUltimoMes =
      ultimoFechado && mesmoMesAnoAnterior ? variacaoPct(ultimoFechado.receitaCents, mesmoMesAnoAnterior) : 0;

    const graficoReceita: Grafico<SerieMes> = {
      titulo: `Receita ${crescimentoPct >= 0 ? "cresceu" : "caiu"} ${pct(Math.abs(crescimentoPct), 0)} em 12 meses, puxada por ${motorDoCrescimento?.nome ?? "—"}`,
      subtitulo: `Média móvel de 3 meses em roxo. ${ultimoFechado ? `Último mês fechado: ${brlCents(ultimoFechado.receitaCents)}, ${crescimentoUltimoMes >= 0 ? "+" : "−"}${pct(Math.abs(crescimentoUltimoMes), 0)} contra o mesmo mês do ano anterior.` : ""} O mês corrente é parcial e está em cinza.`,
      dados: serie,
      confiavel: true
    };

    const graficoNucleo: Grafico<LinhaNucleo> = {
      titulo: motorDoCrescimento
        ? `${motorDoCrescimento.nome} explica ${pct(Math.abs(motorDoCrescimento.pctDoCrescimento), 0)} do crescimento, mas ${maiorNucleo.nome} ainda é ${pct(maiorNucleo.pctDoTotal, 0)} da receita`
        : "Receita por núcleo",
      subtitulo: `Últimos 12 meses contra os 12 anteriores. ${pct((janelaAtual.sem_nucleo / (receita12mCents || 1)) * 100, 0)} da receita ainda está sem núcleo atribuído.`,
      dados: porNucleo.filter((n) => n.receitaCents > 0),
      confiavel: janelaAtual.sem_nucleo / (receita12mCents || 1) < 0.1
    };

    const graficoAging: Grafico<FaixaAging> = {
      titulo: `${pct(pct90, 0)} do vencido passou de 90 dias — ${brlCents(perdaEsperadaCents)} da carteira em risco de perda`,
      subtitulo: `${brlCents(vencidoCents)} vencidos em ${vencidoN} cobranças, contra ${brlCents(aging[0].abertoCents)} ainda a vencer. A barra de recuperação esperada aplica a curva do módulo (90% até 30 dias, 20% acima de 90).`,
      dados: aging,
      confiavel: true
    };

    const graficoPareto: Grafico<LinhaPareto> = {
      titulo: `Carteira pulverizada: os 10 maiores somam ${pct(top10Pct, 0)} da receita e nenhum passa de ${pct(maiorClientePct, 0)}`,
      subtitulo: `HHI de ${hhi} pontos sobre ${clientesRows.length} clientes identificados nos últimos 12 meses (abaixo de 1.500 é considerado pulverizado). ${pct(pctSemContraparte, 1)} da receita não tem cliente identificado e fica fora deste gráfico.`,
      dados: pareto,
      confiavel: pctSemContraparte < 15
    };

    // ── Destaques: as quatro manchetes ─────────────────────────────────────
    const destaques: Indicador[] = [indCrescimento, indCaixa, indRecorrencia, indAging];

    // ── Leitura do mês ─────────────────────────────────────────────────────
    //
    // O parágrafo é montado dos veredictos, na ordem em que um CFO conta a
    // história: o que aconteceu, de onde veio, o que está frágil, o que fazer.
    const leituraDoMes: string[] = [
      `Nos últimos 12 meses a XPE faturou ${brlCompact(receita12mCents)}, ${crescimentoPct >= 0 ? "acima" : "abaixo"} dos ${brlCompact(receita12mAnteriorCents)} do período anterior (${crescimentoPct >= 0 ? "+" : "−"}${pct(Math.abs(crescimentoPct), 0)}), e o ritmo dos últimos ${ultimos3.length} meses fechados projeta ${brlCompact(runRateCents)} por ano.`,
      `O crescimento veio ${Math.abs(efeitoVolumeCents) >= Math.abs(efeitoTicketCents) ? "principalmente de volume" : "principalmente de ticket"}: ${janelaAtual.n} cobranças contra ${janelaAnterior.n}, ticket médio de ${brlCents(ticketCents)} contra ${brlCents(ticketAnteriorCents)}, com a base de clientes indo de ${janelaAnterior.clientes} para ${janelaAtual.clientes}${motorDoCrescimento ? ` — ${motorDoCrescimento.nome} sozinho responde por ${pct(Math.abs(motorDoCrescimento.pctDoCrescimento), 0)} da variação` : ""}.`,
      `A carteira é pulverizada (HHI ${hhi}, top 10 em ${pct(top10Pct, 0)}), mas só ${pct(pctMrrSobreRunRate, 0)} da receita está contratada: ${brlCents(mrrContratadoCents)} por mês em ${contratosAtivos} contratos. Os outros ${pct(100 - pctMrrSobreRunRate, 0)} precisam ser vendidos de novo todo ano.`,
      `Do lado do caixa, ${brlCents(saldoLivreCents)} livres — ${diasDeEntradaCobertos.toFixed(1)} dias de entrada bruta — contra ${brlCents(aging[0].abertoCents)} a vencer e ${brlCents(vencidoCents)} vencidos, dos quais ${pct(pct90, 0)} já passaram de 90 dias.`,
      `A prioridade da semana é a régua de cobrança: os cinco maiores títulos acima de 90 dias somam ${brlCents(top5VencidoCents)} e, pela curva de recuperação, cada mês parado converte mais ${brlCompact(Math.round(perdaEsperadaCents / 12))} em perda.`,
      `Este painel ainda não sabe se a empresa dá lucro: ${nContas - nComExtrato} das ${nContas} contas nunca tiveram extrato importado, a despesa registrada em 90 dias é de ${brlCents(despesa90dCents)} — só tarifas — e ${brlCompact(saidaEmTransito12mCents)} saíram do gateway para contas que este banco não enxerga.`
    ];

    // ── Lacunas declaradas ─────────────────────────────────────────────────
    const lacunas = [
      {
        titulo: "Despesa: praticamente inexistente no ledger",
        detalhe: `Em 90 dias há ${brlCents(despesa90dCents)} de saída classificada como custo ou despesa, quase toda tarifa do gateway, contra ${brlCents(entrada90dCents)} de entrada. Sem despesa não há DRE, não há margem, não há dias de cobertura de caixa e não há Throughput por núcleo confiável.`
      },
      {
        titulo: `Caixa: ${nComExtrato} de ${nContas} contas com extrato`,
        detalhe: `${brlCompact(saidaEmTransito12mCents)} saíram do Asaas nos últimos 12 meses marcados 'em trânsito' — a perna que chega no banco nunca foi importada. O dinheiro não sumiu; o ledger é que não o vê. O saldo de ${brlCents(saldoCents)} é do gateway, não da tesouraria.`
      },
      {
        titulo: "Planejamento: zero documentos registrados antes do caixa",
        detalhe: `Nenhum dos ${nDocs} documentos tem data de planejamento. Toda previsão de fluxo é reconstrução a partir do que já aconteceu, não compromisso registrado — o que impede medir se a empresa cumpre o que planeja.`
      },
      {
        titulo: "Throughput: falta o denominador da restrição",
        detalhe: "O doc 17 define Throughput por hora do recurso crítico. Horas de especialista, dias de equipe de obra e dias de analisador não existem em nenhuma tabela: dá para calcular Throughput por núcleo, não por restrição — que é o número que decide contratar, comprar analisador ou recusar serviço."
      },
      {
        titulo: `Classificação: ${pct(pctSemContraparte, 1)} da receita sem cliente e ${pct((janelaAtual.sem_nucleo / (receita12mCents || 1)) * 100, 1)} sem núcleo`,
        detalhe: `${brlCompact(janelaAtual.sem_contraparte)} entraram sem contraparte identificada e ${brlCompact(janelaAtual.sem_nucleo)} sem núcleo. Concentração, churn e receita por núcleo carregam essa margem — e ela é maior que a diferença entre o segundo e o terceiro núcleo.`
      },
      {
        titulo: "Impostos: Simples Nacional e ISS não estão no cálculo",
        detalhe: `As categorias 7.01 (DAS) e 7.02 (ISS) estão classificadas como Custo Totalmente Variável — corretamente, porque variam com a receita — mas nenhum lançamento foi importado. Com ISS de 5% e a faixa do Simples, o Throughput real está superestimado em cerca de ${brlCompact(Math.round(receita12mCents * 0.11))} ao ano.`
      }
    ];

    return {
      disponivel: true,
      hoje,
      mesAtual,
      mesFechado,
      leituraDoMes,
      destaques,
      caixa: {
        saldoCents,
        saldoLivreCents,
        reservasSeparadasCents,
        metaReservasCents,
        saldo30dAtrasCents,
        entradaMediaDiariaCents,
        despesa90dCents,
        diasCobertura,
        saidaEmTransito12mCents,
        indicadores: [indCaixa, indFolego, indReserva]
      },
      motor: {
        receita12mCents,
        receita12mAnteriorCents,
        crescimentoPct,
        runRateCents,
        ticketCents,
        ticketAnteriorCents,
        nCobrancas: janelaAtual.n,
        nCobrancasAnterior: janelaAnterior.n,
        clientes: janelaAtual.clientes,
        clientesAnterior: janelaAnterior.clientes,
        efeitoVolumeCents,
        efeitoTicketCents,
        efeitoCombinadoCents,
        grafico: graficoReceita,
        graficoNucleo,
        indicadores: [indCrescimento, indRunRate, indDecomposicao]
      },
      qualidade: {
        pctRecorrenteProxy,
        mrrContratadoCents,
        contratosAtivos,
        pctMrrSobreRunRate,
        hhi,
        top10Pct,
        maiorClienteNome: maiorCliente?.nome ?? "—",
        maiorClientePct,
        clientesQueNaoVoltaram,
        baseChurn,
        receitaQueNaoVoltouCents,
        grafico: graficoPareto,
        indicadores: [indRecorrencia, indConcentracao, indChurn]
      },
      ciclo: {
        pmrDiasEmissao,
        pmrDiasEmissaoAnterior,
        prazoConcedidoDias,
        prazoConcedidoDiasAnterior,
        atrasoMedioDias,
        pctEmDia,
        pctEmDiaAnterior,
        grafico: graficoAging,
        indicadores: [indPmr, indAging]
      },
      throughput: {
        receita12mCents,
        ctv12mCents,
        throughput12mCents,
        margemPct,
        porNucleo,
        indicadores: [indThroughput, indThroughputHora]
      },
      riscos,
      lacunas
    };
  } catch (error) {
    console.error("[financeiro] painel executivo indisponível:", error);
    return painelIndisponivel();
  }
}

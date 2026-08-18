import "server-only";

import { isFinanceConfigured, query } from "../db";
import { comFallback, contrato, contratoIndisponivel, type Contrato } from "./base";

/**
 * A visão de caixa por conta, com histórico, e o Pronampe da CAIXA.
 *
 * ---------------------------------------------------------------------------
 * POR QUE SALDO E DÍVIDA MORAM NO MESMO CONTRATO E EM CAMPOS SEPARADOS
 * ---------------------------------------------------------------------------
 * O pedido chegou junto ("ver o total e por conta" + "o empréstimo Pronampe"),
 * e é a mesma pergunta: quanto a empresa tem, e quanto ela deve. Mas as duas
 * respostas NÃO podem somar. O saldo devedor é passivo; se ele entrar na conta
 * de "dinheiro disponível", o número que a pessoa usa para decidir pagamento
 * fica errado por R$ 106 mil.
 *
 * Por isso `total` soma só as contas com extrato, e o empréstimo vem em
 * `emprestimo`, nunca dentro de `contas[].saldo`.
 *
 * ---------------------------------------------------------------------------
 * A RESSALVA QUE VEM ANTES DO NÚMERO
 * ---------------------------------------------------------------------------
 * Nenhuma linha do cronograma do empréstimo é fato. Não existe extrato da
 * conta da XPE na Caixa — o débito da prestação acontece dentro dela e este
 * acervo nunca o viu. O que existe são as transferências que ABASTECEM essa
 * conta, e essas são reais, no extrato do Inter.
 *
 * Duas coisas diferentes, e a tela nunca deve deixar parecer que são uma.
 */

const DOMINIO = "caixa";

export type ContaCaixa = {
  accountId: number;
  slug: string;
  nome: string;
  instituicao: string;
  tipo: string;
  /** Nulo quando a conta não tem extrato. NUNCA zero por ausência. */
  saldoCents: number | null;
  motivoSemSaldo: string | null;
  temCobertura: boolean;
  lancamentos: number;
  primeiroMovimento: string | null;
  ultimoMovimento: string | null;
  ultimoExtratoEm: string | null;
  /** Passivo associado — em campo separado porque não é dinheiro que se tem. */
  passivoSaldoDevedorCents: number | null;
  passivoCcb: string | null;
  passivoMemoria: string | null;
};

export type PontoSerie = {
  slug: string;
  nome: string;
  mes: string;
  entradasCents: number;
  saidasCents: number;
  movimentoCents: number;
  saldoFimCents: number;
  lancamentos: number;
};

export type ParcelaConfronto = {
  parcela: number;
  vencimentoEm: string;
  estado: string;
  modeloCents: number;
  contratoCents: number;
  observadoCents: number | null;
  observadoEm: string | null;
  observadoOrigem: string | null;
  diferencaCents: number | null;
  diferencaPct: number | null;
  taxaMes: number;
  origemTaxa: string;
  encargoCents: number;
  principalCents: number;
  saldoDevedorCents: number;
  coberturaOrigem: string;
  leitura: string;
};

export type LinhaExtratoCaixa = {
  data: string;
  sentido: string;
  valorCents: number;
  descricao: string;
  origem: string;
  estimado: boolean;
  metodo: string;
  descasamentoAcumuladoCents: number;
};

export type Transferencia = {
  movimentoEm: string;
  contaOrigem: string;
  contaOrigemNome: string;
  valorCents: number;
  descricao: string;
  instituicaoDestino: string | null;
};

export type Premissa = {
  chave: string;
  enunciado: string;
  declaradaPor: string;
  declaradaEm: string;
  oQueDerruba: string;
};

export type Emprestimo = {
  ccb: string;
  linha: string;
  credor: string;
  principalCents: number;
  liquidoLiberadoCents: number;
  iofCents: number;
  prestacaoContratualCents: number;
  spreadMensal: number;
  indexador: string | null;
  cetMensalDeclarado: number | null;
  cetAnualDeclarado: number | null;
  liberacaoEm: string;
  primeiraParcelaEm: string;
  vencimentoEm: string;
  prazoTotalMeses: number;
  carenciaMeses: number;
  prestacoes: number;
  contaDebitoContrato: string | null;

  /** O número que ele quer, e a direção do erro junto dele. */
  saldoDevedorCents: number;
  natureza: string;
  ressalva: string;
  memoria: string;
  ultimaParcelaVencida: number;
  ultimaParcelaEm: string;
  proximaPrestacaoCents: number | null;
  proximaParcelaEm: string | null;
  proximaOrigemTaxa: string | null;

  vencidas: number;
  comFunding: number;
  fundingInsuficiente: number;
  semFundingCoberta: number;
  foraDaCobertura: number;
  futuras: number;

  devidoCents: number;
  devidoNaCoberturaCents: number;
  transferidoCents: number;
  transferencias: number;
  primeiraTransferenciaEm: string | null;
  ultimaTransferenciaEm: string | null;
  lacunaNaCoberturaCents: number;

  fonteIndexador: string | null;
  fonteIndexadorUrl: string | null;
  fonteIndexadorConsultadaEm: string | null;
};

/* ========================================================================== */
/* O DETALHE DA CAIXINHA                                                      */
/* ========================================================================== */
/**
 * Um lote de CDB dentro de uma conta de aplicação — o NÍVEL 1 do detalhe.
 *
 * `caixinhaNome` é sempre nulo e `caixinhaNomeMotivo` diz por quê. Não é
 * descuido: o Polp entrega a camada de investimento (o lote que lastreia o
 * dinheiro), não o nome que aparece no app do Nubank. Ver a 0115 para a
 * medição campo a campo.
 */
export type CaixinhaPosicao = {
  posicaoId: number;
  accountSlug: string;
  externalId: string;
  status: string;
  produto: string;
  emissor: string | null;
  emissaoEm: string | null;
  carenciaEm: string | null;
  vencimentoEm: string | null;
  indexador: string | null;
  taxaPercent: number | null;
  principalCents: number;
  brutoCents: number;
  impostosCents: number;
  saldoCents: number;
  rendimentoLiquidoCents: number;
  lidoEm: string | null;
  /** SEMPRE null. O motivo ao lado é obrigatório — é o contrato `Medida`. */
  caixinhaNome: null;
  caixinhaNomeMotivo: string;
  movimentos: number;
  aplicadoCents: number;
  resgatadoCents: number;
  fluxoLiquidoCents: number;
  primeiroMovimento: string | null;
  ultimoMovimento: string | null;
  /** saldo − fluxo líquido. Fecha quando é igual ao rendimento. */
  residuoCents: number;
  /** O que sobra sem explicação. ≠ 0 é achado, e a tela mostra. */
  divergenciaCents: number;
};

/** Um BUY/SELL de uma posição — o NÍVEL 2. NUNCA some isto ao caixa. */
export type CaixinhaMovimento = {
  movimentoId: number;
  posicaoId: number;
  direcao: string;
  dataEm: string | null;
  valorCents: number;
  assinadoCents: number;
};

/** O total do pai contra a soma dos filhos, calculado no banco, não na tela. */
export type CaixinhaAncora = {
  accountId: number;
  accountSlug: string;
  accountNome: string;
  saldoContaCents: number;
  somaPosicoesCents: number;
  /** ≠ 0 é sempre defeito de sincronização. */
  deltaCents: number;
  posicoes: number;
  posicoesAtivas: number;
  posicoesEncerradas: number;
  principalCents: number;
  rendimentoLiquidoCents: number;
  impostosCents: number;
  movimentos: number;
  posicoesDivergentes: number;
  divergenciaCents: number;
  lidoEm: string | null;
  proximoVencimento: string | null;
};

export type CaixinhaDetalhe = {
  ancoras: CaixinhaAncora[];
  posicoes: CaixinhaPosicao[];
  movimentos: CaixinhaMovimento[];
  /** Nulo quando o detalhe está disponível. Preenchido, a tela degrada dizendo. */
  indisponivelMotivo: string | null;
};

export type CaixaDado = {
  contas: ContaCaixa[];
  totalDisponivelCents: number;
  contasSemCobertura: number;
  serie: PontoSerie[];
  emprestimo: Emprestimo | null;
  confronto: ParcelaConfronto[];
  extratoCaixa: LinhaExtratoCaixa[];
  transferencias: Transferencia[];
  premissas: Premissa[];
  caixinhas: CaixinhaDetalhe;
};

const CAIXINHAS_VAZIO: CaixinhaDetalhe = {
  ancoras: [],
  posicoes: [],
  movimentos: [],
  indisponivelMotivo: null
};

const VAZIO: CaixaDado = {
  contas: [],
  totalDisponivelCents: 0,
  contasSemCobertura: 0,
  serie: [],
  emprestimo: null,
  confronto: [],
  extratoCaixa: [],
  transferencias: [],
  premissas: [],
  caixinhas: CAIXINHAS_VAZIO
};

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const numOuNulo = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const dia = (v: unknown): string | null =>
  v === null || v === undefined ? null : new Date(v as string).toISOString().slice(0, 10);

/** A 0110 pode não estar aplicada. A tela degrada dizendo isso, não quebra. */
async function temEmprestimo(): Promise<boolean> {
  const r = await query<{ existe: boolean }>(
    "SELECT to_regclass('public.fin_emprestimo') IS NOT NULL AS existe"
  );
  return Boolean(r[0]?.existe);
}

/**
 * O detalhe das caixinhas, dois níveis.
 *
 * Depende da 0115. Enquanto ela não estiver aplicada o detalhe volta com
 * `indisponivelMotivo` preenchido e a tela DEGRADA DIZENDO O QUE FALTA — uma
 * lista vazia seria indistinguível de "a conta não tem posições", que é
 * exatamente a mentira que este módulo existe para não contar.
 *
 * Os movimentos vêm todos de uma vez, e isso é deliberado: são 163 linhas para
 * 66 posições. Uma chamada por posição ao clicar transformaria um clique em 18
 * viagens ao banco, e a lição do `/financeiro/agenda` é que consulta por linha
 * esgota o pool de 5 conexões e derruba OUTRAS rotas.
 */
async function getCaixinhas(): Promise<CaixinhaDetalhe> {
  const existe = await query<{ existe: boolean }>(
    "SELECT to_regclass('public.fin_caixinha_ancora_v') IS NOT NULL AS existe"
  );
  if (!existe[0]?.existe) {
    return {
      ...CAIXINHAS_VAZIO,
      indisponivelMotivo:
        "a migration 0115 ainda não está aplicada neste ambiente: o detalhe por posição " +
        "não pode ser lido. O total da conta acima é real e independe dela."
    };
  }

  const ancorasRes = await query<Record<string, unknown>>(
    `SELECT account_id, account_slug, account_nome, saldo_conta_cents, soma_posicoes_cents,
            delta_cents, posicoes, posicoes_ativas, posicoes_encerradas, principal_cents,
            rendimento_liquido_cents, impostos_cents, movimentos, posicoes_divergentes,
            divergencia_cents, lido_em, proximo_vencimento
       FROM fin_caixinha_ancora_v ORDER BY account_slug`
  );

  const posicoesRes = await query<Record<string, unknown>>(
    `SELECT posicao_id, account_slug, external_id, status, product_subtype, issuer,
            issue_date, grace_date, due_date, rate_type, rate_percent,
            principal_cents, gross_cents, taxes_cents, balance_cents,
            rendimento_liquido_cents, quoted_on, caixinha_nome, caixinha_nome_motivo,
            movimentos, aplicado_cents, resgatado_cents, fluxo_liquido_cents,
            primeiro_movimento, ultimo_movimento, residuo_cents, divergencia_cents
       FROM fin_caixinha_posicao_v
      ORDER BY (status = 'ativa') DESC, balance_cents DESC, external_id`
  );

  const movimentosRes = await query<Record<string, unknown>>(
    `SELECT movimento_id, posicao_id, direction, trade_date, amount_cents, assinado_cents
       FROM fin_caixinha_movimento_v ORDER BY posicao_id, trade_date, movimento_id`
  );

  return {
    indisponivelMotivo: null,
    ancoras: ancorasRes.map((r) => ({
      accountId: num(r.account_id),
      accountSlug: String(r.account_slug),
      accountNome: String(r.account_nome),
      saldoContaCents: num(r.saldo_conta_cents),
      somaPosicoesCents: num(r.soma_posicoes_cents),
      deltaCents: num(r.delta_cents),
      posicoes: num(r.posicoes),
      posicoesAtivas: num(r.posicoes_ativas),
      posicoesEncerradas: num(r.posicoes_encerradas),
      principalCents: num(r.principal_cents),
      rendimentoLiquidoCents: num(r.rendimento_liquido_cents),
      impostosCents: num(r.impostos_cents),
      movimentos: num(r.movimentos),
      posicoesDivergentes: num(r.posicoes_divergentes),
      divergenciaCents: num(r.divergencia_cents),
      lidoEm: dia(r.lido_em),
      proximoVencimento: dia(r.proximo_vencimento)
    })),
    posicoes: posicoesRes.map((r) => ({
      posicaoId: num(r.posicao_id),
      accountSlug: String(r.account_slug),
      externalId: String(r.external_id),
      status: String(r.status),
      produto: String(r.product_subtype ?? ""),
      emissor: (r.issuer as string) ?? null,
      emissaoEm: dia(r.issue_date),
      carenciaEm: dia(r.grace_date),
      vencimentoEm: dia(r.due_date),
      indexador: (r.rate_type as string) ?? null,
      taxaPercent: numOuNulo(r.rate_percent),
      principalCents: num(r.principal_cents),
      brutoCents: num(r.gross_cents),
      impostosCents: num(r.taxes_cents),
      saldoCents: num(r.balance_cents),
      rendimentoLiquidoCents: num(r.rendimento_liquido_cents),
      lidoEm: dia(r.quoted_on),
      // O banco garante NULL (asserção 5.3 da 0115). O `as null` não afrouxa
      // nada: se algum dia vier texto, a asserção derruba a migration antes.
      caixinhaNome: null,
      caixinhaNomeMotivo: String(r.caixinha_nome_motivo ?? ""),
      movimentos: num(r.movimentos),
      aplicadoCents: num(r.aplicado_cents),
      resgatadoCents: num(r.resgatado_cents),
      fluxoLiquidoCents: num(r.fluxo_liquido_cents),
      primeiroMovimento: dia(r.primeiro_movimento),
      ultimoMovimento: dia(r.ultimo_movimento),
      residuoCents: num(r.residuo_cents),
      divergenciaCents: num(r.divergencia_cents)
    })),
    movimentos: movimentosRes.map((r) => ({
      movimentoId: num(r.movimento_id),
      posicaoId: num(r.posicao_id),
      direcao: String(r.direction),
      dataEm: dia(r.trade_date),
      valorCents: num(r.amount_cents),
      assinadoCents: num(r.assinado_cents)
    }))
  };
}

export async function getCaixa(): Promise<Contrato<CaixaDado>> {
  if (!isFinanceConfigured()) {
    return contratoIndisponivel(DOMINIO, VAZIO, "FINANCE_DATABASE_URL não configurada");
  }

  return comFallback(DOMINIO, VAZIO, async () => {
    const migrada = await temEmprestimo();
    const caixinhas = await getCaixinhas();

    // ------------------------------------------------------------------
    // As contas. Esta consulta NÃO depende da 0110: se a migration não
    // estiver aplicada, o caixa continua aparecendo — só o empréstimo falta.
    // ------------------------------------------------------------------
    const contasSql = migrada
      ? `SELECT c.account_id, c.slug, c.name, c.institution, c.kind, c.saldo_cents,
                c.motivo_sem_saldo, c.tem_cobertura, c.lancamentos,
                c.primeiro_movimento, c.ultimo_movimento, c.last_statement_at,
                c.passivo_saldo_devedor_cents, c.passivo_ccb, c.passivo_memoria
           FROM fin_caixa_conta_v c ORDER BY c.slug`
      : `SELECT a.id AS account_id, a.slug, a.name, a.institution, a.kind,
                CASE WHEN mv.lancamentos > 0
                     THEN (a.opening_balance_cents + mv.soma)::bigint END AS saldo_cents,
                CASE WHEN mv.lancamentos > 0 THEN NULL
                     ELSE 'sem extrato: nenhuma fonte deste acervo alimenta esta conta. '
                          || 'Ausência de dado não é saldo zero.' END AS motivo_sem_saldo,
                (mv.lancamentos > 0) AS tem_cobertura, mv.lancamentos,
                mv.primeiro_movimento, mv.ultimo_movimento, a.last_statement_at,
                NULL::bigint AS passivo_saldo_devedor_cents,
                NULL::text AS passivo_ccb, NULL::text AS passivo_memoria
           FROM fin_account a
           LEFT JOIN LATERAL (
             SELECT count(*) lancamentos, COALESCE(sum(t.amount_cents),0) soma,
                    min(t.posted_on) primeiro_movimento, max(t.posted_on) ultimo_movimento
               FROM fin_transaction t
              WHERE t.account_id = a.id AND NOT t.is_split_parent) mv ON true
          WHERE a.is_active ORDER BY a.slug`;

    const contasRes = await query<Record<string, unknown>>(contasSql);
    const contas: ContaCaixa[] = contasRes.map((r) => ({
      accountId: num(r.account_id),
      slug: String(r.slug),
      nome: String(r.name),
      instituicao: String(r.institution ?? ""),
      tipo: String(r.kind ?? ""),
      saldoCents: numOuNulo(r.saldo_cents),
      motivoSemSaldo: (r.motivo_sem_saldo as string) ?? null,
      temCobertura: Boolean(r.tem_cobertura),
      lancamentos: num(r.lancamentos),
      primeiroMovimento: dia(r.primeiro_movimento),
      ultimoMovimento: dia(r.ultimo_movimento),
      ultimoExtratoEm: dia(r.last_statement_at),
      passivoSaldoDevedorCents: numOuNulo(r.passivo_saldo_devedor_cents),
      passivoCcb: (r.passivo_ccb as string) ?? null,
      passivoMemoria: (r.passivo_memoria as string) ?? null
    }));

    const totalDisponivelCents = contas.reduce((a, c) => a + (c.saldoCents ?? 0), 0);
    const contasSemCobertura = contas.filter((c) => c.saldoCents === null).length;

    // ------------------------------------------------------------------
    // A série mensal por conta.
    // ------------------------------------------------------------------
    const serieSql = migrada
      ? `SELECT slug, name, to_char(mes,'YYYY-MM') mes, entradas_cents, saidas_cents,
                movimento_cents, saldo_fim_cents, lancamentos
           FROM fin_caixa_serie_mensal_v ORDER BY mes, slug`
      : `WITH mes AS (
           SELECT a.id account_id, a.slug, a.name, g.mes::date mes
             FROM fin_account a
             CROSS JOIN LATERAL generate_series(
               date_trunc('month', COALESCE(
                 (SELECT min(t.posted_on) FROM fin_transaction t WHERE t.account_id=a.id),
                 a.opening_balance_date)::timestamptz),
               date_trunc('month', current_date::timestamptz), interval '1 month') g(mes)
            WHERE a.is_active
              AND EXISTS (SELECT 1 FROM fin_transaction t WHERE t.account_id=a.id)),
         agg AS (
           SELECT m.account_id, m.slug, m.name, m.mes,
                  COALESCE(sum(t.amount_cents) FILTER (WHERE t.amount_cents>0),0)::bigint entradas_cents,
                  COALESCE(sum(t.amount_cents) FILTER (WHERE t.amount_cents<0),0)::bigint saidas_cents,
                  COALESCE(sum(t.amount_cents),0)::bigint movimento_cents,
                  count(t.id) lancamentos
             FROM mes m
             LEFT JOIN fin_transaction t ON t.account_id=m.account_id AND NOT t.is_split_parent
                   AND date_trunc('month', t.posted_on::timestamptz)::date = m.mes
            GROUP BY m.account_id, m.slug, m.name, m.mes)
         SELECT agg.slug, agg.name, to_char(agg.mes,'YYYY-MM') mes, agg.entradas_cents,
                agg.saidas_cents, agg.movimento_cents, agg.lancamentos,
                (a.opening_balance_cents + sum(agg.movimento_cents) OVER (
                   PARTITION BY agg.account_id ORDER BY agg.mes
                   ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW))::bigint saldo_fim_cents
           FROM agg JOIN fin_account a ON a.id=agg.account_id
          ORDER BY agg.mes, agg.slug`;

    const serieRes = await query<Record<string, unknown>>(serieSql);
    const serie: PontoSerie[] = serieRes.map((r) => ({
      slug: String(r.slug),
      nome: String(r.name),
      mes: String(r.mes),
      entradasCents: num(r.entradas_cents),
      saidasCents: num(r.saidas_cents),
      movimentoCents: num(r.movimento_cents),
      saldoFimCents: num(r.saldo_fim_cents),
      lancamentos: num(r.lancamentos)
    }));

    const ressalvas: string[] = [
      "Saldo é abertura declarada mais movimento do extrato. Conta sem extrato aparece " +
        "como indeterminada, nunca como R$ 0,00 — ausência de dado não é ausência de dinheiro."
    ];

    if (!migrada) {
      return contrato({
        dominio: DOMINIO,
        dado: { ...VAZIO, contas, totalDisponivelCents, contasSemCobertura, serie, caixinhas },
        ressalvas: [
          ...ressalvas,
          "A migration 0110 ainda não está aplicada neste ambiente: o empréstimo Pronampe " +
            "não aparece. O caixa por conta acima é real e independe dela."
        ]
      });
    }

    // ------------------------------------------------------------------
    // O empréstimo.
    // ------------------------------------------------------------------
    const empRes = await query<Record<string, unknown>>(`
      SELECT s.*, e.credor, e.iof_cents, e.spread_mensal, e.indexador,
             e.cet_mensal_declarado, e.cet_anual_declarado, e.prazo_total_meses,
             e.conta_debito_contrato,
             (SELECT i.fonte_serie FROM fin_emprestimo_indexador i
               WHERE i.emprestimo_id = e.id LIMIT 1) fonte_serie,
             (SELECT i.fonte_url FROM fin_emprestimo_indexador i
               WHERE i.emprestimo_id = e.id LIMIT 1) fonte_url,
             (SELECT i.consultado_em FROM fin_emprestimo_indexador i
               WHERE i.emprestimo_id = e.id LIMIT 1) consultado_em
        FROM fin_emprestimo_saldo_v s
        JOIN fin_emprestimo e ON e.id = s.emprestimo_id
       LIMIT 1`);

    const e = empRes[0];
    const emprestimo: Emprestimo | null = e
      ? {
          ccb: String(e.ccb),
          linha: String(e.linha),
          credor: String(e.credor),
          principalCents: num(e.principal_cents),
          liquidoLiberadoCents: num(e.liquido_liberado_cents),
          iofCents: num(e.iof_cents),
          prestacaoContratualCents: num(e.prestacao_contratual_cents),
          spreadMensal: Number(e.spread_mensal),
          indexador: (e.indexador as string) ?? null,
          cetMensalDeclarado: numOuNulo(e.cet_mensal_declarado),
          cetAnualDeclarado: numOuNulo(e.cet_anual_declarado),
          liberacaoEm: dia(e.liberacao_em)!,
          primeiraParcelaEm: dia(e.primeira_parcela_em)!,
          vencimentoEm: dia(e.vencimento_em)!,
          prazoTotalMeses: num(e.prazo_total_meses),
          carenciaMeses: num(e.carencia_meses),
          prestacoes: num(e.prestacoes),
          contaDebitoContrato: (e.conta_debito_contrato as string) ?? null,
          saldoDevedorCents: num(e.saldo_devedor_cents),
          natureza: String(e.natureza),
          ressalva: String(e.ressalva),
          memoria: String(e.memoria),
          ultimaParcelaVencida: num(e.ultima_parcela_vencida),
          ultimaParcelaEm: dia(e.ultima_parcela_em)!,
          proximaPrestacaoCents: numOuNulo(e.proxima_prestacao_cents),
          proximaParcelaEm: dia(e.proxima_parcela_em),
          proximaOrigemTaxa: (e.proxima_origem_taxa as string) ?? null,
          vencidas: num(e.vencidas),
          comFunding: num(e.com_funding),
          fundingInsuficiente: num(e.funding_insuficiente),
          semFundingCoberta: num(e.sem_funding_coberta),
          foraDaCobertura: num(e.fora_da_cobertura),
          futuras: num(e.futuras),
          devidoCents: num(e.devido_cents),
          devidoNaCoberturaCents: num(e.devido_na_cobertura_cents),
          transferidoCents: num(e.transferido_cents),
          transferencias: num(e.transferencias),
          primeiraTransferenciaEm: dia(e.primeira_transferencia_em),
          ultimaTransferenciaEm: dia(e.ultima_transferencia_em),
          lacunaNaCoberturaCents: num(e.lacuna_na_cobertura_cents),
          fonteIndexador: (e.fonte_serie as string) ?? null,
          fonteIndexadorUrl: (e.fonte_url as string) ?? null,
          fonteIndexadorConsultadaEm: dia(e.consultado_em)
        }
      : null;

    const confRes = await query<Record<string, unknown>>(`
      SELECT parcela, vencimento_em, estado, modelo_cents, contrato_cents,
             observado_cents, observado_em, observado_origem, diferenca_cents,
             diferenca_pct, taxa_mes, origem_taxa, encargo_cents, principal_cents,
             saldo_devedor_cents, cobertura_origem, leitura
        FROM fin_emprestimo_confronto_v ORDER BY parcela`);
    const confronto: ParcelaConfronto[] = confRes.map((r) => ({
      parcela: num(r.parcela),
      vencimentoEm: dia(r.vencimento_em)!,
      estado: String(r.estado),
      modeloCents: num(r.modelo_cents),
      contratoCents: num(r.contrato_cents),
      observadoCents: numOuNulo(r.observado_cents),
      observadoEm: dia(r.observado_em),
      observadoOrigem: (r.observado_origem as string) ?? null,
      diferencaCents: numOuNulo(r.diferenca_cents),
      diferencaPct: numOuNulo(r.diferenca_pct),
      taxaMes: Number(r.taxa_mes),
      origemTaxa: String(r.origem_taxa),
      encargoCents: num(r.encargo_cents),
      principalCents: num(r.principal_cents),
      saldoDevedorCents: num(r.saldo_devedor_cents),
      coberturaOrigem: String(r.cobertura_origem),
      leitura: String(r.leitura)
    }));

    const extRes = await query<Record<string, unknown>>(`
      SELECT data, sentido, valor_cents, descricao, origem, estimado, metodo,
             descasamento_acumulado_cents
        FROM fin_caixa_extrato_estimado_v ORDER BY data, sentido DESC`);
    const extratoCaixa: LinhaExtratoCaixa[] = extRes.map((r) => ({
      data: dia(r.data)!,
      sentido: String(r.sentido),
      valorCents: num(r.valor_cents),
      descricao: String(r.descricao),
      origem: String(r.origem),
      estimado: Boolean(r.estimado),
      metodo: String(r.metodo),
      descasamentoAcumuladoCents: num(r.descasamento_acumulado_cents)
    }));

    const trRes = await query<Record<string, unknown>>(`
      SELECT movimento_em, conta_origem, conta_origem_nome, valor_cents,
             description_raw, instituicao_destino
        FROM fin_emprestimo_transferencia_v ORDER BY movimento_em`);
    const transferencias: Transferencia[] = trRes.map((r) => ({
      movimentoEm: dia(r.movimento_em)!,
      contaOrigem: String(r.conta_origem),
      contaOrigemNome: String(r.conta_origem_nome),
      valorCents: num(r.valor_cents),
      descricao: String(r.description_raw ?? ""),
      instituicaoDestino: (r.instituicao_destino as string) ?? null
    }));

    const prRes = await query<Record<string, unknown>>(`
      SELECT chave, enunciado, declarada_por, declarada_em, o_que_derruba
        FROM fin_emprestimo_premissa WHERE vigente ORDER BY id`);
    const premissas: Premissa[] = prRes.map((r) => ({
      chave: String(r.chave),
      enunciado: String(r.enunciado),
      declaradaPor: String(r.declarada_por),
      declaradaEm: dia(r.declarada_em)!,
      oQueDerruba: String(r.o_que_derruba)
    }));

    if (emprestimo) {
      ressalvas.push(
        "O saldo devedor do Pronampe é PASSIVO e não entra no total disponível. Ele é " +
          "estimado e é PISO: supõe que toda prestação foi paga em dia. Se houve atraso, " +
          "a dívida real é maior."
      );
      ressalvas.push(
        "Nenhuma linha do cronograma é fato: não existe extrato da conta da XPE na Caixa. " +
          "O que é real são as transferências que abastecem essa conta, medidas no extrato de origem."
      );
    }

    return contrato({
      dominio: DOMINIO,
      dado: {
        contas,
        totalDisponivelCents,
        contasSemCobertura,
        serie,
        emprestimo,
        confronto,
        extratoCaixa,
        transferencias,
        premissas,
        caixinhas
      },
      ressalvas
    });
  });
}

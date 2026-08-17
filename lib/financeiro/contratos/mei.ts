import "server-only";

import { isFinanceConfigured, query } from "../db";
import {
  ANO_ESCOPO,
  comFallback,
  contrato,
  contratoIndisponivel,
  frescorDeData,
  type Contrato,
  type Pendencia
} from "./base";

/**
 * A janela do teto do MEI, as multas medidas e o veredito sobre o anexo.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTE CONTRATO EXISTE SEPARADO DO TRIBUTÁRIO
 * ---------------------------------------------------------------------------
 * `tributos/apuracao` responde "quanto a EMPRESA deve". Este responde "quanto
 * de espaço sobra no teto de cada PRESTADOR" — outro contribuinte, outro
 * limite, outra lei. Misturar os dois foi exatamente o erro que produziu a
 * carga fantasma de 9,17% na 0092: o DAS-MEI de terceiro entrou no numerador
 * do imposto da casa.
 *
 * ---------------------------------------------------------------------------
 * A RESSALVA QUE VEM ANTES DO NÚMERO
 * ---------------------------------------------------------------------------
 * Toda medida aqui é PISO. O teto do art. 18-A incide sobre a receita bruta
 * total do MEI, de todos os clientes dele; esta base só enxerga o que a XPE
 * pagou. Um MEI a 94,8% do teto por conta de um contratante só pode já ter
 * estourado por causa de outro — e a tela precisa dizer isso antes de mostrar
 * o percentual, não depois.
 */

export type FaixaTeto =
  | "dentro"
  | "projeta_exceder_ate_20"
  | "projeta_exceder_acima_20"
  | "excedido_ate_20"
  | "excedido_acima_20";

export type JanelaMei = {
  personId: number;
  pessoa: string;
  cnpj: string | null;
  situacaoCadastro: string | null;
  ano: number;
  recebidoCents: number;
  limiteCents: number;
  limiteComToleranciaCents: number;
  pctDoLimite: number;
  faltaParaOLimiteCents: number;
  ritmoMensalCents: number | null;
  projecaoFechamentoCents: number | null;
  pctProjetado: number | null;
  mesesAteCruzar: number | null;
  mesCruzamento: string | null;
  situacao: FaixaTeto;
  efeitoLegal: string;
  porQueEPiso: string;
  /** Nasce nulo de propósito — a lei declara 100% e 120%, e mais nada. */
  alertaAntecipadoPct: number | null;
  alertaAntecipadoMotivo: string;
  ressalvaLimiteProporcional: string | null;
  baseLegal: string;
  fonteUrl: string;
  fonteConsultadaEm: string;
};

export type MultaMedida = {
  transactionId: number;
  postedOn: string;
  conta: string;
  valorCents: number;
  principalCents: number;
  multaCents: number;
  jurosCents: number;
  /** True quando o excedente ultrapassa o teto de 20%: aí juros é prova, não hipótese. */
  contemJurosProvado: boolean;
  diasAtrasoMinimo: number | null;
  memoria: string;
  baseLegal: string;
  fonteUrl: string;
};

export type VeredictoAnexo = {
  competencia: string;
  mesesComFolha: number;
  fatorRMedido: number | null;
  fatorRRecomposto: number | null;
  limiarLegal: number;
  anexoPeloMedido: string | null;
  anexoPeloRecomposto: string | null;
  anexoPeloDasPago: string | null;
  cargaObservada: number | null;
  aliquotaEfetivaIii: number | null;
  aliquotaEfetivaV: number | null;
  concorda: boolean | null;
  memoria: string;
};

export type AliquotaMes = {
  competencia: string;
  anexo: string;
  faixa: number;
  receitaCents: number;
  rbt12Cents: number;
  aliquotaNominal: number;
  aliquotaEfetiva: number | null;
  dasCalculadoCents: number | null;
  dasPagoCents: number | null;
  diferencaCents: number | null;
  memoria: string;
};

export type PanoramaMei = {
  ano: number;
  janelas: JanelaMei[];
  multas: MultaMedida[];
  /** Total de acréscimo achado no acervo INTEIRO, não só no ano. */
  multaTotalCents: number;
  /**
   * O que a medição de multa não alcança. Nulo seria mentira: só o DAS-MEI tem
   * valor esperado derivável da lei.
   */
  multaNaoMedivelMotivo: string;
  veredito: VeredictoAnexo[];
  aliquotas: AliquotaMes[];
  /** Quantos DAS de referência já foram anexados. Zero é o estado inicial. */
  dasReferenciaCount: number;
};

const VAZIO: PanoramaMei = {
  ano: ANO_ESCOPO,
  janelas: [],
  multas: [],
  multaTotalCents: 0,
  multaNaoMedivelMotivo: "",
  veredito: [],
  aliquotas: [],
  dasReferenciaCount: 0
};

const MOTIVO_MULTA_NAO_MEDIVEL =
  "Só o DAS-MEI tem valor esperado derivável da lei (5% do salário mínimo + R$ 5,00), e por isso " +
  "qualquer acréscimo nele é visível. O DAS da empresa depende da receita declarada e não tem " +
  "valor esperado: multa embutida nele é indeterminada, não zero. A categoria 9.11 “Juros e multas " +
  "pagos” tem zero lançamentos e nenhuma descrição do acervo contém a palavra multa, juros, mora " +
  "ou atraso — nesta base a multa nunca é um rótulo, é um excedente.";

export async function getPanoramaMei(args?: { ano?: number }): Promise<Contrato<PanoramaMei>> {
  const ano = args?.ano ?? ANO_ESCOPO;

  if (!isFinanceConfigured()) {
    return contratoIndisponivel("mei", { ...VAZIO, ano }, "FINANCE_DATABASE_URL não configurada");
  }

  return comFallback("mei", { ...VAZIO, ano }, async () => {
    // A migration 0107 pode não estar aplicada. Degradar dizendo o que falta é
    // melhor que um 500 que não ensina nada — é o mesmo padrão da 0105.
    const existe = await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_views WHERE viewname = 'fin_mei_teto_v'`
    );
    if (Number(existe[0]?.n ?? 0) === 0) {
      return contratoIndisponivel(
        "mei",
        { ...VAZIO, ano },
        "a migration 0107 (janela do teto do MEI) ainda não está aplicada neste ambiente"
      );
    }

    const [janelas, multas, veredito, aliquotas, refs, corte] = await Promise.all([
      query<Record<string, unknown>>(
        `SELECT person_id, pessoa, cnpj, situacao_cadastro, ano, recebido_cents,
                limite_cents, limite_com_tolerancia_cents, pct_do_limite,
                falta_para_o_limite_cents, ritmo_mensal_cents, projecao_fechamento_cents,
                pct_projetado, meses_ate_cruzar, mes_cruzamento, situacao, efeito_legal,
                por_que_e_piso, alerta_antecipado_pct, alerta_antecipado_motivo,
                ressalva_limite_proporcional, base_legal, fonte_url, fonte_consultada_em
           FROM fin_mei_teto_v
          WHERE ano = $1
          ORDER BY pct_do_limite DESC`,
        [ano]
      ),
      query<Record<string, unknown>>(
        `SELECT transaction_id, posted_on, conta, valor_cents, principal_cents,
                multa_cents, juros_cents, contem_juros_provado, dias_atraso_minimo,
                memoria, base_legal, fonte_url
           FROM fin_das_mei_pagamento_v
          WHERE especie = 'mei_com_acrescimo'
          ORDER BY posted_on`
      ),
      query<Record<string, unknown>>(
        `SELECT competencia, meses_com_folha, fator_r_medido, fator_r_recomposto_12m,
                limiar_legal, anexo_pelo_medido, anexo_pelo_recomposto, anexo_pelo_das_pago,
                carga_observada, aliquota_efetiva_iii, aliquota_efetiva_v,
                recomposto_concorda_com_o_pago, memoria
           FROM fin_fator_r_veredito_v
          WHERE competencia >= make_date($1, 1, 1) - interval '1 month'
          ORDER BY competencia`,
        [ano]
      ),
      query<Record<string, unknown>>(
        `SELECT competencia, anexo, faixa, receita_cents, rbt12_cents, aliquota_nominal,
                aliquota_efetiva, das_calculado_cents, das_empresa_pago_cents, diferenca_cents,
                memoria
           FROM fin_simples_aliquota_mes_v
          WHERE competencia >= make_date($1, 1, 1) - interval '1 month'
          ORDER BY competencia, anexo`,
        [ano]
      ),
      query<{ n: string }>(`SELECT count(*)::text AS n FROM fin_das_referencia`),
      query<{ ate: string | null }>(`SELECT max(posted_on)::text AS ate FROM fin_transaction`)
    ]);

    const dado: PanoramaMei = {
      ano,
      janelas: janelas.map((r: Record<string, unknown>) => ({
        personId: Number(r.person_id),
        pessoa: String(r.pessoa),
        cnpj: (r.cnpj as string | null) ?? null,
        situacaoCadastro: (r.situacao_cadastro as string | null) ?? null,
        ano: Number(r.ano),
        recebidoCents: Number(r.recebido_cents),
        limiteCents: Number(r.limite_cents),
        limiteComToleranciaCents: Number(r.limite_com_tolerancia_cents),
        pctDoLimite: Number(r.pct_do_limite),
        faltaParaOLimiteCents: Number(r.falta_para_o_limite_cents),
        ritmoMensalCents: num(r.ritmo_mensal_cents),
        projecaoFechamentoCents: num(r.projecao_fechamento_cents),
        pctProjetado: num(r.pct_projetado),
        mesesAteCruzar: num(r.meses_ate_cruzar),
        mesCruzamento: iso(r.mes_cruzamento),
        situacao: r.situacao as FaixaTeto,
        efeitoLegal: String(r.efeito_legal),
        porQueEPiso: String(r.por_que_e_piso),
        alertaAntecipadoPct: num(r.alerta_antecipado_pct),
        alertaAntecipadoMotivo: String(r.alerta_antecipado_motivo),
        ressalvaLimiteProporcional: (r.ressalva_limite_proporcional as string | null) ?? null,
        baseLegal: String(r.base_legal),
        fonteUrl: String(r.fonte_url),
        fonteConsultadaEm: String(iso(r.fonte_consultada_em) ?? "")
      })),
      multas: multas.map((r: Record<string, unknown>) => ({
        transactionId: Number(r.transaction_id),
        postedOn: String(iso(r.posted_on)),
        conta: String(r.conta),
        valorCents: Number(r.valor_cents),
        principalCents: Number(r.principal_cents),
        multaCents: Number(r.multa_cents),
        jurosCents: Number(r.juros_cents),
        contemJurosProvado: Boolean(r.contem_juros_provado),
        diasAtrasoMinimo: num(r.dias_atraso_minimo),
        memoria: String(r.memoria),
        baseLegal: String(r.base_legal),
        fonteUrl: String(r.fonte_url)
      })),
      multaTotalCents: 0,
      multaNaoMedivelMotivo: MOTIVO_MULTA_NAO_MEDIVEL,
      veredito: veredito.map((r: Record<string, unknown>) => ({
        competencia: String(iso(r.competencia)),
        mesesComFolha: Number(r.meses_com_folha),
        fatorRMedido: num(r.fator_r_medido),
        fatorRRecomposto: num(r.fator_r_recomposto_12m),
        limiarLegal: Number(r.limiar_legal),
        anexoPeloMedido: (r.anexo_pelo_medido as string | null) ?? null,
        anexoPeloRecomposto: (r.anexo_pelo_recomposto as string | null) ?? null,
        anexoPeloDasPago: (r.anexo_pelo_das_pago as string | null) ?? null,
        cargaObservada: num(r.carga_observada),
        aliquotaEfetivaIii: num(r.aliquota_efetiva_iii),
        aliquotaEfetivaV: num(r.aliquota_efetiva_v),
        concorda: r.recomposto_concorda_com_o_pago === null ? null : Boolean(r.recomposto_concorda_com_o_pago),
        memoria: String(r.memoria)
      })),
      aliquotas: aliquotas.map((r: Record<string, unknown>) => ({
        competencia: String(iso(r.competencia)),
        anexo: String(r.anexo),
        faixa: Number(r.faixa),
        receitaCents: Number(r.receita_cents),
        rbt12Cents: Number(r.rbt12_cents),
        aliquotaNominal: Number(r.aliquota_nominal),
        aliquotaEfetiva: num(r.aliquota_efetiva),
        dasCalculadoCents: num(r.das_calculado_cents),
        dasPagoCents: num(r.das_empresa_pago_cents),
        diferencaCents: num(r.diferenca_cents),
        memoria: String(r.memoria)
      })),
      dasReferenciaCount: Number(refs[0]?.n ?? 0)
    };

    dado.multaTotalCents = dado.multas.reduce((s, m) => s + m.multaCents + m.jurosCents, 0);

    const emRisco = dado.janelas.filter((j) => j.situacao !== "dentro");
    const pendencias: Pendencia[] = [];

    for (const j of emRisco) {
      const acima20 = j.situacao.endsWith("acima_20");
      pendencias.push({
        chave: `mei-teto-${j.personId}`,
        titulo: `${j.pessoa}: ${(j.pctDoLimite * 100).toFixed(1)}% do teto do MEI${
          j.mesCruzamento ? ` · cruza em ${j.mesCruzamento.slice(0, 7)}` : ""
        }`,
        quantidade: 1,
        // O que está em jogo não é o que ele já recebeu: é o espaço que sobra.
        valorCents: j.faltaParaOLimiteCents,
        severidade: acima20 ? "bloqueante" : "alerta",
        telaDeDecisao: "/financeiro/mei"
      });
    }

    if (dado.dasReferenciaCount === 0) {
      pendencias.push({
        chave: "das-referencia-vazia",
        titulo:
          "Nenhum DAS de referência anexado — a conferência do declarado contra o apurado não existe ainda",
        quantidade: 0,
        valorCents: null,
        severidade: "informativo",
        telaDeDecisao: "/financeiro/mei"
      });
    }

    return contrato({
      dominio: "mei",
      dado,
      cobertura: [
        frescorDeData({
          fonte: "ledger",
          origem: "fin_transaction",
          cobreAte: corte[0]?.ate ?? null,
          toleranciaDias: 3,
          motivoSeVazio: "nenhum lançamento no ledger"
        })
      ],
      pendencias,
      ressalvas: [
        "PISO, não valor: a janela conta apenas o que a XPE pagou. O teto do art. 18-A incide sobre " +
          "a receita bruta total do MEI, de todos os clientes dele.",
        "O teto vem de fin_tax_regime_param com dispositivo legal e data de consulta — nunca de " +
          "constante no código. Se a lei mudar, entra linha nova com vigência própria.",
        "As faixas são as duas que a LC 123/2006 art. 18-A § 7º, III declara: 100% e 120% do teto. " +
          "Não há faixa de alerta antecipado porque ninguém a declarou (dúvida 62).",
        "Leitura gerencial. Não substitui apuração, PGDAS nem parecer: depende de validação do contador."
      ]
    });
  });
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function iso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

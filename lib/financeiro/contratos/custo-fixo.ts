import "server-only";

import { isFinanceConfigured, query } from "../db";
import { contrato, contratoIndisponivel, ENTIDADE, type Contrato } from "./base";

/**
 * O catálogo do que a empresa paga todo mês.
 *
 * ---------------------------------------------------------------------------
 * OS DOIS TOTAIS QUE NÃO PODEM SER CONFUNDIDOS
 * ---------------------------------------------------------------------------
 * Esta é a regra que a tela existe para não deixar ninguém errar:
 *
 *   `totalLigadoCents`     o que a empresa DECIDIU que paga todo mês. É
 *                          previsão, entra no saldo, e hoje é R$ 0,00 —
 *                          porque ninguém ligou nada ainda. Zero aqui NÃO é
 *                          "a empresa não tem custo fixo"; é "ninguém decidiu
 *                          ainda", e `totalLigadoMotivo` diz isso em prosa.
 *
 *   `totalDetectadoCents`  o que ela DE FATO pagou de recorrente, medido nos
 *                          12 meses fechados. É passado. Não entra em saldo
 *                          nenhum, e vem quebrado pela camada que já contém
 *                          cada parte — folha, DAS, documento — porque a maior
 *                          parte do recorrente desta empresa JÁ é projetada por
 *                          outra coisa, e um total único esconderia isso.
 *
 * Somar os dois é contar o mesmo dinheiro duas vezes. Mostrar só o primeiro faz
 * a empresa parecer não ter custo. Mostrar só o segundo faz parecer que a
 * previsão já está pronta. A tela mostra os dois, com a distinção escrita.
 *
 * ---------------------------------------------------------------------------
 * O QUE ESTE CONTRATO NÃO FAZ
 * ---------------------------------------------------------------------------
 * Não soma linha com `entraNoTotal = false`. Nunca. Cada uma delas carrega
 * `motivoForaDoTotal`, e as duas maiores populações são exatamente as que
 * inflariam o número: a folha (R$ 87.800,39/mês, já projetada por
 * `pagar_folha`) e o DAS (R$ 12.930,85/mês, já projetado por
 * `pagar_tributo_das`).
 */

const DOMINIO = "custo-fixo";

export type StatusCatalogo =
  | "proposto"
  | "ativo"
  | "suspenso"
  | "encerrado"
  | "recusado"
  | "candidato"
  | "informativo";

export type ProcedenciaCatalogo = "catalogo" | "candidato" | "folha";

/** Qual critério produziu o valor sugerido. Cada um tem erro medido em backtest. */
export type CriterioValor =
  | "moda_observada"
  | "ultimo_observado"
  | "mediana_3m"
  | "media_janela"
  | "declarado"
  | "contrato";

export type NaturezaCusto =
  | "fixo"
  | "variavel_volume"
  | "parcelado"
  | "estimado"
  | "indeterminado";

export type SituacaoDeteccao = "vigente" | "falhou_meses" | "parou";

export type LinhaCatalogo = {
  /** Nulo no candidato: ele ainda não existe como linha de `fin_recurring`. */
  recurringId: number | null;
  procedencia: ProcedenciaCatalogo;
  descricao: string;
  status: StatusCatalogo;
  statusMotivo: string | null;
  statusAlteradoEm: string | null;
  statusAlteradoPor: string | null;
  confianca: string | null;

  categoriaId: number | null;
  categoriaCode: string | null;
  categoria: string | null;
  contraparteId: number | null;
  contraparte: string | null;
  nucleo: string | null;

  diaDoMes: number | null;
  cadencia: string | null;
  naturezaCusto: NaturezaCusto | null;

  /** O valor gravado no catálogo — o que a previsão usa quando o item está ligado. */
  valorVigenteCents: number | null;
  /** O que o detector sugere HOJE, pelo critério da família. */
  valorSugeridoCents: number | null;
  /** Sugerido − vigente. É o reajuste que ninguém aplicou ainda. */
  divergenciaSugeridoCents: number | null;
  criterio: CriterioValor | null;
  criterioMotivo: string | null;
  /** APE mediana do critério na família dele, medida em backtest cego. */
  criterioErroPct: number | null;
  /** Obrigatório quando não há valor. É a regra nº 5 do projeto, na tela. */
  valorIndeterminadoMotivo: string | null;

  // ── evidência ────────────────────────────────────────────────────────────
  ocorrencias: number | null;
  spanMeses: number | null;
  densidade: number | null;
  dispersao: number | null;
  lancamentosPorMes: number | null;
  primeiraCompetencia: string | null;
  ultimaCompetencia: string | null;
  mesesSemOcorrencia: number | null;
  situacao: SituacaoDeteccao | null;
  situacaoMotivo: string | null;

  /** Os candidatos que o critério descartou, para quem quiser conferir. */
  medianaCents: number | null;
  mediana3mCents: number | null;
  ultimoCents: number | null;
  ultimoComparavelCents: number | null;
  modaCents: number | null;
  mediaCents: number | null;

  // ── revisão e histórico ──────────────────────────────────────────────────
  revisadoEm: string | null;
  revisadoPor: string | null;
  ajustes: number;
  ultimoAjusteVigenteDe: string | null;
  ultimoAjusteAntesCents: number | null;
  ultimoAjusteMotivo: string | null;
  ultimoAjusteAutor: string | null;

  // ── soma e alertas ───────────────────────────────────────────────────────
  entraNoTotal: boolean;
  motivoForaDoTotal: string | null;
  conflitoCamada: string | null;
  conflitoMotivo: string | null;
  alertaSobreposicao: string | null;
  chaveDedupe: string;
};

export type CategoriaCatalogo = {
  categoriaId: number | null;
  code: string | null;
  nome: string | null;
  kind: string | null;
  itens: number;
  ligados: number;
  propostos: number;
  candidatos: number;
  desligados: number;
  comAlerta: number;
  indeterminados: number;
  subtotalCents: number;
  aRevisarCents: number;
  emOutraCamadaCents: number;
};

export type ParcelamentoAberto = {
  planoId: number;
  descricao: string;
  categoriaCode: string | null;
  categoria: string | null;
  parcelasTotal: number;
  parcelasAbertas: number;
  parcelaCents: number;
  abertoCents: number;
  comecaEm: string | null;
  /** A coluna que separa parcelado de assinatura. Vem DECLARADA pela fonte. */
  terminaEm: string | null;
  mesesRestantes: number | null;
  ressalva: string;
};

export type Vencimento = {
  itemId: number | null;
  competencia: string;
  descricao: string;
  categoriaCode: string | null;
  categoria: string | null;
  contraparte: string | null;
  diaEsperado: string;
  diaRegra: string | null;
  valorCents: number | null;
  diasParaVencer: number;
  urgencia: "vencido" | "vence_hoje" | "vence_em_3_dias" | "vence_em_7_dias";
  confirmado: boolean;
  confirmadoPor: string | null;
  /** "confirmado por X — mas confirmar não é pagar". */
  oQueFalta: string;
  alertaSobreposicao: string | null;
  chaveDedupe: string;
};

export type ResumoCatalogo = {
  totalLigadoCents: number;
  /** Preenchido quando o total ligado é zero. Zero sem motivo seria mentira. */
  totalLigadoMotivo: string | null;
  itensLigados: number;
  itensPropostos: number;
  itensCandidatos: number;
  itensDesligados: number;
  itensComAlerta: number;
  itensIndeterminados: number;
  itensNuncaRevisados: number;

  totalDetectadoCents: number;
  detectadoTerceirosCents: number;
  detectadoFolhaCents: number;
  detectadoDasCents: number;
  detectadoDocumentoCents: number;
  detectadoSemValor: number;
  gruposDetectados: number;

  parceladoMesCorrenteCents: number;
  parceladoAbertoCents: number;
  parcelamentosAbertos: number;
  parceladoTerminaEm: string | null;

  /** Estimativa. Já está DENTRO da folha — nunca somar por cima. */
  reembolsoEstimadoCents: number;
};

export type CatalogoCustoFixo = {
  linhas: LinhaCatalogo[];
  porCategoria: CategoriaCatalogo[];
  parcelados: ParcelamentoAberto[];
  vencimentos: Vencimento[];
  resumo: ResumoCatalogo;
};

export type FiltrosCatalogo = {
  categoria?: string;
  status?: StatusCatalogo;
  /** Só o que ainda não foi revisado por ninguém. */
  aRevisar?: boolean;
  /** Esconde o que já vive em outra camada (folha, DAS, cartão). */
  semConflito?: boolean;
  busca?: string;
};

const RESUMO_VAZIO: ResumoCatalogo = {
  totalLigadoCents: 0,
  totalLigadoMotivo: null,
  itensLigados: 0,
  itensPropostos: 0,
  itensCandidatos: 0,
  itensDesligados: 0,
  itensComAlerta: 0,
  itensIndeterminados: 0,
  itensNuncaRevisados: 0,
  totalDetectadoCents: 0,
  detectadoTerceirosCents: 0,
  detectadoFolhaCents: 0,
  detectadoDasCents: 0,
  detectadoDocumentoCents: 0,
  detectadoSemValor: 0,
  gruposDetectados: 0,
  parceladoMesCorrenteCents: 0,
  parceladoAbertoCents: 0,
  parcelamentosAbertos: 0,
  parceladoTerminaEm: null,
  reembolsoEstimadoCents: 0
};

const VAZIO: CatalogoCustoFixo = {
  linhas: [],
  porCategoria: [],
  parcelados: [],
  vencimentos: [],
  resumo: RESUMO_VAZIO
};

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const dia = (v: unknown): string | null => (v ? String(v).slice(0, 10) : null);
const txt = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

export async function getCatalogoCustoFixo(
  filtros: FiltrosCatalogo = {}
): Promise<Contrato<CatalogoCustoFixo>> {
  if (!isFinanceConfigured()) {
    return contratoIndisponivel(DOMINIO, VAZIO, "banco financeiro não configurado");
  }

  try {
    // Filtros sempre como parâmetro, nunca interpolados: um filtro a mais aqui
    // não pode virar um caminho de SQL que ninguém testou. Mesmo desenho de
    // `custos.ts`.
    const [linhas, categorias, parcelados, vencimentos, resumo] = await Promise.all([
      query<Record<string, unknown>>(
        `SELECT v.*, c.code AS categoria_code, c.name AS categoria_nome, cp.name AS contraparte_nome
           FROM fin_custo_fixo_catalogo_v v
           JOIN fin_entity e ON e.id = v.entity_id AND e.slug = $1
           LEFT JOIN fin_category c ON c.id = v.category_id
           LEFT JOIN fin_counterparty cp ON cp.id = v.counterparty_id
          WHERE ($2::text IS NULL OR c.code = $2)
            AND ($3::text IS NULL OR v.status = $3)
            AND (NOT $4::boolean OR (v.revisado_em IS NULL AND v.procedencia <> 'folha'))
            AND (NOT $5::boolean OR v.conflito_camada IS NULL)
            AND ($6::text IS NULL OR v.descricao ILIKE '%' || $6 || '%')
          ORDER BY v.entra_no_total DESC,
                   COALESCE(v.valor_vigente_cents, v.valor_sugerido_cents, 0) DESC,
                   v.descricao`,
        [
          ENTIDADE,
          filtros.categoria ?? null,
          filtros.status ?? null,
          Boolean(filtros.aRevisar),
          Boolean(filtros.semConflito),
          filtros.busca ?? null
        ]
      ),
      query<Record<string, unknown>>(
        `SELECT k.* FROM fin_custo_fixo_categoria_v k
           JOIN fin_entity e ON e.id = k.entity_id AND e.slug = $1
          ORDER BY (k.subtotal_cents + k.a_revisar_cents + k.em_outra_camada_cents) DESC`,
        [ENTIDADE]
      ),
      query<Record<string, unknown>>(
        `SELECT * FROM fin_custo_fixo_parcelado_v ORDER BY termina_em DESC, parcela_cents DESC`
      ),
      query<Record<string, unknown>>(
        `SELECT v.* FROM fin_custo_fixo_vencimento_v v
           JOIN fin_entity e ON e.id = v.entity_id AND e.slug = $1
          ORDER BY v.dia_esperado, COALESCE(v.valor_cents, 0) DESC`,
        [ENTIDADE]
      ),
      query<Record<string, unknown>>(`SELECT * FROM fin_custo_fixo_resumo_v`)
    ]);

    const r = resumo[0] ?? {};

    const dado: CatalogoCustoFixo = {
      linhas: linhas.map(
        (l): LinhaCatalogo => ({
          recurringId: num(l.recurring_id),
          procedencia: String(l.procedencia) as ProcedenciaCatalogo,
          descricao: String(l.descricao),
          status: String(l.status) as StatusCatalogo,
          statusMotivo: txt(l.status_motivo),
          statusAlteradoEm: l.status_alterado_em ? String(l.status_alterado_em) : null,
          statusAlteradoPor: txt(l.status_alterado_por),
          confianca: txt(l.confianca),
          categoriaId: num(l.category_id),
          categoriaCode: txt(l.categoria_code),
          categoria: txt(l.categoria_nome),
          contraparteId: num(l.counterparty_id),
          contraparte: txt(l.contraparte_nome),
          nucleo: txt(l.nucleo),
          diaDoMes: num(l.day_of_month),
          cadencia: txt(l.cadence),
          naturezaCusto: (txt(l.natureza_custo) as NaturezaCusto) ?? null,
          valorVigenteCents: num(l.valor_vigente_cents),
          valorSugeridoCents: num(l.valor_sugerido_cents),
          divergenciaSugeridoCents: num(l.divergencia_sugerido_cents),
          criterio: (txt(l.criterio) as CriterioValor) ?? null,
          criterioMotivo: txt(l.criterio_motivo),
          criterioErroPct: num(l.criterio_erro_pct),
          valorIndeterminadoMotivo: txt(l.valor_indeterminado_motivo),
          ocorrencias: num(l.ocorrencias),
          spanMeses: num(l.span_meses),
          densidade: num(l.densidade),
          dispersao: num(l.dispersao),
          lancamentosPorMes: num(l.lancamentos_por_mes),
          primeiraCompetencia: dia(l.primeira_competencia),
          ultimaCompetencia: dia(l.ultima_competencia),
          mesesSemOcorrencia: num(l.meses_sem_ocorrencia),
          situacao: (txt(l.situacao) as SituacaoDeteccao) ?? null,
          situacaoMotivo: txt(l.situacao_motivo),
          medianaCents: num(l.mediana_cents),
          mediana3mCents: num(l.mediana_3m_cents),
          ultimoCents: num(l.ultimo_cents),
          ultimoComparavelCents: num(l.ultimo_comparavel_cents),
          modaCents: num(l.moda_cents),
          mediaCents: num(l.media_cents),
          revisadoEm: l.revisado_em ? String(l.revisado_em) : null,
          revisadoPor: txt(l.revisado_por),
          ajustes: Number(l.ajustes ?? 0),
          ultimoAjusteVigenteDe: dia(l.ultimo_ajuste_vigente_de),
          ultimoAjusteAntesCents: num(l.ultimo_ajuste_antes_cents),
          ultimoAjusteMotivo: txt(l.ultimo_ajuste_motivo),
          ultimoAjusteAutor: txt(l.ultimo_ajuste_autor),
          entraNoTotal: Boolean(l.entra_no_total),
          motivoForaDoTotal: txt(l.motivo_fora_do_total),
          conflitoCamada: txt(l.conflito_camada),
          conflitoMotivo: txt(l.conflito_motivo),
          alertaSobreposicao: txt(l.alerta_sobreposicao),
          chaveDedupe: String(l.chave_dedupe)
        })
      ),
      porCategoria: categorias.map(
        (k): CategoriaCatalogo => ({
          categoriaId: num(k.category_id),
          code: txt(k.categoria_code),
          nome: txt(k.categoria),
          kind: txt(k.categoria_kind),
          itens: Number(k.itens),
          ligados: Number(k.ligados),
          propostos: Number(k.propostos),
          candidatos: Number(k.candidatos),
          desligados: Number(k.desligados),
          comAlerta: Number(k.com_alerta),
          indeterminados: Number(k.indeterminados),
          subtotalCents: Number(k.subtotal_cents),
          aRevisarCents: Number(k.a_revisar_cents),
          emOutraCamadaCents: Number(k.em_outra_camada_cents)
        })
      ),
      parcelados: parcelados.map(
        (p): ParcelamentoAberto => ({
          planoId: Number(p.plano_id),
          descricao: String(p.descricao ?? "sem descrição"),
          categoriaCode: txt(p.categoria_code),
          categoria: txt(p.categoria),
          parcelasTotal: Number(p.parcelas_total),
          parcelasAbertas: Number(p.parcelas_abertas),
          parcelaCents: Number(p.parcela_cents),
          abertoCents: Number(p.aberto_cents ?? 0),
          comecaEm: dia(p.comeca_em),
          terminaEm: dia(p.termina_em),
          mesesRestantes: num(p.meses_restantes),
          ressalva: String(p.ressalva)
        })
      ),
      vencimentos: vencimentos.map(
        (v): Vencimento => ({
          itemId: num(v.item_id),
          competencia: dia(v.competencia) ?? "",
          descricao: String(v.descricao),
          categoriaCode: txt(v.categoria_code),
          categoria: txt(v.categoria),
          contraparte: txt(v.contraparte),
          diaEsperado: dia(v.dia_esperado) ?? "",
          diaRegra: txt(v.dia_regra),
          valorCents: num(v.valor_cents),
          diasParaVencer: Number(v.dias_para_vencer),
          urgencia: String(v.urgencia) as Vencimento["urgencia"],
          confirmado: Boolean(v.confirmado),
          confirmadoPor: txt(v.confirmado_por),
          oQueFalta: String(v.o_que_falta),
          alertaSobreposicao: txt(v.alerta_sobreposicao),
          chaveDedupe: String(v.chave_dedupe)
        })
      ),
      resumo: {
        totalLigadoCents: Number(r.total_ligado_cents ?? 0),
        totalLigadoMotivo: txt(r.total_ligado_motivo),
        itensLigados: Number(r.itens_ligados ?? 0),
        itensPropostos: Number(r.itens_propostos ?? 0),
        itensCandidatos: Number(r.itens_candidatos ?? 0),
        itensDesligados: Number(r.itens_desligados ?? 0),
        itensComAlerta: Number(r.itens_com_alerta ?? 0),
        itensIndeterminados: Number(r.itens_indeterminados ?? 0),
        itensNuncaRevisados: Number(r.itens_nunca_revisados ?? 0),
        totalDetectadoCents: Number(r.total_detectado_cents ?? 0),
        detectadoTerceirosCents: Number(r.detectado_terceiros_cents ?? 0),
        detectadoFolhaCents: Number(r.detectado_folha_cents ?? 0),
        detectadoDasCents: Number(r.detectado_das_cents ?? 0),
        detectadoDocumentoCents: Number(r.detectado_documento_cents ?? 0),
        detectadoSemValor: Number(r.detectado_sem_valor ?? 0),
        gruposDetectados: Number(r.grupos_detectados ?? 0),
        parceladoMesCorrenteCents: Number(r.parcelado_mes_corrente_cents ?? 0),
        parceladoAbertoCents: Number(r.parcelado_aberto_cents ?? 0),
        parcelamentosAbertos: Number(r.parcelamentos_abertos ?? 0),
        parceladoTerminaEm: dia(r.parcelado_termina_em),
        reembolsoEstimadoCents: Number(r.reembolso_estimado_cents ?? 0)
      }
    };

    return contrato({
      dominio: DOMINIO,
      dado,
      ressalvas: [
        "Some apenas as linhas com entraNoTotal. As demais existem e NÃO somam — cada uma diz por quê em motivoForaDoTotal.",
        "totalLigadoCents é decisão (previsão que entra no saldo); totalDetectadoCents é medida do passado. Somar os dois conta o mesmo dinheiro duas vezes.",
        "O reembolso aparece no catálogo e NÃO soma: ele já está dentro da folha, pago no mês seguinte junto do fixo e classificado como salário.",
        "Parcelamento acaba: fin_custo_fixo_parcelado_v carrega a data de término declarada pela fonte, e nenhuma parcela entra no total de custo fixo.",
        "valorSugeridoCents null vem sempre com valorIndeterminadoMotivo — um número plausível ali seria pior que o vazio."
      ]
    });
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    console.error("[contrato:custo-fixo]", mensagem);
    return contratoIndisponivel(DOMINIO, VAZIO, mensagem);
  }
}

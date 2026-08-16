import "server-only";

import { isFinanceConfigured, query } from "../db";
import {
  Condicoes,
  contrato,
  contratoIndisponivel,
  ENTIDADE,
  frescorDeData,
  frescorIndisponivel,
  montarPagina,
  normalizarPaginacao,
  ordenarPor,
  type Contrato,
  type Drill,
  type Frescor,
  type Ordenacao,
  type Pagina,
  type Paginacao,
  type Pendencia
} from "./base";

/**
 * Contratos da operação de saída: pedido de compra, fila de pagamento, lote.
 *
 * ATENÇÃO A QUEM FOR IMPLEMENTAR A TELA
 *
 * Nada neste arquivo paga. Não existe, e não pode passar a existir, função que
 * chame API bancária. O produto prepara, valida, aprova, loteia e audita; a
 * autorização junto ao banco é humana e acontece fora do sistema. Se um dia
 * aparecer aqui um `executarPagamento()`, é bug de design, não recurso novo.
 *
 * O que a tela de decisão precisa, e por isso o contrato entrega junto:
 *
 *   · a EVIDÊNCIA ao lado da escolha — pendências, duplicidades, favorecido
 *     anterior e valor histórico chegam na mesma consulta que a linha, para
 *     que aprovar não seja um clique cego;
 *   · DECISÃO EM LOTE — os tipos de payload assumem `ids[]`, nunca id único;
 *   · QUEM DECIDIU — toda decisão carrega autor obrigatório e motivo.
 */

const DOMINIO = "pagamentos";

// ---------------------------------------------------------------------------
// Tipos de leitura
// ---------------------------------------------------------------------------

export type StatusPagamento =
  | "rascunho"
  | "em_aprovacao"
  | "aprovada"
  | "em_lote"
  | "aguardando_autorizacao"
  | "pago_parcial"
  | "pago"
  | "rejeitada"
  | "cancelada"
  | "devolvida";

export type Prioridade = "critica" | "alta" | "normal" | "baixa";

export type ItemFilaPagamento = {
  id: number;
  code: string;
  status: StatusPagamento;
  prioridade: Prioridade;
  descricao: string;
  vencimento: string;
  agendadoPara: string | null;
  diasAteVencer: number;
  valorCents: number;
  liquidoCents: number;
  pagoCents: number;
  saldoCents: number;
  beneficiario: string;
  beneficiarioId: number;
  documentoBeneficiario: string | null;
  contaBeneficiario: string | null;
  categoria: string | null;
  categoriaCode: string | null;
  nucleo: string | null;
  centroCusto: string | null;
  contaPagadora: string | null;
  alcada: string | null;
  niveisExigidos: number;
  niveisAssinados: number;
  alcadaCompleta: boolean;
  lote: string | null;
  solicitadoPor: string;
  solicitadoEm: string;
  /** O resumo dos alertas. O detalhe vem em `getSolicitacao`. */
  sinais: SinaisDoItem;
};

/**
 * Os sinais de risco, já resolvidos, para a linha da lista.
 *
 * A tela não deve recalcular nada: se ela precisar consultar de novo para saber
 * se pode aprovar, a lista e o detalhe divergem no exato momento em que alguém
 * está decidindo.
 */
export type SinaisDoItem = {
  bloqueantes: number;
  alertas: number;
  duplicidades: number;
  favorecidoAlterado: boolean;
  documentoDivergente: boolean;
  /** null quando o histórico tem menos de 3 ocorrências — sem base é sem alerta. */
  valorVersusHistorico: "acima" | "abaixo" | "normal" | null;
  medianaHistoricaCents: number | null;
  ocorrenciasHistoricas: number | null;
  /** Resumo pronto: pode ir para o lote? */
  podeAprovar: boolean;
};

export type FiltrosFilaPagamento = {
  status?: StatusPagamento[];
  prioridade?: Prioridade[];
  beneficiario?: number;
  categoria?: string;
  nucleo?: string;
  centroCusto?: string;
  contaPagadora?: string;
  lote?: number;
  vencimentoDe?: string;
  vencimentoAte?: string;
  valorMinCents?: number;
  valorMaxCents?: number;
  busca?: string;
  /** Só o que tem pendência bloqueante — a fila de quem vai destravar. */
  apenasBloqueados?: boolean;
  /** Só o que já pode entrar em lote. */
  apenasProntos?: boolean;
  /** Só o que tem algum sinal de risco. */
  apenasComSinal?: boolean;
};

export type CampoOrdenacaoPagamento =
  | "vencimento"
  | "valor"
  | "beneficiario"
  | "status"
  | "prioridade"
  | "solicitadoEm"
  | "risco";

const COLUNAS_ORDENACAO: Record<CampoOrdenacaoPagamento, string> = {
  vencimento: "f.due_date",
  valor: "f.net_cents",
  beneficiario: "f.beneficiario",
  status: "f.status",
  // A ordem de prioridade é semântica, não alfabética: 'critica' < 'alta' em
  // texto ordenaria a urgência ao contrário.
  prioridade: "CASE f.priority WHEN 'critica' THEN 0 WHEN 'alta' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END",
  solicitadoEm: "f.requested_at",
  risco: "(f.pendencias_bloqueantes * 10 + f.duplicidades + CASE WHEN f.favorecido_alterado THEN 5 ELSE 0 END)"
};

// ---------------------------------------------------------------------------
// Fila de pagamento
// ---------------------------------------------------------------------------

const PAGINA_VAZIA: Pagina<ItemFilaPagamento> = {
  itens: [],
  total: 0,
  pagina: 1,
  porPagina: 50,
  paginas: 1,
  temMais: false,
  ordenacao: { campo: "vencimento", direcao: "asc" },
  vazio: { causa: "sem_dado_na_fonte", motivo: "a fila de pagamento ainda não existe", acao: null }
};

export async function getFilaPagamento(
  filtros: FiltrosFilaPagamento = {},
  paginacao: Paginacao = {},
  ordem?: Ordenacao<CampoOrdenacaoPagamento>
): Promise<Contrato<Pagina<ItemFilaPagamento>>> {
  if (!isFinanceConfigured()) {
    return contratoIndisponivel(DOMINIO, PAGINA_VAZIA, "banco financeiro não configurado");
  }

  const { pagina, porPagina, offset } = normalizarPaginacao(paginacao);
  const ordenacao = ordenarPor(ordem, COLUNAS_ORDENACAO, { campo: "vencimento", direcao: "asc" });

  const cond = new Condicoes(["e.slug = $1"], [ENTIDADE]);
  if (filtros.status?.length) cond.add("f.status = ANY($?)", filtros.status);
  if (filtros.prioridade?.length) cond.add("f.priority = ANY($?)", filtros.prioridade);
  cond.add("f.counterparty_id = $?", filtros.beneficiario);
  cond.add("f.categoria_code = $?", filtros.categoria);
  cond.add("f.nucleo = $?", filtros.nucleo);
  cond.add("f.cost_center_id = (SELECT id FROM fin_cost_center WHERE slug = $?)", filtros.centroCusto);
  cond.add("f.from_account_id = (SELECT id FROM fin_account WHERE slug = $?)", filtros.contaPagadora);
  cond.add("f.batch_id = $?", filtros.lote);
  cond.add("f.due_date >= $?", filtros.vencimentoDe);
  cond.add("f.due_date <= $?", filtros.vencimentoAte);
  cond.add("f.net_cents >= $?", filtros.valorMinCents);
  cond.add("f.net_cents <= $?", filtros.valorMaxCents);
  cond.add("f.code ILIKE '%' || $? || '%' OR f.description ILIKE '%' || $? || '%' OR f.beneficiario ILIKE '%' || $? || '%'", filtros.busca);
  if (filtros.apenasBloqueados) cond.raw("f.pendencias_bloqueantes > 0");
  if (filtros.apenasProntos) cond.raw("f.pendencias_bloqueantes = 0 AND f.alcada_completa");
  if (filtros.apenasComSinal) {
    cond.raw(
      "(f.duplicidades > 0 OR f.favorecido_alterado OR f.documento_divergente OR f.valor_versus_historico IN ('acima','abaixo'))"
    );
  }

  try {
    const limite = cond.proximo(porPagina);
    const salto = cond.proximo(offset);

    const [linhas, totais, alcadas] = await Promise.all([
      query<LinhaFila>(
        `SELECT f.*, count(*) OVER () AS total_linhas
           FROM fin_pagamento_fila_v f
           JOIN fin_entity e ON e.id = f.entity_id
          WHERE ${cond.where}
          ORDER BY ${ordenacao.sql}, f.id
          LIMIT ${limite} OFFSET ${salto}`,
        cond.params
      ),
      query<{ na_fila: number; na_fila_cents: string; ultima: string | null; solicitacoes: number }>(
        `SELECT na_fila, na_fila_cents::text, to_char(ultima_solicitacao_em, 'YYYY-MM-DD') AS ultima, solicitacoes
           FROM fin_pagamento_cobertura_v`
      ),
      query<{ n: number }>(`SELECT count(*)::int AS n FROM fin_approval_rule WHERE is_active`)
    ]);

    const total = linhas.length ? Number(linhas[0].total_linhas) : 0;
    const itens = linhas.map(mapearItem);

    const pendencias = await pendenciasDaOperacao(Number(alcadas[0]?.n ?? 0));

    return contrato({
      dominio: DOMINIO,
      dado: montarPagina({
        itens,
        total,
        pagina,
        porPagina,
        ordenacao: ordenacao.aplicada,
        vazio:
          Number(totais[0]?.solicitacoes ?? 0) === 0
            ? {
                causa: "sem_dado_na_fonte",
                motivo: "nenhuma solicitação de pagamento foi registrada ainda",
                acao: "crie a primeira a partir de um pedido de compra, de uma conta a pagar ou do zero"
              }
            : null
      }),
      cobertura: [frescorDaFila(totais[0]?.ultima ?? null, Number(alcadas[0]?.n ?? 0))],
      pendencias,
      ressalvas: [
        "A fila é uma afirmação sobre o futuro: nada aqui entrou no caixa. O caixa só muda quando o extrato trouxer a saída.",
        "Nenhuma função deste módulo executa pagamento. A autorização junto ao banco é humana e acontece fora do sistema."
      ]
    });
  } catch (error) {
    return trataAusencia(DOMINIO, PAGINA_VAZIA, error);
  }
}

type LinhaFila = {
  id: number;
  code: string;
  status: StatusPagamento;
  priority: Prioridade;
  description: string;
  due_date: string;
  scheduled_for: string | null;
  dias_ate_vencer: number;
  amount_cents: string;
  net_cents: string;
  paid_cents: string;
  saldo_cents: string;
  counterparty_id: number;
  beneficiario: string;
  documento_beneficiario: string | null;
  conta_beneficiario: string | null;
  categoria: string | null;
  categoria_code: string | null;
  nucleo: string | null;
  centro_custo: string | null;
  conta_pagadora: string | null;
  alcada: string | null;
  niveis_exigidos: number;
  niveis_assinados: number;
  alcada_completa: boolean;
  lote: string | null;
  requested_by: string;
  requested_at: string;
  pendencias_bloqueantes: string;
  pendencias_alerta: string;
  duplicidades: string;
  favorecido_alterado: boolean | null;
  documento_divergente: boolean | null;
  valor_versus_historico: "acima" | "abaixo" | "normal" | null;
  mediana_historica_cents: string | null;
  ocorrencias_historicas: string | null;
  total_linhas: string;
};

function mapearItem(linha: LinhaFila): ItemFilaPagamento {
  const bloqueantes = Number(linha.pendencias_bloqueantes ?? 0);
  return {
    id: linha.id,
    code: linha.code,
    status: linha.status,
    prioridade: linha.priority,
    descricao: linha.description,
    vencimento: String(linha.due_date).slice(0, 10),
    agendadoPara: linha.scheduled_for ? String(linha.scheduled_for).slice(0, 10) : null,
    diasAteVencer: Number(linha.dias_ate_vencer),
    valorCents: Number(linha.amount_cents),
    liquidoCents: Number(linha.net_cents),
    pagoCents: Number(linha.paid_cents),
    saldoCents: Number(linha.saldo_cents),
    beneficiario: linha.beneficiario,
    beneficiarioId: linha.counterparty_id,
    documentoBeneficiario: linha.documento_beneficiario,
    contaBeneficiario: linha.conta_beneficiario,
    categoria: linha.categoria,
    categoriaCode: linha.categoria_code,
    nucleo: linha.nucleo,
    centroCusto: linha.centro_custo,
    contaPagadora: linha.conta_pagadora,
    alcada: linha.alcada,
    niveisExigidos: Number(linha.niveis_exigidos ?? 0),
    niveisAssinados: Number(linha.niveis_assinados ?? 0),
    alcadaCompleta: Boolean(linha.alcada_completa),
    lote: linha.lote,
    solicitadoPor: linha.requested_by,
    solicitadoEm: linha.requested_at,
    sinais: {
      bloqueantes,
      alertas: Number(linha.pendencias_alerta ?? 0),
      duplicidades: Number(linha.duplicidades ?? 0),
      favorecidoAlterado: Boolean(linha.favorecido_alterado),
      documentoDivergente: Boolean(linha.documento_divergente),
      valorVersusHistorico: linha.valor_versus_historico,
      medianaHistoricaCents: linha.mediana_historica_cents === null ? null : Number(linha.mediana_historica_cents),
      ocorrenciasHistoricas: linha.ocorrencias_historicas === null ? null : Number(linha.ocorrencias_historicas),
      // "Pode aprovar" é a soma de duas coisas independentes: não há pendência
      // bloqueante E existe régua de alçada casando. Faltar a régua não é
      // permissão, é ausência de política.
      podeAprovar: bloqueantes === 0 && Boolean(linha.alcada)
    }
  };
}

// ---------------------------------------------------------------------------
// Detalhe: a tela de decisão de uma solicitação
// ---------------------------------------------------------------------------

export type EvidenciaDuplicidade = {
  contra: "fila" | "extrato";
  outroId: number;
  referencia: string;
  data: string;
  valorCents: number;
  diasEntre: number;
  temRecorrenteDeclarada: boolean;
};

export type EvidenciaFavorecido = {
  fingerprintAtual: string | null;
  fingerprintAnterior: string | null;
  ultimoPagamentoRef: string | null;
  ultimoPagamentoData: string | null;
  alterado: boolean;
  documentoDivergente: boolean;
  titularDaConta: string | null;
  documentoDoTitular: string | null;
  documentoDoBeneficiario: string | null;
};

export type Assinatura = {
  nivel: number;
  decisao: "aprovado" | "rejeitado" | "devolvido";
  aprovador: string;
  decididoEm: string;
  motivo: string | null;
  valorNaDecisaoCents: number;
  superadaEm: string | null;
  superadaMotivo: string | null;
};

export type Anexo = {
  id: number;
  tipo: string;
  nomeArquivo: string | null;
  notaFiscalId: number | null;
  url: string | null;
  enviadoPor: string;
  enviadoEm: string;
};

export type ExecucaoRegistrada = {
  id: number;
  pagoEm: string;
  valorCents: number;
  metodo: string | null;
  contaSlug: string | null;
  endToEndId: string | null;
  transacaoId: number | null;
  conciliadoEm: string | null;
  registradoPor: string;
};

export type PendenciaSolicitacao = {
  chave: string;
  severidade: "bloqueante" | "alerta" | "informativo";
  motivo: string;
};

export type DetalheSolicitacao = {
  item: ItemFilaPagamento | null;
  pendencias: PendenciaSolicitacao[];
  duplicidades: EvidenciaDuplicidade[];
  favorecido: EvidenciaFavorecido | null;
  assinaturas: Assinatura[];
  anexos: Anexo[];
  execucoes: ExecucaoRegistrada[];
  /** Histórico de alterações desta solicitação, vindo de fin_audit_log. */
  historico: { em: string; acao: string; ator: string; campos: string[] }[];
  /** Quem pode assinar o próximo nível, segundo a régua congelada. */
  proximosAprovadores: string[];
  drillBeneficiario: Drill | null;
};

const DETALHE_VAZIO: DetalheSolicitacao = {
  item: null,
  pendencias: [],
  duplicidades: [],
  favorecido: null,
  assinaturas: [],
  anexos: [],
  execucoes: [],
  historico: [],
  proximosAprovadores: [],
  drillBeneficiario: null
};

export async function getSolicitacao(id: number): Promise<Contrato<DetalheSolicitacao>> {
  if (!isFinanceConfigured()) {
    return contratoIndisponivel(DOMINIO, DETALHE_VAZIO, "banco financeiro não configurado");
  }
  try {
    const [linhas, pend, dup, fav, assin, anex, exec, hist, alc] = await Promise.all([
      query<LinhaFila>(`SELECT f.*, 1 AS total_linhas FROM fin_pagamento_fila_v f WHERE f.id = $1`, [id]),
      query<{ pendencia: string; severidade: PendenciaSolicitacao["severidade"]; motivo: string }>(
        `SELECT pendencia, severidade, motivo FROM fin_pagamento_pendencia_v WHERE payment_request_id = $1
          ORDER BY CASE severidade WHEN 'bloqueante' THEN 0 WHEN 'alerta' THEN 1 ELSE 2 END, pendencia`,
        [id]
      ),
      query<{
        contra: "fila" | "extrato";
        outro_id: number;
        outro_ref: string;
        outra_data: string;
        outro_cents: string;
        dias_entre: number;
        tem_recorrente_declarada: boolean;
      }>(
        `SELECT contra, outro_id, outro_ref, outra_data, outro_cents::text, dias_entre, tem_recorrente_declarada
           FROM fin_pagamento_duplicidade_v WHERE payment_request_id = $1 ORDER BY dias_entre`,
        [id]
      ),
      query<{
        payee_fingerprint: string | null;
        fingerprint_anterior: string | null;
        ultimo_pagamento_ref: string | null;
        ultimo_pagamento_data: string | null;
        favorecido_alterado: boolean | null;
        documento_divergente: boolean | null;
        owner_name: string | null;
        owner_document: string | null;
        documento_beneficiario: string | null;
      }>(`SELECT * FROM fin_pagamento_favorecido_v WHERE payment_request_id = $1`, [id]),
      query<{
        level: number;
        decision: Assinatura["decisao"];
        approver: string;
        decided_at: string;
        reason: string | null;
        amount_at_decision_cents: string;
        superseded_at: string | null;
        superseded_reason: string | null;
      }>(
        `SELECT level, decision, approver, decided_at, reason, amount_at_decision_cents::text,
                superseded_at, superseded_reason
           FROM fin_payment_approval WHERE payment_request_id = $1 ORDER BY level, decided_at`,
        [id]
      ),
      query<{
        id: number;
        kind: string;
        file_name: string | null;
        fiscal_document_id: number | null;
        external_url: string | null;
        uploaded_by: string;
        uploaded_at: string;
      }>(
        `SELECT id, kind, file_name, fiscal_document_id, external_url, uploaded_by, uploaded_at
           FROM fin_payment_attachment
          WHERE target_table = 'fin_payment_request' AND target_id = $1 ORDER BY uploaded_at`,
        [id]
      ),
      query<{
        id: number;
        paid_on: string;
        amount_cents: string;
        method: string | null;
        conta: string | null;
        end_to_end_id: string | null;
        transaction_id: number | null;
        reconciled_at: string | null;
        registered_by: string;
      }>(
        `SELECT ex.id, ex.paid_on, ex.amount_cents::text, ex.method, a.slug AS conta,
                ex.end_to_end_id, ex.transaction_id, ex.reconciled_at, ex.registered_by
           FROM fin_payment_execution ex
           LEFT JOIN fin_account a ON a.id = ex.from_account_id
          WHERE ex.payment_request_id = $1 ORDER BY ex.paid_on`,
        [id]
      ),
      query<{ created_at: string; action: string; actor: string; fields: string[] | null }>(
        `SELECT created_at, action, actor, fields FROM fin_audit_log
          WHERE target_table = 'fin_payment_request' AND target_id = $1
          ORDER BY created_at DESC LIMIT 200`,
        [id]
      ),
      query<{ aprovadores_nivel1: string[]; aprovadores_nivel2: string[]; aprovadores_nivel3: string[] }>(
        `SELECT aprovadores_nivel1, aprovadores_nivel2, aprovadores_nivel3
           FROM fin_alcada_aplicavel_v WHERE payment_request_id = $1`,
        [id]
      )
    ]);

    const item = linhas[0] ? mapearItem(linhas[0]) : null;
    const nivelAlvo = (item?.niveisAssinados ?? 0) + 1;
    const regra = alc[0];
    const proximos =
      nivelAlvo === 1 ? regra?.aprovadores_nivel1 : nivelAlvo === 2 ? regra?.aprovadores_nivel2 : regra?.aprovadores_nivel3;

    const f = fav[0];

    return contrato({
      dominio: `${DOMINIO}.solicitacao`,
      dado: {
        item,
        pendencias: pend.map((p) => ({ chave: p.pendencia, severidade: p.severidade, motivo: p.motivo })),
        duplicidades: dup.map((d) => ({
          contra: d.contra,
          outroId: d.outro_id,
          referencia: d.outro_ref,
          data: String(d.outra_data).slice(0, 10),
          valorCents: Number(d.outro_cents),
          diasEntre: Number(d.dias_entre),
          temRecorrenteDeclarada: Boolean(d.tem_recorrente_declarada)
        })),
        favorecido: f
          ? {
              fingerprintAtual: f.payee_fingerprint,
              fingerprintAnterior: f.fingerprint_anterior,
              ultimoPagamentoRef: f.ultimo_pagamento_ref,
              ultimoPagamentoData: f.ultimo_pagamento_data ? String(f.ultimo_pagamento_data).slice(0, 10) : null,
              alterado: Boolean(f.favorecido_alterado),
              documentoDivergente: Boolean(f.documento_divergente),
              titularDaConta: f.owner_name,
              documentoDoTitular: f.owner_document,
              documentoDoBeneficiario: f.documento_beneficiario
            }
          : null,
        assinaturas: assin.map((a) => ({
          nivel: a.level,
          decisao: a.decision,
          aprovador: a.approver,
          decididoEm: a.decided_at,
          motivo: a.reason,
          valorNaDecisaoCents: Number(a.amount_at_decision_cents),
          superadaEm: a.superseded_at,
          superadaMotivo: a.superseded_reason
        })),
        anexos: anex.map((a) => ({
          id: a.id,
          tipo: a.kind,
          nomeArquivo: a.file_name,
          notaFiscalId: a.fiscal_document_id,
          url: a.external_url,
          enviadoPor: a.uploaded_by,
          enviadoEm: a.uploaded_at
        })),
        execucoes: exec.map((e) => ({
          id: e.id,
          pagoEm: String(e.paid_on).slice(0, 10),
          valorCents: Number(e.amount_cents),
          metodo: e.method,
          contaSlug: e.conta,
          endToEndId: e.end_to_end_id,
          transacaoId: e.transaction_id,
          conciliadoEm: e.reconciled_at,
          registradoPor: e.registered_by
        })),
        historico: hist.map((h) => ({
          em: h.created_at,
          acao: h.action,
          ator: h.actor,
          campos: h.fields ?? []
        })),
        proximosAprovadores: proximos ?? [],
        drillBeneficiario: item ? { dominio: "lancamentos", filtros: { contraparte: item.beneficiarioId } } : null
      },
      ressalvas: [
        "Aprovar aqui não paga. Após a alçada completa, o pagamento entra em lote e alguém digita no banco.",
        "Duplicidade contra recorrente declarada costuma ser falso positivo — o campo temRecorrenteDeclarada diz quando."
      ]
    });
  } catch (error) {
    return trataAusencia(`${DOMINIO}.solicitacao`, DETALHE_VAZIO, error);
  }
}

// ---------------------------------------------------------------------------
// Pedido de compra
// ---------------------------------------------------------------------------

export type ItemFilaCompra = {
  id: number;
  code: string;
  status: string;
  prioridade: Prioridade;
  titulo: string;
  descricao: string | null;
  justificativa: string | null;
  valorCents: number;
  baseDoValor: string;
  cotacoes: number;
  precisaAte: string | null;
  diasAtePrecisar: number | null;
  fornecedorSugerido: string | null;
  categoria: string | null;
  centroCusto: string | null;
  orcamentoMetaCents: number | null;
  orcamentoDisponivelCents: number | null;
  /** null quando o orçamento daquela linha é indeterminado — e não "não estoura". */
  estouraOrcamento: boolean | null;
  anexos: number;
  pagamentosGerados: number;
  solicitadoPor: string;
  solicitadoEm: string;
  decididoPor: string | null;
  decididoEm: string | null;
};

export type FiltrosCompra = {
  status?: string[];
  prioridade?: Prioridade[];
  centroCusto?: string;
  busca?: string;
  apenasSemDecisao?: boolean;
};

const PAGINA_COMPRA_VAZIA: Pagina<ItemFilaCompra> = { ...PAGINA_VAZIA, itens: [] } as unknown as Pagina<ItemFilaCompra>;

export async function getFilaCompra(
  filtros: FiltrosCompra = {},
  paginacao: Paginacao = {}
): Promise<Contrato<Pagina<ItemFilaCompra>>> {
  if (!isFinanceConfigured()) {
    return contratoIndisponivel(`${DOMINIO}.compra`, PAGINA_COMPRA_VAZIA, "banco financeiro não configurado");
  }
  const { pagina, porPagina, offset } = normalizarPaginacao(paginacao);
  const cond = new Condicoes(["e.slug = $1"], [ENTIDADE]);
  if (filtros.status?.length) cond.add("c.status = ANY($?)", filtros.status);
  if (filtros.prioridade?.length) cond.add("c.priority = ANY($?)", filtros.prioridade);
  cond.add("c.cost_center_id = (SELECT id FROM fin_cost_center WHERE slug = $?)", filtros.centroCusto);
  cond.add("(c.title ILIKE '%' || $? || '%' OR c.code ILIKE '%' || $? || '%')", filtros.busca);
  if (filtros.apenasSemDecisao) cond.raw("c.decided_at IS NULL AND c.status IN ('enviada','em_cotacao')");

  try {
    const limite = cond.proximo(porPagina);
    const salto = cond.proximo(offset);
    const linhas = await query<Record<string, unknown>>(
      `SELECT c.*, count(*) OVER () AS total_linhas
         FROM fin_compra_fila_v c
         JOIN fin_entity e ON e.id = c.entity_id
        WHERE ${cond.where}
        ORDER BY CASE c.priority WHEN 'critica' THEN 0 WHEN 'alta' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
                 c.needed_by NULLS LAST, c.id
        LIMIT ${limite} OFFSET ${salto}`,
      cond.params
    );

    const total = linhas.length ? Number(linhas[0].total_linhas) : 0;
    const itens: ItemFilaCompra[] = linhas.map((l) => ({
      id: Number(l.id),
      code: String(l.code),
      status: String(l.status),
      prioridade: l.priority as Prioridade,
      titulo: String(l.title),
      descricao: (l.description as string) ?? null,
      justificativa: (l.justification as string) ?? null,
      valorCents: Number(l.amount_cents),
      baseDoValor: String(l.amount_basis),
      cotacoes: Number(l.quotes_count ?? 0),
      precisaAte: l.needed_by ? String(l.needed_by).slice(0, 10) : null,
      diasAtePrecisar: l.dias_ate_precisar === null ? null : Number(l.dias_ate_precisar),
      fornecedorSugerido: (l.fornecedor_sugerido as string) ?? null,
      categoria: (l.categoria as string) ?? null,
      centroCusto: (l.centro_custo as string) ?? null,
      orcamentoMetaCents: l.orcamento_meta_cents === null ? null : Number(l.orcamento_meta_cents),
      orcamentoDisponivelCents:
        l.orcamento_disponivel_cents === null || l.orcamento_disponivel_cents === undefined
          ? null
          : Number(l.orcamento_disponivel_cents),
      // Sem orçamento apurado a resposta é "não sei", não "não estoura".
      estouraOrcamento:
        l.orcamento_disponivel_cents === null || l.orcamento_disponivel_cents === undefined
          ? null
          : Boolean(l.estoura_orcamento),
      anexos: Number(l.anexos ?? 0),
      pagamentosGerados: Number(l.pagamentos_gerados ?? 0),
      solicitadoPor: String(l.requested_by),
      solicitadoEm: String(l.requested_at),
      decididoPor: (l.decided_by as string) ?? null,
      decididoEm: (l.decided_at as string) ?? null
    }));

    return contrato({
      dominio: `${DOMINIO}.compra`,
      dado: montarPagina({ itens, total, pagina, porPagina, ordenacao: { campo: "prioridade", direcao: "asc" } }),
      ressalvas: [
        "Pedido de compra não é compromisso de caixa. Só vira saída quando um pagamento nasce dele — somar os dois conta duas vezes."
      ]
    });
  } catch (error) {
    return trataAusencia(`${DOMINIO}.compra`, PAGINA_COMPRA_VAZIA, error);
  }
}

// ---------------------------------------------------------------------------
// Lotes
// ---------------------------------------------------------------------------

export type Lote = {
  id: number;
  code: string;
  rotulo: string | null;
  status: string;
  agendadoPara: string;
  contaPagadora: string | null;
  saldoContaCents: number | null;
  itens: number;
  totalCents: number;
  pagoCents: number;
  saldoCents: number;
  exportadoEm: string | null;
  exportadoPor: string | null;
  autorizadoForaDoSistema: boolean;
  autorizadoPor: string | null;
  autorizadoEm: string | null;
  itensComBloqueio: number;
  itensSemAlcadaCompleta: number;
  /** O lote cabe no saldo da conta pagadora no dia agendado? */
  cabeNoSaldo: boolean | null;
};

export async function getLotes(paginacao: Paginacao = {}): Promise<Contrato<Pagina<Lote>>> {
  const vazio = { ...PAGINA_VAZIA, itens: [] } as unknown as Pagina<Lote>;
  if (!isFinanceConfigured()) return contratoIndisponivel(`${DOMINIO}.lotes`, vazio, "banco financeiro não configurado");
  const { pagina, porPagina, offset } = normalizarPaginacao(paginacao);
  try {
    const linhas = await query<Record<string, unknown>>(
      `SELECT l.*, count(*) OVER () AS total_linhas
         FROM fin_pagamento_lote_v l
         JOIN fin_entity e ON e.id = l.entity_id
        WHERE e.slug = $1
        ORDER BY l.scheduled_for DESC, l.id DESC
        LIMIT $2 OFFSET $3`,
      [ENTIDADE, porPagina, offset]
    );
    const total = linhas.length ? Number(linhas[0].total_linhas) : 0;
    const itens: Lote[] = linhas.map((l) => {
      const saldo = l.saldo_conta_cents === null || l.saldo_conta_cents === undefined ? null : Number(l.saldo_conta_cents);
      const totalCents = Number(l.total_cents ?? 0);
      return {
        id: Number(l.id),
        code: String(l.code),
        rotulo: (l.label as string) ?? null,
        status: String(l.status),
        agendadoPara: String(l.scheduled_for).slice(0, 10),
        contaPagadora: (l.conta_pagadora as string) ?? null,
        saldoContaCents: saldo,
        itens: Number(l.item_count ?? 0),
        totalCents,
        pagoCents: Number(l.paid_cents ?? 0),
        saldoCents: Number(l.saldo_cents ?? 0),
        exportadoEm: (l.exported_at as string) ?? null,
        exportadoPor: (l.exported_by as string) ?? null,
        autorizadoForaDoSistema: Boolean(l.authorized_outside_system),
        autorizadoPor: (l.authorized_by as string) ?? null,
        autorizadoEm: (l.authorized_at as string) ?? null,
        itensComBloqueio: Number(l.itens_com_bloqueio ?? 0),
        itensSemAlcadaCompleta: Number(l.itens_sem_alcada_completa ?? 0),
        // Saldo atual, não previsto para o dia: a previsão é outra camada e
        // misturá-la aqui daria falsa segurança. A tela deve dizer isso.
        cabeNoSaldo: saldo === null ? null : saldo >= totalCents
      };
    });
    return contrato({
      dominio: `${DOMINIO}.lotes`,
      dado: montarPagina({ itens, total, pagina, porPagina, ordenacao: { campo: "agendadoPara", direcao: "desc" } }),
      ressalvas: [
        "'exportado' significa que a lista saiu para conferência humana — nunca que foi transmitida ao banco.",
        "cabeNoSaldo compara com o saldo ATUAL da conta, não com o previsto para o dia do lote."
      ]
    });
  } catch (error) {
    return trataAusencia(`${DOMINIO}.lotes`, vazio, error);
  }
}

// ---------------------------------------------------------------------------
// Alçadas
// ---------------------------------------------------------------------------

export type Alcada = {
  id: number;
  slug: string;
  nome: string;
  aplicaA: string;
  ordem: number;
  minCents: number;
  maxCents: number | null;
  niveisExigidos: number;
  aprovadores: string[][];
  permiteAutoaprovacao: boolean;
  exigeDocumento: boolean;
  exigeContaBancaria: boolean;
  exigeCentroCusto: boolean;
  tetoPorTransacaoCents: number | null;
  ativa: boolean;
};

export async function getAlcadas(): Promise<Contrato<Alcada[]>> {
  if (!isFinanceConfigured()) return contratoIndisponivel(`${DOMINIO}.alcadas`, [], "banco financeiro não configurado");
  try {
    const linhas = await query<Record<string, unknown>>(
      `SELECT r.* FROM fin_approval_rule r JOIN fin_entity e ON e.id = r.entity_id
        WHERE e.slug = $1 ORDER BY r.ordem, r.id`,
      [ENTIDADE]
    );
    const itens: Alcada[] = linhas.map((r) => ({
      id: Number(r.id),
      slug: String(r.slug),
      nome: String(r.name),
      aplicaA: String(r.aplica_a),
      ordem: Number(r.ordem),
      minCents: Number(r.min_cents),
      maxCents: r.max_cents === null ? null : Number(r.max_cents),
      niveisExigidos: Number(r.niveis_exigidos),
      aprovadores: [
        (r.aprovadores_nivel1 as string[]) ?? [],
        (r.aprovadores_nivel2 as string[]) ?? [],
        (r.aprovadores_nivel3 as string[]) ?? []
      ],
      permiteAutoaprovacao: Boolean(r.permite_autoaprovacao),
      exigeDocumento: Boolean(r.exige_documento),
      exigeContaBancaria: Boolean(r.exige_conta_bancaria),
      exigeCentroCusto: Boolean(r.exige_centro_custo),
      tetoPorTransacaoCents: r.teto_por_transacao_cents === null ? null : Number(r.teto_por_transacao_cents),
      ativa: Boolean(r.is_active)
    }));
    return contrato({
      dominio: `${DOMINIO}.alcadas`,
      dado: itens,
      pendencias: itens.length
        ? []
        : [
            {
              chave: "alcada_nao_declarada",
              titulo: "Nenhuma alçada declarada — nada pode ser aprovado",
              quantidade: 1,
              valorCents: null,
              severidade: "bloqueante",
              telaDeDecisao: "/financeiro/pagamentos/alcadas"
            }
          ],
      ressalvas: itens.length
        ? []
        : [
            "A tabela nasce vazia de propósito: semear um teto seria inventar política de governança. Enquanto não houver régua, o banco recusa qualquer aprovação."
          ]
    });
  } catch (error) {
    return trataAusencia(`${DOMINIO}.alcadas`, [] as Alcada[], error);
  }
}

// ---------------------------------------------------------------------------
// Payloads de decisão — a forma que a tela envia, não a implementação
// ---------------------------------------------------------------------------

/**
 * Toda decisão é em lote e tem autor.
 *
 * O `ids: number[]` não é conveniência: é a forma de UX que o Fernando pediu.
 * Uma tela que só decide um item por vez transforma 718 pendências em 718
 * cliques, e o resultado previsível é que ninguém decide nada. `motivo` é
 * obrigatório na recusa e opcional na aprovação — recusar sem dizer por quê
 * devolve o item para a fila sem informação nova.
 */
export type DecisaoEmLote = {
  ids: number[];
  decisao: "aprovar" | "rejeitar" | "devolver";
  nivel: 1 | 2 | 3;
  aprovador: string;
  motivo?: string;
  /** Alertas que o aprovador viu e assumiu, com justificativa por tipo. */
  alertasAssumidos?: { tipo: string; impressaoDigital: string; resolucao: "corrigido" | "justificado" | "falso_positivo"; motivo?: string }[];
};

export type MontagemDeLote = {
  ids: number[];
  agendadoPara: string;
  contaPagadoraSlug: string;
  rotulo?: string;
  criadoPor: string;
};

/**
 * Registro de pagamento JÁ FEITO. Note os nomes: `pagoEm` no passado,
 * `registradoPor` e não `executadoPor`. Este payload descreve o que aconteceu
 * no aplicativo do banco; ele não faz acontecer.
 */
export type RegistroDePagamento = {
  solicitacaoId: number;
  pagoEm: string;
  valorCents: number;
  contaSlug: string;
  metodo: "pix" | "ted" | "boleto" | "debito_automatico" | "cartao" | "dinheiro";
  endToEndId?: string;
  comprovanteAnexoId?: number;
  registradoPor: string;
};

// ---------------------------------------------------------------------------
// Apoio
// ---------------------------------------------------------------------------

function frescorDaFila(ultima: string | null, alcadas: number): Frescor {
  if (alcadas === 0) {
    return frescorIndisponivel(
      "fila de pagamento",
      "fin_pagamento_fila_v",
      "nenhuma alçada declarada: sem régua de aprovação, nada pode ser aprovado"
    );
  }
  return frescorDeData({
    fonte: "fila de pagamento",
    origem: "fin_pagamento_fila_v",
    cobreAte: ultima,
    toleranciaDias: 7,
    motivoSeVazio: "nenhuma solicitação de pagamento registrada"
  });
}

async function pendenciasDaOperacao(alcadas: number): Promise<Pendencia[]> {
  const pendencias: Pendencia[] = [];
  if (alcadas === 0) {
    pendencias.push({
      chave: "alcada_nao_declarada",
      titulo: "Nenhuma alçada declarada — nada pode ser aprovado",
      quantidade: 1,
      valorCents: null,
      severidade: "bloqueante",
      telaDeDecisao: "/financeiro/pagamentos/alcadas"
    });
  }
  const linhas = await query<{ pendencia: string; n: string }>(
    `SELECT pendencia, count(*)::text AS n FROM fin_pagamento_pendencia_v
      WHERE severidade = 'bloqueante' GROUP BY 1 ORDER BY 2 DESC`
  );
  for (const linha of linhas) {
    pendencias.push({
      chave: linha.pendencia,
      titulo: TITULO_PENDENCIA[linha.pendencia] ?? linha.pendencia,
      quantidade: Number(linha.n),
      valorCents: null,
      severidade: "bloqueante",
      telaDeDecisao: `/financeiro/pagamentos?pendencia=${linha.pendencia}`
    });
  }
  return pendencias;
}

const TITULO_PENDENCIA: Record<string, string> = {
  alcada_indeterminada: "Sem régua de alçada que case",
  sem_conta_bancaria: "Beneficiário sem coordenada bancária",
  documento_faltante: "Sem nota, boleto, contrato ou recibo",
  sem_categoria: "Sem categoria — não chega à DRE nem ao orçamento",
  acima_do_teto: "Acima do teto por transação",
  sem_centro_custo: "Sem centro de custo"
};

/**
 * Distingue "a migration 0075 ainda não foi aplicada" de erro de verdade.
 *
 * O primeiro caso é informação — o domínio não existe ainda — e a tela deve
 * dizer isso. Confundi-lo com falha faria a operação inteira parecer quebrada
 * num ambiente onde ela simplesmente não foi ligada.
 */
function trataAusencia<T>(dominio: string, vazio: T, error: unknown): Contrato<T> {
  const mensagem = error instanceof Error ? error.message : String(error);
  if (/does not exist|não existe/i.test(mensagem)) {
    return contratoIndisponivel(dominio, vazio, "migration 0075_fin_pagamentos ainda não aplicada");
  }
  console.error(`[contrato:${dominio}]`, mensagem);
  return contratoIndisponivel(dominio, vazio, mensagem);
}

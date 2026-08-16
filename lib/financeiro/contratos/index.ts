import "server-only";

/**
 * Os contratos de dados das telas financeiras — ponto de entrada único.
 *
 * ESTADO POR DOMÍNIO, medido em 16/08/2026. A tabela existe para que ninguém
 * construa uma tela contra um domínio vazio achando que o problema é o código:
 *
 *   DOMÍNIO            FONTE                              ESTADO
 *   executivo          fin_transaction, fin_receber_*     pronto (caixa)
 *   bancos             fin_account, fin_statement_cov.    pronto — 6/6 fecham
 *   conciliacao        fin_settlement, erp_extrato_*      pronto
 *   lancamentos        fin_transaction (13.880)           pronto
 *   cartao             fin_card_* (795 compras, 12 fat.)  pronto, sem titular
 *   receber            fin_receber_aging_v (596 abertas)  pronto
 *   pagar              —                                  SEM DADO: 0 documentos
 *   tesouraria         fin_reserve (4), fin_investment    pronto
 *   pessoas            fin_person (28), fin_custo_*       pronto
 *   reembolsos         fin_reimbursement (81)             pronto
 *   resultado (DRE)    fin_projetado_realizado_v          pronto (regime caixa)
 *   orcamento          fin_budget_target (114)            PARCIAL: 100% escopo obras
 *   previsao           fin_previsao_evento_v (593)        pronto
 *   decisoes           filas de indeterminado             pronto
 *   auditoria          fin_audit_log (4.524)              pronto
 *   pagamentos         migration 0075                     schema pronto, SEM DADO
 *
 * Todo contrato devolve `Contrato<T>` com `disponivel`, `cobertura`,
 * `frescorPior`, `pendencias` e `ressalvas`. A tela nunca deve renderizar o
 * `dado` sem consultar `frescorPior` — é o que separa um número de um número
 * confiável.
 */

export * from "./base";
export { getCobertura, frescorDe, type Cobertura, type FrescorConta } from "./cobertura";

export { getVisaoExecutiva, type VisaoExecutiva, type IndicadorExecutivo } from "./executivo";
export { getBancos, getConciliacao, type PainelBancos, type ContaBancaria, type Conciliacao } from "./bancos";
export {
  getLancamentos,
  getOpcoesLancamentos,
  drillLancamentos,
  type Lancamento,
  type FiltrosLancamentos,
  type CampoOrdenacaoLancamento
} from "./lancamentos";
export { getCartao, type PainelCartao, type LinhaDeCredito, type Fatura, type Subcartao } from "./cartao";
export {
  getContasAReceber,
  getContasAPagar,
  getPrioridadeReceita,
  type Recebivel,
  type FiltrosReceber,
  type ContasAPagar,
  type CamadaAPagar,
  type LinhaPrioridade
} from "./obrigacoes";
export { getTesouraria, type Tesouraria, type Reserva, type Aplicacao } from "./tesouraria";
export { getPessoas, getReembolsos, type PainelPessoas, type Pessoa, type PainelReembolsos } from "./pessoas";
export {
  getResultado,
  getOrcadoRealizado,
  getMargemPorProjeto,
  type Resultado,
  type LinhaOrcamento,
  type MargemProjeto
} from "./resultado";
export { getPrevisao, getPrevisaoRecebimento, type Previsao, type DiaPrevisto, type CamadaPrevisao } from "./previsao";
export { getAuditoria, getPendencias, type EventoAuditoria, type PainelPendencias, type ChecagemIntegridade } from "./auditoria";
export {
  getCaixaDeDecisoes,
  getItensDaFila,
  type ResumoFila,
  type ItemDecisao,
  type Evidencia,
  type DecisaoDeFila,
  type ResultadoDecisao,
  type SlugFila
} from "./decisoes";
export {
  getFilaPagamento,
  getSolicitacao,
  getFilaCompra,
  getLotes,
  getAlcadas,
  type ItemFilaPagamento,
  type DetalheSolicitacao,
  type ItemFilaCompra,
  type Lote,
  type Alcada,
  type DecisaoEmLote,
  type MontagemDeLote,
  type RegistroDePagamento,
  type StatusPagamento
} from "./pagamentos";

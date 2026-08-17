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
 *   cartao             fin_card_hierarquia_v (0074)       pronto, com lacunas declaradas
 *   receber            fin_receber_aging_v (596 abertas)  pronto
 *   pagar              —                                  SEM DADO: 0 documentos
 *   tesouraria         fin_reserve (4), fin_investment    pronto
 *   pessoas            fin_person (28), fin_custo_*       pronto
 *   reembolsos         fin_reimbursement (81)             pronto
 *   resultado (DRE)    fin_dre_v / fin_dre_mensal_v       pronto, DUAS visões (0072)
 *   fluxo de caixa     fin_fluxo_caixa_v                  pronto (0073)
 *   orcamento          fin_budget_target (114)            PARCIAL: 100% escopo obras
 *   previsao           fin_previsao_evento_v (593)        pronto
 *   decisoes           filas de indeterminado             pronto
 *   auditoria          fin_audit_log                      pronto
 *   pagamentos         0075 aplicada                      schema pronto, SEM DADO
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
  // A rota HTTP precisa da lista branca de ordenação para recusar `?ordenarPor=`
  // desconhecido com 400. Sem este export ela teria de importar do módulo por
  // dentro, e o "ponto de entrada único" deixaria de ser único.
  type CampoOrdenacaoReceber,
  type ContasAPagar,
  type CamadaAPagar,
  type LinhaPrioridade
} from "./obrigacoes";
export { getTesouraria, type Tesouraria, type Reserva, type Aplicacao } from "./tesouraria";
export { getPessoas, getReembolsos, type PainelPessoas, type Pessoa, type PainelReembolsos } from "./pessoas";
export {
  getResultado,
  getFluxoDeCaixa,
  getOrcadoRealizado,
  getMargemPorProjeto,
  type Resultado,
  type Visao,
  type MesDre,
  type LinhaDre,
  type CoberturaDre,
  type RegraCompetencia,
  type MesFluxo,
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
export {
  getFolhaPrevisao,
  getComissao,
  getRecorrentes,
  getContratosEParcelas,
  getDrePorDimensao,
  getFluxoPorConta,
  getReceitaPorGrupo,
  type ComponenteFolha,
  type PessoaNaFolha,
  type FolhaPrevista,
  type ComissaoMedida,
  type ComissaoIndeterminada,
  type Comissao,
  type Recorrente,
  type PainelRecorrentes,
  type ContratoEspelhado,
  type ParcelaEspelhada,
  type CoberturaContratos,
  type IndeterminadoContrato,
  type PainelContratos,
  type Dimensao,
  type LinhaDimensao,
  type DrePorDimensao,
  type MesFluxoConta,
  type ReceitaGrupo
} from "./gerencial";
export {
  getBalanco,
  getApuracaoTributaria,
  type LacunaBalanco,
  type LinhaBalanco,
  type MesBalanco,
  type Balanco,
  type MesApuracao,
  type Apuracao
} from "./balanco";

/**
 * A central de categorização — a única régua que atravessa os TRÊS universos
 * onde existe categoria. O indicador "categoria atribuída" mede só
 * `fin_transaction`; 889 itens (R$ 313.559,52) de `fin_document` e
 * `fin_card_transaction` não aparecem em indicador nenhum. Ver 0101.
 */
export {
  getBuscaCategorizacao,
  getPlanoDeContas,
  sinalEsperadoDe,
  UNIVERSOS,
  ESTADOS,
  PROCEDENCIAS,
  MARCADORES_INDECISAO,
  type ItemCategorizavel,
  type FiltrosBusca,
  // A rota HTTP precisa da lista branca de ordenação para recusar
  // `?ordenarPor=` desconhecido com 400, pelo mesmo motivo de `receber`.
  type CampoOrdenacaoBusca,
  type BuscaCategorizacao,
  type CategoriaPlano,
  type Universo,
  type EstadoCategorizacao,
  type ProcedenciaFamilia
} from "./categorizacao";

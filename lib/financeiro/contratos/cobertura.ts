import "server-only";

import { isFinanceConfigured, query } from "../db";
import { ENTIDADE, frescorDeData, frescorIndisponivel, piorFrescor, type Frescor } from "./base";

/**
 * O selo de frescor de cada fonte que alimenta as telas.
 *
 * A pergunta que este arquivo responde é a que o Fernando faz olhando qualquer
 * número: **"isso é de quando?"**. Sem resposta, todo indicador é um chute com
 * cara de fato — e a armadilha específica deste ledger é que os números
 * continuam plausíveis depois que a fonte para: o saldo do Nubank de 07/08
 * parece tão saudável quanto o de hoje.
 *
 * As tolerâncias abaixo NÃO são preferência estética. Cada uma vem da física da
 * fonte: um extrato bancário pode chegar em D+1; uma NFe leva o tempo do
 * cartório municipal; uma meta de orçamento muda uma vez por trimestre. Cobrar
 * D+1 de todas produziria um painel permanentemente vermelho, que é a maneira
 * mais rápida de ensinar o time a ignorar alerta.
 */

/** Cada fonte com o atraso que ainda é normal para ela. */
const TOLERANCIA = {
  extratoBancario: 1,
  cobrancasAsaas: 1,
  cartao: 3,
  espelhoErp: 2,
  notaFiscal: 10,
  investimentos: 7,
  recorrentes: 35,
  orcamento: 95,
  contratos: 7,
  filaPagamento: 7,
  reembolsos: 35,
  folha: 35,
  // A DRE de competência é derivada: ela é tão fresca quanto o lançamento mais
  // recente que carrega competência apurada.
  competencia: 2
} as const;

export type FonteCobertura = keyof typeof TOLERANCIA | "contasBancarias";

/** Frescor de cada conta bancária, individualmente. */
export type FrescorConta = Frescor & {
  slug: string;
  saldoCents: number;
  /** O caixa reconstrói contra o saldo declarado? É a validação máxima do projeto. */
  fechaCaixa: boolean | null;
  divergenciaCents: number | null;
};

export type Cobertura = {
  disponivel: boolean;
  fontes: Frescor[];
  contas: FrescorConta[];
  pior: Frescor | null;
  /** Contas cujo extrato não cobre D+1. É o número que trava o critério de conclusão. */
  contasAtrasadas: number;
  /** Contas cujo saldo reconstruído não bate com o declarado. */
  contasQueNaoFecham: number;
};

const VAZIO: Cobertura = {
  disponivel: false,
  fontes: [],
  contas: [],
  pior: null,
  contasAtrasadas: 0,
  contasQueNaoFecham: 0
};

/**
 * Mede o frescor de tudo, numa consulta por fonte.
 *
 * Cada bloco é independente e tolerante a falha: se a `0075` ainda não estiver
 * aplicada, a fila de pagamento devolve `indisponivel` com o motivo em vez de
 * derrubar o painel inteiro. Um domínio ausente é informação, não erro.
 */
export async function getCobertura(): Promise<Cobertura> {
  if (!isFinanceConfigured()) return VAZIO;

  try {
    const [contas, marcos, filaPagamento] = await Promise.all([
      coberturaDasContas(),
      marcosDasFontes(),
      coberturaDaFilaDePagamento()
    ]);

    const fontes: Frescor[] = [...marcos];
    if (filaPagamento) fontes.push(filaPagamento);

    // A conta mais atrasada representa o extrato bancário no selo geral: o
    // caixa consolidado é tão confiável quanto a pior perna dele.
    const piorConta = piorFrescor(contas);
    if (piorConta) {
      fontes.unshift({
        ...piorConta,
        fonte: "extrato bancário (pior conta)",
        origem: "fin_statement_coverage"
      });
    }

    return {
      disponivel: true,
      fontes,
      contas,
      pior: piorFrescor(fontes),
      contasAtrasadas: contas.filter((c) => c.estado !== "em_dia").length,
      contasQueNaoFecham: contas.filter((c) => c.fechaCaixa === false).length
    };
  } catch (error) {
    console.error("[cobertura] indisponível:", error);
    return VAZIO;
  }
}

/**
 * Frescor conta a conta, com o teste de fechamento junto.
 *
 * "Fecha" e "está em dia" são duas perguntas diferentes e a tela precisa das
 * duas: uma conta pode reconstruir o saldo exatamente no dia em que o extrato
 * termina e ainda assim não dizer nada sobre hoje.
 */
async function coberturaDasContas(): Promise<FrescorConta[]> {
  const linhas = await query<{
    slug: string;
    name: string;
    saldo: number;
    cobre_ate: string | null;
    reconstruido: string | null;
  }>(
    // A FÓRMULA DO FECHAMENTO É COPIADA LETRA POR LETRA de
    // scripts/painel-financeiro.mjs (regra zero). Isso é deliberado e não é
    // duplicação preguiçosa: "o caixa fecha" é a validação máxima do projeto, e
    // uma tela que responda essa pergunta por outra convenção — `>` em vez de
    // `>=` na data de abertura, ou filtrando is_split_parent — devolve um
    // número diferente do painel sobre EXATAMENTE o mesmo fato.
    //
    // Medido em 16/08/2026: com `>` e sem split parent, três das seis contas
    // apareciam como "não fecha" enquanto o painel dizia 6/6. Duas telas certas
    // segundo convenções diferentes destroem a confiança mais rápido que uma
    // tela errada, porque não há como saber em qual acreditar.
    `SELECT a.slug, a.name, a.current_balance_cents AS saldo,
            to_char(sc.ate, 'YYYY-MM-DD') AS cobre_ate,
            (a.opening_balance_cents + COALESCE(mov.total, 0))::text AS reconstruido
       FROM fin_account a
       JOIN fin_entity e ON e.id = a.entity_id
       LEFT JOIN LATERAL (
         SELECT MAX(c.period_end) AS ate FROM fin_statement_coverage c WHERE c.account_id = a.id
       ) sc ON true
       LEFT JOIN LATERAL (
         SELECT SUM(t.amount_cents) AS total
           FROM fin_transaction t
          WHERE t.account_id = a.id
            AND (a.opening_balance_date IS NULL OR t.posted_on >= a.opening_balance_date)
       ) mov ON true
      WHERE e.slug = $1 AND a.is_active
      ORDER BY a.sort_order`,
    [ENTIDADE]
  );

  return linhas.map((linha) => {
    const base = frescorDeData({
      fonte: linha.name,
      origem: "fin_statement_coverage",
      cobreAte: linha.cobre_ate,
      toleranciaDias: TOLERANCIA.extratoBancario,
      motivoSeVazio: "nenhum extrato importado para esta conta"
    });
    const reconstruido = linha.reconstruido === null ? null : Number(linha.reconstruido);
    const divergencia = reconstruido === null ? null : linha.saldo - reconstruido;
    return {
      ...base,
      slug: linha.slug,
      saldoCents: linha.saldo,
      // Sem cobertura não se afirma que fecha: não fechar e não saber são
      // estados diferentes, e o segundo é o honesto aqui.
      fechaCaixa: linha.cobre_ate === null ? null : divergencia === 0,
      divergenciaCents: divergencia
    };
  });
}

/** Última data que cada fonte não bancária cobre. */
async function marcosDasFontes(): Promise<Frescor[]> {
  const [marco] = await query<Record<string, string | null>>(
    `SELECT
       (SELECT to_char(MAX(d.paid_on), 'YYYY-MM-DD') FROM fin_document d
          JOIN fin_entity e ON e.id = d.entity_id
         WHERE e.slug = $1 AND d.source = 'asaas' AND d.paid_on IS NOT NULL)      AS asaas,
       (SELECT to_char(MAX(ct.purchase_date), 'YYYY-MM-DD') FROM fin_card_transaction ct) AS cartao,
       (SELECT to_char(MAX(l.posted_on), 'YYYY-MM-DD') FROM erp_extrato_linha l)  AS erp,
       (SELECT to_char(MAX(f.issue_date), 'YYYY-MM-DD') FROM fin_fiscal_document f) AS nfe,
       (SELECT to_char(MAX(i.quoted_on), 'YYYY-MM-DD') FROM fin_investment i)     AS investimento,
       (SELECT to_char(MAX(r.amostra_ate), 'YYYY-MM-DD') FROM fin_recurring r)    AS recorrente,
       (SELECT to_char(MAX(b.updated_at), 'YYYY-MM-DD') FROM fin_budget_target b) AS orcamento,
       (SELECT to_char(MAX(c.synced_at), 'YYYY-MM-DD') FROM erp_contrato c)       AS contrato,
       (SELECT to_char(MAX(rb.updated_at), 'YYYY-MM-DD') FROM fin_reimbursement rb) AS reembolso,
       (SELECT to_char(MAX(pc.reference_month), 'YYYY-MM-DD') FROM fin_person_compensation pc) AS folha,
       (SELECT to_char(MAX(t.competence_date), 'YYYY-MM-DD') FROM fin_transaction t
          JOIN fin_entity e2 ON e2.id = t.entity_id
         WHERE e2.slug = $1 AND t.competence_date <= CURRENT_DATE)                AS competencia`,
    [ENTIDADE]
  );

  const def = (
    fonte: string,
    origem: string,
    valor: string | null | undefined,
    tolerancia: number,
    motivoSeVazio: string
  ) => frescorDeData({ fonte, origem, cobreAte: valor ?? null, toleranciaDias: tolerancia, motivoSeVazio });

  return [
    def("cobranças Asaas", "fin_document", marco?.asaas, TOLERANCIA.cobrancasAsaas, "nenhuma cobrança liquidada"),
    def("cartão de crédito", "fin_card_transaction", marco?.cartao, TOLERANCIA.cartao, "nenhuma compra de cartão importada"),
    def("espelho do erp-obras", "erp_extrato_linha", marco?.erp, TOLERANCIA.espelhoErp, "espelho vazio"),
    def("notas fiscais", "fin_fiscal_document", marco?.nfe, TOLERANCIA.notaFiscal, "nenhuma NFe importada"),
    def("investimentos", "fin_investment", marco?.investimento, TOLERANCIA.investimentos, "nenhuma posição lida"),
    def("recorrentes detectadas", "fin_recurring", marco?.recorrente, TOLERANCIA.recorrentes, "detector nunca rodou"),
    def("orçamento", "fin_budget_target", marco?.orcamento, TOLERANCIA.orcamento, "nenhuma meta declarada"),
    def("contratos do ERP", "erp_contrato", marco?.contrato, TOLERANCIA.contratos, "nenhum contrato espelhado"),
    def("reembolsos", "fin_reimbursement", marco?.reembolso, TOLERANCIA.reembolsos, "nenhum reembolso lançado"),
    def("folha", "fin_person_compensation", marco?.folha, TOLERANCIA.folha, "nenhuma remuneração declarada"),
    def(
      "competência apurada",
      "fin_transaction.competence_date",
      marco?.competencia,
      TOLERANCIA.competencia,
      "nenhum lançamento com competência apurada — a DRE de competência não tem base"
    )
  ];
}

/**
 * A fila de pagamento é o domínio mais novo e pode não existir ainda.
 *
 * Consultar tabela ausente derrubaria o painel inteiro por um domínio que nem
 * entrou em operação. O catch aqui distingue os dois casos: "a migration não
 * foi aplicada" (informação útil, aparece como indisponível com motivo) de
 * qualquer outro erro, que sobe.
 */
async function coberturaDaFilaDePagamento(): Promise<Frescor | null> {
  try {
    const [linha] = await query<{ ultima: string | null; solicitacoes: number; alcadas: number }>(
      `SELECT to_char(ultima_solicitacao_em, 'YYYY-MM-DD') AS ultima,
              solicitacoes, alcadas_declaradas AS alcadas
         FROM fin_pagamento_cobertura_v`
    );
    if (!linha) return null;
    if (Number(linha.alcadas) === 0) {
      return frescorIndisponivel(
        "fila de pagamento",
        "fin_pagamento_fila_v",
        "nenhuma alçada declarada: sem régua de aprovação, nada pode ser aprovado"
      );
    }
    return frescorDeData({
      fonte: "fila de pagamento",
      origem: "fin_pagamento_fila_v",
      cobreAte: linha.ultima,
      toleranciaDias: TOLERANCIA.filaPagamento,
      motivoSeVazio: "nenhuma solicitação de pagamento registrada"
    });
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    if (/does not exist|não existe/i.test(mensagem)) {
      return frescorIndisponivel(
        "fila de pagamento",
        "fin_pagamento_fila_v",
        "migration 0075_fin_pagamentos ainda não aplicada"
      );
    }
    throw error;
  }
}

/**
 * Atalho para um domínio montar seu selo sem repetir a medição inteira.
 * Devolve só as fontes que interessam àquela tela.
 */
export async function frescorDe(fontes: string[]): Promise<Frescor[]> {
  const cobertura = await getCobertura();
  if (!cobertura.disponivel) return [];
  return cobertura.fontes.filter((f) => fontes.some((nome) => f.fonte.includes(nome) || f.origem === nome));
}

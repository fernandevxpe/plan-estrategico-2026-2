import "server-only";

import type pg from "pg";

import { normalizeDescription } from "@/scripts/lib/fin-normalize.mjs";
import { isFinanceConfigured, query, transaction } from "./db";
import { ValidacaoError } from "./revisao";

/**
 * Reembolsos: a matriz pessoa × mês, os parcelamentos e a previsão do mês
 * seguinte.
 *
 * A planilha "Reembolso 2026" existe porque o extrato bancário não sabe QUEM
 * gastou. Ele mostra um PIX de R$ 3.212,44 para o Igor; não mostra que dentro
 * dele há combustível, uma parcela de impressora 3D e o bolo do aniversariante
 * do mês. Sem essa decomposição, nada disso entra na DRE pela categoria certa e
 * a previsão do mês que vem é chute.
 *
 * A peça que a planilha nunca deu: PREVISÃO. Parcelamento é caixa já
 * comprometido — "faltam 5 parcelas de R$ 284,91" é um número que se sabe hoje e
 * que hoje não aparece em lugar nenhum. Somado à média das despesas avulsas dos
 * últimos 3 meses, vira a linha de reembolso do mês seguinte em contas a pagar.
 *
 * O invariante de escrita é o mesmo do resto do módulo: transação única,
 * fin_audit_log com actor 'ui', e total_cents jamais escrito por código (é
 * gatilho, ver 0012).
 */

const ENTITY = "xpe";

/** Categoria da conta a pagar gerada na aprovação. 6.05 = Reembolsos a colaboradores. */
const CATEGORIA_PAGAMENTO = "6.05";
const NUCLEO_PAGAMENTO = "corporativo";

/** Meses da matriz. 12 é o ciclo do exercício e o suficiente para ver sazonalidade. */
const MESES_MATRIZ = 12;

const STATUS_REEMBOLSO = ["rascunho", "enviado", "aprovado", "pago", "rejeitado"] as const;
export type StatusReembolso = (typeof STATUS_REEMBOLSO)[number];

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

export type TipoReembolso = {
  slug: string;
  name: string;
  categoriaCode: string | null;
  requiresNfe: boolean;
  allowsInstallment: boolean;
};

export type ItemReembolso = {
  id: number;
  reimbursementId: number;
  tipo: string | null;
  tipoNome: string | null;
  descricao: string;
  expenseDate: string | null;
  amountCents: number;
  categoriaCode: string | null;
  installmentPlanId: number | null;
  installmentNumber: number | null;
  installmentTotal: number | null;
  nfeKey: string | null;
  status: string;
};

export type PlanoParcelamento = {
  id: number;
  titulo: string;
  kind: string;
  totalCents: number;
  parcelasTotal: number;
  parcelasPagas: number;
  mensalCents: number;
  primeiraParcela: string;
  status: string;
  /** Quantas parcelas ainda não venceram/foram lançadas. */
  parcelasRestantes: number;
  saldoRestanteCents: number;
  /** Rótulo pronto: "Impressora 3D 7/12". */
  rotulo: string;
};

export type MesReembolso = {
  mes: string;
  reimbursementId: number | null;
  totalCents: number;
  status: StatusReembolso | null;
};

export type PessoaReembolso = {
  id: number;
  nome: string;
  employmentType: string;
  status: string;
  porMes: Record<string, number>;
  statusPorMes: Record<string, StatusReembolso>;
  reimbursementIdPorMes: Record<string, number>;
  totalCents: number;
  /**
   * Previsão do mês seguinte: soma das parcelas em aberto em
   * `fin_reembolso_saldo_v` — a mesma conta do perfil da pessoa.
   */
  previsaoCents: number;
  previsaoParcelasCents: number;
  previsaoAvulsosCents: number;
  /**
   * Saldo ainda a pagar das séries parceladas — mesma fonte do perfil
   * (`fin_reembolso_saldo_v`, NOT quitado). Não soma com `fin_installment_plan`.
   */
  restanteCents: number;
  planos: PlanoParcelamento[];
  itensMesAtual: ItemReembolso[];
  historico: MesReembolso[];
};

export type PainelReembolsos = {
  disponivel: boolean;
  meses: string[];
  mesAtual: string;
  mesSeguinte: string;
  pessoas: PessoaReembolso[];
  totalPorMes: Record<string, number>;
  totalGeralCents: number;
  previsaoTotalCents: number;
  tipos: TipoReembolso[];
  categorias: { code: string; name: string }[];
};

function painelIndisponivel(): PainelReembolsos {
  return {
    disponivel: false,
    meses: [],
    mesAtual: "",
    mesSeguinte: "",
    pessoas: [],
    totalPorMes: {},
    totalGeralCents: 0,
    previsaoTotalCents: 0,
    tipos: [],
    categorias: []
  };
}

export async function getPainelReembolsos(): Promise<PainelReembolsos> {
  if (!isFinanceConfigured()) return painelIndisponivel();

  // O "hoje" vem do banco, no fuso de São Paulo: o servidor de produção vive em
  // UTC e no dia 1º às 00h30 de Brasília ele ainda está no mês anterior.
  const hojeRow = await query<{ mes_atual: string; mes_seguinte: string; mes_inicial: string }>(
    `SELECT to_char(date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM-DD') AS mes_atual,
            to_char(date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') + interval '1 month', 'YYYY-MM-DD') AS mes_seguinte,
            to_char(date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') - interval '${MESES_MATRIZ - 1} months', 'YYYY-MM-DD') AS mes_inicial`
  );
  const { mes_atual: mesAtual, mes_seguinte: mesSeguinte, mes_inicial: mesInicial } = hojeRow[0];

  const meses: string[] = [];
  {
    const [ano, mes] = mesInicial.slice(0, 7).split("-").map(Number);
    for (let i = 0; i < MESES_MATRIZ; i += 1) {
      const d = new Date(Date.UTC(ano, mes - 1 + i, 1));
      meses.push(d.toISOString().slice(0, 10));
    }
  }

  const [pessoas, reembolsos, itens, planos, tipos, categorias, saldos] = await Promise.all([
    query<{ id: number; name: string; employment_type: string; status: string }>(
      `SELECT p.id, p.name, p.employment_type, p.status
         FROM fin_person p JOIN fin_entity e ON e.id = p.entity_id
        WHERE e.slug = $1
        ORDER BY p.status DESC, p.name`,
      [ENTITY]
    ),
    query<{
      id: number;
      person_id: number;
      mes: string;
      mes_referencia: string;
      total_cents: number;
      status: StatusReembolso;
    }>(
      // Eixo da matriz = mês do PIX no extrato, não a competência do pedido.
      // Julho lançado e pago em 01/08 entra na coluna agosto — é o mês em que
      // saiu o dinheiro. A mesma regra da folha (0077): casa pelo valor total
      // contra fin_transaction; cada lançamento casa com no máximo um pedido
      // (o de competência mais próxima) para o PIX de R$ 1.046,35 não puxar
      // março e abril juntos para maio.
      //
      // Sem par no extrato: cai na competência. Piso 4 meses antes do início
      // da janela porque o casamento da folha olha até +4 meses à frente.
      `WITH link AS (
         SELECT person_id, counterparty_id
           FROM fin_person_counterparty
          WHERE status = 'confirmado'
       ),
       pares_total AS (
         SELECT r.id AS reimbursement_id,
                t.id AS tx_id,
                t.posted_on,
                row_number() OVER (
                  PARTITION BY t.id
                  ORDER BY abs(EXTRACT(epoch FROM (t.posted_on::timestamp - r.reference_month::timestamp))),
                           r.id
                ) AS rn_tx
           FROM fin_reimbursement r
           JOIN fin_entity e ON e.id = r.entity_id
           JOIN link l ON l.person_id = r.person_id
           JOIN fin_transaction t
             ON t.counterparty_id = l.counterparty_id
            AND t.amount_cents = -r.total_cents
            AND t.posted_on >= r.reference_month
            AND t.posted_on < r.reference_month + interval '4 months'
          WHERE e.slug = $1
            AND r.total_cents > 0
            AND r.reference_month >= ($2::date - interval '4 months')
            AND r.reference_month <= $3::date
       ),
       casa_total AS (
         SELECT reimbursement_id, posted_on
           FROM (
             SELECT reimbursement_id, posted_on,
                    row_number() OVER (PARTITION BY reimbursement_id ORDER BY posted_on, tx_id) AS rn
               FROM pares_total
              WHERE rn_tx = 1
           ) x
          WHERE rn = 1
       ),
       casa_item AS (
         SELECT r.id AS reimbursement_id, min(t.posted_on) AS posted_on
           FROM fin_reimbursement r
           JOIN fin_entity e ON e.id = r.entity_id
           JOIN fin_reimbursement_item i ON i.reimbursement_id = r.id
           JOIN link l ON l.person_id = r.person_id
           JOIN fin_transaction t
             ON t.counterparty_id = l.counterparty_id
            AND t.amount_cents = -i.amount_cents
            AND t.posted_on >= r.reference_month
            AND t.posted_on < r.reference_month + interval '4 months'
          WHERE e.slug = $1
            AND r.reference_month >= ($2::date - interval '4 months')
            AND r.reference_month <= $3::date
            AND NOT EXISTS (SELECT 1 FROM casa_total c WHERE c.reimbursement_id = r.id)
          GROUP BY r.id
       )
       SELECT r.id, r.person_id,
              to_char(
                date_trunc(
                  'month',
                  COALESCE(ct.posted_on, ci.posted_on, r.reference_month)
                )::date,
                'YYYY-MM-DD'
              ) AS mes,
              r.reference_month::text AS mes_referencia,
              r.total_cents, r.status
         FROM fin_reimbursement r
         JOIN fin_entity e ON e.id = r.entity_id
         LEFT JOIN casa_total ct ON ct.reimbursement_id = r.id
         LEFT JOIN casa_item ci ON ci.reimbursement_id = r.id
        WHERE e.slug = $1
          AND r.reference_month >= ($2::date - interval '4 months')
          AND r.reference_month <= $3::date
          AND date_trunc(
                'month',
                COALESCE(ct.posted_on, ci.posted_on, r.reference_month)
              )::date BETWEEN $2::date AND $3::date
        ORDER BY mes, r.id`,
      [ENTITY, mesInicial, mesAtual]
    ),
    // Itens cujo pedido caiu no mês corrente pelo eixo de caixa (PIX), não
    // pela competência — a gaveta acompanha a coluna que a matriz mostra.
    query<{
      id: number;
      reimbursement_id: number;
      person_id: number;
      tipo: string | null;
      tipo_nome: string | null;
      description: string;
      expense_date: string | null;
      amount_cents: number;
      categoria_code: string | null;
      installment_plan_id: number | null;
      installment_number: number | null;
      installment_total: number | null;
      nfe_key: string | null;
      status: string;
    }>(
      `WITH link AS (
         SELECT person_id, counterparty_id
           FROM fin_person_counterparty
          WHERE status = 'confirmado'
       ),
       pares_total AS (
         SELECT r.id AS reimbursement_id,
                t.id AS tx_id,
                t.posted_on,
                row_number() OVER (
                  PARTITION BY t.id
                  ORDER BY abs(EXTRACT(epoch FROM (t.posted_on::timestamp - r.reference_month::timestamp))),
                           r.id
                ) AS rn_tx
           FROM fin_reimbursement r
           JOIN fin_entity e ON e.id = r.entity_id
           JOIN link l ON l.person_id = r.person_id
           JOIN fin_transaction t
             ON t.counterparty_id = l.counterparty_id
            AND t.amount_cents = -r.total_cents
            AND t.posted_on >= r.reference_month
            AND t.posted_on < r.reference_month + interval '4 months'
          WHERE e.slug = $1 AND r.total_cents > 0
            AND r.reference_month >= ($2::date - interval '4 months')
            AND r.reference_month <= $2::date
       ),
       casa_total AS (
         SELECT reimbursement_id, posted_on
           FROM (
             SELECT reimbursement_id, posted_on,
                    row_number() OVER (PARTITION BY reimbursement_id ORDER BY posted_on, tx_id) AS rn
               FROM pares_total WHERE rn_tx = 1
           ) x WHERE rn = 1
       ),
       casa_item AS (
         SELECT r.id AS reimbursement_id, min(t.posted_on) AS posted_on
           FROM fin_reimbursement r
           JOIN fin_entity e ON e.id = r.entity_id
           JOIN fin_reimbursement_item i ON i.reimbursement_id = r.id
           JOIN link l ON l.person_id = r.person_id
           JOIN fin_transaction t
             ON t.counterparty_id = l.counterparty_id
            AND t.amount_cents = -i.amount_cents
            AND t.posted_on >= r.reference_month
            AND t.posted_on < r.reference_month + interval '4 months'
          WHERE e.slug = $1
            AND r.reference_month >= ($2::date - interval '4 months')
            AND r.reference_month <= $2::date
            AND NOT EXISTS (SELECT 1 FROM casa_total c WHERE c.reimbursement_id = r.id)
          GROUP BY r.id
       ),
       no_mes AS (
         SELECT r.id
           FROM fin_reimbursement r
           JOIN fin_entity e ON e.id = r.entity_id
           LEFT JOIN casa_total ct ON ct.reimbursement_id = r.id
           LEFT JOIN casa_item ci ON ci.reimbursement_id = r.id
          WHERE e.slug = $1
            AND date_trunc(
                  'month',
                  COALESCE(ct.posted_on, ci.posted_on, r.reference_month)
                )::date = $2::date
       )
       SELECT i.id, i.reimbursement_id, r.person_id,
              i.reimbursement_type AS tipo, t.name AS tipo_nome,
              i.description, i.expense_date::text, i.amount_cents,
              c.code AS categoria_code, i.installment_plan_id, i.installment_number, i.installment_total,
              i.nfe_key, i.status
         FROM fin_reimbursement_item i
         JOIN fin_reimbursement r ON r.id = i.reimbursement_id
         JOIN no_mes n ON n.id = r.id
         LEFT JOIN fin_reimbursement_type t ON t.slug = i.reimbursement_type
         LEFT JOIN fin_category c ON c.id = i.category_id
        ORDER BY i.expense_date NULLS LAST, i.id`,
      [ENTITY, mesAtual]
    ),
    // parcelas_lancadas conta os itens JÁ gerados. É daí que sai "faltam 5":
    // total − lançadas, e não total − pagas, porque a geração é o compromisso.
    query<{
      id: number;
      person_id: number | null;
      title: string;
      kind: string;
      total_amount_cents: number;
      installments_total: number;
      installments_paid: number;
      monthly_amount_cents: number;
      first_due_date: string;
      status: string;
      parcelas_lancadas: number;
      parcelas_futuras: number;
    }>(
      `SELECT pl.id, pl.person_id, pl.title, pl.kind, pl.total_amount_cents,
              pl.installments_total, pl.installments_paid, pl.monthly_amount_cents,
              pl.first_due_date::text, pl.status,
              (SELECT count(*)::int FROM fin_reimbursement_item i WHERE i.installment_plan_id = pl.id) AS parcelas_lancadas,
              -- Parcelas cujo mês de referência ainda não passou: é o que a
              -- previsão do mês seguinte pode contar.
              (SELECT count(*)::int FROM fin_reimbursement_item i
                 JOIN fin_reimbursement r ON r.id = i.reimbursement_id
                WHERE i.installment_plan_id = pl.id
                  AND r.reference_month > date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')::date) AS parcelas_futuras
         FROM fin_installment_plan pl
         JOIN fin_entity e ON e.id = pl.entity_id
        WHERE e.slug = $1 AND pl.status = 'ativo'
        ORDER BY pl.created_at DESC`,
      [ENTITY]
    ),
    query<{ slug: string; name: string; categoria_code: string | null; requires_nfe: boolean; allows_installment: boolean }>(
      `SELECT t.slug, t.name, c.code AS categoria_code, t.requires_nfe, t.allows_installment
         FROM fin_reimbursement_type t
         LEFT JOIN fin_category c ON c.id = t.category_id
        WHERE t.is_active
        ORDER BY t.sort_order`
    ),
    query<{ code: string; name: string }>(
      `SELECT c.code, c.name FROM fin_category c JOIN fin_entity e ON e.id = c.entity_id
        WHERE e.slug = $1 AND c.is_active ORDER BY c.code`,
      [ENTITY]
    ),
    // Mesma fonte do perfil (`fin_reembolso_saldo_v`): restante = saldo das
    // séries; previsão = soma das próximas cotas (parcelas_restantes >= 1).
    // Não usa fin_installment_plan: os itens históricos estão com
    // installment_plan_id NULL, então "parcelas futuras" do plano zera e a
    // média antiga de "avulsos" engolia as séries (Fernando 773,93 em vez de
    // 1.276,76).
    query<{ person_id: number; restante_cents: number; previsao_parcelas_cents: number }>(
      `SELECT person_id,
              COALESCE(SUM(saldo_cents), 0)::bigint AS restante_cents,
              COALESCE(
                SUM(valor_parcela_cents) FILTER (WHERE parcelas_restantes >= 1),
                0
              )::bigint AS previsao_parcelas_cents
         FROM fin_reembolso_saldo_v
        WHERE NOT quitado
        GROUP BY person_id`
    )
  ]);

  const restantePorPessoa = new Map(saldos.map((s) => [s.person_id, Number(s.restante_cents)]));
  const previsaoParcelasPorPessoa = new Map(
    saldos.map((s) => [s.person_id, Number(s.previsao_parcelas_cents)])
  );

  const totalPorMes: Record<string, number> = {};
  for (const mes of meses) totalPorMes[mes] = 0;
  let totalGeralCents = 0;
  let previsaoTotalCents = 0;

  const linhas: PessoaReembolso[] = pessoas.map((pessoa) => {
    const porMes: Record<string, number> = {};
    const statusPorMes: Record<string, StatusReembolso> = {};
    const reimbursementIdPorMes: Record<string, number> = {};
    for (const mes of meses) porMes[mes] = 0;

    let total = 0;
    const historico: MesReembolso[] = [];
    for (const r of reembolsos) {
      if (r.person_id !== pessoa.id) continue;
      // Dois pedidos (competências distintas) podem cair no mesmo mês de
      // caixa — soma na célula; o id fica o do último para a gaveta.
      porMes[r.mes] = (porMes[r.mes] ?? 0) + Number(r.total_cents);
      statusPorMes[r.mes] = r.status;
      reimbursementIdPorMes[r.mes] = r.id;
      total += Number(r.total_cents);
      totalPorMes[r.mes] = (totalPorMes[r.mes] ?? 0) + Number(r.total_cents);
      historico.push({ mes: r.mes, reimbursementId: r.id, totalCents: Number(r.total_cents), status: r.status });
    }
    totalGeralCents += total;

    const planosPessoa: PlanoParcelamento[] = planos
      .filter((p) => p.person_id === pessoa.id)
      .map((p) => {
        // "faltam N" conta as parcelas cujo mês de referência ainda está no
        // futuro. A parcela corrente é, portanto, total − futuras: é assim que
        // "Impressora 3D 7/12 — faltam 5" fecha sem depender de ninguém marcar
        // parcela como paga à mão.
        const restantes = Math.max(0, Math.min(p.installments_total, p.parcelas_futuras));
        const atual = Math.max(1, p.installments_total - restantes);
        return {
          id: p.id,
          titulo: p.title,
          kind: p.kind,
          totalCents: p.total_amount_cents,
          parcelasTotal: p.installments_total,
          parcelasPagas: p.installments_paid,
          mensalCents: p.monthly_amount_cents,
          primeiraParcela: p.first_due_date,
          status: p.status,
          parcelasRestantes: restantes,
          saldoRestanteCents: restantes * p.monthly_amount_cents,
          rotulo: `${p.title} ${atual}/${p.installments_total}`
        };
      });

    // Mesma conta do perfil: próximas cotas das séries em fin_reembolso_saldo_v.
    const previsaoParcelas = previsaoParcelasPorPessoa.get(pessoa.id) ?? 0;
    const previsaoAvulsos = 0;
    const previsao = previsaoParcelas;
    previsaoTotalCents += previsao;

    return {
      id: pessoa.id,
      nome: pessoa.name,
      employmentType: pessoa.employment_type,
      status: pessoa.status,
      porMes,
      statusPorMes,
      reimbursementIdPorMes,
      totalCents: total,
      previsaoCents: previsao,
      previsaoParcelasCents: previsaoParcelas,
      previsaoAvulsosCents: previsaoAvulsos,
      restanteCents: restantePorPessoa.get(pessoa.id) ?? 0,
      planos: planosPessoa,
      itensMesAtual: itens
        .filter((i) => i.person_id === pessoa.id)
        .map((i) => ({
          id: i.id,
          reimbursementId: i.reimbursement_id,
          tipo: i.tipo,
          tipoNome: i.tipo_nome,
          descricao: i.description,
          expenseDate: i.expense_date,
          amountCents: i.amount_cents,
          categoriaCode: i.categoria_code,
          installmentPlanId: i.installment_plan_id,
          installmentNumber: i.installment_number,
          installmentTotal: i.installment_total,
          nfeKey: i.nfe_key,
          status: i.status
        })),
      historico: historico.sort((a, b) => b.mes.localeCompare(a.mes))
    };
  });

  return {
    disponivel: true,
    meses,
    mesAtual,
    mesSeguinte,
    pessoas: linhas,
    totalPorMes,
    totalGeralCents,
    previsaoTotalCents,
    tipos: tipos.map((t) => ({
      slug: t.slug,
      name: t.name,
      categoriaCode: t.categoria_code,
      requiresNfe: t.requires_nfe,
      allowsInstallment: t.allows_installment
    })),
    categorias
  };
}

// ---------------------------------------------------------------------------
// Escrita: helpers
// ---------------------------------------------------------------------------

function exigirMes(valor: unknown, campo: string): string {
  if (typeof valor !== "string" || !/^\d{4}-\d{2}(-\d{2})?$/.test(valor.trim())) {
    throw new ValidacaoError(`${campo} deve estar no formato AAAA-MM`);
  }
  return `${valor.trim().slice(0, 7)}-01`;
}

function exigirCentavos(valor: unknown, campo: string): number {
  const n = Number(valor);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new ValidacaoError(`${campo} deve ser um inteiro de centavos maior que zero`);
  }
  return n;
}

/**
 * Garante o reembolso do par (pessoa, mês) e devolve o id.
 *
 * O UNIQUE (person_id, reference_month) faz o ON CONFLICT ser a operação certa:
 * dois lançamentos simultâneos para o Igor em março convergem no mesmo
 * reembolso em vez de criar dois com valores diferentes — que é exatamente o
 * que acontece quando duas abas da planilha são editadas na mesma semana.
 */
async function garantirReembolso(
  client: pg.PoolClient,
  entityId: number,
  personId: number,
  mes: string
): Promise<{ id: number; criado: boolean }> {
  const existente = await client.query<{ id: number }>(
    `SELECT id FROM fin_reimbursement WHERE person_id = $1 AND reference_month = $2::date`,
    [personId, mes]
  );
  if (existente.rows[0]) return { id: existente.rows[0].id, criado: false };

  const criado = await client.query<{ id: number }>(
    `INSERT INTO fin_reimbursement (entity_id, person_id, reference_month, status)
     VALUES ($1, $2, $3::date, 'rascunho')
     ON CONFLICT (person_id, reference_month) DO UPDATE SET updated_at = now()
     RETURNING id`,
    [entityId, personId, mes]
  );
  await client.query(
    `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, after, fields, actor)
     VALUES ($1, 'fin_reimbursement', $2, 'insert', $3::jsonb, ARRAY['person_id','reference_month'], 'ui')`,
    [entityId, criado.rows[0].id, JSON.stringify({ person_id: personId, reference_month: mes })]
  );
  return { id: criado.rows[0].id, criado: true };
}

// ---------------------------------------------------------------------------
// Escrita: novo item (avulso ou parcelado)
// ---------------------------------------------------------------------------

export type NovoItemReembolso = {
  personId?: unknown;
  referenceMonth?: unknown;
  tipo?: unknown;
  descricao?: unknown;
  expenseDate?: unknown;
  valorCents?: unknown;
  parcelado?: unknown;
  parcelasTotal?: unknown;
  /** Valor DE CADA parcela, não o total. É como a nota chega na mão. */
  parcelaCents?: unknown;
  nfeKey?: unknown;
};

export type ResultadoItem = {
  itens: number[];
  reimbursementIds: number[];
  installmentPlanId: number | null;
};

/**
 * Lança um item de reembolso. Quando parcelado, cria o plano e GERA um item por
 * mês, cada um no reembolso do seu mês de referência.
 *
 * Gerar os N itens de uma vez, em vez de um por mês "quando chegar a hora", é o
 * que faz a matriz e a previsão dizerem a mesma coisa. A alternativa — só a
 * primeira parcela e um job mensal — deixa 11 meses de compromisso invisíveis
 * até o job rodar, e o job não existe.
 */
export async function criarItemReembolso(corpo: NovoItemReembolso): Promise<ResultadoItem> {
  const personId = Number(corpo.personId);
  if (!Number.isInteger(personId) || personId <= 0) throw new ValidacaoError("pessoa é obrigatória");
  const mes = exigirMes(corpo.referenceMonth, "mês de referência");
  const descricao = typeof corpo.descricao === "string" && corpo.descricao.trim() ? corpo.descricao.trim() : null;
  if (!descricao) throw new ValidacaoError("descrição é obrigatória");
  const tipo = typeof corpo.tipo === "string" && corpo.tipo.trim() ? corpo.tipo.trim() : null;
  const expenseDate =
    typeof corpo.expenseDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(corpo.expenseDate.trim())
      ? corpo.expenseDate.trim()
      : null;
  const parcelado = corpo.parcelado === true || corpo.parcelado === "true";
  const nfeKeyBruta = typeof corpo.nfeKey === "string" ? corpo.nfeKey.replace(/\D/g, "") : "";
  if (nfeKeyBruta && nfeKeyBruta.length !== 44) {
    throw new ValidacaoError("a chave da NF-e tem 44 dígitos");
  }
  const nfeKey = nfeKeyBruta || null;

  return transaction(async (client) => {
    const entidade = await client.query<{ id: number }>(`SELECT id FROM fin_entity WHERE slug = $1`, [ENTITY]);
    if (!entidade.rows[0]) throw new ValidacaoError("entidade não encontrada");
    const entityId = entidade.rows[0].id;

    const pessoa = await client.query<{ id: number; name: string }>(
      `SELECT id, name FROM fin_person WHERE id = $1 AND entity_id = $2`,
      [personId, entityId]
    );
    if (!pessoa.rows[0]) throw new ValidacaoError(`pessoa desconhecida: ${personId}`);

    let categoryId: number | null = null;
    let requiresNfe = false;
    let allowsInstallment = false;
    if (tipo) {
      const t = await client.query<{ slug: string; category_id: number | null; requires_nfe: boolean; allows_installment: boolean }>(
        `SELECT slug, category_id, requires_nfe, allows_installment FROM fin_reimbursement_type WHERE slug = $1 AND is_active`,
        [tipo]
      );
      if (!t.rows[0]) throw new ValidacaoError(`tipo de reembolso desconhecido: ${tipo}`);
      categoryId = t.rows[0].category_id;
      requiresNfe = t.rows[0].requires_nfe;
      allowsInstallment = t.rows[0].allows_installment;
    }
    if (requiresNfe && !nfeKey) {
      throw new ValidacaoError("este tipo exige a chave da NF-e (44 dígitos)");
    }
    if (parcelado && tipo && !allowsInstallment) {
      throw new ValidacaoError(`o tipo ${tipo} não aceita parcelamento`);
    }

    // ---- avulso ----
    if (!parcelado) {
      const valorCents = exigirCentavos(corpo.valorCents, "valor");
      const reembolso = await garantirReembolso(client, entityId, personId, mes);
      const item = await client.query<{ id: number }>(
        `INSERT INTO fin_reimbursement_item
           (reimbursement_id, category_id, reimbursement_type, description, expense_date, amount_cents, nfe_key)
         VALUES ($1, $2, $3, $4, $5::date, $6, $7) RETURNING id`,
        [reembolso.id, categoryId, tipo, descricao, expenseDate, valorCents, nfeKey]
      );
      await client.query(
        `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, after, fields, actor)
         VALUES ($1, 'fin_reimbursement_item', $2, 'insert', $3::jsonb,
                 ARRAY['description','amount_cents','reimbursement_type'], 'ui')`,
        [
          entityId,
          item.rows[0].id,
          JSON.stringify({
            reimbursement_id: reembolso.id,
            person: pessoa.rows[0].name,
            reference_month: mes,
            description: descricao,
            amount_cents: valorCents,
            reimbursement_type: tipo
          })
        ]
      );
      return { itens: [item.rows[0].id], reimbursementIds: [reembolso.id], installmentPlanId: null };
    }

    // ---- parcelado ----
    const parcelasTotal = Number(corpo.parcelasTotal);
    if (!Number.isInteger(parcelasTotal) || parcelasTotal < 2 || parcelasTotal > 60) {
      throw new ValidacaoError("total de parcelas deve ser um inteiro entre 2 e 60");
    }
    const parcelaCents = exigirCentavos(corpo.parcelaCents, "valor da parcela");

    const plano = await client.query<{ id: number }>(
      `INSERT INTO fin_installment_plan
         (entity_id, person_id, title, kind, total_amount_cents, installments_total,
          monthly_amount_cents, first_due_date, category_id, status)
       VALUES ($1, $2, $3, 'reembolso', $4, $5, $6, $7::date, $8, 'ativo')
       RETURNING id`,
      [entityId, personId, descricao, parcelaCents * parcelasTotal, parcelasTotal, parcelaCents, mes, categoryId]
    );
    const planoId = plano.rows[0].id;

    // Um reembolso por mês de referência, criados na ordem — o ON CONFLICT do
    // garantirReembolso cuida dos meses que já existem.
    const reimbursementIds: number[] = [];
    const itensIds: number[] = [];
    const [ano, mesNum] = mes.slice(0, 7).split("-").map(Number);
    for (let n = 0; n < parcelasTotal; n += 1) {
      const alvo = new Date(Date.UTC(ano, mesNum - 1 + n, 1)).toISOString().slice(0, 10);
      const reembolso = await garantirReembolso(client, entityId, personId, alvo);
      reimbursementIds.push(reembolso.id);
      const item = await client.query<{ id: number }>(
        `INSERT INTO fin_reimbursement_item
           (reimbursement_id, category_id, reimbursement_type, description, expense_date, amount_cents,
            installment_plan_id, installment_number, installment_total, nfe_key)
         VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8, $9, $10) RETURNING id`,
        [
          reembolso.id,
          categoryId,
          tipo,
          `${descricao} ${n + 1}/${parcelasTotal}`,
          // A data da despesa é a da COMPRA e vale para todas as parcelas: é ela
          // que amarra a nota fiscal ao plano inteiro.
          expenseDate,
          parcelaCents,
          planoId,
          n + 1,
          parcelasTotal,
          // A chave da nota vai só na primeira parcela: repeti-la em 12 itens
          // faria qualquer conferência por chave contar a mesma nota 12 vezes.
          n === 0 ? nfeKey : null
        ]
      );
      itensIds.push(item.rows[0].id);
    }

    await client.query(
      `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, after, fields, actor)
       VALUES ($1, 'fin_installment_plan', $2, 'insert', $3::jsonb,
               ARRAY['title','installments_total','monthly_amount_cents'], 'ui')`,
      [
        entityId,
        planoId,
        JSON.stringify({
          person: pessoa.rows[0].name,
          title: descricao,
          installments_total: parcelasTotal,
          monthly_amount_cents: parcelaCents,
          total_amount_cents: parcelaCents * parcelasTotal,
          first_due_date: mes,
          itens: itensIds
        })
      ]
    );

    return { itens: itensIds, reimbursementIds, installmentPlanId: planoId };
  });
}

// ---------------------------------------------------------------------------
// Escrita: status do reembolso (enviar / aprovar / pagar / rejeitar)
// ---------------------------------------------------------------------------

export type RespostaStatus =
  | { ok: true; id: number; status: StatusReembolso; documentoCriadoId: number | null }
  | { ok: false; status: 404 | 409 | 422; error: string };

/**
 * Muda o status de um reembolso — e, ao APROVAR, cria a conta a pagar.
 *
 * A criação do pagável na aprovação (e não no pagamento) é a decisão que liga os
 * dois módulos: aprovar é o momento em que a empresa assume a dívida, e é o
 * único momento anterior à saída do dinheiro. `planned_at = now()` gravado aqui é
 * a prova de precedência que a cobertura de planejamento mede — feito no
 * pagamento, seria carimbo no mesmo dia do caixa e não provaria nada.
 *
 * O vencimento vai para o dia 10 do mês seguinte ao de referência, que é quando
 * a folha é paga; ajustar caso a caso é trabalho de "Contas a pagar", onde a
 * data é editável.
 */
export async function mudarStatusReembolso(
  id: number,
  novoStatus: string,
  observacao?: string | null
): Promise<RespostaStatus> {
  if (!STATUS_REEMBOLSO.includes(novoStatus as StatusReembolso)) {
    return { ok: false, status: 422, error: `status desconhecido: ${novoStatus}` };
  }
  const status = novoStatus as StatusReembolso;

  try {
    return await transaction(async (client) => {
      const { rows } = await client.query<{
        id: number;
        entity_id: number;
        person_id: number;
        reference_month: string;
        status: StatusReembolso;
        total_cents: number;
        paid_document_id: number | null;
        pessoa: string;
        counterparty_id: number | null;
      }>(
        `SELECT r.id, r.entity_id, r.person_id, r.reference_month::text, r.status, r.total_cents,
                r.paid_document_id, p.name AS pessoa, p.counterparty_id
           FROM fin_reimbursement r JOIN fin_person p ON p.id = r.person_id
          WHERE r.id = $1 FOR UPDATE OF r`,
        [id]
      );
      const atual = rows[0];
      if (!atual) return { ok: false as const, status: 404 as const, error: `reembolso ${id} não encontrado` };
      if (status === "aprovado" && atual.total_cents <= 0) {
        return { ok: false as const, status: 409 as const, error: "reembolso sem itens não pode ser aprovado" };
      }

      let documentoCriadoId: number | null = null;
      if (status === "aprovado" && !atual.paid_document_id) {
        const categoria = await client.query<{ id: number }>(
          `SELECT c.id FROM fin_category c JOIN fin_entity e ON e.id = c.entity_id
            WHERE e.slug = $1 AND c.code = $2`,
          [ENTITY, CATEGORIA_PAGAMENTO]
        );
        const descricao = `Reembolso ${atual.pessoa} — ${atual.reference_month.slice(0, 7)}`;
        const doc = await client.query<{ id: number }>(
          `INSERT INTO fin_document (
             entity_id, direction, counterparty_id, category_id, nucleo,
             description, description_norm, competence_date, due_date, expected_cash_date,
             cash_date_basis, flexibility, amount_cents, status, source, source_id, planned_at, created_by
           )
           VALUES ($1, 'pagar', $2, $3, $4, $5, $6,
                   $7::date,
                   ($7::date + interval '1 month' + interval '9 days')::date,
                   ($7::date + interval '1 month' + interval '9 days')::date,
                   'vencimento', 'fixo', $8, 'previsto', 'reembolso', $9, now(), 'ui')
           RETURNING id`,
          [
            atual.entity_id,
            atual.counterparty_id,
            categoria.rows[0]?.id ?? null,
            NUCLEO_PAGAMENTO,
            descricao,
            normalizeDescription(descricao),
            atual.reference_month,
            atual.total_cents,
            // source_id garante idempotência: aprovar duas vezes não gera dois
            // pagáveis, mesmo se paid_document_id for limpo por engano.
            `reembolso:${atual.id}`
          ]
        );
        documentoCriadoId = doc.rows[0].id;
        await client.query(
          `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, after, fields, actor)
           VALUES ($1, 'fin_document', $2, 'insert', $3::jsonb,
                   ARRAY['description','amount_cents','planned_at'], 'ui')`,
          [
            atual.entity_id,
            documentoCriadoId,
            JSON.stringify({
              origem: "reembolso",
              reimbursement_id: atual.id,
              description: descricao,
              amount_cents: atual.total_cents
            })
          ]
        );
      }

      await client.query(
        `UPDATE fin_reimbursement
            SET status = $1,
                submitted_at = CASE WHEN $1 = 'enviado' AND submitted_at IS NULL THEN now() ELSE submitted_at END,
                approved_at = CASE WHEN $1 = 'aprovado' THEN now() ELSE approved_at END,
                approved_by = CASE WHEN $1 = 'aprovado' THEN 'ui' ELSE approved_by END,
                paid_document_id = COALESCE(paid_document_id, $2),
                notes = COALESCE($3, notes)
          WHERE id = $4`,
        [status, documentoCriadoId, observacao ?? null, id]
      );

      // Ao pagar o reembolso, os itens acompanham: sem isso a lista do mês
      // mostraria itens 'pendente' dentro de um reembolso pago.
      if (status === "pago" || status === "aprovado") {
        await client.query(
          `UPDATE fin_reimbursement_item SET status = $1 WHERE reimbursement_id = $2 AND status <> 'rejeitado'`,
          [status === "pago" ? "pago" : "aprovado", id]
        );
      }

      if (atual.status !== status) {
        await client.query(
          `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, before, after, fields, actor)
           VALUES ($1, 'fin_reimbursement', $2, 'update', $3::jsonb, $4::jsonb, ARRAY['status'], 'ui')`,
          [atual.entity_id, id, JSON.stringify({ status: atual.status }), JSON.stringify({ status })]
        );
      }

      return { ok: true as const, id, status, documentoCriadoId };
    });
  } catch (error) {
    if (error instanceof ValidacaoError) return { ok: false, status: 422, error: error.message };
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Escrita: item — valor e exclusão
// ---------------------------------------------------------------------------

export type RespostaItem = { ok: true; id: number; amountCents: number } | { ok: false; status: 404 | 409 | 422; error: string };

export async function atualizarItemReembolso(itemId: number, valorCents: unknown): Promise<RespostaItem> {
  try {
    return await transaction(async (client) => {
      const { rows } = await client.query<{
        id: number;
        amount_cents: number;
        reimbursement_id: number;
        entity_id: number;
        status_reembolso: string;
      }>(
        `SELECT i.id, i.amount_cents, i.reimbursement_id, r.entity_id, r.status AS status_reembolso
           FROM fin_reimbursement_item i JOIN fin_reimbursement r ON r.id = i.reimbursement_id
          WHERE i.id = $1 FOR UPDATE OF i`,
        [itemId]
      );
      const item = rows[0];
      if (!item) return { ok: false as const, status: 404 as const, error: `item ${itemId} não encontrado` };
      if (item.status_reembolso === "pago") {
        return { ok: false as const, status: 409 as const, error: "reembolso já pago — o valor não pode mudar" };
      }
      const novo = exigirCentavos(valorCents, "valor");

      await client.query(`UPDATE fin_reimbursement_item SET amount_cents = $1 WHERE id = $2`, [novo, itemId]);
      if (novo !== item.amount_cents) {
        await client.query(
          `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, before, after, fields, actor)
           VALUES ($1, 'fin_reimbursement_item', $2, 'update', $3::jsonb, $4::jsonb, ARRAY['amount_cents'], 'ui')`,
          [item.entity_id, itemId, JSON.stringify({ amount_cents: item.amount_cents }), JSON.stringify({ amount_cents: novo })]
        );
      }
      return { ok: true as const, id: itemId, amountCents: novo };
    });
  } catch (error) {
    if (error instanceof ValidacaoError) return { ok: false, status: 422, error: error.message };
    throw error;
  }
}

export type RespostaExclusaoItem = { ok: true; id: number } | { ok: false; status: 404 | 409; error: string };

/**
 * Apaga um item. O total_cents do reembolso se corrige sozinho (gatilho de
 * 0012); reembolso já pago é imutável, porque apagar item de algo pago faria a
 * soma da tela divergir do dinheiro que saiu.
 */
export async function excluirItemReembolso(itemId: number): Promise<RespostaExclusaoItem> {
  return transaction(async (client) => {
    const { rows } = await client.query<{
      id: number;
      entity_id: number;
      reimbursement_id: number;
      description: string;
      amount_cents: number;
      installment_plan_id: number | null;
      status_reembolso: string;
    }>(
      `SELECT i.id, r.entity_id, i.reimbursement_id, i.description, i.amount_cents,
              i.installment_plan_id, r.status AS status_reembolso
         FROM fin_reimbursement_item i JOIN fin_reimbursement r ON r.id = i.reimbursement_id
        WHERE i.id = $1 FOR UPDATE OF i`,
      [itemId]
    );
    const item = rows[0];
    if (!item) return { ok: false as const, status: 404 as const, error: `item ${itemId} não encontrado` };
    if (item.status_reembolso === "pago") {
      return { ok: false as const, status: 409 as const, error: "reembolso já pago — o item não pode ser excluído" };
    }

    await client.query(
      `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, before, fields, actor)
       VALUES ($1, 'fin_reimbursement_item', $2, 'delete', $3::jsonb, ARRAY['*'], 'ui')`,
      [
        item.entity_id,
        itemId,
        JSON.stringify({
          reimbursement_id: item.reimbursement_id,
          description: item.description,
          amount_cents: item.amount_cents,
          installment_plan_id: item.installment_plan_id
        })
      ]
    );
    await client.query(`DELETE FROM fin_reimbursement_item WHERE id = $1`, [itemId]);
    return { ok: true as const, id: itemId };
  });
}

import "server-only";

import { isFinanceConfigured, query } from "./db";

/**
 * Consultas de leitura do módulo financeiro.
 *
 * Regra que vale para tudo aqui: nenhuma agregação de dinheiro pode esquecer os
 * dois filtros que o schema documenta como invariantes —
 *
 *   AND transfer_status <> 'pareado'   (senão R$ 3,82 mi contam em dobro)
 *   AND NOT is_split_parent            (senão o rateio conta duas vezes)
 *
 * Por isso as somas passam por `fin_revenue_cash_v` ou repetem os filtros
 * explicitamente, nunca por um SELECT solto sobre fin_transaction.
 */

const ENTITY = "xpe";

export type Conta = {
  slug: string;
  name: string;
  institution: string;
  kind: string;
  saldoCents: number;
  ultimoExtrato: string | null;
  diasSemExtrato: number | null;
  importAdapter: string;
};

export type VisaoGeral = {
  disponivel: boolean;
  saldoTotalCents: number;
  saldoDisponivelCents: number;
  reservasCents: number;
  contas: Conta[];
  reservas: { slug: string; name: string; alvoCents: number; atualCents: number }[];
  reservaFaltaCents: number;
  mesAtual: { entradasCents: number; saidasCents: number };
  receita12m: { month: string; recebidoCents: number }[];
  aReceber: { faixa: string; totalCents: number; n: number }[];
  vencido: { totalCents: number; n: number; faixas: { faixa: string; totalCents: number; n: number }[] };
  categorias: { code: string; name: string; totalCents: number; n: number }[];
  concentracao: { nome: string; totalCents: number; pct: number }[];
  concentracaoTop10Pct: number;
  recorrencia: { contratosAtivos: number; mrrCents: number };
  confiabilidade: {
    contas: number;
    classificacao: number;
    conciliacao: number;
    planejamento: number;
    composto: number;
    naoClassificadoCents: number;
    filaItens: number;
  };
};

/** Estado vazio usado quando o banco ou o schema não estão disponíveis. */
function visaoIndisponivel(): VisaoGeral {
  return {
    disponivel: false,
    saldoTotalCents: 0,
    saldoDisponivelCents: 0,
    reservasCents: 0,
    contas: [],
    reservas: [],
    reservaFaltaCents: 0,
    mesAtual: { entradasCents: 0, saidasCents: 0 },
    receita12m: [],
    aReceber: [],
    vencido: { totalCents: 0, n: 0, faixas: [] },
    categorias: [],
    concentracao: [],
    concentracaoTop10Pct: 0,
    recorrencia: { contratosAtivos: 0, mrrCents: 0 },
    confiabilidade: {
      contas: 0,
      classificacao: 0,
      conciliacao: 0,
      planejamento: 0,
      composto: 0,
      naoClassificadoCents: 0,
      filaItens: 0
    }
  };
}

export async function getVisaoGeral(): Promise<VisaoGeral> {
  if (!isFinanceConfigured()) return visaoIndisponivel();

  try {
    const [contas, reservas, mes, receita, aReceber, vencido, categorias, clientes, recorrencia, conf] =
      await Promise.all([
        query<{
          slug: string;
          name: string;
          institution: string;
          kind: string;
          current_balance_cents: number;
          last_statement_at: string | null;
          import_adapter: string;
          dias: number | null;
        }>(
          // O fuso é convertido no SQL, não na tela: em produção o servidor roda
          // em UTC, e "último extrato" precisa dizer o dia que a pessoa viveu.
          `SELECT a.slug, a.name, a.institution, a.kind, a.current_balance_cents, a.import_adapter,
                  -- A data vem da COBERTURA DE EXTRATO, não de last_statement_at.
                  -- São fontes diferentes e discordavam na mesma tela: o KPI
                  -- dizia "1 de 5 contas" e a tabela mostrava o Nubank com data,
                  -- porque um lote revertido não zerava last_statement_at.
                  -- Cobertura é o que o ledger sustenta; o carimbo é intenção.
                  to_char(sc.ate, 'YYYY-MM-DD') AS last_statement_at,
                  CASE WHEN sc.ate IS NULL THEN NULL
                       ELSE (CURRENT_DATE - sc.ate) END AS dias
             FROM fin_account a
             JOIN fin_entity e ON e.id = a.entity_id
             LEFT JOIN LATERAL (
               SELECT MAX(c.period_end) AS ate FROM fin_statement_coverage c WHERE c.account_id = a.id
             ) sc ON true
            WHERE e.slug = $1 AND a.is_active ORDER BY a.sort_order`,
          [ENTITY]
        ),

        // `current_cents` é o que está de fato separado; `target_cents` é a meta.
        //
        // Usar a meta para calcular "disponível" produzia −R$ 180 mil na
        // primeira linha da tela, porque as quatro reservas somam R$ 230 mil de
        // alvo contra R$ 49 mil em conta. Alvo não é dinheiro comprometido — é
        // dinheiro que ainda falta guardar, e a diferença entre as duas coisas
        // é a distância entre "estou no vermelho" e "tenho uma meta a cumprir".
        query<{ slug: string; name: string; target_cents: number; current_cents: number }>(
          `SELECT r.slug, r.name, r.target_cents, r.current_cents FROM fin_reserve r
             JOIN fin_entity e ON e.id = r.entity_id
            WHERE e.slug = $1 AND r.is_active AND r.is_committed ORDER BY r.sort_order`,
          [ENTITY]
        ),

        query<{ entradas: number; saidas: number }>(
          `SELECT COALESCE(SUM(amount_cents) FILTER (WHERE amount_cents > 0), 0) AS entradas,
                  COALESCE(SUM(amount_cents) FILTER (WHERE amount_cents < 0), 0) AS saidas
             FROM fin_transaction t JOIN fin_entity e ON e.id = t.entity_id
            WHERE e.slug = $1 AND t.transfer_status <> 'pareado' AND NOT t.is_split_parent
              AND t.posted_on >= date_trunc('month', CURRENT_DATE)::date`,
          [ENTITY]
        ),

        // Receita por data de PAGAMENTO: é o número que o negócio conhece de cor,
        // porque é o que o painel do Asaas mostra.
        query<{ month: string; total: number }>(
          `SELECT to_char(date_trunc('month', d.paid_on), 'YYYY-MM-DD') AS month,
                  COALESCE(SUM(d.amount_cents), 0) AS total
             FROM fin_document d JOIN fin_entity e ON e.id = d.entity_id
            WHERE e.slug = $1 AND d.direction = 'receber' AND d.paid_on IS NOT NULL
              AND d.source_status IN ('RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH')
              AND d.paid_on >= (date_trunc('month', CURRENT_DATE) - interval '11 months')::date
            GROUP BY 1 ORDER BY 1`,
          [ENTITY]
        ),

        query<{ faixa: string; total: number; n: number }>(
          `SELECT to_char(date_trunc('month', due_date), 'YYYY-MM') AS faixa,
                  COALESCE(SUM(amount_cents - settled_cents), 0) AS total, count(*)::int AS n
             FROM fin_document d JOIN fin_entity e ON e.id = d.entity_id
            WHERE e.slug = $1 AND d.direction = 'receber' AND d.status IN ('emitido', 'parcial')
              AND d.due_date >= CURRENT_DATE
            GROUP BY 1 ORDER BY 1 LIMIT 12`,
          [ENTITY]
        ),

        // Aging. 'vencido' não é status: é due_date < hoje sobre o que está em
        // aberto — por isso a régua de cobrança enxerga duas cobranças que o
        // Asaas ainda não carimbou como OVERDUE.
        query<{ faixa: string; total: number; n: number }>(
          `SELECT CASE WHEN CURRENT_DATE - due_date <= 30 THEN '0-30'
                       WHEN CURRENT_DATE - due_date <= 60 THEN '31-60'
                       WHEN CURRENT_DATE - due_date <= 90 THEN '61-90'
                       ELSE '90+' END AS faixa,
                  COALESCE(SUM(amount_cents - settled_cents), 0) AS total, count(*)::int AS n
             FROM fin_document d JOIN fin_entity e ON e.id = d.entity_id
            WHERE e.slug = $1 AND d.direction = 'receber' AND d.status IN ('emitido', 'parcial')
              AND d.due_date < CURRENT_DATE
            GROUP BY 1 ORDER BY 1`,
          [ENTITY]
        ),

        // MESMA JANELA DE 12 MESES das demais telas.
        //
        // Sem o recorte, esta tabela somava o histórico inteiro (R$ 3,92 mi)
        // logo abaixo de um KPI que fala em "média dos últimos 12 meses" — e o
        // mesmo cliente aparecia valendo 19,9% aqui e 9,9% em /receitas.
        // Número que discorda entre telas destrói a confiança mais rápido que
        // número errado, porque não dá para saber qual acreditar.
        query<{ code: string; name: string; total: number; n: number }>(
          `SELECT c.code, c.name, COALESCE(SUM(d.amount_cents), 0) AS total, count(*)::int AS n
             FROM fin_document d
             JOIN fin_entity e ON e.id = d.entity_id
             JOIN fin_category c ON c.id = d.category_id
            WHERE e.slug = $1 AND d.direction = 'receber' AND c.kind = 'receita'
              AND d.source_status IN ('RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH')
              AND d.paid_on >= (date_trunc('month', CURRENT_DATE) - interval '11 months')::date
            GROUP BY 1, 2 ORDER BY 3 DESC`,
          [ENTITY]
        ),

        query<{ nome: string; total: number }>(
          `SELECT cp.name AS nome, COALESCE(SUM(d.amount_cents), 0) AS total
             FROM fin_document d
             JOIN fin_entity e ON e.id = d.entity_id
             JOIN fin_counterparty cp ON cp.id = d.counterparty_id
            WHERE e.slug = $1 AND d.direction = 'receber'
              AND d.source_status IN ('RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH')
              AND d.paid_on >= (date_trunc('month', CURRENT_DATE) - interval '11 months')::date
            GROUP BY 1 ORDER BY 2 DESC`,
          [ENTITY]
        ),

        query<{ n: number; mrr: number }>(
          `SELECT count(*)::int AS n, COALESCE(SUM(amount_cents), 0) AS mrr
             FROM fin_contract c JOIN fin_entity e ON e.id = c.entity_id
            WHERE e.slug = $1 AND c.status = 'ativo' AND c.recurrence = 'mensal' AND c.direction = 'receber'`,
          [ENTITY]
        ),

        getConfiabilidade()
      ]);

    const saldoTotalCents = contas
      // Conta de empréstimo fica de fora: saldo negativo ali é normal e somá-lo
      // faria o runway mentir.
      .filter((row) => row.kind !== "emprestimo")
      .reduce((sum, row) => sum + row.current_balance_cents, 0);
    // Comprometido = o que já está separado. A meta entra como lacuna a cumprir,
    // não como dívida contra o saldo.
    const reservasCents = reservas.reduce((sum, row) => sum + row.current_cents, 0);
    const reservaFaltaCents = reservas.reduce((sum, row) => sum + Math.max(0, row.target_cents - row.current_cents), 0);

    const totalReceita = clientes.reduce((sum, row) => sum + row.total, 0);
    const top10 = clientes.slice(0, 10).reduce((sum, row) => sum + row.total, 0);

    return {
      disponivel: true,
      saldoTotalCents,
      // O que sobra depois do dinheiro que já tem dono. Sem isto, a primeira
      // linha da tela mostra como livre a reserva de caixa.
      saldoDisponivelCents: saldoTotalCents - reservasCents,
      reservasCents,
      contas: contas.map((row) => ({
        slug: row.slug,
        name: row.name,
        institution: row.institution,
        kind: row.kind,
        saldoCents: row.current_balance_cents,
        ultimoExtrato: row.last_statement_at,
        diasSemExtrato: row.dias,
        importAdapter: row.import_adapter
      })),
      reservas: reservas.map((row) => ({
        slug: row.slug,
        name: row.name,
        alvoCents: row.target_cents,
        atualCents: row.current_cents
      })),
      reservaFaltaCents,
      mesAtual: { entradasCents: mes[0]?.entradas ?? 0, saidasCents: mes[0]?.saidas ?? 0 },
      receita12m: receita.map((row) => ({ month: row.month, recebidoCents: row.total })),
      aReceber: aReceber.map((row) => ({ faixa: row.faixa, totalCents: row.total, n: row.n })),
      vencido: {
        totalCents: vencido.reduce((sum, row) => sum + row.total, 0),
        n: vencido.reduce((sum, row) => sum + row.n, 0),
        faixas: vencido.map((row) => ({ faixa: row.faixa, totalCents: row.total, n: row.n }))
      },
      categorias: categorias.map((row) => ({ code: row.code, name: row.name, totalCents: row.total, n: row.n })),
      concentracao: clientes.slice(0, 10).map((row) => ({
        nome: row.nome,
        totalCents: row.total,
        pct: totalReceita ? (row.total / totalReceita) * 100 : 0
      })),
      concentracaoTop10Pct: totalReceita ? (top10 / totalReceita) * 100 : 0,
      recorrencia: { contratosAtivos: recorrencia[0]?.n ?? 0, mrrCents: recorrencia[0]?.mrr ?? 0 },
      confiabilidade: conf
    };
  } catch (error) {
    console.error("[financeiro] visão geral indisponível:", error);
    return visaoIndisponivel();
  }
}

/**
 * Índice de Confiabilidade.
 *
 * Quatro componentes, cada um clicável até a lista do que falta. É o placar do
 * módulo: enquanto ele não passa do limiar, todo relatório derivado carrega selo
 * de cobertura parcial — porque número financeiro incompleto apresentado como
 * completo é pior que número nenhum.
 */
export async function getConfiabilidade() {
  // Contas com extrato cobrindo os últimos 30 dias. Hoje só o Asaas tem, e é
  // exatamente essa lacuna que o índice existe para denunciar: 100% da receita
  // e 0% da despesa.
  const [contas] = await query<{ cobertas: number; total: number }>(
    `SELECT count(*) FILTER (WHERE c.id IS NOT NULL)::int AS cobertas, count(*)::int AS total
       FROM fin_account a
       JOIN fin_entity e ON e.id = a.entity_id
       LEFT JOIN LATERAL (
         SELECT 1 AS id FROM fin_statement_coverage sc
          WHERE sc.account_id = a.id AND sc.period_end >= CURRENT_DATE - 30 LIMIT 1
       ) c ON true
      WHERE e.slug = $1 AND a.is_active`,
    [ENTITY]
  );

  // Classificação e conciliação medidas em R$, não em número de linhas: uma
  // cobrança de R$ 15 mil sem categoria pesa mais que trinta de R$ 60.
  //
  // Transferência interna sai do denominador — senão R$ 3,82 mi de ruído
  // afundariam o índice sem que nada estivesse errado.
  const [classificacao] = await query<{ classificado: number; total: number; sem_categoria: number }>(
    `SELECT COALESCE(SUM(abs(amount_cents)) FILTER (WHERE category_id IS NOT NULL), 0) AS classificado,
            COALESCE(SUM(abs(amount_cents)), 0) AS total,
            COALESCE(SUM(abs(amount_cents)) FILTER (WHERE category_id IS NULL), 0) AS sem_categoria
       FROM fin_transaction t JOIN fin_entity e ON e.id = t.entity_id
      WHERE e.slug = $1 AND t.transfer_status = 'nao' AND NOT t.is_split_parent`,
    [ENTITY]
  );

  // LEAST garante que uma liquidação parcial conte como parcial, e não como zero.
  const [conciliacao] = await query<{ conciliado: number; total: number }>(
    `SELECT COALESCE(SUM(LEAST(abs(COALESCE(s.amt, 0)), abs(t.amount_cents))), 0) AS conciliado,
            COALESCE(SUM(abs(t.amount_cents)), 0) AS total
       FROM fin_transaction t
       JOIN fin_entity e ON e.id = t.entity_id
       LEFT JOIN (SELECT transaction_id, SUM(amount_cents) AS amt FROM fin_settlement GROUP BY 1) s
              ON s.transaction_id = t.id
      WHERE e.slug = $1 AND t.transfer_status = 'nao' AND NOT t.is_split_parent`,
    [ENTITY]
  );

  // Precedência real: o pagamento foi registrado ANTES de o dinheiro sair.
  // `planned_at` é a única coluna do schema que não dá para reconstruir depois —
  // created_at não serve de proxy porque o backfill grava data de hoje.
  const [planejamento] = await query<{ planejado: number; total: number }>(
    `SELECT COALESCE(SUM(abs(t.amount_cents)) FILTER (WHERE d.planned_at IS NOT NULL AND d.planned_at < t.posted_on), 0) AS planejado,
            COALESCE(SUM(abs(t.amount_cents)), 0) AS total
       FROM fin_transaction t
       JOIN fin_entity e ON e.id = t.entity_id
       LEFT JOIN fin_settlement s ON s.transaction_id = t.id
       LEFT JOIN fin_document d ON d.id = s.document_id
      WHERE e.slug = $1 AND t.amount_cents < 0 AND t.transfer_status = 'nao' AND NOT t.is_split_parent`,
    [ENTITY]
  );

  const [fila] = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM fin_review_item ri JOIN fin_entity e ON e.id = ri.entity_id
      WHERE e.slug = $1 AND ri.status = 'pendente'`,
    [ENTITY]
  );

  const ratio = (part: number, total: number) => (total > 0 ? (part / total) * 100 : 0);

  const componentes = {
    contas: ratio(contas?.cobertas ?? 0, contas?.total ?? 0),
    classificacao: ratio(classificacao?.classificado ?? 0, classificacao?.total ?? 0),
    conciliacao: ratio(conciliacao?.conciliado ?? 0, conciliacao?.total ?? 0),
    // Sem nenhuma saída registrada ainda, o denominador é zero. Devolver 100%
    // seria mentira confortável; 0% é a leitura honesta de "não medimos isso".
    planejamento: ratio(planejamento?.planejado ?? 0, planejamento?.total ?? 0)
  };

  return {
    ...componentes,
    // Média simples: nenhum componente vale mais que outro, e ponderar aqui
    // esconderia justamente o que está pior.
    composto:
      (componentes.contas + componentes.classificacao + componentes.conciliacao + componentes.planejamento) / 4,
    naoClassificadoCents: classificacao?.sem_categoria ?? 0,
    filaItens: fila?.n ?? 0
  };
}

export type Lancamento = {
  id: number;
  postedOn: string;
  descricao: string;
  contraparte: string | null;
  categoria: string | null;
  categoriaCode: string | null;
  nucleo: string | null;
  amountCents: number;
  conta: string;
  sourceKind: string | null;
  transferStatus: string;
  reconciliado: string;
  reviewStatus: string;
  porQue: Record<string, unknown> | null;
};

export type FiltroLancamentos = {
  conta?: string;
  nucleo?: string;
  categoria?: string;
  busca?: string;
  de?: string;
  ate?: string;
  semCategoria?: boolean;
  incluirTransferencias?: boolean;
  limite?: number;
};

export async function getLancamentos(filtro: FiltroLancamentos = {}): Promise<Lancamento[]> {
  if (!isFinanceConfigured()) return [];

  const where: string[] = ["e.slug = $1", "NOT t.is_split_parent"];
  const params: unknown[] = [ENTITY];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replace("$?", `$${params.length}`));
  };

  // Transferências ficam ocultas por padrão: são 372 linhas e R$ 3,82 mi que
  // não são nem receita nem despesa, e poluem a leitura do extrato.
  if (!filtro.incluirTransferencias) where.push("t.transfer_status = 'nao'");
  if (filtro.conta) add("a.slug = $?", filtro.conta);
  if (filtro.nucleo) add("t.nucleo = $?", filtro.nucleo);
  if (filtro.categoria) add("c.code = $?", filtro.categoria);
  if (filtro.semCategoria) where.push("t.category_id IS NULL");
  if (filtro.de) add("t.posted_on >= $?", filtro.de);
  if (filtro.ate) add("t.posted_on <= $?", filtro.ate);
  if (filtro.busca) add("t.description_norm LIKE '%' || $? || '%'", filtro.busca.toLowerCase());

  params.push(Math.min(filtro.limite ?? 200, 1000));

  try {
    const rows = await query<{
      id: number;
      posted_on: string;
      description_raw: string;
      contraparte: string | null;
      categoria: string | null;
      categoria_code: string | null;
      nucleo: string | null;
      amount_cents: number;
      conta: string;
      source_kind: string | null;
      transfer_status: string;
      reconciled_status: string;
      review_status: string;
      classified_reason: Record<string, unknown> | null;
    }>(
      `SELECT t.id, t.posted_on, t.description_raw, cp.name AS contraparte,
              c.name AS categoria, c.code AS categoria_code, t.nucleo, t.amount_cents,
              a.name AS conta, t.source_kind, t.transfer_status, t.reconciled_status,
              t.review_status, t.classified_reason
         FROM fin_transaction t
         JOIN fin_entity e ON e.id = t.entity_id
         JOIN fin_account a ON a.id = t.account_id
         LEFT JOIN fin_counterparty cp ON cp.id = t.counterparty_id
         LEFT JOIN fin_category c ON c.id = t.category_id
        WHERE ${where.join(" AND ")}
        ORDER BY t.posted_on DESC, t.id DESC
        LIMIT $${params.length}`,
      params
    );

    return rows.map((row) => ({
      id: row.id,
      postedOn: row.posted_on,
      descricao: row.description_raw,
      contraparte: row.contraparte,
      categoria: row.categoria,
      categoriaCode: row.categoria_code,
      nucleo: row.nucleo,
      amountCents: row.amount_cents,
      conta: row.conta,
      sourceKind: row.source_kind,
      transferStatus: row.transfer_status,
      reconciliado: row.reconciled_status,
      reviewStatus: row.review_status,
      porQue: row.classified_reason
    }));
  } catch (error) {
    console.error("[financeiro] lançamentos indisponíveis:", error);
    return [];
  }
}

export async function getFiltrosDisponiveis() {
  if (!isFinanceConfigured()) return { contas: [], categorias: [], nucleos: [] };
  try {
    const [contas, categorias, nucleos] = await Promise.all([
      query<{ slug: string; name: string }>(
        `SELECT a.slug, a.name FROM fin_account a JOIN fin_entity e ON e.id = a.entity_id
          WHERE e.slug = $1 AND a.is_active ORDER BY a.sort_order`,
        [ENTITY]
      ),
      query<{ code: string; name: string }>(
        `SELECT c.code, c.name FROM fin_category c JOIN fin_entity e ON e.id = c.entity_id
          WHERE e.slug = $1 AND c.is_active ORDER BY c.sort_order`,
        [ENTITY]
      ),
      query<{ slug: string; name: string }>(`SELECT slug, name FROM fin_nucleo WHERE is_active ORDER BY sort_order`)
    ]);
    return { contas, categorias, nucleos };
  } catch {
    return { contas: [], categorias: [], nucleos: [] };
  }
}

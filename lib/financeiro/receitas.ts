import "server-only";

import { isFinanceConfigured, query } from "./db";

/**
 * Detalhe de receitas: de onde o dinheiro veio, de quem, e o que está preso.
 *
 * Tudo por data de PAGAMENTO (paid_on) com os status de recebimento do Asaas —
 * a mesma definição da visão geral, porque "esta tela não bate com aquela" é
 * sempre duas consultas definindo receita de um jeito ligeiramente diferente.
 *
 * "Recorrente" aqui é um PROXY por categoria (3.06 comissionamento, 3.07
 * medição, 3.09 gestão de faturas): são os serviços de natureza mensal. Não é
 * MRR contratual — a tabela fin_contract está vazia — e a tela diz isso.
 */

const ENTITY = "xpe";
const CATEGORIAS_RECORRENTES = ["3.06", "3.07", "3.09"];

export type ReceitasDetalhe = {
  disponivel: boolean;
  meses: string[];
  kpi: {
    recebido12mCents: number;
    nCobrancas: number;
    ticketMedioCents: number;
    mrrProxyCents: number;
    mesesCompletos: number;
    pctRecorrente: number;
  };
  matriz: { code: string | null; nome: string; totalCents: number; porMes: Record<string, number> }[];
  totalPorMes: Record<string, number>;
  clientes: { nome: string; totalCents: number; pctDoTotal: number; n: number; ultima: string | null }[];
  nClientes: number;
  pareto80: number;
  inadimplencia: {
    contraparte: string | null;
    descricao: string;
    dueDate: string;
    diasAtraso: number;
    abertoCents: number;
  }[];
  recorrentePorMes: { mes: string; recorrenteCents: number; pontualCents: number }[];
};

function receitasIndisponiveis(): ReceitasDetalhe {
  return {
    disponivel: false,
    meses: [],
    kpi: { recebido12mCents: 0, nCobrancas: 0, ticketMedioCents: 0, mrrProxyCents: 0, mesesCompletos: 0, pctRecorrente: 0 },
    matriz: [],
    totalPorMes: {},
    clientes: [],
    nClientes: 0,
    pareto80: 0,
    inadimplencia: [],
    recorrentePorMes: []
  };
}

export async function getReceitasDetalhe(): Promise<ReceitasDetalhe> {
  if (!isFinanceConfigured()) return receitasIndisponiveis();

  try {
    // Fuso convertido no SQL, como no resto do módulo: o servidor de produção
    // vive em UTC e o mês corrente de lá pode não ser o mês corrente daqui.
    const hojeRow = await query<{ hoje: string; mes_atual: string }>(
      `SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date::text AS hoje,
              to_char(date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM-01') AS mes_atual`
    );
    const { hoje, mes_atual: mesAtual } = hojeRow[0];

    const [porCategoriaMes, clientesRows, vencidos] = await Promise.all([
      // Uma consulta alimenta a matriz, os KPIs e o recorrente × pontual: se
      // fossem três, três definições de receita divergiriam em silêncio.
      query<{ mes: string; code: string | null; nome: string | null; total: number; n: number }>(
        `SELECT to_char(date_trunc('month', d.paid_on), 'YYYY-MM-01') AS mes,
                c.code, c.name AS nome,
                COALESCE(SUM(d.amount_cents), 0) AS total, count(*)::int AS n
           FROM fin_document d
           JOIN fin_entity e ON e.id = d.entity_id
           LEFT JOIN fin_category c ON c.id = d.category_id
          WHERE e.slug = $1 AND d.direction = 'receber' AND d.paid_on IS NOT NULL
            AND d.source_status IN ('RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH')
            AND d.paid_on >= ($2::date - interval '11 months')
          GROUP BY 1, 2, 3`,
        [ENTITY, mesAtual]
      ),

      // TODOS os clientes, não só o top 15: o corte de Pareto ("quantos somam
      // 80%?") precisa da lista completa para ser verdadeiro.
      query<{ nome: string; total: number; n: number; ultima: string | null }>(
        `SELECT COALESCE(cp.name, 'Sem contraparte') AS nome,
                COALESCE(SUM(d.amount_cents), 0) AS total, count(*)::int AS n,
                max(d.paid_on)::text AS ultima
           FROM fin_document d
           JOIN fin_entity e ON e.id = d.entity_id
           LEFT JOIN fin_counterparty cp ON cp.id = d.counterparty_id
          WHERE e.slug = $1 AND d.direction = 'receber' AND d.paid_on IS NOT NULL
            AND d.source_status IN ('RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH')
            AND d.paid_on >= ($2::date - interval '11 months')
          GROUP BY 1 ORDER BY 2 DESC`,
        [ENTITY, mesAtual]
      ),

      // A lista de cobrança: tudo que venceu e segue aberto, do maior para o
      // menor. 'vencido' é derivado de due_date, nunca do carimbo do gateway —
      // o Asaas demora a marcar OVERDUE e a régua não pode esperar por ele.
      query<{ contraparte: string | null; descricao: string; due_date: string; dias_atraso: number; aberto: number }>(
        `SELECT cp.name AS contraparte, d.description AS descricao,
                d.due_date::text AS due_date,
                ($2::date - d.due_date)::int AS dias_atraso,
                (d.amount_cents - d.settled_cents) AS aberto
           FROM fin_document d
           JOIN fin_entity e ON e.id = d.entity_id
           LEFT JOIN fin_counterparty cp ON cp.id = d.counterparty_id
          WHERE e.slug = $1 AND d.direction = 'receber' AND d.status IN ('emitido', 'parcial')
            AND d.due_date < $2::date
          ORDER BY 5 DESC`,
        [ENTITY, hoje]
      )
    ]);

    // Os 12 meses do eixo vêm do calendário, não do dado: um mês sem receita
    // precisa aparecer vazio, não sumir.
    const meses: string[] = [];
    for (let i = 11; i >= 0; i--) {
      const [y, m] = mesAtual.split("-").map(Number);
      const total = y * 12 + (m - 1) - i;
      meses.push(`${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}-01`);
    }

    // Matriz categoria × mês
    const porCategoria = new Map<string, { code: string | null; nome: string; totalCents: number; porMes: Record<string, number> }>();
    const totalPorMes: Record<string, number> = {};
    let recebido12mCents = 0;
    let nCobrancas = 0;
    let recorrenteTotalCents = 0;
    const recorrenteMes: Record<string, number> = {};

    for (const row of porCategoriaMes) {
      const chave = row.code ?? "—";
      const alvo = porCategoria.get(chave) ?? {
        code: row.code,
        nome: row.nome ?? "Sem categoria",
        totalCents: 0,
        porMes: {}
      };
      alvo.totalCents += row.total;
      alvo.porMes[row.mes] = (alvo.porMes[row.mes] ?? 0) + row.total;
      porCategoria.set(chave, alvo);

      totalPorMes[row.mes] = (totalPorMes[row.mes] ?? 0) + row.total;
      recebido12mCents += row.total;
      nCobrancas += row.n;
      if (row.code && CATEGORIAS_RECORRENTES.includes(row.code)) {
        recorrenteTotalCents += row.total;
        recorrenteMes[row.mes] = (recorrenteMes[row.mes] ?? 0) + row.total;
      }
    }

    const matriz = [...porCategoria.values()].sort((a, b) => b.totalCents - a.totalCents);

    // MRR-proxy: média mensal do recorrente sobre os meses COMPLETOS. O mês
    // corrente parcial derrubaria a média sem significar queda nenhuma.
    const mesesCompletos = meses.filter((mes) => mes !== mesAtual);
    const recorrenteCompleto = mesesCompletos.reduce((sum, mes) => sum + (recorrenteMes[mes] ?? 0), 0);
    const mrrProxyCents = mesesCompletos.length ? Math.round(recorrenteCompleto / mesesCompletos.length) : 0;

    // Pareto sobre a lista completa de clientes
    let acumulado = 0;
    let pareto80 = 0;
    for (const cliente of clientesRows) {
      if (acumulado >= recebido12mCents * 0.8) break;
      acumulado += cliente.total;
      pareto80 += 1;
    }

    return {
      disponivel: true,
      meses,
      kpi: {
        recebido12mCents,
        nCobrancas,
        ticketMedioCents: nCobrancas ? Math.round(recebido12mCents / nCobrancas) : 0,
        mrrProxyCents,
        mesesCompletos: mesesCompletos.length,
        pctRecorrente: recebido12mCents ? (recorrenteTotalCents / recebido12mCents) * 100 : 0
      },
      matriz,
      totalPorMes,
      clientes: clientesRows.slice(0, 15).map((c) => ({
        nome: c.nome,
        totalCents: c.total,
        pctDoTotal: recebido12mCents ? (c.total / recebido12mCents) * 100 : 0,
        n: c.n,
        ultima: c.ultima
      })),
      nClientes: clientesRows.length,
      pareto80,
      inadimplencia: vencidos.map((v) => ({
        contraparte: v.contraparte,
        descricao: v.descricao,
        dueDate: v.due_date,
        diasAtraso: v.dias_atraso,
        abertoCents: v.aberto
      })),
      recorrentePorMes: meses.map((mes) => {
        const recorrente = recorrenteMes[mes] ?? 0;
        return { mes, recorrenteCents: recorrente, pontualCents: (totalPorMes[mes] ?? 0) - recorrente };
      })
    };
  } catch (error) {
    console.error("[financeiro] detalhe de receitas indisponível:", error);
    return receitasIndisponiveis();
  }
}

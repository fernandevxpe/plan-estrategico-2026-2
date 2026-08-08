import "server-only";

import { isFinanceConfigured, query } from "./db";

/**
 * Previsão de fluxo de caixa em camadas SEPARADAS.
 *
 * A separação não é estética: cada camada tem uma confiabilidade diferente, e
 * somar tudo num número só esconderia exatamente isso. L0 é fato (saldo em
 * conta). L1 é contrato emitido, descontado por uma curva de recuperação quando
 * está vencido. L2 é recorrência contratada (hoje vazia). L3 são as saídas
 * comprometidas — que hoje NÃO EXISTEM no banco, porque só o Asaas alimenta o
 * ledger e o Asaas não tem despesas. Enquanto L3 for zero, o saldo projetado é
 * um teto, não uma previsão — e a tela diz isso com todas as letras.
 */

const ENTITY = "xpe";
const HORIZONTE_MESES = 6;

// ---------------------------------------------------------------------------
// Aritmética de datas sobre strings 'YYYY-MM-DD'.
//
// Tudo via Date.UTC de propósito: `new Date("2026-08-01")` interpretado em BRT
// vira 31/07 às 21h e o dia migra sozinho. Data pura não tem fuso — as contas
// são feitas em UTC e o resultado volta a ser texto imediatamente.
// ---------------------------------------------------------------------------
function toUtc(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function addDays(iso: string, n: number): string {
  return fromUtc(toUtc(iso) + n * 86_400_000);
}

function diasEntre(de: string, ate: string): number {
  return Math.round((toUtc(ate) - toUtc(de)) / 86_400_000);
}

/** Primeiro dia do mês de uma data. */
function mesDe(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

function somaMeses(mesIso: string, n: number): string {
  const [y, m] = mesIso.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  const ano = Math.floor(total / 12);
  const mes = (total % 12) + 1;
  return `${ano}-${String(mes).padStart(2, "0")}-01`;
}

function ultimoDiaDoMes(mesIso: string): string {
  return addDays(somaMeses(mesIso, 1), -1);
}

// ---------------------------------------------------------------------------
// Tipos expostos à tela
// ---------------------------------------------------------------------------

export type DocPrevisto = {
  descricao: string;
  contraparte: string | null;
  status: string;
  dueDate: string;
  dataPrevista: string;
  brutoCents: number;
  fator: number;
  ajustadoCents: number;
};

export type LinhaDia = {
  dia: string;
  entradaCents: number;
  saidaCents: number;
  saldoCents: number;
  realizado: boolean;
  hoje: boolean;
  minimo: boolean;
};

export type LinhaMes = {
  mes: string;
  aberturaCents: number;
  l1Cents: number;
  l2Cents: number;
  l3Cents: number;
  fechamentoCents: number;
  docs: DocPrevisto[];
  nDocs: number;
};

export type PrevisaoFluxo = {
  disponivel: boolean;
  hoje: string;
  l0: {
    contas: { slug: string; name: string; kind: string; saldoCents: number }[];
    saldoContasCents: number;
    reservasSeparadasCents: number;
    disponivelCents: number;
    metaReservasCents: number;
  };
  l1: {
    brutoCents: number;
    ajustadoCents: number;
    aVencer: { brutoCents: number; n: number };
    vencido: {
      brutoCents: number;
      ajustadoCents: number;
      n: number;
      faixas: { faixa: string; fator: number; brutoCents: number; ajustadoCents: number; n: number }[];
    };
    confirmado: { brutoCents: number; ajustadoCents: number; n: number };
    semDataFuturaCents: number;
    alemHorizonte: { ajustadoCents: number; n: number };
  };
  l2: { contratos: { nome: string; valorCents: number }[]; mensalCents: number };
  l3: { n: number; abertoCents: number };
  grade: LinhaDia[];
  meses: LinhaMes[];
};

function previsaoIndisponivel(): PrevisaoFluxo {
  return {
    disponivel: false,
    hoje: "",
    l0: { contas: [], saldoContasCents: 0, reservasSeparadasCents: 0, disponivelCents: 0, metaReservasCents: 0 },
    l1: {
      brutoCents: 0,
      ajustadoCents: 0,
      aVencer: { brutoCents: 0, n: 0 },
      vencido: { brutoCents: 0, ajustadoCents: 0, n: 0, faixas: [] },
      confirmado: { brutoCents: 0, ajustadoCents: 0, n: 0 },
      semDataFuturaCents: 0,
      alemHorizonte: { ajustadoCents: 0, n: 0 }
    },
    l2: { contratos: [], mensalCents: 0 },
    l3: { n: 0, abertoCents: 0 },
    grade: [],
    meses: []
  };
}

export async function getPrevisaoFluxo(): Promise<PrevisaoFluxo> {
  if (!isFinanceConfigured()) return previsaoIndisponivel();

  try {
    // O "hoje" vem do SQL convertido para o fuso da empresa, seguindo o padrão
    // do módulo: em produção o servidor roda em UTC e, entre 21h e meia-noite,
    // CURRENT_DATE já seria amanhã — a grade diária inteira deslocaria um dia.
    const hojeRow = await query<{ hoje: string }>(
      `SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date::text AS hoje`
    );
    const hoje = hojeRow[0].hoje;
    const mesAtual = mesDe(hoje);

    const [contas, reservas, docs, contratos, realizado] = await Promise.all([
      query<{ slug: string; name: string; kind: string; current_balance_cents: number }>(
        `SELECT a.slug, a.name, a.kind, a.current_balance_cents
           FROM fin_account a JOIN fin_entity e ON e.id = a.entity_id
          WHERE e.slug = $1 AND a.is_active ORDER BY a.sort_order`,
        [ENTITY]
      ),

      query<{ target_cents: number; current_cents: number }>(
        `SELECT r.target_cents, r.current_cents FROM fin_reserve r
           JOIN fin_entity e ON e.id = r.entity_id
          WHERE e.slug = $1 AND r.is_active AND r.is_committed`,
        [ENTITY]
      ),

      // Todos os documentos em aberto, dos DOIS sentidos, cada um já com o seu
      // fator de recuperação calculado no SQL — um lugar só define a curva.
      //
      // A curva desconta pelo tempo de atraso porque o histórico mostra que
      // cobrança velha raramente volta inteira: 54% do vencido passa de 90
      // dias. Tratar tudo como 100% superestimaria o caixa em dezenas de
      // milhares de reais. Saída (pagar) nunca é descontada — dívida não
      // encolhe por otimismo.
      query<{
        direction: string;
        status: string;
        descricao: string;
        contraparte: string | null;
        due_date: string;
        data_prevista: string;
        bruto_cents: number;
        fator: number;
      }>(
        `SELECT d.direction, d.status, d.description AS descricao, cp.name AS contraparte,
                d.due_date::text AS due_date,
                COALESCE(d.expected_cash_date, d.due_date)::text AS data_prevista,
                (d.amount_cents - d.settled_cents) AS bruto_cents,
                CASE WHEN d.direction = 'pagar' THEN 1.0
                     WHEN d.due_date >= $2::date THEN 1.0
                     WHEN $2::date - d.due_date <= 30 THEN 0.90
                     WHEN $2::date - d.due_date <= 60 THEN 0.70
                     WHEN $2::date - d.due_date <= 90 THEN 0.50
                     ELSE 0.20 END AS fator
           FROM fin_document d
           JOIN fin_entity e ON e.id = d.entity_id
           LEFT JOIN fin_counterparty cp ON cp.id = d.counterparty_id
          WHERE e.slug = $1
            AND ((d.direction = 'receber' AND d.status IN ('emitido', 'parcial', 'confirmado'))
              OR (d.direction = 'pagar' AND d.status IN ('previsto', 'emitido', 'parcial', 'confirmado')))
            AND (d.amount_cents - d.settled_cents) > 0`,
        [ENTITY, hoje]
      ),

      query<{ nome: string; valor_cents: number; day_of_month: number | null }>(
        `SELECT c.name AS nome, c.amount_cents AS valor_cents, c.day_of_month
           FROM fin_contract c JOIN fin_entity e ON e.id = c.entity_id
          WHERE e.slug = $1 AND c.status = 'ativo' AND c.recurrence = 'mensal' AND c.direction = 'receber'`,
        [ENTITY]
      ),

      // O realizado do mês corrente, dia a dia — os invariantes do ledger
      // (`transfer_status <> 'pareado' AND NOT is_split_parent`) valem aqui
      // como em toda soma de dinheiro sobre fin_transaction.
      query<{ dia: string; entradas: number; saidas: number }>(
        `SELECT t.posted_on::text AS dia,
                COALESCE(SUM(t.amount_cents) FILTER (WHERE t.amount_cents > 0), 0) AS entradas,
                COALESCE(SUM(t.amount_cents) FILTER (WHERE t.amount_cents < 0), 0) AS saidas
           FROM fin_transaction t JOIN fin_entity e ON e.id = t.entity_id
          WHERE e.slug = $1 AND t.transfer_status <> 'pareado' AND NOT t.is_split_parent
            AND t.posted_on >= $2::date AND t.posted_on <= $3::date
          GROUP BY 1 ORDER BY 1`,
        [ENTITY, mesAtual, hoje]
      )
    ]);

    // ── L0: o que existe de fato, menos o que já tem dono ──────────────────
    const saldoContasCents = contas
      .filter((c) => c.kind !== "emprestimo")
      .reduce((sum, c) => sum + c.current_balance_cents, 0);
    const reservasSeparadasCents = reservas.reduce((sum, r) => sum + r.current_cents, 0);
    const metaReservasCents = reservas.reduce((sum, r) => sum + r.target_cents, 0);
    const disponivelCents = saldoContasCents - reservasSeparadasCents;

    // ── L1: documentos a receber, com o fator aplicado doc a doc ───────────
    const docsPrevistos: (DocPrevisto & { direction: string })[] = docs.map((d) => ({
      direction: d.direction,
      descricao: d.descricao,
      contraparte: d.contraparte,
      status: d.status,
      dueDate: d.due_date,
      dataPrevista: d.data_prevista,
      brutoCents: d.bruto_cents,
      fator: d.fator,
      ajustadoCents: Math.round(d.bruto_cents * d.fator)
    }));
    const receber = docsPrevistos.filter((d) => d.direction === "receber");
    const pagar = docsPrevistos.filter((d) => d.direction === "pagar");

    // 'confirmado' fica numa classe própria: o gateway diz que o pagamento
    // compensou, mas o crédito nunca apareceu no ledger e TODAS as datas
    // previstas já passaram (a mais antiga é de 2021). Isso é dado estagnado,
    // não dinheiro a caminho — recebe a mesma curva do vencido e uma etiqueta
    // separada na tela, em vez de inflar o "a vencer".
    const aVencerDocs = receber.filter((d) => d.status !== "confirmado" && d.dueDate >= hoje);
    const vencidoDocs = receber.filter((d) => d.status !== "confirmado" && d.dueDate < hoje);
    const confirmadoDocs = receber.filter((d) => d.status === "confirmado");

    const soma = (lista: { brutoCents: number }[]) => lista.reduce((s, d) => s + d.brutoCents, 0);
    const somaAjustado = (lista: { ajustadoCents: number }[]) => lista.reduce((s, d) => s + d.ajustadoCents, 0);

    const faixasDef = [
      { faixa: "até 30 dias", fator: 0.9, min: 1, max: 30 },
      { faixa: "31–60 dias", fator: 0.7, min: 31, max: 60 },
      { faixa: "61–90 dias", fator: 0.5, min: 61, max: 90 },
      { faixa: "mais de 90 dias", fator: 0.2, min: 91, max: Infinity }
    ];
    const faixas = faixasDef.map((f) => {
      const naFaixa = vencidoDocs.filter((d) => {
        const atraso = diasEntre(d.dueDate, hoje);
        return atraso >= f.min && atraso <= f.max;
      });
      return {
        faixa: f.faixa,
        fator: f.fator,
        brutoCents: soma(naFaixa),
        ajustadoCents: somaAjustado(naFaixa),
        n: naFaixa.length
      };
    });

    // ── L2: recorrência contratada (pode ser vazia — e hoje é) ─────────────
    const l2MensalCents = contratos.reduce((sum, c) => sum + c.valor_cents, 0);

    // ── Tabela mensal ──────────────────────────────────────────────────────
    // Documento com data prevista no passado não pode "entrar" num mês que já
    // acabou: rola para o mês corrente, com o fator da curva. É a escolha menos
    // errada — a alternativa seria sumir com ele da projeção.
    const mesesHorizonte = Array.from({ length: HORIZONTE_MESES }, (_, i) => somaMeses(mesAtual, i));
    const ultimoMes = mesesHorizonte[mesesHorizonte.length - 1];
    const bucketDe = (d: DocPrevisto) => {
      const mes = mesDe(d.dataPrevista);
      return mes < mesAtual ? mesAtual : mes;
    };

    const alemDocs = receber.filter((d) => bucketDe(d) > ultimoMes);
    const diaDoMes = (contrato: { day_of_month: number | null }, mes: string) => {
      const ultimo = Number(ultimoDiaDoMes(mes).slice(8, 10));
      return Math.min(contrato.day_of_month ?? 1, ultimo);
    };

    let abertura = disponivelCents;
    const meses: LinhaMes[] = mesesHorizonte.map((mes) => {
      const receberMes = receber.filter((d) => bucketDe(d) === mes);
      const pagarMes = pagar.filter((d) => bucketDe(d) === mes);
      // Contrato mensal entra em todo mês do horizonte; no mês corrente, só se
      // o dia de vencimento ainda não passou.
      const l2Cents = contratos.reduce((sum, c) => {
        if (mes === mesAtual && diaDoMes(c, mes) < Number(hoje.slice(8, 10))) return sum;
        return sum + c.valor_cents;
      }, 0);
      const l1Cents = somaAjustado(receberMes);
      const l3Cents = somaAjustado(pagarMes);
      const fechamento = abertura + l1Cents + l2Cents - l3Cents;
      const linha: LinhaMes = {
        mes,
        aberturaCents: abertura,
        l1Cents,
        l2Cents,
        l3Cents,
        fechamentoCents: fechamento,
        docs: [...receberMes, ...pagarMes]
          .sort((a, b) => b.ajustadoCents - a.ajustadoCents)
          .slice(0, 10)
          .map(({ direction: _direction, ...doc }) => doc),
        nDocs: receberMes.length + pagarMes.length
      };
      abertura = fechamento;
      return linha;
    });

    // ── Grade diária: mês corrente + próximo, sem espalhar por média ───────
    // Passado = realizado (fin_transaction). Futuro = documentos na sua data
    // prevista EXATA; o que não tem data futura confiável fica de fora e é
    // declarado na tela — dia inventado é pior que lacuna visível.
    const fimJanela = ultimoDiaDoMes(somaMeses(mesAtual, 1));
    const realizadoPorDia = new Map(realizado.map((r) => [r.dia, r]));
    const esperadoPorDia = new Map<string, { entrada: number; saida: number }>();
    for (const d of docsPrevistos) {
      if (d.dataPrevista < hoje || d.dataPrevista > fimJanela) continue;
      const alvo = esperadoPorDia.get(d.dataPrevista) ?? { entrada: 0, saida: 0 };
      if (d.direction === "receber") alvo.entrada += d.ajustadoCents;
      else alvo.saida += d.ajustadoCents;
      esperadoPorDia.set(d.dataPrevista, alvo);
    }
    for (const c of contratos) {
      for (const mes of [mesAtual, somaMeses(mesAtual, 1)]) {
        const dia = `${mes.slice(0, 8)}${String(diaDoMes(c, mes)).padStart(2, "0")}`;
        if (dia < hoje || dia > fimJanela) continue;
        const alvo = esperadoPorDia.get(dia) ?? { entrada: 0, saida: 0 };
        alvo.entrada += c.valor_cents;
        esperadoPorDia.set(dia, alvo);
      }
    }

    // Âncora do saldo: o saldo atual das contas já contém tudo que foi
    // realizado até agora. Recuar o realizado do mês devolve a abertura do dia
    // 1º; a partir daí a caminhada soma realizado no passado e previsto do
    // hoje em diante.
    const netRealizado = realizado.reduce((sum, r) => sum + r.entradas + r.saidas, 0);
    let saldo = disponivelCents - netRealizado;
    const grade: LinhaDia[] = [];
    for (let dia = mesAtual; dia <= fimJanela; dia = addDays(dia, 1)) {
      const passado = dia < hoje;
      const real = realizadoPorDia.get(dia);
      const esperado = esperadoPorDia.get(dia);
      let entrada = 0;
      let saida = 0;
      if (passado) {
        entrada = real?.entradas ?? 0;
        saida = Math.abs(real?.saidas ?? 0);
        saldo += (real?.entradas ?? 0) + (real?.saidas ?? 0);
      } else if (dia === hoje) {
        // Hoje mistura os dois mundos: o realizado até agora (a âncora o
        // removeu junto com o resto do mês, então volta aqui) e o previsto
        // ainda em aberto. Na linha, os dois aparecem somados.
        entrada = (real?.entradas ?? 0) + (esperado?.entrada ?? 0);
        saida = Math.abs(real?.saidas ?? 0) + (esperado?.saida ?? 0);
        saldo += (real?.entradas ?? 0) + (real?.saidas ?? 0) + (esperado?.entrada ?? 0) - (esperado?.saida ?? 0);
      } else {
        entrada = esperado?.entrada ?? 0;
        saida = esperado?.saida ?? 0;
        saldo += entrada - saida;
      }
      grade.push({
        dia,
        entradaCents: entrada,
        saidaCents: saida,
        saldoCents: saldo,
        realizado: passado,
        hoje: dia === hoje,
        minimo: false
      });
    }
    if (grade.length) {
      let iMin = 0;
      grade.forEach((linha, i) => {
        if (linha.saldoCents < grade[iMin].saldoCents) iMin = i;
      });
      grade[iMin].minimo = true;
    }

    return {
      disponivel: true,
      hoje,
      l0: {
        contas: contas.map((c) => ({ slug: c.slug, name: c.name, kind: c.kind, saldoCents: c.current_balance_cents })),
        saldoContasCents,
        reservasSeparadasCents,
        disponivelCents,
        metaReservasCents
      },
      l1: {
        brutoCents: soma(receber),
        ajustadoCents: somaAjustado(receber),
        aVencer: { brutoCents: soma(aVencerDocs), n: aVencerDocs.length },
        vencido: {
          brutoCents: soma(vencidoDocs),
          ajustadoCents: somaAjustado(vencidoDocs),
          n: vencidoDocs.length,
          faixas
        },
        confirmado: {
          brutoCents: soma(confirmadoDocs),
          ajustadoCents: somaAjustado(confirmadoDocs),
          n: confirmadoDocs.length
        },
        semDataFuturaCents: somaAjustado(receber.filter((d) => d.dataPrevista < hoje)),
        alemHorizonte: { ajustadoCents: somaAjustado(alemDocs), n: alemDocs.length }
      },
      l2: {
        contratos: contratos.map((c) => ({ nome: c.nome, valorCents: c.valor_cents })),
        mensalCents: l2MensalCents
      },
      l3: { n: pagar.length, abertoCents: soma(pagar) },
      grade,
      meses
    };
  } catch (error) {
    console.error("[financeiro] previsão de fluxo indisponível:", error);
    return previsaoIndisponivel();
  }
}

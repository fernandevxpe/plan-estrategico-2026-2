import "server-only";

import ExcelJS from "exceljs";

import { query } from "./db";

/**
 * Extrato bancário para download — XLSX organizado e CSV simples.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ISTO NÃO É `Contrato<T>`
 * ---------------------------------------------------------------------------
 * Todo o resto de `lib/financeiro/contratos/*` devolve um envelope para uma
 * tela renderizar. Isto devolve um ARQUIVO para alguém baixar e abrir no
 * Excel — não há "indeterminado" para mostrar numa célula, só linhas que
 * existem ou não. A honestidade aqui é outra: a planilha declara, na aba
 * Resumo, o período que foi PEDIDO e o período que cada conta de fato
 * COBRE — nunca finge que os dois são a mesma coisa.
 *
 * ---------------------------------------------------------------------------
 * A REGRA DE OURO DO LEDGER, RESPEITADA AQUI TAMBÉM
 * ---------------------------------------------------------------------------
 * `NOT is_split_parent` — a mesma exclusão que toda consulta de saldo deste
 * projeto usa. Uma linha-pai de split soma o mesmo dinheiro que os filhos
 * dela já contam; incluir as duas dobraria o extrato.
 */

export type LinhaExtrato = {
  contaSlug: string;
  contaNome: string;
  instituicao: string;
  data: string;
  descricao: string;
  contraparte: string | null;
  documento: string | null;
  categoria: string | null;
  nucleo: string | null;
  entradaCents: number | null;
  saidaCents: number | null;
  saldoAposCents: number | null;
  conciliacao: string | null;
};

export type ContaExtrato = {
  slug: string;
  nome: string;
  instituicao: string;
};

export async function contasDisponiveis(): Promise<ContaExtrato[]> {
  const linhas = await query<{ slug: string; name: string; institution: string }>(
    `SELECT slug, name, institution FROM fin_account WHERE is_active ORDER BY sort_order`
  );
  return linhas.map((r) => ({ slug: r.slug, nome: r.name, instituicao: r.institution }));
}

export async function buscarLinhasExtrato(args: {
  contas: string[];
  de: string;
  ate: string;
}): Promise<LinhaExtrato[]> {
  const linhas = await query<Record<string, unknown>>(
    `SELECT a.slug AS conta_slug, a.name AS conta_nome, a.institution,
            t.posted_on::text AS data,
            COALESCE(NULLIF(t.description_norm, ''), t.description_raw, '(sem descrição)') AS descricao,
            COALESCE(cp.name, t.counterparty_raw) AS contraparte,
            t.counterparty_document AS documento,
            cat.name AS categoria,
            t.nucleo,
            t.amount_cents,
            t.balance_after_cents,
            t.reconciled_status
       FROM fin_transaction t
       JOIN fin_account a ON a.id = t.account_id
       LEFT JOIN fin_counterparty cp ON cp.id = t.counterparty_id
       LEFT JOIN fin_category cat ON cat.id = t.category_id
      WHERE NOT t.is_split_parent
        AND a.slug = ANY($1::text[])
        AND t.posted_on BETWEEN $2::date AND $3::date
      ORDER BY a.sort_order, t.posted_on, t.id`,
    [args.contas, args.de, args.ate]
  );

  return linhas.map((r) => {
    const cents = Number(r.amount_cents);
    return {
      contaSlug: String(r.conta_slug),
      contaNome: String(r.conta_nome),
      instituicao: String(r.institution ?? ""),
      data: String(r.data),
      descricao: String(r.descricao),
      contraparte: (r.contraparte as string) ?? null,
      documento: (r.documento as string) ?? null,
      categoria: (r.categoria as string) ?? null,
      nucleo: (r.nucleo as string) ?? null,
      entradaCents: cents > 0 ? cents : null,
      saidaCents: cents < 0 ? Math.abs(cents) : null,
      saldoAposCents: r.balance_after_cents === null ? null : Number(r.balance_after_cents),
      conciliacao: (r.reconciled_status as string) ?? null
    };
  });
}

const brl = (cents: number | null) =>
  cents === null ? "" : (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const diaBr = (iso: string) => iso.split("-").reverse().join("/");

// ---------------------------------------------------------------------------
// CSV — simples, de propósito. Um arquivo só, com a coluna "conta" para
// distinguir quando mais de uma foi pedida junto.
// ---------------------------------------------------------------------------
export function montarCsv(linhas: LinhaExtrato[]): string {
  const cab = [
    "Data",
    "Conta",
    "Instituicao",
    "Descricao",
    "Contraparte",
    "Documento",
    "Categoria",
    "Nucleo",
    "Entrada",
    "Saida",
    "Saldo",
    "Conciliacao"
  ];
  const escapar = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const linhasCsv = linhas.map((l) =>
    [
      diaBr(l.data),
      l.contaNome,
      l.instituicao,
      l.descricao,
      l.contraparte ?? "",
      l.documento ?? "",
      l.categoria ?? "",
      l.nucleo ?? "",
      l.entradaCents !== null ? (l.entradaCents / 100).toFixed(2) : "",
      l.saidaCents !== null ? (l.saidaCents / 100).toFixed(2) : "",
      l.saldoAposCents !== null ? (l.saldoAposCents / 100).toFixed(2) : "",
      l.conciliacao ?? ""
    ]
      .map(escapar)
      .join(",")
  );
  // BOM na frente: sem isso o Excel abre acento errado num CSV UTF-8.
  return "﻿" + [cab.join(","), ...linhasCsv].join("\r\n");
}

// ---------------------------------------------------------------------------
// XLSX — uma aba Resumo + uma aba por conta, formatada para conferência
// contábil: cabeçalho fixo, moeda em formato de moeda, totais no rodapé.
// ---------------------------------------------------------------------------
const COR_CABECALHO = "FF1C4E80";
const COR_TEXTO_CABECALHO = "FFFFFFFF";
const COR_TOTAL = "FFEFF3F7";

export async function montarXlsx(args: {
  linhas: LinhaExtrato[];
  contas: ContaExtrato[];
  de: string;
  ate: string;
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "XPE — Plataforma financeira";
  wb.created = new Date();

  const porConta = new Map<string, LinhaExtrato[]>();
  for (const l of args.linhas) {
    const lista = porConta.get(l.contaSlug) ?? [];
    lista.push(l);
    porConta.set(l.contaSlug, lista);
  }

  // ---- Resumo ----
  const resumo = wb.addWorksheet("Resumo");
  resumo.columns = [
    { header: "Conta", key: "conta", width: 24 },
    { header: "Instituição", key: "instituicao", width: 16 },
    { header: "Lançamentos", key: "n", width: 14 },
    { header: "Primeiro lançamento no período", key: "primeiro", width: 26 },
    { header: "Último lançamento no período", key: "ultimo", width: 26 },
    { header: "Entradas", key: "entradas", width: 16 },
    { header: "Saídas", key: "saidas", width: 16 }
  ];
  estilizarCabecalho(resumo.getRow(1));

  resumo.insertRow(1, [`Extrato solicitado: ${diaBr(args.de)} a ${diaBr(args.ate)}`]);
  resumo.mergeCells(1, 1, 1, 7);
  const tituloResumo = resumo.getCell(1, 1);
  tituloResumo.font = { bold: true, size: 13 };
  resumo.insertRow(2, []);

  for (const conta of args.contas) {
    const doConta = (porConta.get(conta.slug) ?? []).slice().sort((a, b) => a.data.localeCompare(b.data));
    const entradas = doConta.reduce((s, l) => s + (l.entradaCents ?? 0), 0);
    const saidas = doConta.reduce((s, l) => s + (l.saidaCents ?? 0), 0);
    const linha = resumo.addRow({
      conta: conta.nome,
      instituicao: conta.instituicao,
      n: doConta.length,
      primeiro: doConta[0] ? diaBr(doConta[0].data) : "sem lançamento no período",
      ultimo: doConta[doConta.length - 1] ? diaBr(doConta[doConta.length - 1].data) : "sem lançamento no período",
      entradas: entradas / 100,
      saidas: saidas / 100
    });
    linha.getCell("entradas").numFmt = '"R$" #,##0.00';
    linha.getCell("saidas").numFmt = '"R$" #,##0.00';
    if (doConta.length === 0) {
      linha.font = { italic: true, color: { argb: "FF8A8A8A" } };
    }
  }
  const nota = resumo.addRow([
    "O período coberto por conta pode ser menor que o solicitado — isso é ausência de extrato" +
      " importado, não ausência de movimento. Cada aba mostra só o que este acervo tem."
  ]);
  resumo.mergeCells(nota.number, 1, nota.number, 7);
  nota.getCell(1).font = { italic: true, size: 10, color: { argb: "FF6B6B6B" } };
  nota.getCell(1).alignment = { wrapText: true };

  // ---- Uma aba por conta ----
  for (const conta of args.contas) {
    const doConta = (porConta.get(conta.slug) ?? []).slice().sort((a, b) => a.data.localeCompare(b.data));
    const aba = wb.addWorksheet(nomeAbaValido(conta.nome));
    aba.columns = [
      { header: "Data", key: "data", width: 12 },
      { header: "Descrição", key: "descricao", width: 40 },
      { header: "Contraparte", key: "contraparte", width: 28 },
      { header: "Documento", key: "documento", width: 18 },
      { header: "Categoria", key: "categoria", width: 22 },
      { header: "Núcleo", key: "nucleo", width: 16 },
      { header: "Entrada", key: "entrada", width: 15 },
      { header: "Saída", key: "saida", width: 15 },
      { header: "Saldo", key: "saldo", width: 15 },
      { header: "Conciliação", key: "conciliacao", width: 14 }
    ];
    estilizarCabecalho(aba.getRow(1));
    aba.views = [{ state: "frozen", ySplit: 1 }];
    aba.autoFilter = { from: "A1", to: "J1" };

    for (const l of doConta) {
      const linha = aba.addRow({
        data: diaBr(l.data),
        descricao: l.descricao,
        contraparte: l.contraparte ?? "",
        documento: l.documento ?? "",
        categoria: l.categoria ?? "",
        nucleo: l.nucleo ?? "",
        entrada: l.entradaCents !== null ? l.entradaCents / 100 : null,
        saida: l.saidaCents !== null ? l.saidaCents / 100 : null,
        saldo: l.saldoAposCents !== null ? l.saldoAposCents / 100 : null,
        conciliacao: l.conciliacao ?? ""
      });
      linha.getCell("entrada").numFmt = '"R$" #,##0.00';
      linha.getCell("saida").numFmt = '"R$" #,##0.00';
      linha.getCell("saldo").numFmt = '"R$" #,##0.00';
    }

    if (doConta.length === 0) {
      const semDado = aba.addRow(["sem lançamento importado neste período"]);
      aba.mergeCells(semDado.number, 1, semDado.number, 10);
      semDado.getCell(1).font = { italic: true, color: { argb: "FF8A8A8A" } };
    } else {
      const entradas = doConta.reduce((s, l) => s + (l.entradaCents ?? 0), 0);
      const saidas = doConta.reduce((s, l) => s + (l.saidaCents ?? 0), 0);
      const totalRow = aba.addRow({
        descricao: "Total do período",
        entrada: entradas / 100,
        saida: saidas / 100
      });
      totalRow.font = { bold: true };
      totalRow.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COR_TOTAL } };
        cell.border = { top: { style: "thin", color: { argb: "FFB9C4CE" } } };
      });
      totalRow.getCell("entrada").numFmt = '"R$" #,##0.00';
      totalRow.getCell("saida").numFmt = '"R$" #,##0.00';
    }
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function estilizarCabecalho(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: COR_TEXTO_CABECALHO } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COR_CABECALHO } };
    cell.alignment = { vertical: "middle" };
  });
  row.height = 20;
}

/** Nome de aba do Excel: até 31 caracteres, sem `: \ / ? * [ ]`. */
function nomeAbaValido(nome: string): string {
  const limpo = nome.replace(/[:\\/?*[\]]/g, "-");
  return limpo.length > 31 ? limpo.slice(0, 31) : limpo;
}

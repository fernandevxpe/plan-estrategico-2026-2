import { toCents } from "../../../scripts/lib/fin-normalize.mjs";

import { parseCsv } from "./csv";
import { brDateToIso, periodOf, type BankParser, type ParsedRow, type ParseResult } from "./types";

/**
 * Extrato da conta Nubank (o CSV de "exportar extrato" do app).
 *
 * Cabeçalho fixo: `Data,Valor,Identificador,Descrição`
 *   · Data em DD/MM/YYYY;
 *   · Valor com ponto decimal ("-51.5", "1500.00") — formato do app, não pt-BR;
 *   · Identificador é um UUID ESTÁVEL por lançamento — a melhor chave de
 *     idempotência possível: reimportar um período sobreposto não duplica nada,
 *     sem heurística nenhuma.
 *
 * Não há coluna de saldo, então este parser não declara saldo final e a
 * conferência de saldo fica por conta do humano na tela.
 */
const HEADER = ["data", "valor", "identificador", "descrição"];

function normalizeHeader(cells: string[]): string[] {
  return cells.map((cell) => cell.trim().toLowerCase());
}

export const nubankCsvParser: BankParser = {
  id: "nubank_csv",
  accountSlug: "nubank",
  label: "Nubank (CSV)",

  detect(sample: string): number {
    const firstLine = sample.split(/\r?\n/, 1)[0] ?? "";
    const cells = normalizeHeader(firstLine.split(","));
    if (cells.length === 4 && HEADER.every((name, i) => cells[i] === name)) return 1;
    // Mesmas colunas em outra ordem: ainda é quase certamente Nubank.
    if (HEADER.every((name) => cells.includes(name))) return 0.8;
    return 0;
  },

  parse(text: string): ParseResult {
    const table = parseCsv(text, ",");
    if (!table.length) throw new Error("arquivo vazio");

    const header = normalizeHeader(table[0]);
    const col = {
      data: header.indexOf("data"),
      valor: header.indexOf("valor"),
      id: header.indexOf("identificador"),
      descricao: header.indexOf("descrição")
    };
    if (col.data === -1 || col.valor === -1 || col.id === -1) {
      throw new Error("cabeçalho não é o do extrato Nubank (esperado Data,Valor,Identificador,Descrição)");
    }

    const rows: ParsedRow[] = [];
    const warnings: string[] = [];

    for (let i = 1; i < table.length; i++) {
      const cells = table[i];
      const rowNumber = i + 1;
      const postedOn = brDateToIso(cells[col.data] ?? "");
      if (!postedOn) {
        warnings.push(`linha ${rowNumber}: data irreconhecível ("${cells[col.data] ?? ""}") — pulada`);
        continue;
      }
      let amountCents: number;
      try {
        amountCents = toCents(cells[col.valor]);
      } catch {
        warnings.push(`linha ${rowNumber}: valor irreconhecível ("${cells[col.valor] ?? ""}") — pulada`);
        continue;
      }
      if (amountCents === 0) {
        warnings.push(`linha ${rowNumber}: valor zero — pulada (zero não é lançamento)`);
        continue;
      }
      const sourceId = (cells[col.id] ?? "").trim();
      rows.push({
        rowNumber,
        postedOn,
        amountCents,
        descriptionRaw: (cells[col.descricao] ?? "").trim() || "(sem descrição)",
        sourceId: sourceId || undefined
      });
    }

    return { rows, warnings, ...periodOf(rows), declaredBalanceCents: null };
  }
};

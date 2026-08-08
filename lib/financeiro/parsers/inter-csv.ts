import { normalizeDescription, toCents } from "../../../scripts/lib/fin-normalize.mjs";

import { parseCsv } from "./csv";
import { brDateToIso, periodOf, type BankParser, type ParsedRow, type ParseResult } from "./types";

/**
 * Extrato da conta Banco Inter (CSV exportado do app/site).
 *
 * As diferenças que importam contra o Nubank:
 *   · separador `;` e decimal com vírgula ("1.500,00");
 *   · o arquivo costuma vir em windows-1252 — a DECODIFICAÇÃO acontece antes,
 *     em detect.ts (utf-8 com fallback latin1), este parser já recebe texto;
 *   · há um preâmbulo ("Extrato Conta Corrente", "Conta;...", "Período;...")
 *     antes do cabeçalho real — o parser o procura em vez de assumir linha 1;
 *   · NÃO há id estável por lançamento. A idempotência fica com o hash por
 *     chave natural (data, valor, descrição normalizada, ordinal) — e é por
 *     isso que a coluna Saldo é preciosa: é a conferência externa que pega
 *     linha faltando.
 */
function headerCells(cells: string[]): string[] {
  return cells.map((cell) => normalizeDescription(cell));
}

export const interCsvParser: BankParser = {
  id: "inter_csv",
  accountSlug: "inter",
  label: "Inter (CSV)",

  detect(sample: string): number {
    const lines = sample.split(/\r?\n/).slice(0, 12);
    const hasHeader = lines.some((line) => {
      if (!line.includes(";")) return false;
      const cells = headerCells(line.split(";"));
      return cells.some((c) => c.startsWith("data")) && cells.includes("valor");
    });
    if (!hasHeader) return 0;
    if (normalizeDescription(sample.slice(0, 200)).includes("extrato")) return 0.95;
    return 0.7;
  },

  parse(text: string): ParseResult {
    const table = parseCsv(text, ";");
    // O cabeçalho real é a primeira linha com uma coluna "data..." e uma
    // coluna "valor" — tudo antes é preâmbulo do banco.
    const headerIndex = table.findIndex((cells) => {
      const names = headerCells(cells);
      return names.some((c) => c.startsWith("data")) && names.includes("valor");
    });
    if (headerIndex === -1) throw new Error("cabeçalho do extrato Inter não encontrado (esperado Data Lançamento;...;Valor;Saldo)");

    const names = headerCells(table[headerIndex]);
    const col = {
      data: names.findIndex((c) => c.startsWith("data")),
      valor: names.indexOf("valor"),
      saldo: names.indexOf("saldo"),
      // Exportações novas trazem "Histórico" e "Descrição"; antigas só uma.
      texto: names
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => c.includes("descricao") || c.includes("historico") || c.includes("lancamento"))
        .map(({ i }) => i)
        .filter((i) => i !== -1)
    };
    if (!col.texto.length) {
      col.texto = names.map((_, i) => i).filter((i) => i !== col.data && i !== col.valor && i !== col.saldo);
    }

    const rows: ParsedRow[] = [];
    const warnings: string[] = [];

    for (let i = headerIndex + 1; i < table.length; i++) {
      const cells = table[i];
      const rowNumber = i + 1;
      const postedOn = brDateToIso(cells[col.data] ?? "");
      if (!postedOn) {
        // Linhas de rodapé/subtotal do Inter não têm data; só avisa se parecia lançamento.
        if ((cells[col.valor] ?? "").trim()) {
          warnings.push(`linha ${rowNumber}: data irreconhecível ("${cells[col.data] ?? ""}") — pulada`);
        }
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

      let balanceAfterCents: number | undefined;
      if (col.saldo !== -1) {
        try {
          const saldo = (cells[col.saldo] ?? "").trim();
          balanceAfterCents = saldo ? toCents(saldo) : undefined;
        } catch {
          warnings.push(`linha ${rowNumber}: saldo irreconhecível ("${cells[col.saldo]}") — lançamento mantido sem saldo`);
        }
      }

      const descricao = col.texto
        .map((idx) => (cells[idx] ?? "").trim())
        .filter(Boolean)
        .join(" — ");

      rows.push({
        rowNumber,
        postedOn,
        amountCents,
        descriptionRaw: descricao || "(sem descrição)",
        balanceAfterCents
      });
    }

    // Saldo declarado = saldo da linha cronologicamente ÚLTIMA (o extrato pode
    // vir do mais novo para o mais velho; a ordem do arquivo não é confiável).
    let declaredBalanceCents: number | null = null;
    let latest: ParsedRow | null = null;
    for (const row of rows) {
      if (row.balanceAfterCents === undefined) continue;
      if (!latest || row.postedOn >= latest.postedOn) latest = row;
    }
    if (latest?.balanceAfterCents !== undefined) declaredBalanceCents = latest.balanceAfterCents;

    return { rows, warnings, ...periodOf(rows), declaredBalanceCents };
  }
};

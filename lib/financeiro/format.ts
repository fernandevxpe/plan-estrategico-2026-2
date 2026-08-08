import { brl as brlHeadline, monthLabel } from "@/lib/analysis/format";

/**
 * Formatação de dinheiro no módulo financeiro.
 *
 * O `brl` da plataforma usa `maximumFractionDigits: 0`. Isso é correto num
 * painel que mostra R$ 1,2 mi e ERRADO numa tela de conciliação, onde o centavo
 * é justamente o que decide se um PIX de R$ 1.350,00 casa com uma cobrança de
 * R$ 1.350,00 ou de R$ 1.349,99.
 *
 * Regra: `brl` para manchete e KPI, `brlPrecise` para toda tabela, preview de
 * importação e tela de casamento.
 */
export { brlHeadline as brl, monthLabel };

const preciseFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

/** Centavos → "R$ 1.350,00". Para tabela e conciliação. */
export function brlPrecise(cents: number | null | undefined) {
  if (cents === null || cents === undefined) return "—";
  return preciseFormatter.format(cents / 100);
}

/** Centavos → "R$ 1.350" (sem centavos). Para KPI e título. */
export function brlCents(cents: number | null | undefined) {
  if (cents === null || cents === undefined) return "—";
  return brlHeadline.format(cents / 100);
}

/**
 * Centavos → "R$ 1,2 mi" / "R$ 240 mil".
 *
 * Cabeçalho de KPI onde a ordem de grandeza importa mais que o dígito — o olho
 * compara "1,2 mi" e "240 mil" mais rápido do que sete dígitos.
 */
export function brlCompact(cents: number | null | undefined) {
  if (cents === null || cents === undefined) return "—";
  const value = cents / 100;
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `R$ ${(value / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mi`;
  if (abs >= 1_000) return `R$ ${(value / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil`;
  return brlHeadline.format(value);
}

/** "2026-08-07" → "07/08/2026". Sem passar por Date: data pura não tem fuso. */
export function dateLabel(iso: string | null | undefined) {
  if (!iso) return "—";
  const [year, month, day] = iso.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

/** "2026-08-07" → "07 ago". Para eixo de gráfico e tabela densa. */
export function shortDateLabel(iso: string | null | undefined) {
  if (!iso) return "—";
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" })
    .format(new Date(year, month - 1, day))
    .replace(".", "");
}

/** "2026-08-01" (primeiro dia do mês) → "ago 26". */
export function monthKeyLabel(iso: string) {
  return monthLabel(iso.slice(0, 7));
}

export function pct(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}

/** Quantos dias separam uma data ISO de hoje. Negativo = no futuro. */
export function daysSince(iso: string | null | undefined) {
  if (!iso) return null;
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  const then = Date.UTC(year, month - 1, day);
  const today = new Date();
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((now - then) / 86_400_000);
}

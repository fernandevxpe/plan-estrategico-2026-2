export const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0
});

export const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

export function monthLabel(month: string) {
  const [year, rawMonth] = month.split("-");
  const date = new Date(Number(year), Number(rawMonth) - 1, 1);
  return new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit" })
    .format(date)
    .replace(".", "");
}

export function formatGrowth(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "n/a";
  return `${value >= 0 ? "+" : ""}${number.format(value)}%`;
}

export function quarterLabel(key: string) {
  const [year, quarter] = key.split("-");
  return `${quarter} ${year}`;
}

export function semesterLabel(key: string) {
  const [year, half] = key.split("-");
  return half === "H1" ? `1º sem ${year}` : `2º sem ${year}`;
}

export function serviceClass(service: string) {
  return service.toLowerCase().includes("obra") ? "amber" : "green";
}

export function formatIndicatorValue(value: number, unit: string) {
  if (unit === "currency") return brl.format(value);
  if (unit === "percent") return formatGrowth(value);
  return Number(value).toLocaleString("pt-BR");
}

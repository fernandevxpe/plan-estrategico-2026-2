export function parseGestaoNumber(value: string | null | undefined): number | null {
  if (!value?.trim()) return null;
  const cleaned = value.replace(/[^\d.,-]/g, "").replace(",", ".");
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

export type GestaoIndicadorStatus = "ok" | "bad" | "neutral";

export function evaluateIndicadorStatus(
  meta: string | null,
  valor: string | null,
  tipo?: string
): GestaoIndicadorStatus {
  if (!meta?.trim() || !valor?.trim()) return "neutral";

  const metaLower = meta.toLowerCase().trim();
  const valorLower = valor.toLowerCase().trim();

  if (tipo === "sim_nao") {
    if (metaLower === "sim" && (valorLower === "sim" || valorLower === "s")) return "ok";
    if (metaLower === "sim") return "bad";
    return "neutral";
  }

  const metaNum = parseGestaoNumber(meta);
  const valorNum = parseGestaoNumber(valor);
  if (metaNum === null || valorNum === null) return "neutral";

  if (meta.includes("≥") || meta.includes(">=")) return valorNum >= metaNum ? "ok" : "bad";
  if (meta.includes("≤") || meta.includes("<=")) return valorNum <= metaNum ? "ok" : "bad";
  if (meta.includes(">") && !meta.includes("=")) return valorNum > metaNum ? "ok" : "bad";
  if (meta.includes("<") && !meta.includes("=")) return valorNum < metaNum ? "ok" : "bad";

  return valorNum === metaNum ? "ok" : "bad";
}

export function indicadorKey(ind: { id?: string; nome: string }) {
  return ind.id ?? ind.nome;
}

const ORIGEM_LABELS: Record<string, string> = {
  manual: "Manual",
  crm: "CRM",
  crm_parcial: "CRM parcial",
  crm_snapshot: "CRM snapshot",
  analise: "Análise"
};

const ORIGEM_SHORT: Record<string, string> = {
  manual: "manual",
  crm: "crm",
  crm_parcial: "parcial",
  crm_snapshot: "snap",
  analise: "auto"
};

export function origemLabel(origem?: string) {
  if (!origem) return null;
  return ORIGEM_LABELS[origem] ?? origem;
}

export function origemShortLabel(origem?: string) {
  if (!origem) return null;
  return ORIGEM_SHORT[origem] ?? origem;
}

export function origemClass(origem?: string) {
  if (origem === "crm") return "crm";
  if (origem === "crm_parcial") return "crm-partial";
  if (origem === "crm_snapshot") return "crm-snapshot";
  if (origem === "analise") return "analise";
  return "manual";
}

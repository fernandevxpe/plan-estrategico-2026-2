import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { MAIN_PIPELINE_ID } from "@/lib/gestao-xpe/pipeline-config";
import { pipedriveDateInRange } from "@/lib/gestao-xpe/pipedrive-datetime";

export { MAIN_PIPELINE_ID, MAIN_PIPELINE_NAME } from "@/lib/gestao-xpe/pipeline-config";

export type WonDealRow = {
  addTime: string;
  wonTime: string;
  value: number;
  origin: string;
  channel: string;
  stage: string;
  labels: string;
  seller: string | null;
  dealId?: number;
};

export type PipelineDeal = {
  id: number;
  status: string;
  addTime: string;
  wonTime: string | null;
  stageChangeTime: string | null;
  value: number;
  channel: string | null;
  seller: string | null;
  stageId: number | null;
};

/** Estágios do pipeline [Exec] Laudos - Condo usados como proxy de fluxo semanal. */
export const EXEC_STAGE_IDS = {
  reuniaoMarcada: 84,
  diagnostico: 86,
  negociacao: 87,
  fechamento: 88,
  relacionamento: 89
} as const;

/** Follow-ups de negociação: negócios em Negociação, Fechamento ou Relacionamento. */
export const NEGOTIATION_STAGE_IDS = new Set<number>([
  EXEC_STAGE_IDS.negociacao,
  EXEC_STAGE_IDS.fechamento,
  EXEC_STAGE_IDS.relacionamento
]);

export function isNegotiationStage(stageId: number | null | undefined): boolean {
  return stageId != null && NEGOTIATION_STAGE_IDS.has(stageId);
}

const SELLER_LABELS = new Set(["GABRIEL", "IGOR", "JONILDO"]);

export function parseSellerFromLabels(labelsRaw: string): string | null {
  if (!labelsRaw?.trim()) return null;
  const parts = labelsRaw.replace(/"/g, "").split(",");
  for (const part of parts) {
    const t = part.trim();
    if (SELLER_LABELS.has(t)) return t;
  }
  const first = parts[0]?.trim();
  if (
    first &&
    /^[A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-ZÁÉÍÓÚÂÊÔÃÕÇ\s]{1,24}$/.test(first) &&
    !/laudo|ldc|lie|icv|obra/i.test(first)
  ) {
    return first;
  }
  return null;
}

function titleCaseSeller(name: string) {
  return name.charAt(0) + name.slice(1).toLowerCase();
}

let channelLabelCache: Record<string, string> | null = null;

async function loadChannelLabels(): Promise<Record<string, string>> {
  if (channelLabelCache) return channelLabelCache;
  const file = path.join(process.cwd(), "data/raw/pipedrive-deal-fields.json");
  const fields = JSON.parse(await readFile(file, "utf8")).data as {
    key: string;
    options?: { id: string | number; label: string }[];
  }[];
  const channelField = fields.find((f) => f.key === "channel");
  channelLabelCache = Object.fromEntries(
    (channelField?.options ?? []).map((o) => [String(o.id), o.label])
  );
  return channelLabelCache;
}

let labelByIdCache: Record<string, string> | null = null;

async function loadLabelById(): Promise<Record<string, string>> {
  if (labelByIdCache) return labelByIdCache;
  const file = path.join(process.cwd(), "data/raw/pipedrive-deal-fields.json");
  const fields = JSON.parse(await readFile(file, "utf8")).data as {
    key: string;
    options?: { id: string | number; label: string }[];
  }[];
  const labelField = fields.find((f) => f.key === "label");
  labelByIdCache = Object.fromEntries(
    (labelField?.options ?? []).map((o) => [String(o.id), o.label])
  );
  return labelByIdCache;
}

function labelsRawFromDeal(label: unknown, labelById: Record<string, string>): string {
  if (label == null) return "";
  if (Array.isArray(label)) {
    return label.map((id) => labelById[String(id)] ?? String(id)).join(",");
  }
  const s = String(label);
  return s
    .split(",")
    .map((id) => labelById[id.trim()] ?? id.trim())
    .join(",");
}

export async function loadPipelineDeals(pipelineId = MAIN_PIPELINE_ID): Promise<PipelineDeal[]> {
  const [raw, channelById, labelById] = await Promise.all([
    readFile(path.join(process.cwd(), "data/raw/pipedrive-deals.json"), "utf8"),
    loadChannelLabels(),
    loadLabelById()
  ]);
  const deals = JSON.parse(raw).data as Record<string, unknown>[];
  return deals
    .filter((d) => d.pipeline_id === pipelineId)
    .map((d) => {
      const labelsRaw = labelsRawFromDeal(d.label, labelById);
      const channelId = d.channel != null ? String(d.channel) : "";
      return {
        id: d.id as number,
        status: String(d.status ?? ""),
        addTime: String(d.add_time ?? ""),
        wonTime: d.won_time ? String(d.won_time) : null,
        stageChangeTime: d.stage_change_time ? String(d.stage_change_time) : null,
        value: Number(d.value) || 0,
        channel: channelById[channelId] ?? (channelId || null),
        seller: parseSellerFromLabels(labelsRaw),
        stageId: (d.stage_id as number) ?? null
      };
    });
}

export async function loadWonDealRows(): Promise<WonDealRow[]> {
  const file = path.join(process.cwd(), "data/processed/won-deals.csv");
  const raw = await readFile(file, "utf8");
  const lines = raw.split("\n").slice(1);
  const rows: WonDealRow[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = line.split(";");
    const pipelineId = Number(cols[14]) || 0;
    if (pipelineId !== MAIN_PIPELINE_ID) continue;
    const labels = cols[25] ?? "";
    rows.push({
      dealId: Number(cols[0]) || undefined,
      addTime: cols[5] ?? "",
      wonTime: cols[7] ?? "",
      value: Number(cols[3]) || 0,
      origin: cols[24] ?? "",
      channel: cols[23] ?? "",
      stage: cols[15] ?? "",
      labels,
      seller: parseSellerFromLabels(labels)
    });
  }
  return rows;
}

export async function listCrmSellers(): Promise<{ id: string; label: string }[]> {
  const deals = await loadPipelineDeals();
  const names = new Set<string>();
  for (const d of deals) {
    if (d.seller && SELLER_LABELS.has(d.seller)) names.add(d.seller);
  }
  return [...names]
    .sort()
    .map((id) => ({ id, label: titleCaseSeller(id) }));
}

export function filterBySeller<T extends { seller: string | null }>(
  rows: T[],
  vendedor: string | null | undefined
) {
  if (!vendedor || vendedor === "todos") return rows;
  return rows.filter((r) => r.seller === vendedor);
}

export function dealIdsForSeller(
  deals: PipelineDeal[],
  vendedor: string | null | undefined
): Set<number> | null {
  if (!vendedor || vendedor === "todos") return null;
  return new Set(deals.filter((d) => d.seller === vendedor).map((d) => d.id));
}

export function isIndicacaoChannel(channel: string | null): boolean {
  return /indicação|indicacao/i.test(channel ?? "");
}

/** Negócios que entraram no estágio (stage_change_time) dentro do período. */
export function countDealsStageChangeInRange(
  deals: PipelineDeal[],
  stageId: number,
  rangeStart: string,
  rangeEnd: string,
  allowedDealIds: Set<number> | null
): number {
  return deals.filter((d) => {
    if (d.stageId !== stageId) return false;
    if (allowedDealIds && !allowedDealIds.has(d.id)) return false;
    return pipedriveDateInRange(d.stageChangeTime, rangeStart, rangeEnd);
  }).length;
}

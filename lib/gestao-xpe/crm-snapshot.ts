import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Recorte do CRM que a Gestão XPE lê em runtime.
 *
 * Vive em data/processed/ (versionado) e não em data/raw/ (gitignored): os
 * arquivos brutos passam de 70 MB e nunca chegam à Vercel, então ler direto de
 * data/raw/ funcionava só na máquina local e quebrava em produção.
 * Regenerado a cada sync por scripts/build-crm-snapshot.mjs.
 */
export type CrmSnapshot = {
  syncedAt: string | null;
  builtAt: string;
  options: {
    channel: Record<string, string>;
    label: Record<string, string>;
  };
  deals: Array<{
    id: number;
    pipeline_id: number | null;
    stage_id: number | null;
    status: string;
    value: number;
    add_time: string | null;
    won_time: string | null;
    lost_time: string | null;
    stage_change_time: string | null;
    channel: string | number | null;
    label: string | number | number[] | null;
  }>;
  activities: Array<{
    id: number;
    type: string;
    subject: string;
    done: boolean;
    deal_id: number | null;
    add_time: string;
    marked_as_done_time: string | null;
    due_date: string | null;
    due_time: string | null;
    user_id: number | null;
  }>;
};

const EMPTY: CrmSnapshot = {
  syncedAt: null,
  builtAt: new Date(0).toISOString(),
  options: { channel: {}, label: {} },
  deals: [],
  activities: []
};

let cache: Promise<CrmSnapshot> | null = null;

export function loadCrmSnapshot(): Promise<CrmSnapshot> {
  if (!cache) {
    const file = path.join(process.cwd(), "data/processed/crm-snapshot.json");
    cache = readFile(file, "utf8")
      .then((raw) => JSON.parse(raw) as CrmSnapshot)
      .catch((error) => {
        console.error("crm-snapshot.json ausente ou inválido:", error);
        return EMPTY;
      });
  }
  return cache;
}

import "server-only";

import { readProcessed } from "@/lib/data/processed-store";

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

/**
 * Sem cache próprio: `readProcessed` já guarda o parse em memória e o invalida
 * pelo mtime do arquivo. Um cache aqui congelaria o snapshot até o restart e o
 * sync diário deixaria de valer.
 */
export function loadCrmSnapshot(): Promise<CrmSnapshot> {
  return readProcessed<CrmSnapshot>("crm-snapshot.json", EMPTY);
}

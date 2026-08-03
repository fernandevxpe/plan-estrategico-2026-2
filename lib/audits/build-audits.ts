import { readProcessed } from "@/lib/data/processed-store";

export type AuditSection = {
  level: number;
  text: string;
  id: string;
};

export type AuditEntry = {
  slug: string;
  file: string;
  title: string;
  /** ISO curto: YYYY-MM-DD. */
  date: string;
  author: string | null;
  kind: string;
  scope: string | null;
  summary: string;
  highlights: string[];
  words: number;
  readingMinutes: number;
  sections: AuditSection[];
  body: string;
};

export type AuditIndex = {
  generatedAt: string;
  total: number;
  latest: string | null;
  audits: AuditEntry[];
};

export function buildAuditIndex(): Promise<AuditIndex> {
  return readProcessed<AuditIndex>("audit-index.json", {
    generatedAt: new Date(0).toISOString(),
    total: 0,
    latest: null,
    audits: []
  });
}

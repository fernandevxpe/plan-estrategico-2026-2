"use client";

import { origemClass, origemShortLabel } from "@/lib/gestao-xpe/metrics";
import type { GestaoOrigemDado } from "@/lib/gestao-xpe/catalog-types";

type Props = {
  origem?: GestaoOrigemDado;
};

export function GestaoOrigemBadge({ origem }: Props) {
  const label = origemShortLabel(origem);
  if (!label) return null;
  return (
    <span
      className={`gestao-bn-tag ${origemClass(origem)}`}
      title={
        origem === "crm"
          ? "Preenchido automaticamente do Pipedrive"
          : origem === "crm_parcial"
            ? "Estimativa parcial do CRM"
            : origem === "crm_snapshot"
              ? "Snapshot atual do CRM"
              : origem === "analise"
                ? "Calculado automaticamente"
                : "Preenchimento manual"
      }
    >
      {label}
    </span>
  );
}

"use client";

import type { GestaoIndicadorTipo } from "@/lib/gestao-xpe/types";
import type { GestaoOrigemDado } from "@/lib/gestao-xpe/catalog-types";
import { GestaoOrigemBadge } from "@/components/gestao-xpe/GestaoOrigemBadge";

type Props = {
  label: string;
  tipo?: GestaoIndicadorTipo;
  meta: string;
  realizado: string;
  calculado?: boolean;
  unidade?: string;
  origemDado?: GestaoOrigemDado;
  nota?: string;
  onMetaChange: (value: string) => void;
  onRealizadoChange: (value: string) => void;
};

export function GestaoIndicadorField({
  label,
  tipo,
  meta,
  realizado,
  calculado,
  unidade,
  origemDado,
  nota,
  onMetaChange,
  onRealizadoChange
}: Props) {
  const crmLocked =
    origemDado === "crm" || origemDado === "crm_parcial" || origemDado === "crm_snapshot";
  const readOnlyRealizado = calculado || crmLocked;

  if (tipo === "sim_nao") {
    return (
      <div className="gestao-field-row">
        <span className="gestao-field-label">
          {label}
          <GestaoOrigemBadge origem={origemDado} />
        </span>
        <div className="gestao-field-inputs">
          <label>
            <span>Meta</span>
            <select value={meta} onChange={(e) => onMetaChange(e.target.value)}>
              <option value="">—</option>
              <option value="Sim">Sim</option>
              <option value="Não">Não</option>
            </select>
          </label>
          <label>
            <span>Realizado</span>
            <select
              value={realizado}
              disabled={readOnlyRealizado}
              onChange={(e) => onRealizadoChange(e.target.value)}
            >
              <option value="">—</option>
              <option value="Sim">Sim</option>
              <option value="Não">Não</option>
            </select>
          </label>
        </div>
      </div>
    );
  }

  return (
    <div className="gestao-field-row">
      <span className="gestao-field-label">
        {label}
        {unidade ? <em>{unidade}</em> : null}
        <GestaoOrigemBadge origem={origemDado} />
        {calculado ? <span className="gestao-bn-tag">calc</span> : null}
      </span>
      <div className="gestao-field-inputs">
        <label>
          <span>Meta</span>
          <input
            type="text"
            value={meta}
            placeholder="≥ 6"
            onChange={(e) => onMetaChange(e.target.value)}
          />
        </label>
        <label>
          <span>Realizado</span>
          <input
            type="text"
            value={realizado}
            placeholder="—"
            disabled={readOnlyRealizado}
            className={crmLocked ? "gestao-input-crm" : undefined}
            onChange={(e) => onRealizadoChange(e.target.value)}
          />
        </label>
      </div>
      {nota ? <p className="gestao-field-nota">{nota}</p> : null}
    </div>
  );
}

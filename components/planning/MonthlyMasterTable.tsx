"use client";

import type { TableRow } from "@/lib/analysis/types";
import { brl, formatGrowth } from "@/lib/analysis/format";

type Props = {
  rows: TableRow[];
  selectedMonth: string | null;
  onSelectMonth: (month: string | null) => void;
};

function statusLabel(kind: TableRow["kind"]) {
  if (kind === "partial") return "Parcial";
  if (kind === "projected") return "Projetado";
  if (kind === "aggregate") return "Agregado";
  return "Realizado";
}

function statusClass(kind: TableRow["kind"]) {
  if (kind === "partial") return "amber";
  if (kind === "projected") return "blue";
  return "green";
}

export function MonthlyMasterTable({ rows, selectedMonth, onSelectMonth }: Props) {
  return (
    <div className="table-wrap">
      <table className="master-table">
        <thead>
          <tr>
            <th>Período</th>
            <th className="right">Novos</th>
            <th className="right">Fechados</th>
            <th className="right">Receita</th>
            <th className="right">Ticket</th>
            <th className="right">MoM</th>
            <th className="right">YoY</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isSelected = row.month === selectedMonth;
            const isDecline = row.revenueMoMPct != null && row.revenueMoMPct < 0;
            return (
              <tr
                key={row.key}
                className={[
                  row.selectable ? "row-clickable" : "",
                  isSelected ? "row-selected" : "",
                  row.kind === "projected" ? "row-projected" : "",
                  isDecline ? "row-decline" : ""
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => {
                  if (row.selectable && row.month) {
                    onSelectMonth(isSelected ? null : row.month);
                  }
                }}
              >
                <td>
                  <strong>{row.label}</strong>
                  {row.month ? <span className="muted table-sub">{row.month}</span> : null}
                </td>
                <td className="right">{row.createdDeals || "—"}</td>
                <td className="right">{row.wonDeals}</td>
                <td className="right">{brl.format(row.revenue)}</td>
                <td className="right">{brl.format(row.averageTicket)}</td>
                <td className="right">{formatGrowth(row.revenueMoMPct)}</td>
                <td className="right">{formatGrowth(row.revenueYoYPct)}</td>
                <td>
                  <span className={`pill ${statusClass(row.kind)}`}>{statusLabel(row.kind)}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

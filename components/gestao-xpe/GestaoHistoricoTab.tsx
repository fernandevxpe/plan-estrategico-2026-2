"use client";

import { useMemo } from "react";
import type { AggregatedIndicator, GestaoCatalog } from "@/lib/gestao-xpe/catalog-types";
import { evaluateIndicadorStatus } from "@/lib/gestao-xpe/metrics";

type WeekSummary = {
  weekKey: string;
  label: string;
  status: string;
  filled: number;
  total: number;
};

type Props = {
  catalog: GestaoCatalog;
  aggregated: Record<string, AggregatedIndicator>;
  weeks: WeekSummary[];
  semanasNoPeriodo: number;
};

export function GestaoHistoricoTab({ catalog, aggregated, weeks, semanasNoPeriodo }: Props) {
  const escopo = catalog.escopos[0];

  const rows = useMemo(() => {
    if (!escopo) return [];
    return escopo.grupos.flatMap((grupo) =>
      grupo.indicadorIds.map((indId) => {
        const def = catalog.indicators[indId];
        const agg = aggregated[indId];
        const st = evaluateIndicadorStatus(agg?.meta ?? def.metaReferencia, agg?.realizado ?? null, def.tipo);
        return {
          grupo: grupo.titulo,
          nome: def.nome,
          meta: agg?.meta ?? "—",
          realizado: agg?.realizado ?? "—",
          semanas: agg?.semanasIncluidas ?? 0,
          status: st,
          unidade: def.unidade
        };
      })
    );
  }, [catalog, aggregated, escopo]);

  return (
    <div className="gestao-historico gestao-tab-panel">
      <section className="card gestao-hist-table-wrap">
        <div className="gestao-hist-table-header">
          <h2>Totais do período</h2>
          <p className="gestao-muted">
            {semanasNoPeriodo} semana(s) com lançamento na janela selecionada no menu acima.
          </p>
        </div>
        <table className="gestao-table">
          <thead>
            <tr>
              <th>Grupo</th>
              <th>Indicador</th>
              <th>Meta período</th>
              <th>Realizado período</th>
              <th>Semanas c/ dado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.nome}
                className={
                  row.status === "ok" ? "gestao-hist-ok" : row.status === "bad" ? "gestao-hist-bad" : ""
                }
              >
                <td className="gestao-muted">{row.grupo}</td>
                <td>{row.nome}</td>
                <td>
                  {row.meta}
                  {row.unidade && row.meta !== "—" ? ` ${row.unidade}` : ""}
                </td>
                <td>
                  <strong>{row.realizado}</strong>
                  {row.unidade && row.realizado !== "—" ? ` ${row.unidade}` : ""}
                </td>
                <td>{row.semanas}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="gestao-hist-weeks">
        <h3>Semanas lançadas</h3>
        {weeks.length === 0 ? (
          <p className="gestao-muted">Nenhuma semana lançada ainda. Use a aba &quot;Lançar semana&quot;.</p>
        ) : (
          <div className="gestao-hist-week-grid">
            {weeks.map((w) => (
              <article className="card gestao-hist-week-card" key={w.weekKey}>
                <strong>{w.label}</strong>
                <span className="gestao-muted">{w.weekKey}</span>
                <span className={`pill tiny ${w.status === "fechado" ? "green" : "amber"}`}>{w.status}</span>
                <span>
                  {w.filled}/{w.total} realizados
                </span>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

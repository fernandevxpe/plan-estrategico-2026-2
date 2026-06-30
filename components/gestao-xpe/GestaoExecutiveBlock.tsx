"use client";

import { AlertTriangle, Crosshair, ShieldAlert, Target } from "lucide-react";
import type { GestaoDashboard } from "@/lib/gestao-xpe/types";
import { brl } from "@/lib/analysis/format";

type Props = {
  dashboard: GestaoDashboard;
};

function statusPill(status: string) {
  if (status === "em_andamento") return "amber";
  if (status === "concluido") return "green";
  if (status === "bloqueado") return "red";
  return "blue";
}

function display(value: string) {
  return value.trim() || "—";
}

export function GestaoExecutiveBlock({ dashboard }: Props) {
  const { meta, restricaoSemana, riscoPrincipal, acaoPrioritaria } = dashboard;

  return (
    <section className="page-zone gestao-executive">
      <blockquote className="gestao-frase-guia">{meta.fraseGuia}</blockquote>

      <div className="kpi-grid kpi-grid-executive gestao-kpi-executive">
        <article className="card kpi-card">
          <div className="kpi-label">
            <Target size={16} />
            Meta 2026
          </div>
          <strong className="kpi-value">{brl.format(meta.anoMeta)}</strong>
          <span className="kpi-hint">Atualizado em {meta.atualizadoEm}</span>
        </article>

        <article className="card kpi-card gestao-restricao-card">
          <div className="kpi-label">
            <Crosshair size={16} />
            Restrição da semana
          </div>
          <strong className="gestao-field-value">{display(restricaoSemana.titulo)}</strong>
          <dl className="gestao-dl compact">
            <div>
              <dt>Área</dt>
              <dd>{display(restricaoSemana.area)}</dd>
            </div>
            <div>
              <dt>Indicador</dt>
              <dd>{display(restricaoSemana.indicador)}</dd>
            </div>
            <div>
              <dt>Responsável</dt>
              <dd>{display(restricaoSemana.responsavel)}</dd>
            </div>
          </dl>
          <span className={`pill ${statusPill(restricaoSemana.status)}`}>{restricaoSemana.status.replace("_", " ")}</span>
        </article>

        <article className="card kpi-card">
          <div className="kpi-label">
            <ShieldAlert size={16} />
            Risco principal
          </div>
          <strong className="gestao-field-value">{display(riscoPrincipal.tipo)}</strong>
          <p className="gestao-muted">{display(riscoPrincipal.descricao)}</p>
          {riscoPrincipal.acaoPreventiva ? (
            <p className="gestao-action-hint">
              <span>Ação preventiva:</span> {riscoPrincipal.acaoPreventiva}
            </p>
          ) : null}
        </article>

        <article className="card kpi-card gestao-prioridade-card">
          <div className="kpi-label">
            <AlertTriangle size={16} />
            Ação prioritária
          </div>
          <strong className="gestao-field-value">{display(acaoPrioritaria)}</strong>
          {restricaoSemana.evidencia ? (
            <p className="gestao-muted">
              <span>Evidência:</span> {restricaoSemana.evidencia}
            </p>
          ) : null}
          {restricaoSemana.plano ? (
            <p className="gestao-action-hint">
              <span>Plano:</span> {restricaoSemana.plano}
            </p>
          ) : null}
        </article>
      </div>
    </section>
  );
}

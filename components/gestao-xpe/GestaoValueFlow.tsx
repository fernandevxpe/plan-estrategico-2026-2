"use client";

import { ArrowRight } from "lucide-react";
import type { GestaoDashboard } from "@/lib/gestao-xpe/types";

type Props = {
  dashboard: GestaoDashboard;
};

export function GestaoValueFlow({ dashboard }: Props) {
  const { etapas } = dashboard.fluxoValor;
  const restricaoEtapa = dashboard.restricaoSemana.etapaFluxo;

  return (
    <div className="gestao-value-flow">
      <div className="section-title subsection-title">
        <h2>Fluxo de valor</h2>
        <p>Avanço da oportunidade até entrega e nova receita na base.</p>
      </div>

      <div className="gestao-flow-track" role="list">
        {etapas.map((etapa, index) => {
          const isActive = restricaoEtapa === etapa.id;
          const isEmpty = !restricaoEtapa && etapa.id === "vendas";

          return (
            <div className="gestao-flow-item" key={etapa.id} role="listitem">
              <div
                className={`gestao-flow-step${isActive ? " active" : ""}${isEmpty && !restricaoEtapa ? "" : ""}`}
                title={etapa.label}
              >
                <span className="gestao-flow-step-label">{etapa.label}</span>
              </div>
              {index < etapas.length - 1 ? (
                <ArrowRight className="gestao-flow-arrow" size={16} aria-hidden />
              ) : null}
            </div>
          );
        })}
      </div>

      {restricaoEtapa ? (
        <p className="gestao-flow-hint">
          Etapa destacada: restrição da semana em{" "}
          <strong>{etapas.find((e) => e.id === restricaoEtapa)?.label ?? restricaoEtapa}</strong>
        </p>
      ) : (
        <p className="gestao-flow-hint">
          Preencha <code>restricaoSemana.etapaFluxo</code> no JSON para destacar a etapa da restrição atual.
        </p>
      )}
    </div>
  );
}

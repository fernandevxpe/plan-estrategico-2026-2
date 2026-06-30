"use client";

import type { GestaoDashboard } from "@/lib/gestao-xpe/types";

type Props = {
  motores: GestaoDashboard["motores"];
  conversao: GestaoDashboard["conversao"];
};

function metricValue(value: string | null) {
  return value?.trim() || "—";
}

export function GestaoMotorsSection({ motores, conversao }: Props) {
  return (
    <div className="gestao-motors">
      <div className="section-title subsection-title">
        <h2>Motores e indicadores por área</h2>
        <p>Quatro motores de receita e entrega — indicadores-chave para monitoramento semanal.</p>
      </div>

      <div className="gestao-conversao-note card">
        <strong>Conversão operacional vs conversão real</strong>
        <p>
          <span>Operacional:</span> {conversao.operacional}
        </p>
        <p>
          <span>Real:</span> {conversao.real}
        </p>
        <p className="gestao-muted">{conversao.nota}</p>
      </div>

      <div className="gestao-motors-grid">
        {motores.map((motor) => (
          <article className="card gestao-motor-card" key={motor.id}>
            <header className="gestao-motor-header">
              <h3>{motor.nome}</h3>
              <p>{motor.objetivo}</p>
            </header>

            <div className="gestao-motor-components">
              {motor.componentes.map((c) => (
                <span className="pill blue tiny" key={c}>
                  {c}
                </span>
              ))}
            </div>

            <table className="gestao-table">
              <thead>
                <tr>
                  <th>Indicador</th>
                  <th>Meta</th>
                  <th>Atual</th>
                </tr>
              </thead>
              <tbody>
                {motor.indicadores.map((ind) => (
                  <tr key={ind.nome}>
                    <td>
                      {ind.nome}
                      {ind.unidade ? <span className="gestao-unit"> ({ind.unidade})</span> : null}
                    </td>
                    <td>{metricValue(ind.meta)}</td>
                    <td>{metricValue(ind.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        ))}
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import type { GestaoCatalog } from "@/lib/gestao-xpe/catalog-types";
import { GestaoOrigemBadge } from "@/components/gestao-xpe/GestaoOrigemBadge";
import { Save } from "lucide-react";

type Props = {
  catalog: GestaoCatalog;
  onSaved: (catalog: GestaoCatalog) => void;
};

export function GestaoReferenciaTab({ catalog, onSaved }: Props) {
  const [local, setLocal] = useState(catalog);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  function updateMeta(id: string, value: string) {
    setLocal((prev) => ({
      ...prev,
      indicators: {
        ...prev.indicators,
        [id]: { ...prev.indicators[id], metaReferencia: value || null }
      }
    }));
  }

  async function save() {
    setSaving(true);
    const res = await fetch("/api/gestao-xpe/catalog", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(local)
    });
    const data = await res.json();
    setSaving(false);
    setMessage("Referências salvas.");
    onSaved(data.catalog);
  }

  const escopo = local.escopos[0];

  return (
    <div className="gestao-referencia">
      <div className="gestao-lancar-intro card">
        <h2>Metas de referência</h2>
        <p>
          Valores <strong>padrão</strong> por indicador — o baseline da operação. Ao lançar uma semana nova,
          use &quot;Metas da referência&quot; para copiar estes valores como meta daquela semana. Não são o
          realizado; mudam raramente (ajuste de capacidade, contratação, etc.).
        </p>
      </div>

      <div className="gestao-lancar-toolbar">
        <button type="button" className="gestao-btn primary" disabled={saving} onClick={save}>
          <Save size={14} /> {saving ? "Salvando…" : "Salvar referências"}
        </button>
        {message ? <span className="gestao-save-msg">{message}</span> : null}
      </div>

      {escopo?.grupos
        .filter((g) => g.id !== "analise")
        .map((grupo) => (
        <section className="gestao-lancar-grupo card" key={grupo.id}>
          <h3>{grupo.titulo}</h3>
          <table className="gestao-table gestao-ref-table">
            <thead>
              <tr>
                <th>Indicador</th>
                <th>Origem</th>
                <th>Meta de referência (semanal)</th>
                <th>Agregação no mês</th>
                <th>Fonte</th>
              </tr>
            </thead>
            <tbody>
              {grupo.indicadorIds.map((indId) => {
                const def = local.indicators[indId];
                return (
                  <tr key={indId}>
                    <td>
                      {def.nome}
                      {def.calculado ? <span className="gestao-bn-tag">calc</span> : null}
                    </td>
                    <td>
                      <GestaoOrigemBadge origem={def.origemDado} />
                    </td>
                    <td>
                      <input
                        type="text"
                        className="gestao-ref-input"
                        value={def.metaReferencia ?? ""}
                        placeholder="ex: ≥ 6"
                        onChange={(e) => updateMeta(indId, e.target.value)}
                      />
                    </td>
                    <td className="gestao-muted">{def.agregacaoMensal}</td>
                    <td className="gestao-muted gestao-ref-fonte">{def.fonte}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ))}

      {escopo?.grupos.find((g) => g.id === "analise") ? (
        <section className="gestao-lancar-grupo card gestao-lancar-analise">
          <h3>Análise automática</h3>
          <p className="gestao-muted">Metas de referência — valores calculados automaticamente pelo Pipedrive.</p>
          <table className="gestao-table gestao-ref-table">
            <thead>
              <tr>
                <th>Indicador</th>
                <th>Meta de referência</th>
                <th>Fórmula</th>
              </tr>
            </thead>
            <tbody>
              {escopo!.grupos
                .find((g) => g.id === "analise")!
                .indicadorIds.map((indId) => {
                  const def = local.indicators[indId];
                  return (
                    <tr key={indId}>
                      <td>{def.nome}</td>
                      <td>{def.metaReferencia ?? "—"}</td>
                      <td className="gestao-muted">{def.formula ?? "—"}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import type { EscalaDashboard } from "@/lib/areas/build-escala-dashboard";
import { brl, number } from "@/lib/analysis/format";

type Props = {
  data: EscalaDashboard;
};

type KpiId = "visitas" | "reunioes" | "orcamentos" | "projetos" | "pipeline-cond" | "fechamentos";

function clampNonNeg(n: number) {
  return Math.max(0, Math.floor(Number.isFinite(n) ? n : 0));
}

export function EscalaNucleusSimulator({ data }: Props) {
  const nuc = data.focus.nucleusOperation;
  const defaults = nuc.costDefaults;
  const packages = nuc.packages;

  const [regionId, setRegionId] = useState(nuc.regionOptions[2]?.id ?? "ne-ba");
  const [packageId, setPackageId] = useState("local");
  const [sellers, setSellers] = useState(2);
  const [technicians, setTechnicians] = useState(1);
  const [openingMaterial, setOpeningMaterial] = useState(defaults.openingMaterial);
  const [monthlyFixed, setMonthlyFixed] = useState(defaults.monthlyFixed);
  const [metersPerSeller, setMetersPerSeller] = useState(defaults.metersPerSeller);
  const [meterUnitCost, setMeterUnitCost] = useState(defaults.meterUnitCost);

  const [enabledServices, setEnabledServices] = useState<Set<string>>(
    () => new Set(nuc.localServices.filter((s) => s.default).map((s) => s.id))
  );

  const [kpiActual, setKpiActual] = useState<Record<KpiId, number>>({
    visitas: 0,
    reunioes: 0,
    orcamentos: 0,
    projetos: 0,
    "pipeline-cond": 0,
    fechamentos: 0
  });

  const [kpiGates, setKpiGates] = useState<Record<KpiId, number>>({
    visitas: 50,
    reunioes: 24,
    orcamentos: 30,
    projetos: 8,
    "pipeline-cond": 80,
    fechamentos: 5
  });

  const applyPackage = (id: string) => {
    const pkg = packages.find((p) => p.id === id);
    if (!pkg) return;
    setPackageId(id);
    setSellers(pkg.sellers);
    setTechnicians(pkg.technicians);
    setEnabledServices(new Set(pkg.services));
    setKpiGates(pkg.kpiGates as Record<KpiId, number>);
  };

  const region = nuc.regionOptions.find((r) => r.id === regionId);
  const macroRegion = data.focus.macroRegions.find((r) => r.id === regionId);
  const suggestedSellers = macroRegion?.recommendedSellers;

  const costs = useMemo(() => {
    const metersTotal = sellers * metersPerSeller;
    const metersCost = metersTotal * meterUnitCost;
    const openingTotal = openingMaterial + metersCost;
    const monthlyOps = monthlyFixed;
    return { metersTotal, metersCost, openingTotal, monthlyOps, openingMaterial };
  }, [sellers, metersPerSeller, meterUnitCost, openingMaterial, monthlyFixed]);

  const kpiResults = useMemo(() => {
    return nuc.kpiIndicators.map((ind) => {
      const id = ind.id as KpiId;
      const actual = kpiActual[id];
      const gate = kpiGates[id];
      const pass = actual >= gate;
      const pct = gate > 0 ? Math.min(100, (actual / gate) * 100) : 100;
      return { ...ind, id, actual, gate, pass, pct };
    });
  }, [nuc.kpiIndicators, kpiActual, kpiGates]);

  const allKpisPass = kpiResults.every((k) => k.pass);
  const passedCount = kpiResults.filter((k) => k.pass).length;

  const toggleService = (id: string) => {
    setPackageId("custom");
    setEnabledServices((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const updateKpiActual = (id: KpiId, value: number) => {
    setKpiActual((prev) => ({ ...prev, [id]: clampNonNeg(value) }));
  };

  const updateKpiGate = (id: KpiId, value: number) => {
    setPackageId("custom");
    setKpiGates((prev) => ({ ...prev, [id]: clampNonNeg(value) }));
  };

  if (region?.isMatrix) {
    return (
      <div className="escala-nucleus-sim">
        <p className="vendas-gate-statement">{nuc.headline}</p>
        <div className="escala-nucleus-matrix-banner">
          <strong>Recife = Matriz</strong>
          <p>{nuc.matrixNote}</p>
          <p className="metric-note">
            O simulador de abertura de núcleo é para novas regiões. A matriz já concentra análise, laudos e
            projetos — selecione outra região para simular investimento.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="escala-nucleus-sim">
      <p className="vendas-gate-statement">{nuc.headline}</p>
      <p className="sc-sim-formula">{nuc.matrixNote}</p>

      <div className="escala-nucleus-layout">
        <aside className="escala-nucleus-sidebar">
          <h3>Região</h3>
          <select
            className="escala-nucleus-select"
            value={regionId}
            onChange={(e) => setRegionId(e.target.value)}
          >
            {nuc.regionOptions.map((r) => (
              <option key={r.id} value={r.id} disabled={r.isMatrix}>
                {r.label}
                {r.isMatrix ? " (matriz)" : ""}
              </option>
            ))}
          </select>
          {suggestedSellers != null ? (
            <p className="metric-note">
              Modelo vendedores: <strong>{suggestedSellers} sugeridos</strong> nesta região
            </p>
          ) : null}

          <h3>Pacote operacional</h3>
          <div className="escala-package-list">
            {packages.map((pkg) => (
              <button
                key={pkg.id}
                type="button"
                className={`escala-package-btn ${packageId === pkg.id ? "active" : ""}`}
                onClick={() => applyPackage(pkg.id)}
              >
                <strong>{pkg.name}</strong>
                <span>{pkg.description}</span>
                <em>
                  {pkg.sellers} vend. · {pkg.technicians} téc.
                </em>
              </button>
            ))}
          </div>

          <h3>Equipe local</h3>
          <div className="sc-margin-fields">
            <label>
              Vendedores
              <input
                type="number"
                min={1}
                max={12}
                value={sellers}
                onChange={(e) => {
                  setPackageId("custom");
                  setSellers(Math.max(1, Number(e.target.value) || 1));
                }}
              />
            </label>
            <label>
              Técnicos
              <input
                type="number"
                min={1}
                max={6}
                value={technicians}
                onChange={(e) => {
                  setPackageId("custom");
                  setTechnicians(Math.max(1, Number(e.target.value) || 1));
                }}
              />
            </label>
          </div>

          <h3>Custos (editável)</h3>
          <div className="sc-margin-fields">
            <label>
              Material abertura (R$)
              <input
                type="number"
                min={0}
                step={1000}
                value={openingMaterial}
                onChange={(e) => setOpeningMaterial(Math.max(0, Number(e.target.value) || 0))}
              />
            </label>
            <label>
              Fixo mensal (R$/mês)
              <input
                type="number"
                min={0}
                step={500}
                value={monthlyFixed}
                onChange={(e) => setMonthlyFixed(Math.max(0, Number(e.target.value) || 0))}
              />
            </label>
            <label>
              Medidores / vendedor
              <input
                type="number"
                min={0}
                max={30}
                value={metersPerSeller}
                onChange={(e) => setMetersPerSeller(clampNonNeg(Number(e.target.value)))}
              />
            </label>
            <label>
              Custo medidor (R$)
              <input
                type="number"
                min={0}
                step={100}
                value={meterUnitCost}
                onChange={(e) => setMeterUnitCost(Math.max(0, Number(e.target.value) || 0))}
              />
            </label>
          </div>
        </aside>

        <div className="escala-nucleus-main">
          <div className={`escala-go-banner ${allKpisPass ? "pass" : "fail"}`}>
            <strong>{allKpisPass ? "Go — indicadores atendidos" : "No-go — indicadores pendentes"}</strong>
            <span>
              {passedCount}/{kpiResults.length} gates fechados · {region?.label}
            </span>
          </div>

          <div className="guide-kpi-row">
            <div className="guide-kpi-card sc-kpi-highlight">
              <span>Investimento abertura</span>
              <strong>{brl.format(costs.openingTotal)}</strong>
              <small>
                Material {brl.format(costs.openingMaterial)} + {costs.metersTotal} med. (
                {brl.format(costs.metersCost)})
              </small>
            </div>
            <div className="guide-kpi-card">
              <span>Custo mensal fixo</span>
              <strong>{brl.format(costs.monthlyOps)}/mês</strong>
              <small>Sem folha vendedor/técnico</small>
            </div>
            <div className="guide-kpi-card">
              <span>Equipe local</span>
              <strong>
                {sellers} vend. + {technicians} téc.
              </strong>
              <small>{costs.metersTotal} medidores no estoque inicial</small>
            </div>
            <div className="guide-kpi-card">
              <span>Payback material</span>
              <strong>{number.format((costs.openingTotal / Math.max(monthlyFixed, 1)) * 1)} meses</strong>
              <small>Só custo fixo — sem receita</small>
            </div>
          </div>

          <div className="escala-cost-breakdown">
            <h3>Composição investimento abertura</h3>
            <div className="escala-cost-bars">
              <div className="escala-cost-row">
                <span>Material operação local</span>
                <div className="escala-cost-bar-track">
                  <div
                    className="escala-cost-bar seg-material"
                    style={{ width: `${(costs.openingMaterial / costs.openingTotal) * 100}%` }}
                  />
                </div>
                <strong>{brl.format(costs.openingMaterial)}</strong>
              </div>
              <div className="escala-cost-row">
                <span>
                  Medidores ({sellers} vend. × {metersPerSeller} × {brl.format(meterUnitCost)})
                </span>
                <div className="escala-cost-bar-track">
                  <div
                    className="escala-cost-bar seg-meters"
                    style={{ width: `${(costs.metersCost / costs.openingTotal) * 100}%` }}
                  />
                </div>
                <strong>{brl.format(costs.metersCost)}</strong>
              </div>
            </div>
            <p className="sc-sim-formula">{nuc.costFormulaNote}</p>
          </div>

          <h3>Indicadores go/no-go — preencha o realizado vs gate</h3>
          <p className="metric-note">
            Antes de abrir o núcleo, os indicadores comerciais da região devem atingir os mínimos do pacote
            escolhido.
          </p>
          <div className="escala-kpi-grid">
            {kpiResults.map((k) => (
              <div className={`escala-kpi-card ${k.pass ? "pass" : "fail"}`} key={k.id}>
                <div className="escala-kpi-header">
                  <strong>{k.label}</strong>
                  <span className={k.pass ? "escala-kpi-badge pass" : "escala-kpi-badge fail"}>
                    {k.pass ? "OK" : "Pendente"}
                  </span>
                </div>
                <p className="metric-note">{k.description}</p>
                <div className="escala-kpi-inputs">
                  <label>
                    Realizado
                    <input
                      type="number"
                      min={0}
                      value={kpiActual[k.id]}
                      onChange={(e) => updateKpiActual(k.id, Number(e.target.value))}
                    />
                  </label>
                  <label>
                    Gate mín.
                    <input
                      type="number"
                      min={0}
                      value={kpiGates[k.id]}
                      onChange={(e) => updateKpiGate(k.id, Number(e.target.value))}
                    />
                  </label>
                </div>
                <div className="escala-kpi-progress">
                  <div className="escala-kpi-progress-fill" style={{ width: `${k.pct}%` }} />
                </div>
                <small>
                  {k.actual} / {k.gate} {k.unit} ({number.format(k.pct)}%)
                </small>
              </div>
            ))}
          </div>

          <h3>Serviços no local vs matriz</h3>
          <div className="escala-services-grid">
            {nuc.localServices.map((svc) => {
              const on = enabledServices.has(svc.id);
              const isMatrix = svc.deliveredBy.includes("Matriz");
              return (
                <label
                  className={`escala-service-chip ${on ? "on" : ""} ${isMatrix ? "matrix-only" : ""}`}
                  key={svc.id}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggleService(svc.id)}
                  />
                  <strong>{svc.label}</strong>
                  <small>{svc.deliveredBy}</small>
                </label>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

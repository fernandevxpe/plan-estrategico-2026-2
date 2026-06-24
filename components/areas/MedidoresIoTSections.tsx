"use client";

import { useMemo, useState } from "react";
import type { MedidoresIoTDashboard } from "@/lib/areas/build-medidores-iot-dashboard";
import { brl } from "@/lib/analysis/format";
import { VendasInlineDetails } from "@/components/areas/VendasInlineDetails";

type Props = {
  data: MedidoresIoTDashboard;
};

export function MedidoresIoTSummaryBar({ data }: Props) {
  const fleet = data.fleet;
  return (
    <div className="vendas-summary-bar consultoria-summary-bar">
      <div className="vendas-summary-gate ok laudos-ldc-gate">
        <span className="vendas-summary-gate-label">Frota 4G</span>
        <span className="vendas-summary-gate-detail">
          <strong>{fleet.total} medidores</strong> · ~{fleet.maintenanceCount} manutenção ({fleet.maintenancePct}%)
          · H2: recuperar sem uso
        </span>
      </div>
      <div className="vendas-summary-metrics">
        <div className="vendas-summary-metric">
          <span>SM3F2.0</span>
          <strong>Controlador de Carga</strong>
        </div>
        <div className="vendas-summary-metric">
          <span>SA3F1.0</span>
          <strong>Subst. analisador</strong>
        </div>
        <div className="vendas-summary-metric">
          <span>Sequência</span>
          <strong>Após Smart Charging</strong>
        </div>
      </div>
      <p className="vendas-sync-note capacity-gap-note">{data.focus.operatingModel.h2Focus}</p>
    </div>
  );
}

type SensorId = "100a" | "600a" | "1000a";

export function MedidoresIoTPurchaseSimulator({ data }: Props) {
  const sim = data.focus.purchaseSimulation;
  const products = data.focus.productLine;
  const sensors = products.sensors;

  const [sm3Qty, setSm3Qty] = useState(sim.defaults.sm3f20Quantity);
  const [sm3Price, setSm3Price] = useState(sim.defaults.sm3f20UnitPrice);
  const [sa3Qty, setSa3Qty] = useState(sim.defaults.sa3f10Quantity);
  const [sa3Price, setSa3Price] = useState(sim.defaults.sa3f10UnitPrice);
  const [sensorQty, setSensorQty] = useState<Record<SensorId, number>>({
    "100a": sim.defaults.sensorQuantities["100a"],
    "600a": sim.defaults.sensorQuantities["600a"],
    "1000a": sim.defaults.sensorQuantities["1000a"]
  });

  const sensorPrices = useMemo(
    () =>
      Object.fromEntries(sensors.map((s) => [s.id, s.defaultUnitPrice])) as Record<SensorId, number>,
    [sensors]
  );

  const totals = useMemo(() => {
    const sm3Total = sm3Qty * sm3Price;
    const sa3Total = sa3Qty * sa3Price;
    const sensorTotal = (["100a", "600a", "1000a"] as SensorId[]).reduce(
      (sum, id) => sum + sensorQty[id] * sensorPrices[id],
      0
    );
    return { sm3Total, sa3Total, sensorTotal, grand: sm3Total + sa3Total + sensorTotal };
  }, [sm3Qty, sm3Price, sa3Qty, sa3Price, sensorQty, sensorPrices]);

  return (
    <div className="card iot-purchase-simulator">
      <div className="card-title">
        <div>
          <h2>{sim.title}</h2>
          <span>{sim.description}</span>
        </div>
      </div>

      <div className="iot-sim-grid">
        <div className="iot-sim-block">
          <h4>{products.sm3f20.id} — {products.sm3f20.name}</h4>
          <p className="metric-note">{products.sm3f20.description}</p>
          <div className="iot-sim-fields">
            <label>
              Quantidade
              <input
                type="number"
                min={0}
                value={sm3Qty}
                onChange={(e) => setSm3Qty(Math.max(0, Number(e.target.value) || 0))}
              />
            </label>
            <label>
              Preço unitário (R$)
              <input
                type="number"
                min={0}
                step={50}
                value={sm3Price}
                onChange={(e) => setSm3Price(Math.max(0, Number(e.target.value) || 0))}
              />
            </label>
          </div>
          <p className="iot-sim-line-total">
            Subtotal: <strong>{brl.format(totals.sm3Total)}</strong>
          </p>
        </div>

        <div className="iot-sim-block">
          <h4>Sensores (por unidade)</h4>
          <p className="metric-note">Comprar conforme faixa de corrente do ponto medido.</p>
          {sensors.map((sensor) => (
            <div className="iot-sensor-row" key={sensor.id}>
              <label>
                <strong>{sensor.label}</strong>
                <span className="metric-note">{brl.format(sensor.defaultUnitPrice)}/un · {sensor.note}</span>
                <input
                  type="number"
                  min={0}
                  value={sensorQty[sensor.id as SensorId]}
                  onChange={(e) =>
                    setSensorQty((prev) => ({
                      ...prev,
                      [sensor.id]: Math.max(0, Number(e.target.value) || 0)
                    }))
                  }
                />
              </label>
              <span className="iot-sensor-subtotal">
                {brl.format(sensorQty[sensor.id as SensorId] * sensor.defaultUnitPrice)}
              </span>
            </div>
          ))}
          <p className="iot-sim-line-total">
            Subtotal sensores: <strong>{brl.format(totals.sensorTotal)}</strong>
          </p>
        </div>

        <div className="iot-sim-block">
          <h4>{products.sa3f10.id} — {products.sa3f10.name}</h4>
          <p className="metric-note">{products.sa3f10.description}</p>
          <p className="metric-note capacity-gap-note">
            Hoje {sim.analyzerComparison.currentAnalyzers} analisadores convencionais — {sim.analyzerComparison.note}
          </p>
          <div className="iot-sim-fields">
            <label>
              Quantidade
              <input
                type="number"
                min={0}
                value={sa3Qty}
                onChange={(e) => setSa3Qty(Math.max(0, Number(e.target.value) || 0))}
              />
            </label>
            <label>
              Preço unitário (R$)
              <input
                type="number"
                min={0}
                step={50}
                value={sa3Price}
                onChange={(e) => setSa3Price(Math.max(0, Number(e.target.value) || 0))}
              />
            </label>
          </div>
          <p className="iot-sim-line-total">
            Subtotal: <strong>{brl.format(totals.sa3Total)}</strong>
          </p>
        </div>
      </div>

      <div className="iot-sim-grand-total">
        <span>Investimento total simulado</span>
        <strong>{brl.format(totals.grand)}</strong>
      </div>
    </div>
  );
}

export function MedidoresIoTOperationalFocus({ data }: Props) {
  const model = data.focus.operatingModel;
  const fleet = data.focus.currentFleet;
  const team = data.focus.sharedTeam;
  const products = data.focus.productLine;

  return (
    <div className="vendas-operational-focus is-embedded">
      <p className="vendas-gate-statement">{model.headline}</p>
      <p className="metric-note">{model.sequencingNote}</p>

      <VendasInlineDetails title={fleet.title} defaultOpen>
        <div className="mini-grid">
          <div className="mini">
            <span className="metric-label">Total 4G</span>
            <strong>{fleet.totalMeters4g}</strong>
          </div>
          <div className="mini">
            <span className="metric-label">Manutenção H2</span>
            <strong>
              ~{fleet.maintenanceNeededCount} ({fleet.maintenanceNeededPct}%)
            </strong>
          </div>
        </div>
        <p className="metric-note">Ações H2:</p>
        <ul className="vendas-compact-list">
          {fleet.h2Actions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
        <p className="metric-note">Recuperação: {fleet.recoveryTargets.join(" · ")}</p>
      </VendasInlineDetails>

      <VendasInlineDetails title={products.title} defaultOpen>
        <div className="evolution-phases icv-pipeline">
          <div className="evolution-phase">
            <span className="pill green">{products.sm3f20.id}</span>
            <strong>{products.sm3f20.name}</strong>
            <p>{products.sm3f20.description}</p>
            <small className="metric-note">Base: {products.sm3f20.basedOn}</small>
          </div>
          <div className="evolution-phase">
            <span className="pill blue">{products.sa3f10.id}</span>
            <strong>{products.sa3f10.name}</strong>
            <p>{products.sa3f10.description}</p>
            <small className="metric-note">{products.sa3f10.replaces}</small>
          </div>
        </div>
      </VendasInlineDetails>

      <VendasInlineDetails title={team.title} defaultOpen>
        {team.members.map((m) => (
          <div className="mini" key={m.name} style={{ marginBottom: 12 }}>
            <span className="metric-label">
              {m.name} — {m.role}
            </span>
            <strong>{m.monthlyComp}</strong>
            <small>{m.focus}</small>
            {"compensationModel" in m && m.compensationModel ? (
              <small className="metric-note capacity-gap-note">{m.compensationModel}</small>
            ) : null}
          </div>
        ))}
        <p className="metric-note">Ver também: /areas/{team.linkedArea}</p>
      </VendasInlineDetails>
    </div>
  );
}

export function MedidoresIoTRoadmapSection({ data }: Props) {
  return (
    <div className="consultoria-roadmap is-embedded">
      {data.focus.roadmapPhases.map((phase) => (
        <div className="card area-sub-card" key={phase.phase}>
          <span className="vendas-template-priority">{phase.phase}</span>
          <h4>{phase.title}</h4>
          <ul className="vendas-compact-list">
            {phase.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

import focusJson from "@/data/areas/medidores-iot-focus.json";

const focus = focusJson as typeof focusJson;

export type MedidoresIoTDashboard = {
  focus: typeof focusJson;
  fleet: {
    total: number;
    maintenanceCount: number;
    maintenancePct: number;
  };
};

export function buildMedidoresIoTDashboard(): MedidoresIoTDashboard {
  const total = focus.currentFleet.totalMeters4g;
  const pct = focus.currentFleet.maintenanceNeededPct;
  return {
    focus,
    fleet: {
      total,
      maintenanceCount: focus.currentFleet.maintenanceNeededCount,
      maintenancePct: pct
    }
  };
}

export { focus as medidoresIoTFocusDefaults };

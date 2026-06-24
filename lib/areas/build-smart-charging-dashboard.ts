import focusJson from "@/data/areas/smart-charging-focus.json";

export type SmartChargingDashboard = {
  focus: typeof focusJson;
};

export function buildSmartChargingDashboard(): SmartChargingDashboard {
  return { focus: focusJson };
}

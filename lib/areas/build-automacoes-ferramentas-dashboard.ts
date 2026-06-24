import focusJson from "@/data/areas/automacoes-ferramentas-focus.json";

export type AutomacoesServiceModule = (typeof focusJson.serviceModules)[number];

export type AutomacoesFerramentasDashboard = {
  focus: typeof focusJson;
  serviceModules: AutomacoesServiceModule[];
};

export function buildAutomacoesFerramentasDashboard(): AutomacoesFerramentasDashboard {
  return {
    focus: focusJson,
    serviceModules: [...focusJson.serviceModules].sort((a, b) => a.priority - b.priority)
  };
}

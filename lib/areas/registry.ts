export type AreaDefinition = {
  id: string;
  name: string;
  shortName: string;
  description: string;
  parentId: string | null;
  status: "estruturando" | "planejando" | "executando" | "monitorando";
  lead: string;
  businessTypes?: string[];
  serviceMatch?: string[];
  keywords?: RegExp;
};

export const AREA_DEFINITIONS: AreaDefinition[] = [
  {
    id: "vendas",
    name: "Vendas",
    shortName: "Vendas",
    description: "Funil comercial, fechamentos, conversão e capacidade da equipe de 2 comerciais.",
    parentId: null,
    status: "executando",
    lead: "Diretor Comercial"
  },
  {
    id: "consultoria",
    name: "Consultoria",
    shortName: "Consultoria",
    description: "Hub de entrega técnica — projetos de engenharia e laudos regulatórios.",
    parentId: null,
    status: "executando",
    lead: "Operação técnica"
  },
  {
    id: "consultoria-projetos",
    name: "Projetos",
    shortName: "Projetos",
    description: "PIE, PROJETOS, CDM e projetos de infraestrutura elétrica.",
    parentId: "consultoria",
    status: "executando",
    lead: "Projetistas",
    businessTypes: ["PROJETOS", "PIE - Projeto infra.  Eletrocalha e Emergência", "CDM"]
  },
  {
    id: "consultoria-laudos",
    name: "Laudos",
    shortName: "Laudos",
    description: "LDC, LIE, LCC, LGR, LSPDA e laudos de disponibilidade de carga.",
    parentId: "consultoria",
    status: "executando",
    lead: "Projetistas",
    businessTypes: [
      "LDC - Laudo de disponibilidade de carga",
      "LIE - Laudo de Instalações Elétricas",
      "LCC - Laudo Carregador Coletivo",
      "LGR - Laudo de Gerenciamento de Risco",
      "LSPDA"
    ]
  },
  {
    id: "obras",
    name: "Obras",
    shortName: "Obras",
    description: "Obras elétricas, execução em campo e ticket alto.",
    parentId: null,
    status: "executando",
    lead: "Operação obras",
    businessTypes: ["OBRA"],
    serviceMatch: ["Obras eletricas"]
  },
  {
    id: "marketing",
    name: "Marketing",
    shortName: "Marketing",
    description: "Tráfego pago, aquisição, conteúdo e geração de demanda qualificada.",
    parentId: null,
    status: "executando",
    lead: "Marketing"
  },
  {
    id: "eventos",
    name: "Eventos",
    shortName: "Eventos",
    description: "Presença em feiras, networking e geração de pipeline presencial.",
    parentId: null,
    status: "planejando",
    lead: "A definir"
  },
  {
    id: "smart-charging",
    name: "Smart Charging",
    shortName: "Smart Charging",
    description: "Carregadores veiculares, ICV, instalação e laudos de infraestrutura EV.",
    parentId: null,
    status: "planejando",
    lead: "Produto EV",
    businessTypes: ["ICV - Inspeção de carregador veicular", "Instalação de Carregador Eletrico", "LCC - Laudo Carregador Coletivo"]
  },
  {
    id: "automacoes-ferramentas",
    name: "Automações e Ferramentas",
    shortName: "Automações",
    description: "CRM, ClickUp, automações internas e produtividade da operação.",
    parentId: null,
    status: "executando",
    lead: "Tech / Operações"
  },
  {
    id: "medidores-iot",
    name: "Medidores IoT",
    shortName: "IoT",
    description: "Medição, telemetria e produtos conectados para condomínios e clientes.",
    parentId: null,
    status: "estruturando",
    lead: "A definir"
  },
  {
    id: "escala",
    name: "Escala",
    shortName: "Escala",
    description: "Capacidade, contratações, processos e crescimento sustentável da operação.",
    parentId: null,
    status: "planejando",
    lead: "Gestão"
  }
];

export const ROOT_AREA_IDS = AREA_DEFINITIONS.filter((area) => !area.parentId).map((area) => area.id);

export const AREA_SLUGS = AREA_DEFINITIONS.map((area) => area.id);

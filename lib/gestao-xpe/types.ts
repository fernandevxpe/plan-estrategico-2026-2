import type { GestaoOrigemDado } from "@/lib/gestao-xpe/catalog-types";

export type GestaoStatus = "a_definir" | "pendente" | "em_andamento" | "concluido" | "bloqueado";

export type GestaoIndicadorTipo =
  | "contagem"
  | "tempo"
  | "moeda"
  | "percentual"
  | "dias"
  | "sim_nao";

export type GestaoIndicador = {
  id?: string;
  nome: string;
  meta: string | null;
  valor: string | null;
  unidade?: string;
  fonte?: string;
  origemDado?: GestaoOrigemDado;
  tipo?: GestaoIndicadorTipo;
  calculado?: boolean;
  formula?: string;
};

export type GestaoIndicadorGrupo = {
  id: string;
  titulo: string;
  descricao?: string;
  indicadores: GestaoIndicador[];
};

export type GestaoColetaItem = {
  indicador: string;
  fonte: string;
  frequencia: string;
  referencia?: string;
};

export type GestaoAcao = {
  id: string;
  titulo: string;
  responsavel: string;
  prazo: string;
  status: GestaoStatus;
  impactoEsperado?: string;
};

export type GestaoMetricasUniversais = {
  capacidade: string | null;
  demanda: string | null;
  fila: string | null;
  leadTime: string | null;
  retrabalho: string | null;
  impactoFinanceiro: string | null;
};

export type GestaoGargalo = {
  id: string;
  rank: number;
  nome: string;
  area: string;
  descricao: string;
  sintomas: string[];
  /** Lista plana — gargalos sem painel agrupado */
  indicadores?: GestaoIndicador[];
  /** Painel semanal agrupado (meta da semana vs realizado) */
  painelSemanal?: {
    semana: string;
    resumo?: string;
    definicaoNobre?: string;
    grupos: GestaoIndicadorGrupo[];
    guiaColeta?: GestaoColetaItem[];
  };
  acoes: GestaoAcao[];
  metricasUniversais: GestaoMetricasUniversais;
};

export type GestaoMotor = {
  id: string;
  nome: string;
  objetivo: string;
  componentes: string[];
  indicadores: GestaoIndicador[];
};

export type GestaoEstoqueInvisivel = {
  id: string;
  tipo: string;
  area: string;
  quantidade: string | null;
  impacto: string | null;
  responsavel: string;
  acao: string;
};

export type GestaoBoletimSecao = {
  id: string;
  titulo: string;
  itens: string[];
};

export type GestaoTocPasso = {
  numero: number;
  titulo: string;
  descricao: string;
  perguntas?: string[];
  exemplos?: string[];
};

export type GestaoDashboard = {
  version: number;
  meta: {
    anoMeta: number;
    atualizadoEm: string;
    fraseGuia: string;
  };
  restricaoSemana: {
    titulo: string;
    area: string;
    evidencia: string;
    indicador: string;
    plano: string;
    responsavel: string;
    status: GestaoStatus;
    etapaFluxo?: string;
  };
  riscoPrincipal: {
    tipo: string;
    descricao: string;
    acaoPreventiva: string;
  };
  acaoPrioritaria: string;
  fluxoValor: {
    etapas: { id: string; label: string }[];
  };
  gargalos: GestaoGargalo[];
  motores: GestaoMotor[];
  estoquesInvisiveis: GestaoEstoqueInvisivel[];
  boletim: {
    semana: string;
    responsavel: string;
    secoes: GestaoBoletimSecao[];
  };
  toc: {
    regras: string[];
    passos: GestaoTocPasso[];
  };
  conversao: {
    operacional: string;
    real: string;
    nota: string;
  };
};

/**
 * O vocabulário de Recebíveis, num lugar só.
 *
 * Três telas usam as mesmas cores, os mesmos rótulos e o mesmo formato de mês:
 * a guia, o gráfico cheio e o resumo do Início. Duas cópias divergiriam na
 * primeira natureza nova — e o app já viveu isso: `.nat-recorrente` existia no
 * componente e `.nat-prolabore` no CSS, e a banda de R$ 72.022 do Gabriel
 * renderizou invisível.
 */

export type Recebiveis = {
  totalCents: number;
  mesAtualCents: number;
  medianaRecorrenteCents: number;
  emAbertoCents: number;
  desde: string | null;
  ultimoEm: string | null;
  porNatureza: { natureza: string; cents: number; n: number }[];
  porMes: { mes: string; totalCents: number; porNatureza: Record<string, number> }[];
  linhas: {
    data: string;
    mes: string;
    valorCents: number;
    natureza: string;
    categoria: string | null;
    conta: string;
    descricao: string;
  }[];
};

export const ROTULO: Record<string, string> = {
  salario: "Salário",
  prolabore: "Pró-labore",
  estagio: "Estágio",
  comissao: "Comissão",
  reembolso: "Reembolso",
  encargo_beneficio: "Benefício",
  extra: "Extra"
};

/*
 * Salário, pró-labore e estágio dividem a MESMA cor.
 *
 * Conferido nas 28 pessoas com pagamento em 2026: ninguém tem duas delas — os
 * vínculos são mutuamente exclusivos. Com uma cor só, a banda roxa quer dizer
 * "o que se repete todo mês" no gráfico de qualquer pessoa, e a legenda diz o
 * nome certo do vínculo de cada uma.
 */
export const CLASSE: Record<string, string> = {
  salario: "nat-recorrente",
  prolabore: "nat-recorrente",
  estagio: "nat-recorrente",
  comissao: "nat-comissao",
  reembolso: "nat-reembolso",
  extra: "nat-extra",
  encargo_beneficio: "nat-encargo"
};

const MES_LONGO = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"
];

export const nomeMes = (m: string) => `${MES_LONGO[Number(m.slice(5, 7)) - 1]} de ${m.slice(0, 4)}`;
export const mesCurto = (m: string) => MES_LONGO[Number(m.slice(5, 7)) - 1].slice(0, 3);

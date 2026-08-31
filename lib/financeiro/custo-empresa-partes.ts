/**
 * Blocos da matriz de Custo da empresa.
 *
 * Uma tabela com 115 linhas não dá para conversar: aluguel some no meio de
 * PIX de material. O dono listou o que é CASA (aluguel, imposto, água,
 * energia, internet, Embrasul, Flyeron, jurídico, contabilidade) e o que é
 * OBRAS (o grosso dos pagamentos). O restante fica em "A organizar".
 *
 * A regra é nome + categoria + área já marcada — não inventa time. Cartão e
 * financiamento NÃO entram aqui: fatura é 9.01 (caixa) e 9.04 está vazia.
 */

import type { TimeCusto } from "./custo-empresa-eixos";

export type ParteCusto = "padrao" | "obras" | "consultoria" | "organizar";
export type SubparteCusto =
  | "aluguel"
  | "impostos"
  | "utilidades"
  | "embrasul"
  | "flyeron"
  | "juridico_contabil"
  | "taxas"
  | "tecnologia"
  | "financeiro"
  | "material_obras"
  | "deslocamento_obras"
  | "terceiros_obras"
  | "outros_obras"
  | "material_consultoria"
  | "outros_consultoria"
  | "resto";

export const PARTES: { slug: ParteCusto; nome: string; dica: string }[] = [
  {
    slug: "padrao",
    nome: "Custos padrão",
    dica: "A casa: aluguel, imposto, água, energia, internet, Embrasul, marketing, jurídico e contabilidade."
  },
  {
    slug: "obras",
    nome: "Custos de obras",
    dica: "Material, deslocamento de serviço e terceirização de campo."
  },
  {
    slug: "consultoria",
    nome: "Custos de consultoria",
    dica: "O que ficou em Consultoria e não é Embrasul (Embrasul mora em padrão)."
  },
  {
    slug: "organizar",
    nome: "A organizar",
    dica: "Ainda sem bloco — é a fila para conversar caso a caso."
  }
];

export const SUBPARTES: { slug: SubparteCusto; parte: ParteCusto; nome: string }[] = [
  { slug: "aluguel", parte: "padrao", nome: "Aluguel" },
  { slug: "impostos", parte: "padrao", nome: "Impostos" },
  { slug: "utilidades", parte: "padrao", nome: "Água, energia e internet" },
  { slug: "embrasul", parte: "padrao", nome: "Embrasul e medição" },
  { slug: "flyeron", parte: "padrao", nome: "Marketing e Tráfego" },
  { slug: "juridico_contabil", parte: "padrao", nome: "Jurídico e contabilidade" },
  { slug: "taxas", parte: "padrao", nome: "Taxas e conselhos" },
  { slug: "tecnologia", parte: "padrao", nome: "Tecnologia da casa" },
  { slug: "financeiro", parte: "padrao", nome: "Tarifas e cobrança" },
  { slug: "material_obras", parte: "obras", nome: "Material" },
  { slug: "deslocamento_obras", parte: "obras", nome: "Deslocamento" },
  { slug: "terceiros_obras", parte: "obras", nome: "Terceirização" },
  { slug: "outros_obras", parte: "obras", nome: "Outros de obras" },
  { slug: "material_consultoria", parte: "consultoria", nome: "Material e equipamento" },
  { slug: "outros_consultoria", parte: "consultoria", nome: "Outros de consultoria" },
  { slug: "resto", parte: "organizar", nome: "Sem bloco ainda" }
];

const SUB_POR_SLUG = new Map(SUBPARTES.map((s) => [s.slug, s]));

export function rotuloSubparte(slug: SubparteCusto): string {
  return SUB_POR_SLUG.get(slug)?.nome ?? slug;
}

export function parteDaSubparte(slug: SubparteCusto): ParteCusto {
  return SUB_POR_SLUG.get(slug)?.parte ?? "organizar";
}

function norm(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function subparteValida(s: string | null | undefined): s is SubparteCusto {
  return typeof s === "string" && SUB_POR_SLUG.has(s as SubparteCusto);
}

export type ItemParaParte = {
  nome: string;
  categoriaCode: string;
  time: TimeCusto;
  areasEmpresa: { slug: string }[];
  /** Override do dono. Ganha da heurística — é o que a tela grava ao mover. */
  bloco?: SubparteCusto | null;
};

/**
 * Primeiro a lista que o dono citou (casa). Depois o eixão de obras.
 * O que não casar fica em "A organizar" — não chute.
 */
export function subparteCustoDe(item: ItemParaParte): SubparteCusto {
  if (subparteValida(item.bloco)) return item.bloco;
  const nome = norm(item.nome);
  const code = item.categoriaCode;
  const areas = new Set(item.areasEmpresa.map((a) => a.slug));

  if (code === "5.01" || /ancora/.test(nome)) return "aluguel";
  if (code.startsWith("7.") || areas.has("impostos") || /(receita federal|simples nacional|das-simples|pref mun|municipio do recife)/.test(nome)) {
    return "impostos";
  }
  if (
    code === "5.02" ||
    /compesa|neoenergia|celpe|claro|algar|companhia ene/.test(nome)
  ) {
    return "utilidades";
  }
  if (/embrasul|embraflex|lyra/.test(nome)) return "embrasul";
  if (/flyer|kevin/.test(nome) || code === "5.05") return "flyeron";
  if (/tabeli|protesto/.test(nome)) return "material_obras";
  if (
    /startlaw|agilize|elaine barbosa/.test(nome) ||
    areas.has("juridico")
  ) {
    return "juridico_contabil";
  }
  if (code === "5.10" || /conselho regional|crea/.test(nome)) return "taxas";
  if (code === "5.03" && !/lyra/.test(nome)) return "tecnologia";
  if (/asaas/.test(nome) || (code === "4.05" && areas.has("financeiro"))) return "financeiro";

  if (code === "4.02" || areas.has("material_obras")) return "material_obras";
  if (code === "4.04") return "deslocamento_obras";
  if (code === "4.03") return "terceiros_obras";
  if (item.time === "obras") return "outros_obras";

  if (areas.has("material_consultoria") || code === "8.01" || item.time === "consultoria") {
    return "material_consultoria";
  }
  if (item.time === "consultoria") return "outros_consultoria";

  return "resto";
}

export function parteCustoDe(item: ItemParaParte): ParteCusto {
  return parteDaSubparte(subparteCustoDe(item));
}

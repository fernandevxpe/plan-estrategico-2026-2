/**
 * Busca na matriz de Custo da empresa.
 *
 * São ~115 pares em 2026: varrer é mais barato que montar índice. O que
 * importa é o ranking — achar Ancora em Aluguel digitando "anco", "5.01"
 * ou "aluguel", não um trie.
 *
 * `blocoTexto` vem de fora (nome do bloco + da parte) para este arquivo
 * não importar `custo-empresa-partes` em runtime — o teste Node não
 * resolve extensão-less.
 */

import type { SubparteCusto } from "./custo-empresa-partes";

export function normalizarBusca(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, " ")
    .trim();
}

export function tokensBusca(query: string): string[] {
  return normalizarBusca(query)
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

export type ItemBuscavel = {
  chave: string;
  nome: string;
  categoriaCode: string;
  categoriaNome: string;
  subparte: SubparteCusto;
  /** "Aluguel Custos padrão" — para achar o item pelo bloco onde mora. */
  blocoTexto: string;
};

export type HitBusca = ItemBuscavel & { score: number };

function pontuarCampo(normCampo: string, token: string): number {
  if (!token || !normCampo) return 0;
  if (normCampo === token) return 100;
  if (normCampo.startsWith(token)) return 80;
  if (` ${normCampo} `.includes(` ${token} `)) return 70;
  const idx = normCampo.indexOf(token);
  if (idx < 0) return 0;
  if (idx > 0 && normCampo[idx - 1] === " ") return 60;
  return 40;
}

function pontuarItem(item: ItemBuscavel, tokens: string[]): number {
  if (!tokens.length) return 0;
  const nome = normalizarBusca(item.nome);
  const code = normalizarBusca(item.categoriaCode);
  const codeSolto = item.categoriaCode.replace(/\./g, "").toLowerCase();
  const cat = normalizarBusca(item.categoriaNome);
  const bloco = normalizarBusca(item.blocoTexto);

  let score = 0;
  for (const tok of tokens) {
    const solto = tok.replace(/\./g, "");
    const melhor = Math.max(
      pontuarCampo(nome, tok) * 1.2,
      pontuarCampo(code, tok),
      pontuarCampo(codeSolto, solto),
      pontuarCampo(cat, tok),
      pontuarCampo(bloco, tok) * 0.95
    );
    if (melhor <= 0) return 0;
    score += melhor;
  }
  return score;
}

/** Filtro da matriz: todos os tokens têm de casar em algum campo. */
export function passaBusca(item: ItemBuscavel, query: string): boolean {
  const tokens = tokensBusca(query);
  if (!tokens.length) return true;
  return pontuarItem(item, tokens) > 0;
}

/** Sugestões tipo Google: ranqueadas. O bloco vem em `blocoTexto`. */
export function buscarCustos(itens: ItemBuscavel[], query: string, limite = 8): HitBusca[] {
  const tokens = tokensBusca(query);
  if (!tokens.length) return [];
  const hits: HitBusca[] = [];
  for (const item of itens) {
    const score = pontuarItem(item, tokens);
    if (score <= 0) continue;
    hits.push({ ...item, score });
  }
  hits.sort((a, b) => b.score - a.score || a.nome.localeCompare(b.nome, "pt"));
  return hits.slice(0, limite);
}

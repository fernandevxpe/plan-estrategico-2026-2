/**
 * Rateio igual do custo de uma pessoa entre as áreas em que ela trabalha.
 *
 * POR QUE NÃO É "100% EM CADA"
 * ----------------------------
 * Quem está em Vendas e Financeiro não custa duas vezes: o gráfico somaria
 * o salário inteiro em duas barras e a casa leria o dobro. 2 áreas → 50/50;
 * 4 áreas → 25% cada. Sem área vira o balde `sem_area` — senão o dinheiro
 * some do gráfico e a soma deixa de bater com a matriz.
 *
 * O CENTAVO QUE SOBRA
 * -------------------
 * R$ 10,00 em 3 não fecha. A sobra (1 centavo) vai para as PRIMEIRAS fatias
 * na ordem do catálogo. A soma é sempre exatamente o total da pessoa.
 */

export const SLUG_SEM_AREA = "sem_area";
export const NOME_SEM_AREA = "Sem área";

export type DestinoRateio = { slug: string; nome: string };

export type FatiaCusto = {
  slug: string;
  nome: string;
  ultimoCents: number;
  mediaCents: number;
  totalCents: number;
};

/** Partes iguais que somam `total`. `n <= 0` devolve lista vazia. */
export function repartirCents(total: number, n: number): number[] {
  if (n <= 0) return [];
  const t = Number.isFinite(total) ? Math.max(0, Math.trunc(total)) : 0;
  if (t === 0) return Array.from({ length: n }, () => 0);
  const base = Math.floor(t / n);
  const resto = t - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < resto ? 1 : 0));
}

/**
 * Para onde vai o custo desta pessoa.
 *
 * `slugsLigados === null` — todos os chips ligados: rateia nas áreas dela.
 * Recorte estreito — rateia só nas áreas ainda visíveis, para a soma do
 * gráfico continuar igual à soma da tabela filtrada.
 */
export function destinosAreaEmpresa(
  areasPessoa: DestinoRateio[] | undefined,
  ordemCatalogo: readonly DestinoRateio[],
  slugsLigados: ReadonlySet<string> | null
): DestinoRateio[] {
  const delas = new Map((areasPessoa ?? []).map((a) => [a.slug, a]));
  if (!delas.size) {
    if (slugsLigados && !slugsLigados.has(SLUG_SEM_AREA)) return [];
    return [{ slug: SLUG_SEM_AREA, nome: NOME_SEM_AREA }];
  }

  const ordenadas: DestinoRateio[] = [];
  const vistos = new Set<string>();
  for (const a of ordemCatalogo) {
    const dela = delas.get(a.slug);
    if (!dela || vistos.has(dela.slug)) continue;
    ordenadas.push(dela);
    vistos.add(dela.slug);
  }
  for (const a of delas.values()) {
    if (vistos.has(a.slug)) continue;
    ordenadas.push(a);
    vistos.add(a.slug);
  }

  if (!slugsLigados) return ordenadas;
  const visiveis = ordenadas.filter((a) => slugsLigados.has(a.slug));
  return visiveis;
}

export function atribuirCents(total: number, destinos: readonly DestinoRateio[]) {
  const partes = repartirCents(total, destinos.length);
  return destinos.map((d, i) => ({ slug: d.slug, nome: d.nome, cents: partes[i] ?? 0 }));
}

/** Junta fatias da mesma chave e deriva a média do recorte. */
export function somarFatias(
  itens: readonly { slug: string; nome: string; ultimoCents: number; totalCents: number }[],
  meses: number
): FatiaCusto[] {
  const mapa = new Map<string, FatiaCusto>();
  for (const item of itens) {
    const atual = mapa.get(item.slug) ?? {
      slug: item.slug,
      nome: item.nome,
      ultimoCents: 0,
      mediaCents: 0,
      totalCents: 0
    };
    atual.ultimoCents += item.ultimoCents;
    atual.totalCents += item.totalCents;
    mapa.set(item.slug, atual);
  }
  const n = Math.max(1, Math.trunc(meses) || 1);
  const saida: FatiaCusto[] = [];
  for (const fatia of mapa.values()) {
    if (fatia.ultimoCents <= 0 && fatia.totalCents <= 0) continue;
    saida.push(fatia);
  }
  // Média no centavo: floor + resto para as maiores frações, senão
  // 16 áreas arredondadas cada uma abrem 2 centavos de diferença entre painéis.
  const alvo = Math.round(saida.reduce((s, f) => s + f.totalCents, 0) / n);
  const quotas = saida.map((f) => {
    const exact = f.totalCents / n;
    const base = Math.floor(exact);
    return { f, base, frac: exact - base };
  });
  quotas.sort((a, b) => b.frac - a.frac || b.f.totalCents - a.f.totalCents);
  let resto = alvo - quotas.reduce((s, q) => s + q.base, 0);
  for (const q of quotas) {
    q.f.mediaCents = q.base + (resto > 0 ? 1 : 0);
    if (resto > 0) resto -= 1;
  }
  return saida.sort((a, b) => b.ultimoCents - a.ultimoCents || b.totalCents - a.totalCents);
}

export function pctDaFatia(cents: number, total: number) {
  if (!total) return 0;
  return (cents / total) * 100;
}

/** Soma duas séries já resolvidas (mês, média, previsto). Não divide de novo. */
export function somarComparativo(
  itens: readonly { slug: string; nome: string; aCents: number; bCents: number }[]
): FatiaCusto[] {
  const mapa = new Map<string, FatiaCusto>();
  for (const item of itens) {
    const atual = mapa.get(item.slug) ?? {
      slug: item.slug,
      nome: item.nome,
      ultimoCents: 0,
      mediaCents: 0,
      totalCents: 0
    };
    atual.ultimoCents += item.aCents;
    atual.mediaCents += item.bCents;
    atual.totalCents += item.aCents;
    mapa.set(item.slug, atual);
  }
  return [...mapa.values()]
    .filter((f) => f.ultimoCents > 0 || f.mediaCents > 0)
    .sort((a, b) => b.ultimoCents - a.ultimoCents || b.mediaCents - a.mediaCents);
}

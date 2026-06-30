import directorConfig from "@/data/areas/vendas-director-dashboard.json";

const PER_SELLER = directorConfig.weeklyTargetsPerSeller100;

/** Metas semanais por indicador (equipe = perSeller × qtd vendedores ativos). */
export function weeklyMetaFor(
  indicatorId: string,
  activeSellerCount: number,
  vendedor?: string | null
): string | null {
  const mult = vendedor && vendedor !== "todos" ? 1 : Math.max(activeSellerCount, 1);
  const n = (per: number) => String(per * mult);

  switch (indicatorId) {
    case "visitas-total":
      return `≥ ${n(PER_SELLER.visitasDiagnosticos)}`;
    case "propostas-novas":
      return `≥ ${n(PER_SELLER.propostasGeradas)}`;
    case "propostas-apresentadas":
      return `≥ ${n(PER_SELLER.apresentacoesProposta)}`;
    case "assembleias":
      return `≥ ${mult}`;
    case "followups":
      return `≥ ${n(PER_SELLER.followupsNegociacao)}`;
    case "fechamentos-qtd":
      return `≥ ${n(PER_SELLER.fechamentos)}`;
    case "propostas-paradas":
      return `≤ ${PER_SELLER.slaBreachesMax}`;
    case "propostas-pendentes":
      return `≤ ${PER_SELLER.slaBreachesMax}`;
    case "conversao-real":
      return "≥ 25";
    case "conversao-ritmo":
      return "≥ 25";
    case "tempo-medio-conversao":
      return "≤ 45";
    case "tempo-elaborar-proposta":
      return "≤ 5";
    case "indicacoes":
      return "≥ 3";
    default:
      return null;
  }
}

export function buildWeeklyMetasMap(
  indicatorIds: string[],
  activeSellerCount: number,
  vendedor?: string | null
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of indicatorIds) {
    const m = weeklyMetaFor(id, activeSellerCount, vendedor);
    if (m) out[id] = m;
  }
  return out;
}

/**
 * Constantes e helpers usados pela cobertura de pessoas no browser.
 * A escrita mora em `saida-sem-dono.ts` (server-only); isto é só UI.
 */

export const TIPOS_SAIDA_SEM_DONO = {
  fornecedor_obras: { rotulo: "Fornecedor de obras", categoryCode: "4.03" },
  utilidade: { rotulo: "Conta (internet, luz…)", categoryCode: "5.02" },
  imposto_simples: { rotulo: "Imposto / Simples / DAS", categoryCode: "7.01" },
  outro: { rotulo: "Outro fornecedor / serviço", categoryCode: null }
} as const;

export type TipoSaidaSemDono = keyof typeof TIPOS_SAIDA_SEM_DONO;

export function tipoSaidaValido(v: unknown): v is TipoSaidaSemDono {
  return typeof v === "string" && v in TIPOS_SAIDA_SEM_DONO;
}

/** Espelho de `nomeSugeridoDoExtrato` do servidor — mesma regra, no client. */
export function nomeSugeridoDoExtrato(descricao: string): string | null {
  const bruto = descricao.trim();
  if (!bruto) return null;

  if (bruto.includes("|")) {
    const parte = bruto.split("|").pop()?.trim() ?? "";
    if (parte.length >= 3 && !/^pagamento/i.test(parte)) return parte;
  }

  const traco = bruto.match(/[—–-]\s*(.+)$/);
  if (traco?.[1]) {
    const parte = traco[1].trim();
    if (parte.length >= 3) return parte;
  }

  if (/simples\s+nacional/i.test(bruto)) return "Simples Nacional";

  return null;
}

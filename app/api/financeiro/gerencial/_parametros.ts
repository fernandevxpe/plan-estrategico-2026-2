import {
  ParametroInvalido,
  bandeiraDe,
  mesDe,
  opcaoDe
} from "@/lib/financeiro/contratos/http";

/** Enum opcional: ausente continua ausente; presente passa pela lista branca comum. */
export function opcaoOpcionalDe<const T extends readonly [string, ...string[]]>(
  sp: URLSearchParams,
  nome: string,
  validas: T
): T[number] | undefined {
  const bruto = sp.get(nome);
  if (bruto === null || bruto === "") return undefined;
  return opcaoDe(sp, nome, validas, validas[0]) as T[number];
}

/**
 * A função-base considera qualquer texto diferente das formas positivas como
 * falso. Na fronteira HTTP isso esconderia um typo (`?semCobranca=tru`), então
 * a rota aceita explicitamente as formas positivas e negativas antes de usá-la.
 */
export function bandeiraEstritaDe(sp: URLSearchParams, nome: string): boolean {
  const bruto = sp.get(nome)?.trim().toLowerCase();
  if (bruto === undefined || bruto === "") return false;
  if (!["1", "true", "sim", "0", "false", "nao", "não"].includes(bruto)) {
    throw new ParametroInvalido(nome, `${nome} deve ser booleano (1/0, true/false ou sim/não)`);
  }
  return bandeiraDe(sp, nome);
}

/**
 * Usa a normalização comum e completa a validação do calendário. `mesDe`
 * garante o formato, mas `Date.parse`/Postgres não devem decidir silenciosamente
 * o que `2026-02-30` significa para uma demonstração financeira.
 */
export function mesEstritoDe(sp: URLSearchParams, nome: string): string | undefined {
  const normalizado = mesDe(sp, nome);
  if (!normalizado) return undefined;

  const bruto = sp.get(nome)!;
  const [ano, mes, dia = 1] = bruto.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  if (
    ano < 2015 ||
    ano > 2100 ||
    mes < 1 ||
    mes > 12 ||
    dia < 1 ||
    data.getUTCFullYear() !== ano ||
    data.getUTCMonth() + 1 !== mes ||
    data.getUTCDate() !== dia
  ) {
    throw new ParametroInvalido(nome, `${nome} deve representar um mês ou data real`);
  }
  return normalizado;
}

/** Intervalo inclusivo de views mensais, sempre normalizado para YYYY-MM-01. */
export function intervaloMensalDe(
  sp: URLSearchParams,
  nomes: { de?: string; ate?: string } = {}
): { de?: string; ate?: string } {
  const nomeDe = nomes.de ?? "de";
  const nomeAte = nomes.ate ?? "ate";
  const de = mesEstritoDe(sp, nomeDe);
  const ate = mesEstritoDe(sp, nomeAte);
  if (de && ate && de > ate) {
    throw new ParametroInvalido(nomeDe, `${nomeDe} não pode ser posterior a ${nomeAte}`);
  }
  return { de, ate };
}

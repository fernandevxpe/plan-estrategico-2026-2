import type { Ordenacao, Paginacao } from "@/lib/financeiro/contratos/base";
import {
  ParametroInvalido,
  bandeiraDe,
  dataDe,
  inteiroDe,
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

/**
 * Data do dia, com o calendário conferido.
 *
 * `dataDe` garante o formato, mas `Date.parse('2026-02-30')` **rola para 02/03**
 * em vez de recusar. Numa listagem isso vira um recorte silenciosamente diferente
 * do pedido — a pessoa filtra fevereiro e recebe março junto, com 200 OK.
 */
export function dataEstritaDe(sp: URLSearchParams, nome: string): string | undefined {
  const bruto = dataDe(sp, nome);
  if (!bruto) return undefined;

  const [ano, mes, dia] = bruto.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  if (
    ano < 2015 ||
    ano > 2100 ||
    data.getUTCFullYear() !== ano ||
    data.getUTCMonth() + 1 !== mes ||
    data.getUTCDate() !== dia
  ) {
    throw new ParametroInvalido(nome, `${nome} deve ser uma data real do calendário`);
  }
  return bruto;
}

/** Intervalo inclusivo por dia, no par `de`/`ate` que todo filtro desta API usa. */
export function intervaloDiarioDe(
  sp: URLSearchParams,
  nomes: { de?: string; ate?: string } = {}
): { de?: string; ate?: string } {
  const nomeDe = nomes.de ?? "de";
  const nomeAte = nomes.ate ?? "ate";
  const de = dataEstritaDe(sp, nomeDe);
  const ate = dataEstritaDe(sp, nomeAte);
  if (de && ate && de > ate) {
    throw new ParametroInvalido(nomeDe, `${nomeDe} não pode ser posterior a ${nomeAte}`);
  }
  return { de, ate };
}

/** O teto de `normalizarPaginacao` (POR_PAGINA_MAX). Repetido aqui para virar 400, não corte mudo. */
const POR_PAGINA_MAX = 500;

/**
 * Paginação vinda da URL.
 *
 * `normalizarPaginacao` CORTA o excesso em silêncio — pedir 5.000 devolve 500 e
 * a página seguinte pula 5.000 linhas que nunca vieram. Na fronteira HTTP isso é
 * perda de dado sem aviso, então aqui o excesso é 400 com a faixa dita.
 */
export function paginacaoDe(sp: URLSearchParams): Paginacao {
  return {
    pagina: inteiroDe(sp, "pagina", { min: 1, max: 1_000_000 }),
    porPagina: inteiroDe(sp, "porPagina", { min: 1, max: POR_PAGINA_MAX })
  };
}

const DIRECOES = ["asc", "desc"] as const;

/**
 * Ordenação por lista branca, com o campo aplicado devolvido no corpo.
 *
 * `ordenarPor` (em `base.ts`) já ignora campo desconhecido e cai no padrão. Isso
 * é certo dentro do contrato e errado na fronteira: `?ordenarPor=vlaor` devolveria
 * a lista ordenada por outra coisa com 200 OK, e quem lê a primeira página conclui
 * que os maiores valores são aqueles. Aqui o desconhecido é 400.
 */
export function ordenacaoDe<const T extends readonly [string, ...string[]]>(
  sp: URLSearchParams,
  campos: T,
  padrao: { campo: T[number]; direcao: "asc" | "desc" }
): Ordenacao<T[number]> {
  return {
    campo: opcaoDe(sp, "ordenarPor", campos as readonly T[number][], padrao.campo),
    direcao: opcaoDe(sp, "direcao", DIRECOES, padrao.direcao)
  };
}

/**
 * Valor monetário de filtro, em CENTAVOS.
 *
 * O nome do parâmetro carrega `Cents` de propósito: quem passar reais achando que
 * são reais filtra por um valor 100× menor e conclui que a base perdeu lançamento.
 * A faixa cobre ±R$ 100 milhões, muito além de qualquer linha desta base.
 */
export function centavosDe(sp: URLSearchParams, nome: string): number | undefined {
  return inteiroDe(sp, nome, { min: -10_000_000_000, max: 10_000_000_000 });
}

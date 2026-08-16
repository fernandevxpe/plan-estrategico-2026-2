import "server-only";

import { FinanceUnavailableError } from "../db";
import type { Contrato, Pendencia } from "./base";

/**
 * A tradução HTTP dos contratos financeiros.
 *
 * Existe para que as 15 rotas de leitura gerencial não repitam — e portanto não
 * divirjam — as três decisões que valem para todas elas:
 *
 * 1. O ENVELOPE VIAJA INTEIRO, SEMPRE.
 *    A rota devolve o `Contrato<T>` como está: `dado`, `cobertura`,
 *    `frescorPior`, `pendencias`, `ressalvas`, `medidoEm`. Nada de "achatar para
 *    o que a tela precisa" — quem achata escolhe o número e descarta o motivo, e
 *    é exatamente essa a mentira que este ledger foi construído para não contar.
 *
 * 2. INDISPONÍVEL É 503 COM CORPO, NÃO 500 SECO NEM 200 MENTIROSO.
 *    `disponivel: false` vira 503 — mas com o envelope completo no corpo, com o
 *    motivo em `ressalvas`. Um cliente ingênuo vê o status e sabe que não deve
 *    confiar; um cliente cuidadoso lê o corpo e sabe POR QUÊ. 200 com dado vazio
 *    seria indistinguível de "não houve movimento".
 *
 * 3. NUNCA CACHE.
 *    Estes números mudam a cada importação de extrato. `no-store` no cabeçalho e
 *    `force-dynamic` em cada rota: um DRE servido do cache do CDN é um DRE de
 *    data desconhecida, e data desconhecida é pior que dado velho declarado.
 *
 * SOMENTE LEITURA. Nenhuma função daqui escreve, e nenhuma rota que a usa expõe
 * verbo além de GET.
 */

// ---------------------------------------------------------------------------
// Resposta
// ---------------------------------------------------------------------------

/**
 * Devolve o contrato como resposta HTTP.
 *
 * Os cabeçalhos `x-fin-*` repetem, em ASCII, o que já está no corpo. Servem a
 * quem monitora sem parsear JSON (um `curl -I`, um alerta de uptime): dá para
 * ver que o domínio respondeu, mas com a pior fonte `atrasado`, sem baixar 400 KB
 * de DRE.
 */
export function responderContrato<T>(contrato: Contrato<T>): Response {
  return Response.json(contrato, {
    status: contrato.disponivel ? 200 : 503,
    headers: {
      "Cache-Control": "no-store",
      "x-fin-dominio": ascii(contrato.dominio),
      "x-fin-disponivel": String(contrato.disponivel),
      "x-fin-frescor": ascii(contrato.frescorPior?.estado ?? "sem_fonte"),
      "x-fin-pendencias": String(contrato.pendencias.length)
    }
  });
}

/** Cabeçalho HTTP não aceita byte alto; acento aqui derrubaria a resposta inteira. */
function ascii(valor: string): string {
  return valor.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\u0020-\u007e]/g, "");
}

/**
 * Acrescenta ressalvas MEDIDAS ao contrato, na frente das fixas.
 *
 * A diferença entre as duas importa. As ressalvas do contrato são permanentes
 * ("fluxo é sempre regime de caixa"); estas são o estado de hoje ("a folha de
 * agosto ainda não saiu, então este mês está otimista"). A perecível vem
 * primeiro porque é a que muda a leitura do número que está na tela agora.
 *
 * Fica na camada HTTP de propósito: ela é DERIVADA do dado que acabou de voltar,
 * medida a cada requisição. Escrevê-la fixa dentro do contrato a congelaria num
 * dia — e no dia seguinte a frase seria falsa sem ninguém perceber.
 */
export function comRessalvas<T>(contrato: Contrato<T>, ...frases: (string | null | undefined)[]): Contrato<T> {
  const novas = frases.filter((f): f is string => typeof f === "string" && f.length > 0);
  if (!novas.length) return contrato;
  return { ...contrato, ressalvas: [...novas, ...contrato.ressalvas] };
}

/** Acrescenta pendências medidas na requisição. Null é ignorado, para o chamador poder decidir inline. */
export function comPendencias<T>(contrato: Contrato<T>, ...itens: (Pendencia | null | undefined)[]): Contrato<T> {
  const novas = itens.filter((p): p is Pendencia => Boolean(p));
  if (!novas.length) return contrato;
  return { ...contrato, pendencias: [...contrato.pendencias, ...novas] };
}

// ---------------------------------------------------------------------------
// Parâmetros de URL
// ---------------------------------------------------------------------------

/**
 * Parâmetro malformado é erro do pedido, não do servidor.
 *
 * `?ano=abc` não pode virar `NaN` e escorrer até o SQL: ou o banco recusa com uma
 * mensagem que não diz nada ao chamador, ou — pior — o `NaN` some num COALESCE e
 * a rota devolve o ano errado com 200 OK.
 */
export class ParametroInvalido extends Error {
  constructor(readonly parametro: string, mensagem: string) {
    super(mensagem);
    this.name = "ParametroInvalido";
  }
}

const ANO_MIN = 2015;
const ANO_MAX = 2100;

export function anoDe(sp: URLSearchParams, nome = "ano"): number | undefined {
  const bruto = sp.get(nome);
  if (bruto === null || bruto === "") return undefined;
  const n = Number(bruto);
  if (!Number.isInteger(n) || n < ANO_MIN || n > ANO_MAX) {
    throw new ParametroInvalido(nome, `${nome} deve ser um ano entre ${ANO_MIN} e ${ANO_MAX}`);
  }
  return n;
}

export function inteiroDe(
  sp: URLSearchParams,
  nome: string,
  faixa: { min: number; max: number }
): number | undefined {
  const bruto = sp.get(nome);
  if (bruto === null || bruto === "") return undefined;
  const n = Number(bruto);
  if (!Number.isInteger(n) || n < faixa.min || n > faixa.max) {
    throw new ParametroInvalido(nome, `${nome} deve ser inteiro entre ${faixa.min} e ${faixa.max}`);
  }
  return n;
}

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const MES_ISO = /^\d{4}-\d{2}$/;

/** `YYYY-MM-DD`. Recusa o resto em vez de deixar o Postgres adivinhar o formato. */
export function dataDe(sp: URLSearchParams, nome: string): string | undefined {
  const bruto = sp.get(nome);
  if (bruto === null || bruto === "") return undefined;
  if (!DATA_ISO.test(bruto) || Number.isNaN(Date.parse(`${bruto}T00:00:00Z`))) {
    throw new ParametroInvalido(nome, `${nome} deve ser uma data ISO válida (YYYY-MM-DD)`);
  }
  return bruto;
}

/**
 * Mês, normalizado para o primeiro dia.
 *
 * Aceita `YYYY-MM` e `YYYY-MM-DD` e devolve sempre `YYYY-MM-01`, porque toda
 * view mensal deste ledger usa `date_trunc('month', ...)` como chave. Sem a
 * normalização, `?mes=2026-08-16` casaria com zero linhas e a tela leria
 * "não houve movimento em agosto".
 */
export function mesDe(sp: URLSearchParams, nome: string): string | undefined {
  const bruto = sp.get(nome);
  if (bruto === null || bruto === "") return undefined;
  if (MES_ISO.test(bruto)) return `${bruto}-01`;
  if (DATA_ISO.test(bruto)) return `${bruto.slice(0, 7)}-01`;
  throw new ParametroInvalido(nome, `${nome} deve ser YYYY-MM ou YYYY-MM-DD`);
}

/** Enum por lista branca. Devolve o padrão quando ausente; recusa o desconhecido. */
export function opcaoDe<T extends string>(
  sp: URLSearchParams,
  nome: string,
  validas: readonly T[],
  padrao: T
): T {
  const bruto = sp.get(nome);
  if (bruto === null || bruto === "") return padrao;
  if (!(validas as readonly string[]).includes(bruto)) {
    throw new ParametroInvalido(nome, `${nome} deve ser um de: ${validas.join(", ")}`);
  }
  return bruto as T;
}

/** Texto livre de filtro, com teto. Só chega a SQL como parâmetro, nunca interpolado. */
export function textoDe(sp: URLSearchParams, nome: string, maximo = 120): string | undefined {
  const bruto = sp.get(nome)?.trim();
  if (!bruto) return undefined;
  if (bruto.length > maximo) throw new ParametroInvalido(nome, `${nome} excede ${maximo} caracteres`);
  return bruto;
}

/** `?flag=1` / `true` / `sim`. Ausente é falso. */
export function bandeiraDe(sp: URLSearchParams, nome: string): boolean {
  const bruto = sp.get(nome)?.toLowerCase();
  return bruto === "1" || bruto === "true" || bruto === "sim";
}

// ---------------------------------------------------------------------------
// Envoltório da rota
// ---------------------------------------------------------------------------

/**
 * Embrulha o handler de uma rota de leitura.
 *
 * Faz três coisas e só essas: entrega os `searchParams` já prontos, traduz
 * `ParametroInvalido` em 400 e `FinanceUnavailableError` em 503. Qualquer outra
 * exceção sobe — bug nosso tem de aparecer no log com a pilha, não virar um
 * `{"erro":"algo deu errado"}` que ninguém consegue investigar.
 *
 * Note que o 503 daqui é o do banco fora do ar. O 503 de `responderContrato` é o
 * do domínio indisponível COM diagnóstico. Os dois existem porque a diferença
 * entre "o Postgres não respondeu" e "esta view não tem dado e eis o motivo" é a
 * diferença entre chamar o plantão e chamar o Fernando.
 */
export function rotaDeLeitura(
  handler: (sp: URLSearchParams, request: Request) => Promise<Response>
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    const sp = new URL(request.url).searchParams;
    try {
      return await handler(sp, request);
    } catch (erro) {
      if (erro instanceof ParametroInvalido) {
        return Response.json(
          { erro: erro.message, parametro: erro.parametro },
          { status: 400, headers: { "Cache-Control": "no-store" } }
        );
      }
      if (erro instanceof FinanceUnavailableError) {
        return Response.json(
          { erro: "banco financeiro indisponível", motivo: erro.message },
          { status: 503, headers: { "Cache-Control": "no-store" } }
        );
      }
      throw erro;
    }
  };
}

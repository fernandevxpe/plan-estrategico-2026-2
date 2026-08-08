// Cliente HTTP com retry, para as integrações do módulo financeiro.
//
// É a lógica de `getJson` de scripts/sync-data.mjs generalizada — deliberadamente
// COPIADA e não extraída de lá. Aquele arquivo carrega três cicatrizes de
// produção documentadas nos próprios comentários (a requisição pendurada por 20
// minutos, o 429 com retry-after de mais de uma hora, o estouro de quota nos
// deal flows) e é o pipeline do qual o comercial já depende todo dia. Unificar os
// dois no mesmo commit que estreia o financeiro arriscaria o que já funciona
// para economizar 40 linhas. Se um dia valer unificar, que seja num commit
// isolado e com o sync comercial verificado.

/** Sem isto uma conexão pendurada trava o sync para sempre. */
const DEFAULT_TIMEOUT_MS = 60_000;
/** Teto para o retry-after: obedecer ao pé da letra já travou o pipeline por horas. */
const DEFAULT_MAX_RETRY_DELAY_MS = 30_000;

/**
 * Cria um leitor de JSON com retry.
 *
 * @param {object} [options]
 * @param {number} [options.timeoutMs]
 * @param {number} [options.maxRetryDelayMs]
 * @param {number} [options.maxAttempts]
 * @param {string} [options.label] prefixo dos logs, para saber quem falhou
 */
export function createJsonFetcher({
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxRetryDelayMs = DEFAULT_MAX_RETRY_DELAY_MS,
  maxAttempts = 4,
  label = 'http'
} = {}) {
  return async function getJson(url, options = {}) {
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await fetch(url, {
          ...options,
          signal: AbortSignal.timeout(timeoutMs)
        });
        if (response.ok) return response.json();

        const body = await response.text();
        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable || attempt === maxAttempts) {
          throw new Error(`${response.status} ${response.statusText} em ${url}\n${body.slice(0, 800)}`);
        }
        const retryAfter = Number(response.headers.get('retry-after') || 0);
        const suggested = retryAfter > 0 ? retryAfter * 1_000 : 500 * 2 ** (attempt - 1);
        const delayMs = Math.min(suggested, maxRetryDelayMs);
        console.warn(`  [${label}] ${response.status} (tentativa ${attempt}/${maxAttempts}), aguardando ${Math.round(delayMs / 1000)}s`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      } catch (error) {
        // Timeout e queda de rede são transitórios; erro de status já saiu acima.
        const transient = error.name === 'TimeoutError' || error.name === 'AbortError' || Boolean(error.cause);
        if (!transient || attempt === maxAttempts) throw error;
        lastError = error;
        console.warn(`  [${label}] tentativa ${attempt}/${maxAttempts} falhou (${error.name}), repetindo...`);
        await new Promise((resolve) => setTimeout(resolve, 1_000 * 2 ** (attempt - 1)));
      }
    }
    throw lastError ?? new Error(`Falha inesperada ao consultar ${url}`);
  };
}

/**
 * Percorre uma coleção paginada por offset (formato do Asaas).
 *
 * O teto de páginas não é paranoia: um `hasMore` que nunca vira false por bug da
 * API ou por filtro mal montado vira laço infinito consumindo quota. Falhar alto
 * é melhor que rodar a noite inteira.
 *
 * @param {(url: string) => Promise<any>} getJson
 * @param {(offset: number, limit: number) => string} buildUrl
 * @param {object} [options]
 */
export async function fetchAllPages(getJson, buildUrl, { limit = 100, maxPages = 500, delayMs = 80, onPage } = {}) {
  const all = [];
  let offset = 0;

  for (let page = 0; ; page += 1) {
    if (page >= maxPages) {
      throw new Error(`paginação passou de ${maxPages} páginas (${all.length} registros) — provável laço infinito`);
    }
    const json = await getJson(buildUrl(offset, limit));
    const batch = json?.data ?? [];
    all.push(...batch);
    if (onPage) onPage(all.length, json?.totalCount);
    if (!json?.hasMore || batch.length === 0) break;
    offset += limit;
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return all;
}

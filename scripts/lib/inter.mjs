// Cliente da API Banking do Banco Inter (mTLS + OAuth client_credentials).
//
// Por que não usa o `createJsonFetcher` de lib/http.mjs: o `fetch` global do
// Node não fala mTLS. Para mandar certificado de cliente seria preciso um
// dispatcher do `undici`, que é dependência nova. `node:https` resolve com zero
// dependências — e o retry aqui é mais simples porque o Inter tem um limite
// declarado (10 req/min) em vez das surpresas de quota que justificaram a
// complexidade do fetcher do comercial.
//
// Credenciais: nunca embutidas. Local vem de arquivo (secrets/), produção vem de
// base64 em variável — o container do Railway não tem como receber arquivo.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { resolve } from 'node:path';

const HOST = 'cdpj.partners.bancointer.com.br';

/** O Inter documenta 10 chamadas por minuto no extrato. 7s dá folga. */
const INTERVALO_MS = 7_000;
/** A janela máxima por consulta é de 90 dias; 80 evita discussão de borda. */
export const JANELA_MAXIMA_DIAS = 80;

/**
 * Lê certificado e chave.
 *
 * Três origens, nesta ordem: variável base64 (produção), caminho explícito, e
 * descoberta pela extensão dentro de `secrets/` — porque o Inter entrega os
 * arquivos com espaço no nome ("Inter API_Certificado.crt") e obrigar a
 * renomear é convite a erro.
 */
function lerCredencial(varB64, varPath, extensao, rotulo) {
  const b64 = process.env[varB64];
  if (b64) return Buffer.from(b64, 'base64').toString('utf8');

  const explicito = process.env[varPath];
  if (explicito) {
    if (!existsSync(resolve(explicito))) throw new Error(`${rotulo} não encontrado em ${explicito}`);
    return readFileSync(resolve(explicito), 'utf8');
  }

  const dir = resolve('secrets');
  if (existsSync(dir)) {
    const achados = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(extensao));
    if (achados.length === 1) return readFileSync(resolve(dir, achados[0]), 'utf8');
    if (achados.length > 1) throw new Error(`mais de um ${rotulo} em secrets/ — defina ${varPath}`);
  }

  throw new Error(`${rotulo} não configurado (${varB64} em produção, secrets/ no local)`);
}

function pedir({ cert, key, path, method, headers = {}, body }) {
  return new Promise((resolveReq, reject) => {
    const req = httpsRequest({ host: HOST, path, method, headers, cert, key, timeout: 60_000 }, (res) => {
      let dados = '';
      res.on('data', (c) => (dados += c));
      res.on('end', () => resolveReq({ status: res.statusCode, body: dados }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout de 60s')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Cria o cliente. As credenciais são lidas uma vez e ficam só em memória.
 *
 * O token vale cerca de 1h; renovar a cada chamada gastaria metade do limite de
 * requisições com autenticação. Guarda com margem de 60s.
 */
export function createInterClient({ escopo = 'extrato.read' } = {}) {
  const clientId = process.env.INTER_CLIENT_ID;
  const clientSecret = process.env.INTER_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('INTER_CLIENT_ID/INTER_CLIENT_SECRET ausentes');

  const cert = lerCredencial('INTER_CERT_B64', 'INTER_CERT_PATH', '.crt', 'certificado');
  const key = lerCredencial('INTER_KEY_B64', 'INTER_KEY_PATH', '.key', 'chave privada');

  let token = null;
  let expiraEm = 0;
  let ultimaChamada = 0;

  async function obterToken() {
    if (token && Date.now() < expiraEm) return token;

    const corpo = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
      scope: escopo
    }).toString();

    const res = await pedir({
      cert,
      key,
      path: '/oauth/v2/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(corpo)
      },
      body: corpo
    });

    // A mensagem nunca ecoa o corpo da requisição: ali vai o client_secret.
    if (res.status !== 200) throw new Error(`token do Inter falhou: HTTP ${res.status}`);

    const json = JSON.parse(res.body);
    token = json.access_token;
    expiraEm = Date.now() + Math.max(0, (json.expires_in ?? 3600) - 60) * 1000;
    return token;
  }

  /** GET autenticado, com espaçamento e retry para 429/5xx. */
  async function get(path, { tentativas = 4 } = {}) {
    for (let tentativa = 1; tentativa <= tentativas; tentativa += 1) {
      const desde = Date.now() - ultimaChamada;
      if (desde < INTERVALO_MS) await espera(INTERVALO_MS - desde);

      const bearer = await obterToken();
      ultimaChamada = Date.now();
      const res = await pedir({
        cert,
        key,
        path,
        method: 'GET',
        headers: { Authorization: `Bearer ${bearer}`, Accept: 'application/json' }
      });

      if (res.status === 200) return JSON.parse(res.body);

      // 401 no meio de um sync longo é token vencido, não credencial errada:
      // descarta e deixa a próxima volta renovar.
      if (res.status === 401) {
        token = null;
        expiraEm = 0;
        if (tentativa < tentativas) continue;
      }

      const retentavel = res.status === 429 || res.status >= 500;
      if (!retentavel || tentativa === tentativas) {
        throw new Error(`Inter GET ${path.split('?')[0]} falhou: HTTP ${res.status} ${res.body.slice(0, 200)}`);
      }
      await espera(Math.min(30_000, INTERVALO_MS * 2 ** tentativa));
    }
    throw new Error(`Inter GET ${path.split('?')[0]}: tentativas esgotadas`);
  }

  /**
   * Extrato completo, página a página.
   *
   * É esta a versão usada pelo sync, e não `/banking/v2/extrato`, por um motivo
   * de correção: o extrato simples não devolve identificador nenhum — só data,
   * tipo, valor e descrição. Dois PIX iguais para a mesma pessoa no mesmo dia
   * ficam indistinguíveis, e qualquer deduplicação por conteúdo apagaria um dos
   * dois. Medido na primeira carga: 150 transações vindas da API viravam 142.
   *
   * O `/completo` traz `idTransacao`, e ainda `numeroDocumento` e `detalhes`,
   * que dão mais material para o motor de regras classificar.
   */
  async function extratoCompleto(inicio, fim, { onPagina } = {}) {
    const transacoes = [];
    let pagina = 0;
    let totalPaginas = 1;

    do {
      const res = await get(
        `/banking/v2/extrato/completo?dataInicio=${inicio}&dataFim=${fim}&pagina=${pagina}`
      );
      const lista = res.transacoes ?? [];
      transacoes.push(...lista);
      totalPaginas = res.totalPaginas ?? 1;
      onPagina?.({ pagina: pagina + 1, totalPaginas, nesta: lista.length });
      pagina += 1;
    } while (pagina < totalPaginas);

    return transacoes;
  }

  return {
    extratoCompleto,
    /** Extrato simples — mantido para conferência pontual; sem id, não serve ao sync. */
    extrato: (inicio, fim) => get(`/banking/v2/extrato?dataInicio=${inicio}&dataFim=${fim}`),
    /** Saldo na data (ou hoje, se omitida). */
    saldo: (data) => get(`/banking/v2/saldo${data ? `?dataSaldo=${data}` : ''}`)
  };
}

/**
 * Fatia um período em janelas que a API aceita.
 *
 * A carga histórica é o caso real: pedir 2 anos de uma vez devolve erro, e sem
 * fatiar o primeiro import simplesmente não roda.
 */
export function fatiarPeriodo(inicio, fim, dias = JANELA_MAXIMA_DIAS) {
  const janelas = [];
  let cursor = new Date(inicio);
  const limite = new Date(fim);

  while (cursor <= limite) {
    const ate = new Date(Math.min(cursor.getTime() + (dias - 1) * 86_400_000, limite.getTime()));
    janelas.push({ inicio: cursor.toISOString().slice(0, 10), fim: ate.toISOString().slice(0, 10) });
    cursor = new Date(ate.getTime() + 86_400_000);
  }
  return janelas;
}

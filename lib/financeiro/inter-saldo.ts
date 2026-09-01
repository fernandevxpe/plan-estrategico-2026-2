import "server-only";

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { resolve } from "node:path";

import type { SaldoConta, SaldoInter } from "./aprovacoes-caixa";
import { isFinanceConfigured, query } from "./db";

/**
 * Saldo do Inter — LEITURA, com a integração de EXTRATO.
 *
 * NÃO usa `INTER_PAG_*`. A Conta Azul documenta que marcar permissão de
 * pagamento na integração de extrato derruba o sync (docs/INTER_PAGAMENTO.md).
 * Este módulo pede `extrato.read` e só `GET /banking/v2/saldo`. Nenhum POST,
 * nenhuma ordem, nenhum centavo sai da conta.
 *
 * O cliente de escrita (`inter-pagamento.ts`) é o outro certificado, de
 * propósito. Misturar os dois aqui seria a mesma falha que a casa já pagou.
 */

const HOST = "cdpj.partners.bancointer.com.br";
const CAMINHO_TOKEN = "/oauth/v2/token";
const CAMINHO_SALDO = "/banking/v2/saldo";
const ESCOPO = "extrato.read";
const TIMEOUT_MS = 12_000;
const MARGEM_TOKEN_S = 60;

const VAZIO: SaldoInter = {
  disponivelCents: null,
  bloqueadoCents: 0,
  em: null,
  fonte: null,
  lastroAte: null,
  ressalva: "saldo do Inter indisponível"
};

function reaisParaCents(valor: unknown): number {
  const n = typeof valor === "number" ? valor : Number(valor);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function lerCredencial(varB64: string, varPath: string, extensao: string, rotulo: string): string {
  const b64 = process.env[varB64];
  if (b64) return Buffer.from(b64, "base64").toString("utf8");

  const explicito = process.env[varPath];
  if (explicito) {
    const absoluto = resolve(explicito);
    if (!existsSync(absoluto)) throw new Error(`${rotulo} não encontrado em ${varPath}`);
    return readFileSync(absoluto, "utf8");
  }

  const dir = resolve("secrets");
  if (existsSync(dir)) {
    // `inter-pagamento.*` é o outro certificado. Entrar nele aqui pediria
    // token de extrato com a integração de pagamento — e o Inter recusa.
    const achados = readdirSync(dir).filter(
      (f) => f.toLowerCase().endsWith(extensao) && !f.toLowerCase().startsWith("inter-pagamento")
    );
    if (achados.length === 1) return readFileSync(resolve(dir, achados[0]), "utf8");
    if (achados.length > 1) throw new Error(`mais de um ${rotulo} em secrets/ — defina ${varPath}`);
  }

  throw new Error(`${rotulo} não configurado`);
}

function credenciaisExtrato(): { clientId: string; clientSecret: string; cert: string; key: string } {
  const clientId = process.env.INTER_CLIENT_ID?.trim();
  const clientSecret = process.env.INTER_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("INTER_CLIENT_ID/INTER_CLIENT_SECRET ausentes — saldo ao vivo usa a integração de extrato");
  }
  return {
    clientId,
    clientSecret,
    cert: lerCredencial("INTER_CERT_B64", "INTER_CERT_PATH", ".crt", "certificado de extrato"),
    key: lerCredencial("INTER_KEY_B64", "INTER_KEY_PATH", ".key", "chave de extrato")
  };
}

function pedir(args: {
  cert: string;
  key: string;
  path: string;
  method: string;
  headers?: Record<string, string | number>;
  body?: string;
}): Promise<{ status: number; body: string }> {
  return new Promise((resolver, rejeitar) => {
    const req = httpsRequest(
      {
        host: HOST,
        path: args.path,
        method: args.method,
        headers: args.headers ?? {},
        cert: args.cert,
        key: args.key,
        timeout: TIMEOUT_MS
      },
      (res) => {
        let dados = "";
        res.on("data", (pedaco) => (dados += pedaco));
        res.on("end", () => resolver({ status: res.statusCode ?? 0, body: dados }));
      }
    );
    req.on("timeout", () => req.destroy(new Error(`timeout de ${TIMEOUT_MS / 1000}s`)));
    req.on("error", rejeitar);
    if (args.body) req.write(args.body);
    req.end();
  });
}

let tokenCache: { token: string; expiraEm: number } | null = null;

/**
 * O Inter limita ~10 chamadas/min. A tela pede saldo a cada 45s — e o HMR do
 * `next dev` multiplicou isso até o 429, medido em 01/09. Cache de 40s +
 * recuo de 90s depois de um 429 cabem no teto e ainda parecem "ao vivo".
 */
const CACHE_VIVO_MS = 40_000;
const RECUO_429_MS = 90_000;
let vivoCache: { saldo: SaldoInter; ate: number } | null = null;
let silenciadoAte = 0;

async function tokenExtrato(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiraEm) return tokenCache.token;

  const { clientId, clientSecret, cert, key } = credenciaisExtrato();
  const corpo = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
    scope: ESCOPO
  }).toString();

  const res = await pedir({
    cert,
    key,
    path: CAMINHO_TOKEN,
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": Buffer.byteLength(corpo)
    },
    body: corpo
  });

  if (res.status !== 200) {
    throw new Error(`token de extrato falhou: HTTP ${res.status}`);
  }
  const json = JSON.parse(res.body) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error("token de extrato veio sem access_token");

  tokenCache = {
    token: json.access_token,
    expiraEm: Date.now() + Math.max(0, (json.expires_in ?? 3600) - MARGEM_TOKEN_S) * 1000
  };
  return tokenCache.token;
}

/**
 * O que o ledger já sabe da conta `inter`.
 *
 * É o número do último sync (`import-inter.mjs` grava `current_balance_cents`
 * a partir de `/banking/v2/saldo`). Não é ao vivo — mas é instantâneo, e é o
 * que a tela mostra enquanto o GET ao banco não volta.
 */
export async function saldoInterDoLedger(): Promise<SaldoInter> {
  if (!isFinanceConfigured()) return { ...VAZIO, ressalva: "sem conexão com o banco do financeiro" };

  try {
    const linhas = await query<{ saldo: string; lastro: string | null }>(
      `SELECT a.current_balance_cents::text AS saldo,
              to_char(a.last_statement_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI') AS lastro
         FROM fin_account a
         JOIN fin_entity e ON e.id = a.entity_id
        WHERE e.slug = 'xpe' AND a.slug = 'inter'
        LIMIT 1`
    );
    const linha = linhas[0];
    if (!linha) return { ...VAZIO, ressalva: "conta inter não cadastrada no ledger" };
    return {
      disponivelCents: Number(linha.saldo),
      bloqueadoCents: 0,
      em: new Date().toISOString(),
      fonte: "ledger",
      lastroAte: linha.lastro,
      ressalva: null
    };
  } catch (error) {
    console.error("[financeiro] saldo Inter no ledger indisponível:", error);
    return { ...VAZIO, ressalva: "saldo do Inter indisponível no ledger" };
  }
}

async function saldoInterAoVivo(): Promise<SaldoInter> {
  const { cert, key } = credenciaisExtrato();
  const bearer = await tokenExtrato();
  const res = await pedir({
    cert,
    key,
    path: CAMINHO_SALDO,
    method: "GET",
    headers: { Authorization: `Bearer ${bearer}`, Accept: "application/json" }
  });
  if (res.status !== 200) {
    throw new Error(`GET /banking/v2/saldo falhou: HTTP ${res.status} ${res.body.slice(0, 160)}`);
  }
  const json = JSON.parse(res.body) as {
    disponivel?: number;
    bloqueadoCheque?: number;
    bloqueadoJudicialmente?: number;
    bloqueadoAdministrativamente?: number;
  };
  const bloqueado =
    reaisParaCents(json.bloqueadoCheque) +
    reaisParaCents(json.bloqueadoJudicialmente) +
    reaisParaCents(json.bloqueadoAdministrativamente);
  return {
    disponivelCents: reaisParaCents(json.disponivel),
    bloqueadoCents: bloqueado,
    em: new Date().toISOString(),
    fonte: "inter",
    lastroAte: null,
    ressalva: null
  };
}

/**
 * Ao vivo primeiro; ledger se o Inter não responder.
 *
 * O GET de saldo é uma chamada. O cliente de extrato espera 7s entre páginas
 * de extrato — aqui não há laço, então a espera não se aplica. O que trava é
 * o timeout de 12s: a tela de aprovações não pode herdar os 30s do cliente
 * de pagamento.
 */
const CONTA_VAZIA: SaldoConta = { disponivelCents: null, lastroAte: null, fonte: null, ressalva: null };

/**
 * Asaas e Nubank no ledger. O Asaas ao vivo mora em `asaas-saldo.ts` —
 * esta função é o fallback e o SSR. Nubank continua só daqui: o extrato
 * chega por CSV/Polp, não tem GET de saldo.
 *
 * `nubank-caixinhas` fica de fora: somar a caixinha misturaria reserva
 * com disponível.
 */
export async function saldosAsaasNubankDoLedger(): Promise<{
  asaas: SaldoConta;
  nubank: SaldoConta;
}> {
  if (!isFinanceConfigured()) return { asaas: CONTA_VAZIA, nubank: CONTA_VAZIA };

  try {
    const linhas = await query<{ slug: string; saldo: string; lastro: string | null }>(
      `SELECT a.slug,
              a.current_balance_cents::text AS saldo,
              to_char(a.last_statement_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS lastro
         FROM fin_account a
         JOIN fin_entity e ON e.id = a.entity_id
        WHERE e.slug = 'xpe' AND a.slug IN ('asaas', 'nubank')`
    );
    const porSlug = new Map(linhas.map((l) => [l.slug, l]));
    const de = (slug: string): SaldoConta => {
      const linha = porSlug.get(slug);
      if (!linha) return CONTA_VAZIA;
      return { disponivelCents: Number(linha.saldo), lastroAte: linha.lastro, fonte: "ledger", ressalva: null };
    };
    return { asaas: de("asaas"), nubank: de("nubank") };
  } catch (error) {
    console.error("[financeiro] saldo Asaas/Nubank no ledger indisponível:", error);
    return { asaas: CONTA_VAZIA, nubank: CONTA_VAZIA };
  }
}

export async function consultarSaldoInter(): Promise<SaldoInter> {
  const agora = Date.now();
  if (vivoCache && agora < vivoCache.ate) return vivoCache.saldo;

  const ledger = await saldoInterDoLedger();
  if (agora < silenciadoAte) {
    return ledger.disponivelCents === null
      ? ledger
      : { ...ledger, ressalva: ledger.ressalva ?? "Inter em recuo após limite de chamadas; mostrando o último extrato" };
  }

  try {
    const vivo = await saldoInterAoVivo();
    vivoCache = { saldo: vivo, ate: agora + CACHE_VIVO_MS };
    return vivo;
  } catch (error) {
    const motivo = error instanceof Error ? error.message : "Inter indisponível";
    if (/HTTP 429/.test(motivo)) silenciadoAte = agora + RECUO_429_MS;
    console.warn("[financeiro] saldo Inter ao vivo falhou, usando ledger:", motivo);
    if (ledger.disponivelCents === null) {
      return { ...VAZIO, ressalva: motivo };
    }
    return {
      ...ledger,
      ressalva: `ao vivo falhou (${motivo}); mostrando o saldo do último extrato`
    };
  }
}

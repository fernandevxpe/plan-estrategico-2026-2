import "server-only";

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { SaldoConta } from "./aprovacoes-caixa";
import { saldosAsaasNubankDoLedger } from "./inter-saldo";

/**
 * Saldo do Asaas — LEITURA, `GET /v3/finance/balance`.
 *
 * Medido em 01/09/2026: o ledger (último sync 31/08) dizia R$ 110.845,14;
 * a API devolveu R$ 64.759,37. A diferença é o que saiu da conta depois
 * do import — mostrar a soma reconstruída nesta tela é mentir o caixa.
 *
 * Não usa o certificado do Inter. A chave é `ASAAS_API_KEY`, a mesma do
 * `sync-asaas.mjs`. Nenhum POST: só o saldo disponível.
 */

const TIMEOUT_MS = 12_000;
const CACHE_VIVO_MS = 40_000;
const VAZIO: SaldoConta = { disponivelCents: null, lastroAte: null, fonte: null, ressalva: "saldo do Asaas indisponível" };

function reaisParaCents(valor: unknown): number {
  const n = typeof valor === "number" ? valor : Number(valor);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/**
 * A chave do Asaas começa com `$aact_`. O loader do Next trata `$` como
 * interpolação e esvazia `process.env.ASAAS_API_KEY` no `next dev`. Medido
 * em 01/09/2026: sem isto o GET caía no ledger de 31/08 (R$ 110.845) no
 * lugar do ao vivo (R$ 64.759). No Railway a variável chega inteira — este
 * fallback só lê `.env.local` quando o env já veio vazio.
 */
function chaveAsaas(): string | null {
  const direto = process.env.ASAAS_API_KEY?.trim();
  if (direto) return direto;
  for (const arquivo of [resolve(process.cwd(), ".env.local")]) {
    if (!existsSync(arquivo)) continue;
    for (const raw of readFileSync(arquivo, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line.startsWith("ASAAS_API_KEY=")) continue;
      let value = line.slice("ASAAS_API_KEY=".length).trim();
      if (
        (value.startsWith("'") && value.endsWith("'")) ||
        (value.startsWith('"') && value.endsWith('"'))
      ) {
        value = value.slice(1, -1);
      }
      return value || null;
    }
  }
  return null;
}

let vivoCache: { saldo: SaldoConta; ate: number } | null = null;

async function saldoAsaasAoVivo(): Promise<SaldoConta> {
  const chave = chaveAsaas();
  if (!chave) throw new Error("ASAAS_API_KEY ausente");

  const base = (process.env.ASAAS_API_URL || "https://api.asaas.com/v3").replace(/\/$/, "");
  const resposta = await fetch(`${base}/finance/balance`, {
    method: "GET",
    headers: { access_token: chave, "User-Agent": "xpe-plataforma/financeiro", Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store"
  });
  if (!resposta.ok) {
    throw new Error(`GET /finance/balance falhou: HTTP ${resposta.status}`);
  }
  const json = (await resposta.json()) as { balance?: number };
  return {
    disponivelCents: reaisParaCents(json.balance),
    lastroAte: null,
    fonte: "asaas",
    ressalva: null
  };
}

export async function consultarSaldoAsaas(): Promise<SaldoConta> {
  const agora = Date.now();
  if (vivoCache && agora < vivoCache.ate) return vivoCache.saldo;

  try {
    const vivo = await saldoAsaasAoVivo();
    vivoCache = { saldo: vivo, ate: agora + CACHE_VIVO_MS };
    return vivo;
  } catch (error) {
    const motivo = error instanceof Error ? error.message : "Asaas indisponível";
    console.warn("[financeiro] saldo Asaas ao vivo falhou, usando ledger:", motivo);
    const ledger = (await saldosAsaasNubankDoLedger()).asaas;
    if (ledger.disponivelCents === null) return { ...VAZIO, ressalva: motivo };
    return {
      ...ledger,
      ressalva: `ao vivo falhou (${motivo}); mostrando o saldo do último sync`
    };
  }
}

"use client";

import Link from "next/link";

/**
 * Idade do dado, sempre visível no topo.
 *
 * O sync diário ficou quebrado por semanas sem ninguém perceber, porque nenhuma
 * tela dizia de quando era o número que estava sendo lido. Passando de 48h o
 * aviso fica vermelho e explica o que fazer.
 */
const STALE_HOURS = 30;
const CRITICAL_HOURS = 48;

export type SyncState = {
  lastFinishedAt?: string | null;
  lastStatus?: "ok" | "parcial" | "erro" | null;
  lastError?: string | null;
  lastFailures?: Array<{ step: string; message: string }> | null;
};

export function DataFreshness({
  syncedAt,
  syncState
}: {
  syncedAt: string | null;
  syncState?: SyncState | null;
}) {
  if (!syncedAt) return null;

  const synced = new Date(syncedAt);
  if (Number.isNaN(synced.getTime())) return null;

  const hours = (Date.now() - synced.getTime()) / 3_600_000;
  // Um sync que roda mas falha em parte é tão enganoso quanto um sync parado:
  // o carimbo de data fica novo e o número por trás não.
  const degraded = syncState?.lastStatus === "erro" || syncState?.lastStatus === "parcial";
  const tone =
    hours >= CRITICAL_HOURS || syncState?.lastStatus === "erro"
      ? "critical"
      : hours >= STALE_HOURS || degraded
        ? "stale"
        : "fresh";
  const brokenSteps = (syncState?.lastFailures ?? []).map((item) => item.step);

  const relative =
    hours < 1
      ? "agora há pouco"
      : hours < 24
        ? `há ${Math.round(hours)}h`
        : `há ${Math.round(hours / 24)} dia${Math.round(hours / 24) === 1 ? "" : "s"}`;

  return (
    <div
      className={`freshness is-${tone}`}
      title={
        `Última sincronização: ${synced.toLocaleString("pt-BR")}` +
        (syncState?.lastError ? `\nErro: ${syncState.lastError}` : "") +
        (brokenSteps.length ? `\nSem atualizar: ${brokenSteps.join(", ")}` : "")
      }
    >
      <span className="freshness-dot" aria-hidden />
      <span className="freshness-text">
        Dados de {relative}
        {brokenSteps.length ? (
          <>
            {" · "}
            <Link href="/auditorias" title={brokenSteps.join(" · ")}>
              {brokenSteps.length} fonte{brokenSteps.length === 1 ? "" : "s"} sem atualizar
            </Link>
          </>
        ) : tone !== "fresh" ? (
          <>
            {" · "}
            <Link href="/auditorias">sync atrasado</Link>
          </>
        ) : null}
      </span>
    </div>
  );
}

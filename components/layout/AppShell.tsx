import Link from "next/link";
import { headers } from "next/headers";

import { AppNav } from "@/components/layout/AppNav";
import { CABECALHO_PERFIL, type Perfil } from "@/lib/auth/perfis";
import { DataFreshness, type SyncState } from "@/components/layout/DataFreshness";
import { readProcessed } from "@/lib/data/processed-store";
import { readFile } from "node:fs/promises";
import { dataPath } from "@/lib/data/processed-store";

type Props = {
  children: React.ReactNode;
};

export async function AppShell({ children }: Props) {
  // O perfil vem do cabeçalho que o middleware carimba, nunca do cliente.
  // Qualquer valor inesperado cai em "comum": errar para o lado de mostrar
  // menos é o único erro barato aqui.
  const perfil: Perfil = (await headers()).get(CABECALHO_PERFIL) === "admin" ? "admin" : "comum";
  const snapshot = await readProcessed<{ syncedAt: string | null }>("crm-snapshot.json", {
    syncedAt: null
  });
  // Gravado pelo agendador a cada rodada; ausente quando o sync nunca correu aqui.
  const syncState = await readFile(dataPath("sync-state.json"), "utf8")
    .then((raw) => JSON.parse(raw) as SyncState)
    .catch(() => null);
  return (
    <main className="page">
      <a className="skip-link" href="#conteudo">
        Pular para o conteúdo
      </a>
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/" className="brand brand-link">
            <div className="brand-mark">XPE</div>
            <div>
              <p className="brand-title">Planejamento 2026.2</p>
              <p className="brand-subtitle">Pipedrive · Meta · Chatwoot</p>
            </div>
          </Link>
          <div className="topbar-right">
            <DataFreshness syncedAt={snapshot.syncedAt} syncState={syncState} />
            <AppNav perfil={perfil} />
          </div>
        </div>
      </header>
      <div className="shell" id="conteudo">
        {children}
      </div>
    </main>
  );
}

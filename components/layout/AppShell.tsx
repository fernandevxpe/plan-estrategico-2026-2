import Link from "next/link";
import { headers } from "next/headers";

import { AppNav } from "@/components/layout/AppNav";
import { AtualizarFontes } from "@/components/layout/AtualizarFontes";
import { CABECALHO_PERFIL, type Perfil } from "@/lib/auth/perfis";
import { DataFreshness, type SyncState } from "@/components/layout/DataFreshness";
import { Sino } from "@/components/notificacoes/Sino";
import { Trilha } from "@/components/layout/Trilha";
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
            {/* O botão fica AO LADO do carimbo de idade porque foi ali que ele
                foi pedido — "ao lado do local onde informa a ultima
                atualização... assim se usuario mover algo das contas, pode
                apertar para atualizar as bases de dados". Quem acabou de mexer
                no banco está em qualquer tela, não em /financeiro/fontes.

                Só para admin: `/api/financeiro/*` devolve 404 (não 403) ao
                perfil comum, e um botão que sempre responde 404 é um alarme que
                não age. O componente busca o próprio estado no cliente, ao
                montar, para não pendurar consulta de banco na renderização de
                toda página do site. */}
            {perfil === "admin" ? <AtualizarFontes /> : null}
            {/* O sino vive na moldura, não numa tela: um aviso que só aparece
                em /notificacoes depende de alguém ir lá por hábito, que é
                exatamente o problema que ele existe para resolver. O conteúdo é
                filtrado no servidor pelo perfil e pela pessoa; o componente não
                sabe esconder nada, e é bom que não saiba. */}
            <Sino />
            <AppNav perfil={perfil} />
          </div>
        </div>
        {/* A segunda linha do cabeçalho: a trilha e, quando a seção tem
            irmãs, as rotas dela. Fica DENTRO do `topbar` de propósito — ela
            gruda no topo junto com o menu, e "onde estou" não deveria sumir ao
            rolar uma tela de 3.000 lançamentos. */}
        <Trilha />
      </header>
      <div className="shell" id="conteudo">
        {children}
      </div>
    </main>
  );
}

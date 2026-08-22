import Link from "next/link";

import { TimeShell } from "@/components/time/TimeShell";

/**
 * O layout do app do time.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ELE NÃO USA O `AppShell`
 * ---------------------------------------------------------------------------
 * Usava. E isso virou um vazamento no dia em que `/time` saiu de trás do Basic
 * Auth para poder ser instalado: o `AppShell` lê `sync-state.json` e monta o
 * indicador de frescor, cujo `title` concatena `lastError` e o nome da etapa
 * que falhou. Ou seja, a mensagem crua do pipeline (Pipedrive, Meta, Chatwoot,
 * Inter) ia para dentro do HTML de uma página que agora responde sem
 * credencial. Junto ia o menu inteiro da plataforma — o mapa de rotas para
 * quem nunca provou nada.
 *
 * Nada disso é do app do time. Ele tem seis telas e uma pergunta: o que você
 * precisa mandar para o financeiro. O casco próprio resolve o vazamento e, de
 * quebra, é o que o Fernando pediu — "desacoplado na interface, backend 100%
 * integrado".
 *
 * O link de volta existe para quem chegou pelo navegador da plataforma; no app
 * instalado ele fica escondido (`display-mode: standalone` no globals.css),
 * porque lá fora do escopo não há para onde voltar.
 */
export const dynamic = "force-dynamic";

export default function TimeLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="page time-page">
      <div className="shell" id="conteudo">
        <TimeShell>{children}</TimeShell>
        <p className="time-voltar">
          <Link href="/">← voltar à plataforma</Link>
        </p>
      </div>
    </main>
  );
}

import { AppShell } from "@/components/layout/AppShell";
import { ListaNotificacoes } from "@/components/notificacoes/Lista";

export const metadata = { title: "Notificações — XPE" };

/**
 * Fora de `/financeiro` de propósito: o time também recebe aviso, e sob aquele
 * prefixo o middleware devolveria 404 para ele. O que cada perfil vê é
 * decidido no servidor, pela cláusula de alcance de `lib/financeiro/notificacoes.ts`.
 */
export const dynamic = "force-dynamic";

export default function NotificacoesPage() {
  return (
    <AppShell>
      <div className="page-header">
        <h1>Notificações</h1>
        <p>
          O que precisa de você, o que já foi visto e o que alguém tratou. Um aviso resolvido reabre sozinho se o fato
          voltar a acontecer — a caixa acompanha o mundo, não o contrário.
        </p>
      </div>
      <ListaNotificacoes />
    </AppShell>
  );
}

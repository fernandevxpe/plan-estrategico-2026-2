import { AppShell } from "@/components/layout/AppShell";
import { FinAprovacoes } from "@/components/financeiro/FinAprovacoes";
import { FinShell } from "@/components/financeiro/FinShell";
import { getAprovacoes } from "@/lib/financeiro/aprovacoes";

export const metadata = {
  title: "Aprovações — Financeiro XPE"
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Aprovações — onde a ordem enviada ao Inter é acompanhada até o dinheiro sair.
 *
 * Leitura e envio, carregada no SERVIDOR como Custo da empresa e Pessoas: não há
 * escrita nesta tela, então um estado de carregamento no cliente seria custo
 * sem contrapartida.
 *
 * Sem guard de autenticação aqui e de propósito: `middleware.ts` protege
 * `/financeiro` por PREFIXO (lib/auth/perfis.ts:74). Um segundo guard na página
 * é uma regra que passa a poder divergir da primeira — e a divergência sempre
 * aparece do lado que deixa entrar.
 */
export default async function AprovacoesPage() {
  const dados = await getAprovacoes();

  return (
    <AppShell>
      <div className="page-header">
        <h1>Aprovações</h1>
      </div>
      <FinShell>
        <FinAprovacoes dados={dados} />
      </FinShell>
    </AppShell>
  );
}

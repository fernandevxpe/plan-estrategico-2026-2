import { AppShell } from "@/components/layout/AppShell";
import { FinPagamentosHistorico } from "@/components/financeiro/FinPagamentosHistorico";
import { FinShell } from "@/components/financeiro/FinShell";
import { getHistoricoPagamentos } from "@/lib/financeiro/pagamentos-historico";

export const metadata = {
  title: "Pagamentos enviados — Financeiro XPE"
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Pagamentos enviados — tudo que foi para o banco, por dia de envio.
 *
 * Somente leitura e carregada no servidor (como Aprovações). Os filtros rodam
 * no cliente sobre a lista inteira: são 86 ordens em 30/10/2026, e uma ida ao
 * servidor por tecla seria custo sem ganho. A rota GET existe para o teste e
 * para quando a lista crescer.
 *
 * Sem guard aqui: `middleware.ts` protege `/financeiro` por prefixo.
 */
export default async function PagamentosPage() {
  const dados = await getHistoricoPagamentos();
  return (
    <AppShell>
      <div className="page-header">
        <h1>Pagamentos enviados</h1>
        <p>Histórico de toda ordem que foi ao Inter, por dia de envio. Nada aqui envia ou aprova.</p>
      </div>
      <FinShell>
        <FinPagamentosHistorico dados={dados} />
      </FinShell>
    </AppShell>
  );
}

import { AppShell } from "@/components/layout/AppShell";
import { FinShell } from "@/components/financeiro/FinShell";
import { FinLedgerTable } from "@/components/financeiro/FinLedgerTable";
import { getFiltrosDisponiveis, getLancamentos } from "@/lib/financeiro/queries";

export const metadata = {
  title: "Lançamentos — Financeiro XPE"
};

export const dynamic = "force-dynamic";

export default async function LancamentosPage() {
  // 500 linhas cobrem com folga os últimos meses e permitem filtrar no cliente
  // sem ida ao servidor a cada tecla. Paginação real entra quando as outras
  // quatro contas começarem a alimentar o ledger.
  const [lancamentos, filtros] = await Promise.all([
    getLancamentos({ limite: 500, incluirTransferencias: true }),
    getFiltrosDisponiveis()
  ]);

  return (
    <AppShell>
      <div className="page-header">
        <h1>Lançamentos</h1>
        <p>
          O extrato consolidado. Transferências entre contas próprias ficam ocultas por padrão — são R$ 3,8 milhões
          que não são receita nem despesa.
        </p>
      </div>
      <FinShell>
        <FinLedgerTable lancamentos={lancamentos} contas={filtros.contas} nucleos={filtros.nucleos} />
      </FinShell>
    </AppShell>
  );
}

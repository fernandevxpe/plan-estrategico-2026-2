import { AppShell } from "@/components/layout/AppShell";
import { FinEstornosReembolso } from "@/components/financeiro/FinEstornosReembolso";
import { FinShell } from "@/components/financeiro/FinShell";
import { FinReimbursements } from "@/components/financeiro/FinReimbursements";
import { getPainelReembolsos } from "@/lib/financeiro/reembolsos";

export const metadata = {
  title: "Reembolsos — Financeiro XPE"
};

export const dynamic = "force-dynamic";

export default async function ReembolsosPage({
  searchParams
}: {
  searchParams: Promise<{ pessoa?: string }>;
}) {
  const dados = await getPainelReembolsos();
  const sp = await searchParams;
  const pessoaInicial = sp.pessoa && /^\d+$/.test(sp.pessoa) ? Number(sp.pessoa) : null;

  return (
    <AppShell>
      <div className="page-header">
        <h1>Reembolsos</h1>
        <p>
          Pessoa × mês, como na planilha — mais o que a planilha não tinha: os parcelamentos em curso com saldo e
          parcelas restantes, e a previsão do mês seguinte, que é a linha de reembolso que entra em contas a pagar
          antes de virar PIX.
        </p>
      </div>
      <FinShell>
        <FinEstornosReembolso />
        <FinReimbursements dados={dados} pessoaInicial={pessoaInicial} />
      </FinShell>
    </AppShell>
  );
}

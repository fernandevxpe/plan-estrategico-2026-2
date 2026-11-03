import { AppShell } from "@/components/layout/AppShell";
import { FinEstornosReembolso } from "@/components/financeiro/FinEstornosReembolso";
import { FinShell } from "@/components/financeiro/FinShell";
import { FinReembolsosGestao } from "@/components/financeiro/FinReembolsosGestao";
import { FinReimbursements } from "@/components/financeiro/FinReimbursements";
import { getContasAPagar } from "@/lib/financeiro/contas-a-pagar";
import { linhasPagarPorPessoa } from "@/lib/financeiro/pagar-por-pessoa";
import { getGestaoReembolsos, getPainelReembolsos } from "@/lib/financeiro/reembolsos";

export const metadata = {
  title: "Reembolsos — Financeiro XPE"
};

export const dynamic = "force-dynamic";

export default async function ReembolsosPage({
  searchParams
}: {
  searchParams: Promise<{ pessoa?: string; mes?: string }>;
}) {
  const [dados, gestao, contas] = await Promise.all([getPainelReembolsos(), getGestaoReembolsos(), getContasAPagar()]);
  // A linha de reembolso de Contas a pagar é a que vira ordem — ver FinPagarPorPessoa.
  const linhasPagar = linhasPagarPorPessoa(contas, "reembolso");
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
        <FinReembolsosGestao
          dados={gestao}
          mesInicial={sp.mes ?? null}
          pagar={{ linhas: linhasPagar, mesPagamento: `${contas.competencia.slice(0, 7)}-01`, hoje: contas.hoje }}
        />
        <FinEstornosReembolso />
        <FinReimbursements dados={dados} pessoaInicial={pessoaInicial} />
      </FinShell>
    </AppShell>
  );
}

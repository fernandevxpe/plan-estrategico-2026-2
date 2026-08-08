import { AppShell } from "@/components/layout/AppShell";
import { FinShell } from "@/components/financeiro/FinShell";
import { FinRevenueDetail } from "@/components/financeiro/FinRevenueDetail";
import { getReceitasDetalhe } from "@/lib/financeiro/receitas";

export const metadata = {
  title: "Receitas — Financeiro XPE"
};

export const dynamic = "force-dynamic";

export default async function ReceitasPage() {
  const dados = await getReceitasDetalhe();

  return (
    <AppShell>
      <div className="page-header">
        <h1>Receitas</h1>
        <p>
          De onde vem o dinheiro: categoria mês a mês, concentração de clientes e a lista de cobranças em atraso — que
          é uma lista de trabalho de cobrança, não um relatório.
        </p>
      </div>
      <FinShell>
        <FinRevenueDetail dados={dados} />
      </FinShell>
    </AppShell>
  );
}

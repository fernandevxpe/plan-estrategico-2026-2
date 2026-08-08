import { AppShell } from "@/components/layout/AppShell";
import { FinShell } from "@/components/financeiro/FinShell";
import { FinPlanning } from "@/components/financeiro/FinPlanning";
import { getPlanejamento } from "@/lib/financeiro/planejamento";

export const metadata = {
  title: "Planejamento — Financeiro XPE"
};

export const dynamic = "force-dynamic";

export default async function PlanejamentoFinanceiroPage() {
  const dados = await getPlanejamento();

  return (
    <AppShell>
      <div className="page-header">
        <h1>Planejamento global</h1>
        <p>
          A meta comercial vem do pipe e não se digita aqui. O que esta tela faz é derivar o que ela implica — imposto,
          custo, margem, tamanho de equipe — por relações que você pode ajustar, ou sobrescrever mês a mês.
        </p>
      </div>
      <FinShell>
        <FinPlanning dados={dados} />
      </FinShell>
    </AppShell>
  );
}

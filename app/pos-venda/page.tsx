import { AppShell } from "@/components/layout/AppShell";
import { ThemedDashboardPage } from "@/components/pages/ThemedDashboardPage";
import { loadDashboardData } from "@/lib/data/load-dashboard";

export default async function PosVendaPage() {
  const { analysis, generatedAt } = await loadDashboardData();

  return (
    <AppShell>
      <ThemedDashboardPage
        analysis={analysis}
        generatedAt={generatedAt}
        view="pos-venda"
        title="Pós-venda e recorrência"
        description="Contas recorrentes, confiança por CNPJ e principais fechamentos."
      />
    </AppShell>
  );
}

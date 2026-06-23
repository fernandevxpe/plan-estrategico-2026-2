import { AppShell } from "@/components/layout/AppShell";
import { ThemedDashboardPage } from "@/components/pages/ThemedDashboardPage";
import { loadDashboardData } from "@/lib/data/load-dashboard";

export default async function MixPage() {
  const { analysis, generatedAt } = await loadDashboardData();

  return (
    <AppShell>
      <ThemedDashboardPage
        analysis={analysis}
        generatedAt={generatedAt}
        view="mix"
        title="Mix de vendas"
        description="Participação por tipo de serviço, filtros visuais e evolução mensal."
      />
    </AppShell>
  );
}

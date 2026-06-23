import { AppShell } from "@/components/layout/AppShell";
import { ThemedDashboardPage } from "@/components/pages/ThemedDashboardPage";
import { loadDashboardData } from "@/lib/data/load-dashboard";

export default async function ComercialPage() {
  const { analysis, generatedAt } = await loadDashboardData();

  return (
    <AppShell>
      <ThemedDashboardPage
        analysis={analysis}
        generatedAt={generatedAt}
        view="comercial"
        title="Comercial"
        description="Funil, conversão madura, pipeline e motor que sustenta a projeção realista."
      />
    </AppShell>
  );
}

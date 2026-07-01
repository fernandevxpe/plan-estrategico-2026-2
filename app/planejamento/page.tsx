import { AppShell } from "@/components/layout/AppShell";
import { PlanningPage } from "@/components/pages/PlanningPage";
import { loadDashboardData } from "@/lib/data/load-dashboard";

export default async function PlanejamentoPage() {
  const { analysis } = await loadDashboardData();

  return (
    <AppShell>
      <PlanningPage analysis={analysis} />
    </AppShell>
  );
}

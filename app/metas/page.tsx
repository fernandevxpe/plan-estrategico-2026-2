import { AppShell } from "@/components/layout/AppShell";
import { MetasPage } from "@/components/pages/MetasPage";
import { loadDashboardData } from "@/lib/data/load-dashboard";

export default async function MetasRoutePage() {
  const { analysis } = await loadDashboardData();

  return (
    <AppShell>
      <MetasPage guides={analysis.growthGuides} />
    </AppShell>
  );
}

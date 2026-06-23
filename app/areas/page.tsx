import { AppShell } from "@/components/layout/AppShell";
import { AreasIndexPage } from "@/components/areas/AreasIndexPage";
import { loadDashboardData } from "@/lib/data/load-dashboard";

export default async function AreasPage() {
  const { areasDashboard } = await loadDashboardData();

  return (
    <AppShell>
      <AreasIndexPage dashboard={areasDashboard} />
    </AppShell>
  );
}

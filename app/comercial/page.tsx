import { AppShell } from "@/components/layout/AppShell";
import { ComercialDashboard } from "@/components/pages/ComercialDashboard";
import { loadDashboardData } from "@/lib/data/load-dashboard";

export default async function ComercialPage() {
  const { analysis } = await loadDashboardData();

  return (
    <AppShell>
      <ComercialDashboard analysis={analysis} />
    </AppShell>
  );
}

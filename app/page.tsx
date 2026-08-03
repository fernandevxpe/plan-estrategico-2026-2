import { AppShell } from "@/components/layout/AppShell";
import { loadDashboardData } from "@/lib/data/load-dashboard";
import { HomePage } from "@/components/pages/HomePage";
import { buildCommercialIntelDashboard } from "@/lib/areas/build-commercial-intel";

export default async function Page() {
  const [{ analysis, generatedAt }, intel] = await Promise.all([
    loadDashboardData(),
    buildCommercialIntelDashboard()
  ]);
  const criticalFindings = intel.executive.filter((item) => item.priority === "critica").slice(0, 5);

  return (
    <AppShell>
      <HomePage analysis={analysis} generatedAt={generatedAt} criticalFindings={criticalFindings} />
    </AppShell>
  );
}

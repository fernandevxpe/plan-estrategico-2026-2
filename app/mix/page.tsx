import { AppShell } from "@/components/layout/AppShell";
import { MixPage } from "@/components/pages/MixPage";
import { loadDashboardData } from "@/lib/data/load-dashboard";

export default async function MixRoutePage() {
  const { analysis, generatedAt } = await loadDashboardData();

  return (
    <AppShell>
      <MixPage analysis={analysis} generatedAt={generatedAt} />
    </AppShell>
  );
}

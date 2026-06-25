import { AppShell } from "@/components/layout/AppShell";
import { PlanoProPage } from "@/components/pages/PlanoProPage";
import { loadDashboardData } from "@/lib/data/load-dashboard";

export default async function PlanoProRoute() {
  const { analysis, generatedAt } = await loadDashboardData();

  return (
    <AppShell>
      <PlanoProPage analysis={analysis} generatedAt={generatedAt} />
    </AppShell>
  );
}

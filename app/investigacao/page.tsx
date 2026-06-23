import { AppShell } from "@/components/layout/AppShell";
import { InvestigacaoPage } from "@/components/pages/InvestigacaoPage";
import { loadDashboardData } from "@/lib/data/load-dashboard";

export default async function InvestigacaoRoutePage() {
  const { analysis } = await loadDashboardData();

  return (
    <AppShell>
      <InvestigacaoPage analysis={analysis} />
    </AppShell>
  );
}

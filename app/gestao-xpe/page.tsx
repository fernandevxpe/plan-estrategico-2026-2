import { AppShell } from "@/components/layout/AppShell";
import { GestaoXpeShell } from "@/components/gestao-xpe/GestaoXpeShell";
import { loadGestaoDashboard } from "@/lib/gestao-xpe/load-gestao";
import { loadGestaoCatalog } from "@/lib/gestao-xpe/weekly-records-store";

export default async function GestaoXpeRoutePage() {
  const [dashboard, catalog] = await Promise.all([loadGestaoDashboard(), loadGestaoCatalog()]);
  return (
    <AppShell>
      <GestaoXpeShell catalog={catalog} dashboard={dashboard} />
    </AppShell>
  );
}

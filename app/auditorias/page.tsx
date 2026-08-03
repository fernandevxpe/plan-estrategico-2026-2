import { AppShell } from "@/components/layout/AppShell";
import { AuditsPage } from "@/components/audits/AuditsPage";
import { buildAuditIndex } from "@/lib/audits/build-audits";

export const metadata = {
  title: "Auditorias — XPE",
  description: "Registro histórico das auditorias da plataforma e dos indicadores."
};

export default async function AuditoriasRoute() {
  const index = await buildAuditIndex();

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1>Auditorias</h1>
          <p>
            Cada rodada de análise fica registrada com a data em que foi gerada. Serve para
            comparar o que mudou entre uma revisão e a próxima.
          </p>
        </div>
      </div>
      <AuditsPage index={index} />
    </AppShell>
  );
}

import { readFile } from "node:fs/promises";
import path from "node:path";
import { DashboardApp } from "@/components/DashboardApp";
import type { Analysis } from "@/lib/analysis/types";
import { buildAreasDashboard } from "@/lib/areas/build-areas-dashboard";

async function getAnalysis(): Promise<Analysis> {
  const file = path.join(process.cwd(), "data/processed/analysis.json");
  return JSON.parse(await readFile(file, "utf8"));
}

export default async function Page() {
  const analysis = await getAnalysis();
  const areasDashboard = buildAreasDashboard(analysis);
  const generatedAt = new Date(analysis.generatedAt).toLocaleString("pt-BR");

  return (
    <main className="page">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <div className="brand-mark">XPE</div>
            <div>
              <p className="brand-title">Planejamento 2026.2</p>
              <p className="brand-subtitle">Pipedrive + ClickUp</p>
            </div>
          </div>
          <nav className="nav" aria-label="Secoes do dashboard">
            <a href="#planejamento">Resumo</a>
            <a href="#comercial">Comercial</a>
            <a href="#mix">Mix</a>
            <a href="#pos-venda">Pós-venda</a>
            <a href="#metas">Metas</a>
            <a href="#areas">Áreas</a>
            <a href="#apendice">Apêndice</a>
          </nav>
        </div>
      </header>

      <div className="shell">
        <DashboardApp analysis={analysis} areasDashboard={areasDashboard} generatedAt={generatedAt} />
      </div>
    </main>
  );
}

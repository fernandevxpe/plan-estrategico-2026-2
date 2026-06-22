import { readFile } from "node:fs/promises";
import path from "node:path";
import { DashboardApp } from "@/components/DashboardApp";
import type { Analysis } from "@/lib/analysis/types";

async function getAnalysis(): Promise<Analysis> {
  const file = path.join(process.cwd(), "data/processed/analysis.json");
  return JSON.parse(await readFile(file, "utf8"));
}

export default async function Page() {
  const analysis = await getAnalysis();
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
            <a href="#planejamento">Planejamento</a>
            <a href="#guias">Projeções 2x/3x</a>
            <a href="#alertas">Alertas</a>
            <a href="#investigacao">Investigação</a>
            <a href="#recordes">Recordes</a>
            <a href="#funil">Funil</a>
            <a href="#projecoes">Projeções</a>
            <a href="#tipos">Tipos</a>
            <a href="#fechamentos">Fechamentos</a>
            <a href="#qualidade">Base</a>
          </nav>
        </div>
      </header>

      <div className="shell">
        <DashboardApp analysis={analysis} generatedAt={generatedAt} />
      </div>
    </main>
  );
}

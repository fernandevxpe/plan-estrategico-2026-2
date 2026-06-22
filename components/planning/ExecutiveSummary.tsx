"use client";

import { CalendarClock, LineChart, Target, TrendingUp, Wallet } from "lucide-react";
import type { ExecutiveKpis } from "@/lib/analysis/types";
import { brl, formatGrowth } from "@/lib/analysis/format";

type Props = {
  kpis: ExecutiveKpis;
};

export function ExecutiveSummary({ kpis }: Props) {
  return (
    <section className="kpi-grid kpi-grid-executive">
      <KpiCard
        title="Faturamento 2025"
        value={brl.format(kpis.revenue2025)}
        note={`${kpis.wonDeals2025} fechamentos`}
        icon={<Wallet size={18} />}
      />
      <KpiCard
        title="2026 até agora"
        value={brl.format(kpis.revenue2026Ytd)}
        note={`YTD · ${kpis.wonDeals2026Ytd} fechamentos · jun parcial`}
        icon={<TrendingUp size={18} />}
      />
      <KpiCard
        title="2026.1 projetado"
        value={brl.format(kpis.projected2026H1)}
        note="Jan–mai real + jun estimado"
        icon={<Target size={18} />}
      />
      <KpiCard
        title="2026.2 projetado"
        value={brl.format(kpis.projected2026H2)}
        note={`Cenário: ${kpis.scenarioName}`}
        icon={<CalendarClock size={18} />}
      />
      <KpiCard
        title="2026 total projetado"
        value={brl.format(kpis.projected2026Total)}
        note={`${formatGrowth(kpis.growthVs2025Pct)} vs 2025`}
        icon={<LineChart size={18} />}
        highlight
      />
    </section>
  );
}

function KpiCard({
  title,
  value,
  note,
  icon,
  highlight
}: {
  title: string;
  value: string;
  note: string;
  icon: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <article className={`card kpi-card ${highlight ? "kpi-highlight" : ""}`}>
      <div className="card-title">
        <span>{title}</span>
        {icon}
      </div>
      <p className="metric">{value}</p>
      <p className="metric-note">{note}</p>
    </article>
  );
}

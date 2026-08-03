import type {
  IntelExecutiveFinding,
  IntelMonth,
  IntelScope
} from "@/lib/areas/build-commercial-intel";

const money = (n: number) => `R$ ${Math.round(n).toLocaleString("pt-BR")}`;

const PRIORITY_ORDER: Record<IntelExecutiveFinding["priority"], number> = {
  critica: 0,
  alta: 1,
  media: 2,
  ok: 3
};

const MAX_FINDINGS = 7;

function monthLabel(month: string) {
  return new Date(`${month}-15T12:00:00-03:00`)
    .toLocaleDateString("pt-BR", { month: "short", year: "2-digit" })
    .replace(".", "")
    .replace(" de ", "/");
}

function sortFindings(findings: IntelExecutiveFinding[]) {
  return [...findings].sort(
    (a, b) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9)
  );
}

function takeTop(findings: IntelExecutiveFinding[], limit = MAX_FINDINGS) {
  return sortFindings(findings).slice(0, limit);
}

function deltaPct(current: number, previous: number) {
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
}

function formatDelta(pct: number | null, unit = "%") {
  if (pct == null || !Number.isFinite(pct)) return "—";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(0)}${unit}`;
}

function closedMonthsUpTo(scope: IntelScope, monthKey: string) {
  return scope.months.filter((row) => row.month <= monthKey && !row.isPartial);
}

/** Quantos meses seguidos abaixo da meta, terminando no mês selecionado. */
function goalMissStreakEndingAt(scope: IntelScope, monthKey: string) {
  const closed = closedMonthsUpTo(scope, monthKey);
  let streak = 0;
  for (const row of [...closed].reverse()) {
    if (row.goal?.attainmentPct != null && row.goal.attainmentPct < 100) streak += 1;
    else break;
  }
  return streak;
}

function channelEfficiencyFromMonth(month: IntelMonth) {
  const wonByChannel = Object.fromEntries(month.won.byChannel.map((row) => [row.key, row]));
  const lostByChannel = Object.fromEntries(month.lost.byChannel.map((row) => [row.key, row]));
  return [...new Set([...Object.keys(wonByChannel), ...Object.keys(lostByChannel)])]
    .map((channel) => {
      const won = wonByChannel[channel]?.deals ?? 0;
      const lost = lostByChannel[channel]?.deals ?? 0;
      return {
        channel,
        won,
        lost,
        total: won + lost,
        winRatePct: won + lost ? (won / (won + lost)) * 100 : null,
        revenue: wonByChannel[channel]?.value ?? 0
      };
    })
    .filter((row) => row.total >= 2)
    .sort((a, b) => (b.winRatePct ?? 0) - (a.winRatePct ?? 0));
}

/** Achados do escopo no ano (canais, perdas, funil aberto). */
export function buildScopeYearFindings(scope: IntelScope): IntelExecutiveFinding[] {
  const findings: IntelExecutiveFinding[] = [];
  const open = scope.openPipeline;
  const year = scope.year;

  const missStreak = goalMissStreakEndingAt(scope, scope.months.filter((m) => !m.isPartial).at(-1)?.month ?? "");
  if (missStreak >= 2) {
    const last = closedMonthsUpTo(scope, scope.months.at(-1)?.month ?? "").at(-1);
    findings.push({
      id: `${scope.id}-abaixo-meta-streak`,
      priority: missStreak >= 4 ? "critica" : "alta",
      title: `${scope.label} abaixo da meta há ${missStreak} meses seguidos`,
      detail: `Último fechamento em ${last?.goal?.attainmentPct?.toFixed(0) ?? "—"}% (${money(last?.goal?.progress ?? 0)} de ${money(last?.goal?.target ?? 0)}).`,
      metric: missStreak,
      unit: "count"
    });
  }

  const worstStage = [...open.byStage].sort((a, b) => b.value - a.value)[0];
  if (worstStage && worstStage.valuePct > 45) {
    findings.push({
      id: `${scope.id}-funil-travado`,
      priority: worstStage.valuePct > 60 ? "critica" : "alta",
      title: `${worstStage.valuePct.toFixed(0)}% do aberto em "${worstStage.key}"`,
      detail: `${worstStage.deals} negócios e ${money(worstStage.value)} concentrados nessa etapa. Ciclo mediano ${year.cycle.medianDays?.toFixed(0) ?? "—"} dias.`,
      metric: worstStage.value,
      unit: "currency"
    });
  }

  const zeroPct = (open.zeroValueDeals / Math.max(open.deals, 1)) * 100;
  if (zeroPct > 10) {
    findings.push({
      id: `${scope.id}-forecast-cego`,
      priority: zeroPct > 20 ? "alta" : "media",
      title: `${zeroPct.toFixed(0)}% do funil aberto sem valor`,
      detail: `${open.zeroValueDeals} de ${open.deals} negócios com R$ 0. Potencial declarado: ${money(open.value)}.`,
      metric: open.zeroValueDeals,
      unit: "count"
    });
  }

  const wonByChannel = Object.fromEntries(year.won.byChannel.map((row) => [row.key, row]));
  const lostByChannel = Object.fromEntries(year.lost.byChannel.map((row) => [row.key, row]));
  const channelEfficiency = [...new Set([...Object.keys(wonByChannel), ...Object.keys(lostByChannel)])]
    .map((channel) => {
      const won = wonByChannel[channel]?.deals ?? 0;
      const lost = lostByChannel[channel]?.deals ?? 0;
      return {
        channel,
        won,
        lost,
        total: won + lost,
        winRatePct: won + lost ? (won / (won + lost)) * 100 : null,
        revenue: wonByChannel[channel]?.value ?? 0
      };
    })
    .filter((row) => row.total >= 5)
    .sort((a, b) => (b.winRatePct ?? 0) - (a.winRatePct ?? 0));

  if (channelEfficiency.length >= 2) {
    const best = channelEfficiency[0]!;
    const worst = channelEfficiency.at(-1)!;
    if (best.winRatePct != null && worst.winRatePct != null && best.winRatePct - worst.winRatePct >= 15) {
      findings.push({
        id: `${scope.id}-eficiencia-canal`,
        priority: "alta",
        title: `${best.channel} converte ${best.winRatePct.toFixed(0)}% · ${worst.channel} ${worst.winRatePct.toFixed(0)}%`,
        detail: `Diferença de eficiência entre canais com volume. Melhor: ${best.total} negócios e ${money(best.revenue)}. Pior: ${worst.total} negócios.`,
        metric: best.winRatePct - worst.winRatePct,
        unit: "percent",
        channelEfficiency
      });
    }
  }

  const priorityDrop = year.lost.byReason.find((row) => /prioridade/i.test(row.key));
  const exhausted = year.lost.byReason.find((row) => /tentativas/i.test(row.key));
  if (priorityDrop || exhausted) {
    const combined = (priorityDrop?.deals ?? 0) + (exhausted?.deals ?? 0);
    const share = (combined / Math.max(year.lost.deals, 1)) * 100;
    if (share >= 25) {
      findings.push({
        id: `${scope.id}-follow-up`,
        priority: share >= 40 ? "critica" : "alta",
        title: `${share.toFixed(0)}% das perdas ligadas a follow-up`,
        detail: `${[priorityDrop, exhausted]
          .filter(Boolean)
          .map((row) => `"${row!.key}" (${row!.deals})`)
          .join(" + ")}. Win rate do ano: ${year.winRatePct?.toFixed(0) ?? "—"}%.`,
        metric: combined,
        unit: "count"
      });
    }
  }

  if (year.winRatePct != null) {
    findings.push({
      id: `${scope.id}-win-rate-ano`,
      priority: year.winRatePct < 25 ? "alta" : year.winRatePct < 40 ? "media" : "ok",
      title: `Win rate ${scope.label}: ${year.winRatePct.toFixed(0)}%`,
      detail: `${year.won.deals} ganhos · ${year.lost.deals} perdidos · receita ${money(year.won.value)}.`,
      metric: year.winRatePct,
      unit: "percent"
    });
  }

  return takeTop(findings, 8);
}

/**
 * Diagnóstico do mês: o que aconteceu neste período, o que melhorou/piorou
 * vs o mês anterior, e só os achados mais relevantes.
 */
export function buildMonthFindings(
  scope: IntelScope,
  month: IntelMonth,
  previous: IntelMonth | null
): IntelExecutiveFinding[] {
  const findings: IntelExecutiveFinding[] = [];
  const label = monthLabel(month.month);
  const prevLabel = previous ? monthLabel(previous.month) : null;

  if (month.isPartial && month.won.deals === 0 && month.lost.deals === 0 && month.created.deals === 0) {
    return [
      {
        id: `vazio-${month.month}`,
        priority: "media",
        title: `${label}: mês ainda sem fechamentos`,
        detail: "Período parcial — ainda não há ganhos, perdas ou criações suficientes para diagnóstico.",
        metric: 0,
        unit: "count"
      }
    ];
  }

  // 1) Meta do mês
  if (month.goal) {
    const att = month.goal.attainmentPct;
    const prevAtt = previous?.goal?.attainmentPct ?? null;
    const attDelta = att != null && prevAtt != null ? att - prevAtt : null;
    const streak = goalMissStreakEndingAt(scope, month.month);
    let detail =
      `Realizado ${money(month.goal.progress)} de ${money(month.goal.target)}. ` +
      `${month.won.deals} ganhos · ticket médio ${money(month.won.averageTicket)}.`;
    if (attDelta != null) {
      detail +=
        attDelta >= 0
          ? ` Atingimento ${attDelta.toFixed(0)} pp acima de ${prevLabel}.`
          : ` Atingimento ${Math.abs(attDelta).toFixed(0)} pp abaixo de ${prevLabel}.`;
    }
    if (att != null && att < 100 && streak >= 2) {
      detail += ` Sequência abaixo da meta: ${streak} meses até aqui.`;
    }
    findings.push({
      id: `meta-${month.month}`,
      priority:
        att == null
          ? "media"
          : att >= 100
            ? "ok"
            : streak >= 3 || att < 80
              ? "critica"
              : "alta",
      title:
        att != null && att >= 100
          ? `${label}: meta batida (${att.toFixed(0)}%)`
          : `${label}: ${att?.toFixed(0) ?? "—"}% da meta`,
      detail,
      metric: att ?? 0,
      unit: "percent"
    });
  }

  // 2) Compilado o que melhorou / piorou vs mês anterior
  if (previous) {
    const moves: Array<{
      key: string;
      better: boolean;
      magnitude: number;
      text: string;
    }> = [];

    const revDelta = deltaPct(month.won.value, previous.won.value);
    if (revDelta != null && Math.abs(revDelta) >= 10) {
      moves.push({
        key: "receita",
        better: revDelta > 0,
        magnitude: Math.abs(revDelta),
        text: `receita ${formatDelta(revDelta)} (${money(month.won.value)} vs ${money(previous.won.value)})`
      });
    }

    if (month.winRatePct != null && previous.winRatePct != null) {
      const wrDelta = month.winRatePct - previous.winRatePct;
      if (Math.abs(wrDelta) >= 5) {
        moves.push({
          key: "winrate",
          better: wrDelta > 0,
          magnitude: Math.abs(wrDelta),
          text: `win rate ${wrDelta > 0 ? "+" : ""}${wrDelta.toFixed(0)} pp (${month.winRatePct.toFixed(0)}% vs ${previous.winRatePct.toFixed(0)}%)`
        });
      }
    }

    const lostDelta = deltaPct(month.lost.deals, previous.lost.deals);
    if (lostDelta != null && Math.abs(lostDelta) >= 20) {
      moves.push({
        key: "perdas",
        better: lostDelta < 0,
        magnitude: Math.abs(lostDelta),
        text: `perdas ${formatDelta(lostDelta)} (${month.lost.deals} vs ${previous.lost.deals})`
      });
    }

    if (month.cycle.medianDays != null && previous.cycle.medianDays != null) {
      const cycleDelta = month.cycle.medianDays - previous.cycle.medianDays;
      if (Math.abs(cycleDelta) >= 7) {
        moves.push({
          key: "ciclo",
          better: cycleDelta < 0,
          magnitude: Math.abs(cycleDelta),
          text: `ciclo ${cycleDelta > 0 ? "+" : ""}${cycleDelta.toFixed(0)} dias (${month.cycle.medianDays.toFixed(0)} vs ${previous.cycle.medianDays.toFixed(0)})`
        });
      }
    }

    const createdDelta = deltaPct(month.created.value, previous.created.value);
    if (createdDelta != null && Math.abs(createdDelta) >= 20) {
      moves.push({
        key: "criados",
        better: createdDelta > 0,
        magnitude: Math.abs(createdDelta),
        text: `potencial criado ${formatDelta(createdDelta)} (${money(month.created.value)} vs ${money(previous.created.value)})`
      });
    }

    const meetNow = month.activities.meetingsPerWeek;
    const meetPrev = previous.activities.meetingsPerWeek;
    const meetDelta = deltaPct(meetNow, meetPrev);
    if (meetDelta != null && Math.abs(meetDelta) >= 20 && meetPrev > 0) {
      moves.push({
        key: "reunioes",
        better: meetDelta > 0,
        magnitude: Math.abs(meetDelta),
        text: `reuniões/sem ${formatDelta(meetDelta)} (${meetNow.toFixed(1)} vs ${meetPrev.toFixed(1)})`
      });
    }

    const worsened = moves.filter((m) => !m.better).sort((a, b) => b.magnitude - a.magnitude);
    const improved = moves.filter((m) => m.better).sort((a, b) => b.magnitude - a.magnitude);

    if (worsened.length) {
      findings.push({
        id: `piorou-${month.month}`,
        priority: worsened[0]!.magnitude >= 30 ? "critica" : "alta",
        title: `${label}: piorou vs ${prevLabel}`,
        detail: worsened.map((m) => m.text).join(" · ") + ".",
        metric: worsened[0]!.magnitude,
        unit: "percent"
      });
    }

    if (improved.length) {
      findings.push({
        id: `melhorou-${month.month}`,
        priority: "ok",
        title: `${label}: melhorou vs ${prevLabel}`,
        detail: improved.map((m) => m.text).join(" · ") + ".",
        metric: improved[0]!.magnitude,
        unit: "percent"
      });
    }
  }

  // 3) Win rate absoluto do mês
  if (month.winRatePct != null) {
    findings.push({
      id: `winrate-${month.month}`,
      priority: month.winRatePct < 25 ? "critica" : month.winRatePct < 35 ? "alta" : month.winRatePct < 45 ? "media" : "ok",
      title: `Win rate ${label}: ${month.winRatePct.toFixed(0)}%`,
      detail: `${month.won.deals} ganhos · ${month.lost.deals} perdidos · receita ${money(month.won.value)}.`,
      metric: month.winRatePct,
      unit: "percent"
    });
  }

  // 4) Motivo de perda dominante
  const topLost = month.lost.byReason[0];
  if (topLost && month.lost.deals >= 3) {
    const prevSame = previous?.lost.byReason.find((row) => row.key === topLost.key);
    let detail = `${topLost.deals} negócios (${topLost.dealsPct.toFixed(0)}%) · ${money(topLost.value)}.`;
    if (prevSame) {
      const d = topLost.deals - prevSame.deals;
      detail += ` Vs ${prevLabel}: ${d >= 0 ? "+" : ""}${d} nesse motivo.`;
    }
    findings.push({
      id: `perda-${month.month}`,
      priority: topLost.dealsPct >= 40 || month.lost.deals >= 30 ? "critica" : topLost.dealsPct >= 30 ? "alta" : "media",
      title: `Perda dominante: ${topLost.key}`,
      detail,
      metric: topLost.deals,
      unit: "count"
    });
  }

  // 5) Canal do mês
  const topWonChannel = month.won.byChannel[0];
  if (topWonChannel && month.won.deals > 0) {
    findings.push({
      id: `canal-${month.month}`,
      priority: "media",
      title: `Canal líder: ${topWonChannel.key}`,
      detail: `${topWonChannel.dealsPct.toFixed(0)}% dos ganhos · ${money(topWonChannel.value)}. Relacionamento: ${month.won.relationshipShare.valuePct.toFixed(0)}% da receita.`,
      metric: topWonChannel.valuePct,
      unit: "percent"
    });
  }

  const efficiency = channelEfficiencyFromMonth(month);
  if (efficiency.length >= 2) {
    const best = efficiency[0]!;
    const worst = efficiency.at(-1)!;
    if (
      best.winRatePct != null &&
      worst.winRatePct != null &&
      best.total >= 3 &&
      worst.total >= 3 &&
      best.winRatePct - worst.winRatePct >= 20
    ) {
      findings.push({
        id: `eficiencia-${month.month}`,
        priority: "alta",
        title: `${label}: ${best.channel} ${best.winRatePct.toFixed(0)}% vs ${worst.channel} ${worst.winRatePct.toFixed(0)}%`,
        detail: `Eficiência de conversão no mês. ${best.channel}: ${best.won} ganhos / ${best.lost} perdas. ${worst.channel}: ${worst.won} / ${worst.lost}.`,
        metric: best.winRatePct - worst.winRatePct,
        unit: "percent",
        channelEfficiency: efficiency
      });
    }
  }

  // 6) Reuniões
  if (month.meetingGoal?.weeklyTarget != null) {
    const actual = month.meetingGoal.weeklyActual ?? month.activities.meetingsPerWeek;
    const gap = month.meetingGoal.gapPerWeek;
    findings.push({
      id: `reunioes-${month.month}`,
      priority: gap > 2 ? "alta" : gap > 0.5 ? "media" : "ok",
      title:
        gap > 0
          ? `Reuniões ${gap.toFixed(1)}/sem abaixo da meta`
          : `Reuniões no ritmo (${actual.toFixed(1)}/sem)`,
      detail: `Real ${actual.toFixed(1)} · meta ${month.meetingGoal.weeklyTarget.toFixed(0)}/semana · ${month.activities.meetings} no mês.`,
      metric: actual,
      unit: "count"
    });
  }

  // 7) Potencial criado
  if (month.createdGoal && month.created.deals > 0) {
    const att = month.createdGoal.attainmentPct;
    findings.push({
      id: `criados-${month.month}`,
      priority: att != null && att < 70 ? "alta" : att != null && att < 100 ? "media" : "ok",
      title: `Potencial criado: ${att?.toFixed(0) ?? "—"}% da meta`,
      detail: `${month.created.deals} novos · ${money(month.created.value)} · meta ${money(month.createdGoal.target)}.`,
      metric: att ?? 0,
      unit: "percent"
    });
  }

  return takeTop(findings);
}

/** Diagnóstico por período: ano = acumulado; mês = leitura daquele mês. */
export function resolveExecutiveFindings(args: {
  monthKey: string;
  scope: IntelScope;
  yearExecutive: IntelExecutiveFinding[];
}): { label: string; findings: IntelExecutiveFinding[] } {
  const { monthKey, scope, yearExecutive } = args;

  if (monthKey === "ano") {
    // Só achados de empresa (ritmo anual / mídia). Streak e funil vêm do escopo.
    const company = yearExecutive.filter((item) => ["meta-ano", "midia-parada"].includes(item.id));
    const scopeFindings = buildScopeYearFindings(scope);
    const mergedIds = new Set(scopeFindings.map((f) => f.id));
    // Evita duplicar "consultoria-abaixo-meta" do JSON se já geramos streak do escopo.
    const companyFiltered = company.filter((item) => {
      if (item.id === "consultoria-abaixo-meta" && mergedIds.has(`${scope.id}-abaixo-meta-streak`)) {
        return false;
      }
      return true;
    });
    // Também remove o finding legado do JSON quando o escopo não é consultoria
    const companyForScope =
      scope.id === "consultoria"
        ? companyFiltered
        : companyFiltered.filter((item) => item.id !== "consultoria-abaixo-meta");

    return {
      label: `${scope.label} · ano inteiro`,
      findings: takeTop([...companyForScope, ...scopeFindings], 8)
    };
  }

  const month = scope.months.find((row) => row.month === monthKey) ?? null;
  if (!month) return { label: scope.label, findings: [] };

  const idx = scope.months.findIndex((row) => row.month === monthKey);
  const previous = idx > 0 ? (scope.months[idx - 1] ?? null) : null;

  return {
    label: `${scope.label} · ${monthLabel(month.month)}${month.isPartial ? " (parcial)" : ""}`,
    findings: buildMonthFindings(scope, month, previous)
  };
}

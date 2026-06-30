"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GestaoCatalog, WeeklyRecord } from "@/lib/gestao-xpe/catalog-types";
import { MAIN_PIPELINE_NAME } from "@/lib/gestao-xpe/pipeline-config";
import { applyCrmToWeekValues } from "@/lib/gestao-xpe/crm-week-sync";
import { GestaoIndicadorField } from "@/components/gestao-xpe/GestaoIndicadorField";
import { GestaoOrigemBadge } from "@/components/gestao-xpe/GestaoOrigemBadge";
import { Copy, RefreshCw, Save } from "lucide-react";

type Props = {
  catalog: GestaoCatalog;
  weekKey: string;
  onSaved: () => void;
};

export function GestaoLancamentosTab({ catalog, weekKey, onSaved }: Props) {
  const [record, setRecord] = useState<WeeklyRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const catalogRef = useRef(catalog);
  catalogRef.current = catalog;

  const escopo = catalog.escopos[0];
  const gruposLancaveis = escopo?.grupos.filter((g) => g.id !== "analise") ?? [];

  const persist = useCallback(
    async (next: WeeklyRecord, silent = false) => {
      setSaving(true);
      if (!silent) setMessage("");
      const res = await fetch(`/api/gestao-xpe/weeks/${encodeURIComponent(next.weekKey)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next)
      });
      const data = await res.json();
      setRecord(data.record);
      setSaving(false);
      if (!silent) setMessage("Salvo com sucesso.");
      onSaved();
    },
    [onSaved]
  );

  const applyCrm = useCallback(
    async (base: WeeklyRecord, overwrite: boolean, silent = false) => {
      setSyncing(true);
      try {
        const crmRes = await fetch(`/api/gestao-xpe/crm/${encodeURIComponent(base.weekKey)}`);
        if (!crmRes.ok) {
          if (!silent) setMessage("CRM indisponível neste momento.");
          return base;
        }
        const crm = await crmRes.json();
        const merged: WeeklyRecord = {
          ...base,
          valores: applyCrmToWeekValues(base.valores, catalogRef.current, crm, overwrite)
        };
        if (JSON.stringify(merged.valores) !== JSON.stringify(base.valores)) {
          await persist(merged, silent);
          if (!silent) setMessage("Dados do CRM aplicados.");
          return merged;
        }
        if (!silent) setMessage("CRM já estava sincronizado.");
        return base;
      } finally {
        setSyncing(false);
      }
    },
    [persist]
  );

  const loadWeek = useCallback(
    async (key: string) => {
      const res = await fetch(`/api/gestao-xpe/weeks/${encodeURIComponent(key)}`);
      const data = (await res.json()) as WeeklyRecord;
      setRecord(data);
      await applyCrm(data, false, true);
    },
    [applyCrm]
  );

  useEffect(() => {
    loadWeek(weekKey);
  }, [weekKey, loadWeek]);

  function scheduleSave(next: WeeklyRecord) {
    setRecord(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => persist(next, true), 600);
  }

  function updateValor(indicatorId: string, field: "meta" | "realizado", value: string) {
    if (!record) return;
    const def = catalog.indicators[indicatorId];
    if (def?.origemDado === "analise") return;
    if (
      field === "realizado" &&
      (def?.origemDado === "crm" ||
        def?.origemDado === "crm_parcial" ||
        def?.origemDado === "crm_snapshot")
    ) {
      return;
    }
    const next: WeeklyRecord = {
      ...record,
      valores: {
        ...record.valores,
        [indicatorId]: {
          ...record.valores[indicatorId],
          [field]: value || null
        }
      }
    };
    scheduleSave(next);
  }

  async function applyReferencias() {
    if (!record) return;
    const next: WeeklyRecord = {
      ...record,
      valores: { ...record.valores }
    };
    for (const id of Object.keys(catalog.indicators)) {
      if (catalog.indicators[id].origemDado === "analise") continue;
      next.valores[id] = {
        ...next.valores[id],
        meta: catalog.indicators[id].metaReferencia
      };
    }
    await persist(next);
  }

  async function copyFromPreviousWeek() {
    const res = await fetch("/api/gestao-xpe/weeks");
    const data = (await res.json()) as { semanas: { weekKey: string }[] };
    const sorted = data.semanas.map((s) => s.weekKey).sort();
    const idx = sorted.indexOf(weekKey);
    if (idx <= 0) {
      setMessage("Não há semana anterior.");
      return;
    }
    const prevKey = sorted[idx - 1];
    const prevRes = await fetch(`/api/gestao-xpe/weeks/${encodeURIComponent(prevKey)}`);
    const prev = (await prevRes.json()) as WeeklyRecord;
    if (!record) return;
    const next: WeeklyRecord = {
      ...record,
      valores: { ...record.valores }
    };
    for (const id of Object.keys(catalog.indicators)) {
      if (catalog.indicators[id].origemDado === "analise") continue;
      const m = prev.valores[id]?.meta;
      if (m?.trim()) next.valores[id] = { ...next.valores[id], meta: m };
    }
    await persist(next);
  }

  async function closeWeek() {
    if (!record) return;
    await persist({ ...record, status: "fechado" });
  }

  const manualIds = useMemo(
    () =>
      Object.values(catalog.indicators)
        .filter((d) => d.origemDado !== "analise")
        .map((d) => d.id),
    [catalog.indicators]
  );

  const filled = record
    ? manualIds.filter((id) => record.valores[id]?.realizado?.trim()).length
    : 0;
  const total = manualIds.length;

  const analiseGrupo = escopo?.grupos.find((g) => g.id === "analise");

  return (
    <div className="gestao-lancar">
      <div className="gestao-lancar-intro card">
        <h2>Lançar semana — {record?.label ?? weekKey}</h2>
        <p>
          <strong>Meta</strong> = objetivo desta semana. <strong>Realizado</strong> = o que aconteceu.
          Troque a semana no menu acima. Fechamentos e parte do funil vêm do CRM (funil{" "}
          <strong>{MAIN_PIPELINE_NAME}</strong>) automaticamente.
        </p>
      </div>

      <div className="gestao-lancar-toolbar">
        <span className={`pill ${record?.status === "fechado" ? "green" : "amber"}`}>
          {record?.status === "fechado" ? "Fechada" : "Rascunho"}
        </span>
        <span className="gestao-muted">
          {filled}/{total} realizados (sem CRM auto)
        </span>
        <button
          type="button"
          className="gestao-btn secondary"
          disabled={syncing || !record}
          onClick={() => record && applyCrm(record, true)}
        >
          <RefreshCw size={14} /> {syncing ? "Sincronizando…" : "Atualizar do CRM"}
        </button>
        <button type="button" className="gestao-btn secondary" onClick={applyReferencias}>
          <Copy size={14} /> Metas da referência
        </button>
        <button type="button" className="gestao-btn secondary" onClick={copyFromPreviousWeek}>
          <Copy size={14} /> Metas semana anterior
        </button>
        <button type="button" className="gestao-btn" disabled={saving || !record} onClick={() => record && persist(record)}>
          <Save size={14} /> {saving ? "Salvando…" : "Salvar agora"}
        </button>
        {record?.status !== "fechado" ? (
          <button type="button" className="gestao-btn primary" onClick={closeWeek}>
            Fechar semana
          </button>
        ) : null}
        {message ? <span className="gestao-save-msg">{message}</span> : null}
      </div>

      {!record ? (
        <p className="gestao-muted">Carregando semana…</p>
      ) : (
        <div className="gestao-lancar-form">
          {gruposLancaveis.map((grupo) => (
            <section className="gestao-lancar-grupo card" key={grupo.id}>
              <h3>{grupo.titulo}</h3>
              {grupo.descricao ? <p className="gestao-muted">{grupo.descricao}</p> : null}
              {grupo.indicadorIds.map((indId) => {
                const def = catalog.indicators[indId];
                const val = record.valores[indId] ?? { meta: null, realizado: null };
                return (
                  <GestaoIndicadorField
                    key={indId}
                    label={def.nome}
                    tipo={def.tipo}
                    meta={val.meta ?? ""}
                    realizado={val.realizado ?? ""}
                    calculado={def.calculado}
                    unidade={def.unidade}
                    origemDado={def.origemDado}
                    nota={val.notas}
                    onMetaChange={(v) => updateValor(indId, "meta", v)}
                    onRealizadoChange={(v) => updateValor(indId, "realizado", v)}
                  />
                );
              })}
            </section>
          ))}

          {analiseGrupo ? (
            <section className="gestao-lancar-grupo card gestao-lancar-analise">
              <h3>Análise automática</h3>
              <p className="gestao-muted">Calculado do Pipedrive — atualiza ao sincronizar CRM.</p>
              {analiseGrupo.indicadorIds.map((indId) => {
                const def = catalog.indicators[indId];
                const val = record?.valores[indId]?.realizado;
                return (
                  <div className="gestao-analise-row" key={indId}>
                    <span>
                      {def.nome}
                      <GestaoOrigemBadge origem="analise" />
                    </span>
                    <strong>
                      {val?.trim() || "—"}
                      {val?.trim() ? ` ${def.unidade ?? ""}` : ""}
                    </strong>
                    <em>meta {record?.valores[indId]?.meta ?? def.metaReferencia ?? "—"}</em>
                    {def.formula ? (
                      <span className="gestao-muted gestao-analise-formula">{def.formula}</span>
                    ) : null}
                  </div>
                );
              })}
            </section>
          ) : null}

          <section className="gestao-lancar-grupo card">
            <h3>Notas da semana</h3>
            <textarea
              className="gestao-notes"
              rows={3}
              placeholder="Observações, decisões, bloqueios…"
              value={record.notasSemana ?? ""}
              onChange={(e) => scheduleSave({ ...record, notasSemana: e.target.value })}
            />
          </section>
        </div>
      )}
    </div>
  );
}

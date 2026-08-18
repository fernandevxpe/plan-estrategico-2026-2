"use client";

import { useMemo, useState } from "react";

import type { ContaExtrato } from "@/lib/financeiro/extratos";

type Preset = "mes_atual" | "30d" | "60d" | "mes" | "ano" | "custom";

const ROTULO_PRESET: Record<Preset, string> = {
  mes_atual: "Mês atual",
  "30d": "Últimos 30 dias",
  "60d": "Últimos 60 dias",
  mes: "Um mês específico",
  ano: "Um ano inteiro",
  custom: "Período personalizado"
};

function hojeIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function somarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

function primeiroDiaDoMes(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

function ultimoDiaDoMes(anoMes: string): string {
  const [ano, mes] = anoMes.split("-").map(Number);
  const d = new Date(Date.UTC(ano, mes, 0));
  return d.toISOString().slice(0, 10);
}

function diaBr(iso: string): string {
  return iso.split("-").reverse().join("/");
}

export function FinExtratos({ contas }: { contas: ContaExtrato[] }) {
  const hoje = useMemo(() => hojeIso(), []);
  const [preset, setPreset] = useState<Preset>("mes_atual");
  const [mesEscolhido, setMesEscolhido] = useState(hoje.slice(0, 7));
  const [anoEscolhido, setAnoEscolhido] = useState(String(Number(hoje.slice(0, 4))));
  const [deCustom, setDeCustom] = useState(primeiroDiaDoMes(hoje));
  const [ateCustom, setAteCustom] = useState(hoje);
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set(contas.map((c) => c.slug)));

  const { de, ate, erroPeriodo } = useMemo(() => {
    switch (preset) {
      case "mes_atual":
        return { de: primeiroDiaDoMes(hoje), ate: hoje, erroPeriodo: null };
      case "30d":
        return { de: somarDias(hoje, -30), ate: hoje, erroPeriodo: null };
      case "60d":
        return { de: somarDias(hoje, -60), ate: hoje, erroPeriodo: null };
      case "mes": {
        if (!/^\d{4}-\d{2}$/.test(mesEscolhido)) return { de: "", ate: "", erroPeriodo: "escolha um mês" };
        return { de: `${mesEscolhido}-01`, ate: ultimoDiaDoMes(mesEscolhido), erroPeriodo: null };
      }
      case "ano": {
        const ano = Number(anoEscolhido);
        if (!Number.isInteger(ano) || ano < 2015 || ano > 2100) {
          return { de: "", ate: "", erroPeriodo: "escolha um ano entre 2015 e 2100" };
        }
        return { de: `${ano}-01-01`, ate: `${ano}-12-31`, erroPeriodo: null };
      }
      case "custom":
        if (!deCustom || !ateCustom) return { de: "", ate: "", erroPeriodo: "preencha as duas datas" };
        if (deCustom > ateCustom) return { de: "", ate: "", erroPeriodo: "\"de\" não pode ser depois de \"até\"" };
        return { de: deCustom, ate: ateCustom, erroPeriodo: null };
      default:
        return { de: "", ate: "", erroPeriodo: "período inválido" };
    }
  }, [preset, hoje, mesEscolhido, anoEscolhido, deCustom, ateCustom]);

  function alternarConta(slug: string) {
    setSelecionadas((atual) => {
      const novo = new Set(atual);
      if (novo.has(slug)) novo.delete(slug);
      else novo.add(slug);
      return novo;
    });
  }

  const todasSelecionadas = selecionadas.size === contas.length;
  const nenhumaSelecionada = selecionadas.size === 0;

  const linkBase = useMemo(() => {
    if (!de || !ate || nenhumaSelecionada) return null;
    const params = new URLSearchParams({
      de,
      ate,
      contas: todasSelecionadas ? "todas" : Array.from(selecionadas).join(",")
    });
    return params;
  }, [de, ate, selecionadas, todasSelecionadas, nenhumaSelecionada]);

  const hrefXlsx = linkBase ? `/api/financeiro/extratos?${linkBase.toString()}&formato=xlsx` : undefined;
  const hrefCsv = linkBase ? `/api/financeiro/extratos?${linkBase.toString()}&formato=csv` : undefined;

  return (
    <section className="fin-card fin-form-novo">
      <header className="fin-card-head">
        <h2>Baixar extrato</h2>
        <p className="fin-card-hint">
          Escolha o período e as contas. O sistema baixa o que tiver — conta sem extrato importado
          naquele intervalo aparece dizendo isso, na aba dela.
        </p>
      </header>

      <div className="fin-form-grid">
        <label className="fin-field">
          <span>Período</span>
          <select className="fin-select" value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>
            {(Object.keys(ROTULO_PRESET) as Preset[]).map((p) => (
              <option key={p} value={p}>
                {ROTULO_PRESET[p]}
              </option>
            ))}
          </select>
        </label>

        {preset === "mes" && (
          <label className="fin-field">
            <span>Mês</span>
            <input
              className="fin-input"
              type="month"
              value={mesEscolhido}
              onChange={(e) => setMesEscolhido(e.target.value)}
            />
          </label>
        )}

        {preset === "ano" && (
          <label className="fin-field">
            <span>Ano</span>
            <input
              className="fin-input"
              type="number"
              min={2015}
              max={2100}
              value={anoEscolhido}
              onChange={(e) => setAnoEscolhido(e.target.value)}
            />
          </label>
        )}

        {preset === "custom" && (
          <>
            <label className="fin-field">
              <span>De</span>
              <input className="fin-input" type="date" value={deCustom} onChange={(e) => setDeCustom(e.target.value)} />
            </label>
            <label className="fin-field">
              <span>Até</span>
              <input className="fin-input" type="date" value={ateCustom} onChange={(e) => setAteCustom(e.target.value)} />
            </label>
          </>
        )}
      </div>

      <div className="fin-field fin-field-wide">
        <span>Contas</span>
        <div className="extratos-contas">
          <label className="extratos-conta-item extratos-conta-todas">
            <input
              type="checkbox"
              checked={todasSelecionadas}
              onChange={() => setSelecionadas(todasSelecionadas ? new Set() : new Set(contas.map((c) => c.slug)))}
            />
            Todas as contas
          </label>
          {contas.map((c) => (
            <label key={c.slug} className="extratos-conta-item">
              <input type="checkbox" checked={selecionadas.has(c.slug)} onChange={() => alternarConta(c.slug)} />
              {c.nome}
            </label>
          ))}
        </div>
      </div>

      <div className="extratos-resumo">
        {erroPeriodo ? (
          <span className="extratos-resumo-erro">{erroPeriodo}</span>
        ) : (
          <span>
            Período: <strong>{diaBr(de)}</strong> a <strong>{diaBr(ate)}</strong>
            {" · "}
            {todasSelecionadas
              ? `todas as ${contas.length} contas`
              : `${selecionadas.size} conta(s): ${contas
                  .filter((c) => selecionadas.has(c.slug))
                  .map((c) => c.nome)
                  .join(", ")}`}
          </span>
        )}
        {nenhumaSelecionada && !erroPeriodo && (
          <span className="extratos-resumo-erro">selecione ao menos uma conta</span>
        )}
      </div>

      <div className="fin-form-acoes">
        <a
          className={`fin-btn-primary${!hrefXlsx ? " extratos-btn-desabilitado" : ""}`}
          href={hrefXlsx}
          aria-disabled={!hrefXlsx}
        >
          Baixar Excel (.xlsx)
        </a>
        <a
          className={`fin-btn-ghost${!hrefCsv ? " extratos-btn-desabilitado" : ""}`}
          href={hrefCsv}
          aria-disabled={!hrefCsv}
        >
          Baixar CSV
        </a>
      </div>
    </section>
  );
}

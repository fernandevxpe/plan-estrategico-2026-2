"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { brl, Ressalva } from "./Certeza";
import type { LinhaReconciliacao, Reconciliacao, StatusReconciliacao } from "@/lib/financeiro/contratos/reconciliacao";

const ROTA = "/api/financeiro/gerencial/reconciliacao";

const STATUS_ROTULO: Record<StatusReconciliacao, string> = {
  pendente: "pendente",
  sistema_correto: "sistema está certo",
  referencia_errada: "referência está errada",
  corrigido: "corrigido"
};

const STATUS_OPCOES: StatusReconciliacao[] = ["pendente", "sistema_correto", "referencia_errada", "corrigido"];

function mesRotulo(mes: string): string {
  const [ano, m] = mes.split("-");
  const nomes = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${nomes[Number(m) - 1]}/${ano.slice(2)}`;
}

function fimDoMes(mes: string): string {
  const [ano, m] = mes.split("-").map(Number);
  const ultimoDia = new Date(Date.UTC(ano, m, 0)).getUTCDate();
  return `${mes}-${String(ultimoDia).padStart(2, "0")}`;
}

function corDiferenca(diffCents: number, sistemaCents: number): "ok" | "warn" | "bad" {
  const base = Math.max(Math.abs(sistemaCents), 100);
  const pct = Math.abs(diffCents) / base;
  if (Math.abs(diffCents) < 100) return "ok";
  if (pct < 0.05) return "warn";
  return "bad";
}

type Props = {
  dados: Reconciliacao;
  disponivel: boolean;
  ressalvas: string[];
};

export function FinReconciliacao({ dados: inicial, disponivel, ressalvas }: Props) {
  const [dados, setDados] = useState(inicial);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, setPendente] = useState<string | null>(null);

  const recarregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const ano = new Date().getFullYear();
      const r = await fetch(`${ROTA}?de=${ano}-01&ate=${ano}-12`, { headers: { accept: "application/json" } });
      const corpo = await r.json();
      if (corpo?.dado) setDados(corpo.dado);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "falha ao recarregar");
    } finally {
      setCarregando(false);
    }
  }, []);

  const { comReferencia, semReferencia } = useMemo(() => {
    const comRef = dados.linhas.filter((l) => l.referenciaId !== null);
    const semRef = dados.linhas.filter((l) => l.referenciaId === null && l.valorSistemaCents !== 0);
    return { comReferencia: comRef, semReferencia: semRef };
  }, [dados.linhas]);

  async function marcarStatus(linha: LinhaReconciliacao, status: StatusReconciliacao) {
    if (!linha.referenciaId) return;
    const chave = `status-${linha.referenciaId}`;
    setPendente(chave);
    setErro(null);
    try {
      const r = await fetch(ROTA, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ referenciaId: linha.referenciaId, status, nota: linha.nota })
      });
      const corpo = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(corpo?.erro ?? `falha (HTTP ${r.status})`);
      await recarregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "falha ao marcar veredicto");
    } finally {
      setPendente(null);
    }
  }

  async function salvarNota(linha: LinhaReconciliacao, nota: string) {
    if (!linha.referenciaId) return;
    const chave = `nota-${linha.referenciaId}`;
    setPendente(chave);
    setErro(null);
    try {
      const r = await fetch(ROTA, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ referenciaId: linha.referenciaId, status: linha.status ?? "pendente", nota })
      });
      const corpo = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(corpo?.erro ?? `falha (HTTP ${r.status})`);
      await recarregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "falha ao salvar nota");
    } finally {
      setPendente(null);
    }
  }

  if (!disponivel) {
    return (
      <p className="fin-alert">
        A reconciliação não pôde ser lida do banco financeiro. Nada foi escondido: a lista está vazia
        porque a fonte não respondeu, não porque não existem divergências.
      </p>
    );
  }

  return (
    <div className="fin-recon">
      <section className="fin-cat-lacuna card">
        <div className="card-title">
          <h2>{brl(dados.somaAbsDiferencasCents)} em diferenças, {dados.totalPendentes} pendente(s)</h2>
          <span>{dados.totalReferencias} categoria×mês com referência salva</span>
        </div>
        {ressalvas.map((r) => (
          <Ressalva key={r}>{r}</Ressalva>
        ))}
      </section>

      {erro ? <p className="fin-alert">{erro}</p> : null}

      <section className="card">
        <div className="fin-card-head">
          <h2>Com referência salva — maior diferença primeiro</h2>
          <button type="button" className="fin-link-btn" onClick={() => void recarregar()} disabled={carregando}>
            {carregando ? "atualizando…" : "atualizar"}
          </button>
        </div>
        <div className="fin-table-wrap">
          <table className="fin-table">
            <thead>
              <tr>
                <th>Categoria</th>
                <th>Mês</th>
                <th style={{ textAlign: "right" }}>Sistema</th>
                <th style={{ textAlign: "right" }}>Esperado</th>
                <th style={{ textAlign: "right" }}>Diferença</th>
                <th>Fonte</th>
                <th>Status</th>
                <th>Nota</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {comReferencia.length === 0 ? (
                <tr>
                  <td colSpan={9}>Nenhuma categoria com referência salva neste período.</td>
                </tr>
              ) : null}
              {comReferencia.map((l) => {
                const diff = l.diferencaCents ?? 0;
                const cor = corDiferenca(diff, l.valorSistemaCents);
                const chaveStatus = `status-${l.referenciaId}`;
                const chaveNota = `nota-${l.referenciaId}`;
                return (
                  <tr key={`${l.categoryId}-${l.mes}`}>
                    <td>
                      {l.categoriaCode ? (
                        <>
                          <span className="fin-code">{l.categoriaCode}</span> {l.categoriaNome}
                        </>
                      ) : (
                        "sem categoria"
                      )}
                    </td>
                    <td>{mesRotulo(l.mes.slice(0, 7))}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{brl(l.valorSistemaCents)}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {brl(l.valorEsperadoCents ?? 0)}
                    </td>
                    <td
                      style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}
                      className={`fin-recon-diff fin-recon-diff-${cor}`}
                    >
                      {diff > 0 ? "+" : ""}
                      {brl(diff)}
                    </td>
                    <td className="fin-recon-fonte" title={l.fonte ?? ""}>
                      {l.fonte}
                    </td>
                    <td>
                      <select
                        className="fin-select"
                        value={l.status ?? "pendente"}
                        disabled={pendente === chaveStatus}
                        onChange={(e) => void marcarStatus(l, e.target.value as StatusReconciliacao)}
                      >
                        {STATUS_OPCOES.map((s) => (
                          <option key={s} value={s}>
                            {STATUS_ROTULO[s]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        className="fin-input"
                        defaultValue={l.nota ?? ""}
                        placeholder="por que — se já souber"
                        disabled={pendente === chaveNota}
                        onBlur={(e) => {
                          if (e.target.value !== (l.nota ?? "")) void salvarNota(l, e.target.value);
                        }}
                      />
                    </td>
                    <td>
                      {l.categoriaCode ? (
                        <Link
                          className="fin-link-btn"
                          href={`/financeiro/categorizacao?categoria=${l.categoriaCode}&de=${l.mes.slice(0, 7)}-01&ate=${fimDoMes(l.mes.slice(0, 7))}`}
                        >
                          ver lançamentos →
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="fin-card-head">
          <h2>Sem referência ainda</h2>
          <span className="fin-card-hint">
            O sistema tem lançamento nestas categorias/meses, mas ninguém salvou um valor esperado para
            comparar. Não é divergência — é ausência de comparação.
          </span>
        </div>
        <div className="fin-table-wrap">
          <table className="fin-table">
            <thead>
              <tr>
                <th>Categoria</th>
                <th>Mês</th>
                <th style={{ textAlign: "right" }}>Sistema</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {semReferencia.map((l) => (
                <SemReferenciaLinha key={`${l.categoryId}-${l.mes}`} linha={l} onSalvo={recarregar} />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function SemReferenciaLinha({ linha, onSalvo }: { linha: LinhaReconciliacao; onSalvo: () => void | Promise<void> }) {
  const [abrindo, setAbrindo] = useState(false);
  const [valor, setValor] = useState("");
  const [fonte, setFonte] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erroLocal, setErroLocal] = useState<string | null>(null);

  async function salvar() {
    const limpo = valor.replace(/[R$\s.]/g, "").replace(",", ".");
    const n = Number(limpo);
    if (!Number.isFinite(n) || n < 0) {
      setErroLocal("valor inválido");
      return;
    }
    if (!fonte.trim()) {
      setErroLocal("informe a fonte");
      return;
    }
    setSalvando(true);
    setErroLocal(null);
    try {
      const r = await fetch(ROTA, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          categoryId: linha.categoryId,
          mes: linha.mes.slice(0, 7),
          valorEsperadoCents: Math.round(n * 100),
          fonte: fonte.trim()
        })
      });
      const corpo = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(corpo?.erro ?? `falha (HTTP ${r.status})`);
      setAbrindo(false);
      setValor("");
      setFonte("");
      await onSalvo();
    } catch (e) {
      setErroLocal(e instanceof Error ? e.message : "falha ao salvar");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <tr>
      <td>
        {linha.categoriaCode ? (
          <>
            <span className="fin-code">{linha.categoriaCode}</span> {linha.categoriaNome}
          </>
        ) : (
          "sem categoria"
        )}
      </td>
      <td>{mesRotulo(linha.mes.slice(0, 7))}</td>
      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{brl(linha.valorSistemaCents)}</td>
      <td>
        {abrindo ? (
          <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <input
              className="fin-input fin-input-valor"
              placeholder="valor esperado"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              style={{ width: 110 }}
            />
            <input
              className="fin-input"
              placeholder="fonte"
              value={fonte}
              onChange={(e) => setFonte(e.target.value)}
              style={{ width: 160 }}
            />
            <button type="button" className="fin-btn-primary fin-btn-mini" onClick={() => void salvar()} disabled={salvando}>
              salvar
            </button>
            <button type="button" className="fin-btn-ghost fin-btn-mini" onClick={() => setAbrindo(false)}>
              cancelar
            </button>
            {erroLocal ? <span style={{ color: "var(--neon-pink-ink)", fontSize: 12 }}>{erroLocal}</span> : null}
          </span>
        ) : (
          <button type="button" className="fin-link-btn" onClick={() => setAbrindo(true)}>
            salvar valor esperado
          </button>
        )}
      </td>
    </tr>
  );
}

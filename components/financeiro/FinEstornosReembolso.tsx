"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { brlCents } from "@/lib/financeiro/format";

type EstornoLinha = {
  id: number;
  pessoaNome: string;
  titulo: string;
  valorCents: number;
  parcelasPagas: number;
  status: string;
  motivo: string;
  motivoCategoria: string;
  criadoEm: string;
  quitadoEm: string | null;
  matchSugeridoId: number | null;
  matchConfianca: string | null;
  matchSugeridoDescricao: string | null;
};

const ROTULO_STATUS: Record<string, string> = {
  aberto: "aguardando PIX",
  parcial: "parcial",
  quitado: "recebido",
  cancelado_admin: "cancelado"
};

const ROTULO_CONFIANCA: Record<string, string> = {
  alta: "match alto",
  media: "match médio",
  baixa: "match baixo"
};

export function FinEstornosReembolso() {
  const router = useRouter();
  const [pendente, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [estornos, setEstornos] = useState<EstornoLinha[]>([]);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const r = await fetch("/api/financeiro/estornos-reembolso", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro((j.erro as string) ?? "Não foi possível carregar estornos.");
        return;
      }
      setEstornos((j.estornos as EstornoLinha[]) ?? []);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  function confirmar(id: number, transactionId?: number | null) {
    setErro(null);
    startTransition(async () => {
      const r = await fetch("/api/financeiro/estornos-reembolso", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, transactionId })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro((j.erro as string) ?? "Falha ao confirmar.");
        return;
      }
      router.refresh();
      await carregar();
    });
  }

  const abertos = estornos.filter((e) => e.status === "aberto" || e.status === "parcial");
  const totalAberto = abertos.reduce((s, e) => s + e.valorCents, 0);

  return (
    <section className="fin-estornos" aria-labelledby="fin-estornos-titulo">
      <header className="fin-estornos-cabeca">
        <div>
          <h2 id="fin-estornos-titulo">Estornos a receber</h2>
          <p>
            Devoluções de reembolso cancelado — dinheiro que deve voltar para a empresa (Inter), não é faturamento.
          </p>
        </div>
        <div className="fin-estornos-resumo">
          <strong>{brlCents(totalAberto)}</strong>
          <span>{abertos.length} em aberto</span>
        </div>
      </header>

      {erro ? <p className="fin-erro">{erro}</p> : null}
      {carregando ? <p className="fin-sub">Carregando estornos…</p> : null}

      {!carregando && estornos.length === 0 ? (
        <p className="fin-sub">Nenhum estorno registrado.</p>
      ) : null}

      {!carregando && estornos.length > 0 ? (
        <div className="fin-estornos-tabela" role="table">
          <div className="fin-estornos-linha fin-estornos-cabeca-linha" role="row">
            <span role="columnheader">Pessoa</span>
            <span role="columnheader">Item</span>
            <span role="columnheader">Valor</span>
            <span role="columnheader">Status</span>
            <span role="columnheader">Match extrato</span>
            <span role="columnheader">Ação</span>
          </div>
          {estornos.map((e) => (
            <div key={e.id} className={`fin-estornos-linha fin-estornos-linha-${e.status}`} role="row">
              <span data-label="Pessoa">{e.pessoaNome}</span>
              <span data-label="Item">
                <strong>{e.titulo}</strong>
                <small>
                  {e.parcelasPagas} parcela{e.parcelasPagas === 1 ? "" : "s"} · {e.motivo}
                </small>
              </span>
              <span data-label="Valor">{brlCents(e.valorCents)}</span>
              <span data-label="Status">
                <span className={`fin-pill fin-pill-${e.status}`}>{ROTULO_STATUS[e.status] ?? e.status}</span>
              </span>
              <span data-label="Match">
                {e.matchSugeridoId ? (
                  <>
                    <span className={`fin-pill fin-pill-match-${e.matchConfianca}`}>
                      {ROTULO_CONFIANCA[e.matchConfianca ?? ""] ?? "sugerido"}
                    </span>
                    <small title={e.matchSugeridoDescricao ?? undefined}>#{e.matchSugeridoId}</small>
                  </>
                ) : (
                  <span className="fin-sub">—</span>
                )}
              </span>
              <span data-label="Ação">
                {e.status === "aberto" || e.status === "parcial" ? (
                  <button
                    type="button"
                    className="fin-btn fin-btn-sm"
                    disabled={pendente}
                    onClick={() => confirmar(e.id, e.matchConfianca === "alta" ? e.matchSugeridoId : undefined)}
                  >
                    {e.matchSugeridoId && e.matchConfianca === "alta" ? "Confirmar match" : "Marcar recebido"}
                  </button>
                ) : e.quitadoEm ? (
                  <small>{new Date(e.quitadoEm).toLocaleDateString("pt-BR")}</small>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

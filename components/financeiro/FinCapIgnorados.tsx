"use client";

import { useState } from "react";
import { ChevronRight, EyeOff, RotateCcw } from "lucide-react";

import type { ContaAPagar } from "@/lib/financeiro/contas-a-pagar";
import { brlPrecise, shortDateLabel } from "@/lib/financeiro/format";
import { urlDaOrigem } from "@/lib/url-origem";

/**
 * O que o dono disse que não vai pagar neste mês — fora da fila de caixa,
 * recuperável. Sem esta lista, Ignorar era apagar na prática: o item sumia
 * e ninguém sabia como trazê-lo de volta.
 */
export function FinCapIgnorados({
  linhas,
  onAtualizar
}: {
  linhas: ContaAPagar[];
  onAtualizar: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [emVoo, setEmVoo] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  if (!linhas.length) return null;

  const totalCents = linhas.reduce((s, l) => s + l.valorCents, 0);

  async function reativar(itemId: number) {
    setErro(null);
    setEmVoo(itemId);
    try {
      const r = await fetch(
        urlDaOrigem(`/api/financeiro/gerencial/agenda/itens/pagar/${itemId}`),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reativar: true })
        }
      );
      const j = (await r.json().catch(() => null)) as { erro?: string; error?: string } | null;
      if (!r.ok) {
        setErro(j?.erro ?? j?.error ?? "não reativou");
        return;
      }
      onAtualizar();
    } finally {
      setEmVoo(null);
    }
  }

  return (
    <section
      className={aberto ? "fin-custo-parte fin-cap-ignorados" : "fin-custo-parte fin-cap-ignorados fechada"}
      aria-label="Ignorados"
    >
      <header className="fin-custo-parte-cab">
        <button
          type="button"
          className="fin-cap-grupo-toggle"
          aria-expanded={aberto}
          onClick={() => setAberto((v) => !v)}
        >
          <span className="fin-custo-parte-icone" aria-hidden>
            <EyeOff size={15} strokeWidth={2.1} />
          </span>
          <div className="fin-cap-grupo-texto">
            <span className="fin-custo-parte-titulo">Ignorados</span>
            {aberto ? (
              <p className="fin-custo-parte-dica">
                Fora do total deste mês — reative se a decisão mudou.
              </p>
            ) : null}
          </div>
          <span className="fin-cap-grupo-chevron" aria-hidden>
            <ChevronRight
              size={16}
              strokeWidth={2.2}
              className={aberto ? "fin-chevron-aberto" : undefined}
            />
          </span>
        </button>
        <div className="fin-cap-grupo-somas">
          <div>
            <span>
              {linhas.length} {linhas.length === 1 ? "item" : "itens"}
            </span>
            <b>{brlPrecise(totalCents)}</b>
          </div>
        </div>
      </header>

      {aberto ? (
        <div className="fin-cap-ignorados-corpo">
          {erro ? (
            <p className="fin-cap-erro" role="alert">
              {erro}
            </p>
          ) : null}
          <ul className="fin-cap-ignorados-lista">
            {linhas.map((l) => (
              <li key={l.itemId ?? l.chaveDedupe} className="fin-cap-ignorados-item">
                <div className="fin-cap-ignorados-texto">
                  <strong>{l.contraparte ?? l.descricao}</strong>
                  {l.contraparte && l.descricao !== l.contraparte ? (
                    <span className="fin-cap-ignorados-desc">{l.descricao}</span>
                  ) : null}
                  <span className="fin-cap-ignorados-meta">
                    {shortDateLabel(l.dia)} · {brlPrecise(l.valorCents)}
                    {l.motivoNaoSoma ? ` · ${l.motivoNaoSoma}` : null}
                  </span>
                </div>
                {l.itemId != null ? (
                  <button
                    type="button"
                    className="fin-btn-ghost fin-cap-ignorados-reativar"
                    disabled={emVoo === l.itemId}
                    onClick={() => void reativar(l.itemId as number)}
                  >
                    <RotateCcw size={13} strokeWidth={2.2} aria-hidden />
                    {emVoo === l.itemId ? "reativando…" : "Reativar"}
                  </button>
                ) : (
                  <span className="fin-cap-ignorados-sem-id" title="sem item materializado">
                    sem id
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

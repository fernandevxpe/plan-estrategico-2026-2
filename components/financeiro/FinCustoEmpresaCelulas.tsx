"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

import { TIMES, type TimeCusto } from "@/lib/financeiro/custo-empresa-eixos";
import type { ItemCusto, Opcao } from "@/lib/financeiro/custos-empresa";
import { urlDaOrigem } from "@/lib/url-origem";

import { catalogoAreasEmpresa, corAreaEmpresa } from "./FinPessoaEditor";

async function patchCusto(
  item: Pick<ItemCusto, "counterpartyId" | "categoryId">,
  corpo: { area?: string | null; areasEmpresa?: string[]; bloco?: string | null }
) {
  const resposta = await fetch(urlDaOrigem("/api/financeiro/custos-empresa"), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      counterpartyId: item.counterpartyId,
      categoryId: item.categoryId,
      ...corpo
    })
  });
  const resultado = (await resposta.json()) as { error?: string };
  if (!resposta.ok) throw new Error(resultado.error ?? "não salvou");
}

export { patchCusto };

export function CelulaTimeCusto({ item, times }: { item: ItemCusto; times: Opcao[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [emVoo, setEmVoo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const opcoes = times.length ? times : [...TIMES];
  const valor: TimeCusto | "" = item.time === "sem_time" ? "" : item.time;

  async function mudar(slug: string) {
    const atual = valor;
    if (slug === atual) return;
    setErro(null);
    setEmVoo(true);
    try {
      await patchCusto(item, { area: slug || null });
      startTransition(() => router.refresh());
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : "não salvou");
    } finally {
      setEmVoo(false);
    }
  }

  return (
    <span className="fin-celula-area">
      <select
        className="fin-select fin-select-inline"
        value={valor}
        disabled={emVoo}
        aria-label={`Time de ${item.nome}`}
        onChange={(evento) => void mudar(evento.target.value)}
      >
        <option value="">sem time</option>
        {opcoes.map((t) => (
          <option key={t.slug} value={t.slug}>
            {t.nome}
          </option>
        ))}
      </select>
      {erro ? <span className="fin-badge-atencao">{erro}</span> : null}
    </span>
  );
}

export function CelulaAreasCusto({ item, areas }: { item: ItemCusto; areas: Opcao[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [aberto, setAberto] = useState(false);
  const [emVoo, setEmVoo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [nova, setNova] = useState("");
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const gatilhoRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const escolhidas = item.areasEmpresa ?? [];
  const slugs = new Set(escolhidas.map((a) => a.slug));
  const catalogo = catalogoAreasEmpresa(areas, escolhidas);

  function abrir() {
    const el = gatilhoRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const largura = 260;
    const left = Math.min(r.left, window.innerWidth - largura - 8);
    setPos({ top: r.bottom + 4, left: Math.max(8, left) });
    setAberto(true);
  }

  useEffect(() => {
    if (!aberto) return;
    function fechar(evento: MouseEvent) {
      const alvo = evento.target as Node;
      if (popRef.current?.contains(alvo) || gatilhoRef.current?.contains(alvo)) return;
      setAberto(false);
    }
    function tecla(evento: KeyboardEvent) {
      if (evento.key === "Escape") setAberto(false);
    }
    document.addEventListener("mousedown", fechar);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("mousedown", fechar);
      document.removeEventListener("keydown", tecla);
    };
  }, [aberto]);

  async function gravar(proximos: string[]) {
    setErro(null);
    setEmVoo(true);
    try {
      await patchCusto(item, { areasEmpresa: proximos });
      startTransition(() => router.refresh());
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : "não salvou");
    } finally {
      setEmVoo(false);
    }
  }

  function alternar(slug: string) {
    const proximo = slugs.has(slug)
      ? escolhidas.filter((a) => a.slug !== slug).map((a) => a.slug)
      : [...escolhidas.map((a) => a.slug), slug];
    void gravar(proximo);
  }

  function criarNova() {
    const nome = nova.trim();
    if (!nome) return;
    const hit = catalogo.find(
      (a) => a.nome.toLowerCase() === nome.toLowerCase() || a.slug === nome
    );
    if (hit) {
      if (!slugs.has(hit.slug)) void gravar([...escolhidas.map((a) => a.slug), hit.slug]);
      setNova("");
      return;
    }
    void gravar([...escolhidas.map((a) => a.slug), nome]);
    setNova("");
  }

  return (
    <span className="fin-celula-areas-empresa">
      <button
        ref={gatilhoRef}
        type="button"
        className={escolhidas.length ? "fin-areas-empresa-gatilho tem" : "fin-areas-empresa-gatilho vazio"}
        disabled={emVoo}
        aria-expanded={aberto}
        aria-haspopup="listbox"
        aria-label={`Áreas da empresa de ${item.nome}`}
        onClick={() => (aberto ? setAberto(false) : abrir())}
      >
        {escolhidas.length ? (
          <span className="fin-areas-empresa-pills">
            {escolhidas.map((a) => (
              <i
                key={a.slug}
                className="fin-areas-empresa-pill"
                style={{ ["--chip-cor" as string]: corAreaEmpresa(a.slug) }}
              >
                {a.nome}
              </i>
            ))}
          </span>
        ) : (
          "sem área"
        )}
      </button>
      {erro ? <span className="fin-badge-atencao">{erro}</span> : null}
      {aberto && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={popRef}
              className="fin-areas-empresa-pop"
              style={{ top: pos.top, left: pos.left }}
              role="listbox"
              aria-multiselectable
              aria-label="Áreas da empresa"
            >
              {catalogo.map((op) => {
                const marcado = slugs.has(op.slug);
                return (
                  <label
                    key={op.slug}
                    className={marcado ? "ativo" : undefined}
                    style={{ ["--chip-cor" as string]: corAreaEmpresa(op.slug) }}
                  >
                    <input
                      type="checkbox"
                      checked={marcado}
                      disabled={emVoo}
                      onChange={() => alternar(op.slug)}
                    />
                    <i className="fin-pessoas-matriz-chip-ponto" aria-hidden />
                    {op.nome}
                  </label>
                );
              })}
              <div className="fin-areas-empresa-nova">
                <input
                  className="fin-input"
                  value={nova}
                  placeholder="Outra área…"
                  disabled={emVoo}
                  onChange={(e) => setNova(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      criarNova();
                    }
                  }}
                />
                <button type="button" className="fin-btn-ghost" disabled={emVoo || !nova.trim()} onClick={criarNova}>
                  +
                </button>
              </div>
            </div>,
            document.body
          )
        : null}
    </span>
  );
}

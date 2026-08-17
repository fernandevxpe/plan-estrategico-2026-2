"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { brl } from "@/components/financeiro/Certeza";

/**
 * O sino.
 *
 * ---------------------------------------------------------------------------
 * AS TRÊS DECISÕES DE PRODUTO QUE ESTE ARQUIVO CARREGA
 * ---------------------------------------------------------------------------
 *
 * **1. O contador conta o que EXIGE AÇÃO, não o que existe.** Um sino que
 * mostra 1.500 é um sino desligado: o número deixa de significar qualquer coisa
 * e a pessoa aprende a não olhar. Por isso a fila de decisão inteira aparece
 * como UM aviso agregado (a régua de valor não foi declarada — dúvida 59), e
 * não como 1.555.
 *
 * **2. Valor só aparece para quem pode ver valor.** O corte é feito no
 * servidor, em três camadas (schema, consulta, middleware) — aqui embaixo o
 * componente só renderiza o que chegou. Ele não sabe filtrar, e é bom que não
 * saiba: componente que decide o que esconder é componente que um dia esconde
 * errado.
 *
 * **3. Não existe polling agressivo.** 60 segundos, e só quando a aba está
 * visível. Um sino que consulta a cada 5s numa aba esquecida é uma varredura de
 * views do ledger a cada 5s, para sempre. O custo de saber 50 segundos depois é
 * zero; o de martelar o banco não é.
 */

type Notificacao = {
  id: number;
  kind: string;
  titulo: string;
  corpo: string;
  link: string;
  valorCents: number | null;
  motivoSemValor: string | null;
  estado: "nao_lida" | "lida" | "resolvida";
  escopo: "proprio" | "gestao";
  criadaEm: string;
  ultimaOcorrencia: string;
  ocorrencias: number;
};

type Caixa = {
  disponivel: boolean;
  motivoIndisponivel: string | null;
  naoLidas: number;
  notificacoes: Notificacao[];
  destinatario: { perfil: string; pessoa: string | null };
};

const INTERVALO_MS = 60_000;

export function Sino() {
  const [caixa, setCaixa] = useState<Caixa | null>(null);
  const [aberto, setAberto] = useState(false);
  const painelRef = useRef<HTMLDivElement>(null);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch("/api/notificacoes?limite=20", { cache: "no-store" });
      if (!r.ok) return;
      setCaixa(await r.json());
    } catch {
      // Silêncio proposital: o sino aparece em toda tela da plataforma. Uma
      // falha aqui não pode virar erro visível numa página que está funcionando.
    }
  }, []);

  useEffect(() => {
    carregar();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") carregar();
    }, INTERVALO_MS);
    return () => clearInterval(t);
  }, [carregar]);

  // Fecha ao clicar fora e no Esc — o painel cobre conteúdo e prender o usuário
  // dentro dele é o defeito mais comum deste componente em qualquer produto.
  useEffect(() => {
    if (!aberto) return;
    const clique = (e: MouseEvent) => {
      if (painelRef.current && !painelRef.current.contains(e.target as Node)) setAberto(false);
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAberto(false);
    };
    document.addEventListener("mousedown", clique);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("mousedown", clique);
      document.removeEventListener("keydown", tecla);
    };
  }, [aberto]);

  async function marcar(id: number, estado: "lida" | "resolvida") {
    await fetch(`/api/notificacoes/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ estado })
    });
    await carregar();
  }

  const naoLidas = caixa?.naoLidas ?? 0;

  return (
    <div className="sino-wrap" ref={painelRef}>
      <button
        type="button"
        className="sino"
        aria-label={naoLidas > 0 ? `${naoLidas} avisos não lidos` : "Notificações"}
        aria-expanded={aberto}
        onClick={() => setAberto(!aberto)}
      >
        <span aria-hidden>🔔</span>
        {naoLidas > 0 ? <span className="sino-contador">{naoLidas > 99 ? "99+" : naoLidas}</span> : null}
      </button>

      {aberto ? (
        <div className="sino-painel" role="dialog" aria-label="Notificações">
          <div className="sino-topo">
            <strong>Precisa de você</strong>
            {caixa?.destinatario.pessoa ? <span className="sino-quem">{caixa.destinatario.pessoa}</span> : null}
            {naoLidas > 0 ? (
              <button
                type="button"
                className="sino-acao"
                onClick={async () => {
                  await fetch("/api/notificacoes", { method: "POST" });
                  await carregar();
                }}
              >
                marcar tudo como lido
              </button>
            ) : null}
          </div>

          {!caixa ? (
            <p className="sino-vazio">carregando…</p>
          ) : !caixa.disponivel ? (
            <p className="sino-vazio">{caixa.motivoIndisponivel}</p>
          ) : caixa.notificacoes.length === 0 ? (
            <p className="sino-vazio">
              {caixa.destinatario.perfil === "comum" && !caixa.destinatario.pessoa ? (
                <>
                  Nenhum aviso — e eu ainda não sei quem é você.{" "}
                  <Link href="/time">Identifique-se</Link> para receber a resposta do que enviar.
                </>
              ) : (
                "Nada esperando por você."
              )}
            </p>
          ) : (
            <ul className="sino-lista">
              {caixa.notificacoes.map((n) => (
                <li key={n.id} className="sino-item" data-estado={n.estado}>
                  <Link href={n.link} className="sino-item-link" onClick={() => marcar(n.id, "lida")}>
                    <span className="sino-item-titulo">{n.titulo}</span>
                    <span className="sino-item-corpo">{n.corpo}</span>
                    <span className="sino-item-meta">
                      {n.valorCents !== null ? (
                        <strong>{brl(n.valorCents)}</strong>
                      ) : (
                        <em title={n.motivoSemValor ?? undefined}>sem valor em jogo</em>
                      )}
                      {n.ocorrencias > 1 ? <span>· visto {n.ocorrencias}×</span> : null}
                    </span>
                  </Link>
                  <button type="button" className="sino-acao" onClick={() => marcar(n.id, "resolvida")}>
                    já cuidei
                  </button>
                </li>
              ))}
            </ul>
          )}

          <Link href="/notificacoes" className="sino-todos" onClick={() => setAberto(false)}>
            ver todas →
          </Link>
        </div>
      ) : null}
    </div>
  );
}

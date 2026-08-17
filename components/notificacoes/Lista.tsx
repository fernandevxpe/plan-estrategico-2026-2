"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { SeloCamada, brl } from "@/components/financeiro/Certeza";

/**
 * A lista inteira de notificações.
 *
 * O que ela faz que o sino não faz: mostra as RESOLVIDAS. É a única tela que
 * responde "isso já foi avisado e alguém tratou?" — sem ela, um aviso que
 * some do sino some do mundo, e a pergunta "por que ninguém me falou?" não tem
 * como ser respondida.
 *
 * O agrupamento é por ESTADO e não por data: a pessoa vem aqui com uma
 * pergunta de estado ("o que falta?"), não cronológica.
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

/**
 * O que cada tipo significa, em uma linha. O sino mostra o fato; aqui mostramos
 * também POR QUE aquilo é um aviso — é a diferença entre um alerta e um
 * incômodo.
 */
const EXPLICA: Record<string, string> = {
  fila_decisao_item: "um lançamento acima da régua espera decisão",
  fila_decisao_sem_regua: "a fila não tem régua de valor, então nada é notificado item a item",
  pagamento_aguardando_aprovacao: "há solicitação de pagamento parada antes da aprovação",
  alcada_ausente: "sem alçada declarada, o gatilho recusa qualquer aprovação — a fila não anda",
  time_reembolso_aguardando: "alguém do time mandou reembolso e espera resposta",
  time_compra_aguardando: "alguém do time pediu uma compra e espera resposta",
  time_envio_aguardando: "alguém do time mandou custo ou nota e espera resposta",
  time_resposta: "o que você enviou foi respondido",
  fonte_desatualizada: "uma fonte passou da tolerância dela — o saldo da tela envelhece a partir daqui",
  invariante_quebrado: "uma afirmação que o ledger garante deixou de ser verdadeira"
};

const GRUPOS: { estado: Notificacao["estado"]; titulo: string; vazio: string }[] = [
  { estado: "nao_lida", titulo: "Não lidas", vazio: "Nada esperando por você." },
  { estado: "lida", titulo: "Lidas, ainda abertas", vazio: "Nada aqui." },
  { estado: "resolvida", titulo: "Resolvidas", vazio: "Nada resolvido ainda." }
];

export function ListaNotificacoes() {
  const [caixa, setCaixa] = useState<Caixa | null>(null);

  const carregar = useCallback(async () => {
    const r = await fetch("/api/notificacoes?resolvidas=1&limite=200", { cache: "no-store" });
    if (!r.ok) return;
    setCaixa(await r.json());
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function marcar(id: number, estado: "lida" | "resolvida" | "nao_lida") {
    await fetch(`/api/notificacoes/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ estado })
    });
    await carregar();
  }

  if (!caixa) return <p className="time-sub">carregando…</p>;

  if (!caixa.disponivel) {
    return (
      <div className="time-aviso">
        <h2>A caixa de avisos ainda não existe neste ambiente</h2>
        <p>{caixa.motivoIndisponivel}</p>
      </div>
    );
  }

  if (caixa.destinatario.perfil === "comum" && !caixa.destinatario.pessoa) {
    return (
      <div className="time-aviso">
        <h2>Eu ainda não sei quem é você</h2>
        <p>
          A senha desta plataforma é a mesma para o time inteiro. Para receber a resposta do que você enviar,{" "}
          <Link href="/time">diga quem você é</Link>.
        </p>
      </div>
    );
  }

  return (
    <div className="notif-pagina">
      {GRUPOS.map((g) => {
        const itens = caixa.notificacoes.filter((n) => n.estado === g.estado);
        return (
          <section key={g.estado} className="notif-grupo">
            <h2>
              {g.titulo} {itens.length > 0 ? <span className="time-contador">{itens.length}</span> : null}
            </h2>
            {itens.length === 0 ? (
              <p className="time-sub">{g.vazio}</p>
            ) : (
              <ul className="notif-lista">
                {itens.map((n) => (
                  <li key={n.id} className="notif-item" data-estado={n.estado}>
                    <div className="notif-item-topo">
                      <Link href={n.link} className="notif-item-titulo" onClick={() => marcar(n.id, "lida")}>
                        {n.titulo}
                      </Link>
                      {n.valorCents !== null ? (
                        <span className="notif-valor">{brl(n.valorCents)}</span>
                      ) : (
                        <SeloCamada camada="indeterminado" texto="sem valor" />
                      )}
                    </div>
                    <p className="notif-corpo">{n.corpo}</p>
                    <p className="notif-porque">{EXPLICA[n.kind] ?? n.kind}</p>
                    <div className="notif-acoes">
                      <span className="notif-quando">
                        {new Date(n.ultimaOcorrencia).toLocaleString("pt-BR")}
                        {n.ocorrencias > 1 ? ` · visto ${n.ocorrencias}×` : ""}
                      </span>
                      {n.estado !== "resolvida" ? (
                        <button type="button" className="time-link" onClick={() => marcar(n.id, "resolvida")}>
                          já cuidei
                        </button>
                      ) : (
                        <button type="button" className="time-link" onClick={() => marcar(n.id, "nao_lida")}>
                          reabrir
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}

      <p className="time-sub time-rodape">
        Um aviso <strong>resolvido</strong> é você dizendo &quot;já cuidei&quot;. Se o fato voltar a acontecer, ele
        reabre sozinho — a caixa acompanha o mundo, não o contrário.
      </p>
    </div>
  );
}

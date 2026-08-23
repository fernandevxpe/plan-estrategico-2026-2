"use client";

import { useEffect, useMemo, useState } from "react";

import type { EtapaExecucao, ExecucaoSync, ReferenciaSync } from "@/lib/financeiro/contratos/fontes";

/**
 * As peças de progresso de uma sincronização, compartilhadas pelo botão do
 * cabeçalho e pela tela `/financeiro/fontes`.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ELAS SÃO UM ARQUIVO SÓ
 * ---------------------------------------------------------------------------
 * São duas superfícies mostrando a MESMA execução, e o pedido foi por um botão
 * no cabeçalho — não por uma segunda leitura do mesmo fato. Duas formatações do
 * mesmo percentual divergiriam no primeiro arredondamento, e o usuário veria
 * 67% no topo e 66% na tela, sem ter como saber qual acreditar.
 *
 * ---------------------------------------------------------------------------
 * O RELÓGIO É O DO SERVIDOR, ANCORADO NO CLIENTE
 * ---------------------------------------------------------------------------
 * `decorridoMs` vem calculado pelo servidor (`now − iniciada_em`). Contar no
 * cliente a partir de `iniciadaEm` pareceria mais simples e estaria errado: o
 * relógio do navegador pode estar minutos fora do relógio do container, e o
 * sintoma seria um cronômetro que já começa em "3m" ou em zero e não anda.
 *
 * `useDecorrido` toma o valor do servidor como âncora e soma só o tempo LOCAL
 * decorrido desde que aquele valor chegou. O erro fica limitado à latência da
 * requisição, não à diferença entre dois relógios.
 */

/** "38s" · "4m12s" · "1h04m". Segundos importam abaixo de uma hora, não acima. */
export function duracao(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`;
}

/**
 * Só depois de montado. Um cronômetro renderizado no servidor e re-renderizado
 * no cliente com outro `Date.now()` produz divergência de hidratação — e o
 * React descarta a árvore inteira por causa de dois dígitos de segundo.
 */
export function useMontado(): boolean {
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);
  return montado;
}

/** O decorrido ao vivo, ancorado no valor do servidor. Ver o cabeçalho. */
export function useDecorrido(execucao: ExecucaoSync | null): number {
  const base = execucao?.progresso.decorridoMs ?? 0;
  const rodando = execucao?.status === "rodando";
  const id = execucao?.id ?? null;

  // Reancora sempre que chega leitura nova do servidor (o `base` muda a cada
  // passo do polling) ou quando a execução observada é outra.
  const ancora = useMemo(() => ({ base, em: Date.now() }), [base, id]);
  const [, tique] = useState(0);

  useEffect(() => {
    if (!rodando) return;
    const t = setInterval(() => tique((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [rodando]);

  if (!rodando) return base;
  return ancora.base + (Date.now() - ancora.em);
}

/** A frase do progresso: percentual E etapa N de M, porque uma explica a outra. */
export function textoDoProgresso(x: ExecucaoSync): string {
  const p = x.progresso;
  if (p.planoPresumido) return "iniciando…";
  if (p.previstas === 0) return "sem etapa declarada";
  const posicao = p.etapaAtual ?? Math.min(p.concluidas + 1, p.previstas);
  return x.status === "rodando"
    ? `${p.pct}% · etapa ${posicao} de ${p.previstas}`
    : `${p.concluidas} de ${p.previstas} etapa${p.previstas === 1 ? "" : "s"}`;
}

/**
 * A barra. Ela é discreta e o número ao lado dela é que informa — a barra
 * existe para dar a direção de relance, não para ser a medida.
 */
export function BarraProgresso({ x }: { x: ExecucaoSync }) {
  const p = x.progresso;
  const cor =
    p.falhas > 0 ? "var(--fin-out)" : x.status === "rodando" ? "var(--purple)" : "var(--green)";
  return (
    <div
      className="sync-barra"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={p.pct}
      aria-label={textoDoProgresso(x)}
    >
      <span style={{ width: `${Math.min(100, Math.max(0, p.pct))}%`, background: cor }} />
    </div>
  );
}

/**
 * Quanto a última bem-sucedida levou. Fica ao LADO do percentual, nunca dentro
 * dele: é referência histórica, e misturar as duas transformaria uma contagem de
 * fatos numa estimativa.
 */
export function textoDaReferencia(r: ReferenciaSync | null): string {
  if (!r) return "primeira vez neste ambiente — ainda não há quanto isto costuma levar";
  return `a última completa levou ${duracao(r.duracaoMs)}`;
}

const SIMBOLO: Record<EtapaExecucao["estado"], string> = {
  pendente: "·",
  rodando: "…",
  ok: "✓",
  erro: "✗"
};

/*
 * As tintas, não as cores de gráfico.
 *
 * `--green` sobre o cartão branco dá 3,39:1 e `--purple` 4,0 — os dois abaixo
 * do mínimo para texto. `--ink-green` e `--ink-purple` existem exatamente para
 * quando a cor é lida, não vista de longe, e acompanham os três blocos de
 * tema. O ✓ tem 11,5px e é o único sinal de que a etapa passou.
 */
const COR: Record<EtapaExecucao["estado"], string> = {
  pendente: "var(--muted)",
  rodando: "var(--ink-purple)",
  ok: "var(--ink-green)",
  erro: "var(--fin-out)"
};

/**
 * Uma etapa. `pendente` aparece apagada em vez de sumir: saber que faltam três
 * é a informação, e uma lista que só cresce esconde o denominador.
 *
 * Quando falha, a linha diz O QUE falhou e POR QUÊ. Sem isso o botão falha em
 * silêncio, que é pior que não ter botão.
 */
export function LinhaEtapa({ e, compacta = false }: { e: EtapaExecucao; compacta?: boolean }) {
  const apagada = e.estado === "pendente";
  return (
    <li className={`sync-etapa${apagada ? " is-pendente" : ""}`}>
      <span className="sync-etapa-marca" style={{ color: COR[e.estado] }} aria-hidden>
        {SIMBOLO[e.estado]}
      </span>
      <span className="sync-etapa-nome">
        {e.etapa}
        {e.fonte ? <span className="sync-etapa-fonte">{e.fonte}</span> : null}
      </span>
      <span className="sync-etapa-tempo">
        {e.ms !== undefined ? duracao(e.ms) : e.estado === "rodando" ? "rodando" : ""}
      </span>
      {e.erro ? (
        <div className="sync-etapa-erro">
          {e.erro}
          {!compacta && e.saida ? <pre className="sync-etapa-saida">{e.saida}</pre> : null}
        </div>
      ) : null}
    </li>
  );
}

export function ListaEtapas({
  etapas,
  compacta = false
}: {
  etapas: EtapaExecucao[];
  compacta?: boolean;
}) {
  if (!etapas.length) return null;
  return (
    <ul className="sync-etapas">
      {etapas.map((e, i) => (
        <LinhaEtapa key={`${e.etapa}-${i}`} e={e} compacta={compacta} />
      ))}
    </ul>
  );
}

/**
 * A frase de desfecho. Ela nomeia a FONTE que falhou, não "erro ao sincronizar":
 * o usuário precisa saber se o problema foi no Asaas ou no Inter para decidir se
 * tenta de novo ou se o número da tela ainda serve.
 *
 * 'perdida' diz que ninguém sabe como terminou — nunca que falhou. O processo
 * pode ter concluído e morrido antes de reportar, e chamar isso de falha seria
 * inventar um fato.
 */
export function desfecho(x: ExecucaoSync): { tom: "ok" | "parcial" | "erro" | "duvida"; texto: string } {
  const falhas = x.etapas.filter((e) => e.estado === "erro");
  const fontes = [...new Set(falhas.map((e) => e.fonte ?? "consolidação"))];

  if (x.status === "ok") {
    return { tom: "ok", texto: `atualizado em ${duracao(x.progresso.decorridoMs)}` };
  }
  if (x.status === "perdida") {
    return {
      tom: "duvida",
      texto:
        x.erro ??
        "o processo não reportou fim; não se sabe como terminou. Isto não afirma que falhou."
    };
  }
  if (x.status === "parcial") {
    return {
      tom: "parcial",
      texto:
        `${x.progresso.ok} de ${x.progresso.previstas} etapas passaram. ` +
        `Falhou em: ${fontes.join(", ")} — ${falhas.map((f) => `${f.etapa}: ${f.erro}`).join(" · ")}`
    };
  }
  return {
    tom: "erro",
    texto: falhas.length
      ? `falhou em ${fontes.join(", ")} — ${falhas.map((f) => `${f.etapa}: ${f.erro}`).join(" · ")}`
      : (x.erro ?? "falhou sem registrar o motivo")
  };
}

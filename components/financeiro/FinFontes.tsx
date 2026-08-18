"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Ressalva, SeloCamada, type Camada } from "@/components/financeiro/Certeza";
import {
  BarraProgresso,
  ListaEtapas,
  duracao,
  textoDaReferencia,
  textoDoProgresso,
  useDecorrido,
  useMontado
} from "@/components/financeiro/SyncProgresso";
import type { Contrato } from "@/lib/financeiro/contratos/base";
import type {
  EstadoFonte,
  ExecucaoSync,
  LinhaFonte,
  PainelFontes,
  ReferenciaSync
} from "@/lib/financeiro/contratos/fontes";

/**
 * A tela das fontes — a resposta às quatro perguntas do feedback.
 *
 * ---------------------------------------------------------------------------
 * A DECISÃO DE DESENHO QUE IMPORTA: DUAS DATAS, NÃO UMA
 * ---------------------------------------------------------------------------
 * Cada linha mostra "último dado" E "última tentativa", lado a lado. A tela
 * antiga mostrava só a primeira, e por isso "a sync quebrou" e "o banco não teve
 * movimento no fim de semana" apareciam idênticas — as duas em vermelho, com o
 * mesmo número.
 *
 * Com as duas datas a leitura fica óbvia sem precisar de explicação: *último
 * dado 15/08 · olhamos hoje* é uma fonte saudável numa segunda-feira. *último
 * dado 15/08 · olhamos em 10/08* é uma sync parada.
 *
 * ---------------------------------------------------------------------------
 * BOTÃO DESABILITADO SEMPRE COM O MOTIVO AO LADO
 * ---------------------------------------------------------------------------
 * Metade das fontes não é alcançada pelo pipeline do botão: três são importação
 * manual e duas são API sem etapa no agendador. Mostrar um botão cinza sem
 * explicação seria repetir, em forma de widget, o defeito que esta tela veio
 * consertar — cobrar sem oferecer a ação. Cada linha inatualizável diz por quê e,
 * quando existe, qual comando a atualiza.
 *
 * Indeterminado tem hachura roxa (`cert-hachura`), nunca cinza: cinza lê como
 * "zero" e aqui não há zero nenhum, há ausência de régua declarada.
 */

const SELO_POR_ESTADO: Record<EstadoFonte, { camada: Camada; texto: string }> = {
  em_dia: { camada: "firme", texto: "em dia" },
  atrasada: { camada: "atrasado", texto: "atrasada" },
  // Régua ausente é indeterminação, não atraso: não se sabe se está atrasada.
  sem_regua: { camada: "indeterminado", texto: "sem régua" },
  nunca_entregou: { camada: "indeterminado", texto: "nunca entregou" },
  sem_classificacao: { camada: "indeterminado", texto: "sem classificação" }
};

const ROTULO_NATUREZA: Record<LinhaFonte["natureza"], string> = {
  automatica: "automática",
  manual: "manual",
  desconhecida: "não catalogada"
};

function dataCurta(iso: string | null): string {
  if (!iso) return "—";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

/** "hoje", "ontem" ou a data. Um relógio que fala em dias é lido sem contar. */
function quando(iso: string | null): string {
  if (!iso) return "nunca";
  const alvo = new Date(iso.slice(0, 10) + "T12:00:00Z");
  const hoje = new Date();
  const dias = Math.round(
    (Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate()) -
      Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth(), alvo.getUTCDate())) /
      86_400_000
  );
  if (dias === 0) return "hoje";
  if (dias === 1) return "ontem";
  return `${dataCurta(iso)} · há ${dias} dias`;
}

function atrasoTexto(f: LinhaFonte): React.ReactNode {
  if (f.atrasoUtil === null) {
    return <span className="cert-hachura">indeterminado</span>;
  }
  const uteis = `${f.atrasoUtil} dia${f.atrasoUtil === 1 ? "" : "s"} útil${f.atrasoUtil === 1 ? "" : "eis"}`;
  return (
    <>
      <strong>{uteis}</strong>
      {f.atrasoCorrido !== null && f.atrasoCorrido !== f.atrasoUtil ? (
        <span className="fin-desc-sub">{f.atrasoCorrido} corridos</span>
      ) : null}
    </>
  );
}

/**
 * Uma execução, com o progresso.
 *
 * `ao vivo` só é passado para a execução corrente: o cronômetro tem de contar
 * numa e só numa, senão o histórico "conta" junto e mostra durações que crescem
 * sozinhas para execuções encerradas há dias.
 */
function Execucao({
  x,
  referencia,
  aoVivo = false
}: {
  x: ExecucaoSync;
  referencia?: ReferenciaSync | null;
  aoVivo?: boolean;
}) {
  const rodando = x.status === "rodando";
  const montado = useMontado();
  const decorridoVivo = useDecorrido(aoVivo ? x : null);
  const decorrido = aoVivo && montado ? decorridoVivo : x.progresso.decorridoMs;

  return (
    <div className="fin-card" style={{ padding: 14, marginBottom: 12 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <strong>
          {rodando ? "Sincronizando agora" : `Execução #${x.id}`}
          {x.escopo !== "todas" ? ` · ${x.escopo}` : ""}
        </strong>
        <SeloCamada
          camada={x.status === "ok" ? "firme" : x.status === "rodando" ? "provavel" : x.status === "parcial" ? "observado" : "atrasado"}
          texto={x.status}
        />
        <span className="fin-desc-sub">
          iniciada por {x.ator} em {new Date(x.iniciadaEm).toLocaleString("pt-BR")}
        </span>
      </div>

      {/* Percentual E "etapa N de M" lado a lado: o segundo é o que explica o
          primeiro. O percentual conta ETAPAS CONCLUÍDAS — se ele andasse por
          relógio, encalhar no Asaas ainda o levaria a 100%. */}
      <div className="sync-painel-linha" style={{ marginTop: 10 }}>
        <strong>{textoDoProgresso(x)}</strong>
        <span className="fin-desc-sub" style={{ margin: 0 }}>
          {duracao(decorrido)}
          {rodando && referencia ? ` de ~${duracao(referencia.duracaoMs)}` : ""}
        </span>
      </div>
      <BarraProgresso x={x} />

      {x.etapas.length ? (
        <ListaEtapas etapas={x.etapas} />
      ) : (
        <p className="fin-card-hint">
          {rodando ? "começando…" : "esta execução não registrou etapa nenhuma."}
        </p>
      )}

      {/* 'perdida' declara desconhecimento, não falha — e a tela repete essa
          distinção em vez de pintar tudo de vermelho. */}
      {x.erro ? (
        <Ressalva>
          <strong>{x.status === "perdida" ? "Não se sabe como terminou: " : "Falhou: "}</strong>
          {x.erro}
        </Ressalva>
      ) : null}
    </div>
  );
}

export function FinFontes({ contrato }: { contrato: Contrato<PainelFontes> }) {
  const [dado, setDado] = useState<PainelFontes>(contrato.dado);
  const [execucao, setExecucao] = useState<ExecucaoSync | null>(contrato.dado.execucaoCorrente);
  const [disparando, setDisparando] = useState<string | null>(null);
  const [recusa, setRecusa] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const recarregar = useCallback(async () => {
    const r = await fetch("/api/financeiro/gerencial/fontes", { cache: "no-store" });
    if (!r.ok) return;
    const c = (await r.json()) as Contrato<PainelFontes>;
    setDado(c.dado);
  }, []);

  /**
   * O polling. Ele para sozinho quando a execução termina e recarrega a lista —
   * uma tela que continua mostrando o atraso antigo depois de a sync ter
   * corrigido é a mesma mentira do sino que não resolve.
   */
  useEffect(() => {
    if (!execucao || execucao.status !== "rodando") {
      if (timer.current) clearTimeout(timer.current);
      return;
    }
    let vivo = true;
    const passo = async () => {
      try {
        const r = await fetch(
          `/api/financeiro/gerencial/fontes/sincronizar?execucao=${execucao.id}`,
          { cache: "no-store" }
        );
        if (r.ok && vivo) {
          const e = (await r.json()) as ExecucaoSync;
          setExecucao(e);
          if (e.status !== "rodando") {
            await recarregar();
            return;
          }
        }
      } catch {
        // Rede caindo no meio do polling não pode apagar o que já se sabe da
        // execução: mantém o último estado e tenta de novo.
      }
      if (vivo) timer.current = setTimeout(passo, 3000);
    };
    timer.current = setTimeout(passo, 2000);
    return () => {
      vivo = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [execucao, recarregar]);

  async function sincronizar(fonte: string) {
    setDisparando(fonte);
    setRecusa(null);
    try {
      const r = await fetch("/api/financeiro/gerencial/fontes/sincronizar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fonte })
      });
      const corpo = await r.json();

      if (r.status === 202) {
        // Otimista, com `planoPresumido`: a tela diz "iniciando…" em vez de 0%
        // de um denominador que o trabalhador ainda não gravou.
        setExecucao({
          id: corpo.execucaoId,
          escopo: corpo.escopo,
          status: "rodando",
          ator: "você",
          iniciadaEm: new Date().toISOString(),
          terminadaEm: null,
          etapas: [],
          erro: null,
          progresso: {
            previstas: corpo.etapas ?? 0,
            concluidas: 0,
            ok: 0,
            falhas: 0,
            pendentes: corpo.etapas ?? 0,
            pct: 0,
            etapaAtual: null,
            nomeEtapaAtual: null,
            etapaAtualMs: null,
            decorridoMs: 0,
            planoPresumido: true
          }
        });
        return;
      }

      // 409: já existe uma rodando. Passar a acompanhar AQUELA é mais útil que
      // dizer "não" — foi ela que o segundo clique queria de qualquer forma.
      if (r.status === 409 && corpo.execucaoId) {
        const j = await fetch(
          `/api/financeiro/gerencial/fontes/sincronizar?execucao=${corpo.execucaoId}`,
          { cache: "no-store" }
        );
        if (j.ok) setExecucao((await j.json()) as ExecucaoSync);
        setRecusa(`Já havia uma sincronização em andamento (iniciada por ${corpo.iniciadaPor ?? "alguém"}). Acompanhando ela.`);
        return;
      }

      setRecusa(`${corpo.erro ?? "não consegui disparar"}${corpo.motivo ? ` — ${corpo.motivo}` : ""}`);
    } catch (e) {
      setRecusa(`não consegui falar com o servidor: ${(e as Error).message}`);
    } finally {
      setDisparando(null);
    }
  }

  if (!contrato.disponivel) {
    return (
      <Ressalva>
        A tela de fontes existe, a medida ainda não:{" "}
        <strong>{contrato.ressalvas[0] ?? "motivo não informado"}</strong>. Dizer isso vale mais que
        mostrar uma lista vazia, que seria indistinguível de &quot;está tudo em dia&quot;.
      </Ressalva>
    );
  }

  const rodando = execucao?.status === "rodando";
  const foraDaTolerancia = dado.fontes.filter((f) => f.alarma);
  const podeGeral = dado.fontesAtualizaveis.length > 0;

  return (
    <div className="fin-secao">
      {/* A ressalva vem ANTES da tabela, sempre: um rodapé chega tarde. */}
      <div style={{ display: "grid", gap: 10, marginBottom: 16 }}>
        {contrato.ressalvas.slice(0, 3).map((r, i) => (
          <Ressalva key={i}>{r}</Ressalva>
        ))}
      </div>

      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          flexWrap: "wrap",
          marginBottom: 14
        }}
      >
        <button
          type="button"
          className="fin-btn-primary"
          disabled={rodando || disparando !== null || !podeGeral}
          onClick={() => sincronizar("todas")}
          title={
            podeGeral
              ? `Roda o mesmo pipeline do agendador para: ${dado.fontesAtualizaveis.join(", ")}`
              : "nenhuma fonte é alcançada por este botão neste ambiente"
          }
        >
          {rodando
            ? `sincronizando… ${textoDoProgresso(execucao)}`
            : "Atualizar todas as fontes automáticas"}
        </button>
        <span className="fin-desc-sub">
          alcança {dado.fontesAtualizaveis.join(", ") || "nenhuma"} — as demais dizem por que não, na
          linha delas · {textoDaReferencia(dado.referencia)}
        </span>
      </div>

      {recusa ? <Ressalva>{recusa}</Ressalva> : null}
      {execucao ? (
        <Execucao
          x={execucao}
          referencia={dado.referencia}
          aoVivo={execucao.status === "rodando"}
        />
      ) : null}

      <table className="fin-tabela-simples">
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Fonte</th>
            <th style={{ textAlign: "left" }}>O que ela alimenta</th>
            <th style={{ textAlign: "left" }}>Último dado</th>
            <th style={{ textAlign: "left" }}>Olhamos</th>
            <th style={{ textAlign: "left" }}>Atraso</th>
            <th style={{ textAlign: "left" }}>Tolerância</th>
            <th style={{ textAlign: "left" }}>Estado</th>
            <th style={{ textAlign: "left" }}>Atualizar</th>
          </tr>
        </thead>
        <tbody>
          {dado.fontes.map((f) => {
            const selo = SELO_POR_ESTADO[f.estado];
            return (
              <tr key={`${f.fonte}:${f.conta}`}>
                <td>
                  <span className="fin-desc">{f.rotulo}</span>
                  <span className="fin-desc-sub">
                    {f.conta} · {ROTULO_NATUREZA[f.natureza]}
                    {f.natureza === "automatica" ? (f.agendada ? " · agendada" : " · SEM agendamento") : ""}
                  </span>
                </td>
                <td style={{ maxWidth: 300, fontSize: 12.5 }}>{f.alimenta}</td>
                <td>{f.ultimoDadoEm ? dataCurta(f.ultimoDadoEm) : <span className="cert-hachura">nunca</span>}</td>
                {/* A coluna que faltava. Sem ela, "sync quebrada" e "banco sem
                    movimento" têm a mesma cara. */}
                <td style={{ fontSize: 12.5 }}>{quando(f.ultimaTentativaEm)}</td>
                <td style={{ fontVariantNumeric: "tabular-nums" }}>{atrasoTexto(f)}</td>
                <td style={{ fontVariantNumeric: "tabular-nums" }}>
                  {f.toleranciaUtil === null ? (
                    <span className="cert-hachura" title={f.motivo ?? undefined}>
                      não declarada
                    </span>
                  ) : (
                    `${f.toleranciaUtil} útil${f.toleranciaUtil === 1 ? "" : "eis"}`
                  )}
                </td>
                <td>
                  <SeloCamada camada={selo.camada} texto={selo.texto} />
                  {f.motivo && f.estado !== "em_dia" ? (
                    <span className="fin-desc-sub" style={{ maxWidth: 320, display: "block" }}>
                      {f.motivo}
                    </span>
                  ) : null}
                </td>
                <td>
                  {f.atualizavel ? (
                    <button
                      type="button"
                      className="fin-btn-ghost fin-btn-mini"
                      disabled={rodando || disparando !== null}
                      onClick={() => sincronizar(f.fonte)}
                    >
                      {disparando === f.fonte ? "…" : "atualizar"}
                    </button>
                  ) : (
                    <span className="fin-desc-sub" style={{ maxWidth: 260, display: "block" }}>
                      {f.motivoNaoAtualizavel}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="fin-card-hint">
        {foraDaTolerancia.length === 0 ? (
          <>
            Nenhuma fonte automática está fora da tolerância dela. O atraso é contado em{" "}
            <strong>dias úteis</strong> — sábado, domingo e feriado nacional não contam contra a
            fonte, porque o banco não lança neles. Feriados conferidos:{" "}
            {dado.anosDeCalendario.join(", ") || "nenhum ano"}.
          </>
        ) : (
          <>
            {foraDaTolerancia.length} fonte(s) fora da tolerância. O atraso é em dias úteis; feriados
            conferidos em {dado.anosDeCalendario.join(", ") || "nenhum ano"}.
          </>
        )}
      </p>

      {dado.ultimasExecucoes.length ? (
        <details style={{ marginTop: 18 }}>
          <summary style={{ cursor: "pointer", fontSize: 13 }}>
            Últimas {dado.ultimasExecucoes.length} sincronizações
          </summary>
          <div style={{ marginTop: 10 }}>
            {dado.ultimasExecucoes.map((x) => (
              <Execucao key={x.id} x={x} />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

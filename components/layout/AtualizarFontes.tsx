"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  BarraProgresso,
  ListaEtapas,
  desfecho,
  duracao,
  textoDaReferencia,
  textoDoProgresso,
  useDecorrido,
  useMontado
} from "@/components/financeiro/SyncProgresso";
import type { ExecucaoSync, ReferenciaSync } from "@/lib/financeiro/contratos/fontes";

/**
 * O botão de atualizar, ao lado da idade do dado, no cabeçalho.
 *
 * ===========================================================================
 * O PEDIDO, E ONDE ELE PEDIU QUE FICASSE
 * ===========================================================================
 * "Quero tbm na interface ao lado do local onde informa a ultima atualização
 *  quero que tenha um botão de atualizar que mostra tempo de atualizaçao e
 *  percentual atualizado (assim se usuario mover algo das contas, pode apertar
 *  para atualizar as bases de dados)"
 *
 * Três exigências, e a terceira é a que decide o lugar: *se o usuário mover
 * algo das contas*. Quem acabou de mexer no banco não está em
 * `/financeiro/fontes` — está em qualquer tela, olhando um número que sabe estar
 * velho. Um botão que só existe na tela de fontes exige que ele saiba que
 * aquela tela existe e navegue até lá. Por isso ele vive na moldura, do lado do
 * carimbo de idade, e a tela de fontes continua com o dela para o caso por
 * fonte.
 *
 * ===========================================================================
 * O QUE ESTE BOTÃO ATUALIZA — E O QUE ELE NÃO ATUALIZA
 * ===========================================================================
 * Ele roda o pipeline financeiro: Asaas e Inter, mais a fila e as notificações.
 * Ele NÃO atualiza o instantâneo de CRM (Pipedrive/Meta/Chatwoot) que o
 * `DataFreshness` ao lado carimba. Isso está dito no rótulo e no painel, porque
 * a alternativa — deixar implícito — produziria a decepção previsível de clicar,
 * esperar quatro minutos e ver "Dados de há 2 dias" intacto ao lado.
 *
 * ===========================================================================
 * SÓ ADMIN, E POR CONSTRUÇÃO
 * ===========================================================================
 * `AppShell` só monta este componente para o perfil admin. Não é esconder um
 * botão: `/api/financeiro/*` devolve **404** para o perfil comum (não 403), e um
 * botão que sempre responde 404 seria um alarme que não age — o defeito que esta
 * frente inteira veio consertar.
 *
 * ===========================================================================
 * O PERCENTUAL É CONTAGEM DE ETAPAS, NUNCA RELÓGIO
 * ===========================================================================
 * Ver `components/financeiro/SyncProgresso.tsx`. A duração da última execução
 * bem-sucedida aparece ao lado, como referência, e nunca dentro do percentual.
 */

type EstadoDoBotao = {
  execucaoCorrente: ExecucaoSync | null;
  ultimaExecucao: ExecucaoSync | null;
  referencia: ReferenciaSync | null;
  fontesAtualizaveis: string[];
  indisponivel?: string;
};

const ROTA = "/api/financeiro/gerencial/fontes/sincronizar";

/** O intervalo do polling. 3s é o mesmo de `/financeiro/fontes`. */
const PASSO_MS = 3000;

export function AtualizarFontes() {
  const router = useRouter();
  const montado = useMontado();

  const [estado, setEstado] = useState<EstadoDoBotao | null>(null);
  const [execucao, setExecucao] = useState<ExecucaoSync | null>(null);
  const [aberto, setAberto] = useState(false);
  const [disparando, setDisparando] = useState(false);
  const [recusa, setRecusa] = useState<string | null>(null);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const caixa = useRef<HTMLDivElement | null>(null);

  const decorrido = useDecorrido(execucao);

  const lerEstado = useCallback(async () => {
    try {
      const r = await fetch(ROTA, { cache: "no-store" });
      // 404 = perfil comum (o middleware nega assim, de propósito). Não é erro
      // a reportar: o botão simplesmente não existe para quem não alcança.
      if (r.status === 404) return;
      const corpo = (await r.json()) as EstadoDoBotao;
      setEstado(corpo);
      setExecucao((atual) => atual ?? corpo.execucaoCorrente ?? null);
    } catch {
      // Cabeçalho não pode quebrar a página por causa de rede. Sem estado o
      // botão fica com o rótulo neutro e ainda dispara.
    }
  }, []);

  useEffect(() => {
    void lerEstado();
  }, [lerEstado]);

  /**
   * O polling, que para sozinho quando a execução termina.
   *
   * Ao terminar ele faz `router.refresh()`: os números das telas são renderizados
   * no servidor, e uma sync que corrige o dado e deixa a tela mostrando o valor
   * de antes é a mesma mentira do alarme que não some depois de resolvido.
   */
  useEffect(() => {
    if (!execucao || execucao.status !== "rodando") return;
    let vivo = true;

    const passo = async () => {
      try {
        const r = await fetch(`${ROTA}?execucao=${execucao.id}`, { cache: "no-store" });
        if (r.ok && vivo) {
          const e = (await r.json()) as ExecucaoSync;
          setExecucao(e);
          if (e.status !== "rodando") {
            // Falha e sucesso parcial ficam abertos: quem clicou precisa ler
            // qual fonte falhou. Sucesso limpo não precisa roubar a tela.
            if (e.status !== "ok") setAberto(true);
            await lerEstado();
            router.refresh();
            return;
          }
        }
      } catch {
        // Rede caindo no meio não pode apagar o que já se sabe da execução.
      }
      if (vivo) timer.current = setTimeout(passo, PASSO_MS);
    };

    timer.current = setTimeout(passo, 1500);
    return () => {
      vivo = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [execucao, lerEstado, router]);

  /** Fecha o painel ao clicar fora — ele cobre conteúdo. */
  useEffect(() => {
    if (!aberto) return;
    const fora = (ev: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(ev.target as Node)) setAberto(false);
    };
    const esc = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setAberto(false);
    };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [aberto]);

  async function sincronizar() {
    setDisparando(true);
    setRecusa(null);
    setAberto(true);
    try {
      const r = await fetch(ROTA, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fonte: "todas" })
      });
      const corpo = await r.json();

      if (r.status === 202) {
        // Otimista, com o plano ainda vazio: `planoPresumido` faz a tela dizer
        // "iniciando…" em vez de 0% de um denominador que ela não tem.
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

      // 409: já havia uma rodando. Passar a acompanhar AQUELA é o que o segundo
      // clique queria; a trava é o índice único do banco, não uma flag daqui.
      if (r.status === 409 && corpo.execucaoId) {
        const j = await fetch(`${ROTA}?execucao=${corpo.execucaoId}`, { cache: "no-store" });
        if (j.ok) setExecucao((await j.json()) as ExecucaoSync);
        setRecusa(
          `Já havia uma sincronização em andamento (iniciada por ${corpo.iniciadaPor ?? "alguém"}). Acompanhando ela.`
        );
        return;
      }

      setRecusa(
        `${corpo.erro ?? `não consegui disparar (HTTP ${r.status})`}${corpo.motivo ? ` — ${corpo.motivo}` : ""}`
      );
    } catch (e) {
      setRecusa(`não consegui falar com o servidor: ${(e as Error).message}`);
    } finally {
      setDisparando(false);
    }
  }

  const rodando = execucao?.status === "rodando";
  const indisponivel = estado?.indisponivel ?? null;
  const alcance = estado?.fontesAtualizaveis ?? [];
  const ultima = execucao ?? estado?.ultimaExecucao ?? null;
  const fecho = ultima && ultima.status !== "rodando" ? desfecho(ultima) : null;

  // O selo ao lado do botão quando parado: como terminou a última. Um botão que
  // não diz nada sobre a última vez obriga a clicar para descobrir.
  const marca =
    fecho?.tom === "erro" ? "is-erro" : fecho?.tom === "parcial" || fecho?.tom === "duvida" ? "is-parcial" : "";

  return (
    <div className={`sync-botao${rodando ? " is-rodando" : ""}`} ref={caixa}>
      <button
        type="button"
        className={`sync-botao-acao ${marca}`}
        // Desabilitado enquanto roda: a trava real é o índice único do banco,
        // mas deixar clicável para receber 409 seria oferecer uma ação que não
        // faz o que aparenta.
        disabled={rodando || disparando || indisponivel !== null}
        onClick={sincronizar}
        aria-label="Atualizar as bases financeiras"
        title={
          indisponivel
            ? `indisponível: ${indisponivel}`
            : rodando
              ? `sincronizando — ${textoDoProgresso(execucao)}`
              : `Roda o mesmo pipeline do agendador: ${alcance.join(", ") || "nenhuma fonte alcançada"}.\n` +
                `Não atualiza o instantâneo de CRM do carimbo ao lado.\n` +
                textoDaReferencia(estado?.referencia ?? null)
        }
      >
        <span className={`sync-icone${rodando ? " gira" : ""}`} aria-hidden>
          ↻
        </span>
        <span className="sync-rotulo">
          {rodando && montado
            ? `${execucao.progresso.planoPresumido ? "iniciando" : `${execucao.progresso.pct}%`} · ${duracao(decorrido)}`
            : disparando
              ? "disparando…"
              : "Atualizar"}
        </span>
      </button>

      {/* O detalhe fica atrás de um botão próprio: no cabeçalho, espaço é o
          recurso escasso, e "menos é mais" foi pedido explicitamente. */}
      <button
        type="button"
        className="sync-botao-detalhe"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        aria-label={aberto ? "Fechar detalhe da sincronização" : "Ver detalhe da sincronização"}
      >
        {aberto ? "▴" : "▾"}
      </button>

      {aberto ? (
        <div className="sync-painel" role="dialog" aria-label="Sincronização das fontes">
          <p className="sync-painel-titulo">
            Bases financeiras
            <Link href="/financeiro/fontes" onClick={() => setAberto(false)}>
              ver por fonte
            </Link>
          </p>

          {indisponivel ? (
            <p className="sync-painel-nota is-alerta">{indisponivel}</p>
          ) : (
            <p className="sync-painel-nota">
              Roda o pipeline do agendador para <strong>{alcance.join(", ") || "nenhuma fonte"}</strong>.
              Não atualiza o instantâneo de CRM do carimbo ao lado.
            </p>
          )}

          {recusa ? <p className="sync-painel-nota is-alerta">{recusa}</p> : null}

          {execucao ? (
            <>
              <div className="sync-painel-linha">
                <strong>{textoDoProgresso(execucao)}</strong>
                <span>{montado ? duracao(decorrido) : duracao(execucao.progresso.decorridoMs)}</span>
              </div>
              <BarraProgresso x={execucao} />
              {execucao.progresso.nomeEtapaAtual ? (
                <p className="sync-painel-nota">
                  agora: {execucao.progresso.nomeEtapaAtual}
                  {execucao.progresso.etapaAtualMs !== null
                    ? ` · há ${duracao(execucao.progresso.etapaAtualMs)}`
                    : ""}
                </p>
              ) : null}
              <ListaEtapas etapas={execucao.etapas} compacta />
            </>
          ) : null}

          {fecho ? (
            <p className={`sync-painel-desfecho is-${fecho.tom}`}>
              <strong>
                {fecho.tom === "ok"
                  ? "Concluída: "
                  : fecho.tom === "duvida"
                    ? "Não se sabe como terminou: "
                    : fecho.tom === "parcial"
                      ? "Parcial: "
                      : "Falhou: "}
              </strong>
              {fecho.texto}
            </p>
          ) : null}

          <p className="sync-painel-nota">{textoDaReferencia(estado?.referencia ?? null)}</p>
        </div>
      ) : null}
    </div>
  );
}

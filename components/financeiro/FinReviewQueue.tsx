"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type { FilaRevisao, ItemRevisao, OpcoesClassificacao } from "@/lib/financeiro/revisao";
import { brlCents, brlPrecise, dateLabel, pct } from "@/lib/financeiro/format";

type Props = {
  fila: FilaRevisao;
  opcoes: OpcoesClassificacao;
};

const ROTULO_MOTIVO: Record<string, string> = {
  texto_generico: "sem descrição útil",
  sem_categoria: "sem categoria",
  baixa_confianca: "confiança baixa",
  sem_documento: "sem cobrança ligada",
  divergencia_valor: "valor divergente",
  possivel_nao_receita: "talvez não seja receita",
  saida_nao_planejada: "saída não planejada",
  lancamento_avulso: "lançamento avulso"
};

/**
 * A fila de revisão.
 *
 * Em termos de TOC isto é inventário invisível: uma pilha de decisões não
 * tomadas com valor mensurável em reais. Por isso a ordenação é por R$ e não por
 * data — as primeiras ~100 decisões cobrem a maior parte do montante.
 *
 * Três coisas fazem a fila esvaziar em vez de crescer:
 *
 *  · SUGESTÃO DE UM CLIQUE. O histórico da contraparte já sabe a resposta na
 *    maioria dos casos ("92% das cobranças deste cliente são 3.06"). Aceitar é
 *    um clique, não um formulário.
 *  · SELEÇÃO MÚLTIPLA. Trinta cobranças do mesmo cliente se resolvem juntas.
 *  · A DECISÃO GRUDA. Cada aplicação trava a coluna em human_locked_fields, e o
 *    sync noturno passa a respeitá-la — sem isso a fila voltaria ao tamanho
 *    original toda madrugada.
 */
export function FinReviewQueue({ fila, opcoes }: Props) {
  const router = useRouter();
  const [pendente, startTransition] = useTransition();
  const [selecao, setSelecao] = useState<Set<string>>(new Set());
  const [categoriaLote, setCategoriaLote] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");

  const chave = (item: ItemRevisao) => `${item.targetTable}:${item.targetId}`;

  const itens = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return fila.itens;
    return fila.itens.filter((item) =>
      `${item.descricao} ${item.contraparte ?? ""}`.toLowerCase().includes(termo)
    );
  }, [fila.itens, busca]);

  const totalFila = fila.pendentes.valorCents + fila.resolvidos.valorCents;
  const progresso = totalFila ? (fila.resolvidos.valorCents / totalFila) * 100 : 100;

  async function aplicar(alvos: { table: string; id: number }[], categoryCode: string, nucleo?: string | null) {
    setErro(null);
    const resposta = await fetch("/api/financeiro/revisao/lote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targets: alvos, categoryCode, nucleo: nucleo ?? undefined })
    });
    if (!resposta.ok) {
      const corpo = await resposta.json().catch(() => ({}));
      setErro(corpo.error ?? `falha ao aplicar (HTTP ${resposta.status})`);
      return;
    }
    setSelecao(new Set());
    startTransition(() => router.refresh());
  }

  if (!fila.disponivel) {
    return (
      <section className="card fin-empty">
        <h2 className="card-title">Fila indisponível</h2>
        <p>Sem conexão com o banco do financeiro. O resto da plataforma segue funcionando.</p>
      </section>
    );
  }

  if (!fila.itens.length) {
    return (
      <section className="card fin-queue-done">
        <h2 className="card-title">Fila zerada</h2>
        <p>
          Todo lançamento e toda cobrança têm categoria. {brlCents(fila.resolvidos.valorCents)} classificados em{" "}
          {fila.resolvidos.itens.toLocaleString("pt-BR")} itens.
        </p>
      </section>
    );
  }

  return (
    <>
      <section className="card fin-queue-head">
        <div>
          <h2 className="card-title">
            {fila.pendentes.itens.toLocaleString("pt-BR")} itens aguardando · {brlCents(fila.pendentes.valorCents)}
          </h2>
          <p className="fin-card-hint">
            Ordenado por valor. As primeiras decisões cobrem a maior parte do montante — não precisa chegar ao fim
            para o número ficar confiável.
          </p>
        </div>
        <div className="fin-queue-progress" role="img" aria-label={`${pct(progresso, 0)} do valor já classificado`}>
          <span style={{ width: `${Math.min(100, progresso)}%` }} />
        </div>
        <p className="fin-queue-progress-label">
          {brlCents(fila.resolvidos.valorCents)} já resolvidos de {brlCents(totalFila)} ({pct(progresso, 0)})
        </p>
      </section>

      {erro ? (
        <div className="fin-alert" role="alert">
          {erro}
        </div>
      ) : null}

      <section className="card">
        <div className="fin-filters">
          <input
            type="search"
            className="fin-input"
            placeholder="Filtrar por descrição ou cliente…"
            value={busca}
            onChange={(evento) => setBusca(evento.target.value)}
            aria-label="Filtrar a fila"
          />
        </div>

        {selecao.size ? (
          <div className="fin-bulk-bar">
            <strong>{selecao.size} selecionados</strong>
            <select
              className="fin-select"
              value={categoriaLote}
              onChange={(evento) => setCategoriaLote(evento.target.value)}
              aria-label="Categoria para aplicar em lote"
            >
              <option value="">Escolha a categoria…</option>
              {opcoes.categorias.map((categoria) => (
                <option key={categoria.code} value={categoria.code}>
                  {categoria.code} · {categoria.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="fin-btn-primary"
              disabled={!categoriaLote || pendente}
              onClick={() => {
                const alvos = fila.itens
                  .filter((item) => selecao.has(chave(item)))
                  .map((item) => ({ table: item.targetTable, id: item.targetId }));
                void aplicar(alvos, categoriaLote);
              }}
            >
              Aplicar aos {selecao.size}
            </button>
            <button type="button" className="fin-btn-ghost" onClick={() => setSelecao(new Set())}>
              Limpar
            </button>
          </div>
        ) : null}

        <ul className="fin-queue-list">
          {itens.map((item) => {
            const id = chave(item);
            const marcado = selecao.has(id);
            return (
              <li key={id} className={marcado ? "fin-queue-item marcado" : "fin-queue-item"}>
                <label className="fin-queue-check">
                  <input
                    type="checkbox"
                    checked={marcado}
                    onChange={() => {
                      const proxima = new Set(selecao);
                      if (proxima.has(id)) proxima.delete(id);
                      else proxima.add(id);
                      setSelecao(proxima);
                    }}
                    aria-label={`Selecionar ${item.descricao.slice(0, 40)}`}
                  />
                </label>

                <div className="fin-queue-body">
                  <p className="fin-queue-desc">{item.descricao}</p>
                  <p className="fin-queue-meta">
                    {dateLabel(item.data)}
                    {item.contraparte ? ` · ${item.contraparte}` : ""}
                    <span className="fin-tag">{ROTULO_MOTIVO[item.reason] ?? item.reason}</span>
                    {item.targetTable === "fin_transaction" ? <span className="fin-tag">extrato</span> : null}
                  </p>

                  <div className="fin-queue-actions">
                    {item.sugestoes.slice(0, 3).map((sugestao) => (
                      <button
                        key={sugestao.code}
                        type="button"
                        className="fin-btn-suggestion"
                        disabled={pendente}
                        onClick={() =>
                          void aplicar(
                            [{ table: item.targetTable, id: item.targetId }],
                            sugestao.code,
                            sugestao.nucleo
                          )
                        }
                        title={`${sugestao.n} cobranças desta contraparte já estão em ${sugestao.code}`}
                      >
                        {sugestao.code} {sugestao.name}
                        <em>{pct(sugestao.share, 0)}</em>
                      </button>
                    ))}

                    <select
                      className="fin-select fin-select-inline"
                      defaultValue=""
                      disabled={pendente}
                      aria-label="Escolher categoria manualmente"
                      onChange={(evento) => {
                        if (!evento.target.value) return;
                        void aplicar([{ table: item.targetTable, id: item.targetId }], evento.target.value);
                      }}
                    >
                      <option value="">outra categoria…</option>
                      {opcoes.categorias.map((categoria) => (
                        <option key={categoria.code} value={categoria.code}>
                          {categoria.code} · {categoria.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <p className={item.amountCents >= 0 ? "fin-queue-valor fin-in" : "fin-queue-valor fin-out"}>
                  {brlPrecise(item.amountCents)}
                </p>
              </li>
            );
          })}
        </ul>

        {!itens.length ? <p className="fin-empty-row">Nenhum item com esse filtro.</p> : null}
      </section>
    </>
  );
}

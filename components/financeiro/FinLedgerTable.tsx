"use client";

import { useMemo, useState } from "react";

import type { Lancamento } from "@/lib/financeiro/queries";
import { brlPrecise, dateLabel } from "@/lib/financeiro/format";

type Props = {
  lancamentos: Lancamento[];
  /** true quando a origem não respondeu — diferente de extrato vazio. */
  indisponivel?: boolean;
  contas: { slug: string; name: string }[];
  nucleos: { slug: string; name: string }[];
  /** Vem de ?semCategoria=1 — o link do painel de qualificação. */
  inicialSemCategoria?: boolean;
  inicialBusca?: string;
};

/**
 * O extrato — a tela onde se passa mais tempo.
 *
 * Duas decisões de uso que valem explicar:
 *
 * 1. TRANSFERÊNCIAS FICAM OCULTAS por padrão. São 372 linhas e R$ 3,82 milhões
 *    que não são receita nem despesa: é a empresa movendo dinheiro do Asaas para
 *    os outros bancos. Deixá-las visíveis por padrão faz o extrato parecer o
 *    dobro do que é. O botão existe porque quando se procura "onde foi parar o
 *    dinheiro", são exatamente elas que se quer ver.
 *
 * 2. TODA LINHA CLASSIFICADA TEM "por quê?". Mostra qual regra casou, em que
 *    trecho do texto, e quais outras regras casaram e perderam na prioridade.
 *    É essa interação que faz alguém confiar na classificação em vez de
 *    reconferir tudo à mão — e foi ela que revelou que uma regra de "medição"
 *    estava capturando transferências, porque a razão social da empresa contém
 *    "MEDICAO".
 */
export function FinLedgerTable({
  lancamentos,
  contas,
  nucleos,
  inicialSemCategoria = false,
  inicialBusca = "",
  indisponivel = false
}: Props) {
  const [busca, setBusca] = useState(inicialBusca);
  const [conta, setConta] = useState("");
  const [nucleo, setNucleo] = useState("");
  const [somenteSemCategoria, setSomenteSemCategoria] = useState(inicialSemCategoria);
  const [mostrarTransferencias, setMostrarTransferencias] = useState(false);
  const [porQueAberto, setPorQueAberto] = useState<number | null>(null);

  // Filtro no cliente: são no máximo 500 linhas já carregadas, e filtrar aqui é
  // instantâneo. Passar de volta ao servidor a cada tecla tornaria a busca
  // perceptivelmente lenta sem ganho nenhum nesse volume.
  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return lancamentos.filter((linha) => {
      if (!mostrarTransferencias && linha.transferStatus !== "nao") return false;
      if (conta && linha.conta !== conta) return false;
      if (nucleo && linha.nucleo !== nucleo) return false;
      if (somenteSemCategoria && linha.categoria) return false;
      if (termo) {
        const alvo = `${linha.descricao} ${linha.contraparte ?? ""} ${linha.categoria ?? ""}`.toLowerCase();
        if (!alvo.includes(termo)) return false;
      }
      return true;
    });
  }, [lancamentos, busca, conta, nucleo, somenteSemCategoria, mostrarTransferencias]);

  const total = filtrados.reduce((sum, linha) => sum + linha.amountCents, 0);
  const entradas = filtrados.filter((l) => l.amountCents > 0).reduce((s, l) => s + l.amountCents, 0);
  const saidas = filtrados.filter((l) => l.amountCents < 0).reduce((s, l) => s + l.amountCents, 0);

  return (
    <section className="card">
      <div className="fin-filters">
        <input
          type="search"
          className="fin-input"
          placeholder="Buscar descrição, cliente ou categoria…"
          value={busca}
          onChange={(event) => setBusca(event.target.value)}
          aria-label="Buscar lançamentos"
        />
        <select className="fin-select" value={conta} onChange={(e) => setConta(e.target.value)} aria-label="Conta">
          <option value="">Todas as contas</option>
          {contas.map((item) => (
            <option key={item.slug} value={item.name}>
              {item.name}
            </option>
          ))}
        </select>
        <select className="fin-select" value={nucleo} onChange={(e) => setNucleo(e.target.value)} aria-label="Núcleo">
          <option value="">Todos os núcleos</option>
          {nucleos.map((item) => (
            <option key={item.slug} value={item.slug}>
              {item.name}
            </option>
          ))}
        </select>
        <label className="fin-check">
          <input
            type="checkbox"
            checked={somenteSemCategoria}
            onChange={(e) => setSomenteSemCategoria(e.target.checked)}
          />
          Só sem categoria
        </label>
        <label className="fin-check">
          <input
            type="checkbox"
            checked={mostrarTransferencias}
            onChange={(e) => setMostrarTransferencias(e.target.checked)}
          />
          Mostrar transferências
        </label>
      </div>

      {/* A soma só é afirmada quando houve o que somar. Com a origem fora do
          ar, "0 lançamentos · R$ 0,00" seria uma afirmação sobre o dinheiro —
          e o que se sabe é sobre o dado. Aconteceu de verdade: a tela disse
          zero sobre 13.882 lançamentos que estavam no banco. */}
      {indisponivel ? (
        <p className="fin-filters-summary fin-indisponivel">
          <strong>indeterminado</strong> — a origem dos lançamentos não respondeu.
          Isto não significa extrato vazio; significa que não foi possível medir.
        </p>
      ) : (
        <p className="fin-filters-summary">
          <strong>{filtrados.length.toLocaleString("pt-BR")}</strong> lançamentos · entradas{" "}
          <strong className="fin-in">{brlPrecise(entradas)}</strong> · saídas{" "}
          <strong className="fin-out">{brlPrecise(saidas)}</strong> · líquido <strong>{brlPrecise(total)}</strong>
        </p>
      )}

      <div className="table-wrap">
        <table className="fin-table fin-ledger">
          <thead>
            <tr>
              <th>Data</th>
              <th>Descrição</th>
              <th>Categoria</th>
              <th>Núcleo</th>
              <th className="num">Valor</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.map((linha) => (
              <tr key={linha.id} className={linha.transferStatus !== "nao" ? "fin-row-transfer" : undefined}>
                <td className="fin-nowrap">{dateLabel(linha.postedOn)}</td>
                <td>
                  <span className="fin-desc">{linha.descricao}</span>
                  {linha.contraparte ? <span className="fin-desc-sub">{linha.contraparte}</span> : null}
                  {linha.transferStatus === "em_transito" ? (
                    <span className="fin-tag" title="Saiu desta conta e ainda não foi vista chegando na outra. Não conta como receita nem despesa.">
                      em trânsito
                    </span>
                  ) : null}
                </td>
                <td>
                  {linha.categoria ? (
                    <span className="fin-cat">
                      <span className="fin-code">{linha.categoriaCode}</span> {linha.categoria}
                      {linha.porQue ? (
                        <button
                          type="button"
                          className="fin-why"
                          onClick={() => setPorQueAberto(porQueAberto === linha.id ? null : linha.id)}
                          aria-expanded={porQueAberto === linha.id}
                        >
                          por quê?
                        </button>
                      ) : null}
                    </span>
                  ) : (
                    <span className="fin-badge-pendente">sem categoria</span>
                  )}
                  {porQueAberto === linha.id && linha.porQue ? <PorQue dados={linha.porQue} /> : null}
                </td>
                <td>{linha.nucleo ?? "—"}</td>
                <td className={linha.amountCents >= 0 ? "num fin-table-money fin-in" : "num fin-table-money fin-out"}>
                  {brlPrecise(linha.amountCents)}
                </td>
              </tr>
            ))}
            {!filtrados.length ? (
              <tr>
                <td colSpan={5} className="fin-empty-row">
                  Nenhum lançamento com esses filtros.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** O popover que responde "por que isto caiu nesta categoria". */
function PorQue({ dados }: { dados: Record<string, unknown> }) {
  const regra = dados.regra as string | undefined;
  const trecho = dados.trecho as string | undefined;
  const prioridade = dados.prioridade as number | undefined;
  const competidores = (dados.tambem_casaram ?? []) as { name?: string; priority?: number }[];

  return (
    <div className="fin-why-popover" role="note">
      <p>
        Regra <strong>{regra ?? "—"}</strong>
        {prioridade !== undefined ? ` (prioridade ${prioridade})` : ""}
      </p>
      {trecho ? (
        <p>
          Casou em <mark>{trecho}</mark>
        </p>
      ) : null}
      {competidores.length ? (
        <p className="fin-why-losers">
          Também casaram e perderam: {competidores.map((c) => `${c.name ?? "?"} (${c.priority ?? "?"})`).join(", ")}
        </p>
      ) : null}
    </div>
  );
}

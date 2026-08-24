"use client";

import { type PointerEvent, type ReactNode, type RefObject, useEffect, useRef } from "react";

import { brl } from "@/components/financeiro/Certeza";
import {
  CLASSE,
  ROTULO,
  mesCurto,
  nomeMesTitulo,
  plural,
  type Recebiveis as DadoRecebiveis
} from "@/components/time/recebiveis-dado";

/** Coluna do gráfico empilhado — real ou prevista. */
export type ColunaPlot = {
  mes: string;
  porNatureza: Record<string, number>;
  totalCents: number;
  previsto: boolean;
};

export type FocoPlot = { mes: string; nat: string | null } | null;

/** O nome do item, sem o resíduo da planilha. */
export function nomeDoItem(descricao: string, alternativa: string) {
  return descricao.replace(/[\s-]*\d+\s*\/\s*\d+\s*$/, "").replace(/[\s\-–—]+$/, "").trim() || alternativa;
}

/** Gasto de M é reembolsado em M+1 — mesma regra da view 0163 e da folha. */
export function competenciaDe(mes: string) {
  const [a, m] = mes.split("-").map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;
}

type ItemGrafico = { nome: string; detalhe?: string; valorCents: number };
type GrupoGrafico = { natureza: string; rotulo: string; totalCents: number; itens: ItemGrafico[] };

export function calcLegenda(janela: ColunaPlot[]) {
  const m = new Map<string, { cents: number; n: number }>();
  for (const mes of janela) {
    for (const [nat, v] of Object.entries(mes.porNatureza)) {
      const a = m.get(nat) ?? { cents: 0, n: 0 };
      m.set(nat, { cents: a.cents + v, n: a.n + 1 });
    }
  }
  return [...m.entries()]
    .map(([natureza, v]) => ({ natureza, ...v }))
    .sort((a, b) => b.cents - a.cents);
}

function gruposDoMes(
  dado: DadoRecebiveis,
  mes: string,
  porNatureza: Record<string, number>,
  natFoco: string | null,
  ocultas: Set<string>
): GrupoGrafico[] {
  const naturezas = (natFoco ? [natFoco] : Object.keys(porNatureza)).filter((n) => !ocultas.has(n));
  return naturezas
    .map((natureza) => {
      const totalCents = porNatureza[natureza] ?? 0;
      if (natureza === "reembolso") {
        const reemb = (dado.reembolsoPorCompetencia ?? []).find((c) => c.competencia === competenciaDe(mes));
        const itens =
          reemb?.itens.map((it) => ({
            nome: nomeDoItem(it.descricao, it.descricao),
            detalhe:
              it.parcelasTotal && it.parcelasTotal > 1
                ? `parcela ${it.parcela} de ${it.parcelasTotal}`
                : undefined,
            valorCents: it.valorCents
          })) ??
          dado.linhas
            .filter((l) => l.mes === mes && l.natureza === natureza)
            .map((l) => ({
              nome: l.descricao || l.conta,
              detalhe: `${l.data.slice(8, 10)}/${l.data.slice(5, 7)}`,
              valorCents: l.valorCents
            }));
        return { natureza, rotulo: ROTULO[natureza] ?? natureza, totalCents, itens };
      }
      const itens = dado.linhas
        .filter((l) => l.mes === mes && l.natureza === natureza)
        .map((l) => ({
          nome: l.descricao || l.conta,
          detalhe: `${l.data.slice(8, 10)}/${l.data.slice(5, 7)}`,
          valorCents: l.valorCents
        }));
      return { natureza, rotulo: ROTULO[natureza] ?? natureza, totalCents, itens };
    })
    .filter((g) => g.totalCents > 0);
}

function gruposPrevistos(porNatureza: Record<string, number>, natFoco: string | null): GrupoGrafico[] {
  const naturezas = natFoco ? [natFoco] : Object.keys(porNatureza);
  return naturezas
    .map((natureza) => {
      const totalCents = porNatureza[natureza] ?? 0;
      return {
        natureza,
        rotulo: ROTULO[natureza] ?? natureza,
        totalCents,
        itens: totalCents > 0 ? [{ nome: "Previsto", valorCents: totalCents }] : []
      };
    })
    .filter((g) => g.totalCents > 0);
}

export function IconePrevisao() {
  return (
    <svg className="rec-plot-icone" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 19V11" />
      <path d="M9 19V8" />
      <path d="M14 19V5" />
      <path d="M19 19v-7" strokeDasharray="2.5 2.5" />
    </svg>
  );
}

/**
 * Um gráfico, duas alturas — compacto e expandido compartilham o mesmo
 * comportamento: toque no mês, toque na banda, legenda-filtro e painel item a item.
 */
export function RecebiveisPlot({
  dado,
  colunas,
  mesesLegenda,
  ocultas,
  alternar,
  foco,
  onFoco,
  cabeca,
  trilhoRef,
  rolagem = false,
  ariaDescricao
}: {
  dado: DadoRecebiveis;
  colunas: ColunaPlot[];
  mesesLegenda: ColunaPlot[];
  ocultas: Set<string>;
  alternar: (nat: string) => void;
  foco: FocoPlot;
  onFoco: (f: FocoPlot) => void;
  cabeca?: ReactNode;
  trilhoRef?: RefObject<HTMLDivElement | null>;
  rolagem?: boolean;
  ariaDescricao: string;
}) {
  const trilhoLocal = useRef<HTMLDivElement | null>(null);
  const trilho = trilhoRef ?? trilhoLocal;

  useEffect(() => {
    if (!rolagem) return;
    const t = trilho.current;
    if (t) t.scrollLeft = Math.max(0, t.scrollWidth - t.clientWidth);
  }, [rolagem, colunas.length]);

  const teto = Math.max(...colunas.map((m) => m.totalCents), 1);
  const janelaLegenda = foco ? colunas.filter((m) => m.mes === foco.mes) : mesesLegenda;
  const legenda = calcLegenda(janelaLegenda);
  const colFoco = foco ? colunas.find((c) => c.mes === foco.mes) ?? null : null;
  const gruposFoco =
    colFoco && foco
      ? colFoco.previsto
        ? gruposPrevistos(colFoco.porNatureza, foco.nat)
        : gruposDoMes(dado, colFoco.mes, colFoco.porNatureza, foco.nat, ocultas)
      : [];

  const focarMes = (mes: string) =>
    onFoco(foco?.mes === mes && !foco.nat ? null : { mes, nat: null });

  const focarBanda = (mes: string, nat: string, e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onFoco(foco?.mes === mes && foco.nat === nat ? { mes, nat: null } : { mes, nat });
  };

  return (
    <>
      {cabeca}
      <div className="rec-plot-trilho" ref={trilho}>
        <div className="rec-grade" role="img" aria-label={`Recebido mês a mês. ${ariaDescricao}`}>
          {colunas.map((m) => (
            <button
              key={`${m.previsto ? "p" : "r"}-${m.mes}`}
              type="button"
              className={
                m.previsto
                  ? foco?.mes === m.mes
                    ? "rec-col rec-col-previsto ativa"
                    : "rec-col rec-col-previsto"
                  : foco?.mes === m.mes
                    ? "rec-col ativa"
                    : "rec-col"
              }
              aria-pressed={foco?.mes === m.mes}
              aria-label={`${nomeMesTitulo(m.mes)}: ${brl(m.totalCents)}${m.previsto ? " (previsto)" : ""}${Object.entries(m.porNatureza)
                .sort((a, b) => b[1] - a[1])
                .map(([nat, v]) => ` · ${ROTULO[nat] ?? nat} ${brl(v)}`)
                .join("")}`}
              onClick={() => focarMes(m.mes)}
            >
              <span className="rec-col-area">
                <span className="rec-pilha" style={{ height: `${(m.totalCents / teto) * 100}%` }}>
                  {Object.entries(m.porNatureza)
                    .sort((a, b) => b[1] - a[1])
                    .map(([nat, v]) => (
                      <i
                        key={nat}
                        className={`${CLASSE[nat] ?? "nat-encargo"}${foco?.mes === m.mes && foco.nat === nat ? " foco" : ""}`}
                        style={{ height: `${(v / m.totalCents) * 100}%` }}
                        onPointerDown={(e) => focarBanda(m.mes, nat, e)}
                      />
                    ))}
                </span>
              </span>
              <span className="rec-col-mes">{mesCurto(m.mes)}</span>
            </button>
          ))}
        </div>
      </div>
      {colFoco && foco ? (
        <div className="rec-plot-dica" role="status">
          <div className="rec-plot-dica-cabeca">
            <strong>
              {nomeMesTitulo(colFoco.mes)}
              {colFoco.previsto ? " · previsto" : ""}
            </strong>
            <b>{brl(colFoco.totalCents)}</b>
          </div>
          {gruposFoco.length === 0 ? (
            <p className="rec-plot-dica-vazio">Nada neste mês nas naturezas ligadas.</p>
          ) : (
            <ul className="rec-plot-dica-grupos">
              {gruposFoco.map((g) => (
                <li key={g.natureza}>
                  <div className="rec-plot-dica-nat">
                    <i className={`rec-ponto ${CLASSE[g.natureza] ?? "nat-encargo"}`} aria-hidden />
                    <span>{g.rotulo}</span>
                    <b>{brl(g.totalCents)}</b>
                  </div>
                  {g.itens.length > 0 ? (
                    <ul className="rec-plot-dica-itens">
                      {g.itens.map((it, k) => (
                        <li key={`${it.nome}-${k}`}>
                          <span className="rec-plot-dica-nome">
                            {it.nome}
                            {it.detalhe ? <small>{it.detalhe}</small> : null}
                          </span>
                          <b>{brl(it.valorCents)}</b>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <p className="rec-plot-dica-nota">
            {foco.nat
              ? `Só ${ROTULO[foco.nat] ?? foco.nat}. Toque na banda de novo para ver o mês inteiro.`
              : "Toque numa banda para ver só aquela natureza. Toque no mês de novo para fechar."}
          </p>
        </div>
      ) : (
        <p className="rec-plot-nota" role="status">
          Toque num mês para ver cada pagamento. Toque numa banda para focar numa natureza.
        </p>
      )}
      <ul className="rec-legenda rec-legenda-filtro">
        {dado.porNatureza.map((n) => {
          const dentro = legenda.find((l) => l.natureza === n.natureza);
          const liga = !ocultas.has(n.natureza);
          return (
            <li key={n.natureza}>
              <button type="button" aria-pressed={liga} onClick={() => alternar(n.natureza)}>
                <i className={`rec-ponto ${CLASSE[n.natureza] ?? "nat-encargo"}${liga ? "" : " vazado"}`} />
                <span>{ROTULO[n.natureza] ?? n.natureza}</span>
                <b>{liga ? brl(dentro?.cents ?? 0) : "—"}</b>
                <em>{liga ? plural(dentro?.n ?? 0, "mês", "meses") : "oculto"}</em>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

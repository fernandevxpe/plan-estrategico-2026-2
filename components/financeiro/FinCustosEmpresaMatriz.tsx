"use client";

import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type Dispatch,
  type ReactNode,
  type SetStateAction
} from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, CircleDashed, Cpu, Hammer, House, Layers, Search, X } from "lucide-react";

import { buscarCustos, passaBusca, type HitBusca } from "@/lib/financeiro/custo-empresa-busca";

import {
  chaveAgrupamentoCusto,
  chaveCusto,
  CLASSES,
  COR_CLASSE,
  COR_TIME,
  destinosTime,
  nomeAgrupadoCusto,
  ORDEM_TIME,
  ROTULO_CLASSE,
  ROTULO_TIME,
  type ClasseCusto
} from "@/lib/financeiro/custo-empresa-eixos";
import {
  PARTES,
  parteDaSubparte,
  rotuloSubparte,
  subparteCustoDe,
  subparteExibida,
  subpartesVisiveis,
  type ParteCusto,
  type SubparteCusto
} from "@/lib/financeiro/custo-empresa-partes";
import type { CustosEmpresa, ItemCusto } from "@/lib/financeiro/custos-empresa";
import { brlPrecise, monthKeyLabel } from "@/lib/financeiro/format";
import {
  atribuirCents,
  destinosAreaEmpresa,
  SLUG_SEM_AREA,
  type FatiaCusto
} from "@/lib/financeiro/repartir-custo-area";

import { CelulaAreasCusto, CelulaTimeCusto, patchCustoVarios } from "./FinCustoEmpresaCelulas";
import { catalogoAreasEmpresa, corAreaEmpresa } from "./FinPessoaEditor";
import { FinPessoasCustoGraficos } from "./FinPessoasCustoGraficos";
import { FinSecaoColapsavel } from "./FinSecaoColapsavel";

type Ativos = Record<string, boolean>;

const DICA_CHIP = "Clique para ver só este. De novo para voltar todos.";

function estaLigado(ativos: Ativos, slug: string) {
  return ativos[slug] !== false;
}

function alternarGrupo(set: Dispatch<SetStateAction<Ativos>>, chave: string, todos: readonly string[]) {
  set((antes) => {
    const ligados = todos.filter((s) => estaLigado(antes, s));
    if (ligados.length === todos.length) {
      const prox: Ativos = { ...antes };
      for (const s of todos) prox[s] = s === chave;
      return prox;
    }
    if (ligados.length === 1 && ligados[0] === chave) {
      const prox: Ativos = { ...antes };
      for (const s of todos) prox[s] = true;
      return prox;
    }
    return { ...antes, [chave]: !estaLigado(antes, chave) };
  });
}

function textoBloco(sub: SubparteCusto): string {
  const visivel = subparteExibida(sub);
  const parte = PARTES.find((p) => p.slug === parteDaSubparte(visivel));
  return `${rotuloSubparte(visivel)} ${parte?.nome ?? ""}`;
}

function grupoEstreito(ativos: Ativos, todos: readonly string[]) {
  return todos.some((s) => !estaLigado(ativos, s));
}

function GrupoFiltro({
  rotulo,
  aberto,
  estreito,
  onToggle,
  children
}: {
  rotulo: string;
  aberto: boolean;
  estreito: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className={aberto ? "fin-pessoas-matriz-filtro-grupo aberto" : "fin-pessoas-matriz-filtro-grupo"}>
      <button
        type="button"
        className={aberto ? "fin-pessoas-matriz-grupo-cab aberto" : "fin-pessoas-matriz-grupo-cab"}
        aria-expanded={aberto}
        onClick={onToggle}
      >
        <span>
          {rotulo}
          {estreito ? <i>filtro</i> : null}
        </span>
        <span className="fin-pessoas-matriz-grupo-chevron" aria-hidden>
          <ChevronRight
            size={16}
            strokeWidth={2.2}
            className={aberto ? "fin-chevron-aberto" : undefined}
          />
        </span>
      </button>
      {aberto ? children : null}
    </div>
  );
}

function SubparteColapsavel({
  titulo,
  meta,
  forcarAberto = false,
  children
}: {
  titulo: string;
  meta: ReactNode;
  forcarAberto?: boolean;
  children: ReactNode;
}) {
  const [aberto, setAberto] = useState(true);
  const visivel = forcarAberto || aberto;
  return (
    <div className={visivel ? "fin-custo-subparte aberta" : "fin-custo-subparte"}>
      <h3 className="fin-custo-subparte-titulo">
        <button
          type="button"
          className={visivel ? "fin-custo-subparte-cab aberto" : "fin-custo-subparte-cab"}
          aria-expanded={visivel}
          onClick={() => setAberto((v) => !v)}
        >
          <span className="fin-custo-subparte-nome">
            {titulo}
            <span>{meta}</span>
          </span>
          <span className="fin-pessoas-matriz-grupo-chevron" aria-hidden>
            <ChevronRight
              size={16}
              strokeWidth={2.2}
              className={visivel ? "fin-chevron-aberto" : undefined}
            />
          </span>
        </button>
      </h3>
      {visivel ? children : null}
    </div>
  );
}

function BarraBusca({
  value,
  onChange,
  hits,
  onEscolher
}: {
  value: string;
  onChange: (v: string) => void;
  hits: HitBusca[];
  onEscolher: (hit: HitBusca) => void;
}) {
  const [foco, setFoco] = useState(false);
  const mostrarHits = foco && value.trim().length > 0;
  return (
    <div className="fin-custo-busca">
      <div className={foco || value ? "fin-custo-busca-barra foco" : "fin-custo-busca-barra"}>
        <Search size={18} strokeWidth={2} aria-hidden />
        <input
          type="search"
          value={value}
          placeholder="Buscar custo, categoria ou bloco…"
          aria-label="Buscar custo"
          autoComplete="off"
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFoco(true)}
          onBlur={() => window.setTimeout(() => setFoco(false), 180)}
        />
        {value ? (
          <button type="button" className="fin-custo-busca-limpar" aria-label="Limpar busca" onClick={() => onChange("")}>
            <X size={16} strokeWidth={2.2} aria-hidden />
          </button>
        ) : null}
      </div>
      {mostrarHits ? (
        <ul className="fin-custo-busca-hits" role="listbox" aria-label="Resultados da busca">
          {hits.length ? (
            hits.map((h) => (
              <li key={h.chave}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onEscolher(h)}
                >
                  <b>{h.nome}</b>
                  <span>
                    {rotuloSubparte(h.subparte)} · {PARTES.find((p) => p.slug === parteDaSubparte(h.subparte))?.nome}
                  </span>
                  <span>
                    {h.categoriaCode} {h.categoriaNome}
                  </span>
                </button>
              </li>
            ))
          ) : (
            <li className="vazio">Nenhum custo com «{value.trim()}»</li>
          )}
        </ul>
      ) : null}
    </div>
  );
}

function somarMeses(porMes: Record<string, number>, meses: string[]) {
  let s = 0;
  for (const mes of meses) s += porMes[mes] ?? 0;
  return s;
}

function fundirLinhas(linhas: Linha[], nMeses: number): Linha[] {
  const grupos = new Map<string, Linha[]>();
  for (const l of linhas) {
    const k = `${chaveAgrupamentoCusto(l.item)}:${l.subparte}`;
    const arr = grupos.get(k) ?? [];
    arr.push(l);
    grupos.set(k, arr);
  }
  const saida: Linha[] = [];
  for (const [chaveGrupo, membros] of grupos) {
    if (membros.length === 1) {
      saida.push({ ...membros[0], membros: [membros[0].item] });
      continue;
    }
    membros.sort((a, b) => b.totalCents - a.totalCents);
    const porMes: Record<string, number> = {};
    let totalCents = 0;
    const itens: ItemCusto[] = [];
    for (const m of membros) {
      totalCents += m.totalCents;
      itens.push(m.item);
      for (const [mes, cents] of Object.entries(m.porMes)) {
        porMes[mes] = (porMes[mes] ?? 0) + cents;
      }
    }
    const cabeca = membros[0];
    saida.push({
      chave: chaveGrupo,
      item: { ...cabeca.item, nome: nomeAgrupadoCusto(itens) },
      porMes,
      totalCents,
      mediaCents: Math.round(totalCents / nMeses),
      subparte: cabeca.subparte,
      membros: itens
    });
  }
  return saida.sort((a, b) => b.totalCents - a.totalCents);
}

type Linha = {
  item: ItemCusto;
  chave: string;
  porMes: Record<string, number>;
  totalCents: number;
  mediaCents: number;
  subparte: SubparteCusto;
  /** Pares reais atrás de uma linha agrupada (DAS 7.01). */
  membros: ItemCusto[];
};

const ICONE_PARTE: Record<ParteCusto, typeof House> = {
  padrao: House,
  obras: Hammer,
  consultoria: Cpu,
  organizar: CircleDashed
};

function TabelaMatriz({
  linhas,
  meses,
  mesAtual,
  times,
  areas,
  mostrarCadastro = true,
  selecionavel = false,
  selecionadas,
  onToggle,
  onToggleTodas,
  destaque,
  colunaNome = "Custo"
}: {
  linhas: Linha[];
  meses: string[];
  mesAtual: string | null;
  times: CustosEmpresa["times"];
  areas: { slug: string; nome: string }[];
  mostrarCadastro?: boolean;
  selecionavel?: boolean;
  selecionadas?: Set<string>;
  onToggle?: (chave: string) => void;
  onToggleTodas?: (chaves: string[], ligar: boolean) => void;
  destaque?: string | null;
  colunaNome?: string;
}) {
  const cabecalhoRef = useRef<HTMLTableRowElement>(null);
  const [alturaCabecalho, setAlturaCabecalho] = useState(46);
  const nMeses = Math.max(1, meses.length);

  useLayoutEffect(() => {
    const el = cabecalhoRef.current;
    if (!el) return;
    const medir = () => setAlturaCabecalho(el.getBoundingClientRect().height);
    medir();
    const obs = new ResizeObserver(medir);
    obs.observe(el);
    return () => obs.disconnect();
  }, [meses.length]);

  const totalPorMes: Record<string, number> = {};
  for (const mes of meses) totalPorMes[mes] = 0;
  let totalGeral = 0;
  for (const l of linhas) {
    totalGeral += l.totalCents;
    for (const mes of meses) totalPorMes[mes] += l.porMes[mes] ?? 0;
  }

  const chaves = linhas.map((l) => l.chave);
  const todasMarcadas = selecionavel && chaves.length > 0 && chaves.every((k) => selecionadas?.has(k));

  return (
    <div className="fin-matrix-wrap" style={{ ["--matriz-head-h" as string]: `${alturaCabecalho}px` }}>
      <table className="fin-table fin-matrix fin-pessoas-matriz-tabela">
        <thead>
          <tr ref={cabecalhoRef}>
            <th className="fin-matrix-head">
              {selecionavel ? (
                <label className="fin-custo-sel">
                  <input
                    type="checkbox"
                    checked={todasMarcadas}
                    aria-label={`Selecionar todos em ${colunaNome}`}
                    onChange={() => onToggleTodas?.(chaves, !todasMarcadas)}
                  />
                  {colunaNome}
                </label>
              ) : (
                colunaNome
              )}
            </th>
            {meses.map((mes) => (
              <th key={mes} className="num">
                {monthKeyLabel(mes)}
                {mes === mesAtual ? <span className="fin-tag">parcial</span> : null}
              </th>
            ))}
            <th className="num">Total</th>
            <th className="num">Média/mês</th>
          </tr>
          {linhas.length ? (
            <tr className="fin-pessoas-matriz-totais">
              <th className="fin-matrix-head" scope="row">
                Total · {linhas.length}
              </th>
              {meses.map((mes) => (
                <td key={mes} className="num fin-table-money">
                  {totalPorMes[mes] ? brlPrecise(totalPorMes[mes]) : <span className="fin-zero">—</span>}
                </td>
              ))}
              <td className="num fin-table-money">{brlPrecise(totalGeral)}</td>
              <td className="num fin-table-money">{brlPrecise(Math.round(totalGeral / nMeses))}</td>
            </tr>
          ) : null}
        </thead>
        <tbody>
          {linhas.map((linha) => (
            <tr
              key={linha.chave}
              data-custo-chave={linha.chave}
              className={[
                selecionadas?.has(linha.chave) ? "fin-custo-marcada" : "",
                destaque === linha.chave ? "fin-custo-destaque" : ""
              ]
                .filter(Boolean)
                .join(" ") || undefined}
            >
              <th className="fin-matrix-head" scope="row">
                <div className="fin-custo-linha-cab">
                  {selecionavel ? (
                    <label className="fin-custo-sel" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selecionadas?.has(linha.chave) ?? false}
                        aria-label={`Selecionar ${linha.item.nome}`}
                        onChange={() => onToggle?.(linha.chave)}
                      />
                    </label>
                  ) : null}
                  <div className="fin-pessoas-matriz-pessoa-bloco">
                    <span className="fin-desc">{linha.item.nome}</span>
                    <span className="fin-desc-sub">
                      {linha.item.categoriaCode} {linha.item.categoriaNome}
                    </span>
                    {mostrarCadastro ? (
                      <div className="fin-pessoas-matriz-cadastro" onClick={(e) => e.stopPropagation()}>
                        <CelulaTimeCusto item={linha.item} times={times} tambem={linha.membros} />
                        <CelulaAreasCusto item={linha.item} areas={areas} tambem={linha.membros} />
                      </div>
                    ) : null}
                  </div>
                </div>
              </th>
              {meses.map((mes) => {
                const cents = linha.porMes[mes] ?? 0;
                return (
                  <td key={mes} className="num fin-table-money">
                    {cents ? brlPrecise(cents) : <span className="fin-zero">—</span>}
                  </td>
                );
              })}
              <td className="num fin-table-money">{brlPrecise(linha.totalCents)}</td>
              <td className="num fin-table-money">{brlPrecise(linha.mediaCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function fatiar(
  linhas: Linha[],
  chave: (l: Linha) => { slug: string; nome: string },
  ultimoMes: string | null,
  nMeses: number
): FatiaCusto[] {
  const m = new Map<string, FatiaCusto>();
  for (const l of linhas) {
    const { slug, nome } = chave(l);
    const f = m.get(slug) ?? { slug, nome, ultimoCents: 0, mediaCents: 0, totalCents: 0 };
    f.totalCents += l.totalCents;
    if (ultimoMes) f.ultimoCents += l.porMes[ultimoMes] ?? 0;
    m.set(slug, f);
  }
  const n = Math.max(1, nMeses);
  return [...m.values()]
    .map((f) => ({ ...f, mediaCents: Math.round(f.totalCents / n) }))
    .sort((a, b) => b.totalCents - a.totalCents);
}

export function FinCustosEmpresaMatriz({
  dados,
  meses,
  mesAtual
}: {
  dados: CustosEmpresa;
  meses: string[];
  mesAtual: string | null;
}) {
  const [busca, setBusca] = useState("");
  const [timesAtivos, setTimesAtivos] = useState<Ativos>({});
  const [areasAtivos, setAreasAtivos] = useState<Ativos>({});
  const [classesAtivos, setClassesAtivos] = useState<Ativos>({});
  const [mostrarTime, setMostrarTime] = useState(true);
  const [mostrarArea, setMostrarArea] = useState(true);
  const [mostrarClasse, setMostrarClasse] = useState(false);
  const [serieA, setSerieA] = useState("");
  const [serieB, setSerieB] = useState("media");
  const [blocosManuais, setBlocosManuais] = useState<Record<string, SubparteCusto>>({});
  const [selecionadas, setSelecionadas] = useState<Set<string>>(() => new Set());
  const [destino, setDestino] = useState<SubparteCusto | "">("");
  const [destaque, setDestaque] = useState<string | null>(null);
  const [erroMover, setErroMover] = useState<string | null>(null);
  const [emVooMover, setEmVooMover] = useState(false);
  const router = useRouter();
  const [, startTransition] = useTransition();

  const areasCatalogo = useMemo(
    () => catalogoAreasEmpresa(dados.areasEmpresa, []),
    [dados.areasEmpresa]
  );
  const chavesArea = useMemo(() => [...areasCatalogo.map((a) => a.slug), SLUG_SEM_AREA], [areasCatalogo]);
  const chavesClasse = CLASSES.map((c) => c.slug);
  const timesDisponiveis = ORDEM_TIME;

  const itemPorChave = useMemo(() => {
    const m = new Map<string, ItemCusto>();
    for (const i of dados.itens) m.set(chaveCusto(i.counterpartyId, i.categoryId), i);
    return m;
  }, [dados.itens]);

  const termoBusca = busca.trim().toLowerCase();

  const linhas: Linha[] = useMemo(() => {
    const porItem = new Map<string, Record<string, number>>();
    for (const c of dados.celulas) {
      if (!meses.includes(c.mes)) continue;
      const k = chaveCusto(c.counterpartyId, c.categoryId);
      const porMes = porItem.get(k) ?? {};
      porMes[c.mes] = (porMes[c.mes] ?? 0) + c.cents;
      porItem.set(k, porMes);
    }

    const n = Math.max(1, meses.length);
    const lista: Linha[] = [];
    for (const [chave, porMes] of porItem) {
      const item = itemPorChave.get(chave);
      if (!item) continue;
      const subparte = blocosManuais[chave] ?? item.bloco ?? subparteCustoDe(item);
      if (
        grupoEstreito(timesAtivos, timesDisponiveis) &&
        !destinosTime(item.time).some((d) => estaLigado(timesAtivos, d.slug))
      )
        continue;
      if (grupoEstreito(classesAtivos, chavesClasse) && !estaLigado(classesAtivos, item.classe)) continue;
      if (grupoEstreito(areasAtivos, chavesArea)) {
        const delas = item.areasEmpresa.map((a) => a.slug);
        const passa = delas.length
          ? delas.some((s) => estaLigado(areasAtivos, s))
          : estaLigado(areasAtivos, SLUG_SEM_AREA);
        if (!passa) continue;
      }
      const totalCents = somarMeses(porMes, meses);
      lista.push({
        item,
        chave,
        porMes,
        totalCents,
        mediaCents: Math.round(totalCents / n),
        subparte,
        membros: [item]
      });
    }
    const fundidas = fundirLinhas(lista, n);
    if (!termoBusca) return fundidas;
    return fundidas.filter((l) =>
      passaBusca(
        {
          chave: l.chave,
          nome: l.item.nome,
          categoriaCode: l.item.categoriaCode,
          categoriaNome: l.item.categoriaNome,
          subparte: subparteExibida(l.subparte),
          blocoTexto: `${textoBloco(l.subparte)} ${l.membros.map((m) => m.nome).join(" ")}`.trim()
        },
        busca
      )
    );
  }, [
    dados.celulas,
    itemPorChave,
    meses,
    termoBusca,
    timesAtivos,
    timesDisponiveis,
    classesAtivos,
    chavesClasse,
    areasAtivos,
    chavesArea,
    busca,
    blocosManuais
  ]);

  const totalGeral = linhas.reduce((s, l) => s + l.totalCents, 0);
  const ultimoMes = meses[meses.length - 1] ?? null;
  const nMeses = Math.max(1, meses.length);

  const slugsAreaLigados = grupoEstreito(areasAtivos, chavesArea)
    ? new Set(chavesArea.filter((s) => estaLigado(areasAtivos, s)))
    : null;

  const slugsTimeLigados = grupoEstreito(timesAtivos, timesDisponiveis)
    ? new Set(timesDisponiveis.filter((s) => estaLigado(timesAtivos, s)))
    : null;

  const porTime = useMemo(() => {
    const acc = new Map<string, FatiaCusto>();
    for (const l of linhas) {
      const destinos = destinosTime(l.item.time, slugsTimeLigados);
      const partes = atribuirCents(l.totalCents, destinos);
      const partesUltimo = ultimoMes ? atribuirCents(l.porMes[ultimoMes] ?? 0, destinos) : [];
      for (let i = 0; i < destinos.length; i++) {
        const d = destinos[i];
        const f = acc.get(d.slug) ?? { slug: d.slug, nome: d.nome, ultimoCents: 0, mediaCents: 0, totalCents: 0 };
        f.totalCents += partes[i]?.cents ?? 0;
        f.ultimoCents += partesUltimo[i]?.cents ?? 0;
        acc.set(d.slug, f);
      }
    }
    return [...acc.values()]
      .map((f) => ({ ...f, mediaCents: Math.round(f.totalCents / nMeses) }))
      .sort((a, b) => b.totalCents - a.totalCents);
  }, [linhas, slugsTimeLigados, ultimoMes, nMeses]);

  const porArea = useMemo(() => {
    const acc = new Map<string, FatiaCusto>();
    for (const l of linhas) {
      const destinos = destinosAreaEmpresa(l.item.areasEmpresa, areasCatalogo, slugsAreaLigados);
      const partes = atribuirCents(l.totalCents, destinos);
      const partesUltimo = ultimoMes ? atribuirCents(l.porMes[ultimoMes] ?? 0, destinos) : [];
      for (let i = 0; i < destinos.length; i++) {
        const d = destinos[i];
        const f = acc.get(d.slug) ?? { slug: d.slug, nome: d.nome, ultimoCents: 0, mediaCents: 0, totalCents: 0 };
        f.totalCents += partes[i]?.cents ?? 0;
        f.ultimoCents += partesUltimo[i]?.cents ?? 0;
        acc.set(d.slug, f);
      }
    }
    return [...acc.values()]
      .map((f) => ({ ...f, mediaCents: Math.round(f.totalCents / nMeses) }))
      .sort((a, b) => b.totalCents - a.totalCents);
  }, [linhas, areasCatalogo, slugsAreaLigados, ultimoMes, nMeses]);

  const porClasse = useMemo(
    () =>
      fatiar(
        linhas,
        (l) => ({ slug: l.item.classe, nome: ROTULO_CLASSE[l.item.classe as ClasseCusto] }),
        ultimoMes,
        nMeses
      ),
    [linhas, ultimoMes, nMeses]
  );

  const opcoesComparativo = useMemo(() => {
    const lista = meses.map((m) => ({ id: `mes:${m}`, nome: monthKeyLabel(m) }));
    lista.push({ id: "media", nome: `Média de ${meses.length} ${meses.length === 1 ? "mês" : "meses"}` });
    return lista;
  }, [meses]);
  const serieAEfetiva = serieA || (ultimoMes ? `mes:${ultimoMes}` : "media");

  const filtrosEstreitos =
    grupoEstreito(timesAtivos, timesDisponiveis) ||
    grupoEstreito(areasAtivos, chavesArea) ||
    grupoEstreito(classesAtivos, chavesClasse) ||
    Boolean(termoBusca);

  const blocos = useMemo(() => {
    return PARTES.map((parte) => {
      const daParte = linhas.filter((l) => parteDaSubparte(subparteExibida(l.subparte)) === parte.slug);
      const subs = subpartesVisiveis()
        .filter((s) => s.parte === parte.slug)
        .map((s) => ({
          ...s,
          linhas: daParte.filter((l) => subparteExibida(l.subparte) === s.slug)
        }))
        .filter((s) => s.linhas.length > 0);
      const totalCents = daParte.reduce((s, l) => s + l.totalCents, 0);
      return { ...parte, linhas: daParte, subs, totalCents };
    }).filter((b) => b.linhas.length > 0);
  }, [linhas]);

  const linhasCartao = useMemo(() => {
    const n = Math.max(1, meses.length);
    const porEmissor = new Map<string, Record<string, number>>();
    for (const f of dados.faturasCartao ?? []) {
      if (!meses.includes(f.mes)) continue;
      const porMes = porEmissor.get(f.emissor) ?? {};
      porMes[f.mes] = (porMes[f.mes] ?? 0) + f.cents;
      porEmissor.set(f.emissor, porMes);
    }
    const lista: Linha[] = [];
    for (const [emissor, porMes] of porEmissor) {
      const totalCents = somarMeses(porMes, meses);
      lista.push({
        chave: `cartao:${emissor}`,
        item: {
          counterpartyId: null,
          categoryId: 0,
          nome: emissor === "inter" ? "Cartão Inter" : "Cartão Nubank",
          categoriaCode: "9.01",
          categoriaNome: "Pagamento de fatura — caixa, não soma com o bloco acima",
          time: "sem_time",
          areasEmpresa: [],
          classe: "operacional",
          bloco: null
        },
        porMes,
        totalCents,
        mediaCents: Math.round(totalCents / n),
        subparte: "financeiro",
        membros: []
      });
    }
    return lista.sort((a, b) => b.totalCents - a.totalCents);
  }, [dados.faturasCartao, meses]);

  const hitsBusca = useMemo(
    () =>
      buscarCustos(
        linhas.map((l) => ({
          chave: l.chave,
          nome: l.item.nome,
          categoriaCode: l.item.categoriaCode,
          categoriaNome: l.item.categoriaNome,
          subparte: subparteExibida(l.subparte),
          blocoTexto: `${textoBloco(l.subparte)} ${l.membros.map((m) => m.nome).join(" ")}`.trim()
        })),
        busca
      ),
    [linhas, busca]
  );

  function toggleChave(chave: string) {
    setSelecionadas((antes) => {
      const prox = new Set(antes);
      if (prox.has(chave)) prox.delete(chave);
      else prox.add(chave);
      return prox;
    });
  }

  function toggleTodas(chaves: string[], ligar: boolean) {
    setSelecionadas((antes) => {
      const prox = new Set(antes);
      for (const k of chaves) {
        if (ligar) prox.add(k);
        else prox.delete(k);
      }
      return prox;
    });
  }

  function irAoHit(hit: HitBusca) {
    setDestaque(hit.chave);
    window.setTimeout(() => {
      const el = document.querySelector(`[data-custo-chave="${hit.chave}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 40);
  }

  async function moverSelecionados() {
    if (!destino || !selecionadas.size) return;
    const alvos = linhas.filter((l) => selecionadas.has(l.chave) && l.item.categoryId > 0);
    if (!alvos.length) {
      setErroMover("Cartão da empresa não muda de bloco — é fatura 9.01.");
      return;
    }
    setErroMover(null);
    setEmVooMover(true);
    try {
      for (const l of alvos) {
        const itens = l.membros.length ? l.membros : [l.item];
        await patchCustoVarios(itens, { bloco: destino });
      }
      setBlocosManuais((antes) => {
        const prox = { ...antes };
        for (const l of alvos) {
          const itens = l.membros.length ? l.membros : [l.item];
          for (const i of itens) prox[chaveCusto(i.counterpartyId, i.categoryId)] = destino;
        }
        return prox;
      });
      setSelecionadas(new Set());
      setDestino("");
      startTransition(() => router.refresh());
    } catch (falha) {
      setErroMover(falha instanceof Error ? falha.message : "não salvou");
    } finally {
      setEmVooMover(false);
    }
  }

  const propsSel = {
    selecionavel: true as const,
    selecionadas,
    onToggle: toggleChave,
    onToggleTodas: toggleTodas,
    destaque
  };

  return (
    <>
      <FinSecaoColapsavel
        titulo="Custos por time, área e classe"
        icone={Layers}
        meta={`${linhas.length} ${linhas.length === 1 ? "custo" : "custos"} · ${brlPrecise(totalGeral)}`}
        abertoPadrao
        ariaLabel="Custo da empresa por time, área e classe"
      >
        <FinPessoasCustoGraficos
          paineis={[
            { titulo: "Por time", fatias: porTime, corDe: (slug) => COR_TIME[slug as keyof typeof COR_TIME] ?? "var(--muted)" },
            { titulo: "Por área da empresa", fatias: porArea, corDe: (slug) => corAreaEmpresa(slug) },
            { titulo: "Por classe", fatias: porClasse, corDe: (slug) => COR_CLASSE[slug as ClasseCusto] ?? "var(--muted)" }
          ]}
          nota="Time e área são cadastro: o que você marca na linha abaixo. Classe (operacional / máquinas) sai do plano de contas. Gente fica em Pessoas — limpeza (Rita) é serviço da casa e entra aqui."
          ultimoMesLabel={ultimoMes ? monthKeyLabel(ultimoMes) : "—"}
          mediaLabel={`Média de ${meses.length} meses`}
          opcoesComparativo={opcoesComparativo}
          serieA={serieAEfetiva}
          serieB={serieB}
          onSerieA={setSerieA}
          onSerieB={setSerieB}
          atalhos={
            ultimoMes
              ? [
                  { id: "atual-media", nome: "Atual × média", a: `mes:${ultimoMes}`, b: "media" },
                  ...(meses.length > 1
                    ? [
                        {
                          id: "atual-anterior",
                          nome: "Atual × anterior",
                          a: `mes:${ultimoMes}`,
                          b: `mes:${meses[meses.length - 2]}`
                        }
                      ]
                    : [])
                ]
              : []
          }
        />
      </FinSecaoColapsavel>

      <FinSecaoColapsavel
        className="fin-painel-grafico fin-pessoas-matriz"
        titulo="Custos por bloco"
        icone={Layers}
        abertoPadrao
        meta={`${linhas.length} ${linhas.length === 1 ? "custo" : "custos"} · ${meses.length} ${meses.length === 1 ? "mês" : "meses"} · ${brlPrecise(totalGeral)}`}
        ariaLabel="Custo da empresa, mês a mês, por bloco"
      >
        <BarraBusca value={busca} onChange={setBusca} hits={hitsBusca} onEscolher={irAoHit} />
        {selecionadas.size ? (
          <div className="fin-custo-mover" role="region" aria-label="Mover custos de bloco">
            <b>
              {selecionadas.size} {selecionadas.size === 1 ? "item" : "itens"}
            </b>
            <label>
              Mover para
              <select
                className="fin-select"
                value={destino}
                disabled={emVooMover}
                onChange={(e) => setDestino(e.target.value as SubparteCusto | "")}
              >
                <option value="">escolher bloco…</option>
                {PARTES.map((p) => (
                  <optgroup key={p.slug} label={p.nome}>
                    {subpartesVisiveis()
                      .filter((s) => s.parte === p.slug)
                      .map((s) => (
                        <option key={s.slug} value={s.slug}>
                          {s.nome}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <button type="button" className="fin-btn-primary" disabled={!destino || emVooMover} onClick={() => void moverSelecionados()}>
              {emVooMover ? "Movendo…" : "Mover"}
            </button>
            <button
              type="button"
              className="fin-btn-ghost"
              disabled={emVooMover}
              onClick={() => {
                setSelecionadas(new Set());
                setDestino("");
                setErroMover(null);
              }}
            >
              Limpar
            </button>
            {erroMover ? <span className="fin-badge-atencao">{erroMover}</span> : null}
          </div>
        ) : null}
        <div className="fin-pessoas-matriz-filtros">
          <div className="fin-pessoas-matriz-filtro-linha">
            <GrupoFiltro
              rotulo="Time"
              aberto={mostrarTime}
              estreito={grupoEstreito(timesAtivos, timesDisponiveis)}
              onToggle={() => setMostrarTime((v) => !v)}
            >
              <div className="fin-pessoas-matriz-chips" role="group" aria-label="Times visíveis">
                {timesDisponiveis.map((slug) => (
                  <button
                    key={slug}
                    type="button"
                    className={estaLigado(timesAtivos, slug) ? "fin-pessoas-matriz-chip ativo" : "fin-pessoas-matriz-chip"}
                    style={{ ["--chip-cor" as string]: COR_TIME[slug] }}
                    aria-pressed={estaLigado(timesAtivos, slug)}
                    title={DICA_CHIP}
                    onClick={() => alternarGrupo(setTimesAtivos, slug, timesDisponiveis)}
                  >
                    <i className="fin-pessoas-matriz-chip-ponto" aria-hidden />
                    {ROTULO_TIME[slug]}
                  </button>
                ))}
              </div>
            </GrupoFiltro>
            <GrupoFiltro
              rotulo="Área da empresa"
              aberto={mostrarArea}
              estreito={grupoEstreito(areasAtivos, chavesArea)}
              onToggle={() => setMostrarArea((v) => !v)}
            >
              <div className="fin-pessoas-matriz-chips" role="group" aria-label="Áreas da empresa visíveis">
                {areasCatalogo.map((area) => (
                  <button
                    key={area.slug}
                    type="button"
                    className={estaLigado(areasAtivos, area.slug) ? "fin-pessoas-matriz-chip ativo" : "fin-pessoas-matriz-chip"}
                    style={{ ["--chip-cor" as string]: corAreaEmpresa(area.slug) }}
                    aria-pressed={estaLigado(areasAtivos, area.slug)}
                    title={DICA_CHIP}
                    onClick={() => alternarGrupo(setAreasAtivos, area.slug, chavesArea)}
                  >
                    <i className="fin-pessoas-matriz-chip-ponto" aria-hidden />
                    {area.nome}
                  </button>
                ))}
                <button
                  type="button"
                  className={estaLigado(areasAtivos, SLUG_SEM_AREA) ? "fin-pessoas-matriz-chip ativo" : "fin-pessoas-matriz-chip"}
                  style={{ ["--chip-cor" as string]: "var(--area-sem_area)" }}
                  aria-pressed={estaLigado(areasAtivos, SLUG_SEM_AREA)}
                  title={DICA_CHIP}
                  onClick={() => alternarGrupo(setAreasAtivos, SLUG_SEM_AREA, chavesArea)}
                >
                  <i className="fin-pessoas-matriz-chip-ponto" aria-hidden />
                  Sem área
                </button>
              </div>
            </GrupoFiltro>
            <GrupoFiltro
              rotulo="Classe"
              aberto={mostrarClasse}
              estreito={grupoEstreito(classesAtivos, chavesClasse)}
              onToggle={() => setMostrarClasse((v) => !v)}
            >
              <div className="fin-pessoas-matriz-chips" role="group" aria-label="Classes visíveis">
                {CLASSES.map((c) => (
                  <button
                    key={c.slug}
                    type="button"
                    className={estaLigado(classesAtivos, c.slug) ? "fin-pessoas-matriz-chip ativo" : "fin-pessoas-matriz-chip"}
                    style={{ ["--chip-cor" as string]: COR_CLASSE[c.slug] }}
                    aria-pressed={estaLigado(classesAtivos, c.slug)}
                    title={DICA_CHIP}
                    onClick={() => alternarGrupo(setClassesAtivos, c.slug, chavesClasse)}
                  >
                    <i className="fin-pessoas-matriz-chip-ponto" aria-hidden />
                    {c.nome}
                  </button>
                ))}
              </div>
            </GrupoFiltro>
            {filtrosEstreitos ? (
              <button
                type="button"
                className="fin-btn-ghost fin-pessoas-matriz-limpar"
                onClick={() => {
                  setBusca("");
                  setTimesAtivos({});
                  setAreasAtivos({});
                  setClassesAtivos({});
                }}
              >
                Limpar filtros
              </button>
            ) : null}
          </div>
        </div>

        {blocos.map((bloco) => {
          const Icone = ICONE_PARTE[bloco.slug];
          return (
            <section key={bloco.slug} className="fin-custo-parte">
              <header className="fin-custo-parte-cab">
                <span className="fin-custo-parte-icone" aria-hidden>
                  <Icone size={15} strokeWidth={2.1} />
                </span>
                <div>
                  <h2 className="fin-custo-parte-titulo">{bloco.nome}</h2>
                  <p className="fin-custo-parte-dica">
                    {bloco.dica} · {bloco.linhas.length} {bloco.linhas.length === 1 ? "linha" : "linhas"} ·{" "}
                    {brlPrecise(bloco.totalCents)}
                  </p>
                </div>
              </header>
              {bloco.subs.map((sub) => (
                <SubparteColapsavel
                  key={sub.slug}
                  titulo={sub.nome}
                  forcarAberto={Boolean(termoBusca)}
                  meta={
                    <>
                      {sub.linhas.length} · {brlPrecise(sub.linhas.reduce((s, l) => s + l.totalCents, 0))}
                    </>
                  }
                >
                  <TabelaMatriz
                    linhas={sub.linhas}
                    meses={meses}
                    mesAtual={mesAtual}
                    times={dados.times}
                    areas={areasCatalogo}
                    {...propsSel}
                  />
                </SubparteColapsavel>
              ))}
              {bloco.slug === "padrao" && linhasCartao.length ? (
                <SubparteColapsavel
                  titulo="Cartões da empresa"
                  forcarAberto={Boolean(termoBusca)}
                  meta={
                    <>
                      {linhasCartao.length} · {brlPrecise(linhasCartao.reduce((s, l) => s + l.totalCents, 0))}
                    </>
                  }
                >
                  <p className="fin-custo-subparte-nota">
                    Inter e Nubank separados. Isto é a fatura paga (9.01) — não entra no total do bloco nem no
                    R$ da matriz. Inter não itemiza compra; Nubank itemiza na tela de cartões.
                  </p>
                  <TabelaMatriz
                    linhas={linhasCartao}
                    meses={meses}
                    mesAtual={mesAtual}
                    times={dados.times}
                    areas={areasCatalogo}
                    mostrarCadastro={false}
                    colunaNome="Cartão"
                  />
                </SubparteColapsavel>
              ) : null}
              {bloco.slug === "padrao" ? (
                <p className="fin-custo-subparte-nota">
                  Financiamento (9.04) não tem lançamento em 2026. Quando aparecer o favorecido, entra neste
                  bloco.
                </p>
              ) : null}
            </section>
          );
        })}
      </FinSecaoColapsavel>
    </>
  );
}

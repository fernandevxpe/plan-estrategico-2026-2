"use client";

import { ChevronRight, PieChart, Search, Users } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";

import type { BandaRemuneracao, CustoPessoas, Pessoa, PrevisaoCadastro } from "@/lib/financeiro/pessoas";
import { brlPrecise, monthKeyLabel, pct } from "@/lib/financeiro/format";
import {
  atribuirCents,
  destinosAreaEmpresa,
  somarComparativo
} from "@/lib/financeiro/repartir-custo-area";

import { FinPessoasCustoGraficos } from "./FinPessoasCustoGraficos";
import { CelulaArea, CelulaAreasEmpresa, catalogoAreasEmpresa, corAreaEmpresa } from "./FinPessoaEditor";
import { BotaoPrevisaoPessoa } from "./FinPrevisaoPessoaPop";
import { FinSecaoColapsavel } from "./FinSecaoColapsavel";

/** Ordem estável — a mesma do perfil. */
const NATUREZAS = [
  "salario",
  "prolabore",
  "comissao",
  "estagio",
  "extra",
  "encargo_beneficio",
  "reembolso"
] as const;

const ROTULO: Record<string, string> = {
  salario: "Salário",
  prolabore: "Pró-labore",
  comissao: "Comissão",
  estagio: "Estágio",
  extra: "Extra",
  encargo_beneficio: "Encargo",
  reembolso: "Reembolso"
};

/** Mesmas tokens do perfil (`FinPessoaPerfil` / `--nat-*`). */
const COR: Record<string, string> = {
  salario: "var(--nat-salario)",
  prolabore: "var(--nat-recorrente)",
  estagio: "var(--nat-recorrente)",
  comissao: "var(--nat-comissao)",
  reembolso: "var(--nat-reembolso)",
  encargo_beneficio: "var(--nat-encargo)",
  extra: "var(--nat-extra)"
};

/** Ordem do eixo de time — a mesma de `ORDEM_TIME` em `lib/financeiro/pessoas.ts`. */
const ORDEM_TIME = ["consultoria", "obras", "administrativo", "outros", "sem_time"] as const;

const COR_TIME: Record<string, string> = {
  consultoria: "var(--purple)",
  obras: "var(--ink-orange, #c2410c)",
  administrativo: "var(--teal)",
  outros: "var(--amber)",
  sem_time: "var(--muted)"
};

const ROTULO_TIME: Record<string, string> = {
  consultoria: "Consultoria",
  obras: "Obras",
  administrativo: "Administrativo",
  outros: "Outros",
  sem_time: "Sem time"
};

const DICA_CHIP = "Clique para ver só este. De novo para voltar todos.";

const SEM_AREA = "sem_area";

type Ativos = Record<string, boolean>;

/** Métricas que vinham do "Geral do time" — agora na mesma tabela da série. */
export type ResumoPessoaMatriz = {
  fixoContratadoCents: number | null;
  excedenteCents: number | null;
  mesesPactuados: string[];
  mediaMensalCents: number;
  variacaoPct: number | null;
  primeiroMes: string | null;
  ultimoMes: string | null;
};

function ativosIniciais(tipos: { slug: string }[]): Ativos {
  const base: Ativos = {};
  for (const slug of NATUREZAS) base[slug] = true;
  for (const t of tipos) base[t.slug] = true;
  return base;
}

/**
 * Clique com todos ligados isola um só — é o "só consultoria" / "só comissão"
 * sem desligar os outros cinco à mão. Clique no único ligado devolve o grupo.
 * Com recorte parcial, o clique volta a ser liga/desliga.
 */
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

function grupoEstreito(ativos: Ativos, todos: readonly string[]) {
  return todos.some((s) => !estaLigado(ativos, s));
}

function pessoaPassaArea(pessoa: Pessoa, areasAtivos: Ativos, slugsCatalogo: readonly string[]) {
  const chaves = [...slugsCatalogo, SEM_AREA];
  if (!grupoEstreito(areasAtivos, chaves)) return true;
  const delas = (pessoa.areasEmpresa ?? []).map((a) => a.slug);
  if (!delas.length) return estaLigado(areasAtivos, SEM_AREA);
  return delas.some((s) => estaLigado(areasAtivos, s));
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
        {rotulo}
        {estreito ? <i>filtro</i> : null}
        <ChevronRight size={14} strokeWidth={2.2} className={aberto ? "fin-chevron-aberto" : undefined} aria-hidden />
      </button>
      {aberto ? children : null}
    </div>
  );
}

function somarAtivos(porTipo: Record<string, number> | undefined, ativos: Ativos) {
  if (!porTipo) return 0;
  let s = 0;
  for (const [nat, cents] of Object.entries(porTipo)) {
    if (ativos[nat]) s += cents;
  }
  return s;
}

export type OpcaoComparativoCusto = { id: string; nome: string };

function centsSeriePessoa(
  linha: { porTipoMes: Record<string, Record<string, number>>; previsao: Record<string, number> },
  id: string,
  ativos: Ativos,
  mesesVisiveis: string[],
  nMeses: number
) {
  if (id === "media") {
    let t = 0;
    for (const mes of mesesVisiveis) t += somarAtivos(linha.porTipoMes[mes], ativos);
    return Math.round(t / Math.max(nMeses, 1));
  }
  if (id === "previsto") return somarAtivos(linha.previsao, ativos);
  if (id.startsWith("mes:")) return somarAtivos(linha.porTipoMes[id.slice(4)], ativos);
  return 0;
}

function centsSerieNatureza(
  linha: { porTipoMes: Record<string, Record<string, number>>; previsao: Record<string, number> },
  nat: string,
  id: string,
  mesesVisiveis: string[],
  nMeses: number
) {
  if (id === "media") {
    let t = 0;
    for (const mes of mesesVisiveis) t += linha.porTipoMes[mes]?.[nat] ?? 0;
    return Math.round(t / Math.max(nMeses, 1));
  }
  if (id === "previsto") return linha.previsao[nat] ?? 0;
  if (id.startsWith("mes:")) return linha.porTipoMes[id.slice(4)]?.[nat] ?? 0;
  return 0;
}

function compsAtivos(
  porTipo: Record<string, number> | undefined,
  ativos: Ativos,
  ordem: readonly string[]
) {
  if (!porTipo) return [] as { slug: string; cents: number }[];
  return ordem
    .filter((slug) => ativos[slug] && (porTipo[slug] ?? 0) > 0)
    .map((slug) => ({ slug, cents: porTipo[slug] }));
}

/**
 * Pessoa × mês + cadastro leve + fixo/acima/Δ.
 * Absorveu o antigo "Geral do time": uma pergunta, uma tabela.
 */
export function FinPessoasMatriz({
  dados,
  bandas,
  meses,
  pessoaPorId,
  mesAtual,
  resumoPorPessoa,
  rodape
}: {
  dados: CustoPessoas;
  bandas: BandaRemuneracao[];
  meses: string[];
  pessoaPorId: Map<number, Pessoa>;
  mesAtual: string;
  resumoPorPessoa: Map<number, ResumoPessoaMatriz>;
  rodape?: ReactNode;
}) {
  const [busca, setBusca] = useState("");
  const [ativos, setAtivos] = useState<Ativos>(() => ativosIniciais(dados.tiposRemuneracao));
  const [timesAtivos, setTimesAtivos] = useState<Ativos>({});
  const [areasAtivos, setAreasAtivos] = useState<Ativos>({});
  const [ocultarDetalhes, setOcultarDetalhes] = useState(false);
  const [mostrarTime, setMostrarTime] = useState(false);
  const [mostrarArea, setMostrarArea] = useState(false);
  const [mostrarTipo, setMostrarTipo] = useState(false);
  const [serieA, setSerieA] = useState(() => `mes:${mesAtual}`);
  const [serieB, setSerieB] = useState("media");
  const cabecalhoRef = useRef<HTMLTableRowElement>(null);
  const [alturaCabecalho, setAlturaCabecalho] = useState(46);

  const mesPrevisto = dados.mesPrevisto;
  const previsaoPorId = useMemo(() => {
    const m = new Map<number, PrevisaoCadastro>();
    for (const p of dados.previsaoCadastro) m.set(p.personId, p);
    return m;
  }, [dados.previsaoCadastro]);

  const naturezasDisponiveis = useMemo(() => {
    const presentes = new Set(bandas.map((b) => b.natureza));
    for (const t of dados.tiposRemuneracao) presentes.add(t.slug);
    for (const p of dados.previsaoCadastro) {
      for (const nat of Object.keys(p.porNatureza)) presentes.add(nat);
    }
    return NATUREZAS.filter((slug) => presentes.has(slug));
  }, [bandas, dados.tiposRemuneracao, dados.previsaoCadastro]);

  const bandasBase = useMemo(
    () => bandas.filter((b) => meses.includes(b.mes)),
    [bandas, meses]
  );

  const pessoasComBanda = useMemo(() => {
    const ids = new Set(bandas.filter((b) => meses.includes(b.mes)).map((b) => b.personId));
    return [...ids]
      .map((id) => pessoaPorId.get(id))
      .filter((p): p is Pessoa => Boolean(p))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [bandas, meses, pessoaPorId]);

  const timesDisponiveis = useMemo(() => {
    const presentes = new Set(pessoasComBanda.map((p) => p.time));
    const conhecidos = ORDEM_TIME.filter((s) => presentes.has(s));
    const extras = [...presentes].filter((s) => !conhecidos.includes(s as (typeof ORDEM_TIME)[number]));
    return [...conhecidos, ...extras];
  }, [pessoasComBanda]);

  const areasCatalogo = useMemo(
    () => catalogoAreasEmpresa(dados.areasEmpresa, []),
    [dados.areasEmpresa]
  );
  const areasFiltro = useMemo(
    () => areasCatalogo.map((a) => a.slug),
    [areasCatalogo]
  );
  const chavesArea = useMemo(() => [...areasFiltro, SEM_AREA], [areasFiltro]);

  const termoBusca = busca.trim().toLowerCase();

  const linhas = useMemo(() => {
    const mapa = new Map<
      number,
      {
        pessoa: Pessoa;
        porTipoMes: Record<string, Record<string, number>>;
        totalAtivoCents: number;
        previsao: Record<string, number>;
        resumo: ResumoPessoaMatriz | undefined;
      }
    >();

    for (const b of bandasBase) {
      const pessoa = pessoaPorId.get(b.personId);
      if (!pessoa) continue;
      if (timesAtivos[pessoa.time] === false) continue;
      if (!pessoaPassaArea(pessoa, areasAtivos, areasFiltro)) continue;
      if (termoBusca) {
        const hay = `${pessoa.nome} ${pessoa.nomeLegal ?? ""} ${pessoa.timeRotulo} ${(pessoa.areasEmpresa ?? []).map((a) => a.nome).join(" ")}`.toLowerCase();
        if (!hay.includes(termoBusca)) continue;
      }
      const atual = mapa.get(b.personId) ?? {
        pessoa,
        porTipoMes: {},
        totalAtivoCents: 0,
        previsao: previsaoPorId.get(b.personId)?.porNatureza ?? {},
        resumo: resumoPorPessoa.get(b.personId)
      };
      if (!atual.porTipoMes[b.mes]) atual.porTipoMes[b.mes] = {};
      atual.porTipoMes[b.mes][b.natureza] = (atual.porTipoMes[b.mes][b.natureza] ?? 0) + b.cents;
      if (ativos[b.natureza]) atual.totalAtivoCents += b.cents;
      mapa.set(b.personId, atual);
    }

    return [...mapa.values()]
      .filter((l) => {
        for (const porTipo of Object.values(l.porTipoMes)) {
          for (const [nat, cents] of Object.entries(porTipo)) {
            if (ativos[nat] && cents > 0) return true;
          }
        }
        return somarAtivos(l.previsao, ativos) > 0;
      })
      .sort((a, b) => b.totalAtivoCents - a.totalAtivoCents);
  }, [bandasBase, pessoaPorId, ativos, timesAtivos, areasAtivos, areasFiltro, termoBusca, previsaoPorId, resumoPorPessoa]);

  const mesesVisiveis = useMemo(() => {
    const comValor = new Set<string>();
    for (const l of linhas) {
      for (const [mes, porTipo] of Object.entries(l.porTipoMes)) {
        for (const [nat, cents] of Object.entries(porTipo)) {
          if (ativos[nat] && cents > 0) comValor.add(mes);
        }
      }
    }
    const recorteEstreito =
      Boolean(termoBusca) ||
      grupoEstreito(timesAtivos, timesDisponiveis) ||
      grupoEstreito(areasAtivos, chavesArea);
    if (recorteEstreito) return meses;
    const primeiro = meses.findIndex((m) => comValor.has(m));
    return primeiro <= 0 ? meses : meses.slice(primeiro);
  }, [meses, linhas, ativos, termoBusca, timesAtivos, timesDisponiveis, areasAtivos, chavesArea]);

  const totalPorMes = useMemo(() => {
    const mapa: Record<string, number> = {};
    for (const mes of mesesVisiveis) {
      mapa[mes] = linhas.reduce((s, l) => s + somarAtivos(l.porTipoMes[mes], ativos), 0);
    }
    return mapa;
  }, [linhas, mesesVisiveis, ativos]);

  const totalPrevisao = linhas.reduce((s, l) => s + somarAtivos(l.previsao, ativos), 0);
  const totalGeral = linhas.reduce((s, l) => s + l.totalAtivoCents, 0);
  const totalFixo = linhas.reduce((s, l) => s + (l.resumo?.fixoContratadoCents ?? 0), 0);
  const totalExcedente = linhas.reduce((s, l) => s + (l.resumo?.excedenteCents ?? 0), 0);
  const temFixo = linhas.some((l) => l.resumo?.fixoContratadoCents !== null);
  const temExcedente = linhas.some((l) => l.resumo?.excedenteCents !== null);

  const filtrosEstreitos =
    Boolean(termoBusca) ||
    grupoEstreito(timesAtivos, timesDisponiveis) ||
    grupoEstreito(areasAtivos, chavesArea) ||
    grupoEstreito(ativos, naturezasDisponiveis);

  const ultimoMes = mesesVisiveis.includes(mesAtual) ? mesAtual : (mesesVisiveis.at(-1) ?? mesAtual);
  const nMesesMedia = Math.max(mesesVisiveis.length, 1);
  const slugsAreaLigados = useMemo(() => {
    if (!grupoEstreito(areasAtivos, chavesArea)) return null;
    return new Set(chavesArea.filter((s) => estaLigado(areasAtivos, s)));
  }, [areasAtivos, chavesArea]);

  const opcoesComparativo = useMemo(() => {
    const lista: OpcaoComparativoCusto[] = [];
    const vistos = new Set<string>();
    const porMes = (mes: string, extra = "") => {
      const id = `mes:${mes}`;
      if (vistos.has(id)) return;
      vistos.add(id);
      lista.push({
        id,
        nome: `${monthKeyLabel(mes)}${mes === mesAtual ? " · atual" : ""}${extra}`
      });
    };
    porMes(ultimoMes, ultimoMes === mesAtual ? " · parcial" : "");
    for (const mes of [...mesesVisiveis].reverse()) porMes(mes);
    if (mesPrevisto) {
      lista.push({ id: "previsto", nome: `${monthKeyLabel(mesPrevisto)} · previsto` });
    }
    lista.push({
      id: "media",
      nome: `Média de ${mesesVisiveis.length} ${mesesVisiveis.length === 1 ? "mês" : "meses"}`
    });
    return lista;
  }, [mesesVisiveis, mesAtual, mesPrevisto, ultimoMes]);

  const idsComparativo = useMemo(() => new Set(opcoesComparativo.map((o) => o.id)), [opcoesComparativo]);
  const serieAEfetiva = idsComparativo.has(serieA) ? serieA : `mes:${ultimoMes}`;
  const serieBEfetiva = idsComparativo.has(serieB) ? serieB : "media";
  const rotuloA = opcoesComparativo.find((o) => o.id === serieAEfetiva)?.nome ?? "Série A";
  const rotuloB = opcoesComparativo.find((o) => o.id === serieBEfetiva)?.nome ?? "Série B";
  const idxAtual = mesesVisiveis.indexOf(mesAtual);
  const mesAnterior = (idxAtual > 0 ? mesesVisiveis[idxAtual - 1] : mesesVisiveis.at(-2)) ?? null;

  const { porTime, porArea, porCategoria } = useMemo(() => {
    const itensTime: { slug: string; nome: string; aCents: number; bCents: number }[] = [];
    const itensArea: { slug: string; nome: string; aCents: number; bCents: number }[] = [];
    const itensCat: { slug: string; nome: string; aCents: number; bCents: number }[] = [];

    for (const linha of linhas) {
      const a = centsSeriePessoa(linha, serieAEfetiva, ativos, mesesVisiveis, nMesesMedia);
      const b = centsSeriePessoa(linha, serieBEfetiva, ativos, mesesVisiveis, nMesesMedia);

      itensTime.push({
        slug: linha.pessoa.time,
        nome: ROTULO_TIME[linha.pessoa.time] ?? linha.pessoa.timeRotulo,
        aCents: a,
        bCents: b
      });

      const destinos = destinosAreaEmpresa(linha.pessoa.areasEmpresa, areasCatalogo, slugsAreaLigados);
      const partesA = atribuirCents(a, destinos);
      const partesB = atribuirCents(b, destinos);
      for (let i = 0; i < destinos.length; i++) {
        itensArea.push({
          slug: destinos[i].slug,
          nome: destinos[i].nome,
          aCents: partesA[i]?.cents ?? 0,
          bCents: partesB[i]?.cents ?? 0
        });
      }

      for (const nat of naturezasDisponiveis) {
        if (!estaLigado(ativos, nat)) continue;
        const ua = centsSerieNatureza(linha, nat, serieAEfetiva, mesesVisiveis, nMesesMedia);
        const ub = centsSerieNatureza(linha, nat, serieBEfetiva, mesesVisiveis, nMesesMedia);
        if (ua > 0 || ub > 0) {
          itensCat.push({
            slug: nat,
            nome: ROTULO[nat] ?? nat,
            aCents: ua,
            bCents: ub
          });
        }
      }
    }

    return {
      porTime: somarComparativo(itensTime),
      porArea: somarComparativo(itensArea),
      porCategoria: somarComparativo(itensCat)
    };
  }, [
    linhas,
    serieAEfetiva,
    serieBEfetiva,
    mesesVisiveis,
    ativos,
    areasCatalogo,
    slugsAreaLigados,
    naturezasDisponiveis,
    nMesesMedia
  ]);

  useLayoutEffect(() => {
    const el = cabecalhoRef.current;
    if (!el) return;
    const medir = () => setAlturaCabecalho(el.getBoundingClientRect().height);
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, [mesesVisiveis, mesPrevisto]);

  const colunas =
    1 + mesesVisiveis.length + (mesPrevisto ? 1 : 0) + 5; // pessoa + meses + previsto? + total + média + fixo + acima + Δ

  return (
    <>
    <FinSecaoColapsavel
      className="fin-painel-grafico fin-pessoas-custo-secao"
      titulo="Custos por área e categoria"
      icone={PieChart}
      abertoPadrao
      meta={`${rotuloA} × ${rotuloB}`}
      ariaLabel="Custo rateado por time, área da empresa e categoria"
    >
      <FinPessoasCustoGraficos
        paineis={[
          { titulo: "Por time", fatias: porTime, corDe: (slug: string) => COR_TIME[slug] ?? "var(--muted)" },
          {
            titulo: "Por área da empresa",
            fatias: porArea,
            corDe: (slug: string) => (slug === SEM_AREA ? "var(--area-sem_area)" : corAreaEmpresa(slug))
          },
          { titulo: "Por categoria", fatias: porCategoria, corDe: (slug: string) => COR[slug] ?? "var(--muted)" }
        ]}
        nota="Quem trabalha em N áreas divide o custo em N partes iguais. O salário não conta duas vezes. As três leituras (separado, empilhado, pizza) são o mesmo número."
        ultimoMesLabel={rotuloA}
        mediaLabel={rotuloB}
        opcoesComparativo={opcoesComparativo}
        serieA={serieAEfetiva}
        serieB={serieBEfetiva}
        onSerieA={setSerieA}
        onSerieB={setSerieB}
        atalhos={[
          { id: "atual-media", nome: "Atual × média", a: `mes:${ultimoMes}`, b: "media" },
          ...(mesAnterior
            ? [{ id: "atual-anterior", nome: "Atual × anterior", a: `mes:${ultimoMes}`, b: `mes:${mesAnterior}` }]
            : []),
          ...(mesPrevisto
            ? [{ id: "atual-previsto", nome: "Atual × próximo", a: `mes:${ultimoMes}`, b: "previsto" }]
            : [])
        ]}
      />
    </FinSecaoColapsavel>
    <FinSecaoColapsavel
      className="fin-painel-grafico fin-pessoas-matriz"
      titulo="Pessoas"
      icone={Users}
      abertoPadrao
      meta={`${linhas.length} ${linhas.length === 1 ? "pessoa" : "pessoas"} · ${mesesVisiveis.length} ${mesesVisiveis.length === 1 ? "mês" : "meses"} · ${brlPrecise(totalGeral)}`}
      ariaLabel="Custo por pessoa, mês a mês"
      cabExtra={
        <label className="fin-pessoas-matriz-campo fin-pessoas-matriz-busca">
          <span className="fin-pessoas-matriz-busca-campo">
            <Search size={15} strokeWidth={2.2} aria-hidden />
            <input
              type="search"
              className="fin-input"
              placeholder="Buscar por nome…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              aria-label="Buscar pessoa"
            />
          </span>
          {termoBusca ? (
            <small>
              {linhas.length} de {pessoasComBanda.length}
            </small>
          ) : null}
        </label>
      }
    >
      <div className="fin-pessoas-matriz-filtros">
        <div className="fin-pessoas-matriz-filtro-linha">
          <GrupoFiltro
            rotulo="Time"
            aberto={mostrarTime}
            estreito={grupoEstreito(timesAtivos, timesDisponiveis)}
            onToggle={() => setMostrarTime((v) => !v)}
          >
            <div className="fin-pessoas-matriz-chips" role="group" aria-label="Times visíveis">
              {timesDisponiveis.map((slug) => {
                const ligado = estaLigado(timesAtivos, slug);
                const pessoa = pessoasComBanda.find((p) => p.time === slug);
                return (
                  <button
                    key={slug}
                    type="button"
                    className={ligado ? "fin-pessoas-matriz-chip ativo" : "fin-pessoas-matriz-chip"}
                    style={{ ["--chip-cor" as string]: COR_TIME[slug] ?? "var(--muted)" }}
                    aria-pressed={ligado}
                    title={DICA_CHIP}
                    onClick={() => alternarGrupo(setTimesAtivos, slug, timesDisponiveis)}
                  >
                    <i className="fin-pessoas-matriz-chip-ponto" aria-hidden />
                    {ROTULO_TIME[slug] ?? pessoa?.timeRotulo ?? slug}
                  </button>
                );
              })}
            </div>
          </GrupoFiltro>
          <GrupoFiltro
            rotulo="Área da empresa"
            aberto={mostrarArea}
            estreito={grupoEstreito(areasAtivos, chavesArea)}
            onToggle={() => setMostrarArea((v) => !v)}
          >
            <div className="fin-pessoas-matriz-chips" role="group" aria-label="Áreas da empresa visíveis">
              {areasCatalogo.map((area) => {
                const ligado = estaLigado(areasAtivos, area.slug);
                return (
                  <button
                    key={area.slug}
                    type="button"
                    className={ligado ? "fin-pessoas-matriz-chip ativo" : "fin-pessoas-matriz-chip"}
                    style={{ ["--chip-cor" as string]: corAreaEmpresa(area.slug) }}
                    aria-pressed={ligado}
                    title={DICA_CHIP}
                    onClick={() => alternarGrupo(setAreasAtivos, area.slug, chavesArea)}
                  >
                    <i className="fin-pessoas-matriz-chip-ponto" aria-hidden />
                    {area.nome}
                  </button>
                );
              })}
              <button
                type="button"
                className={estaLigado(areasAtivos, SEM_AREA) ? "fin-pessoas-matriz-chip ativo" : "fin-pessoas-matriz-chip"}
                style={{ ["--chip-cor" as string]: "var(--area-sem_area)" }}
                aria-pressed={estaLigado(areasAtivos, SEM_AREA)}
                title={DICA_CHIP}
                onClick={() => alternarGrupo(setAreasAtivos, SEM_AREA, chavesArea)}
              >
                <i className="fin-pessoas-matriz-chip-ponto" aria-hidden />
                Sem área
              </button>
            </div>
          </GrupoFiltro>
          <GrupoFiltro
            rotulo="Tipo de pagamento"
            aberto={mostrarTipo}
            estreito={grupoEstreito(ativos, naturezasDisponiveis)}
            onToggle={() => setMostrarTipo((v) => !v)}
          >
            <div className="fin-pessoas-matriz-chips" role="group" aria-label="Tipos de pagamento visíveis">
              {naturezasDisponiveis.map((slug) => {
                const ligado = estaLigado(ativos, slug);
                return (
                  <button
                    key={slug}
                    type="button"
                    className={ligado ? "fin-pessoas-matriz-chip ativo" : "fin-pessoas-matriz-chip"}
                    style={{ ["--chip-cor" as string]: COR[slug] ?? "var(--muted)" }}
                    aria-pressed={ligado}
                    title={DICA_CHIP}
                    onClick={() => alternarGrupo(setAtivos, slug, naturezasDisponiveis)}
                  >
                    <i className="fin-pessoas-matriz-chip-ponto" aria-hidden />
                    {ROTULO[slug] ?? slug}
                  </button>
                );
              })}
              <button
                type="button"
                className="fin-btn-ghost fin-pessoas-matriz-ocultar"
                aria-pressed={ocultarDetalhes}
                title="Soma dos tipos ligados, sem a lista colorida embaixo do número"
                onClick={() => setOcultarDetalhes((v) => !v)}
              >
                {ocultarDetalhes ? "Mostrar detalhes" : "Ocultar todos"}
              </button>
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
                setAtivos(ativosIniciais(dados.tiposRemuneracao));
              }}
            >
              Limpar filtros
            </button>
          ) : null}
        </div>
      </div>

      <div
        className="fin-matrix-wrap"
        style={{ ["--matriz-head-h" as string]: `${alturaCabecalho}px` }}
      >
        <table className="fin-table fin-matrix fin-pessoas-matriz-tabela">
          <thead>
            <tr ref={cabecalhoRef}>
              <th className="fin-matrix-head">Pessoa</th>
              {mesesVisiveis.map((mes) => (
                <th key={mes} className="num">
                  {monthKeyLabel(mes)}
                  {mes === mesAtual ? <span className="fin-tag">parcial</span> : null}
                </th>
              ))}
              {mesPrevisto ? (
                <th
                  className="num fin-previsao"
                  title="Soma dos cadastros vigentes: salário-base, pró-labore esperado, comissão do mês e reembolso com parcela a cair"
                >
                  {monthKeyLabel(mesPrevisto)}
                  <span className="fin-tag">previsto</span>
                </th>
              ) : null}
              <th className="num">Total</th>
              <th className="num">Média/mês</th>
              <th
                className="num"
                title="Fixo contratado na planilha de comissionamento, só nos meses em que ela existe"
              >
                Fixo
              </th>
              <th className="num" title="Realizado menos o fixo contratado, nos mesmos meses">
                Acima
              </th>
              <th className="num">Δ</th>
            </tr>
            {linhas.length ? (
              <LinhaTotal
                rotulo={`Total · ${linhas.length}`}
                mesesVisiveis={mesesVisiveis}
                mesPrevisto={mesPrevisto}
                linhas={linhas}
                ativos={ativos}
                naturezasDisponiveis={naturezasDisponiveis}
                totalPorMes={totalPorMes}
                totalPrevisao={totalPrevisao}
                totalGeral={totalGeral}
                totalFixo={totalFixo}
                totalExcedente={totalExcedente}
                temFixo={temFixo}
                temExcedente={temExcedente}
                ocultarDetalhes={ocultarDetalhes}
              />
            ) : null}
          </thead>
          <tbody>
            {linhas.map((linha) => {
              const prevTotal = somarAtivos(linha.previsao, ativos);
              const prevComps = compsAtivos(linha.previsao, ativos, naturezasDisponiveis);
              const r = linha.resumo;
              return (
                <tr key={linha.pessoa.id}>
                  <th className="fin-matrix-head" scope="row">
                    <div className="fin-pessoas-matriz-pessoa-bloco">
                      <a
                        className="fin-pessoas-nome-link fin-pessoas-matriz-pessoa"
                        href={`/financeiro/pessoas/${linha.pessoa.id}`}
                      >
                        <span className="fin-pessoas-nome">
                          <span className="fin-pessoas-nome-texto">
                            <span className="fin-desc">{linha.pessoa.nome}</span>
                          </span>
                          <ChevronRight
                            className="fin-pessoas-nome-seta"
                            size={15}
                            strokeWidth={2.2}
                            aria-hidden
                          />
                        </span>
                      </a>
                      <div
                        className="fin-pessoas-matriz-cadastro"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <CelulaArea pessoa={linha.pessoa} areas={dados.areas} />
                        <CelulaAreasEmpresa pessoa={linha.pessoa} areas={areasCatalogo} />
                      </div>
                    </div>
                  </th>
                  {mesesVisiveis.map((mes) => {
                    const total = somarAtivos(linha.porTipoMes[mes], ativos);
                    const comps = compsAtivos(linha.porTipoMes[mes], ativos, naturezasDisponiveis);
                    return (
                      <td key={mes} className="num fin-table-money">
                        {total ? (
                          <CelulaComposta total={total} comps={comps} ocultarDetalhes={ocultarDetalhes} />
                        ) : (
                          <span className="fin-zero">—</span>
                        )}
                      </td>
                    );
                  })}
                  {mesPrevisto ? (
                    <td className="num fin-table-money fin-previsao fin-previsao-celula">
                      <div className="fin-previsao-celula-conteudo">
                        {prevTotal ? (
                          <CelulaComposta total={prevTotal} comps={prevComps} ocultarDetalhes={ocultarDetalhes} />
                        ) : (
                          <span className="fin-zero">—</span>
                        )}
                        <BotaoPrevisaoPessoa
                          personId={linha.pessoa.id}
                          nome={linha.pessoa.nome}
                          mesPrevisto={mesPrevisto}
                          previstoCents={prevTotal}
                        />
                      </div>
                    </td>
                  ) : null}
                  <td className="num fin-table-money">
                    {linha.totalAtivoCents ? (
                      <CelulaComposta
                        total={linha.totalAtivoCents}
                        comps={naturezasDisponiveis
                          .map((slug) => ({
                            slug,
                            cents: mesesVisiveis.reduce(
                              (s, mes) => s + (linha.porTipoMes[mes]?.[slug] ?? 0),
                              0
                            )
                          }))
                          .filter((c) => ativos[c.slug] && c.cents > 0)}
                        forte
                        ocultarDetalhes={ocultarDetalhes}
                      />
                    ) : (
                      <span className="fin-zero">—</span>
                    )}
                  </td>
                  <td className="num fin-table-money">
                    {r?.mediaMensalCents ? brlPrecise(r.mediaMensalCents) : <span className="fin-zero">—</span>}
                  </td>
                  <td className="num fin-table-money fin-previsao">
                    {r?.fixoContratadoCents == null ? (
                      <span className="fin-zero">—</span>
                    ) : (
                      <span title={`Soma do fixo em ${r.mesesPactuados.map(monthKeyLabel).join(", ")}`}>
                        {brlPrecise(r.fixoContratadoCents)}
                      </span>
                    )}
                  </td>
                  <td className="num fin-table-money">
                    {r?.excedenteCents == null ? (
                      <span className="fin-zero">—</span>
                    ) : (
                      <span className={r.excedenteCents > 0 ? "fin-out" : undefined}>
                        {brlPrecise(r.excedenteCents)}
                      </span>
                    )}
                  </td>
                  <td className="num">
                    {r?.variacaoPct == null ? (
                      <span className="fin-zero">—</span>
                    ) : (
                      <span
                        className={
                          Math.abs(r.variacaoPct) < 0.5
                            ? "fin-pessoas-delta neutro"
                            : r.variacaoPct > 0
                              ? "fin-pessoas-delta sobe"
                              : "fin-pessoas-delta desce"
                        }
                        title={
                          r.primeiroMes && r.ultimoMes
                            ? `${monthKeyLabel(r.primeiroMes)} → ${monthKeyLabel(r.ultimoMes)}`
                            : undefined
                        }
                      >
                        {r.variacaoPct >= 0 ? "+" : "−"}
                        {pct(Math.abs(r.variacaoPct), 0)}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {!linhas.length ? (
              <tr>
                <td colSpan={colunas} className="fin-empty-row">
                  Nenhuma pessoa com os componentes ligados neste recorte.
                </td>
              </tr>
            ) : null}
          </tbody>
          <tfoot>
            {linhas.length ? (
              <LinhaTotal
                rotulo="Total"
                mesesVisiveis={mesesVisiveis}
                mesPrevisto={mesPrevisto}
                linhas={linhas}
                ativos={ativos}
                naturezasDisponiveis={naturezasDisponiveis}
                totalPorMes={totalPorMes}
                totalPrevisao={totalPrevisao}
                totalGeral={totalGeral}
                totalFixo={totalFixo}
                totalExcedente={totalExcedente}
                temFixo={temFixo}
                temExcedente={temExcedente}
                ocultarDetalhes={ocultarDetalhes}
              />
            ) : null}
          </tfoot>
        </table>
      </div>
      {rodape}
    </FinSecaoColapsavel>
    </>
  );
}

type LinhaMatriz = {
  porTipoMes: Record<string, Record<string, number>>;
  previsao: Record<string, number>;
};

function LinhaTotal({
  rotulo,
  mesesVisiveis,
  mesPrevisto,
  linhas,
  ativos,
  naturezasDisponiveis,
  totalPorMes,
  totalPrevisao,
  totalGeral,
  totalFixo,
  totalExcedente,
  temFixo,
  temExcedente,
  ocultarDetalhes
}: {
  rotulo: string;
  mesesVisiveis: string[];
  mesPrevisto: string | null;
  linhas: LinhaMatriz[];
  ativos: Ativos;
  naturezasDisponiveis: readonly string[];
  totalPorMes: Record<string, number>;
  totalPrevisao: number;
  totalGeral: number;
  totalFixo: number;
  totalExcedente: number;
  temFixo: boolean;
  temExcedente: boolean;
  ocultarDetalhes?: boolean;
}) {
  return (
    <tr className="fin-pessoas-matriz-totais">
      <th className="fin-matrix-head" scope="row">
        {rotulo}
      </th>
      {mesesVisiveis.map((mes) => (
        <td key={mes} className="num fin-table-money">
          {totalPorMes[mes] ? (
            <CelulaComposta
              total={totalPorMes[mes]}
              comps={naturezasDisponiveis
                .map((slug) => ({
                  slug,
                  cents: linhas.reduce((s, l) => s + (l.porTipoMes[mes]?.[slug] ?? 0), 0)
                }))
                .filter((c) => ativos[c.slug] && c.cents > 0)}
              forte
              ocultarDetalhes={ocultarDetalhes}
            />
          ) : (
            <span className="fin-zero">—</span>
          )}
        </td>
      ))}
      {mesPrevisto ? (
        <td className="num fin-table-money fin-previsao">
          {totalPrevisao ? (
            <CelulaComposta
              total={totalPrevisao}
              comps={naturezasDisponiveis
                .map((slug) => ({
                  slug,
                  cents: linhas.reduce((s, l) => s + (l.previsao[slug] ?? 0), 0)
                }))
                .filter((c) => ativos[c.slug] && c.cents > 0)}
              forte
              ocultarDetalhes={ocultarDetalhes}
            />
          ) : (
            <span className="fin-zero">—</span>
          )}
        </td>
      ) : null}
      <td className="num fin-table-money">
        <strong>{brlPrecise(totalGeral)}</strong>
      </td>
      <td className="num fin-table-money">
        {mesesVisiveis.length ? brlPrecise(Math.round(totalGeral / mesesVisiveis.length)) : "—"}
      </td>
      <td className="num fin-table-money fin-previsao">
        {temFixo ? <strong>{brlPrecise(totalFixo)}</strong> : <span className="fin-zero">—</span>}
      </td>
      <td className="num fin-table-money">
        {temExcedente ? <strong>{brlPrecise(totalExcedente)}</strong> : <span className="fin-zero">—</span>}
      </td>
      <td />
    </tr>
  );
}

function CelulaComposta({
  total,
  comps,
  forte,
  ocultarDetalhes
}: {
  total: number;
  comps: { slug: string; cents: number }[];
  forte?: boolean;
  ocultarDetalhes?: boolean;
}) {
  return (
    <span className="fin-pessoas-matriz-cel">
      {forte ? <strong>{brlPrecise(total)}</strong> : brlPrecise(total)}
      {ocultarDetalhes
        ? null
        : comps.map((c) => (
            <small
              key={c.slug}
              className="fin-pessoas-matriz-comp"
              style={{ color: COR[c.slug] ?? "var(--muted)" }}
              title={ROTULO[c.slug] ?? c.slug}
            >
              ({brlPrecise(c.cents)})
            </small>
          ))}
    </span>
  );
}

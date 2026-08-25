"use client";

import { useCallback, useMemo, useState, type CSSProperties } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import { ChartFrame } from "@/components/charts/ChartFrame";
import { brlCompact, brlPrecise, dateLabel, pct } from "@/lib/financeiro/format";
import type {
  MesDoCartao,
  NaoItemizadoDoMes,
  QuebraDoPainel,
  RankingDoPainel,
  TransacaoDoPainel
} from "@/lib/financeiro/contratos/cartao-painel";

/**
 * A análise do gasto de cartão: quem pesa, sob qual eixo, em que mês, cruzado
 * com qual plástico.
 *
 * ---------------------------------------------------------------------------
 * TRÊS ESTADOS, E DOIS DELES SÃO "NÃO SEI" DIFERENTES
 * ---------------------------------------------------------------------------
 * O erro que este componente existe para não cometer é tratar todo buraco como
 * o mesmo buraco. Em 2026 o cartão custou R$ 115.095,91 e só R$ 62.421,09 chega
 * itemizado. Dentro do itemizado, R$ 49.703,98 não têm núcleo. São coisas
 * distintas e têm desenhos distintos:
 *
 *   classificado ... sólido. Tem dono, decompõe-se nas fatias coloridas.
 *   lacuna ......... hachura ROXA a 135° (`--cert-indet`, o vocabulário da casa
 *                    em `FinCartaoHistorico`). Gasto itemizado que ninguém
 *                    classificou — RESOLVÍVEL: a fila de qualificação resolve.
 *   opaco .......... pontilhado GRAFITE. Gasto não itemizado: o emissor manda
 *                    só o pagamento da fatura (o Banco Inter inteiro, R$ 40.862,41).
 *                    NÃO é resolvível qualificando — a fonte nunca vai contar.
 *
 * Pintar os dois de roxo mandaria alguém abrir a fila para resolver R$ 40 mil
 * que nenhuma fila resolve.
 *
 * O denominador honesto é um DESENHO, não um parágrafo: a faixa de cobertura
 * mostra os três pedaços em escala, com os números em cima. Quem lê "Marketing
 * é 30%" vê, na mesma linha, de quanto é os 30%.
 *
 * ---------------------------------------------------------------------------
 * UM TOTAL SÓ EM TODO O COMPONENTE: R$ 62.421,09
 * ---------------------------------------------------------------------------
 * As quebras do contrato são do ANO CORRENTE. Tudo que este componente deriva
 * de `transacoes` — composição mensal e as duas matrizes — usa o MESMO recorte
 * (competência dentro do ano), e não 2026-em-diante. As parcelas que o emissor
 * já lançou para 2027 são dado verdadeiro, mas somá-las aqui faria a soma das
 * matrizes divergir da soma das fatias, e duas somas do mesmo total que não
 * batem destroem a confiança na página inteira.
 *
 * ---------------------------------------------------------------------------
 * NÃO EXISTE "QUEM COMPROU"
 * ---------------------------------------------------------------------------
 * `fin_card_transaction` não tem pessoa. Uma coluna "comprador" vazia seria uma
 * promessa que o dado não cumpre, então ela não existe. O que existe é
 * `classificadoPor` — quem QUALIFICOU o lançamento, regra ou gente — e é isso
 * que o chip diz, com essas palavras.
 *
 * ---------------------------------------------------------------------------
 * AS CORES
 * ---------------------------------------------------------------------------
 * Quatro categóricas mais cinza de "Outros" mais o roxo do indeterminado. A
 * sequência na ordem em que empilha passa os seis testes do validador de paleta
 * NOS DOIS TEMAS (faixa de luminosidade OKLCH, piso de croma, separação para
 * daltonismo — pior par adjacente ΔE 8,1 em protanopia —, piso de visão normal
 * ΔE 17,7 e contraste ≥ 3:1 nas duas superfícies). São hex literais, e não
 * `var(--…)`, porque o `ChartFrame` exporta PNG serializando o SVG: variável de
 * CSS não sobrevive à serialização e o gráfico baixado sairia preto.
 *
 * O cinza reprova o piso de croma de propósito — ele É o balde "Outros", e ler
 * como cinza é o trabalho dele. O roxo carrega hachura como codificação
 * secundária, então quem não distingue a cor distingue a textura.
 *
 * Verde ficou fora: nesta base verde é ENTRADA, e cartão é saída inteira.
 *
 * ---------------------------------------------------------------------------
 * AS TRÊS QUE VIRAM COM O TEMA: ATRIBUTO **E** CLASSE
 * ---------------------------------------------------------------------------
 * A paleta categórica acima é a MESMA nos dois temas de propósito — cada cor
 * dela foi escolhida para dar 3:1 nas duas superfícies. As três abaixo não
 * podem ser: elas descrevem a superfície, e superfície que vira sem elas
 * virarem reprova contraste. Medido no escuro antes desta correção:
 *
 *   roxo do indeterminado ... 2,71:1 sobre o card (piso 3:1) — e é ele que
 *                             pinta a MAIOR fatia do gráfico.
 *   tinta fraca ............. 3,68:1 em texto de 11 px (piso 4,5:1).
 *   grade ................... 14,3:1 — quase branca, gritando exatamente onde
 *                             o elemento deveria sumir.
 *
 * O conserto é o do irmão `FinCartaoPainelTopo`, e são DOIS caminhos que
 * convivem, não uma troca: o hex literal continua no ATRIBUTO, porque o PNG do
 * `ChartFrame` sai sem o CSS da página e `var(--…)` não sobrevive à
 * serialização; e uma CLASSE por cima carrega o token, que vira com o tema.
 * Regra de folha de estilo ganha de atributo de apresentação, então a classe
 * vence na tela sem apagar o atributo. O atributo salva o PNG, a classe salva
 * o tema — e por isso cada literal abaixo é o valor do token no tema CLARO: os
 * dois caminhos dizem a mesma coisa onde se encontram.
 */

/** Ordem de empilhamento (de baixo para cima) — é a ordem validada. */
const COR_OUTROS = "#7c8a93";
const SERIE = ["#d9612e", "#2a78d6", "#b67818", "#c94f85"];

/** `--cert-indet` no claro. Classes: `-hachura-fundo/-linha`, `-faixa-lacuna`. */
const COR_INDET = "#6b4e8f";
/** `--muted` no claro. Classe: `-tinta-fraca`, mais os ticks que o recharts nomeia. */
const TINTA_FRACA = "#5c6970";
/** `--line` no claro. Classe: os elementos de grade que o recharts nomeia. */
const GRADE = "#dce5e8";
const HACHURA = "url(#fin-cartao-an-hachura)";

const TOPO = SERIE.length;

type Eixo = "categoria" | "nucleo" | "centro";

const EIXOS: { chave: Eixo; nome: string; sem: string; curto: string }[] = [
  { chave: "categoria", nome: "Categoria", sem: "Sem categoria", curto: "categoria" },
  { chave: "nucleo", nome: "Núcleo", sem: "Sem núcleo", curto: "núcleo" },
  { chave: "centro", nome: "Centro de custo", sem: "Sem centro de custo", curto: "centro de custo" }
];

type Faixa = {
  /** O rótulo é a chave: é ele que casa transação, quebra, legenda e matriz. */
  rotulo: string;
  cor: string;
  lacuna: boolean;
};

type Props = {
  ranking: RankingDoPainel[];
  porCategoria: QuebraDoPainel[];
  porNucleo: QuebraDoPainel[];
  porCentro: QuebraDoPainel[];
  transacoes: TransacaoDoPainel[];
  serie: MesDoCartao[];
  /**
   * O que a fonte não itemiza. Vazio significa "o emissor entrega tudo" — e é
   * por isso que ele tem default: uma base sem buraco não deve quebrar a tela.
   */
  naoItemizado?: NaoItemizadoDoMes[];
  /** O ano das quebras. Todo recorte deste componente é ele. */
  ano?: number;
};

/**
 * O que se diz de um emissor que não itemiza. Quatro palavras, da CASA — o
 * mesmo verbo que o irmão `FinCartaoPainelTopo` já usa ("a fonte não abre as
 * compras"), para as duas telas falarem a mesma língua.
 *
 * Não é tradução do motivo da fonte, é substituição dele. Aquele texto vinha
 * cru do banco: cifra em formato americano (`4,191.06`, `.00`) brigando com o
 * R$ da mesma linha, sem acento, e com referência interna (`ver 0047 §3`)
 * vazando para quem só quer saber quem não conta o que gastou. O valor já está
 * ao lado; aqui cabe o porquê, e ele cabe em quatro palavras.
 */
const SEM_ITENS = "não abre as compras";

const inicial = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const rotuloMes = (mes: string) => {
  const [ano, m] = mes.slice(0, 7).split("-");
  return `${m}/${ano.slice(2)}`;
};

const cortar = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Estilo com custom property — o TS não conhece `--i`, e o cast é o preço. */
const vars = (v: Record<string, string | number>) => v as CSSProperties;

const nomeDoCartao = (apelido: string | null, last4: string | null) =>
  apelido ?? (last4 ? `final ${last4}` : "sem cartão identificado");

export function FinCartaoAnalise({
  ranking,
  porCategoria,
  porNucleo,
  porCentro,
  transacoes,
  serie,
  naoItemizado = [],
  ano = new Date().getFullYear()
}: Props) {
  const [eixo, setEixo] = useState<Eixo>("nucleo");
  const [soSemDono, setSoSemDono] = useState(false);

  const prefixo = String(ano);
  const meta = EIXOS.find((e) => e.chave === eixo) ?? EIXOS[1];
  const quebra = eixo === "categoria" ? porCategoria : eixo === "nucleo" ? porNucleo : porCentro;

  // O valor bruto do eixo numa transação e num item do ranking. Null é null:
  // ele nunca vira "" nem "outros" — é o estado que este componente persegue.
  const bruto = useCallback(
    (t: { categoria: string | null; nucleo: string | null; centro: string | null }) =>
      eixo === "categoria" ? t.categoria : eixo === "nucleo" ? t.nucleo : t.centro,
    [eixo]
  );

  const analise = useMemo(() => {
    const linhaSem = quebra.find((l) => l.chave === "sem") ?? null;
    const semRotulo = linhaSem?.rotulo ?? meta.sem;
    const conhecidas = quebra.filter((l) => l.chave !== "sem");

    // O rótulo derivado da transação tem de ser IDÊNTICO ao da quebra, senão a
    // cor de uma fatia muda entre o gráfico e a matriz. Núcleo é o único que o
    // SQL capitaliza (`initcap`), então é o único que capitalizo aqui.
    const rotuloDe = (valor: string | null) =>
      valor === null ? semRotulo : eixo === "nucleo" ? inicial(valor) : valor;

    // Cor segue a ENTIDADE, não o posto: o mapa é montado uma vez, da quebra do
    // ano, e vale para ranking, composição e matriz. Trocar de eixo repinta;
    // filtrar dentro de um eixo, não.
    const cores = new Map<string, string>();
    conhecidas.forEach((l, i) => cores.set(l.rotulo, i < TOPO ? SERIE[i] : COR_OUTROS));
    cores.set(semRotulo, COR_INDET);

    // As faixas empilháveis, na ordem validada de baixo para cima.
    const faixas: Faixa[] = [];
    if (conhecidas.length > TOPO) faixas.push({ rotulo: "Outros", cor: COR_OUTROS, lacuna: false });
    conhecidas.slice(0, TOPO).forEach((l, i) => faixas.push({ rotulo: l.rotulo, cor: SERIE[i], lacuna: false }));
    faixas.push({ rotulo: semRotulo, cor: COR_INDET, lacuna: true });

    const indiceDaFaixa = new Map<string, number>();
    faixas.forEach((f, i) => indiceDaFaixa.set(f.rotulo, i));
    const iOutros = conhecidas.length > TOPO ? 0 : -1;
    const faixaDe = (valor: string | null) => {
      const r = rotuloDe(valor);
      const i = indiceDaFaixa.get(r);
      return i === undefined ? iOutros : i;
    };

    const classificadoCents = conhecidas.reduce((s, l) => s + l.valorCents, 0);
    const lacunaCents = linhaSem?.valorCents ?? 0;
    const itemizadoCents = classificadoCents + lacunaCents;
    const itens = quebra.reduce((s, l) => s + l.itens, 0);

    // Degenerado: o eixo inteiro é indeterminado. Um gráfico de uma fatia só é
    // um retângulo — não há comparação nenhuma dentro dele.
    const degenerado = quebra.length > 0 && conhecidas.length === 0;

    return {
      semRotulo,
      conhecidas,
      linhaSem,
      cores,
      faixas,
      faixaDe,
      rotuloDe,
      classificadoCents,
      lacunaCents,
      itemizadoCents,
      itens,
      degenerado
    };
  }, [quebra, eixo, meta.sem]);

  // -------------------------------------------------------------------------
  // O que a fonte não entrega, no ano. Agrupado por emissor: a pergunta é
  // "quem não conta", e a resposta é um nome, não um mês.
  //
  // O MOTIVO DA FONTE NÃO SOBE PARA O ACUMULADO. A view guarda um motivo por
  // LINHA, com os números do mês daquela linha; a primeira versão pegava o do
  // primeiro mês e o colava na soma de oito, e a tela mostrava "a fonte declara
  // 4,191.06" ao lado de R$ 40.862,41 — duas cifras que se contradizem na mesma
  // linha, e a menor com cara de ser a verdadeira. O contrato hoje devolve
  // `motivo` nulo de propósito (o `min()` saiu do SQL), mas o campo continua
  // sendo lido para o dia em que voltar: só sobrevive o que TODOS os meses do
  // emissor repetem, isto é, um motivo do ANO. Quem fala com o usuário é
  // `SEM_ITENS` — frase da casa, sem número para contradizer o da linha.
  // -------------------------------------------------------------------------
  const opaco = useMemo(() => {
    const doAno = naoItemizado.filter((x) => x.mes.startsWith(prefixo));
    const porEmissor = new Map<string, { valorCents: number; motivo: string | null }>();
    for (const x of doAno) {
      const nome = x.emissor ?? "emissor não identificado";
      const atual = porEmissor.get(nome);
      if (!atual) {
        porEmissor.set(nome, { valorCents: x.valorCents, motivo: x.motivo });
        continue;
      }
      atual.valorCents += x.valorCents;
      if (atual.motivo !== x.motivo) atual.motivo = null;
    }
    const linhas = [...porEmissor.entries()]
      .map(([emissor, v]) => ({ emissor, ...v }))
      .sort((a, b) => b.valorCents - a.valorCents);
    return { cents: linhas.reduce((s, l) => s + l.valorCents, 0), linhas };
  }, [naoItemizado, prefixo]);

  const totalAnoCents = analise.itemizadoCents + opaco.cents;

  // -------------------------------------------------------------------------
  // Composição mensal. Realizado e previsto em PILHAS SEPARADAS, lado a lado:
  // no mês corrente os dois convivem, e uma pilha só afirmaria que o mês já
  // fechou por um valor que ainda pode mudar.
  // -------------------------------------------------------------------------
  const composicao = useMemo(() => {
    const doAno = transacoes.filter((t) => t.competencia.startsWith(prefixo));
    const meses = [
      ...new Set([
        ...serie.filter((s) => s.mes.startsWith(prefixo)).map((s) => s.mes),
        ...doAno.map((t) => t.competencia)
      ])
    ].sort();

    const n = analise.faixas.length;
    const linhas = meses.map((mes) => {
      const ponto: Record<string, number | string> = { mes, rotulo: rotuloMes(mes) };
      for (let i = 0; i < n; i += 1) {
        ponto[`r${i}`] = 0;
        ponto[`p${i}`] = 0;
      }
      ponto.totalR = 0;
      ponto.totalP = 0;
      ponto.itens = 0;
      return ponto;
    });
    const porMes = new Map(linhas.map((l) => [l.mes as string, l]));

    for (const t of doAno) {
      const linha = porMes.get(t.competencia);
      if (!linha) continue;
      const i = analise.faixaDe(bruto(t));
      if (i < 0) continue;
      const alvo = t.status === "POSTED" ? `r${i}` : `p${i}`;
      linha[alvo] = (linha[alvo] as number) + t.valorCents / 100;
      const total = t.status === "POSTED" ? "totalR" : "totalP";
      linha[total] = (linha[total] as number) + t.valorCents / 100;
      linha.itens = (linha.itens as number) + 1;
    }

    const temPrevisto = linhas.some((l) => (l.totalP as number) > 0);
    return { linhas, temPrevisto };
  }, [transacoes, serie, analise, prefixo, bruto]);

  // -------------------------------------------------------------------------
  // Cruzamento 1 — cartão × eixo. Qual plástico é usado para quê.
  // -------------------------------------------------------------------------
  const cruzCartao = useMemo(() => {
    const doAno = transacoes.filter((t) => t.competencia.startsWith(prefixo));
    const n = analise.faixas.length;
    const porCartao = new Map<string, number[]>();
    for (const t of doAno) {
      const nome = nomeDoCartao(t.apelido, t.last4);
      const celulas = porCartao.get(nome) ?? new Array<number>(n).fill(0);
      const i = analise.faixaDe(bruto(t));
      if (i >= 0) celulas[i] += t.valorCents;
      porCartao.set(nome, celulas);
    }
    return [...porCartao.entries()]
      .map(([rotulo, celulas]) => ({ rotulo, celulas, total: celulas.reduce((s, v) => s + v, 0) }))
      .sort((a, b) => b.total - a.total);
  }, [transacoes, analise, prefixo, bruto]);

  // -------------------------------------------------------------------------
  // Cruzamento 2 — mês × núcleo. Fixo no núcleo de propósito: é o eixo da
  // pergunta "obra ou casa?", e ela não deve depender do seletor.
  // -------------------------------------------------------------------------
  const cruzNucleo = useMemo(() => {
    const semRotulo = porNucleo.find((l) => l.chave === "sem")?.rotulo ?? "Sem núcleo";
    const conhecidos = porNucleo.filter((l) => l.chave !== "sem");
    const colunas: Faixa[] = [
      ...conhecidos.slice(0, TOPO).map((l, i) => ({ rotulo: l.rotulo, cor: SERIE[i], lacuna: false })),
      { rotulo: semRotulo, cor: COR_INDET, lacuna: true }
    ];
    const indice = new Map(colunas.map((c, i) => [c.rotulo, i]));

    const doAno = transacoes.filter((t) => t.competencia.startsWith(prefixo));
    const porMes = new Map<string, number[]>();
    for (const t of doAno) {
      const celulas = porMes.get(t.competencia) ?? new Array<number>(colunas.length).fill(0);
      const i = indice.get(t.nucleo === null ? semRotulo : inicial(t.nucleo));
      if (i !== undefined) celulas[i] += t.valorCents;
      porMes.set(t.competencia, celulas);
    }
    const linhas = [...porMes.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([mes, celulas]) => ({
        rotulo: rotuloMes(mes),
        celulas,
        total: celulas.reduce((s, v) => s + v, 0)
      }));
    return { colunas, linhas };
  }, [transacoes, porNucleo, prefixo]);

  // -------------------------------------------------------------------------
  // Ranking. Quem qualificou o lançamento vem de `transacoes` — e é "quem
  // qualificou", nunca "quem comprou": o cartão sincronizado não tem pessoa.
  // -------------------------------------------------------------------------
  const qualificadores = useMemo(
    () => new Map(transacoes.map((t) => [t.id, t.classificadoPor])),
    [transacoes]
  );

  const posicao = useMemo(() => new Map(ranking.map((r, i) => [r.id, i + 1])), [ranking]);
  const rankingVisivel = soSemDono ? ranking.filter((r) => bruto(r) === null) : ranking;
  const tetoRanking = ranking.reduce((m, r) => Math.max(m, r.valorCents), 0);
  const semDono = ranking.filter((r) => bruto(r) === null).length;

  const alturaQuebra = Math.max(150, quebra.length * 27 + 24);

  return (
    <div className="fin-cartao-an">
      <Hachura />

      {/* ------------------------------------------------------------------
          O controle é um só e governa o componente inteiro: ranking, quebra,
          composição e a matriz de cartão. Trocar o eixo repinta as três coisas
          com o mesmo mapa de cores, então a leitura atravessa as seções.
         ------------------------------------------------------------------ */}
      <div className="fin-cartao-an-barra">
        <div className="fin-cartao-an-seg" role="group" aria-label="Eixo da análise">
          {EIXOS.map((e) => (
            <button key={e.chave} type="button" aria-pressed={eixo === e.chave} onClick={() => setEixo(e.chave)}>
              {e.nome}
            </button>
          ))}
        </div>
        <label className="fin-cartao-an-check" data-ligado={soSemDono ? "1" : "0"}>
          <input type="checkbox" checked={soSemDono} onChange={(ev) => setSoSemDono(ev.target.checked)} />
          só os maiores sem {meta.curto} ({semDono} de {ranking.length})
        </label>
      </div>

      {/* ================================================================== */}
      {/* 1. Ranking                                                          */}
      {/* ================================================================== */}
      <section className="fin-cartao-an-secao">
        <header>
          <h3 className="fin-cartao-an-titulo">Os maiores gastos de {ano}</h3>
          <p className="fin-cartao-an-sub">
            Barra proporcional ao valor, pintada pelo {meta.curto} do lançamento. Hachurada e com marca na
            borda quando não tem: <strong>{semDono}</strong> dos {ranking.length} maiores estão sem{" "}
            {meta.curto}.
          </p>
        </header>
        {!rankingVisivel.length ? (
          <p className="fin-cartao-an-vazio">
            {ranking.length ? `Nenhum dos maiores está sem ${meta.curto}.` : "Sem compra registrada no ano."}
          </p>
        ) : (
          <ol className="fin-cartao-an-rank">
            {rankingVisivel.map((r) => {
              const valor = bruto(r);
              const rotulo = analise.rotuloDe(valor);
              const cor = analise.cores.get(rotulo) ?? COR_OUTROS;
              const lacuna = valor === null;
              const orfa = r.categoria === null || r.nucleo === null || r.centro === null;
              const largura = tetoRanking ? (r.valorCents / tetoRanking) * 100 : 0;
              const quem = qualificadores.get(r.id) ?? null;
              return (
                <li key={r.id} className="fin-cartao-an-rank-linha" data-orfa={orfa ? "1" : "0"}>
                  <div className="fin-cartao-an-rank-topo">
                    <span className="fin-cartao-an-rank-pos">{posicao.get(r.id)}</span>
                    <span className="fin-cartao-an-rank-desc" title={r.descricao}>
                      {r.descricao}
                    </span>
                    <span className="fin-cartao-an-rank-valor">{brlPrecise(r.valorCents)}</span>
                  </div>
                  <div className="fin-cartao-an-rank-trilho">
                    <div
                      className={`fin-cartao-an-rank-barra${lacuna ? " fin-cartao-an-tex-lacuna" : ""}`}
                      data-lacuna={lacuna ? "1" : "0"}
                      style={{ width: `${largura}%`, background: lacuna ? undefined : cor }}
                    />
                  </div>
                  <div className="fin-cartao-an-rank-meta">
                    <span className="fin-cartao-an-chip">{dateLabel(r.postedOn)}</span>
                    <span className="fin-cartao-an-chip">{nomeDoCartao(r.apelido, r.last4)}</span>
                    <Chip rotulo={r.categoria} falta="sem categoria" />
                    <Chip rotulo={r.nucleo === null ? null : inicial(r.nucleo)} falta="sem núcleo" />
                    <Chip rotulo={r.centro} falta="sem centro de custo" />
                    {quem ? <span className="fin-cartao-an-chip">qualificado por {quem}</span> : null}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {/* ================================================================== */}
      {/* 2. Quebra por eixo, com o denominador em cima                       */}
      {/* ================================================================== */}
      <section className="fin-cartao-an-secao">
        <header>
          <h3 className="fin-cartao-an-titulo">Quebra por {meta.curto}</h3>
          <p className="fin-cartao-an-sub">
            A análise cobre <strong>{brlPrecise(analise.itemizadoCents)}</strong> dos{" "}
            <strong>{brlPrecise(totalAnoCents)}</strong> gastos em {ano}.
          </p>
        </header>

        <Cobertura
          classificadoCents={analise.classificadoCents}
          lacunaCents={analise.lacunaCents}
          opacoCents={opaco.cents}
          semRotulo={analise.semRotulo}
          linhasOpacas={opaco.linhas}
        />

        {analise.degenerado ? (
          <div className="fin-cartao-an-degenerado">
            <div className="fin-cartao-an-degenerado-faixa fin-cartao-an-tex-lacuna">
              {analise.itens} lançamentos · {brlPrecise(analise.itemizadoCents)} · 100 % sem {meta.curto}
            </div>
            <p>
              Nenhum lançamento de cartão tem {meta.curto}. Não há quebra, composição mensal nem
              cruzamento por este eixo enquanto ninguém atribuir o primeiro —{" "}
              <strong>a fila de qualificação, nesta mesma tela, é onde isso se resolve</strong>. Os outros
              dois eixos já respondem.
            </p>
          </div>
        ) : !quebra.length ? (
          <p className="fin-cartao-an-vazio">Sem gasto de cartão em {ano}.</p>
        ) : (
          <div className="fin-cartao-an-quebra">
            <ChartFrame titulo={`Cartão ${ano} — por ${meta.curto}`}>
              <ResponsiveContainer width="100%" height={alturaQuebra}>
                <BarChart
                  data={quebra.map((l) => ({
                    rotulo: l.rotulo,
                    valor: l.valorCents / 100,
                    itens: l.itens,
                    parte: analise.itemizadoCents ? (l.valorCents / analise.itemizadoCents) * 100 : 0,
                    lacuna: l.chave === "sem",
                    cor: analise.cores.get(l.rotulo) ?? COR_OUTROS
                  }))}
                  layout="vertical"
                  margin={{ top: 4, right: 92, bottom: 4, left: 4 }}
                >
                  <XAxis type="number" hide />
                  <YAxis
                    type="category"
                    dataKey="rotulo"
                    width={150}
                    tick={{ fontSize: 11.5, fill: TINTA_FRACA }}
                    tickFormatter={(v: string) => cortar(v, 24)}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<DicaQuebra />} cursor={{ fill: "rgba(23,51,58,.05)" }} />
                  <Bar dataKey="valor" radius={[0, 3, 3, 0]} maxBarSize={19}>
                    {quebra.map((l) => (
                      <Cell
                        key={l.chave}
                        className={l.chave === "sem" ? "fin-cartao-an-faixa-lacuna" : undefined}
                        fill={l.chave === "sem" ? HACHURA : analise.cores.get(l.rotulo) ?? COR_OUTROS}
                        stroke={l.chave === "sem" ? COR_INDET : undefined}
                        strokeWidth={l.chave === "sem" ? 1 : 0}
                      />
                    ))}
                    {/* `fill` vai como ATRIBUTO, e não dentro de `style`: estilo
                        embutido ganha de folha de estilo e travaria a tinta no
                        claro. Como atributo, o PNG continua levando a cor e a
                        classe consegue trocá-la no tema escuro. */}
                    <LabelList
                      dataKey="valor"
                      position="right"
                      className="fin-cartao-an-tinta-fraca"
                      fill={TINTA_FRACA}
                      formatter={(v: number) => brlCompact(v * 100)}
                      style={{ fontSize: 11.5, fontWeight: 600 }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartFrame>

            <table className="fin-cartao-an-tabela">
              <thead>
                <tr>
                  <th>{meta.nome}</th>
                  <th className="num">Valor</th>
                  <th className="num">Itens</th>
                  <th className="num">% do itemizado</th>
                </tr>
              </thead>
              <tbody>
                {quebra.map((l) => {
                  const lacuna = l.chave === "sem";
                  return (
                    <tr key={l.chave} data-lacuna={lacuna ? "1" : "0"}>
                      <td>
                        <span className="fin-cartao-an-rotulo">
                          <i
                            className={`fin-cartao-an-ponto${lacuna ? " fin-cartao-an-tex-lacuna" : ""}`}
                            style={{ background: lacuna ? undefined : analise.cores.get(l.rotulo) }}
                            aria-hidden
                          />
                          <span title={l.rotulo}>{l.rotulo}</span>
                        </span>
                      </td>
                      <td className="num">{brlPrecise(l.valorCents)}</td>
                      <td className="num">{l.itens}</td>
                      <td className="num">
                        {pct(analise.itemizadoCents ? (l.valorCents / analise.itemizadoCents) * 100 : 0, 1)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td>Itemizado em {ano}</td>
                  <td className="num">{brlPrecise(analise.itemizadoCents)}</td>
                  <td className="num">{analise.itens}</td>
                  <td className="num">{pct(100, 0)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      {/* ================================================================== */}
      {/* 3. Composição mensal                                                */}
      {/* ================================================================== */}
      {analise.degenerado ? null : (
        <section className="fin-cartao-an-secao">
          <header>
            <h3 className="fin-cartao-an-titulo">Composição mês a mês, por {meta.curto}</h3>
            <p className="fin-cartao-an-sub">
              Cada mês tem duas pilhas: <strong>realizado</strong> (cheia) e <strong>previsto</strong>{" "}
              (contornada) — parcelas que o emissor já lançou. Nunca somadas numa barra só.
            </p>
          </header>
          <Legenda faixas={analise.faixas} previsto={composicao.temPrevisto} />
          {!composicao.linhas.length ? (
            <p className="fin-cartao-an-vazio">Sem competência de {ano} nos lançamentos.</p>
          ) : (
            <ChartFrame titulo={`Cartão ${ano} — composição mensal por ${meta.curto}`}>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={composicao.linhas} margin={{ top: 6, right: 8, bottom: 0, left: 0 }} barGap={2}>
                  {/* Sem `strokeOpacity`: o quanto a grade some é decisão do
                      token `--line`, que já vira com o tema. Dimerizar por cima
                      dele empilhava duas decisões e, no escuro, apagava a grade
                      inteira. */}
                  <CartesianGrid stroke={GRADE} vertical={false} />
                  <XAxis
                    dataKey="rotulo"
                    tick={{ fontSize: 11, fill: TINTA_FRACA }}
                    axisLine={{ stroke: GRADE }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: TINTA_FRACA }}
                    axisLine={false}
                    tickLine={false}
                    width={62}
                    tickFormatter={(v: number) => brlCompact(v * 100)}
                  />
                  <Tooltip content={<DicaMes faixas={analise.faixas} />} cursor={{ fill: "rgba(23,51,58,.05)" }} />
                  {analise.faixas.map((f, i) => (
                    <Bar
                      key={`r${i}`}
                      dataKey={`r${i}`}
                      stackId="realizado"
                      name={f.rotulo}
                      className={f.lacuna ? "fin-cartao-an-faixa-lacuna" : undefined}
                      fill={f.lacuna ? HACHURA : f.cor}
                      stroke={f.lacuna ? COR_INDET : undefined}
                      strokeWidth={f.lacuna ? 1 : 0}
                      maxBarSize={26}
                    />
                  ))}
                  {analise.faixas.map((f, i) => (
                    <Bar
                      key={`p${i}`}
                      dataKey={`p${i}`}
                      stackId="previsto"
                      name={`${f.rotulo} (previsto)`}
                      className={f.lacuna ? "fin-cartao-an-faixa-lacuna" : undefined}
                      fill={f.lacuna ? HACHURA : f.cor}
                      fillOpacity={0.28}
                      stroke={f.lacuna ? COR_INDET : f.cor}
                      strokeWidth={1}
                      strokeDasharray="3 2"
                      maxBarSize={26}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </ChartFrame>
          )}
        </section>
      )}

      {/* ================================================================== */}
      {/* 4. Cruzamentos                                                      */}
      {/* ================================================================== */}
      <section className="fin-cartao-an-secao">
        <header>
          <h3 className="fin-cartao-an-titulo">Cruzamentos</h3>
          <p className="fin-cartao-an-sub">
            Célula proporcional dentro da própria matriz. Sem gasto é traço; sem dono é hachura — não são
            a mesma coisa e não têm o mesmo desenho.
          </p>
        </header>
        <div className="fin-cartao-an-cruz">
          {analise.degenerado ? null : (
            <Matriz
              titulo={`Cartão × ${meta.curto}`}
              colunas={analise.faixas}
              linhas={cruzCartao}
              rotuloLinha="Cartão"
            />
          )}
          <Matriz
            titulo="Mês × núcleo"
            colunas={cruzNucleo.colunas}
            linhas={cruzNucleo.linhas}
            rotuloLinha="Mês"
          />
        </div>
      </section>
    </div>
  );
}

/* ===========================================================================
   Peças
   =========================================================================== */

/**
 * A hachura do indeterminado — uma `<pattern>` só no documento, como em
 * `FinCartaoHistorico`. Ela mora num `<svg>` de tamanho zero e não dentro do
 * gráfico, então o PNG que o `ChartFrame` exporta perde o preenchimento da
 * barra indeterminada. Por isso a barra também leva CONTORNO roxo: no arquivo
 * exportado ela continua sendo a barra que se distingue das outras.
 *
 * O hex fica no atributo e a classe vem por cima com `var(--cert-indet)` — os
 * dois caminhos do irmão `FinCartaoPainelTopo`. Sem a classe, esta hachura
 * ficava presa no roxo claro e dava 2,71:1 no tema escuro; com ela, o SVG passa
 * a falar a mesma tinta que a textura em CSS (`.fin-cartao-an-tex-lacuna`) já
 * falava, e as duas param de divergir quando o tema vira.
 */
function Hachura() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
      <defs>
        <pattern
          id="fin-cartao-an-hachura"
          width="6"
          height="6"
          patternTransform="rotate(135)"
          patternUnits="userSpaceOnUse"
        >
          <rect
            className="fin-cartao-an-hachura-fundo"
            width="6"
            height="6"
            fill={COR_INDET}
            opacity="0.16"
          />
          <line
            className="fin-cartao-an-hachura-linha"
            x1="0"
            y1="0"
            x2="0"
            y2="6"
            stroke={COR_INDET}
            strokeWidth="2.4"
          />
        </pattern>
      </defs>
    </svg>
  );
}

function Chip({ rotulo, falta }: { rotulo: string | null; falta: string }) {
  if (rotulo === null) {
    return (
      <span className="fin-cartao-an-chip" data-tom="lacuna">
        {falta}
      </span>
    );
  }
  return (
    <span className="fin-cartao-an-chip" title={rotulo}>
      {cortar(rotulo, 44)}
    </span>
  );
}

/**
 * A faixa de cobertura: os três estados em escala, uma vez, com os números em
 * cima. É o parágrafo de ressalva convertido em desenho — o dono pediu menos
 * texto, e a régua diz sozinha de quanto é o "30 %" que alguém vai citar.
 */
function Cobertura({
  classificadoCents,
  lacunaCents,
  opacoCents,
  semRotulo,
  linhasOpacas
}: {
  classificadoCents: number;
  lacunaCents: number;
  opacoCents: number;
  semRotulo: string;
  /**
   * `motivo` viaja e não é desenhado: o texto da fonte é de um MÊS e a linha é
   * do ano — ver a nota em `opaco`. Quem explica a linha é `SEM_ITENS`.
   */
  linhasOpacas: { emissor: string; valorCents: number; motivo: string | null }[];
}) {
  const total = classificadoCents + lacunaCents + opacoCents;
  if (total <= 0) return null;
  const parte = (v: number) => `${(v / total) * 100}%`;

  return (
    <div className="fin-cartao-an-cobertura">
      <div className="fin-cartao-an-faixa" role="img" aria-label="Cobertura da análise no ano">
        <span className="fin-cartao-an-faixa-conhecido" style={{ width: parte(classificadoCents) }} />
        <span className="fin-cartao-an-tex-lacuna" style={{ width: parte(lacunaCents) }} />
        <span className="fin-cartao-an-tex-opaco" style={{ width: parte(opacoCents) }} />
      </div>
      <ul className="fin-cartao-an-cob-leg">
        <li>
          <i className="fin-cartao-an-amostra fin-cartao-an-amostra-conhecido" aria-hidden />
          <em>classificado</em>
          <b>{brlPrecise(classificadoCents)}</b>
        </li>
        <li>
          <i className="fin-cartao-an-amostra fin-cartao-an-amostra-lacuna fin-cartao-an-tex-lacuna" aria-hidden />
          <em>{semRotulo.toLowerCase()} — dá para qualificar</em>
          <b>{brlPrecise(lacunaCents)}</b>
        </li>
        <li>
          <i className="fin-cartao-an-amostra fin-cartao-an-amostra-opaco fin-cartao-an-tex-opaco" aria-hidden />
          <em>não itemizado — a fonte não entrega as compras</em>
          <b>{brlPrecise(opacoCents)}</b>
        </li>
      </ul>
      {linhasOpacas.length ? (
        <ul className="fin-cartao-an-opacos">
          {linhasOpacas.slice(0, 3).map((l) => (
            <li key={l.emissor}>
              <strong>{l.emissor}</strong>
              <span>{SEM_ITENS}</span>
              <span className="fin-cartao-an-num">{brlPrecise(l.valorCents)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Legenda({ faixas, previsto }: { faixas: Faixa[]; previsto: boolean }) {
  return (
    <ul className="fin-cartao-an-legenda">
      {faixas.map((f) => (
        <li key={f.rotulo}>
          <i
            className={`fin-cartao-an-ponto${f.lacuna ? " fin-cartao-an-tex-lacuna" : ""}`}
            style={{ background: f.lacuna ? undefined : f.cor }}
            aria-hidden
          />
          <span title={f.rotulo}>{f.rotulo}</span>
        </li>
      ))}
      {previsto ? (
        <li>
          <i className="fin-cartao-an-legenda-prev" aria-hidden />
          <span>previsto — parcela já lançada pelo emissor</span>
        </li>
      ) : null}
    </ul>
  );
}

type LinhaMatriz = { rotulo: string; celulas: number[]; total: number };

/**
 * Matriz densa. A intensidade é uma rampa de UM hue e vale só dentro da própria
 * matriz — comparar célula de uma com célula da outra não é leitura legítima, e
 * por isso cada uma normaliza pelo próprio máximo.
 *
 * A raiz quadrada na intensidade não é enfeite: sem ela, uma matriz onde uma
 * célula vale 40 vezes a segunda pinta todo o resto de branco, e o desenho
 * afirma "não há mais nada aqui".
 */
function Matriz({
  titulo,
  colunas,
  linhas,
  rotuloLinha
}: {
  titulo: string;
  colunas: Faixa[];
  linhas: LinhaMatriz[];
  rotuloLinha: string;
}) {
  if (!linhas.length || !colunas.length) {
    return <p className="fin-cartao-an-vazio">Sem dado para cruzar em {titulo.toLowerCase()}.</p>;
  }
  const teto = linhas.reduce((m, l) => Math.max(m, ...l.celulas), 0);
  const rodape = colunas.map((_, i) => linhas.reduce((s, l) => s + l.celulas[i], 0));
  const total = rodape.reduce((s, v) => s + v, 0);

  return (
    <div className="fin-cartao-an-matriz-wrap">
      <table className="fin-cartao-an-matriz">
        <caption>
          <strong>{titulo}</strong> · {brlPrecise(total)}
        </caption>
        <thead>
          <tr>
            <th scope="col">{rotuloLinha}</th>
            {colunas.map((c) => (
              <th key={c.rotulo} scope="col" title={c.rotulo}>
                {cortar(c.rotulo, 16)}
              </th>
            ))}
            <th scope="col">Total</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.rotulo}>
              <th scope="row" title={l.rotulo}>
                {l.rotulo}
              </th>
              {l.celulas.map((v, i) => {
                const intensidade = teto > 0 && v > 0 ? Math.round(Math.sqrt(v / teto) * 100) : 0;
                return (
                  <td
                    key={colunas[i].rotulo}
                    data-vazio={v > 0 ? "0" : "1"}
                    data-lacuna={colunas[i].lacuna && v > 0 ? "1" : "0"}
                    style={vars({ "--i": intensidade })}
                    title={`${l.rotulo} · ${colunas[i].rotulo}`}
                  >
                    {v > 0 ? brlCompact(v) : "—"}
                  </td>
                );
              })}
              <td className="total">{brlCompact(l.total)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Total</th>
            {rodape.map((v, i) => (
              <td key={colunas[i].rotulo}>{v > 0 ? brlCompact(v) : "—"}</td>
            ))}
            <td>{brlCompact(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/* ===========================================================================
   Dicas
   =========================================================================== */

type CargaQuebra = {
  rotulo: string;
  valor: number;
  itens: number;
  parte: number;
  lacuna: boolean;
  cor: string;
};

type DicaQuebraProps = { active?: boolean; payload?: { payload?: CargaQuebra }[] };

function DicaQuebra({ active, payload }: DicaQuebraProps) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  return (
    <div className="fin-cartao-an-dica">
      <strong className="fin-cartao-an-dica-tit">{p.rotulo}</strong>
      <div className="fin-cartao-an-dica-linha">
        <i
          className={`fin-cartao-an-ponto${p.lacuna ? " fin-cartao-an-tex-lacuna" : ""}`}
          style={{ background: p.lacuna ? undefined : p.cor }}
          aria-hidden
        />
        <span>gasto no ano</span>
        <b>{brlPrecise(p.valor * 100)}</b>
      </div>
      <div className="fin-cartao-an-dica-linha">
        <span>lançamentos</span>
        <b>{p.itens}</b>
      </div>
      <div className="fin-cartao-an-dica-linha">
        <span>do itemizado</span>
        <b>{pct(p.parte, 1)}</b>
      </div>
      {p.lacuna ? (
        <p className="fin-cartao-an-dica-nota">
          Itemizado e sem classificação: a fila de qualificação resolve esta fatia.
        </p>
      ) : null}
    </div>
  );
}

type DicaMesProps = {
  faixas: Faixa[];
  active?: boolean;
  label?: string;
  payload?: { payload?: Record<string, number | string> }[];
};

function DicaMes({ faixas, active, label, payload }: DicaMesProps) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  const totalR = Number(p.totalR ?? 0);
  const totalP = Number(p.totalP ?? 0);

  return (
    <div className="fin-cartao-an-dica">
      <strong className="fin-cartao-an-dica-tit">{label}</strong>
      {faixas.map((f, i) => {
        const r = Number(p[`r${i}`] ?? 0);
        const v = Number(p[`p${i}`] ?? 0);
        if (r === 0 && v === 0) return null;
        return (
          <div className="fin-cartao-an-dica-linha" key={f.rotulo}>
            <i
              className={`fin-cartao-an-ponto${f.lacuna ? " fin-cartao-an-tex-lacuna" : ""}`}
              style={{ background: f.lacuna ? undefined : f.cor }}
              aria-hidden
            />
            <span>{cortar(f.rotulo, 26)}</span>
            <b>
              {brlPrecise(r * 100)}
              {v > 0 ? ` + ${brlPrecise(v * 100)} prev.` : ""}
            </b>
          </div>
        );
      })}
      <p className="fin-cartao-an-dica-nota">
        realizado {brlPrecise(totalR * 100)}
        {totalP > 0 ? ` · previsto ${brlPrecise(totalP * 100)}` : ""} · {Number(p.itens ?? 0)} lançamentos
      </p>
    </div>
  );
}

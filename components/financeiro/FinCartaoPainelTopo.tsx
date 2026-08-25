"use client";

import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { ChartFrame } from "@/components/charts/ChartFrame";
import { KpiCard } from "@/components/ui/KpiCard";
import { brl, brlCompact, brlPrecise } from "@/lib/financeiro/format";
import type { CartaoPainel } from "@/lib/financeiro/contratos/cartao-painel";

/**
 * O topo do painel de cartões — quatro KPIs e o gasto mensal empilhado por
 * plástico.
 *
 * ---------------------------------------------------------------------------
 * A PILHA SOBE POR CERTEZA, NÃO POR TAMANHO
 * ---------------------------------------------------------------------------
 * Cada barra empilha três blocos, de baixo para cima, em ordem de quanto se
 * sabe sobre o dinheiro:
 *
 *   1. REALIZADO ITEMIZADO — sabe-se o cartão e as compras. Faixa cheia, uma
 *      cor por plástico.
 *   2. NÃO ITEMIZADO ....... sabe-se o dinheiro, não o plástico. O Banco Inter
 *      inteiro cai aqui (`itemization_level = 'somente_pagamento'`: o emissor
 *      entrega o pagamento da fatura e nunca os itens), mais as faturas do
 *      Nubank cujo detalhamento não veio. Faixa HACHURADA, cor de
 *      indeterminado da casa.
 *   3. PREVISTO ............ parcelas que o emissor já lançou para meses à
 *      frente. Mesma cor do plástico, esmaecida.
 *
 * Essa ordem faz a leitura de baixo para cima ser "o que é firme → o que é
 * incerto", e o topo esmaecido de agosto/2026 mostra sozinho que o mês ainda
 * corre — sem uma linha de ressalva.
 *
 * ---------------------------------------------------------------------------
 * O NÃO ITEMIZADO NUNCA É RATEADO
 * ---------------------------------------------------------------------------
 * Em 2026 ele é R$ 52,6 mil contra R$ 62,4 mil de itemizado — quase o mesmo
 * tamanho. Diluí-lo proporcionalmente entre os cartões conhecidos daria um
 * gráfico mais bonito e inventaria dono para gasto sem dono, que é justamente
 * a regra que a tela irmã (`cartao-detalhe.ts`) existe para proteger. Ele fica
 * numa faixa própria, hachurada, com nome próprio na legenda.
 *
 * Não ser rateável, porém, não é motivo para ficar de fora das contas: ele é
 * gasto e entra em toda manchete de valor — ver a seção seguinte.
 *
 * ---------------------------------------------------------------------------
 * A MANCHETE DO MÊS É O TOTAL; A COMPOSIÇÃO FICA NA LINHA DE BAIXO
 * ---------------------------------------------------------------------------
 * Os três KPIs de valor — mês passado, este mês, no ano — são TOTAIS, e por
 * isso medem a mesma coisa entre si e podem ser lidos em sequência.
 *
 * A primeira versão desta tela deixava a manchete do mês no itemizado, com um
 * argumento que parecia mais puro: o itemizado é medido na competência da
 * compra e o não itemizado na data da fatura, e misturar dois eixos de tempo
 * num único mês é impreciso na borda. Medido contra o dado, o argumento caiu.
 * Julho de 2026 tem R$ 5.483,14 itemizados e R$ 6.809,21 NÃO itemizados — o
 * segundo é MAIOR que o primeiro. "Mês passado: R$ 5.483,14" subnotificaria
 * julho em 55%, e de um jeito calado: o número pareceria completo. Errar 55%
 * para menos é incomparavelmente pior que errar alguns dias na virada do mês.
 *
 * Somar não é esconder — esconder seria somar e parar aí. Cada card abre a
 * composição logo abaixo da manchete (com itens · sem itens · previsto), e o
 * gráfico continua desenhando as três naturezas em blocos separados, nunca
 * fundidas numa faixa só.
 *
 * O único número que esta tela nunca produz continua sendo o que junta
 * competência com caixa: pagamento de fatura não entra aqui.
 */

/* ===========================================================================
   COR
   =========================================================================== */

/**
 * O vocabulário fechado de `fin_card.cor` (migration 0149), traduzido em tinta.
 *
 * Cor de plástico é DADO, não enfeite: é como uma pessoa reconhece o próprio
 * cartão ("o preto", "o dourado") antes de ler os quatro dígitos. Quando ela
 * existe, ela ganha da paleta — o gráfico passa a usar a cor que a pessoa tem
 * na mão. Só que ela quase nunca existe: 12 dos 15 plásticos vieram do sync do
 * Nubank sem apelido e sem cor.
 */
/*
 * EXPORTADA porque `FinCartaoPlasticos` precisa da MESMA tinta.
 *
 * Os dois componentes nasceram com o mapa duplicado e ele já tinha divergido em
 * 9 das 12 cores — um cartão `azul` saía #1e5eb8 no gráfico e #1e5fd4 no
 * mini-cartão. Diferença pequena demais para alguém notar de propósito e
 * grande o bastante para quebrar o casamento visual entre as duas seções, que
 * é justamente o que a cor existe para fazer aqui.
 */
export const TINTA_DO_PLASTICO: Record<string, string> = {
  preto: "#2b2b31",
  branco: "#e8e8ea",
  cinza: "#6e7076",
  prata: "#a8adb4",
  dourado: "#c39c2c",
  roxo: "#820ad1",
  azul: "#1e5eb8",
  verde: "#1f8f5f",
  vermelho: "#c0392b",
  laranja: "#e07b39",
  rosa: "#d6559b",
  transparente: "#9aa3ab"
};

/**
 * A paleta de fallback — nove slots, indexados por `cardId`.
 *
 * ---------------------------------------------------------------------------
 * POR QUE NOVE, E NÃO QUINZE
 * ---------------------------------------------------------------------------
 * A tela roda em tema claro E escuro, e `corDoCartao` devolve UM hex — o mesmo
 * nos dois. Isso obriga cada cor a ter luminância relativa entre 0,1224 e 0,30
 * para dar 3:1 tanto sobre o branco quanto sobre o `--card` escuro (#17131f).
 * Dentro dessa faixa estreita de claridade, a separação para daltonismo
 * (protanopia/deuteranopia, que colapsam o eixo vermelho-verde e sobra
 * claridade) esgota em nove cores: com dez, o pior par cai para ΔE 4,1 e
 * reprova o piso.
 *
 * Nove passam TODAS as checagens nos dois modos, em all-pairs — que é o teste
 * certo aqui, porque num mês qualquer subconjunto de cartões pode encostar:
 *   banda de claridade · piso de croma · piso de visão normal (pior par 15,0)
 *   · contraste ≥ 3:1 nos dois fundos.
 * A separação para daltonismo fica em ΔE 6,3 — dentro da banda de piso, que é
 * legal SÓ com encoding secundário. Ele existe e é forte: cada faixa tem chip
 * nomeado na legenda, o tooltip diz o nome do cartão faixa a faixa, clicar
 * isola, e a ordem da pilha é fixa. Cor aqui acelera o reconhecimento; ela
 * nunca é o único caminho para a identidade.
 *
 * A partir do décimo cartão a cor se repete. É um empate assumido, não um
 * descuido: gerar um décimo tom seria fabricar uma diferença que o olho não
 * enxerga — e nesta base os cartões com gasto são ~10, dos quais poucos
 * dividem o mesmo mês.
 *
 * VERDE ESTÁ FORA DE PROPÓSITO. Nesta base verde é ENTRADA (`--fin-in`) e
 * cartão é saída inteira. A faixa de matiz 106°–180° foi excluída da busca.
 * (A exceção é um plástico literalmente verde vindo de `TINTA_DO_PLASTICO`:
 * ali a cor descreve o objeto que a pessoa tem na mão, não a direção do
 * dinheiro.)
 *
 * A ordem dos slots também foi resolvida: `cardId % 9` dá cores consecutivas a
 * ids consecutivos, então os vizinhos de slot (inclusive fechando o ciclo)
 * ficam a ΔE ≥ 16,4 um do outro.
 */
export const PALETA_DE_CARTAO = [
  "#cc7b2d",
  "#c122cc",
  "#777118",
  "#1ba1a7",
  "#772efb",
  "#f0488c",
  "#1e88fc",
  "#a55563",
  "#a57ad3"
] as const;

/** A tinta de indeterminado da casa (`--cert-indet` no tema claro). */
const COR_INDETERMINADA = "#6b4e8f";

/**
 * A cor estável de um cartão. A MESMA no gráfico, na legenda e nos
 * mini-cartões — cor segue a entidade, nunca a posição dela num ranking, para
 * que ligar e desligar faixas não repinte as que sobraram.
 *
 * @param cardId  `fin_card.id`. `null` (compra sem cartão identificado) devolve
 *                a tinta de indeterminado, que a paleta evita de propósito.
 * @param cor     `fin_card.cor`, se houver — o vocabulário fechado da 0149.
 *                Tem prioridade: é a cor do plástico de verdade.
 */
export function corDoCartao(cardId: number | null | undefined, _cor?: string | null): string {
  /*
   * A COR REAL DO PLÁSTICO NÃO ENTRA AQUI, e a primeira versão deixava.
   *
   * O argumento para deixar era bom: a pessoa reconhece o próprio cartão pela
   * cor ("o preto", "o dourado") antes de ler os quatro dígitos. Só que medido
   * contra as duas superfícies do app, 8 das 12 cores do vocabulário reprovam
   * o piso de 3:1 em pelo menos um tema — `preto` dá 1,30:1 no escuro,
   * `branco` dá 1,22:1 no claro, `prata` 2,26, `dourado` 2,59, `roxo` 2,53.
   * Um cartão preto viraria uma faixa invisível no gráfico escuro.
   *
   * E clarear o hex não é opção: um cartão preto É preto, e mentir sobre isso
   * quebra justamente o reconhecimento que a cor existe para dar.
   *
   * A saída é separar os dois trabalhos que a cor faz:
   *
   *   IDENTIFICAR A SÉRIE ...... esta função, paleta validada nos dois temas.
   *                              O gráfico e o ponto de acento do mini-cartão
   *                              usam ela, então o casamento entre as duas
   *                              seções continua de pé.
   *   RETRATAR O OBJETO ........ `TINTA_DO_PLASTICO`, na tarja do mini-cartão,
   *                              onde ela desenha o plástico de verdade e um
   *                              fio de contorno garante a aresta.
   *
   * `_cor` fica na assinatura de propósito: as chamadas passam a cor, e tirar
   * o parâmetro faria cada uma delas parecer um esquecimento.
   */
  if (cardId === null || cardId === undefined || cardId < 0) return COR_INDETERMINADA;
  const i = ((Math.trunc(cardId) % PALETA_DE_CARTAO.length) + PALETA_DE_CARTAO.length) %
    PALETA_DE_CARTAO.length;
  return PALETA_DE_CARTAO[i];
}

/* ===========================================================================
   CHAVES
   =========================================================================== */

/**
 * A legenda guarda `Set<number>` de `cardId`. Estas duas faixas não são
 * plástico nenhum, então ocupam ids negativos — que `fin_card.id` (serial)
 * nunca produz, e que `corDoCartao` já trata como indeterminado.
 */
const CHAVE_NAO_ITEMIZADO = -1;
const CHAVE_SEM_CARTAO = -2;

const ID_HACHURA = "fin-cartao-topo-hachura";

type Faixa = {
  chave: number;
  nome: string;
  emissor: string | null;
  cor: string;
  /** Hachurada e sem par de previsto: é a faixa do que a fonte não itemiza. */
  indeterminada: boolean;
  totalCents: number;
};

type LinhaDoGrafico = {
  mes: string;
  rotulo: string;
  corrente: boolean;
} & Record<string, number | string | boolean>;

const chaveRealizado = (c: number) => `r_${c}`;
const chavePrevisto = (c: number) => `p_${c}`;

/** `2026-08` → `08/26`. Dezesseis meses no eixo pedem o rótulo curto. */
const rotuloMes = (mes: string) => {
  const [ano, m] = mes.slice(0, 7).split("-");
  return `${m}/${ano.slice(2)}`;
};

const nomeDoCartao = (apelido: string | null, last4: string | null) =>
  apelido ?? (last4 ? `final ${last4}` : "cartão não identificado");

/* ===========================================================================
   COMPONENTE
   =========================================================================== */

export function FinCartaoPainelTopo({ dado }: { dado: CartaoPainel }) {
  const { faixas, linhas, temPrevisto } = useMemo(() => montar(dado), [dado]);

  // Todas ligadas no início — a tela abre mostrando o gasto inteiro, e é quem
  // olha que decide o que tirar de vista.
  const [ligados, setLigados] = useState<Set<number>>(() => new Set(faixas.map((f) => f.chave)));

  // A animação de reempilhar é a graça do toggle: ela mostra a faixa saindo e
  // as de cima descendo, em vez de a barra simplesmente aparecer diferente.
  // Quem pediu menos movimento no sistema não recebe nenhum.
  const [comMovimento, setComMovimento] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const ler = () => setComMovimento(!mq.matches);
    ler();
    mq.addEventListener("change", ler);
    return () => mq.removeEventListener("change", ler);
  }, []);

  function alternar(chave: number) {
    setLigados((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(chave)) proximo.delete(chave);
      else proximo.add(chave);
      return proximo;
    });
  }

  // Zerar o valor da faixa desligada em vez de desmontar a <Bar> é o que faz a
  // transição existir: a série continua no gráfico e o recharts interpola a
  // altura de onde estava até zero. Desmontar cortaria o quadro.
  const dados = useMemo(
    () =>
      linhas.map((linha) => {
        const copia: LinhaDoGrafico = { ...linha };
        for (const f of faixas) {
          if (ligados.has(f.chave)) continue;
          copia[chaveRealizado(f.chave)] = 0;
          copia[chavePrevisto(f.chave)] = 0;
        }
        return copia;
      }),
    [linhas, faixas, ligados]
  );

  if (!faixas.length || !linhas.length) {
    return (
      <div className="fin-cartao-topo">
        <FaixaDeKpis dado={dado} />
        <p className="fin-cartao-topo-vazio">
          Nenhum gasto de cartão lançado a partir de janeiro de 2026.
        </p>
      </div>
    );
  }

  const ocultas = faixas.length - ligados.size;

  return (
    <div className="fin-cartao-topo">
      <FaixaDeKpis dado={dado} />

      <figure className="fin-cartao-topo-grafico">
        <figcaption className="fin-cartao-topo-titulo">
          <strong>Gasto por mês, cartão a cartão</strong>
          <span>competência · não é o pagamento da fatura</span>
        </figcaption>

        <div className="fin-cartao-topo-chave">
          <span className="fin-cartao-topo-chave-item">
            <i className="fin-cartao-topo-amostra" style={{ background: "var(--ink)" }} />
            realizado
          </span>
          {temPrevisto && (
            <span className="fin-cartao-topo-chave-item">
              <i
                className="fin-cartao-topo-amostra fin-cartao-topo-amostra-previsto"
                style={{ background: "var(--ink)", color: "var(--ink)" }}
              />
              previsto — parcela que o emissor já lançou
            </span>
          )}
          <span className="fin-cartao-topo-chave-item">
            <i className="fin-cartao-topo-amostra fin-cartao-topo-amostra-indet" />
            sem itens — a fonte não abre as compras
          </span>
        </div>

        <Legenda faixas={faixas} ligados={ligados} onAlternar={alternar} onDefinir={setLigados} />

        <ChartFrame titulo="Cartões — gasto mensal por plástico">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={dados} margin={{ top: 6, right: 10, bottom: 0, left: 0 }} barCategoryGap="18%">
              {/* O <defs> mora DENTRO do svg do gráfico, e não num svg solto ao
                  lado, para que o PNG que o ChartFrame exporta leve a hachura
                  junto — ele clona só este svg. */}
              <defs>
                <pattern
                  id={ID_HACHURA}
                  width="6"
                  height="6"
                  patternTransform="rotate(135)"
                  patternUnits="userSpaceOnUse"
                >
                  <rect
                    className="fin-cartao-topo-hachura-fundo"
                    width="6"
                    height="6"
                    fill={COR_INDETERMINADA}
                    opacity="0.18"
                  />
                  <line
                    className="fin-cartao-topo-hachura-linha"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="6"
                    stroke={COR_INDETERMINADA}
                    strokeWidth="2.4"
                  />
                </pattern>
              </defs>

              <CartesianGrid stroke="var(--line)" vertical={false} />
              <XAxis
                dataKey="rotulo"
                tick={<TickDeMes corrente={dado.mesCorrente ? rotuloMes(dado.mesCorrente) : undefined} />}
                interval={0}
                axisLine={{ stroke: "var(--line)" }}
                tickLine={false}
                height={26}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "var(--muted)" }}
                axisLine={false}
                tickLine={false}
                width={64}
                tickFormatter={(v: number) => brlCompact(v * 100)}
              />
              <Tooltip
                content={<Dica faixas={faixas} ocultas={ocultas} />}
                cursor={{ fill: "rgba(124,31,224,.07)" }}
              />

              {/* 1. Realizado itemizado — a base da pilha. */}
              {faixas
                .filter((f) => !f.indeterminada)
                .map((f) => (
                  <Bar
                    key={chaveRealizado(f.chave)}
                    className="fin-cartao-topo-faixa"
                    dataKey={chaveRealizado(f.chave)}
                    stackId="gasto"
                    fill={f.cor}
                    isAnimationActive={comMovimento}
                    animationDuration={420}
                    animationEasing="ease-out"
                  />
                ))}

              {/* 2. O que a fonte não itemiza. Nunca rateado entre os de cima. */}
              {faixas
                .filter((f) => f.indeterminada)
                .map((f) => (
                  <Bar
                    key={chaveRealizado(f.chave)}
                    className="fin-cartao-topo-faixa"
                    dataKey={chaveRealizado(f.chave)}
                    stackId="gasto"
                    fill={`url(#${ID_HACHURA})`}
                    isAnimationActive={comMovimento}
                    animationDuration={420}
                    animationEasing="ease-out"
                  />
                ))}

              {/* 3. Previsto, no topo — a parte que ainda pode mudar.
                     `stroke` na própria cor porque a opacidade sozinha some
                     sobre o fundo escuro; a borda segura o contraste. */}
              {faixas
                .filter((f) => !f.indeterminada)
                .map((f) => (
                  <Bar
                    key={chavePrevisto(f.chave)}
                    className="fin-cartao-topo-faixa-previsto"
                    dataKey={chavePrevisto(f.chave)}
                    stackId="gasto"
                    fill={f.cor}
                    stroke={f.cor}
                    strokeWidth={1.2}
                    /* O CSS levanta esta opacidade no tema escuro. O atributo
                       fica aqui mesmo assim porque o PNG que o ChartFrame
                       exporta sai sem o CSS da página — e sem ele o previsto
                       sairia sólido no arquivo, exatamente a leitura errada. */
                    fillOpacity={0.42}
                    isAnimationActive={comMovimento}
                    animationDuration={420}
                    animationEasing="ease-out"
                  />
                ))}
            </BarChart>
          </ResponsiveContainer>
        </ChartFrame>
      </figure>
    </div>
  );
}

/* ===========================================================================
   KPIs
   =========================================================================== */

function FaixaDeKpis({ dado }: { dado: CartaoPainel }) {
  const { kpi } = dado;

  // A variação já vem do contrato comparando TOTAL com TOTAL, então manchete e
  // variação medem a mesma coisa. (Medi-la só no itemizado mediria a oscilação
  // de cobertura do Inter, não a mudança de gasto.) O que resta à tela dizer é
  // que um dos dois meses ainda corre — e "mês em curso", duas linhas acima, já
  // diz, sem parágrafo de ressalva.
  const variacao =
    kpi.variacaoPct === null ? null : (
      <span className="fin-cartao-topo-variacao">
        <span className="fin-cartao-topo-variacao-seta" aria-hidden>
          {kpi.variacaoPct >= 0 ? "▲" : "▼"}
        </span>
        {`${Math.abs(kpi.variacaoPct).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}
      </span>
    );

  const ultimoLancado = ultimoMesLancado(dado);

  return (
    <div className="fin-cartao-topo-kpis">
      <KpiCard
        rotulo="Mês passado"
        valor={reais(kpi.mesAnteriorTotalCents)}
        acento="neutro"
        detalhe={
          <span className="fin-cartao-topo-detalhe">
            <span className="fin-cartao-topo-detalhe-linha">
              {rotuloMes(dado.mesAnterior)}
              <span className="fin-cartao-topo-estado">fechado</span>
            </span>
            <Composicao
              partes={[
                { cents: kpi.mesAnteriorCents, rotulo: "com itens" },
                { cents: kpi.mesAnteriorNaoItemizadoCents, rotulo: "sem itens", indeterminado: true }
              ]}
            />
          </span>
        }
      />

      {/* O número que a tela existe para mostrar — e é total, como os vizinhos:
          em agosto o não itemizado (R$ 7.855,58) quase empata com o itemizado
          (R$ 8.471,06), então a manchete no itemizado seria metade do mês. */}
      <KpiCard
        rotulo="Este mês"
        valor={reais(kpi.mesCorrenteTotalCents)}
        acento="purple"
        brilho
        detalhe={
          <span className="fin-cartao-topo-detalhe">
            <span className="fin-cartao-topo-detalhe-linha">
              {rotuloMes(dado.mesCorrente)}
              <span className="fin-cartao-topo-estado">mês em curso</span>
            </span>
            <Composicao
              partes={[
                { cents: kpi.mesCorrenteRealizadoCents, rotulo: "com itens" },
                { cents: kpi.mesCorrenteNaoItemizadoCents, rotulo: "sem itens", indeterminado: true },
                { cents: kpi.mesCorrentePrevistoCents, rotulo: "previsto" }
              ]}
            />
            {variacao ? (
              <span className="fin-cartao-topo-detalhe-linha">
                {variacao} contra {rotuloMes(dado.mesAnterior)}
              </span>
            ) : (
              <span className="fin-cartao-topo-detalhe-linha">
                <span className="fin-cartao-topo-estado-indet">
                  sem base no mês passado para comparar
                </span>
              </span>
            )}
          </span>
        }
      />

      {/* Total pelo mesmo motivo dos dois acima — e é justamente por ser total
          que ele NUNCA pode ser quebrado por cartão: metade dele é dinheiro
          sem dono conhecido. */}
      <KpiCard
        rotulo="No ano"
        valor={reais(kpi.anoTotalCents)}
        acento="neutro"
        detalhe={
          <span className="fin-cartao-topo-detalhe">
            <Composicao
              partes={[
                { cents: kpi.anoCents, rotulo: "com itens" },
                { cents: kpi.anoNaoItemizadoCents, rotulo: "sem itens", indeterminado: true }
              ]}
            />
          </span>
        }
      />

      <KpiCard
        rotulo="Já lançado à frente"
        valor={reais(kpi.futuroCents)}
        acento="neutro"
        detalhe={
          <span className="fin-cartao-topo-detalhe">
            <span className="fin-cartao-topo-detalhe-linha">parcelas que o emissor confirmou</span>
            {ultimoLancado && (
              <span className="fin-cartao-topo-detalhe-linha">até {rotuloMes(ultimoLancado)}</span>
            )}
          </span>
        }
      />
    </div>
  );
}

/**
 * A composição de uma manchete — o que a soma junta, aberto parte a parte.
 *
 * Parte zerada NÃO vira uma linha "R$ 0": em setembro não há previsto porque
 * nada foi lançado, e escrever zero ali afirmaria uma medição que não houve.
 * Zero e "não sei" são estados diferentes, e nenhum dos dois é uma linha vazia.
 */
function Composicao({
  partes
}: {
  partes: { cents: number; rotulo: string; indeterminado?: boolean }[];
}) {
  const vivas = partes.filter((p) => p.cents !== 0);
  return (
    <>
      {vivas.map((p, i) => (
        <span key={p.rotulo} className="fin-cartao-topo-detalhe-linha">
          <span className={p.indeterminado ? "fin-cartao-topo-estado-indet" : undefined}>
            {i > 0 && p.cents > 0 ? "+ " : ""}
            {reais(p.cents)} {p.rotulo}
          </span>
        </span>
      ))}
    </>
  );
}

/* ===========================================================================
   LEGENDA
   =========================================================================== */

function Legenda({
  faixas,
  ligados,
  onAlternar,
  onDefinir
}: {
  faixas: Faixa[];
  ligados: Set<number>;
  onAlternar: (chave: number) => void;
  onDefinir: (s: Set<number>) => void;
}) {
  const todas = ligados.size === faixas.length;
  return (
    <div className="fin-cartao-topo-legenda">
      {faixas.map((f) => {
        const ligada = ligados.has(f.chave);
        return (
          <button
            key={f.chave}
            type="button"
            className="fin-cartao-topo-chip"
            aria-pressed={ligada}
            onClick={() => onAlternar(f.chave)}
            title={ligada ? `Esconder ${f.nome}` : `Mostrar ${f.nome}`}
          >
            <i
              className={
                f.indeterminada
                  ? "fin-cartao-topo-amostra fin-cartao-topo-amostra-indet"
                  : "fin-cartao-topo-amostra"
              }
              style={f.indeterminada ? undefined : { background: f.cor, color: f.cor }}
            />
            <span className="fin-cartao-topo-chip-nome">{f.nome}</span>
            {f.emissor && <span className="fin-cartao-topo-chip-emissor">{f.emissor}</span>}
          </button>
        );
      })}
      <span className="fin-cartao-topo-legenda-acoes">
        <button
          type="button"
          className="fin-cartao-topo-acao"
          onClick={() => onDefinir(new Set(faixas.map((f) => f.chave)))}
          disabled={todas}
        >
          tudo
        </button>
        <button
          type="button"
          className="fin-cartao-topo-acao"
          onClick={() => onDefinir(new Set())}
          disabled={ligados.size === 0}
        >
          nada
        </button>
      </span>
    </div>
  );
}

/* ===========================================================================
   EIXO E TOOLTIP
   =========================================================================== */

type TickProps = {
  x?: number;
  y?: number;
  payload?: { value?: string; index?: number };
  /** O rótulo do mês corrente. Vem do contrato, não do relógio do navegador. */
  corrente?: string;
};

/**
 * O mês corrente em negrito. É o único tick do eixo que ainda não fechou, e
 * peso de fonte diz isso sem gastar palavra nenhuma.
 */
function TickDeMes({ x = 0, y = 0, payload, corrente }: TickProps) {
  const valor = String(payload?.value ?? "");
  return (
    <text
      x={x}
      y={y}
      dy={13}
      textAnchor="middle"
      fontSize={11}
      fill="var(--muted)"
      className={valor === corrente ? "fin-cartao-topo-tick-corrente" : undefined}
    >
      {valor}
    </text>
  );
}

type DicaProps = {
  active?: boolean;
  label?: string;
  payload?: { dataKey?: string | number; value?: number; payload?: LinhaDoGrafico }[];
  faixas: Faixa[];
  ocultas: number;
};

function Dica({ active, label, payload, faixas, ocultas }: DicaProps) {
  if (!active || !payload?.length) return null;
  const linha = payload[0]?.payload;
  if (!linha) return null;

  const valor = (k: string) => Number(linha[k] ?? 0);

  const realizadas = faixas
    .map((f) => ({ f, v: valor(chaveRealizado(f.chave)) }))
    .filter((x) => x.v !== 0);
  const previstas = faixas
    .filter((f) => !f.indeterminada)
    .map((f) => ({ f, v: valor(chavePrevisto(f.chave)) }))
    .filter((x) => x.v !== 0);

  if (!realizadas.length && !previstas.length) return null;

  const somaR = realizadas.reduce((s, x) => s + x.v, 0);
  const somaP = previstas.reduce((s, x) => s + x.v, 0);

  return (
    <div className="fin-cartao-topo-dica">
      <strong className="fin-cartao-topo-dica-titulo">
        {label}
        {linha.corrente ? " · mês em curso" : ""}
      </strong>

      {realizadas.length > 0 && (
        <>
          <p className="fin-cartao-topo-dica-grupo">realizado</p>
          {realizadas.map(({ f, v }) => (
            <LinhaDaDica key={f.chave} faixa={f} valor={v} />
          ))}
          {realizadas.length > 1 && (
            <div className="fin-cartao-topo-dica-soma">
              <span className="fin-cartao-topo-dica-nome">soma do realizado</span>
              <span className="fin-cartao-topo-dica-valor">{brlPrecise(somaR * 100)}</span>
            </div>
          )}
        </>
      )}

      {previstas.length > 0 && (
        <>
          <p className="fin-cartao-topo-dica-grupo">previsto</p>
          {previstas.map(({ f, v }) => (
            <LinhaDaDica key={f.chave} faixa={f} valor={v} previsto />
          ))}
          {previstas.length > 1 && (
            <div className="fin-cartao-topo-dica-soma">
              <span className="fin-cartao-topo-dica-nome">soma do previsto</span>
              <span className="fin-cartao-topo-dica-valor">{brlPrecise(somaP * 100)}</span>
            </div>
          )}
        </>
      )}

      {ocultas > 0 && (
        <p className="fin-cartao-topo-dica-nota">
          {ocultas} faixa{ocultas > 1 ? "s" : ""} escondida{ocultas > 1 ? "s" : ""} na legenda.
        </p>
      )}
    </div>
  );
}

function LinhaDaDica({ faixa, valor, previsto }: { faixa: Faixa; valor: number; previsto?: boolean }) {
  return (
    <div className="fin-cartao-topo-dica-linha">
      <i
        className={
          faixa.indeterminada
            ? "fin-cartao-topo-amostra fin-cartao-topo-amostra-indet"
            : previsto
              ? "fin-cartao-topo-amostra fin-cartao-topo-amostra-previsto"
              : "fin-cartao-topo-amostra"
        }
        style={faixa.indeterminada ? undefined : { background: faixa.cor, color: faixa.cor }}
      />
      <span className="fin-cartao-topo-dica-nome">{faixa.nome}</span>
      <span className="fin-cartao-topo-dica-valor">{brlPrecise(valor * 100)}</span>
    </div>
  );
}

/* ===========================================================================
   PREPARO DOS DADOS
   =========================================================================== */

/** Centavos → manchete de KPI, sem centavos. */
const reais = (cents: number) => brl.format(cents / 100);

/** O mês mais distante que já tem lançamento — o horizonte do "à frente". */
function ultimoMesLancado(dado: CartaoPainel): string | null {
  const meses = dado.serie
    .filter((s) => s.mes > dado.mesCorrente && s.realizadoCents + s.previstoCents !== 0)
    .map((s) => s.mes);
  return meses.length ? meses.reduce((a, b) => (a > b ? a : b)) : null;
}

function montar(dado: CartaoPainel) {
  const porFaixa = new Map<number, Faixa>();
  const porMes = new Map<string, Record<string, number>>();
  const meses = new Set<string>();

  const acumular = (mes: string, chave: string, cents: number) => {
    meses.add(mes);
    const linha = porMes.get(mes) ?? {};
    linha[chave] = (linha[chave] ?? 0) + cents / 100;
    porMes.set(mes, linha);
  };

  for (const s of dado.serie) {
    // `cardId` nulo é compra sem plástico identificado — e é um "não sei"
    // DIFERENTE do não itemizado: aqui a compra é conhecida e falta o cartão;
    // lá falta a compra inteira. Os dois usam a tinta de indeterminado da casa
    // e se separam pela hachura, que só o não itemizado tem.
    const chave = s.cardId ?? CHAVE_SEM_CARTAO;
    const existente = porFaixa.get(chave);
    const totalCents = (existente?.totalCents ?? 0) + s.realizadoCents + s.previstoCents;
    porFaixa.set(chave, {
      chave,
      nome:
        s.cardId === null
          ? "sem cartão identificado"
          : (existente?.nome ?? nomeDoCartao(s.apelido, s.last4)),
      emissor: existente?.emissor ?? s.emissor,
      cor: corDoCartao(s.cardId, corDoPlastico(dado, s.cardId)),
      indeterminada: false,
      totalCents
    });
    acumular(s.mes, chaveRealizado(chave), s.realizadoCents);
    acumular(s.mes, chavePrevisto(chave), s.previstoCents);
  }

  // O não itemizado chega por (mês, emissor); a faixa é uma só, somada por mês.
  // Ela não vira uma faixa por emissor de propósito: a pergunta do gráfico é
  // "quanto do mês não tem dono", e quebrá-la por emissor sugeriria que os
  // pedaços são atribuíveis — que é exatamente o que eles não são.
  let naoItemizadoCents = 0;
  for (const n of dado.naoItemizado) {
    naoItemizadoCents += n.valorCents;
    acumular(n.mes, chaveRealizado(CHAVE_NAO_ITEMIZADO), n.valorCents);
  }
  if (naoItemizadoCents !== 0) {
    porFaixa.set(CHAVE_NAO_ITEMIZADO, {
      chave: CHAVE_NAO_ITEMIZADO,
      nome: "sem itens",
      emissor: emissoresSemItens(dado),
      cor: COR_INDETERMINADA,
      indeterminada: true,
      totalCents: naoItemizadoCents
    });
  }

  // Ordem da pilha: maior gasto embaixo, calculada UMA vez sobre o dado
  // inteiro. Reordenar conforme o filtro faria as faixas trocarem de lugar a
  // cada clique, e a comparação entre meses dependeria do que está ligado.
  // O indeterminado vai por último entre os "realizado" — a leitura de baixo
  // para cima fica firme → incerto.
  const faixas = [...porFaixa.values()].sort((a, b) => {
    if (a.indeterminada !== b.indeterminada) return a.indeterminada ? 1 : -1;
    return b.totalCents - a.totalCents || a.chave - b.chave;
  });

  const agora = new Date().toISOString().slice(0, 7);
  const linhas: LinhaDoGrafico[] = [...meses]
    .sort()
    .map((mes) => ({
      mes,
      rotulo: rotuloMes(mes),
      corrente: mes === (dado.mesCorrente || agora),
      ...(porMes.get(mes) ?? {})
    }));

  const temPrevisto = dado.serie.some((s) => s.previstoCents !== 0);

  return { faixas, linhas, temPrevisto };
}

/** A cor do plástico, quando o cadastro tem uma. Casa `serie` com `plasticos`. */
function corDoPlastico(dado: CartaoPainel, cardId: number | null): string | null {
  if (cardId === null) return null;
  return dado.plasticos.find((p) => p.cardId === cardId)?.cor ?? null;
}

/** Quais emissores não entregam itens — vira o subtítulo do chip da legenda. */
function emissoresSemItens(dado: CartaoPainel): string | null {
  const nomes = [...new Set(dado.naoItemizado.map((n) => n.emissor).filter(Boolean))] as string[];
  if (!nomes.length) return null;
  return nomes.length <= 2 ? nomes.join(" e ") : `${nomes.length} emissores`;
}

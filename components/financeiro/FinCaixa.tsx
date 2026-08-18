"use client";

import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import { ChartWithLegend, useLegendToggle, type LegendSeries } from "@/components/charts/useLegendToggle";
import { Medida, Ressalva, SeloCamada, brl } from "@/components/financeiro/Certeza";
import { brlCompact, brlPrecise, monthKeyLabel, shortDateLabel } from "@/lib/financeiro/format";
import type {
  CaixaDado,
  CaixinhaAncora,
  CaixinhaDetalhe,
  CaixinhaMovimento,
  CaixinhaPosicao,
  ContaCaixa,
  PontoSerie
} from "@/lib/financeiro/contratos/caixa";

/**
 * Caixa por conta, com histórico, e o Pronampe.
 *
 * ---------------------------------------------------------------------------
 * A PALETA FOI VALIDADA, NÃO ESCOLHIDA A OLHO
 * ---------------------------------------------------------------------------
 * As quatro cores de conta passaram no validador de daltonismo contra a
 * superfície branca dos cards (#ffffff):
 *
 *   #6d28d9 · #21a67a · #b67818 · #2a78d6
 *   faixa de luminosidade PASS · piso de croma PASS · separação CVD PASS
 *   (pior par adjacente ΔE 9,9 deutan / 21,0 tritan) · visão normal ΔE 18,7
 *   · contraste ≥ 3:1 PASS
 *
 * A ordem é fixa e a cor segue a CONTA, nunca a posição na lista — filtrar
 * uma série não pode repintar as outras.
 *
 * O roxo do tema (#6d28d9) já é a cor da marca; o teal da paleta antiga
 * (#0f766e) foi recusado pelo validador (croma 0,086, abaixo do piso: lê como
 * cinza) e trocado pelo azul.
 */

/** Cor por conta, fixa. Nunca por índice da lista renderizada. */
const COR_CONTA: Record<string, string> = {
  asaas: "#6d28d9",
  inter: "#21a67a",
  nubank: "#b67818",
  "nubank-caixinhas": "#2a78d6"
};
const COR_FALLBACK = "#4b5563";

/** O passivo nunca divide gráfico com as contas, então pode ter cor própria. */
const COR_DIVIDA = "#c8553d";

const GRID = "#e1e0d9";
const EIXO = "#898781";
const SUPERFICIE = "#ffffff";

const corDe = (slug: string) => COR_CONTA[slug] ?? COR_FALLBACK;

type Props = { dado: CaixaDado; ressalvas: string[] };

type Aba = "contas" | "emprestimo";

export function FinCaixa({ dado, ressalvas }: Props) {
  const [aba, setAba] = useState<Aba>("contas");

  return (
    <div className="fin-caixa">
      <div className="fin-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={aba === "contas"}
          className={aba === "contas" ? "is-active" : undefined}
          onClick={() => setAba("contas")}
        >
          Caixa por conta
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={aba === "emprestimo"}
          className={aba === "emprestimo" ? "is-active" : undefined}
          onClick={() => setAba("emprestimo")}
        >
          Empréstimo Pronampe
        </button>
      </div>

      {ressalvas.length > 0 && (
        <Ressalva>
          <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
            {ressalvas.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </Ressalva>
      )}

      {aba === "contas" ? <PainelContas dado={dado} /> : <PainelEmprestimo dado={dado} />}
    </div>
  );
}

/* ========================================================================== */
/* CAIXA POR CONTA                                                            */
/* ========================================================================== */

function PainelContas({ dado }: { dado: CaixaDado }) {
  const comSaldo = dado.contas.filter((c) => c.saldoCents !== null);
  const semSaldo = dado.contas.filter((c) => c.saldoCents === null);

  return (
    <>
      {/* O total é um número, não um gráfico. Uma barra só não é gráfico. */}
      <section className="fin-card">
        <header className="fin-card-head">
          <h2>Hoje</h2>
          <p className="fin-card-hint">
            {comSaldo.length} conta(s) com extrato · {semSaldo.length} sem
          </p>
        </header>
        <div className="medida-grid">
          <Medida
            rotulo="Total disponível"
            valorCents={dado.totalDisponivelCents}
            cobertura={dado.contas.length ? comSaldo.length / dado.contas.length : 0}
            detalhe={`soma de ${comSaldo.length} conta(s) com extrato`}
            vies={
              semSaldo.length
                ? `${semSaldo.length} conta(s) sem extrato ficam de fora — o total é PISO`
                : undefined
            }
          />
          {comSaldo.map((c) => (
            <Medida
              key={c.slug}
              rotulo={c.nome}
              valorCents={c.saldoCents as number}
              detalhe={`${c.lancamentos.toLocaleString("pt-BR")} lançamentos · extrato até ${
                shortDateLabel(c.ultimoMovimento) ?? "—"
              }`}
            />
          ))}
          {semSaldo.map((c) => (
            <Medida key={c.slug} rotulo={c.nome} valorCents={null} motivo={c.motivoSemSaldo ?? "sem extrato"} />
          ))}
        </div>
        {semSaldo.some((c) => c.passivoSaldoDevedorCents !== null) && (
          <p className="fin-card-hint" style={{ marginTop: 12 }}>
            A conta do empréstimo não tem saldo porque não tem extrato — mas tem dívida. O saldo
            devedor aparece na aba <strong>Empréstimo Pronampe</strong> e{" "}
            <strong>não está somado</strong> no total acima: é passivo, não dinheiro disponível.
          </p>
        )}
      </section>

      <PainelCaixinhas caixinhas={dado.caixinhas} />

      <GraficoEmpilhado serie={dado.serie} contas={dado.contas} />
      <GraficosIndividuais serie={dado.serie} contas={dado.contas} />
    </>
  );
}

/* ========================================================================== */
/* AS CAIXINHAS, POR DENTRO                                                   */
/* ========================================================================== */
/**
 * O pedido foi: clicar na caixinha e ver as subcaixas.
 *
 * ---------------------------------------------------------------------------
 * O NÍVEL QUE O FERNANDO PROCURA NÃO EXISTE NA FONTE — E A TELA DIZ ISSO
 * ---------------------------------------------------------------------------
 * "Caixinha" com nome ("Reserva", "Impostos") é agrupamento do APLICATIVO do
 * Nubank. O Open Finance transmite a camada de baixo: o lote de CDB da NU
 * FINANCEIRA que lastreia o dinheiro. Medido campo a campo na 0114 — `name`
 * tem UM valor distinto em 66 posições e todos os campos de identidade são
 * nulos.
 *
 * Então a tela mostra os dois níveis que EXISTEM (conta → posição →
 * movimento) e carimba o nível ausente com a hachura roxa de indeterminado,
 * com o motivo ao lado. Inventar "Caixinha 1", "Caixinha 2" a partir de valor
 * ou data seria o rótulo inventado que a restrição 5 proíbe.
 *
 * ---------------------------------------------------------------------------
 * UM NÍVEL POR VEZ, E A SOMA DOS FILHOS SEMPRE À VISTA
 * ---------------------------------------------------------------------------
 * Cada linha soma apenas os FILHOS DIRETOS, nunca os netos. A soma aparece ao
 * lado do total do pai, sempre — não só quando diverge. Um confronto que só
 * aparece no erro ensina a ler o silêncio como ausência de conferência; visível
 * sempre, ele vira prova.
 *
 * Quando diverge, a tela mostra o número e o nome do que falta. Não há
 * arredondamento que absorva: no nível da conta a divergência é defeito de
 * sincronização; no nível da posição é histórico de movimento incompleto na
 * fonte, e vale R$ 12,14 numa das 18 ativas hoje.
 */
function PainelCaixinhas({ caixinhas }: { caixinhas: CaixinhaDetalhe }) {
  const [contaAberta, setContaAberta] = useState<string | null>(null);
  const [posicaoAberta, setPosicaoAberta] = useState<number | null>(null);

  // Contas de aplicação que de fato têm carteira. `caixa-aplicacao` existe com
  // zero posições e não deve virar uma linha vazia para clicar.
  const comCarteira = caixinhas.ancoras.filter((a) => a.posicoes > 0);

  if (caixinhas.indisponivelMotivo) {
    return (
      <section className="fin-card">
        <header className="fin-card-head">
          <h2>As caixinhas, por dentro</h2>
        </header>
        <div className="cert-hachura" style={{ padding: "14px 16px", borderRadius: 6 }}>
          <SeloCamada camada="indeterminado" />
          <p style={{ margin: "8px 0 0", fontSize: 13 }}>{caixinhas.indisponivelMotivo}</p>
        </div>
      </section>
    );
  }

  if (!comCarteira.length) return null;

  const abrirConta = (slug: string) => {
    setContaAberta((atual) => (atual === slug ? null : slug));
    // Fechar a conta tem de fechar a posição junto: deixar um nível aberto
    // dentro de um pai fechado faz o próximo clique reabrir num estado que
    // ninguém pediu.
    setPosicaoAberta(null);
  };

  return (
    <section className="fin-card">
      <header className="fin-card-head">
        <h2>As caixinhas, por dentro</h2>
        <p className="fin-card-hint">
          Clique para expandir um nível. Cada linha mostra o próprio total e, ao lado, a soma dos
          seus filhos diretos — se os dois não baterem, a diferença aparece com nome.
        </p>
      </header>

      <div className="cx-arvore">
        {comCarteira.map((a) => (
          <NoConta
            key={a.accountSlug}
            ancora={a}
            aberta={contaAberta === a.accountSlug}
            onToggle={() => abrirConta(a.accountSlug)}
            posicoes={caixinhas.posicoes.filter((p) => p.accountSlug === a.accountSlug)}
            movimentos={caixinhas.movimentos}
            posicaoAberta={posicaoAberta}
            onTogglePosicao={(id) => setPosicaoAberta((atual) => (atual === id ? null : id))}
          />
        ))}
      </div>
    </section>
  );
}

/** Nível 0 → 1: a conta, expandindo nas posições. */
function NoConta({
  ancora,
  aberta,
  onToggle,
  posicoes,
  movimentos,
  posicaoAberta,
  onTogglePosicao
}: {
  ancora: CaixinhaAncora;
  aberta: boolean;
  onToggle: () => void;
  posicoes: CaixinhaPosicao[];
  movimentos: CaixinhaMovimento[];
  posicaoAberta: number | null;
  onTogglePosicao: (id: number) => void;
}) {
  const ativas = posicoes.filter((p) => p.status === "ativa");
  const encerradas = posicoes.filter((p) => p.status !== "ativa");
  // O motivo é o mesmo em todas as linhas — vem do banco uma vez por posição, e
  // a tela mostra uma vez por conta.
  const motivoNome = posicoes[0]?.caixinhaNomeMotivo ?? "";

  return (
    <div className="cx-no" data-nivel="conta">
      <button
        type="button"
        className="cx-linha"
        aria-expanded={aberta}
        onClick={onToggle}
        style={{ borderLeftColor: corDe(ancora.accountSlug) }}
      >
        <span className="cx-chevron" aria-hidden>
          {aberta ? "▾" : "▸"}
        </span>
        <span className="cx-nome">
          {ancora.accountNome}
          <small>
            {ancora.posicoesAtivas} posição(ões) ativa(s)
            {ancora.posicoesEncerradas ? ` · ${ancora.posicoesEncerradas} encerrada(s)` : ""}
            {ancora.lidoEm ? ` · lido em ${shortDateLabel(ancora.lidoEm)}` : ""}
          </small>
        </span>
        <ConfrontoPaiFilhos
          rotuloPai="saldo da conta"
          paiCents={ancora.saldoContaCents}
          rotuloFilhos={`soma das ${ancora.posicoes} posições`}
          filhosCents={ancora.somaPosicoesCents}
          diferencaNome="defeito de sincronização: alguma posição entrou sem lançamento, ou o saldo foi mexido à mão"
        />
      </button>

      {aberta && (
        <div className="cx-filhos">
          {/* A lacuna, uma vez por conta, antes da lista — a ressalva vem
              ANTES do número, não num rodapé depois de a pessoa já ter lido. */}
          <div className="cert-hachura cx-lacuna">
            <SeloCamada camada="indeterminado" texto="nome da caixinha" />
            <p>{motivoNome}</p>
            <p className="cx-lacuna-saida">
              O que está abaixo é a camada que a fonte entrega: cada lote de CDB que lastreia o
              dinheiro, com emissão, vencimento, taxa e imposto. A soma deles é o saldo da conta,
              ao centavo.
            </p>
          </div>

          {ativas.map((p) => (
            <NoPosicao
              key={p.posicaoId}
              posicao={p}
              aberta={posicaoAberta === p.posicaoId}
              onToggle={() => onTogglePosicao(p.posicaoId)}
              movimentos={movimentos.filter((m) => m.posicaoId === p.posicaoId)}
            />
          ))}

          {encerradas.length > 0 && (
            <p className="cx-encerradas">
              {encerradas.length} posição(ões) já liquidada(s), somando{" "}
              {/* MEDIDO, não afirmado. Escrever "R$ 0,00" à mão aqui faria a
                  frase continuar dizendo zero no dia em que uma liquidada
                  voltasse com saldo — e essa é a linha que ninguém releria. */}
              {brl(encerradas.reduce((s, p) => s + p.saldoCents, 0))} — são histórico, não caixa, e
              por isso ficam fora da lista. Elas continuam no banco e nos movimentos, e estão
              somadas no confronto acima.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Nível 1 → 2: a posição, expandindo nos movimentos. */
function NoPosicao({
  posicao,
  aberta,
  onToggle,
  movimentos
}: {
  posicao: CaixinhaPosicao;
  aberta: boolean;
  onToggle: () => void;
  movimentos: CaixinhaMovimento[];
}) {
  const p = posicao;

  return (
    <div className="cx-no" data-nivel="posicao">
      <button type="button" className="cx-linha" aria-expanded={aberta} onClick={onToggle}>
        <span className="cx-chevron" aria-hidden>
          {aberta ? "▾" : "▸"}
        </span>
        <span className="cx-nome">
          {p.produto} #{p.externalId}
          <small>
            {p.indexador && p.taxaPercent !== null ? `${p.taxaPercent}% do ${p.indexador} · ` : ""}
            emitido em {shortDateLabel(p.emissaoEm) ?? "—"} · vence em{" "}
            {shortDateLabel(p.vencimentoEm) ?? "—"} · {p.movimentos} movimento(s)
          </small>
        </span>
        <ConfrontoPaiFilhos
          rotuloPai="saldo da posição"
          paiCents={p.saldoCents}
          rotuloFilhos={`${p.movimentos} movimento(s), líquido`}
          filhosCents={p.fluxoLiquidoCents}
          // A diferença ESPERADA entre saldo e fluxo tem nome: é o rendimento
          // apropriado dentro da aplicação, que nunca passa pela conta
          // corrente. Ela não é erro — só precisa ser dita.
          esperadoCents={p.rendimentoLiquidoCents}
          esperadoNome="rendimento apropriado dentro da posição (nunca passou pela conta corrente)"
          diferencaNome="movimento que a fonte não entregou: o saldo não se explica nem por fluxo nem por rendimento"
        />
      </button>

      {aberta && (
        <div className="cx-filhos">
          <dl className="cx-ficha">
            <div>
              <dt>principal aplicado</dt>
              <dd>{brl(p.principalCents)}</dd>
            </div>
            <div>
              <dt>bruto</dt>
              <dd>{brl(p.brutoCents)}</dd>
            </div>
            <div>
              <dt>IR/IOF provisionado</dt>
              <dd>−{brl(p.impostosCents)}</dd>
            </div>
            <div>
              <dt>saldo líquido</dt>
              <dd>
                <strong>{brl(p.saldoCents)}</strong>
              </dd>
            </div>
            <div>
              <dt>carência</dt>
              <dd>{shortDateLabel(p.carenciaEm) ?? "—"}</dd>
            </div>
            <div>
              <dt>emissor</dt>
              <dd title={p.emissor ?? ""}>{p.emissor ?? "—"}</dd>
            </div>
          </dl>

          {movimentos.length ? (
            <table className="cx-mov">
              <thead>
                <tr>
                  <th>data</th>
                  <th>movimento</th>
                  <th style={{ textAlign: "right" }}>valor</th>
                </tr>
              </thead>
              <tbody>
                {movimentos.map((m) => (
                  <tr key={m.movimentoId}>
                    <td>{shortDateLabel(m.dataEm) ?? "—"}</td>
                    <td>{m.direcao === "aplicacao" ? "aplicação" : "resgate"}</td>
                    <td
                      style={{
                        textAlign: "right",
                        fontVariantNumeric: "tabular-nums",
                        color: m.assinadoCents < 0 ? "var(--cert-atrasado)" : undefined
                      }}
                    >
                      {m.assinadoCents < 0 ? "−" : "+"}
                      {brl(Math.abs(m.assinadoCents))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="cx-encerradas">
              Nenhum movimento nesta posição no acervo. Ela existe no saldo, e o que a criou é
              anterior à janela coberta.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * O total do pai, a soma dos filhos DIRETOS, e a diferença com nome.
 *
 * `esperadoCents` é a parte da diferença que já tem explicação (o rendimento,
 * no caso da posição). O que sobra depois dela é o achado, e recebe destaque —
 * nunca some num arredondamento.
 */
function ConfrontoPaiFilhos({
  rotuloPai,
  paiCents,
  rotuloFilhos,
  filhosCents,
  esperadoCents = 0,
  esperadoNome,
  diferencaNome
}: {
  rotuloPai: string;
  paiCents: number;
  rotuloFilhos: string;
  filhosCents: number;
  esperadoCents?: number;
  esperadoNome?: string;
  diferencaNome: string;
}) {
  const residuo = paiCents - filhosCents;
  const sobra = residuo - esperadoCents;

  return (
    <span className="cx-confronto">
      <span className="cx-val">
        <b>{brl(paiCents)}</b>
        <small>{rotuloPai}</small>
      </span>
      <span className="cx-igual" data-bate={sobra === 0 ? "1" : "0"} aria-hidden>
        {sobra === 0 ? "=" : "≠"}
      </span>
      <span className="cx-val">
        <b>{brl(filhosCents)}</b>
        <small>{rotuloFilhos}</small>
      </span>
      {esperadoCents !== 0 && (
        <span className="cx-val cx-esperado" title={esperadoNome}>
          <b>+{brl(esperadoCents)}</b>
          <small>rendimento</small>
        </span>
      )}
      {sobra !== 0 && (
        <span className="cx-val cx-sobra cert-hachura" title={diferencaNome}>
          <b>
            {sobra < 0 ? "−" : "+"}
            {brl(Math.abs(sobra))}
          </b>
          <small>sem explicação</small>
        </span>
      )}
    </span>
  );
}

/**
 * O coletivo: saldo por conta, empilhado no tempo.
 *
 * Empilhado responde "quanto a empresa tinha, e de quem era" numa leitura só —
 * que é literalmente o pedido. Área com 2px de respiro entre as faixas: a
 * separação é feita pela superfície, nunca por uma borda desenhada em volta.
 */
function GraficoEmpilhado({ serie, contas }: { serie: PontoSerie[]; contas: ContaCaixa[] }) {
  const slugs = useMemo(
    () => contas.filter((c) => c.temCobertura).map((c) => c.slug),
    [contas]
  );
  const { hidden, isHidden, toggle } = useLegendToggle();

  const series: LegendSeries[] = slugs.map((s) => ({
    dataKey: s,
    name: contas.find((c) => c.slug === s)?.nome ?? s,
    color: corDe(s),
    type: "rect"
  }));

  const pontos = useMemo(() => {
    const porMes = new Map<string, Record<string, number | string>>();
    for (const p of serie) {
      if (!porMes.has(p.mes)) porMes.set(p.mes, { mes: monthKeyLabel(`${p.mes}-01`) });
      porMes.get(p.mes)![p.slug] = p.saldoFimCents / 100;
    }
    // Conta que ainda não existia naquele mês fica ausente, não zero: uma faixa
    // em zero afirmaria que a conta existia e estava vazia.
    return [...porMes.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
  }, [serie]);

  if (!pontos.length) return null;

  const visiveis = slugs.filter((s) => !isHidden(s));

  return (
    <section className="fin-card">
      <header className="fin-card-head">
        <h2>Saldo por conta no tempo, empilhado</h2>
        <p className="fin-card-hint">
          A altura da pilha é o caixa total do mês; cada faixa é uma conta. Mês em que uma conta
          ainda não tinha extrato não desenha faixa — ausência não é zero.
        </p>
      </header>
      <ChartWithLegend series={series} hidden={hidden} onToggle={toggle}>
        <ResponsiveContainer width="100%" height={320}>
          <AreaChart data={pontos} margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis
              dataKey="mes"
              tick={{ fontSize: 11, fill: EIXO }}
              axisLine={false}
              tickLine={false}
              minTickGap={24}
            />
            <YAxis
              tick={{ fontSize: 11, fill: EIXO }}
              axisLine={false}
              tickLine={false}
              width={72}
              tickFormatter={(v: number) => brlCompact(v * 100)}
            />
            <Tooltip content={<TooltipCaixa contas={contas} empilhado />} />
            {visiveis.map((s) => (
              <Area
                key={s}
                type="monotone"
                dataKey={s}
                stackId="caixa"
                stroke={corDe(s)}
                strokeWidth={2}
                // O respiro de 2px entre faixas é feito pela superfície.
                fill={corDe(s)}
                fillOpacity={0.16}
                connectNulls={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: SUPERFICIE }}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </ChartWithLegend>
    </section>
  );
}

/**
 * Os individuais: pequenos múltiplos, uma conta por painel.
 *
 * Cada painel tem UMA série, então não leva legenda — o título já diz o que
 * está plotado. A escala é própria de cada conta de propósito: o Asaas gira
 * R$ 78 mil e o Inter R$ 1,5 mil; forçar eixo comum apagaria a forma do menor.
 * O valor de fim de série é rotulado direto; o resto fica no eixo e no tooltip.
 */
function GraficosIndividuais({ serie, contas }: { serie: PontoSerie[]; contas: ContaCaixa[] }) {
  const comCobertura = contas.filter((c) => c.temCobertura);
  if (!comCobertura.length) return null;

  return (
    <section className="fin-card">
      <header className="fin-card-head">
        <h2>Cada conta, no seu próprio eixo</h2>
        <p className="fin-card-hint">
          Barras são o movimento do mês (entrada menos saída); a linha é o saldo ao fim do mês. A
          escala é própria de cada conta — o Asaas gira dezenas de milhares e o Inter, milhares.
        </p>
      </header>
      <div className="fin-multiplos">
        {comCobertura.map((c) => (
          <PainelConta key={c.slug} conta={c} serie={serie.filter((p) => p.slug === c.slug)} />
        ))}
      </div>
      {contas
        .filter((c) => !c.temCobertura)
        .map((c) => (
          <div key={c.slug} className="cert-hachura fin-conta-vazia">
            <strong>{c.nome}</strong>
            <SeloCamada camada="indeterminado" />
            <p>{c.motivoSemSaldo}</p>
          </div>
        ))}
    </section>
  );
}

function PainelConta({ conta, serie }: { conta: ContaCaixa; serie: PontoSerie[] }) {
  const cor = corDe(conta.slug);
  const pontos = serie.map((p) => ({
    mes: monthKeyLabel(`${p.mes}-01`),
    movimento: p.movimentoCents / 100,
    saldo: p.saldoFimCents / 100
  }));
  if (!pontos.length) return null;

  return (
    <figure className="fin-multiplo">
      <figcaption>
        <span className="fin-multiplo-k">
          <i aria-hidden style={{ background: cor }} />
          {conta.nome}
        </span>
        <strong>{brlPrecise(conta.saldoCents ?? 0)}</strong>
      </figcaption>
      <ResponsiveContainer width="100%" height={150}>
        <ComposedChart data={pontos} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis
            dataKey="mes"
            tick={{ fontSize: 10, fill: EIXO }}
            axisLine={false}
            tickLine={false}
            minTickGap={28}
          />
          <YAxis
            tick={{ fontSize: 10, fill: EIXO }}
            axisLine={false}
            tickLine={false}
            width={54}
            tickFormatter={(v: number) => brlCompact(v * 100)}
          />
          <Tooltip content={<TooltipConta nome={conta.nome} />} />
          <Bar dataKey="movimento" fill={cor} fillOpacity={0.28} maxBarSize={18} radius={[4, 4, 0, 0]} />
          <Line
            type="monotone"
            dataKey="saldo"
            stroke={cor}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: SUPERFICIE }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </figure>
  );
}

/* ========================================================================== */
/* EMPRÉSTIMO                                                                 */
/* ========================================================================== */

function PainelEmprestimo({ dado }: { dado: CaixaDado }) {
  const e = dado.emprestimo;
  if (!e) {
    return (
      <section className="fin-card">
        <p className="fin-card-hint">
          A migration <code>0110_fin_emprestimo</code> ainda não está aplicada neste ambiente. O
          contrato existe em <code>emprestimo/</code> e o modelo está validado, mas nada foi gravado
          — a tela prefere dizer isso a mostrar uma lista vazia, que seria indistinguível de
          &quot;não há empréstimo&quot;.
        </p>
      </section>
    );
  }

  return (
    <>
      <Ressalva>
        <strong>Todo número desta aba é estimativa.</strong> Não existe extrato da conta da XPE na
        Caixa — a prestação é debitada dentro dela e este acervo nunca viu esse débito. O que é
        real são as {e.transferencias} transferências que abastecem a conta, medidas no extrato de
        origem. O saldo devedor é <strong>piso</strong>: supõe adimplência integral, e atraso só faz
        subir.
      </Ressalva>

      <section className="fin-card">
        <header className="fin-card-head">
          <h2>Saldo devedor hoje</h2>
          <p className="fin-card-hint">
            CCB {e.ccb} · {e.credor} · débito em {e.contaDebitoContrato}
          </p>
        </header>
        <div className="medida-grid">
          <Medida
            rotulo="Saldo devedor estimado"
            valorCents={e.saldoDevedorCents}
            detalhe={`após a parcela ${e.ultimaParcelaVencida}/${e.prestacoes} de ${shortDateLabel(
              e.ultimaParcelaEm
            )} · PISO`}
          />
          <Medida
            rotulo="Já amortizado do principal"
            valorCents={e.principalCents - e.saldoDevedorCents}
            detalhe={`de ${brlPrecise(e.principalCents)} contratados`}
          />
          <Medida
            rotulo="Próxima prestação"
            valorCents={e.proximaPrestacaoCents ?? 0}
            detalhe={`vence ${shortDateLabel(e.proximaParcelaEm)} · ${
              e.proximaOrigemTaxa === "cenario" ? "cenário: Selic de hoje" : "Selic observada"
            }`}
          />
          <Medida
            rotulo="Transferido para a Caixa"
            valorCents={e.transferidoCents}
            detalhe={`${e.transferencias} lançamentos, de ${shortDateLabel(
              e.primeiraTransferenciaEm
            )} a ${shortDateLabel(e.ultimaTransferenciaEm)}`}
          />
        </div>

        <div className="fin-memoria">
          <h3>Memória de cálculo</h3>
          <p>{e.memoria}</p>
          <dl>
            <div>
              <dt>Prazo</dt>
              <dd>
                {e.prazoTotalMeses} meses = {e.carenciaMeses} de carência + {e.prestacoes} prestações.
                Não é contradição: 48 é prazo, 37 é número de parcelas.
              </dd>
            </div>
            <div>
              <dt>Taxa</dt>
              <dd>
                spread de {(e.spreadMensal * 100).toFixed(6)}% a.m. <strong>× Selic do período</strong>.
                Pós-fixada (Cláusula Quarta, §1º e §2º) — por isso a prestação varia mês a mês.
              </dd>
            </div>
            <div>
              <dt>A prova da leitura</dt>
              <dd>
                Com o spread <em>sozinho</em>, a Price de {e.prestacoes} parcelas sobre{" "}
                {e.carenciaMeses} meses de capitalização dá{" "}
                <strong>{brlPrecise(e.prestacaoContratualCents)}</strong> — exatamente a prestação
                impressa na CCB. É isso que prova que 0,486755 é spread e não a taxa total.
              </dd>
            </div>
            <div>
              <dt>Selic</dt>
              <dd>
                {e.fonteIndexador} — fonte primária, consultada em{" "}
                {shortDateLabel(e.fonteIndexadorConsultadaEm)}. Fator acumulado no intervalo de
                competência de cada parcela.
              </dd>
            </div>
            <div>
              <dt>Ressalva</dt>
              <dd>{e.ressalva}</dd>
            </div>
          </dl>
        </div>
      </section>

      <GraficoDivida confronto={dado.confronto} />
      <GraficoConfronto confronto={dado.confronto} />
      <TabelaConfronto confronto={dado.confronto} />
      <ExtratoEstimado dado={dado} />
      <Premissas dado={dado} />
    </>
  );
}

/** Uma série só: sem caixa de legenda — o título já diz o que está plotado. */
function GraficoDivida({ confronto }: { confronto: CaixaDado["confronto"] }) {
  const pontos = confronto.map((p) => ({
    mes: monthKeyLabel(`${p.vencimentoEm.slice(0, 7)}-01`),
    saldo: p.saldoDevedorCents / 100,
    cenario: p.origemTaxa === "cenario"
  }));
  if (!pontos.length) return null;
  const corte = pontos.findIndex((p) => p.cenario);

  return (
    <section className="fin-card">
      <header className="fin-card-head">
        <h2>O saldo devedor caindo até 02/04/2028</h2>
        <p className="fin-card-hint">
          Da parcela {corte >= 0 ? corte + 1 : "—"} em diante a Selic ainda não existe: a curva vira
          cenário, calculado com a última Selic observada. Ela sobe ou desce com a Selic real.
        </p>
      </header>
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={pontos} margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis
            dataKey="mes"
            tick={{ fontSize: 11, fill: EIXO }}
            axisLine={false}
            tickLine={false}
            minTickGap={24}
          />
          <YAxis
            tick={{ fontSize: 11, fill: EIXO }}
            axisLine={false}
            tickLine={false}
            width={72}
            tickFormatter={(v: number) => brlCompact(v * 100)}
          />
          <Tooltip content={<TooltipDivida />} />
          <Area
            type="monotone"
            dataKey="saldo"
            stroke={COR_DIVIDA}
            strokeWidth={2}
            fill={COR_DIVIDA}
            fillOpacity={0.1}
            activeDot={{ r: 4, strokeWidth: 2, stroke: SUPERFICIE }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </section>
  );
}

/**
 * O confronto: o que o modelo prevê contra o que o extrato mostra.
 *
 * Barra = transferência real; linha = prestação modelada. Marcas diferentes,
 * não só cores diferentes — a identidade nunca depende só de cor. Um eixo só:
 * as duas séries são reais em dinheiro.
 */
function GraficoConfronto({ confronto }: { confronto: CaixaDado["confronto"] }) {
  const { hidden, isHidden, toggle } = useLegendToggle();
  const vencidas = confronto.filter((p) => p.estado !== "futura");
  if (!vencidas.length) return null;

  const series: LegendSeries[] = [
    { dataKey: "observado", name: "Transferido (real)", color: "#21a67a", type: "rect" },
    { dataKey: "modelo", name: "Prestação modelada", color: "#6d28d9", type: "line" },
    { dataKey: "contrato", name: "Prestação do contrato (taxa fixa)", color: "#b67818", type: "line" }
  ];

  const pontos = vencidas.map((p) => ({
    mes: monthKeyLabel(`${p.vencimentoEm.slice(0, 7)}-01`),
    parcela: p.parcela,
    observado: p.observadoCents === null ? null : p.observadoCents / 100,
    modelo: p.modeloCents / 100,
    contrato: p.contratoCents / 100,
    estado: p.estado
  }));

  return (
    <section className="fin-card">
      <header className="fin-card-head">
        <h2>Contrato × transferência, parcela a parcela</h2>
        <p className="fin-card-hint">
          A barra é dinheiro que saiu de verdade do Inter. A linha roxa é a prestação com Selic; a
          âmbar é a prestação que o contrato imprimiu em 2024, com a taxa daquele dia. A distância
          entre as duas linhas é o que a Selic fez.
        </p>
      </header>
      <ChartWithLegend series={series} hidden={hidden} onToggle={toggle}>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={pontos} margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis
              dataKey="mes"
              tick={{ fontSize: 11, fill: EIXO }}
              axisLine={false}
              tickLine={false}
              minTickGap={16}
            />
            <YAxis
              tick={{ fontSize: 11, fill: EIXO }}
              axisLine={false}
              tickLine={false}
              width={72}
              tickFormatter={(v: number) => brlCompact(v * 100)}
            />
            <Tooltip content={<TooltipConfronto />} />
            {!isHidden("observado") && (
              <Bar dataKey="observado" fill="#21a67a" maxBarSize={22} radius={[4, 4, 0, 0]} />
            )}
            {!isHidden("modelo") && (
              <Line
                type="monotone"
                dataKey="modelo"
                stroke="#6d28d9"
                strokeWidth={2}
                dot={{ r: 4, strokeWidth: 2, stroke: SUPERFICIE, fill: "#6d28d9" }}
                activeDot={{ r: 5, strokeWidth: 2, stroke: SUPERFICIE }}
              />
            )}
            {!isHidden("contrato") && (
              <Line
                type="monotone"
                dataKey="contrato"
                stroke="#b67818"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: SUPERFICIE }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </ChartWithLegend>
    </section>
  );
}

const ROTULO_ESTADO: Record<string, { texto: string; camada: "firme" | "observado" | "atrasado" | "indeterminado" }> = {
  vencida_com_funding_compativel: { texto: "transferência compatível", camada: "observado" },
  vencida_com_funding_insuficiente: { texto: "transferência insuficiente", camada: "atrasado" },
  vencida_sem_funding_na_janela_coberta: { texto: "sem funding na janela coberta", camada: "atrasado" },
  vencida_fora_da_cobertura: { texto: "fora da cobertura de extrato", camada: "indeterminado" },
  futura: { texto: "futura", camada: "indeterminado" }
};

function TabelaConfronto({ confronto }: { confronto: CaixaDado["confronto"] }) {
  const [tudo, setTudo] = useState(false);
  const linhas = tudo ? confronto : confronto.filter((p) => p.estado !== "futura");

  return (
    <section className="fin-card">
      <header className="fin-card-head">
        <h2>A tabela</h2>
        <button type="button" className="fin-link-btn" onClick={() => setTudo((v) => !v)}>
          {tudo ? "só as vencidas" : `mostrar as ${confronto.length} parcelas`}
        </button>
      </header>
      <div className="fin-table-wrap">
        <table className="fin-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Vencimento</th>
              <th style={{ textAlign: "right" }}>Taxa</th>
              <th style={{ textAlign: "right" }}>Encargo</th>
              <th style={{ textAlign: "right" }}>Principal</th>
              <th style={{ textAlign: "right" }}>Prestação (modelo)</th>
              <th style={{ textAlign: "right" }}>Transferido</th>
              <th style={{ textAlign: "right" }}>Diferença</th>
              <th style={{ textAlign: "right" }}>Saldo devedor</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((p) => {
              const r = ROTULO_ESTADO[p.estado] ?? { texto: p.estado, camada: "indeterminado" as const };
              return (
                <tr key={p.parcela} title={p.leitura}>
                  <td>{p.parcela}</td>
                  <td>{shortDateLabel(p.vencimentoEm)}</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {(p.taxaMes * 100).toFixed(4)}%{p.origemTaxa === "cenario" ? " *" : ""}
                  </td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {brlPrecise(p.encargoCents)}
                  </td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {brlPrecise(p.principalCents)}
                  </td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {brlPrecise(p.modeloCents)}
                  </td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {p.observadoCents === null ? "—" : brlPrecise(p.observadoCents)}
                  </td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {p.diferencaPct === null ? "—" : `${(p.diferencaPct * 100).toFixed(2)}%`}
                  </td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {brlPrecise(p.saldoDevedorCents)}
                  </td>
                  <td>
                    <SeloCamada camada={r.camada} texto={r.texto} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="fin-card-hint">
        * taxa de cenário: a Selic desse mês ainda não existe. Toda linha é estimada — não há
        extrato da conta debitada.
      </p>
    </section>
  );
}

function ExtratoEstimado({ dado }: { dado: CaixaDado }) {
  const e = dado.emprestimo!;
  return (
    <section className="fin-card">
      <header className="fin-card-head">
        <h2>Extrato estimado da conta na Caixa</h2>
        <p className="fin-card-hint">
          Entrada = transferência real no extrato de origem. Saída = prestação modelada. O acumulado
          é <strong>descasamento</strong>, não saldo: negativo quer dizer que faltou funding
          visível, não que a conta esteja negativa.
        </p>
      </header>

      <div className="medida-grid">
        <Medida
          rotulo="Devido na janela coberta"
          valorCents={e.devidoNaCoberturaCents}
          detalhe="prestações vencidas de 01/01/2026 em diante"
        />
        <Medida
          rotulo="Transferido na mesma janela"
          valorCents={e.transferidoCents}
          detalhe={`${e.transferencias} lançamentos, todos do Inter`}
        />
        <Medida
          rotulo="Lacuna sem origem conhecida"
          valorCents={e.lacunaNaCoberturaCents}
          detalhe="≈ 4 prestações · só o extrato da Caixa fecha isto"
        />
      </div>

      <p className="fin-card-hint" style={{ marginTop: 4 }}>
        <strong>
          {e.comFunding} de {e.comFunding + e.fundingInsuficiente + e.semFundingCoberta} prestações
        </strong>{" "}
        da janela coberta têm transferência compatível. {e.fundingInsuficiente} tem transferência
        insuficiente e {e.semFundingCoberta} não têm nenhuma — com as quatro contas do ledger
        cobertas, isso é ausência <em>medida</em>, não falta de busca. As outras{" "}
        {e.foraDaCobertura} venceram antes de 01/01/2026, quando só o Asaas enxergava.
      </p>

      <div className="fin-table-wrap">
        <table className="fin-table">
          <thead>
            <tr>
              <th>Data</th>
              <th>Movimento</th>
              <th style={{ textAlign: "right" }}>Valor</th>
              <th style={{ textAlign: "right" }}>Descasamento</th>
              <th>Origem</th>
            </tr>
          </thead>
          <tbody>
            {dado.extratoCaixa.map((l, i) => (
              <tr key={`${l.data}-${i}`} title={l.metodo} className={l.estimado ? "cert-hachura" : undefined}>
                <td>{shortDateLabel(l.data)}</td>
                <td>{l.descricao}</td>
                <td
                  style={{
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                    color: l.valorCents < 0 ? "#8a3f2f" : undefined
                  }}
                >
                  {brlPrecise(l.valorCents)}
                </td>
                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  {brlPrecise(l.descasamentoAcumuladoCents)}
                </td>
                <td>
                  <SeloCamada
                    camada={l.estimado ? "indeterminado" : "firme"}
                    texto={l.estimado ? "estimado" : "extrato de origem"}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Premissas({ dado }: { dado: CaixaDado }) {
  if (!dado.premissas.length) return null;
  return (
    <section className="fin-card">
      <header className="fin-card-head">
        <h2>As premissas declaradas</h2>
        <p className="fin-card-hint">
          Não são achados: são autorizações para seguir com dado faltando. Cada uma diz quem
          declarou, quando, e o que a derruba.
        </p>
      </header>
      <div className="fin-premissas">
        {dado.premissas.map((p) => (
          <article key={p.chave}>
            <h3>{p.enunciado}</h3>
            <p className="fin-premissa-meta">
              {p.declaradaPor} · {shortDateLabel(p.declaradaEm)}
            </p>
            <p>
              <strong>O que derruba:</strong> {p.oQueDerruba}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

/* ========================================================================== */
/* TOOLTIPS                                                                   */
/* ========================================================================== */

type TipProps = {
  active?: boolean;
  payload?: { dataKey?: string | number; value?: number; payload?: Record<string, unknown> }[];
  label?: string | number;
};

function Caixa({ children }: { children: React.ReactNode }) {
  return <div className="fin-tooltip">{children}</div>;
}

function TooltipCaixa({ active, payload, label, contas, empilhado }: TipProps & { contas: ContaCaixa[]; empilhado?: boolean }) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((a, p) => a + (p.value ?? 0), 0);
  return (
    <Caixa>
      <strong>{label}</strong>
      {payload.map((p) => {
        const slug = String(p.dataKey);
        return (
          <div key={slug} className="fin-tooltip-linha">
            <i aria-hidden style={{ background: corDe(slug) }} />
            <span>{contas.find((c) => c.slug === slug)?.nome ?? slug}</span>
            <b>{brl((p.value ?? 0) * 100)}</b>
          </div>
        );
      })}
      {empilhado && payload.length > 1 && (
        <div className="fin-tooltip-total">
          <span>Total</span>
          <b>{brl(total * 100)}</b>
        </div>
      )}
    </Caixa>
  );
}

function TooltipConta({ active, payload, label, nome }: TipProps & { nome: string }) {
  if (!active || !payload?.length) return null;
  const mov = payload.find((p) => p.dataKey === "movimento")?.value ?? 0;
  const saldo = payload.find((p) => p.dataKey === "saldo")?.value ?? 0;
  return (
    <Caixa>
      <strong>
        {nome} · {label}
      </strong>
      <div className="fin-tooltip-linha">
        <span>Movimento no mês</span>
        <b>{brl(mov * 100)}</b>
      </div>
      <div className="fin-tooltip-linha">
        <span>Saldo ao fim</span>
        <b>{brl(saldo * 100)}</b>
      </div>
    </Caixa>
  );
}

function TooltipDivida({ active, payload, label }: TipProps) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  const cenario = Boolean(p.payload?.cenario);
  return (
    <Caixa>
      <strong>{label}</strong>
      <div className="fin-tooltip-linha">
        <span>Saldo devedor</span>
        <b>{brl((p.value ?? 0) * 100)}</b>
      </div>
      <p className="fin-tooltip-nota">
        {cenario ? "cenário: Selic estimada pela última observada" : "Selic observada no período"}
      </p>
    </Caixa>
  );
}

function TooltipConfronto({ active, payload, label }: TipProps) {
  if (!active || !payload?.length) return null;
  const linha = payload[0]?.payload ?? {};
  const estado = String(linha.estado ?? "");
  const r = ROTULO_ESTADO[estado];
  const obs = linha.observado as number | null;
  const mod = linha.modelo as number;
  return (
    <Caixa>
      <strong>
        Parcela {String(linha.parcela)} · {label}
      </strong>
      <div className="fin-tooltip-linha">
        <i aria-hidden style={{ background: "#6d28d9" }} />
        <span>Prestação modelada</span>
        <b>{brl(mod * 100)}</b>
      </div>
      <div className="fin-tooltip-linha">
        <i aria-hidden style={{ background: "#b67818" }} />
        <span>Prestação do contrato</span>
        <b>{brl((linha.contrato as number) * 100)}</b>
      </div>
      <div className="fin-tooltip-linha">
        <i aria-hidden style={{ background: "#21a67a" }} />
        <span>Transferido</span>
        <b>{obs === null ? "—" : brl(obs * 100)}</b>
      </div>
      {r && <p className="fin-tooltip-nota">{r.texto}</p>}
    </Caixa>
  );
}

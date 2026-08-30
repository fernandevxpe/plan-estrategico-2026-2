"use client";

import { useState } from "react";

import { brl } from "@/components/financeiro/Certeza";
import {
  CLASSE,
  ROTULO,
  mesCurto,
  mesNome,
  nomeMes,
  nomeMesTitulo,
  plural,
  useRecebiveis
} from "@/components/time/recebiveis-dado";
import {
  competenciaDe,
  IconePrevisao,
  nomeDoItem,
  RecebiveisPlot,
  type FocoPlot
} from "@/components/time/recebiveis-plot";

/**
 * O que a casa me paga.
 *
 * ---------------------------------------------------------------------------
 * NASCE FORA DO `TimeApp`, E ISSO É PARTE DO DESENHO
 * ---------------------------------------------------------------------------
 * `TimeApp.tsx` tem ~5.600 linhas e as nove rotas de `/time` carregam o arquivo
 * inteiro — abrir a tela de um item baixa junto o formulário de custo, o
 * cadastro de cartão e as três buscas. A justificativa daquele arquivo é
 * verdadeira (sessão, opções e envios precisam estar sempre em acordo entre as
 * telas que os usam), mas ela não cobre quem busca o próprio dado: esta tela
 * não usa nenhum dos três.
 *
 * ---------------------------------------------------------------------------
 * UMA FONTE POR PERGUNTA
 * ---------------------------------------------------------------------------
 * "Reembolso" tem três números diferentes no banco: a folha
 * (`fin_reimbursement`, R$ 37.587 em 2026), o ledger (categoria 6.05,
 * R$ 12.286) e o saldo em aberto (R$ 19.625). Em julho a folha diz R$ 6.960 e
 * o ledger diz zero.
 *
 * Duas telas mostrando dois desses números fariam 14 pessoas lerem valores
 * diferentes para o próprio dinheiro. Então aqui vale uma regra só:
 *
 *   "o que já caiu"      = ledger. É o que saiu do banco, e é conferível
 *                          contra o extrato da pessoa.
 *   "o que ainda vai cair" = saldo em aberto. É contrato, não é caixa.
 *
 * A folha NÃO aparece nesta tela. Ela é a contabilidade do financeiro, não uma
 * segunda opinião sobre o extrato de ninguém.
 *
 * ---------------------------------------------------------------------------
 * O ZERO DE JULHO: EU TINHA ESCRITO A CAUSA ERRADA AQUI
 * ---------------------------------------------------------------------------
 * Este comentário afirmava, sem medir, que o zero vinha de "reembolso pago
 * junto com o salário caiu em 6.01/6.02 em vez de 6.05". Fui testar: se fosse
 * isso, tirar a folha do recorrente deixaria a série mensal mais estável.
 * Deixa mais INSTÁVEL, nas 6 pessoas de maior volume. A hipótese é falsa.
 *
 * O que os 81 pares (pessoa × competência) mostram:
 *
 *   26%  o ledger paga no MÊS SEGUINTE ao da competência, valor exato
 *    2%  paga no mesmo mês
 *   41%  não há nada no ledger nos dois meses
 *   31%  há, mas o valor diverge (pagamento parcial ou agrupado)
 *
 * A causa principal do zero de julho é banal e não é defeito: gasto de julho é
 * reembolsado em AGOSTO, e agosto ainda está aberto. Dos 33 pares sem
 * contrapartida, ONZE são de competência 07/2026 — mais do que qualquer outro
 * mês, e exatamente o que se espera de um mês que ainda não fechou.
 *
 * Sobra um resto real: reembolso na folha que nunca vira 6.05 no ledger. Esse
 * é problema de categorização, mas é MENOR do que este comentário dizia, e a
 * regra desta tela ("o que caiu = ledger") continua certa por outro motivo — é
 * o único número conferível contra o extrato do banco da pessoa.
 */

function IconeSeta() {
  return (
    <svg className="rec-seta" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function Recebiveis() {
  const { dado, erro, carregando } = useRecebiveis();
  const [ocultas, setOcultas] = useState<Set<string>>(new Set());
  const [mostrarPrevisao, setMostrarPrevisao] = useState(false);
  const [foco, setFoco] = useState<FocoPlot>(null);

  if (carregando) return <div className="time-aviso">carregando…</div>;
  if (erro) return <p className="time-erro">{erro}</p>;
  if (!dado) return null;

  if (dado.porMes.length === 0) {
    return (
      <div className="time-tela-padrao">
        <header className="time-form-cabeca">
          <h1>Recebíveis</h1>
          <p>
            Nenhum pagamento seu aparece aqui ainda. A base começa em janeiro de 2026 — se você recebeu antes disso, ou
            se falta algum mês, o acerto é com o financeiro; não é algo que se resolva pelo aplicativo.
          </p>
        </header>
      </div>
    );
  }

  /*
   * O GRÁFICO PASSA A SER FILTRÁVEL, E A LEGENDA É O FILTRO.
   *
   * Pedido: "quero que no gráfico seja selecionado o que eu quero ver... tbm
   * quero que consiga mostrar um ou outro". Duas listas — uma que explica as
   * cores e outra que filtra — seriam a mesma informação duas vezes, e a
   * segunda envelheceria primeiro. Aqui tocar na natureza tira e põe a banda.
   *
   * A última visível não desliga: um gráfico sem banda nenhuma não comunica
   * nada e deixa a pessoa sem caminho de volta óbvio.
   */
  const naturezasExistentes = dado.porNatureza.map((n) => n.natureza);
  const alternar = (nat: string) =>
    setOcultas((antes) => {
      const novo = new Set(antes);
      if (novo.has(nat)) novo.delete(nat);
      else if (naturezasExistentes.length - novo.size > 1) novo.add(nat);
      return novo;
    });

  const soNatureza = (por: Record<string, number>) =>
    Object.fromEntries(Object.entries(por).filter(([n]) => !ocultas.has(n)));

  // Os seis meses mais recentes no compacto. O resto vive na tela cheia — a
  // coluna fica com 55px em 361px, e abaixo disso o rótulo do mês some.
  const mesesBase = dado.porMes.slice(-6).map((m) => {
    const por = soNatureza(m.porNatureza);
    return { mes: m.mes, porNatureza: por, totalCents: Object.values(por).reduce((a, b) => a + b, 0), previsto: false };
  });

  /*
   * A PREVISÃO ENTRA NO MESMO GRÁFICO, e não num segundo.
   *
   * Pedido: "tbm poder mostrar a previsão dos outros meses". Num gráfico à
   * parte a comparação exige memória; na mesma régua ela é visual.
   *
   * O que se projeta tem contrato por trás: salário base, mediana de pró-labore
   * e as parcelas de reembolso que faltam.
   */
  /*
   * Todos os meses previstos entram no gráfico; o trilho rola. Limitar a 3
   * escondia o restante sem aviso — a seção Previsões lista o detalhe, mas a
   * comparação visual precisa da série completa.
   */
  const mesesPrevistos = mostrarPrevisao
    ? (dado.previsao ?? [])
        .map((p) => {
          const por = soNatureza({
            ...(p.salarioCents > 0 ? { salario: p.salarioCents } : {}),
            ...(p.prolaboreCents > 0 ? { prolabore: p.prolaboreCents } : {}),
            ...(p.comissaoCents > 0 ? { comissao: p.comissaoCents } : {}),
            ...(p.reembolsoCents > 0 ? { reembolso: p.reembolsoCents } : {})
          });
          return { mes: p.mes, porNatureza: por, totalCents: Object.values(por).reduce((a, b) => a + b, 0), previsto: true };
        })
        .filter((m) => m.totalCents > 0)
    : [];

  const meses = mesesBase;
  const colunas = [...mesesBase, ...mesesPrevistos];

  const descricaoGrafico = meses
    .map(
      (m) =>
        `${mesCurto(m.mes)}: ${brl(m.totalCents)} (${Object.entries(m.porNatureza)
          .map(([n, v]) => `${ROTULO[n] ?? n} ${brl(v)}`)
          .join(", ")})`
    )
    .join("; ");

  const porMesDesc = [...dado.porMes].reverse();
  const ultimoMesRec = porMesDesc[0] ?? null;
  const ultimoRemun = ultimoMesRec
    ? (ultimoMesRec.porNatureza?.salario ?? 0) +
      (ultimoMesRec.porNatureza?.prolabore ?? 0) +
      (ultimoMesRec.porNatureza?.estagio ?? 0) +
      (ultimoMesRec.porNatureza?.comissao ?? 0) +
      (ultimoMesRec.porNatureza?.extra ?? 0)
    : 0;
  const ultimoReemb = ultimoMesRec?.porNatureza?.reembolso ?? 0;

  const previsaoMeses = dado.previsao ?? [];
  const proximoMes = previsaoMeses[0];
  const totalReembolsoPrevisto = dado.emAbertoCents;
  const totalReembolsoParcelas = previsaoMeses.reduce((a, p) => a + (p.reembolsoCents ?? 0), 0);
  const comissaoProximoMes = proximoMes?.comissaoCents ?? 0;
  const remProximoMes =
    (proximoMes?.salarioCents ?? 0) + (proximoMes?.prolaboreCents ?? 0) + comissaoProximoMes;
  const reembProximoMes = proximoMes?.reembolsoCents ?? 0;
  const previstoProximoMes = remProximoMes + reembProximoMes;
  const reembolsosFuturosCents =
    dado.emAbertoCents > 0 ? dado.emAbertoCents : totalReembolsoParcelas;
  const totalComissaoFutura = (dado.previsao ?? []).reduce(
    (acc, p) => acc + (p.comissaoCents ?? 0),
    0
  );
  const comissoesFuturasPorComp = (dado.comissaoPorCompetencia ?? []).filter(
    (c) => !proximoMes || c.competencia >= proximoMes.mes
  );
  const comissoesDoProximoMes = (dado.comissaoPorCompetencia ?? []).find(
    (c) => c.competencia === proximoMes?.mes
  )?.itens ?? [];
  const temFuturos = reembolsosFuturosCents > 0 || totalComissaoFutura > 0;
  /*
   * O "previsto" do cabeçalho é o MÊS SEGUINTE inteiro — salário, pró-labore,
   * comissão e a PARCELA de reembolso daquele mês.
   *
   * Antes somava `emAbertoCents`, que é o saldo INTEIRO da dívida de reembolso:
   * uma série de 6× R$ 1.000 entrava como R$ 6.000 num número que a pessoa lê
   * como "o que recebo mês que vem". O saldo continua visível logo abaixo, com
   * o nome certo.
   */
  const totalPrevisto = previstoProximoMes;
  const temPrevisoes = totalPrevisto > 0 || previsaoMeses.length > 0;

  return (
    <div className="time-tela-padrao">
      <header className="time-form-cabeca">
        <h1>Recebíveis</h1>
        <p>Gestão financeira das entradas</p>
      </header>

      <div className="time-faixa">
        <article className="time-faixa-item time-faixa-destaque">
          <strong className="time-faixa-valor">
            {brl(ultimoRemun > 0 ? ultimoRemun : (ultimoMesRec?.totalCents ?? 0))}
          </strong>
          {ultimoMesRec && ultimoReemb > 0 && ultimoRemun > 0 ? (
            <span className="time-faixa-nota time-nota-reemb">
              + {brl(ultimoReemb)}
            </span>
          ) : (
            <small className="time-faixa-nota">
              {ultimoMesRec
                ? plural(dado.linhas.filter((l) => l.mes === ultimoMesRec.mes).length, "pagamento", "pagamentos")
                : "nada ainda"}
            </small>
          )}
          <span className="time-faixa-rotulo">{ultimoMesRec ? mesNome(ultimoMesRec.mes) : "no mês"}</span>
        </article>
        <article className="time-faixa-item time-faixa-previsto">
          <strong className="time-faixa-valor">
            {brl(remProximoMes > 0 ? remProximoMes : previstoProximoMes)}
          </strong>
          {proximoMes && reembProximoMes > 0 && remProximoMes > 0 ? (
            <span className="time-faixa-nota time-nota-reemb">
              + {brl(reembProximoMes)}
            </span>
          ) : (
            <small className="time-faixa-nota">previsto</small>
          )}
          <span className="time-faixa-rotulo">
            {proximoMes ? mesNome(proximoMes.mes) : "Próximo mês"}
          </span>
        </article>
        {temFuturos ? (
          <a className="time-faixa-item time-faixa-reembolso" href="#aberto">
            {totalComissaoFutura > 0 && reembolsosFuturosCents > 0 ? (
              <div className="time-faixa-par">
                <div className="time-faixa-par-item">
                  <strong className="time-faixa-valor time-valor-reemb">
                    {brl(reembolsosFuturosCents)}
                  </strong>
                  <span className="time-faixa-rotulo">Reembolso</span>
                </div>
                <div className="time-faixa-par-item">
                  <strong className="time-faixa-valor time-valor-comissao">
                    + {brl(totalComissaoFutura)}
                  </strong>
                  <span className="time-faixa-rotulo">Comissão</span>
                </div>
              </div>
            ) : totalComissaoFutura > 0 ? (
              <>
                <strong className="time-faixa-valor time-valor-comissao">
                  {brl(totalComissaoFutura)}
                </strong>
                <small className="time-faixa-nota">à receber</small>
                <span className="time-faixa-rotulo">Comissão futura</span>
              </>
            ) : (
              <>
                <strong className="time-faixa-valor time-valor-reemb">
                  {brl(reembolsosFuturosCents)}
                </strong>
                <small className="time-faixa-nota">à receber</small>
                <span className="time-faixa-rotulo">Reembolso total</span>
              </>
            )}
          </a>
        ) : (
          <article className="time-faixa-item">
            <strong className="time-faixa-valor">{brl(dado.totalCents)}</strong>
            <small className="time-faixa-nota">nada em aberto</small>
            <span className="time-faixa-rotulo">Em 2026</span>
          </article>
        )}
      </div>

      <section
        className={`rec-plot rec-plot-mini${mostrarPrevisao && mesesPrevistos.length > 0 ? " rec-plot-rolagem" : ""}`}
      >
        <RecebiveisPlot
          dado={dado}
          colunas={colunas}
          mesesLegenda={meses}
          ocultas={ocultas}
          alternar={alternar}
          foco={foco}
          onFoco={setFoco}
          rolagem={mostrarPrevisao && mesesPrevistos.length > 0}
          ariaDescricao={descricaoGrafico}
          cabeca={
            previsaoMeses.length > 0 ? (
              <div className="rec-plot-cabeca rec-plot-cabeca-acoes">
                <div className="rec-plot-acoes">
                  <button
                    type="button"
                    className={mostrarPrevisao ? "rec-plot-acao ativo" : "rec-plot-acao"}
                    aria-pressed={mostrarPrevisao}
                    aria-label={
                      mostrarPrevisao
                        ? "Esconder previsão no gráfico"
                        : `Mostrar previsão nos próximos ${plural(previsaoMeses.length, "mês", "meses")}`
                    }
                    onClick={() => setMostrarPrevisao((v) => !v)}
                  >
                    <IconePrevisao />
                    <span>Previsão</span>
                  </button>
                </div>
              </div>
            ) : undefined
          }
        />
      </section>

      {temPrevisoes ? (
        <section className="time-secao rec-secao-previsoes" id="aberto">
          <details className="rec-secao-dobravel" open>
            <summary className="rec-secao-cabeca">
              <h2>Previsões</h2>
              <span className="rec-secao-cabeca-direita">
                {totalPrevisto > 0 ? (
                  <span className="rec-secao-total">
                    <strong>{brl(totalPrevisto)}</strong>
                    <small>{proximoMes ? mesNome(proximoMes.mes) : "previsto"}</small>
                  </span>
                ) : null}
                <IconeSeta />
              </span>
            </summary>
            <div className="rec-secao-corpo">
          <ul className="rec-naturezas rec-prev-cats">
            {proximoMes && proximoMes.salarioCents > 0 ? (
              <li>
                <div className="rec-nat-linha">
                  <i className={`rec-ponto ${CLASSE.salario}`} aria-hidden />
                  <span className="rec-nat-nome">
                    Salário
                    <small>Salário base 2026</small>
                  </span>
                  <b className="rec-nat-valor">
                    <span>{brl(proximoMes.salarioCents)}</span>
                    <small className="rec-nat-sub">{nomeMesTitulo(proximoMes.mes)}</small>
                  </b>
                </div>
              </li>
            ) : null}
            {proximoMes && proximoMes.prolaboreCents > 0 ? (
              <li>
                <div className="rec-nat-linha">
                  <i className={`rec-ponto ${CLASSE.prolabore}`} aria-hidden />
                  <span className="rec-nat-nome">
                    Pró-labore
                    <small>Recorrente 2026</small>
                  </span>
                  <b className="rec-nat-valor">
                    <span>{brl(proximoMes.prolaboreCents)}</span>
                    <small className="rec-nat-sub">{nomeMesTitulo(proximoMes.mes)}</small>
                  </b>
                </div>
              </li>
            ) : null}
            {totalComissaoFutura > 0 || comissaoProximoMes > 0 ? (
              <li>
                <details className="rec-nat-prev" open>
                  <summary className="rec-nat-linha">
                    <i className={`rec-ponto ${CLASSE.comissao}`} aria-hidden />
                    <span className="rec-nat-nome">
                      Comissão
                      {totalComissaoFutura > 0 ? (
                        <small>
                          {totalComissaoFutura > comissaoProximoMes
                            ? `total declarado ${brl(totalComissaoFutura)}`
                            : `total em aberto ${brl(totalComissaoFutura)}`}
                        </small>
                      ) : null}
                    </span>
                    <b className="rec-nat-valor">
                      <span>{brl(comissaoProximoMes > 0 ? comissaoProximoMes : totalComissaoFutura)}</span>
                      {proximoMes ? (
                        <small className="rec-nat-sub">{nomeMesTitulo(proximoMes.mes)}</small>
                      ) : null}
                    </b>
                    <IconeSeta />
                  </summary>
                  <ul className="rec-aberto-lista rec-aberto-lista-aninhada">
                    {(comissoesDoProximoMes.length > 0 ? comissoesDoProximoMes : comissoesFuturasPorComp[0]?.itens ?? []).map((it, idx) => (
                      <li key={`${it.descricao}-${idx}`}>
                        <span className="rec-aberto-nome">
                          {it.descricao}
                          <span className="rec-aberto-parc">
                            {[
                              it.tipo,
                              it.cliente,
                              it.ehEntrada
                                ? "entrada"
                                : it.parcelasTotal && it.parcelasTotal > 1
                                  ? `parcela ${it.parcela} de ${it.parcelasTotal}`
                                  : null
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                            {it.nota ? (
                              <span style={{ display: "block", color: "var(--muted)", fontStyle: "italic", marginTop: 2 }}>
                                {it.nota}
                              </span>
                            ) : null}
                          </span>
                        </span>
                        <span className="rec-aberto-valor">{brl(it.valorCents)}</span>
                      </li>
                    ))}
                  </ul>
                  {previsaoMeses.filter((p) => p.comissaoCents > 0).length > 1 ? (
                    <ul className="rec-prev-meses rec-prev-meses-aninhada rec-prev-parcelas">
                      {previsaoMeses
                        .filter((p) => p.comissaoCents > 0)
                        .map((p) => (
                          <li key={p.mes}>
                            <span className="rec-prev-mes">{nomeMesTitulo(p.mes)}</span>
                            <b>{brl(p.comissaoCents)}</b>
                          </li>
                        ))}
                    </ul>
                  ) : null}
                </details>
              </li>
            ) : null}
            {totalReembolsoPrevisto > 0 || reembProximoMes > 0 ? (
              <li>
                <details className="rec-nat-prev">
                  <summary className="rec-nat-linha">
                    <i className={`rec-ponto ${CLASSE.reembolso}`} aria-hidden />
                    <span className="rec-nat-nome">
                      Reembolso
                      {totalReembolsoPrevisto > 0 ? (
                        <small>
                          total em aberto {brl(totalReembolsoPrevisto)}
                        </small>
                      ) : (
                        <small>aprovado, ainda não pago</small>
                      )}
                    </span>
                    <b className="rec-nat-valor">
                      <span>{brl(reembProximoMes > 0 ? reembProximoMes : totalReembolsoPrevisto)}</span>
                      {proximoMes ? (
                        <small className="rec-nat-sub">{nomeMesTitulo(proximoMes.mes)}</small>
                      ) : null}
                    </b>
                    <IconeSeta />
                  </summary>
                  <ul className="rec-aberto-lista rec-aberto-lista-aninhada">
                    {dado.emAberto
                      .filter((a) => a.parcelasRestantes > 0)
                      .map((a) => (
                        <li key={a.slug}>
                          <span className="rec-aberto-nome">
                            {nomeDoItem(a.descricao, a.slug)}
                            <span className="rec-aberto-parc">
                              {a.parcelasTotal > 1
                                ? `parcela ${a.parcela} de ${a.parcelasTotal} · saldo ${brl(a.saldoCents)} (faltam ${plural(a.parcelasRestantes, "parcela", "parcelas")})`
                                : `parcela única · saldo ${brl(a.saldoCents)}`}
                            </span>
                          </span>
                          <span className="rec-aberto-valor">{brl(a.valorParcelaCents)}</span>
                        </li>
                      ))}
                  </ul>
                  {totalReembolsoParcelas > 0 ? (
                    <ul className="rec-prev-meses rec-prev-meses-aninhada rec-prev-parcelas">
                      {previsaoMeses
                        .filter((p) => p.reembolsoCents > 0)
                        .map((p) => (
                          <li key={p.mes}>
                            <span className="rec-prev-mes">{nomeMesTitulo(p.mes)}</span>
                            <b>{brl(p.reembolsoCents)}</b>
                          </li>
                        ))}
                    </ul>
                  ) : null}
                </details>
              </li>
            ) : null}
          </ul>
            </div>
          </details>
        </section>
      ) : null}

      <section className="time-secao">
        <details className="rec-secao-dobravel" open>
          <summary className="rec-secao-cabeca">
            <h2>Histórico de Recebíveis</h2>
            <span className="rec-secao-cabeca-direita">
              <span className="rec-secao-total">
                <strong>{brl(dado.totalCents)}</strong>
                <small>acumulado</small>
              </span>
              <IconeSeta />
            </span>
          </summary>
          <div className="rec-secao-corpo">
        {porMesDesc.map((m, i) => {
          const doMes = dado.linhas.filter((l) => l.mes === m.mes);
          return (
            // Só o mês mais recente abre. Todos abertos dariam 1.686px de
            // rolagem antes do primeiro mês antigo.
            <details key={m.mes} className="rec-mes" open={i === 0}>
              <summary className="rec-mes-cabeca">
                <span className="rec-mes-titulo">{nomeMesTitulo(m.mes)}</span>
                <span className="rec-mes-cabeca-direita">
                  <span className="rec-mes-total-bloco">
                    <strong>{brl(m.totalCents)}</strong>
                    <small>{plural(doMes.length, "Pix", "Pix")}</small>
                  </span>
                  <IconeSeta />
                </span>
              </summary>

              {/*
                A COMPOSIÇÃO DO MÊS VEM PRIMEIRO, E ELA É A AUTORIDADE.
                
                As linhas abaixo são os PIX que caíram; esta faixa é o que cada
                parte significa. Os dois números não vêm da mesma fonte de
                propósito: o PIX vem do extrato, a composição vem da folha —
                que é quem sabe que R$ 765,61 pagos em março eram o reembolso de
                fevereiro, e não pró-labore, mesmo estando em 6.02 no ledger.
              */}
              {/*
                A EXPANSÃO É UMA SEQUÊNCIA: mês → natureza → o que sustenta.
                
                Pedido: "deveria ser uma sequência de expandir; pró-labore
                expande e mostra os Pix recebidos e os valores; reembolso
                expandir e mostrar o detalhamento dos reembolsos que compõem o
                todo — isso por mês".
                
                Cada natureza é um `<details>` próprio. Fechadas, as três linhas
                respondem "quanto de quê". Abertas, cada uma responde de onde
                aquele número vem — e a resposta é diferente para cada:
                
                  Salário    a base contratada e desde quando vale
                  Reembolso  os itens da competência, exatos, com parcela
                  o resto    os Pix do mês, que é o que dá para conferir no
                             extrato do banco
                
                Por que os Pix ficam sob a natureza e não atribuídos um a um:
                medido na base inteira, em apenas 46% dos 156 pessoa×mês existe
                casamento exato entre o valor de cada Pix e o de cada banda. Em
                29% não casa nenhum. Dizer "este Pix é o pró-labore" seria certo
                em menos da metade das vezes.
              */}
              <ul className="rec-naturezas rec-naturezas-mes">
                {Object.entries(m.porNatureza)
                  .sort((a, b) => b[1] - a[1])
                  .map(([nat, v]) => {
                    const reemb =
                      nat === "reembolso"
                        ? (dado.reembolsoPorCompetencia ?? []).find((c) => c.competencia === competenciaDe(m.mes))
                        : null;
                    const temDetalhe =
                      Boolean(reemb) ||
                      (nat === "salario" && dado.salarioBase !== null && v < dado.salarioBase.valorCents);
                    const cabeca = (
                      <>
                        <i className={`rec-ponto ${CLASSE[nat] ?? "nat-encargo"}`} aria-hidden />
                        <span className="rec-nat-nome">
                          {ROTULO[nat] ?? nat}
                          {reemb ? <small>competência {nomeMesTitulo(reemb.competencia)}</small> : null}
                        </span>
                        <b className="rec-nat-valor">{brl(v)}</b>
                        {temDetalhe ? <IconeSeta /> : null}
                      </>
                    );
                    return (
                      <li key={nat}>
                        {temDetalhe ? (
                          <details className="rec-nat-mes">
                            <summary className="rec-nat-linha">{cabeca}</summary>
                            {nat === "salario" && dado.salarioBase && v < dado.salarioBase.valorCents ? (
                              <p className="rec-nat-nota">
                                Neste mês caiu menos que a base contratada de {brl(dado.salarioBase.valorCents)}.
                              </p>
                            ) : null}
                            {reemb ? (
                              <ul className="rec-reemb-itens">
                                {reemb.itens.map((it, k) => (
                                  <li key={`${it.descricao}-${k}`}>
                                    <span className="rec-reemb-nome">
                                      {nomeDoItem(it.descricao, it.descricao)}
                                      {it.parcelasTotal && it.parcelasTotal > 1 ? (
                                        <span className="rec-reemb-parc">
                                          parcela {it.parcela} de {it.parcelasTotal}
                                        </span>
                                      ) : null}
                                    </span>
                                    <span className="rec-reemb-valor">{brl(it.valorCents)}</span>
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </details>
                        ) : (
                          <div className="rec-nat-linha">{cabeca}</div>
                        )}
                      </li>
                    );
                  })}
              </ul>
            </details>
          );
        })}
          </div>
        </details>
      </section>
    </div>
  );
}

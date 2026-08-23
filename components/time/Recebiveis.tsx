"use client";

import Link from "next/link";
import { useState } from "react";

import { brl } from "@/components/financeiro/Certeza";
import { CLASSE, ROTULO, mesCurto, nomeMes, plural, useRecebiveis } from "@/components/time/recebiveis-dado";

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

/**
 * O nome do item, sem o resíduo da planilha.
 *
 * As descrições vêm de uma planilha e carregam duas sujeiras que a tela já
 * mostra em coluna própria: a fração ("Ar Cond 8/12") e, quando a fração está
 * em coluna separada, o hífen que sobrou dela ("Notebooks part 2 -", "Tv -",
 * "Gela Água -"). Conferido nas 13 séries em aberto e nos 38 itens do Fernando.
 *
 * Tirar os dois deixa o texto dizer O QUE é; quantas parcelas fica na linha de
 * baixo, escrito por extenso.
 */
function nomeDoItem(descricao: string, alternativa: string) {
  return descricao.replace(/[\s-]*\d+\s*\/\s*\d+\s*$/, "").replace(/[\s\-–—]+$/, "").trim() || alternativa;
}

/** O mês anterior: gasto de M é reembolsado em M+1, então a competência do
 *  reembolso pago no mês M é M−1. Mesma regra da view 0163 e da folha. */
function competenciaDe(mes: string) {
  const [a, m] = mes.split("-").map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;
}

export function Recebiveis() {
  const { dado, erro, carregando } = useRecebiveis();

  if (carregando) return <div className="time-aviso">carregando…</div>;
  if (erro) return <p className="time-erro">{erro}</p>;
  if (!dado) return null;

  if (dado.porMes.length === 0) {
    return (
      <div className="time-tela-padrao">
        <header className="time-form-cabeca">
          <h1>O que eu recebo</h1>
          <p>
            Nenhum pagamento seu aparece aqui ainda. A base começa em janeiro de 2026 — se você recebeu antes disso, ou
            se falta algum mês, o acerto é com o financeiro; não é algo que se resolva pelo aplicativo.
          </p>
        </header>
      </div>
    );
  }

  // Os seis meses mais recentes no compacto. O resto vive na tela cheia — a
  // coluna fica com 55px em 361px, e abaixo disso o rótulo do mês some.
  const meses = dado.porMes.slice(-6);
  const teto = Math.max(...meses.map((m) => m.totalCents), 1);
  const valores = meses.map((m) => m.totalCents);
  const menor = Math.min(...valores);
  const maior = Math.max(...valores);

  const descricaoGrafico = meses
    .map(
      (m) =>
        `${mesCurto(m.mes)}: ${brl(m.totalCents)} (${Object.entries(m.porNatureza)
          .map(([n, v]) => `${ROTULO[n] ?? n} ${brl(v)}`)
          .join(", ")})`
    )
    .join("; ");

  const porMesDesc = [...dado.porMes].reverse();

  /*
   * A LEGENDA SOMA OS MESES QUE O GRÁFICO MOSTRA — e não somava.
   *
   * O gráfico compacto exibe 6 meses; `dado.porNatureza` vem do servidor com o
   * total dos 8. No Fernando a legenda dizia Pró-labore R$ 41.649,74 enquanto
   * as seis barras somavam R$ 31.618,52: R$ 10.031,22 que nenhuma barra
   * explicava, ao lado do próprio gráfico. Número que não fecha com o desenho
   * ao lado é pior que número ausente.
   */
  const legenda = (() => {
    /*
     * O VALOR E A CONTAGEM PRECISAM FALAR DA MESMA JANELA.
     *
     * O valor já era escopado nos meses desenhados; a contagem vinha de
     * `dado.linhas`, que é a lista inteira. Enquanto o `n` significava
     * "quantos Pix" isso passava despercebido; quando virou "quantos meses"
     * ficou absurdo na cara: "Pró-labore · 19 meses" para quem tem 8, e
     * "Comissão · 5 meses" para quem tem 2.
     *
     * Agora conta os meses da janela, que é o que as barras ao lado mostram.
     */
    const m = new Map<string, { cents: number; n: number }>();
    for (const mes of meses) {
      for (const [nat, v] of Object.entries(mes.porNatureza)) {
        const a = m.get(nat) ?? { cents: 0, n: 0 };
        m.set(nat, { cents: a.cents + v, n: a.n + 1 });
      }
    }
    return [...m.entries()]
      .map(([natureza, v]) => ({ natureza, ...v }))
      .sort((a, b) => b.cents - a.cents);
  })();

  return (
    <div className="time-tela-padrao">
      <header className="time-form-cabeca">
        <h1>O que eu recebo</h1>
        <p>Tudo que a XPE te pagou desde {dado.desde ? nomeMes(dado.desde) : "janeiro de 2026"}.</p>
      </header>

      <div className="time-faixa">
        <article className="time-faixa-item time-faixa-destaque">
          <span className="time-faixa-rotulo">{porMesDesc[0] ? mesCurto(porMesDesc[0].mes) : "no mês"}</span>
          <strong className="time-faixa-valor">{brl(porMesDesc[0]?.totalCents ?? 0)}</strong>
          <small className="time-faixa-nota">
            {porMesDesc[0]
              ? plural(dado.linhas.filter((l) => l.mes === porMesDesc[0].mes).length, "pagamento", "pagamentos")
              : "nada ainda"}
          </small>
        </article>
        <article className="time-faixa-item">
          <span className="time-faixa-rotulo">De hábito</span>
          <strong className="time-faixa-valor">{brl(dado.medianaRecorrenteCents)}</strong>
          {/* "mediana" escrito na tela de propósito: não é o contrato, é o que
              costuma cair. A média seria puxada pelos extremos — no Fernando os
              oito meses vão de R$ 2.386 a R$ 7.644. */}
          <small className="time-faixa-nota">mediana, {plural(dado.porMes.length, "mês", "meses")}</small>
        </article>
        {dado.emAbertoCents > 0 ? (
          <a className="time-faixa-item" href="#aberto">
            <span className="time-faixa-rotulo">Ainda a receber</span>
            <strong className="time-faixa-valor">{brl(dado.emAbertoCents)}</strong>
            <small className="time-faixa-nota">aprovado, ainda não pago</small>
          </a>
        ) : (
          <article className="time-faixa-item">
            <span className="time-faixa-rotulo">Em 2026</span>
            <strong className="time-faixa-valor">{brl(dado.totalCents)}</strong>
            <small className="time-faixa-nota">nada em aberto</small>
          </article>
        )}
      </div>

      <section className="rec-plot rec-plot-mini">
        <div className="rec-plot-cabeca">
          <h2>Mês a mês</h2>
          {dado.porMes.length > 6 ? (
            <Link className="rec-plot-abrir" href="/time/recebiveis/grafico">
              Ver tudo
            </Link>
          ) : null}
        </div>
        <div className="rec-plot-trilho">
          <div className="rec-grade" role="img" aria-label={`Recebido mês a mês. ${descricaoGrafico}`}>
            {meses.map((m) => (
              <div key={m.mes} className="rec-col">
                <span className="rec-col-area">
                  <span className="rec-pilha" style={{ height: `${(m.totalCents / teto) * 100}%` }}>
                    {Object.entries(m.porNatureza)
                      .sort((a, b) => b[1] - a[1])
                      .map(([nat, v]) => (
                        <i
                          key={nat}
                          className={CLASSE[nat] ?? "nat-encargo"}
                          style={{ height: `${(v / m.totalCents) * 100}%` }}
                          title={`${ROTULO[nat] ?? nat}: ${brl(v)}`}
                        />
                      ))}
                  </span>
                </span>
                <span className="rec-col-mes">{mesCurto(m.mes)}</span>
              </div>
            ))}
          </div>
        </div>
        {/* A faixa em texto responde "está quebrado?" quando todas as colunas
            têm a mesma altura — e dá o número exato sem competir com a faixa
            de cima. */}
        <p className="rec-plot-nota">
          {menor === maior
            ? `O mesmo valor ${meses.length === 1 ? "no único mês" : `nos ${meses.length} meses`}: ${brl(maior)}.`
            : `${meses.length === 1 ? "No único mês" : `Nos ${meses.length} meses`}: de ${brl(menor)} a ${brl(maior)}.`}
          {dado.porMes.length > meses.length ? ` Total de ${plural(dado.porMes.length, "mês", "meses")}: ${brl(dado.totalCents)}.` : ""}
        </p>
        <ul className="rec-legenda">
          {legenda.map((n) => (
            <li key={n.natureza}>
              <i className={`rec-ponto ${CLASSE[n.natureza] ?? "nat-encargo"}`} />
              <span>{ROTULO[n.natureza] ?? n.natureza}</span>
              <b>{brl(n.cents)}</b>
              {/* meses, não lançamentos — ver o comentário em `meusRecebiveis` */}
              <em>{plural(n.n, "mês", "meses")}</em>
            </li>
          ))}
        </ul>
      </section>

      {dado.emAbertoCents > 0 ? (
        <section className="time-secao" id="aberto">
          {/*
            ESTA SEÇÃO REPETIA O AZULEJO DO TOPO, PALAVRA POR PALAVRA.
            
            Mesmo número, mesmo rótulo, mesma nota — 350px abaixo. E o azulejo
            é um LINK para cá: a pessoa tocava esperando "quais reembolsos" e
            recebia "R$ 12.119,51" de novo, maior. Um link que não leva a
            informação nova é pior que nenhum link, porque gasta o toque.
            
            Agora a seção responde a pergunta que o azulejo levanta: de onde
            vem o saldo, série a série, e quantas parcelas ainda faltam em cada
            uma. O total continua no topo — aqui ele é o rodapé da conta, não o
            título.
          */}
          <h2>De onde vem o que falta</h2>
          <ul className="rec-aberto-lista">
            {dado.emAberto.map((a) => (
              <li key={a.slug}>
                <span className="rec-aberto-nome">
                  {/*
                    A descrição da planilha JÁ TERMINA na fração — "Ar Cond
                    8/12", "Notebooks part 2 - 13/24", "notebook estag 2 -
                    3/12". Conferido nas 13 séries em aberto da base: todas.
                    Renderizar isso ao lado de "parcela 13 de 24" dizia a mesma
                    coisa duas vezes na mesma linha, e a versão da planilha é a
                    pior das duas (não diz que é parcela, e às vezes vem com
                    hífen solto). Tiro a fração do fim e deixo o texto explicar
                    O QUE é; a contagem fica na linha de baixo, escrita por
                    extenso.
                  */}
                  {nomeDoItem(a.descricao, a.slug)}
                  <span className="rec-aberto-parc">
                    {a.parcelasTotal > 1
                      ? `parcela ${a.parcela} de ${a.parcelasTotal} · faltam ${plural(a.parcelasRestantes, "parcela", "parcelas")} de ${brl(a.valorParcelaCents)}`
                      : `${plural(a.parcelasRestantes, "parcela", "parcelas")} de ${brl(a.valorParcelaCents)}`}
                  </span>
                </span>
                <span className="rec-aberto-valor">{brl(a.saldoCents)}</span>
              </li>
            ))}
          </ul>
          <p className="rec-aberto-rodape">
            <strong>{brl(dado.emAbertoCents)}</strong>
            <span>
              em {plural(dado.emAberto.length, "série", "séries")} · aprovado, ainda não pago
            </span>
          </p>
        </section>
      ) : null}

      <section className="time-secao">
        <h2>Cada pagamento</h2>
        {porMesDesc.map((m, i) => {
          const doMes = dado.linhas.filter((l) => l.mes === m.mes);
          return (
            // Só o mês mais recente abre. Todos abertos dariam 1.686px de
            // rolagem antes do primeiro mês antigo.
            <details key={m.mes} className="rec-mes" open={i === 0}>
              <summary>
                <span>
                  {nomeMes(m.mes)}
                  {/* Quando os pagamentos do mês não caíram todos no mesmo dia,
                      o intervalo aparece fechado: é a diferença entre "recebi
                      dia 1º" e "recebi ao longo do mês". */}
                  {doMes.length > 1 && doMes[0].data !== doMes[doMes.length - 1].data ? (
                    <small className="rec-mes-periodo">
                      {doMes[doMes.length - 1].data.slice(8, 10)}–{doMes[0].data.slice(8, 10)}
                    </small>
                  ) : null}
                </span>
                <span className="rec-mes-total">{brl(m.totalCents)}</span>
                <span className="rec-mes-n">{plural(doMes.length, "Pix", "Pix")}</span>
              </summary>

              {/*
                A COMPOSIÇÃO DO MÊS VEM PRIMEIRO, E ELA É A AUTORIDADE.
                
                As linhas abaixo são os PIX que caíram; esta faixa é o que cada
                parte significa. Os dois números não vêm da mesma fonte de
                propósito: o PIX vem do extrato, a composição vem da folha —
                que é quem sabe que R$ 765,61 pagos em março eram o reembolso de
                fevereiro, e não pró-labore, mesmo estando em 6.02 no ledger.
              */}
              <ul className="rec-comp">
                {Object.entries(m.porNatureza)
                  .sort((a, b) => b[1] - a[1])
                  .map(([nat, v]) => (
                    <li key={nat}>
                      <i className={`rec-ponto ${CLASSE[nat] ?? "nat-encargo"}`} />
                      <span>{ROTULO[nat] ?? nat}</span>
                      <b>{brl(v)}</b>
                    </li>
                  ))}
              </ul>

              <p className="rec-mes-rotulo">
                {plural(doMes.length, "Pix recebido", "Pix recebidos")}
              </p>
              {/* `rec-linhas-sem-ponto`: a linha perdeu o pontinho de natureza
                  (a natureza dela não é conhecível), e a grade de 4 colunas
                  jogava o texto na coluna de 9px — "Pix" renderizava como "P".
                  Três filhos pedem três colunas. */}
              <ul className="rec-linhas rec-linhas-sem-ponto">
                {doMes.map((l, k) => (
                  <li key={`${l.data}-${k}`} className={k > 0 && doMes[k - 1].data === l.data ? "rec-linha-mesmodia" : ""}>
                    {/* A data da movimentação, sempre — é o que a pessoa cruza
                        com o extrato do banco dela. Some só quando é o MESMO
                        dia da linha de cima, para três Pix do mesmo dia não
                        repetirem a data três vezes. */}
                    <span className="rec-linha-dia">
                      {k > 0 && doMes[k - 1].data === l.data ? "" : `${l.data.slice(8, 10)}/${l.data.slice(5, 7)}`}
                    </span>
                    {/*
                      SEM RÓTULO DE NATUREZA NA LINHA, e a ausência é a parte
                      honesta.
                      
                      Cada linha dizia "Pró-labore" ou "Reembolso" pela
                      categoria do ledger, e a categoria erra quando os dois
                      saem no mesmo dia: os R$ 765,61 de março apareciam como
                      pró-labore. Testei se dava para descobrir qual PIX era
                      qual — em 7 dos 8 meses do Fernando existe um subconjunto
                      que soma exato o reembolso, mas em fevereiro não existe
                      nenhum. Casar por valor é chute, e chute em pagamento de
                      pessoa não entra.
                      
                      Então a linha diz o que se sabe: quando caiu, quanto, e
                      em que conta. O que cada parte É está na composição, logo
                      acima, onde a folha responde.
                    */}
                    <span className="rec-linha-nat">
                      Pix
                      {dado.linhas.some((x) => x.conta !== l.conta) ? (
                        <span className="rec-linha-conta">{l.conta}</span>
                      ) : null}
                    </span>
                    <span className="rec-linha-valor">{brl(l.valorCents)}</span>
                  </li>
                ))}
              </ul>

              {/*
                O REEMBOLSO, ITEM A ITEM. Era o pedido: "sabemos todo
                detalhamento dos reembolsos, itens, parcelas — isso deve
                aparecer". A competência é a do mês ANTERIOR, porque gasto de um
                mês é reembolsado no seguinte — e por isso ela vem escrita, para
                ninguém procurar em agosto o que gastou em agosto.
              */}
              {(() => {
                const reemb = (dado.reembolsoPorCompetencia ?? []).find(
                  (c) => c.competencia === competenciaDe(m.mes)
                );
                if (!reemb || !m.porNatureza.reembolso) return null;
                return (
                  <section className="rec-reemb">
                    <h3>
                      O reembolso de {nomeMes(reemb.competencia)}
                      <b>{brl(reemb.totalCents)}</b>
                    </h3>
                    <ul>
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
                  </section>
                );
              })()}
            </details>
          );
        })}
      </section>
    </div>
  );
}

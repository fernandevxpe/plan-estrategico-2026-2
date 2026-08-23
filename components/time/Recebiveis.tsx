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
 * segunda opinião sobre o extrato de ninguém. O zero de julho no ledger vira um
 * problema visível — reembolso pago junto com o salário caiu em 6.01/6.02 em
 * vez de 6.05 — e um zero que incomoda é melhor que dois números que se calam.
 */

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
    const m = new Map<string, { cents: number; n: number }>();
    for (const mes of meses) {
      for (const [nat, v] of Object.entries(mes.porNatureza)) {
        const a = m.get(nat) ?? { cents: 0, n: 0 };
        m.set(nat, { cents: a.cents + v, n: a.n });
      }
    }
    for (const l of dado.linhas) {
      if (!meses.some((x) => x.mes === l.mes)) continue;
      const a = m.get(l.natureza);
      if (a) a.n += 1;
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
            <small className="time-faixa-nota">reembolso parcelado</small>
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
              <em>{n.n}×</em>
            </li>
          ))}
        </ul>
      </section>

      {dado.emAbertoCents > 0 ? (
        <section className="time-secao" id="aberto">
          <h2>Ainda a receber</h2>
          <div className="rec-aberto-topo">
            <strong>{brl(dado.emAbertoCents)}</strong>
            <span>reembolso já aprovado, ainda não pago</span>
          </div>
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
                <span className="rec-mes-n">{doMes.length}×</span>
              </summary>
              <ul className="rec-linhas">
                {doMes.map((l, k) => (
                  <li key={`${l.data}-${k}`} className={k > 0 && doMes[k - 1].data === l.data ? "rec-linha-mesmodia" : ""}>
                    {/* A data da movimentação, sempre — é o que a pessoa cruza
                        com o extrato do banco dela. Some só quando é o MESMO
                        dia da linha de cima, para três Pix do mesmo dia não
                        repetirem a data três vezes. */}
                    <span className="rec-linha-dia">
                      {k > 0 && doMes[k - 1].data === l.data ? "" : `${l.data.slice(8, 10)}/${l.data.slice(5, 7)}`}
                    </span>
                    <i className={`rec-ponto ${CLASSE[l.natureza] ?? "nat-encargo"}`} />
                    <span className="rec-linha-nat">
                      {ROTULO[l.natureza] ?? l.natureza}
                      {/* A conta só quando a pessoa recebe por mais de uma:
                          23 das 28 recebem por uma só, e repetir "Inter" em
                          todas as linhas é ruído. */}
                      {dado.linhas.some((x) => x.conta !== l.conta) ? (
                        <span className="rec-linha-conta">{l.conta}</span>
                      ) : null}
                    </span>
                    <span className="rec-linha-valor">{brl(l.valorCents)}</span>
                  </li>
                ))}
              </ul>
            </details>
          );
        })}
      </section>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { brl } from "@/components/financeiro/Certeza";

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

type Recebiveis = {
  totalCents: number;
  mesAtualCents: number;
  medianaRecorrenteCents: number;
  emAbertoCents: number;
  desde: string | null;
  ultimoEm: string | null;
  porNatureza: { natureza: string; cents: number; n: number }[];
  porMes: { mes: string; totalCents: number; porNatureza: Record<string, number> }[];
  linhas: {
    data: string;
    mes: string;
    valorCents: number;
    natureza: string;
    categoria: string | null;
    conta: string;
    descricao: string;
  }[];
};

const ROTULO: Record<string, string> = {
  salario: "Salário",
  prolabore: "Pró-labore",
  estagio: "Estágio",
  comissao: "Comissão",
  reembolso: "Reembolso",
  encargo_beneficio: "Benefício",
  extra: "Extra"
};

/*
 * Salário, pró-labore e estágio dividem a MESMA classe de cor.
 *
 * Conferido nas 28 pessoas com pagamento em 2026: ninguém tem duas delas — os
 * vínculos são mutuamente exclusivos. Com uma cor só, a banda roxa quer dizer
 * "o que se repete" no gráfico de qualquer pessoa, seja MEI ou CLT, e a
 * legenda diz o nome certo de cada uma.
 */
const CLASSE: Record<string, string> = {
  salario: "nat-recorrente",
  prolabore: "nat-recorrente",
  estagio: "nat-recorrente",
  comissao: "nat-comissao",
  reembolso: "nat-reembolso",
  extra: "nat-extra",
  encargo_beneficio: "nat-encargo"
};

const MES_LONGO = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"
];
const nomeMes = (m: string) => `${MES_LONGO[Number(m.slice(5, 7)) - 1]} de ${m.slice(0, 4)}`;
const mesCurto = (m: string) => MES_LONGO[Number(m.slice(5, 7)) - 1].slice(0, 3);

export function Recebiveis() {
  const [dado, setDado] = useState<Recebiveis | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch("/api/time/recebiveis", { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          setErro((j.error as string) ?? "não consegui carregar");
          return;
        }
        setDado(j.recebiveis as Recebiveis);
      } finally {
        setCarregando(false);
      }
    })();
  }, []);

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
              ? `${dado.linhas.filter((l) => l.mes === porMesDesc[0].mes).length} pagamentos`
              : "nada ainda"}
          </small>
        </article>
        <article className="time-faixa-item">
          <span className="time-faixa-rotulo">De hábito</span>
          <strong className="time-faixa-valor">{brl(dado.medianaRecorrenteCents)}</strong>
          {/* "mediana" escrito na tela de propósito: não é o contrato, é o que
              costuma cair. A média seria puxada pelos extremos — no Fernando os
              oito meses vão de R$ 2.386 a R$ 7.644. */}
          <small className="time-faixa-nota">mediana, {dado.porMes.length} meses</small>
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
            ? `O mesmo valor nos ${meses.length} meses: ${brl(maior)}.`
            : `Nos ${meses.length} meses: de ${brl(menor)} a ${brl(maior)}.`}
        </p>
        <ul className="rec-legenda">
          {dado.porNatureza.map((n) => (
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
                <span>{nomeMes(m.mes)}</span>
                <span className="rec-mes-total">{brl(m.totalCents)}</span>
                <span className="rec-mes-n">{doMes.length}×</span>
              </summary>
              <ul className="rec-linhas">
                {doMes.map((l, k) => (
                  <li key={`${l.data}-${k}`} className={k > 0 && doMes[k - 1].data === l.data ? "rec-linha-mesmodia" : ""}>
                    <span className="rec-linha-dia">{l.data.slice(8, 10)}/{l.data.slice(5, 7)}</span>
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

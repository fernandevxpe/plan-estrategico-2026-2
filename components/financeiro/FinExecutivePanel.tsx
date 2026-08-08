import type { Indicador, PainelExecutivo } from "@/lib/financeiro/painel";
import { brlCents, brlCompact, pct } from "@/lib/financeiro/format";

import { FinPainelAgingChart } from "./FinPainelAgingChart";
import { FinPainelNucleoChart } from "./FinPainelNucleoChart";
import { FinPainelParetoChart } from "./FinPainelParetoChart";
import { FinPainelReceitaChart } from "./FinPainelReceitaChart";

/**
 * O painel executivo, montado de cima para baixo como um briefing e não como um
 * mural de números.
 *
 * A ordem é a de quem apresenta a diretoria: primeiro a leitura em português
 * (uma pessoa que lê só o primeiro parágrafo tem de sair sabendo o essencial),
 * depois as quatro manchetes com comparação, depois os gráficos — cada um com o
 * seu recado no título —, depois os riscos e, por último, o que o painel NÃO
 * sabe.
 *
 * A seção final não é humildade decorativa: é o que separa um painel de um
 * slide. Aqui só o Asaas alimenta o ledger, e um painel que exibisse "margem" ou
 * "runway" com essa base estaria inventando. Declarar a lacuna é o que dá direito
 * de confiar no resto.
 */

const FORMATADORES: Record<Indicador["formato"], (valor: number) => string> = {
  brl: (valor) => brlCents(valor),
  brlCompact: (valor) => brlCompact(valor),
  pct: (valor) => pct(valor, 1),
  dias: (valor) => `${valor.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} dias`,
  numero: (valor) => valor.toLocaleString("pt-BR")
};

const SETA: Record<Indicador["tendencia"], string> = {
  melhorando: "▲",
  piorando: "▼",
  estavel: "▬"
};

function valorDe(indicador: Indicador) {
  // Indicador não confiável com valor zero não mostra "R$ 0" — mostra que não
  // sabe. Um zero formatado é indistinguível de uma medição legítima de zero, e
  // essa confusão é exatamente o que este painel promete não fazer.
  if (!indicador.confiavel && indicador.valor === 0) return "—";
  return FORMATADORES[indicador.formato](indicador.valor);
}

/** Bloco padrão de indicador: número, comparação, veredito e a linha de ação. */
function Bloco({ indicador }: { indicador: Indicador }) {
  return (
    <article className={`fin-painel-ind tendencia-${indicador.tendencia}`}>
      <header>
        <p className="fin-painel-ind-rotulo">
          {indicador.rotulo}
          {!indicador.confiavel ? (
            <span className="fin-painel-flag" title="Indicador construído sobre dado incompleto">
              dado incompleto
            </span>
          ) : null}
        </p>
        <p className="fin-painel-ind-valor">
          {valorDe(indicador)}
          <span className={`fin-painel-seta ${indicador.tendencia}`} aria-label={indicador.tendencia}>
            {SETA[indicador.tendencia]}
          </span>
        </p>
      </header>
      <p className="fin-painel-ind-comp">{indicador.comparacao}</p>
      <p className="fin-painel-ind-veredito">{indicador.veredito}</p>
      {indicador.acao ? (
        <p className="fin-painel-acao">
          <strong>Fazer:</strong> {indicador.acao}
        </p>
      ) : null}
    </article>
  );
}

/** Cabeçalho de gráfico: o título É a conclusão, derivada do dado. */
function TituloGrafico({ titulo, subtitulo }: { titulo: string; subtitulo: string }) {
  return (
    <header className="fin-painel-grafico-head">
      <h3>{titulo}</h3>
      <p>{subtitulo}</p>
    </header>
  );
}

export function FinExecutivePanel({ dados }: { dados: PainelExecutivo }) {
  if (!dados.disponivel) {
    return (
      <section className="card fin-empty">
        <h2 className="card-title">Painel indisponível</h2>
        <p>
          O painel executivo lê direto do PostgreSQL. Sem <code>FINANCE_DATABASE_URL</code> configurada, ou com as
          migrations não aplicadas, esta tela fica assim — o restante da plataforma segue funcionando.
        </p>
      </section>
    );
  }

  const { caixa, motor, qualidade, ciclo, throughput } = dados;
  const naoConfiaveis = [
    ...caixa.indicadores,
    ...motor.indicadores,
    ...qualidade.indicadores,
    ...ciclo.indicadores,
    ...throughput.indicadores
  ].filter((indicador) => !indicador.confiavel);
  const destaqueNucleo = [...throughput.porNucleo].sort((a, b) => b.deltaCents - a.deltaCents)[0]?.slug ?? "";

  return (
    <>
      {/* (a) A leitura do mês. Quem lê só isto sai sabendo o que decidir. */}
      <section className="card fin-painel-leitura" aria-label="Leitura do mês">
        <h2 className="card-title">Leitura do mês</h2>
        {dados.leituraDoMes.map((frase, indice) => (
          <p key={indice} className={indice === 0 ? "fin-painel-leitura-abre" : undefined}>
            {frase}
          </p>
        ))}
      </section>

      {/* (b) As quatro manchetes. Nenhuma aparece sem comparação. */}
      <section className="fin-painel-destaques" aria-label="Números do período">
        {dados.destaques.map((indicador) => (
          <article
            key={indicador.rotulo}
            className={`fin-painel-destaque ${indicador.tendencia}${indicador.confiavel ? "" : " incerto"}`}
          >
            <p className="fin-painel-destaque-rotulo">{indicador.rotulo}</p>
            <p className="fin-painel-destaque-valor">{valorDe(indicador)}</p>
            <p className="fin-painel-destaque-comp">
              <span className={`fin-painel-seta ${indicador.tendencia}`}>{SETA[indicador.tendencia]}</span>{" "}
              {indicador.comparacao}
            </p>
          </article>
        ))}
      </section>

      {/* (c) Gráficos. O título de cada um é a conclusão, calculada do dado. */}
      <section className="card fin-painel-grafico" aria-label="Motor de receita">
        <TituloGrafico titulo={motor.grafico.titulo} subtitulo={motor.grafico.subtitulo} />
        <FinPainelReceitaChart dados={motor.grafico.dados} />
        <div className="fin-painel-blocos">
          {motor.indicadores.map((indicador) => (
            <Bloco key={indicador.rotulo} indicador={indicador} />
          ))}
        </div>
      </section>

      <section className="card fin-painel-grafico" aria-label="Throughput por núcleo">
        <TituloGrafico titulo={motor.graficoNucleo.titulo} subtitulo={motor.graficoNucleo.subtitulo} />
        <FinPainelNucleoChart dados={motor.graficoNucleo.dados} destaque={destaqueNucleo} />

        {/* A tabela existe porque a barra responde "quanto" e o Throughput
            responde "quanto sobra" — e no doc 17 é o segundo que decide. */}
        <div className="fin-table-wrap">
          <table className="fin-table">
            <caption className="fin-painel-caption">
              Throughput = Receita − Custos Totalmente Variáveis (doc 17). Sem rateio de custo fixo: rateio serve para
              contabilidade, não para decidir se vale a pena aceitar o próximo serviço.
            </caption>
            <thead>
              <tr>
                <th scope="col">Núcleo</th>
                <th scope="col" className="num">
                  Receita 12m
                </th>
                <th scope="col" className="num">
                  12m anteriores
                </th>
                <th scope="col" className="num">
                  CTV
                </th>
                <th scope="col" className="num">
                  Throughput
                </th>
                <th scope="col" className="num">
                  Margem T
                </th>
              </tr>
            </thead>
            <tbody>
              {throughput.porNucleo
                .filter((linha) => linha.receitaCents > 0)
                .map((linha) => (
                  <tr key={linha.slug}>
                    <th scope="row">{linha.nome}</th>
                    <td className="num fin-table-money">{brlCents(linha.receitaCents)}</td>
                    <td className="num fin-table-money fin-nowrap">{brlCents(linha.receitaAnteriorCents)}</td>
                    <td className={linha.ctvCents > 0 ? "num fin-table-money" : "num fin-table-money fin-zero"}>
                      {linha.ctvCents > 0 ? brlCents(linha.ctvCents) : "não registrado"}
                    </td>
                    <td className="num fin-table-money">{brlCents(linha.throughputCents)}</td>
                    <td className="num fin-table-money">{pct(linha.margemThroughputPct, 1)}</td>
                  </tr>
                ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Total</th>
                <td className="num fin-table-money">{brlCents(throughput.receita12mCents)}</td>
                <td className="num fin-table-money">{brlCents(motor.receita12mAnteriorCents)}</td>
                <td className="num fin-table-money">{brlCents(throughput.ctv12mCents)}</td>
                <td className="num fin-table-money">{brlCents(throughput.throughput12mCents)}</td>
                <td className="num fin-table-money">{pct(throughput.margemPct, 1)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="fin-painel-blocos">
          {throughput.indicadores.map((indicador) => (
            <Bloco key={indicador.rotulo} indicador={indicador} />
          ))}
        </div>
      </section>

      <section className="card fin-painel-grafico" aria-label="Ciclo financeiro e carteira">
        <TituloGrafico titulo={ciclo.grafico.titulo} subtitulo={ciclo.grafico.subtitulo} />
        <FinPainelAgingChart dados={ciclo.grafico.dados} />
        <div className="fin-painel-blocos">
          {ciclo.indicadores.map((indicador) => (
            <Bloco key={indicador.rotulo} indicador={indicador} />
          ))}
        </div>
      </section>

      <section className="card fin-painel-grafico" aria-label="Qualidade e concentração da receita">
        <TituloGrafico titulo={qualidade.grafico.titulo} subtitulo={qualidade.grafico.subtitulo} />
        <FinPainelParetoChart dados={qualidade.grafico.dados} />
        <ol className="fin-painel-top">
          {qualidade.grafico.dados.slice(0, 5).map((linha, indice) => (
            <li key={linha.nome}>
              <span className="fin-painel-top-pos">{indice + 1}º</span>
              <span className="fin-painel-top-nome">{linha.nome}</span>
              <span className="fin-painel-top-valor">
                {brlCompact(linha.receitaCents)} · {pct(linha.pctIndividual, 1)}
              </span>
            </li>
          ))}
        </ol>
        <div className="fin-painel-blocos">
          {qualidade.indicadores.map((indicador) => (
            <Bloco key={indicador.rotulo} indicador={indicador} />
          ))}
        </div>
      </section>

      <section className="card fin-painel-grafico" aria-label="Caixa e fôlego">
        <header className="fin-painel-grafico-head">
          <h3>
            {caixa.diasCobertura === null
              ? "Fôlego de caixa: indisponível — a despesa não está no ledger"
              : `Fôlego de caixa: ${caixa.diasCobertura} dias de cobertura`}
          </h3>
          <p>
            {brlCents(caixa.saldoCents)} em conta, {brlCents(caixa.reservasSeparadasCents)} separados em reservas,{" "}
            {brlCents(caixa.entradaMediaDiariaCents)} de entrada média diária nos últimos 90 dias.
          </p>
        </header>
        <div className="fin-painel-blocos">
          {caixa.indicadores.map((indicador) => (
            <Bloco key={indicador.rotulo} indicador={indicador} />
          ))}
        </div>
      </section>

      {/* (d) Riscos: o que pode derrubar o ano, com a ação ao lado. */}
      <section className="card fin-painel-grafico" aria-label="Riscos">
        <header className="fin-painel-grafico-head">
          <h3>Riscos que exigem decisão, não monitoramento</h3>
          <p>
            Ordenados por quanto custam se ninguém agir. Cada um traz o número que dispara a ação, não uma cor de
            semáforo.
          </p>
        </header>
        <div className="fin-painel-blocos">
          {dados.riscos.map((indicador) => (
            <Bloco key={indicador.rotulo} indicador={indicador} />
          ))}
        </div>
      </section>

      {/* (e) A seção que dá crédito ao resto: o que o painel não sabe. */}
      <section className="card fin-painel-lacunas" aria-label="Limites do painel">
        <h2 className="card-title">O que este painel ainda não sabe</h2>
        <p className="fin-painel-lacunas-abre">
          Todo número acima vem do Asaas. Enquanto ele for a única fonte do ledger, este painel descreve o lado da
          receita com precisão e o lado do custo não descreve de forma alguma. As lacunas abaixo estão em ordem de
          impacto — a primeira invalida qualquer conversa sobre lucro.
        </p>
        <ol className="fin-painel-lacunas-lista">
          {dados.lacunas.map((lacuna) => (
            <li key={lacuna.titulo}>
              <strong>{lacuna.titulo}</strong>
              <span>{lacuna.detalhe}</span>
            </li>
          ))}
        </ol>
        {naoConfiaveis.length ? (
          <p className="fin-painel-lacunas-flags">
            Indicadores marcados como dado incompleto nesta tela:{" "}
            {naoConfiaveis.map((indicador) => indicador.rotulo).join(" · ")}.
          </p>
        ) : null}
      </section>
    </>
  );
}

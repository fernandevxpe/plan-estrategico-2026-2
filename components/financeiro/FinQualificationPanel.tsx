import Link from "next/link";

import type { Qualificacao } from "@/lib/financeiro/qualificacao";
import { brlCents, pct } from "@/lib/financeiro/format";

/**
 * O que falta qualificar — e o caminho para resolver.
 *
 * A visão geral mostrava indicadores e parava aí. Um número que diz "93%
 * classificado" sem dizer QUAIS 7% faltam e quanto valem vira curiosidade, não
 * tarefa. Este bloco fecha essa lacuna: cada linha é um clique para o lugar
 * onde a decisão se toma.
 *
 * Ordenado por R$ em jogo, sempre. 46 cobranças de R$ 1.086 do mesmo shopping
 * valem mais que 119 de R$ 154 de um posto — e resolver as duas custa o mesmo,
 * porque a decisão é por CLIENTE, não por linha.
 */
export function FinQualificationPanel({ dados }: { dados: Qualificacao }) {
  if (!dados.disponivel) return null;

  const tudoResolvido =
    !dados.semCategoria.n && !dados.semNucleo.n && !dados.lancamentosSemCategoria.n && !dados.contasSemExtrato.length;

  if (tudoResolvido) {
    return (
      <section className="card fin-queue-done">
        <h2 className="card-title">Nada pendente de qualificação</h2>
        <p>Toda cobrança e todo lançamento têm categoria, núcleo e contraparte. As contas estão com extrato em dia.</p>
      </section>
    );
  }

  return (
    <section className="card">
      <h2 className="card-title">O que falta qualificar</h2>
      <p className="fin-card-hint">
        Cada linha leva ao lugar onde a decisão se toma. Ordenado por valor: as primeiras resolvem a maior parte.
      </p>

      <div className="fin-lacunas">
        {dados.semCategoria.n ? (
          <Link href="/financeiro/revisao" className="fin-lacuna">
            <span className="fin-lacuna-valor">{brlCents(dados.semCategoria.valorCents)}</span>
            <span className="fin-lacuna-rotulo">
              {dados.semCategoria.n} cobranças sem categoria
            </span>
            <span className="fin-lacuna-acao">ir para a fila de revisão →</span>
          </Link>
        ) : null}

        {dados.lancamentosSemCategoria.n ? (
          <Link href="/financeiro/lancamentos?semCategoria=1" className="fin-lacuna">
            <span className="fin-lacuna-valor">{brlCents(dados.lancamentosSemCategoria.valorCents)}</span>
            <span className="fin-lacuna-rotulo">{dados.lancamentosSemCategoria.n} lançamentos sem categoria</span>
            <span className="fin-lacuna-acao">ver no extrato →</span>
          </Link>
        ) : null}

        {dados.semNucleo.n ? (
          <Link href="/financeiro/revisao" className="fin-lacuna">
            <span className="fin-lacuna-valor">{brlCents(dados.semNucleo.valorCents)}</span>
            <span className="fin-lacuna-rotulo">
              {dados.semNucleo.n} cobranças sem núcleo — não entram no resultado por área
            </span>
            <span className="fin-lacuna-acao">classificar →</span>
          </Link>
        ) : null}

        {dados.contasSemExtrato.length ? (
          <Link href="/financeiro/importar" className="fin-lacuna alerta">
            <span className="fin-lacuna-valor">{dados.contasSemExtrato.length}</span>
            <span className="fin-lacuna-rotulo">
              contas sem extrato recente:{" "}
              {dados.contasSemExtrato
                .map((conta) => `${conta.nome}${conta.diasSemExtrato === null ? " (nunca)" : ` (${conta.diasSemExtrato}d)`}`)
                .join(" · ")}
            </span>
            <span className="fin-lacuna-acao">importar extrato →</span>
          </Link>
        ) : null}

        {dados.pagaveisSemPlano.n ? (
          <Link href="/financeiro/contas" className="fin-lacuna">
            <span className="fin-lacuna-valor">{brlCents(dados.pagaveisSemPlano.valorCents)}</span>
            <span className="fin-lacuna-rotulo">
              {dados.pagaveisSemPlano.n} saídas sem pagamento previsto — dinheiro que saiu sem ter sido planejado
            </span>
            <span className="fin-lacuna-acao">planejar pagamentos →</span>
          </Link>
        ) : null}
      </div>

      {dados.semCategoria.porContraparte.length ? (
        <>
          <h3 className="fin-subtitulo">Por cliente — a decisão é por cliente, não por cobrança</h3>
          <div className="table-wrap">
            <table className="fin-table">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th className="num">Cobranças</th>
                  <th className="num">Valor</th>
                  <th>O histórico dele sugere</th>
                </tr>
              </thead>
              <tbody>
                {dados.semCategoria.porContraparte.slice(0, 12).map((linha) => (
                  <tr key={`${linha.contraparteId ?? "sem"}-${linha.nome}`}>
                    <td>{linha.nome}</td>
                    <td className="num">{linha.n}</td>
                    <td className="num fin-table-money">{brlCents(linha.valorCents)}</td>
                    <td>
                      {linha.sugestao ? (
                        <>
                          <span className="fin-code">{linha.sugestao.code}</span> {linha.sugestao.name}
                          <span className="fin-tag">{pct(linha.sugestao.share, 0)} do histórico</span>
                        </>
                      ) : (
                        <span className="fin-badge-pendente">sem histórico — precisa de decisão</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  );
}

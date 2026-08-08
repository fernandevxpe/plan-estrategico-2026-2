import type { Indicador, Indicadores } from "@/lib/financeiro/indicadores";
import { brlCents, pct } from "@/lib/financeiro/format";

/**
 * Painel de indicadores de gestão.
 *
 * Cada cartão mostra três coisas e nada mais: o valor, a variação contra a
 * janela comparável, e a definição em uma linha. A definição fica visível em vez
 * de escondida num tooltip porque indicador financeiro sem definição é
 * literalmente ilegível — "inadimplência" mede coisas diferentes em cada empresa
 * que já usou a palavra.
 *
 * Quando o dado não existe, o cartão diz o motivo em vez de mostrar zero. Zero é
 * uma afirmação sobre o mundo; ausência é uma afirmação sobre o banco, e as duas
 * não podem ter a mesma aparência numa tela onde alguém decide pagamento.
 */

const AVISO_TETO =
  "Este DRE tem receita real e despesa quase zero — o Asaas não registra saídas. " +
  "Lucro e margem aqui são teto, não resultado.";

function formatarValor(indicador: Indicador) {
  if (indicador.valor === null) return "—";
  switch (indicador.formato) {
    case "dinheiro":
      return brlCents(indicador.valor);
    case "percentual":
      return pct(indicador.valor, 1);
    case "meses":
      return `${indicador.valor.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} meses`;
    default:
      return indicador.valor.toLocaleString("pt-BR");
  }
}

/**
 * Delta em pontos percentuais quando o indicador JÁ é percentual, e em variação
 * relativa quando é valor. Misturar os dois faz "inadimplência subiu 34%" querer
 * dizer duas coisas diferentes em dois cartões vizinhos.
 */
function calcularDelta(indicador: Indicador) {
  if (indicador.valor === null || indicador.anterior === null) return null;
  if (indicador.formato === "percentual") {
    const diferenca = indicador.valor - indicador.anterior;
    return {
      texto: `${diferenca >= 0 ? "+" : "−"}${Math.abs(diferenca).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} p.p.`,
      sinal: diferenca
    };
  }
  if (!indicador.anterior) return null;
  const variacao = ((indicador.valor - indicador.anterior) / Math.abs(indicador.anterior)) * 100;
  return {
    texto: `${variacao >= 0 ? "+" : "−"}${Math.abs(variacao).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`,
    sinal: variacao
  };
}

function classeDelta(sinal: number, melhorQuando: Indicador["melhorQuando"]) {
  if (Math.abs(sinal) < 0.05 || melhorQuando === "neutro") return "fin-delta neutro";
  const bom = melhorQuando === "sobe" ? sinal > 0 : sinal < 0;
  return bom ? "fin-delta bom" : "fin-delta ruim";
}

export function FinIndicadores({ dados, semDespesa }: { dados: Indicadores; semDespesa: boolean }) {
  if (!dados.disponivel) return null;

  return (
    <>
      {dados.grupos.map((grupo) => (
        <section className="card" key={grupo.titulo}>
          <h2 className="card-title">{grupo.titulo}</h2>
          <p className="fin-card-hint">{grupo.hint}</p>
          <div className="fin-ind-grid">
            {grupo.itens.map((indicador) => {
              const delta = calcularDelta(indicador);
              const indisponivel = indicador.valor === null;
              const titulo = indicador.dependeDeDespesa && semDespesa ? AVISO_TETO : undefined;

              return (
                <article
                  key={indicador.chave}
                  className={
                    indisponivel
                      ? "fin-ind-card indisponivel"
                      : indicador.alerta
                        ? "fin-ind-card alerta"
                        : "fin-ind-card"
                  }
                  title={titulo}
                >
                  <p className="fin-ind-rotulo">{indicador.rotulo}</p>
                  <p className="fin-ind-valor">{formatarValor(indicador)}</p>
                  {indisponivel ? (
                    <p className="fin-ind-indisponivel">{indicador.indisponivelPor}</p>
                  ) : delta ? (
                    <p className={classeDelta(delta.sinal, indicador.melhorQuando)}>
                      {delta.texto} <span>vs. período anterior</span>
                    </p>
                  ) : (
                    <p className="fin-delta neutro">
                      <span>sem série comparável</span>
                    </p>
                  )}
                  <p className="fin-ind-hint">{indicador.hint}</p>
                </article>
              );
            })}
          </div>
        </section>
      ))}

      <div className="fin-two-col">
        <section className="card">
          <h2 className="card-title">Inadimplência por idade</h2>
          <div className="table-wrap">
            <table className="fin-table">
              <thead>
                <tr>
                  <th>Faixa</th>
                  <th className="num">Cobranças</th>
                  <th className="num">Em aberto</th>
                  <th className="num">Peso</th>
                </tr>
              </thead>
              <tbody>
                {dados.aging.map((faixa) => (
                  <tr key={faixa.faixa}>
                    <td className={faixa.faixa === "90+" ? "fin-badge-atencao" : undefined}>{faixa.faixa} dias</td>
                    <td className="num">{faixa.n}</td>
                    <td className="num fin-table-money">{brlCents(faixa.abertoCents)}</td>
                    <td className="num">
                      <span
                        className="fin-share"
                        style={{ ["--share" as string]: `${faixa.pctDoVencido.toFixed(1)}%` }}
                      >
                        {pct(faixa.pctDoVencido, 0)}
                      </span>
                    </td>
                  </tr>
                ))}
                {!dados.aging.length ? (
                  <tr>
                    <td colSpan={4} className="fin-empty-row">
                      Nada em atraso.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <p className="fin-card-hint">
            Contado por data de vencimento, não pelo carimbo do gateway. Cobrança já confirmada e aguardando crédito
            (cartão em D+30) fica de fora: o dinheiro chegou, só não foi liberado.
          </p>
        </section>

        <section className="card">
          <h2 className="card-title">Concentração no período</h2>
          <div className="table-wrap">
            <table className="fin-table">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th className="num">Receita</th>
                  <th className="num">Peso</th>
                </tr>
              </thead>
              <tbody>
                {dados.topClientes.map((cliente) => (
                  <tr key={cliente.nome}>
                    <td>{cliente.nome}</td>
                    <td className="num fin-table-money">{brlCents(cliente.totalCents)}</td>
                    <td className="num">
                      <span
                        className="fin-share"
                        style={{
                          ["--share" as string]: `${
                            dados.topClientes[0] ? (cliente.totalCents / dados.topClientes[0].totalCents) * 100 : 0
                          }%`
                        }}
                      >
                        {pct(cliente.pct, 1)}
                      </span>
                    </td>
                  </tr>
                ))}
                {!dados.topClientes.length ? (
                  <tr>
                    <td colSpan={3} className="fin-empty-row">
                      Sem receita no período.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <p className="fin-card-hint">
            Por competência e no período selecionado — trocar o período troca esta lista.
          </p>
        </section>
      </div>
    </>
  );
}

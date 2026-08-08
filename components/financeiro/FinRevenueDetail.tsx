import type { ReceitasDetalhe } from "@/lib/financeiro/receitas";
import { brlCents, brlCompact, brlPrecise, dateLabel, monthKeyLabel, pct } from "@/lib/financeiro/format";

/**
 * Detalhamento de receita.
 *
 * A matriz categoria × mês é a peça central: é a visão que a planilha nunca deu
 * bem, porque exigia rolar duas dimensões ao mesmo tempo. Aqui a primeira coluna
 * fica fixa e o resto rola na horizontal.
 *
 * A lista de inadimplência fica por último de propósito, e completa: são 47
 * cobranças e R$ 92 mil: é curta o bastante para caber inteira, e é uma lista de
 * ligações a fazer, não um indicador para contemplar.
 */
export function FinRevenueDetail({ dados }: { dados: ReceitasDetalhe }) {
  if (!dados.disponivel) {
    return (
      <section className="card fin-empty">
        <h2 className="card-title">Receitas indisponíveis</h2>
        <p>
          Sem conexão com o banco do financeiro. O restante da plataforma segue funcionando — só esta tela depende do
          PostgreSQL em tempo de request.
        </p>
      </section>
    );
  }

  return (
    <>
      <section className="fin-kpi-row" aria-label="Indicadores de receita">
        <article className="fin-kpi-card">
          <p className="fin-kpi-label">Recebido em 12 meses</p>
          <p className="fin-kpi-value">{brlCents(dados.kpi.recebido12mCents)}</p>
          <p className="fin-kpi-hint">{dados.kpi.nCobrancas.toLocaleString("pt-BR")} cobranças pagas</p>
        </article>
        <article className="fin-kpi-card">
          <p className="fin-kpi-label">Ticket médio</p>
          <p className="fin-kpi-value">{brlCents(dados.kpi.ticketMedioCents)}</p>
          <p className="fin-kpi-hint">por cobrança recebida</p>
        </article>
        <article className="fin-kpi-card">
          <p className="fin-kpi-label">Recorrente por mês</p>
          <p className="fin-kpi-value">{brlCents(dados.kpi.mrrProxyCents)}</p>
          <p className="fin-kpi-hint">
            {pct(dados.kpi.pctRecorrente, 1)} da receita · o resto recomeça do zero todo mês
          </p>
        </article>
        <article className="fin-kpi-card">
          <p className="fin-kpi-label">Concentração</p>
          <p className="fin-kpi-value">{dados.pareto80}</p>
          <p className="fin-kpi-hint">
            clientes somam 80% do faturamento, de {dados.nClientes.toLocaleString("pt-BR")} no total
          </p>
        </article>
      </section>

      <section className="card">
        <h2 className="card-title">Receita por categoria, mês a mês</h2>
        <p className="fin-card-hint">
          Por data de pagamento. A primeira coluna fica fixa — role na horizontal para ver os meses anteriores.
        </p>
        <div className="table-wrap fin-matrix-wrap">
          <table className="fin-table fin-matrix">
            <thead>
              <tr>
                <th className="fin-matrix-head">Categoria</th>
                {dados.meses.map((mes) => (
                  <th key={mes} className="num">
                    {monthKeyLabel(mes)}
                  </th>
                ))}
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {dados.matriz.map((linha) => (
                <tr key={linha.code ?? linha.nome}>
                  <th scope="row" className="fin-matrix-head">
                    {linha.code ? <span className="fin-code">{linha.code}</span> : null}
                    {linha.nome}
                  </th>
                  {dados.meses.map((mes) => {
                    const valor = linha.porMes[mes] ?? 0;
                    return (
                      <td key={mes} className="num fin-table-money">
                        {valor ? brlCompact(valor) : <span className="fin-zero">—</span>}
                      </td>
                    );
                  })}
                  <td className="num fin-table-money">
                    <strong>{brlCompact(linha.totalCents)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" className="fin-matrix-head">
                  Total
                </th>
                {dados.meses.map((mes) => (
                  <td key={mes} className="num fin-table-money">
                    <strong>{brlCompact(dados.totalPorMes[mes] ?? 0)}</strong>
                  </td>
                ))}
                <td className="num fin-table-money">
                  <strong>{brlCompact(dados.kpi.recebido12mCents)}</strong>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <div className="fin-two-col">
        <section className="card">
          <h2 className="card-title">Maiores clientes</h2>
          <div className="table-wrap">
            <table className="fin-table">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th className="num">Recebido</th>
                  <th className="num">Peso</th>
                  <th>Última</th>
                </tr>
              </thead>
              <tbody>
                {dados.clientes.map((cliente) => (
                  <tr key={cliente.nome}>
                    <td>
                      {cliente.nome}
                      <span className="fin-desc-sub">{cliente.n} cobranças</span>
                    </td>
                    <td className="num fin-table-money">{brlCents(cliente.totalCents)}</td>
                    <td className="num">
                      <span
                        className="fin-share"
                        style={{
                          ["--share" as string]: `${
                            dados.clientes[0] ? (cliente.totalCents / dados.clientes[0].totalCents) * 100 : 0
                          }%`
                        }}
                      >
                        {pct(cliente.pctDoTotal, 1)}
                      </span>
                    </td>
                    <td className="fin-nowrap">{dateLabel(cliente.ultima)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <h2 className="card-title">Recorrente × pontual</h2>
          <div className="table-wrap">
            <table className="fin-table">
              <thead>
                <tr>
                  <th>Mês</th>
                  <th className="num">Recorrente</th>
                  <th className="num">Pontual</th>
                  <th className="num">% rec.</th>
                </tr>
              </thead>
              <tbody>
                {dados.recorrentePorMes.map((linha) => {
                  const total = linha.recorrenteCents + linha.pontualCents;
                  return (
                    <tr key={linha.mes}>
                      <td>{monthKeyLabel(linha.mes)}</td>
                      <td className="num fin-table-money">{brlCompact(linha.recorrenteCents)}</td>
                      <td className="num fin-table-money">{brlCompact(linha.pontualCents)}</td>
                      <td className="num">{pct(total ? (linha.recorrenteCents / total) * 100 : 0, 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="fin-card-hint">
            Recorrente conta gestão de faturas, medição e comissionamento — o que se repete sem venda nova.
          </p>
        </section>
      </div>

      <section className="card">
        <h2 className="card-title">Em atraso — lista de cobrança</h2>
        <p className="fin-card-hint">
          Contado por data de vencimento, não pelo carimbo do gateway. Ordenado por valor: as primeiras ligações
          recuperam a maior parte.
        </p>
        <div className="table-wrap">
          <table className="fin-table">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Descrição</th>
                <th>Venceu</th>
                <th className="num">Atraso</th>
                <th className="num">Em aberto</th>
              </tr>
            </thead>
            <tbody>
              {dados.inadimplencia.map((linha, indice) => (
                <tr key={`${linha.dueDate}-${indice}`}>
                  <td>{linha.contraparte ?? "—"}</td>
                  <td>
                    <span className="fin-desc">{linha.descricao}</span>
                  </td>
                  <td className="fin-nowrap">{dateLabel(linha.dueDate)}</td>
                  <td className="num">
                    <span className={linha.diasAtraso > 90 ? "fin-badge-atencao" : undefined}>
                      {linha.diasAtraso} d
                    </span>
                  </td>
                  <td className="num fin-table-money fin-out">{brlPrecise(linha.abertoCents)}</td>
                </tr>
              ))}
              {!dados.inadimplencia.length ? (
                <tr>
                  <td colSpan={5} className="fin-empty-row">
                    Nada em atraso.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

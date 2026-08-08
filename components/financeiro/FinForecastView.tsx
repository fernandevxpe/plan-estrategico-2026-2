import type { PrevisaoFluxo } from "@/lib/financeiro/forecast";
import { brlCents, brlCompact, brlPrecise, dateLabel, monthKeyLabel, pct, shortDateLabel } from "@/lib/financeiro/format";
import { FinForecastChart } from "./FinForecastChart";

/**
 * Previsão de fluxo de caixa.
 *
 * O princípio da tela: NUNCA uma soma opaca. Cada camada aparece com o próprio
 * número e a própria confiabilidade, e o que falta no banco (todas as saídas)
 * é dito em card de aviso, não escondido atrás de um total otimista.
 */
export function FinForecastView({ dados }: { dados: PrevisaoFluxo }) {
  if (!dados.disponivel) {
    return (
      <section className="card fin-empty">
        <h2 className="card-title">Previsão indisponível</h2>
        <p>
          O fluxo de caixa lê direto do PostgreSQL. Sem <code>DATABASE_URL</code> configurada ou com as migrations não
          aplicadas, esta tela fica assim — o restante da plataforma segue funcionando.
        </p>
      </section>
    );
  }

  const { l0, l1, l2, l3, grade, meses } = dados;
  const linhaMinima = grade.find((linha) => linha.minimo);

  return (
    <>
      {/* ── As quatro camadas, lado a lado e nunca somadas ── */}
      <section className="fin-kpi-row" aria-label="Camadas da previsão">
        <article className="fin-kpi-card">
          <p className="fin-kpi-label">
            <span className="fin-layer-tag">L0</span> Saldo disponível
          </p>
          <p className="fin-kpi-value">{brlCents(l0.disponivelCents)}</p>
          <p className="fin-kpi-hint">
            {brlCents(l0.saldoContasCents)} em conta menos {brlCents(l0.reservasSeparadasCents)} já separados em
            reservas. Fato, não projeção — mas só o Asaas tem extrato.
          </p>
        </article>
        <article className="fin-kpi-card">
          <p className="fin-kpi-label">
            <span className="fin-layer-tag">L1</span> Contratado a receber
          </p>
          <p className="fin-kpi-value">{brlCents(l1.ajustadoCents)}</p>
          <p className="fin-kpi-hint">
            {brlCents(l1.brutoCents)} brutos em {l1.aVencer.n + l1.vencido.n + l1.confirmado.n} cobranças, ajustados
            pela curva de recuperação do que está vencido.
          </p>
        </article>
        <article className="fin-kpi-card">
          <p className="fin-kpi-label">
            <span className="fin-layer-tag">L2</span> Recorrente contratado
          </p>
          <p className="fin-kpi-value">{l2.contratos.length ? `${brlCents(l2.mensalCents)}/mês` : "—"}</p>
          <p className="fin-kpi-hint">
            {l2.contratos.length
              ? `${l2.contratos.length} contratos mensais ativos projetados no horizonte.`
              : "Nenhum contrato recorrente cadastrado ainda. A PIAU (~R$ 15 mil/mês) chega como cobrança avulsa e hoje só aparece na L1 quando a cobrança é emitida."}
          </p>
        </article>
        <article className="fin-kpi-card alerta">
          <p className="fin-kpi-label">
            <span className="fin-layer-tag">L3</span> Saídas comprometidas
          </p>
          <p className="fin-kpi-value">{l3.n ? brlCents(l3.abertoCents) : "R$ 0"}</p>
          <p className="fin-kpi-hint">
            {l3.n
              ? `${l3.n} documentos a pagar em aberto.`
              : "Zero documentos a pagar no banco — o que é lacuna de dado, não ausência de despesa."}
          </p>
        </article>
      </section>

      {!l3.n ? (
        <div className="fin-alert" role="status">
          <strong>Nenhuma saída registrada.</strong> O Asaas não tem despesas; até os extratos dos outros bancos
          entrarem, esta previsão mostra só o lado da entrada e o saldo projetado é um teto, não uma previsão.
        </div>
      ) : null}

      {/* ── Curva de recuperação do vencido ── */}
      <section className="card">
        <h2 className="card-title">O vencido não vale o valor de face</h2>
        <p className="fin-card-hint">
          {brlCents(l1.vencido.brutoCents)} vencidos em {l1.vencido.n} cobranças valem{" "}
          <strong>{brlCompact(l1.vencido.ajustadoCents)}</strong> ajustados pela curva — quanto mais velho o atraso,
          menor a chance de recuperar. A curva é uma premissa declarada, não um cálculo do histórico; quando a régua de
          cobrança existir, ela deve ser recalibrada.
        </p>
        <div className="table-wrap">
          <table className="fin-table">
            <thead>
              <tr>
                <th>Idade do atraso</th>
                <th className="num">Fator</th>
                <th className="num">Cobranças</th>
                <th className="num">Bruto</th>
                <th className="num">Ajustado</th>
              </tr>
            </thead>
            <tbody>
              {l1.vencido.faixas.map((faixa) => (
                <tr key={faixa.faixa}>
                  <td>{faixa.faixa}</td>
                  <td className="num">{pct(faixa.fator * 100, 0)}</td>
                  <td className="num">{faixa.n}</td>
                  <td className="num fin-table-money">{brlPrecise(faixa.brutoCents)}</td>
                  <td className="num fin-table-money">{brlPrecise(faixa.ajustadoCents)}</td>
                </tr>
              ))}
              <tr className="fin-linha-total">
                <td>Total vencido</td>
                <td className="num">—</td>
                <td className="num">{l1.vencido.n}</td>
                <td className="num fin-table-money">{brlPrecise(l1.vencido.brutoCents)}</td>
                <td className="num fin-table-money">{brlPrecise(l1.vencido.ajustadoCents)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        {l1.confirmado.n ? (
          <p className="fin-card-hint">
            À parte disso, {l1.confirmado.n} cobranças que o Asaas marca como <em>confirmadas</em> somam{" "}
            {brlCents(l1.confirmado.brutoCents)} — mas a data prevista de crédito já passou em todas (a mais antiga é
            de 2021). Isso é dado estagnado aguardando conciliação, não dinheiro a caminho; recebem a mesma curva do
            vencido e entram ajustadas a {brlCompact(l1.confirmado.ajustadoCents)}.
          </p>
        ) : null}
      </section>

      {/* ── Horizonte de 6 meses ── */}
      <section className="card">
        <h2 className="card-title">Saldo projetado, 6 meses</h2>
        <p className="fin-card-hint">
          Barras: entradas contratadas ajustadas (L1 + L2) por mês. Linha: saldo projetado — um teto enquanto L3 for
          zero. A linha tracejada é a meta somada das quatro reservas ({brlCents(l0.metaReservasCents)}), hoje com R$ 0
          separado.
        </p>
        <FinForecastChart
          meses={meses.map((m) => ({
            mes: m.mes,
            entradaCents: m.l1Cents + m.l2Cents,
            fechamentoCents: m.fechamentoCents
          }))}
          metaReservasCents={l0.metaReservasCents}
        />
      </section>

      <section className="card">
        <h2 className="card-title">Mês a mês</h2>
        <p className="fin-card-hint">
          Cobrança com data prevista no passado (vencidos e confirmados) rola para o mês corrente, já ajustada.{" "}
          {l1.alemHorizonte.n
            ? `Além do horizonte ficam ${l1.alemHorizonte.n} cobranças (${brlCompact(l1.alemHorizonte.ajustadoCents)} ajustados). `
            : ""}
          Abra um mês para ver as 10 maiores cobranças que o compõem.
        </p>
        <div className="table-wrap">
          <table className="fin-table">
            <thead>
              <tr>
                <th>Mês</th>
                <th className="num">Abertura</th>
                <th className="num">L1 a receber</th>
                <th className="num">L2 recorrente</th>
                <th className="num">L3 saídas</th>
                <th className="num">Fechamento</th>
              </tr>
            </thead>
            <tbody>
              {meses.map((linha) => (
                <tr key={linha.mes}>
                  <td colSpan={6} className="fin-mes-cell">
                    <details className="fin-mes-details">
                      <summary>
                        <span className="fin-mes-nome">{monthKeyLabel(linha.mes)}</span>
                        <span className="num fin-table-money">{brlCents(linha.aberturaCents)}</span>
                        <span className="num fin-table-money fin-in">+{brlCents(linha.l1Cents)}</span>
                        <span className="num fin-table-money">{linha.l2Cents ? `+${brlCents(linha.l2Cents)}` : "—"}</span>
                        <span className="num fin-table-money fin-out">
                          {linha.l3Cents ? `−${brlCents(linha.l3Cents)}` : "—"}
                        </span>
                        <span className="num fin-table-money fin-mes-fech">{brlCents(linha.fechamentoCents)}</span>
                      </summary>
                      <div className="fin-mes-docs">
                        {linha.docs.length ? (
                          <table className="fin-table">
                            <thead>
                              <tr>
                                <th>Documento</th>
                                <th>Vencimento</th>
                                <th className="num">Fator</th>
                                <th className="num">Ajustado</th>
                              </tr>
                            </thead>
                            <tbody>
                              {linha.docs.map((doc, i) => (
                                <tr key={i}>
                                  <td>
                                    <span className="fin-desc">{doc.descricao || "(sem descrição)"}</span>
                                    <span className="fin-desc-sub">
                                      {doc.contraparte ?? "sem contraparte"}
                                      {doc.status === "confirmado" ? " · confirmado aguardando crédito" : ""}
                                      {doc.status !== "confirmado" && doc.dueDate < dados.hoje ? " · vencido" : ""}
                                    </span>
                                  </td>
                                  <td className="fin-nowrap">{dateLabel(doc.dueDate)}</td>
                                  <td className="num">{pct(doc.fator * 100, 0)}</td>
                                  <td className="num fin-table-money">{brlPrecise(doc.ajustadoCents)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <p className="fin-card-hint">Nenhum documento neste mês.</p>
                        )}
                        {linha.nDocs > linha.docs.length ? (
                          <p className="fin-card-hint">
                            Mostrando as {linha.docs.length} maiores de {linha.nDocs} cobranças.
                          </p>
                        ) : null}
                      </div>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Grade diária ── */}
      <section className="card">
        <h2 className="card-title">Dia a dia: mês corrente e o próximo</h2>
        <p className="fin-card-hint">
          Passado em cinza é o realizado do extrato; do dia de hoje em diante, cada cobrança entra na sua data prevista
          exata — nada é espalhado por média.{" "}
          {l1.semDataFuturaCents
            ? `Vencidos e confirmados sem data futura (${brlCompact(l1.semDataFuturaCents)} ajustados) ficam FORA da grade: sem data confiável, entrariam num dia inventado. `
            : ""}
          {linhaMinima ? (
            <>
              O menor saldo do período é <strong>{brlCents(linhaMinima.saldoCents)}</strong> em{" "}
              {dateLabel(linhaMinima.dia)}.
            </>
          ) : null}
        </p>
        <div className="fin-grade-wrap table-wrap">
          <table className="fin-table fin-grade">
            <thead>
              <tr>
                <th>Dia</th>
                <th className="num">Entradas</th>
                <th className="num">Saídas</th>
                <th className="num">Saldo projetado</th>
                <th aria-label="marcadores" />
              </tr>
            </thead>
            <tbody>
              {grade.map((linha) => (
                <tr
                  key={linha.dia}
                  className={[
                    linha.realizado ? "fin-dia-passado" : "",
                    linha.hoje ? "fin-dia-hoje" : "",
                    linha.minimo ? "fin-dia-minimo" : ""
                  ]
                    .filter(Boolean)
                    .join(" ") || undefined}
                >
                  <td className="fin-nowrap">{shortDateLabel(linha.dia)}</td>
                  <td className="num fin-table-money">
                    {linha.entradaCents ? <span className="fin-in">+{brlPrecise(linha.entradaCents)}</span> : "—"}
                  </td>
                  <td className="num fin-table-money">
                    {linha.saidaCents ? <span className="fin-out">−{brlPrecise(linha.saidaCents)}</span> : "—"}
                  </td>
                  <td className="num fin-table-money">{brlPrecise(linha.saldoCents)}</td>
                  <td>
                    {linha.realizado ? <span className="fin-tag">realizado</span> : null}
                    {linha.hoje ? <span className="fin-tag">hoje</span> : null}
                    {linha.minimo ? <span className="fin-minimo-label">menor saldo do período</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="fin-card-hint">
          Sem saídas futuras registradas (L3 = 0), o saldo só sobe — o menor saldo tende a ser hoje ou um dia já
          realizado. Quando as despesas entrarem, esta grade passa a apontar o dia de aperto de verdade.
        </p>
      </section>
    </>
  );
}

import type { VisaoGeral } from "@/lib/financeiro/queries";
import { brlCents, brlCompact, dateLabel, pct } from "@/lib/financeiro/format";
import { FinReliabilityPanel } from "./FinReliabilityPanel";
import { FinRevenueChart } from "./FinRevenueChart";

/**
 * Visão geral do financeiro.
 *
 * A ordem das seções é a ordem das perguntas que alguém faz ao abrir a tela de
 * manhã: posso confiar nisto? quanto tenho? quanto entrou? quem me deve? de onde
 * vem o dinheiro? do que dependo?
 */
export function FinOverview({ dados }: { dados: VisaoGeral }) {
  if (!dados.disponivel) {
    return (
      <section className="card fin-empty">
        <h2 className="card-title">Financeiro indisponível</h2>
        <p>
          O módulo financeiro lê direto do PostgreSQL, diferente do resto da plataforma, que lê artefatos do volume.
          Sem <code>DATABASE_URL</code> configurada ou com as migrations não aplicadas, esta tela fica assim — o
          restante da plataforma segue funcionando normalmente.
        </p>
        <p className="fin-empty-hint">
          Para subir localmente: <code>npm run db:migrate</code>, depois{" "}
          <code>node scripts/sync-asaas.mjs --full</code> e <code>node scripts/import-asaas.mjs</code>.
        </p>
      </section>
    );
  }

  const contasSemExtrato = dados.contas.filter(
    (conta) => conta.kind !== "emprestimo" && (conta.diasSemExtrato === null || conta.diasSemExtrato > 3)
  );
  const receitaMesAtual = dados.receita12m.at(-1)?.recebidoCents ?? 0;
  const mediaMensal = dados.receita12m.length
    ? Math.round(dados.receita12m.reduce((sum, row) => sum + row.recebidoCents, 0) / dados.receita12m.length)
    : 0;

  return (
    <>
      <FinReliabilityPanel {...dados.confiabilidade} />

      {contasSemExtrato.length ? (
        <div className="fin-alert" role="status">
          <strong>Despesa não rastreada.</strong> {contasSemExtrato.length} de {dados.contas.length} contas estão sem
          extrato recente ({contasSemExtrato.map((conta) => conta.name).join(", ")}). O Asaas entrega toda a receita e
          nenhuma despesa — enquanto isso durar, qualquer leitura de lucro nesta tela está incompleta por construção.
        </div>
      ) : null}

      <section className="fin-kpi-row" aria-label="Indicadores principais">
        <article className="fin-kpi-card">
          <p className="fin-kpi-label">Saldo disponível</p>
          <p className="fin-kpi-value">{brlCents(dados.saldoDisponivelCents)}</p>
          <p className="fin-kpi-hint">
            {brlCents(dados.saldoTotalCents)} em conta
            {dados.reservasCents > 0 ? ` menos ${brlCents(dados.reservasCents)} já separados em reservas` : ""}
            {dados.reservaFaltaCents > 0
              ? ` · faltam ${brlCompact(dados.reservaFaltaCents)} para completar as reservas`
              : ""}
          </p>
        </article>
        <article className="fin-kpi-card">
          <p className="fin-kpi-label">Recebido no mês</p>
          <p className="fin-kpi-value">{brlCents(receitaMesAtual)}</p>
          <p className="fin-kpi-hint">média de {brlCompact(mediaMensal)} nos últimos 12 meses</p>
        </article>
        <article className="fin-kpi-card">
          <p className="fin-kpi-label">A receber</p>
          <p className="fin-kpi-value">
            {brlCents(dados.aReceber.reduce((sum, row) => sum + row.totalCents, 0))}
          </p>
          <p className="fin-kpi-hint">
            {dados.aReceber.reduce((sum, row) => sum + row.n, 0)} cobranças já emitidas, a vencer
          </p>
        </article>
        <article className={dados.vencido.totalCents > 0 ? "fin-kpi-card alerta" : "fin-kpi-card"}>
          <p className="fin-kpi-label">Em atraso</p>
          <p className="fin-kpi-value">{brlCents(dados.vencido.totalCents)}</p>
          <p className="fin-kpi-hint">
            {dados.vencido.n} cobranças ·{" "}
            {pct(
              dados.vencido.totalCents
                ? ((dados.vencido.faixas.find((f) => f.faixa === "90+")?.totalCents ?? 0) / dados.vencido.totalCents) *
                    100
                : 0,
              0
            )}{" "}
            com mais de 90 dias
          </p>
        </article>
        <article className="fin-kpi-card">
          <p className="fin-kpi-label">Concentração</p>
          <p className="fin-kpi-value">{pct(dados.concentracaoTop10Pct, 0)}</p>
          <p className="fin-kpi-hint">
            do faturamento vem dos 10 maiores clientes
            {dados.concentracao[0]
              ? ` · o maior sozinho é ${pct(dados.concentracao[0].pct, 0)}`
              : ""}
          </p>
        </article>
      </section>

      <section className="card">
        <h2 className="card-title">Receita recebida, mês a mês</h2>
        <p className="fin-card-hint">
          Por data de pagamento — é a mesma base que o painel do Asaas mostra. O fluxo de caixa usa a data de crédito,
          que difere em 864 das 3.023 cobranças porque boleto pago na sexta cai na conta na segunda.
        </p>
        <FinRevenueChart dados={dados.receita12m} />
      </section>

      <div className="fin-two-col">
        <section className="card">
          <h2 className="card-title">Contas</h2>
          <div className="table-wrap">
            <table className="fin-table">
              <thead>
                <tr>
                  <th>Conta</th>
                  <th className="num">Saldo</th>
                  <th>Último extrato</th>
                </tr>
              </thead>
              <tbody>
                {dados.contas.map((conta) => (
                  <tr key={conta.slug}>
                    <td>
                      {conta.name}
                      {conta.kind === "emprestimo" ? <span className="fin-tag">fora do disponível</span> : null}
                    </td>
                    <td className="num fin-table-money">{brlCents(conta.saldoCents)}</td>
                    <td>
                      {conta.ultimoExtrato ? (
                        <span className={(conta.diasSemExtrato ?? 0) > 3 ? "fin-badge-atencao" : "fin-badge-ok"}>
                          {dateLabel(conta.ultimoExtrato)}
                        </span>
                      ) : (
                        <span className="fin-badge-atencao">nunca importado</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="fin-card-hint">
            Reservas: {dados.reservas.map((r) => `${r.name} ${brlCompact(r.atualCents)} de ${brlCompact(r.alvoCents)}`).join(" · ")}
          </p>
        </section>

        <section className="card">
          <h2 className="card-title">Inadimplência por idade</h2>
          <div className="table-wrap">
            <table className="fin-table">
              <thead>
                <tr>
                  <th>Faixa</th>
                  <th className="num">Cobranças</th>
                  <th className="num">Valor</th>
                </tr>
              </thead>
              <tbody>
                {dados.vencido.faixas.map((faixa) => (
                  <tr key={faixa.faixa}>
                    <td>{faixa.faixa} dias</td>
                    <td className="num">{faixa.n}</td>
                    <td className="num fin-table-money">{brlCents(faixa.totalCents)}</td>
                  </tr>
                ))}
                {!dados.vencido.faixas.length ? (
                  <tr>
                    <td colSpan={3}>Nada em atraso.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <p className="fin-card-hint">
            Contado por data de vencimento, não pelo carimbo do gateway — o Asaas demora para marcar como vencida, e
            uma cobrança vencida é vencida de qualquer forma.
          </p>
        </section>
      </div>

      <div className="fin-two-col">
        <section className="card">
          <h2 className="card-title">Receita por categoria</h2>
          <div className="table-wrap">
            <table className="fin-table">
              <thead>
                <tr>
                  <th>Categoria</th>
                  <th className="num">Cobranças</th>
                  <th className="num">Recebido</th>
                </tr>
              </thead>
              <tbody>
                {dados.categorias.map((categoria) => (
                  <tr key={categoria.code}>
                    <td>
                      <span className="fin-code">{categoria.code}</span> {categoria.name}
                    </td>
                    <td className="num">{categoria.n.toLocaleString("pt-BR")}</td>
                    <td className="num fin-table-money">{brlCents(categoria.totalCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <h2 className="card-title">Concentração de clientes</h2>
          <div className="table-wrap">
            <table className="fin-table">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th className="num">Recebido</th>
                  <th className="num">Peso</th>
                </tr>
              </thead>
              <tbody>
                {dados.concentracao.map((cliente) => (
                  <tr key={cliente.nome}>
                    <td>{cliente.nome}</td>
                    <td className="num fin-table-money">{brlCents(cliente.totalCents)}</td>
                    <td className="num">
                      <span
                        className="fin-share"
                        style={{
                          // Barra relativa ao maior, para o olho comparar sem
                          // precisar ler os números.
                          ["--share" as string]: `${
                            dados.concentracao[0] ? (cliente.totalCents / dados.concentracao[0].totalCents) * 100 : 0
                          }%`
                        }}
                      >
                        {pct(cliente.pct, 1)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="fin-card-hint">
            Recorrência contratada hoje: {brlCents(dados.recorrencia.mrrCents)}/mês em{" "}
            {dados.recorrencia.contratosAtivos} contratos. Todo mês a receita recomeça quase do zero.
          </p>
        </section>
      </div>
    </>
  );
}

import { brlCents, brlPrecise } from "@/lib/financeiro/format";
import type { ResumoModelo } from "@/lib/financeiro/modelo";

/**
 * O "DashBoard Fin" da planilha, com a correção que ele não tem.
 *
 * A aba original mostra FATURAMENTO R$ 1.246.106,85 e LUCRO LÍQUIDO
 * R$ 396.335,60 lado a lado. Os dois números estão certos isoladamente e a
 * conclusão que eles produzem juntos está errada: a receita foi atualizada até
 * julho e o custo parou em maio. O "lucro" é, quase inteiro, dois meses de
 * receita sem custo atrás.
 *
 * Este cartão mostra o mesmo resultado em DUAS janelas:
 *
 *   ano corrido      tudo que o ledger tem — o número grande
 *   janela fechada   só os meses em que receita E custo existem dos dois lados
 *
 * Quando as duas discordam muito, é sinal de que a leitura do número grande
 * está contaminada por meses incompletos. A tela diz isso em uma frase em vez
 * de deixar quem lê descobrir sozinho — que foi o que não aconteceu na planilha.
 */
const NOMES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function FinModeloResumo({ dados }: { dados: ResumoModelo }) {
  const soma = (v: number[], meses: number[]) =>
    meses.reduce((s, m) => s + (v[m - 1] ?? 0), 0);

  const todos = dados.mesesComDado;
  // Mês fechado é o que tem receita, tem custo, e cujo extrato chegou ao fim do
  // mês. Os três precisam valer: agosto tem os dois primeiros e para no dia 7 —
  // entra com a receita da primeira semana e sem a folha do dia 30.
  const fechados = todos.filter(
    (m) =>
      !dados.mesesParciais.includes(m) &&
      dados.totaisPorSecao.receita[m - 1] !== 0 &&
      (dados.totaisPorSecao.custo_fixo[m - 1] !== 0 || dados.totaisPorSecao.custo_operacao[m - 1] !== 0)
  );

  const receitaAno = soma(dados.totaisPorSecao.receita, todos);
  const receitaFechada = soma(dados.totaisPorSecao.receita, fechados);
  const ebitdaAno = soma(dados.ebitda, todos);
  const ebitdaFechado = soma(dados.ebitda, fechados);

  const custoAno =
    soma(dados.totaisPorSecao.custo_fixo, todos) +
    soma(dados.totaisPorSecao.custo_operacao, todos) +
    soma(dados.totaisPorSecao.deducao, todos);

  const margem = receitaFechada ? (100 * ebitdaFechado) / receitaFechada : 0;

  const mesesFaltando = todos.filter((m) => !fechados.includes(m));

  return (
    <section className="fin-modelo-resumo">
      <div className="fin-kpi-row">
        <article className="fin-kpi-card">
          <span className="fin-kpi-label">Receita — ano corrido</span>
          <strong className="fin-kpi-value">{brlCents(receitaAno)}</strong>
          <span className="fin-kpi-hint">
            {todos.length} {todos.length === 1 ? "mês" : "meses"} com movimento
          </span>
        </article>

        <article className="fin-kpi-card">
          <span className="fin-kpi-label">Custo total — ano corrido</span>
          <strong className="fin-kpi-value">{brlCents(Math.abs(custoAno))}</strong>
          <span className="fin-kpi-hint">operação, fixo, impostos e financeiro</span>
        </article>

        <article className="fin-kpi-card">
          <span className="fin-kpi-label">Resultado — ano corrido</span>
          <strong className="fin-kpi-value" data-negativo={ebitdaAno < 0 ? "sim" : undefined}>
            {brlCents(ebitdaAno)}
          </strong>
          <span className="fin-kpi-hint">receita menos tudo</span>
        </article>

        <article className="fin-kpi-card fin-kpi-destaque">
          <span className="fin-kpi-label">Resultado — meses fechados</span>
          <strong className="fin-kpi-value" data-negativo={ebitdaFechado < 0 ? "sim" : undefined}>
            {brlCents(ebitdaFechado)}
          </strong>
          <span className="fin-kpi-hint">
            margem {margem.toFixed(1)}% sobre {brlCents(receitaFechada)}
          </span>
        </article>
      </div>

      {mesesFaltando.length ? (
        <p className="fin-alert">
          {mesesFaltando.length}{" "}
          {mesesFaltando.length === 1 ? "mês não fechou" : "meses não fecharam"}
          {dados.mesesParciais.length
            ? ` (${dados.mesesParciais.map((m) => NOMES[m - 1]).join(", ")} ainda com extrato em aberto)`
            : " — há receita registrada sem custo correspondente"}
          . O resultado do ano corrido inclui {brlPrecise(soma(dados.ebitda, mesesFaltando))} vindo daí; para
          decidir, leia a janela fechada.
        </p>
      ) : null}

      {dados.cobertura.pct < 99.5 ? (
        <p className="fin-alert">
          {(100 - dados.cobertura.pct).toFixed(1)}% do dinheiro movimentado no ano —{" "}
          {brlPrecise(dados.cobertura.fora)} — ainda não tem categoria e por isso não entra em nenhuma linha desta
          tela. Enquanto isso não fechar, o EBITDA daqui é otimista por construção: a despesa existe no extrato e
          não no modelo.
        </p>
      ) : null}

      <div className="fin-modelo-linhas-resumo">
        <h3 className="card-title">Resultado por seção</h3>
        <table className="fin-tabela-simples">
          <tbody>
            {(
              [
                ["Receita", dados.totaisPorSecao.receita],
                ["Deduções, impostos e financeiro", dados.totaisPorSecao.deducao],
                ["Custos de operação", dados.totaisPorSecao.custo_operacao],
                ["Custos fixos", dados.totaisPorSecao.custo_fixo]
              ] as [string, number[]][]
            ).map(([rotulo, valores]) => {
              const total = soma(valores, todos);
              const pct = receitaAno ? (100 * total) / receitaAno : 0;
              return (
                <tr key={rotulo}>
                  <th scope="row">{rotulo}</th>
                  <td className="fin-nowrap">{brlPrecise(total)}</td>
                  <td className="fin-nowrap fin-desc-sub">{pct.toFixed(1)}%</td>
                </tr>
              );
            })}
            <tr className="fin-modelo-ebitda">
              <th scope="row">EBITDA</th>
              <td className="fin-nowrap">
                <strong>{brlPrecise(ebitdaAno)}</strong>
              </td>
              <td className="fin-nowrap fin-desc-sub">
                {receitaAno ? ((100 * ebitdaAno) / receitaAno).toFixed(1) : "0,0"}%
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

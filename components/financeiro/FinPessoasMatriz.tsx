"use client";

import { useMemo } from "react";

import type { Celula, CustoPessoas, Pessoa } from "@/lib/financeiro/pessoas";
import { brlCents, brlPrecise, monthKeyLabel, pct } from "@/lib/financeiro/format";

/**
 * A matriz pessoa × mês — a tela que responde "onde houve aumento".
 *
 * Três decisões que a fazem servir para isso, e não só para conferir totais:
 *
 * 1. A ORDEM É POR CUSTO, NUNCA ALFABÉTICA. A primeira linha é a pessoa mais
 *    cara. Numa matriz de 20 linhas por 8 colunas, a ordem é a única coisa que o
 *    olho lê antes de qualquer número.
 *
 * 2. O SALTO É MARCADO, NÃO DEIXADO PARA O LEITOR ACHAR. Célula cujo valor sobe
 *    mais de 15% contra o mês anterior ganha destaque. Sem isso, um reajuste de
 *    R$ 1.000 para R$ 3.203 (Cleber, jan→mar) fica indistinguível de um mês com
 *    duas parcelas — que é exatamente o tipo de aumento que passa despercebido
 *    por seis meses.
 *
 * 3. O MÊS PARCIAL É DECLARADO. O extrato do Inter vai até dia 4 e o do Nubank
 *    até dia 7. Sem a marca, todo início de mês a última coluna mostraria uma
 *    queda que é calendário, não decisão — e a folha desta empresa é paga entre
 *    os dias 1 e 3, o que torna o efeito ainda mais enganoso: às vezes a coluna
 *    parcial vem MAIOR que o mês fechado anterior.
 *
 * A matriz recebe as células JÁ FILTRADAS pela tela de cima. Refazer o filtro
 * aqui criaria uma segunda definição do recorte, e o total do rodapé desta
 * tabela passaria a discordar do KPI de duas seções acima.
 */
export function FinPessoasMatriz({
  dados,
  celulas,
  meses,
  pessoaPorId,
  mesAtual
}: {
  dados: CustoPessoas;
  celulas: Celula[];
  meses: string[];
  pessoaPorId: Map<number, Pessoa>;
  mesAtual: string;
}) {
  const linhas = useMemo(() => {
    const mapa = new Map<number, { pessoa: Pessoa; porMes: Record<string, number>; totalCents: number }>();
    for (const celula of celulas) {
      const pessoa = pessoaPorId.get(celula.personId);
      if (!pessoa) continue;
      const atual = mapa.get(celula.personId) ?? { pessoa, porMes: {}, totalCents: 0 };
      atual.porMes[celula.mes] = (atual.porMes[celula.mes] ?? 0) + celula.cents;
      atual.totalCents += celula.cents;
      mapa.set(celula.personId, atual);
    }
    return [...mapa.values()].sort((a, b) => b.totalCents - a.totalCents);
  }, [celulas, pessoaPorId]);

  const totalPorMes = useMemo(() => {
    const mapa: Record<string, number> = {};
    for (const mes of meses) mapa[mes] = linhas.reduce((s, l) => s + (l.porMes[mes] ?? 0), 0);
    return mapa;
  }, [linhas, meses]);

  const totalGeral = linhas.reduce((s, l) => s + l.totalCents, 0);

  // Os dois meses fechados nas pontas do recorte: é a leitura de "quanto a folha
  // cresceu", e ela precisa ignorar o mês corrente para não medir calendário.
  const mesesFechados = meses.filter((mes) => mes !== mesAtual && totalPorMes[mes] > 0);
  const primeiroFechado = mesesFechados[0] ?? null;
  const ultimoFechado = mesesFechados[mesesFechados.length - 1] ?? null;
  const crescimentoPct =
    primeiroFechado && ultimoFechado && primeiroFechado !== ultimoFechado && totalPorMes[primeiroFechado]
      ? ((totalPorMes[ultimoFechado] - totalPorMes[primeiroFechado]) / totalPorMes[primeiroFechado]) * 100
      : null;

  // Quem mais subiu entre as duas pontas fechadas. Derivado do dado, nunca
  // escrito à mão: um nome fixo no título vira mentira no mês seguinte.
  const maiorAlta = useMemo(() => {
    if (!primeiroFechado || !ultimoFechado || primeiroFechado === ultimoFechado) return null;
    const candidatos = linhas
      .map((linha) => ({
        nome: linha.pessoa.nome,
        de: linha.porMes[primeiroFechado] ?? 0,
        para: linha.porMes[ultimoFechado] ?? 0
      }))
      .filter((c) => c.de > 0)
      .map((c) => ({ ...c, delta: c.para - c.de, pctVar: ((c.para - c.de) / c.de) * 100 }))
      .sort((a, b) => b.delta - a.delta);
    return candidatos[0] ?? null;
  }, [linhas, primeiroFechado, ultimoFechado]);

  return (
    <section className="card fin-painel-grafico" aria-label="Custo por pessoa, mês a mês">
      <header className="fin-painel-grafico-head">
        <h3>
          {crescimentoPct === null
            ? "Custo por pessoa, mês a mês"
            : `A folha ${crescimentoPct >= 0 ? "subiu" : "caiu"} ${pct(Math.abs(crescimentoPct), 0)} de ${monthKeyLabel(primeiroFechado!)} a ${monthKeyLabel(ultimoFechado!)}${maiorAlta && maiorAlta.delta > 0 ? `, e ${maiorAlta.nome} responde pela maior alta individual` : ""}`}
        </h3>
        <p>
          {primeiroFechado && ultimoFechado
            ? `${brlCents(totalPorMes[primeiroFechado])} em ${monthKeyLabel(primeiroFechado)} contra ${brlCents(totalPorMes[ultimoFechado])} em ${monthKeyLabel(ultimoFechado)}, considerando só meses fechados. `
            : ""}
          {maiorAlta && maiorAlta.delta > 0
            ? `${maiorAlta.nome} passou de ${brlCents(maiorAlta.de)} para ${brlCents(maiorAlta.para)} (${maiorAlta.pctVar >= 0 ? "+" : "−"}${pct(Math.abs(maiorAlta.pctVar), 0)}). `
            : ""}
          Célula destacada é alta de mais de 15% contra o mês anterior — o sinal de reajuste, de comissão nova ou de
          mês com duas parcelas. Qual das três é decisão de quem lê; a tela só garante que o salto não passe
          despercebido.
        </p>
      </header>

      <div className="fin-matrix-wrap">
        <table className="fin-table fin-matrix">
          <thead>
            <tr>
              <th className="fin-matrix-head">Pessoa</th>
              {meses.map((mes) => (
                <th key={mes} className="num">
                  {monthKeyLabel(mes)}
                  {mes === mesAtual ? <span className="fin-tag">parcial</span> : null}
                </th>
              ))}
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((linha) => (
              <tr key={linha.pessoa.id}>
                <th className="fin-matrix-head" scope="row">
                  {linha.pessoa.nome}
                  <span className="fin-desc-sub">
                    {linha.pessoa.vinculoRotulo} · {linha.pessoa.timeRotulo}
                  </span>
                </th>
                {meses.map((mes, indice) => {
                  const valor = linha.porMes[mes] ?? 0;
                  const anterior = indice > 0 ? linha.porMes[meses[indice - 1]] ?? 0 : 0;
                  const salto = anterior > 0 && valor > anterior * 1.15;
                  return (
                    <td key={mes} className="num fin-table-money">
                      {valor ? (
                        <span
                          className={salto ? "fin-badge-atencao" : undefined}
                          title={
                            salto
                              ? `Alta de ${pct(((valor - anterior) / anterior) * 100, 0)} contra ${monthKeyLabel(meses[indice - 1])}`
                              : undefined
                          }
                        >
                          {brlPrecise(valor)}
                        </span>
                      ) : (
                        <span className="fin-zero">—</span>
                      )}
                    </td>
                  );
                })}
                <td className="num fin-table-money">
                  <strong>{brlPrecise(linha.totalCents)}</strong>
                </td>
              </tr>
            ))}
            {!linhas.length ? (
              <tr>
                <td colSpan={meses.length + 2} className="fin-empty-row">
                  Nenhuma pessoa com lançamento neste recorte.
                </td>
              </tr>
            ) : null}
          </tbody>
          <tfoot>
            <tr>
              <th className="fin-matrix-head">Total do mês</th>
              {meses.map((mes) => (
                <td key={mes} className="num fin-table-money">
                  {totalPorMes[mes] ? <strong>{brlPrecise(totalPorMes[mes])}</strong> : <span className="fin-zero">—</span>}
                </td>
              ))}
              <td className="num fin-table-money">
                <strong>{brlPrecise(totalGeral)}</strong>
              </td>
            </tr>
            <tr>
              <th className="fin-matrix-head">Sem favorecido no mês</th>
              {meses.map((mes) => {
                const buraco = dados.cobertura.buracos
                  .filter((b) => b.mes === mes)
                  .reduce((s, b) => s + b.semContraparteCents, 0);
                return (
                  <td key={mes} className="num fin-table-money">
                    {buraco ? (
                      <span className="fin-out" title="Saídas de conta corrente sem favorecido: não somam para ninguém">
                        {brlPrecise(buraco)}
                      </span>
                    ) : (
                      <span className="fin-zero">—</span>
                    )}
                  </td>
                );
              })}
              <td className="num fin-table-money fin-out">
                {brlPrecise(
                  dados.cobertura.buracos
                    .filter((b) => meses.includes(b.mes))
                    .reduce((s, b) => s + b.semContraparteCents, 0)
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="fin-card-hint">
        A última linha não é custo de gente: é o que saiu das contas correntes sem favorecido nenhum, no mesmo mês. Ela
        fica aqui porque um mês em que o total cai e essa linha sobe quase sempre é o mesmo dinheiro trocando de lugar —
        não uma folha menor.
      </p>
    </section>
  );
}

import Link from "next/link";

import type { Dre } from "@/lib/financeiro/dre";
import { brlCents, brlCompact, monthKeyLabel, pct } from "@/lib/financeiro/format";

/**
 * DRE por competência, compacta por padrão.
 *
 * O corpo da DRE são doze linhas — é assim que ela cabe na cabeça de alguém. O
 * detalhe por categoria vive dentro de `<details>` nativo, pelo mesmo motivo do
 * `Collapsible` da plataforma: funciona sem JavaScript, já vem com teclado e
 * leitor de tela resolvidos, imprime aberto se o navegador quiser, e o conteúdo
 * continua no HTML do servidor.
 *
 * Por que NÃO é `<table>`: `<details>` não pode ser `<tr>`, e `display: contents`
 * para forçar a caber numa grade quebra o widget de abrir/fechar em parte dos
 * navegadores. As colunas se alinham por largura fixa em flex, que dá o mesmo
 * resultado visual sem apostar em comportamento indefinido.
 */

const AVISO_TETO =
  "Este DRE tem receita real e despesa quase zero — o Asaas não registra saídas. " +
  "Lucro e margem aqui são teto, não resultado.";

function linkPara(periodo: string, nucleo: string | null) {
  const params = new URLSearchParams();
  // "12m" é o padrão: mantê-lo fora da URL faz o link limpo ser o estado normal.
  if (periodo && periodo !== "12m") params.set("periodo", periodo);
  if (nucleo) params.set("nucleo", nucleo);
  const query = params.toString();
  return query ? `/financeiro/indicadores?${query}` : "/financeiro/indicadores";
}

export function FinDre({ dados }: { dados: Dre }) {
  if (!dados.disponivel) {
    return (
      <section className="card fin-empty">
        <h2 className="card-title">DRE indisponível</h2>
        <p>
          Sem conexão com o banco do financeiro. O restante da plataforma segue funcionando — só esta tela depende do
          PostgreSQL em tempo de request.
        </p>
      </section>
    );
  }

  const { cobertura, tributos, periodo, escopos } = dados;
  const tetoTitle = cobertura.semDespesa ? AVISO_TETO : undefined;
  // Largura mínima da grade: rótulo + uma célula por escopo + a coluna de % da
  // receita. Vive em variável CSS para o componente não fixar pixel nenhum.
  const estilo = { ["--fin-dre-cols" as string]: String(escopos.length + 1) };

  return (
    <>
      {cobertura.semDespesa ? (
        <div className="fin-alert fin-alert-forte" role="status">
          <strong>{AVISO_TETO}</strong>
          <span>
            No período, a despesa registrada é {pct(cobertura.razaoPct, 1)} da receita — nenhuma empresa de serviço
            opera assim. {cobertura.contasSemExtrato.length ? (
              <>
                Faltam extratos de {cobertura.contasSemExtrato.join(", ")}: {cobertura.contasComExtrato} de{" "}
                {cobertura.contasTotal} contas têm movimento importado.
              </>
            ) : null}{" "}
            Toda margem desta página está marcada com esse aviso.
          </span>
        </div>
      ) : null}

      <section className="card">
        <div className="fin-dre-controles">
          <div className="fin-filter-group" role="group" aria-label="Período">
            <span className="fin-filter-label">Período</span>
            {dados.opcoesPeriodo.map((opcao) => (
              <Link
                key={opcao.chave}
                href={linkPara(opcao.chave, dados.nucleoFoco)}
                className={opcao.chave === periodo.chave ? "fin-chip ativo" : "fin-chip"}
              >
                {opcao.rotulo}
              </Link>
            ))}
          </div>
          <div className="fin-filter-group" role="group" aria-label="Núcleo">
            <span className="fin-filter-label">Núcleo</span>
            <Link
              href={linkPara(periodo.chave, null)}
              className={dados.nucleoFoco ? "fin-chip" : "fin-chip ativo"}
            >
              Todos lado a lado
            </Link>
            {/* A lista vem de `nucleosDisponiveis`, não de `escopos`: com um
                núcleo em foco a tabela só tem duas colunas, e usar `escopos`
                aqui apagaria os outros núcleos do seletor — sem caminho de
                volta a não ser o botão do navegador. */}
            {dados.nucleosDisponiveis.map((escopo) => (
              <Link
                key={escopo.slug}
                href={linkPara(periodo.chave, escopo.slug)}
                className={dados.nucleoFoco === escopo.slug ? "fin-chip ativo" : "fin-chip"}
              >
                {escopo.nome}
              </Link>
            ))}
          </div>
        </div>

        <h2 className="card-title">DRE por competência — {periodo.rotulo}</h2>
        <p className="fin-card-hint">
          De {periodo.de.split("-").reverse().join("/")} a {periodo.ate.split("-").reverse().join("/")}, por data de
          competência (quando foi ganho), não por data de pagamento. Por isso o total aqui difere do da tela de
          Receitas, que soma por caixa. Clique numa linha para abrir as categorias.
          {periodo.ate > dados.hoje ? (
            <>
              {" "}
              <b>O período ainda está correndo</b> — a comparação com o anterior é contra uma janela já fechada, e
              tende a parecer queda até o fim do mês.
            </>
          ) : null}
        </p>

        <div className="fin-dre-wrap">
          <div className="fin-dre" style={estilo}>
            <div className="fin-dre-row fin-dre-head">
              <span className="fin-dre-label">Linha</span>
              {escopos.map((escopo) => (
                <span key={escopo.slug} className="fin-dre-cell">
                  {escopo.nome}
                </span>
              ))}
              <span className="fin-dre-cell" title="Percentual sobre a receita bruta global do período">
                % rec. bruta
              </span>
            </div>

            {dados.itens.map((item) =>
              item.tipo === "grupo" ? (
                <details key={item.grupo.linha} className="fin-dre-grupo">
                  <summary className="fin-dre-row">
                    <span className="fin-dre-label">
                      <span className="collapsible-caret" aria-hidden="true" />
                      <span className="fin-dre-nome">
                        <strong>{item.grupo.rotulo}</strong>
                        <em>
                          {item.grupo.hint}
                          {item.grupo.categorias.length
                            ? ` · ${item.grupo.categorias.length} categoria${item.grupo.categorias.length > 1 ? "s" : ""} · ${item.grupo.n.toLocaleString("pt-BR")} documentos`
                            : " · sem movimento no período"}
                        </em>
                      </span>
                    </span>
                    {escopos.map((escopo) => (
                      <span
                        key={escopo.slug}
                        className={valorClasse(item.grupo.porEscopo[escopo.slug] ?? 0)}
                      >
                        {(item.grupo.porEscopo[escopo.slug] ?? 0) === 0 ? (
                          <span className="fin-zero">—</span>
                        ) : (
                          brlCents(item.grupo.porEscopo[escopo.slug])
                        )}
                      </span>
                    ))}
                    <span className="fin-dre-cell">{pct(item.grupo.pctDaReceita, 1)}</span>
                  </summary>

                  <div className="fin-dre-body">
                    {item.grupo.categorias.length ? (
                      item.grupo.categorias.map((categoria) => (
                        <div key={categoria.code ?? categoria.nome} className="fin-dre-row fin-dre-item">
                          <span className="fin-dre-label">
                            <span className="fin-dre-nome">
                              <span>
                                {categoria.code ? <span className="fin-code">{categoria.code}</span> : null}
                                {categoria.nome}
                              </span>
                              <em>
                                {pct(categoria.pctDoGrupo, 1)} do grupo · {pct(categoria.pctDaReceita, 1)} da receita ·{" "}
                                {categoria.n.toLocaleString("pt-BR")} documento{categoria.n === 1 ? "" : "s"}
                              </em>
                            </span>
                          </span>
                          {escopos.map((escopo) => (
                            <span key={escopo.slug} className={valorClasse(categoria.porEscopo[escopo.slug] ?? 0)}>
                              {(categoria.porEscopo[escopo.slug] ?? 0) === 0 ? (
                                <span className="fin-zero">—</span>
                              ) : (
                                brlCents(categoria.porEscopo[escopo.slug])
                              )}
                            </span>
                          ))}
                          <span className="fin-dre-cell">{pct(categoria.pctDaReceita, 1)}</span>
                        </div>
                      ))
                    ) : (
                      <p className="fin-dre-vazio">
                        Nenhum lançamento nesta linha no período. Enquanto só o Asaas estiver importado, as linhas de
                        despesa ficam assim.
                      </p>
                    )}
                  </div>
                </details>
              ) : (
                <div
                  key={item.subtotal.chave}
                  className="fin-dre-row fin-dre-subtotal"
                  title={item.subtotal.margem ? tetoTitle : undefined}
                >
                  <span className="fin-dre-label">
                    <span className="fin-dre-nome">
                      <strong>{item.subtotal.rotulo}</strong>
                      {item.subtotal.margem ? (
                        <em>
                          margem {pct(item.subtotal.margemPct, 1)}
                          {cobertura.semDespesa ? " — teto, não resultado" : ""}
                        </em>
                      ) : null}
                    </span>
                  </span>
                  {escopos.map((escopo) => (
                    <span key={escopo.slug} className={valorClasse(item.subtotal.porEscopo[escopo.slug] ?? 0)}>
                      <strong>{brlCents(item.subtotal.porEscopo[escopo.slug] ?? 0)}</strong>
                    </span>
                  ))}
                  <span className="fin-dre-cell" title={item.subtotal.margem ? tetoTitle : undefined}>
                    <strong>{pct(item.subtotal.margemPct, 1)}</strong>
                  </span>
                </div>
              )
            )}
          </div>
        </div>

        {dados.foraDaDre.length ? (
          <div className="fin-dre-fora">
            <strong>Fora da DRE, de propósito</strong>
            <ul>
              {dados.foraDaDre.map((linha) => (
                <li key={linha.rotulo}>
                  <span>{linha.rotulo}</span>
                  <em>{linha.porque}</em>
                  <span className="fin-table-money">{brlCents(linha.totalCents)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className="fin-card-hint">
          Linha com sinal contrário ao esperado — dedução positiva, por exemplo — é estorno entrando no caixa. Está
          assim porque é isso que o extrato diz; abra a linha para ver os lançamentos.
        </p>
      </section>

      <section className="card">
        <h2 className="card-title">Simples Nacional — estimativa do DAS</h2>
        <div className="fin-dre-premissa" role="note">
          <strong>Este número é premissa, não apuração.</strong>
          <p>
            Alíquota efetiva estimada de <b>{pct(tributos.aliquotaEfetivaPct, 2)}</b> sobre um RBT12 de{" "}
            <b>{brlCents(tributos.rbt12Cents)}</b> — {tributos.anexo}, {tributos.faixaRotulo} (
            {pct(tributos.aliquotaNominalPct, 2)} nominal menos parcela a deduzir de {brlCents(tributos.deducaoCents)}).
          </p>
          <p>
            A premissa que mais pesa: <b>{tributos.anexo}</b> {tributos.premissaAnexo}. Se a empresa estiver no Anexo V,
            a alíquota da mesma faixa sobe cerca de cinco pontos e esta estimativa erra por dezenas de milhares de reais
            no ano. Para ajustar, edite <code>ANEXO_SIMPLES</code> em <code>lib/financeiro/dre.ts</code>.
          </p>
        </div>

        <div className="table-wrap">
          <table className="fin-table">
            <tbody>
              <tr>
                <td>RBT12 — receita bruta dos últimos 12 meses</td>
                <td className="num fin-table-money">{brlCents(tributos.rbt12Cents)}</td>
              </tr>
              <tr>
                <td>Receita bruta do período selecionado</td>
                <td className="num fin-table-money">{brlCents(tributos.receitaPeriodoCents)}</td>
              </tr>
              <tr>
                <td>
                  DAS estimado no período <span className="fin-tag">premissa</span>
                </td>
                <td className="num fin-table-money">{brlCents(tributos.dasEstimadoCents)}</td>
              </tr>
              <tr>
                <td>
                  ISS destacado nas NFS-e autorizadas <span className="fin-tag">real</span>
                  <span className="fin-desc-sub">
                    {tributos.nNotas.toLocaleString("pt-BR")} notas no período. Não soma ao DAS: no Simples o ISS já
                    está dentro da guia — contar os dois inflaria a carga em vários pontos.
                  </span>
                </td>
                <td className="num fin-table-money">{brlCents(tributos.issDestacadoCents)}</td>
              </tr>
              <tr>
                <td>
                  ISS retido na fonte <span className="fin-tag">real</span>
                  <span className="fin-desc-sub">
                    Este sim é dinheiro a mais: retido pelo tomador, por fora da guia.
                  </span>
                </td>
                <td className="num fin-table-money">{brlCents(tributos.issRetidoCents)}</td>
              </tr>
              <tr>
                <td>
                  <strong>Carga tributária efetiva</strong>
                  <span className="fin-desc-sub">(DAS estimado + ISS retido) ÷ receita bruta do período</span>
                </td>
                <td className="num fin-table-money">
                  <strong>{pct(tributos.cargaEfetivaPct, 2)}</strong>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">Evolução mensal, linha a linha</h2>
        <p className="fin-card-hint">
          Últimos 12 meses por competência, independentemente do período selecionado acima
          {dados.nucleoFoco ? ` · somente o núcleo ${dados.nucleoFoco}` : ""}. A primeira coluna fica fixa — role na
          horizontal.
        </p>
        <div className="table-wrap fin-matrix-wrap">
          <table className="fin-table fin-matrix">
            <thead>
              <tr>
                <th className="fin-matrix-head">Linha</th>
                {dados.evolucao.meses.map((mes) => (
                  <th key={mes} className="num">
                    {monthKeyLabel(mes)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dados.evolucao.linhas.map((linha) => (
                <tr key={linha.linha} className={linha.linha === "resultado_liquido" ? "fin-dre-evolucao-total" : undefined}>
                  <th scope="row" className="fin-matrix-head">
                    {linha.rotulo}
                  </th>
                  {dados.evolucao.meses.map((mes) => {
                    const valor = linha.porMes[mes] ?? 0;
                    return (
                      <td
                        key={mes}
                        className={`num fin-table-money${valor < 0 ? " fin-out" : ""}`}
                        title={linha.linha === "resultado_liquido" ? tetoTitle : undefined}
                      >
                        {valor ? brlCompact(valor) : <span className="fin-zero">—</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

/** Vermelho só quando sai dinheiro. Zero não é saída nem entrada. */
function valorClasse(valor: number) {
  return valor < 0 ? "fin-dre-cell fin-table-money fin-out" : "fin-dre-cell fin-table-money";
}

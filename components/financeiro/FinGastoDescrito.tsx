import { brl } from "@/components/financeiro/Certeza";
import { FORMA_ROTULO, type Fatia, type PainelDescrito } from "@/lib/financeiro/gasto-descrito";

/**
 * O painel do gasto descrito.
 *
 * ---------------------------------------------------------------------------
 * AS LACUNAS VÊM PRIMEIRO, ANTES DOS TOTAIS BONITOS
 * ---------------------------------------------------------------------------
 * A tentação de um painel é abrir com o número grande. Aqui o número grande é o
 * menos acionável: "gastamos R$ 42 mil" não muda o que ninguém faz amanhã.
 *
 * O que muda é "R$ 42 mil sem categoria" — porque isso é trabalho pendente com
 * nome e tamanho. Por isso as lacunas ficam na primeira linha, com a mesma
 * tipografia do total: elas são o estado real da base, não uma nota de rodapé.
 *
 * ---------------------------------------------------------------------------
 * BARRA, E NÃO PIZZA
 * ---------------------------------------------------------------------------
 * Os cortes são listas ordenadas por valor, com barra proporcional. Pizza é
 * pior para comparar fatias parecidas e péssima quando há mais de cinco — e
 * aqui há catorze categorias e doze pessoas. A barra também deixa o rótulo
 * legível sem legenda.
 */

function Barra({ fatias, teto, vazio }: { fatias: Fatia[]; teto: number; vazio: string }) {
  if (!fatias.length) return <p className="gd-vazio">{vazio}</p>;
  return (
    <ul className="gd-barras">
      {fatias.map((f) => (
        <li key={f.chave}>
          <span className="gd-rotulo" title={f.rotulo}>
            {f.rotulo}
          </span>
          <span className="gd-trilho">
            <i
              style={{
                width: `${teto > 0 ? Math.max(1.5, (f.cents / teto) * 100) : 0}%`,
                background: f.cor ?? "var(--purple)"
              }}
            />
          </span>
          <span className="gd-valor">{brl(f.cents)}</span>
          <span className="gd-n">{f.n}×</span>
        </li>
      ))}
    </ul>
  );
}

/** O histórico como colunas. Sem eixo Y: o valor de cada mês está no rótulo. */
function Historico({ meses }: { meses: Fatia[] }) {
  if (!meses.length) return <p className="gd-vazio">Ainda não há histórico.</p>;
  const teto = Math.max(...meses.map((m) => m.cents), 1);
  return (
    <div
      className="gd-historico"
      role="img"
      aria-label={`Gasto descrito por mês: ${meses.map((m) => `${m.rotulo} ${brl(m.cents)}`).join("; ")}`}
    >
      {meses.map((m) => (
        <div key={m.chave} className="gd-mes">
          <span className="gd-mes-valor">{brl(m.cents)}</span>
          <span className="gd-coluna" style={{ height: `${Math.max(4, (m.cents / teto) * 100)}%` }} />
          <span className="gd-mes-rotulo">{m.rotulo}</span>
          <span className="gd-mes-n">{m.n}</span>
        </div>
      ))}
    </div>
  );
}

export function FinGastoDescrito({
  painel,
  titulo,
  explicacao
}: {
  painel: PainelDescrito;
  titulo: string;
  explicacao: string;
}) {
  if (!painel.disponivel) return null;

  if (painel.quantidade === 0) {
    return (
      <section className="fin-card">
        <div className="fin-card-head">
          <h2>{titulo}</h2>
        </div>
        <p className="fin-card-hint">Nada foi descrito ainda por este caminho.</p>
      </section>
    );
  }

  const tetoForma = Math.max(...painel.porForma.map((f) => f.cents), 1);
  const tetoArea = Math.max(...painel.porArea.map((f) => f.cents), 1);
  const tetoCat = Math.max(...painel.porCategoria.map((f) => f.cents), 1);
  const tetoPessoa = Math.max(...painel.porPessoa.map((f) => f.cents), 1);
  /*
   * NUNCA 100% QUANDO NÃO É 100%.
   *
   * Medido: R$ 42.320,34 sem categoria de R$ 42.514,17 é 99,5%, e
   * `Math.round` mostrava "100% do total" — com UM lançamento classificado ali
   * do lado, na mesma tela. Uma lacuna descrita como total quando não é total
   * é o tipo de exagero que faz alguém parar de acreditar no resto dos números.
   *
   * Vale para os dois extremos: 0,4% não pode virar "0%" enquanto houver
   * alguma coisa lá.
   */
  const pct = (c: number) => {
    if (painel.totalCents <= 0 || c <= 0) return 0;
    if (c >= painel.totalCents) return 100;
    return Math.min(99, Math.max(1, Math.round((c / painel.totalCents) * 100)));
  };

  return (
    <section className="fin-card">
      <div className="fin-card-head">
        <h2>{titulo}</h2>
        <span className="fin-card-total">{brl(painel.totalCents)}</span>
      </div>
      <p className="fin-card-hint">{explicacao}</p>

      {/* As lacunas primeiro: é o que dá trabalho a alguém amanhã. */}
      <div className="gd-numeros">
        <div className="gd-num">
          <b>{brl(painel.totalCents)}</b>
          <span>
            em {painel.quantidade} {painel.quantidade === 1 ? "lançamento" : "lançamentos"}
          </span>
        </div>
        <div className={painel.semCategoriaCents > 0 ? "gd-num alerta" : "gd-num"}>
          <b>{brl(painel.semCategoriaCents)}</b>
          <span>sem categoria — {pct(painel.semCategoriaCents)}% do total</span>
        </div>
        <div className={painel.semAreaCents > 0 ? "gd-num aviso" : "gd-num"}>
          <b>{brl(painel.semAreaCents)}</b>
          <span>sem área — {pct(painel.semAreaCents)}% do total</span>
        </div>
        <div className={painel.semComprovante > 0 ? "gd-num aviso" : "gd-num"}>
          <b>{painel.semComprovante}</b>
          <span>
            {painel.semComprovante === 1 ? "lançamento" : "lançamentos"} sem comprovante anexado
          </span>
        </div>
      </div>

      <div className="gd-bloco">
        <h3>Histórico</h3>
        <Historico meses={painel.porMes} />
      </div>

      <div className="gd-cortes">
        <div className="gd-bloco">
          <h3>Por onde o dinheiro saiu</h3>
          <Barra fatias={painel.porForma} teto={tetoForma} vazio="Sem forma declarada." />
        </div>
        <div className="gd-bloco">
          <h3>Para qual área</h3>
          <Barra fatias={painel.porArea} teto={tetoArea} vazio="Nenhuma área apontada." />
        </div>
        <div className="gd-bloco">
          <h3>Em quê — tipo e categoria</h3>
          <Barra fatias={painel.porCategoria} teto={tetoCat} vazio="Nada classificado." />
        </div>
        <div className="gd-bloco">
          <h3>Quem gastou</h3>
          <Barra fatias={painel.porPessoa} teto={tetoPessoa} vazio="Sem pessoas." />
        </div>
      </div>

      <div className="gd-bloco">
        <h3>
          Lançamento a lançamento
          {painel.linhas.length < painel.quantidade ? (
            <em> — os {painel.linhas.length} mais recentes de {painel.quantidade}</em>
          ) : null}
        </h3>
        <div className="gd-tabela-caixa">
          <table className="gd-tabela">
            <thead>
              <tr>
                <th scope="col">Quando</th>
                <th scope="col">O que foi</th>
                <th scope="col">Por onde</th>
                <th scope="col">Quem</th>
                <th scope="col" className="num">
                  Valor
                </th>
              </tr>
            </thead>
            <tbody>
              {painel.linhas.map((l) => (
                <tr key={`${l.origem}-${l.code}`}>
                  <td className="num">
                    {/* Data quando existe; senão o mês, que é o que o dado
                        garante. Os 193 reembolsos importados de planilha têm
                        mês de competência e nenhum dia. */}
                    {l.data ? l.data.split("-").reverse().join("/") : `${l.mes.slice(5)}/${l.mes.slice(2, 4)}`}
                    {!l.data ? <span className="gd-meta">mês</span> : null}
                  </td>
                  <td>
                    <span className="gd-titulo">{l.titulo}</span>
                    <span className="gd-meta">
                      {l.categoria ?? (l.tipoReembolso ? `tipo: ${l.tipoReembolso}` : "sem categoria")}
                      {l.centro ? ` · ${l.centro}` : ""}
                      {l.parcelas ? ` · ${l.parcelas}×` : ""}
                      {l.anexos ? "" : " · sem comprovante"}
                    </span>
                  </td>
                  <td>
                    <span className="gd-forma">{FORMA_ROTULO[l.forma] ?? l.forma}</span>
                    {l.banco || l.final ? (
                      <span className="gd-meta">{[l.banco, l.final ? `final ${l.final}` : null].filter(Boolean).join(" · ")}</span>
                    ) : null}
                  </td>
                  <td>{l.pessoa}</td>
                  <td className="num">{brl(l.valorCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

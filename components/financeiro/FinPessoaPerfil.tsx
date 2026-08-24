import { brl } from "@/components/financeiro/Certeza";
import {
  FinComissaoForm,
  FinSalarioBaseForm,
  TabelaComissao,
  TabelaSalarioBase
} from "@/components/financeiro/FinRemuneracaoForms";
import type { PerfilPessoa } from "@/lib/financeiro/pessoa-perfil";

/**
 * O perfil financeiro de uma pessoa.
 *
 * ---------------------------------------------------------------------------
 * A CONTA VEM PRIMEIRO, E A FALTA DELA É UM ALERTA
 * ---------------------------------------------------------------------------
 * A tela existe para dois usos: entender o que uma pessoa custa, e PAGAR essa
 * pessoa. O segundo é o que tem prazo. Por isso o bloco "para onde vai o
 * dinheiro" abre a página, e quem não tem conta cadastrada aparece com aviso
 * em vez de um espaço em branco — não dá para programar um lote com destino
 * faltando.
 *
 * E a chave que ninguém do financeiro conferiu aparece marcada. Chave errada
 * não dá erro: paga outra pessoa.
 */

const NATUREZA_ROTULO: Record<string, string> = {
  salario: "Salário",
  prolabore: "Pró-labore",
  estagio: "Estágio",
  comissao: "Comissão",
  reembolso: "Reembolso",
  encargo_beneficio: "Encargos e benefícios",
  extra: "Extra"
};

const NATUREZA_COR: Record<string, string> = {
  salario: "var(--purple)",
  prolabore: "#1e5fd4",
  estagio: "#12805c",
  comissao: "var(--ink-amber)",
  reembolso: "#d6449b",
  encargo_beneficio: "var(--muted)",
  extra: "var(--cert-atrasado)"
};

const PIX_ROTULO: Record<string, string> = {
  cpf: "CPF",
  cnpj: "CNPJ",
  email: "E-mail",
  telefone: "Telefone",
  aleatoria: "Chave aleatória"
};

function mesCurto(m: string) {
  const [ano, mes] = m.split("-");
  return `${mes}/${ano.slice(2)}`;
}

export function FinPessoaPerfil({ perfil }: { perfil: PerfilPessoa }) {
  const tetoMes = Math.max(...perfil.porMes.map((m) => m.cents), 1);
  const tetoNat = Math.max(...perfil.porNatureza.map((n) => n.cents), 1);
  const c = perfil.conta;

  return (
    <>
      {/* 1. Para onde vai o dinheiro — o que tem prazo. */}
      <section className="fin-card">
        <div className="fin-card-head">
          <h2>Para onde vai o dinheiro</h2>
          {c ? (
            <span className={c.conferidoEm ? "pp-selo ok" : "pp-selo aviso"}>
              {c.conferidoEm ? "conferido pelo financeiro" : "não conferido"}
            </span>
          ) : null}
        </div>

        {!c ? (
          <p className="pp-vazio-alerta">
            <strong>Nenhuma conta cadastrada.</strong> Sem isso esta pessoa não entra num lote de pagamento de
            reembolso — o destino teria que vir de conversa, que é exatamente o que o cadastro existe para eliminar.
            Ela mesma preenche pelo aplicativo, em Meu perfil.
          </p>
        ) : (
          <>
            <dl className="pp-conta">
              <div>
                <dt>Como recebe</dt>
                <dd>{c.metodo === "pix" ? "PIX" : "TED"}</dd>
              </div>
              {c.metodo === "pix" ? (
                <>
                  <div>
                    <dt>Tipo da chave</dt>
                    <dd>{PIX_ROTULO[c.pixTipo ?? ""] ?? c.pixTipo}</dd>
                  </div>
                  <div className="pp-conta-larga">
                    <dt>Chave</dt>
                    <dd className="pp-chave">{c.pixChave}</dd>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <dt>Banco</dt>
                    <dd>{c.bancoNome}</dd>
                  </div>
                  <div>
                    <dt>Agência</dt>
                    <dd>{c.agencia}</dd>
                  </div>
                  <div>
                    <dt>Conta</dt>
                    <dd>{c.conta}</dd>
                  </div>
                </>
              )}
              <div className="pp-conta-larga">
                <dt>Titular</dt>
                <dd>
                  {c.titularEhAPessoa ? (
                    `${perfil.nome} (a própria pessoa)`
                  ) : (
                    <>
                      {c.titularNome} · {c.titularDocumento}
                      {/* O time é MEI: receber no CNPJ é o caso comum, e o
                          comprovante vai mostrar um nome de empresa. Dizer
                          isso aqui evita que alguém trate como erro. */}
                      <span className="pp-nota"> — não é a pessoa; confira o nome no comprovante</span>
                    </>
                  )}
                </dd>
              </div>
              <div>
                <dt>Serve para</dt>
                <dd>
                  {[c.recebeSalario ? "salário" : null, c.recebeReembolso ? "reembolso" : null]
                    .filter(Boolean)
                    .join(" e ") || "nada marcado"}
                </dd>
              </div>
              {c.observacao ? (
                <div className="pp-conta-larga">
                  <dt>Observação</dt>
                  <dd>{c.observacao}</dd>
                </div>
              ) : null}
            </dl>
            {!c.conferidoEm ? (
              <p className="pp-aviso">
                Esta chave foi digitada pela própria pessoa e ninguém do financeiro conferiu ainda. Chave errada não dá
                erro — paga outra pessoa. Confira antes de incluir num lote automático.
              </p>
            ) : null}
          </>
        )}
      </section>

      {/* 2. Definir e ajustar — o que era só relatório vira registro. */}
      <section className="fin-card">
        <div className="fin-card-head">
          <h2>Salário e comissão</h2>
        </div>
        <p className="pp-remuneracao-intro">
          O que está aqui vale para o mês seguinte e é a MESMA conta que a pessoa vê no próprio app, em Meu Perfil —
          nunca um número em paralelo.
        </p>
        <FinSalarioBaseForm personId={perfil.id} atual={perfil.salarioBaseAtual} />
        <TabelaSalarioBase historico={perfil.salarioBaseHistorico} />
        <FinComissaoForm personId={perfil.id} temSalarioBase={Boolean(perfil.salarioBaseAtual)} />
        <TabelaComissao historico={perfil.comissaoDeclarada} />
      </section>

      {/* 3. Os números que resumem. */}
      <section className="fin-card">
        <div className="fin-card-head">
          <h2>Desde 2026</h2>
          <span className="fin-card-total">{brl(perfil.totalCents)}</span>
        </div>
        <div className="pp-numeros">
          <div className="pp-num">
            <b>{brl(perfil.mediaRecorrenteCents)}</b>
            <span>por mês, mediana do que se repete (salário, pró-labore, estágio)</span>
          </div>
          <div className="pp-num">
            <b>{perfil.porMes.length}</b>
            <span>{perfil.porMes.length === 1 ? "mês com pagamento" : "meses com pagamento"}</span>
          </div>
          <div className={perfil.reembolsoAbertoCents > 0 ? "pp-num aviso" : "pp-num"}>
            <b>{brl(perfil.reembolsoAbertoCents)}</b>
            <span>de reembolso em aberto — a empresa ainda deve</span>
          </div>
          <div className="pp-num">
            <b>{perfil.ultimoPagamento ? perfil.ultimoPagamento.split("-").reverse().join("/") : "—"}</b>
            <span>último pagamento</span>
          </div>
        </div>

        <div className="pp-bloco">
          <h3>Mês a mês</h3>
          {perfil.porMes.length === 0 ? (
            <p className="pp-vazio">Nenhum pagamento registrado desde 2026.</p>
          ) : (
            <div
              className="pp-historico"
              role="img"
              aria-label={perfil.porMes.map((m) => `${mesCurto(m.mes)}: ${brl(m.cents)}`).join("; ")}
            >
              {perfil.porMes.map((m) => (
                <div key={m.mes} className="pp-mes">
                  <span className="pp-mes-valor">{brl(m.cents)}</span>
                  {/* Empilhado por natureza: dá para ver num relance o mês em
                      que entrou comissão ou um extra, que é o que a média
                      esconde. */}
                  <span className="pp-coluna" style={{ height: `${Math.max(4, (m.cents / tetoMes) * 100)}%` }}>
                    {Object.entries(m.porNatureza)
                      .sort((a, b) => b[1] - a[1])
                      .map(([nat, v]) => (
                        <i
                          key={nat}
                          title={`${NATUREZA_ROTULO[nat] ?? nat}: ${brl(v)}`}
                          style={{ height: `${(v / m.cents) * 100}%`, background: NATUREZA_COR[nat] ?? "var(--muted)" }}
                        />
                      ))}
                  </span>
                  <span className="pp-mes-rotulo">{mesCurto(m.mes)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* A MESMA informação do gráfico, em número exato — é o que dá para
            somar de cabeça e conferir contra o combinado com a pessoa. */}
        {perfil.porMes.length > 0 ? (
          <div className="pp-bloco">
            <h3>Mês a mês, em números</h3>
            <TabelaMesNatureza porMes={perfil.porMes} />
          </div>
        ) : null}

        <div className="pp-cortes">
          <div className="pp-bloco">
            <h3>Por natureza</h3>
            <ul className="pp-barras">
              {perfil.porNatureza.map((n) => (
                <li key={n.natureza}>
                  <span className="pp-rotulo">{NATUREZA_ROTULO[n.natureza] ?? n.natureza}</span>
                  <span className="pp-trilho">
                    <i style={{ width: `${(n.cents / tetoNat) * 100}%`, background: NATUREZA_COR[n.natureza] }} />
                  </span>
                  <span className="pp-valor">{brl(n.cents)}</span>
                  <span className="pp-n">{n.n}×</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="pp-bloco">
            <h3>De qual conta saiu</h3>
            <ul className="pp-barras">
              {perfil.porConta.map((a) => (
                <li key={a.conta}>
                  <span className="pp-rotulo">{a.conta}</span>
                  <span className="pp-trilho">
                    <i style={{ width: `${(a.cents / (perfil.porConta[0]?.cents || 1)) * 100}%` }} />
                  </span>
                  <span className="pp-valor">{brl(a.cents)}</span>
                  <span className="pp-n">{a.n}×</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* 4. Pagamento a pagamento. */}
      <section className="fin-card">
        <div className="fin-card-head">
          <h2>
            Cada pagamento
            {perfil.pagamentos.length >= 200 ? <em> — os 200 mais recentes</em> : null}
          </h2>
        </div>
        {perfil.salarioBaseAtual ? (
          <p className="pp-remuneracao-explicacao pp-cada-pagamento-nota">
            Esta lista mostra a categoria do lançamento no banco — não a separação de cima. Quando a base
            (salário/comissão) mora numa categoria que também recebe outra coisa (aqui, Pró-labore), o razão não
            distingue as duas PIX a PIX: a separação certa é a do resumo acima, calculada pelo mês inteiro. Alguns
            meses até batem linha a linha por coincidência de valor; outros dividem um único PIX entre duas naturezas,
            e aí nenhuma linha isolada representa o número de cima.
          </p>
        ) : null}
        <div className="pp-tabela-caixa">
          <table className="pp-tabela">
            <thead>
              <tr>
                <th scope="col">Data</th>
                <th scope="col">O que foi</th>
                <th scope="col">Conta</th>
                <th scope="col" className="num">
                  Valor
                </th>
              </tr>
            </thead>
            <tbody>
              {perfil.pagamentos.map((p) => (
                <tr key={p.transactionId}>
                  <td className="num">{p.data.split("-").reverse().join("/")}</td>
                  <td>
                    <span className="pp-titulo">{NATUREZA_ROTULO[p.natureza] ?? p.natureza}</span>
                    <span className="pp-meta">
                      {p.categoria ?? "sem categoria"}
                      {p.descricao ? ` · ${p.descricao.slice(0, 70)}` : ""}
                    </span>
                  </td>
                  <td>{p.conta}</td>
                  <td className="num">{brl(p.valorCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

/** A ORDEM É FIXA, não alfabética — dinheiro que efetivamente é remuneração
    primeiro, reembolso (devolução, não remuneração) por último. Colunas que a
    pessoa nunca recebeu somem: uma tabela com "Comissão" zerada em toda linha
    não ajuda ninguém a ler. */
const ORDEM_NATUREZA = ["salario", "prolabore", "comissao", "estagio", "encargo_beneficio", "extra", "reembolso"];

function TabelaMesNatureza({ porMes }: { porMes: PerfilPessoa["porMes"] }) {
  const colunas = ORDEM_NATUREZA.filter((nat) => porMes.some((m) => (m.porNatureza[nat] ?? 0) > 0));

  return (
    <div className="pp-tabela-caixa">
      <table className="pp-tabela">
        <thead>
          <tr>
            <th scope="col">Mês</th>
            {colunas.map((nat) => (
              <th scope="col" className="num" key={nat}>
                {NATUREZA_ROTULO[nat] ?? nat}
              </th>
            ))}
            <th scope="col" className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {porMes.map((m) => (
            <tr key={m.mes}>
              <td>{mesCurto(m.mes)}</td>
              {colunas.map((nat) => (
                <td className="num" key={nat}>
                  {m.porNatureza[nat] ? brl(m.porNatureza[nat]) : "—"}
                </td>
              ))}
              <td className="num">
                <strong>{brl(m.cents)}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

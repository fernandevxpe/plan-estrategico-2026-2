import type { CartaoDescrito } from "@/lib/financeiro/cartao-descrito";
import { brl } from "@/components/financeiro/Certeza";

/**
 * O que o time descreveu, por cartão.
 *
 * Fica ABAIXO da fatura na tela de cartões, e a separação é o conteúdo: em cima
 * está o que o banco cobrou, aqui está o que uma pessoa contou. Nunca somados —
 * são a mesma compra por dois caminhos, e um total único contaria duas vezes.
 */

const STATUS_ROTULO: Record<string, string> = {
  enviado: "aguardando decisão",
  em_analise: "em análise",
  aprovado: "aprovado",
  recusado: "recusado",
  atendida: "atendida"
};

const CORES: Record<string, string> = {
  preto: "#2b2b31",
  branco: "#d9d9e0",
  cinza: "#6b6b76",
  prata: "#a9aeb8",
  dourado: "#c39c2c",
  roxo: "#820ad1",
  azul: "#1e5fd4",
  verde: "#12805c",
  vermelho: "#c2283c",
  laranja: "#ff7a00",
  rosa: "#d6449b",
  transparente: "#7d8592"
};

export function FinCartaoDescrito({
  cartoes,
  totalCents
}: {
  cartoes: CartaoDescrito[];
  totalCents: number;
}) {
  if (!cartoes.length) {
    return (
      <section className="fin-card">
        <div className="fin-card-head">
          <h2>Descrito pelo time</h2>
        </div>
        <p className="fin-card-hint">
          Nenhum custo de cartão foi lançado pelo aplicativo ainda. Quando alguém fotografar uma compra e marcar o
          cartão, ela aparece aqui — antes de a fatura chegar.
        </p>
      </section>
    );
  }

  return (
    <section className="fin-card">
      <div className="fin-card-head">
        <h2>Descrito pelo time</h2>
        <span className="fin-card-total">{brl(totalCents)}</span>
      </div>
      <p className="fin-card-hint">
        O que foi lançado pelo aplicativo e apontado para um cartão. <strong>Não somar com a fatura acima</strong> — são
        a mesma compra por dois caminhos: lá está o que o banco cobrou, aqui o que uma pessoa contou. Onde os dois
        existem, dá para conferir; onde só um existe, é o que falta.
      </p>

      <div className="descrito-lista">
        {cartoes.map((c) => (
          <article key={c.chave} className="descrito-cartao">
            <header>
              <span
                className="descrito-tarja"
                style={{ background: (c.cor && CORES[c.cor]) || "var(--line)" }}
                aria-hidden
              />
              <div className="descrito-quem">
                <strong>
                  {c.apelido ?? (c.final ? `Final ${c.final}` : c.banco ?? "Cartão")}
                </strong>
                <span>
                  {[c.banco, c.final ? `final ${c.final}` : null, c.bandeira, c.cor].filter(Boolean).join(" · ")}
                </span>
              </div>
              <div className="descrito-valor">
                <b>{brl(c.totalCents)}</b>
                <span>
                  {c.lancamentos.length} {c.lancamentos.length === 1 ? "lançamento" : "lançamentos"}
                </span>
              </div>
            </header>

            {!c.cadastrado ? (
              <p className="descrito-aviso">
                Este final foi digitado e não casa com nenhum plástico cadastrado. Enquanto estiver assim, estes
                lançamentos não têm como casar com a fatura — cadastre o cartão pelo aplicativo.
              </p>
            ) : null}

            <table className="descrito-tabela">
              <thead>
                <tr>
                  <th scope="col">Data</th>
                  <th scope="col">O que foi</th>
                  <th scope="col">Quem</th>
                  <th scope="col">Situação</th>
                  <th scope="col" className="num">
                    Valor
                  </th>
                </tr>
              </thead>
              <tbody>
                {c.lancamentos.map((l) => (
                  <tr key={l.code}>
                    <td className="num">{l.data.split("-").reverse().join("/")}</td>
                    <td>
                      <span className="descrito-titulo">{l.titulo}</span>
                      <span className="descrito-meta">
                        {l.code}
                        {l.categoria ? ` · ${l.categoria}` : " · sem categoria"}
                        {l.centro ? ` · ${l.centro}` : ""}
                        {l.parcelas ? ` · ${l.parcelas}×` : ""}
                        {l.anexos ? ` · ${l.anexos} anexo${l.anexos > 1 ? "s" : ""}` : " · sem comprovante"}
                      </span>
                    </td>
                    <td>
                      {l.pessoa}
                      {/* A força da identidade viaja junto: "declarada" quer
                          dizer que a pessoa disse quem era e ninguém provou. */}
                      {l.prova === "declarada" ? <span className="descrito-meta">identidade declarada</span> : null}
                    </td>
                    <td>
                      <span className={`descrito-selo ${l.status}`}>{STATUS_ROTULO[l.status] ?? l.status}</span>
                    </td>
                    <td className="num">{brl(l.valorCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        ))}
      </div>
    </section>
  );
}

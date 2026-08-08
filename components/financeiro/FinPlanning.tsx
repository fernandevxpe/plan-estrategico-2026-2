"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type { LinhaPlano, Planejamento } from "@/lib/financeiro/planejamento";
import { brlCents, brlCompact, monthKeyLabel, pct } from "@/lib/financeiro/format";

/**
 * Planejamento global.
 *
 * A meta vem do pipe e não se digita — é fato comercial, e duas metas
 * divergentes em duas telas é pior que meta nenhuma. O que se edita aqui são as
 * PREMISSAS (que refazem o plano inteiro) e, quando necessário, um valor
 * isolado de um mês (que não toca na fórmula).
 *
 * Essa distinção é o coração da tela. Sem a sobrescrita por célula, a primeira
 * exceção — "em março a gente sabe que o aluguel sobe" — manda a pessoa de volta
 * para a planilha, e aí passam a existir duas verdades. Com ela, a exceção fica
 * registrada, datada, com motivo, e a fórmula continua valendo nos outros meses.
 */
export function FinPlanning({ dados }: { dados: Planejamento }) {
  const router = useRouter();
  const [pendente, startTransition] = useTransition();
  const [escopoAtivo, setEscopoAtivo] = useState(dados.escopos[0]?.escopo ?? "collective");
  const [editando, setEditando] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState("");
  const [celula, setCelula] = useState<{ linha: string; mes: number } | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const escopo = dados.escopos.find((item) => item.escopo === escopoAtivo) ?? dados.escopos[0];

  async function salvarPremissa(slug: string, valor: number) {
    setErro(null);
    const resposta = await fetch("/api/financeiro/planejamento", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipo: "premissa", slug, valor })
    });
    if (!resposta.ok) {
      setErro((await resposta.json().catch(() => ({}))).error ?? "não consegui salvar");
      return;
    }
    setEditando(null);
    startTransition(() => router.refresh());
  }

  async function salvarCelula(linha: string, mes: number, valorReais: string) {
    setErro(null);
    const limpo = valorReais.replace(/[^\d,-]/g, "").replace(",", ".");
    const valorCents = limpo === "" ? null : Math.round(Number(limpo) * 100);
    if (valorCents !== null && !Number.isFinite(valorCents)) {
      setErro("valor inválido");
      return;
    }
    const resposta = await fetch("/api/financeiro/planejamento", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tipo: "override",
        ano: dados.ano,
        mes,
        linha,
        nucleo: escopoAtivo,
        valorCents,
        motivo: "editado na tela de planejamento"
      })
    });
    if (!resposta.ok) {
      setErro((await resposta.json().catch(() => ({}))).error ?? "não consegui salvar");
      return;
    }
    setCelula(null);
    startTransition(() => router.refresh());
  }

  if (!dados.disponivel) {
    return (
      <section className="card fin-empty">
        <h2 className="card-title">Planejamento indisponível</h2>
        <p>Sem conexão com o banco do financeiro.</p>
      </section>
    );
  }

  return (
    <>
      {erro ? (
        <div className="fin-alert" role="alert">
          {erro}
        </div>
      ) : null}
      {dados.avisos.map((aviso) => (
        <div className="fin-alert" key={aviso} role="status">
          {aviso}
        </div>
      ))}

      <section className="card">
        <h2 className="card-title">Premissas</h2>
        <p className="fin-card-hint">
          São elas que transformam a meta em custo, margem e equipe. Mudar qualquer uma refaz o plano inteiro. A
          origem diz de onde o número veio — <strong>planilha v3.1</strong> é o modelo que a empresa já usava,{" "}
          <strong>medido</strong> viria do ledger, <strong>manual</strong> é decisão de alguém.
        </p>
        <div className="fin-premissas">
          {dados.premissas.map((premissa) => {
            const emEdicao = editando === premissa.slug;
            const exibido =
              premissa.unidade === "bps"
                ? `${(premissa.valor / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`
                : premissa.unidade === "cents"
                  ? brlCents(premissa.valor)
                  : premissa.valor.toLocaleString("pt-BR");

            return (
              <div className="fin-premissa" key={premissa.slug}>
                <div className="fin-premissa-topo">
                  <span className="fin-premissa-nome">{premissa.name}</span>
                  <span className={`fin-origem fin-origem-${premissa.origem}`}>{premissa.origem.replace("_", " ")}</span>
                </div>
                {emEdicao ? (
                  <div className="fin-premissa-edit">
                    <input
                      className="fin-input"
                      autoFocus
                      value={rascunho}
                      inputMode="decimal"
                      onChange={(evento) => setRascunho(evento.target.value)}
                      onKeyDown={(evento) => {
                        if (evento.key === "Enter") {
                          const bruto = Number(rascunho.replace(",", "."));
                          if (Number.isFinite(bruto)) {
                            // A tela fala em % e R$; o banco guarda bps e centavos.
                            const valor =
                              premissa.unidade === "bps"
                                ? Math.round(bruto * 100)
                                : premissa.unidade === "cents"
                                  ? Math.round(bruto * 100)
                                  : Math.round(bruto);
                            void salvarPremissa(premissa.slug, valor);
                          }
                        }
                        if (evento.key === "Escape") setEditando(null);
                      }}
                      aria-label={`Novo valor para ${premissa.name}`}
                    />
                    <span className="fin-premissa-unidade">{premissa.unidade === "bps" ? "%" : "R$"}</span>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="fin-premissa-valor"
                    onClick={() => {
                      setEditando(premissa.slug);
                      setRascunho(
                        premissa.unidade === "bps" ? String(premissa.valor / 100) : String(premissa.valor / 100)
                      );
                    }}
                  >
                    {exibido}
                  </button>
                )}
                {premissa.descricao ? <p className="fin-premissa-desc">{premissa.descricao}</p> : null}
              </div>
            );
          })}
        </div>
      </section>

      <section className="card">
        <div className="fin-escopo-tabs" role="tablist" aria-label="Escopo do plano">
          {dados.escopos.map((item) => (
            <button
              key={item.escopo}
              type="button"
              role="tab"
              aria-selected={item.escopo === escopoAtivo}
              className={item.escopo === escopoAtivo ? "fin-escopo-tab active" : "fin-escopo-tab"}
              onClick={() => setEscopoAtivo(item.escopo)}
            >
              {item.rotulo}
            </button>
          ))}
        </div>

        {escopo ? (
          <>
            <p className="fin-card-hint">
              Meta de {dados.fonteMeta}. Clique em qualquer célula para escrever o valor à mão — a fórmula continua
              valendo nos outros meses, e a célula editada fica marcada.
              {escopo.escopo !== "collective" ? (
                <>
                  {" "}
                  O custo fixo da estrutura <strong>não é rateado</strong> entre núcleos: ele aparece inteiro no
                  consolidado, porque rateio produziria um lucro por núcleo que soma mais que o lucro real.
                </>
              ) : null}
            </p>

            <div className="table-wrap fin-matrix-wrap">
              <table className="fin-table fin-matrix fin-plano">
                <thead>
                  <tr>
                    <th className="fin-matrix-head">Linha</th>
                    {escopo.meses.map((mes) => (
                      <th key={mes} className="num">
                        {monthKeyLabel(mes)}
                      </th>
                    ))}
                    <th className="num">Ano</th>
                    <th className="num">% rec.</th>
                  </tr>
                </thead>
                <tbody>
                  {escopo.linhas.map((linha) => (
                    <LinhaTabela
                      key={linha.linha}
                      linha={linha}
                      meses={escopo.meses}
                      celulaAberta={celula}
                      onAbrir={setCelula}
                      onSalvar={salvarCelula}
                      pendente={pendente}
                    />
                  ))}
                  <tr className="fin-plano-realizado">
                    <th scope="row" className="fin-matrix-head">
                      Realizado (comercial)
                    </th>
                    {escopo.realizadoPorMes.map((valor, indice) => (
                      <td key={indice} className="num fin-table-money">
                        {valor ? brlCompact(valor) : <span className="fin-zero">—</span>}
                      </td>
                    ))}
                    <td className="num fin-table-money">
                      {brlCompact(escopo.realizadoPorMes.reduce((s, v) => s + v, 0))}
                    </td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="fin-plano-equipe">
              <div>
                <span className="fin-import-num">{escopo.equipe.vendedoresNecessarios.toFixed(1)}</span>
                <span>vendedores que a meta exige</span>
              </div>
              <div>
                <span className="fin-import-num">{escopo.equipe.fechamentosMes.toFixed(1)}</span>
                <span>fechamentos por mês</span>
              </div>
              <div>
                <span className="fin-import-num">{escopo.equipe.pessoasEstimadas.toFixed(1)}</span>
                <span>pessoas na operação (estimado pelo custo)</span>
              </div>
            </div>
          </>
        ) : null}
      </section>
    </>
  );
}

function LinhaTabela({
  linha,
  meses,
  celulaAberta,
  onAbrir,
  onSalvar,
  pendente
}: {
  linha: LinhaPlano;
  meses: string[];
  celulaAberta: { linha: string; mes: number } | null;
  onAbrir: (celula: { linha: string; mes: number } | null) => void;
  onSalvar: (linha: string, mes: number, valor: string) => void;
  pendente: boolean;
}) {
  const [rascunho, setRascunho] = useState("");
  const ehResultado = linha.tipo === "resultado";
  // Receita é positiva; tudo que reduz o resultado aparece com sinal para o
  // olho não precisar interpretar o rótulo.
  const sinal = linha.tipo === "receita" || ehResultado ? 1 : -1;

  return (
    <tr className={ehResultado ? "fin-plano-resultado" : undefined}>
      <th scope="row" className="fin-matrix-head" title={linha.formula ?? undefined}>
        {linha.rotulo}
        {linha.temOverride ? <span className="fin-tag">editado</span> : null}
      </th>
      {meses.map((mes, indice) => {
        const aberta = celulaAberta?.linha === linha.linha && celulaAberta?.mes === indice + 1;
        const valor = linha.porMes[indice] ?? 0;
        if (aberta) {
          return (
            <td key={mes} className="num">
              <input
                className="fin-input fin-cell-input"
                autoFocus
                value={rascunho}
                inputMode="decimal"
                placeholder="vazio = volta à fórmula"
                onChange={(evento) => setRascunho(evento.target.value)}
                onKeyDown={(evento) => {
                  if (evento.key === "Enter") onSalvar(linha.linha, indice + 1, rascunho);
                  if (evento.key === "Escape") onAbrir(null);
                }}
                aria-label={`${linha.rotulo} em ${monthKeyLabel(mes)}`}
              />
            </td>
          );
        }
        return (
          <td key={mes} className="num fin-table-money">
            <button
              type="button"
              className="fin-cell-btn"
              disabled={pendente || ehResultado}
              onClick={() => {
                onAbrir({ linha: linha.linha, mes: indice + 1 });
                setRascunho(String((valor / 100).toFixed(2)).replace(".", ","));
              }}
              title={ehResultado ? "linha calculada — edite as linhas acima" : "clique para escrever à mão"}
            >
              {valor ? brlCompact(valor * sinal) : <span className="fin-zero">—</span>}
            </button>
          </td>
        );
      })}
      <td className="num fin-table-money">
        <strong>{brlCompact(linha.total * sinal)}</strong>
      </td>
      <td className="num">{pct(linha.pctReceita, 1)}</td>
    </tr>
  );
}

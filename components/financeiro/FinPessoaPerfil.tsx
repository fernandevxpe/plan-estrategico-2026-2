"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { brl } from "@/components/financeiro/Certeza";
import {
  FinCalculadoraRemuneracao,
  FinComissaoForm,
  FinProlaboreEsperadoForm,
  FinSalarioBaseForm
} from "@/components/financeiro/FinRemuneracaoForms";
import type { PerfilPessoa } from "@/lib/financeiro/pessoa-perfil";

const NATUREZA_ROTULO: Record<string, string> = {
  salario: "Salário",
  prolabore: "Pró-labore",
  estagio: "Estágio",
  comissao: "Comissão",
  reembolso: "Reembolso",
  encargo_beneficio: "Encargos",
  extra: "Extra"
};

const NATUREZA_COR: Record<string, string> = {
  salario: "var(--nat-salario)",
  prolabore: "var(--nat-recorrente)",
  estagio: "var(--nat-recorrente)",
  comissao: "var(--nat-comissao)",
  reembolso: "var(--nat-reembolso)",
  encargo_beneficio: "var(--nat-encargo)",
  extra: "var(--nat-extra)"
};

const VINCULO: Record<string, string> = {
  clt: "CLT",
  pj: "PJ",
  socio: "Sócio",
  estagiario: "Estagiário"
};

const PIX_ROTULO: Record<string, string> = {
  cpf: "CPF",
  cnpj: "CNPJ",
  email: "E-mail",
  telefone: "Telefone",
  aleatoria: "Aleatória"
};

const FILTROS = ["todos", "salario", "prolabore", "comissao", "reembolso", "estagio", "extra"] as const;
type Filtro = (typeof FILTROS)[number];

function mesCurto(m: string) {
  const [ano, mes] = m.split("-");
  return `${mes}/${ano.slice(2)}`;
}

function dataCurta(iso: string) {
  return iso.split("-").reverse().join("/");
}

function competenciaProxima() {
  const hoje = new Date();
  const prox = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1);
  return `${prox.getFullYear()}-${String(prox.getMonth() + 1).padStart(2, "0")}`;
}

export function FinPessoaPerfil({ perfil }: { perfil: PerfilPessoa }) {
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [mostrarPrevisao, setMostrarPrevisao] = useState(true);
  const [detalhesAbertos, setDetalhesAbertos] = useState(false);
  const [mostrarPix, setMostrarPix] = useState(false);

  const c = perfil.conta;
  const proxMes = competenciaProxima();
  const comissaoProxima = perfil.comissaoDeclarada.find((x) => x.competencia === proxMes) ?? null;
  // 0167: várias no mesmo mês — a previsão e o chip somam.
  const comissaoProximaSoma = perfil.comissaoDeclarada
    .filter((x) => x.competencia === proxMes)
    .reduce((s, x) => s + x.valorCents, 0);
  const reembolsoPrevistoProximoMesCents = perfil.reembolsoPrevistoProximoMesCents;

  const previsaoFixa =
    perfil.salarioBaseAtual && perfil.prolaboreEsperadoAtual
      ? perfil.salarioBaseAtual.valorCents + perfil.prolaboreEsperadoAtual.valorCents
      : null;
  const previsaoTotal =
    previsaoFixa !== null
      ? previsaoFixa + comissaoProximaSoma + reembolsoPrevistoProximoMesCents
      : null;

  const mesMaisRecente = perfil.porMes.length ? perfil.porMes[perfil.porMes.length - 1] : null;
  const mesMaisRecenteCents = mesMaisRecente?.cents ?? null;
  const crescimentoPct =
    mesMaisRecenteCents !== null && perfil.mediaRecorrenteCents > 0
      ? ((mesMaisRecenteCents / perfil.mediaRecorrenteCents) - 1) * 100
      : null;

  const pagamentosFiltrados = useMemo(
    () => (filtro === "todos" ? perfil.pagamentos : perfil.pagamentos.filter((p) => p.natureza === filtro)),
    [filtro, perfil.pagamentos]
  );
  const mesesFiltrados = useMemo(
    () =>
      perfil.porMes.filter((m) => {
        if (filtro === "todos") return true;
        return (m.porNatureza[filtro] ?? 0) > 0;
      }),
    [filtro, perfil.porMes]
  );

  const tetoMes = Math.max(...perfil.porMes.map((m) => m.cents), previsaoTotal ?? 0, 1);
  const tetoNat = Math.max(...perfil.porNatureza.map((n) => n.cents), 1);

  const mesesGrafico = useMemo(() => {
    const base = [...perfil.porMes];
    if (!mostrarPrevisao || previsaoTotal === null || previsaoTotal <= 0) return base;

    const porNatureza: Record<string, number> = {};
    if (perfil.salarioBaseAtual) porNatureza.salario = perfil.salarioBaseAtual.valorCents;
    if (perfil.prolaboreEsperadoAtual) porNatureza.prolabore = perfil.prolaboreEsperadoAtual.valorCents;
    if (comissaoProximaSoma) porNatureza.comissao = comissaoProximaSoma;
    if (reembolsoPrevistoProximoMesCents > 0) porNatureza.reembolso = reembolsoPrevistoProximoMesCents;

    return [
      ...base,
      {
        mes: proxMes,
        cents: previsaoTotal,
        porNatureza,
        previsao: true as const
      }
    ];
  }, [perfil, mostrarPrevisao, previsaoTotal, comissaoProximaSoma, reembolsoPrevistoProximoMesCents, proxMes]);

  return (
    <div className="pp-unificado">
      {/* Identidade + pagamento */}
      <section className="fin-card pp-card-compacta">
        <div className="pp-cabecalho">
          <div className="pp-identidade">
            <span className="pp-bloco-eyebrow">Pessoa</span>
            <div className="pp-linha-resumo">
              <strong className="pp-resumo-principal">{perfil.nome}</strong>
              {perfil.vinculo ? <span className="pp-tag">{VINCULO[perfil.vinculo] ?? perfil.vinculo}</span> : null}
              {perfil.area ? <span className="pp-tag neutro">{perfil.area}</span> : null}
              {perfil.papel ? <span className="pp-tag neutro">{perfil.papel}</span> : null}
              {perfil.cpf ? <span className="pp-item-inline"><b>CPF</b>{perfil.cpf}</span> : null}
              {perfil.email ? <span className="pp-item-inline pp-truncar"><b>E-mail</b>{perfil.email}</span> : null}
              {perfil.desde ? <span className="pp-item-inline"><b>Desde</b>{dataCurta(perfil.desde)}</span> : null}
              {perfil.dataNascimento ? <span className="pp-item-inline"><b>Aniversário</b>{dataCurta(perfil.dataNascimento)}</span> : null}
            </div>
          </div>

          <div className="pp-pagamento">
            <span className="pp-bloco-eyebrow">Pagamento</span>
            {!c ? (
              <p className="pp-vazio">Sem conta cadastrada — a pessoa preenche em Meu perfil no app.</p>
            ) : (
              <div className="pp-linha-resumo">
                <strong className="pp-resumo-principal">{c.metodo === "pix" ? "PIX" : "TED"}</strong>
                <span className="pp-item-inline">
                  <b>Usa para</b>
                  {[c.recebeSalario ? "salário" : null, c.recebeReembolso ? "reembolso" : null]
                    .filter(Boolean)
                    .join(" + ") || "—"}
                </span>
                {c.metodo === "pix" ? (
                  <>
                    <span className="pp-item-inline"><b>Tipo</b>{PIX_ROTULO[c.pixTipo ?? ""] ?? c.pixTipo}</span>
                    <span className="pp-item-inline pp-chave-curta"><b>Chave</b>{c.pixChave}</span>
                  </>
                ) : (
                  <>
                    <span className="pp-item-inline"><b>Banco</b>{c.bancoNome}</span>
                    <span className="pp-item-inline"><b>Ag / Cc</b>{c.agencia} · {c.conta}</span>
                  </>
                )}
                <span className="pp-item-inline"><b>Titular</b>{c.titularEhAPessoa ? perfil.nome : `${c.titularNome ?? "—"}${c.titularDocumento ? ` · ${c.titularDocumento}` : ""}`}</span>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* KPIs + remuneração */}
      <section className="fin-card pp-card-compacta">
        <div className="pp-kpis">
          <div className="pp-kpi">
            <b>{perfil.ultimoPagamento ? dataCurta(perfil.ultimoPagamento) : "—"}</b>
            <span>último pago</span>
          </div>
          <div className="pp-kpi">
            <b>{brl(perfil.mediaRecorrenteCents)}</b>
            <span>mediana/mês recorrente</span>
            {mesMaisRecenteCents !== null ? (
              <span>
                mês recente: {brl(mesMaisRecenteCents)}
                {crescimentoPct !== null ? ` (${crescimentoPct >= 0 ? "+" : ""}${crescimentoPct.toFixed(0)}%)` : null}
              </span>
            ) : null}
          </div>
          <div className="pp-kpi">
            <b>{previsaoTotal === null ? "—" : brl(previsaoTotal)}</b>
            <span>previsto {mesCurto(proxMes)} (com reembolso)</span>
          </div>
          <div className={`pp-kpi${perfil.reembolsoAbertoCents > 0 ? " destaque" : ""}`}>
            <b>{brl(perfil.reembolsoAbertoCents)}</b>
            <span>
              reembolso em aberto ·{" "}
              <Link href="/financeiro/reembolsos" className="pp-link">
                ver reembolsos
              </Link>
            </span>
          </div>
        </div>

        <div className="pp-rem-grid">
          <FinSalarioBaseForm personId={perfil.id} atual={perfil.salarioBaseAtual} historico={perfil.salarioBaseHistorico} />
          <FinProlaboreEsperadoForm
            personId={perfil.id}
            atual={perfil.prolaboreEsperadoAtual}
            historico={perfil.prolaboreEsperadoHistorico}
          />
          <FinComissaoForm
            personId={perfil.id}
            temSalarioBase={Boolean(perfil.salarioBaseAtual)}
            comissaoAtual={
              comissaoProximaSoma
                ? {
                    id: comissaoProxima?.id ?? 0,
                    valorCents: comissaoProximaSoma,
                    competencia: proxMes,
                    descricao: "soma do mês",
                    nota: null
                  }
                : perfil.comissaoDeclarada[0] ?? null
            }
            historico={perfil.comissaoDeclarada}
          />
          <article className="pp-chip" style={{ ["--pp-chip-cor" as string]: "var(--nat-reembolso)" }}>
            <div className="pp-chip-topo">
              <div className="pp-chip-corpo">
                <span className="pp-chip-rotulo">Reembolso previsto</span>
                <strong className="pp-chip-valor">{brl(reembolsoPrevistoProximoMesCents)}</strong>
                <span className="pp-chip-detalhe">
                  parcelas do mês {mesCurto(proxMes)}
                </span>
              </div>
              <div className="pp-chip-acoes" aria-hidden />
            </div>
          </article>
          <FinCalculadoraRemuneracao
            salarioBaseAtual={perfil.salarioBaseAtual}
            prolaboreEsperadoAtual={perfil.prolaboreEsperadoAtual}
            comissaoDeclarada={perfil.comissaoDeclarada}
            reembolsoPrevistoProximoMesCents={reembolsoPrevistoProximoMesCents}
            compacto
          />
        </div>
      </section>

      {/* Gráfico + extrato */}
      <section className="fin-card pp-card-compacta">
        <div className="pp-secao-topo">
          <h2>Histórico e extrato</h2>
          <div className="pp-secao-acoes">
            <label className="pp-toggle">
              <input type="checkbox" checked={mostrarPrevisao} onChange={(e) => setMostrarPrevisao(e.target.checked)} />
              incluir previsão {mesCurto(proxMes)}
            </label>
            <button type="button" className="pp-btn-texto" onClick={() => setDetalhesAbertos((v) => !v)}>
              {detalhesAbertos ? "Ocultar detalhes" : "Ver por natureza/conta"}
            </button>
          </div>
        </div>

        <div className="pp-resumo-linha">
          <span>
            <strong>{brl(perfil.totalCents)}</strong> desde 2026 · {perfil.porMes.length} meses
          </span>
        </div>

        {perfil.porMes.length > 0 || (mostrarPrevisao && previsaoTotal) ? (
          <div
            className="pp-historico pp-historico-compacto"
            role="img"
            aria-label="Histórico mês a mês"
          >
            {mesesGrafico.map((m) => (
              <div key={m.mes} className={"pp-mes" + ("previsao" in m && m.previsao ? " pp-mes-previsao" : "")}>
                <span className="pp-mes-valor">{brl(m.cents)}</span>
                <span
                  className="pp-coluna"
                  style={{ height: `${Math.max(4, (m.cents / tetoMes) * 100)}%` }}
                >
                  {Object.entries(m.porNatureza)
                    .sort((a, b) => b[1] - a[1])
                    .map(([nat, v]) => (
                      <i
                        key={nat}
                        title={`${NATUREZA_ROTULO[nat] ?? nat}: ${brl(v)}`}
                        style={{
                          height: `${(v / m.cents) * 100}%`,
                          background: NATUREZA_COR[nat] ?? "var(--muted)"
                        }}
                      />
                    ))}
                </span>
                <span className="pp-mes-rotulo">{mesCurto(m.mes)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="pp-vazio">Nenhum pagamento registrado desde 2026.</p>
        )}

        {detalhesAbertos ? (
          <div className="pp-cortes pp-cortes-compacto">
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
              <h3>De qual conta</h3>
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
        ) : null}

        <div className="pp-extrato">
          <div className="pp-filtros" role="tablist" aria-label="Filtrar por natureza">
            {FILTROS.map((f) => (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={filtro === f}
                className={filtro === f ? "pp-filtro ativo" : "pp-filtro"}
                onClick={() => setFiltro(f)}
              >
                {f === "todos" ? "Todos" : (NATUREZA_ROTULO[f] ?? f)}
                {f !== "todos" ? (
                  <span className="pp-filtro-n">
                    {perfil.porMes.filter((m) => (m.porNatureza[f] ?? 0) > 0).length}
                  </span>
                ) : (
                  <span className="pp-filtro-n">{perfil.porMes.length}</span>
                )}
              </button>
            ))}
          </div>

          <div className="pp-tabela-caixa pp-tabela-caixa-alta">
            <table className="pp-tabela">
              <thead>
                <tr>
                  <th scope="col">Mês</th>
                  <th scope="col" className="num">Salário</th>
                  <th scope="col" className="num">Pró-labore</th>
                  <th scope="col" className="num">Comissão</th>
                  <th scope="col" className="num">Reembolso</th>
                  <th scope="col" className="num">Extra</th>
                  <th scope="col" className="num">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {mesesFiltrados.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="pp-vazio-celula">
                      Nenhum mês com esta natureza.
                    </td>
                  </tr>
                ) : (
                  mesesFiltrados.map((m) => (
                    <tr key={m.mes}>
                      <td>{mesCurto(m.mes)}</td>
                      <td className="num">{m.porNatureza.salario ? brl(m.porNatureza.salario) : "—"}</td>
                      <td className="num">{m.porNatureza.prolabore ? brl(m.porNatureza.prolabore) : "—"}</td>
                      <td className="num">{m.porNatureza.comissao ? brl(m.porNatureza.comissao) : "—"}</td>
                      <td className="num">{m.porNatureza.reembolso ? brl(m.porNatureza.reembolso) : "—"}</td>
                      <td className="num">{m.porNatureza.extra ? brl(m.porNatureza.extra) : "—"}</td>
                      <td className="num">
                        <strong>{brl(m.cents)}</strong>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <p className="pp-nota-rodape">
            Esta tabela usa a mesma composição mensal do gráfico. O PIX bruto do banco pode ter outra categoria e não
            separa salário, pró-labore e reembolso sozinho.
          </p>

          <div className="pp-pix-bloco">
            <button type="button" className="pp-btn-texto" onClick={() => setMostrarPix((v) => !v)}>
              {mostrarPix ? "Ocultar PIX do extrato" : "Ver PIX do extrato"}
            </button>
            {mostrarPix ? (
              <div className="pp-tabela-caixa pp-tabela-caixa-media">
                <table className="pp-tabela">
                  <thead>
                    <tr>
                      <th scope="col">Data</th>
                      <th scope="col">Categoria no banco</th>
                      <th scope="col">Detalhe</th>
                      <th scope="col">Conta</th>
                      <th scope="col" className="num">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagamentosFiltrados.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="pp-vazio-celula">Nenhum PIX neste filtro.</td>
                      </tr>
                    ) : (
                      pagamentosFiltrados.map((p) => (
                        <tr key={p.transactionId}>
                          <td className="num">{dataCurta(p.data)}</td>
                          <td>{p.categoria ?? "sem categoria"}</td>
                          <td><span className="pp-meta">{p.descricao ? p.descricao.slice(0, 90) : "—"}</span></td>
                          <td>{p.conta}</td>
                          <td className="num">{brl(p.valorCents)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}

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

/** Ordem dos chips do gráfico — mesma da matriz. */
const GRAFICO_NATUREZAS = [
  "salario",
  "prolabore",
  "comissao",
  "estagio",
  "extra",
  "encargo_beneficio",
  "reembolso"
] as const;

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

function mesSeguinteYm(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

/**
 * Uma cota por mês a partir de `inicioMes`, até acabar cada série.
 * Notebook 13/24 com 11 restantes → 11 barras futuras, não só o mês que vem.
 */
function projetarReembolsosFuturos(
  series: { quitado: boolean; parcelasRestantes: number; valorParcelaCents: number }[],
  inicioMes: string
): { mes: string; cents: number }[] {
  const mapa = new Map<string, number>();
  for (const s of series) {
    if (s.quitado || s.parcelasRestantes < 1) continue;
    let mes = inicioMes;
    for (let i = 0; i < s.parcelasRestantes; i += 1) {
      mapa.set(mes, (mapa.get(mes) ?? 0) + s.valorParcelaCents);
      mes = mesSeguinteYm(mes);
    }
  }
  return [...mapa.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([mes, cents]) => ({ mes, cents }));
}

export function FinPessoaPerfil({ perfil }: { perfil: PerfilPessoa }) {
  const [filtro, setFiltro] = useState<Filtro>("todos");
  /** Reembolso começa desligado — o previsto futuro só entra se a pessoa pedir. */
  const [ativos, setAtivos] = useState<Record<string, boolean>>(() => {
    const base: Record<string, boolean> = {};
    for (const slug of GRAFICO_NATUREZAS) base[slug] = slug !== "reembolso";
    return base;
  });
  const [detalhesAbertos, setDetalhesAbertos] = useState(false);
  const [mostrarPix, setMostrarPix] = useState(false);
  const [reembolsosAbertos, setReembolsosAbertos] = useState(true);

  const c = perfil.conta;
  const proxMes = competenciaProxima();
  const comissaoProxima = perfil.comissaoDeclarada.find((x) => x.competencia === proxMes) ?? null;
  const comissaoProximaSoma = perfil.comissaoDeclarada
    .filter((x) => x.competencia === proxMes)
    .reduce((s, x) => s + x.valorCents, 0);
  const reembolsoPrevistoProximoMesCents = perfil.reembolsoPrevistoProximoMesCents;

  const reembolsoFuturoPorMes = useMemo(
    () => projetarReembolsosFuturos(perfil.reembolsoSeries, proxMes),
    [perfil.reembolsoSeries, proxMes]
  );

  const naturezasGrafico = useMemo(() => {
    const presentes = new Set(perfil.porNatureza.map((n) => n.natureza));
    if (perfil.salarioBaseAtual) presentes.add("salario");
    if (perfil.prolaboreEsperadoAtual) presentes.add("prolabore");
    if (comissaoProximaSoma > 0 || perfil.comissaoDeclarada.length) presentes.add("comissao");
    if (perfil.reembolsoSeries.some((s) => !s.quitado) || reembolsoPrevistoProximoMesCents > 0) {
      presentes.add("reembolso");
    }
    return GRAFICO_NATUREZAS.filter((slug) => presentes.has(slug));
  }, [perfil, comissaoProximaSoma, reembolsoPrevistoProximoMesCents]);

  /** Previsão do mês seguinte só com chips ligados. */
  const previsaoProximoPorNatureza = useMemo(() => {
    const por: Record<string, number> = {};
    if (ativos.salario && perfil.salarioBaseAtual) por.salario = perfil.salarioBaseAtual.valorCents;
    if (ativos.prolabore && perfil.prolaboreEsperadoAtual) {
      por.prolabore = perfil.prolaboreEsperadoAtual.valorCents;
    }
    if (ativos.comissao && comissaoProximaSoma > 0) por.comissao = comissaoProximaSoma;
    if (ativos.reembolso && reembolsoPrevistoProximoMesCents > 0) {
      por.reembolso = reembolsoPrevistoProximoMesCents;
    }
    return por;
  }, [ativos, perfil, comissaoProximaSoma, reembolsoPrevistoProximoMesCents]);

  const previsaoTotal = (() => {
    const vals = Object.values(previsaoProximoPorNatureza);
    if (!vals.length) return null;
    return vals.reduce((s, v) => s + v, 0);
  })();

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

  const seriesAbertas = useMemo(
    () => perfil.reembolsoSeries.filter((s) => !s.quitado),
    [perfil.reembolsoSeries]
  );
  const seriesQuitadas = useMemo(
    () => perfil.reembolsoSeries.filter((s) => s.quitado),
    [perfil.reembolsoSeries]
  );

  const mesesGrafico = useMemo(() => {
    const filtrar = (por: Record<string, number>) => {
      const porNatureza: Record<string, number> = {};
      let cents = 0;
      for (const [nat, v] of Object.entries(por)) {
        if (ativos[nat] && v > 0) {
          porNatureza[nat] = v;
          cents += v;
        }
      }
      return { porNatureza, cents };
    };

    const base = perfil.porMes
      .map((m) => {
        const f = filtrar(m.porNatureza);
        return { mes: m.mes, ...f, previsao: false as const };
      })
      .filter((m) => m.cents > 0);

    const futuros = new Map<
      string,
      { mes: string; cents: number; porNatureza: Record<string, number>; previsao: true }
    >();

    const garantir = (mes: string) => {
      let f = futuros.get(mes);
      if (!f) {
        f = { mes, cents: 0, porNatureza: {}, previsao: true };
        futuros.set(mes, f);
      }
      return f;
    };

    // Remuneração cadastrada no mês seguinte (chips ligados).
    for (const [nat, v] of Object.entries(previsaoProximoPorNatureza)) {
      if (nat === "reembolso") continue; // reembolso entra pelo horizonte das séries
      const f = garantir(proxMes);
      f.porNatureza[nat] = (f.porNatureza[nat] ?? 0) + v;
      f.cents += v;
    }

    // Cotas futuras — só com o chip Reembolso ligado.
    if (ativos.reembolso) {
      for (const { mes, cents } of reembolsoFuturoPorMes) {
        const f = garantir(mes);
        f.porNatureza.reembolso = (f.porNatureza.reembolso ?? 0) + cents;
        f.cents += cents;
      }
    }

    const extras = [...futuros.values()]
      .filter((f) => f.cents > 0)
      .sort((a, b) => a.mes.localeCompare(b.mes));

    return [...base, ...extras];
  }, [perfil.porMes, ativos, previsaoProximoPorNatureza, reembolsoFuturoPorMes, proxMes]);

  const tetoMes = Math.max(...mesesGrafico.map((m) => m.cents), 1);
  const tetoNat = Math.max(...perfil.porNatureza.map((n) => n.cents), 1);

  function alternarNatureza(slug: string) {
    setAtivos((antes) => ({ ...antes, [slug]: !antes[slug] }));
  }

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
            <span>previsto {mesCurto(proxMes)}</span>
          </div>
          <div className={`pp-kpi${perfil.reembolsoAbertoCents > 0 ? " destaque" : ""}`}>
            <b>{brl(perfil.reembolsoAbertoCents)}</b>
            <span>
              reembolso em aberto ·{" "}
              <a href="#pp-reembolsos" className="pp-link">
                ver séries
              </a>
              {" · "}
              <Link href={`/financeiro/reembolsos?pessoa=${perfil.id}`} className="pp-link">
                tela completa
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
                  próximas cotas · {seriesAbertas.reduce((s, x) => s + x.parcelasRestantes, 0)} parcelas
                  {reembolsoFuturoPorMes.length
                    ? ` até ${mesCurto(reembolsoFuturoPorMes[reembolsoFuturoPorMes.length - 1].mes)}`
                    : ""}
                  {" · "}
                  <a href="#pp-reembolsos" className="pp-link">
                    {seriesAbertas.length
                      ? `${seriesAbertas.length} série${seriesAbertas.length === 1 ? "" : "s"}`
                      : "sem séries"}
                  </a>
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
            <button type="button" className="pp-btn-texto" onClick={() => setDetalhesAbertos((v) => !v)}>
              {detalhesAbertos ? "Ocultar detalhes" : "Ver por natureza/conta"}
            </button>
          </div>
        </div>

        <div className="fin-pessoas-matriz-chips pp-grafico-chips" role="group" aria-label="Componentes do gráfico">
          {naturezasGrafico.map((slug) => {
            const ligado = Boolean(ativos[slug]);
            return (
              <button
                key={slug}
                type="button"
                className={ligado ? "fin-pessoas-matriz-chip ativo" : "fin-pessoas-matriz-chip"}
                style={{ ["--chip-cor" as string]: NATUREZA_COR[slug] ?? "var(--muted)" }}
                aria-pressed={ligado}
                title={
                  slug === "reembolso"
                    ? "Histórico + cotas futuras até o fim das séries"
                    : slug === "salario" || slug === "prolabore" || slug === "comissao"
                      ? "Histórico e previsão do mês seguinte (cadastro)"
                      : "Histórico"
                }
                onClick={() => alternarNatureza(slug)}
              >
                <i className="fin-pessoas-matriz-chip-ponto" aria-hidden />
                {NATUREZA_ROTULO[slug] ?? slug}
              </button>
            );
          })}
        </div>

        <div className="pp-resumo-linha">
          <span>
            <strong>{brl(perfil.totalCents)}</strong> desde 2026 · {perfil.porMes.length} meses
          </span>
        </div>

        {mesesGrafico.length > 0 ? (
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

      {/* Reembolsos cadastrados — depois do histórico; sanfona */}
      <section id="pp-reembolsos" className={"fin-card pp-card-compacta" + (reembolsosAbertos ? "" : " pp-sanfona-fechada")}>
        <div className="pp-secao-topo">
          <button
            type="button"
            className="pp-sanfona-botao"
            aria-expanded={reembolsosAbertos}
            onClick={() => setReembolsosAbertos((v) => !v)}
          >
            <span className="pp-sanfona-seta" aria-hidden>
              {reembolsosAbertos ? "▾" : "▸"}
            </span>
            <h2>Reembolsos cadastrados</h2>
            {!reembolsosAbertos ? (
              <span className="pp-sanfona-resumo">
                {brl(perfil.reembolsoAbertoCents)} em aberto
                {reembolsoFuturoPorMes.length
                  ? ` · ${reembolsoFuturoPorMes.length} m. previstos`
                  : ""}
              </span>
            ) : null}
          </button>
          <div className="pp-secao-acoes">
            <Link href={`/financeiro/reembolsos?pessoa=${perfil.id}`} className="pp-btn-texto">
              Abrir tela de reembolsos →
            </Link>
          </div>
        </div>
        {reembolsosAbertos ? (
        <>
        <p className="pp-resumo-linha">
          <span>
            <strong>{brl(perfil.reembolsoAbertoCents)}</strong> em aberto
            {reembolsoPrevistoProximoMesCents > 0
              ? ` · ${brl(reembolsoPrevistoProximoMesCents)} em ${mesCurto(proxMes)}`
              : null}
            {reembolsoFuturoPorMes.length > 1
              ? ` · ${reembolsoFuturoPorMes.length} meses até ${mesCurto(reembolsoFuturoPorMes[reembolsoFuturoPorMes.length - 1].mes)}`
              : null}
          </span>
        </p>

        {seriesAbertas.length || seriesQuitadas.length ? (
          <div className="pp-tabela-caixa">
            <table className="pp-tabela">
              <thead>
                <tr>
                  <th scope="col">Série</th>
                  <th scope="col">Desde</th>
                  <th scope="col" className="num">
                    Parcela
                  </th>
                  <th scope="col" className="num">
                    Pago
                  </th>
                  <th scope="col" className="num">
                    Falta
                  </th>
                  <th scope="col" className="num">
                    Próx. cota
                  </th>
                </tr>
              </thead>
              <tbody>
                {seriesAbertas.map((s) => (
                  <tr key={s.slug}>
                    <td>
                      <span className="pp-meta">{s.descricao}</span>
                      {s.categoria ? <span className="fin-desc-sub">{s.categoria}</span> : null}
                      {s.cadastradoEm ? (
                        <span className="fin-desc-sub">cadastrado {dataCurta(s.cadastradoEm)}</span>
                      ) : null}
                    </td>
                    <td className="num">{s.desde ? mesCurto(s.desde) : "—"}</td>
                    <td className="num">
                      {s.parcela}/{s.parcelasTotal}
                    </td>
                    <td className="num">{brl(s.pagoCents)}</td>
                    <td className="num">
                      <strong>{brl(s.saldoCents)}</strong>
                      {s.parcelasRestantes > 0 ? (
                        <span className="fin-desc-sub">{s.parcelasRestantes}×</span>
                      ) : null}
                    </td>
                    <td className="num" style={{ color: "var(--nat-reembolso)" }}>
                      {s.parcelasRestantes >= 1 ? brl(s.valorParcelaCents) : "—"}
                    </td>
                  </tr>
                ))}
                {seriesQuitadas.map((s) => (
                  <tr key={s.slug} className="pp-linha-quitada">
                    <td>
                      <span className="pp-meta">{s.descricao}</span>
                      <span className="fin-desc-sub">quitado</span>
                    </td>
                    <td className="num">{s.desde ? mesCurto(s.desde) : "—"}</td>
                    <td className="num">
                      {s.parcela}/{s.parcelasTotal}
                    </td>
                    <td className="num">{brl(s.pagoCents)}</td>
                    <td className="num">
                      <span className="fin-zero">—</span>
                    </td>
                    <td className="num">
                      <span className="fin-zero">—</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="pp-vazio">Nenhuma série de reembolso cadastrada para esta pessoa.</p>
        )}

        {perfil.reembolsoPedidos.length ? (
          <>
            <h3 className="pp-sub">Pedidos mensais</h3>
            <div className="pp-tabela-caixa pp-tabela-caixa-media">
              <table className="pp-tabela">
                <thead>
                  <tr>
                    <th scope="col">Mês</th>
                    <th scope="col">Status</th>
                    <th scope="col">Cadastrado</th>
                    <th scope="col" className="num">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {perfil.reembolsoPedidos.map((p) => (
                    <tr key={p.id}>
                      <td>{mesCurto(p.mes)}</td>
                      <td>
                        <span className="fin-tag">{p.status}</span>
                      </td>
                      <td className="num">{dataCurta(p.cadastradoEm)}</td>
                      <td className="num">{brl(p.totalCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
              </>
        ) : null}
      </section>

    </div>
  );
}
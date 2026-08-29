"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type { PainelComissoes } from "@/lib/financeiro/comissoes";
import { brlCents, brlPrecise, monthKeyLabel } from "@/lib/financeiro/format";

const ROTULO_VINCULO: Record<string, string> = {
  socio_adm: "sócio adm.",
  socio: "sócio",
  mei: "MEI",
  estagiario: "estágio",
  irregular: "irregular",
  pj: "PJ",
  clt: "CLT",
  indefinido: "indefinido"
};

function mascaraDinheiro(texto: string): string {
  const digitos = texto.replace(/\D/g, "");
  if (!digitos) return "";
  const n = Number(digitos) / 100;
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Centavos do texto, ou `null` quando o campo está VAZIO.
 *
 * A distinção entre vazio e zero é o ponto. Antes as duas situações devolviam
 * 0 e o formulário recusava as duas com "informe um valor maior que zero" — e
 * como zero é uma resposta legítima ("olhei o mês e não houve comissão"), a
 * única saída era digitar R$ 0,01. Foi o que entrou na base quatro vezes.
 */
function centavosDoTexto(texto: string): number | null {
  const limpo = texto.trim().replace(/[R$\s]/g, "");
  if (!limpo) return null;
  const normalizado = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  const valor = Number(normalizado);
  if (!Number.isFinite(valor) || valor < 0) return null;
  return Math.round(valor * 100);
}

function mesInput(iso: string): string {
  return iso.slice(0, 7);
}

/**
 * Gestão de comissões declaradas — pessoa × mês, à vista ou parcelada.
 * Fonte: fin_pessoa_comissao_declarada + fin_pessoa_comissao_serie (0167).
 */
export function FinComissoes({ dados }: { dados: PainelComissoes }) {
  const router = useRouter();
  const [pendente, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [pessoaFiltro, setPessoaFiltro] = useState<number | "">("");
  const [somenteAtivos, setSomenteAtivos] = useState(true);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [aberta, setAberta] = useState<number | null>(null);

  const pessoasAtivas = useMemo(
    () => (somenteAtivos ? dados.pessoas.filter((p) => p.status === "ativo") : dados.pessoas),
    [dados.pessoas, somenteAtivos]
  );

  const mesesVisiveis = useMemo(() => {
    const ate = dados.mesSeguinte;
    const base = dados.meses.filter((m) => m <= ate);
    const comValor = new Set(
      dados.itens.filter((i) => !pessoaFiltro || i.personId === pessoaFiltro).map((i) => i.competencia)
    );
    const primeiro = base.findIndex((m) => comValor.has(m) || m === dados.mesAtual || m === dados.mesSeguinte);
    return primeiro <= 0 ? base : base.slice(Math.min(primeiro, Math.max(0, base.length - 8)));
  }, [dados.meses, dados.itens, dados.mesAtual, dados.mesSeguinte, pessoaFiltro]);

  const linhas = useMemo(() => {
    const mapa = new Map<
      number,
      { id: number; nome: string; vinculo: string; status: string; porMes: Record<string, number>; total: number; itens: typeof dados.itens }
    >();
    for (const p of pessoasAtivas) {
      if (pessoaFiltro !== "" && p.id !== pessoaFiltro) continue;
      mapa.set(p.id, {
        id: p.id,
        nome: p.nome,
        vinculo: p.vinculo,
        status: p.status,
        porMes: {},
        total: 0,
        itens: []
      });
    }
    for (const item of dados.itens) {
      if (pessoaFiltro !== "" && item.personId !== pessoaFiltro) continue;
      if (!mapa.has(item.personId)) continue;
      if (!mesesVisiveis.includes(item.competencia) && item.competencia !== dados.mesSeguinte) continue;
      const linha = mapa.get(item.personId)!;
      linha.porMes[item.competencia] = (linha.porMes[item.competencia] ?? 0) + item.valorCents;
      if (item.competencia <= dados.mesAtual) linha.total += item.valorCents;
      linha.itens.push(item);
    }
    return [...mapa.values()]
      .filter((l) => l.total > 0 || l.itens.length > 0 || pessoaFiltro !== "")
      .sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome, "pt-BR"));
  }, [pessoasAtivas, dados.itens, dados.mesAtual, dados.mesSeguinte, pessoaFiltro, mesesVisiveis]);

  const totalPorMes = useMemo(() => {
    const mapa: Record<string, number> = {};
    for (const mes of mesesVisiveis) {
      mapa[mes] = linhas.reduce((s, l) => s + (l.porMes[mes] ?? 0), 0);
    }
    return mapa;
  }, [linhas, mesesVisiveis]);

  const totalGeral = linhas.reduce((s, l) => s + l.total, 0);
  const projetado = linhas.reduce((s, l) => s + (l.porMes[dados.mesSeguinte] ?? 0), 0);

  async function enviar(url: string, metodo: string, corpo?: unknown) {
    setErro(null);
    const resposta = await fetch(url, {
      method: metodo,
      headers: corpo ? { "Content-Type": "application/json" } : undefined,
      body: corpo ? JSON.stringify(corpo) : undefined
    });
    if (!resposta.ok) {
      const json = await resposta.json().catch(() => ({}));
      setErro(json.error ?? `falha (HTTP ${resposta.status})`);
      return false;
    }
    startTransition(() => router.refresh());
    return true;
  }

  if (!dados.disponivel) {
    return (
      <section className="card fin-empty">
        <h2 className="card-title">Comissões indisponíveis</h2>
        <p>Sem conexão com o banco do financeiro, ou a migration 0167 ainda não rodou.</p>
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

      <section className="fin-kpi-row" aria-label="Indicadores de comissão">
        <article className="fin-kpi-card">
          <p className="fin-kpi-label">Declarado no período</p>
          <p className="fin-kpi-value">{brlCents(totalGeral)}</p>
          <p className="fin-kpi-hint">{linhas.length} pessoas com comissão</p>
        </article>
        <article className="fin-kpi-card">
          <p className="fin-kpi-label">Projetado {monthKeyLabel(dados.mesSeguinte)}</p>
          <p className="fin-kpi-value">{brlCents(projetado)}</p>
          <p className="fin-kpi-hint">parcelas e à vista já lançadas para o mês seguinte</p>
        </article>
        <article className="fin-kpi-card">
          <p className="fin-kpi-label">Séries parceladas</p>
          <p className="fin-kpi-value">{dados.series.length}</p>
          <p className="fin-kpi-hint">
            {brlPrecise(dados.series.reduce((s, x) => s + x.projetadoRestanteCents, 0))} ainda a cair
          </p>
        </article>
      </section>

      <div className="fin-contas-acoes" style={{ flexWrap: "wrap", gap: "0.75rem" }}>
        <button type="button" className="fin-btn-primary" onClick={() => setMostrarForm((v) => !v)}>
          {mostrarForm ? "Fechar" : "Lançar comissão"}
        </button>
        <label className="fin-check">
          Pessoa
          <select
            value={pessoaFiltro === "" ? "" : String(pessoaFiltro)}
            onChange={(e) => setPessoaFiltro(e.target.value ? Number(e.target.value) : "")}
          >
            <option value="">Todas</option>
            {pessoasAtivas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="fin-check">
          <input type="checkbox" checked={somenteAtivos} onChange={(e) => setSomenteAtivos(e.target.checked)} />
          somente ativos
        </label>
      </div>

      {mostrarForm ? (
        <FormComissao
          pessoas={pessoasAtivas}
          mesPadrao={mesInput(dados.mesAtual)}
          pendente={pendente}
          onCancelar={() => setMostrarForm(false)}
          onEnviar={async (corpo) => {
            const ok = await enviar("/api/financeiro/comissoes", "POST", corpo);
            if (ok) setMostrarForm(false);
            return ok;
          }}
        />
      ) : null}

      <section className="card">
        <h2 className="card-title">Comissão por pessoa, mês a mês</h2>
        <p className="fin-card-hint">
          Cada célula soma todas as comissões daquele mês (várias descrições). A coluna{" "}
          {monthKeyLabel(dados.mesSeguinte)} é projetada — já lançada, ainda não no caixa. ▸ abre o detalhe.
        </p>

        <div className="fin-matrix-wrap">
          <table className="fin-table fin-matrix fin-matrix-reembolso">
            <thead>
              <tr>
                <th className="fin-matrix-head">Pessoa</th>
                {mesesVisiveis.map((mes) => (
                  <th key={mes} className="num">
                    <span className="fin-mes-head">
                      <span>{new Date(`${mes}T12:00:00`).toLocaleDateString("pt-BR", { month: "long" })}</span>
                      <small>{new Date(`${mes}T12:00:00`).toLocaleDateString("pt-BR", { year: "numeric" })}</small>
                    </span>
                    {mes === dados.mesSeguinte ? <span className="fin-tag">proj.</span> : null}
                  </th>
                ))}
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((linha) => {
                const expandida = aberta === linha.id;
                const detalhe = linha.itens
                  .filter((i) => mesesVisiveis.includes(i.competencia))
                  .sort((a, b) => b.competencia.localeCompare(a.competencia) || b.id - a.id);
                return (
                  <Fragment key={linha.id}>
                    <tr className={expandida ? "fin-linha-aberta" : undefined}>
                      <th className="fin-matrix-head">
                        <button
                          type="button"
                          className="fin-pessoa-toggle"
                          aria-expanded={expandida}
                          onClick={() => setAberta(expandida ? null : linha.id)}
                        >
                          {expandida ? "▾" : "▸"} {linha.nome}
                          <span className="fin-tag">{ROTULO_VINCULO[linha.vinculo] ?? linha.vinculo}</span>
                        </button>
                      </th>
                      {mesesVisiveis.map((mes) => {
                        const v = linha.porMes[mes] ?? 0;
                        return (
                          <td key={mes} className={`num fin-table-money${mes === dados.mesSeguinte ? " fin-previsao" : ""}`}>
                            {v ? brlPrecise(v) : <span className="fin-zero">—</span>}
                          </td>
                        );
                      })}
                      <td className="num fin-table-money">
                        <strong>{linha.total ? brlPrecise(linha.total) : "—"}</strong>
                      </td>
                    </tr>
                    {expandida
                      ? detalhe.map((item) => (
                          <tr key={item.id} className="fin-linha-detalhe">
                            <th className="fin-matrix-head">
                              <span className="fin-desc-sub">
                                {item.descricao}
                                {item.serieId ? ` · série #${item.serieId}` : ""}
                              </span>
                            </th>
                            {mesesVisiveis.map((mes) => (
                              <td key={mes} className="num fin-table-money">
                                {item.competencia === mes ? brlPrecise(item.valorCents) : <span className="fin-zero">—</span>}
                              </td>
                            ))}
                            <td className="num">
                              {!item.serieId ? (
                                <button
                                  type="button"
                                  className="fin-btn-ghost"
                                  disabled={pendente}
                                  onClick={() => enviar(`/api/financeiro/comissoes/${item.id}`, "DELETE")}
                                >
                                  excluir
                                </button>
                              ) : (
                                <span className="fin-desc-sub">parcela</span>
                              )}
                            </td>
                          </tr>
                        ))
                      : null}
                  </Fragment>
                );
              })}
              {!linhas.length ? (
                <tr>
                  <td colSpan={mesesVisiveis.length + 2} className="fin-empty-row">
                    Nenhuma comissão neste recorte. Use “Lançar comissão”.
                  </td>
                </tr>
              ) : null}
            </tbody>
            <tfoot>
              <tr>
                <th className="fin-matrix-head">Total</th>
                {mesesVisiveis.map((mes) => (
                  <td key={mes} className="num fin-table-money">
                    {totalPorMes[mes] ? <strong>{brlPrecise(totalPorMes[mes])}</strong> : <span className="fin-zero">—</span>}
                  </td>
                ))}
                <td className="num fin-table-money">
                  <strong>{brlPrecise(totalGeral)}</strong>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {dados.series.length ? (
        <section className="card">
          <h2 className="card-title">Séries parceladas</h2>
          <p className="fin-card-hint">Excluir a série remove todas as parcelas de uma vez.</p>
          <div className="table-wrap">
            <table className="fin-table">
              <thead>
                <tr>
                  <th>Pessoa</th>
                  <th>Descrição</th>
                  <th className="num">Total</th>
                  <th className="num">Parcelas</th>
                  <th className="num">A cair</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {dados.series
                  .filter((s) => pessoaFiltro === "" || s.personId === pessoaFiltro)
                  .map((s) => (
                    <tr key={s.id}>
                      <td>{s.pessoa}</td>
                      <td>
                        {s.descricao}
                        <span className="fin-desc-sub">
                          desde {monthKeyLabel(s.primeiraCompetencia)} · {s.parcelasLancadas}/{s.parcelasTotal}
                        </span>
                      </td>
                      <td className="num fin-table-money">{brlPrecise(s.totalCents)}</td>
                      <td className="num">{brlPrecise(s.valorParcelaCents)} × {s.parcelasTotal}</td>
                      <td className="num fin-table-money">{brlPrecise(s.projetadoRestanteCents)}</td>
                      <td className="num">
                        <button
                          type="button"
                          className="fin-btn-ghost"
                          disabled={pendente}
                          onClick={() => enviar(`/api/financeiro/comissoes/serie/${s.id}`, "DELETE")}
                        >
                          excluir série
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}

function FormComissao({
  pessoas,
  mesPadrao,
  pendente,
  onCancelar,
  onEnviar
}: {
  pessoas: PainelComissoes["pessoas"];
  mesPadrao: string;
  pendente: boolean;
  onCancelar: () => void;
  onEnviar: (corpo: Record<string, unknown>) => Promise<boolean>;
}) {
  const [modo, setModo] = useState<"avulsa" | "parcelada">("avulsa");
  const [personId, setPersonId] = useState(pessoas[0]?.id ? String(pessoas[0].id) : "");
  const [descricao, setDescricao] = useState("");
  const [nota, setNota] = useState("");
  const [valor, setValor] = useState("");
  const [competencia, setCompetencia] = useState(mesPadrao);
  const [parcelas, setParcelas] = useState("3");
  const [erroLocal, setErroLocal] = useState<string | null>(null);

  const pessoa = pessoas.find((p) => p.id === Number(personId));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErroLocal(null);
    const valorCents = centavosDoTexto(valor);
    if (valorCents === null) {
      return setErroLocal("informe um valor — use 0,00 para declarar que não houve comissão no mês");
    }
    // Parcelar zero não existe; à vista, zero é a declaração de que não houve.
    if (modo === "parcelada" && valorCents <= 0) {
      return setErroLocal("parcelamento exige um valor maior que zero");
    }
    // A descrição deixou de barrar: vazia, o servidor grava "Sem comissão no
    // mês" ou "Comissão". A linha continua se explicando, sem travar quem só
    // queria zerar o mês.

    if (modo === "avulsa") {
      await onEnviar({
        modo: "avulsa",
        personId: Number(personId),
        competencia,
        valorCents,
        descricao: descricao.trim(),
        nota: nota.trim() || null
      });
      return;
    }

    const n = Number(parcelas);
    if (!Number.isInteger(n) || n < 2) return setErroLocal("parcelas: mínimo 2");
    await onEnviar({
      modo: "parcelada",
      personId: Number(personId),
      primeiraCompetencia: competencia,
      totalCents: valorCents,
      parcelas: n,
      descricao: descricao.trim(),
      nota: nota.trim() || null
    });
  }

  return (
    <section className="card">
      <h2 className="card-title">Nova comissão</h2>
      <form className="fin-form" onSubmit={submit}>
        <div className="fin-form-row">
          <label>
            Pessoa
            <select value={personId} onChange={(e) => setPersonId(e.target.value)} required>
              {pessoas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                  {!p.temSalarioBase ? " (sem salário-base)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Modo
            <select value={modo} onChange={(e) => setModo(e.target.value as "avulsa" | "parcelada")}>
              <option value="avulsa">À vista (um mês)</option>
              <option value="parcelada">Parcelada (vários meses)</option>
            </select>
          </label>
        </div>
        {pessoa && !pessoa.temSalarioBase ? (
          <p className="fin-card-hint">
            Sem salário-base a composição do perfil não separa comissão do PIX — o lançamento fica gravado e passa a
            valer assim que a base existir.
          </p>
        ) : null}
        <label>
          Descrição
          <input
            className="fin-input"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="Ex.: Comissão obra Residencial Aurora (opcional)"
          />
        </label>
        <div className="fin-form-row">
          <label>
            {modo === "avulsa" ? "Valor" : "Valor total"}
            <input
              className="fin-input"
              value={valor}
              onChange={(e) => setValor(mascaraDinheiro(e.target.value))}
              inputMode="numeric"
              placeholder="0,00"
              required
            />
          </label>
          <label>
            {modo === "avulsa" ? "Mês" : "Primeira competência"}
            <input className="fin-input" type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)} required />
          </label>
          {modo === "parcelada" ? (
            <label>
              Nº de parcelas
              <input
                className="fin-input"
                type="number"
                min={2}
                max={60}
                value={parcelas}
                onChange={(e) => setParcelas(e.target.value)}
              />
            </label>
          ) : null}
        </div>
        <label>
          Nota (opcional)
          <input className="fin-input" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Fonte / observação" />
        </label>
        {erroLocal ? <p className="fin-alert">{erroLocal}</p> : null}
        <div className="fin-contas-acoes">
          <button type="submit" className="fin-btn-primary" disabled={pendente}>
            {pendente ? "Salvando…" : "Salvar"}
          </button>
          <button type="button" className="fin-btn-ghost" onClick={onCancelar}>
            Cancelar
          </button>
        </div>
      </form>
    </section>
  );
}

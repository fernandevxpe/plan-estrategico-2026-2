"use client";

import { Fragment, useMemo, useState } from "react";

import type { ComissaoItem, ComissaoSerie, PainelComissoes } from "@/lib/financeiro/comissoes";
import { brlCents, brlPrecise, monthKeyLabel } from "@/lib/financeiro/format";

/**
 * Gestão do mês — pedido do dono em 30/10/2026, depois de cadastrar 22
 * comissões de outubro numa tarde (ids 161–182): "ver os recentes, excluir o
 * que foi preenchido errado, editar, ver todas do mês, por pessoa, por tipo,
 * as parcelas". A matriz pessoa × mês (abaixo) responde "quanto"; ela não
 * respondia "quais linhas", e era só nela que dava para mexer.
 *
 * Tudo aqui é recorte em memória de `dados.itens` (12 meses para trás, 24 para
 * frente): nenhuma consulta nova, e o filtro responde a cada tecla.
 */

type Aba = "mes" | "recentes" | "parcelas" | "pessoa";
type Agrupar = "nenhum" | "pessoa" | "tipo";
type Ordem = "pessoa" | "valor" | "criado" | "tipo";

const ABAS: { id: Aba; rotulo: string }[] = [
  { id: "mes", rotulo: "Todas do mês" },
  { id: "recentes", rotulo: "Recentes" },
  { id: "parcelas", rotulo: "Parcelas" },
  { id: "pessoa", rotulo: "Por pessoa" }
];

/** Recentes = últimos 7 dias: cobre uma semana de cadastro sem virar o histórico inteiro. */
const DIAS_RECENTES = 7;

function avancar(iso: string, n: number): string {
  const [a, m] = iso.slice(0, 7).split("-").map(Number);
  return new Date(Date.UTC(a, m - 1 + n, 1)).toISOString().slice(0, 10);
}

function dataHora(iso: string): string {
  const [d, h] = iso.split("T");
  return `${d.slice(8, 10)}/${d.slice(5, 7)} ${h?.slice(0, 5) ?? ""}`;
}

function mascaraDinheiro(texto: string): string {
  const digitos = texto.replace(/\D/g, "");
  if (!digitos) return "";
  return (Number(digitos) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function centavos(texto: string): number | null {
  const limpo = texto.trim().replace(/[R$\s]/g, "");
  if (!limpo) return null;
  const n = Number(limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

function rotuloForma(i: ComissaoItem): string {
  if (!i.serieId) return "à vista";
  if (i.ehEntrada) return `entrada · ${i.parcela}/${i.parcelasTotal}`;
  return `parcela ${i.parcela}/${i.parcelasTotal}`;
}

type Enviar = (url: string, metodo: string, corpo?: unknown) => Promise<boolean>;

export function FinComissoesGestao({
  dados,
  enviar,
  pendente
}: {
  dados: PainelComissoes;
  enviar: Enviar;
  pendente: boolean;
}) {
  const [mes, setMes] = useState(dados.mesAtual);
  const [aba, setAba] = useState<Aba>("mes");
  const [pessoa, setPessoa] = useState<number | "">("");
  const [tipo, setTipo] = useState<string>("");
  const [busca, setBusca] = useState("");
  const [agrupar, setAgrupar] = useState<Agrupar>("nenhum");
  const [ordem, setOrdem] = useState<Ordem>("pessoa");
  // "Todas do mês" filtrava só pela competência, e o dono leu como "tudo": em
  // outubro eram 59 linhas, 22 delas cadastradas em 30/10 e o resto semanas
  // antes. Quem confere o que digitou quer o recorte pela DATA DO CADASTRO.
  const [criterio, setCriterio] = useState<"competencia" | "cadastro">("competencia");
  const [editando, setEditando] = useState<number | null>(null);
  const [editandoSerie, setEditandoSerie] = useState<number | null>(null);

  const mesesComDado = useMemo(() => {
    const s = new Set(dados.itens.map((i) => i.competencia));
    s.add(dados.mesAtual);
    s.add(dados.mesSeguinte);
    s.add(mes);
    return [...s].sort().reverse();
  }, [dados.itens, dados.mesAtual, dados.mesSeguinte, mes]);

  const doMes = useMemo(() => dados.itens.filter((i) => i.competencia === mes), [dados.itens, mes]);
  const doMesAnterior = useMemo(
    () => dados.itens.filter((i) => i.competencia === avancar(mes, -1)),
    [dados.itens, mes]
  );

  const resumo = useMemo(() => {
    const total = doMes.reduce((s, i) => s + i.valorCents, 0);
    const noBanco = doMes.filter((i) => i.ordemNoBanco).reduce((s, i) => s + i.valorCents, 0);
    const anterior = doMesAnterior.reduce((s, i) => s + i.valorCents, 0);
    return {
      total,
      noBanco,
      falta: total - noBanco,
      anterior,
      n: doMes.length,
      nParcelas: doMes.filter((i) => i.serieId).length,
      pessoas: new Set(doMes.map((i) => i.personId)).size
    };
  }, [doMes, doMesAnterior]);

  const termo = busca.trim().toLocaleLowerCase("pt-BR");
  const passaFiltro = (i: ComissaoItem) =>
    (pessoa === "" || i.personId === pessoa) &&
    (tipo === "" || (i.tipoSlug ?? "sem_tipo") === tipo) &&
    (!termo ||
      `${i.pessoa} ${i.descricao} ${i.cliente ?? ""} ${i.tipoNome ?? ""} ${i.nota ?? ""}`
        .toLocaleLowerCase("pt-BR")
        .includes(termo));

  const ordenar = (a: ComissaoItem, b: ComissaoItem) => {
    if (ordem === "valor") return b.valorCents - a.valorCents;
    if (ordem === "criado") return b.criadoEm.localeCompare(a.criadoEm);
    if (ordem === "tipo") return (a.tipoNome ?? "~").localeCompare(b.tipoNome ?? "~", "pt-BR") || b.valorCents - a.valorCents;
    return a.pessoa.localeCompare(b.pessoa, "pt-BR") || b.valorCents - a.valorCents;
  };

  const cadastradasNoMes = useMemo(
    () => dados.itens.filter((i) => i.criadoEm.slice(0, 7) === mes.slice(0, 7)),
    [dados.itens, mes]
  );
  const baseDaTabela = criterio === "cadastro" ? cadastradasNoMes : doMes;
  // Cadastradas no mês podem ter competência de outro mês: aí a coluna Mês aparece.
  const comMes = criterio === "cadastro";
  const filtradas = useMemo(() => baseDaTabela.filter(passaFiltro).sort(ordenar), // eslint-disable-next-line react-hooks/exhaustive-deps
    [baseDaTabela, pessoa, tipo, termo, ordem]);

  const grupos = useMemo(() => {
    if (agrupar === "nenhum") return [{ chave: "", rotulo: "", itens: filtradas }];
    const mapa = new Map<string, { chave: string; rotulo: string; itens: ComissaoItem[] }>();
    for (const i of filtradas) {
      const chave = agrupar === "pessoa" ? String(i.personId) : (i.tipoSlug ?? "sem_tipo");
      const rotulo = agrupar === "pessoa" ? i.pessoa : (i.tipoNome ?? "Sem tipo");
      if (!mapa.has(chave)) mapa.set(chave, { chave, rotulo, itens: [] });
      mapa.get(chave)!.itens.push(i);
    }
    return [...mapa.values()].sort(
      (a, b) => b.itens.reduce((s, i) => s + i.valorCents, 0) - a.itens.reduce((s, i) => s + i.valorCents, 0)
    );
  }, [filtradas, agrupar]);

  const recentes = useMemo(() => {
    const [a, m, d] = dados.hoje.split("-").map(Number);
    const corte = new Date(Date.UTC(a, m - 1, d - (DIAS_RECENTES - 1))).toISOString().slice(0, 10);
    return dados.itens
      .filter((i) => i.criadoEm.slice(0, 10) >= corte)
      .filter(passaFiltro)
      .sort((x, y) => y.criadoEm.localeCompare(x.criadoEm) || y.id - x.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dados.itens, dados.hoje, pessoa, tipo, termo]);
  const deHoje = recentes.filter((i) => i.criadoEm.startsWith(dados.hoje));

  const seriesDoMes = useMemo(() => {
    const porSerie = new Map<number, ComissaoItem[]>();
    for (const i of dados.itens) {
      if (!i.serieId) continue;
      if (!porSerie.has(i.serieId)) porSerie.set(i.serieId, []);
      porSerie.get(i.serieId)!.push(i);
    }
    return dados.series
      .map((s) => {
        const linhas = (porSerie.get(s.id) ?? []).sort((a, b) => (a.parcela ?? 0) - (b.parcela ?? 0));
        const noMes = linhas.find((l) => l.competencia === mes) ?? null;
        const ate = linhas.filter((l) => l.competencia <= mes);
        const depois = linhas.filter((l) => l.competencia > mes);
        return {
          serie: s,
          linhas,
          noMes,
          quitadas: ate.length,
          restanteCents: depois.reduce((x, l) => x + l.valorCents, 0),
          ultimoMes: linhas[linhas.length - 1]?.competencia ?? s.primeiraCompetencia
        };
      })
      .filter((x) => x.noMes && passaFiltro(x.noMes));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dados.series, dados.itens, mes, pessoa, tipo, termo]);

  const [pessoaVista, setPessoaVista] = useState<number | "">("");
  const historicoPessoa = useMemo(() => {
    if (pessoaVista === "") return [];
    const porMes = new Map<string, ComissaoItem[]>();
    for (const i of dados.itens) {
      if (i.personId !== pessoaVista) continue;
      if (!porMes.has(i.competencia)) porMes.set(i.competencia, []);
      porMes.get(i.competencia)!.push(i);
    }
    return [...porMes.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [dados.itens, pessoaVista]);
  const [mesAbertoPessoa, setMesAbertoPessoa] = useState<string | null>(null);

  const pessoasComComissao = useMemo(() => {
    const ids = new Set(dados.itens.map((i) => i.personId));
    return dados.pessoas.filter((p) => ids.has(p.id));
  }, [dados.itens, dados.pessoas]);

  async function excluir(i: ComissaoItem) {
    const qual = i.serieId ? `a ${rotuloForma(i)} da série #${i.serieId} (as outras parcelas ficam)` : "esta comissão à vista";
    const ok = window.confirm(
      `Excluir ${qual}?\n\n${i.pessoa} · ${monthKeyLabel(i.competencia)} · ${brlPrecise(i.valorCents)}\n${i.descricao}\n\nNão dá para desfazer.`
    );
    if (ok) await enviar(`/api/financeiro/comissoes/${i.id}`, "DELETE");
  }

  async function excluirSerie(s: ComissaoSerie, n: number) {
    const ok = window.confirm(
      `Excluir a SÉRIE INTEIRA #${s.id}?\n\n${s.pessoa} · ${s.descricao}\n${n} parcelas, ${brlPrecise(s.totalCents)} no total.\n\nTodas as parcelas somem. Não dá para desfazer.`
    );
    if (ok) await enviar(`/api/financeiro/comissoes/serie/${s.id}`, "DELETE");
  }

  const delta = resumo.total - resumo.anterior;
  const totalFiltrado = filtradas.reduce((s, i) => s + i.valorCents, 0);

  function linhaItem(i: ComissaoItem, opcoes: { mostrarMes?: boolean } = {}) {
    const hoje = i.criadoEm.startsWith(dados.hoje);
    return (
      <Fragment key={i.id}>
        <tr className={hoje ? "fin-linha-aberta" : undefined}>
          {opcoes.mostrarMes ? <td>{monthKeyLabel(i.competencia)}</td> : null}
          <td>{i.pessoa}</td>
          <td>
            {i.cliente ?? i.descricao}
            {i.cliente && i.descricao !== `Comissão — ${i.cliente}` ? (
              <span className="fin-desc-sub">{i.descricao}</span>
            ) : null}
            {i.nota ? <span className="fin-desc-sub">{i.nota}</span> : null}
          </td>
          <td>{i.tipoNome ?? <span className="fin-zero">sem tipo</span>}</td>
          <td>
            {rotuloForma(i)}
            {i.ordemNoBanco ? (
              <span className="fin-tag" title="Esta linha entrou numa ordem enviada ao banco: valor, mês, tipo e exclusão travados">
                no banco {i.ordemNoBanco}
              </span>
            ) : null}
          </td>
          <td className="num fin-table-money">{brlPrecise(i.valorCents)}</td>
          <td>
            {dataHora(i.criadoEm)}
            {hoje ? <span className="fin-tag">hoje</span> : null}
          </td>
          <td className="num" style={{ whiteSpace: "nowrap" }}>
            <button
              type="button"
              className="fin-btn-ghost"
              disabled={pendente}
              onClick={() => setEditando(editando === i.id ? null : i.id)}
            >
              {editando === i.id ? "fechar" : "editar"}
            </button>
            <button
              type="button"
              className="fin-btn-ghost"
              disabled={pendente || Boolean(i.ordemNoBanco)}
              title={i.ordemNoBanco ? `já no banco (${i.ordemNoBanco})` : undefined}
              onClick={() => void excluir(i)}
            >
              excluir
            </button>
          </td>
        </tr>
        {editando === i.id ? (
          <tr className="fin-linha-detalhe">
            <td colSpan={opcoes.mostrarMes ? 8 : 7}>
              <FormEditar
                item={i}
                tipos={dados.tipos}
                pendente={pendente}
                onCancelar={() => setEditando(null)}
                onEditarSerie={i.serieId ? () => setEditandoSerie(i.serieId) : undefined}
                onSalvar={async (corpo) => {
                  const ok = await enviar(`/api/financeiro/comissoes/${i.id}`, "PATCH", corpo);
                  if (ok) setEditando(null);
                }}
              />
            </td>
          </tr>
        ) : null}
      </Fragment>
    );
  }

  const cabecalho = (mostrarMes = false) => (
    <thead>
      <tr>
        {mostrarMes ? <th>Mês</th> : null}
        <th>
          <button type="button" className="fin-btn-ghost" onClick={() => setOrdem("pessoa")}>
            Pessoa{ordem === "pessoa" ? " ▾" : ""}
          </button>
        </th>
        <th>Cliente / descrição</th>
        <th>
          <button type="button" className="fin-btn-ghost" onClick={() => setOrdem("tipo")}>
            Tipo{ordem === "tipo" ? " ▾" : ""}
          </button>
        </th>
        <th>Forma</th>
        <th className="num">
          <button type="button" className="fin-btn-ghost" onClick={() => setOrdem("valor")}>
            Valor{ordem === "valor" ? " ▾" : ""}
          </button>
        </th>
        <th>
          <button type="button" className="fin-btn-ghost" onClick={() => setOrdem("criado")}>
            Cadastrada{ordem === "criado" ? " ▾" : ""}
          </button>
        </th>
        <th />
      </tr>
    </thead>
  );

  const serieEmEdicao = editandoSerie != null ? dados.series.find((s) => s.id === editandoSerie) : null;

  return (
    <section className="card" aria-label="Gestão das comissões do mês">
      <div className="fin-contas-acoes" style={{ flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
        <h2 className="card-title" style={{ margin: 0 }}>
          Comissões de
        </h2>
        <button type="button" className="fin-btn-ghost" onClick={() => setMes(avancar(mes, -1))} aria-label="mês anterior">
          ◀
        </button>
        <select value={mes} onChange={(e) => setMes(e.target.value)} aria-label="Mês">
          {mesesComDado.map((m) => (
            <option key={m} value={m}>
              {monthKeyLabel(m)}
              {m === dados.mesAtual ? " (atual)" : ""}
            </option>
          ))}
        </select>
        <button type="button" className="fin-btn-ghost" onClick={() => setMes(avancar(mes, 1))} aria-label="mês seguinte">
          ▶
        </button>
        {mes !== dados.mesAtual ? (
          <button type="button" className="fin-btn-ghost" onClick={() => setMes(dados.mesAtual)}>
            voltar ao mês atual
          </button>
        ) : null}
      </div>

      <div className="fin-kpi-row" style={{ marginTop: "0.75rem" }}>
        <article className="fin-kpi-card">
          <p className="fin-kpi-label">Previsto em {monthKeyLabel(mes)}</p>
          <p className="fin-kpi-value">{brlCents(resumo.total)}</p>
          <p className="fin-kpi-hint">tudo lançado com este mês — à vista e parcelas</p>
        </article>
        <article className="fin-kpi-card">
          <p className="fin-kpi-label">Lançamentos</p>
          <p className="fin-kpi-value">{resumo.n}</p>
          <p className="fin-kpi-hint">
            {resumo.n - resumo.nParcelas} à vista · {resumo.nParcelas} parcelas · {resumo.pessoas}{" "}
            {resumo.pessoas === 1 ? "pessoa" : "pessoas"}
          </p>
        </article>
        <article className="fin-kpi-card">
          <p className="fin-kpi-label">Já no banco / falta</p>
          <p className="fin-kpi-value">{brlCents(resumo.falta)}</p>
          <p className="fin-kpi-hint">{brlCents(resumo.noBanco)} já entrou em ordem enviada ou paga</p>
        </article>
        <article className="fin-kpi-card">
          <p className="fin-kpi-label">vs. {monthKeyLabel(avancar(mes, -1))}</p>
          <p className="fin-kpi-value">
            {delta >= 0 ? "+" : "−"}
            {brlCents(Math.abs(delta))}
          </p>
          <p className="fin-kpi-hint">
            mês anterior: {brlCents(resumo.anterior)}
            {resumo.anterior > 0 ? ` (${delta >= 0 ? "+" : ""}${Math.round((delta / resumo.anterior) * 100)}%)` : ""}
          </p>
        </article>
      </div>

      <div className="fin-com-pacotes" role="tablist" aria-label="Visão" style={{ marginTop: "0.75rem" }}>
        {ABAS.map((a) => (
          <button
            key={a.id}
            type="button"
            role="tab"
            aria-selected={aba === a.id}
            className={`fin-com-pacote${aba === a.id ? " ativo" : ""}`}
            onClick={() => setAba(a.id)}
          >
            <strong>{a.rotulo}</strong>
            <span className="fin-kpi-hint">
              {a.id === "mes"
                ? `${doMes.length} em ${monthKeyLabel(mes)}`
                : a.id === "recentes"
                  ? `${deHoje.length} hoje`
                  : a.id === "parcelas"
                    ? `${dados.itens.filter((i) => i.serieId && i.competencia === mes).length} caem no mês`
                    : "histórico"}
            </span>
          </button>
        ))}
      </div>

      {aba !== "pessoa" ? (
        <div className="fin-contas-acoes" style={{ flexWrap: "wrap", gap: "0.75rem", marginTop: "0.75rem" }}>
          <label className="fin-check">
            Pessoa
            <select value={pessoa === "" ? "" : String(pessoa)} onChange={(e) => setPessoa(e.target.value ? Number(e.target.value) : "")}>
              <option value="">Todas</option>
              {pessoasComComissao.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
          </label>
          <label className="fin-check">
            Tipo
            <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="">Todos</option>
              {dados.tipos.map((t) => (
                <option key={t.slug} value={t.slug}>
                  {t.nome}
                </option>
              ))}
              <option value="sem_tipo">Sem tipo</option>
            </select>
          </label>
          <input
            className="fin-input"
            type="search"
            placeholder="Buscar cliente, descrição, nota…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            style={{ maxWidth: 280 }}
          />
          {aba === "mes" ? (
            <label className="fin-check">
              Mostrar
              <select value={criterio} onChange={(e) => setCriterio(e.target.value as "competencia" | "cadastro")}>
                <option value="competencia">competência de {monthKeyLabel(mes)} ({doMes.length})</option>
                <option value="cadastro">cadastradas em {monthKeyLabel(mes)} ({cadastradasNoMes.length})</option>
              </select>
            </label>
          ) : null}
          {aba === "mes" ? (
            <label className="fin-check">
              Agrupar
              <select value={agrupar} onChange={(e) => setAgrupar(e.target.value as Agrupar)}>
                <option value="nenhum">não agrupar</option>
                <option value="pessoa">por pessoa</option>
                <option value="tipo">por tipo</option>
              </select>
            </label>
          ) : null}
        </div>
      ) : null}

      {serieEmEdicao ? (
        <FormEditarSerie
          serie={serieEmEdicao}
          tipos={dados.tipos}
          pendente={pendente}
          onCancelar={() => setEditandoSerie(null)}
          onSalvar={async (corpo) => {
            const ok = await enviar(`/api/financeiro/comissoes/serie/${serieEmEdicao.id}`, "PATCH", corpo);
            if (ok) setEditandoSerie(null);
          }}
        />
      ) : null}

      {aba === "mes" ? (
        <p className="fin-card-hint" style={{ marginTop: "0.75rem", fontSize: "1rem" }}>
          Na tabela: <strong>{filtradas.length}</strong> {filtradas.length === 1 ? "lançamento" : "lançamentos"} ·{" "}
          <strong>{brlPrecise(totalFiltrado)}</strong> · {new Set(filtradas.map((i) => i.personId)).size}{" "}
          {new Set(filtradas.map((i) => i.personId)).size === 1 ? "pessoa" : "pessoas"}
          {comMes ? ` · cadastradas em ${monthKeyLabel(mes)}` : ` · competência ${monthKeyLabel(mes)}`}
        </p>
      ) : null}
      {aba === "mes" ? (
        <div className="table-wrap" style={{ marginTop: "0.75rem" }}>
          <table className="fin-table">
            {cabecalho(comMes)}
            <tbody>
              {grupos.map((g) => (
                <Fragment key={g.chave || "todos"}>
                  {agrupar !== "nenhum" ? (
                    <tr className="fin-linha-aberta">
                      <th colSpan={comMes ? 6 : 5}>
                        {g.rotulo} <span className="fin-desc-sub">{g.itens.length} lançamentos</span>
                      </th>
                      <td className="num fin-table-money">
                        <strong>{brlPrecise(g.itens.reduce((s, i) => s + i.valorCents, 0))}</strong>
                      </td>
                      <td colSpan={2} />
                    </tr>
                  ) : null}
                  {g.itens.map((i) => linhaItem(i, { mostrarMes: comMes }))}
                </Fragment>
              ))}
              {!filtradas.length ? (
                <tr>
                  <td colSpan={comMes ? 8 : 7} className="fin-empty-row">
                    Nenhuma comissão {comMes ? "cadastrada" : ""} em {monthKeyLabel(mes)} neste filtro.
                  </td>
                </tr>
              ) : null}
            </tbody>
            <tfoot>
              <tr>
                <th colSpan={comMes ? 6 : 5}>
                  Total {filtradas.length !== baseDaTabela.length ? `(filtro: ${filtradas.length} de ${baseDaTabela.length})` : ""}
                </th>
                <td className="num fin-table-money">
                  <strong>{brlPrecise(totalFiltrado)}</strong>
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      ) : null}

      {aba === "recentes" ? (
        <>
          <p className="fin-card-hint" style={{ marginTop: "0.75rem" }}>
            Cadastradas nos últimos {DIAS_RECENTES} dias, a mais nova primeiro, de qualquer mês de competência.
            Hoje: {deHoje.length} {deHoje.length === 1 ? "lançamento" : "lançamentos"},{" "}
            {brlPrecise(deHoje.reduce((s, i) => s + i.valorCents, 0))}.
          </p>
          <div className="table-wrap">
            <table className="fin-table">
              {cabecalho(true)}
              <tbody>
                {recentes.map((i) => linhaItem(i, { mostrarMes: true }))}
                {!recentes.length ? (
                  <tr>
                    <td colSpan={8} className="fin-empty-row">
                      Nada cadastrado nos últimos {DIAS_RECENTES} dias.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {aba === "parcelas" ? (
        <>
          <p className="fin-card-hint" style={{ marginTop: "0.75rem" }}>
            Séries com parcela em {monthKeyLabel(mes)}. “Até o mês” conta as parcelas com competência até{" "}
            {monthKeyLabel(mes)}; “restante” é o que cai depois. Para mudar o valor de uma parcela, edite a linha — o total
            da série se recalcula.
          </p>
          <div className="table-wrap">
            <table className="fin-table">
              <thead>
                <tr>
                  <th>Pessoa</th>
                  <th>Série</th>
                  <th>Parcela no mês</th>
                  <th className="num">Valor no mês</th>
                  <th>Até o mês</th>
                  <th className="num">Restante</th>
                  <th className="num">Total</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {seriesDoMes.map(({ serie, linhas, noMes, quitadas, restanteCents, ultimoMes }) => (
                  <tr key={serie.id}>
                    <td>{serie.pessoa}</td>
                    <td>
                      {serie.cliente ?? serie.descricao}
                      <span className="fin-desc-sub">
                        #{serie.id} · {serie.tipoNome ?? "sem tipo"} · {monthKeyLabel(serie.primeiraCompetencia)} a{" "}
                        {monthKeyLabel(ultimoMes)}
                      </span>
                    </td>
                    <td>{noMes ? rotuloForma(noMes) : "—"}</td>
                    <td className="num fin-table-money">{noMes ? brlPrecise(noMes.valorCents) : "—"}</td>
                    <td>
                      <progress max={linhas.length || 1} value={quitadas} style={{ width: 70, marginRight: 6 }} />
                      {quitadas}/{linhas.length}
                    </td>
                    <td className="num fin-table-money">{brlPrecise(restanteCents)}</td>
                    <td className="num fin-table-money">{brlPrecise(serie.totalCents)}</td>
                    <td className="num" style={{ whiteSpace: "nowrap" }}>
                      <button type="button" className="fin-btn-ghost" disabled={pendente} onClick={() => setEditandoSerie(serie.id)}>
                        editar série
                      </button>
                      <button
                        type="button"
                        className="fin-btn-ghost"
                        disabled={pendente || linhas.some((l) => l.ordemNoBanco)}
                        title={linhas.some((l) => l.ordemNoBanco) ? "há parcela já no banco — exclua só as que não saíram" : undefined}
                        onClick={() => void excluirSerie(serie, linhas.length)}
                      >
                        excluir série
                      </button>
                    </td>
                  </tr>
                ))}
                {!seriesDoMes.length ? (
                  <tr>
                    <td colSpan={8} className="fin-empty-row">
                      Nenhuma parcela cai em {monthKeyLabel(mes)} neste filtro.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {aba === "pessoa" ? (
        <>
          <div className="fin-contas-acoes" style={{ marginTop: "0.75rem" }}>
            <label className="fin-check">
              Pessoa
              <select
                value={pessoaVista === "" ? "" : String(pessoaVista)}
                onChange={(e) => {
                  setPessoaVista(e.target.value ? Number(e.target.value) : "");
                  setMesAbertoPessoa(null);
                }}
              >
                <option value="">Escolha…</option>
                {pessoasComComissao.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {pessoaVista !== "" ? (
            <div className="table-wrap">
              <table className="fin-table">
                <thead>
                  <tr>
                    <th>Mês</th>
                    <th className="num">Lançamentos</th>
                    <th className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {historicoPessoa.map(([m, itens]) => {
                    const aberto = mesAbertoPessoa === m;
                    return (
                      <Fragment key={m}>
                        <tr className={aberto ? "fin-linha-aberta" : undefined}>
                          <th>
                            <button type="button" className="fin-pessoa-toggle" onClick={() => setMesAbertoPessoa(aberto ? null : m)}>
                              {aberto ? "▾" : "▸"} {monthKeyLabel(m)}
                              {m > dados.mesAtual ? <span className="fin-tag">futuro</span> : null}
                            </button>
                          </th>
                          <td className="num">{itens.length}</td>
                          <td className="num fin-table-money">
                            <strong>{brlPrecise(itens.reduce((s, i) => s + i.valorCents, 0))}</strong>
                          </td>
                        </tr>
                        {aberto ? (
                          <tr>
                            <td colSpan={3}>
                              <table className="fin-table">
                                {cabecalho()}
                                <tbody>{[...itens].sort(ordenar).map((i) => linhaItem(i))}</tbody>
                              </table>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <th>Total (janela da tela)</th>
                    <td className="num">{historicoPessoa.reduce((s, [, i]) => s + i.length, 0)}</td>
                    <td className="num fin-table-money">
                      <strong>
                        {brlPrecise(historicoPessoa.reduce((s, [, i]) => s + i.reduce((x, y) => x + y.valorCents, 0), 0))}
                      </strong>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <p className="fin-card-hint">Escolha uma pessoa para ver todos os meses dela, com as linhas de cada mês.</p>
          )}
        </>
      ) : null}
    </section>
  );
}

function FormEditar({
  item,
  tipos,
  pendente,
  onCancelar,
  onSalvar,
  onEditarSerie
}: {
  item: ComissaoItem;
  tipos: PainelComissoes["tipos"];
  pendente: boolean;
  onCancelar: () => void;
  onSalvar: (corpo: Record<string, unknown>) => Promise<void>;
  onEditarSerie?: () => void;
}) {
  const [valor, setValor] = useState(mascaraDinheiro(String(item.valorCents)));
  const [competencia, setCompetencia] = useState(item.competencia.slice(0, 7));
  const [descricao, setDescricao] = useState(item.descricao);
  const [cliente, setCliente] = useState(item.cliente ?? "");
  const [tipoSlug, setTipoSlug] = useState(item.tipoSlug ?? "");
  const [nota, setNota] = useState(item.nota ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const travado = Boolean(item.ordemNoBanco);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    const cents = centavos(valor);
    if (cents === null) return setErro("informe o valor (0,00 vale)");
    if (!descricao.trim()) return setErro("a descrição não pode ficar vazia");
    // Só manda o que mudou: o servidor trava valor/mês/tipo em mês já pago, e
    // reenviar o valor igual não deve esbarrar nessa trava.
    const corpo: Record<string, unknown> = {};
    if (cents !== item.valorCents) corpo.valorCents = cents;
    if (competencia !== item.competencia.slice(0, 7)) corpo.competencia = competencia;
    if (descricao.trim() !== item.descricao) corpo.descricao = descricao.trim();
    if ((cliente.trim() || null) !== item.cliente) corpo.cliente = cliente.trim() || null;
    if ((tipoSlug || null) !== item.tipoSlug) corpo.tipoSlug = tipoSlug || null;
    if ((nota.trim() || null) !== item.nota) corpo.nota = nota.trim() || null;
    if (!Object.keys(corpo).length) return onCancelar();
    await onSalvar(corpo);
  }

  return (
    <form className="fin-form" onSubmit={submit}>
      {travado ? (
        <p className="fin-card-hint">
          Esta linha entrou na ordem {item.ordemNoBanco}, já enviada ao banco: valor, mês e tipo não mudam (mudar faria a
          conta da ordem não fechar). Descrição, cliente e nota podem.
        </p>
      ) : null}
      <div className="fin-form-row">
        <label>
          Valor
          <input
            className="fin-input"
            value={valor}
            inputMode="numeric"
            disabled={travado}
            onChange={(e) => setValor(mascaraDinheiro(e.target.value))}
          />
        </label>
        <label>
          Mês
          <input className="fin-input" type="month" value={competencia} disabled={travado} onChange={(e) => setCompetencia(e.target.value)} />
        </label>
        <label>
          Tipo
          <select value={tipoSlug} disabled={travado} onChange={(e) => setTipoSlug(e.target.value)}>
            <option value="">Sem tipo</option>
            {tipos.map((t) => (
              <option key={t.slug} value={t.slug}>
                {t.nome}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="fin-form-row">
        <label>
          Cliente / obra
          <input className="fin-input" value={cliente} onChange={(e) => setCliente(e.target.value)} />
        </label>
        <label>
          Descrição
          <input className="fin-input" value={descricao} onChange={(e) => setDescricao(e.target.value)} required />
        </label>
        <label>
          Nota
          <input className="fin-input" value={nota} onChange={(e) => setNota(e.target.value)} />
        </label>
      </div>
      {item.serieId ? (
        <p className="fin-card-hint">
          Esta é a {rotuloForma(item)} da série #{item.serieId}: aqui você muda só esta parcela.{" "}
          {onEditarSerie ? (
            <button type="button" className="fin-btn-ghost" onClick={onEditarSerie}>
              editar a série inteira
            </button>
          ) : null}
        </p>
      ) : null}
      {erro ? <p className="fin-alert">{erro}</p> : null}
      <div className="fin-contas-acoes">
        <button type="submit" className="fin-btn-primary" disabled={pendente}>
          {pendente ? "Salvando…" : "Salvar"}
        </button>
        <button type="button" className="fin-btn-ghost" onClick={onCancelar}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function FormEditarSerie({
  serie,
  tipos,
  pendente,
  onCancelar,
  onSalvar
}: {
  serie: ComissaoSerie;
  tipos: PainelComissoes["tipos"];
  pendente: boolean;
  onCancelar: () => void;
  onSalvar: (corpo: Record<string, unknown>) => Promise<void>;
}) {
  const [descricao, setDescricao] = useState(serie.descricao);
  const [cliente, setCliente] = useState(serie.cliente ?? "");
  const [tipoSlug, setTipoSlug] = useState(serie.tipoSlug ?? "");
  const [nota, setNota] = useState(serie.nota ?? "");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const corpo: Record<string, unknown> = {};
    if (descricao.trim() !== serie.descricao) corpo.descricao = descricao.trim();
    if ((cliente.trim() || null) !== serie.cliente) corpo.cliente = cliente.trim() || null;
    if ((tipoSlug || null) !== serie.tipoSlug) corpo.tipoSlug = tipoSlug || null;
    if ((nota.trim() || null) !== serie.nota) corpo.nota = nota.trim() || null;
    if (!Object.keys(corpo).length) return onCancelar();
    await onSalvar(corpo);
  }

  return (
    <form className="fin-form card" onSubmit={submit} style={{ marginTop: "0.75rem" }}>
      <h3 className="card-title">
        Editar série #{serie.id} — {serie.pessoa}
      </h3>
      <p className="fin-card-hint">
        Vale para todas as {serie.parcelasLancadas} parcelas. Total ({brlPrecise(serie.totalCents)}) e nº de parcelas não
        mudam aqui: recriar o cronograma apagaria parcelas que podem já ter saído no banco. Para corrigir valor, edite a
        parcela; para refazer o parcelamento, exclua a série e lance de novo.
      </p>
      <div className="fin-form-row">
        <label>
          Descrição
          <input className="fin-input" value={descricao} onChange={(e) => setDescricao(e.target.value)} required />
        </label>
        <label>
          Cliente / obra
          <input className="fin-input" value={cliente} onChange={(e) => setCliente(e.target.value)} />
        </label>
      </div>
      <div className="fin-form-row">
        <label>
          Tipo
          <select value={tipoSlug} onChange={(e) => setTipoSlug(e.target.value)}>
            <option value="">Sem tipo</option>
            {tipos.map((t) => (
              <option key={t.slug} value={t.slug}>
                {t.nome}
              </option>
            ))}
          </select>
        </label>
        <label>
          Nota
          <input className="fin-input" value={nota} onChange={(e) => setNota(e.target.value)} />
        </label>
      </div>
      <div className="fin-contas-acoes">
        <button type="submit" className="fin-btn-primary" disabled={pendente}>
          {pendente ? "Salvando…" : "Salvar série"}
        </button>
        <button type="button" className="fin-btn-ghost" onClick={onCancelar}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

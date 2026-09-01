"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type { PainelComissoes } from "@/lib/financeiro/comissoes";
import {
  FORMAS_PAGAMENTO,
  MAX_PARCELAS,
  ROTULO_FORMA,
  type FormaPagamento,
  montarCronograma,
  rotuloParcela
} from "@/lib/financeiro/comissao-cronograma";
import {
  pacoteFiltroDaOrigem,
  type PacoteFiltroComissao
} from "@/lib/financeiro/contas-a-pagar-eixos";
import { brlCents, brlPrecise, monthKeyLabel } from "@/lib/financeiro/format";

type RecortePacote = "todas" | PacoteFiltroComissao;

const PACOTES_TELA: { id: RecortePacote; rotulo: string }[] = [
  { id: "todas", rotulo: "Todas" },
  { id: "consultoria", rotulo: "Consultoria" },
  { id: "obras", rotulo: "Obras" },
  { id: "outras", rotulo: "Outras" }
];

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
  const [pacoteFiltro, setPacoteFiltro] = useState<RecortePacote>("todas");
  const [somenteAtivos, setSomenteAtivos] = useState(true);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [aberta, setAberta] = useState<number | null>(null);

  const pessoasAtivas = useMemo(
    () => (somenteAtivos ? dados.pessoas.filter((p) => p.status === "ativo") : dados.pessoas),
    [dados.pessoas, somenteAtivos]
  );

  const itensNoRecorte = useMemo(() => {
    return dados.itens.filter((i) => {
      if (pessoaFiltro !== "" && i.personId !== pessoaFiltro) return false;
      if (pacoteFiltro !== "todas" && pacoteFiltroDaOrigem(i.tipoSlug) !== pacoteFiltro) return false;
      return true;
    });
  }, [dados.itens, pessoaFiltro, pacoteFiltro]);

  const somaPacote = useMemo(() => {
    const base = dados.itens.filter((i) => pessoaFiltro === "" || i.personId === pessoaFiltro);
    const out: Record<RecortePacote, { cents: number; n: number }> = {
      todas: { cents: 0, n: 0 },
      consultoria: { cents: 0, n: 0 },
      obras: { cents: 0, n: 0 },
      outras: { cents: 0, n: 0 }
    };
    for (const i of base) {
      // O número do cadastro: compromisso deste mês em diante, o mesmo que
      // o KPI "A receber". Filtrar obras e ainda somar o passado misturaria
      // o que já saiu com o que ainda vai cair.
      if (i.competencia < dados.mesAtual) continue;
      const p = pacoteFiltroDaOrigem(i.tipoSlug);
      out[p].cents += i.valorCents;
      out[p].n += 1;
      out.todas.cents += i.valorCents;
      out.todas.n += 1;
    }
    return out;
  }, [dados.itens, dados.mesAtual, pessoaFiltro]);

  const mesesVisiveis = useMemo(() => {
    const ate = dados.mesSeguinte;
    const base = dados.meses.filter((m) => m <= ate);
    const comValor = new Set(itensNoRecorte.map((i) => i.competencia));
    const primeiro = base.findIndex((m) => comValor.has(m) || m === dados.mesAtual || m === dados.mesSeguinte);
    return primeiro <= 0 ? base : base.slice(Math.min(primeiro, Math.max(0, base.length - 8)));
  }, [dados.meses, itensNoRecorte, dados.mesAtual, dados.mesSeguinte]);

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
    for (const item of itensNoRecorte) {
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
  }, [pessoasAtivas, itensNoRecorte, dados.mesAtual, dados.mesSeguinte, pessoaFiltro, mesesVisiveis]);

  const totalPorMes = useMemo(() => {
    const mapa: Record<string, number> = {};
    for (const mes of mesesVisiveis) {
      mapa[mes] = linhas.reduce((s, l) => s + (l.porMes[mes] ?? 0), 0);
    }
    return mapa;
  }, [linhas, mesesVisiveis]);

  const totalGeral = linhas.reduce((s, l) => s + l.total, 0);
  const projetado = linhas.reduce((s, l) => s + (l.porMes[dados.mesSeguinte] ?? 0), 0);
  const aReceberFiltrado = itensNoRecorte
    .filter((i) => i.competencia >= dados.mesAtual)
    .reduce((s, i) => s + i.valorCents, 0);
  const mesesAReceber = useMemo(() => {
    const porMes: Record<string, number> = {};
    for (const i of itensNoRecorte) {
      if (i.competencia < dados.mesAtual) continue;
      porMes[i.competencia] = (porMes[i.competencia] ?? 0) + i.valorCents;
    }
    return Object.keys(porMes)
      .filter((m) => porMes[m] > 0)
      .sort();
  }, [itensNoRecorte, dados.mesAtual]);

  const seriesNoRecorte = useMemo(
    () =>
      dados.series.filter((s) => {
        if (pessoaFiltro !== "" && s.personId !== pessoaFiltro) return false;
        if (pacoteFiltro !== "todas" && pacoteFiltroDaOrigem(s.tipoSlug) !== pacoteFiltro) return false;
        return true;
      }),
    [dados.series, pessoaFiltro, pacoteFiltro]
  );

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

      <section className="card" aria-label="Filtro por origem da comissão">
        <h2 className="card-title">Por origem do cadastro</h2>
        <p className="fin-card-hint">
          Soma do que está lançado deste mês em diante. Consultoria e obras são os dois PIX; o resto (diárias, lotes,
          gestão, sem tipo) cai em Outras. O recorte vale para os totais, a matriz e as séries.
        </p>
        <div className="fin-com-pacotes" role="group" aria-label="Origem da comissão">
          {PACOTES_TELA.map((p) => {
            const ativo = pacoteFiltro === p.id;
            const soma = somaPacote[p.id];
            const pct =
              p.id !== "todas" && somaPacote.todas.cents > 0
                ? Math.round((soma.cents / somaPacote.todas.cents) * 100)
                : null;
            return (
              <button
                key={p.id}
                type="button"
                className={`fin-com-pacote${ativo ? " ativo" : ""}`}
                aria-pressed={ativo}
                onClick={() => setPacoteFiltro(p.id)}
              >
                <span className="fin-kpi-label">{p.rotulo}</span>
                <strong className="fin-kpi-value">{brlCents(soma.cents)}</strong>
                <span className="fin-kpi-hint">
                  {soma.n} {soma.n === 1 ? "lançamento" : "lançamentos"}
                  {pct != null ? ` · ${pct}%` : ""}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="fin-kpi-row" aria-label="Indicadores de comissão">
        <article className="fin-kpi-card">
          {/* O número que o cadastro existe para produzir: compromisso lançado
              que ainda não saiu do caixa, incluindo a cauda das parcelas. */}
          <p className="fin-kpi-label">A receber (deste mês em diante)</p>
          <p className="fin-kpi-value">{brlCents(aReceberFiltrado)}</p>
          <p className="fin-kpi-hint">
            {mesesAReceber.length
              ? `distribuído em ${mesesAReceber.length} ${mesesAReceber.length === 1 ? "mês" : "meses"}, até ${monthKeyLabel(mesesAReceber[mesesAReceber.length - 1])}`
              : "nada lançado para frente"}
          </p>
        </article>
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
          <p className="fin-kpi-value">{seriesNoRecorte.length}</p>
          <p className="fin-kpi-hint">
            {brlPrecise(seriesNoRecorte.reduce((s, x) => s + x.projetadoRestanteCents, 0))} ainda a cair
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
          tipos={dados.tipos}
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
          Cada célula soma as comissões daquele mês neste recorte. A coluna{" "}
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
                                {item.tipoNome ? <span className="fin-tag">{item.tipoNome}</span> : null}
                                {item.cliente ? ` · ${item.cliente}` : ""}
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

      {seriesNoRecorte.length ? (
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
                {seriesNoRecorte.map((s) => (
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

/**
 * Lançamento de comissão, com PRÉVIA DO CRONOGRAMA.
 *
 * A prévia não é enfeite: "entrada de R$ 4.000 e mais 3×" é uma frase que
 * parece clara e esconde três perguntas — em que meses cai, quanto cai em cada
 * um, e onde foi parar o centavo que não divide. A tabela responde as três
 * antes de salvar, e responde chamando `montarCronograma`, a MESMA função que
 * o servidor usa para gravar. O que está na tela é o que vai para o banco.
 */
function FormComissao({
  pessoas,
  tipos,
  mesPadrao,
  pendente,
  onCancelar,
  onEnviar
}: {
  pessoas: PainelComissoes["pessoas"];
  tipos: PainelComissoes["tipos"];
  mesPadrao: string;
  pendente: boolean;
  onCancelar: () => void;
  onEnviar: (corpo: Record<string, unknown>) => Promise<boolean>;
}) {
  const [forma, setForma] = useState<FormaPagamento>("avista");
  const [personId, setPersonId] = useState(pessoas[0]?.id ? String(pessoas[0].id) : "");
  const [tipoSlug, setTipoSlug] = useState(tipos[0]?.slug ?? "");
  const [cliente, setCliente] = useState("");
  const [descricao, setDescricao] = useState("");
  const [nota, setNota] = useState("");
  const [valor, setValor] = useState("");
  const [entrada, setEntrada] = useState("");
  const [competencia, setCompetencia] = useState(mesPadrao);
  const [parcelas, setParcelas] = useState("3");
  const [erroLocal, setErroLocal] = useState<string | null>(null);

  const pessoa = pessoas.find((p) => p.id === Number(personId));
  const totalCents = centavosDoTexto(valor);
  const entradaCents = centavosDoTexto(entrada);

  // A prévia recalcula a cada tecla. É barato — é aritmética — e é o que faz o
  // formulário responder antes de o servidor ser chamado.
  const previa = useMemo(
    () =>
      montarCronograma({
        totalCents: totalCents ?? 0,
        forma,
        parcelas: Number(parcelas) || 0,
        entradaCents: entradaCents ?? 0,
        primeiraCompetencia: competencia
      }),
    [totalCents, forma, parcelas, entradaCents, competencia]
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErroLocal(null);
    if (totalCents === null) {
      return setErroLocal("informe o valor total — use 0,00 para declarar que não houve comissão no mês");
    }
    if (!previa.ok) return setErroLocal(previa.erro);

    await onEnviar({
      personId: Number(personId),
      forma,
      totalCents,
      parcelas: Number(parcelas) || 1,
      entradaCents: entradaCents ?? 0,
      primeiraCompetencia: competencia,
      tipoSlug: tipoSlug || null,
      cliente: cliente.trim() || null,
      descricao: descricao.trim(),
      nota: nota.trim() || null
    });
  }

  const parcelasDaPrevia = previa.ok ? previa.parcelas : [];
  const somaPrevia = parcelasDaPrevia.reduce((s, p) => s + p.valorCents, 0);

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
        </div>

        {pessoa && !pessoa.temSalarioBase ? (
          <p className="fin-card-hint">
            Sem salário-base a composição do perfil não separa comissão do PIX — o lançamento fica gravado e passa a
            valer assim que a base existir.
          </p>
        ) : null}

        <div className="fin-form-row">
          <label>
            Cliente / obra
            <input
              className="fin-input"
              value={cliente}
              onChange={(e) => setCliente(e.target.value)}
              placeholder="Ex.: Residencial Aurora"
            />
          </label>
          <label>
            Descrição
            <input
              className="fin-input"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Opcional — vazia, vira “Comissão — cliente”"
            />
          </label>
        </div>

        <div className="fin-form-row">
          <label>
            Valor total da comissão
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
            Forma de pagamento
            <select value={forma} onChange={(e) => setForma(e.target.value as FormaPagamento)}>
              {FORMAS_PAGAMENTO.map((f) => (
                <option key={f} value={f}>
                  {ROTULO_FORMA[f]}
                </option>
              ))}
            </select>
          </label>
          <label>
            {forma === "avista" ? "Mês" : "Primeiro mês"}
            <input
              className="fin-input"
              type="month"
              value={competencia}
              onChange={(e) => setCompetencia(e.target.value)}
              required
            />
          </label>
        </div>

        {forma !== "avista" ? (
          <div className="fin-form-row">
            {forma === "entrada_parcelas" ? (
              <label>
                Entrada
                <input
                  className="fin-input"
                  value={entrada}
                  onChange={(e) => setEntrada(mascaraDinheiro(e.target.value))}
                  inputMode="numeric"
                  placeholder="0,00"
                />
              </label>
            ) : null}
            <label>
              {forma === "entrada_parcelas" ? "Parcelas depois da entrada" : "Nº de parcelas"}
              <input
                className="fin-input"
                type="number"
                min={forma === "entrada_parcelas" ? 1 : 2}
                max={MAX_PARCELAS}
                value={parcelas}
                onChange={(e) => setParcelas(e.target.value)}
              />
            </label>
          </div>
        ) : null}

        <label>
          Nota
          <input
            className="fin-input"
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            placeholder="Sobre o que se trata, fonte, combinado (opcional)"
          />
        </label>

        {/* ---------------------------------------------------------------
            A prévia. Aparece assim que há valor, e some quando o que foi
            digitado não forma cronograma — com a razão escrita, não com um
            silêncio.
           --------------------------------------------------------------- */}
        {totalCents !== null && totalCents > 0 ? (
          previa.ok ? (
            <div className="fin-matrix-wrap" style={{ marginTop: "0.5rem" }}>
              <table className="fin-table">
                <caption style={{ captionSide: "top", textAlign: "left", padding: "0 0 0.5rem" }}>
                  <strong>Previsão do pagamento</strong> — {parcelasDaPrevia.length}{" "}
                  {parcelasDaPrevia.length === 1 ? "lançamento" : "lançamentos"}, de{" "}
                  {monthKeyLabel(parcelasDaPrevia[0].competencia)} a{" "}
                  {monthKeyLabel(parcelasDaPrevia[parcelasDaPrevia.length - 1].competencia)}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Mês</th>
                    <th scope="col">Parcela</th>
                    <th scope="col" className="num">
                      Valor
                    </th>
                    <th scope="col" className="num">
                      Acumulado
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {parcelasDaPrevia.map((p, i) => {
                    const acumulado = parcelasDaPrevia.slice(0, i + 1).reduce((s, x) => s + x.valorCents, 0);
                    return (
                      <tr key={`${p.competencia}-${p.parcela}`}>
                        <th scope="row">{monthKeyLabel(p.competencia)}</th>
                        <td>
                          {rotuloParcela(p)}
                          {p.ehEntrada ? <span className="fin-tag">entrada</span> : null}
                        </td>
                        <td className="num fin-table-money">{brlPrecise(p.valorCents)}</td>
                        <td className="num fin-table-money fin-previsao">{brlPrecise(acumulado)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" colSpan={2}>
                      Total
                    </th>
                    <td className="num fin-table-money">
                      <strong>{brlPrecise(somaPrevia)}</strong>
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <p className="fin-alert">{previa.erro}</p>
          )
        ) : null}

        {erroLocal ? <p className="fin-alert">{erroLocal}</p> : null}
        <div className="fin-contas-acoes">
          <button type="submit" className="fin-btn-primary" disabled={pendente || (totalCents !== null && totalCents > 0 && !previa.ok)}>
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
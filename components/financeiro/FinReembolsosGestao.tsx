"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type { GestaoReembolsos, ItemGestao } from "@/lib/financeiro/reembolsos";
import { brlPrecise, dateLabel, monthKeyLabel } from "@/lib/financeiro/format";

/**
 * Gestão dos reembolsos por COMPETÊNCIA: o mês inteiro numa lista só, quem
 * lançou hoje, as parcelas, a pessoa mês a mês — e o lápis para corrigir.
 *
 * Fica ACIMA da matriz (que segue lá, intacta) porque a pergunta do dia a dia
 * é "o que entrou para este mês e o que está errado", não "quanto saiu no PIX".
 * Em 30/10/2026 havia 13 itens do app aprovados em outubro, 8 deles lançados no
 * mesmo dia — e a única forma de vê-los era abrir pessoa por pessoa na gaveta.
 */

type Aba = "mes" | "recentes" | "parcelas" | "pessoa";

const ROTULO_STATUS: Record<string, string> = {
  pendente: "pendente",
  aprovado: "aprovado",
  pago: "pago",
  rejeitado: "rejeitado",
  cancelado: "cancelado"
};

const FORA_DO_TOTAL = new Set(["cancelado", "rejeitado"]);

function somarMes(iso: string, n: number) {
  const [a, m] = iso.slice(0, 7).split("-").map(Number);
  return new Date(Date.UTC(a, m - 1 + n, 1)).toISOString().slice(0, 10);
}

function paraCentavos(texto: string): number | null {
  const limpo = texto.trim().replace(/[R$\s]/g, "");
  if (!limpo) return null;
  const normalizado = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  const valor = Number(normalizado);
  return Number.isFinite(valor) ? Math.round(valor * 100) : null;
}

function rotuloCategoria(i: ItemGestao) {
  return i.categoriaNome ?? i.tipoNome ?? "sem categoria";
}

function soma(lista: ItemGestao[]) {
  return lista.reduce((s, i) => s + i.valorCents, 0);
}

export function FinReembolsosGestao({ dados, mesInicial }: { dados: GestaoReembolsos; mesInicial?: string | null }) {
  const router = useRouter();
  const [pendente, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [aba, setAba] = useState<Aba>("mes");
  const [mes, setMes] = useState(() =>
    mesInicial && /^\d{4}-\d{2}$/.test(mesInicial) ? `${mesInicial}-01` : dados.mesAtual
  );
  const [fPessoa, setFPessoa] = useState("");
  const [fCategoria, setFCategoria] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fOrigem, setFOrigem] = useState("");
  const [busca, setBusca] = useState("");
  const [editando, setEditando] = useState<string | null>(null);
  const [pessoaHistorico, setPessoaHistorico] = useState("");

  async function enviar(url: string, metodo: string, corpo: unknown) {
    setErro(null);
    const r = await fetch(url, {
      method: metodo,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo)
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setErro(j.error ?? `falha na operação (HTTP ${r.status})`);
      return false;
    }
    startTransition(() => router.refresh());
    return true;
  }

  async function cancelarItem(item: ItemGestao) {
    const motivo = window.prompt(`Cancelar "${item.descricao}" (${item.pessoa}, ${brlPrecise(item.valorCents)})?\nDiga o motivo:`);
    if (!motivo || !motivo.trim()) return;
    await enviar(`/api/financeiro/reembolsos/${item.id}`, "DELETE", { motivo: motivo.trim() });
  }

  const doMes = useMemo(() => dados.itens.filter((i) => i.competencia === mes), [dados.itens, mes]);

  const resumo = useMemo(() => {
    const validos = doMes.filter((i) => !FORA_DO_TOTAL.has(i.status));
    const pago = validos.filter((i) => i.status === "pago");
    const aberto = validos.filter((i) => i.status !== "pago");
    return {
      total: soma(validos),
      pago: soma(pago),
      aberto: soma(aberto),
      itens: validos.length,
      pessoas: new Set(validos.map((i) => i.personId)).size,
      cancelados: doMes.length - validos.length
    };
  }, [doMes]);

  /*
   * PREVISTO DO PRÓXIMO PAGAMENTO (~dia 02 do mês seguinte à competência).
   * Base: `fin_reembolso_saldo_unificado_v` — a mesma conta que a programação
   * de contas a pagar lê. Ela só enxerga competência <= mês corrente (0195);
   * para um mês futuro somam-se os itens do app já lançados para lá.
   * A parte da planilha é a próxima cota de cada série aberta, e vai separada
   * porque o contador dela parou em julho e superestima o saldo.
   */
  const previsto = useMemo(() => {
    if (mes < dados.mesAtual) return null;
    const app = dados.saldoAberto
      .filter((s) => s.origem === "app" && s.ultimaCompetencia <= mes)
      .reduce((s, x) => s + x.saldoCents, 0);
    const futuro = dados.itens
      .filter(
        (i) =>
          i.origem === "app" &&
          i.competencia > dados.mesAtual &&
          i.competencia <= mes &&
          !["pago", "rejeitado", "cancelado"].includes(i.status) &&
          !["pago", "rejeitado"].includes(i.statusReembolso ?? "")
      )
      .reduce((s, i) => s + i.valorCents, 0);
    const planilha = dados.saldoAberto
      .filter((s) => s.origem === "planilha" && s.parcelasRestantes >= 1)
      .reduce((s, x) => s + x.valorParcelaCents, 0);
    return { app: app + futuro, planilha, total: app + futuro + planilha };
  }, [dados, mes]);

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return doMes.filter(
      (i) =>
        (!fPessoa || String(i.personId) === fPessoa) &&
        (!fCategoria || rotuloCategoria(i) === fCategoria) &&
        (!fStatus || i.status === fStatus) &&
        (!fOrigem || i.origem === fOrigem) &&
        (!termo || `${i.descricao} ${i.pessoa} ${rotuloCategoria(i)}`.toLowerCase().includes(termo))
    );
  }, [doMes, fPessoa, fCategoria, fStatus, fOrigem, busca]);

  const subtotais = useMemo(() => {
    const porPessoa = new Map<string, number>();
    const porCategoria = new Map<string, number>();
    for (const i of filtrados) {
      if (FORA_DO_TOTAL.has(i.status)) continue;
      porPessoa.set(i.pessoa, (porPessoa.get(i.pessoa) ?? 0) + i.valorCents);
      porCategoria.set(rotuloCategoria(i), (porCategoria.get(rotuloCategoria(i)) ?? 0) + i.valorCents);
    }
    const ordenar = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]);
    return { porPessoa: ordenar(porPessoa), porCategoria: ordenar(porCategoria) };
  }, [filtrados]);

  const categoriasDoMes = useMemo(() => [...new Set(doMes.map(rotuloCategoria))].sort(), [doMes]);
  const pessoasDoMes = useMemo(() => {
    const m = new Map<number, string>();
    for (const i of doMes) m.set(i.personId, i.pessoa);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [doMes]);

  if (!dados.disponivel) return null;

  const proximoPagamento = somarMes(mes, 1);

  return (
    <section className="card" aria-label="Gestão de reembolsos">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h2 className="card-title" style={{ margin: 0 }}>
          Reembolsos do mês
        </h2>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button type="button" className="fin-btn-ghost fin-btn-mini" onClick={() => setMes(somarMes(mes, -1))}>
            ‹
          </button>
          <input
            className="fin-select"
            type="month"
            aria-label="Competência"
            value={mes.slice(0, 7)}
            onChange={(e) => e.target.value && setMes(`${e.target.value}-01`)}
          />
          <button type="button" className="fin-btn-ghost fin-btn-mini" onClick={() => setMes(somarMes(mes, 1))}>
            ›
          </button>
          {mes !== dados.mesAtual ? (
            <button type="button" className="fin-btn-ghost fin-btn-mini" onClick={() => setMes(dados.mesAtual)}>
              mês atual
            </button>
          ) : null}
        </div>
      </div>
      <p className="fin-card-hint">
        Competência {monthKeyLabel(mes)} — o mês PARA o qual o gasto foi lançado. Itens do app e linhas da planilha
        juntos, cada compra uma vez só.
      </p>

      {erro ? (
        <div className="fin-alert" role="alert">
          {erro}
        </div>
      ) : null}

      <div className="fin-kpi-row">
        <article className="fin-kpi-card">
          <p className="fin-kpi-label">Total do mês</p>
          <p className="fin-kpi-value">{brlPrecise(resumo.total)}</p>
          <p className="fin-kpi-hint">
            {resumo.itens} itens · {resumo.pessoas} pessoas
            {resumo.cancelados ? ` · ${resumo.cancelados} cancelado(s) fora do total` : ""}
          </p>
        </article>
        <article className="fin-kpi-card">
          <p className="fin-kpi-label">Já pago</p>
          <p className="fin-kpi-value">{brlPrecise(resumo.pago)}</p>
        </article>
        <article className="fin-kpi-card">
          <p className="fin-kpi-label">Em aberto</p>
          <p className="fin-kpi-value">{brlPrecise(resumo.aberto)}</p>
          <p className="fin-kpi-hint">lançado para {monthKeyLabel(mes)} e ainda não pago</p>
        </article>
        <article className="fin-kpi-card">
          <p className="fin-kpi-label">Previsto p/ 02/{proximoPagamento.slice(5, 7)}</p>
          <p className="fin-kpi-value">{previsto ? brlPrecise(previsto.total) : "—"}</p>
          <p className="fin-kpi-hint">
            {previsto
              ? `app ${brlPrecise(previsto.app)} + séries da planilha ${brlPrecise(previsto.planilha)}`
              : "mês passado: veja já pago / em aberto"}
          </p>
        </article>
      </div>

      <div className="fin-tabs" role="tablist" style={{ marginTop: 12 }}>
        {(
          [
            ["mes", `Todos do mês (${doMes.length})`],
            ["recentes", "Recentes"],
            ["parcelas", "Parcelas"],
            ["pessoa", "Por pessoa"]
          ] as [Aba, string][]
        ).map(([chave, rotulo]) => (
          <button
            key={chave}
            type="button"
            role="tab"
            aria-selected={aba === chave}
            className={`fin-tab${aba === chave ? " active" : ""}`}
            style={{ background: aba === chave ? undefined : "transparent", cursor: "pointer" }}
            onClick={() => setAba(chave)}
          >
            {rotulo}
          </button>
        ))}
      </div>

      {aba === "mes" ? (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "12px 0" }}>
            <select className="fin-select" value={fPessoa} onChange={(e) => setFPessoa(e.target.value)} aria-label="Pessoa">
              <option value="">todas as pessoas</option>
              {pessoasDoMes.map(([id, nome]) => (
                <option key={id} value={id}>
                  {nome}
                </option>
              ))}
            </select>
            <select className="fin-select" value={fCategoria} onChange={(e) => setFCategoria(e.target.value)} aria-label="Tipo">
              <option value="">todos os tipos</option>
              {categoriasDoMes.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select className="fin-select" value={fStatus} onChange={(e) => setFStatus(e.target.value)} aria-label="Status">
              <option value="">todos os status</option>
              {Object.keys(ROTULO_STATUS).map((s) => (
                <option key={s} value={s}>
                  {ROTULO_STATUS[s]}
                </option>
              ))}
            </select>
            <select className="fin-select" value={fOrigem} onChange={(e) => setFOrigem(e.target.value)} aria-label="Origem">
              <option value="">app e planilha</option>
              <option value="app">app</option>
              <option value="planilha">planilha</option>
            </select>
            <input
              className="fin-input"
              placeholder="buscar descrição…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
            {fPessoa || fCategoria || fStatus || fOrigem || busca ? (
              <button
                type="button"
                className="fin-btn-ghost fin-btn-mini"
                onClick={() => {
                  setFPessoa("");
                  setFCategoria("");
                  setFStatus("");
                  setFOrigem("");
                  setBusca("");
                }}
              >
                limpar filtros
              </button>
            ) : null}
          </div>

          <TabelaItens
            itens={filtrados}
            dados={dados}
            editando={editando}
            setEditando={setEditando}
            pendente={pendente}
            onSalvar={(item, corpo) => enviar(`/api/financeiro/reembolsos/${item.id}`, "PATCH", { tipo: "item", ...corpo })}
            onCancelar={cancelarItem}
            mostrarCompetencia={false}
          />

          {filtrados.length ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16, marginTop: 16 }}>
              <Subtotal titulo="Por pessoa" linhas={subtotais.porPessoa} />
              <Subtotal titulo="Por tipo / categoria" linhas={subtotais.porCategoria} />
            </div>
          ) : null}
        </>
      ) : null}

      {aba === "recentes" ? <Recentes dados={dados} editando={editando} setEditando={setEditando} pendente={pendente}
        onSalvar={(item, corpo) => enviar(`/api/financeiro/reembolsos/${item.id}`, "PATCH", { tipo: "item", ...corpo })}
        onCancelar={cancelarItem} /> : null}

      {aba === "parcelas" ? <Parcelas dados={dados} mes={mes} doMes={doMes} /> : null}

      {aba === "pessoa" ? (
        <PorPessoa
          dados={dados}
          pessoa={pessoaHistorico}
          setPessoa={setPessoaHistorico}
          abrirMes={(m, pessoaId) => {
            setMes(m);
            setFPessoa(pessoaId);
            setAba("mes");
          }}
        />
      ) : null}
    </section>
  );
}

function Subtotal({ titulo, linhas }: { titulo: string; linhas: [string, number][] }) {
  return (
    <div>
      <h3 className="fin-sub-titulo">{titulo}</h3>
      <table className="fin-table">
        <tbody>
          {linhas.map(([rotulo, valor]) => (
            <tr key={rotulo}>
              <td>{rotulo}</td>
              <td className="num fin-table-money">{brlPrecise(valor)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th>Total</th>
            <td className="num fin-table-money">
              <strong>{brlPrecise(linhas.reduce((s, [, v]) => s + v, 0))}</strong>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

type CorpoEdicao = Record<string, unknown>;

function TabelaItens({
  itens,
  dados,
  editando,
  setEditando,
  pendente,
  onSalvar,
  onCancelar,
  mostrarCompetencia,
  hoje
}: {
  itens: ItemGestao[];
  dados: GestaoReembolsos;
  editando: string | null;
  setEditando: (c: string | null) => void;
  pendente: boolean;
  onSalvar: (item: ItemGestao, corpo: CorpoEdicao) => Promise<boolean>;
  onCancelar: (item: ItemGestao) => void;
  mostrarCompetencia: boolean;
  hoje?: string;
}) {
  const colunas = mostrarCompetencia ? 11 : 10;
  return (
    <div className="fin-table-wrap" style={{ overflowX: "auto" }}>
      <table className="fin-table">
        <thead>
          <tr>
            <th>Pessoa</th>
            <th>Descrição</th>
            <th>Tipo</th>
            {mostrarCompetencia ? <th>Competência</th> : null}
            <th>Origem</th>
            <th>Parcela</th>
            <th>Status</th>
            <th className="num">Valor</th>
            <th>Anexo</th>
            <th>Enviado em</th>
            <th aria-label="Ações" />
          </tr>
        </thead>
        <tbody>
          {itens.map((i) => {
            const fora = FORA_DO_TOTAL.has(i.status);
            const deHoje = hoje && i.criadoEm?.startsWith(hoje);
            return [
              <tr
                key={i.chave}
                style={{
                  opacity: fora ? 0.55 : 1,
                  background: deHoje ? "var(--surface-2)" : undefined
                }}
              >
                <td className="fin-nowrap">{i.pessoa}</td>
                <td>
                  <span className="fin-desc" style={{ textDecoration: fora ? "line-through" : undefined }}>
                    {i.descricao}
                  </span>
                  {i.dataDespesa ? <span className="fin-desc-sub">gasto em {dateLabel(i.dataDespesa)}</span> : null}
                </td>
                <td>
                  {i.categoriaCode ? <span className="fin-code">{i.categoriaCode}</span> : null} {rotuloCategoria(i)}
                </td>
                {mostrarCompetencia ? <td className="fin-nowrap">{monthKeyLabel(i.competencia)}</td> : null}
                <td>
                  <span className="fin-tag">{i.origem}</span>
                </td>
                <td className="fin-nowrap">{i.parcelasTotal ? `${i.parcela}/${i.parcelasTotal}` : "—"}</td>
                <td>
                  <span className={i.status === "pago" ? "fin-badge-ok" : "fin-tag"}>{ROTULO_STATUS[i.status] ?? i.status}</span>
                </td>
                <td className="num fin-table-money">{brlPrecise(i.valorCents)}</td>
                <td>{i.temAnexo || i.temNfe ? <span className="fin-badge-ok">sim</span> : <span className="fin-zero">não</span>}</td>
                <td className="fin-nowrap">
                  {i.criadoEm ? `${dateLabel(i.criadoEm.slice(0, 10))} ${i.criadoEm.slice(11, 16)}` : "—"}
                  {deHoje ? <span className="fin-tag" style={{ marginLeft: 4 }}>hoje</span> : null}
                </td>
                <td className="fin-nowrap">
                  {i.travadoPor ? (
                    <span className="fin-zero" title={i.travadoPor}>
                      🔒
                    </span>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="fin-btn-ghost fin-btn-mini"
                        disabled={pendente}
                        onClick={() => setEditando(editando === i.chave ? null : i.chave)}
                      >
                        editar
                      </button>
                      {!fora ? (
                        <button
                          type="button"
                          className="fin-btn-ghost fin-btn-mini fin-btn-perigo"
                          disabled={pendente}
                          onClick={() => onCancelar(i)}
                        >
                          excluir
                        </button>
                      ) : null}
                    </>
                  )}
                </td>
              </tr>,
              editando === i.chave ? (
                <tr key={`${i.chave}-edit`}>
                  <td colSpan={colunas}>
                    <FormEdicao
                      item={i}
                      dados={dados}
                      pendente={pendente}
                      onFechar={() => setEditando(null)}
                      onSalvar={async (corpo) => {
                        const ok = await onSalvar(i, corpo);
                        if (ok) setEditando(null);
                      }}
                    />
                  </td>
                </tr>
              ) : null
            ];
          })}
          {!itens.length ? (
            <tr>
              <td colSpan={colunas} className="fin-empty-row">
                Nada encontrado.
              </td>
            </tr>
          ) : null}
        </tbody>
        {itens.length ? (
          <tfoot>
            <tr>
              <th colSpan={mostrarCompetencia ? 7 : 6}>Total (sem cancelados)</th>
              <td className="num fin-table-money">
                <strong>{brlPrecise(soma(itens.filter((i) => !FORA_DO_TOTAL.has(i.status))))}</strong>
              </td>
              <td colSpan={3} />
            </tr>
          </tfoot>
        ) : null}
      </table>
      <p className="fin-card-hint">🔒 = pago, ou já numa ordem enviada ao banco, ou linha da planilha — passe o mouse para ver o motivo.</p>
    </div>
  );
}

function FormEdicao({
  item,
  dados,
  pendente,
  onSalvar,
  onFechar
}: {
  item: ItemGestao;
  dados: GestaoReembolsos;
  pendente: boolean;
  onSalvar: (corpo: CorpoEdicao) => Promise<void>;
  onFechar: () => void;
}) {
  const [valor, setValor] = useState((item.valorCents / 100).toFixed(2).replace(".", ","));
  const [competencia, setCompetencia] = useState(item.competencia.slice(0, 7));
  const [descricao, setDescricao] = useState(item.descricao);
  const [tipo, setTipo] = useState(item.tipo ?? "");
  const [categoria, setCategoria] = useState(item.categoriaCode ?? "");
  const [status, setStatus] = useState(item.status);
  const [motivo, setMotivo] = useState("");
  const [erroLocal, setErroLocal] = useState<string | null>(null);

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", padding: "8px 0" }}>
      <label className="fin-field">
        <span>Valor</span>
        <input className="fin-input" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />
      </label>
      <label className="fin-field">
        <span>Competência</span>
        <input className="fin-select" type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)} />
      </label>
      <label className="fin-field" style={{ minWidth: 240, flex: 1 }}>
        <span>Descrição</span>
        <input className="fin-input" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
      </label>
      <label className="fin-field">
        <span>Tipo</span>
        <select className="fin-select" value={tipo} onChange={(e) => setTipo(e.target.value)}>
          <option value="">—</option>
          {dados.tipos.map((t) => (
            <option key={t.slug} value={t.slug}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <label className="fin-field">
        <span>Categoria</span>
        <select className="fin-select" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
          <option value="">—</option>
          {dados.categorias.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} · {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="fin-field">
        <span>Status</span>
        <select className="fin-select" value={status} onChange={(e) => setStatus(e.target.value)}>
          {["pendente", "aprovado", "rejeitado", "cancelado"].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      {status === "cancelado" || status === "rejeitado" ? (
        <label className="fin-field">
          <span>Motivo</span>
          <input className="fin-input" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="preenchido errado" />
        </label>
      ) : null}
      <button
        type="button"
        className="fin-btn-primary"
        disabled={pendente}
        onClick={async () => {
          setErroLocal(null);
          const centavos = paraCentavos(valor);
          if (!centavos || centavos <= 0) return setErroLocal("valor inválido");
          // Só viaja o que mudou: a auditoria registra o que a pessoa mexeu,
          // não o formulário inteiro.
          const corpo: CorpoEdicao = {};
          if (centavos !== item.valorCents) corpo.valorCents = centavos;
          if (competencia !== item.competencia.slice(0, 7)) corpo.competencia = competencia;
          if (descricao.trim() !== item.descricao) corpo.descricao = descricao.trim();
          if (tipo !== (item.tipo ?? "")) corpo.tipoReembolso = tipo;
          if (categoria !== (item.categoriaCode ?? "")) corpo.categoriaCode = categoria;
          if (status !== item.status) {
            corpo.status = status;
            if (motivo.trim()) corpo.motivo = motivo.trim();
          }
          if (!Object.keys(corpo).length) return onFechar();
          await onSalvar(corpo);
        }}
      >
        Salvar
      </button>
      <button type="button" className="fin-btn-ghost" onClick={onFechar}>
        Fechar
      </button>
      {erroLocal ? <span className="fin-alert">{erroLocal}</span> : null}
    </div>
  );
}

function Recentes({
  dados,
  ...resto
}: {
  dados: GestaoReembolsos;
  editando: string | null;
  setEditando: (c: string | null) => void;
  pendente: boolean;
  onSalvar: (item: ItemGestao, corpo: CorpoEdicao) => Promise<boolean>;
  onCancelar: (item: ItemGestao) => void;
}) {
  const [quantos, setQuantos] = useState(30);
  const recentes = useMemo(
    () =>
      dados.itens
        .filter((i) => i.origem === "app" && i.criadoEm)
        .sort((a, b) => (b.criadoEm ?? "").localeCompare(a.criadoEm ?? "") || b.id - a.id),
    [dados.itens]
  );
  const deHoje = recentes.filter((i) => i.criadoEm?.startsWith(dados.hoje));
  return (
    <>
      <p className="fin-card-hint">
        Hoje ({dateLabel(dados.hoje)}): <strong>{deHoje.length}</strong> item(ns), {brlPrecise(soma(deHoje.filter((i) => !FORA_DO_TOTAL.has(i.status))))}.
        Os de hoje aparecem destacados.
      </p>
      <TabelaItens itens={recentes.slice(0, quantos)} dados={dados} mostrarCompetencia hoje={dados.hoje} {...resto} />
      {recentes.length > quantos ? (
        <button type="button" className="fin-btn-ghost" onClick={() => setQuantos(quantos + 50)}>
          ver mais
        </button>
      ) : null}
    </>
  );
}

function Parcelas({ dados, mes, doMes }: { dados: GestaoReembolsos; mes: string; doMes: ItemGestao[] }) {
  const doMesParcelado = doMes.filter((i) => (i.parcelasTotal ?? 0) > 1 && !FORA_DO_TOTAL.has(i.status));
  const seriesPlanilha = dados.saldoAberto.filter((s) => s.origem === "planilha");
  const futuras = dados.itens
    .filter((i) => i.origem === "app" && (i.parcelasTotal ?? 0) > 1 && i.competencia > mes && !FORA_DO_TOTAL.has(i.status))
    .sort((a, b) => a.competencia.localeCompare(b.competencia) || a.pessoa.localeCompare(b.pessoa));

  const barra = (feito: number, total: number) => (
    <span style={{ display: "inline-block", width: 80, height: 6, background: "var(--line)", borderRadius: 3, verticalAlign: "middle" }}>
      <span style={{ display: "block", width: `${Math.min(100, (feito / total) * 100)}%`, height: 6, background: "var(--purple)", borderRadius: 3 }} />
    </span>
  );

  return (
    <>
      <h3 className="fin-sub-titulo">Parcelas de {monthKeyLabel(mes)}</h3>
      <table className="fin-table">
        <thead>
          <tr>
            <th>Pessoa</th>
            <th>Compra</th>
            <th>Origem</th>
            <th>Parcela</th>
            <th>Progresso</th>
            <th className="num">Parcela (R$)</th>
            <th className="num">Restante</th>
          </tr>
        </thead>
        <tbody>
          {doMesParcelado.map((i) => (
            <tr key={i.chave}>
              <td>{i.pessoa}</td>
              <td>{i.descricao}</td>
              <td>
                <span className="fin-tag">{i.origem}</span>
              </td>
              <td>
                {i.parcela}/{i.parcelasTotal}
              </td>
              <td>{barra(i.parcela ?? 0, i.parcelasTotal ?? 1)}</td>
              <td className="num fin-table-money">{brlPrecise(i.valorCents)}</td>
              <td className="num fin-table-money">
                {brlPrecise(((i.parcelasTotal ?? 0) - (i.parcela ?? 0)) * i.valorCents)}
              </td>
            </tr>
          ))}
          {!doMesParcelado.length ? (
            <tr>
              <td colSpan={7} className="fin-empty-row">
                Nenhuma parcela lançada para este mês.
              </td>
            </tr>
          ) : null}
        </tbody>
        {doMesParcelado.length ? (
          <tfoot>
            <tr>
              <th colSpan={5}>Total das parcelas do mês</th>
              <td className="num fin-table-money">
                <strong>{brlPrecise(soma(doMesParcelado))}</strong>
              </td>
              <td />
            </tr>
          </tfoot>
        ) : null}
      </table>

      <h3 className="fin-sub-titulo">Séries da planilha em aberto</h3>
      <p className="fin-card-hint">
        “Paga até” é a última parcela já paga (a linha da competência M sai no dia ~02 de M+1). “Agora” é a parcela da
        competência seguinte — a que entra no próximo pagamento. O dono leu 11/14 como atraso quando a parcela do mês
        era a 12/14 (30/10/2026); por isso as duas aparecem.
      </p>
      <table className="fin-table">
        <thead>
          <tr>
            <th>Pessoa</th>
            <th>Compra</th>
            <th>Paga até</th>
            <th>Agora</th>
            <th>Progresso</th>
            <th className="num">Parcela (R$)</th>
            <th className="num">Saldo</th>
          </tr>
        </thead>
        <tbody>
          {seriesPlanilha.map((s) => (
            <tr key={s.chave}>
              <td>{s.pessoa}</td>
              {/* A descrição da planilha carrega o "N/M" do mês em que foi digitada. */}
              <td>{s.descricao.replace(/\s*-?\s*\d+\s*\/\s*\d+.*$/, "")}</td>
              <td className="fin-nowrap">
                {s.parcela}/{s.parcelasTotal} <span className="fin-desc-sub">{monthKeyLabel(s.ultimaCompetencia)}</span>
              </td>
              <td className="fin-nowrap">
                {s.parcela < s.parcelasTotal ? (
                  <>
                    <strong>
                      {s.parcela + 1}/{s.parcelasTotal}
                    </strong>{" "}
                    <span className="fin-desc-sub">{monthKeyLabel(avancarMes(s.ultimaCompetencia, 1))}</span>
                  </>
                ) : (
                  "quitada"
                )}
              </td>
              <td>{barra(s.parcela, s.parcelasTotal)}</td>
              <td className="num fin-table-money">{brlPrecise(s.valorParcelaCents)}</td>
              <td className="num fin-table-money">{brlPrecise(s.saldoCents)}</td>
            </tr>
          ))}
          {!seriesPlanilha.length ? (
            <tr>
              <td colSpan={7} className="fin-empty-row">
                Nenhuma série aberta.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <h3 className="fin-sub-titulo">Parcelas futuras (depois de {monthKeyLabel(mes)})</h3>
      <table className="fin-table">
        <thead>
          <tr>
            <th>Competência</th>
            <th>Pessoa</th>
            <th>Compra</th>
            <th>Parcela</th>
            <th className="num">Valor</th>
          </tr>
        </thead>
        <tbody>
          {futuras.map((i) => (
            <tr key={i.chave}>
              <td>{monthKeyLabel(i.competencia)}</td>
              <td>{i.pessoa}</td>
              <td>{i.descricao}</td>
              <td>
                {i.parcela}/{i.parcelasTotal}
              </td>
              <td className="num fin-table-money">{brlPrecise(i.valorCents)}</td>
            </tr>
          ))}
          {!futuras.length ? (
            <tr>
              <td colSpan={5} className="fin-empty-row">
                Nenhuma parcela futura lançada.
              </td>
            </tr>
          ) : null}
        </tbody>
        {futuras.length ? (
          <tfoot>
            <tr>
              <th colSpan={4}>Total já comprometido</th>
              <td className="num fin-table-money">
                <strong>{brlPrecise(soma(futuras))}</strong>
              </td>
            </tr>
          </tfoot>
        ) : null}
      </table>
    </>
  );
}

function PorPessoa({
  dados,
  pessoa,
  setPessoa,
  abrirMes
}: {
  dados: GestaoReembolsos;
  pessoa: string;
  setPessoa: (p: string) => void;
  abrirMes: (mes: string, pessoaId: string) => void;
}) {
  const comItens = useMemo(() => {
    const ids = new Set(dados.itens.map((i) => i.personId));
    return dados.pessoas.filter((p) => ids.has(p.id));
  }, [dados]);

  const meses = useMemo(() => {
    if (!pessoa) return [];
    const mapa = new Map<string, { itens: number; total: number; pago: number; aberto: number; cancelado: number }>();
    for (const i of dados.itens) {
      if (String(i.personId) !== pessoa) continue;
      const m = mapa.get(i.competencia) ?? { itens: 0, total: 0, pago: 0, aberto: 0, cancelado: 0 };
      if (FORA_DO_TOTAL.has(i.status)) m.cancelado += i.valorCents;
      else {
        m.itens += 1;
        m.total += i.valorCents;
        if (i.status === "pago") m.pago += i.valorCents;
        else m.aberto += i.valorCents;
      }
      mapa.set(i.competencia, m);
    }
    return [...mapa.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [dados.itens, pessoa]);

  const saldo = dados.saldoAberto.filter((s) => String(s.personId) === pessoa);

  return (
    <>
      <div style={{ margin: "12px 0" }}>
        <select className="fin-select" value={pessoa} onChange={(e) => setPessoa(e.target.value)} aria-label="Pessoa">
          <option value="">escolha a pessoa…</option>
          {comItens.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
              {p.status !== "ativo" ? " (inativo)" : ""}
            </option>
          ))}
        </select>
      </div>
      {pessoa ? (
        <>
          <table className="fin-table">
            <thead>
              <tr>
                <th>Competência</th>
                <th className="num">Itens</th>
                <th className="num">Total</th>
                <th className="num">Pago</th>
                <th className="num">Em aberto</th>
                <th className="num">Cancelado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {meses.map(([m, v]) => (
                <tr key={m}>
                  <td>{monthKeyLabel(m)}</td>
                  <td className="num">{v.itens}</td>
                  <td className="num fin-table-money">{brlPrecise(v.total)}</td>
                  <td className="num fin-table-money">{v.pago ? brlPrecise(v.pago) : <span className="fin-zero">—</span>}</td>
                  <td className="num fin-table-money">{v.aberto ? brlPrecise(v.aberto) : <span className="fin-zero">—</span>}</td>
                  <td className="num fin-table-money">
                    {v.cancelado ? brlPrecise(v.cancelado) : <span className="fin-zero">—</span>}
                  </td>
                  <td>
                    <button type="button" className="fin-btn-ghost fin-btn-mini" onClick={() => abrirMes(m, pessoa)}>
                      ver itens
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th>Total</th>
                <td className="num">{meses.reduce((s, [, v]) => s + v.itens, 0)}</td>
                <td className="num fin-table-money">
                  <strong>{brlPrecise(meses.reduce((s, [, v]) => s + v.total, 0))}</strong>
                </td>
                <td className="num fin-table-money">{brlPrecise(meses.reduce((s, [, v]) => s + v.pago, 0))}</td>
                <td className="num fin-table-money">{brlPrecise(meses.reduce((s, [, v]) => s + v.aberto, 0))}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
          <p className="fin-card-hint">
            A receber hoje (view unificada, o que a programação de pagamento lê):{" "}
            <strong>{brlPrecise(saldo.reduce((s, x) => s + x.saldoCents, 0))}</strong> em {saldo.length} linha(s).
          </p>
        </>
      ) : null}
    </>
  );
}

// "AAAA-MM" ou "AAAA-MM-DD" → "AAAA-MM" n meses depois, sem fuso.
function avancarMes(m: string, n: number): string {
  const [a, mm] = m.slice(0, 7).split("-").map(Number);
  const d = new Date(Date.UTC(a, mm - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

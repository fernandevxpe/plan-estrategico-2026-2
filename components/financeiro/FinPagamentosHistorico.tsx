"use client";

import { Fragment, useMemo, useState } from "react";

import type {
  EstadoPagamento,
  HistoricoPagamentos,
  OrdemHistorico,
  TipoPagamento
} from "@/lib/financeiro/pagamentos-historico";
import { brlPrecise, dateLabel } from "@/lib/financeiro/format";

/**
 * PAGAMENTOS ENVIADOS — somente leitura.
 *
 * Os rótulos moram aqui, e não importados de lib/financeiro/pagamentos-historico,
 * porque aquele arquivo é `server-only`: importar valor dele num componente
 * cliente quebra o build. Só os TIPOS atravessam.
 */
const ROTULO_TIPO: Record<TipoPagamento, string> = {
  salario: "Salário",
  prolabore: "Pró-labore",
  reembolso: "Reembolso",
  comissao: "Comissão",
  fornecedor: "Fornecedor",
  cartao: "Fatura de cartão",
  outro: "Outro"
};

const ESTADO: Record<EstadoPagamento, { rotulo: string; cor: string; fundo: string }> = {
  rascunho: { rotulo: "Rascunho — não enviado", cor: "#555", fundo: "#ececec" },
  aguardando_banco: { rotulo: "No banco — aguardando aprovação", cor: "#8a5a00", fundo: "#fff2cc" },
  pago: { rotulo: "Pago", cor: "#106b2f", fundo: "#d9f2e1" },
  pago_parcial: { rotulo: "Pago parcial", cor: "#9a4a00", fundo: "#ffe2c7" },
  cancelado: { rotulo: "Cancelado", cor: "#8b1a1a", fundo: "#f8d7d7" },
  outro: { rotulo: "Em andamento", cor: "#1f4e8a", fundo: "#dbe8fb" }
};

function hora(iso: string | null): string {
  return iso ? iso.slice(11, 16) : "";
}

function diaLongo(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
}

function mesLegivel(c: string | null): string {
  if (!c) return "—";
  const [a, m] = c.split("-");
  return `${m}/${a}`;
}

function Selo({ estado }: { estado: EstadoPagamento }) {
  const e = ESTADO[estado];
  return (
    <span
      style={{
        background: e.fundo,
        color: e.cor,
        borderRadius: 999,
        padding: "2px 8px",
        fontSize: 12,
        fontWeight: 600,
        whiteSpace: "nowrap"
      }}
    >
      {e.rotulo}
    </span>
  );
}

function Cartao({
  titulo,
  valor,
  meta,
  alerta
}: {
  titulo: string;
  valor: string;
  meta: string;
  alerta?: boolean;
}) {
  return (
    <div
      className="card"
      style={{
        flex: "1 1 200px",
        padding: 14,
        borderLeft: alerta ? "4px solid #c0392b" : undefined
      }}
    >
      <p style={{ margin: 0, fontSize: 12, opacity: 0.75 }}>{titulo}</p>
      <p style={{ margin: "4px 0", fontSize: 22, fontWeight: 700 }}>{valor}</p>
      <p style={{ margin: 0, fontSize: 12, opacity: 0.75 }}>{meta}</p>
    </div>
  );
}

function Detalhe({ o }: { o: OrdemHistorico }) {
  const somaComp = o.composicao?.reduce((s, c) => s + c.valorCents, 0) ?? 0;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, padding: "8px 4px" }}>
      <div>
        <h4 style={{ margin: "0 0 6px" }}>Linha do tempo</h4>
        <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
          {o.linhaDoTempo.map((ev, i) => (
            <li key={i}>
              <strong>{dateLabel(ev.em)}</strong>
              {ev.em.endsWith("T00:00:00") ? "" : ` ${hora(ev.em)}`} — {ev.rotulo}
            </li>
          ))}
        </ol>
        {o.codigosSolicitacao.length ? (
          <p style={{ fontSize: 12, opacity: 0.75, wordBreak: "break-all" }}>
            Código(s) no Inter: {o.codigosSolicitacao.join(", ")}
          </p>
        ) : null}
        <p style={{ fontSize: 12, opacity: 0.75 }}>{o.descricao}</p>
      </div>
      <div>
        <h4 style={{ margin: "0 0 6px" }}>Prova no extrato</h4>
        {o.execucoes.length === 0 ? (
          <p style={{ fontSize: 13 }}>
            Nenhuma saída registrada.{" "}
            {o.suspeitaPagaPorFora
              ? `Aberta há ${o.diasAberta} dias — provavelmente paga por fora ou não conciliada. Confira o extrato antes de reenviar.`
              : ""}
          </p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {o.execucoes.map((e, i) => (
              <li key={i}>
                {dateLabel(e.pagoEm)} · {brlPrecise(e.valorCents)}
                {e.transacao ? (
                  <>
                    {" "}
                    — extrato #{e.transacao.id} ({e.transacao.conta ?? "conta ?"}, {dateLabel(e.transacao.data)}):{" "}
                    <em>{e.transacao.descricao}</em>
                  </>
                ) : (
                  " — sem linha de extrato ligada"
                )}
              </li>
            ))}
          </ul>
        )}
        {o.divergenciaCents ? (
          <p style={{ color: "#c0392b", fontSize: 13, fontWeight: 600 }}>
            Divergência: saiu {brlPrecise(o.valorCents + o.divergenciaCents)} para uma ordem de {brlPrecise(o.valorCents)}.
          </p>
        ) : null}
      </div>
      <div>
        <h4 style={{ margin: "0 0 6px" }}>Composição</h4>
        {o.composicao && o.composicao.length ? (
          <>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
              {o.composicao.map((c) => (
                <li key={c.id}>
                  {c.descricao} · {brlPrecise(c.valorCents)}
                </li>
              ))}
            </ul>
            <p style={{ fontSize: 12 }}>
              Soma das linhas {brlPrecise(somaComp)} · ordem {brlPrecise(o.valorCents)}
            </p>
          </>
        ) : null}
        <p style={{ fontSize: 12, opacity: 0.75 }}>
          {o.composicaoNota ?? "Ordem de valor único (salário/pró-labore ou fornecedor) — sem itens."}
        </p>
      </div>
    </div>
  );
}

export function FinPagamentosHistorico({ dados }: { dados: HistoricoPagamentos }) {
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [pessoa, setPessoa] = useState("");
  const [tipo, setTipo] = useState("");
  const [estado, setEstado] = useState("");
  const [busca, setBusca] = useState("");
  const [aberta, setAberta] = useState<number | null>(null);

  const filtradas = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return dados.ordens.filter(
      (o) =>
        (!de || o.dia >= de) &&
        (!ate || o.dia <= ate) &&
        (!pessoa || o.favorecido === pessoa) &&
        (!tipo || o.tipo === tipo) &&
        (!estado || o.estado === estado) &&
        (!b ||
          `${o.code} ${o.favorecido} ${o.descricao} ${o.codigosSolicitacao.join(" ")}`.toLowerCase().includes(b))
    );
  }, [dados.ordens, de, ate, pessoa, tipo, estado, busca]);

  const porDia = useMemo(() => {
    const m = new Map<string, OrdemHistorico[]>();
    for (const o of filtradas) {
      const l = m.get(o.dia) ?? [];
      l.push(o);
      m.set(o.dia, l);
    }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [filtradas]);

  if (!dados.disponivel) {
    return (
      <section className="card fin-empty">
        <h2 className="card-title">Histórico indisponível</h2>
        <p>O banco financeiro não respondeu.</p>
      </section>
    );
  }

  const r = dados.resumo;
  const sel = { padding: "6px 8px", borderRadius: 6, border: "1px solid #ccc" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Cartao
          titulo="Enviado hoje"
          valor={brlPrecise(r.enviadoHoje.cents)}
          meta={`${r.enviadoHoje.n} ordem(ns) em ${dateLabel(dados.hoje)}`}
        />
        <Cartao
          titulo="No banco, aguardando sua aprovação"
          valor={brlPrecise(r.aguardandoBanco.cents)}
          meta={`${r.aguardandoBanco.n} ordem(ns) — aprove no app do Inter`}
        />
        <Cartao
          titulo="Pago no mês"
          valor={brlPrecise(r.pagoNoMes.cents)}
          meta={`${r.pagoNoMes.n} ordem(ns) com saída em ${dados.hoje.slice(5, 7)}/${dados.hoje.slice(0, 4)}`}
        />
        <Cartao
          titulo="Abertas há mais de 20 dias"
          valor={brlPrecise(r.abertasSuspeitas.cents)}
          meta={
            r.abertasSuspeitas.n
              ? `${r.abertasSuspeitas.n}: ${r.abertasSuspeitas.codes.join(", ")} — provavelmente já pagas; conciliar, não reenviar`
              : "nenhuma"
          }
          alerta={r.abertasSuspeitas.n > 0}
        />
      </div>

      <div className="card" style={{ padding: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <label>
          De <input type="date" value={de} onChange={(e) => setDe(e.target.value)} style={sel} />
        </label>
        <label>
          Até <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} style={sel} />
        </label>
        <select value={pessoa} onChange={(e) => setPessoa(e.target.value)} style={sel} aria-label="Pessoa">
          <option value="">Todas as pessoas</option>
          {dados.pessoas.map((p) => (
            <option key={p.nome} value={p.nome}>
              {p.nome}
            </option>
          ))}
        </select>
        <select value={tipo} onChange={(e) => setTipo(e.target.value)} style={sel} aria-label="Tipo">
          <option value="">Todos os tipos</option>
          {(Object.keys(ROTULO_TIPO) as TipoPagamento[]).map((t) => (
            <option key={t} value={t}>
              {ROTULO_TIPO[t]}
            </option>
          ))}
        </select>
        <select value={estado} onChange={(e) => setEstado(e.target.value)} style={sel} aria-label="Status">
          <option value="">Todos os status</option>
          {(Object.keys(ESTADO) as EstadoPagamento[]).map((s) => (
            <option key={s} value={s}>
              {ESTADO[s].rotulo} ({r.porEstado[s].n})
            </option>
          ))}
        </select>
        <input
          type="search"
          placeholder="Buscar código, pessoa, descrição…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          style={{ ...sel, flex: "1 1 200px" }}
        />
        <span style={{ fontSize: 13, opacity: 0.75 }}>
          {filtradas.length} ordem(ns) · {brlPrecise(filtradas.reduce((s, o) => s + o.valorCents, 0))}
        </span>
      </div>

      {porDia.length === 0 ? (
        <section className="card fin-empty">
          <p>Nenhuma ordem com esses filtros.</p>
        </section>
      ) : null}

      {porDia.map(([dia, ordens]) => {
        const total = ordens.reduce((s, o) => s + o.valorCents, 0);
        const soRascunho = ordens.every((o) => !o.enviada);
        return (
          <section key={dia} className="card" style={{ padding: 12 }}>
            <h2 className="card-title" style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <span style={{ textTransform: "capitalize" }}>
                {diaLongo(dia)}
                {dia === dados.hoje ? " — hoje" : ""}
                {soRascunho ? " (criadas, não enviadas)" : ""}
              </span>
              <span>
                {ordens.length} ordem(ns) · {brlPrecise(total)}
              </span>
            </h2>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                    <th>Hora</th>
                    <th>Ordem</th>
                    <th>Favorecido</th>
                    <th>Tipo</th>
                    <th>Competência</th>
                    <th style={{ textAlign: "right" }}>Valor</th>
                    <th>Status</th>
                    <th>Tentativas</th>
                  </tr>
                </thead>
                <tbody>
                  {ordens.map((o) => {
                    const pago = o.execucoes[o.execucoes.length - 1];
                    return (
                      <Fragment key={o.id}>
                        <tr
                          onClick={() => setAberta(aberta === o.id ? null : o.id)}
                          style={{ cursor: "pointer", borderBottom: "1px solid #f0f0f0" }}
                        >
                          <td>{o.enviada ? hora(o.enviadaEm) : "—"}</td>
                          <td style={{ whiteSpace: "nowrap" }}>{aberta === o.id ? "▾" : "▸"} {o.code}</td>
                          <td>{o.favorecido}</td>
                          <td>
                            {ROTULO_TIPO[o.tipo]}
                            {o.pacote ? ` · ${o.pacote}` : ""}
                          </td>
                          <td>{mesLegivel(o.competencia)}</td>
                          <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{brlPrecise(o.valorCents)}</td>
                          <td>
                            <Selo estado={o.estado} />
                            {pago ? (
                              <span style={{ fontSize: 12, marginLeft: 6 }}>
                                em {dateLabel(pago.pagoEm)}
                                {pago.transacao ? " · no extrato" : ""}
                              </span>
                            ) : null}
                            {o.divergenciaCents ? (
                              <span style={{ color: "#c0392b", fontSize: 12, marginLeft: 6 }}>
                                divergência {brlPrecise(o.divergenciaCents)}
                              </span>
                            ) : null}
                            {o.suspeitaPagaPorFora ? (
                              <span style={{ color: "#c0392b", fontSize: 12, marginLeft: 6 }}>
                                aberta há {o.diasAberta} dias
                              </span>
                            ) : null}
                          </td>
                          <td>{o.tentativas || "—"}</td>
                        </tr>
                        {aberta === o.id ? (
                          <tr>
                            <td colSpan={8} style={{ background: "#fafafa" }}>
                              <Detalhe o={o} />
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}

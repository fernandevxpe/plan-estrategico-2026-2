"use client";

import { Fragment, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { brlPrecise } from "@/lib/financeiro/format";
import { INTERVALO_ENTRE_PAGAMENTOS_MS } from "@/lib/financeiro/inter-ritmo";
import { urlDaOrigem } from "@/lib/url-origem";

/**
 * "Confiro pessoa a pessoa e mando pagar": a tabela de reembolsos e a de
 * comissões do mês (02/11/2026). Um componente só para as duas porque o envio
 * ao Inter é o trecho que não pode divergir.
 *
 * Cada linha é uma linha de Contas a pagar (mesma `chaveDedupe`, mesmo
 * `fin_payment_request.source_id`): clicar aqui e lá não cria ordem em dobro,
 * o índice único devolve `jaExistiam`. O valor do PIX é o de lá; o detalhe
 * embaixo é para conferir, e a tela avisa quando a soma dele diverge.
 */

export type DetalhePagar = { chave: string; texto: string; valorCents: number };

export type LinhaPagar = {
  chaveDedupe: string;
  personId: number;
  pessoa: string;
  /** Ex.: "consultoria", "obras" — vazio no reembolso, que é um PIX por pessoa. */
  rotulo: string | null;
  valorCents: number;
  counterpartyId: number | null;
  descricao: string;
  categoryId: number | null;
  nucleo: string | null;
  origemTabela: string | null;
  origemId: number | null;
  pix: string | null;
  impedimento: string | null;
  ordem: { id: number; code: string; status: string; pagoCents: number } | null;
  detalhes: DetalhePagar[];
  /** Aviso ao lado do nome (ex.: comissão de obra sai pelo Nubank). */
  alerta?: string | null;
};

const ROTULO_ORDEM: Record<string, string> = {
  rascunho: "programada, não enviada",
  aprovada: "aprovada, não enviada",
  aguardando_autorizacao: "no Inter — aprovar no app",
  pago: "paga",
  pago_parcial: "paga em parte"
};
const PODEM_SAIR = new Set(["rascunho", "aprovada"]);

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function FinPagarPorPessoa({
  linhas,
  mesPagamento,
  hoje,
  cabecalho,
  vazio
}: {
  linhas: LinhaPagar[];
  mesPagamento: string;
  hoje: string;
  cabecalho: ReactNode;
  vazio: string;
}) {
  const router = useRouter();
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  // Aberto por padrão: o uso é conferir pessoa a pessoa, item a item.
  const [abertas, setAbertas] = useState<Set<string>>(() => new Set(linhas.map((l) => l.chaveDedupe)));
  const [fPessoa, setFPessoa] = useState("");
  const [fRotulo, setFRotulo] = useState("");
  const [dia, setDia] = useState(() => {
    const padrao = `${mesPagamento.slice(0, 7)}-02`;
    return padrao < hoje ? hoje : padrao;
  });
  const [emVoo, setEmVoo] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const parar = useRef(false);

  const pessoas = useMemo(
    () => [...new Map(linhas.map((l) => [l.personId, l.pessoa])).entries()].sort((a, b) => a[1].localeCompare(b[1])),
    [linhas]
  );
  const rotulos = useMemo(() => [...new Set(linhas.map((l) => l.rotulo).filter(Boolean))] as string[], [linhas]);

  const visiveis = useMemo(
    () =>
      linhas
        .filter((l) => (!fPessoa || String(l.personId) === fPessoa) && (!fRotulo || l.rotulo === fRotulo))
        .sort((a, b) => a.pessoa.localeCompare(b.pessoa) || (a.rotulo ?? "").localeCompare(b.rotulo ?? "")),
    [linhas, fPessoa, fRotulo]
  );

  const podeMarcar = (l: LinhaPagar) =>
    !l.impedimento && l.valorCents > 0 && (!l.ordem || PODEM_SAIR.has(l.ordem.status));

  const selecionaveis = visiveis.filter(podeMarcar);
  const escolhidas = visiveis.filter((l) => marcadas.has(l.chaveDedupe) && podeMarcar(l));
  const totalEscolhido = escolhidas.reduce((s, l) => s + l.valorCents, 0);
  const total = visiveis.reduce((s, l) => s + l.valorCents, 0);
  const aPagar = visiveis.filter((l) => !l.ordem || PODEM_SAIR.has(l.ordem.status)).reduce((s, l) => s + l.valorCents, 0);
  const nome = (l: LinhaPagar) => (l.rotulo ? `${l.pessoa} · ${l.rotulo}` : l.pessoa);

  function alternar(chave: string) {
    setMarcadas((m) => {
      const n = new Set(m);
      if (n.has(chave)) n.delete(chave);
      else n.add(chave);
      return n;
    });
  }

  async function programarEEnviar() {
    if (!escolhidas.length || emVoo) return;
    if (dia < hoje) {
      setLog(["A data do pagamento já passou — o Inter recusa. Escolha hoje ou depois."]);
      return;
    }
    const ok = window.confirm(
      `Programar ${escolhidas.length} pagamento(s), ${brlPrecise(totalEscolhido)}, para ${dia.split("-").reverse().join("/")} e enviar ao Inter?\n\n` +
        escolhidas.map((l) => `• ${nome(l)} ${brlPrecise(l.valorCents)}`).join("\n") +
        `\n\nNada é pago aqui: cada ordem para em "aguardando autorização" e você aprova no app do Inter.`
    );
    if (!ok) return;
    setEmVoo(true);
    parar.current = false;
    const linhasLog: string[] = [];
    const anota = (t: string) => {
      linhasLog.push(t);
      setLog([...linhasLog]);
    };
    try {
      const r = await fetch(urlDaOrigem("/api/financeiro/contas-a-pagar/programar"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduledFor: dia,
          metodo: "pix",
          alvos: escolhidas.map((l) => ({
            chaveDedupe: l.chaveDedupe,
            origemTabela: l.origemTabela,
            origemId: l.origemId,
            counterpartyId: l.counterpartyId,
            descricao: l.descricao,
            valorCents: l.valorCents,
            dueDate: dia,
            categoryId: l.categoryId,
            nucleo: l.nucleo
          }))
        })
      });
      const corpo = (await r.json().catch(() => ({}))) as {
        criadas?: { id?: number; code?: string; chaveDedupe?: string }[];
        jaExistiam?: { id?: number; code?: string; chaveDedupe?: string; status?: string }[];
        recusadas?: { chaveDedupe?: string; motivo?: string }[];
        error?: string;
      };
      if (!r.ok) throw new Error(corpo.error ?? `não programou (HTTP ${r.status})`);
      setMarcadas(new Set());

      const rot = new Map(escolhidas.map((l) => [l.chaveDedupe, `${nome(l)} ${brlPrecise(l.valorCents)}`]));
      for (const x of corpo.recusadas ?? []) anota(`✗ ${rot.get(x.chaveDedupe ?? "") ?? x.chaveDedupe}: ${x.motivo}`);
      const fila: { id: number; rotulo: string }[] = [];
      for (const c of corpo.criadas ?? [])
        if (typeof c.id === "number") fila.push({ id: c.id, rotulo: rot.get(c.chaveDedupe ?? "") ?? c.code ?? "" });
      for (const j of corpo.jaExistiam ?? []) {
        const rr = rot.get(j.chaveDedupe ?? "") ?? j.code ?? "";
        // `aguardando_autorizacao` já está no banco: reenviar é o caminho para pagar duas vezes.
        if (typeof j.id === "number" && PODEM_SAIR.has(String(j.status))) fila.push({ id: j.id, rotulo: rr });
        else anota(`· ${rr}: já existia (${j.code}, ${j.status}) — não reenviei`);
      }

      // Uma a uma, no ritmo do Inter — mesmo intervalo de Contas a pagar.
      for (let i = 0; i < fila.length; i++) {
        if (i > 0) for (let ja = 0; ja < INTERVALO_ENTRE_PAGAMENTOS_MS && !parar.current; ja += 200) await esperar(200);
        if (parar.current) {
          anota(`■ parado: ${fila.length - i} ficaram programadas sem envio (reenvie em Aprovações)`);
          break;
        }
        anota(`… enviando ${i + 1}/${fila.length}: ${fila[i].rotulo}`);
        try {
          const e = await fetch(urlDaOrigem("/api/financeiro/contas-a-pagar/programar"), {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: fila[i].id })
          });
          const ej = (await e.json().catch(() => ({}))) as { error?: string };
          linhasLog.pop();
          anota(e.ok ? `✓ ${fila[i].rotulo} — no Inter, aguardando sua aprovação` : `✗ ${fila[i].rotulo}: ${ej.error ?? `HTTP ${e.status}`}`);
          if (e.status === 503) break;
        } catch (err) {
          linhasLog.pop();
          anota(`✗ ${fila[i].rotulo}: a requisição não completou (${err instanceof Error ? err.message : "rede"}) — confira em Aprovações antes de reenviar`);
        }
      }
    } catch (err) {
      anota(`✗ ${err instanceof Error ? err.message : "não programou"}`);
    } finally {
      setEmVoo(false);
      router.refresh();
    }
  }

  if (!linhas.length) return <p className="fin-card-hint" style={{ marginTop: 12 }}>{vazio}</p>;

  return (
    <>
      <p className="fin-card-hint" style={{ marginTop: 12 }}>
        {cabecalho} Na tabela: <strong>{brlPrecise(total)}</strong> em {visiveis.length} PIX · ainda a enviar{" "}
        <strong>{brlPrecise(aPagar)}</strong>.
      </p>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", margin: "8px 0" }}>
        <select className="fin-select" value={fPessoa} onChange={(e) => setFPessoa(e.target.value)} aria-label="Pessoa">
          <option value="">todas as pessoas</option>
          {pessoas.map(([id, n]) => (
            <option key={id} value={id}>
              {n}
            </option>
          ))}
        </select>
        {rotulos.length > 1 ? (
          <select className="fin-select" value={fRotulo} onChange={(e) => setFRotulo(e.target.value)} aria-label="Tipo">
            <option value="">todos os tipos</option>
            {rotulos.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        ) : null}
        <button
          type="button"
          className="fin-btn-ghost fin-btn-mini"
          onClick={() => setAbertas(abertas.size ? new Set() : new Set(linhas.map((l) => l.chaveDedupe)))}
        >
          {abertas.size ? "recolher detalhes" : "abrir detalhes"}
        </button>
        <button
          type="button"
          className="fin-btn-ghost fin-btn-mini"
          disabled={emVoo || !selecionaveis.length}
          onClick={() =>
            setMarcadas(
              escolhidas.length === selecionaveis.length ? new Set() : new Set(selecionaveis.map((l) => l.chaveDedupe))
            )
          }
        >
          {escolhidas.length === selecionaveis.length && selecionaveis.length
            ? "desmarcar todos"
            : `marcar todos os que podem sair (${selecionaveis.length})`}
        </button>
        <label className="fin-card-hint">
          pagar em{" "}
          <input type="date" className="fin-input" value={dia} min={hoje} onChange={(e) => setDia(e.target.value)} disabled={emVoo} />
        </label>
        <button type="button" className="fin-btn-primary" disabled={emVoo || !escolhidas.length} onClick={programarEEnviar}>
          {emVoo ? "enviando…" : `Programar e enviar ao Inter (${escolhidas.length} · ${brlPrecise(totalEscolhido)})`}
        </button>
        {emVoo ? (
          <button type="button" className="fin-btn-ghost fin-btn-mini" onClick={() => (parar.current = true)}>
            parar
          </button>
        ) : null}
      </div>

      {log.length ? (
        <ul className="fin-card-hint" style={{ margin: "8px 0", paddingLeft: 18 }}>
          {log.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      ) : null}

      <table className="fin-table">
        <thead>
          <tr>
            <th />
            <th>Pessoa</th>
            <th>Tipo</th>
            <th className="num">Lançamentos</th>
            <th className="num">PIX</th>
            <th>Chave</th>
            <th>Situação</th>
          </tr>
        </thead>
        <tbody>
          {visiveis.map((l) => {
            const aberta = abertas.has(l.chaveDedupe);
            const soma = l.detalhes.reduce((s, d) => s + d.valorCents, 0);
            const situacao = l.ordem
              ? `${l.ordem.code} · ${ROTULO_ORDEM[l.ordem.status] ?? l.ordem.status}`
              : l.impedimento ?? "a programar";
            return (
              <Fragment key={l.chaveDedupe}>
                <tr>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`selecionar ${nome(l)}`}
                      disabled={emVoo || !podeMarcar(l)}
                      checked={marcadas.has(l.chaveDedupe) && podeMarcar(l)}
                      onChange={() => alternar(l.chaveDedupe)}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="fin-btn-ghost fin-btn-mini"
                      onClick={() =>
                        setAbertas((a) => {
                          const n = new Set(a);
                          if (n.has(l.chaveDedupe)) n.delete(l.chaveDedupe);
                          else n.add(l.chaveDedupe);
                          return n;
                        })
                      }
                    >
                      {aberta ? "▾" : "▸"} {l.pessoa}
                    </button>
                    {l.alerta ? <div className="fin-desc-sub">⚠ {l.alerta}</div> : null}
                  </td>
                  <td>{l.rotulo ? <span className="fin-tag">{l.rotulo}</span> : "—"}</td>
                  <td className="num">{l.detalhes.length}</td>
                  <td className="num fin-table-money">
                    <strong>{brlPrecise(l.valorCents)}</strong>
                    {l.detalhes.length && soma !== l.valorCents ? (
                      <div className="fin-desc-sub" title="A ordem usa o valor de Contas a pagar">
                        lançamentos somam {brlPrecise(soma)}
                      </div>
                    ) : null}
                  </td>
                  <td className="fin-desc-sub">{l.pix ?? "sem chave"}</td>
                  <td>
                    <span className="fin-tag">{situacao}</span>
                  </td>
                </tr>
                {aberta
                  ? l.detalhes.map((d) => (
                      <tr key={d.chave} className="fin-desc-sub">
                        <td />
                        <td colSpan={3}>{d.texto}</td>
                        <td className="num fin-table-money">{brlPrecise(d.valorCents)}</td>
                        <td colSpan={2} />
                      </tr>
                    ))
                  : null}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <th colSpan={4}>Total</th>
            <td className="num fin-table-money">
              <strong>{brlPrecise(total)}</strong>
            </td>
            <td colSpan={2} />
          </tr>
        </tfoot>
      </table>
    </>
  );
}

"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { brlPrecise } from "@/lib/financeiro/format";
import type { FilaQualificacao, GrupoQualificacao } from "@/lib/financeiro/qualificar";

/**
 * Qualificação ativa: decidir em grupo, com a evidência à vista.
 *
 * A tela de Revisão mostra 100 lançamentos soltos por valor. Esta mostra
 * GRUPOS, do mais recente para o mais antigo, porque o objetivo declarado é
 * fechar 2026 — e o passado distante já não muda decisão nenhuma.
 *
 * CADA GRUPO CARREGA A EVIDÊNCIA. "casou com a cobrança do Condomínio Morada,
 * mesma quantia, 1 dia de diferença" é contestável; "provavelmente 3.05" não é.
 * Uma sugestão que o usuário não pode contestar com fundamento é um chute com
 * autoridade, e ele acaba aceitando tudo ou desconfiando de tudo.
 *
 * O AVISO DE TRANSFERÊNCIA tem destaque próprio porque é o erro mais caro que
 * esta tela pode cometer: classificar remessa entre contas da empresa como
 * receita conta o mesmo dinheiro duas vezes. Já valeu R$ 352 mil uma vez.
 */

const FONTE_ROTULO: Record<string, { texto: string; tom: string }> = {
  transferencia: { texto: "remessa interna", tom: "#7a3ea3" },
  liquidacao: { texto: "casou com cobrança", tom: "#0f7b4f" },
  contraparte: { texto: "histórico da contraparte", tom: "#0f7b4f" },
  padrao: { texto: "descrição igual", tom: "#8a6d1f" },
  valor: { texto: "mesmo valor", tom: "#8a6d1f" }
};

export function FinQualificar({ fila }: { fila: FilaQualificacao }) {
  const router = useRouter();
  const [aberto, setAberto] = useState<string | null>(null);
  const [escolha, setEscolha] = useState<Record<string, string>>({});
  const [criarRegra, setCriarRegra] = useState<Record<string, boolean>>({});
  const [pendente, setPendente] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<string[]>([]);
  const [busca, setBusca] = useState("");
  const [minValor, setMinValor] = useState(0);
  const [soComSugestao, setSoComSugestao] = useState(false);
  const [direcao, setDirecao] = useState<"" | "entrada" | "saida">("");

  const grupos = useMemo(() => {
    const alvo = busca.trim().toLowerCase();
    return fila.grupos.filter((g) => {
      if (feito.includes(g.chave)) return false;
      if (g.valorCents < minValor * 100) return false;
      if (soComSugestao && !g.sugestao) return false;
      if (direcao && g.direcao !== direcao) return false;
      if (!alvo) return true;
      return (
        g.rotulo.toLowerCase().includes(alvo) ||
        g.itens.some((i) => i.descricao.toLowerCase().includes(alvo))
      );
    });
  }, [fila.grupos, feito, busca, minValor, soComSugestao, direcao]);

  const restante = grupos.reduce((s, g) => s + g.valorCents, 0);
  const pct = fila.progresso.valorTotal
    ? (100 * fila.progresso.valorClassificado) / fila.progresso.valorTotal
    : 0;

  async function aplicar(g: GrupoQualificacao, code: string, comRegra: boolean) {
    setPendente(g.chave);
    setErro(null);
    try {
      const r = await fetch("/api/financeiro/qualificar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ids: g.itens.map((i) => i.id),
          code,
          criarRegra: comRegra,
          rotulo: g.rotulo,
          padrao: g.porContraparte ? "" : g.rotulo,
          porContraparte: g.porContraparte,
          evidencia: g.sugestao?.evidencia ?? null
        })
      });
      const corpo = await r.json();
      if (!r.ok) throw new Error(corpo?.erro ?? "falha ao qualificar");
      setFeito((f) => [...f, g.chave]);
      if (corpo.regraRecusada) setErro(`Classificado, mas sem regra: ${corpo.regraRecusada}`);
      // Recarrega o Server Component para o progresso e as sugestões
      // recalcularem — cada decisão vira histórico e melhora as próximas.
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "falha ao qualificar");
    } finally {
      setPendente(null);
    }
  }

  return (
    <div className="fin-qual">
      <section className="fin-kpi-row">
        <article className="fin-kpi-card">
          <span className="fin-kpi-label">Falta qualificar em {fila.ano}</span>
          <strong className="fin-kpi-value">{brlPrecise(restante)}</strong>
          <span className="fin-kpi-hint">{grupos.length} grupos · {fila.pendentes.n} lançamentos</span>
        </article>
        <article className="fin-kpi-card fin-kpi-destaque">
          <span className="fin-kpi-label">Cobertura do ano</span>
          <strong className="fin-kpi-value">{pct.toFixed(1)}%</strong>
          <span className="fin-kpi-hint">
            {fila.progresso.classificados} de {fila.progresso.total} lançamentos com categoria
          </span>
        </article>
        <article className="fin-kpi-card">
          <span className="fin-kpi-label">Já resolvido nesta sessão</span>
          <strong className="fin-kpi-value">{feito.length}</strong>
          <span className="fin-kpi-hint">grupos decididos</span>
        </article>
      </section>

      <div className="fin-qual-filtros">
        <input
          type="search"
          className="fin-input"
          placeholder="Filtrar por nome ou descrição…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          aria-label="Filtrar grupos"
        />
        <label className="fin-field">
          <span className="fin-field-hint">valor mínimo</span>
          <select className="fin-select" value={minValor} onChange={(e) => setMinValor(Number(e.target.value))}>
            <option value={0}>tudo</option>
            <option value={500}>R$ 500+</option>
            <option value={2000}>R$ 2.000+</option>
            <option value={10000}>R$ 10.000+</option>
          </select>
        </label>
        <label className="fin-field">
          <span className="fin-field-hint">direção</span>
          <select className="fin-select" value={direcao} onChange={(e) => setDirecao(e.target.value as "" | "entrada" | "saida")}>
            <option value="">entradas e saídas</option>
            <option value="entrada">só entradas (receita)</option>
            <option value="saida">só saídas (custo)</option>
          </select>
        </label>
        <label className="fin-check">
          <input type="checkbox" checked={soComSugestao} onChange={(e) => setSoComSugestao(e.target.checked)} />
          só com sugestão
        </label>
      </div>

      {erro ? <p className="fin-alert" role="alert">{erro}</p> : null}

      <ul className="fin-qual-lista">
        {grupos.map((g) => {
          const s = g.sugestao;
          const f = s ? FONTE_ROTULO[s.fonte] : null;
          const code = escolha[g.chave] ?? s?.code ?? "";
          const expandido = aberto === g.chave;
          return (
            <li key={g.chave} className="fin-qual-item" data-transferencia={s?.fonte === "transferencia" ? "sim" : undefined}>
              <div className="fin-qual-cabeca">
                <button
                  type="button"
                  className="fin-qual-toggle"
                  onClick={() => setAberto(expandido ? null : g.chave)}
                  aria-expanded={expandido}
                >
                  <strong>
                    {/* Entrada e saída antes do nome: a categoria certa para uma
                        depende disso, e ler o valor sem o sinal já custou erro. */}
                    <span className="fin-qual-dir" data-dir={g.direcao}>
                      {g.direcao === "entrada" ? "↓ entrada" : "↑ saída"}
                    </span>
                    {g.rotulo.slice(0, 66)}
                  </strong>
                  <small>
                    {g.n} {g.n === 1 ? "lançamento" : "lançamentos"} ·{" "}
                    {g.contas.map((c) => (
                      <span key={c} className="fin-qual-conta">{c}</span>
                    ))}{" "}
                    · {String(g.maisRecente).slice(0, 10).split("-").reverse().join("/")}
                    {g.valorFixo ? " · valor fixo" : g.valoresDistintos > 1 ? ` · ${g.valoresDistintos} valores` : ""}
                  </small>
                </button>
                <span className="fin-qual-valor" data-dir={g.direcao}>
                  {g.direcao === "entrada" ? "+" : "−"}{brlPrecise(g.valorCents)}
                </span>
              </div>

              {s ? (
                <p className="fin-qual-evidencia" style={{ borderColor: f?.tom }}>
                  <span className="fin-qual-fonte" style={{ background: f?.tom }}>
                    {f?.texto} · {(100 * s.confianca).toFixed(0)}%
                  </span>
                  {s.evidencia}
                </p>
              ) : (
                <p className="fin-qual-evidencia fin-qual-sem">
                  Nada no histórico explica este grupo — precisa da sua decisão.
                </p>
              )}

              {s?.fonte === "transferencia" ? (
                <p className="fin-alert fin-qual-aviso">
                  Isto parece dinheiro mudando de conta, não receita. Classificar como receita contaria o mesmo
                  valor duas vezes — uma quando o cliente pagou, outra quando o dinheiro trocou de banco.
                </p>
              ) : null}

              <div className="fin-qual-acoes">
                <select
                  className="fin-select"
                  value={code}
                  onChange={(e) => setEscolha((x) => ({ ...x, [g.chave]: e.target.value }))}
                  aria-label={`Categoria para ${g.rotulo}`}
                >
                  <option value="">Escolha a categoria…</option>
                  {fila.categorias.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} · {c.name}
                    </option>
                  ))}
                </select>
                <label className="fin-check" title="Cria uma regra para as próximas importações já chegarem classificadas">
                  <input
                    type="checkbox"
                    checked={criarRegra[g.chave] ?? false}
                    onChange={(e) => setCriarRegra((x) => ({ ...x, [g.chave]: e.target.checked }))}
                  />
                  criar regra
                </label>
                <button
                  type="button"
                  className="fin-btn-primary"
                  disabled={!code || pendente === g.chave}
                  onClick={() => void aplicar(g, code, criarRegra[g.chave] ?? false)}
                >
                  {pendente === g.chave ? "aplicando…" : `Aplicar aos ${g.n}`}
                </button>
              </div>

              {expandido ? (
                <table className="fin-qual-detalhe">
                  <tbody>
                    {g.itens.slice(0, 30).map((i) => (
                      <tr key={i.id}>
                        <td className="fin-nowrap">{i.postedOn.slice(0, 10).split("-").reverse().join("/")}</td>
                        <td className="fin-nowrap" data-dir={i.amountCents > 0 ? "entrada" : "saida"}>
                          {i.amountCents > 0 ? "+" : "−"}{brlPrecise(Math.abs(i.amountCents))}
                        </td>
                        <td><span className="fin-qual-conta">{i.conta}</span></td>
                        <td className="fin-desc-sub">{i.descricao.slice(0, 70)}</td>
                      </tr>
                    ))}
                    {g.n > 30 ? (
                      <tr>
                        <td colSpan={4} className="fin-desc-sub">… e mais {g.n - 30}</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              ) : null}
            </li>
          );
        })}
      </ul>

      {!grupos.length ? (
        <p className="fin-empty-row">
          {feito.length ? "Tudo que casava com o filtro foi decidido." : "Nenhum grupo com esse filtro."}
        </p>
      ) : null}
    </div>
  );
}

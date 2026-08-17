"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { brlCents, brlPrecise, dateLabel } from "@/lib/financeiro/format";

type Regra = {
  id: number;
  slug: string;
  name: string;
  priority: number;
  matchScope: string;
  conditions: { all?: { field: string; op: string; value: unknown }[] };
  actions: { category_code?: string; nucleo?: string };
  confidence: number;
  source: string;
  status: string;
  hitsCount: number;
  lastHitAt: string | null;
};

type Preview = {
  casaria: number;
  valorCents: number;
  jaClassificadas: number;
  afetaria: number;
  amostra: { id: number; descricao: string; amountCents: number; jaClassificada: boolean }[];
};

type Props = {
  regras: Regra[];
  /** true quando a consulta falhou — lista vazia por não saber, não por não haver. */
  indisponivel?: boolean;
  categorias: { code: string; name: string }[];
  nucleos: { slug: string; name: string }[];
};

/**
 * Editor de regras de classificação.
 *
 * É a peça que faz o módulo se manter sozinho: uma regra criada aqui classifica
 * as cobranças de hoje E as de amanhã, sem programador.
 *
 * O DRY-RUN NÃO É CONVENIÊNCIA, É PROTEÇÃO. Este módulo já teve duas vezes o
 * mesmo acidente — uma agulha curta demais casando com o NOME de alguém:
 * "medicao" pegou 276 transferências porque está na razão social da empresa, e
 * "art " pegou lançamentos da Art Foods e da CHICO BART. As duas teriam sido
 * óbvias num preview. Por isso salvar sem simular é impossível aqui.
 */
export function FinRules({ regras, categorias, nucleos, indisponivel = false }: Props) {
  const router = useRouter();
  const [pendente, startTransition] = useTransition();
  const [nome, setNome] = useState("");
  const [agulhas, setAgulhas] = useState("");
  const [categoria, setCategoria] = useState("");
  const [nucleo, setNucleo] = useState("");
  const [prioridade, setPrioridade] = useState("100");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const condicoes = () => ({
    all: [
      {
        field: "description_norm",
        op: "contains_any",
        // Minúsculas e sem acento porque é assim que description_norm é gravada
        // — uma agulha com acento nunca casaria nada, silenciosamente.
        value: agulhas
          .split(",")
          .map((item) =>
            item
              .trim()
              .toLowerCase()
              .normalize("NFD")
              .replace(/[̀-ͯ]/g, "")
          )
          .filter(Boolean)
      }
    ]
  });

  async function simular() {
    setErro(null);
    setPreview(null);
    const resposta = await fetch("/api/financeiro/regras/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conditions: condicoes() })
    });
    const corpo = await resposta.json();
    if (!resposta.ok) {
      setErro(corpo.error ?? "não consegui simular");
      return;
    }
    setPreview(corpo);
  }

  async function salvarEAplicar() {
    setErro(null);
    const criar = await fetch("/api/financeiro/regras", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: nome,
        priority: Number(prioridade),
        conditions: condicoes(),
        actions: { category_code: categoria, ...(nucleo ? { nucleo } : {}) },
        confidence: 95
      })
    });
    const criada = await criar.json();
    if (!criar.ok) {
      setErro(criada.error ?? "não consegui salvar a regra");
      return;
    }

    const aplicar = await fetch("/api/financeiro/regras/aplicar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ruleId: criada.id ?? criada.rule?.id })
    });
    const resultado = await aplicar.json();
    setAviso(
      aplicar.ok
        ? `Regra criada e aplicada a ${resultado.aplicados} cobranças.`
        : `Regra criada, mas a aplicação falhou: ${resultado.error}`
    );
    setNome("");
    setAgulhas("");
    setCategoria("");
    setPreview(null);
    startTransition(() => router.refresh());
  }

  const pronta = nome.trim() && agulhas.trim() && categoria && preview;

  return (
    <>
      {erro ? (
        <div className="fin-alert" role="alert">
          {erro}
        </div>
      ) : null}
      {aviso ? (
        <div className="fin-alert" role="status">
          {aviso}
        </div>
      ) : null}

      <section className="card">
        <h2 className="card-title">Nova regra</h2>
        <p className="fin-card-hint">
          Uma regra é uma hipótese: ela ganha o que ninguém reivindicou, nunca sobrescreve decisão humana nem
          classificação existente. Simular é obrigatório — foi assim que dois acidentes de agulha curta demais
          entraram neste módulo antes.
        </p>

        <div className="fin-regra-form">
          <label className="fin-field">
            <span>Nome</span>
            <input
              className="fin-input"
              value={nome}
              onChange={(evento) => setNome(evento.target.value)}
              placeholder="Ex.: Inspeção termográfica"
            />
          </label>
          <label className="fin-field fin-field-wide">
            <span>Palavras que identificam (separadas por vírgula)</span>
            <input
              className="fin-input"
              value={agulhas}
              onChange={(evento) => {
                setAgulhas(evento.target.value);
                setPreview(null);
              }}
              placeholder="termografia, inspecao termografica"
            />
          </label>
          <label className="fin-field">
            <span>Categoria</span>
            <select className="fin-select" value={categoria} onChange={(evento) => setCategoria(evento.target.value)}>
              <option value="">escolha…</option>
              {categorias.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.code} · {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="fin-field">
            <span>Núcleo (opcional)</span>
            <select className="fin-select" value={nucleo} onChange={(evento) => setNucleo(evento.target.value)}>
              <option value="">nenhum</option>
              {nucleos.map((item) => (
                <option key={item.slug} value={item.slug}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="fin-field">
            <span>Prioridade (menor roda primeiro)</span>
            <input
              className="fin-input"
              value={prioridade}
              inputMode="numeric"
              onChange={(evento) => setPrioridade(evento.target.value)}
            />
          </label>
        </div>

        <div className="fin-import-acoes">
          <button
            type="button"
            className="fin-btn-ghost"
            disabled={!agulhas.trim() || pendente}
            onClick={() => void simular()}
          >
            Simular impacto
          </button>
          <button type="button" className="fin-btn-primary" disabled={!pronta || pendente} onClick={() => void salvarEAplicar()}>
            Criar e aplicar
          </button>
        </div>

        {preview ? (
          <div className={preview.afetaria === 0 ? "fin-preview vazio" : "fin-preview"}>
            <p className="fin-preview-titulo">
              Casaria <strong>{preview.casaria}</strong> cobranças ·{" "}
              <strong>{brlCents(preview.valorCents)}</strong>
            </p>
            <p className="fin-preview-sub">
              {preview.jaClassificadas} já têm categoria e ficariam como estão. Esta regra mudaria{" "}
              <strong>{preview.afetaria}</strong>.
            </p>
            <table className="fin-table">
              <tbody>
                {preview.amostra.map((linha) => (
                  <tr key={linha.id}>
                    <td>
                      {linha.descricao.slice(0, 80)}
                      {linha.jaClassificada ? <span className="fin-tag">já classificada</span> : null}
                    </td>
                    <td className="num fin-table-money">{brlPrecise(linha.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="card">
        <h2 className="card-title">
          {indisponivel ? (
            <span className="fin-indisponivel">
              Regras ativas — indeterminado: a origem não respondeu
            </span>
          ) : (
            <>Regras ativas ({regras.length})</>
          )}
        </h2>
        <p className="fin-card-hint">
          Em ordem de execução. A primeira que casa vence — por isso "comissionamento de vendas" precisa estar antes
          de "laudo" e de "comissão", que compartilham radical mas significam coisas opostas.
        </p>
        <div className="table-wrap">
          <table className="fin-table">
            <thead>
              <tr>
                <th className="num">Prio</th>
                <th>Regra</th>
                <th>Categoria</th>
                <th>Escopo</th>
                <th className="num">Usos</th>
                <th>Última vez</th>
              </tr>
            </thead>
            <tbody>
              {regras.map((regra) => (
                <tr key={regra.id}>
                  <td className="num">{regra.priority}</td>
                  <td>
                    {regra.name}
                    {regra.source === "seed" ? <span className="fin-tag">inicial</span> : null}
                    {regra.confidence < 80 ? <span className="fin-tag">manda revisar</span> : null}
                  </td>
                  <td>
                    <span className="fin-code">{regra.actions?.category_code ?? "—"}</span>
                  </td>
                  <td>{regra.matchScope === "document" ? "cobrança" : regra.matchScope}</td>
                  <td className="num">{regra.hitsCount}</td>
                  <td className="fin-nowrap">{regra.lastHitAt ? dateLabel(regra.lastHitAt) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

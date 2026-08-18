"use client";

import { useMemo, useState } from "react";

import { Nota } from "@/components/ui/Nota";
import { brlPrecise } from "@/lib/financeiro/format";
import type { CelulaModelo, LinhaModelo, ResumoModelo } from "@/lib/financeiro/modelo";

/**
 * O modelo de gestão na tela, na forma da planilha do dono.
 *
 * TRÊS MODOS, porque são três perguntas diferentes e misturá-las numa tela só
 * produziu, na planilha original, o erro que custou mais caro: comparar sete
 * meses de receita com cinco de custo e concluir R$ 396 mil de lucro.
 *
 *   realizado  o que os extratos provam. É o padrão.
 *   comparar   realizado × planilha, com a divergência explícita por célula.
 *   editar     o dono digita o que sabe e o ledger ainda não.
 *
 * O CINZA DAS COLUNAS SEM DADO não é decoração. A planilha do dono tem custo
 * até maio e receita até julho; quem olha a linha de EBITDA de junho vê um
 * número que é receita sem custo nenhum. Aqui, mês sem cobertura dos dois lados
 * aparece apagado e o rodapé diz por quê — a tela recusa-se a exibir um lucro
 * que só existe porque falta a metade de baixo.
 */

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

const ROTULO_SECAO: Record<string, string> = {
  receita: "Receita",
  deducao: "Deduções, impostos e financeiro",
  custo_operacao: "Custos de operação",
  custo_fixo: "Custos fixos",
  resultado: "Resultado"
};

const ROTULO_CONFIANCA: Record<string, { texto: string; tom: string }> = {
  exata: { texto: "confere ao centavo com a planilha", tom: "#0f7b4f" },
  alta: { texto: "correspondência de definição", tom: "#0f7b4f" },
  media: { texto: "a categoria cobre a linha, mas pode conter outras coisas", tom: "#8a6d1f" },
  sem_fonte: { texto: "a planilha tem a linha; o ledger não tem como alimentá-la", tom: "#9aa4ab" }
};

type Modo = "realizado" | "comparar" | "editar";

export function FinModelo({ dados }: { dados: ResumoModelo }) {
  const [modo, setModo] = useState<Modo>("realizado");
  const [editando, setEditando] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);
  const [ocultarVazias, setOcultarVazias] = useState(true);

  // Sobreposições otimistas: a tela precisa refletir a edição antes do reload do
  // Server Component, senão o dono digita e o número não se move por um segundo
  // — e ele digita de novo.
  const [locais, setLocais] = useState<Map<string, number | null>>(new Map());

  const chave = (slug: string, mes: number) => `${slug}:${mes}`;

  const valorDe = (linha: LinhaModelo, c: CelulaModelo) => {
    const k = chave(linha.slug, c.mes);
    if (locais.has(k)) {
      const v = locais.get(k);
      return v ?? c.realizado ?? 0;
    }
    return c.valor;
  };

  const linhasVisiveis = useMemo(() => {
    if (!ocultarVazias) return dados.linhas;
    // Uma linha some quando não tem realizado, nem referência, nem edição.
    // Some a linha, não a seção: a hierarquia continua legível.
    const comConteudo = new Set<string>();
    for (const l of dados.linhas) {
      const tem =
        l.celulas.some((c) => c.realizado || c.referencia || c.manual) || l.tipo !== "item";
      if (tem) {
        comConteudo.add(l.slug);
        let pai = l.paiSlug;
        for (let i = 0; pai && i < 8; i += 1) {
          comConteudo.add(pai);
          pai = dados.linhas.find((x) => x.slug === pai)?.paiSlug ?? null;
        }
      }
    }
    return dados.linhas.filter((l) => comConteudo.has(l.slug));
  }, [dados.linhas, ocultarVazias, versao]);

  /** Meses cobertos pelos DOIS lados — os únicos em que comparar faz sentido. */
  const mesesComparaveis = useMemo(() => {
    const s = new Set(dados.mesesComReferencia);
    return dados.mesesComDado.filter((m) => s.has(m));
  }, [dados.mesesComDado, dados.mesesComReferencia]);

  async function salvar(linha: LinhaModelo, mes: number) {
    setSalvando(true);
    setErro(null);
    const texto = rascunho.trim();
    // Vazio apaga: devolve a célula ao ledger em vez de gravar zero.
    const valorCents =
      texto === ""
        ? null
        : Math.round(Number(texto.replace(/\./g, "").replace(",", ".")) * 100);

    if (valorCents !== null && !Number.isFinite(valorCents)) {
      setErro("valor não é um número");
      setSalvando(false);
      return;
    }

    try {
      const r = await fetch("/api/financeiro/modelo", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ano: dados.ano, mes, linha: linha.slug, valorCents })
      });
      const corpo = await r.json();
      if (!r.ok) throw new Error(corpo?.erro ?? "falha ao gravar");
      setLocais((m) => new Map(m).set(chave(linha.slug, mes), valorCents));
      setEditando(null);
      setVersao((v) => v + 1);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "falha ao gravar");
    } finally {
      setSalvando(false);
    }
  }

  const totalDaLinha = (l: LinhaModelo) => l.celulas.reduce((s, c) => s + valorDe(l, c), 0);

  return (
    <div className="fin-modelo">
      <div className="fin-modelo-barra">
        <div className="fin-modelo-modos" role="tablist" aria-label="Modo de leitura">
          {(
            [
              ["realizado", "Realizado"],
              ["comparar", "Comparar com a planilha"],
              ["editar", "Editar"]
            ] as [Modo, string][]
          ).map(([m, rotulo]) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={modo === m}
              className={modo === m ? "fin-btn-primary" : "fin-btn-ghost"}
              onClick={() => {
                setModo(m);
                setEditando(null);
              }}
            >
              {rotulo}
            </button>
          ))}
        </div>
        <label className="fin-check">
          <input
            type="checkbox"
            checked={ocultarVazias}
            onChange={(e) => setOcultarVazias(e.target.checked)}
          />
          esconder linhas sem movimento
        </label>
      </div>

      {modo === "comparar" && mesesComparaveis.length < dados.mesesComDado.length ? (
        <p className="fin-alert">
          A planilha cobre {mesesComparaveis.length} {mesesComparaveis.length === 1 ? "mês" : "meses"} (
          {mesesComparaveis.map((m) => MESES[m - 1]).join(", ")}); o ledger cobre{" "}
          {dados.mesesComDado.length}. Fora dessa janela a comparação mede a ausência de dado na planilha, não
          divergência.
        </p>
      ) : null}

      {erro ? <p className="fin-alert">{erro}</p> : null}

      <div className="fin-matrix-wrap">
        <table className="fin-matrix fin-modelo-tabela">
          <thead>
            <tr>
              <th className="fin-matrix-head">Linha</th>
              {MESES.map((rotulo, i) => (
                <th
                  key={rotulo}
                  className={dados.mesesComDado.includes(i + 1) ? "" : "fin-zero"}
                  scope="col"
                >
                  {rotulo}
                </th>
              ))}
              <th scope="col">Ano</th>
              {modo === "comparar" ? <th scope="col">Planilha</th> : null}
            </tr>
          </thead>
          <tbody>
            {linhasVisiveis.map((linha) => {
              const ehGrupo = linha.tipo !== "item";
              const conf = ROTULO_CONFIANCA[linha.confianca];
              return (
                <tr
                  key={linha.slug}
                  className={ehGrupo ? "fin-modelo-grupo" : undefined}
                  data-secao={linha.secao}
                >
                  <th className="fin-matrix-head" scope="row">
                    <span style={{ paddingLeft: `${linha.nivel * 14}px` }}>
                      {linha.nome}
                      {linha.confianca === "sem_fonte" && !ehGrupo ? (
                        <em className="fin-modelo-marca" title={conf.texto}>
                          {" "}
                          sem fonte
                        </em>
                      ) : null}
                      {linha.confianca === "media" && !ehGrupo ? (
                        <em className="fin-modelo-marca" title={conf.texto} style={{ color: conf.tom }}>
                          {" "}
                          aproximado
                        </em>
                      ) : null}
                    </span>
                    {linha.fontes.length ? (
                      <small className="fin-modelo-fontes">{linha.fontes.join(" · ")}</small>
                    ) : null}
                  </th>

                  {linha.celulas.map((c) => {
                    const v = valorDe(linha, c);
                    const k = chave(linha.slug, c.mes);
                    const editavel = modo === "editar" && !ehGrupo;
                    const temManual = locais.has(k) ? locais.get(k) !== null : c.manual !== null;
                    const divergente =
                      modo === "comparar" && c.referencia !== null && Math.abs(v - c.referencia) >= 100;

                    if (editando === k) {
                      return (
                        <td key={c.mes} className="fin-modelo-celula-edit">
                          <input
                            className="fin-input"
                            autoFocus
                            value={rascunho}
                            disabled={salvando}
                            onChange={(e) => setRascunho(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void salvar(linha, c.mes);
                              if (e.key === "Escape") setEditando(null);
                            }}
                            onBlur={() => void salvar(linha, c.mes)}
                            aria-label={`${linha.nome}, ${MESES[c.mes - 1]}`}
                          />
                        </td>
                      );
                    }

                    return (
                      <td
                        key={c.mes}
                        className={[
                          v === 0 ? "fin-zero" : "",
                          temManual ? "fin-modelo-manual" : "",
                          divergente ? "fin-modelo-divergente" : "",
                          editavel ? "fin-modelo-editavel" : ""
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        title={
                          modo === "comparar" && c.referencia !== null
                            ? `ledger ${brlPrecise(c.realizado ?? 0)} · planilha ${brlPrecise(c.referencia)}`
                            : temManual
                              ? "valor digitado — clique em Editar para alterar ou apagar"
                              : undefined
                        }
                        onClick={
                          editavel
                            ? () => {
                                setEditando(k);
                                setRascunho(v === 0 ? "" : (v / 100).toFixed(2).replace(".", ","));
                              }
                            : undefined
                        }
                      >
                        {v === 0 ? "—" : brlPrecise(v)}
                        {modo === "comparar" && c.referencia !== null ? (
                          <small className="fin-modelo-ref">{brlPrecise(v - c.referencia)}</small>
                        ) : null}
                      </td>
                    );
                  })}

                  <td className="fin-nowrap">
                    <strong>{brlPrecise(totalDaLinha(linha))}</strong>
                  </td>
                  {modo === "comparar" ? (
                    <td className="fin-nowrap fin-modelo-ref-col">
                      {linha.totalReferencia === null ? "—" : brlPrecise(linha.totalReferencia)}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>

          <tfoot>
            {(["receita", "deducao", "custo_operacao", "custo_fixo"] as const).map((s) => (
              <tr key={s}>
                <th className="fin-matrix-head" scope="row">
                  {ROTULO_SECAO[s]}
                </th>
                {dados.totaisPorSecao[s].map((v, i) => (
                  <td key={i} className={v === 0 ? "fin-zero" : ""}>
                    {v === 0 ? "—" : brlPrecise(v)}
                  </td>
                ))}
                <td className="fin-nowrap">
                  <strong>{brlPrecise(dados.totaisPorSecao[s].reduce((a, b) => a + b, 0))}</strong>
                </td>
                {modo === "comparar" ? <td /> : null}
              </tr>
            ))}
            <tr className="fin-modelo-ebitda">
              <th className="fin-matrix-head" scope="row">
                EBITDA
              </th>
              {dados.ebitda.map((v, i) => {
                const comparavel = mesesComparaveis.includes(i + 1);
                return (
                  <td key={i} className={comparavel ? "" : "fin-zero"} title={comparavel ? undefined : "mês sem cobertura dos dois lados"}>
                    {v === 0 ? "—" : brlPrecise(v)}
                  </td>
                );
              })}
              <td className="fin-nowrap">
                <strong>{brlPrecise(dados.ebitda.reduce((a, b) => a + b, 0))}</strong>
              </td>
              {modo === "comparar" ? <td /> : null}
            </tr>
          </tfoot>
        </table>
      </div>

      <Nota rotulo="Regime, aproximações, e o que não tem fonte">
        <p>
          Regime de caixa, por data de pagamento — é o mesmo regime da aba "Fluxo de Caixa" da planilha, para que os
          dois sejam comparáveis. Transferência entre contas próprias fica de fora dos dois lados. Linhas marcadas{" "}
          <em>aproximado</em> somam categorias que podem conter mais coisas do que o nome da linha diz;{" "}
          <em>sem fonte</em> significa que o extrato bancário não tem como alimentá-las — depreciação e fatura de
          cartão são os casos maiores.
        </p>
      </Nota>
      {dados.atualizadoEm ? (
        <p className="fin-card-hint">
          Referência da planilha importada em{" "}
          {new Date(dados.atualizadoEm).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}.
        </p>
      ) : null}
    </div>
  );
}

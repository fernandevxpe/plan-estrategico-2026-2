"use client";

import { useMemo, useState } from "react";
import { CalendarRange, Layers, Repeat } from "lucide-react";

import type { CustosEmpresa } from "@/lib/financeiro/custos-empresa";
import { brlCents, monthKeyLabel } from "@/lib/financeiro/format";
import type { FatiaCusto } from "@/lib/financeiro/repartir-custo-area";

import { DeltaCusto, KpiAnalise, crescimentoDe, type SparkPonto } from "./FinKpiAnalise";
import { FinPessoasCustoGraficos } from "./FinPessoasCustoGraficos";
import { FinSecaoColapsavel } from "./FinSecaoColapsavel";

/**
 * CUSTO DA EMPRESA — a mesma leitura de Pessoas, para o que não é pessoa.
 *
 * Reusa `KpiAnalise` e `FinPessoasCustoGraficos` de propósito: quem atravessa
 * as duas telas precisa que "+20,1% vs. jul" queira dizer a mesma coisa nas
 * duas. Duas implementações do mesmo indicador divergem no primeiro ajuste.
 *
 * O QUE MUDA EM RELAÇÃO A PESSOAS
 * -------------------------------
 *  · Não há "por time" nem "por vínculo": um aluguel não tem time.
 *  · A dimensão que funciona é CATEGORIA — 88 de 88 itens do catálogo a têm,
 *    enquanto `cost_center_id` está 100% nulo e `nucleo` em 83%. "Por área da
 *    empresa" não existe ainda para custo: `fin_area_empresa` só se liga a
 *    pessoa (única FK). Quando a ligação nascer, entra aqui como um painel a
 *    mais, sem mexer no resto.
 *  · Ganha o bloco de CAMADAS EXCLUÍDAS, que Pessoas não precisa ter: aqui é
 *    onde a folha aparece sem ser somada, com link para onde ela é contada.
 */

const ATALHOS = [
  { slug: "recente", rotulo: "Mês recente" },
  { slug: "3m", rotulo: "3 meses" },
  { slug: "6m", rotulo: "6 meses" },
  { slug: "tudo", rotulo: "Todo o período" }
] as const;

/** Cor por prefixo do plano de contas — o mesmo eixo que a DRE usa. */
function corCategoria(code: string): string {
  const g = code.split(".")[0];
  return (
    {
      "4": "var(--purple)",
      "5": "var(--ink-blue)",
      "7": "var(--ink-amber)",
      "8": "var(--neon-green-ink)",
      "3": "var(--neon-pink-ink)"
    }[g] ?? "var(--muted)"
  );
}

const PALETA_CONTA = ["var(--purple)", "var(--ink-blue)", "var(--neon-green-ink)", "var(--ink-amber)", "var(--muted)"];

const ROTULO_NATUREZA: Record<string, string> = {
  fixo: "Fixo",
  variavel_volume: "Variável (por volume)",
  estimado: "Estimado",
  indeterminado: "Indeterminado"
};

export function FinCustosEmpresa({ dados }: { dados: CustosEmpresa }) {
  const [atalho, setAtalho] = useState<(typeof ATALHOS)[number]["slug"]>("tudo");
  const [serieA, setSerieA] = useState("");
  const [serieB, setSerieB] = useState("media");

  if (!dados.disponivel) {
    return (
      <section className="card fin-empty">
        <h2 className="card-title">Custo da empresa indisponível</h2>
        <p>Sem conexão com o banco do financeiro, ou nenhum lançamento categorizado no período.</p>
      </section>
    );
  }

  return (
    <ConteudoCustos
      dados={dados}
      atalho={atalho}
      setAtalho={setAtalho}
      serieA={serieA}
      serieB={serieB}
      setSerieA={setSerieA}
      setSerieB={setSerieB}
    />
  );
}

/**
 * Os hooks vivem aqui porque não podem ficar depois do `return` de guarda
 * acima — a mesma divisão em dois níveis de `FinPessoas.tsx`.
 */
function ConteudoCustos({
  dados,
  atalho,
  setAtalho,
  serieA,
  serieB,
  setSerieA,
  setSerieB
}: {
  dados: CustosEmpresa;
  atalho: string;
  setAtalho: (v: (typeof ATALHOS)[number]["slug"]) => void;
  serieA: string;
  serieB: string;
  setSerieA: (v: string) => void;
  setSerieB: (v: string) => void;
}) {
  const { meses, celulas } = dados;

  // O recorte só corta a JANELA de meses. Tudo abaixo soma `celulasNoRecorte`,
  // que é o mesmo array — a decisão nº 1 de pessoas.ts, repetida de propósito.
  const mesesNoRecorte = useMemo(() => {
    if (atalho === "tudo") return meses;
    const n = atalho === "recente" ? 1 : atalho === "3m" ? 3 : 6;
    return meses.slice(-n);
  }, [meses, atalho]);

  const celulasNoRecorte = useMemo(
    () => celulas.filter((c) => mesesNoRecorte.includes(c.mes)),
    [celulas, mesesNoRecorte]
  );

  const totalCents = celulasNoRecorte.reduce((s, c) => s + c.cents, 0);
  const ultimoMes = mesesNoRecorte[mesesNoRecorte.length - 1] ?? null;
  const penultimoMes = mesesNoRecorte[mesesNoRecorte.length - 2] ?? null;
  const somaDoMes = (mes: string | null) =>
    mes ? celulas.filter((c) => c.mes === mes).reduce((s, c) => s + c.cents, 0) : 0;
  const ultimoMesCents = somaDoMes(ultimoMes);
  const penultimoMesCents = somaDoMes(penultimoMes);
  const mediaMensalCents = mesesNoRecorte.length ? Math.round(totalCents / mesesNoRecorte.length) : 0;

  // Período anterior de mesmo tamanho, para o Δ do total ter contra o que medir.
  const anteriores = meses.slice(
    Math.max(0, meses.length - mesesNoRecorte.length * 2),
    Math.max(0, meses.length - mesesNoRecorte.length)
  );
  const totalAnteriorCents = celulas
    .filter((c) => anteriores.includes(c.mes))
    .reduce((s, c) => s + c.cents, 0);

  // Séries dos sparks: acumulada no total, mensal no mês, média corrente na média.
  const serieMensal: SparkPonto[] = mesesNoRecorte.map((mes) => ({ mes, cents: somaDoMes(mes) }));
  const serieAcumulada: SparkPonto[] = mesesNoRecorte.map((mes, i) => ({
    mes,
    cents: mesesNoRecorte.slice(0, i + 1).reduce((s, m) => s + somaDoMes(m), 0)
  }));
  const serieMedia: SparkPonto[] = mesesNoRecorte.map((mes, i) => ({
    mes,
    cents: Math.round(serieAcumulada[i].cents / (i + 1))
  }));

  /** Agrupa o grão numa dimensão e devolve as fatias que os gráficos comem. */
  function fatiar(chave: (c: (typeof celulas)[number]) => { slug: string; nome: string }): FatiaCusto[] {
    const m = new Map<string, FatiaCusto>();
    for (const c of celulasNoRecorte) {
      const { slug, nome } = chave(c);
      const f = m.get(slug) ?? { slug, nome, ultimoCents: 0, mediaCents: 0, totalCents: 0 };
      f.totalCents += c.cents;
      if (c.mes === ultimoMes) f.ultimoCents += c.cents;
      m.set(slug, f);
    }
    const n = Math.max(1, mesesNoRecorte.length);
    return [...m.values()]
      .map((f) => ({ ...f, mediaCents: Math.round(f.totalCents / n) }))
      .sort((a, b) => b.totalCents - a.totalCents);
  }

  const porCategoria = useMemo(
    () => fatiar((c) => ({ slug: c.categoriaCode, nome: `${c.categoriaCode} ${c.categoriaNome}` })),
    [celulasNoRecorte, ultimoMes]
  );
  const porConta = useMemo(
    () => fatiar((c) => ({ slug: c.contaNome, nome: c.contaNome })),
    [celulasNoRecorte, ultimoMes]
  );

  const contasOrdem = porConta.map((f) => f.slug);
  const opcoesComparativo = [
    ...mesesNoRecorte.map((m) => ({ id: `mes:${m}`, nome: monthKeyLabel(m) })),
    { id: "media", nome: `Média de ${mesesNoRecorte.length} meses` }
  ];
  const serieAEfetiva = serieA || (ultimoMes ? `mes:${ultimoMes}` : "media");

  const catalogoTotal = dados.catalogo.reduce((s, i) => s + (i.valorCents ?? 0), 0);
  const excluidoTotal = dados.camadasExcluidas.reduce((s, c) => s + c.cents, 0);
  const ultimoParcial = ultimoMes === dados.mesParcial;

  return (
    <>
      <section className="fin-pessoas-kpis" aria-label="Indicadores de custo da empresa">
        <div className="fin-pessoas-kpi-faixa">
          <KpiAnalise
            destaque
            rotulo="Total da empresa"
            valor={brlCents(totalCents)}
            delta={
              <DeltaCusto atual={totalCents} anterior={totalAnteriorCents} contra="período anterior" />
            }
            extra={
              <p className="fin-pessoas-kpi-extra">
                {mesesNoRecorte.length} {mesesNoRecorte.length === 1 ? "mês" : "meses"} · sem folha
              </p>
            }
            pontos={serieAcumulada}
            crescimento={crescimentoDe(serieAcumulada)}
            ariaSpark="Custo acumulado no recorte"
          />
          <KpiAnalise
            rotulo={
              <>
                Mês {ultimoMes ? monthKeyLabel(ultimoMes) : "—"}
                {ultimoParcial ? <span className="fin-tag">parcial</span> : null}
              </>
            }
            valor={brlCents(ultimoMesCents)}
            delta={
              <DeltaCusto
                atual={ultimoMesCents}
                anterior={penultimoMes ? penultimoMesCents : null}
                contra={penultimoMes ? monthKeyLabel(penultimoMes) : ""}
              />
            }
            pontos={serieMensal}
            crescimento={crescimentoDe(serieMensal)}
            ariaSpark="Custo mês a mês"
          />
          <KpiAnalise
            rotulo="Média mensal"
            valor={brlCents(mediaMensalCents)}
            delta={
              <DeltaCusto
                atual={mediaMensalCents}
                anterior={anteriores.length ? Math.round(totalAnteriorCents / anteriores.length) : null}
                contra="período anterior"
              />
            }
            pontos={serieMedia}
            crescimento={crescimentoDe(serieMedia)}
            ariaSpark="Média mensal corrente"
          />
          <KpiAnalise
            rotulo="Recorrente detectado"
            valor={brlCents(catalogoTotal)}
            delta={
              <p className="fin-delta neutro">
                {dados.catalogo.length} {dados.catalogo.length === 1 ? "item" : "itens"} no catálogo
              </p>
            }
            extra={
              <p className="fin-pessoas-kpi-extra">
                {brlCents(excluidoTotal)} em outras camadas, fora deste total
              </p>
            }
            pontos={serieMensal}
            crescimento={null}
            ariaSpark="Custo mês a mês"
          />
        </div>
      </section>

      <FinSecaoColapsavel
        titulo="Custos por categoria e conta"
        icone={Layers}
        meta={`${mesesNoRecorte.length} ${mesesNoRecorte.length === 1 ? "mês" : "meses"} · ${brlCents(totalCents)}`}
        abertoPadrao
        ariaLabel="Custo da empresa por categoria e por conta"
      >
        <FinPessoasCustoGraficos
          paineis={[
            { titulo: "Por categoria", fatias: porCategoria, corDe: (slug) => corCategoria(slug) },
            {
              titulo: "Por conta",
              fatias: porConta,
              corDe: (slug) => PALETA_CONTA[contasOrdem.indexOf(slug) % PALETA_CONTA.length]
            }
          ]}
          nota="Folha, DAS e conta já a pagar ficam fora deste total — cada um é contado na tela onde é decidido. As três leituras (separado, empilhado, pizza) são o mesmo número."
          ultimoMesLabel={ultimoMes ? monthKeyLabel(ultimoMes) : "—"}
          mediaLabel={`Média de ${mesesNoRecorte.length} meses`}
          opcoesComparativo={opcoesComparativo}
          serieA={serieAEfetiva}
          serieB={serieB}
          onSerieA={setSerieA}
          onSerieB={setSerieB}
          atalhos={[
            ...(ultimoMes ? [{ id: "atual-media", nome: "Atual × média", a: `mes:${ultimoMes}`, b: "media" }] : []),
            ...(ultimoMes && penultimoMes
              ? [{ id: "atual-anterior", nome: "Atual × anterior", a: `mes:${ultimoMes}`, b: `mes:${penultimoMes}` }]
              : [])
          ]}
        />
      </FinSecaoColapsavel>

      <FinSecaoColapsavel
        titulo="Recorrentes detectados"
        icone={Repeat}
        meta={`${dados.catalogo.length} itens · ${brlCents(catalogoTotal)}/mês`}
        abertoPadrao
        ariaLabel="Catálogo de custos recorrentes da empresa"
      >
        <p className="fin-card-hint">
          O que se repete no extrato, com o valor sugerido e quantas vezes ocorreu. Marcar fixo ou variável e confirmar
          o valor é feito na tela do catálogo — aqui é a leitura.
        </p>
        <div className="fin-matrix-wrap">
          <table className="fin-table">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Categoria</th>
                <th scope="col">Natureza</th>
                <th scope="col" className="num">Ocorrências</th>
                <th scope="col" className="num">Valor/mês</th>
              </tr>
            </thead>
            <tbody>
              {dados.catalogo.map((i) => (
                <tr key={`${i.recurringId ?? i.descricao}`}>
                  <th scope="row">
                    <span className="fin-desc">{i.descricao}</span>
                    {i.primeiraCompetencia ? (
                      <span className="fin-desc-sub">
                        desde {monthKeyLabel(i.primeiraCompetencia)}
                        {i.ultimaCompetencia ? ` · até ${monthKeyLabel(i.ultimaCompetencia)}` : ""}
                      </span>
                    ) : null}
                  </th>
                  <td>{i.categoriaCode ? <span className="fin-code">{i.categoriaCode}</span> : "—"}</td>
                  <td>
                    {i.natureza ? (
                      <span className="fin-tag">{ROTULO_NATUREZA[i.natureza] ?? i.natureza}</span>
                    ) : (
                      <span className="fin-zero">—</span>
                    )}
                  </td>
                  <td className="num">{i.ocorrencias}</td>
                  <td className="num fin-table-money">
                    {i.valorCents ? brlCents(i.valorCents) : <span className="fin-zero">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </FinSecaoColapsavel>

      {dados.camadasExcluidas.length ? (
        <FinSecaoColapsavel
          titulo="Fora deste total, de propósito"
          icone={Layers}
          meta={brlCents(excluidoTotal)}
          ariaLabel="Camadas contadas em outras telas"
        >
          <p className="fin-card-hint">
            A detecção encontrou estes custos, e eles são reais — mas já são contados em outra tela. Somá-los aqui seria
            o mesmo dinheiro contado duas vezes.
          </p>
          <div className="fin-matrix-wrap">
            <table className="fin-table">
              <thead>
                <tr>
                  <th scope="col">Camada</th>
                  <th scope="col" className="num">Itens</th>
                  <th scope="col" className="num">Por mês</th>
                  <th scope="col">Onde é contado</th>
                </tr>
              </thead>
              <tbody>
                {dados.camadasExcluidas.map((c) => (
                  <tr key={c.camada}>
                    <th scope="row">{c.rotulo}</th>
                    <td className="num">{c.itens}</td>
                    <td className="num fin-table-money">{brlCents(c.cents)}</td>
                    <td>
                      {c.ondeVer ? (
                        <a className="pp-link" href={c.ondeVer}>
                          abrir
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </FinSecaoColapsavel>
      ) : null}

      <FinSecaoColapsavel
        titulo="Recorte"
        icone={CalendarRange}
        meta={
          mesesNoRecorte.length
            ? `${monthKeyLabel(mesesNoRecorte[0])} → ${monthKeyLabel(mesesNoRecorte[mesesNoRecorte.length - 1])}`
            : "—"
        }
        abertoPadrao
        ariaLabel="Recorte de período"
      >
        <div className="fin-contas-acoes" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
          {ATALHOS.map((a) => (
            <button
              key={a.slug}
              type="button"
              className={atalho === a.slug ? "fin-btn-primary" : "fin-btn-ghost"}
              aria-pressed={atalho === a.slug}
              onClick={() => setAtalho(a.slug)}
            >
              {a.rotulo}
            </button>
          ))}
        </div>
      </FinSecaoColapsavel>
    </>
  );
}

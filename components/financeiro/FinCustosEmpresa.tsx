"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarRange, FileDown, Layers } from "lucide-react";

import type { ContasAPagar } from "@/lib/financeiro/contas-a-pagar";
import type { AbaCustos } from "@/lib/financeiro/custo-empresa-abas";
import type { CustosEmpresa } from "@/lib/financeiro/custos-empresa";
import { baixarBlob, nomeDeArquivo } from "@/lib/exportar/grafico-png";
import { blobDePdf, pdfDaPagina } from "@/lib/exportar/pagina";
import { brlCents, monthKeyLabel } from "@/lib/financeiro/format";
import { varrerPagina } from "@/lib/exportar/alvos";

import { FinContasAPagar } from "./FinContasAPagar";
import { FinCustosEmpresaMatriz } from "./FinCustosEmpresaMatriz";
import { DeltaCusto, KpiAnalise, crescimentoDe, type SparkPonto } from "./FinKpiAnalise";
import { FinSecaoColapsavel } from "./FinSecaoColapsavel";

/**
 * CUSTO DA EMPRESA — a mesma casca de Pessoas, para o que não é pessoa.
 *
 * Três KPIs (total, mês, média), matriz mês a mês, classificação na linha
 * (time + área da empresa). O crescimento do total sai do RITMO, não do
 * acumulado: oito meses somados contra janeiro pintavam "+7.000%/ano".
 */

const ATALHOS = [
  { slug: "recente", rotulo: "Mês recente" },
  { slug: "3m", rotulo: "3 meses" },
  { slug: "6m", rotulo: "6 meses" },
  { slug: "tudo", rotulo: "Todo o período" }
] as const;

type Atalho = (typeof ATALHOS)[number]["slug"];

export function FinCustosEmpresa({
  dados,
  contas,
  aba
}: {
  dados: CustosEmpresa;
  contas: ContasAPagar;
  aba: AbaCustos;
}) {
  const router = useRouter();
  const [mesDe, setMesDe] = useState(dados.meses[0] ?? "");
  const [mesAte, setMesAte] = useState(dados.meses[dados.meses.length - 1] ?? "");

  /*
   * PDF = ARQUIVO GERADO, não diálogo de impressão.
   *
   * O que havia aqui era `window.print()` no clique, e o comentário antigo já
   * registrava a derrota: "o Chromium trava no 'Preparando…' e `afterprint`
   * nunca dispara". A tentativa de contornar adiando a chamada perdia o gesto
   * do usuário, e não adiar travava — não havia terceira saída dentro da
   * impressão nativa.
   *
   * CORREÇÃO DE 01/09/2026, no mesmo dia: eu tinha escrito aqui que a causa era
   * o reflow — `@media print` levando `.fin-layout` de `grid` para `block` e
   * `.fin-table-wrap` de `overflow: auto` para `visible` numa árvore enorme.
   * MEDI, e não é isso. Com o Chrome headless sobre o app local
   * (`Emulation.setEmulatedMedia` em `print`, depois forçando layout):
   *
   * | tela | nós | reflow em tela | reflow em impressão |
   * |---|---|---|---|
   * | `custos-empresa?aba=contas-a-pagar` | 2.393 | 134ms | **0ms** |
   * | `financeiro/caixa` | 861 | 32ms | 115ms |
   * | `financeiro/pessoas` | 3.581 | 164ms | 0ms |
   *
   * O reflow de impressão é mais BARATO que o de tela. A explicação que sobra
   * está fora do que essa medição alcança — a pré-visualização do Chromium
   * sobre a árvore VIVA, com React montado, `ResponsiveContainer` remedindo os
   * gráficos a cada mudança de caixa e elementos fixos no caminho. Deixo o
   * número escrito em vez de apagar a hipótese: ela já me fez propor o conserto
   * errado uma vez.
   *
   * Agora o dado é lido da tela e escrito num PDF de verdade
   * (`lib/exportar/`), que baixa como arquivo. Some o diálogo, some o reflow, e
   * o recorte que sai é exatamente o que está filtrado na tela — inclusive os
   * chips de ciclo, área e eixo, que só existem no estado do React.
   */
  const [exportando, setExportando] = useState(false);

  async function exportarPdf() {
    const recorte =
      aba === "contas-a-pagar"
        ? `Contas a pagar — ${monthKeyLabel(contas.competencia)}`
        : "Matriz de custo da empresa";
    setExportando(true);
    // Um quadro antes de trabalhar: sem ele o React não chega a pintar
    // "gerando…" e a tela parece travada — o mesmo sintoma que a impressão
    // nativa dava, e que não pode voltar por outra porta.
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    try {
      const bytes = await pdfDaPagina(varrerPagina());
      baixarBlob(blobDePdf(bytes), nomeDeArquivo(recorte, "pdf"));
    } catch (erro) {
      console.error("exportar custo da empresa:", erro);
    } finally {
      setExportando(false);
    }
  }

  // O `<em>` de cada aba mostra o número dela. É o motivo de a página carregar
  // as duas fontes juntas: uma aba que só sabe o próprio total obriga a clicar
  // para descobrir se vale a pena clicar (a razão está escrita igual em
  // app/financeiro/contas/page.tsx:25).
  const totalMatrizCents = useMemo(() => dados.celulas.reduce((s, c) => s + c.cents, 0), [dados.celulas]);
  const totalAPagarCents = useMemo(
    () => contas.linhas.reduce((s, l) => (l.entraNoTotal ? s + l.valorCents : s), 0),
    [contas.linhas]
  );

  // A aba vive na querystring para o link ser colável — mesma convenção de
  // FinPayables.tsx:126-129. `mes` cai fora ao voltar para a matriz: ele é
  // recorte de contas a pagar e não significa nada do outro lado.
  function trocarAba(proxima: AbaCustos) {
    router.replace(proxima === "matriz" ? "/financeiro/custos-empresa" : `/financeiro/custos-empresa?aba=${proxima}`, {
      scroll: false
    });
  }

  return (
    <>
      <p className="fin-print-cab">
        {aba === "contas-a-pagar"
          ? `Contas a pagar · ${monthKeyLabel(contas.competencia)}`
          : "Matriz de custo da empresa"}
        {contas.hoje ? ` · gerado em ${contas.hoje.split("-").reverse().join("/")}` : ""}
      </p>
      <nav className="fin-subtabs" aria-label="Visões do custo da empresa">
        <button
          type="button"
          className={aba === "matriz" ? "fin-subtab active" : "fin-subtab"}
          onClick={() => trocarAba("matriz")}
        >
          Matriz de custo
          <em>{dados.disponivel ? brlCents(totalMatrizCents) : "indisponível"}</em>
        </button>
        <button
          type="button"
          className={aba === "contas-a-pagar" ? "fin-subtab active" : "fin-subtab"}
          onClick={() => trocarAba("contas-a-pagar")}
        >
          Contas a pagar
          <em>{contas.disponivel ? brlCents(totalAPagarCents) : "indisponível"}</em>
        </button>
        <button
          type="button"
          className="fin-btn-ghost fin-print-btn"
          onClick={exportarPdf}
          disabled={exportando}
          title="Baixa esta tela em PDF, com o recorte que está filtrado agora"
        >
          <FileDown size={15} strokeWidth={2.2} aria-hidden />
          {exportando ? "Gerando…" : "Exportar PDF"}
        </button>
      </nav>

      {aba === "contas-a-pagar" ? (
        <FinContasAPagar dados={contas} />
      ) : !dados.disponivel ? (
        <section className="card fin-empty">
          <h2 className="card-title">Custo da empresa indisponível</h2>
          <p>Sem conexão com o banco do financeiro, ou nenhum lançamento categorizado no período.</p>
        </section>
      ) : (
        <ConteudoCustos dados={dados} mesDe={mesDe} mesAte={mesAte} setMesDe={setMesDe} setMesAte={setMesAte} />
      )}
    </>
  );
}

function ConteudoCustos({
  dados,
  mesDe,
  mesAte,
  setMesDe,
  setMesAte
}: {
  dados: CustosEmpresa;
  mesDe: string;
  mesAte: string;
  setMesDe: (v: string) => void;
  setMesAte: (v: string) => void;
}) {
  const mesesNoPeriodo = useMemo(
    () => dados.meses.filter((mes) => mes >= mesDe && mes <= mesAte),
    [dados.meses, mesDe, mesAte]
  );

  const celulasFiltradas = useMemo(
    () => dados.celulas.filter((c) => c.mes >= mesDe && c.mes <= mesAte),
    [dados.celulas, mesDe, mesAte]
  );

  const totalCents = celulasFiltradas.reduce((s, c) => s + c.cents, 0);

  const mesesComCusto = mesesNoPeriodo.filter((mes) =>
    celulasFiltradas.some((c) => c.mes === mes && c.cents !== 0)
  );
  const ultimoMes = mesesComCusto[mesesComCusto.length - 1] ?? null;
  const penultimoMes = mesesComCusto[mesesComCusto.length - 2] ?? null;
  const totalMes = (mes: string | null) =>
    mes ? celulasFiltradas.filter((c) => c.mes === mes).reduce((s, c) => s + c.cents, 0) : 0;
  const ultimoMesCents = totalMes(ultimoMes);
  const penultimoMesCents = totalMes(penultimoMes);
  const ultimoMesParcial = ultimoMes === dados.mesAtual;
  const mediaMensalCents = mesesComCusto.length ? Math.round(totalCents / mesesComCusto.length) : 0;

  const serieMensal: SparkPonto[] = mesesNoPeriodo.map((mes) => ({ mes, cents: totalMes(mes) }));
  const serieAcumulada: SparkPonto[] = mesesNoPeriodo.map((mes, i) => ({
    mes,
    cents: mesesNoPeriodo.slice(0, i + 1).reduce((s, m) => s + totalMes(m), 0)
  }));
  const serieRitmo: SparkPonto[] = mesesNoPeriodo.map((mes, i) => ({
    mes,
    cents: Math.round(serieAcumulada[i].cents / (i + 1))
  }));

  const crescimentoTotal = useMemo(() => crescimentoDe(serieRitmo), [serieRitmo]);
  const crescimentoMes = useMemo(() => crescimentoDe(serieMensal), [serieMensal]);

  let totalPeriodoAnteriorCents: number | null = null;
  {
    const iDe = dados.meses.indexOf(mesDe);
    const iAte = dados.meses.indexOf(mesAte);
    const len = iAte >= iDe && iDe >= 0 ? iAte - iDe + 1 : 0;
    if (len > 0 && iDe > 0) {
      const ateAnt = iDe - 1;
      const deAnt = Math.max(0, ateAnt - len + 1);
      const de = dados.meses[deAnt];
      const ate = dados.meses[ateAnt];
      totalPeriodoAnteriorCents = dados.celulas
        .filter((c) => c.mes >= de && c.mes <= ate)
        .reduce((s, c) => s + c.cents, 0);
    }
  }

  const mediaAnteriorCents =
    totalPeriodoAnteriorCents != null && mesesComCusto.length
      ? Math.round(totalPeriodoAnteriorCents / mesesComCusto.length)
      : null;

  function aplicarAtalho(atalho: Atalho) {
    const todos = dados.meses;
    if (!todos.length) return;
    const fim = todos[todos.length - 1];
    const recorte = { recente: 1, "3m": 3, "6m": 6, tudo: todos.length }[atalho];
    setMesDe(todos[Math.max(0, todos.length - recorte)]);
    setMesAte(fim);
  }

  const atalhoAtivo = (atalho: Atalho): boolean => {
    const todos = dados.meses;
    if (!todos.length) return false;
    const recorte = { recente: 1, "3m": 3, "6m": 6, tudo: todos.length }[atalho];
    return mesAte === todos[todos.length - 1] && mesDe === todos[Math.max(0, todos.length - recorte)];
  };

  const excluidoTotal = dados.camadasExcluidas.reduce((s, c) => s + c.cents, 0);

  return (
    <>
      <section className="fin-pessoas-kpis" aria-label="Indicadores de custo da empresa">
        <div className="fin-pessoas-kpi-faixa">
          <KpiAnalise
            destaque
            rotulo="Total da empresa"
            valor={brlCents(totalCents)}
            delta={
              <DeltaCusto atual={totalCents} anterior={totalPeriodoAnteriorCents} contra="período anterior" />
            }
            extra={
              <p className="fin-pessoas-kpi-extra">
                {mesesNoPeriodo.length} {mesesNoPeriodo.length === 1 ? "mês" : "meses"} · sem pessoas
              </p>
            }
            pontos={serieAcumulada}
            crescimento={crescimentoTotal}
            ariaSpark="Custo acumulado no recorte"
          />
          <KpiAnalise
            rotulo={
              <>
                Mês {ultimoMes ? monthKeyLabel(ultimoMes) : "—"}
                {ultimoMesParcial ? <span className="fin-tag">parcial</span> : null}
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
            crescimento={crescimentoMes}
            ariaSpark="Custo mês a mês"
          />
          <KpiAnalise
            rotulo="Média mensal"
            valor={brlCents(mediaMensalCents)}
            delta={
              <DeltaCusto atual={mediaMensalCents} anterior={mediaAnteriorCents} contra="período anterior" />
            }
            pontos={serieRitmo}
            crescimento={crescimentoTotal}
            ariaSpark="Média mensal corrente"
          />
        </div>
      </section>

      <FinCustosEmpresaMatriz dados={dados} meses={mesesNoPeriodo} mesAtual={dados.mesAtual} />

      <FinSecaoColapsavel
        className="fin-pessoas-recorte"
        titulo="Recorte"
        icone={CalendarRange}
        abertoPadrao
        meta={
          mesesNoPeriodo.length === 1
            ? monthKeyLabel(mesDe)
            : `${monthKeyLabel(mesDe)} → ${monthKeyLabel(mesAte)}`
        }
      >
        <header className="fin-pessoas-recorte-topo">
          <div className="fin-escopo-tabs" role="group" aria-label="Período rápido">
            {ATALHOS.map((atalho) => (
              <button
                key={atalho.slug}
                type="button"
                className={atalhoAtivo(atalho.slug) ? "fin-escopo-tab active" : "fin-escopo-tab"}
                onClick={() => aplicarAtalho(atalho.slug)}
              >
                {atalho.rotulo}
              </button>
            ))}
          </div>
          <p className="fin-pessoas-recorte-periodo">
            {mesesNoPeriodo.length === 1
              ? monthKeyLabel(mesDe)
              : `${monthKeyLabel(mesDe)} → ${monthKeyLabel(mesAte)}`}
          </p>
        </header>
      </FinSecaoColapsavel>

      {dados.camadasExcluidas.length ? (
        <FinSecaoColapsavel
          titulo="Fora deste total, de propósito"
          icone={Layers}
          meta={brlCents(excluidoTotal)}
          ariaLabel="Camadas contadas em outras telas"
        >
          <p className="fin-card-hint">
            Folha, comissão, reembolso e qualquer PIX de quem está no roster ficam em Pessoas. Somá-los
            aqui seria o mesmo dinheiro duas vezes.
          </p>
          <div className="fin-matrix-wrap">
            <table className="fin-table">
              <thead>
                <tr>
                  <th scope="col">Camada</th>
                  <th scope="col" className="num">
                    Itens
                  </th>
                  <th scope="col" className="num">
                    Por mês
                  </th>
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
    </>
  );
}

"use client";

import { Fragment, useMemo, useState } from "react";
import { CalendarRange, ChevronRight, Link2, UsersRound } from "lucide-react";

import type { CustoPessoas, Pactuado, Pessoa } from "@/lib/financeiro/pessoas";
import { brlCents, brlPrecise, monthKeyLabel, pct } from "@/lib/financeiro/format";

import { Nota } from "@/components/ui/Nota";

import { FinPessoaCadastro } from "./FinPessoaEditor";
import { FinPessoasMatriz, type ResumoPessoaMatriz } from "./FinPessoasMatriz";
import { FinSecaoColapsavel } from "./FinSecaoColapsavel";
import { DeltaCusto, KpiAnalise, crescimentoDe, type SparkPonto } from "./FinKpiAnalise";

/**
 * Custo com pessoas.
 *
 * Quatro decisões de uso, e nenhuma é estética:
 *
 * 1. TODA SOMA SAI DO MESMO ARRAY. KPI, linha da tabela, célula da matriz,
 *    rodapé e gaveta somam `celulasFiltradas` — o grão pessoa × mês × conta ×
 *    natureza que o servidor mandou. Consultas separadas para cada painel é como
 *    duas telas do mesmo módulo começam a discordar: basta um filtro esquecido
 *    em uma delas. Aqui, mudar um filtro move tudo junto ou não move nada.
 *
 * 2. O FILTRO É NO CLIENTE PORQUE CABE. São algumas centenas de células; ida ao
 *    servidor a cada clique tornaria "mês a mês" perceptivelmente lento sem ganho
 *    nenhum. Mesma escolha do extrato (FinLedgerTable).
 *
 * 3. "ACIMA DO FIXO" VEM VAZIO, NÃO ZERADO, ONDE NÃO HÁ PACTUADO. O extrato não
 *    sabe separar fixo de comissão; a planilha de comissionamento sabe, e está
 *    carregada só para ago/26. Nos outros meses a coluna mostra "—". Um zero ali
 *    seria indistinguível de "esta pessoa não recebeu nada acima do fixo", que é
 *    uma afirmação — e uma que não temos como fazer.
 */

const ATALHOS = [
  { slug: "recente", rotulo: "Mês recente" },
  { slug: "3m", rotulo: "3 meses" },
  { slug: "6m", rotulo: "6 meses" },
  { slug: "tudo", rotulo: "Todo o período" }
] as const;

type Atalho = (typeof ATALHOS)[number]["slug"];

/** Chave composta pessoa+mês, usada nos mapas de junção. */
function chave(personId: number, mes: string) {
  return `${personId}|${mes}`;
}

/**
 * Delta de CUSTO: subir é ruim, cair é bom. Neutro abaixo de 0,05 p.p. para
 * não pintar ruído de centavos como tendência.
 */
export function FinPessoas({ dados }: { dados: CustoPessoas }) {
  // O padrão é TODO o período, não o mês recente: a primeira pergunta do dono é
  // "quanto custa o time", e responder isso com um mês parcial (ago/26 vai só
  // até o dia 7) daria um número menor que a realidade logo na abertura.
  const [mesDe, setMesDe] = useState(dados.meses[0] ?? "");
  const [mesAte, setMesAte] = useState(dados.meses[dados.meses.length - 1] ?? "");

  if (!dados.disponivel) {
    return (
      <section className="card fin-empty">
        <h2 className="card-title">Custo com pessoas indisponível</h2>
        <p>
          Sem conexão com o banco do financeiro. O restante da plataforma segue funcionando — só esta tela depende do
          PostgreSQL em tempo de request.
        </p>
      </section>
    );
  }

  return (
    <ConteudoPessoas
      dados={dados}
      estado={{ mesDe, mesAte }}
      set={{ setMesDe, setMesAte }}
    />
  );
}

type Estado = {
  mesDe: string;
  mesAte: string;
};

type Setters = {
  setMesDe: (v: string) => void;
  setMesAte: (v: string) => void;
};

/**
 * Separado do componente de cima só porque os hooks não podem viver depois do
 * `return` de indisponibilidade. É a mesma tela.
 */
function ConteudoPessoas({ dados, estado, set }: { dados: CustoPessoas; estado: Estado; set: Setters }) {
  const { mesDe, mesAte } = estado;
  const [vinculoAberto, setVinculoAberto] = useState<string | null>(null);

  const pessoaPorId = useMemo(() => new Map(dados.pessoas.map((p) => [p.id, p])), [dados.pessoas]);

  const pactuadoPorChave = useMemo(() => {
    const mapa = new Map<string, Pactuado>();
    for (const linha of dados.pactuado) mapa.set(chave(linha.personId, linha.mes), linha);
    return mapa;
  }, [dados.pactuado]);

  const mesesNoPeriodo = useMemo(
    () => dados.meses.filter((mes) => mes >= mesDe && mes <= mesAte),
    [dados.meses, mesDe, mesAte]
  );

  /** Meses do recorte que têm fixo CONTRATADO — o único recorte comparável. */
  const mesesComPactuadoNoPeriodo = useMemo(
    () =>
      mesesNoPeriodo.filter((mes) =>
        dados.pactuado.some((p) => p.mes === mes && p.fixoContratadoCents > 0)
      ),
    [mesesNoPeriodo, dados.pactuado]
  );

  const celulasFiltradas = useMemo(
    () => dados.celulas.filter((celula) => celula.mes >= mesDe && celula.mes <= mesAte),
    [dados.celulas, mesDe, mesAte]
  );

  const bandasFiltradas = useMemo(
    () => dados.bandas.filter((banda) => banda.mes >= mesDe && banda.mes <= mesAte),
    [dados.bandas, mesDe, mesAte]
  );

  const totalCents = celulasFiltradas.reduce((s, c) => s + c.cents, 0);

  // ── Linhas da tabela: uma por pessoa, somando TODAS as contrapartes dela ──
  const linhas = useMemo(() => {
    const acumulador = new Map<
      number,
      { pessoa: Pessoa; totalCents: number; n: number; porConta: Record<string, number>; porMes: Record<string, number> }
    >();

    for (const celula of celulasFiltradas) {
      const pessoa = pessoaPorId.get(celula.personId);
      if (!pessoa) continue;
      const atual =
        acumulador.get(celula.personId) ?? { pessoa, totalCents: 0, n: 0, porConta: {}, porMes: {} };
      atual.totalCents += celula.cents;
      atual.n += celula.n;
      atual.porConta[celula.conta] = (atual.porConta[celula.conta] ?? 0) + celula.cents;
      atual.porMes[celula.mes] = (atual.porMes[celula.mes] ?? 0) + celula.cents;
      acumulador.set(celula.personId, atual);
    }

    return [...acumulador.values()]
      .map((linha) => {
        // Fixo pactuado e excedente só existem nos meses em que a planilha de
        // comissionamento traz um fixo CONTRATADO. `null` (e não zero) quando
        // não há nenhum: a tela precisa poder dizer "não sei", e zero não diz.
        //
        // A condição é `> 0`, não "a linha existe": Dantre, Sandro e Lorena
        // entraram na planilha só pela lista do mês (apurado), sem valor
        // combinado. Somá-los com fixo zero faria a tela afirmar que os
        // R$ 1.000,00 de cada um estão "acima do fixo" — uma conclusão sobre um
        // combinado que ninguém registrou.
        let fixoContratadoCents: number | null = null;
        let excedenteCents: number | null = null;
        const mesesPactuados: string[] = [];
        for (const mes of mesesNoPeriodo) {
          const pact = pactuadoPorChave.get(chave(linha.pessoa.id, mes));
          if (!pact || pact.fixoContratadoCents <= 0) continue;
          mesesPactuados.push(mes);
          fixoContratadoCents = (fixoContratadoCents ?? 0) + pact.fixoContratadoCents;
          excedenteCents = (excedenteCents ?? 0) + ((linha.porMes[mes] ?? 0) - pact.fixoContratadoCents);
        }

        const mesesComValor = mesesNoPeriodo.filter((mes) => (linha.porMes[mes] ?? 0) > 0);
        const primeiro = mesesComValor[0];
        const ultimo = mesesComValor[mesesComValor.length - 1];
        // Variação do primeiro ao último mês COM valor. Comparar com um mês
        // vazio produziria "+∞%" para quem entrou no meio do período.
        const variacaoPct =
          primeiro && ultimo && primeiro !== ultimo && linha.porMes[primeiro]
            ? ((linha.porMes[ultimo] - linha.porMes[primeiro]) / linha.porMes[primeiro]) * 100
            : null;

        return {
          ...linha,
          fixoContratadoCents,
          excedenteCents,
          mesesPactuados,
          mediaMensalCents: mesesComValor.length ? Math.round(linha.totalCents / mesesComValor.length) : 0,
          mesesComValor: mesesComValor.length,
          primeiroMes: primeiro ?? null,
          ultimoMes: ultimo ?? null,
          variacaoPct
        };
      })
      .sort((a, b) => b.totalCents - a.totalCents);
  }, [celulasFiltradas, pessoaPorId, mesesNoPeriodo, pactuadoPorChave]);

  const resumoPorPessoa = useMemo(() => {
    const mapa = new Map<number, ResumoPessoaMatriz>();
    for (const l of linhas) {
      mapa.set(l.pessoa.id, {
        fixoContratadoCents: l.fixoContratadoCents,
        excedenteCents: l.excedenteCents,
        mesesPactuados: l.mesesPactuados,
        mediaMensalCents: l.mediaMensalCents,
        variacaoPct: l.variacaoPct,
        primeiroMes: l.primeiroMes,
        ultimoMes: l.ultimoMes
      });
    }
    return mapa;
  }, [linhas]);

  /**
   * Quem tem fixo contratado e não aparece em nenhuma linha da tabela.
   *
   * É um compromisso que a tabela não mostra — não porque não exista, mas porque
   * o dinheiro não foi visto saindo. Nomear essas pessoas é o que separa "não
   * custou nada" de "não conseguimos ver o pagamento".
   */
  const { pactuadosSemLancamento, fixoSemLancamentoCents } = useMemo(() => {
    const comLinha = new Set(linhas.map((l) => l.pessoa.id));
    const pendentes = new Map<number, number>();
    for (const pact of dados.pactuado) {
      if (pact.fixoContratadoCents <= 0) continue;
      if (!mesesNoPeriodo.includes(pact.mes)) continue;
      if (comLinha.has(pact.personId)) continue;
      const pessoa = pessoaPorId.get(pact.personId);
      if (!pessoa) continue;
      pendentes.set(pact.personId, Math.max(pendentes.get(pact.personId) ?? 0, pact.fixoContratadoCents));
    }
    return {
      pactuadosSemLancamento: [...pendentes.keys()].map((id) => pessoaPorId.get(id)!),
      fixoSemLancamentoCents: [...pendentes.values()].reduce((s, v) => s + v, 0)
    };
  }, [linhas, dados.pactuado, mesesNoPeriodo, pessoaPorId]);

  // ── Divisão do total: por conta e por natureza ──────────────────────────
  const porConta = useMemo(
    () =>
      dados.contas
        .map((c) => ({
          ...c,
          cents: celulasFiltradas.filter((x) => x.conta === c.slug).reduce((s, x) => s + x.cents, 0),
          n: celulasFiltradas.filter((x) => x.conta === c.slug).reduce((s, x) => s + x.n, 0)
        }))
        .sort((a, b) => b.cents - a.cents),
    [dados.contas, celulasFiltradas]
  );

  const porNatureza = useMemo(
    () =>
      dados.naturezas
        .map((nat) => ({
          ...nat,
          cents: celulasFiltradas.filter((x) => x.natureza === nat.slug).reduce((s, x) => s + x.cents, 0),
          n: celulasFiltradas.filter((x) => x.natureza === nat.slug).reduce((s, x) => s + x.n, 0)
        }))
        .sort((a, b) => b.cents - a.cents),
    [dados.naturezas, celulasFiltradas]
  );

  // Último mês COM lançamento no recorte filtrado — base do "custo mensal" e da fatia.
  const mesUltimoNoRecorte = useMemo(() => {
    let max = "";
    for (const celula of celulasFiltradas) {
      if (celula.mes > max) max = celula.mes;
    }
    return max || mesAte;
  }, [celulasFiltradas, mesAte]);

  const totalMesUltimoCents = useMemo(
    () =>
      celulasFiltradas
        .filter((c) => c.mes === mesUltimoNoRecorte)
        .reduce((s, c) => s + c.cents, 0),
    [celulasFiltradas, mesUltimoNoRecorte]
  );

  const porTime = useMemo(() => {
    const mapa = new Map<
      string,
      { nome: string; centsTotal: number; centsMes: number; pessoas: Set<number> }
    >();
    for (const celula of celulasFiltradas) {
      const pessoa = pessoaPorId.get(celula.personId);
      if (!pessoa) continue;
      const atual = mapa.get(pessoa.time) ?? {
        nome: pessoa.timeRotulo,
        centsTotal: 0,
        centsMes: 0,
        pessoas: new Set<number>()
      };
      atual.centsTotal += celula.cents;
      if (celula.mes === mesUltimoNoRecorte) atual.centsMes += celula.cents;
      atual.pessoas.add(pessoa.id);
      mapa.set(pessoa.time, atual);
    }
    return [...mapa.entries()]
      .map(([slug, v]) => ({
        slug,
        nome: v.nome,
        centsTotal: v.centsTotal,
        centsMes: v.centsMes,
        pessoas: v.pessoas.size
      }))
      .sort((a, b) => b.centsMes - a.centsMes || b.centsTotal - a.centsTotal);
  }, [celulasFiltradas, pessoaPorId, mesUltimoNoRecorte]);

  const porVinculo = useMemo(() => {
    type PessoaLinha = { id: number; nome: string; centsTotal: number; centsMes: number };
    const mapa = new Map<
      string,
      {
        nome: string;
        centsTotal: number;
        centsMes: number;
        pessoas: Map<number, PessoaLinha>;
      }
    >();
    for (const celula of celulasFiltradas) {
      const pessoa = pessoaPorId.get(celula.personId);
      if (!pessoa) continue;
      const atual = mapa.get(pessoa.vinculo) ?? {
        nome: pessoa.vinculoRotulo,
        centsTotal: 0,
        centsMes: 0,
        pessoas: new Map()
      };
      atual.centsTotal += celula.cents;
      if (celula.mes === mesUltimoNoRecorte) atual.centsMes += celula.cents;
      const pl =
        atual.pessoas.get(pessoa.id) ??
        ({ id: pessoa.id, nome: pessoa.nome, centsTotal: 0, centsMes: 0 } satisfies PessoaLinha);
      pl.centsTotal += celula.cents;
      if (celula.mes === mesUltimoNoRecorte) pl.centsMes += celula.cents;
      atual.pessoas.set(pessoa.id, pl);
      mapa.set(pessoa.vinculo, atual);
    }
    return [...mapa.entries()]
      .map(([slug, v]) => ({
        slug,
        nome: v.nome,
        centsTotal: v.centsTotal,
        centsMes: v.centsMes,
        pessoas: v.pessoas.size,
        lista: [...v.pessoas.values()].sort(
          (a, b) => b.centsMes - a.centsMes || b.centsTotal - a.centsTotal
        )
      }))
      .sort((a, b) => b.centsMes - a.centsMes || b.centsTotal - a.centsTotal);
  }, [celulasFiltradas, pessoaPorId, mesUltimoNoRecorte]);

  // ── Mês recente e a comparação com o anterior ───────────────────────────
  const mesesComCusto = mesesNoPeriodo.filter((mes) =>
    celulasFiltradas.some((c) => c.mes === mes && c.cents !== 0)
  );
  const ultimoMes = mesesComCusto[mesesComCusto.length - 1] ?? null;
  const penultimoMes = mesesComCusto[mesesComCusto.length - 2] ?? null;
  const totalMes = (mes: string | null) =>
    mes ? celulasFiltradas.filter((c) => c.mes === mes).reduce((s, c) => s + c.cents, 0) : 0;
  const ultimoMesCents = totalMes(ultimoMes);
  const penultimoMesCents = totalMes(penultimoMes);
  // O mês corrente é parcial por definição: o extrato do Inter vai até o dia 4 e
  // o do Nubank até o 7. Sem essa marca, todo início de mês a tela mostraria uma
  // "queda" que é só calendário.
  const ultimoMesParcial = ultimoMes === dados.mesAtual;

  const pessoasNoRecorte = linhas.length;

  // Média mensal por pessoa = (total ÷ meses ÷ pessoas). Dividir só pelo
  // headcount dava o custo acumulado do período por cabeça — R$ 24 mil lidos
  // como "custa isso por mês" quando eram oito meses somados.
  const mediaMensalPorPessoaCents =
    pessoasNoRecorte && mesesComCusto.length
      ? Math.round(totalCents / (pessoasNoRecorte * mesesComCusto.length))
      : 0;

  // Pessoas distintas no mês recente / anterior — para Δ da média mensal/pessoa.
  const pessoasNoMes = (mes: string | null) => {
    if (!mes) return 0;
    const ids = new Set(
      celulasFiltradas.filter((c) => c.mes === mes && c.cents > 0).map((c) => c.personId)
    );
    return ids.size;
  };
  const mediaPessoaUltimo =
    ultimoMes && pessoasNoMes(ultimoMes) ? Math.round(ultimoMesCents / pessoasNoMes(ultimoMes)) : null;
  const mediaPessoaPenultimo =
    penultimoMes && pessoasNoMes(penultimoMes)
      ? Math.round(penultimoMesCents / pessoasNoMes(penultimoMes))
      : null;

  const previstoProximoCents = useMemo(
    () => dados.previsaoCadastro.reduce((s, p) => s + p.totalCents, 0),
    [dados.previsaoCadastro]
  );

  const serieFolha = useMemo(() => {
    const porMes = new Map<string, number>();
    for (const mes of mesesNoPeriodo) porMes.set(mes, 0);
    for (const c of celulasFiltradas) {
      porMes.set(c.mes, (porMes.get(c.mes) ?? 0) + c.cents);
    }
    const pontos = mesesNoPeriodo.map((mes) => ({
      mes,
      cents: porMes.get(mes) ?? 0,
      previsto: false
    }));
    if (dados.mesPrevisto && previstoProximoCents > 0) {
      pontos.push({ mes: dados.mesPrevisto, cents: previstoProximoCents, previsto: true });
    }
    return pontos;
  }, [mesesNoPeriodo, celulasFiltradas, dados.mesPrevisto, previstoProximoCents]);

  const serieAcumulada = useMemo(() => {
    let acc = 0;
    const pontos: SparkPonto[] = [];
    for (const p of serieFolha) {
      if (p.previsto) {
        pontos.push({ mes: p.mes, cents: acc + p.cents, previsto: true });
      } else {
        acc += p.cents;
        pontos.push({ mes: p.mes, cents: acc, previsto: false });
      }
    }
    return pontos;
  }, [serieFolha]);

  // Ritmo do recorte (acumulado / n meses). No card do total, taxa sobre o
  // estoque mentiria: jan=primeiro mês e ago=soma de oito sempre "cresce".
  const serieRitmo = useMemo(() => {
    let acc = 0;
    let n = 0;
    const pontos: SparkPonto[] = [];
    for (const p of serieFolha) {
      if (p.previsto) {
        pontos.push({
          mes: p.mes,
          cents: n ? Math.round((acc + p.cents) / (n + 1)) : p.cents,
          previsto: true
        });
      } else {
        acc += p.cents;
        n += 1;
        pontos.push({ mes: p.mes, cents: n ? Math.round(acc / n) : 0, previsto: false });
      }
    }
    return pontos;
  }, [serieFolha]);

  const seriePorPessoa = useMemo(() => {
    const porMes = new Map<string, { cents: number; ids: Set<number> }>();
    for (const mes of mesesNoPeriodo) porMes.set(mes, { cents: 0, ids: new Set() });
    for (const c of celulasFiltradas) {
      const atual = porMes.get(c.mes);
      if (!atual) continue;
      atual.cents += c.cents;
      if (c.cents > 0) atual.ids.add(c.personId);
    }
    const pontos: SparkPonto[] = mesesNoPeriodo.map((mes) => {
      const atual = porMes.get(mes);
      const n = atual?.ids.size ?? 0;
      return { mes, cents: n ? Math.round((atual?.cents ?? 0) / n) : 0, previsto: false };
    });
    const nPrev = dados.previsaoCadastro.filter((p) => p.totalCents > 0).length;
    if (dados.mesPrevisto && nPrev && previstoProximoCents) {
      pontos.push({
        mes: dados.mesPrevisto,
        cents: Math.round(previstoProximoCents / nPrev),
        previsto: true
      });
    }
    return pontos;
  }, [
    mesesNoPeriodo,
    celulasFiltradas,
    dados.previsaoCadastro,
    dados.mesPrevisto,
    previstoProximoCents
  ]);

  const crescimentoFolha = useMemo(() => crescimentoDe(serieFolha), [serieFolha]);
  const crescimentoTotal = useMemo(() => crescimentoDe(serieRitmo), [serieRitmo]);
  const crescimentoPessoa = useMemo(() => crescimentoDe(seriePorPessoa), [seriePorPessoa]);
  const mediaPrevistaCents = seriePorPessoa.find((p) => p.previsto)?.cents ?? 0;

  // Período anterior de mesmo comprimento — Δ do total.
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
      const celulasAnt = dados.celulas.filter((celula) => celula.mes >= de && celula.mes <= ate);
      totalPeriodoAnteriorCents = celulasAnt.reduce((s, c) => s + c.cents, 0);
    }
  }

  function aplicarAtalho(atalho: Atalho) {
    const todos = dados.meses;
    if (!todos.length) return;
    const fim = todos[todos.length - 1];
    const recorte = { recente: 1, "3m": 3, "6m": 6, tudo: todos.length }[atalho];
    set.setMesDe(todos[Math.max(0, todos.length - recorte)]);
    set.setMesAte(fim);
  }

  const atalhoAtivo = (atalho: Atalho): boolean => {
    const todos = dados.meses;
    if (!todos.length) return false;
    const recorte = { recente: 1, "3m": 3, "6m": 6, tudo: todos.length }[atalho];
    return mesAte === todos[todos.length - 1] && mesDe === todos[Math.max(0, todos.length - recorte)];
  };

  return (
    <>
      <section className="fin-pessoas-kpis" aria-label="Indicadores de custo com pessoas">
        <div className="fin-pessoas-kpi-faixa">
          <KpiAnalise
            destaque
            rotulo="Total com pessoas"
            valor={brlCents(totalCents)}
            delta={
              <DeltaCusto
                atual={totalCents}
                anterior={totalPeriodoAnteriorCents}
                contra="período anterior"
              />
            }
            extra={
              previstoProximoCents ? (
                <p className="fin-pessoas-kpi-extra">
                  com previsto {dados.mesPrevisto ? monthKeyLabel(dados.mesPrevisto) : "próximo"}{" "}
                  {brlCents(totalCents + previstoProximoCents)}
                </p>
              ) : null
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
            extra={
              previstoProximoCents ? (
                <p className="fin-pessoas-kpi-extra">
                  previsto {dados.mesPrevisto ? monthKeyLabel(dados.mesPrevisto) : "próximo"}{" "}
                  {brlCents(previstoProximoCents)}
                </p>
              ) : (
                <p className="fin-pessoas-kpi-extra">sem cadastro previsto</p>
              )
            }
            pontos={serieFolha}
            crescimento={crescimentoFolha}
            ariaSpark="Custo mensal da folha"
          />
          <KpiAnalise
            rotulo="Média mensal / pessoa"
            valor={brlCents(mediaMensalPorPessoaCents)}
            delta={
              mediaPessoaUltimo !== null ? (
                <DeltaCusto
                  atual={mediaPessoaUltimo}
                  anterior={mediaPessoaPenultimo}
                  contra={penultimoMes ? monthKeyLabel(penultimoMes) : ""}
                />
              ) : (
                <p className="fin-delta neutro">sem base</p>
              )
            }
            extra={
              mediaPrevistaCents ? (
                <p className="fin-pessoas-kpi-extra">
                  previsto {dados.mesPrevisto ? monthKeyLabel(dados.mesPrevisto) : "próximo"}{" "}
                  {brlCents(mediaPrevistaCents)}
                </p>
              ) : null
            }
            pontos={seriePorPessoa}
            crescimento={crescimentoPessoa}
            ariaSpark="Custo médio por pessoa no recorte"
          />
        </div>
      </section>

      <FinPessoasMatriz
        dados={dados}
        bandas={bandasFiltradas}
        meses={mesesNoPeriodo}
        pessoaPorId={pessoaPorId}
        mesAtual={dados.mesAtual}
        resumoPorPessoa={resumoPorPessoa}
        rodape={
          <Nota rotulo="Por que as colunas de pactuado às vezes não fecham com o total">
            <p>
              {mesesComPactuadoNoPeriodo.length
                ? `Fixo e "acima" cobrem só ${mesesComPactuadoNoPeriodo.map(monthKeyLabel).join(", ")} — meses com planilha de comissionamento. O total cobre ${mesesNoPeriodo.length} ${mesesNoPeriodo.length === 1 ? "mês" : "meses"}.`
                : "Nenhum mês deste recorte tem fixo contratado na planilha de comissionamento, então as colunas de pactuado vêm vazias."}{" "}
              {pactuadosSemLancamento.length
                ? `${pactuadosSemLancamento.map((p) => p.nome).join(", ")} ${pactuadosSemLancamento.length === 1 ? "tem" : "têm"} fixo sem saída vista: ${brlPrecise(fixoSemLancamentoCents)}.`
                : "Todo mundo com fixo contratado tem ao menos um lançamento neste recorte."}
            </p>
          </Nota>
        }
      />

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

        <div className="fin-pessoas-divisao">
          <div className="fin-pessoas-painel">
            <h3 className="fin-pessoas-painel-titulo">Por conta</h3>
            <ul className="fin-pessoas-fatias">
              {porConta.map((linha) => {
                const fatia = totalCents ? (linha.cents / totalCents) * 100 : 0;
                return (
                  <li key={linha.slug} className={linha.cents ? undefined : "zerada"}>
                    <div className="fin-pessoas-fatia-topo">
                      <span className="fin-pessoas-fatia-nome">{linha.nome}</span>
                      <span className="fin-pessoas-fatia-valor">
                        {linha.cents ? brlPrecise(linha.cents) : "R$ 0,00"}
                      </span>
                    </div>
                    <div className="fin-pessoas-fatia-trilha" aria-hidden="true">
                      <span className="fin-pessoas-fatia-barra" style={{ width: `${Math.max(fatia, 0)}%` }} />
                    </div>
                    <div className="fin-pessoas-fatia-meta">
                      <span>{pct(fatia, 1)}</span>
                      <span>{linha.n ? `${linha.n} lanç.` : "—"}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="fin-pessoas-painel">
            <h3 className="fin-pessoas-painel-titulo">Por natureza</h3>
            {porNatureza.length ? (
              <ul className="fin-pessoas-fatias">
                {porNatureza.map((linha) => {
                  const fatia = totalCents ? (linha.cents / totalCents) * 100 : 0;
                  return (
                    <li key={linha.slug} className={linha.cents ? undefined : "zerada"}>
                      <div className="fin-pessoas-fatia-topo">
                        <span className="fin-pessoas-fatia-nome">{linha.nome}</span>
                        <span className="fin-pessoas-fatia-valor">
                          {linha.cents ? brlPrecise(linha.cents) : "R$ 0,00"}
                        </span>
                      </div>
                      <div className="fin-pessoas-fatia-trilha" aria-hidden="true">
                        <span className="fin-pessoas-fatia-barra" style={{ width: `${Math.max(fatia, 0)}%` }} />
                      </div>
                      <div className="fin-pessoas-fatia-meta">
                        <span>{pct(fatia, 1)}</span>
                        <span>{linha.n ? `${linha.n} lanç.` : "—"}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="fin-pessoas-vazio">Nada neste recorte.</p>
            )}
          </div>
        </div>
      </FinSecaoColapsavel>

      <section className="fin-two-col">
        <FinSecaoColapsavel
          titulo="Por time"
          icone={UsersRound}
          meta={`${porTime.length} ${porTime.length === 1 ? "time" : "times"} · ${monthKeyLabel(mesUltimoNoRecorte)}`}
        >
          <div className="table-wrap">
            <table className="fin-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th className="num">Pessoas</th>
                  <th className="num" title={monthKeyLabel(mesUltimoNoRecorte)}>
                    Custo mensal
                  </th>
                  <th className="num">Custo total</th>
                  <th className="num" title={`Fatia de ${monthKeyLabel(mesUltimoNoRecorte)}`}>
                    Fatia
                  </th>
                </tr>
              </thead>
              <tbody>
                {porTime.map((linha) => {
                  const fatia = totalMesUltimoCents
                    ? (linha.centsMes / totalMesUltimoCents) * 100
                    : 0;
                  return (
                    <tr key={linha.slug}>
                      <td>{linha.nome}</td>
                      <td className="num">{linha.pessoas}</td>
                      <td className="num fin-table-money">{brlPrecise(linha.centsMes)}</td>
                      <td className="num fin-table-money">{brlPrecise(linha.centsTotal)}</td>
                      <td className="num">
                        <span className="fin-share" style={{ ["--share" as string]: `${fatia.toFixed(1)}%` }}>
                          {pct(fatia, 1)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {!porTime.length ? (
                  <tr>
                    <td colSpan={5} className="fin-empty-row">
                      Nada neste recorte.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </FinSecaoColapsavel>

        <FinSecaoColapsavel
          titulo="Por vínculo"
          icone={Link2}
          meta={`${porVinculo.length} ${porVinculo.length === 1 ? "tipo" : "tipos"} · ${monthKeyLabel(mesUltimoNoRecorte)}`}
        >
          <div className="table-wrap">
            <table className="fin-table">
              <thead>
                <tr>
                  <th>Vínculo</th>
                  <th className="num">Pessoas</th>
                  <th className="num" title={monthKeyLabel(mesUltimoNoRecorte)}>
                    Custo mensal
                  </th>
                  <th className="num">Custo total</th>
                  <th className="num" title={`Fatia de ${monthKeyLabel(mesUltimoNoRecorte)}`}>
                    Fatia
                  </th>
                </tr>
              </thead>
              <tbody>
                {porVinculo.map((linha) => {
                  const fatia = totalMesUltimoCents
                    ? (linha.centsMes / totalMesUltimoCents) * 100
                    : 0;
                  const aberto = vinculoAberto === linha.slug;
                  return (
                    <Fragment key={linha.slug}>
                      <tr
                        className="fin-row-expandivel"
                        onClick={() => setVinculoAberto(aberto ? null : linha.slug)}
                        aria-expanded={aberto}
                      >
                        <td
                          className={
                            linha.slug === "irregular" || linha.slug === "indefinido"
                              ? "fin-badge-atencao"
                              : undefined
                          }
                        >
                          <span className="fin-row-expand-label">
                            <ChevronRight
                              size={14}
                              className={aberto ? "fin-chevron-aberto" : undefined}
                              aria-hidden
                            />
                            {linha.nome}
                          </span>
                        </td>
                        <td className="num">{linha.pessoas}</td>
                        <td className="num fin-table-money">{brlPrecise(linha.centsMes)}</td>
                        <td className="num fin-table-money">{brlPrecise(linha.centsTotal)}</td>
                        <td className="num">
                          <span className="fin-share" style={{ ["--share" as string]: `${fatia.toFixed(1)}%` }}>
                            {pct(fatia, 1)}
                          </span>
                        </td>
                      </tr>
                      {aberto ? (
                        <tr className="fin-row-detalhe">
                          <td colSpan={5}>
                            <table className="fin-table fin-table-aninhada">
                              <thead>
                                <tr>
                                  <th>Pessoa</th>
                                  <th className="num">Mensal</th>
                                  <th className="num">Total</th>
                                </tr>
                              </thead>
                              <tbody>
                                {linha.lista.map((p) => (
                                  <tr key={p.id}>
                                    <td>
                                      <a href={`/financeiro/pessoas/${p.id}`}>{p.nome}</a>
                                    </td>
                                    <td className="num fin-table-money">{brlPrecise(p.centsMes)}</td>
                                    <td className="num fin-table-money">{brlPrecise(p.centsTotal)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
                {!porVinculo.length ? (
                  <tr>
                    <td colSpan={5} className="fin-empty-row">
                      Nada neste recorte.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </FinSecaoColapsavel>
      </section>

      <FinPessoaCadastro dados={dados} />
    </>
  );
}

"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";

import type {
  BandaRemuneracao,
  CustoPessoas,
  Pactuado,
  Pessoa,
  SaidaSemDono
} from "@/lib/financeiro/pessoas";
import { brlCents, brlPrecise, monthKeyLabel, pct } from "@/lib/financeiro/format";
import {
  TIPOS_SAIDA_SEM_DONO,
  nomeSugeridoDoExtrato,
  type TipoSaidaSemDono
} from "@/lib/financeiro/saida-sem-dono-ui";
import { urlDaOrigem } from "@/lib/url-origem";

import { Nota } from "@/components/ui/Nota";

import { FinLigacaoPropostaAcoes, FinPessoaCadastro } from "./FinPessoaEditor";
import { FinPessoasMatriz } from "./FinPessoasMatriz";
import { FinSecaoColapsavel } from "./FinSecaoColapsavel";

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
 * 3. A COBERTURA FICA ACIMA DA TABELA, NÃO NO RODAPÉ. O custo que não pôde ser
 *    atribuído a ninguém está no segundo cartão da primeira linha, do lado do
 *    total. Em abril/2026 o total atribuído despenca para R$ 25.035,41 enquanto
 *    R$ 50.949,07 de PIX para gente do roster ficam de fora por falta de
 *    favorecido: quem lesse só o total concluiria que a folha caiu 64% num mês.
 *    Um aviso no rodapé não teria evitado essa leitura.
 *
 * 4. "ACIMA DO FIXO" VEM VAZIO, NÃO ZERADO, ONDE NÃO HÁ PACTUADO. O extrato não
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

type ComposicaoMes = {
  mes: string;
  salarioCents: number;
  prolaboreCents: number;
  comissaoCents: number;
  reembolsoCents: number;
  estagioCents: number;
  extraCents: number;
};

/**
 * Composição do ÚLTIMO mês com banda — a mesma régua do perfil individual.
 *
 * As seis naturezas vêm do MESMO mês. Antes só salário/pró-labore/comissão/
 * reembolso apareciam na tabela: Paulo, Dante e Sandro (bolsa em `estagio`) e
 * Kevin/Rita (`extra`, categorias 5.05 e 4.03) ficavam com as colunas vazias
 * embora o dinheiro estivesse na view — a mesma que o perfil usa.
 */
function composicaoUltimoMes(bandas: BandaRemuneracao[], personId: number): ComposicaoMes | null {
  const daPessoa = bandas.filter((b) => b.personId === personId && b.cents > 0);
  if (!daPessoa.length) return null;
  let mes = daPessoa[0].mes;
  for (const b of daPessoa) if (b.mes > mes) mes = b.mes;
  const doMes = daPessoa.filter((b) => b.mes === mes);
  const soma = (natureza: string) =>
    doMes.filter((b) => b.natureza === natureza).reduce((s, b) => s + b.cents, 0);
  return {
    mes,
    salarioCents: soma("salario"),
    prolaboreCents: soma("prolabore"),
    comissaoCents: soma("comissao"),
    reembolsoCents: soma("reembolso"),
    estagioCents: soma("estagio"),
    extraCents: soma("extra")
  };
}

function CelulaBanda({ cents }: { cents: number }) {
  if (!cents) return <span className="fin-zero">—</span>;
  return <span className="fin-pessoas-ultimo">{brlPrecise(cents)}</span>;
}

/**
 * Delta de CUSTO: subir é ruim, cair é bom. Neutro abaixo de 0,05 p.p. para
 * não pintar ruído de centavos como tendência.
 */
function DeltaCusto({
  atual,
  anterior,
  contra
}: {
  atual: number;
  anterior: number | null;
  contra: string;
}) {
  if (anterior === null || !anterior) {
    return <p className="fin-delta neutro">sem base para comparar</p>;
  }
  const variacao = ((atual - anterior) / Math.abs(anterior)) * 100;
  const classe =
    Math.abs(variacao) < 0.05 ? "fin-delta neutro" : variacao > 0 ? "fin-delta ruim" : "fin-delta bom";
  return (
    <p className={classe}>
      {variacao >= 0 ? "+" : "−"}
      {pct(Math.abs(variacao), 1)} <span>vs. {contra}</span>
    </p>
  );
}

export function FinPessoas({ dados }: { dados: CustoPessoas }) {
  // O padrão é TODO o período, não o mês recente: a primeira pergunta do dono é
  // "quanto custa o time", e responder isso com um mês parcial (ago/26 vai só
  // até o dia 7) daria um número menor que a realidade logo na abertura.
  const [mesDe, setMesDe] = useState(dados.meses[0] ?? "");
  const [mesAte, setMesAte] = useState(dados.meses[dados.meses.length - 1] ?? "");
  const [busca, setBusca] = useState("");
  const [conta, setConta] = useState("");
  const [time, setTime] = useState("");
  const [vinculo, setVinculo] = useState("");
  const [natureza, setNatureza] = useState("");

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
      estado={{ mesDe, mesAte, busca, conta, time, vinculo, natureza }}
      set={{ setMesDe, setMesAte, setBusca, setConta, setTime, setVinculo, setNatureza }}
    />
  );
}

type Estado = {
  mesDe: string;
  mesAte: string;
  busca: string;
  conta: string;
  time: string;
  vinculo: string;
  natureza: string;
};

type Setters = {
  setMesDe: (v: string) => void;
  setMesAte: (v: string) => void;
  setBusca: (v: string) => void;
  setConta: (v: string) => void;
  setTime: (v: string) => void;
  setVinculo: (v: string) => void;
  setNatureza: (v: string) => void;
};

/**
 * Separado do componente de cima só porque os hooks não podem viver depois do
 * `return` de indisponibilidade. É a mesma tela.
 */
function ConteudoPessoas({ dados, estado, set }: { dados: CustoPessoas; estado: Estado; set: Setters }) {
  const { mesDe, mesAte, busca, conta, time, vinculo, natureza } = estado;
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

  /** A pessoa passa nos filtros que são dela (não do lançamento). */
  const pessoaPassa = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (pessoa: Pessoa | undefined) => {
      if (!pessoa) return false;
      if (time && pessoa.time !== time) return false;
      if (vinculo && pessoa.vinculo !== vinculo) return false;
      if (termo) {
        const alvo = `${pessoa.nome} ${pessoa.nomeLegal ?? ""} ${pessoa.contrapartes
          .map((c) => c.nome)
          .join(" ")}`.toLowerCase();
        if (!alvo.includes(termo)) return false;
      }
      return true;
    };
  }, [busca, time, vinculo]);

  const celulasFiltradas = useMemo(
    () =>
      dados.celulas.filter((celula) => {
        if (celula.mes < mesDe || celula.mes > mesAte) return false;
        if (conta && celula.conta !== conta) return false;
        if (natureza && celula.natureza !== natureza) return false;
        return pessoaPassa(pessoaPorId.get(celula.personId));
      }),
    [dados.celulas, mesDe, mesAte, conta, natureza, pessoaPassa, pessoaPorId]
  );

  const bandasFiltradas = useMemo(
    () =>
      dados.bandas.filter((banda) => {
        if (banda.mes < mesDe || banda.mes > mesAte) return false;
        return pessoaPassa(pessoaPorId.get(banda.personId));
      }),
    [dados.bandas, mesDe, mesAte, pessoaPassa, pessoaPorId]
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
          variacaoPct,
          // Mesma composição do perfil: as quatro naturezas do ÚLTIMO mês com
          // banda, nunca "o último de cada tipo" em meses diferentes.
          ultimoMesBanda: composicaoUltimoMes(dados.bandas, linha.pessoa.id)
        };
      })
      .sort((a, b) => b.totalCents - a.totalCents);
  }, [celulasFiltradas, pessoaPorId, mesesNoPeriodo, pactuadoPorChave, dados.bandas]);

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
      if (!pessoa || !pessoaPassa(pessoa)) continue;
      pendentes.set(pact.personId, Math.max(pendentes.get(pact.personId) ?? 0, pact.fixoContratadoCents));
    }
    return {
      pactuadosSemLancamento: [...pendentes.keys()].map((id) => pessoaPorId.get(id)!),
      fixoSemLancamentoCents: [...pendentes.values()].reduce((s, v) => s + v, 0)
    };
  }, [linhas, dados.pactuado, mesesNoPeriodo, pessoaPorId, pessoaPassa]);

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

  const saidasSemDonoNoPeriodo = useMemo(
    () =>
      dados.cobertura.saidasSemDono.filter((s) => {
        const mes = `${s.data.slice(0, 7)}-01`;
        if (mes < mesDe || mes > mesAte) return false;
        if (conta && s.conta !== conta) return false;
        return true;
      }),
    [dados.cobertura.saidasSemDono, mesDe, mesAte, conta]
  );

  // ── Cobertura no mesmo recorte de período e conta ───────────────────────
  const buracosNoPeriodo = useMemo(
    () =>
      dados.cobertura.buracos.filter(
        (b) => b.mes >= mesDe && b.mes <= mesAte && (!conta || b.conta === conta)
      ),
    [dados.cobertura.buracos, mesDe, mesAte, conta]
  );
  const naoAtribuidoCents = buracosNoPeriodo.reduce((s, b) => s + b.semContraparteCents, 0);
  const naoAtribuidoN = buracosNoPeriodo.reduce((s, b) => s + b.semContraparteN, 0);

  const suspeitosNoPeriodo = useMemo(
    () =>
      dados.cobertura.suspeitos
        .filter((x) => x.mes >= mesDe && x.mes <= mesAte && (!conta || x.conta === conta))
        .filter((x) => pessoaPassa(pessoaPorId.get(x.personId)))
        .sort((a, b) => b.cents - a.cents),
    [dados.cobertura.suspeitos, mesDe, mesAte, conta, pessoaPassa, pessoaPorId]
  );
  const suspeitoCents = suspeitosNoPeriodo.reduce((s, x) => s + x.cents, 0);

  /**
   * Cobertura = quanto do dinheiro daquelas contas, naqueles meses, ganhou dono.
   *
   * O denominador ignora os filtros de PESSOA (time, vínculo, busca) de
   * propósito, e o numerador também. A saída sem favorecido não pertence a
   * ninguém — logo não encolhe quando se filtra por Hardware. Dividir um
   * numerador filtrado por um denominador que não filtra produzia "cobertura de
   * 59,3%" ao escolher um time, o que não é uma medida de nada: é o custo de um
   * time dividido pelo buraco da empresa inteira.
   */
  const totalDoUniversoCents = useMemo(
    () =>
      dados.celulas
        .filter((c) => c.mes >= mesDe && c.mes <= mesAte && (!conta || c.conta === conta))
        .reduce((s, c) => s + c.cents, 0),
    [dados.celulas, mesDe, mesAte, conta]
  );
  const universoCents = totalDoUniversoCents + naoAtribuidoCents;
  const pctAtribuido = universoCents ? (totalDoUniversoCents / universoCents) * 100 : 100;

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
      const celulasAnt = dados.celulas.filter((celula) => {
        if (celula.mes < de || celula.mes > ate) return false;
        if (conta && celula.conta !== conta) return false;
        if (natureza && celula.natureza !== natureza) return false;
        return pessoaPassa(pessoaPorId.get(celula.personId));
      });
      totalPeriodoAnteriorCents = celulasAnt.reduce((s, c) => s + c.cents, 0);
    }
  }

  const totaisUltimoMes = useMemo(() => {
    const acc = {
      salario: 0,
      prolabore: 0,
      estagio: 0,
      comissao: 0,
      reembolso: 0,
      extra: 0
    };
    for (const l of linhas) {
      const u = l.ultimoMesBanda;
      if (!u) continue;
      acc.salario += u.salarioCents;
      acc.prolabore += u.prolaboreCents;
      acc.estagio += u.estagioCents;
      acc.comissao += u.comissaoCents;
      acc.reembolso += u.reembolsoCents;
      acc.extra += u.extraCents;
    }
    return acc;
  }, [linhas]);

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
          <article className="fin-pessoas-kpi-item destaque">
            <p className="fin-pessoas-kpi-rotulo">Total com pessoas</p>
            <p className="fin-pessoas-kpi-valor">{brlCents(totalCents)}</p>
            <DeltaCusto
              atual={totalCents}
              anterior={totalPeriodoAnteriorCents}
              contra="período anterior"
            />
          </article>

          <article className="fin-pessoas-kpi-item">
            <p className="fin-pessoas-kpi-rotulo">
              Mês {ultimoMes ? monthKeyLabel(ultimoMes) : "—"}
              {ultimoMesParcial ? <span className="fin-tag">parcial</span> : null}
            </p>
            <p className="fin-pessoas-kpi-valor">{brlCents(ultimoMesCents)}</p>
            <DeltaCusto
              atual={ultimoMesCents}
              anterior={penultimoMes ? penultimoMesCents : null}
              contra={penultimoMes ? monthKeyLabel(penultimoMes) : ""}
            />
          </article>

          <article className="fin-pessoas-kpi-item">
            <p className="fin-pessoas-kpi-rotulo">Média mensal / pessoa</p>
            <p className="fin-pessoas-kpi-valor">{brlCents(mediaMensalPorPessoaCents)}</p>
            {mediaPessoaUltimo !== null ? (
              <DeltaCusto
                atual={mediaPessoaUltimo}
                anterior={mediaPessoaPenultimo}
                contra={penultimoMes ? monthKeyLabel(penultimoMes) : ""}
              />
            ) : (
              <p className="fin-delta neutro">sem base</p>
            )}
          </article>
        </div>
      </section>

      <FinSecaoColapsavel
        className="fin-pessoas-recorte"
        titulo="Recorte"
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

        <div className="fin-pessoas-filtros">
          <input
            type="search"
            className="fin-input"
            placeholder="Buscar pessoa…"
            value={busca}
            onChange={(e) => set.setBusca(e.target.value)}
            aria-label="Buscar pessoa"
          />
          <select className="fin-select" value={mesDe} onChange={(e) => set.setMesDe(e.target.value)} aria-label="Mês inicial">
            {dados.meses.map((mes) => (
              <option key={mes} value={mes}>
                de {monthKeyLabel(mes)}
              </option>
            ))}
          </select>
          <select className="fin-select" value={mesAte} onChange={(e) => set.setMesAte(e.target.value)} aria-label="Mês final">
            {dados.meses.map((mes) => (
              <option key={mes} value={mes}>
                até {monthKeyLabel(mes)}
              </option>
            ))}
          </select>
          <select className="fin-select" value={conta} onChange={(e) => set.setConta(e.target.value)} aria-label="Conta">
            <option value="">Todas as contas</option>
            {dados.contas.map((item) => (
              <option key={item.slug} value={item.slug}>
                {item.nome}
              </option>
            ))}
          </select>
          <select className="fin-select" value={time} onChange={(e) => set.setTime(e.target.value)} aria-label="Time">
            <option value="">Todos os times</option>
            {dados.times.map((item) => (
              <option key={item.slug} value={item.slug}>
                {item.nome}
              </option>
            ))}
          </select>
          <select className="fin-select" value={vinculo} onChange={(e) => set.setVinculo(e.target.value)} aria-label="Vínculo">
            <option value="">Todos os vínculos</option>
            {dados.vinculos.map((item) => (
              <option key={item.slug} value={item.slug}>
                {item.nome}
              </option>
            ))}
          </select>
          <select
            className="fin-select"
            value={natureza}
            onChange={(e) => set.setNatureza(e.target.value)}
            aria-label="Natureza"
          >
            <option value="">Todas as naturezas</option>
            {dados.naturezas.map((item) => (
              <option key={item.slug} value={item.slug}>
                {item.nome}
              </option>
            ))}
          </select>
        </div>

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

      <FinPessoasMatriz
        dados={dados}
        bandas={bandasFiltradas}
        meses={mesesNoPeriodo}
        pessoaPorId={pessoaPorId}
        mesAtual={dados.mesAtual}
      />

      <FinSecaoColapsavel
        className="fin-pessoas-lista"
        titulo="Geral do time"
        meta={`${pessoasNoRecorte} ${pessoasNoRecorte === 1 ? "pessoa" : "pessoas"} · ${brlPrecise(totalCents)}`}
      >
        <div className="fin-pessoas-tabela-wrap">
          <table className="fin-table fin-pessoas-tabela">
            <thead>
              <tr>
                <th>Pessoa</th>
                <th>Vínculo</th>
                <th>Time</th>
                <th>Último mês</th>
                <th className="num">Salário</th>
                <th className="num">Pró-labore</th>
                <th className="num">Estágio</th>
                <th className="num">Comissão</th>
                <th className="num">Reembolso</th>
                <th className="num" title="Pago sem cair em salário/pró-labore/comissão/bolsa — em geral categoria errada ou serviço (4.03, 5.05)">
                  Extra
                </th>
                <th className="num">Total</th>
                <th className="num">Média/mês</th>
                <th
                  className="num"
                  title="Fixo contratado na planilha de comissionamento, só nos meses em que ela existe"
                >
                  Fixo
                  {mesesComPactuadoNoPeriodo.length === 1
                    ? ` (${monthKeyLabel(mesesComPactuadoNoPeriodo[0])})`
                    : mesesComPactuadoNoPeriodo.length
                      ? ` (${mesesComPactuadoNoPeriodo.length} m.)`
                      : ""}
                </th>
                <th className="num" title="Realizado menos o fixo contratado, nos mesmos meses">
                  Acima
                </th>
                <th className="num">Δ</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((linha) => (
                <tr key={linha.pessoa.id}>
                  <td>
                    <a
                      className="fin-pessoas-nome-link"
                      href={`/financeiro/pessoas/${linha.pessoa.id}`}
                    >
                      <span className="fin-pessoas-nome">
                        <span className="fin-pessoas-nome-texto">
                          <span className="fin-desc">{linha.pessoa.nome}</span>
                          {linha.pessoa.nomeLegal &&
                          linha.pessoa.nomeLegal !== linha.pessoa.nome ? (
                            <span className="fin-desc-sub">{linha.pessoa.nomeLegal}</span>
                          ) : null}
                        </span>
                        <ChevronRight
                          className="fin-pessoas-nome-seta"
                          size={15}
                          strokeWidth={2.2}
                          aria-hidden
                        />
                      </span>
                    </a>
                  </td>
                  <td>
                    <span className="fin-pessoas-pill">{linha.pessoa.vinculoRotulo}</span>
                  </td>
                  <td>{linha.pessoa.timeRotulo}</td>
                  <td className="fin-nowrap">
                    {linha.ultimoMesBanda ? (
                      <span className="fin-pessoas-ultimo-mes">
                        {monthKeyLabel(linha.ultimoMesBanda.mes)}
                      </span>
                    ) : (
                      <span className="fin-zero">—</span>
                    )}
                  </td>
                  <td className="num fin-table-money">
                    <CelulaBanda cents={linha.ultimoMesBanda?.salarioCents ?? 0} />
                  </td>
                  <td className="num fin-table-money">
                    <CelulaBanda cents={linha.ultimoMesBanda?.prolaboreCents ?? 0} />
                  </td>
                  <td className="num fin-table-money">
                    <CelulaBanda cents={linha.ultimoMesBanda?.estagioCents ?? 0} />
                  </td>
                  <td className="num fin-table-money">
                    <CelulaBanda cents={linha.ultimoMesBanda?.comissaoCents ?? 0} />
                  </td>
                  <td className="num fin-table-money">
                    <CelulaBanda cents={linha.ultimoMesBanda?.reembolsoCents ?? 0} />
                  </td>
                  <td className="num fin-table-money">
                    <CelulaBanda cents={linha.ultimoMesBanda?.extraCents ?? 0} />
                  </td>
                  <td className="num fin-table-money">
                    <strong>{brlPrecise(linha.totalCents)}</strong>
                  </td>
                  <td className="num fin-table-money">{brlPrecise(linha.mediaMensalCents)}</td>
                  <td className="num fin-table-money fin-previsao">
                    {linha.fixoContratadoCents === null ? (
                      <span className="fin-zero">—</span>
                    ) : (
                      <span
                        title={`Soma do fixo em ${linha.mesesPactuados.map(monthKeyLabel).join(", ")}`}
                      >
                        {brlPrecise(linha.fixoContratadoCents)}
                      </span>
                    )}
                  </td>
                  <td className="num fin-table-money">
                    {linha.excedenteCents === null ? (
                      <span className="fin-zero">—</span>
                    ) : (
                      <span className={linha.excedenteCents > 0 ? "fin-out" : undefined}>
                        {brlPrecise(linha.excedenteCents)}
                      </span>
                    )}
                  </td>
                  <td className="num">
                    {linha.variacaoPct === null ? (
                      <span className="fin-zero">—</span>
                    ) : (
                      <span
                        className={
                          Math.abs(linha.variacaoPct) < 0.5
                            ? "fin-pessoas-delta neutro"
                            : linha.variacaoPct > 0
                              ? "fin-pessoas-delta sobe"
                              : "fin-pessoas-delta desce"
                        }
                        title={`${monthKeyLabel(linha.primeiroMes!)} → ${monthKeyLabel(linha.ultimoMes!)}`}
                      >
                        {linha.variacaoPct >= 0 ? "+" : "−"}
                        {pct(Math.abs(linha.variacaoPct), 0)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {!linhas.length ? (
                <tr>
                  <td colSpan={15} className="fin-empty-row">
                    Nenhuma pessoa com lançamento neste recorte.
                  </td>
                </tr>
              ) : null}
            </tbody>
            <tfoot>
              <tr>
                <th>Total</th>
                <td />
                <td />
                <td className="num" title="Soma do último mês de cada pessoa — meses podem diferir">
                  <span className="fin-zero">último</span>
                </td>
                <td className="num fin-table-money">
                  {totaisUltimoMes.salario ? (
                    <strong>{brlPrecise(totaisUltimoMes.salario)}</strong>
                  ) : (
                    <span className="fin-zero">—</span>
                  )}
                </td>
                <td className="num fin-table-money">
                  {totaisUltimoMes.prolabore ? (
                    <strong>{brlPrecise(totaisUltimoMes.prolabore)}</strong>
                  ) : (
                    <span className="fin-zero">—</span>
                  )}
                </td>
                <td className="num fin-table-money">
                  {totaisUltimoMes.estagio ? (
                    <strong>{brlPrecise(totaisUltimoMes.estagio)}</strong>
                  ) : (
                    <span className="fin-zero">—</span>
                  )}
                </td>
                <td className="num fin-table-money">
                  {totaisUltimoMes.comissao ? (
                    <strong>{brlPrecise(totaisUltimoMes.comissao)}</strong>
                  ) : (
                    <span className="fin-zero">—</span>
                  )}
                </td>
                <td className="num fin-table-money">
                  {totaisUltimoMes.reembolso ? (
                    <strong>{brlPrecise(totaisUltimoMes.reembolso)}</strong>
                  ) : (
                    <span className="fin-zero">—</span>
                  )}
                </td>
                <td className="num fin-table-money">
                  {totaisUltimoMes.extra ? (
                    <strong>{brlPrecise(totaisUltimoMes.extra)}</strong>
                  ) : (
                    <span className="fin-zero">—</span>
                  )}
                </td>
                <td className="num fin-table-money">
                  <strong>{brlPrecise(totalCents)}</strong>
                </td>
                <td className="num fin-table-money">
                  {brlPrecise(mesesComCusto.length ? Math.round(totalCents / mesesComCusto.length) : 0)}
                </td>
                <td className="num fin-table-money fin-previsao">
                  {linhas.some((l) => l.fixoContratadoCents !== null) ? (
                    <strong>
                      {brlPrecise(linhas.reduce((s, l) => s + (l.fixoContratadoCents ?? 0), 0))}
                    </strong>
                  ) : (
                    <span className="fin-zero">—</span>
                  )}
                </td>
                <td className="num fin-table-money">
                  {linhas.some((l) => l.excedenteCents !== null) ? (
                    <strong>
                      {brlPrecise(linhas.reduce((s, l) => s + (l.excedenteCents ?? 0), 0))}
                    </strong>
                  ) : (
                    <span className="fin-zero">—</span>
                  )}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>

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
      </FinSecaoColapsavel>

      <section className="fin-two-col">
        <FinSecaoColapsavel
          titulo="Por time"
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
      <Cobertura
        dados={dados}
        totalCents={totalDoUniversoCents}
        naoAtribuidoCents={naoAtribuidoCents}
        naoAtribuidoN={naoAtribuidoN}
        pctAtribuido={pctAtribuido}
        suspeitos={suspeitosNoPeriodo}
        suspeitoCents={suspeitoCents}
        saidasSemDono={saidasSemDonoNoPeriodo}
      />


    </>
  );
}

// ---------------------------------------------------------------------------
// Cobertura: o que NÃO entrou no total, com valor
// ---------------------------------------------------------------------------
function Cobertura({
  dados,
  totalCents,
  naoAtribuidoCents,
  naoAtribuidoN,
  pctAtribuido,
  suspeitos,
  suspeitoCents,
  saidasSemDono
}: {
  dados: CustoPessoas;
  totalCents: number;
  naoAtribuidoCents: number;
  naoAtribuidoN: number;
  pctAtribuido: number;
  suspeitos: CustoPessoas["cobertura"]["suspeitos"];
  suspeitoCents: number;
  saidasSemDono: SaidaSemDono[];
}) {
  const { linksPropostos, pessoasSemContraparte, faturaCartaoCents, faturaCartaoN } = dados.cobertura;
  const linksCents = linksPropostos.reduce((s, l) => s + l.saidaCents, 0);
  const suspeitoN = suspeitos.reduce((s, x) => s + x.n, 0);

  const indicadores = [
    suspeitoCents > 0
      ? {
          key: "suspeitos",
          alerta: true,
          rotulo: "Nome no extrato, sem contraparte",
          valor: brlCents(suspeitoCents),
          topicos: [
            `${suspeitoN} saídas neste recorte`,
            "Texto casa com alguém do roster",
            "Sem favorecido → não soma no total"
          ]
        }
      : null,
    faturaCartaoCents > 0
      ? {
          key: "fatura",
          alerta: false,
          rotulo: "Fatura de cartão (excluída)",
          valor: brlCents(faturaCartaoCents),
          topicos: [
            `${faturaCartaoN} lançamentos`,
            `~${brlCents(Math.round(faturaCartaoCents / Math.max(1, dados.meses.length)))}/mês`,
            "Sai no nome do sócio — não é pró-labore"
          ]
        }
      : null,
    linksPropostos.length > 0
      ? {
          key: "links",
          alerta: linksPropostos.some((l) => l.ehBanco),
          rotulo: "Ligações a decidir",
          valor: String(linksPropostos.length),
          topicos: [
            `${brlCents(linksCents)} pendurados`,
            "Só confirmada entra no custo",
            ...(linksPropostos.some((l) => l.ehBanco) ? ["Há proposta de banco (não confirmar)"] : [])
          ]
        }
      : null,
    pessoasSemContraparte.length > 0
      ? {
          key: "sem-cp",
          alerta: true,
          rotulo: "Sem contraparte nenhuma",
          valor: String(pessoasSemContraparte.length),
          topicos: [
            pessoasSemContraparte.map((p) => p.nome).join(", "),
            "Aparecem R$ 0 até ligar"
          ]
        }
      : null
  ].filter(Boolean) as {
    key: string;
    alerta: boolean;
    rotulo: string;
    valor: string;
    topicos: string[];
  }[];

  return (
    <FinSecaoColapsavel
      className="fin-painel-grafico"
      titulo="Cobertura"
      abertoPadrao={naoAtribuidoCents > 0 || linksPropostos.length > 0}
      meta={
        pctAtribuido >= 99.5
          ? `${pct(pctAtribuido, 1)} atribuído`
          : `${pct(100 - pctAtribuido, 1)} sem dono · ${brlCents(naoAtribuidoCents)}`
      }
      ariaLabel="Cobertura do custo com pessoas"
    >
      <p className="fin-card-hint fin-card-hint-curto">
        {brlCents(totalCents)} atribuídos · {brlCents(naoAtribuidoCents)} sem favorecido
        {naoAtribuidoN ? ` · ${naoAtribuidoN} saídas` : ""}
      </p>

      {indicadores.length ? (
        <div className="fin-painel-blocos">
          {indicadores.map((ind) => (
            <article
              key={ind.key}
              className={ind.alerta ? "fin-painel-ind tendencia-piorando" : "fin-painel-ind"}
            >
              <p className="fin-painel-ind-rotulo">{ind.rotulo}</p>
              <p className="fin-painel-ind-valor">{ind.valor}</p>
              <ul className="fin-painel-ind-topicos">
                {ind.topicos.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      ) : null}

      {saidasSemDono.length ? (
        <div className="table-wrap">
          <h3 className="fin-painel-sub">Saídas sem favorecido — diga o que é</h3>
          <table className="fin-table fin-table-saidas-sem-dono">
            <thead>
              <tr>
                <th>Data</th>
                <th className="num">Valor</th>
                <th>Extrato</th>
                <th>O que é</th>
              </tr>
            </thead>
            <tbody>
              {saidasSemDono.map((linha) => (
                <tr key={linha.id}>
                  <td className="fin-nowrap">{linha.data}</td>
                  <td className="num fin-table-money fin-out">{brlPrecise(linha.cents)}</td>
                  <td>
                    <span className="fin-desc-sub">{linha.descricao}</span>
                    <span className="fin-desc-sub">
                      {dados.contas.find((c) => c.slug === linha.conta)?.nome ?? linha.conta}
                    </span>
                  </td>
                  <td>
                    <FinSaidaSemDonoAcoes saida={linha} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {suspeitos.length ? (
        <div className="table-wrap">
          <h3 className="fin-painel-sub">Provável gente do roster (ainda fora do total)</h3>
          <table className="fin-table">
            <thead>
              <tr>
                <th>Provável favorecido</th>
                <th>Mês</th>
                <th>Conta</th>
                <th className="num">Lanç.</th>
                <th className="num">Valor</th>
                <th>Extrato</th>
              </tr>
            </thead>
            <tbody>
              {suspeitos.map((linha) => (
                <tr key={`${linha.personId}-${linha.mes}-${linha.conta}`}>
                  <td>{linha.pessoa}</td>
                  <td className="fin-nowrap">{monthKeyLabel(linha.mes)}</td>
                  <td>{dados.contas.find((c) => c.slug === linha.conta)?.nome ?? linha.conta}</td>
                  <td className="num">{linha.n}</td>
                  <td className="num fin-table-money fin-out">{brlPrecise(linha.cents)}</td>
                  <td>
                    <span className="fin-desc-sub">{linha.amostra}</span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th colSpan={4}>Total</th>
                <td className="num fin-table-money fin-out">
                  <strong>{brlPrecise(suspeitoCents)}</strong>
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      ) : null}

      {linksPropostos.length ? (
        <div className="table-wrap">
          <h3 className="fin-painel-sub">Confirmar ou rejeitar ligação</h3>
          <p className="fin-card-hint fin-card-hint-curto">
            Confirmar: soma no custo da pessoa. Rejeitar: não propõe de novo. R$ 0 = nome parecido sem saída
            (rejeitar).
          </p>
          <table className="fin-table">
            <thead>
              <tr>
                <th>Pessoa</th>
                <th>Contraparte proposta</th>
                <th>Método</th>
                <th className="num">Confiança</th>
                <th className="num">Lanç.</th>
                <th className="num">Saída</th>
                <th>Decidir</th>
              </tr>
            </thead>
            <tbody>
              {linksPropostos.map((linha) => (
                <tr key={linha.linkId}>
                  <td>{linha.pessoa}</td>
                  <td>
                    {linha.contraparte}
                    {linha.ehBanco ? (
                      <span className="fin-badge-pendente" title="Instituição financeira">
                        é banco
                      </span>
                    ) : null}
                  </td>
                  <td>{linha.metodo}</td>
                  <td className="num">{linha.confianca.toFixed(2)}</td>
                  <td className="num">{linha.n}</td>
                  <td className="num fin-table-money">{brlPrecise(linha.saidaCents)}</td>
                  <td>
                    <FinLigacaoPropostaAcoes link={linha} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </FinSecaoColapsavel>
  );
}

function FinSaidaSemDonoAcoes({ saida }: { saida: SaidaSemDono }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const sugerido = nomeSugeridoDoExtrato(saida.descricao) ?? "";
  const [tipo, setTipo] = useState<TipoSaidaSemDono | "">("");
  const [nome, setNome] = useState(sugerido);
  const [iguais, setIguais] = useState(true);
  const [emVoo, setEmVoo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function aplicar() {
    if (!tipo) return;
    setErro(null);
    setEmVoo(true);
    try {
      const resposta = await fetch(urlDaOrigem(`/api/financeiro/lancamentos/${saida.id}/favorecido`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo,
          nome: nome.trim() || null,
          aplicarIguais: iguais
        })
      });
      const resultado = await resposta.json();
      if (!resposta.ok) {
        setErro(resultado.error ?? "não gravou");
        return;
      }
      const cat = resultado.categoryCode ? ` · ${resultado.categoryCode}` : "";
      setOk(
        `${resultado.aplicados}× → ${resultado.nome}${cat}`
      );
      startTransition(() => router.refresh());
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : "não gravou");
    } finally {
      setEmVoo(false);
    }
  }

  if (ok) return <span className="fin-desc-sub">{ok}</span>;

  return (
    <div className="fin-saida-acoes">
      <select
        className="fin-select fin-select-inline"
        value={tipo}
        disabled={emVoo}
        onChange={(e) => setTipo(e.target.value as TipoSaidaSemDono | "")}
        aria-label="Tipo da saída"
      >
        <option value="">O que é?</option>
        {(Object.keys(TIPOS_SAIDA_SEM_DONO) as TipoSaidaSemDono[]).map((chave) => (
          <option key={chave} value={chave}>
            {TIPOS_SAIDA_SEM_DONO[chave].rotulo}
          </option>
        ))}
      </select>
      <input
        className="fin-input fin-input-mini"
        value={nome}
        disabled={emVoo}
        placeholder="Favorecido"
        onChange={(e) => setNome(e.target.value)}
        aria-label="Nome do favorecido"
      />
      <label className="fin-saida-iguais">
        <input
          type="checkbox"
          checked={iguais}
          disabled={emVoo}
          onChange={(e) => setIguais(e.target.checked)}
        />
        iguais
      </label>
      <button
        type="button"
        className="fin-btn-ghost fin-btn-mini"
        disabled={emVoo || !tipo || nome.trim().length < 3}
        onClick={() => void aplicar()}
      >
        {emVoo ? "…" : "Gravar"}
      </button>
      {erro ? <span className="fin-badge-atencao">{erro}</span> : null}
    </div>
  );
}


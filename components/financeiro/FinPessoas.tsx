"use client";

import { Fragment, useMemo, useState } from "react";

import type { CustoPessoas, Pactuado, Pessoa } from "@/lib/financeiro/pessoas";
import { brlCents, brlPrecise, monthKeyLabel, pct } from "@/lib/financeiro/format";

import { Nota } from "@/components/ui/Nota";

import { FinLigacaoPropostaAcoes, FinPessoaCadastro, FinPessoaEditor } from "./FinPessoaEditor";
import { FinPessoasMatriz } from "./FinPessoasMatriz";

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
  const [aberta, setAberta] = useState<number | null>(null);

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
      estado={{ mesDe, mesAte, busca, conta, time, vinculo, natureza, aberta }}
      set={{ setMesDe, setMesAte, setBusca, setConta, setTime, setVinculo, setNatureza, setAberta }}
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
  aberta: number | null;
};

type Setters = {
  setMesDe: (v: string) => void;
  setMesAte: (v: string) => void;
  setBusca: (v: string) => void;
  setConta: (v: string) => void;
  setTime: (v: string) => void;
  setVinculo: (v: string) => void;
  setNatureza: (v: string) => void;
  setAberta: (v: number | null) => void;
};

/**
 * Separado do componente de cima só porque os hooks não podem viver depois do
 * `return` de indisponibilidade. É a mesma tela.
 */
function ConteudoPessoas({ dados, estado, set }: { dados: CustoPessoas; estado: Estado; set: Setters }) {
  const { mesDe, mesAte, busca, conta, time, vinculo, natureza, aberta } = estado;

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

  const totalCents = celulasFiltradas.reduce((s, c) => s + c.cents, 0);
  const totalLancamentos = celulasFiltradas.reduce((s, c) => s + c.n, 0);

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

  const porTime = useMemo(() => {
    const mapa = new Map<string, { nome: string; cents: number; pessoas: Set<number> }>();
    for (const celula of celulasFiltradas) {
      const pessoa = pessoaPorId.get(celula.personId);
      if (!pessoa) continue;
      const atual = mapa.get(pessoa.time) ?? { nome: pessoa.timeRotulo, cents: 0, pessoas: new Set<number>() };
      atual.cents += celula.cents;
      atual.pessoas.add(pessoa.id);
      mapa.set(pessoa.time, atual);
    }
    return [...mapa.entries()]
      .map(([slug, v]) => ({ slug, nome: v.nome, cents: v.cents, pessoas: v.pessoas.size }))
      .sort((a, b) => b.cents - a.cents);
  }, [celulasFiltradas, pessoaPorId]);

  const porVinculo = useMemo(() => {
    const mapa = new Map<string, { nome: string; cents: number; pessoas: Set<number> }>();
    for (const celula of celulasFiltradas) {
      const pessoa = pessoaPorId.get(celula.personId);
      if (!pessoa) continue;
      const atual = mapa.get(pessoa.vinculo) ?? { nome: pessoa.vinculoRotulo, cents: 0, pessoas: new Set<number>() };
      atual.cents += celula.cents;
      atual.pessoas.add(pessoa.id);
      mapa.set(pessoa.vinculo, atual);
    }
    return [...mapa.entries()]
      .map(([slug, v]) => ({ slug, nome: v.nome, cents: v.cents, pessoas: v.pessoas.size }))
      .sort((a, b) => b.cents - a.cents);
  }, [celulasFiltradas, pessoaPorId]);

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
  const filtroDePessoaAtivo = Boolean(time || vinculo || busca.trim() || natureza);

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
  const variacaoMes = penultimoMesCents ? ((ultimoMesCents - penultimoMesCents) / penultimoMesCents) * 100 : null;
  // O mês corrente é parcial por definição: o extrato do Inter vai até o dia 4 e
  // o do Nubank até o 7. Sem essa marca, todo início de mês a tela mostraria uma
  // "queda" que é só calendário.
  const ultimoMesParcial = ultimoMes === dados.mesAtual;

  const pessoasNoRecorte = linhas.length;
  const contaAtiva = dados.contas.find((c) => c.slug === conta);

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
      <section className="fin-kpi-row" aria-label="Indicadores de custo com pessoas">
        <article className="fin-kpi-card">
          <p className="fin-kpi-label">Custo atribuído a pessoas</p>
          <p className="fin-kpi-value">{brlCents(totalCents)}</p>
          <p className="fin-kpi-hint">
            {pessoasNoRecorte} {pessoasNoRecorte === 1 ? "pessoa" : "pessoas"} · {totalLancamentos} lançamentos ·{" "}
            {mesesNoPeriodo.length === 1
              ? monthKeyLabel(mesDe)
              : `${monthKeyLabel(mesDe)} a ${monthKeyLabel(mesAte)}`}
          </p>
        </article>

        <article className={naoAtribuidoCents > 0 ? "fin-kpi-card alerta" : "fin-kpi-card"}>
          <p className="fin-kpi-label">Não atribuído a ninguém</p>
          <p className="fin-kpi-value">{brlCents(naoAtribuidoCents)}</p>
          <p className="fin-kpi-hint">
            {naoAtribuidoN} saídas de conta corrente sem favorecido. Cobertura: {pct(pctAtribuido, 1)} do dinheiro que
            saiu {contaAtiva ? `do ${contaAtiva.nome}` : "das contas correntes"} no período tem dono.
            {filtroDePessoaAtivo
              ? " Este número não responde aos filtros de pessoa — saída sem favorecido não pertence a time nem a vínculo nenhum."
              : ""}
          </p>
        </article>

        <article className="fin-kpi-card">
          <p className="fin-kpi-label">Como se divide por conta</p>
          <p className="fin-kpi-value">
            {porConta.length && porConta[0].cents ? `${porConta[0].nome} ${pct((porConta[0].cents / (totalCents || 1)) * 100, 0)}` : "—"}
          </p>
          <p className="fin-kpi-hint">
            {porConta
              .map((c) => `${c.nome} ${brlCents(c.cents)} (${pct((c.cents / (totalCents || 1)) * 100, 0)})`)
              .join(" · ")}
          </p>
        </article>

        <article className="fin-kpi-card">
          <p className="fin-kpi-label">
            Mês {ultimoMes ? monthKeyLabel(ultimoMes) : "—"}
            {ultimoMesParcial ? <span className="fin-tag">parcial</span> : null}
          </p>
          <p className="fin-kpi-value">{brlCents(ultimoMesCents)}</p>
          <p className="fin-kpi-hint">
            {variacaoMes === null || !penultimoMes
              ? "sem mês anterior no recorte para comparar"
              : `${variacaoMes >= 0 ? "+" : "−"}${pct(Math.abs(variacaoMes), 1)} contra ${monthKeyLabel(penultimoMes)} (${brlCents(penultimoMesCents)})`}
            {ultimoMesParcial ? ` · o extrato vai até ${dados.hoje.slice(8, 10)}/${dados.hoje.slice(5, 7)}, o mês não fechou` : ""}
          </p>
        </article>
      </section>

      <section className="card">
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

        <div className="fin-filters">
          <input
            type="search"
            className="fin-input"
            placeholder="Buscar pessoa, nome de cartório ou contraparte…"
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

        <p className="fin-filters-summary">
          <strong>{brlPrecise(totalCents)}</strong> em {mesesNoPeriodo.length}{" "}
          {mesesNoPeriodo.length === 1 ? "mês" : "meses"} · {pessoasNoRecorte} pessoas ·{" "}
          {contaAtiva ? contaAtiva.nome : "todas as contas"} · média de{" "}
          <strong>{brlPrecise(mesesComCusto.length ? Math.round(totalCents / mesesComCusto.length) : 0)}</strong> por
          mês
          {naoAtribuidoCents > 0 ? (
            <>
              {" "}
              · <strong className="fin-out">{brlPrecise(naoAtribuidoCents)}</strong> fora da conta por falta de
              favorecido
            </>
          ) : null}
        </p>

        <div className="fin-two-col">
          <div>
            <p className="fin-subtitulo">Por conta — de onde o dinheiro saiu</p>
            <div className="table-wrap">
              <table className="fin-table">
                <thead>
                  <tr>
                    <th>Conta</th>
                    <th className="num">Lanç.</th>
                    <th className="num">Valor</th>
                    <th className="num">Fatia</th>
                  </tr>
                </thead>
                <tbody>
                  {porConta.map((linha) => {
                    const fatia = totalCents ? (linha.cents / totalCents) * 100 : 0;
                    return (
                      <tr key={linha.slug}>
                        <td>{linha.nome}</td>
                        <td className="num">{linha.n || <span className="fin-zero">—</span>}</td>
                        <td className="num fin-table-money">
                          {linha.cents ? brlPrecise(linha.cents) : <span className="fin-zero">R$ 0,00</span>}
                        </td>
                        <td className="num">
                          <span className="fin-share" style={{ ["--share" as string]: `${fatia.toFixed(1)}%` }}>
                            {pct(fatia, 1)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="fin-card-hint">
              O gateway aparece com R$ 0,00 de propósito: nenhum pagamento a pessoa sai do Asaas — de lá o dinheiro vai
              para os bancos e é nos bancos que a folha acontece. Uma planilha que olhasse só o Inter perderia{" "}
              {brlCents(porConta.find((c) => c.slug === "nubank")?.cents ?? 0)} pagos pelo Nubank.
            </p>
          </div>

          <div>
            <p className="fin-subtitulo">Por natureza — o que o razão sabe dizer</p>
            <div className="table-wrap">
              <table className="fin-table">
                <thead>
                  <tr>
                    <th>Natureza</th>
                    <th className="num">Lanç.</th>
                    <th className="num">Valor</th>
                    <th className="num">Fatia</th>
                  </tr>
                </thead>
                <tbody>
                  {porNatureza.map((linha) => {
                    const fatia = totalCents ? (linha.cents / totalCents) * 100 : 0;
                    return (
                      <tr key={linha.slug}>
                        <td>{linha.nome}</td>
                        <td className="num">{linha.n || <span className="fin-zero">—</span>}</td>
                        <td className="num fin-table-money">
                          {linha.cents ? brlPrecise(linha.cents) : <span className="fin-zero">R$ 0,00</span>}
                        </td>
                        <td className="num">
                          <span className="fin-share" style={{ ["--share" as string]: `${fatia.toFixed(1)}%` }}>
                            {pct(fatia, 1)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {!porNatureza.length ? (
                    <tr>
                      <td colSpan={4} className="fin-empty-row">
                        Nada neste recorte.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <p className="fin-card-hint">
              Reembolso e benefício aparecem aqui quando existirem: hoje nenhum lançamento das categorias 6.04 e 6.05
              tem contraparte ligada a alguém do roster, então valem R$ 0,00 — zerados, não escondidos. A separação
              entre fixo e variável NÃO vem daqui: vem da planilha de comissionamento, na coluna "acima do fixo" da
              tabela abaixo.
            </p>
          </div>
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">Cada pessoa, somando todas as contrapartes dela</h2>
        <p className="fin-card-hint">
          Seis MEIs recebem no CNPJ e no CPF. A coluna "contrapartes" mostra quantas cada pessoa tem — clicar em
          "detalhar" abre quanto entrou por cada uma. Somar por contraparte, e não por pessoa, cortaria o custo desses
          seis pela metade sem produzir erro nenhum: só um número menor.
        </p>

        <div className="table-wrap">
          <table className="fin-table">
            <thead>
              <tr>
                <th>Pessoa</th>
                <th>Vínculo</th>
                <th>Time</th>
                <th className="num">Contrap.</th>
                {dados.contas.map((c) => (
                  <th key={c.slug} className="num">
                    {c.nome}
                  </th>
                ))}
                <th className="num">Total</th>
                <th className="num">Média/mês</th>
                {/* O rótulo carrega o recorte do pactuado porque ele quase nunca
                    é o mesmo do total ao lado: a planilha de comissionamento
                    cobre um mês e o total cobre oito. Sem os meses no cabeçalho,
                    R$ 7.500 de fixo ao lado de R$ 80.920 de total lê-se como
                    "recebeu 10× o combinado". */}
                <th className="num" title="Fixo contratado na planilha de comissionamento, somado apenas nos meses em que ela existe">
                  Fixo pactuado
                  {mesesComPactuadoNoPeriodo.length
                    ? ` (${mesesComPactuadoNoPeriodo.map(monthKeyLabel).join(", ")})`
                    : ""}
                </th>
                <th className="num" title="Realizado menos o fixo contratado, nos mesmos meses">
                  Acima do fixo
                </th>
                <th className="num">Variação</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((linha) => (
                <Fragment key={linha.pessoa.id}>
                  <tr>
                    <td>
                      <span className="fin-desc">{linha.pessoa.nome}</span>
                      {linha.pessoa.nomeLegal && linha.pessoa.nomeLegal !== linha.pessoa.nome ? (
                        <span className="fin-desc-sub">{linha.pessoa.nomeLegal}</span>
                      ) : null}
                      <button
                        type="button"
                        className="fin-why"
                        onClick={() => set.setAberta(aberta === linha.pessoa.id ? null : linha.pessoa.id)}
                        aria-expanded={aberta === linha.pessoa.id}
                      >
                        detalhar
                      </button>
                    </td>
                    <td>{linha.pessoa.vinculoRotulo}</td>
                    <td>{linha.pessoa.timeRotulo}</td>
                    <td className="num">
                      {linha.pessoa.contrapartes.length}
                      {linha.pessoa.contrapartes.length > 1 ? (
                        <span className="fin-tag" title="Recebe em mais de um documento (CNPJ do MEI e CPF)">
                          CNPJ+CPF
                        </span>
                      ) : null}
                    </td>
                    {dados.contas.map((c) => (
                      <td key={c.slug} className="num fin-table-money">
                        {linha.porConta[c.slug] ? (
                          brlPrecise(linha.porConta[c.slug])
                        ) : (
                          <span className="fin-zero">—</span>
                        )}
                      </td>
                    ))}
                    <td className="num fin-table-money">
                      <strong>{brlPrecise(linha.totalCents)}</strong>
                    </td>
                    <td className="num fin-table-money">{brlPrecise(linha.mediaMensalCents)}</td>
                    <td className="num fin-table-money fin-previsao">
                      {linha.fixoContratadoCents === null ? (
                        <span className="fin-zero" title="Sem fixo contratado na planilha para os meses deste recorte">
                          —
                        </span>
                      ) : (
                        <span title={`Soma do fixo contratado em ${linha.mesesPactuados.map(monthKeyLabel).join(", ")}`}>
                          {brlPrecise(linha.fixoContratadoCents)}
                        </span>
                      )}
                    </td>
                    <td className="num fin-table-money">
                      {linha.excedenteCents === null ? (
                        <span className="fin-zero">—</span>
                      ) : (
                        <span
                          className={linha.excedenteCents > 0 ? "fin-out" : undefined}
                          title={`Realizado em ${linha.mesesPactuados.map(monthKeyLabel).join(", ")} menos o fixo contratado dos mesmos meses`}
                        >
                          {brlPrecise(linha.excedenteCents)}
                        </span>
                      )}
                    </td>
                    <td className="num">
                      {linha.variacaoPct === null ? (
                        <span className="fin-zero">—</span>
                      ) : (
                        <span
                          className={linha.variacaoPct > 5 ? "fin-badge-atencao" : undefined}
                          title={`${monthKeyLabel(linha.primeiroMes!)} → ${monthKeyLabel(linha.ultimoMes!)}`}
                        >
                          {linha.variacaoPct >= 0 ? "+" : "−"}
                          {pct(Math.abs(linha.variacaoPct), 0)}
                        </span>
                      )}
                    </td>
                  </tr>
                  {aberta === linha.pessoa.id ? (
                    <tr>
                      <td colSpan={dados.contas.length + 8}>
                        <Detalhe
                          pessoa={linha.pessoa}
                          dados={dados}
                          porMes={linha.porMes}
                          meses={mesesNoPeriodo}
                          pactuadoPorChave={pactuadoPorChave}
                        />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
              {!linhas.length ? (
                <tr>
                  <td colSpan={dados.contas.length + 8} className="fin-empty-row">
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
                <td className="num">{linhas.reduce((s, l) => s + l.pessoa.contrapartes.length, 0)}</td>
                {dados.contas.map((c) => (
                  <td key={c.slug} className="num fin-table-money">
                    {porConta.find((x) => x.slug === c.slug)?.cents ? (
                      <strong>{brlPrecise(porConta.find((x) => x.slug === c.slug)!.cents)}</strong>
                    ) : (
                      <span className="fin-zero">—</span>
                    )}
                  </td>
                ))}
                <td className="num fin-table-money">
                  <strong>{brlPrecise(totalCents)}</strong>
                </td>
                <td className="num fin-table-money">
                  {brlPrecise(mesesComCusto.length ? Math.round(totalCents / mesesComCusto.length) : 0)}
                </td>
                <td className="num fin-table-money fin-previsao">
                  {linhas.some((l) => l.fixoContratadoCents !== null) ? (
                    <strong>{brlPrecise(linhas.reduce((s, l) => s + (l.fixoContratadoCents ?? 0), 0))}</strong>
                  ) : (
                    <span className="fin-zero">—</span>
                  )}
                </td>
                <td className="num fin-table-money">
                  {linhas.some((l) => l.excedenteCents !== null) ? (
                    <strong>{brlPrecise(linhas.reduce((s, l) => s + (l.excedenteCents ?? 0), 0))}</strong>
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
              ? `As duas últimas colunas de dinheiro cobrem só ${mesesComPactuadoNoPeriodo.map(monthKeyLabel).join(", ")} — os meses em que a planilha de comissionamento existe. O total ao lado cobre ${mesesNoPeriodo.length} ${mesesNoPeriodo.length === 1 ? "mês" : "meses"}: são recortes diferentes de propósito, e por isso a comparação entre eles não fecha. "Acima do fixo" negativo significa que a pessoa recebeu MENOS que o combinado no mês.`
              : "Nenhum mês deste recorte tem fixo contratado na planilha de comissionamento, então as colunas de pactuado vêm vazias."}{" "}
            {pactuadosSemLancamento.length
              ? `O rodapé soma apenas quem teve lançamento. ${pactuadosSemLancamento.map((p) => p.nome).join(", ")} ${pactuadosSemLancamento.length === 1 ? "tem fixo contratado e não aparece" : "têm fixo contratado e não aparecem"} em nenhuma linha: ${brlPrecise(fixoSemLancamentoCents)} por mês de compromisso que esta tabela não mostra porque o dinheiro não foi visto saindo.`
              : "Todo mundo com fixo contratado na planilha tem ao menos um lançamento neste recorte."}
          </p>
        </Nota>
      </section>

      <FinPessoasMatriz
        dados={dados}
        celulas={celulasFiltradas}
        meses={mesesNoPeriodo}
        pessoaPorId={pessoaPorId}
        mesAtual={dados.mesAtual}
      />

      <section className="fin-two-col">
        <section className="card">
          <h2 className="card-title">Por time</h2>
          <p className="fin-card-hint">
            O time vem do cadastro da pessoa (área para Hardware e Software, via de pagamento para Obras e
            Consultoria), não do trabalho do mês. Quem atua nos dois lados aparece inteiro num só.
          </p>
          <div className="table-wrap">
            <table className="fin-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th className="num">Pessoas</th>
                  <th className="num">Custo</th>
                  <th className="num">Fatia</th>
                </tr>
              </thead>
              <tbody>
                {porTime.map((linha) => {
                  const fatia = totalCents ? (linha.cents / totalCents) * 100 : 0;
                  return (
                    <tr key={linha.slug}>
                      <td>{linha.nome}</td>
                      <td className="num">{linha.pessoas}</td>
                      <td className="num fin-table-money">{brlPrecise(linha.cents)}</td>
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
                    <td colSpan={4} className="fin-empty-row">
                      Nada neste recorte.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <h2 className="card-title">Por vínculo</h2>
          <p className="fin-card-hint">
            Vínculo decide linha de DRE e encargo: sócio adm. é pró-labore (6.02), MEI é nota contra CNPJ próprio,
            estágio é bolsa (6.06). "Irregular" é quem presta serviço, recebe e não tem enquadramento nenhum — e o
            valor ao lado é o tamanho da exposição.
          </p>
          <div className="table-wrap">
            <table className="fin-table">
              <thead>
                <tr>
                  <th>Vínculo</th>
                  <th className="num">Pessoas</th>
                  <th className="num">Custo</th>
                  <th className="num">Fatia</th>
                </tr>
              </thead>
              <tbody>
                {porVinculo.map((linha) => {
                  const fatia = totalCents ? (linha.cents / totalCents) * 100 : 0;
                  return (
                    <tr key={linha.slug}>
                      <td className={linha.slug === "irregular" || linha.slug === "indefinido" ? "fin-badge-atencao" : undefined}>
                        {linha.nome}
                      </td>
                      <td className="num">{linha.pessoas}</td>
                      <td className="num fin-table-money">{brlPrecise(linha.cents)}</td>
                      <td className="num">
                        <span className="fin-share" style={{ ["--share" as string]: `${fatia.toFixed(1)}%` }}>
                          {pct(fatia, 1)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {!porVinculo.length ? (
                  <tr>
                    <td colSpan={4} className="fin-empty-row">
                      Nada neste recorte.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </section>

      <Cobertura
        dados={dados}
        totalCents={totalDoUniversoCents}
        naoAtribuidoCents={naoAtribuidoCents}
        naoAtribuidoN={naoAtribuidoN}
        pctAtribuido={pctAtribuido}
        suspeitos={suspeitosNoPeriodo}
        suspeitoCents={suspeitoCents}
      />

      {/* O cadastro vem DEPOIS da cobertura de propósito: é a seção que responde
          às pendências que a cobertura acabou de nomear — a pessoa sem área, o
          vínculo indefinido, a ligação que ninguém confirmou. */}
      <FinPessoaCadastro dados={dados} />

      <section className="card fin-painel-lacunas" aria-label="Limites desta tela">
        <h2 className="card-title">O que esta tela ainda não sabe</h2>
        <p className="fin-painel-lacunas-abre">
          Os {brlCents(totalCents)} acima são dinheiro que saiu do banco para alguém do roster — isso a tela afirma com
          o extrato na mão. O que ela não afirma está aqui, em ordem de impacto sobre a decisão de contratar, reajustar
          ou cortar.
        </p>
        <ol className="fin-painel-lacunas-lista">
          {dados.lacunas.map((lacuna) => (
            <li key={lacuna.titulo}>
              <strong>{lacuna.titulo}</strong>
              <span>{lacuna.detalhe}</span>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Gaveta da pessoa: as contrapartes, os componentes pactuados e o mês a mês
// ---------------------------------------------------------------------------
function Detalhe({
  pessoa,
  dados,
  porMes,
  meses,
  pactuadoPorChave
}: {
  pessoa: Pessoa;
  dados: CustoPessoas;
  porMes: Record<string, number>;
  meses: string[];
  pactuadoPorChave: Map<string, Pactuado>;
}) {
  const componentes = dados.componentes.filter((c) => c.personId === pessoa.id);
  const mesesDoComponente = [...new Set(componentes.map((c) => c.mes))].sort();
  const mesComponente = mesesDoComponente[mesesDoComponente.length - 1] ?? null;
  const doMes = mesComponente ? componentes.filter((c) => c.mes === mesComponente) : [];

  return (
    <div className="fin-why-popover" role="note">
      {/* O mesmo editor da seção de cadastro, aqui. Quem abriu a gaveta para
          entender um número já está com a pergunta na cabeça ("por que o Diogo
          conta como Hardware?"); mandá-lo procurar a pessoa noutra tabela para
          corrigir é onde o trabalho se perde. */}
      <FinPessoaEditor pessoa={pessoa} dados={dados} />

      <p style={{ marginTop: 16 }}>
        <strong>Contrapartes ligadas a {pessoa.nome}</strong>
      </p>
      <table className="fin-table">
        <thead>
          <tr>
            <th>Contraparte no extrato</th>
            <th>Documento</th>
            <th>Como foi ligada</th>
            <th className="num">Lanç.</th>
            <th className="num">Saída total</th>
          </tr>
        </thead>
        <tbody>
          {pessoa.contrapartes.map((cp) => (
            <tr key={cp.id}>
              <td>
                {cp.nome}
                {cp.primaria ? <span className="fin-tag">primária</span> : null}
              </td>
              <td className="fin-nowrap">{cp.documento ?? "—"}</td>
              <td>
                {cp.metodo} · confiança {cp.confianca.toFixed(2)}
              </td>
              <td className="num">{cp.n}</td>
              <td className="num fin-table-money">{brlPrecise(cp.realizadoCents)}</td>
            </tr>
          ))}
          {!pessoa.contrapartes.length ? (
            <tr>
              <td colSpan={5} className="fin-empty-row">
                Nenhuma contraparte confirmada — o custo desta pessoa não aparece em lugar nenhum desta tela.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      {doMes.length ? (
        <>
          <p style={{ marginTop: 12 }}>
            <strong>Componentes pactuados — {monthKeyLabel(mesComponente!)}</strong>
          </p>
          <table className="fin-table">
            <thead>
              <tr>
                <th>Componente</th>
                <th>Natureza</th>
                <th>Via</th>
                <th className="num">Contratado</th>
                <th className="num">Apurado</th>
              </tr>
            </thead>
            <tbody>
              {[...new Set(doMes.map((c) => c.componente))].map((slug) => {
                const contratado = doMes.find((c) => c.componente === slug && c.kind === "contratado");
                const apurado = doMes.find((c) => c.componente === slug && c.kind === "apurado");
                const ref = contratado ?? apurado!;
                return (
                  <tr key={slug}>
                    <td>{ref.componenteNome}</td>
                    <td>{ref.tipo}</td>
                    <td>{ref.nucleo ?? "—"}</td>
                    <td className="num fin-table-money fin-previsao">
                      {contratado ? brlPrecise(contratado.cents) : <span className="fin-zero">—</span>}
                    </td>
                    <td className="num fin-table-money">
                      {apurado ? brlPrecise(apurado.cents) : <span className="fin-zero">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      ) : (
        <p className="fin-why-losers" style={{ marginTop: 12 }}>
          Sem componentes pactuados: esta pessoa não está na planilha de comissionamento carregada, então não há fixo
          contra o qual comparar o que ela recebeu.
        </p>
      )}

      <p style={{ marginTop: 12 }}>
        <strong>Mês a mês</strong>
      </p>
      <table className="fin-table">
        <thead>
          <tr>
            <th>Mês</th>
            <th className="num">Saiu do banco</th>
            <th className="num">Fixo pactuado</th>
            <th className="num">Acima do fixo</th>
            <th className="num">Contra o mês anterior</th>
          </tr>
        </thead>
        <tbody>
          {meses.map((mes, indice) => {
            const valor = porMes[mes] ?? 0;
            const anterior = indice > 0 ? porMes[meses[indice - 1]] ?? 0 : 0;
            const pact = pactuadoPorChave.get(chave(pessoa.id, mes));
            const delta = anterior ? ((valor - anterior) / anterior) * 100 : null;
            return (
              <tr key={mes}>
                <td className="fin-nowrap">{monthKeyLabel(mes)}</td>
                <td className="num fin-table-money">
                  {valor ? brlPrecise(valor) : <span className="fin-zero">—</span>}
                </td>
                <td className="num fin-table-money fin-previsao">
                  {pact ? brlPrecise(pact.fixoContratadoCents) : <span className="fin-zero">—</span>}
                </td>
                <td className="num fin-table-money">
                  {pact ? brlPrecise(valor - pact.fixoContratadoCents) : <span className="fin-zero">—</span>}
                </td>
                <td className="num">
                  {delta === null || !valor ? (
                    <span className="fin-zero">—</span>
                  ) : (
                    <span className={Math.abs(delta) > 15 ? "fin-badge-atencao" : undefined}>
                      {delta >= 0 ? "+" : "−"}
                      {pct(Math.abs(delta), 0)}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
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
  suspeitoCents
}: {
  dados: CustoPessoas;
  totalCents: number;
  naoAtribuidoCents: number;
  naoAtribuidoN: number;
  pctAtribuido: number;
  suspeitos: CustoPessoas["cobertura"]["suspeitos"];
  suspeitoCents: number;
}) {
  const { linksPropostos, pessoasSemContraparte, faturaCartaoCents, faturaCartaoN } = dados.cobertura;

  return (
    <section className="card fin-painel-grafico" aria-label="Cobertura do custo com pessoas">
      <header className="fin-painel-grafico-head">
        <h3>
          {pctAtribuido >= 99.5
            ? `Cobertura de ${pct(pctAtribuido, 1)}: praticamente todo o dinheiro deste recorte tem dono`
            : `${pct(100 - pctAtribuido, 1)} do dinheiro deste recorte não tem dono — ${brlCents(naoAtribuidoCents)} em ${naoAtribuidoN} saídas`}
        </h3>
        <p>
          {brlCents(totalCents)} atribuídos contra {brlCents(naoAtribuidoCents)} sem favorecido nenhum. Esses
          lançamentos não podem ser atribuídos a pessoa nem a fornecedor: o extrato simplesmente não diz para quem
          foram. Enquanto existirem, o total desta tela é um piso, não a folha inteira.
        </p>
      </header>

      <div className="fin-painel-blocos">
        <article className={suspeitoCents > 0 ? "fin-painel-ind tendencia-piorando" : "fin-painel-ind"}>
          <p className="fin-painel-ind-rotulo">
            Custo de gente que ficou de fora
            {suspeitoCents > 0 ? <span className="fin-painel-flag">fora do total</span> : null}
          </p>
          <p className="fin-painel-ind-valor">{brlCents(suspeitoCents)}</p>
          <p className="fin-painel-ind-comp">
            {suspeitos.reduce((s, x) => s + x.n, 0)} saídas sem favorecido cujo texto do extrato traz o nome de alguém
            do roster
          </p>
          <p className="fin-painel-ind-veredito">
            {suspeitoCents > 0
              ? "O nome está na descrição, a contraparte não foi criada, e por isso o valor não soma para ninguém. É a diferença entre o que a tela mostra e o que a empresa gastou com gente no período."
              : "Nenhuma saída sem favorecido tem nome do roster no texto neste recorte."}
          </p>
          {suspeitoCents > 0 ? (
            <p className="fin-painel-acao">
              <strong>Fazer:</strong> rodar a fila de revisão sobre essas linhas. Cada uma que ganhar contraparte entra
              automaticamente no total desta tela, sem reprocessar nada.
            </p>
          ) : null}
        </article>

        <article className="fin-painel-ind">
          <p className="fin-painel-ind-rotulo">Fatura de cartão deixada de fora</p>
          <p className="fin-painel-ind-valor">{brlCents(faturaCartaoCents)}</p>
          <p className="fin-painel-ind-comp">
            {faturaCartaoN} lançamentos que a guarda de fatura remove do custo de gente
          </p>
          <p className="fin-painel-ind-veredito">
            A fatura do cartão corporativo sai no nome do sócio. Contá-la como custo dele somaria cerca de{" "}
            {brlCents(Math.round(faturaCartaoCents / Math.max(1, dados.meses.length)))} por mês de pró-labore fictício e
            faria a pessoa mais cara da empresa ser a errada. O gasto existe — ele pertence às categorias das compras
            que compõem a fatura, não a uma pessoa.
          </p>
        </article>

        <article className={linksPropostos.some((l) => l.ehBanco) ? "fin-painel-ind tendencia-piorando" : "fin-painel-ind"}>
          <p className="fin-painel-ind-rotulo">Ligações propostas, não somadas</p>
          <p className="fin-painel-ind-valor">{linksPropostos.length}</p>
          <p className="fin-painel-ind-comp">
            {brlCents(linksPropostos.reduce((s, l) => s + l.saidaCents, 0))} de saída pendurada em ligações que ninguém
            confirmou
          </p>
          <p className="fin-painel-ind-veredito">
            Só ligação confirmada soma.{" "}
            {linksPropostos.some((l) => l.ehBanco)
              ? "E duas destas apontam para uma INSTITUIÇÃO, não para uma pessoa: o importador do Inter guardou o banco de destino no lugar do favorecido, e essas contrapartes carregam lançamentos de várias pessoas misturadas. Confirmar qualquer uma penduraria o custo de meio time numa pessoa só."
              : "Confirmar cada uma é decisão humana, porque uma ligação errada é permanente."}
          </p>
        </article>

        <article className={pessoasSemContraparte.length ? "fin-painel-ind tendencia-piorando" : "fin-painel-ind"}>
          <p className="fin-painel-ind-rotulo">Pessoas sem nenhuma contraparte</p>
          <p className="fin-painel-ind-valor">{pessoasSemContraparte.length}</p>
          <p className="fin-painel-ind-comp">
            {pessoasSemContraparte.map((p) => p.nome).join(", ") || "nenhuma"}
          </p>
          <p className="fin-painel-ind-veredito">
            Estas pessoas aparecem com R$ 0,00 nesta tela. Zero aqui pode significar duas coisas opostas — que ninguém
            lhes pagou nada, ou que o pagamento existe e o ledger não sabe ligar. A tela não distingue as duas, e por
            isso as nomeia.
          </p>
        </article>
      </div>

      {suspeitos.length ? (
        <div className="table-wrap">
          <table className="fin-table">
            <thead>
              <tr>
                <th>Provável favorecido</th>
                <th>Mês</th>
                <th>Conta</th>
                <th className="num">Lanç.</th>
                <th className="num">Valor fora do total</th>
                <th>Como aparece no extrato</th>
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
                <th colSpan={4}>Total fora do custo atribuído</th>
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
          <table className="fin-table">
            <thead>
              <tr>
                <th>Pessoa</th>
                <th>Contraparte proposta</th>
                <th>Método</th>
                <th className="num">Confiança</th>
                <th className="num">Lanç.</th>
                <th className="num">Saída na contraparte</th>
                {/* A decisão fica na MESMA linha do valor. Uma fila ordenada por
                    dinheiro em jogo que obrigasse a procurar a pessoa noutra
                    seção para decidir seria uma fila que ninguém esvazia. */}
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
                      <span
                        className="fin-badge-pendente"
                        title="É uma instituição financeira, não uma pessoa: carrega lançamentos de várias pessoas misturadas"
                      >
                        é banco, não pessoa
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
    </section>
  );
}

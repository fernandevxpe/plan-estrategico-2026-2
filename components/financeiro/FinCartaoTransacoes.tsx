"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { brlPrecise, dateLabel, monthLabel } from "@/lib/financeiro/format";
import { urlDaOrigem } from "@/lib/url-origem";
import type { PlasticoDoPainel, TransacaoDoPainel } from "@/lib/financeiro/contratos/cartao-painel";

/**
 * Todas as compras de cartão, cruzáveis.
 *
 * ---------------------------------------------------------------------------
 * O FILTRO É DO CLIENTE, INTEIRO
 * ---------------------------------------------------------------------------
 * As ~795 linhas chegam de uma vez pelo contrato. Filtrar no servidor
 * obrigaria uma ida ao banco por toque de filtro, num painel cuja graça é
 * justamente cruzar recortes rápido — "o que o final 4029 gastou em julho sem
 * núcleo" é uma pergunta que se faz mexendo em três seletores seguidos, e cada
 * mexida não pode custar uma volta de rede.
 *
 * ---------------------------------------------------------------------------
 * O TOTAL É DO QUE ESTÁ FILTRADO
 * ---------------------------------------------------------------------------
 * Quem cruza recortes quer o número do recorte, não o do acervo. O total soma
 * exatamente as linhas que o filtro deixou passar — não as da página — e a
 * contagem vem junto: R$ 12.400 pode ser uma compra ou quarenta, e isso muda
 * a conversa.
 *
 * ---------------------------------------------------------------------------
 * O QUE FALTA SE ANUNCIA
 * ---------------------------------------------------------------------------
 * `falta` vem do contrato e diz o que impede aquele gasto de estar explicado.
 * Linha incompleta ganha marca na lateral, e a célula vazia diz o que falta em
 * vez de mostrar um traço: traço se confunde com zero, e "não sei de que área
 * é" não é "área nenhuma". Estorno tem `falta` vazio de propósito — ele desfaz
 * uma compra que já carrega a classificação dela.
 */

export type CategoriaOpcao = { id: number; rotulo: string };
export type NucleoOpcao = { slug: string; nome: string };
export type CentroOpcao = { id: number; nome: string; ehProjeto: boolean };

type Campo = "data" | "valor" | "cartao" | "categoria";

/**
 * O valor do seletor para "este campo está vazio".
 *
 * Começa com espaço para nunca colidir com um id ou um slug real — "sem" é um
 * slug de núcleo plausível, " sem" não é.
 */
const SEM = " sem";

/** Ordenação alfabética: quem não tem rótulo vai para o fim, não para o começo. */
const FIM_DA_FILA = "\uffff";

type Filtros = {
  busca: string;
  cartao: string;
  emissor: string;
  categoria: string;
  nucleo: string;
  mes: string;
  status: string;
  soFalta: boolean;
};

const FILTROS_VAZIOS: Filtros = {
  busca: "",
  cartao: "",
  emissor: "",
  categoria: "",
  nucleo: "",
  mes: "",
  status: "",
  soFalta: false
};

const nomeDoPlastico = (t: { apelido: string | null; last4: string | null }) =>
  t.apelido ?? (t.last4 ? `Final ${t.last4}` : "Sem cartão");

const inicial = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);

/**
 * O emissor deste plástico não conta o que ele comprou.
 *
 * Gêmeo do helper de `FinCartaoPlasticos`, e pela mesma razão: 4 dos 15
 * plásticos (os três do Inter e o do Asaas) têm `compras = 0` e `totalCents = 0`
 * NÃO por estarem parados, mas porque a fonte nunca diz o que eles compraram —
 * é o que o campo `itemizacao` do contrato existe para avisar. A linha do Inter
 * gastou R$ 40.862,41 em 2026, tudo dentro do não itemizado.
 *
 * Sem isto, escolher "•••• 5585" no seletor devolvia "0 lançamentos · R$ 0,00" e
 * "Nenhum lançamento neste recorte" — três frases dizendo que o cartão não foi
 * usado. Zero e "não sei" nunca compartilham representação.
 *
 * A checagem exige os três sinais: um cartão que não itemiza mas que por algum
 * motivo tenha lançamento (importação manual, Asaas parcial) tem número de
 * verdade para mostrar, e escondê-lo atrás de "sem detalhamento" seria o erro
 * simétrico.
 */
function semExtratoDeItens(p: PlasticoDoPainel): boolean {
  return p.itemizacao !== "itens" && p.compras === 0 && p.totalCents === 0;
}

/** Por que a fonte não conta. O nome do emissor entra antes desta frase. */
const MOTIVO_SEM_EXTRATO: Record<string, string> = {
  somente_pagamento: "manda só o pagamento da fatura",
  somente_fatura: "manda o total da fatura, sem as compras"
};

export function FinCartaoTransacoes({
  transacoes,
  plasticos,
  categorias,
  nucleos,
  centros
}: {
  transacoes: TransacaoDoPainel[];
  plasticos: PlasticoDoPainel[];
  categorias: CategoriaOpcao[];
  nucleos: NucleoOpcao[];
  centros: CentroOpcao[];
}) {
  const router = useRouter();
  const [f, setF] = useState<Filtros>(FILTROS_VAZIOS);
  const [ordem, setOrdem] = useState<{ campo: Campo; dir: "asc" | "desc" }>({ campo: "data", dir: "desc" });
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(100);
  const [sel, setSel] = useState<Set<number>>(() => new Set());

  const [paraCardId, setParaCardId] = useState("");
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<string | null>(null);

  /** Qualquer mudança de filtro volta para a página 1 — senão o resultado some da vista. */
  const mudar = useCallback((patch: Partial<Filtros>) => {
    setF((atual) => ({ ...atual, ...patch }));
    setPagina(1);
  }, []);

  const mapaPlastico = useMemo(() => new Map(plasticos.map((p) => [p.cardId, p])), [plasticos]);
  const mapaCategoria = useMemo(() => new Map(categorias.map((c) => [c.id, c.rotulo])), [categorias]);
  const mapaNucleo = useMemo(() => new Map(nucleos.map((n) => [n.slug, n.nome])), [nucleos]);
  const mapaCentro = useMemo(() => new Map(centros.map((c) => [c.id, c])), [centros]);

  const rotuloCategoria = useCallback(
    (t: TransacaoDoPainel) =>
      t.categoria ?? (t.categoriaId === null ? null : mapaCategoria.get(t.categoriaId) ?? null),
    [mapaCategoria]
  );
  const rotuloNucleo = useCallback(
    (t: TransacaoDoPainel) => (t.nucleo ? mapaNucleo.get(t.nucleo) ?? inicial(t.nucleo) : null),
    [mapaNucleo]
  );
  const rotuloCentro = useCallback(
    (t: TransacaoDoPainel) => t.centro ?? (t.centroId === null ? null : mapaCentro.get(t.centroId)?.nome ?? null),
    [mapaCentro]
  );

  // As opções de categoria e núcleo vêm do que EXISTE nos lançamentos, não do
  // plano de contas inteiro: um seletor com 180 categorias das quais 12
  // aparecem no cartão esconde as 12 que importam. As listas completas
  // (`categorias`, `nucleos`, `centros`) servem para dar nome a um id que veio
  // sem rótulo — e é na área de qualificação que elas são a lista de escolha.
  const opcoes = useMemo(() => {
    const emissores = new Set<string>();
    const meses = new Set<string>();
    const cats = new Map<string, string>();
    const nucs = new Map<string, string>();
    let temSemCartao = false;
    for (const t of transacoes) {
      if (t.emissor) emissores.add(t.emissor);
      if (t.competencia) meses.add(t.competencia);
      if (t.categoriaId !== null) cats.set(String(t.categoriaId), rotuloCategoria(t) ?? `#${t.categoriaId}`);
      if (t.nucleo) nucs.set(t.nucleo, rotuloNucleo(t) ?? t.nucleo);
      if (t.cardId === null) temSemCartao = true;
    }
    return {
      emissores: [...emissores].sort((a, b) => a.localeCompare(b, "pt-BR")),
      meses: [...meses].sort().reverse(),
      categorias: [...cats.entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR")),
      nucleos: [...nucs.entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR")),
      temSemCartao
    };
  }, [transacoes, rotuloCategoria, rotuloNucleo]);

  const filtradas = useMemo(() => {
    const alvo = f.busca.trim().toLowerCase();
    const linhas = transacoes.filter((t) => {
      if (f.soFalta && t.falta.length === 0) return false;
      if (f.emissor && (t.emissor ?? "") !== f.emissor) return false;
      if (f.mes && t.competencia !== f.mes) return false;
      if (f.status && t.status !== f.status) return false;
      if (f.cartao && (f.cartao === SEM ? t.cardId !== null : String(t.cardId ?? "") !== f.cartao)) return false;
      if (
        f.categoria &&
        (f.categoria === SEM ? t.categoriaId !== null : String(t.categoriaId ?? "") !== f.categoria)
      ) {
        return false;
      }
      if (f.nucleo && (f.nucleo === SEM ? t.nucleo !== null : t.nucleo !== f.nucleo)) return false;
      if (!alvo) return true;
      return (
        t.descricao.toLowerCase().includes(alvo) ||
        (t.merchant ?? "").toLowerCase().includes(alvo) ||
        (t.last4 ?? "").includes(alvo) ||
        (t.apelido ?? "").toLowerCase().includes(alvo)
      );
    });

    const sinal = ordem.dir === "asc" ? 1 : -1;
    const chave = (t: TransacaoDoPainel): string | number => {
      if (ordem.campo === "valor") return t.valorCents;
      if (ordem.campo === "cartao") return nomeDoPlastico(t).toLowerCase();
      if (ordem.campo === "categoria") return (rotuloCategoria(t) ?? FIM_DA_FILA).toLowerCase();
      return `${t.postedOn}#${String(t.id).padStart(12, "0")}`;
    };
    return [...linhas].sort((a, b) => {
      const x = chave(a);
      const y = chave(b);
      if (typeof x === "number" && typeof y === "number") return (x - y) * sinal;
      return String(x).localeCompare(String(y), "pt-BR") * sinal;
    });
  }, [transacoes, f, ordem, rotuloCategoria]);

  const soma = useMemo(() => {
    let total = 0;
    let faltantes = 0;
    let faltantesCents = 0;
    for (const t of filtradas) {
      total += t.valorCents;
      if (t.falta.length) {
        faltantes += 1;
        faltantesCents += t.valorCents;
      }
    }
    return { total, faltantes, faltantesCents };
  }, [filtradas]);

  /**
   * O ESCOPO DO TOTAL, colado no total.
   *
   * Esta tabela é o único bloco da tela sem recorte de ano: ela soma 2025, 2026
   * e as parcelas já lançadas até 2027 — R$ 84.058,09 — a poucos centímetros do
   * KPI "no ano" (R$ 115.096) e da análise (R$ 62.421,09). Três números grandes
   * e diferentes sem rótulo nenhum fazem quem lê concluir que um deles está
   * errado, e aí a página inteira perde a confiança.
   *
   * O tempo não é a única diferença. Filtrar competência 07/2026 aqui dá
   * R$ 5.483,14 contra os R$ 12.292 do KPI do mesmo mês: recorte igual, 124% de
   * distância, porque a tabela lista LANÇAMENTOS e o que o emissor não detalha
   * não é lançamento nenhum. Por isso o rótulo diz as duas coisas — "só o
   * itemizado" e o período — em quatro palavras. O dono pediu menos texto de
   * ressalva; a resposta é rótulo, não parágrafo.
   */
  const escopo = useMemo(() => {
    let de = "";
    let ate = "";
    for (const t of filtradas) {
      if (!t.competencia) continue;
      if (!de || t.competencia < de) de = t.competencia;
      if (!ate || t.competencia > ate) ate = t.competencia;
    }
    if (!de) return "só o itemizado";
    const periodo = de === ate ? monthLabel(de) : `${monthLabel(de)} a ${monthLabel(ate)}`;
    return `só o itemizado · ${periodo}`;
  }, [filtradas]);

  /**
   * O plástico escolhido no filtro, quando ele é um dos que a fonte não detalha.
   * É o que troca o "nenhum lançamento" por uma explicação — ver
   * `semExtratoDeItens`.
   */
  const semExtrato = useMemo(() => {
    if (!f.cartao || f.cartao === SEM) return null;
    const p = mapaPlastico.get(Number(f.cartao));
    return p && semExtratoDeItens(p) ? p : null;
  }, [f.cartao, mapaPlastico]);

  const totalPaginas = porPagina === 0 ? 1 : Math.max(1, Math.ceil(filtradas.length / porPagina));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const visiveis =
    porPagina === 0 ? filtradas : filtradas.slice((paginaAtual - 1) * porPagina, paginaAtual * porPagina);

  const selecionadas = useMemo(() => transacoes.filter((t) => sel.has(t.id)), [transacoes, sel]);
  const valorSelecionado = selecionadas.reduce((s, t) => s + t.valorCents, 0);
  const noFiltro = filtradas.filter((t) => sel.has(t.id)).length;
  const todasDoFiltro = filtradas.length > 0 && noFiltro === filtradas.length;

  const alternar = (id: number) =>
    setSel((s) => {
      const proxima = new Set(s);
      if (proxima.has(id)) proxima.delete(id);
      else proxima.add(id);
      return proxima;
    });

  const alternarTodas = () =>
    setSel((s) => {
      const proxima = new Set(s);
      if (todasDoFiltro) for (const t of filtradas) proxima.delete(t.id);
      else for (const t of filtradas) proxima.add(t.id);
      return proxima;
    });

  // Só cartões da MESMA linha de crédito entram no seletor de destino. A rota
  // recusa o resto com 422 e explica o porquê; oferecer o impossível na tela
  // transformaria uma regra do modelo num erro de digitação da pessoa.
  const contasSelecionadas = useMemo(() => {
    const contas = new Set<number | null>();
    for (const t of selecionadas) {
      contas.add(t.cardId === null ? null : mapaPlastico.get(t.cardId)?.contaId ?? null);
    }
    return contas;
  }, [selecionadas, mapaPlastico]);

  const contaUnica = contasSelecionadas.size === 1 ? [...contasSelecionadas][0] : undefined;
  const destinos = useMemo(
    () =>
      contaUnica === undefined || contaUnica === null ? [] : plasticos.filter((p) => p.contaId === contaUnica),
    [contaUnica, plasticos]
  );

  const ordenar = (campo: Campo) =>
    setOrdem((o) =>
      o.campo === campo
        ? { campo, dir: o.dir === "asc" ? "desc" : "asc" }
        : { campo, dir: campo === "data" || campo === "valor" ? "desc" : "asc" }
    );

  const setaDe = (campo: Campo) => (ordem.campo !== campo ? "" : ordem.dir === "asc" ? "↑" : "↓");

  const ariaSort = (campo: Campo): "none" | "ascending" | "descending" =>
    ordem.campo !== campo ? "none" : ordem.dir === "asc" ? "ascending" : "descending";

  async function reatribuir() {
    const ids = selecionadas.map((t) => t.id);
    if (!ids.length || !paraCardId || motivo.trim().length < 5) return;
    setEnviando(true);
    setErro(null);
    setFeito(null);
    try {
      // A rota recusa lotes acima de 200. Quebrar aqui é melhor que mostrar
      // "divida" para quem acabou de marcar 300 linhas de propósito.
      let movidos = 0;
      let paraLast4 = "";
      for (let i = 0; i < ids.length; i += 200) {
        const r = await fetch(urlDaOrigem("/api/financeiro/cartao/reatribuir"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ids: ids.slice(i, i + 200),
            paraCardId: Number(paraCardId),
            motivo: motivo.trim()
          })
        });
        const corpo = await r.json();
        // A mensagem da rota já explica por que a linha de crédito trava o
        // movimento. Reescrevê-la aqui criaria duas versões da mesma regra.
        if (!r.ok) throw new Error(corpo?.erro ?? "falha ao reatribuir");
        movidos += Number(corpo.movidos ?? 0);
        paraLast4 = String(corpo.paraLast4 ?? paraLast4);
      }
      setFeito(`${movidos} lançamento(s) agora são do final ${paraLast4}.`);
      setSel(new Set());
      setMotivo("");
      setParaCardId("");
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "falha ao reatribuir");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="fin-card fin-cartao-tx">
      <div className="fin-card-head">
        <h2>Compras</h2>
        <span className="fin-cartao-tx-escopo">
          <span className="fin-card-total">{brlPrecise(soma.total)}</span>
          <small title="A tabela lista lançamento a lançamento. O gasto que o emissor não detalha não é lançamento e não entra neste total.">
            {escopo}
          </small>
        </span>
      </div>

      <div className="fin-cartao-tx-resumo" role="status">
        <span className="fin-cartao-tx-resumo-n">
          <b>{filtradas.length.toLocaleString("pt-BR")}</b> de {transacoes.length.toLocaleString("pt-BR")}{" "}
          lançamentos
        </span>
        {soma.faltantes > 0 ? (
          <button
            type="button"
            className="fin-cartao-tx-faltam"
            data-ligado={f.soFalta ? "sim" : undefined}
            aria-pressed={f.soFalta}
            onClick={() => mudar({ soFalta: !f.soFalta })}
          >
            <span className="fin-cartao-tx-faltam-marca" aria-hidden />
            <b>{soma.faltantes}</b> sem qualificar
            <span className="fin-cartao-tx-faltam-valor">{brlPrecise(soma.faltantesCents)}</span>
          </button>
        ) : (
          <span className="fin-cartao-tx-completo">tudo qualificado neste recorte</span>
        )}
      </div>

      <div className="fin-cartao-tx-filtros">
        <input
          type="search"
          className="fin-input fin-cartao-tx-busca"
          placeholder="Buscar na descrição, no comerciante ou no final…"
          value={f.busca}
          onChange={(e) => mudar({ busca: e.target.value })}
          aria-label="Buscar lançamento"
        />
        <label className="fin-field">
          <span className="fin-field-hint">cartão</span>
          <select className="fin-select" value={f.cartao} onChange={(e) => mudar({ cartao: e.target.value })}>
            <option value="">todos</option>
            {/* Os 4 plásticos sem extrato de itens CONTINUAM na lista, marcados.
                Tirá-los faria a pessoa procurar o final 5585 e não achar — e
                "sumiu" é uma resposta pior que "existe, mas o emissor não conta".
                Quem escolher um deles cai na explicação no lugar da tabela. */}
            {plasticos.map((p) => (
              <option key={p.cardId} value={String(p.cardId)}>
                {`${nomeDoPlastico(p)}${semExtratoDeItens(p) ? " · sem detalhamento" : ""}`}
              </option>
            ))}
            {opcoes.temSemCartao ? <option value={SEM}>sem cartão identificado</option> : null}
          </select>
        </label>
        <label className="fin-field">
          <span className="fin-field-hint">emissor</span>
          <select className="fin-select" value={f.emissor} onChange={(e) => mudar({ emissor: e.target.value })}>
            <option value="">todos</option>
            {opcoes.emissores.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </label>
        <label className="fin-field">
          <span className="fin-field-hint">categoria</span>
          <select className="fin-select" value={f.categoria} onChange={(e) => mudar({ categoria: e.target.value })}>
            <option value="">todas</option>
            <option value={SEM}>sem categoria</option>
            {opcoes.categorias.map(([id, rotulo]) => (
              <option key={id} value={id}>
                {rotulo}
              </option>
            ))}
          </select>
        </label>
        <label className="fin-field">
          <span className="fin-field-hint">núcleo</span>
          <select className="fin-select" value={f.nucleo} onChange={(e) => mudar({ nucleo: e.target.value })}>
            <option value="">todos</option>
            <option value={SEM}>sem núcleo</option>
            {opcoes.nucleos.map(([slug, nome]) => (
              <option key={slug} value={slug}>
                {nome}
              </option>
            ))}
          </select>
        </label>
        <label className="fin-field">
          <span className="fin-field-hint">competência</span>
          <select className="fin-select" value={f.mes} onChange={(e) => mudar({ mes: e.target.value })}>
            <option value="">todas</option>
            {opcoes.meses.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
        </label>
        <label className="fin-field">
          <span className="fin-field-hint">situação</span>
          <select className="fin-select" value={f.status} onChange={(e) => mudar({ status: e.target.value })}>
            <option value="">lançado e previsto</option>
            <option value="POSTED">só lançado</option>
            <option value="PENDING">só previsto</option>
          </select>
        </label>
        <button
          type="button"
          className="fin-cartao-tx-limpar"
          onClick={() => {
            setF(FILTROS_VAZIOS);
            setPagina(1);
          }}
        >
          limpar filtros
        </button>
      </div>

      {sel.size > 0 ? (
        <div className="fin-cartao-tx-acao">
          <div className="fin-cartao-tx-acao-quem">
            <strong>
              {sel.size} selecionado{sel.size > 1 ? "s" : ""}
            </strong>
            <span className="fin-cartao-tx-acao-valor">{brlPrecise(valorSelecionado)}</span>
            {noFiltro < sel.size ? (
              <span className="fin-cartao-tx-acao-fora">{sel.size - noFiltro} fora do filtro atual</span>
            ) : null}
            <button type="button" className="fin-cartao-tx-limpar" onClick={() => setSel(new Set())}>
              limpar seleção
            </button>
          </div>

          <div className="fin-cartao-tx-acao-form">
            <label className="fin-field">
              <span className="fin-field-hint">mover para</span>
              <select
                className="fin-select"
                value={paraCardId}
                onChange={(e) => setParaCardId(e.target.value)}
                disabled={!destinos.length}
              >
                <option value="">escolha o plástico…</option>
                {destinos.map((p) => (
                  <option key={p.cardId} value={String(p.cardId)}>
                    {nomeDoPlastico(p)} · final {p.last4}
                  </option>
                ))}
              </select>
            </label>
            <label className="fin-field fin-cartao-tx-motivo">
              <span className="fin-field-hint">por quê · mín. 5 letras</span>
              <input
                className="fin-input"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="plástico reemitido, compra do adicional…"
              />
            </label>
            <button
              type="button"
              className="fin-cartao-tx-mover"
              onClick={reatribuir}
              disabled={enviando || !paraCardId || motivo.trim().length < 5}
            >
              {enviando ? "movendo…" : "mover"}
            </button>
          </div>

          {!destinos.length ? (
            <p className="fin-cartao-tx-acao-nota">
              {contasSelecionadas.size > 1
                ? "A seleção mistura linhas de crédito — separe por emissor."
                : "Esta linha de crédito não tem outro plástico para onde mover."}
            </p>
          ) : null}
        </div>
      ) : null}

      {erro ? (
        <p className="fin-alert" role="alert">
          {erro}
        </p>
      ) : null}
      {feito ? <p className="fin-cartao-tx-feito">{feito}</p> : null}

      <div className="fin-cartao-tx-rolagem">
        <table className="fin-cartao-tx-tabela">
          <thead>
            <tr>
              <th scope="col" className="fin-cartao-tx-check">
                <input
                  type="checkbox"
                  checked={todasDoFiltro}
                  ref={(el) => {
                    if (el) el.indeterminate = noFiltro > 0 && !todasDoFiltro;
                  }}
                  onChange={alternarTodas}
                  aria-label="Selecionar tudo que está filtrado"
                />
              </th>
              <th scope="col" aria-sort={ariaSort("data")}>
                <button type="button" onClick={() => ordenar("data")}>
                  Data <span aria-hidden>{setaDe("data")}</span>
                </button>
              </th>
              <th scope="col">Descrição</th>
              <th scope="col" aria-sort={ariaSort("cartao")}>
                <button type="button" onClick={() => ordenar("cartao")}>
                  Cartão <span aria-hidden>{setaDe("cartao")}</span>
                </button>
              </th>
              <th scope="col" className="num" aria-sort={ariaSort("valor")}>
                <button type="button" onClick={() => ordenar("valor")}>
                  Valor <span aria-hidden>{setaDe("valor")}</span>
                </button>
              </th>
              <th scope="col" aria-sort={ariaSort("categoria")}>
                <button type="button" onClick={() => ordenar("categoria")}>
                  Categoria <span aria-hidden>{setaDe("categoria")}</span>
                </button>
              </th>
              <th scope="col">Núcleo</th>
              <th scope="col">Centro</th>
              <th scope="col" className="num">
                Parcela
              </th>
              <th scope="col">Situação</th>
            </tr>
          </thead>
          <tbody>
            {visiveis.map((t) => {
              const cat = rotuloCategoria(t);
              const nuc = rotuloNucleo(t);
              const cen = rotuloCentro(t);
              const marca = t.falta.length === 2 ? "ambos" : t.falta[0];
              return (
                <tr
                  key={t.id}
                  data-falta={marca}
                  data-selecionado={sel.has(t.id) ? "sim" : undefined}
                  data-estorno={t.kind === "estorno" ? "sim" : undefined}
                >
                  <td className="fin-cartao-tx-check">
                    <input
                      type="checkbox"
                      checked={sel.has(t.id)}
                      onChange={() => alternar(t.id)}
                      aria-label={`Selecionar ${t.descricao}`}
                    />
                  </td>
                  <td className="num fin-cartao-tx-data">
                    <span>{dateLabel(t.postedOn)}</span>
                    {t.competencia !== t.postedOn.slice(0, 7) ? (
                      <small>compet. {monthLabel(t.competencia)}</small>
                    ) : null}
                  </td>
                  <td className="fin-cartao-tx-desc">
                    <span className="fin-cartao-tx-titulo">{t.descricao}</span>
                    <small>
                      {[
                        t.merchant && t.merchant !== t.descricao ? t.merchant : null,
                        t.kind === "iof" ? "IOF" : t.kind === "estorno" ? "estorno" : null,
                        t.mcc ? `MCC ${t.mcc}` : null,
                        t.classificadoPor ? `por ${t.classificadoPor}` : null
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                  </td>
                  <td className="fin-cartao-tx-cartao">
                    <span>{nomeDoPlastico(t)}</span>
                    <small>{[t.emissor, t.last4 ? `final ${t.last4}` : null].filter(Boolean).join(" · ")}</small>
                  </td>
                  <td className="num fin-cartao-tx-valor">{brlPrecise(t.valorCents)}</td>
                  <td>
                    {cat ? (
                      <span className="fin-cartao-tx-tag">{cat}</span>
                    ) : t.falta.includes("categoria") ? (
                      <span className="fin-cartao-tx-lacuna">falta categoria</span>
                    ) : (
                      <span className="fin-cartao-tx-nao-cabe">não se aplica</span>
                    )}
                  </td>
                  <td>
                    {nuc ? (
                      <span className="fin-cartao-tx-tag">{nuc}</span>
                    ) : t.falta.includes("nucleo") ? (
                      <span className="fin-cartao-tx-lacuna">falta núcleo</span>
                    ) : (
                      <span className="fin-cartao-tx-nao-cabe">não se aplica</span>
                    )}
                  </td>
                  <td>
                    {cen ? (
                      <span className="fin-cartao-tx-tag">{cen}</span>
                    ) : (
                      <span className="fin-cartao-tx-opcional">não apontado</span>
                    )}
                  </td>
                  <td className="num">
                    {t.parcela && t.parcelasTotal ? (
                      <span className="fin-cartao-tx-parcela">
                        {t.parcela}/{t.parcelasTotal}
                      </span>
                    ) : (
                      <span className="fin-cartao-tx-opcional">à vista</span>
                    )}
                  </td>
                  <td>
                    <span className="fin-cartao-tx-status" data-status={t.status}>
                      {t.status === "POSTED" ? "lançado" : "previsto"}
                    </span>
                  </td>
                </tr>
              );
            })}
            {!visiveis.length ? (
              <tr>
                <td colSpan={10} className="fin-cartao-tx-nada">
                  {semExtrato ? (
                    <span className="fin-cartao-tx-sem-extrato">
                      <strong>sem detalhamento</strong>
                      {`${semExtrato.emissor ?? "A fonte deste plástico"} não detalha as compras deste cartão: ${
                        (semExtrato.itemizacao && MOTIVO_SEM_EXTRATO[semExtrato.itemizacao]) ??
                        "não entrega as compras"
                      }. O gasto dele está no não itemizado, na análise.`}
                    </span>
                  ) : (
                    "Nenhum lançamento neste recorte."
                  )}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="fin-cartao-tx-rodape">
        <label className="fin-field">
          <span className="fin-field-hint">por página</span>
          <select
            className="fin-select"
            value={porPagina}
            onChange={(e) => {
              setPorPagina(Number(e.target.value));
              setPagina(1);
            }}
          >
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={250}>250</option>
            <option value={0}>tudo</option>
          </select>
        </label>
        <div className="fin-cartao-tx-paginas">
          <button type="button" onClick={() => setPagina((p) => Math.max(1, p - 1))} disabled={paginaAtual <= 1}>
            anterior
          </button>
          <span>
            página {paginaAtual} de {totalPaginas}
          </span>
          <button
            type="button"
            onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
            disabled={paginaAtual >= totalPaginas}
          >
            próxima
          </button>
        </div>
        <span className="fin-cartao-tx-rodape-total">
          {filtradas.length.toLocaleString("pt-BR")} lançamentos · <b>{brlPrecise(soma.total)}</b> · {escopo}
        </span>
      </div>
    </section>
  );
}

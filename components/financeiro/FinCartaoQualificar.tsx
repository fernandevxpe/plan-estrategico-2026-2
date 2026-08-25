"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { brlPrecise, dateLabel } from "@/lib/financeiro/format";
import { urlDaOrigem } from "@/lib/url-origem";
import type { CartaoPainel, TransacaoDoPainel } from "@/lib/financeiro/contratos/cartao-painel";
import type { CategoriaOpcao, CentroOpcao, NucleoOpcao } from "./FinCartaoTransacoes";

/**
 * A área de qualificação: dizer o que é cada gasto, e ensinar a ferramenta.
 *
 * ---------------------------------------------------------------------------
 * A FILA É GRANDE, ENTÃO A UNIDADE DE TRABALHO É O FORNECEDOR
 * ---------------------------------------------------------------------------
 * São 234 lançamentos sem categoria e 461 sem núcleo. Decidir um a um é 695
 * decisões; decidir por fornecedor é algumas dezenas — treze lançamentos do
 * Facebook com sufixo aleatório ("Facebk *Va4u4frll2", "Facebk *F6lxhzyll2")
 * são o mesmo fornecedor e a mesma resposta.
 *
 * O agrupamento é por PREFIXO limpo da descrição, não por semelhança difusa:
 * juntar demais faria uma decisão errada valer por trinta linhas, e desfazer
 * isso custa mais que ter decidido separado. Por isso a chave usa no máximo as
 * duas primeiras palavras legíveis — "Auto Pecas Real" e "Auto Posto" ficam em
 * grupos diferentes, e o botão de agrupar pode ser desligado.
 *
 * ---------------------------------------------------------------------------
 * DUAS ORIGENS DE SUGESTÃO NÃO PODEM PARECER A MESMA COISA
 * ---------------------------------------------------------------------------
 * `origem: "aprendido"` é gente que já decidiu isso antes. `origem: "historico"`
 * é o que lançamentos parecidos já têm — inclusive por regra automática, que é
 * chute com autoridade. Elas chegam na mesma lista e saem na tela com peso
 * visual diferente, com o número de vezes e o texto que casou à vista: uma
 * sugestão que não se pode contestar vira aceitação cega.
 *
 * ---------------------------------------------------------------------------
 * O QUE SAI DA FILA É A LACUNA, NÃO O LANÇAMENTO
 * ---------------------------------------------------------------------------
 * Quem qualifica só a categoria de um item que também não tem núcleo resolveu
 * metade. O item continua na fila com a metade que falta — sumir com ele
 * esconderia trabalho que ninguém fez.
 */

type Alvo = "categoria" | "nucleo" | "centro";

type Sugestao = {
  origem: "aprendido" | "historico";
  alvo: string;
  categoriaId: number | null;
  nucleo: string | null;
  centroId: number | null;
  rotulo: string | null;
  vezes: number;
  similaridade: number;
  parecidoCom: string | null;
};

type Lacuna = "categoria" | "nucleo";

type Grupo = {
  chave: string;
  rotulo: string;
  variacoes: number;
  itens: TransacaoDoPainel[];
  valorCents: number;
  faltaCategoria: number;
  faltaNucleo: number;
  de: string;
  ate: string;
};

const ALVOS_BASE: Alvo[] = ["categoria", "nucleo"];

const SEM_SUGESTAO: Record<Alvo, Sugestao[]> = { categoria: [], nucleo: [], centro: [] };

/**
 * ONDE UM ATALHO DE UMA TECLA NÃO PODE ENTRAR.
 *
 * Os atalhos daqui escutam a JANELA inteira, então eles disputam o teclado com
 * a página toda. Enquanto a guarda isentava só INPUT/TEXTAREA/SELECT, apertar
 * ESPAÇO com o foco em qualquer botão — o chip da legenda do gráfico, o
 * "editar" de um cartão, o "tudo/nada", o seletor de eixo da análise — caía no
 * `preventDefault()` daqui e marcava um grupo desta fila EM VEZ de acionar o
 * botão. Espaço é o gesto padrão para acionar botão: quem navega por teclado
 * ficava sem conseguir acionar botão nenhum na tela inteira.
 *
 * A isenção vale para o resto pelo mesmo motivo. Num `role="tab"` ou num grupo
 * de rádio as setas são do widget; num `role="option"` as letras são busca por
 * digitação. Nada disso é a fila de qualificação.
 *
 * O teste é `closest()` e não o `tagName` do próprio nó: o alvo do evento
 * costuma ser o `<span>` de dentro do botão, e aí o `tagName` é SPAN.
 *
 * `a[href]` e não `a`: âncora sem destino não é acionável e pode envolver
 * texto grande — isentá-la calaria os atalhos em cima de conteúdo comum.
 */
const ACIONAVEL = [
  "input",
  "textarea",
  "select",
  "button",
  "a[href]",
  "summary",
  '[contenteditable]:not([contenteditable="false"])',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="option"]'
].join(", ");

/**
 * Onde a tecla é TEXTO sendo escrito.
 *
 * Subconjunto do de cima, e serve a outra pergunta: aqui o Esc significa "sair
 * do campo", não "limpar a seleção". Num botão o Esc não desfaz gesto nenhum do
 * navegador, então ele continua limpando a seleção de onde quer que se esteja.
 */
const ESCREVENDO = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

/**
 * A descrição suja vira chave de fornecedor.
 *
 * Tira acento, parcela ("1/3"), pontuação e os pedaços com dígito — que é onde
 * mora o sufixo aleatório do adquirente. Sobram as palavras que identificam
 * quem recebeu: "Facebk *Va4u4frll2" → "facebk"; "Mp *Aliexpress" →
 * "aliexpress" (o "mp" cai por ter menos de 3 letras, e é bom que caia: ele é
 * o gateway, não o fornecedor).
 */
function chaveFornecedor(descricao: string): string {
  const base = descricao
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b\d{1,2}\s*\/\s*\d{1,2}\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ");
  const tokens: string[] = [];
  for (const t of base.split(" ")) {
    if (t.length < 3 || /\d/.test(t)) continue;
    if (tokens.includes(t)) continue;
    tokens.push(t);
    if (tokens.length === 2) break;
  }
  return tokens.join(" ") || base.trim() || "sem descrição";
}

const inicial = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);

export function FinCartaoQualificar({
  transacoes,
  categorias,
  nucleos,
  centros,
  aQualificar
}: {
  transacoes: TransacaoDoPainel[];
  categorias: CategoriaOpcao[];
  nucleos: NucleoOpcao[];
  centros: CentroOpcao[];
  aQualificar: CartaoPainel["aQualificar"];
}) {
  const router = useRouter();

  // O que esta sessão já resolveu, por lacuna. Enquanto o Server Component não
  // volta do `router.refresh()`, é isto que tira a linha da fila — e tira só a
  // metade resolvida.
  const [feitoLocal, setFeitoLocal] = useState<Record<number, Partial<Record<Lacuna, boolean>>>>({});
  const [sessao, setSessao] = useState({ itens: 0, cents: 0 });

  const [busca, setBusca] = useState("");
  const [soLacuna, setSoLacuna] = useState<"" | Lacuna>("");
  const [ordem, setOrdem] = useState<"valor" | "recente" | "itens">("valor");
  const [agrupar, setAgrupar] = useState(true);
  const [expandido, setExpandido] = useState<Set<string>>(() => new Set());
  const [foco, setFoco] = useState(0);

  const [sel, setSel] = useState<Set<number>>(() => new Set());

  const [texto, setTexto] = useState("");
  const [textoTocado, setTextoTocado] = useState(false);
  const [debounced, setDebounced] = useState("");
  const [sugestoes, setSugestoes] = useState<Record<Alvo, Sugestao[]>>(SEM_SUGESTAO);
  const [buscando, setBuscando] = useState(false);

  const [comCentro, setComCentro] = useState(false);
  const [laneFoco, setLaneFoco] = useState<Alvo>("categoria");
  const [escolhaCategoria, setEscolhaCategoria] = useState<number | null>(null);
  const [escolhaNucleo, setEscolhaNucleo] = useState<string | null>(null);
  const [escolhaCentro, setEscolhaCentro] = useState<number | null>(null);
  const [aprender, setAprender] = useState(true);

  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [recado, setRecado] = useState<string | null>(null);

  const campoRef = useRef<HTMLInputElement | null>(null);

  const mapaCategoria = useMemo(() => new Map(categorias.map((c) => [c.id, c.rotulo])), [categorias]);
  const mapaNucleo = useMemo(() => new Map(nucleos.map((n) => [n.slug, n.nome])), [nucleos]);
  const mapaCentro = useMemo(() => new Map(centros.map((c) => [c.id, c.nome])), [centros]);

  const faltaAtual = useCallback(
    (t: TransacaoDoPainel): Lacuna[] => t.falta.filter((k) => !feitoLocal[t.id]?.[k]),
    [feitoLocal]
  );

  const grupos = useMemo<Grupo[]>(() => {
    const alvo = busca.trim().toLowerCase();
    const mapa = new Map<string, Grupo>();

    for (const t of transacoes) {
      const falta = faltaAtual(t);
      if (!falta.length) continue;
      if (soLacuna && !falta.includes(soLacuna)) continue;
      if (alvo && !t.descricao.toLowerCase().includes(alvo) && !(t.merchant ?? "").toLowerCase().includes(alvo)) {
        continue;
      }
      const chave = agrupar ? chaveFornecedor(t.descricao) : `#${t.id}`;
      const atual = mapa.get(chave);
      if (atual) {
        atual.itens.push(t);
        atual.valorCents += t.valorCents;
        if (falta.includes("categoria")) atual.faltaCategoria += 1;
        if (falta.includes("nucleo")) atual.faltaNucleo += 1;
        if (t.postedOn < atual.de) atual.de = t.postedOn;
        if (t.postedOn > atual.ate) atual.ate = t.postedOn;
        if (t.descricao.length < atual.rotulo.length) atual.rotulo = t.descricao;
      } else {
        mapa.set(chave, {
          chave,
          rotulo: t.descricao,
          variacoes: 0,
          itens: [t],
          valorCents: t.valorCents,
          faltaCategoria: falta.includes("categoria") ? 1 : 0,
          faltaNucleo: falta.includes("nucleo") ? 1 : 0,
          de: t.postedOn,
          ate: t.postedOn
        });
      }
    }

    const lista = [...mapa.values()];
    for (const g of lista) g.variacoes = new Set(g.itens.map((i) => i.descricao)).size;

    lista.sort((a, b) => {
      if (ordem === "itens") return b.itens.length - a.itens.length || b.valorCents - a.valorCents;
      if (ordem === "recente") return b.ate.localeCompare(a.ate) || b.valorCents - a.valorCents;
      // Valor primeiro: zerar R$ 49.703,98 de núcleo é o objetivo, e as
      // decisões grandes pagam mais por minuto de atenção.
      return b.valorCents - a.valorCents;
    });
    return lista;
  }, [transacoes, faltaAtual, busca, soLacuna, agrupar, ordem]);

  const restante = useMemo(() => {
    let itens = 0;
    let cents = 0;
    for (const g of grupos) {
      itens += g.itens.length;
      cents += g.valorCents;
    }
    return { itens, cents, grupos: grupos.length };
  }, [grupos]);

  const selecionadas = useMemo(() => transacoes.filter((t) => sel.has(t.id)), [transacoes, sel]);
  const valorSelecionado = selecionadas.reduce((s, t) => s + t.valorCents, 0);

  const focoSeguro = grupos.length ? Math.min(foco, grupos.length - 1) : 0;

  // ---------------------------------------------------------------------------
  // A busca por proximidade. Um texto, os alvos abertos — e o `alvo=centro` só
  // sai quando alguém abre essa faixa: hoje nenhum lançamento tem centro, então
  // pedir a terceira busca em toda tecla seria gastar rede por lista vazia.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const t = setTimeout(() => setDebounced(texto.trim()), 300);
    return () => clearTimeout(t);
  }, [texto]);

  useEffect(() => {
    if (debounced.length < 3) {
      setSugestoes(SEM_SUGESTAO);
      setBuscando(false);
      return;
    }
    const alvos: Alvo[] = comCentro ? [...ALVOS_BASE, "centro"] : ALVOS_BASE;
    let vivo = true;
    setBuscando(true);
    Promise.all(
      alvos.map(async (a) => {
        const r = await fetch(
          urlDaOrigem(`/api/financeiro/cartao/sugerir?texto=${encodeURIComponent(debounced)}&alvo=${a}`)
        );
        const corpo = await r.json();
        if (!r.ok) throw new Error(corpo?.erro ?? "falha ao buscar sugestões");
        return [a, (corpo.sugestoes ?? []) as Sugestao[]] as const;
      })
    )
      .then((pares) => {
        if (!vivo) return;
        const proximas: Record<Alvo, Sugestao[]> = { categoria: [], nucleo: [], centro: [] };
        for (const [a, s] of pares) proximas[a] = s;
        setSugestoes(proximas);
      })
      .catch((e) => {
        if (vivo) setErro(e instanceof Error ? e.message : "falha ao buscar sugestões");
      })
      .finally(() => {
        if (vivo) setBuscando(false);
      });
    return () => {
      vivo = false;
    };
  }, [debounced, comCentro]);

  const marcarGrupo = useCallback((g: Grupo, ligar: boolean) => {
    setSel((s) => {
      const proxima = new Set(s);
      for (const i of g.itens) {
        if (ligar) proxima.add(i.id);
        else proxima.delete(i.id);
      }
      return proxima;
    });
    // Escrever "facebk" para depois procurar "facebook" é trabalho repetido —
    // o texto do fornecedor já está na descrição. Quem digitar por cima manda.
    if (ligar) {
      setTexto((atual) => (textoTocado || atual ? atual : g.chave));
    }
  }, [textoTocado]);

  const alternarItem = (id: number) =>
    setSel((s) => {
      const proxima = new Set(s);
      if (proxima.has(id)) proxima.delete(id);
      else proxima.add(id);
      return proxima;
    });

  const aplicarSugestao = useCallback((s: Sugestao) => {
    if (s.alvo === "categoria" && s.categoriaId !== null) setEscolhaCategoria(s.categoriaId);
    else if (s.alvo === "nucleo" && s.nucleo) setEscolhaNucleo(s.nucleo);
    else if (s.alvo === "centro" && s.centroId !== null) setEscolhaCentro(s.centroId);
  }, []);

  const temAlvo = escolhaCategoria !== null || escolhaNucleo !== null || escolhaCentro !== null;
  const podeSalvar = sel.size > 0 && temAlvo && !salvando;

  const salvar = useCallback(async () => {
    const ids = selecionadas.map((t) => t.id);
    if (!ids.length || !temAlvo) return;
    setSalvando(true);
    setErro(null);
    setRecado(null);
    try {
      let atualizados = 0;
      let padroes = 0;
      // A rota recusa lotes acima de 500 — quebrar aqui evita que "marquei o
      // fornecedor inteiro" vire um erro de tamanho.
      for (let i = 0; i < ids.length; i += 500) {
        const corpoEnvio: Record<string, unknown> = { ids: ids.slice(i, i + 500), aprender };
        if (escolhaCategoria !== null) corpoEnvio.categoriaId = escolhaCategoria;
        if (escolhaNucleo !== null) corpoEnvio.nucleo = escolhaNucleo;
        if (escolhaCentro !== null) corpoEnvio.centroId = escolhaCentro;
        const r = await fetch(urlDaOrigem("/api/financeiro/cartao/qualificar"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(corpoEnvio)
        });
        const corpo = await r.json();
        if (!r.ok) throw new Error(corpo?.erro ?? "falha ao qualificar");
        atualizados += Number(corpo.atualizados ?? 0);
        padroes += Number(corpo.padroes ?? 0);
      }

      const marcas: Partial<Record<Lacuna, boolean>> = {};
      if (escolhaCategoria !== null) marcas.categoria = true;
      if (escolhaNucleo !== null) marcas.nucleo = true;

      // A contagem sai ANTES do `setState`: um atualizador que soma numa
      // variável de fora é chamado duas vezes em desenvolvimento e o placar da
      // sessão passaria a mostrar o dobro do trabalho feito.
      let zerados = 0;
      let zeradosCents = 0;
      for (const t of selecionadas) {
        const antes = faltaAtual(t);
        if (antes.length && !antes.some((k) => !marcas[k])) {
          zerados += 1;
          zeradosCents += t.valorCents;
        }
      }

      setFeitoLocal((atual) => {
        const proximo = { ...atual };
        for (const t of selecionadas) proximo[t.id] = { ...proximo[t.id], ...marcas };
        return proximo;
      });
      setSessao((s) => ({ itens: s.itens + zerados, cents: s.cents + zeradosCents }));

      setRecado(
        `${atualizados} lançamento(s) qualificados${aprender ? ` · ${padroes} padrão(ões) guardados` : ""}.`
      );
      setSel(new Set());
      setEscolhaCategoria(null);
      setEscolhaNucleo(null);
      setEscolhaCentro(null);
      setTexto("");
      setTextoTocado(false);
      // Cada decisão vira histórico: a próxima busca por proximidade já nasce
      // melhor, e o placar do servidor recalcula.
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "falha ao qualificar");
    } finally {
      setSalvando(false);
    }
  }, [selecionadas, temAlvo, aprender, escolhaCategoria, escolhaNucleo, escolhaCentro, faltaAtual, router]);

  // ---------------------------------------------------------------------------
  // Teclado. 695 decisões com o mouse é uma tarde; com j/k/x/1/⌘⏎ é uma hora.
  // ---------------------------------------------------------------------------
  const teclaRef = useRef<(e: KeyboardEvent) => void>(() => {});

  useEffect(() => {
    teclaRef.current = (e: KeyboardEvent) => {
      // `Element` e não `HTMLElement`: o alvo pode ser um nó de dentro de um
      // <svg> (o gráfico lá em cima), e ali o `closest()` continua sendo o
      // teste certo. Só o `blur()` precisa mesmo de um HTMLElement.
      const nodo = e.target instanceof Element ? e.target : null;
      const alvo = nodo instanceof HTMLElement ? nodo : null;
      const digitando = !!nodo?.closest(ESCREVENDO);
      // Qualquer coisa acionável — não só campo de texto. Ver `ACIONAVEL`.
      const noWidget = !!nodo?.closest(ACIONAVEL);

      // ⌘⏎ e Esc seguem globais de propósito: nenhum dos dois é gesto de
      // acionar widget, e "aplicar" e "limpar" precisam funcionar de onde a
      // pessoa estiver — inclusive com o foco dentro do campo de texto.
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        if (podeSalvar) void salvar();
        return;
      }
      if (e.key === "Escape") {
        if (digitando) alvo?.blur();
        else setSel(new Set());
        return;
      }
      if (noWidget || e.altKey || e.metaKey || e.ctrlKey) return;

      const g = grupos[focoSeguro];
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setFoco((f) => Math.min(grupos.length - 1, f + 1));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setFoco((f) => Math.max(0, f - 1));
      } else if ((e.key === "x" || e.key === " ") && g) {
        e.preventDefault();
        marcarGrupo(g, !g.itens.every((i) => sel.has(i.id)));
      } else if (e.key === "e" && g) {
        e.preventDefault();
        setExpandido((s) => {
          const proxima = new Set(s);
          if (proxima.has(g.chave)) proxima.delete(g.chave);
          else proxima.add(g.chave);
          return proxima;
        });
      } else if (e.key === "/") {
        e.preventDefault();
        campoRef.current?.focus();
      } else if (e.key === "c") {
        setLaneFoco("categoria");
      } else if (e.key === "n") {
        setLaneFoco("nucleo");
      } else if (e.key === "p") {
        setComCentro(true);
        setLaneFoco("centro");
      } else if (/^[1-9]$/.test(e.key)) {
        const escolhida = sugestoes[laneFoco][Number(e.key) - 1];
        if (escolhida) {
          e.preventDefault();
          aplicarSugestao(escolhida);
        }
      }
    };
  });

  useEffect(() => {
    const h = (e: KeyboardEvent) => teclaRef.current(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  useEffect(() => {
    const el = document.querySelector<HTMLElement>(".fin-cartao-qual-grupo[data-foco='sim']");
    el?.scrollIntoView({ block: "nearest" });
  }, [focoSeguro]);

  const rotuloDaEscolha = (alvo: Alvo): string | null => {
    if (alvo === "categoria") return escolhaCategoria === null ? null : mapaCategoria.get(escolhaCategoria) ?? `#${escolhaCategoria}`;
    if (alvo === "nucleo") return escolhaNucleo === null ? null : mapaNucleo.get(escolhaNucleo) ?? inicial(escolhaNucleo);
    return escolhaCentro === null ? null : mapaCentro.get(escolhaCentro) ?? `#${escolhaCentro}`;
  };

  const limparEscolha = (alvo: Alvo) => {
    if (alvo === "categoria") setEscolhaCategoria(null);
    else if (alvo === "nucleo") setEscolhaNucleo(null);
    else setEscolhaCentro(null);
  };

  const TITULO: Record<Alvo, string> = {
    categoria: "Categoria",
    nucleo: "Núcleo",
    centro: "Projeto ou centro de custo"
  };

  function faixa(alvo: Alvo) {
    const lista = sugestoes[alvo];
    const escolhido = rotuloDaEscolha(alvo);
    const atalho = alvo === "categoria" ? "c" : alvo === "nucleo" ? "n" : "p";
    return (
      <section
        className="fin-cartao-qual-faixa"
        data-alvo={alvo}
        data-foco={laneFoco === alvo ? "sim" : undefined}
        onFocus={() => setLaneFoco(alvo)}
        onMouseEnter={() => setLaneFoco(alvo)}
      >
        <header>
          <h4>{TITULO[alvo]}</h4>
          <kbd>{atalho}</kbd>
          {alvo === "centro" ? <span className="fin-cartao-qual-opcional">só se for necessário</span> : null}
        </header>

        {escolhido ? (
          <p className="fin-cartao-qual-escolhido">
            <span>{escolhido}</span>
            <button type="button" onClick={() => limparEscolha(alvo)} aria-label={`Tirar ${escolhido}`}>
              ×
            </button>
          </p>
        ) : null}

        {debounced.length >= 3 ? (
          lista.length ? (
            <ul className="fin-cartao-qual-sugestoes">
              {lista.map((s, i) => (
                <li key={`${s.origem}-${s.alvo}-${s.rotulo}-${i}`}>
                  <button
                    type="button"
                    className="fin-cartao-qual-sug"
                    data-origem={s.origem}
                    onClick={() => aplicarSugestao(s)}
                  >
                    <span className="fin-cartao-qual-sug-num">{i + 1}</span>
                    <span className="fin-cartao-qual-sug-corpo">
                      <strong>{s.rotulo ?? "sem rótulo"}</strong>
                      <span className="fin-cartao-qual-sug-origem">
                        {s.origem === "aprendido"
                          ? `decidido por gente · ${s.vezes}×`
                          : `visto em lançamentos · ${s.vezes}×`}
                      </span>
                      {s.parecidoCom ? (
                        <span className="fin-cartao-qual-sug-parecido">parecido com “{s.parecidoCom}”</span>
                      ) : null}
                    </span>
                    <span className="fin-cartao-qual-sug-sim" title="semelhança com o que você escreveu">
                      <i style={{ width: `${Math.round(Math.max(0, Math.min(1, s.similaridade)) * 100)}%` }} />
                      <b>{Math.round(s.similaridade * 100)}%</b>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="fin-cartao-qual-sem-sugestao">
              {buscando ? "procurando…" : "nada parecido — escolha da lista e a próxima busca já saberá"}
            </p>
          )
        ) : null}

        <label className="fin-field fin-cartao-qual-lista">
          <span className="fin-field-hint">da lista completa</span>
          {alvo === "categoria" ? (
            <select
              className="fin-select"
              value={escolhaCategoria === null ? "" : String(escolhaCategoria)}
              onChange={(e) => setEscolhaCategoria(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">escolher…</option>
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.rotulo}
                </option>
              ))}
            </select>
          ) : alvo === "nucleo" ? (
            <select
              className="fin-select"
              value={escolhaNucleo ?? ""}
              onChange={(e) => setEscolhaNucleo(e.target.value || null)}
            >
              <option value="">escolher…</option>
              {nucleos.map((n) => (
                <option key={n.slug} value={n.slug}>
                  {n.nome}
                </option>
              ))}
            </select>
          ) : (
            <select
              className="fin-select"
              value={escolhaCentro === null ? "" : String(escolhaCentro)}
              onChange={(e) => setEscolhaCentro(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">escolher…</option>
              <optgroup label="Projetos">
                {centros
                  .filter((c) => c.ehProjeto)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
              </optgroup>
              <optgroup label="Centros de custo">
                {centros
                  .filter((c) => !c.ehProjeto)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
              </optgroup>
            </select>
          )}
        </label>
      </section>
    );
  }

  return (
    <section className="fin-card fin-cartao-qual">
      <div className="fin-card-head">
        <h2>Qualificar</h2>
        <span className="fin-card-total">{brlPrecise(restante.cents)}</span>
      </div>

      <div className="fin-cartao-qual-placar">
        <article className="fin-cartao-qual-tile" data-lacuna="categoria">
          <span className="fin-cartao-qual-tile-rotulo">Sem categoria</span>
          <strong>{aQualificar.semCategoria.itens.toLocaleString("pt-BR")}</strong>
          <span className="fin-cartao-qual-tile-valor">{brlPrecise(aQualificar.semCategoria.valorCents)}</span>
        </article>
        <article className="fin-cartao-qual-tile" data-lacuna="nucleo">
          <span className="fin-cartao-qual-tile-rotulo">Sem núcleo</span>
          <strong>{aQualificar.semNucleo.itens.toLocaleString("pt-BR")}</strong>
          <span className="fin-cartao-qual-tile-valor">{brlPrecise(aQualificar.semNucleo.valorCents)}</span>
        </article>
        <article className="fin-cartao-qual-tile" data-lacuna="feito">
          <span className="fin-cartao-qual-tile-rotulo">Fechado nesta sessão</span>
          <strong>{sessao.itens.toLocaleString("pt-BR")}</strong>
          <span className="fin-cartao-qual-tile-valor">{brlPrecise(sessao.cents)}</span>
        </article>
      </div>

      {erro ? (
        <p className="fin-alert" role="alert">
          {erro}
        </p>
      ) : null}
      {recado ? <p className="fin-cartao-qual-recado">{recado}</p> : null}

      <div className="fin-cartao-qual-corpo">
        <div className="fin-cartao-qual-fila">
          <div className="fin-cartao-qual-filtros">
            <input
              type="search"
              className="fin-input"
              placeholder="Filtrar a fila…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              aria-label="Filtrar a fila"
            />
            <label className="fin-field">
              <span className="fin-field-hint">o que falta</span>
              <select
                className="fin-select"
                value={soLacuna}
                onChange={(e) => setSoLacuna(e.target.value as "" | Lacuna)}
              >
                <option value="">categoria ou núcleo</option>
                <option value="categoria">só falta categoria</option>
                <option value="nucleo">só falta núcleo</option>
              </select>
            </label>
            <label className="fin-field">
              <span className="fin-field-hint">ordem</span>
              <select
                className="fin-select"
                value={ordem}
                onChange={(e) => setOrdem(e.target.value as "valor" | "recente" | "itens")}
              >
                <option value="valor">maior valor</option>
                <option value="itens">mais lançamentos</option>
                <option value="recente">mais recente</option>
              </select>
            </label>
            <label className="fin-check">
              <input type="checkbox" checked={agrupar} onChange={(e) => setAgrupar(e.target.checked)} />
              agrupar parecidos
            </label>
          </div>

          <p className="fin-cartao-qual-restante">
            <b>{restante.itens.toLocaleString("pt-BR")}</b> lançamentos em{" "}
            <b>{restante.grupos.toLocaleString("pt-BR")}</b> {agrupar ? "fornecedores" : "linhas"} ·{" "}
            {brlPrecise(restante.cents)}
          </p>

          <ul className="fin-cartao-qual-grupos">
            {grupos.map((g, idx) => {
              const marcados = g.itens.filter((i) => sel.has(i.id)).length;
              const todos = marcados === g.itens.length;
              const aberto = expandido.has(g.chave);
              return (
                <li
                  key={g.chave}
                  className="fin-cartao-qual-grupo"
                  data-foco={idx === focoSeguro ? "sim" : undefined}
                  data-marcado={marcados > 0 ? "sim" : undefined}
                  onMouseEnter={() => setFoco(idx)}
                >
                  <div className="fin-cartao-qual-grupo-cabeca">
                    <input
                      type="checkbox"
                      checked={todos}
                      ref={(el) => {
                        if (el) el.indeterminate = marcados > 0 && !todos;
                      }}
                      onChange={() => marcarGrupo(g, !todos)}
                      aria-label={`Selecionar ${g.itens.length} de ${g.rotulo}`}
                    />
                    <button
                      type="button"
                      className="fin-cartao-qual-grupo-nome"
                      onClick={() =>
                        setExpandido((s) => {
                          const proxima = new Set(s);
                          if (proxima.has(g.chave)) proxima.delete(g.chave);
                          else proxima.add(g.chave);
                          return proxima;
                        })
                      }
                      aria-expanded={aberto}
                    >
                      <strong>{g.rotulo}</strong>
                      <small>
                        {g.itens.length} {g.itens.length === 1 ? "lançamento" : "lançamentos"}
                        {g.variacoes > 1 ? ` · ${g.variacoes} descrições` : ""} ·{" "}
                        {g.de === g.ate ? dateLabel(g.de) : `${dateLabel(g.de)} a ${dateLabel(g.ate)}`}
                      </small>
                    </button>

                    <span className="fin-cartao-qual-grupo-falta">
                      {g.faltaCategoria ? (
                        <em data-lacuna="categoria">
                          categoria{g.itens.length > 1 ? ` ×${g.faltaCategoria}` : ""}
                        </em>
                      ) : null}
                      {g.faltaNucleo ? (
                        <em data-lacuna="nucleo">núcleo{g.itens.length > 1 ? ` ×${g.faltaNucleo}` : ""}</em>
                      ) : null}
                    </span>

                    <span className="fin-cartao-qual-grupo-valor">{brlPrecise(g.valorCents)}</span>

                    {g.itens.length > 1 && !todos ? (
                      <button
                        type="button"
                        className="fin-cartao-qual-todos"
                        onClick={() => marcarGrupo(g, true)}
                      >
                        os {g.itens.length}
                      </button>
                    ) : null}
                  </div>

                  {aberto ? (
                    <ul className="fin-cartao-qual-itens">
                      {g.itens.map((i) => {
                        const falta = faltaAtual(i);
                        return (
                          <li key={i.id}>
                            <label>
                              <input
                                type="checkbox"
                                checked={sel.has(i.id)}
                                onChange={() => alternarItem(i.id)}
                              />
                              <span className="fin-cartao-qual-item-data">{dateLabel(i.postedOn)}</span>
                              <span className="fin-cartao-qual-item-desc">
                                {i.descricao}
                                {i.parcela && i.parcelasTotal ? (
                                  <em>
                                    {" "}
                                    {i.parcela}/{i.parcelasTotal}
                                  </em>
                                ) : null}
                              </span>
                              <span className="fin-cartao-qual-item-cartao">
                                {i.apelido ?? (i.last4 ? `final ${i.last4}` : "sem cartão")}
                              </span>
                              <span className="fin-cartao-qual-item-falta">
                                {falta.map((k) => (
                                  <em key={k} data-lacuna={k}>
                                    {k === "categoria" ? "categoria" : "núcleo"}
                                  </em>
                                ))}
                              </span>
                              <span className="fin-cartao-qual-item-valor">{brlPrecise(i.valorCents)}</span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </li>
              );
            })}
            {!grupos.length ? (
              <li className="fin-cartao-qual-vazia">
                {busca || soLacuna ? "Nada neste recorte da fila." : "A fila está zerada."}
              </li>
            ) : null}
          </ul>
        </div>

        <aside className="fin-cartao-qual-painel">
          <header className="fin-cartao-qual-painel-topo">
            <strong>
              {sel.size ? `${sel.size} selecionado${sel.size > 1 ? "s" : ""}` : "Nada selecionado"}
            </strong>
            <span>{sel.size ? brlPrecise(valorSelecionado) : "marque na fila ao lado"}</span>
          </header>

          <label className="fin-field fin-cartao-qual-campo">
            <span className="fin-field-hint">escreva a qualificação</span>
            <input
              ref={campoRef}
              className="fin-input"
              value={texto}
              placeholder="facebook, mercado livre, posto…"
              onChange={(e) => {
                setTexto(e.target.value);
                setTextoTocado(true);
              }}
            />
          </label>

          {faixa("categoria")}
          {faixa("nucleo")}
          {comCentro ? (
            faixa("centro")
          ) : (
            <button type="button" className="fin-cartao-qual-abrir-centro" onClick={() => setComCentro(true)}>
              apontar projeto ou centro de custo
            </button>
          )}

          <label className="fin-check fin-cartao-qual-aprender">
            <input type="checkbox" checked={aprender} onChange={(e) => setAprender(e.target.checked)} />
            guardar o padrão
          </label>
          <p className="fin-cartao-qual-aprender-nota">
            A descrição de cada lançamento vira busca para a próxima vez.
          </p>

          <button type="button" className="fin-cartao-qual-salvar" onClick={salvar} disabled={!podeSalvar}>
            {salvando ? "salvando…" : sel.size ? `aplicar a ${sel.size}` : "aplicar"}
          </button>

          <p className="fin-cartao-qual-atalhos">
            <kbd>j</kbd>
            <kbd>k</kbd> andar · <kbd>x</kbd> marcar · <kbd>e</kbd> abrir · <kbd>/</kbd> escrever ·{" "}
            <kbd>c</kbd>
            <kbd>n</kbd>
            <kbd>p</kbd> alvo · <kbd>1</kbd>–<kbd>9</kbd> sugestão · <kbd>⌘⏎</kbd> aplicar · <kbd>esc</kbd>{" "}
            limpar
          </p>
        </aside>
      </div>
    </section>
  );
}

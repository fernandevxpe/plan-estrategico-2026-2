"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

import { Medida, Ressalva, SeloCamada, brl, type Camada } from "@/components/financeiro/Certeza";
import { FinPlanoContas } from "@/components/financeiro/FinPlanoContas";
import { dateLabel } from "@/lib/financeiro/format";
import type { Contrato } from "@/lib/financeiro/contratos/base";
import type { PropostaRegra, ResultadoLote } from "@/lib/financeiro/categorizacao";
import type {
  BuscaCategorizacao,
  CampoOrdenacaoBusca,
  CategoriaPlano,
  EstadoCategorizacao,
  ItemCategorizavel,
  ProcedenciaFamilia,
  ResumoUniverso,
  Universo
} from "@/lib/financeiro/contratos/categorizacao";

/**
 * A central de categorização.
 *
 * ===========================================================================
 * POR QUE ESTA TELA EXISTE — o número que a justifica
 * ===========================================================================
 * O painel mede `fin_transaction` e está certo: é o que o nome dele diz. O
 * efeito colateral é que **889 itens não aparecem em indicador nenhum** — 389
 * documentos (R$ 259.432,76) e 500 itens de cartão (R$ 54.126,76). Não estão
 * errados; estão fora da régua. `fin_categorizavel_v` é a primeira régua que
 * atravessa os três universos, e esta tela é a mão que a usa.
 *
 * ===========================================================================
 * O UNIVERSO APARECE EM TODA LINHA, E ISSO NÃO É DECORAÇÃO
 * ===========================================================================
 * As consequências diferem: classificar um LANÇAMENTO mexe na DRE pelo caixa;
 * classificar um DOCUMENTO mexe pela competência e o lançamento liquidado pode
 * herdar; classificar um ITEM DE CARTÃO mexe num subledger que o painel não
 * lê. Uma tela que mistura os três sem dizer qual é qual convida a pessoa a
 * decidir com a régua errada.
 *
 * ===========================================================================
 * NÃO EXISTE "RECLASSIFICAR TODOS OS RESULTADOS DA BUSCA". DE PROPÓSITO
 * ===========================================================================
 * A dúvida 0 está aberta: 205 linhas migrariam de `6.02 Pró-labore` para
 * `6.01 Salários` por uma regra genérica (`pix-pessoa-fisica`, precisão medida
 * de 15,2%), com consequência tributária. O backend recusa lote por filtro com
 * 422 e exige `ids` explícitos; a tela não oferece o botão que geraria esse
 * pedido. O que existe é "selecionar os N desta página" — itens que estão na
 * tela, que a pessoa viu, e cujos ids viajam um a um.
 *
 * ===========================================================================
 * TODA MUDANÇA PASSA POR DRY-RUN
 * ===========================================================================
 * `aplicar: false` é o padrão da casa (todo script de escrita deste
 * repositório tem `--aplicar`). O botão de gravar só acende depois de a prévia
 * voltar, e a prévia é invalidada assim que a seleção, a categoria ou o motivo
 * mudam — uma prévia de outro pedido é pior que nenhuma.
 *
 * O vocabulário visual é o de `Certeza.tsx`. Indeterminado tem hachura roxa
 * porque aqui o dado ausente é o produto, não um erro a esconder.
 */

// ---------------------------------------------------------------------------
// Vocabulário
// ---------------------------------------------------------------------------

const UNIVERSOS: Universo[] = ["lancamento", "documento", "item_cartao"];

const UNIVERSO_ROTULO: Record<Universo, { curto: string; plural: string; tabela: string; explica: string }> = {
  lancamento: {
    curto: "lançamento",
    plural: "lançamentos",
    tabela: "fin_transaction",
    explica: "movimento de extrato — é o que o painel mede, e o que entra na DRE pelo caixa"
  },
  documento: {
    curto: "documento",
    plural: "documentos",
    tabela: "fin_document",
    explica: "cobrança emitida — entra pela competência, e o lançamento liquidado pode herdar a categoria"
  },
  item_cartao: {
    curto: "item de cartão",
    plural: "itens de cartão",
    tabela: "fin_card_transaction",
    explica: "linha da fatura — subledger que nenhum indicador do painel alcança"
  }
};

const ESTADOS: EstadoCategorizacao[] = ["classificado", "indeterminado", "em_duvida"];

const ESTADO_ROTULO: Record<EstadoCategorizacao, { texto: string; camada: Camada }> = {
  classificado: { texto: "classificado", camada: "firme" },
  em_duvida: { texto: "em dúvida", camada: "observado" },
  indeterminado: { texto: "indeterminado", camada: "indeterminado" }
};

const PROCEDENCIAS: ProcedenciaFamilia[] = [
  "humano",
  "contrato",
  "regra",
  "fonte",
  "cadastro",
  "historico",
  "padrao",
  "indefinida"
];

/**
 * Quem decidiu → que camada de certeza aquilo vale.
 *
 * A camada não é enfeite: `humano` e `contrato` são decisões com dono; `regra`
 * e `fonte` são derivações que já erraram antes (a regra 40 acumulou 25
 * acertos com zero verdadeiros positivos); `cadastro`, `histórico` e `padrão`
 * são inferência sobre o passado. `indefinida` é ausência, e ausência tem
 * hachura.
 */
const CAMADA_DA_PROCEDENCIA: Record<ProcedenciaFamilia, Camada> = {
  humano: "firme",
  contrato: "firme",
  regra: "provavel",
  fonte: "provavel",
  cadastro: "observado",
  historico: "observado",
  padrao: "observado",
  indefinida: "indeterminado"
};

const PROCEDENCIA_EXPLICA: Record<ProcedenciaFamilia, string> = {
  humano: "uma pessoa decidiu e a decisão ficou travada",
  contrato: "veio do contrato / documento liquidado",
  regra: "uma regra do motor casou o texto",
  fonte: "a própria fonte já entregou classificado",
  cadastro: "veio do cadastro da contraparte",
  historico: "inferido do histórico daquela contraparte",
  padrao: "caiu no padrão, sem evidência específica",
  indefinida: "ninguém decidiu — não há carimbo de origem"
};

const ROTA_BUSCA = "/api/financeiro/gerencial/categorizacao/busca";
const ROTA_LOTE = "/api/financeiro/gerencial/categorizacao/reclassificar-lote";
const ROTA_REGRA = "/api/financeiro/gerencial/categorizacao/virar-regra";
const ROTA_PLANO = "/api/financeiro/gerencial/categorizacao/categorias";

/** O teto por requisição do backend (`LOTE_MAXIMO`). Repetido para avisar antes do 422. */
const LOTE_MAXIMO = 1000;

const ORDENACOES: { campo: CampoOrdenacaoBusca; rotulo: string }[] = [
  { campo: "data", rotulo: "data" },
  { campo: "valor", rotulo: "valor" },
  { campo: "descricao", rotulo: "descrição" },
  { campo: "categoria", rotulo: "categoria" },
  { campo: "universo", rotulo: "universo" },
  { campo: "estado", rotulo: "estado" },
  { campo: "procedencia", rotulo: "quem decidiu" }
];

// ---------------------------------------------------------------------------
// Filtros
// ---------------------------------------------------------------------------

type Filtros = {
  busca: string;
  universo: "" | Universo;
  categoria: string;
  estado: "" | EstadoCategorizacao;
  procedencia: "" | ProcedenciaFamilia;
  nucleo: string;
  centroCusto: string;
  contraparte: string;
  contraparteNome: string;
  de: string;
  ate: string;
  valorMin: string;
  valorMax: string;
  natureza: "" | "entrada" | "saida";
  travado: "" | "1" | "0";
  apenasClassificavel: boolean;
  ordenarPor: CampoOrdenacaoBusca;
  direcao: "asc" | "desc";
  pagina: number;
  porPagina: number;
};

const FILTROS_VAZIOS: Filtros = {
  busca: "",
  universo: "",
  categoria: "",
  estado: "",
  procedencia: "",
  nucleo: "",
  centroCusto: "",
  contraparte: "",
  contraparteNome: "",
  de: "",
  ate: "",
  valorMin: "",
  valorMax: "",
  natureza: "",
  travado: "",
  apenasClassificavel: false,
  ordenarPor: "data",
  direcao: "desc",
  pagina: 1,
  porPagina: 50
};

/**
 * "1.234,56" ou "1234.56" → 123456 centavos.
 *
 * O parâmetro da API se chama `valorMinCents` de propósito: quem manda reais
 * achando que são reais filtra por um valor 100× menor e conclui que a base
 * perdeu lançamento. A conversão fica aqui, num lugar só.
 */
function paraCentavos(texto: string): number | null {
  const limpo = texto.replace(/[R$\s]/g, "").trim();
  if (!limpo) return null;
  const normal = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  const n = Number(normal);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function queryDe(f: Filtros): string {
  const p = new URLSearchParams();
  const add = (chave: string, valor: string | number | undefined | null) => {
    if (valor === undefined || valor === null || valor === "") return;
    p.set(chave, String(valor));
  };
  add("busca", f.busca.trim());
  add("universo", f.universo);
  add("categoria", f.categoria);
  add("estado", f.estado);
  add("procedencia", f.procedencia);
  add("nucleo", f.nucleo);
  add("centroCusto", f.centroCusto);
  add("contraparte", f.contraparte);
  add("de", f.de);
  add("ate", f.ate);
  add("valorMinCents", paraCentavos(f.valorMin));
  add("valorMaxCents", paraCentavos(f.valorMax));
  add("natureza", f.natureza);
  if (f.travado) add("travado", f.travado);
  if (f.apenasClassificavel) add("apenasClassificavel", "1");
  add("ordenarPor", f.ordenarPor);
  add("direcao", f.direcao);
  add("pagina", f.pagina);
  add("porPagina", f.porPagina);
  return p.toString();
}

// ---------------------------------------------------------------------------
// Respostas das rotas de escrita (elas não devolvem `Contrato<T>`: devolvem o
// que mudou). Os tipos vêm do módulo de escrita para não divergirem dele.
// ---------------------------------------------------------------------------

type RespostaLote = ResultadoLote & { ok: boolean; dryRun: boolean; ressalvas: string[] };
type RespostaRegra = { ok: boolean; dryRun: boolean; proposta: PropostaRegra; ressalvas: string[] };

type PlanoDado = {
  categorias: CategoriaPlano[];
  gruposFluxo: { slug: string; nome: string; direcao: string }[];
};

type Props = {
  plano: PlanoDado;
  ressalvasPlano: string[];
  nucleos: { slug: string; nome: string }[];
  centrosCusto: { slug: string; nome: string; tipo: string }[];
  /** Os indeterminados classificáveis dos três universos, medidos no servidor. */
  foraDaRegua: ResumoUniverso[];
  planoDisponivel: boolean;
};

const chaveDe = (i: { universo: Universo; id: number }) => `${i.universo}:${i.id}`;

function alvosDe(itens: ItemCategorizavel[]): { universo: Universo; ids: number[] }[] {
  const mapa = new Map<Universo, number[]>();
  for (const item of itens) {
    const lista = mapa.get(item.universo);
    if (lista) lista.push(item.id);
    else mapa.set(item.universo, [item.id]);
  }
  return [...mapa.entries()].map(([universo, ids]) => ({ universo, ids }));
}

async function erroDaResposta(r: Response): Promise<string> {
  const corpo = await r.json().catch(() => null);
  if (!corpo) return `falha (HTTP ${r.status})`;
  const extras: string[] = [];
  if (corpo.recusadoPor) extras.push(`recusado por ${corpo.recusadoPor}`);
  if (Array.isArray(corpo.itens) && corpo.itens.length) {
    extras.push(
      corpo.itens
        .slice(0, 3)
        .map((i: { id: number; motivo?: string }) => `#${i.id}${i.motivo ? `: ${i.motivo}` : ""}`)
        .join(" · ")
    );
  }
  if (corpo.parametro) extras.push(`parâmetro: ${corpo.parametro}`);
  const base = corpo.erro ?? corpo.ressalvas?.[0] ?? `falha (HTTP ${r.status})`;
  return extras.length ? `${base} — ${extras.join(" — ")}` : base;
}

// ---------------------------------------------------------------------------

export function FinCategorizacao(props: Props) {
  const [aba, setAba] = useState<"itens" | "plano">("itens");

  // O plano é servido pelo Server Component na primeira pintura e recarregado
  // pela rota depois de cada criação/edição — a lista de categorias do seletor
  // de lote tem de refletir a categoria que a pessoa acabou de criar.
  const [plano, setPlano] = useState<PlanoDado>(props.plano);
  const [ressalvasPlano, setRessalvasPlano] = useState<string[]>(props.ressalvasPlano);
  const [recarregandoPlano, setRecarregandoPlano] = useState(false);

  const recarregarPlano = useCallback(async () => {
    setRecarregandoPlano(true);
    try {
      const r = await fetch(`${ROTA_PLANO}?incluirInativas=1`, { headers: { accept: "application/json" } });
      if (!r.ok) return;
      const corpo = (await r.json()) as Contrato<PlanoDado>;
      if (corpo?.dado) {
        setPlano(corpo.dado);
        setRessalvasPlano(corpo.ressalvas ?? []);
      }
    } finally {
      setRecarregandoPlano(false);
    }
  }, []);

  const categoriasAtivas = useMemo(() => plano.categorias.filter((c) => c.ativa), [plano.categorias]);

  return (
    <div className="fin-cat">
      <nav className="fin-cat-abas" aria-label="Seções da categorização">
        <button
          type="button"
          className={aba === "itens" ? "fin-cat-aba ativa" : "fin-cat-aba"}
          onClick={() => setAba("itens")}
        >
          Itens categorizáveis
        </button>
        <button
          type="button"
          className={aba === "plano" ? "fin-cat-aba ativa" : "fin-cat-aba"}
          onClick={() => setAba("plano")}
        >
          Plano de contas <span className="fin-tag">{categoriasAtivas.length} ativas</span>
        </button>
      </nav>

      {aba === "itens" ? (
        <Itens
          categorias={categoriasAtivas}
          nucleos={props.nucleos}
          centrosCusto={props.centrosCusto}
          foraDaRegua={props.foraDaRegua}
        />
      ) : props.planoDisponivel ? (
        <FinPlanoContas
          categorias={plano.categorias}
          gruposFluxo={plano.gruposFluxo}
          nucleos={props.nucleos}
          ressalvas={ressalvasPlano}
          recarregando={recarregandoPlano}
          onMudou={() => void recarregarPlano()}
        />
      ) : (
        <p className="fin-alert">
          O plano de contas não pôde ser lido do banco financeiro. Nada foi escondido: a lista está vazia porque a
          fonte não respondeu, não porque não existem categorias.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// A busca e o que se faz com o resultado
// ---------------------------------------------------------------------------

function Itens({
  categorias,
  nucleos,
  centrosCusto,
  foraDaRegua
}: {
  categorias: CategoriaPlano[];
  nucleos: { slug: string; nome: string }[];
  centrosCusto: { slug: string; nome: string; tipo: string }[];
  foraDaRegua: ResumoUniverso[];
}) {
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_VAZIOS);
  const [resultado, setResultado] = useState<Contrato<BuscaCategorizacao> | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erroBusca, setErroBusca] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [avancado, setAvancado] = useState(false);
  const [detalhe, setDetalhe] = useState<string | null>(null);

  const [selecao, setSelecao] = useState<Record<string, ItemCategorizavel>>({});
  const selecionados = useMemo(() => Object.values(selecao), [selecao]);

  const consulta = useMemo(() => queryDe(filtros), [filtros]);

  useEffect(() => {
    const controle = new AbortController();
    // Debounce curto: digitar "condomínio" não deve disparar dez buscas na
    // view que varre 18.094 linhas.
    const timer = setTimeout(async () => {
      setCarregando(true);
      setErroBusca(null);
      try {
        const r = await fetch(`${ROTA_BUSCA}?${consulta}`, { signal: controle.signal });
        if (!r.ok) {
          setErroBusca(await erroDaResposta(r));
          setResultado(null);
        } else {
          setResultado((await r.json()) as Contrato<BuscaCategorizacao>);
        }
      } catch (e) {
        if (controle.signal.aborted) return;
        setErroBusca(e instanceof Error ? e.message : "falha ao buscar");
        setResultado(null);
      }
      if (!controle.signal.aborted) setCarregando(false);
    }, 300);

    return () => {
      clearTimeout(timer);
      controle.abort();
    };
  }, [consulta, recarga]);

  /** Qualquer mudança de filtro volta para a página 1 — senão a pessoa cai na página 7 de um resultado de 2. */
  const mudar = useCallback((patch: Partial<Filtros>) => {
    setFiltros((f) => ({ ...f, ...patch, pagina: patch.pagina ?? 1 }));
  }, []);

  const pagina = resultado?.dado.pagina;
  const itens = pagina?.itens ?? [];
  const porUniverso = resultado?.dado.porUniverso ?? [];

  const alternar = (item: ItemCategorizavel) => {
    const chave = chaveDe(item);
    setSelecao((s) => {
      const proxima = { ...s };
      if (proxima[chave]) delete proxima[chave];
      else proxima[chave] = item;
      return proxima;
    });
  };

  const todosDaPaginaMarcados = itens.length > 0 && itens.every((i) => selecao[chaveDe(i)]);

  const foraDoPainel = foraDaRegua.filter((u) => u.universo !== "lancamento");
  const totalForaDoPainel = foraDoPainel.reduce((s, u) => s + u.indeterminados, 0);

  return (
    <>
      {/* -------------------------------------------------------------- */}
      {/* O número que justifica a tela, e que é clicável                */}
      {/* -------------------------------------------------------------- */}
      <section className="card fin-cat-lacuna">
        <div className="card-title">
          {/* "medido agora" só pode ser dito depois de medir. Enquanto a
              consulta não volta, `foraDaRegua` é lista vazia e a soma dá zero —
              e zero aqui afirmaria que não há nada fora da régua, quando há 889
              itens. Auditoria de 17/08 pegou a tela dizendo isso em produção. */}
          {carregando && foraDaRegua.length === 0 ? (
            <>
              <h2 className="fin-indisponivel">medindo os três universos…</h2>
              <span>ainda não é zero — é que ainda não se sabe</span>
            </>
          ) : (
            <>
              <h2>{totalForaDoPainel.toLocaleString("pt-BR")} itens fora de todo indicador</h2>
              <span>medido agora, nos três universos</span>
            </>
          )}
        </div>
        <p className="fin-card-hint">
          O painel mede <code>fin_transaction</code> — e está certo, é o que o nome dele diz. Estes não são
          lançamentos, então nenhum indicador os alcança: não estão errados, estão fora da régua. Os valores{" "}
          <strong>não se somam</strong>: o sinal do cartão é de dívida e o do extrato é de caixa.
        </p>
        <div className="fin-cat-lacuna-medidas">
          {foraDaRegua.map((u) => (
            <div key={u.universo} className="fin-cat-lacuna-item">
              <Medida
                rotulo={`${UNIVERSO_ROTULO[u.universo].plural} sem destino`}
                valorCents={u.valorAbsCents}
                detalhe={`${u.indeterminados.toLocaleString("pt-BR")} itens · ${
                  u.universo === "lancamento" ? "o painel mede estes" : "fora do painel"
                }`}
              />
              <button
                type="button"
                className="fin-cat-lacuna-botao"
                onClick={() => {
                  setSelecao({});
                  setFiltros({
                    ...FILTROS_VAZIOS,
                    universo: u.universo,
                    estado: "indeterminado",
                    apenasClassificavel: true,
                    ordenarPor: "valor",
                    direcao: "desc"
                  });
                }}
              >
                abrir os {u.indeterminados.toLocaleString("pt-BR")} →
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* -------------------------------------------------------------- */}
      {/* Filtros                                                        */}
      {/* -------------------------------------------------------------- */}
      <section className="card">
        <div className="fin-cat-filtros">
          <input
            type="search"
            className="fin-input fin-cat-busca"
            placeholder="Buscar na descrição e no nome da contraparte…"
            value={filtros.busca}
            onChange={(e) => mudar({ busca: e.target.value })}
            aria-label="Buscar por texto"
          />

          <label className="fin-field">
            <span>universo</span>
            <select
              className="fin-select"
              value={filtros.universo}
              onChange={(e) => mudar({ universo: e.target.value as Filtros["universo"] })}
            >
              <option value="">os três</option>
              {UNIVERSOS.map((u) => (
                <option key={u} value={u}>
                  {UNIVERSO_ROTULO[u].plural}
                </option>
              ))}
            </select>
          </label>

          <label className="fin-field">
            <span>estado</span>
            <select
              className="fin-select"
              value={filtros.estado}
              onChange={(e) => mudar({ estado: e.target.value as Filtros["estado"] })}
            >
              <option value="">qualquer</option>
              {ESTADOS.map((e) => (
                <option key={e} value={e}>
                  {ESTADO_ROTULO[e].texto}
                </option>
              ))}
            </select>
          </label>

          <label className="fin-field">
            <span>categoria</span>
            <select
              className="fin-select"
              value={filtros.categoria}
              onChange={(e) => mudar({ categoria: e.target.value })}
            >
              <option value="">qualquer</option>
              {categorias.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} · {c.nome}
                </option>
              ))}
            </select>
          </label>

          <label className="fin-field">
            <span>valor de (R$)</span>
            <input
              className="fin-input fin-input-valor"
              inputMode="decimal"
              value={filtros.valorMin}
              onChange={(e) => mudar({ valorMin: e.target.value })}
              placeholder="0,00"
            />
          </label>

          <label className="fin-field">
            <span>até (R$)</span>
            <input
              className="fin-input fin-input-valor"
              inputMode="decimal"
              value={filtros.valorMax}
              onChange={(e) => mudar({ valorMax: e.target.value })}
              placeholder="sem teto"
            />
          </label>

          <button type="button" className="fin-btn-ghost" onClick={() => setAvancado((v) => !v)}>
            {avancado ? "menos filtros" : "mais filtros"}
          </button>
        </div>

        {avancado ? (
          <div className="fin-cat-filtros">
            <label className="fin-field">
              <span>de (data)</span>
              <input
                type="date"
                className="fin-input"
                value={filtros.de}
                onChange={(e) => mudar({ de: e.target.value })}
              />
            </label>
            <label className="fin-field">
              <span>até (data)</span>
              <input
                type="date"
                className="fin-input"
                value={filtros.ate}
                onChange={(e) => mudar({ ate: e.target.value })}
              />
            </label>

            <label className="fin-field">
              <span>quem decidiu</span>
              <select
                className="fin-select"
                value={filtros.procedencia}
                onChange={(e) => mudar({ procedencia: e.target.value as Filtros["procedencia"] })}
              >
                <option value="">qualquer</option>
                {PROCEDENCIAS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>

            <label className="fin-field">
              <span>núcleo</span>
              <select
                className="fin-select"
                value={filtros.nucleo}
                onChange={(e) => mudar({ nucleo: e.target.value })}
              >
                <option value="">qualquer</option>
                {nucleos.map((n) => (
                  <option key={n.slug} value={n.slug}>
                    {n.nome}
                  </option>
                ))}
              </select>
            </label>

            <label className="fin-field">
              <span>centro de custo</span>
              <select
                className="fin-select"
                value={filtros.centroCusto}
                onChange={(e) => mudar({ centroCusto: e.target.value })}
              >
                <option value="">qualquer</option>
                {centrosCusto.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.nome}
                  </option>
                ))}
              </select>
              <span className="fin-field-hint">1,1% preenchido — teto de fonte, dúvida 19</span>
            </label>

            <label className="fin-field">
              <span>natureza</span>
              <select
                className="fin-select"
                value={filtros.natureza}
                onChange={(e) => mudar({ natureza: e.target.value as Filtros["natureza"] })}
              >
                <option value="">entradas e saídas</option>
                <option value="entrada">só entradas</option>
                <option value="saida">só saídas</option>
              </select>
            </label>

            <label className="fin-field">
              <span>decisão humana</span>
              <select
                className="fin-select"
                value={filtros.travado}
                onChange={(e) => mudar({ travado: e.target.value as Filtros["travado"] })}
              >
                <option value="">tanto faz</option>
                <option value="1">só travados</option>
                <option value="0">só destravados</option>
              </select>
            </label>

            <label className="fin-check">
              <input
                type="checkbox"
                checked={filtros.apenasClassificavel}
                onChange={(e) => mudar({ apenasClassificavel: e.target.checked })}
              />
              só o que o lote pode mudar
            </label>

            <label className="fin-field">
              <span>ordenar por</span>
              <select
                className="fin-select"
                value={filtros.ordenarPor}
                onChange={(e) => mudar({ ordenarPor: e.target.value as CampoOrdenacaoBusca })}
              >
                {ORDENACOES.map((o) => (
                  <option key={o.campo} value={o.campo}>
                    {o.rotulo}
                  </option>
                ))}
              </select>
            </label>

            <label className="fin-field">
              <span>sentido</span>
              <select
                className="fin-select"
                value={filtros.direcao}
                onChange={(e) => mudar({ direcao: e.target.value as "asc" | "desc" })}
              >
                <option value="desc">maior / mais recente primeiro</option>
                <option value="asc">menor / mais antigo primeiro</option>
              </select>
            </label>

            <label className="fin-field">
              <span>por página</span>
              <select
                className="fin-select"
                value={filtros.porPagina}
                onChange={(e) => mudar({ porPagina: Number(e.target.value) })}
              >
                {[25, 50, 100, 200].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}

        <div className="fin-cat-chips">
          {filtros.contraparte ? (
            <button
              type="button"
              className="fin-cat-chip ativo"
              onClick={() => mudar({ contraparte: "", contraparteNome: "" })}
            >
              contraparte: {filtros.contraparteNome || filtros.contraparte} ✕
            </button>
          ) : null}
          <button
            type="button"
            className="fin-cat-chip"
            onClick={() => mudar({ estado: "indeterminado", apenasClassificavel: true })}
          >
            só o indeterminado tratável
          </button>
          <button type="button" className="fin-cat-chip" onClick={() => mudar({ travado: "1" })}>
            só decisão humana
          </button>
          <button
            type="button"
            className="fin-cat-chip"
            onClick={() => mudar({ procedencia: "regra", estado: "classificado" })}
          >
            classificado por regra
          </button>
          <button
            type="button"
            className="fin-cat-chip"
            onClick={() => {
              setSelecao({});
              setFiltros(FILTROS_VAZIOS);
            }}
          >
            limpar tudo
          </button>
        </div>

        {erroBusca ? (
          <p className="fin-alert" role="alert">
            {erroBusca}
          </p>
        ) : null}

        {resultado && !resultado.disponivel ? (
          <p className="fin-alert" role="alert">
            Busca indisponível: {resultado.ressalvas[0] ?? "o banco financeiro não respondeu"}
          </p>
        ) : null}

        {/* ---------------------------------------------------------- */}
        {/* Resumo por universo — nunca somado                          */}
        {/* ---------------------------------------------------------- */}
        {porUniverso.length ? (
          <div className="fin-cat-resumo">
            {porUniverso.map((u) => (
              <Medida
                key={u.universo}
                rotulo={UNIVERSO_ROTULO[u.universo].plural}
                valorCents={u.valorAbsCents}
                detalhe={
                  `${u.n.toLocaleString("pt-BR")} no filtro · ${u.classificados} classificados` +
                  (u.indeterminados ? ` · ${u.indeterminados} indeterminados` : "") +
                  (u.emDuvida ? ` · ${u.emDuvida} em dúvida` : "")
                }
              />
            ))}
            {resultado?.dado.travados ? (
              <Medida
                rotulo="travados por decisão humana"
                valorCents={null}
                motivo={`${resultado.dado.travados} item(ns) — o valor não é somado porque atravessa universos`}
              />
            ) : null}
          </div>
        ) : null}

        {resultado?.ressalvas.length ? (
          <div className="fin-cat-ressalvas">
            {resultado.ressalvas.map((r) => (
              <Ressalva key={r}>{r}</Ressalva>
            ))}
          </div>
        ) : null}
      </section>

      {/* -------------------------------------------------------------- */}
      {/* Lote                                                           */}
      {/* -------------------------------------------------------------- */}
      {selecionados.length ? (
        <PainelLote
          selecionados={selecionados}
          categorias={categorias}
          onLimpar={() => setSelecao({})}
          onAplicado={() => {
            setSelecao({});
            setRecarga((n) => n + 1);
          }}
        />
      ) : null}

      {/* -------------------------------------------------------------- */}
      {/* Resultado                                                      */}
      {/* -------------------------------------------------------------- */}
      <section className="card">
        <div className="card-title">
          <h2>
            {carregando
              ? "buscando…"
              : `${(pagina?.total ?? 0).toLocaleString("pt-BR")} itens · página ${pagina?.pagina ?? 1} de ${
                  pagina?.paginas ?? 1
                }`}
          </h2>
          <span>
            ordenado por {ORDENACOES.find((o) => o.campo === filtros.ordenarPor)?.rotulo} ({filtros.direcao})
          </span>
        </div>

        <div className="fin-cat-wrap">
          <table className="fin-table fin-cat-tabela">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    checked={todosDaPaginaMarcados}
                    disabled={!itens.length}
                    onChange={() => {
                      // Marca só o que está NA TELA. Não existe "todos os
                      // resultados da busca": ver o cabeçalho do arquivo.
                      setSelecao((s) => {
                        const proxima = { ...s };
                        if (todosDaPaginaMarcados) {
                          for (const i of itens) delete proxima[chaveDe(i)];
                        } else {
                          for (const i of itens) proxima[chaveDe(i)] = i;
                        }
                        return proxima;
                      });
                    }}
                    aria-label="Selecionar os itens desta página"
                  />
                </th>
                <th>universo</th>
                <th>data</th>
                <th>descrição</th>
                <th className="num">valor</th>
                <th>categoria</th>
                <th>por quê?</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {itens.map((item) => {
                const chave = chaveDe(item);
                const marcado = Boolean(selecao[chave]);
                const aberto = detalhe === chave;
                const estado = ESTADO_ROTULO[item.estado];
                return (
                  <Fragment key={chave}>
                    <tr className={marcado ? "fin-cat-linha marcada" : "fin-cat-linha"}>
                      <td>
                        <input
                          type="checkbox"
                          checked={marcado}
                          onChange={() => alternar(item)}
                          aria-label={`Selecionar ${item.descricao.slice(0, 40)}`}
                        />
                      </td>

                      <td>
                        <span
                          className="fin-cat-uni"
                          data-uni={item.universo}
                          title={UNIVERSO_ROTULO[item.universo].explica}
                        >
                          {UNIVERSO_ROTULO[item.universo].curto}
                        </span>
                        <span className="fin-desc-sub">{item.fonteRotulo}</span>
                      </td>

                      <td className="fin-nowrap">{dateLabel(item.data)}</td>

                      <td>
                        <span className="fin-desc">{item.descricao.slice(0, 90)}</span>
                        {item.contraparte ? (
                          <button
                            type="button"
                            className="fin-cat-contraparte"
                            title="filtrar por esta contraparte"
                            onClick={() =>
                              item.contraparteId !== null
                                ? mudar({
                                    contraparte: String(item.contraparteId),
                                    contraparteNome: item.contraparte ?? ""
                                  })
                                : undefined
                            }
                          >
                            {item.contraparte}
                          </button>
                        ) : (
                          <span className="fin-desc-sub">sem contraparte identificada</span>
                        )}
                      </td>

                      <td className="num fin-table-money" data-dir={item.direcao}>
                        {item.direcao === "entrada" ? "+" : "−"}
                        {brl(item.valorAbsCents)}
                      </td>

                      <td>
                        {item.categoriaCode ? (
                          <>
                            <span className="fin-desc">{item.categoriaCode}</span>
                            <span className="fin-desc-sub">{item.categoriaNome}</span>
                          </>
                        ) : (
                          <span className="cert-hachura fin-cat-sem-categoria">sem categoria</span>
                        )}
                      </td>

                      <td>
                        <button
                          type="button"
                          className="fin-cat-porque"
                          onClick={() => setDetalhe(aberto ? null : chave)}
                          aria-expanded={aberto}
                        >
                          <SeloCamada
                            camada={CAMADA_DA_PROCEDENCIA[item.procedencia]}
                            texto={item.procedencia}
                          />
                          <SeloCamada camada={estado.camada} texto={estado.texto} />
                          {item.travado ? <span className="fin-cat-trava">travado</span> : null}
                        </button>
                      </td>

                      <td>
                        <button
                          type="button"
                          className="fin-btn-ghost fin-btn-mini"
                          disabled={!item.classificavel}
                          title={item.motivoNaoClassificavel ?? "trocar a categoria deste item"}
                          onClick={() => setSelecao({ [chave]: item })}
                        >
                          trocar
                        </button>
                      </td>
                    </tr>

                    {aberto ? (
                      <tr className="fin-cat-detalhe-linha">
                        <td colSpan={8}>
                          <Detalhe item={item} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {!carregando && !itens.length ? (
          <p className="fin-empty-row">
            {pagina?.vazio?.motivo ?? "Nenhum item com esse filtro."}
            {pagina?.vazio?.acao ? <span className="fin-desc-sub">{pagina.vazio.acao}</span> : null}
          </p>
        ) : null}

        {pagina && pagina.paginas > 1 ? (
          <div className="fin-cat-paginacao">
            <button
              type="button"
              className="fin-btn-ghost"
              disabled={pagina.pagina <= 1}
              onClick={() => mudar({ pagina: pagina.pagina - 1 })}
            >
              ← anterior
            </button>
            <span>
              {pagina.pagina} / {pagina.paginas}
            </span>
            <button
              type="button"
              className="fin-btn-ghost"
              disabled={!pagina.temMais}
              onClick={() => mudar({ pagina: pagina.pagina + 1 })}
            >
              próxima →
            </button>
          </div>
        ) : null}
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// O selo "por quê?", aberto
// ---------------------------------------------------------------------------

function Detalhe({ item }: { item: ItemCategorizavel }) {
  const evidencia =
    item.procedenciaEvidenciaTexto ??
    (item.procedenciaEvidencia ? JSON.stringify(item.procedenciaEvidencia) : null);

  return (
    <div className="fin-cat-detalhe">
      <dl>
        <div>
          <dt>o que é</dt>
          <dd>
            {UNIVERSO_ROTULO[item.universo].curto} #{item.id} · <code>{UNIVERSO_ROTULO[item.universo].tabela}</code>
            <span className="fin-desc-sub">{UNIVERSO_ROTULO[item.universo].explica}</span>
          </dd>
        </div>

        <div>
          <dt>quem decidiu</dt>
          <dd>
            <SeloCamada camada={CAMADA_DA_PROCEDENCIA[item.procedencia]} texto={item.procedencia} />
            <span className="fin-desc-sub">{PROCEDENCIA_EXPLICA[item.procedencia]}</span>
            {item.procedenciaBruta && item.procedenciaBruta !== item.procedencia ? (
              <span className="fin-desc-sub">
                carimbo cru: <code>{item.procedenciaBruta}</code>
              </span>
            ) : null}
            {item.procedenciaRegra ? (
              <span className="fin-desc-sub">regra: {item.procedenciaRegra}</span>
            ) : null}
          </dd>
        </div>

        <div>
          <dt>quando</dt>
          <dd>
            {item.procedenciaEm ? (
              new Date(item.procedenciaEm).toLocaleString("pt-BR")
            ) : (
              <span className="fin-cat-vazio">sem carimbo de data</span>
            )}
          </dd>
        </div>

        <div>
          <dt>com que evidência</dt>
          <dd>
            {evidencia ? (
              <code className="fin-cat-evidencia">{evidencia.slice(0, 400)}</code>
            ) : (
              <span className="fin-cat-vazio">nenhuma evidência registrada</span>
            )}
          </dd>
        </div>

        <div>
          <dt>travado?</dt>
          <dd>
            {item.travado ? (
              <>
                <strong>sim</strong>
                <span className="fin-desc-sub">
                  campos travados: {item.travadoCampos.join(", ") || "—"}. `fin_preserve_human_locks` devolve o
                  valor antigo a qualquer sincronização — foi o que faltou nas 52 classificações perdidas em 11/08.
                </span>
              </>
            ) : (
              <>
                não
                <span className="fin-desc-sub">a próxima sincronização tem o direito de sobrescrever</span>
              </>
            )}
          </dd>
        </div>

        <div>
          <dt>estado</dt>
          <dd>
            <SeloCamada camada={ESTADO_ROTULO[item.estado].camada} texto={ESTADO_ROTULO[item.estado].texto} />
            {item.motivoIndeterminado ? (
              <span className="fin-desc-sub cert-hachura fin-cat-motivo">{item.motivoIndeterminado}</span>
            ) : null}
          </dd>
        </div>

        <div>
          <dt>fila de revisão</dt>
          <dd>
            {item.filaMotivo ? (
              <>
                {item.filaMotivo} · {item.filaStatus}
              </>
            ) : (
              <span className="fin-cat-vazio">
                {item.universo === "item_cartao"
                  ? "o subledger do cartão não tem fila: fin_review_item não aceita fin_card_transaction como alvo"
                  : "sem item de fila"}
              </span>
            )}
            <span className="fin-desc-sub">review_status: {item.revisao || "—"}</span>
          </dd>
        </div>

        <div>
          <dt>onde entra</dt>
          <dd>
            {item.categoriaCode ? (
              <>
                {item.categoriaCode} {item.categoriaNome}
                <span className="fin-desc-sub">
                  {item.categoriaKind} · {item.categoriaGrupo ?? "sem grupo"}
                </span>
              </>
            ) : (
              <span className="fin-cat-vazio">nenhuma categoria</span>
            )}
            <span className="fin-desc-sub">
              núcleo: {item.nucleo ?? "—"} · centro de custo: {item.centroCusto ?? "—"} · competência:{" "}
              {item.competencia ? dateLabel(item.competencia) : "—"}
            </span>
          </dd>
        </div>

        {!item.classificavel ? (
          <div className="fin-cat-detalhe-veto">
            <dt>não é classificável</dt>
            <dd>{item.motivoNaoClassificavel}</dd>
          </div>
        ) : null}

        {item.valorFonteCents !== item.valorAbsCents ? (
          <div>
            <dt>valor na fonte</dt>
            <dd>
              {brl(item.valorFonteCents)}
              <span className="fin-desc-sub">
                o sinal é o da fonte. Nunca some entre universos: no cartão, positivo aumenta o que se DEVE.
              </span>
            </dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reclassificar: prévia obrigatória, depois gravar
// ---------------------------------------------------------------------------

function PainelLote({
  selecionados,
  categorias,
  onLimpar,
  onAplicado
}: {
  selecionados: ItemCategorizavel[];
  categorias: CategoriaPlano[];
  onLimpar: () => void;
  onAplicado: () => void;
}) {
  const [code, setCode] = useState("");
  const [motivo, setMotivo] = useState("");
  const [evidencia, setEvidencia] = useState("");
  const [previa, setPrevia] = useState<{ chave: string; resposta: RespostaLote } | null>(null);
  const [aplicado, setAplicado] = useState<RespostaLote | null>(null);
  const [pendente, setPendente] = useState<"previa" | "aplicar" | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const alvos = useMemo(() => alvosDe(selecionados), [selecionados]);

  /** A prévia vale para ESTE pedido. Mudou seleção, categoria ou motivo, ela morre. */
  const chavePedido = useMemo(
    () =>
      JSON.stringify({
        code,
        motivo: motivo.trim(),
        evidencia: evidencia.trim(),
        itens: selecionados.map(chaveDe).sort()
      }),
    [code, motivo, evidencia, selecionados]
  );

  const previaValida = previa?.chave === chavePedido ? previa.resposta : null;
  const acimaDoTeto = selecionados.length > LOTE_MAXIMO;
  const naoClassificaveis = selecionados.filter((i) => !i.classificavel);
  const travados = selecionados.filter((i) => i.travado);
  const categoria = categorias.find((c) => c.code === code);

  async function chamar(aplicar: boolean) {
    setPendente(aplicar ? "aplicar" : "previa");
    setErro(null);
    try {
      const r = await fetch(ROTA_LOTE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          alvos,
          code,
          motivo: motivo.trim(),
          evidencia: evidencia.trim() || undefined,
          aplicar
        })
      });
      if (!r.ok) throw new Error(await erroDaResposta(r));
      const resposta = (await r.json()) as RespostaLote;
      if (aplicar) {
        setAplicado(resposta);
        setPrevia(null);
      } else {
        setPrevia({ chave: chavePedido, resposta });
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : "falha ao reclassificar");
    } finally {
      setPendente(null);
    }
  }

  if (aplicado) {
    const total = aplicado.aplicados.reduce((s, a) => s + a.n, 0);
    return (
      <section className="card fin-cat-painel fin-cat-painel-ok">
        <div className="card-title">
          <h2>
            {total} item(ns) agora em {aplicado.categoria.code} {aplicado.categoria.nome}
          </h2>
          <span>lote {aplicado.loteId.slice(0, 8)}</span>
        </div>
        <ul className="fin-cat-lista-prova">
          {aplicado.aplicados.map((a) => (
            <li key={a.universo}>
              {a.n} {UNIVERSO_ROTULO[a.universo].plural}
            </li>
          ))}
          <li>{aplicado.eventosTrilha} evento(s) em `fin_classification_event` — é o que torna o desfazer possível</li>
          {aplicado.filaResolvida.map((f) => (
            <li key={`fila-${f.universo}`}>
              {f.n} item(ns) de fila resolvidos em {UNIVERSO_ROTULO[f.universo].plural} — antes do UPDATE, que é
              a ordem que o gatilho da 0094 exige
            </li>
          ))}
          {aplicado.travasEscritas.map((t) => (
            <li key={`trava-${t.universo}`}>
              {t.n} trava(s) em {UNIVERSO_ROTULO[t.universo].plural}, <strong>relidas do banco</strong> — afirmar
              que travou sem conferir foi como 52 classificações se perderam
            </li>
          ))}
        </ul>

        <PainelRegra codeAplicado={aplicado.categoria.code} itens={selecionados} />

        <div className="fin-cat-form-acoes">
          <button
            type="button"
            className="fin-btn-primary"
            onClick={() => {
              setAplicado(null);
              onAplicado();
            }}
          >
            Voltar para a busca
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="card fin-cat-painel">
      <div className="fin-bulk-bar">
        <strong>{selecionados.length} selecionados</strong>
        <select
          className="fin-select"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          aria-label="Categoria de destino"
        >
          <option value="">categoria de destino…</option>
          {categorias.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} · {c.nome}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="fin-btn-primary"
          disabled={!code || !motivo.trim() || acimaDoTeto || pendente !== null}
          onClick={() => void chamar(false)}
        >
          {pendente === "previa" ? "medindo…" : "Ver o que muda"}
        </button>
        <button type="button" className="fin-btn-ghost" onClick={onLimpar}>
          Limpar seleção
        </button>
      </div>

      <div className="fin-cat-grade">
        <label className="fin-field fin-field-wide">
          <span>motivo (obrigatório)</span>
          <input
            className="fin-input"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="NF 190 e 192 casam as parcelas 1/6 e 2/6 do contrato"
          />
          <span className="fin-field-hint">
            a trilha sem motivo diz &ldquo;alguém mudou isso&rdquo; e o desfazer perde o porquê — o backend recusa
            com 422
          </span>
        </label>
        <label className="fin-field fin-field-wide">
          <span>evidência (opcional)</span>
          <input
            className="fin-input"
            value={evidencia}
            onChange={(e) => setEvidencia(e.target.value)}
            placeholder="paid_on das duas parcelas = 12/03; únicos créditos de R$ 17.000 no mês"
          />
        </label>
      </div>

      {categoria ? (
        <p className="fin-cat-nota">
          {categoria.code} {categoria.nome} é <strong>{categoria.kind}</strong> e{" "}
          {categoria.sinalEsperado === "ambos"
            ? "aceita entrada e saída"
            : `exige ${categoria.sinalEsperado}`}
          . O gatilho <code>fin_transaction_sinal_da_categoria</code> anula a categoria em silêncio quando o sinal
          não bate; por isso o lote inteiro é recusado antes do UPDATE se algum item for incompatível.
        </p>
      ) : null}

      {acimaDoTeto ? (
        <p className="fin-alert" role="alert">
          {selecionados.length} itens acima do teto de {LOTE_MAXIMO} por requisição — desfazer 5.000 linhas é bem
          mais caro que refazer duas chamadas. Divida a seleção.
        </p>
      ) : null}

      {naoClassificaveis.length ? (
        <p className="fin-alert" role="alert">
          {naoClassificaveis.length} item(ns) da seleção são <strong>declarados não classificáveis</strong>:{" "}
          {naoClassificaveis[0].motivoNaoClassificavel}. O lote inteiro será recusado enquanto eles estiverem
          dentro.
        </p>
      ) : null}

      {travados.length ? (
        <Ressalva>
          {travados.length} item(ns) da seleção estão travados por decisão humana anterior. A automação não os
          tocaria; esta tela toca porque é ato humano explícito — e a decisão anterior fica registrada em{" "}
          <code>fin_classification_event</code> com o valor que tinha antes.
        </Ressalva>
      ) : null}

      {erro ? (
        <p className="fin-alert" role="alert">
          {erro}
        </p>
      ) : null}

      {previaValida ? (
        <div className="fin-cat-previa">
          <h3>
            Prévia — nada foi escrito. Destino: {previaValida.categoria.code} {previaValida.categoria.nome} (
            {previaValida.categoria.kind}, sinal {previaValida.categoria.sinalEsperado})
          </h3>
          <table className="fin-table">
            <thead>
              <tr>
                <th>universo</th>
                <th className="num">encontrados</th>
                <th className="num">já nesta categoria</th>
                <th className="num">travados</th>
                <th className="num">valor hoje</th>
                <th>de onde saem</th>
              </tr>
            </thead>
            <tbody>
              {previaValida.previsao.map((p) => (
                <tr key={p.universo}>
                  <td>{UNIVERSO_ROTULO[p.universo].plural}</td>
                  <td className="num">
                    {p.encontrados}
                    {p.inexistentes.length ? (
                      <span className="fin-desc-sub">{p.inexistentes.length} id(s) não existem</span>
                    ) : null}
                  </td>
                  <td className="num">{p.jaNaCategoria}</td>
                  <td className="num">{p.travados}</td>
                  <td className="num fin-table-money">{brl(p.valorAntesCents)}</td>
                  <td>
                    {p.categoriasAntes.map((c) => (
                      <span key={c.code ?? "sem"} className="fin-tag">
                        {c.code ?? "sem categoria"}: {c.n}
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="fin-cat-nota">
            Os valores por universo <strong>não se somam</strong>. Ao aplicar, cada linha ganha{" "}
            <code>classified_by=&apos;humano&apos;</code>, perde o ponteiro de regra (o invariante D6 exige o par
            completo) e recebe <code>category_id</code> em <code>human_locked_fields</code>.
          </p>
          <div className="fin-cat-form-acoes">
            <button
              type="button"
              className="fin-btn-primary"
              disabled={pendente !== null}
              onClick={() => void chamar(true)}
            >
              {pendente === "aplicar" ? "gravando…" : `Aplicar aos ${selecionados.length}`}
            </button>
            <button type="button" className="fin-btn-ghost" onClick={() => setPrevia(null)}>
              Descartar prévia
            </button>
          </div>
        </div>
      ) : (
        <p className="fin-cat-nota">
          {previa
            ? "A seleção ou o motivo mudaram desde a prévia — meça de novo. Uma prévia de outro pedido é pior que nenhuma."
            : "Nada é gravado antes de você ver a prévia. É o mesmo padrão dos scripts desta base: o default é não escrever."}
        </p>
      )}

      <p className="fin-cat-nota fin-cat-trava-nota">
        Esta tela não oferece &ldquo;reclassificar todos os resultados da busca&rdquo;. O backend recusa lote por
        filtro com 422 e exige ids explícitos: a dúvida 0 está aberta e um filtro
        &ldquo;conta=inter, categoria=6.02&rdquo; moveria 205 linhas de Pró-labore para Salários, com consequência
        tributária.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Virar regra — sempre proposta
// ---------------------------------------------------------------------------

function PainelRegra({ codeAplicado, itens }: { codeAplicado: string; itens: ItemCategorizavel[] }) {
  const contraparteComum = useMemo(() => {
    const nomes = new Set(itens.map((i) => i.contraparte ?? ""));
    return nomes.size === 1 && itens[0]?.contraparte ? itens[0].contraparte : null;
  }, [itens]);

  const [aberto, setAberto] = useState(false);
  const [porContraparte, setPorContraparte] = useState(Boolean(contraparteComum));
  const [padrao, setPadrao] = useState(contraparteComum ?? itens[0]?.descricao.slice(0, 60) ?? "");
  const [previa, setPrevia] = useState<RespostaRegra | null>(null);
  const [proposta, setProposta] = useState<RespostaRegra | null>(null);
  const [pendente, setPendente] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const curto = padrao.trim().length < 18;

  async function chamar(aplicar: boolean) {
    setPendente(true);
    setErro(null);
    try {
      const r = await fetch(ROTA_REGRA, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: codeAplicado,
          padrao: padrao.trim(),
          porContraparte,
          rotulo: (contraparteComum ?? padrao).slice(0, 120),
          aplicar
        })
      });
      if (!r.ok) throw new Error(await erroDaResposta(r));
      const resposta = (await r.json()) as RespostaRegra;
      if (aplicar) setProposta(resposta);
      else setPrevia(resposta);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "falha ao propor regra");
    } finally {
      setPendente(false);
    }
  }

  if (proposta) {
    return (
      <div className="fin-cat-regra">
        <h3>
          Regra <code>{proposta.proposta.slug}</code> criada como <strong>proposta</strong>
        </h3>
        <ul className="fin-cat-lista-prova">
          {proposta.ressalvas.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <p className="fin-cat-nota">
          Ela não classifica nada até ser ativada à parte, na tela de Regras. A regra 40 nasceu ativa e acumulou 25
          acertos com zero verdadeiros positivos.
        </p>
      </div>
    );
  }

  return (
    <div className="fin-cat-regra">
      {!aberto ? (
        <button type="button" className="fin-btn-ghost" onClick={() => setAberto(true)}>
          Transformar em regra para as próximas importações
        </button>
      ) : (
        <>
          <h3>Virar regra — nasce sempre como proposta</h3>
          <div className="fin-cat-grade">
            <label className="fin-field fin-field-wide">
              <span>padrão a casar</span>
              <input className="fin-input" value={padrao} onChange={(e) => setPadrao(e.target.value)} />
              <span className="fin-field-hint">
                {padrao.trim().length} caracteres.{" "}
                {curto
                  ? "abaixo de 18 o backend recusa: um padrão curto engole meio extrato, foi assim que pix-pessoa-fisica chegou a 15,2% de precisão"
                  : "o padrão casa a descrição normalizada, ou o nome exato da contraparte"}
              </span>
            </label>
            <label className="fin-check">
              <input
                type="checkbox"
                checked={porContraparte}
                onChange={(e) => setPorContraparte(e.target.checked)}
              />
              casar pelo nome da contraparte (não pelo texto)
            </label>
          </div>

          {erro ? (
            <p className="fin-alert" role="alert">
              {erro}
            </p>
          ) : null}

          {previa ? (
            <div className="fin-cat-previa">
              <h4>Alcance medido no acervo de HOJE — não é previsão do futuro</h4>
              <ul className="fin-cat-lista-prova">
                {previa.proposta.alcanceAtual.map((a) => (
                  <li key={a.universo}>
                    {a.n} {UNIVERSO_ROTULO[a.universo].plural} · {brl(a.valorAbsCents)}
                  </li>
                ))}
                {previa.ressalvas.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="fin-cat-form-acoes">
            <button
              type="button"
              className="fin-btn-ghost"
              disabled={pendente || curto}
              onClick={() => void chamar(false)}
            >
              {pendente ? "medindo…" : "Quantos itens ela pegaria?"}
            </button>
            <button
              type="button"
              className="fin-btn-primary"
              disabled={pendente || curto || !previa}
              onClick={() => void chamar(true)}
            >
              Propor regra
            </button>
          </div>
        </>
      )}
    </div>
  );
}

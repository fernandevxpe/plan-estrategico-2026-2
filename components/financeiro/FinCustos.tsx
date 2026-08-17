"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { OpcoesContas } from "@/lib/financeiro/contas";
import type { CategoriaCusto, ConfrontoCusto, CustosDoMes, ItemCusto } from "@/lib/financeiro/contratos/custos";

import { brl, Medida, Ressalva, SeloCamada, type Camada } from "./Certeza";

/**
 * A previsão de custos do mês, categorizada, confirmável e completável.
 *
 * ---------------------------------------------------------------------------
 * AS TRÊS REGRAS QUE ESTA TELA NÃO PODE QUEBRAR
 * ---------------------------------------------------------------------------
 *
 * 1. SÓ SOMA O QUE `entraNoTotal` MANDA SOMAR. O consolidado emite duas linhas
 *    quando duas fontes falam do mesmo dinheiro — o item e a projeção que ele
 *    substituiu — e acende `entraNoTotal` em uma só. Somar as duas triplica o
 *    mês; esconder a segunda faz o total parecer vindo do nada. As duas ficam
 *    visíveis, e a que não soma carrega o motivo ao lado.
 *
 * 2. CONFIRMAR NÃO É REALIZAR, E NÃO ADIANTA CAIXA. Nenhum botão desta tela
 *    cria lançamento, mexe em saldo ou promove previsto a realizado. Confirmar
 *    carimba autor, hora e valor num item que continua sendo previsão até o
 *    dinheiro sair do extrato. A palavra "realizado" só aparece aqui como
 *    leitura do que o ledger já registrou, na tabela de confronto.
 *
 * 3. MATERIALIZAR É NEUTRO; SÓ CONFIRMAR MOVE O NÚMERO. Uma linha ainda
 *    projetada vira item na mesma transação em que é confirmada. Por isso a
 *    tela nunca oferece "materializar" como ação própria: seria um botão que
 *    parece fazer algo com o dinheiro e não faz.
 *
 * ---------------------------------------------------------------------------
 * POR QUE CONFIRMAR EM LOTE TEM DUAS PORTAS, E NÃO UMA
 * ---------------------------------------------------------------------------
 * Confirmar uma linha que JÁ soma pelo valor de face não muda o total do mês:
 * é assinatura, não decisão sobre dinheiro. Confirmar uma linha que NÃO soma
 * hoje — as recorrentes de fornecedor que estão em `proposto`, R$ 11.593,04/mês
 * medidos — ADICIONA aquele valor ao mês.
 *
 * Um botão só, chamado "confirmar todos", faria as duas coisas com o mesmo
 * clique e a segunda seria invisível. Então o lote que soma tem um botão, o
 * lote que não soma tem outro, e o segundo diz na etiqueta quanto o mês sobe.
 */

const LOTE_MAXIMO = 200;

// ---------------------------------------------------------------------------
// Vocabulário
// ---------------------------------------------------------------------------

/** O nome da camada em português. `pagar_cartao_ciclo` não é palavra de tela. */
const CAMADA: Record<string, string> = {
  pagar_folha: "folha",
  pagar_tributo_das: "DAS",
  pagar_recorrente: "recorrente",
  pagar_emprestimo: "empréstimo",
  pagar_documento: "documento a pagar",
  pagar_cartao_ciclo: "fatura de cartão · ciclo",
  pagar_cartao_parcela: "fatura de cartão · parcela",
  pagar_cartao_estimado: "fatura de cartão · estimada"
};

/**
 * A confiança da projeção, traduzida para o vocabulário de certeza já existente.
 *
 * `fin_previsao_evento_v` emite seis palavras; `Certeza.tsx` tem cinco camadas.
 * Inventar um sexto selo aqui ensinaria dois vocabulários para a mesma ideia, e
 * o CSS diz isso em voz alta no bloco "VOCABULÁRIO DE CERTEZA". Então:
 *
 *   contratado · faturado · firme  → firme          há documento por trás
 *   provavel                       → provável       o contrato declara
 *   observado                      → observado      padrão histórico
 *   estimado                       → indeterminado  hachura roxa
 *
 * `estimado` cai no indeterminado de propósito: a fatura de cartão estimada tem
 * um número, mas o número é extrapolação de ciclo, não evidência. A hachura é
 * exatamente o que o desenho técnico usa para "ainda não definido", e o texto
 * ao lado preserva a palavra original para quem quiser a distinção fina.
 */
const CERTEZA: Record<string, Camada> = {
  contratado: "firme",
  faturado: "firme",
  firme: "firme",
  provavel: "provavel",
  observado: "observado",
  estimado: "indeterminado"
};

const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro"
];

const SEM_CATEGORIA = "__sem_categoria__";

// ---------------------------------------------------------------------------
// Datas e dinheiro
// ---------------------------------------------------------------------------

/** O mês corrente em São Paulo. Em UTC, às 21h do dia 31, já é o mês seguinte. */
function mesCorrente(): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit"
  }).formatToParts(new Date());
  const ano = partes.find((p) => p.type === "year")?.value ?? "2026";
  const mes = partes.find((p) => p.type === "month")?.value ?? "01";
  return `${ano}-${mes}-01`;
}

function deslocarMes(competencia: string, passo: number): string {
  const [ano, mes] = competencia.split("-").map(Number);
  const total = ano * 12 + (mes - 1) + passo;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}-01`;
}

function rotuloMes(competencia: string): string {
  const [ano, mes] = competencia.split("-").map(Number);
  return `${MESES[mes - 1]} de ${ano}`;
}

function rotuloDia(iso: string | null): string {
  if (!iso) return "sem dia";
  const [, mes, dia] = iso.split("-");
  return `${dia}/${mes}`;
}

/** Centavos a partir de "1.350,00" / "1350,00" / "1350.00" / "1350". */
function paraCentavos(texto: string): number | null {
  const limpo = texto.trim().replace(/[R$\s]/g, "");
  if (!limpo) return null;
  // pt-BR: o último separador é o decimal. "1.350,00" → 135000.
  const normalizado = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  const valor = Number(normalizado);
  if (!Number.isFinite(valor)) return null;
  return Math.round(valor * 100);
}

const emReais = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");

/** Delta com sinal: "+R$ 1,00" e "−R$ 1,00" se leem de relance; "R$ -1,00" não. */
const delta = (cents: number) => `${cents >= 0 ? "+" : "−"}${brl(Math.abs(cents))}`;

// ---------------------------------------------------------------------------
// Alvos de confirmação
// ---------------------------------------------------------------------------

type Alvo = { id: number; valorCents?: number } | { competencia: string; origemRef: string; valorCents?: number };

/**
 * Uma linha vira alvo pelo `id` quando já é item, e pelo par
 * `(competência, origemRef)` quando ainda é projeção.
 *
 * A rota resolve as duas formas na MESMA transação. Exigir que a tela
 * materializasse antes abriria uma janela entre as duas chamadas, e um duplo
 * clique nessa janela criaria dois itens para a mesma projeção — a dupla
 * contagem nascendo dentro da tabela feita para evitá-la.
 */
function alvoDe(item: ItemCusto, competencia: string, valorCents?: number): Alvo {
  if (item.itemId !== null) return valorCents === undefined ? { id: item.itemId } : { id: item.itemId, valorCents };
  const base = { competencia, origemRef: item.origemRef ?? "" };
  return valorCents === undefined ? base : { ...base, valorCents };
}

/** Pendente = ninguém confirmou nem ignorou, e há valor para confirmar. */
const pendente = (i: ItemCusto) => i.precedencia !== "confirmado" && i.precedencia !== "ignorado";
const confirmavelEmLote = (i: ItemCusto) => pendente(i) && i.valorCents !== null;

// ---------------------------------------------------------------------------
// Agrupamento
// ---------------------------------------------------------------------------

type Grupo = {
  chave: string;
  code: string | null;
  nome: string | null;
  motivoSemCategoria: string | null;
  itens: ItemCusto[];
  /** Soma só do que `entraNoTotal` — é o subtotal da view, não a soma das linhas. */
  subtotalCents: number;
  participacaoPct: number | null;
  confirmadoCents: number;
  itensConfirmados: number;
  foraDaSomaCents: number;
  foraDaSomaN: number;
  alertas: number;
};

/**
 * Agrupa por categoria a partir dos ITENS, e não da view de categoria.
 *
 * `fin_custo_previsto_categoria_v` só enxerga o que soma — e as 9 recorrentes
 * não confirmadas de setembro têm categoria (5.01, 5.02, 5.05, 6.01, 6.03) e
 * não somam. Montar os grupos pela view faria essas nove sumirem da tela, que é
 * exatamente onde mora a decisão que alguém precisa tomar. Então os grupos
 * nascem dos itens e o subtotal vem da view — cada número da fonte que o define.
 */
function agrupar(itens: ItemCusto[], porCategoria: CategoriaCusto[]): Grupo[] {
  const porCode = new Map(porCategoria.map((k) => [k.code ?? SEM_CATEGORIA, k]));
  const mapa = new Map<string, Grupo>();

  for (const item of itens) {
    const chave = item.categoriaCode ?? SEM_CATEGORIA;
    let grupo = mapa.get(chave);
    if (!grupo) {
      const k = porCode.get(chave);
      grupo = {
        chave,
        code: item.categoriaCode,
        nome: item.categoria ?? k?.nome ?? null,
        motivoSemCategoria: k?.motivoSemCategoria ?? null,
        itens: [],
        subtotalCents: k?.subtotalCents ?? 0,
        participacaoPct: k?.participacaoPct ?? null,
        confirmadoCents: k?.confirmadoCents ?? 0,
        itensConfirmados: k?.itensConfirmados ?? 0,
        foraDaSomaCents: 0,
        foraDaSomaN: 0,
        alertas: 0
      };
      mapa.set(chave, grupo);
    }
    grupo.itens.push(item);
    if (!item.entraNoTotal) {
      grupo.foraDaSomaCents += item.valorCents ?? 0;
      grupo.foraDaSomaN += 1;
    }
    if (item.alerta) grupo.alertas += 1;
  }

  for (const grupo of mapa.values()) {
    // Dia esperado primeiro: dentro de uma categoria, a pergunta é "quando sai".
    grupo.itens.sort(
      (a, b) =>
        (a.diaEsperado ?? "9999").localeCompare(b.diaEsperado ?? "9999") ||
        (b.valorCents ?? 0) - (a.valorCents ?? 0)
    );
  }

  return [...mapa.values()].sort(
    (a, b) => b.subtotalCents - a.subtotalCents || b.foraDaSomaCents - a.foraDaSomaCents
  );
}

// ---------------------------------------------------------------------------
// A tela
// ---------------------------------------------------------------------------

type Aviso = { tipo: "ok" | "erro"; texto: string };

export function FinCustos({ mesInicial, opcoes }: { mesInicial: string | null; opcoes: OpcoesContas }) {
  const [mes, setMes] = useState(() => mesInicial ?? mesCorrente());
  const [dados, setDados] = useState<CustosDoMes | null>(null);
  const [ressalvas, setRessalvas] = useState<string[]>([]);
  const [disponivel, setDisponivel] = useState(true);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [abertas, setAbertas] = useState<Set<string>>(new Set());
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [editando, setEditando] = useState<number | null>(null);
  const [formNovo, setFormNovo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);

  const buscar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/financeiro/gerencial/custos?mes=${mes}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok && !j?.dado) throw new Error(j?.erro ?? `HTTP ${r.status}`);
      setDados(j.dado as CustosDoMes);
      setRessalvas(Array.isArray(j.ressalvas) ? j.ressalvas : []);
      setDisponivel(Boolean(j.disponivel));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "falha ao carregar a previsão de custos");
    } finally {
      setCarregando(false);
    }
  }, [mes]);

  useEffect(() => {
    void buscar();
  }, [buscar]);

  /**
   * Toda escrita passa por aqui — e toda escrita recarrega o mês inteiro.
   *
   * Atualizar a linha no cliente seria mais rápido e estaria errado: confirmar
   * uma projeção cria um item, cala a linha de origem, muda o subtotal da
   * categoria, a participação de TODAS as outras e o confronto. Metade da tela
   * mudando a partir de um clique numa linha é exatamente o caso em que o
   * estado local diverge do banco sem ninguém notar.
   */
  async function escrever(url: string, metodo: string, corpo?: unknown): Promise<Record<string, unknown> | null> {
    setEnviando(true);
    setAviso(null);
    try {
      const r = await fetch(url, {
        method: metodo,
        headers: corpo === undefined ? undefined : { "Content-Type": "application/json" },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
        cache: "no-store"
      });
      const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      if (!r.ok) {
        setAviso({ tipo: "erro", texto: String(j.erro ?? `falha na operação (HTTP ${r.status})`) });
        return null;
      }
      return j;
    } catch (e) {
      setAviso({ tipo: "erro", texto: e instanceof Error ? e.message : "falha de rede" });
      return null;
    } finally {
      setEnviando(false);
    }
  }

  /**
   * Confirma N alvos, em lotes de 200 — o teto que a rota impõe.
   *
   * Um lote por chamada, em série: a rota abre uma transação por chamada e
   * meio lote gravado é pior que lote nenhum quando o assunto é dinheiro.
   * Disparar os pedaços em paralelo trocaria essa garantia por meio segundo.
   */
  async function confirmar(alvos: Alvo[], nota?: string) {
    if (!alvos.length) return;
    let confirmados = 0;
    let ajuste = 0;
    let materializados = 0;
    for (let i = 0; i < alvos.length; i += LOTE_MAXIMO) {
      const pedaco = alvos.slice(i, i + LOTE_MAXIMO);
      const j = await escrever("/api/financeiro/gerencial/custos/confirmar", "POST", {
        itens: pedaco,
        ...(nota ? { nota } : {})
      });
      if (!j) {
        await buscar();
        return;
      }
      confirmados += Number(j.confirmados ?? 0);
      ajuste += Number(j.ajusteCents ?? 0);
      materializados += Number(j.materializados ?? 0);
    }
    setConfirmando(null);
    setAviso({
      tipo: "ok",
      texto:
        `${confirmados} ${confirmados === 1 ? "item confirmado" : "itens confirmados"}` +
        (materializados ? ` · ${materializados} projeção(ões) viraram item (neutro no total)` : "") +
        (ajuste ? ` · a confirmação ajustou o previsto em ${delta(ajuste)}` : "") +
        ". Confirmado não é realizado: continua sendo previsão até o lançamento aparecer no extrato."
    });
    await buscar();
  }

  const grupos = useMemo(
    () => (dados ? agrupar(dados.itens, dados.porCategoria) : []),
    [dados]
  );

  const comAlerta = useMemo(() => (dados ? dados.itens.filter((i) => i.alerta) : []), [dados]);

  /**
   * Os documentos de folha sem contraparte identificada.
   *
   * O alerta de sobreposição casa por `counterparty_id`, então um documento que
   * nasceu com a contraparte nula NÃO acende — e é justamente a terceira folha
   * do mesmo lote do ClickUp. Mostrá-los ao lado do alerta é o que impede que a
   * ausência do selo seja lida como ausência do problema.
   */
  const documentosSemContraparte = useMemo(
    () =>
      dados
        ? dados.itens.filter((i) => i.origemCamada === "pagar_documento" && i.contraparteId === null && i.entraNoTotal)
        : [],
    [dados]
  );

  const pendentesQueSomam = useMemo(
    () => (dados ? dados.itens.filter((i) => confirmavelEmLote(i) && i.entraNoTotal) : []),
    [dados]
  );
  const pendentesQueNaoSomam = useMemo(
    () => (dados ? dados.itens.filter((i) => confirmavelEmLote(i) && !i.entraNoTotal) : []),
    [dados]
  );
  const somaDe = (lista: ItemCusto[]) => lista.reduce((s, i) => s + (i.valorCents ?? 0), 0);

  const ajusteDoMes = useMemo(
    () => (dados ? dados.confronto.reduce((s, f) => s + f.ajusteDaConfirmacaoCents, 0) : 0),
    [dados]
  );

  return (
    <>
      <div className="fin-custo-topo">
        <div className="fin-custo-mes">
          <button type="button" className="fin-btn-ghost fin-btn-mini" onClick={() => setMes((m) => deslocarMes(m, -1))}>
            ← mês anterior
          </button>
          <strong>{rotuloMes(mes)}</strong>
          <button type="button" className="fin-btn-ghost fin-btn-mini" onClick={() => setMes((m) => deslocarMes(m, 1))}>
            mês seguinte →
          </button>
          <input
            type="month"
            className="fin-select fin-select-inline"
            value={mes.slice(0, 7)}
            onChange={(e) => (e.target.value ? setMes(`${e.target.value}-01`) : null)}
            aria-label="Competência"
          />
          {mes !== mesCorrente() ? (
            <button type="button" className="fin-btn-ghost fin-btn-mini" onClick={() => setMes(mesCorrente())}>
              hoje
            </button>
          ) : null}
        </div>
        <button type="button" className="fin-btn-primary" onClick={() => setFormNovo((v) => !v)}>
          {formNovo ? "Fechar" : "Adicionar custo"}
        </button>
      </div>

      {erro ? <div className="fin-alert-forte">Falha ao carregar: {erro}</div> : null}
      {!disponivel && !erro ? (
        <div className="fin-alert">
          Banco do financeiro indisponível. A tela mostra o que sabe — nenhum número foi inventado no lugar do que
          falta.
        </div>
      ) : null}
      {aviso ? <div className={aviso.tipo === "ok" ? "fin-custo-recado ok" : "fin-alert"}>{aviso.texto}</div> : null}

      {formNovo ? (
        <FormNovoCusto
          competencia={mes}
          opcoes={opcoes}
          enviando={enviando}
          onCriar={async (corpos) => {
            let criados = 0;
            for (const corpo of corpos) {
              const j = await escrever("/api/financeiro/gerencial/custos", "POST", corpo);
              if (!j) break;
              criados += 1;
            }
            if (criados) {
              setAviso({
                tipo: "ok",
                texto:
                  `${criados} de ${corpos.length} ${corpos.length === 1 ? "item criado" : "itens criados"}. ` +
                  "Item manual soma por cima da projeção — ele não duplica camada nenhuma. Se este gasto já é " +
                  "projetado por recorrente, documento ou fatura, confirme aquela linha em vez de manter esta."
              });
              setFormNovo(false);
              await buscar();
            }
            return criados === corpos.length;
          }}
        />
      ) : null}

      {carregando && !dados ? <p className="fin-empty-row">Carregando a previsão de {rotuloMes(mes)}…</p> : null}

      {dados ? (
        <>
          <div className="medida-grade fin-custo-medidas">
            <Medida
              rotulo="Custo previsto do mês"
              valorCents={dados.totalCents}
              detalhe={`${dados.itens.filter((i) => i.entraNoTotal).length} linhas somam · uma por dinheiro`}
            />
            <Medida
              rotulo="Confirmado"
              valorCents={dados.confirmadoCents}
              cobertura={dados.totalCents ? dados.confirmadoCents / dados.totalCents : undefined}
              detalhe={`${dados.itens.filter((i) => i.precedencia === "confirmado").length} de ${
                dados.itens.filter((i) => i.entraNoTotal).length
              } linhas · confirmar não adianta caixa`}
            />
            <Medida
              rotulo="Falta confirmar"
              valorCents={dados.aConfirmarCents}
              detalhe={`${pendentesQueSomam.length} ${pendentesQueSomam.length === 1 ? "linha" : "linhas"} que já somam`}
            />
            {dados.foraDaSomaCents ? (
              <Medida
                rotulo="Existe e não soma"
                valorCents={dados.foraDaSomaCents}
                detalhe={`${dados.itens.filter((i) => !i.entraNoTotal).length} linhas, cada uma com o motivo ao lado`}
              />
            ) : null}
            {dados.realizadoCents === null ? (
              <Medida
                rotulo="Realizado nesta competência"
                valorCents={null}
                motivo="nenhum lançamento de saída nesta competência — ausência de dado, não zero"
              />
            ) : (
              <Medida
                rotulo="Realizado nesta competência"
                valorCents={dados.realizadoCents}
                detalhe="o que o extrato já registrou · comparação, nunca junção"
              />
            )}
            {ajusteDoMes ? (
              <Medida
                rotulo="Ajuste da confirmação"
                valorCents={ajusteDoMes}
                detalhe="quanto quem confirmou corrigiu a projeção — o erro dela, medido item a item"
              />
            ) : null}
            {dados.itensIndeterminados ? (
              <Medida
                rotulo="Sem valor conhecido"
                valorCents={null}
                motivo={`${dados.itensIndeterminados} ${
                  dados.itensIndeterminados === 1 ? "item declara" : "itens declaram"
                } que não se sabe quanto — e por isso ficam fora de toda soma`}
              />
            ) : null}
          </div>

          {ressalvas.map((frase) => (
            <Ressalva key={frase}>{frase}</Ressalva>
          ))}

          {comAlerta.length || documentosSemContraparte.length ? (
            <BlocoSobreposicao itens={comAlerta} semContraparte={documentosSemContraparte} />
          ) : null}

          {pendentesQueSomam.length || pendentesQueNaoSomam.length ? (
            <div className="fin-custo-lote">
              {pendentesQueSomam.length ? (
                <div className="fin-custo-lote-acao">
                  <button
                    type="button"
                    className="fin-btn-primary"
                    disabled={enviando}
                    onClick={() => void confirmar(pendentesQueSomam.map((i) => alvoDe(i, mes)))}
                  >
                    Confirmar todos os {pendentesQueSomam.length} do mês
                  </button>
                  <span className="fin-card-hint">
                    {brl(somaDe(pendentesQueSomam))} pelo valor de face. O total do mês <strong>não muda</strong> — o
                    que muda é que passa a existir quem assinou cada linha.
                  </span>
                </div>
              ) : null}
              {pendentesQueNaoSomam.length ? (
                <div className="fin-custo-lote-acao">
                  <button
                    type="button"
                    className="fin-btn-ghost"
                    disabled={enviando}
                    onClick={() => void confirmar(pendentesQueNaoSomam.map((i) => alvoDe(i, mes)))}
                  >
                    Confirmar os {pendentesQueNaoSomam.length} que hoje não somam
                  </button>
                  <span className="fin-card-hint">
                    Sobe o total do mês em <strong>{brl(somaDe(pendentesQueNaoSomam))}</strong>. São recorrentes ainda
                    propostas: confirmar vale <em>só para este mês</em> e não ativa a recorrente nos demais.
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}

          {grupos.length ? (
            grupos.map((grupo) => (
              <GrupoCategoria
                key={grupo.chave}
                grupo={grupo}
                competencia={mes}
                aberta={abertas.has(grupo.chave)}
                enviando={enviando}
                confirmando={confirmando}
                editando={editando}
                opcoes={opcoes}
                onAlternar={() =>
                  setAbertas((s) => {
                    const proximo = new Set(s);
                    if (proximo.has(grupo.chave)) proximo.delete(grupo.chave);
                    else proximo.add(grupo.chave);
                    return proximo;
                  })
                }
                onConfirmarGrupo={(lista) => void confirmar(lista.map((i) => alvoDe(i, mes)))}
                onAbrirConfirmacao={(chave) => setConfirmando(chave)}
                onFecharConfirmacao={() => setConfirmando(null)}
                onConfirmarItem={(item, valorCents, nota) =>
                  void confirmar([alvoDe(item, mes, valorCents ?? undefined)], nota ?? undefined)
                }
                onAbrirEdicao={(id) => setEditando(id)}
                onFecharEdicao={() => setEditando(null)}
                onPatch={async (id, corpo) => {
                  const j = await escrever(`/api/financeiro/gerencial/custos/${id}`, "PATCH", corpo);
                  if (j) {
                    setEditando(null);
                    setAviso({
                      tipo: "ok",
                      texto: Array.isArray(j.alterados) && (j.alterados as string[]).includes("ignorar")
                        ? "Item ignorado: sai do total e continua visível, com o motivo. A projeção que o originou NÃO ressuscita — ignorar é decisão sobre o dinheiro, não um desfazer."
                        : `Item ${id} atualizado.`
                    });
                    await buscar();
                  }
                }}
                onApagar={async (id) => {
                  const j = await escrever(`/api/financeiro/gerencial/custos/${id}`, "DELETE");
                  if (j) {
                    setEditando(null);
                    setAviso({ tipo: "ok", texto: `Item ${id} apagado. Só item manual e não realizado chega aqui.` });
                    await buscar();
                  }
                }}
              />
            ))
          ) : !carregando ? (
            <section className="card fin-empty">
              <h2 className="card-title">Nada previsto em {rotuloMes(mes)}</h2>
              <p>
                Nenhuma camada de projeção alcança esta competência e ninguém criou item manual. Se o mês é passado, a
                projeção é uma curva de caixa que começa hoje e não olha para trás — o que já saiu está no extrato, e o
                confronto abaixo é onde ele se lê.
              </p>
            </section>
          ) : null}

          <TabelaConfronto confronto={dados.confronto} competencia={mes} />
        </>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// O alerta de sobreposição — em destaque, porque ele custa dinheiro de verdade
// ---------------------------------------------------------------------------

/**
 * Duas origens projetando a mesma contraparte no mesmo mês.
 *
 * O alerta NÃO suprime nada e nem deveria: pode ser um aluguel e uma multa do
 * mesmo locador (dois custos legítimos) ou o mesmo dinheiro contado duas vezes.
 * Quem sabe é o humano. O que a tela faz é recusar-se a esconder a coincidência
 * e mostrar, ao lado, quanto estaria em duplicidade se for o mesmo dinheiro:
 * a soma do grupo menos a maior linha dele.
 */
function BlocoSobreposicao({ itens, semContraparte }: { itens: ItemCusto[]; semContraparte: ItemCusto[] }) {
  const grupos = useMemo(() => {
    const mapa = new Map<number, ItemCusto[]>();
    for (const item of itens) {
      if (item.contraparteId === null) continue;
      const lista = mapa.get(item.contraparteId);
      if (lista) lista.push(item);
      else mapa.set(item.contraparteId, [item]);
    }
    return [...mapa.entries()]
      .map(([id, lista]) => {
        const total = lista.reduce((s, i) => s + (i.valorCents ?? 0), 0);
        const maior = lista.reduce((m, i) => Math.max(m, i.valorCents ?? 0), 0);
        return { id, nome: lista[0].contraparte ?? `contraparte ${id}`, lista, excedente: total - maior };
      })
      .sort((a, b) => b.excedente - a.excedente);
  }, [itens]);

  const excedente = grupos.reduce((s, g) => s + g.excedente, 0);

  return (
    <section className="fin-custo-alerta">
      <h2>
        Sobreposição: a mesma contraparte projetada por mais de uma origem
        {excedente ? <em>até {brl(excedente)} em duplicidade potencial</em> : null}
      </h2>
      <p>
        Esta é uma dupla contagem <strong>anterior</strong> a esta tela e ela não foi corrigida aqui: escolher qual das
        duas camadas cala é decisão sobre a composição da saída — o documento tem o valor contratado, a folha tem o
        histórico. O que o banco faz é se recusar a esconder a coincidência.
      </p>

      {grupos.map((grupo) => (
        <div key={grupo.id} className="fin-custo-alerta-par">
          <strong>{grupo.nome}</strong>
          <ul>
            {grupo.lista.map((item) => (
              <li key={item.chaveDedupe}>
                <span className="fin-tag">{CAMADA[item.origemCamada ?? ""] ?? item.origemCamada ?? "manual"}</span>
                <span>{item.descricao}</span>
                <span className="fin-custo-alerta-valor">{item.valorCents === null ? "—" : brl(item.valorCents)}</span>
              </li>
            ))}
          </ul>
          {grupo.excedente ? (
            <span className="fin-custo-alerta-excedente">
              se for o mesmo dinheiro, {brl(grupo.excedente)} está contado duas vezes neste mês
            </span>
          ) : null}
        </div>
      ))}

      {semContraparte.length ? (
        <p className="fin-custo-alerta-escape">
          <strong>E o alerta não pega tudo.</strong> Ele casa por contraparte, então{" "}
          {semContraparte.length === 1 ? "o documento" : `os ${semContraparte.length} documentos`} abaixo{" "}
          {semContraparte.length === 1 ? "escapa" : "escapam"} dele por ter nascido sem contraparte identificada —
          ausência de selo aqui não é ausência do problema:{" "}
          {semContraparte.map((i) => `${i.descricao} (${i.valorCents === null ? "sem valor" : brl(i.valorCents)})`).join(" · ")}.
        </p>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Uma categoria, com subtotal, participação e os itens dentro
// ---------------------------------------------------------------------------

function GrupoCategoria({
  grupo,
  competencia,
  aberta,
  enviando,
  confirmando,
  editando,
  opcoes,
  onAlternar,
  onConfirmarGrupo,
  onAbrirConfirmacao,
  onFecharConfirmacao,
  onConfirmarItem,
  onAbrirEdicao,
  onFecharEdicao,
  onPatch,
  onApagar
}: {
  grupo: Grupo;
  competencia: string;
  aberta: boolean;
  enviando: boolean;
  confirmando: string | null;
  editando: number | null;
  opcoes: OpcoesContas;
  onAlternar: () => void;
  onConfirmarGrupo: (itens: ItemCusto[]) => void;
  onAbrirConfirmacao: (chave: string) => void;
  onFecharConfirmacao: () => void;
  onConfirmarItem: (item: ItemCusto, valorCents: number | null, nota: string | null) => void;
  onAbrirEdicao: (id: number) => void;
  onFecharEdicao: () => void;
  onPatch: (id: number, corpo: Record<string, unknown>) => Promise<void>;
  onApagar: (id: number) => Promise<void>;
}) {
  const pendentes = grupo.itens.filter(confirmavelEmLote);
  const pendentesForaDaSoma = pendentes.filter((i) => !i.entraNoTotal);
  const subiria = pendentesForaDaSoma.reduce((s, i) => s + (i.valorCents ?? 0), 0);

  return (
    <section className="card fin-custo-grupo">
      <button
        type="button"
        className="fin-custo-grupo-cab"
        onClick={onAlternar}
        aria-expanded={aberta}
      >
        <span className="fin-custo-grupo-nome">
          <span className="fin-custo-seta" aria-hidden="true">
            {aberta ? "▾" : "▸"}
          </span>
          {grupo.code ? <span className="fin-code">{grupo.code}</span> : null}
          <strong>{grupo.nome ?? "sem categoria"}</strong>
          <span className="fin-custo-grupo-n">
            {grupo.itens.length} {grupo.itens.length === 1 ? "item" : "itens"}
          </span>
          {grupo.alertas ? <span className="fin-badge-atencao">{grupo.alertas} com alerta</span> : null}
        </span>
        <span className="fin-custo-grupo-num">
          <strong>{brl(grupo.subtotalCents)}</strong>
          {grupo.participacaoPct !== null ? (
            <span className="fin-custo-part" title={`${grupo.participacaoPct}% do custo previsto do mês`}>
              <i style={{ width: `${Math.min(100, Math.max(2, grupo.participacaoPct))}%` }} />
              <em>{grupo.participacaoPct}%</em>
            </span>
          ) : null}
          {grupo.foraDaSomaCents ? (
            <span className="fin-custo-grupo-fora">+ {brl(grupo.foraDaSomaCents)} que não soma</span>
          ) : null}
        </span>
      </button>

      {grupo.motivoSemCategoria ? <p className="fin-custo-motivo">{grupo.motivoSemCategoria}</p> : null}

      {aberta ? (
        <>
          {pendentes.length ? (
            <div className="fin-custo-grupo-acoes">
              <button
                type="button"
                className="fin-btn-primary fin-btn-mini"
                disabled={enviando}
                onClick={() => onConfirmarGrupo(pendentes)}
              >
                Confirmar os {pendentes.length} desta categoria
              </button>
              <span className="fin-card-hint">
                {subiria
                  ? `${brl(subiria)} desses ainda não somam — confirmá-los sobe o total do mês nesse valor.`
                  : "pelo valor de face; o total do mês não muda."}
              </span>
            </div>
          ) : null}

          <table className="fin-table fin-custo-tabela">
            <thead>
              <tr>
                <th>Dia</th>
                <th>Contraparte</th>
                <th>Descrição e origem</th>
                <th className="num">Previsto</th>
                <th>Estado</th>
                <th>Certeza</th>
                <th aria-label="Ações" />
              </tr>
            </thead>
            <tbody>
              {grupo.itens.map((item) =>
                item.itemId !== null && editando === item.itemId ? (
                  <LinhaEdicao
                    key={item.chaveDedupe}
                    item={item}
                    opcoes={opcoes}
                    enviando={enviando}
                    onCancelar={onFecharEdicao}
                    onSalvar={(corpo) => onPatch(item.itemId as number, corpo)}
                    onApagar={() => onApagar(item.itemId as number)}
                  />
                ) : (
                  <LinhaItem
                    key={item.chaveDedupe}
                    item={item}
                    competencia={competencia}
                    enviando={enviando}
                    confirmandoAqui={confirmando === item.chaveDedupe}
                    onAbrirConfirmacao={() => onAbrirConfirmacao(item.chaveDedupe)}
                    onFecharConfirmacao={onFecharConfirmacao}
                    onConfirmar={(valorCents, nota) => onConfirmarItem(item, valorCents, nota)}
                    onEditar={() => (item.itemId !== null ? onAbrirEdicao(item.itemId) : undefined)}
                    onReativar={() => onPatch(item.itemId as number, { reativar: true })}
                    onIgnorar={(motivo) => onPatch(item.itemId as number, { ignorar: motivo })}
                  />
                )
              )}
            </tbody>
          </table>
        </>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Uma linha
// ---------------------------------------------------------------------------

function LinhaItem({
  item,
  competencia,
  enviando,
  confirmandoAqui,
  onAbrirConfirmacao,
  onFecharConfirmacao,
  onConfirmar,
  onEditar,
  onReativar,
  onIgnorar
}: {
  item: ItemCusto;
  competencia: string;
  enviando: boolean;
  confirmandoAqui: boolean;
  onAbrirConfirmacao: () => void;
  onFecharConfirmacao: () => void;
  onConfirmar: (valorCents: number | null, nota: string | null) => void;
  onEditar: () => void;
  onReativar: () => void;
  onIgnorar: (motivo: string) => void;
}) {
  const [ignorando, setIgnorando] = useState(false);
  const camada = item.origemCamada ? CAMADA[item.origemCamada] ?? item.origemCamada : null;
  const ajustado =
    item.previstoCents !== null && item.confirmadoCents !== null && item.previstoCents !== item.confirmadoCents;

  return (
    <>
      <tr className={item.entraNoTotal ? undefined : "fin-custo-nao-soma"}>
        <td className="fin-nowrap">
          {rotuloDia(item.diaEsperado)}
          {item.diaEsperado && item.diaEsperado.slice(0, 7) !== competencia.slice(0, 7) ? (
            <span className="fin-custo-outro-mes" title="a saída de caixa cai fora da competência">
              caixa em {item.diaEsperado.slice(0, 7)}
            </span>
          ) : null}
        </td>
        <td>{item.contraparte ?? <span className="fin-zero">sem contraparte</span>}</td>
        <td>
          <span className="fin-desc">{item.descricao}</span>
          <span className="fin-custo-origem">
            {item.procedencia === "projetado"
              ? `projeção · ${camada ?? "camada não declarada"}`
              : item.origem === "manual"
                ? "criado à mão nesta tela"
                : `item derivado de ${camada ?? "camada não declarada"}`}
            {item.origemRef ? <code title="a chave que amarra item e projeção">{item.origemRef}</code> : null}
          </span>
          {item.diaRegra ? <span className="fin-custo-regra">{item.diaRegra}</span> : null}
          {item.alerta ? <span className="fin-custo-alerta-linha">{item.alerta}</span> : null}
          {!item.entraNoTotal && item.motivoForaDaSoma ? (
            <span className="fin-custo-motivo-linha">não soma: {item.motivoForaDaSoma}</span>
          ) : null}
          {ajustado ? (
            <span className="fin-custo-delta">
              previsto {brl(item.previstoCents as number)} → confirmado {brl(item.confirmadoCents as number)} ·{" "}
              {delta((item.confirmadoCents as number) - (item.previstoCents as number))}
            </span>
          ) : null}
          {item.confirmadoPor ? (
            <span className="fin-custo-assinatura">
              confirmado por {item.confirmadoPor}
              {item.confirmadoEm ? ` em ${item.confirmadoEm.slice(0, 10)}` : ""}
            </span>
          ) : null}
        </td>
        <td className="num fin-table-money">
          {item.valorCents === null ? (
            <span className="cert-selo" data-cert="indeterminado">
              sem valor
            </span>
          ) : (
            brl(item.valorCents)
          )}
        </td>
        <td className="fin-nowrap">
          <EstadoTag item={item} />
        </td>
        <td className="fin-nowrap">
          {item.confianca ? (
            <SeloCamada
              camada={CERTEZA[item.confianca] ?? "indeterminado"}
              texto={CERTEZA[item.confianca] === item.confianca ? undefined : item.confianca}
            />
          ) : (
            <span className="fin-zero">—</span>
          )}
        </td>
        <td className="fin-nowrap fin-custo-acoes">
          {pendente(item) ? (
            <button
              type="button"
              className="fin-btn-primary fin-btn-mini"
              disabled={enviando}
              onClick={confirmandoAqui ? onFecharConfirmacao : onAbrirConfirmacao}
            >
              {confirmandoAqui ? "fechar" : "confirmar"}
            </button>
          ) : null}
          {item.itemId !== null && item.estado !== "realizado" && item.estado !== "ignorado" ? (
            <button type="button" className="fin-btn-ghost fin-btn-mini" disabled={enviando} onClick={onEditar}>
              editar
            </button>
          ) : null}
          {item.itemId !== null && item.estado !== "realizado" && item.estado !== "ignorado" ? (
            <button
              type="button"
              className="fin-btn-ghost fin-btn-mini"
              disabled={enviando}
              onClick={() => setIgnorando((v) => !v)}
            >
              ignorar
            </button>
          ) : null}
          {item.itemId !== null && item.estado === "ignorado" ? (
            <button type="button" className="fin-btn-ghost fin-btn-mini" disabled={enviando} onClick={onReativar}>
              reativar
            </button>
          ) : null}
        </td>
      </tr>

      {confirmandoAqui ? (
        <FormConfirmacao item={item} enviando={enviando} onCancelar={onFecharConfirmacao} onConfirmar={onConfirmar} />
      ) : null}

      {ignorando && item.itemId !== null ? (
        <FormIgnorar
          enviando={enviando}
          onCancelar={() => setIgnorando(false)}
          onIgnorar={(motivo) => {
            setIgnorando(false);
            onIgnorar(motivo);
          }}
        />
      ) : null}
    </>
  );
}

function EstadoTag({ item }: { item: ItemCusto }) {
  if (item.procedencia === "projetado") {
    return (
      <span className="fin-tag" title="ainda é projeção: não existe item para editar ou ignorar até alguém confirmar">
        projeção
      </span>
    );
  }
  if (item.estado === "confirmado") return <span className="fin-badge-ok">confirmado</span>;
  if (item.estado === "realizado") return <span className="fin-badge-ok">realizado</span>;
  if (item.estado === "ignorado") return <span className="fin-badge-pendente">ignorado</span>;
  return <span className="fin-tag">previsto</span>;
}

// ---------------------------------------------------------------------------
// Confirmar uma linha — com ajuste de valor
// ---------------------------------------------------------------------------

/**
 * O campo do valor vem preenchido com o previsto e é editável.
 *
 * Confirmar sem poder ajustar obrigaria quem sabe o número certo a confirmar o
 * errado e corrigir depois — e a correção posterior apagaria justamente o sinal
 * que interessa: `valor_previsto_cents` e `valor_confirmado_cents` moram em
 * colunas separadas porque a diferença entre eles é a única aferição item a
 * item que esta base tem da previsão de saída.
 */
function FormConfirmacao({
  item,
  enviando,
  onCancelar,
  onConfirmar
}: {
  item: ItemCusto;
  enviando: boolean;
  onCancelar: () => void;
  onConfirmar: (valorCents: number | null, nota: string | null) => void;
}) {
  const [valor, setValor] = useState(item.valorCents === null ? "" : emReais(item.valorCents));
  const [nota, setNota] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const centavos = paraCentavos(valor);
  const diferenca = centavos !== null && item.previstoCents !== null ? centavos - item.previstoCents : 0;

  return (
    <tr className="fin-linha-edicao">
      <td colSpan={7}>
        <div className="fin-custo-conf">
          <label className="fin-field">
            <span>Valor confirmado</span>
            <input
              className="fin-input fin-input-valor"
              inputMode="decimal"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              placeholder="1.350,00"
              autoFocus
            />
            <em className="fin-field-hint">
              {item.previstoCents === null
                ? "este item não tem valor previsto — confirmar exige informar um, porque confirmar sem número seria inventá-lo"
                : diferenca
                  ? `a projeção dizia ${brl(item.previstoCents)} · ajuste de ${delta(diferenca)}`
                  : "igual ao previsto"}
            </em>
          </label>
          <label className="fin-field fin-field-wide">
            <span>Nota (opcional)</span>
            <input
              className="fin-input"
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="conferido no contrato, boleto chegou com reajuste…"
            />
          </label>
          <div className="fin-form-acoes">
            <button
              type="button"
              className="fin-btn-primary fin-btn-mini"
              disabled={enviando}
              onClick={() => {
                setErro(null);
                if (valor.trim() && centavos === null) return setErro("valor não reconhecido");
                if (centavos !== null && centavos < 0) return setErro("valor não pode ser negativo");
                if (item.previstoCents === null && centavos === null) {
                  return setErro("informe o valor: este item declara que não se sabe quanto");
                }
                onConfirmar(
                  centavos !== null && centavos !== item.previstoCents ? centavos : null,
                  nota.trim() || null
                );
              }}
            >
              confirmar
            </button>
            <button type="button" className="fin-btn-ghost fin-btn-mini" onClick={onCancelar}>
              cancelar
            </button>
          </div>
          {erro ? <p className="fin-alert">{erro}</p> : null}
          <p className="fin-custo-conf-nota">
            Confirmar carimba autor e hora e <strong>não</strong> cria lançamento nem mexe em saldo. O item continua
            sendo previsão até o dinheiro sair do extrato.
            {item.procedencia === "projetado"
              ? " Esta linha ainda é projeção: ela vira item na mesma transação, e materializar por si só não muda o total do mês."
              : ""}
          </p>
        </div>
      </td>
    </tr>
  );
}

/** Ignorar exige motivo — aqui, na rota e no CHECK do banco. */
function FormIgnorar({
  enviando,
  onCancelar,
  onIgnorar
}: {
  enviando: boolean;
  onCancelar: () => void;
  onIgnorar: (motivo: string) => void;
}) {
  const [motivo, setMotivo] = useState("");

  return (
    <tr className="fin-linha-edicao">
      <td colSpan={7}>
        <div className="fin-custo-conf">
          <label className="fin-field fin-field-wide">
            <span>Por que ignorar</span>
            <input
              className="fin-input"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="contrato encerrado em agosto · já pago pelo cartão · duplica o documento 26349"
              autoFocus
            />
            <em className="fin-field-hint">
              Obrigatório. Item derivado não se apaga: ele voltaria na próxima leitura da projeção e o apagamento teria
              destruído exatamente o que o apagamento produziu — a nota de quem decidiu tirá-lo.
            </em>
          </label>
          <div className="fin-form-acoes">
            <button
              type="button"
              className="fin-btn-ghost fin-btn-mini fin-btn-perigo"
              disabled={enviando || !motivo.trim()}
              onClick={() => onIgnorar(motivo.trim())}
            >
              ignorar item
            </button>
            <button type="button" className="fin-btn-ghost fin-btn-mini" onClick={onCancelar}>
              cancelar
            </button>
          </div>
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Editar
// ---------------------------------------------------------------------------

/**
 * O que NÃO aparece aqui, e por quê.
 *
 * `origemRef` e `competencia` não são editáveis — mudar o primeiro faria o item
 * calar uma projeção que não o originou (dinheiro real sumindo do mês sem que
 * nenhuma linha diga que sumiu); mudar o segundo moveria o custo de mês sem
 * trilha de que mês ele veio. `estado` também não: confirmar tem rota própria e
 * ignorar tem motivo obrigatório. Um campo de estado genérico seria o caminho
 * por onde `realizado` entraria sem lançamento no extrato.
 */
function LinhaEdicao({
  item,
  opcoes,
  enviando,
  onCancelar,
  onSalvar,
  onApagar
}: {
  item: ItemCusto;
  opcoes: OpcoesContas;
  enviando: boolean;
  onCancelar: () => void;
  onSalvar: (corpo: Record<string, unknown>) => Promise<void>;
  onApagar: () => Promise<void>;
}) {
  const [descricao, setDescricao] = useState(item.descricao);
  const [valor, setValor] = useState(item.previstoCents === null ? "" : emReais(item.previstoCents));
  const [categoria, setCategoria] = useState(item.categoriaCode ?? "");
  const [dia, setDia] = useState(item.diaEsperado ?? "");
  const [contraparte, setContraparte] = useState(item.contraparte ?? "");
  const [erro, setErro] = useState<string | null>(null);

  const casada = opcoes.contrapartes.find((c) => c.name.toLowerCase() === contraparte.trim().toLowerCase());

  return (
    <tr className="fin-linha-edicao">
      <td colSpan={7}>
        <div className="fin-custo-conf">
          <label className="fin-field fin-field-wide">
            <span>Descrição</span>
            <input className="fin-input" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
          </label>
          <label className="fin-field">
            <span>Valor previsto</span>
            <input
              className="fin-input fin-input-valor"
              inputMode="decimal"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
            />
          </label>
          <label className="fin-field">
            <span>Categoria</span>
            <select className="fin-select" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
              <option value="">Sem categoria</option>
              {opcoes.categorias
                .filter((c) => c.kind !== "receita" && c.kind !== "deducao_receita")
                .map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} · {c.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="fin-field">
            <span>Dia esperado de caixa</span>
            <input className="fin-select" type="date" value={dia} onChange={(e) => setDia(e.target.value)} />
          </label>
          <label className="fin-field">
            <span>Contraparte</span>
            <input
              className="fin-input"
              list="fin-custo-contrapartes"
              value={contraparte}
              onChange={(e) => setContraparte(e.target.value)}
            />
            <em className="fin-field-hint">
              {contraparte.trim() && !casada
                ? "nome fora do cadastro — a contraparte fica em branco em vez de nascer inventada"
                : "só contrapartes já cadastradas"}
            </em>
          </label>

          <div className="fin-form-acoes">
            <button
              type="button"
              className="fin-btn-primary fin-btn-mini"
              disabled={enviando}
              onClick={() => {
                setErro(null);
                const centavos = paraCentavos(valor);
                if (!descricao.trim()) return setErro("descrição não pode ficar vazia");
                if (valor.trim() && centavos === null) return setErro("valor não reconhecido");
                const corpo: Record<string, unknown> = { descricao: descricao.trim() };
                if (centavos !== item.previstoCents) corpo.valorCents = centavos;
                if ((categoria || null) !== item.categoriaCode) corpo.categoria = categoria || null;
                if ((dia || null) !== item.diaEsperado) corpo.diaEsperado = dia || null;
                if ((casada?.id ?? null) !== item.contraparteId) corpo.contraparte = casada?.id ?? null;
                void onSalvar(corpo);
              }}
            >
              salvar
            </button>
            <button type="button" className="fin-btn-ghost fin-btn-mini" onClick={onCancelar}>
              cancelar
            </button>
            {item.origem === "manual" ? (
              <button
                type="button"
                className="fin-btn-ghost fin-btn-mini fin-btn-perigo"
                disabled={enviando}
                onClick={() => void onApagar()}
              >
                apagar
              </button>
            ) : (
              <span className="fin-card-hint">
                Item derivado não se apaga — use <strong>ignorar</strong>, com motivo. Item realizado não se apaga nem
                se edita: o lançamento já existe e a previsão está fechada.
              </span>
            )}
          </div>
          {erro ? <p className="fin-alert">{erro}</p> : null}
          <datalist id="fin-custo-contrapartes">
            {opcoes.contrapartes.map((c) => (
              <option key={c.id} value={c.name} />
            ))}
          </datalist>
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Adicionar item manual — por onde a lacuna de cobertura se fecha
// ---------------------------------------------------------------------------

/**
 * "Repete" cria UM ITEM POR MÊS, e não uma recorrência.
 *
 * A diferença é a mesma que a dúvida 33 aponta: ativar uma recorrente é uma
 * decisão sobre todos os meses futuros, e ninguém deve tomá-la por engano ao
 * cadastrar setembro. Doze itens independentes se confirmam, ajustam e ignoram
 * um a um, no mês de cada um — que é como o resto desta tela funciona.
 */
function FormNovoCusto({
  competencia,
  opcoes,
  enviando,
  onCriar
}: {
  competencia: string;
  opcoes: OpcoesContas;
  enviando: boolean;
  onCriar: (corpos: Record<string, unknown>[]) => Promise<boolean>;
}) {
  const [descricao, setDescricao] = useState("");
  const [categoria, setCategoria] = useState("");
  const [nucleo, setNucleo] = useState("");
  const [contraparte, setContraparte] = useState("");
  const [valor, setValor] = useState("");
  const [motivoSemValor, setMotivoSemValor] = useState("");
  const [dia, setDia] = useState("");
  const [meses, setMeses] = useState(1);
  const [erro, setErro] = useState<string | null>(null);

  const casada = opcoes.contrapartes.find((c) => c.name.toLowerCase() === contraparte.trim().toLowerCase());
  const centavos = paraCentavos(valor);

  return (
    <section className="card fin-form-novo">
      <h2 className="card-title">Adicionar custo previsto</h2>
      <p className="fin-card-hint">
        É por aqui que entra o gasto que nenhuma camada consegue derivar: sem recorrente, sem documento, sem fatura. Um
        item manual <strong>soma por cima</strong> da projeção porque não duplica nada — se o gasto já é projetado por
        alguma camada, o caminho certo é confirmar aquela linha ajustando o valor, e não criar uma segunda aqui.
      </p>

      <div className="fin-form-grid">
        <label className="fin-field fin-field-wide">
          <span>Descrição</span>
          <input
            className="fin-input"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="Manutenção do veículo da equipe de obra"
          />
        </label>

        <label className="fin-field">
          <span>Categoria</span>
          <select className="fin-select" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
            <option value="">Sem categoria</option>
            {opcoes.categorias
              .filter((c) => c.kind !== "receita" && c.kind !== "deducao_receita")
              .map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} · {c.name}
                </option>
              ))}
          </select>
        </label>

        <label className="fin-field">
          <span>Contraparte</span>
          <input
            className="fin-input"
            list="fin-custo-contrapartes-novo"
            value={contraparte}
            onChange={(e) => setContraparte(e.target.value)}
            placeholder="Quem recebe"
          />
          <datalist id="fin-custo-contrapartes-novo">
            {opcoes.contrapartes.map((c) => (
              <option key={c.id} value={c.name} />
            ))}
          </datalist>
          <em className="fin-field-hint">
            {contraparte.trim() && !casada
              ? "fora do cadastro — o item nasce sem contraparte em vez de nascer com uma inventada"
              : "opcional · só o cadastro existente"}
          </em>
        </label>

        <label className="fin-field">
          <span>Núcleo</span>
          <select className="fin-select" value={nucleo} onChange={(e) => setNucleo(e.target.value)}>
            <option value="">Sem núcleo</option>
            {opcoes.nucleos.map((n) => (
              <option key={n.slug} value={n.slug}>
                {n.name}
              </option>
            ))}
          </select>
        </label>

        <label className="fin-field">
          <span>Valor</span>
          <input
            className="fin-input"
            inputMode="decimal"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            placeholder="8.000,00"
          />
        </label>

        <label className="fin-field">
          <span>Dia esperado de caixa</span>
          <input className="fin-select" type="date" value={dia} onChange={(e) => setDia(e.target.value)} />
          <em className="fin-field-hint">quando o dinheiro sai; pode cair fora da competência</em>
        </label>

        <label className="fin-field">
          <span>Repete</span>
          <select className="fin-select" value={meses} onChange={(e) => setMeses(Number(e.target.value))}>
            <option value={1}>só nesta competência</option>
            <option value={3}>por 3 meses</option>
            <option value={6}>por 6 meses</option>
            <option value={12}>por 12 meses</option>
          </select>
          <em className="fin-field-hint">
            {meses === 1
              ? "um item"
              : `cria ${meses} itens independentes, um por mês — cada um se confirma no seu mês`}
          </em>
        </label>

        <label className="fin-field fin-field-wide">
          <span>Se não souber o valor, diga por quê</span>
          <input
            className="fin-input"
            value={motivoSemValor}
            onChange={(e) => setMotivoSemValor(e.target.value)}
            placeholder="orçamento pedido ao fornecedor, ainda sem resposta"
          />
          <em className="fin-field-hint">
            Um item sem valor aparece na tela, declara que não se sabe quanto e fica fora de toda soma. Um número
            plausível ali seria pior que o vazio — o vazio se vê.
          </em>
        </label>
      </div>

      {erro ? (
        <p className="fin-alert" role="alert">
          {erro}
        </p>
      ) : null}

      <div className="fin-form-acoes">
        <button
          type="button"
          className="fin-btn-primary"
          disabled={enviando}
          onClick={() => {
            setErro(null);
            if (!descricao.trim()) return setErro("informe a descrição — item sem nome é item que ninguém revisa");
            if (valor.trim() && centavos === null) return setErro("valor não reconhecido");
            if (centavos === null && !motivoSemValor.trim()) {
              return setErro("sem valor é obrigatório declarar o motivo");
            }
            if (centavos !== null && centavos <= 0) {
              return setErro("valor zero não é custo previsto — declare o motivo de não saber, em vez disso");
            }
            const corpos = Array.from({ length: meses }, (_, i) => {
              const mesAlvo = deslocarMes(competencia, i);
              return {
                competencia: mesAlvo,
                descricao: descricao.trim(),
                ...(centavos !== null ? { valorCents: centavos } : { indeterminadoMotivo: motivoSemValor.trim() }),
                ...(categoria ? { categoria } : {}),
                ...(nucleo ? { nucleo } : {}),
                ...(casada ? { contraparte: casada.id } : {}),
                ...(dia ? { diaEsperado: i === 0 ? dia : mesmoDiaEm(dia, mesAlvo) } : {})
              };
            });
            void onCriar(corpos).then((ok) => {
              if (ok) {
                setDescricao("");
                setValor("");
                setMotivoSemValor("");
              }
            });
          }}
        >
          {meses === 1 ? "Criar item" : `Criar ${meses} itens`}
        </button>
      </div>
    </section>
  );
}

/**
 * O mesmo dia do mês na competência seguinte, limitado ao último dia do mês.
 *
 * Dia 31 em fevereiro não existe, e deixar o navegador "consertar" viraria 3 de
 * março — um custo previsto migrando de competência sozinho. Cortar no último
 * dia do mês é a mesma regra que a projeção de recorrente já usa.
 */
function mesmoDiaEm(diaOriginal: string, competencia: string): string {
  const dia = Number(diaOriginal.slice(8, 10));
  const [ano, mes] = competencia.split("-").map(Number);
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${competencia.slice(0, 8)}${String(Math.min(dia, ultimo)).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Confronto: previsto × confirmado × realizado
// ---------------------------------------------------------------------------

/**
 * Compara, nunca junta.
 *
 * A chave é (competência, categoria) e não o item: casar item a item exigiria um
 * pareador, e um pareador errado transformaria "previ certo" em "previ errado"
 * sem que ninguém conseguisse ver por quê. A categoria que aparece só do lado
 * realizado é a lacuna de cobertura com nome e sobrenome — o gasto que ninguém
 * previu — e é por isso que ela aparece em vez de ser filtrada.
 */
function TabelaConfronto({ confronto, competencia }: { confronto: ConfrontoCusto[]; competencia: string }) {
  const [aberto, setAberto] = useState(false);
  const linhas = confronto.filter(
    (f) => f.previstoCents || f.confirmadoCents || (f.realizadoCents ?? 0) !== 0
  );
  if (!linhas.length) return null;

  const semPrevisao = linhas.filter((f) => !f.previstoCents && (f.realizadoCents ?? 0) > 0);
  const naoPrevisto = semPrevisao.reduce((s, f) => s + (f.realizadoCents ?? 0), 0);

  return (
    <section className="card fin-custo-confronto">
      <button type="button" className="fin-custo-grupo-cab" onClick={() => setAberto((v) => !v)} aria-expanded={aberto}>
        <span className="fin-custo-grupo-nome">
          <span className="fin-custo-seta" aria-hidden="true">
            {aberto ? "▾" : "▸"}
          </span>
          <strong>Previsto × confirmado × realizado</strong>
          <span className="fin-custo-grupo-n">{linhas.length} categorias em {rotuloMes(competencia)}</span>
        </span>
        {naoPrevisto ? (
          <span className="fin-custo-grupo-num">
            <span className="fin-badge-atencao">{brl(naoPrevisto)} saiu sem previsão nenhuma</span>
          </span>
        ) : null}
      </button>

      {aberto ? (
        <>
          <table className="fin-table">
            <thead>
              <tr>
                <th>Categoria</th>
                <th className="num">Previsto</th>
                <th className="num">Confirmado</th>
                <th className="num">Ajuste</th>
                <th className="num">Realizado</th>
                <th className="num">Erro</th>
                <th>Leitura</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((f) => (
                <tr key={`${f.code ?? "sem"}-${f.categoriaId ?? 0}`}>
                  <td>
                    {f.code ? <span className="fin-code">{f.code}</span> : null}
                    {f.nome ?? <span className="fin-zero">sem categoria</span>}
                  </td>
                  <td className="num fin-table-money">{f.previstoCents ? brl(f.previstoCents) : "—"}</td>
                  <td className="num fin-table-money">{f.confirmadoCents ? brl(f.confirmadoCents) : "—"}</td>
                  <td className="num fin-table-money">
                    {f.ajusteDaConfirmacaoCents ? delta(f.ajusteDaConfirmacaoCents) : "—"}
                  </td>
                  <td className="num fin-table-money">
                    {f.realizadoCents === null ? (
                      <span className="cert-selo" data-cert="indeterminado" title="ausência de lançamento, não zero">
                        sem lançamento
                      </span>
                    ) : (
                      brl(f.realizadoCents)
                    )}
                  </td>
                  <td className="num fin-table-money">{f.erroCents === null ? "—" : delta(f.erroCents)}</td>
                  <td className="fin-custo-leitura">{f.leitura ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="fin-card-hint">
            &quot;Realizado&quot; aqui é o que o extrato registrou nesta competência — leitura do ledger, não promoção
            de previsão. Nenhum item vira realizado por estar nesta tabela: isso exige o lançamento apontado, e o
            gatilho do banco recusa qualquer outra coisa.
          </p>
        </>
      ) : null}
    </section>
  );
}

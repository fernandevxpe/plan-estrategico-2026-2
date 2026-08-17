"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AgendaPeriodo, DiaAgenda, LinhaAgenda } from "@/lib/financeiro/contratos/agenda";

import { brl, Medida, Ressalva, SeloCamada, type Camada } from "./Certeza";

/**
 * A agenda diária de obrigações.
 *
 * ---------------------------------------------------------------------------
 * O QUE ESTA TELA RESPONDE, E EM QUE ORDEM
 * ---------------------------------------------------------------------------
 * 1. "Como está o mês?"        → o calendário, com o dia carregado à vista
 * 2. "O que tem no dia X?"     → a lista densa, item a item
 * 3. "Isso está certo?"        → o item abre e se corrige ali mesmo
 *
 * HOJE É SEMPRE LOCALIZÁVEL. Passado, hoje e futuro vivem na mesma linha do
 * tempo contínua, e um botão fixo volta para hoje de qualquer lugar. Uma agenda
 * em que a pessoa se perde no tempo é uma agenda que ela abre uma vez.
 *
 * ---------------------------------------------------------------------------
 * AS TRÊS COISAS QUE ESTA TELA SE RECUSA A FAZER
 * ---------------------------------------------------------------------------
 * NÃO SOMA O QUE NÃO SOMA. Cada linha traz `entraNoTotal`. As que não somam
 * aparecem hachuradas, com o motivo, FORA do total — e o rodapé do dia diz
 * quanto ficou de fora. Somar as duas coisas é o defeito que já produziu
 * R$ 1,27 milhão falso nesta base; escondê-las faz o total parecer arbitrário.
 *
 * NÃO DESENHA SALDO NO PASSADO. `saldoPrevistoCents` é null antes de hoje, e a
 * tela mostra o realizado no lugar. O saldo de ontem é o extrato de ontem.
 *
 * NÃO APRESENTA TOTAL QUANDO A PROVA FALHA. Se `provaOk` for falso, alguma
 * coisa está sendo contada duas vezes, e o cabeçalho diz isso em vez de exibir
 * um número que parece bom.
 *
 * ---------------------------------------------------------------------------
 * O PASSADO MOSTRA PREVISTO × REALIZADO, LADO A LADO
 * ---------------------------------------------------------------------------
 * É a única razão de a agenda ter passado. A diferença entre o dia esperado e o
 * dia em que o dinheiro se moveu é a medida honesta da qualidade da previsão —
 * e é ela que ensina a próxima.
 */

const HOJE_ROTULO = "hoje";
const DIAS_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"
];

type Visao = "calendario" | "lista";

/** Data ISO → partes, sem passar por Date (fuso muda o dia). */
function partes(iso: string) {
  const [ano, mes, dia] = iso.split("-").map(Number);
  return { ano, mes, dia };
}
function somaDias(iso: string, n: number): string {
  const { ano, mes, dia } = partes(iso);
  const d = new Date(Date.UTC(ano, mes - 1, dia + n));
  return d.toISOString().slice(0, 10);
}
function inicioDoMes(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}
function fimDoMes(iso: string): string {
  const { ano, mes } = partes(iso);
  return new Date(Date.UTC(ano, mes, 0)).toISOString().slice(0, 10);
}
function rotuloMes(iso: string): string {
  const { ano, mes } = partes(iso);
  return `${MESES[mes - 1]} de ${ano}`;
}
function rotuloDia(iso: string, hoje: string): string {
  if (iso === hoje) return HOJE_ROTULO;
  if (iso === somaDias(hoje, 1)) return "amanhã";
  if (iso === somaDias(hoje, -1)) return "ontem";
  const { ano, mes, dia } = partes(iso);
  const semana = DIAS_SEMANA[new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay()];
  return `${semana} ${String(dia).padStart(2, "0")}/${String(mes).padStart(2, "0")}`;
}

export function FinAgenda({ inicial }: { inicial: AgendaPeriodo & { disponivel: boolean; ressalvas: string[] } }) {
  const hoje = inicial.hoje || new Date().toISOString().slice(0, 10);

  const [visao, setVisao] = useState<Visao>("calendario");
  const [mes, setMes] = useState(() => inicioDoMes(hoje));
  const [diaFoco, setDiaFoco] = useState(hoje);
  const [dados, setDados] = useState(inicial);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Filtros de busca
  const [texto, setTexto] = useState("");
  const [direcao, setDirecao] = useState<"" | "receber" | "pagar">("");
  const [certeza, setCerteza] = useState("");
  const [categoria, setCategoria] = useState("");
  const [valorMin, setValorMin] = useState("");
  const [valorMax, setValorMax] = useState("");
  const [somenteVencidos, setSomenteVencidos] = useState(false);
  const [ordenarPor, setOrdenarPor] = useState("dia");
  const [ordem, setOrdem] = useState<"asc" | "desc">("asc");

  const [selecao, setSelecao] = useState<Set<string>>(new Set());
  const [aberto, setAberto] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [formNovo, setFormNovo] = useState(false);

  const gradeRef = useRef<HTMLDivElement>(null);

  const janela = useMemo(() => {
    if (visao === "calendario") return { de: inicioDoMes(mes), ate: fimDoMes(mes) };
    // A lista densa anda por semana em torno do dia focado — uma janela larga
    // rolaria centenas de dias vazios entre um vencimento e o seguinte.
    return { de: somaDias(diaFoco, -7), ate: somaDias(diaFoco, 21) };
  }, [visao, mes, diaFoco]);

  const buscar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    const p = new URLSearchParams({ de: janela.de, ate: janela.ate, porPagina: "500", ordenarPor, ordem });
    if (texto.trim()) p.set("texto", texto.trim());
    if (direcao) p.set("direcao", direcao);
    if (certeza) p.set("certeza", certeza);
    if (categoria.trim()) p.set("categoria", categoria.trim());
    if (valorMin) p.set("valorMin", String(Math.round(Number(valorMin) * 100)));
    if (valorMax) p.set("valorMax", String(Math.round(Number(valorMax) * 100)));
    if (somenteVencidos) p.set("somenteVencidos", "1");
    try {
      const r = await fetch(`/api/financeiro/gerencial/agenda?${p}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok && !j?.dado) throw new Error(j?.erro ?? `HTTP ${r.status}`);
      setDados({ ...j.dado, disponivel: j.disponivel, ressalvas: j.ressalvas ?? [] });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "falha ao carregar a agenda");
    } finally {
      setCarregando(false);
    }
  }, [janela.de, janela.ate, texto, direcao, certeza, categoria, valorMin, valorMax, somenteVencidos, ordenarPor, ordem]);

  useEffect(() => {
    void buscar();
  }, [buscar]);

  // ── Teclado ───────────────────────────────────────────────────────────
  // Navegar dias com ← →, semana com shift, T volta para hoje, Enter abre o
  // detalhe, C confirma a seleção. Uma agenda que exige mouse para andar no
  // tempo obriga a pessoa a mirar, e mirar é o que cansa numa triagem longa.
  useEffect(() => {
    const alvoEditavel = (el: EventTarget | null) =>
      el instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);

    const onKey = (e: KeyboardEvent) => {
      if (alvoEditavel(e.target)) return;
      const passo = e.shiftKey ? 7 : 1;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        setDiaFoco((d) => somaDias(d, passo));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setDiaFoco((d) => somaDias(d, -passo));
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setDiaFoco((d) => somaDias(d, 7));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setDiaFoco((d) => somaDias(d, -7));
      } else if (e.key === "t" || e.key === "T") {
        setDiaFoco(hoje);
        setMes(inicioDoMes(hoje));
      } else if (e.key === "Enter") {
        setVisao("lista");
      } else if ((e.key === "c" || e.key === "C") && selecao.size) {
        void agir("confirmar");
      } else if (e.key === "Escape") {
        setAberto(null);
        setSelecao(new Set());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // `agir` é estável o bastante para a dependência de selecao bastar aqui.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoje, selecao]);

  // O calendário segue o dia focado quando ele sai do mês visível.
  useEffect(() => {
    if (inicioDoMes(diaFoco) !== mes) setMes(inicioDoMes(diaFoco));
  }, [diaFoco, mes]);

  const porDia = useMemo(() => {
    const m = new Map<string, LinhaAgenda[]>();
    for (const l of dados.linhas) {
      const lista = m.get(l.dia);
      if (lista) lista.push(l);
      else m.set(l.dia, [l]);
    }
    return m;
  }, [dados.linhas]);

  const diaMap = useMemo(() => {
    const m = new Map<string, DiaAgenda>();
    for (const d of dados.dias) m.set(d.dia, d);
    return m;
  }, [dados.dias]);

  const chaveLinha = (l: LinhaAgenda) => `${l.direcao}|${l.chaveDedupe}|${l.dia}`;

  const linhasSelecionadas = useMemo(
    () => dados.linhas.filter((l) => selecao.has(chaveLinha(l))),
    [dados.linhas, selecao]
  );

  async function agir(acao: "confirmar" | "nao-vai-acontecer", motivo?: string) {
    if (!linhasSelecionadas.length) return;
    setEnviando(true);
    setAviso(null);
    try {
      const itens = linhasSelecionadas.map((l) =>
        l.itemId
          ? { direcao: l.direcao, id: l.itemId }
          : { direcao: l.direcao, competencia: l.competencia.slice(0, 7), origemRef: l.origemRef }
      );
      const r = await fetch("/api/financeiro/gerencial/agenda/confirmar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ acao, itens, motivo })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.erro ?? `HTTP ${r.status}`);
      setAviso(
        acao === "confirmar"
          ? `${j.confirmados} item(ns) confirmado(s)${j.ajusteCents ? ` · ajuste ${brl(j.ajusteCents)}` : ""}. Nenhum lançamento foi criado.`
          : `${j.itens?.length ?? 0} item(ns) marcado(s) como "não vai acontecer". Nada foi apagado.`
      );
      setSelecao(new Set());
      await buscar();
    } catch (e) {
      setAviso(e instanceof Error ? `Falhou: ${e.message}` : "falhou");
    } finally {
      setEnviando(false);
    }
  }

  if (!dados.disponivel) {
    return (
      <section className="card fin-empty">
        <h2 className="card-title">Agenda indisponível</h2>
        <p>
          A agenda lê o ledger direto do PostgreSQL. Sem <code>FINANCE_DATABASE_URL</code> configurada, ou com a
          migration <code>0104</code> ainda não aplicada, esta tela fica assim — o resto da plataforma segue.
        </p>
      </section>
    );
  }

  const provaRuim = dados.prova.filter((p) => !p.deltaExplicado);

  return (
    <div className="agenda">
      {/* ── A prova, antes de qualquer número ─────────────────────────── */}
      {provaRuim.length ? (
        <Ressalva>
          <strong>A prova de não-duplicação falhou</strong> em {provaRuim.length} mês(es):{" "}
          {provaRuim.map((p) => `${p.competencia.slice(0, 7)}/${p.direcao} ${brl(p.deltaCents)}`).join(", ")}. Os totais
          abaixo não são confiáveis — alguma coisa está sendo contada duas vezes.
        </Ressalva>
      ) : null}

      {dados.ressalvas.slice(0, 2).map((r) => (
        <Ressalva key={r}>{r}</Ressalva>
      ))}

      {/* ── Cabeçalho: o período em números ───────────────────────────── */}
      <section className="agenda-topo">
        <div className="agenda-medidas">
          <Medida rotulo="Entra no período" valorCents={dados.entradaCents} detalhe={`${dados.de} → ${dados.ate}`} />
          <Medida
            rotulo="Sai no período"
            valorCents={dados.saidaCents}
            detalhe="a previsão de saída cobre ~72% do que sai"
            cobertura={0.72}
            vies="otimista por construção"
          />
          <Medida
            rotulo="Líquido"
            valorCents={dados.liquidoCents}
            detalhe={dados.ancoraAte ? `saldo real de ${dados.ancoraAte}: ${brl(dados.ancoraSaldoCents ?? 0)}` : undefined}
          />
          {dados.foraDaSomaLinhas ? (
            <Medida
              rotulo="Existe e NÃO soma"
              valorCents={dados.foraDaSomaCents}
              detalhe={`${dados.foraDaSomaLinhas} linha(s), cada uma com motivo`}
            />
          ) : (
            <Medida rotulo="Existe e NÃO soma" valorCents={null} motivo="nenhuma linha suprimida neste período" />
          )}
        </div>

        <div className="agenda-controles">
          <div className="agenda-navegacao">
            <button
              type="button"
              className="fin-btn-ghost"
              onClick={() => (visao === "calendario" ? setMes(somaDias(mes, -1).slice(0, 7) + "-01") : setDiaFoco(somaDias(diaFoco, -7)))}
              aria-label="período anterior"
            >
              ←
            </button>
            <strong className="agenda-periodo">
              {visao === "calendario" ? rotuloMes(mes) : `${rotuloDia(janela.de, hoje)} → ${rotuloDia(janela.ate, hoje)}`}
            </strong>
            <button
              type="button"
              className="fin-btn-ghost"
              onClick={() => {
                if (visao === "calendario") {
                  const { ano, mes: m } = partes(mes);
                  setMes(new Date(Date.UTC(ano, m, 1)).toISOString().slice(0, 10));
                } else setDiaFoco(somaDias(diaFoco, 7));
              }}
              aria-label="próximo período"
            >
              →
            </button>
            {/* HOJE SEMPRE LOCALIZÁVEL — o botão nunca some, mesmo quando já
                estamos em hoje: um alvo que aparece e desaparece obriga a
                procurar antes de clicar. */}
            <button
              type="button"
              className={diaFoco === hoje && inicioDoMes(hoje) === mes ? "fin-btn-ghost agenda-hoje ativo" : "fin-btn-ghost agenda-hoje"}
              onClick={() => {
                setDiaFoco(hoje);
                setMes(inicioDoMes(hoje));
              }}
            >
              hoje <kbd>T</kbd>
            </button>
          </div>

          <div className="agenda-visoes" role="tablist" aria-label="visão da agenda">
            <button
              type="button"
              role="tab"
              aria-selected={visao === "calendario"}
              className={visao === "calendario" ? "fin-escopo-tab ativo" : "fin-escopo-tab"}
              onClick={() => setVisao("calendario")}
            >
              Calendário
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={visao === "lista"}
              className={visao === "lista" ? "fin-escopo-tab ativo" : "fin-escopo-tab"}
              onClick={() => setVisao("lista")}
            >
              Lista densa
            </button>
          </div>
        </div>
      </section>

      {/* ── Busca ─────────────────────────────────────────────────────── */}
      <section className="agenda-busca">
        <input
          type="search"
          placeholder="buscar em descrição e contraparte…"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          className="fin-cell-input agenda-busca-texto"
        />
        <select value={direcao} onChange={(e) => setDirecao(e.target.value as typeof direcao)} className="fin-cell-input">
          <option value="">entra e sai</option>
          <option value="receber">só a receber</option>
          <option value="pagar">só a pagar</option>
        </select>
        <select value={certeza} onChange={(e) => setCerteza(e.target.value)} className="fin-cell-input">
          <option value="">toda certeza</option>
          <option value="firme">firme</option>
          <option value="provavel">provável</option>
          <option value="observado">observado</option>
          <option value="atrasado">atrasado</option>
          <option value="indeterminado">indeterminado</option>
        </select>
        <input
          type="text"
          placeholder="categoria (5.01)"
          value={categoria}
          onChange={(e) => setCategoria(e.target.value)}
          className="fin-cell-input agenda-busca-cat"
        />
        <input
          type="number"
          placeholder="de R$"
          value={valorMin}
          onChange={(e) => setValorMin(e.target.value)}
          className="fin-cell-input agenda-busca-valor"
        />
        <input
          type="number"
          placeholder="até R$"
          value={valorMax}
          onChange={(e) => setValorMax(e.target.value)}
          className="fin-cell-input agenda-busca-valor"
        />
        <label className="fin-check">
          <input type="checkbox" checked={somenteVencidos} onChange={(e) => setSomenteVencidos(e.target.checked)} />
          só vencidos
        </label>
        <select
          value={`${ordenarPor}:${ordem}`}
          onChange={(e) => {
            const [c, o] = e.target.value.split(":");
            setOrdenarPor(c);
            setOrdem(o as "asc" | "desc");
          }}
          className="fin-cell-input"
        >
          <option value="dia:asc">dia ↑</option>
          <option value="dia:desc">dia ↓</option>
          <option value="valor:desc">maior valor</option>
          <option value="valor:asc">menor valor</option>
          <option value="contraparte:asc">contraparte</option>
          <option value="categoria:asc">categoria</option>
          <option value="atraso:desc">mais atrasado</option>
        </select>
        <button type="button" className="fin-btn-mini" onClick={() => setFormNovo((v) => !v)}>
          + cadastrar futuro
        </button>
      </section>

      {formNovo ? <FormNovoPrevisto dia={diaFoco} onPronto={() => { setFormNovo(false); void buscar(); }} /> : null}

      {erro ? <div className="fin-alert-forte">Falha ao carregar: {erro}</div> : null}
      {aviso ? <div className="fin-alert">{aviso}</div> : null}

      {/* ── A barra de lote ───────────────────────────────────────────── */}
      {selecao.size ? (
        <div className="fin-bulk-bar agenda-lote">
          <span>
            {selecao.size} selecionado(s) ·{" "}
            {brl(linhasSelecionadas.reduce((s, l) => s + (l.valorCents ?? 0), 0))}
          </span>
          <button type="button" className="fin-btn-primary" disabled={enviando} onClick={() => void agir("confirmar")}>
            Confirmar <kbd>C</kbd>
          </button>
          <button
            type="button"
            className="fin-btn-perigo"
            disabled={enviando}
            onClick={() => {
              const motivo = window.prompt("Por que não vai acontecer? (fica registrado, e é reversível)");
              if (motivo?.trim()) void agir("nao-vai-acontecer", motivo.trim());
            }}
          >
            Não vai acontecer
          </button>
          <button type="button" className="fin-btn-ghost" onClick={() => setSelecao(new Set())}>
            limpar
          </button>
        </div>
      ) : null}

      {carregando ? <p className="fin-card-hint">carregando…</p> : null}

      {visao === "calendario" ? (
        <Calendario
          mes={mes}
          hoje={hoje}
          diaFoco={diaFoco}
          diaMap={diaMap}
          porDia={porDia}
          onEscolher={(d) => {
            setDiaFoco(d);
            setVisao("lista");
          }}
          gradeRef={gradeRef}
        />
      ) : (
        <ListaDensa
          de={janela.de}
          ate={janela.ate}
          hoje={hoje}
          diaFoco={diaFoco}
          diaMap={diaMap}
          porDia={porDia}
          selecao={selecao}
          aberto={aberto}
          chaveLinha={chaveLinha}
          onSelecionar={(k) =>
            setSelecao((s) => {
              const n = new Set(s);
              if (n.has(k)) n.delete(k);
              else n.add(k);
              return n;
            })
          }
          onAbrir={(k) => setAberto((a) => (a === k ? null : k))}
          onMudou={() => void buscar()}
          onFoco={setDiaFoco}
        />
      )}

      <p className="agenda-atalhos">
        <kbd>←</kbd> <kbd>→</kbd> anda um dia · <kbd>shift</kbd> uma semana · <kbd>↑</kbd> <kbd>↓</kbd> semana ·{" "}
        <kbd>T</kbd> volta para hoje · <kbd>Enter</kbd> abre a lista · <kbd>C</kbd> confirma a seleção ·{" "}
        <kbd>Esc</kbd> limpa
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Calendário do mês
// ---------------------------------------------------------------------------

/**
 * A visão do mês. Cada célula mostra entrada, saída e o saldo ao fim do dia.
 *
 * O saldo negativo ganha marca própria porque é a única informação da tela que
 * muda decisão hoje: o resto se lê depois, o aperto de caixa não.
 *
 * No passado, a célula mostra o REALIZADO em vez do saldo — porque o saldo
 * projetado não existe lá, e desenhar zero seria afirmar que nada se moveu.
 */
function Calendario({
  mes,
  hoje,
  diaFoco,
  diaMap,
  porDia,
  onEscolher,
  gradeRef
}: {
  mes: string;
  hoje: string;
  diaFoco: string;
  diaMap: Map<string, DiaAgenda>;
  porDia: Map<string, LinhaAgenda[]>;
  onEscolher: (dia: string) => void;
  gradeRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { ano, mes: m } = partes(mes);
  const primeiro = new Date(Date.UTC(ano, m - 1, 1));
  const diasNoMes = new Date(Date.UTC(ano, m, 0)).getUTCDate();
  const vazios = primeiro.getUTCDay();

  const celulas: (string | null)[] = [
    ...Array.from({ length: vazios }, () => null),
    ...Array.from({ length: diasNoMes }, (_, i) => `${mes.slice(0, 7)}-${String(i + 1).padStart(2, "0")}`)
  ];

  return (
    <div className="agenda-cal" ref={gradeRef}>
      <div className="agenda-cal-cabecalho">
        {DIAS_SEMANA.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="agenda-cal-grade">
        {celulas.map((dia, i) => {
          if (!dia) return <div key={`v${i}`} className="agenda-cel vazia" />;
          const resumo = diaMap.get(dia);
          const linhas = porDia.get(dia) ?? [];
          const passado = dia < hoje;
          const saldo = resumo?.saldoPrevistoCents ?? null;
          const aperto = saldo !== null && saldo < 0;
          const classes = [
            "agenda-cel",
            dia === hoje ? "hoje" : "",
            dia === diaFoco ? "foco" : "",
            passado ? "passado" : "",
            aperto ? "aperto" : "",
            (resumo?.itensVencidos ?? 0) > 0 ? "vencido" : ""
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <button type="button" key={dia} className={classes} onClick={() => onEscolher(dia)}>
              <span className="agenda-cel-dia">
                {partes(dia).dia}
                {dia === hoje ? <em>hoje</em> : null}
              </span>

              {resumo && (resumo.entradaCents || resumo.saidaCents) ? (
                <span className="agenda-cel-mov">
                  {resumo.entradaCents ? <b className="entra">+{brl(resumo.entradaCents)}</b> : null}
                  {resumo.saidaCents ? <b className="sai">−{brl(resumo.saidaCents)}</b> : null}
                </span>
              ) : (
                <span className="agenda-cel-mov vazio">—</span>
              )}

              {passado ? (
                resumo?.realizadoLiquidoCents !== null && resumo?.realizadoLiquidoCents !== undefined ? (
                  <span className="agenda-cel-saldo realizado" title="movimento realizado no extrato deste dia">
                    real {brl(resumo.realizadoLiquidoCents)}
                  </span>
                ) : (
                  // Ausência de lançamento não é zero: sem extrato coberto, o
                  // dia não afirma nada. A hachura diz isso sem palavra.
                  <span className="agenda-cel-saldo cert-hachura" title="sem lançamento neste dia — ausência de dado, não zero">
                    sem lançamento
                  </span>
                )
              ) : saldo !== null ? (
                <span className={aperto ? "agenda-cel-saldo negativo" : "agenda-cel-saldo"}>{brl(saldo)}</span>
              ) : null}

              {linhas.length ? (
                <span className="agenda-cel-itens">
                  {linhas.filter((l) => l.entraNoTotal).length} item(ns)
                  {resumo?.itensForaDaSoma ? ` · ${resumo.itensForaDaSoma} fora` : ""}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lista densa — dia a dia, item a item
// ---------------------------------------------------------------------------

function ListaDensa({
  de,
  ate,
  hoje,
  diaFoco,
  diaMap,
  porDia,
  selecao,
  aberto,
  chaveLinha,
  onSelecionar,
  onAbrir,
  onMudou,
  onFoco
}: {
  de: string;
  ate: string;
  hoje: string;
  diaFoco: string;
  diaMap: Map<string, DiaAgenda>;
  porDia: Map<string, LinhaAgenda[]>;
  selecao: Set<string>;
  aberto: string | null;
  chaveLinha: (l: LinhaAgenda) => string;
  onSelecionar: (k: string) => void;
  onAbrir: (k: string) => void;
  onMudou: () => void;
  onFoco: (d: string) => void;
}) {
  const dias: string[] = [];
  for (let d = de; d <= ate; d = somaDias(d, 1)) dias.push(d);

  const focoRef = useRef<HTMLElement>(null);
  useEffect(() => {
    focoRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [diaFoco]);

  return (
    <div className="agenda-lista">
      {dias.map((dia) => {
        const resumo = diaMap.get(dia);
        const linhas = porDia.get(dia) ?? [];
        // Dia vazio no meio do período aparece como régua fina, não some: a
        // distância entre dois vencimentos É informação.
        if (!linhas.length) {
          return (
            <div
              key={dia}
              className={`agenda-dia-vazio${dia === hoje ? " hoje" : ""}${dia === diaFoco ? " foco" : ""}`}
              onClick={() => onFoco(dia)}
              role="presentation"
            >
              <span>{rotuloDia(dia, hoje)}</span>
              <span className="agenda-dia-vazio-nada">sem obrigação</span>
              {dia >= hoje && resumo?.saldoPrevistoCents !== null && resumo?.saldoPrevistoCents !== undefined ? (
                <span className="agenda-dia-vazio-saldo">{brl(resumo.saldoPrevistoCents)}</span>
              ) : null}
            </div>
          );
        }

        const passado = dia < hoje;
        return (
          <section
            key={dia}
            ref={dia === diaFoco ? (focoRef as React.RefObject<HTMLElement>) : undefined}
            className={`agenda-dia${dia === hoje ? " hoje" : ""}${dia === diaFoco ? " foco" : ""}${passado ? " passado" : ""}`}
          >
            <header className="agenda-dia-cab" onClick={() => onFoco(dia)} role="presentation">
              <h3>
                {rotuloDia(dia, hoje)} <small>{dia}</small>
              </h3>
              <div className="agenda-dia-nums">
                {resumo?.entradaCents ? <span className="entra">+{brl(resumo.entradaCents)}</span> : null}
                {resumo?.saidaCents ? <span className="sai">−{brl(resumo.saidaCents)}</span> : null}
                <span className="liquido">{brl(resumo?.liquidoCents ?? 0)}</span>
                {passado ? (
                  <span className="agenda-dia-realizado">
                    {resumo?.realizadoLiquidoCents !== null && resumo?.realizadoLiquidoCents !== undefined ? (
                      <>
                        realizado {brl(resumo.realizadoLiquidoCents)}
                        {resumo.erroDoDiaCents !== null ? <em> · erro {brl(resumo.erroDoDiaCents)}</em> : null}
                      </>
                    ) : (
                      <em className="cert-hachura">sem lançamento neste dia</em>
                    )}
                  </span>
                ) : resumo?.saldoPrevistoCents !== null && resumo?.saldoPrevistoCents !== undefined ? (
                  <span className={resumo.saldoPrevistoCents < 0 ? "agenda-dia-saldo negativo" : "agenda-dia-saldo"}>
                    saldo ao fim do dia {brl(resumo.saldoPrevistoCents)}
                  </span>
                ) : null}
              </div>
            </header>

            {resumo?.itensForaDaSoma ? (
              <p className="agenda-dia-fora">
                {resumo.itensForaDaSoma} linha(s) deste dia aparecem e <strong>não somam</strong> (
                {brl(resumo.foraDaSomaCents)}) — cada uma com o motivo abaixo.
              </p>
            ) : null}

            <table className="agenda-tab">
              <tbody>
                {linhas.map((l) => {
                  const k = chaveLinha(l);
                  return (
                    <LinhaItem
                      key={k}
                      linha={l}
                      chave={k}
                      selecionado={selecao.has(k)}
                      aberto={aberto === k}
                      onSelecionar={() => onSelecionar(k)}
                      onAbrir={() => onAbrir(k)}
                      onMudou={onMudou}
                    />
                  );
                })}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// A linha, e a gaveta que a corrige
// ---------------------------------------------------------------------------

const CERTEZA_VALIDA: Camada[] = ["firme", "provavel", "observado", "atrasado", "indeterminado"];

function LinhaItem({
  linha,
  chave,
  selecionado,
  aberto,
  onSelecionar,
  onAbrir,
  onMudou
}: {
  linha: LinhaAgenda;
  chave: string;
  selecionado: boolean;
  aberto: boolean;
  onSelecionar: () => void;
  onAbrir: () => void;
  onMudou: () => void;
}) {
  const camada: Camada = CERTEZA_VALIDA.includes(linha.certeza as Camada) ? (linha.certeza as Camada) : "indeterminado";
  const manual = linha.procedencia === "item" && linha.precedencia === "manual";

  return (
    <>
      <tr
        className={[
          "agenda-linha",
          linha.entraNoTotal ? "" : "nao-soma cert-hachura",
          selecionado ? "sel" : "",
          manual ? "manual" : "",
          linha.vencido ? "vencido" : ""
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <td className="agenda-td-check">
          {/* Só o que ainda não foi decidido pode entrar num lote. Oferecer o
              checkbox no que já está confirmado ou ignorado convida ao clique
              que não faz nada — e o "selecionar tudo" viraria ruído. */}
          {linha.estado === "confirmado" || linha.estado === "ignorado" || linha.estado === "realizado" ? null : (
            <input type="checkbox" checked={selecionado} onChange={onSelecionar} aria-label={`selecionar ${linha.descricao}`} />
          )}
        </td>
        <td className="agenda-td-dir">
          <span className={linha.direcao === "receber" ? "agenda-dir entra" : "agenda-dir sai"}>
            {linha.direcao === "receber" ? "↓" : "↑"}
          </span>
        </td>
        <td className="agenda-td-desc">
          <button type="button" className="fin-cell-btn agenda-desc-btn" onClick={onAbrir}>
            {linha.descricao}
          </button>
          <span className="agenda-sub">
            {linha.contraparte ?? "—"}
            {linha.categoriaCode ? ` · ${linha.categoriaCode} ${linha.categoria ?? ""}` : " · sem categoria"}
            {manual ? " · cadastrado à mão" : ""}
          </span>
        </td>
        <td className="agenda-td-selo">
          <SeloCamada camada={camada} texto={linha.confianca ?? undefined} />
          {linha.estado && linha.estado !== "projetado" ? <span className="agenda-estado">{linha.estado}</span> : null}
        </td>
        <td className="agenda-td-valor">
          {linha.valorCents === null ? (
            <em className="agenda-indet">indeterminado</em>
          ) : (
            <span className={linha.direcao === "receber" ? "entra" : "sai"}>
              {linha.direcao === "receber" ? "+" : "−"}
              {brl(linha.valorCents)}
            </span>
          )}
        </td>
        <td className="agenda-td-real">
          {/* Previsto × realizado, lado a lado. É o que faz a previsão aprender. */}
          {linha.realizadoCents !== null ? (
            <span className="agenda-realizado">
              {brl(linha.realizadoCents)}
              {linha.atrasoDias !== null && linha.atrasoDias !== 0 ? (
                <em className={linha.atrasoDias > 0 ? "atraso" : "adiantou"}>
                  {linha.atrasoDias > 0 ? `+${linha.atrasoDias}d` : `${linha.atrasoDias}d`}
                </em>
              ) : null}
            </span>
          ) : linha.vencido ? (
            <span className="agenda-nao-veio">não veio</span>
          ) : null}
        </td>
      </tr>

      {!linha.entraNoTotal && linha.motivoNaoSoma ? (
        <tr className="agenda-motivo">
          <td colSpan={6}>↳ não soma: {linha.motivoNaoSoma}</td>
        </tr>
      ) : null}

      {linha.alertaSobreposicao ? (
        <tr className="agenda-alerta">
          <td colSpan={6}>⚠ {linha.alertaSobreposicao}</td>
        </tr>
      ) : null}

      {aberto ? (
        <tr>
          <td colSpan={6}>
            <Gaveta linha={linha} chave={chave} onMudou={onMudou} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

/**
 * A gaveta de correção — o "ir item a item" do pedido.
 *
 * Ela edita PREVISÃO, nunca caixa. Um item ainda projetado é materializado no
 * ato (a rota faz isso), e a partir daí tem id, trilha e autor.
 */
function Gaveta({ linha, onMudou }: { linha: LinhaAgenda; chave: string; onMudou: () => void }) {
  const [dia, setDia] = useState(linha.dia);
  const [valor, setValor] = useState(linha.valorCents === null ? "" : String(linha.valorCents / 100));
  const [categoria, setCategoria] = useState(linha.categoriaCode ?? "");
  const [descricao, setDescricao] = useState(linha.descricao);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function salvar() {
    setSalvando(true);
    setMsg(null);
    try {
      let itemId = linha.itemId;
      // Sem item ainda: confirmar por (competência, origemRef) materializa e
      // devolve o id. É o único caminho que não inventa um segundo modelo.
      if (!itemId) {
        const r0 = await fetch("/api/financeiro/gerencial/agenda/confirmar", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            acao: "confirmar",
            itens: [{ direcao: linha.direcao, competencia: linha.competencia.slice(0, 7), origemRef: linha.origemRef }]
          })
        });
        const j0 = await r0.json();
        if (!r0.ok) throw new Error(j0?.erro ?? `HTTP ${r0.status}`);
        itemId = (linha.direcao === "pagar" ? j0.pagar : j0.receber)?.itens?.[0]?.id ?? null;
        if (!itemId) throw new Error("não consegui materializar o item para editar");
      }

      const patch: Record<string, unknown> = {};
      if (dia !== linha.dia) patch.diaEsperado = dia;
      if (descricao !== linha.descricao) patch.descricao = descricao;
      if (categoria !== (linha.categoriaCode ?? "")) patch.categoria = categoria || null;
      const cents = valor === "" ? null : Math.round(Number(valor) * 100);
      if (cents !== linha.valorCents) patch.valorCents = cents;

      if (!Object.keys(patch).length) {
        setMsg("nada mudou");
        return;
      }
      const r = await fetch(`/api/financeiro/gerencial/agenda/itens/${linha.direcao}/${itemId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch)
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.erro ?? `HTTP ${r.status}`);
      setMsg(`salvo: ${j.alterados.join(", ")}`);
      onMudou();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "falhou");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="agenda-gaveta fin-gaveta">
      <dl className="agenda-proveniencia">
        <div>
          <dt>por que este dia</dt>
          <dd>{linha.diaRegra ?? <em className="cert-hachura">não declarado — ninguém consegue conferir</em>}</dd>
        </div>
        <div>
          <dt>de onde veio</dt>
          <dd>
            <code>{linha.origemTabela}</code>
            {linha.origemId ? ` #${linha.origemId}` : ""} · camada <code>{linha.camada ?? "—"}</code>
          </dd>
        </div>
        <div>
          <dt>identidade do dinheiro</dt>
          <dd>
            <code>{linha.chaveDedupe}</code>
          </dd>
        </div>
        {linha.externalUrl ? (
          <div>
            <dt>na fonte</dt>
            <dd>
              <a href={linha.externalUrl} target="_blank" rel="noreferrer">
                abrir no {linha.source ?? "provedor"}
              </a>
            </dd>
          </div>
        ) : null}
      </dl>

      <div className="agenda-form">
        <label>
          <span>dia esperado</span>
          <input type="date" value={dia} onChange={(e) => setDia(e.target.value)} />
        </label>
        <label>
          <span>valor (R$)</span>
          <input type="number" step="0.01" value={valor} onChange={(e) => setValor(e.target.value)} />
        </label>
        <label>
          <span>categoria (code)</span>
          <input type="text" value={categoria} onChange={(e) => setCategoria(e.target.value)} placeholder="5.01" />
        </label>
        <label className="largo">
          <span>descrição</span>
          <input type="text" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
        </label>
        <button type="button" className="fin-btn-primary" disabled={salvando} onClick={() => void salvar()}>
          {salvando ? "salvando…" : "salvar correção"}
        </button>
        {msg ? <span className="agenda-form-msg">{msg}</span> : null}
      </div>

      <p className="agenda-gaveta-nota">
        Corrigir aqui muda a <strong>previsão</strong>, nunca o caixa: nenhum lançamento é criado, nenhum saldo muda, e
        o valor anterior fica em <code>fin_audit_log</code>. Se o item ainda era projeção, ele é materializado no ato —
        e materializar não muda o total do mês.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cadastrar um futuro
// ---------------------------------------------------------------------------

function FormNovoPrevisto({ dia, onPronto }: { dia: string; onPronto: () => void }) {
  const [direcao, setDirecao] = useState<"receber" | "pagar">("pagar");
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [motivo, setMotivo] = useState("");
  const [diaEsperado, setDiaEsperado] = useState(dia);
  const [categoria, setCategoria] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function criar() {
    setSalvando(true);
    setMsg(null);
    try {
      const r = await fetch("/api/financeiro/gerencial/agenda/itens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          direcao,
          competencia: diaEsperado.slice(0, 7),
          descricao,
          diaEsperado,
          categoria: categoria || undefined,
          valorCents: valor ? Math.round(Number(valor) * 100) : undefined,
          indeterminadoMotivo: valor ? undefined : motivo || undefined
        })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.erro ?? `HTTP ${r.status}`);
      setMsg(`criado #${j.id} — previsão, não caixa`);
      setDescricao("");
      setValor("");
      onPronto();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "falhou");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="agenda-novo fin-form-novo">
      <h3>Cadastrar um futuro</h3>
      <p className="fin-field-hint">
        Uma obrigação ou um recebimento que <strong>nenhuma fonte declarou</strong>. Entra na agenda com camada própria,
        distinta do que veio de fonte — e não vira lançamento, cobrança nem saldo.
      </p>
      <div className="fin-form-grid">
        <label className="fin-field">
          <span>direção</span>
          <select value={direcao} onChange={(e) => setDirecao(e.target.value as typeof direcao)}>
            <option value="pagar">vou pagar</option>
            <option value="receber">vou receber</option>
          </select>
        </label>
        <label className="fin-field">
          <span>dia esperado</span>
          <input type="date" value={diaEsperado} onChange={(e) => setDiaEsperado(e.target.value)} />
        </label>
        <label className="fin-field fin-field-wide">
          <span>descrição</span>
          <input type="text" value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="o que é" />
        </label>
        <label className="fin-field">
          <span>valor (R$)</span>
          <input type="number" step="0.01" value={valor} onChange={(e) => setValor(e.target.value)} />
        </label>
        <label className="fin-field">
          <span>categoria (code)</span>
          <input type="text" value={categoria} onChange={(e) => setCategoria(e.target.value)} placeholder="5.01" />
        </label>
        {!valor ? (
          <label className="fin-field fin-field-wide">
            {/* Sem valor exige motivo — a restrição nº 5 do projeto, na tela. */}
            <span>sem valor? diga por quê (obrigatório)</span>
            <input
              type="text"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="ex.: aguardando o orçamento do fornecedor"
            />
          </label>
        ) : null}
      </div>
      <div className="fin-form-acoes">
        <button
          type="button"
          className="fin-btn-primary"
          disabled={salvando || !descricao.trim() || (!valor && !motivo.trim())}
          onClick={() => void criar()}
        >
          {salvando ? "criando…" : "cadastrar"}
        </button>
        {msg ? <span className="agenda-form-msg">{msg}</span> : null}
      </div>
    </div>
  );
}

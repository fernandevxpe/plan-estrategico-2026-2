"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { LinhaLacuna, Ressalva, SeloCamada, brl } from "./Certeza";
import type { Contrato } from "@/lib/financeiro/contratos/base";
import type { DreDrill, MoverCategoria, NoDrill, RegraDeOuro } from "@/lib/financeiro/contratos/dre-drill";
import type {
  AjusteDeclarado,
  CategoriaDestino,
  DreResultado,
  LinhaResultado,
  ResultadoAjuste
} from "@/lib/financeiro/contratos/dre-resultado";

import "./FinResultado.css";

/**
 * A DRE que se abre até o lançamento — e o único lugar desta base onde alguém
 * muda uma linha da DRE sem editar a DRE.
 *
 * ---------------------------------------------------------------------------
 * O PEDIDO, E AS QUATRO COISAS QUE ELE PEDE AO MESMO TEMPO
 * ---------------------------------------------------------------------------
 * "ver o resumo, expandir as linhas ver mais em detalhe cada parte que compõe,
 *  tudo organizado, e permitir usuário inclusive tirar algo de um para outro,
 *  adicionar algo, e na realidade o feito é sempre o caixa"
 *
 * 1. RESUMO QUE EXPANDE. Quatro níveis: linha → categoria → contraparte →
 *    lançamento. Cada um soma exatamente o de cima, e o backend prova isso em
 *    64 meses com zero grupos divergentes.
 *
 * 2. "O FEITO É SEMPRE O CAIXA". Isso não é uma frase de efeito: é a regra de
 *    ouro, `abertura + DRE de caixa = saldo`, com resíduo R$ 0,00, no alto da
 *    tela. Se ela deixar de fechar, nenhum outro número desta página vale.
 *
 * 3. TIRAR DE UM PARA OUTRO. Com uma sutileza que a tela precisa comunicar em
 *    vez de esconder: **a DRE não é editada — o lançamento é reclassificado, e
 *    a DRE se refaz sozinha**. Por isso o fluxo é seleciona → vê o impacto
 *    medido nas duas linhas → confirma.
 *
 * 4. ADICIONAR ALGO. Só existe uma forma honesta: o ajuste DECLARADO, em seção
 *    própria, que não altera caixa nem saldo — e a tela devolve a medida disso.
 *
 * ---------------------------------------------------------------------------
 * A GARANTIA QUE ESTA TELA EXISTE PARA TORNAR VISÍVEL
 * ---------------------------------------------------------------------------
 * O total NUNCA muda ao expandir. É a promessa central de um drill, e é a
 * primeira que quebra em silêncio quando alguém filtra o nível de baixo sem
 * refiltrar o de cima. Então a tela não confia nela: ela CONGELA o total no
 * instante em que o mês abre, recompara a cada expansão, conta quantas
 * expansões houve, e mostra o resíduo. Zero é o resultado esperado; qualquer
 * outra coisa aparece em vermelho no topo, sem precisar que ninguém confira.
 *
 * ---------------------------------------------------------------------------
 * O CUIDADO MAIS CARO DESTE ARQUIVO
 * ---------------------------------------------------------------------------
 * `fin_transaction_sinal_da_categoria` NÃO recusa categoria de sinal errado:
 * ele apaga (`category_id := NULL`) e devolve sucesso. A rota valida antes e
 * recusa em português — mas a tela não pode depender disso. Ela **nunca diz
 * "movido" a partir do 200 da resposta**: ela lê a avaliação que volta DEPOIS
 * do UPDATE e exige que cada lançamento afirme estar na categoria de destino.
 * Ver `confirmarMovimento`. O pior caso possível aqui é a tela comemorar e o
 * lançamento ter caído na lacuna.
 */

/** O separador das chaves do drill: U+001F, porque nome é texto livre. */
const SEP = "\u001F";

const NIVEL_NOME = ["linha", "categoria", "contraparte", "lancamento"] as const;

const SECAO_TITULO: Record<string, { titulo: string; hint: string }> = {
  resultado: {
    titulo: "Resultado",
    hint: "O que a operação ganhou e gastou. Clique numa linha para abrir as categorias."
  },
  fora: {
    titulo: "Fora da DRE, de propósito",
    hint:
      "Existe no caixa e não é resultado: investimento, remessa entre contas próprias e pagamento de fatura de cartão " +
      "(a despesa dele já está nos itens, contá-la de novo aqui seria duas vezes)."
  },
  lacuna: {
    titulo: "Lacuna — dinheiro que andou e ainda não tem linha",
    hint:
      "Não é ausência de movimento, e não é zero. É valor no extrato cuja linha ninguém decidiu ainda. " +
      "Abra até o lançamento e mova-o para a linha certa."
  },
  ajuste: { titulo: "Ajustes declarados", hint: "Afirmação humana, com autor e motivo. Não é extrato." }
};

type Props = {
  drillInicial: Contrato<DreDrill>;
  esqueletoInicial: Contrato<DreResultado>;
  autorPadrao: string;
};

export function FinResultado({ drillInicial, esqueletoInicial, autorPadrao }: Props) {
  const [visao, setVisao] = useState<"caixa" | "competencia">(drillInicial.dado.visao);
  const [mes, setMes] = useState<string | null>(esqueletoInicial.dado.mes);
  const [expandidos, setExpandidos] = useState<string[]>([]);
  const [drill, setDrill] = useState<Contrato<DreDrill>>(drillInicial);
  const [esq, setEsq] = useState<Contrato<DreResultado>>(esqueletoInicial);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // A âncora: o total do nível 1 no instante em que o mês abriu, mais quantas
  // expansões aconteceram desde então. É a prova visual de que abrir não muda.
  const ancora = useRef<{ chave: string; totalCents: number; aberturas: number }>({
    chave: `${drillInicial.dado.visao}|${esqueletoInicial.dado.mes}`,
    totalCents: somaNivel1(drillInicial.dado.nos),
    aberturas: 0
  });
  const [, redesenhar] = useState(0);

  const carregar = useCallback(
    async (proxima: { visao: "caixa" | "competencia"; mes: string | null; expandidos: string[] }) => {
      setCarregando(true);
      setErro(null);
      try {
        const nivel = NIVEL_NOME[Math.min(3, profundidadePedida(proxima.expandidos))];
        const p = new URLSearchParams();
        p.set("visao", proxima.visao);
        if (proxima.mes) p.set("mes", proxima.mes);
        p.set("nivel", nivel);
        for (const chave of proxima.expandidos) p.append("expandir", chave);

        const q = new URLSearchParams();
        q.set("visao", proxima.visao);
        if (proxima.mes) q.set("mes", proxima.mes);

        const [rDrill, rEsq] = await Promise.all([
          fetch(`/api/financeiro/gerencial/dre/drill?${p.toString()}`, { cache: "no-store" }),
          fetch(`/api/financeiro/gerencial/dre/resultado?${q.toString()}`, { cache: "no-store" })
        ]);
        const cDrill = (await rDrill.json()) as Contrato<DreDrill>;
        const cEsq = (await rEsq.json()) as Contrato<DreResultado>;
        if (!cDrill?.dado || !cEsq?.dado) throw new Error("resposta sem contrato");

        setDrill(cDrill);
        setEsq(cEsq);

        const chave = `${proxima.visao}|${cEsq.dado.mes}`;
        if (ancora.current.chave !== chave) {
          ancora.current = { chave, totalCents: somaNivel1(cDrill.dado.nos), aberturas: 0 };
        } else {
          ancora.current.aberturas += 1;
        }
        redesenhar((n) => n + 1);
      } catch (e) {
        setErro(e instanceof Error ? e.message : "falha ao carregar a DRE");
      } finally {
        setCarregando(false);
      }
    },
    []
  );

  // ---- seleção para mover -------------------------------------------------
  const [sel, setSel] = useState<NoDrill[]>([]);
  const alvo = sel.length
    ? sel[0].origem === "cartao"
      ? ("fin_card_transaction" as const)
      : ("fin_transaction" as const)
    : ("fin_transaction" as const);

  function alternarSelecao(no: NoDrill) {
    setSel((atual) => {
      const dentro = atual.some((n) => n.chave === no.chave);
      if (dentro) return atual.filter((n) => n.chave !== no.chave);
      if (atual.length && atual[0].origem !== no.origem) {
        setErro(
          "Um lote é de uma origem só: item de cartão e lançamento bancário vivem em tabelas diferentes " +
            "e a rota recebe um alvo por vez. Conclua ou limpe a seleção atual antes de misturar."
        );
        return atual;
      }
      return [...atual, no];
    });
  }

  const nos = drill.dado.nos;
  const porChave = useMemo(() => new Map(nos.map((n) => [n.chave, n])), [nos]);
  const filhos = useMemo(() => {
    const m = new Map<string, NoDrill[]>();
    for (const n of nos) {
      if (!n.pai) continue;
      const lista = m.get(n.pai) ?? [];
      lista.push(n);
      m.set(n.pai, lista);
    }
    return m;
  }, [nos]);

  const totalAtual = somaNivel1(nos);
  const residuoAncora = totalAtual - ancora.current.totalCents;

  // A conferência que o drill promete: os filhos de cada nó aberto somam o pai.
  const conferencia = useMemo(() => {
    let conferidos = 0;
    let divergentes = 0;
    const divergencia = new Map<string, number>();
    for (const chave of expandidos) {
      const pai = porChave.get(chave);
      const lista = filhos.get(chave);
      if (!pai || !lista?.length) continue;
      const soma = lista.reduce((s, f) => s + f.valorCents, 0);
      if (soma === pai.valorCents) conferidos += 1;
      else {
        divergentes += 1;
        divergencia.set(chave, soma - pai.valorCents);
      }
    }
    return { conferidos, divergentes, divergencia };
  }, [expandidos, porChave, filhos]);

  function alternar(no: NoDrill) {
    const aberto = expandidos.includes(no.chave);
    const proximos = aberto
      ? expandidos.filter((c) => c !== no.chave && !c.startsWith(`${no.chave}${SEP}`))
      : [...expandidos, no.chave];
    setExpandidos(proximos);
    void carregar({ visao, mes, expandidos: proximos });
  }

  function trocarVisao(proxima: "caixa" | "competencia") {
    setVisao(proxima);
    setExpandidos([]);
    setSel([]);
    void carregar({ visao: proxima, mes, expandidos: [] });
  }

  function trocarMes(proximo: string) {
    setMes(proximo);
    setExpandidos([]);
    setSel([]);
    void carregar({ visao, mes: proximo, expandidos: [] });
  }

  const recarregar = useCallback(() => carregar({ visao, mes, expandidos }), [carregar, visao, mes, expandidos]);

  const dados = esq.dado;
  const ressalvasDoMes = dados.ressalvas.filter((r) => r.linha === null);
  const ressalvaDaLinha = (linha: string) => dados.ressalvas.filter((r) => r.linha === linha);
  const lucro = dados.linhas.find((l) => l.linha === "lucro_liquido");
  const lucroComLacunas = dados.linhas.find((l) => l.linha === "lucro_liquido_com_lacunas");

  if (!drill.disponivel || !esq.disponivel) {
    return (
      <section className="card fin-empty">
        <h2 className="card-title">DRE indisponível</h2>
        <p>{drill.ressalvas[0] ?? esq.ressalvas[0] ?? "sem conexão com o banco do financeiro"}</p>
      </section>
    );
  }

  return (
    <div className="res">
      <RegraDeOuroFaixa ouro={drill.dado.regraDeOuro} />

      <section className="res-controles card">
        <div className="res-visao" role="group" aria-label="Regime da DRE">
          <button
            type="button"
            className={visao === "caixa" ? "res-toggle ativo" : "res-toggle"}
            onClick={() => trocarVisao("caixa")}
          >
            <strong>Caixa</strong>
            <span>o que entrou e saiu do banco. O feito.</span>
          </button>
          <button
            type="button"
            className={visao === "competencia" ? "res-toggle ativo" : "res-toggle"}
            onClick={() => trocarVisao("competencia")}
          >
            <strong>Competência</strong>
            <span>o mesmo dinheiro reposicionado no tempo.</span>
          </button>
        </div>

        <label className="res-mes">
          <span>Mês</span>
          <select value={mes ?? ""} onChange={(e) => trocarMes(e.target.value)} disabled={carregando}>
            {dados.meses.map((m) => (
              <option key={m.mes} value={m.mes}>
                {rotuloMes(m.mes)} · {brl(m.lucroLiquidoCents)}
              </option>
            ))}
          </select>
        </label>

        <AncoraDoTotal
          totalCents={totalAtual}
          residuoCents={residuoAncora}
          aberturas={ancora.current.aberturas}
          conferidos={conferencia.conferidos}
          divergentes={conferencia.divergentes}
          carregando={carregando}
        />
      </section>

      {/* O toggle não é filtro: ele troca o significado da tela inteira, e a
          ressalva do mês aberto tem de ser lida ANTES do número. */}
      <div className="res-ressalvas">
        <Ressalva>
          <strong>{visao === "caixa" ? "Visão de CAIXA." : "Visão de COMPETÊNCIA."}</strong>{" "}
          {visao === "caixa"
            ? "Realizado é o extrato, sempre. Item de cartão não aparece aqui — o caixa dele é o pagamento da fatura, que é outro lançamento. Esta é a visão que reconstrói o saldo."
            : "O MESMO dinheiro, reposicionado para o mês em que foi ganho ou consumido. Nada aqui é dinheiro diferente do caixa; é o caixa em outra ordem. Item de cartão só existe nesta visão."}
        </Ressalva>
        {ressalvasDoMes.map((r) => (
          <Ressalva key={r.chave}>
            {r.texto}
            {r.valorEmJogoCents ? <strong> Em jogo: {brl(r.valorEmJogoCents)}.</strong> : null}
          </Ressalva>
        ))}
        {erro ? <p className="res-erro">{erro}</p> : null}
      </div>

      <section className="card res-tabela-card">
        <h2 className="card-title">
          DRE de {rotuloMes(dados.mes ?? "")} · {visao === "caixa" ? "caixa" : "competência"}
        </h2>
        <p className="fin-card-hint">
          Quatro níveis: linha → categoria → contraparte → lançamento. Cada nível soma exatamente o de cima — a tela
          confere isso a cada abertura e mostra o resíduo ali em cima. Nada aqui é digitado à mão: tudo é derivado do
          extrato.
        </p>

        <div className="table-wrap">
          <table className="fin-table res-dre">
            <thead>
              <tr>
                <th>Linha</th>
                <th className="num">Lançamentos</th>
                <th className="num">Valor</th>
                <th>Certeza</th>
              </tr>
            </thead>
            <tbody>
              {renderSecoes({
                linhas: dados.linhas.filter((l) => l.secao !== "ajuste"),
                porChave,
                filhos,
                expandidos,
                alternar,
                ressalvaDaLinha,
                divergencia: conferencia.divergencia,
                sel,
                alternarSelecao,
                lucro,
                lucroComLacunas
              })}
            </tbody>
          </table>
        </div>
      </section>

      <SecaoAjuste
        dados={dados}
        visao={visao}
        mes={dados.mes}
        autorPadrao={autorPadrao}
        aoMudar={recarregar}
      />

      {sel.length ? (
        <PainelMover
          selecionados={sel}
          alvo={alvo}
          categorias={dados.categorias}
          autorPadrao={autorPadrao}
          aoLimpar={() => setSel([])}
          aoAplicar={async () => {
            setSel([]);
            await recarregar();
          }}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// A regra de ouro — "o feito é sempre o caixa", medido
// ---------------------------------------------------------------------------

function RegraDeOuroFaixa({ ouro }: { ouro: RegraDeOuro | null }) {
  if (!ouro) {
    return (
      <div className="res-ouro res-ouro-indet cert-hachura">
        <strong>A regra de ouro não pôde ser medida.</strong>
        <span>
          Sem ela não há como afirmar que esta DRE é o caixa. Não cite nenhum número desta tela até
          <code> fin_dre_regra_de_ouro_v</code> responder.
        </span>
      </div>
    );
  }

  return (
    <div className={ouro.fecha ? "res-ouro" : "res-ouro res-ouro-quebrada"}>
      <div className="res-ouro-titulo">
        <SeloCamada camada={ouro.fecha ? "firme" : "atrasado"} texto={ouro.fecha ? "fecha" : "NÃO fecha"} />
        <strong>O feito é sempre o caixa</strong>
      </div>
      <div className="res-ouro-conta">
        <span>
          abertura <b>{brl(ouro.aberturaCents)}</b>
        </span>
        <span className="res-ouro-op">+</span>
        <span>
          DRE de caixa <b>{brl(ouro.dreCaixaCents)}</b>
        </span>
        <span className="res-ouro-op">=</span>
        <span>
          saldo hoje <b>{brl(ouro.atualCents)}</b>
        </span>
        <span className="res-ouro-res">
          resíduo <b>{brl(ouro.residuoSaldoCents)}</b>
        </span>
      </div>
      <p className="res-ouro-sub">
        {ouro.meses} meses · {ouro.lancamentos.toLocaleString("pt-BR")} lançamentos · resíduo contra o ledger{" "}
        {brl(ouro.residuoLedgerCents)} · {ouro.itensCartaoNoCaixa} item de cartão na visão caixa (tem de ser 0: item de
        cartão não tem caixa próprio).
        {ouro.fecha
          ? " Enquanto isto for zero, a DRE é derivada do extrato — não é uma segunda verdade."
          : " ENQUANTO ISTO NÃO FOR ZERO, NENHUM NÚMERO DESTA TELA DEVE SER CITADO."}
      </p>
    </div>
  );
}

function AncoraDoTotal({
  totalCents,
  residuoCents,
  aberturas,
  conferidos,
  divergentes,
  carregando
}: {
  totalCents: number;
  residuoCents: number;
  aberturas: number;
  conferidos: number;
  divergentes: number;
  carregando: boolean;
}) {
  const ok = residuoCents === 0 && divergentes === 0;
  return (
    <div className={ok ? "res-ancora" : "res-ancora res-ancora-ruim"}>
      <span className="res-ancora-k">Total das linhas, somado agora</span>
      <strong className="res-ancora-v">{brl(totalCents)}</strong>
      <span className="res-ancora-sub">
        {carregando ? (
          "abrindo…"
        ) : (
          <>
            {aberturas === 0
              ? "congelado nesta abertura — expanda e veja que ele não se mexe"
              : `${aberturas} ${aberturas === 1 ? "expansão" : "expansões"} depois, diferença de ${brl(residuoCents)}`}
            {conferidos ? ` · ${conferidos} ${conferidos === 1 ? "nó confere" : "nós conferem"} com os filhos` : ""}
            {divergentes ? ` · ${divergentes} DIVERGENTE(S)` : ""}
          </>
        )}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// As seções e as linhas
// ---------------------------------------------------------------------------

function renderSecoes(args: {
  linhas: LinhaResultado[];
  porChave: Map<string, NoDrill>;
  filhos: Map<string, NoDrill[]>;
  expandidos: string[];
  alternar: (no: NoDrill) => void;
  ressalvaDaLinha: (linha: string) => { chave: string; texto: string; valorEmJogoCents: number }[];
  divergencia: Map<string, number>;
  sel: NoDrill[];
  alternarSelecao: (no: NoDrill) => void;
  lucro?: LinhaResultado;
  lucroComLacunas?: LinhaResultado;
}) {
  const saida: React.ReactNode[] = [];
  let secaoAtual = "";

  for (const l of args.linhas) {
    if (l.secao !== secaoAtual) {
      secaoAtual = l.secao;
      const cabecalho = SECAO_TITULO[l.secao];
      saida.push(
        <tr key={`secao-${l.secao}`} className="res-secao">
          <td colSpan={4}>
            <strong>{cabecalho?.titulo ?? l.secao}</strong>
            <em>{cabecalho?.hint}</em>
          </td>
        </tr>
      );
    }

    // A ressalva vem ANTES do número, na linha de cima — e vale mesmo quando a
    // linha não tem nó nenhum no drill (pessoal em agosto vale zero porque a
    // folha sai em 01/09; é exatamente a ressalva que mais importa).
    for (const r of args.ressalvaDaLinha(l.linha)) {
      saida.push(
        <tr key={`ress-${l.linha}-${r.chave}`} className="res-ressalva-linha">
          <td colSpan={4}>
            <Ressalva>
              <strong>Antes de ler {l.nome}:</strong> {r.texto}
            </Ressalva>
          </td>
        </tr>
      );
    }

    // Antes do lucro líquido, o que ele NÃO contém. Depois dele seria tarde.
    if (l.linha === "lucro_liquido" && args.lucroComLacunas && args.lucro) {
      const dif = args.lucroComLacunas.valorCents - args.lucro.valorCents;
      if (dif !== 0) {
        saida.push(
          <tr key="ress-lucro" className="res-ressalva-linha">
            <td colSpan={4}>
              <Ressalva>
                <strong>Antes de ler o lucro:</strong> ele não inclui {brl(dif)} de lacuna — dinheiro que andou no
                extrato e ainda não tem linha. Com a lacuna dentro, o resultado é{" "}
                <b>{brl(args.lucroComLacunas.valorCents)}</b>. Os dois são publicados; escolher um pelo leitor seria
                decidir por ele.
              </Ressalva>
            </td>
          </tr>
        );
      }
    }

    const no = args.porChave.get(l.linha);

    if (l.tipo === "subtotal") {
      saida.push(
        <tr key={l.linha} className="res-subtotal">
          <td>
            <strong>{l.nome}</strong>
            {l.formula ? <em className="res-formula">{l.formula}</em> : null}
          </td>
          <td />
          <td className={classeValor(l.valorCents)}>
            <strong>{brl(l.valorCents)}</strong>
          </td>
          <td />
        </tr>
      );
      continue;
    }

    if (!no) {
      // Linha sem lançamento no mês. Zero com motivo, nunca zero mudo.
      saida.push(
        <tr key={l.linha} className="res-linha res-linha-vazia">
          <td>
            <span className="res-rotulo">{l.nome}</span>
            <em className="res-vazio">nenhum lançamento neste mês nesta visão</em>
          </td>
          <td className="num">0</td>
          <td className={classeValor(l.valorCents)}>{brl(l.valorCents)}</td>
          <td />
        </tr>
      );
      continue;
    }

    saida.push(...renderNo(no, 0, args));
  }

  return saida;
}

function renderNo(
  no: NoDrill,
  _profundidade: number,
  args: Parameters<typeof renderSecoes>[0]
): React.ReactNode[] {
  const saida: React.ReactNode[] = [];
  const aberto = args.expandidos.includes(no.chave);
  const meusFilhos = args.filhos.get(no.chave) ?? [];
  const divergencia = args.divergencia.get(no.chave);
  const selecionado = args.sel.some((s) => s.chave === no.chave);
  const folha = no.nivelNome === "lancamento";

  saida.push(
    <tr
      key={no.chave}
      className={[
        "res-linha",
        `res-n${no.nivel}`,
        no.ehLacuna ? "res-lacuna" : "",
        selecionado ? "res-selecionado" : ""
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <td>
        <span className="res-celula" style={{ paddingLeft: `${no.indentacao * 20}px` }}>
          {no.temFilhos ? (
            <button
              type="button"
              className="res-caret"
              aria-expanded={aberto}
              onClick={() => args.alternar(no)}
              title={aberto ? "fechar" : "abrir e conferir a soma"}
            >
              {aberto ? "▾" : "▸"}
            </button>
          ) : (
            <span className="res-caret res-caret-vazio" aria-hidden="true" />
          )}
          {folha ? (
            <input
              type="checkbox"
              className="res-check"
              checked={selecionado}
              onChange={() => args.alternarSelecao(no)}
              aria-label={`selecionar ${no.rotulo}`}
            />
          ) : null}
          <span className={no.nivel === 1 ? "res-rotulo res-rotulo-forte" : "res-rotulo"}>{no.rotulo}</span>
        </span>
        {aberto && meusFilhos.length ? (
          divergencia === undefined ? (
            <em className="res-confere">
              ✓ {meusFilhos.length} {meusFilhos.length === 1 ? "filho soma" : "filhos somam"} exatamente este total —
              abrir não mudou nada
            </em>
          ) : (
            <em className="res-diverge">
              ✗ os filhos somam {brl(divergencia)} a mais que esta linha. Isto é bug do drill, não arredondamento — não
              use este número.
            </em>
          )
        ) : null}
        {no.destinoProvavel ? <DestinoProvavelSelo destino={no.destinoProvavel} /> : null}
      </td>
      <td className="num">{no.lancamentos.toLocaleString("pt-BR")}</td>
      <td className={classeValor(no.valorCents)}>{brl(no.valorCents)}</td>
      <td>
        {no.ehLacuna ? (
          <SeloCamada camada="indeterminado" />
        ) : no.travados ? (
          <span className="res-tag" title="categoria travada por decisão humana anterior">
            {no.travados} travado{no.travados === 1 ? "" : "s"}
          </span>
        ) : null}
      </td>
    </tr>
  );

  // A lacuna DENTRO do grupo, indentada sob ele — nunca num rodapé, que é a
  // forma elegante de esconder. `lacunaCents` existe em todo nível.
  if (!no.ehLacuna && no.lacunaCents !== 0) {
    saida.push(
      <LinhaLacuna
        key={`${no.chave}-lacuna`}
        rotulo={`sem categoria dentro de ${no.rotulo} · ${no.semCategoria} lançamento(s)`}
        valorCents={no.lacunaCents}
        colunasVazias={1}
        motivo="Existe no extrato e ainda não tem linha. Abra até o lançamento e mova-o para a categoria certa."
      />
    );
  }

  if (aberto) {
    for (const f of meusFilhos) saida.push(...renderNo(f, no.indentacao + 1, args));
  }

  return saida;
}

function DestinoProvavelSelo({ destino }: { destino: NonNullable<NoDrill["destinoProvavel"]> }) {
  if (!destino.linha) {
    return (
      <em className="res-destino res-destino-indet">
        destino indeterminado — {destino.motivoIndeterminado ?? "sem evidência"}
      </em>
    );
  }
  return (
    <em className="res-destino" title={destino.evidencia ?? undefined}>
      destino provável: <b>{destino.linhaNome ?? destino.linha}</b>
      {destino.concordanciaPct !== null ? ` · ${destino.concordanciaPct.toFixed(0)}% do histórico da contraparte` : ""} ·
      hipótese, nunca somada
    </em>
  );
}

// ---------------------------------------------------------------------------
// Mover: tirar de uma linha e pôr em outra
// ---------------------------------------------------------------------------

function PainelMover({
  selecionados,
  alvo,
  categorias,
  autorPadrao,
  aoLimpar,
  aoAplicar
}: {
  selecionados: NoDrill[];
  alvo: "fin_transaction" | "fin_card_transaction";
  categorias: CategoriaDestino[];
  autorPadrao: string;
  aoLimpar: () => void;
  aoAplicar: () => Promise<void>;
}) {
  const [destino, setDestino] = useState<number | null>(null);
  const [dry, setDry] = useState<Contrato<MoverCategoria> | null>(null);
  const [motivo, setMotivo] = useState("");
  const [autor, setAutor] = useState(autorPadrao);
  const [ocupado, setOcupado] = useState(false);
  const [falha, setFalha] = useState<string | null>(null);
  const [veredito, setVeredito] = useState<{ ok: boolean; texto: string; impacto: MoverCategoria["impacto"] } | null>(
    null
  );

  const ids = selecionados.map((s) => s.lancamentoId).filter((i): i is number => i !== null);
  const total = selecionados.reduce((s, n) => s + n.valorCents, 0);
  const categoria = categorias.find((c) => c.id === destino) ?? null;

  // Trocar o destino invalida o dry-run: aplicar com o julgamento de outra
  // categoria é exatamente o erro que o dry-run existe para evitar.
  useEffect(() => {
    setDry(null);
    setVeredito(null);
  }, [destino, selecionados.length]);

  async function simular() {
    if (!destino) return;
    setOcupado(true);
    setFalha(null);
    try {
      const p = new URLSearchParams();
      p.set("alvo", alvo);
      p.set("ids", ids.join(","));
      p.set("categoriaId", String(destino));
      const r = await fetch(`/api/financeiro/gerencial/dre/mover-categoria?${p.toString()}`, { cache: "no-store" });
      const c = (await r.json()) as Contrato<MoverCategoria> & { erro?: string };
      if (c.erro) throw new Error(c.erro);
      setDry(c);
    } catch (e) {
      setFalha(e instanceof Error ? e.message : "falha ao simular");
    } finally {
      setOcupado(false);
    }
  }

  async function aplicar() {
    if (!destino || !dry) return;
    setOcupado(true);
    setFalha(null);
    try {
      const r = await fetch("/api/financeiro/gerencial/dre/mover-categoria", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ alvo, ids, categoriaId: destino, motivo, autor, aplicar: true })
      });
      const c = (await r.json()) as Contrato<MoverCategoria> & { erro?: string };
      if (c.erro) throw new Error(c.erro);
      const conferido = confirmarMovimento(c, ids);
      setVeredito({ ok: conferido.ok, texto: conferido.texto, impacto: c.dado?.impacto ?? [] });
      if (conferido.ok) await aoAplicar();
    } catch (e) {
      setFalha(e instanceof Error ? e.message : "falha ao aplicar");
    } finally {
      setOcupado(false);
    }
  }

  const recusados = dry?.dado.avaliacoes.filter((a) => !a.aceito) ?? [];
  const podeAplicar = Boolean(dry && !recusados.length && motivo.trim().length >= 8 && autor.trim().length > 0);

  return (
    <aside className="res-mover">
      <header>
        <div>
          <strong>
            {selecionados.length} {selecionados.length === 1 ? "lançamento" : "lançamentos"} · {brl(total)}
          </strong>
          <span>
            {alvo === "fin_card_transaction" ? "itens de cartão" : "lançamentos bancários"} — mover é{" "}
            <b>reclassificar</b>, e a DRE se refaz sozinha. Nenhum centavo muda de conta.
          </span>
        </div>
        <button type="button" className="res-btn-sec" onClick={aoLimpar}>
          limpar seleção
        </button>
      </header>

      <div className="res-mover-linha">
        <label>
          <span>Para qual linha</span>
          <select value={destino ?? ""} onChange={(e) => setDestino(Number(e.target.value) || null)}>
            <option value="">escolha a categoria de destino…</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} {c.nome} → {c.linhaNome ?? c.linha ?? "sem linha"}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="res-btn" onClick={simular} disabled={!destino || ocupado}>
          {ocupado ? "medindo…" : "Ver o impacto (nada é gravado)"}
        </button>
      </div>

      {categoria ? (
        <p className="res-mover-nota">
          {categoria.code} cai em <b>{categoria.linhaNome ?? categoria.linha}</b>. A DRE não é editada: o lançamento
          muda de categoria e a linha se recalcula a partir do extrato.
        </p>
      ) : null}

      {falha ? <p className="res-erro">{falha}</p> : null}

      {dry ? (
        <div className="res-dry">
          <h4>Impacto medido, antes de gravar</h4>
          <table className="fin-table">
            <thead>
              <tr>
                <th>Linha</th>
                <th className="num">Antes</th>
                <th className="num">Depois</th>
                <th className="num">Diferença</th>
              </tr>
            </thead>
            <tbody>
              {dry.dado.impacto.map((i) => (
                <tr key={`${i.visao}-${i.mes}-${i.linha}`}>
                  <td>
                    {i.linhaNome ?? i.linha} <em>{i.visao} · {rotuloMes(i.mes)}</em>
                  </td>
                  <td className="num fin-table-money">{brl(i.valorAntesCents)}</td>
                  <td className="num fin-table-money">{brl(i.valorDepoisCents)}</td>
                  <td className={classeValor(i.deltaCents)}>{brl(i.deltaCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="res-dry-nota">
            A soma das diferenças de cada (visão, mês) é zero: sai de uma linha e entra na outra. Mover reposiciona, não
            cria nem destrói.
          </p>

          {recusados.length ? (
            <div className="res-recusa">
              <strong>
                {recusados.length} {recusados.length === 1 ? "recusado" : "recusados"} — o lote é tudo ou nada.
              </strong>
              <ul>
                {recusados.map((r) => (
                  <li key={r.id}>
                    #{r.id} — {r.recusa}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {dry.dado.avaliacoes.some((a) => a.travado) ? (
            <p className="res-aviso-travado">
              Há lançamento com categoria <b>travada por decisão humana anterior</b>. Mover sobrescreve gente, não
              palpite de máquina — confira antes.
            </p>
          ) : null}

          {!recusados.length ? (
            <div className="res-confirmar">
              <label>
                <span>Por quê? (a trilha guarda isto)</span>
                <textarea
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  rows={2}
                  placeholder="ex.: a regra 40 casava o banco do recebedor, não a contraparte"
                />
                <em>{motivo.trim().length}/8 caracteres mínimos — “ajuste” não é motivo</em>
              </label>
              <label>
                <span>Quem decide</span>
                <input value={autor} onChange={(e) => setAutor(e.target.value)} />
              </label>
              <button type="button" className="res-btn res-btn-forte" onClick={aplicar} disabled={!podeAplicar || ocupado}>
                {ocupado ? "aplicando…" : "Mover de verdade"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {veredito ? (
        <div className={veredito.ok ? "res-veredito ok" : "res-veredito ruim"}>
          <strong>{veredito.texto}</strong>
          {veredito.impacto.length ? (
            <ul>
              {veredito.impacto.map((i) => (
                <li key={`${i.visao}-${i.mes}-${i.linha}`}>
                  {i.linha} · {rotuloMes(i.mes)}: {brl(i.valorAntesCents)} → {brl(i.valorDepoisCents)} (
                  {brl(i.deltaCents)})
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}

/**
 * A tela nunca diz "movido" por causa de um HTTP 200.
 *
 * `fin_transaction_sinal_da_categoria` apaga a categoria em vez de recusar, e
 * devolve sucesso. Então a confirmação exigida aqui é mais forte que o status:
 * cada id precisa VOLTAR, na avaliação pós-UPDATE, afirmando que já está na
 * categoria de destino (`semEfeito` com `categoriaAntes === categoriaDepois`).
 * Se a categoria tivesse sido apagada, `categoriaAntes` viria nula — e é
 * exatamente esse caso que esta função existe para não deixar passar.
 */
function confirmarMovimento(
  c: Contrato<MoverCategoria>,
  ids: number[]
): { ok: boolean; texto: string } {
  if (!c.disponivel) {
    return { ok: false, texto: `NÃO foi movido: ${c.ressalvas[0] ?? "o contrato voltou indisponível"}` };
  }
  const d = c.dado;
  if (!d.aplicado || !d.batchId) {
    return { ok: false, texto: "NÃO foi movido: a resposta não trouxe lote aplicado. Nada foi gravado." };
  }
  const faltando = ids.filter((id) => {
    const a = d.avaliacoes.find((x) => x.id === id);
    return !a || !a.semEfeito || !a.categoriaDepois || a.categoriaAntes !== a.categoriaDepois;
  });
  if (faltando.length) {
    return {
      ok: false,
      texto:
        `ATENÇÃO: a API respondeu, mas ${faltando.length} lançamento(s) (${faltando.join(", ")}) NÃO confirmaram estar ` +
        "na categoria de destino. Pode ter caído na lacuna — o gatilho de sinal apaga a categoria e devolve sucesso. " +
        "NÃO trate como movido: abra a linha e confira antes de qualquer outra coisa."
    };
  }
  return {
    ok: true,
    texto:
      `Movido e conferido: ${ids.length} lançamento(s), lote ${d.batchId}. Cada um confirmou estar na categoria de ` +
      "destino depois do UPDATE. A DRE abaixo já é a nova — ela se refez a partir do extrato."
  };
}

// ---------------------------------------------------------------------------
// O ajuste declarado — "adicionar algo", sem inventar dinheiro
// ---------------------------------------------------------------------------

function SecaoAjuste({
  dados,
  visao,
  mes,
  autorPadrao,
  aoMudar
}: {
  dados: DreResultado;
  visao: "caixa" | "competencia";
  mes: string | null;
  autorPadrao: string;
  aoMudar: () => Promise<void>;
}) {
  const [aberto, setAberto] = useState(false);
  const [linha, setLinha] = useState("");
  const [valor, setValor] = useState("");
  const [motivo, setMotivo] = useState("");
  const [autor, setAutor] = useState(autorPadrao);
  const [dry, setDry] = useState<Contrato<ResultadoAjuste> | null>(null);
  const [feito, setFeito] = useState<Contrato<ResultadoAjuste> | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [falha, setFalha] = useState<string | null>(null);

  const subtotal = dados.linhas.find((l) => l.linha === "ajustes_declarados");
  const comAjuste = dados.linhas.find((l) => l.linha === "lucro_liquido_com_ajuste");
  const centavos = centavosDeTexto(valor);
  const podeConferir = Boolean(linha && centavos !== null && centavos !== 0);
  const podeGravar = Boolean(dry && !dry.dado.recusa && motivo.trim().length >= 12 && autor.trim());

  async function conferir() {
    if (!mes || centavos === null) return;
    setOcupado(true);
    setFalha(null);
    setFeito(null);
    try {
      const p = new URLSearchParams({
        mes,
        linha,
        valorCents: String(centavos),
        motivo,
        autor
      });
      const r = await fetch(`/api/financeiro/gerencial/dre/ajuste?${p.toString()}`, { cache: "no-store" });
      const c = (await r.json()) as Contrato<ResultadoAjuste> & { erro?: string };
      if (c.erro) throw new Error(c.erro);
      setDry(c);
    } catch (e) {
      setFalha(e instanceof Error ? e.message : "falha ao conferir");
    } finally {
      setOcupado(false);
    }
  }

  async function gravar() {
    if (!mes || centavos === null) return;
    setOcupado(true);
    setFalha(null);
    try {
      const r = await fetch("/api/financeiro/gerencial/dre/ajuste", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mes, linha, amountCents: centavos, motivo, autor, aplicar: true })
      });
      const c = (await r.json()) as Contrato<ResultadoAjuste> & { erro?: string };
      if (c.erro) throw new Error(c.erro);
      setFeito(c);
      setDry(null);
      if (c.dado?.aplicado) {
        setValor("");
        setMotivo("");
        await aoMudar();
      }
    } catch (e) {
      setFalha(e instanceof Error ? e.message : "falha ao gravar");
    } finally {
      setOcupado(false);
    }
  }

  async function revogar(a: AjusteDeclarado) {
    const porQue = window.prompt(
      `Revogar o ajuste de ${brl(a.amountCents)} em ${a.linhaNome}.\n\nPor quê? (mínimo 12 caracteres — sumir sem explicação é pior que ficar errado à vista)`
    );
    if (porQue === null) return;
    setOcupado(true);
    setFalha(null);
    try {
      const r = await fetch("/api/financeiro/gerencial/dre/ajuste", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ acao: "revogar", id: a.id, motivo: porQue, autor, aplicar: true })
      });
      const c = (await r.json()) as Contrato<ResultadoAjuste> & { erro?: string };
      if (c.erro) throw new Error(c.erro);
      if (c.dado?.recusa) throw new Error(c.dado.recusa);
      await aoMudar();
    } catch (e) {
      setFalha(e instanceof Error ? e.message : "falha ao revogar");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="card res-ajuste cert-hachura">
      <h2 className="card-title">Ajustes declarados — o que NÃO veio do extrato</h2>

      <div className="res-ajuste-travas">
        <p>
          <strong>Ajuste não altera o caixa nem o saldo de nenhuma conta.</strong> Ele é uma afirmação humana, com autor
          e motivo, exibida aqui e nunca dentro de uma linha do extrato. Não existe “adicionar linha à DRE”: a DRE é
          derivada do extrato, e uma linha acrescentada sem lastro seria resultado inventado.
        </p>
        <ul>
          <li>
            <b>A DRE mensal não lê esta tabela.</b> <code>fin_dre_mensal_v</code> ignora <code>fin_dre_ajuste</code> —
            não por convenção, por construção.
          </li>
          <li>
            <b>Um CHECK proíbe visão caixa.</b> Na visão caixa o realizado é o extrato, sempre; um ajuste ali quebraria
            a soma que reconstrói o saldo.
          </li>
          <li>
            <b>Um gatilho recusa subtotal.</b> Subtotal já soma os itens: ajustar ali contaria duas vezes.
          </li>
        </ul>
        <p className="res-ajuste-medida">
          E a cada gravação a tela recebe a <b>medida</b>: o lucro do mês e a regra de ouro, lidos antes e depois do
          INSERT dentro da mesma transação. Se divergirem, a transação volta inteira.
        </p>
      </div>

      {visao === "caixa" ? (
        <Ressalva>
          Você está na visão <b>caixa</b>: aqui esta seção é <b>estruturalmente zero</b>, não vazia por falta de
          carregamento. Ajuste só existe em competência. Troque a visão no topo para declarar um.
        </Ressalva>
      ) : null}

      <table className="fin-table res-ajuste-total">
        <tbody>
          <tr>
            <td>{subtotal?.nome ?? "Ajustes declarados (subtotal)"}</td>
            <td className={classeValor(subtotal?.valorCents ?? 0)}>{brl(subtotal?.valorCents ?? 0)}</td>
          </tr>
          <tr>
            <td>
              <strong>{comAjuste?.nome ?? "Lucro líquido com ajustes declarados"}</strong>
              <em className="res-formula">lucro_liquido + ajustes_declarados</em>
            </td>
            <td className={classeValor(comAjuste?.valorCents ?? 0)}>
              <strong>{brl(comAjuste?.valorCents ?? 0)}</strong>
            </td>
          </tr>
        </tbody>
      </table>

      {dados.ajustes.length ? (
        <table className="fin-table">
          <thead>
            <tr>
              <th>Linha</th>
              <th className="num">Valor</th>
              <th>Quem e por quê</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {dados.ajustes.map((a) => (
              <tr key={a.id} className={a.vigente ? undefined : "res-ajuste-revogado"}>
                <td>{a.linhaNome}</td>
                <td className={classeValor(a.amountCents)}>{brl(a.amountCents)}</td>
                <td>
                  <b>{a.autor}</b> — {a.motivo}
                  {a.vigente ? null : (
                    <em>
                      {" "}
                      revogado por {a.revogadoPor}: {a.revogadoMotivo}
                    </em>
                  )}
                </td>
                <td>
                  {a.vigente ? (
                    <button type="button" className="res-btn-sec" onClick={() => revogar(a)} disabled={ocupado}>
                      revogar
                    </button>
                  ) : (
                    <SeloCamada camada="indeterminado" texto="revogado" />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="fin-card-hint">Nenhum ajuste declarado neste mês. O resultado acima é o extrato, inteiro.</p>
      )}

      {visao === "competencia" ? (
        <div className="res-ajuste-form">
          <button type="button" className="res-btn-sec" onClick={() => setAberto((v) => !v)}>
            {aberto ? "fechar" : "Declarar um ajuste"}
          </button>

          {aberto ? (
            <div className="res-ajuste-campos">
              <label>
                <span>Em qual linha</span>
                <select value={linha} onChange={(e) => setLinha(e.target.value)}>
                  <option value="">escolha…</option>
                  {dados.linhasAjustaveis.map((l) => (
                    <option key={l.linha} value={l.linha}>
                      {l.nome}
                    </option>
                  ))}
                </select>
                <em>só linha de item da seção resultado — o banco recusa as outras, e a tela não as oferece</em>
              </label>
              <label>
                <span>Valor (negativo para despesa)</span>
                <input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="-1.234,56" />
                <em>{centavos === null ? "informe um valor" : `${brl(centavos)} — é assim que vai ser gravado`}</em>
              </label>
              <label className="res-ajuste-motivo">
                <span>Por quê?</span>
                <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} />
                <em>{motivo.trim().length}/12 caracteres mínimos — “ajuste” é rótulo, não motivo</em>
              </label>
              <label>
                <span>Quem declara</span>
                <input value={autor} onChange={(e) => setAutor(e.target.value)} />
              </label>

              <div className="res-ajuste-acoes">
                <button type="button" className="res-btn" onClick={conferir} disabled={!podeConferir || ocupado}>
                  Conferir (nada é gravado)
                </button>
                <button type="button" className="res-btn res-btn-forte" onClick={gravar} disabled={!podeGravar || ocupado}>
                  Gravar o ajuste
                </button>
              </div>

              {dry ? (
                <p className={dry.dado.recusa ? "res-erro" : "res-ok"}>
                  {dry.dado.recusa ? `Seria recusado: ${dry.dado.recusa}` : dry.ressalvas[0]}
                </p>
              ) : null}
              {falha ? <p className="res-erro">{falha}</p> : null}
              {feito?.dado.prova ? (
                <div className="res-ok res-prova">
                  <strong>Gravado — e medido:</strong> lucro líquido do mês{" "}
                  {brl(feito.dado.prova.lucroLiquidoAntesCents)} antes e {brl(feito.dado.prova.lucroLiquidoDepoisCents)}{" "}
                  depois; resíduo da regra de ouro {brl(feito.dado.prova.residuoSaldoDepoisCents)} nos dois momentos.{" "}
                  {feito.dado.prova.caixaIntacto ? "O ajuste não alcançou o caixa." : "DIVERGIU — a transação voltou."}
                </div>
              ) : null}
              {feito?.dado.recusa ? <p className="res-erro">Recusado: {feito.dado.recusa}</p> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

function somaNivel1(nos: NoDrill[]): number {
  return nos.filter((n) => n.nivel === 1).reduce((s, n) => s + n.valorCents, 0);
}

/** O teto de profundidade que a expansão atual exige. Pedir 4 sempre custaria caro. */
function profundidadePedida(expandidos: string[]): number {
  let maior = 0;
  for (const chave of expandidos) maior = Math.max(maior, chave.split(SEP).length);
  return maior; // 0 expandido → nível 1 (índice 0); 1 chave de nível 1 → nível 2 (índice 1)
}

function classeValor(cents: number): string {
  return cents < 0 ? "num fin-table-money fin-out" : "num fin-table-money";
}

function rotuloMes(iso: string): string {
  if (!iso) return "—";
  const [ano, mes] = iso.split("-");
  const nomes = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${nomes[Number(mes) - 1] ?? mes}/${ano}`;
}

/**
 * "R$ -1.234,56", "-1234.56" e "-1234,56" viram o mesmo inteiro de centavos.
 *
 * Devolve null em vez de zero quando não dá para ler: zero é uma afirmação
 * sobre o dinheiro, e um campo em branco não é uma afirmação sobre nada.
 */
function centavosDeTexto(texto: string): number | null {
  const limpo = texto.replace(/[^\d,.-]/g, "").trim();
  if (!limpo) return null;
  const normal = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  const n = Number(normal);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

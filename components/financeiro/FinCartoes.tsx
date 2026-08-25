"use client";

import { useCallback, useMemo, useState } from "react";

import type { CartaoDetalhe, NoArvore } from "@/lib/financeiro/contratos/cartao-detalhe";

import { brl, Medida, Ressalva, SeloCamada } from "./Certeza";
import { FinCartaoHistorico, type PontoHistorico } from "./FinCartaoHistorico";

/**
 * O detalhamento de cartão.
 *
 * ---------------------------------------------------------------------------
 * A REGRA QUE ESTA TELA NÃO PODE QUEBRAR
 * ---------------------------------------------------------------------------
 * NUNCA EXISTE UM NÚMERO QUE SOME FATURA COM ITEM.
 *
 * A fatura é o que saiu do caixa; os itens são a composição dela. São o mesmo
 * dinheiro visto de dois lugares, e em meses diferentes — a fatura de março é
 * paga em março com compras de fevereiro. Medido no acervo: competência
 * R$ 84.058,09, caixa R$ 107.600,75, e a soma dos dois daria R$ 61.550,10 a
 * mais do que tudo que os emissores já cobraram.
 *
 * Por isso os dois vivem em cartões separados, com gráficos separados, e o
 * bloco de abertura traz a frase antes dos números — não depois. Um rodapé
 * explicando chega tarde: a pessoa já leu e já somou.
 *
 * ---------------------------------------------------------------------------
 * A SEGUNDA REGRA: A PARTE QUE NINGUÉM EXPLICA TEM LINHA PRÓPRIA
 * ---------------------------------------------------------------------------
 * 42% do valor das faturas não é explicado por item nenhum. Isso não é erro de
 * conta — é a fonte que não itemiza. A tentação é fechar por diferença: somar o
 * buraco ao último item, ou ratear entre os subcartões. Aqui ele é um nó irmão
 * dos subcartões, com hachura roxa e motivo, e soma no pai como qualquer outro
 * filho. Gasto sem dono não vira gasto com dono inventado.
 *
 * ---------------------------------------------------------------------------
 * DENSIDADE ONDE HÁ DADO, AR ONDE HÁ DECISÃO
 * ---------------------------------------------------------------------------
 * O pedido foi "máximo de detalhamento" e "menos é mais, não quero algo
 * carregado" — as duas coisas ao mesmo tempo. A resolução: a árvore é densa
 * (linhas de 30px, números tabulares, tudo alinhado), e nasce FECHADA. Quem
 * quer o detalhe desce; quem quer o panorama vê seis linhas. Uma cor de acento
 * — o roxo do indeterminado — e ela só aparece onde falta dado.
 */

type Props = {
  dado: CartaoDetalhe;
  ressalvas: string[];
};

const pct = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}%`);

const mesCurto = (mes: string | null) => {
  if (!mes) return "—";
  const [ano, m] = mes.slice(0, 7).split("-");
  return `${m}/${ano}`;
};

const dataCurta = (d: string | null) => (d ? d.slice(8, 10) + "/" + d.slice(5, 7) + "/" + d.slice(0, 4) : "—");

export function FinCartoes({ dado, ressalvas }: Props) {
  // Dois eixos de recorte, e eles não são o mesmo. A LINHA é a unidade da
  // fatura; o SUBCARTÃO é a unidade do gasto. Escolher um zera o outro porque
  // "final 7626 dentro do Inter" é uma pergunta sem resposta.
  const [linhaSlug, setLinhaSlug] = useState<string>("");
  const [cardId, setCardId] = useState<number | null>(null);

  // As três medidas de abertura. Nenhum `total` — de propósito: não existe um
  // número que junte competência e caixa, e oferecer um campo chamado "total"
  // seria convidar alguém a preenchê-lo.
  const competenciaCents = dado.competencia
    .filter((c) => c.faixa === "item")
    .reduce((s, c) => s + c.valorCents, 0);
  const naoItemizadoCents = dado.competencia
    .filter((c) => c.faixa === "nao_itemizado")
    .reduce((s, c) => s + c.valorCents, 0);
  const caixaCents = dado.caixa.reduce((s, k) => s + k.saiuCents, 0);

  const linhas = dado.arvore.filter((n) => n.nivel === "linha");
  const emissores = dado.arvore.filter((n) => n.nivel === "emissor");

  // Os subcartões que de fato gastaram, com quanto — a ordem é por valor, não
  // alfabética: quem olha quer achar o plástico que pesa, não o que vem antes
  // no alfabeto.
  const subcartoes = useMemo(() => {
    const m = new Map<number, { cardId: number; last4: string; titular: string | null; cents: number; linhaSlug: string }>();
    for (const c of dado.competencia) {
      if (c.faixa !== "item" || c.cardId === null) continue;
      if (linhaSlug && c.linhaSlug !== linhaSlug) continue;
      const atual = m.get(c.cardId) ?? {
        cardId: c.cardId,
        last4: c.last4 ?? "—",
        titular: c.titular,
        cents: 0,
        linhaSlug: c.linhaSlug
      };
      atual.cents += c.valorCents;
      m.set(c.cardId, atual);
    }
    return [...m.values()].sort((a, b) => b.cents - a.cents);
  }, [dado.competencia, linhaSlug]);

  const historico = useMemo(
    () => montarHistorico(dado, linhaSlug, cardId),
    [dado, linhaSlug, cardId]
  );

  const subEscolhido = cardId === null ? null : subcartoes.find((s) => s.cardId === cardId);
  const rotuloRecorte = subEscolhido
    ? `final ${subEscolhido.last4}`
    : linhaSlug
      ? linhas.find((l) => l.linhaSlug === linhaSlug)?.rotulo ?? linhaSlug
      : "todos os emissores";

  // O pagamento da fatura é da LINHA, não do plástico: o emissor cobra uma
  // fatura só e o débito sai uma vez. Ao descer para o subcartão o caixa deixa
  // de ter resposta, e barras zeradas ali afirmariam que aquele final nunca
  // custou nada.
  const caixaIndisponivel = subEscolhido
    ? `O caixa não desce ao subcartão. O emissor cobra UMA fatura por linha de crédito e o débito ` +
      `sai uma vez da conta corrente — não existe "quanto o final ${subEscolhido.last4} pagou". ` +
      `Ratear a fatura entre os finais pelo que cada um gastou seria inventar um pagamento que ` +
      `nunca aconteceu. O gasto dele está no painel acima, por competência.`
    : null;

  return (
    <>
      {/* =================================================================
          1. O CARTÃO DENTRO DA SAÍDA DE CAIXA
          ================================================================= */}
      <section className="fin-card">
        <div className="fin-card-head">
          <h2>O cartão dentro da saída de caixa</h2>
        </div>

        {/* A ressalva vem ANTES dos números. Depois já é tarde. */}
        <Ressalva>
          <strong>Estes dois números não se somam.</strong> A fatura é o que saiu do caixa; os itens
          são a composição dela. Somar daria {brl(competenciaCents + caixaCents)} — mais do que tudo
          que os emissores já cobraram desde 2025. E os dois lados nem caem no mesmo mês: a fatura de
          março é paga em março, com compras de fevereiro.
        </Ressalva>

        <div
          style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))", marginTop: 12 }}
        >
          <Medida
            rotulo="Competência — comprado no cartão"
            valorCents={competenciaCents}
            detalhe={`${dado.cobertura.itens} itens · não é caixa`}
          />
          <Medida
            rotulo="Caixa — pagamento de fatura"
            valorCents={caixaCents}
            detalhe={`${dado.saidas.length} pagamentos · saiu da conta corrente`}
          />
          <Medida
            rotulo="Não itemizado"
            valorCents={naoItemizadoCents}
            detalhe={`a fonte declara o total e não entrega as compras`}
            cobertura={
              competenciaCents + naoItemizadoCents > 0
                ? competenciaCents / (competenciaCents + naoItemizadoCents)
                : undefined
            }
            vies="o resto é fatura sem composição"
          />
          {dado.comprometidoFuturoCents ? (
            <Medida
              rotulo="Comprometido à frente"
              valorCents={dado.comprometidoFuturoCents}
              detalhe={`${dado.comprometidoFuturoLinhas} parcelas · competência, ainda não virou fatura`}
            />
          ) : null}
        </div>

        <div className="fin-table-wrap" style={{ marginTop: 16 }}>
          <table className="fin-table">
            <thead>
              <tr>
                <th>Saiu da conta</th>
                <th>Fatura</th>
                <th className="num">Saiu do caixa</th>
                <th className="num">Declarado</th>
                <th className="num">Itemizado</th>
                <th className="num">Não itemizado</th>
                <th>Classificação</th>
              </tr>
            </thead>
            <tbody>
              {dado.saidas.map((s) => (
                <tr key={s.transactionId}>
                  <td>
                    <strong>{dataCurta(s.postedOn)}</strong>
                    <span style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>
                      conta {s.conta} · lançamento {s.transactionId}
                    </span>
                  </td>
                  <td>
                    {s.emissor} · {mesCurto(s.mesReferencia)}
                    <span style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>
                      {s.origemFatura === "derivada_do_pagamento"
                        ? "fatura nunca vista — derivada do pagamento"
                        : `vence ${dataCurta(s.vencimento)}`}
                      {s.diferencaCents !== 0
                        ? ` · pago ${brl(s.diferencaCents)} a ${s.diferencaCents > 0 ? "menos" : "mais"} que o declarado`
                        : ""}
                    </span>
                  </td>
                  <td className="num fin-table-money">
                    <strong>{brl(s.saiuCents)}</strong>
                  </td>
                  <td className="num fin-table-money">{brl(s.faturaCents)}</td>
                  <td className="num fin-table-money">
                    {s.itemizadoCents ? brl(s.itemizadoCents) : "—"}
                    {s.pctExplicado !== null ? (
                      <span style={{ display: "block", fontSize: 11.5, color: "var(--muted)" }}>
                        {pct(s.pctExplicado)} explicado
                      </span>
                    ) : null}
                  </td>
                  <td className="num fin-table-money">
                    {s.naoItemizadoCents ? (
                      <span className="cert-hachura" style={{ padding: "2px 6px", borderRadius: 3 }} title={s.ressalva ?? undefined}>
                        {brl(s.naoItemizadoCents)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    {s.categoriaCode ? (
                      <span style={{ fontSize: 12.5 }}>
                        {s.categoriaCode} {s.categoria}
                      </span>
                    ) : (
                      <span title={s.categoriaMotivo ?? undefined}>
                        <SeloCamada camada="indeterminado" texto="sem categoria" />
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="fin-card-hint">
          A âncora desta tabela é <code>fin_card_bill.paid_transaction_id</code>, não a categoria
          9.01. Os {dado.saidas.filter((s) => !s.categoriaCode).length} pagamentos sem categoria
          somam {brl(dado.saidas.filter((s) => !s.categoriaCode).reduce((a, s) => a + s.saiuCents, 0))} e
          sumiriam de qualquer medida por rótulo.
        </p>
      </section>

      {/* =================================================================
          2. HISTÓRICO
          ================================================================= */}
      <section className="fin-card">
        <div className="fin-card-head">
          <h2>Histórico</h2>
          <div style={{ display: "grid", gap: 6, justifyItems: "end" }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button
                type="button"
                className={linhaSlug === "" && cardId === null ? "fin-chip ativo" : "fin-chip"}
                onClick={() => {
                  setLinhaSlug("");
                  setCardId(null);
                }}
              >
                tudo
              </button>
              {linhas.map((l) => (
                <button
                  key={l.chave}
                  type="button"
                  className={linhaSlug === l.linhaSlug && cardId === null ? "fin-chip ativo" : "fin-chip"}
                  onClick={() => {
                    setLinhaSlug(l.linhaSlug ?? "");
                    setCardId(null);
                  }}
                >
                  {l.rotulo}
                </button>
              ))}
            </div>
            {subcartoes.length ? (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <span style={{ fontSize: 11.5, color: "var(--muted)", alignSelf: "center" }}>subcartão</span>
                {subcartoes.map((s) => (
                  <button
                    key={s.cardId}
                    type="button"
                    className={cardId === s.cardId ? "fin-chip ativo" : "fin-chip"}
                    title={
                      s.titular
                        ? `titular ${s.titular}`
                        : "a fonte não diz de quem é este plástico — nenhum titular foi deduzido"
                    }
                    onClick={() => {
                      setCardId(cardId === s.cardId ? null : s.cardId);
                      setLinhaSlug(s.linhaSlug);
                    }}
                  >
                    {s.last4} · {brl(s.cents)}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        <FinCartaoHistorico
          pontos={historico}
          recorte={rotuloRecorte}
          caixaIndisponivel={caixaIndisponivel}
        />
      </section>

      {/* =================================================================
          3. O DRILL
          ================================================================= */}
      <section className="fin-card">
        <div className="fin-card-head">
          <h2>Emissor → linha → fatura → subcartão → item</h2>
          <p className="fin-card-hint">
            Cada nível soma o de cima. A fatura fica debaixo da linha, não do subcartão: uma fatura do
            Nubank mistura de 5 a 8 finais, e pendurá-la sob cada um multiplicaria o total.
          </p>
        </div>
        <Arvore no={emissores} todos={dado.arvore} />
      </section>

      {/* =================================================================
          4. PARCELAMENTOS
          ================================================================= */}
      <section className="fin-card">
        <div className="fin-card-head">
          <h2>Parcelamentos</h2>
          <p className="fin-card-hint">
            {dado.planos.filter((p) => p.atravessaReemissao).length} de {dado.planos.length} planos
            aparecem em mais de um final de cartão e continuam sendo UM plano. É o caso mais confuso
            para quem olha o extrato — e a troca de plástico não está declarada em lugar nenhum: ela é
            inferida pela continuidade da numeração das parcelas.
          </p>
        </div>
        <Planos planos={dado.planos} />
      </section>

      {/* =================================================================
          5. O QUE NENHUMA FONTE EXPLICA
          ================================================================= */}
      <section className="fin-card">
        <div className="fin-card-head">
          <h2>O que nenhuma fonte explica</h2>
          <p className="fin-card-hint">
            Lacuna não é defeito de código: é ausência na origem. Cada uma com escopo, valor e motivo.
            Nenhuma é fechada por estimativa.
          </p>
        </div>
        <div className="fin-table-wrap">
          <table className="fin-table">
            <thead>
              <tr>
                <th>Lacuna</th>
                <th>Escopo</th>
                <th className="num">Itens</th>
                <th className="num">Valor</th>
                <th>Por quê</th>
              </tr>
            </thead>
            <tbody>
              {dado.lacunas.map((l, i) => (
                <tr key={`${l.lacuna}-${l.escopo}-${i}`}>
                  <td>
                    <SeloCamada camada="indeterminado" texto={l.lacuna.replace(/_/g, " ")} />
                  </td>
                  <td style={{ fontSize: 12.5 }}>{l.escopo}</td>
                  <td className="num">{l.itens}</td>
                  <td className="num fin-table-money">{brl(l.valorCents)}</td>
                  <td style={{ fontSize: 12.5, color: "var(--muted)", maxWidth: "42ch" }}>{l.motivo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="fin-card-hint">
          {dado.cobertura.semCategoria} de {dado.cobertura.itens} itens seguem sem categoria (
          {brl(dado.cobertura.semCategoriaCents)}) e {dado.cobertura.semTitular} sem titular, em{" "}
          {dado.cobertura.subcartoesSemTitular} subcartões sem dono declarado. Nenhum dos dois é
          deduzido: a fonte não devolve <code>owner</code>, e categoria adivinhada entra na DRE como
          fato.
        </p>
      </section>

      {/*
        RECOLHIDA, NÃO APAGADA.
        Era uma seção aberta com a lista inteira de ressalvas, e o dono pediu
        "menos texto de ressalvas" olhando para esta tela. Apagá-las seria a
        leitura errada do pedido: elas dizem como ler os números e ainda valem.
        O que estava errado era o PESO — um bloco permanente do tamanho de um
        cartão de dado, acima do dado. Fechada, ela custa uma linha e continua
        a um clique de quem for auditar.
      */}
      {ressalvas.length ? (
        <details className="fin-card fin-cartao-ressalvas">
          <summary>Como ler estes números ({ressalvas.length})</summary>
          <ul>
            {ressalvas.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// A árvore
// ---------------------------------------------------------------------------

/**
 * A hierarquia, montada por ponteiro.
 *
 * `chave`/`paiKey` vêm de `fin_card_arvore_v` e são a ÚNICA definição de quem é
 * filho de quem. Este componente não agrupa, não soma e não ordena por conta
 * própria: se ele o fizesse, existiriam duas hierarquias — a do banco e a da
 * tela — e elas divergiriam na primeira fatura sem itens.
 *
 * O nível `item` não vem na carga inicial (são ~780 nós contra ~140 do resto).
 * Ele é buscado quando alguém abre um subcartão, pela mesma coluna `chave_pai`.
 */
function Arvore({ no, todos }: { no: NoArvore[]; todos: NoArvore[] }) {
  const porPai = useMemo(() => {
    const m = new Map<string, NoArvore[]>();
    for (const n of todos) {
      if (!n.paiKey) continue;
      const lista = m.get(n.paiKey) ?? [];
      lista.push(n);
      m.set(n.paiKey, lista);
    }
    return m;
  }, [todos]);

  return (
    <div role="tree" style={{ borderTop: "1px solid var(--line)" }}>
      {no.map((n) => (
        <NoDaArvore key={n.chave} no={n} porPai={porPai} nivel={0} />
      ))}
    </div>
  );
}

function NoDaArvore({
  no,
  porPai,
  nivel
}: {
  no: NoArvore;
  porPai: Map<string, NoArvore[]>;
  nivel: number;
}) {
  const [aberto, setAberto] = useState(false);
  const [itens, setItens] = useState<NoArvore[] | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const filhosLocais = porPai.get(no.chave) ?? [];
  // Subcartão é o único nível cujos filhos não vêm na carga inicial.
  const buscaFilhos = no.nivel === "subcartao";
  const temFilhos = filhosLocais.length > 0 || buscaFilhos;

  const abrir = useCallback(async () => {
    const proximo = !aberto;
    setAberto(proximo);
    if (!proximo || !buscaFilhos || itens !== null || carregando) return;
    setCarregando(true);
    try {
      const r = await fetch(
        `/api/financeiro/gerencial/cartao/detalhe?pai=${encodeURIComponent(no.chave)}`,
        { cache: "no-store" }
      );
      const corpo = await r.json();
      if (!r.ok || !corpo?.disponivel) {
        setErro(corpo?.ressalvas?.[0] ?? `o detalhe não pôde ser lido (HTTP ${r.status})`);
        setItens([]);
      } else {
        setItens(corpo.dado as NoArvore[]);
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      setItens([]);
    } finally {
      setCarregando(false);
    }
  }, [aberto, buscaFilhos, itens, carregando, no.chave]);

  const indeterminado = no.nivel === "nao_itemizado";

  return (
    <div role="treeitem" aria-expanded={temFilhos ? aberto : undefined}>
      <div
        className={indeterminado ? "cert-hachura" : undefined}
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) 92px 132px",
          alignItems: "baseline",
          gap: 10,
          padding: "6px 10px",
          paddingLeft: 10 + nivel * 18,
          borderBottom: "1px solid #eef3f5",
          fontSize: 13.5
        }}
      >
        <span style={{ minWidth: 0 }}>
          {temFilhos ? (
            <button
              type="button"
              onClick={abrir}
              aria-label={aberto ? `Fechar ${no.rotulo}` : `Abrir ${no.rotulo}`}
              style={{
                border: 0,
                background: "transparent",
                cursor: "pointer",
                color: "var(--muted)",
                padding: "0 7px 0 0",
                fontSize: 11
              }}
            >
              {aberto ? "▾" : "▸"}
            </button>
          ) : (
            <span style={{ display: "inline-block", width: 18 }} />
          )}
          <span style={{ fontWeight: nivel <= 1 ? 600 : 400 }}>{no.rotulo}</span>
          {no.detalhe ? (
            <span style={{ color: "var(--muted)", fontSize: 12, marginLeft: 8 }}>{no.detalhe}</span>
          ) : null}
          {no.motivo ? (
            <span
              title={no.motivo}
              style={{ marginLeft: 8, color: "var(--cert-indet)", fontSize: 11.5, cursor: "help" }}
            >
              ◆ por quê
            </span>
          ) : null}
        </span>
        <span style={{ textAlign: "right", color: "var(--muted)", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
          {no.itens !== null && no.nivel !== "item" ? `${no.itens} itens` : ""}
        </span>
        <span
          style={{
            textAlign: "right",
            fontVariantNumeric: "tabular-nums",
            fontWeight: nivel <= 1 ? 600 : 400,
            color: indeterminado ? "var(--cert-indet)" : undefined
          }}
        >
          {brl(no.valorCents)}
        </span>
      </div>

      {aberto ? (
        <>
          {filhosLocais.map((f) => (
            <NoDaArvore key={f.chave} no={f} porPai={porPai} nivel={nivel + 1} />
          ))}
          {carregando ? (
            <p style={{ margin: 0, padding: `6px 10px 6px ${28 + nivel * 18}px`, fontSize: 12.5, color: "var(--muted)" }}>
              lendo os itens…
            </p>
          ) : null}
          {erro ? (
            <p style={{ margin: 0, padding: `6px 10px 6px ${28 + nivel * 18}px`, fontSize: 12.5, color: "var(--cert-atrasado)" }}>
              {erro}
            </p>
          ) : null}
          {itens?.map((f) => <NoDaArvore key={f.chave} no={f} porPai={porPai} nivel={nivel + 1} />)}
          {itens !== null && itens.length === 0 && !erro ? (
            <p style={{ margin: 0, padding: `6px 10px 6px ${28 + nivel * 18}px`, fontSize: 12.5, color: "var(--muted)" }}>
              a fonte não entrega item nenhum deste ramo.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Parcelamentos
// ---------------------------------------------------------------------------

function Planos({ planos }: { planos: CartaoDetalhe["planos"] }) {
  const [aberto, setAberto] = useState<number | null>(null);
  // Ativos primeiro: um plano quitado é história, um aberto é compromisso.
  const ordenados = [...planos].sort((a, b) => {
    if ((a.status === "ativo") !== (b.status === "ativo")) return a.status === "ativo" ? -1 : 1;
    return (b.compraEm ?? "").localeCompare(a.compraEm ?? "");
  });

  return (
    <div className="fin-table-wrap">
      <table className="fin-table">
        <thead>
          <tr>
            <th>Compra</th>
            <th className="num">Parcelas</th>
            <th className="num">Parcela</th>
            <th className="num">Total</th>
            <th>Finais</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          {ordenados.map((p) => (
            <>
              <tr key={p.planoId}>
                <td>
                  <button
                    type="button"
                    onClick={() => setAberto(aberto === p.planoId ? null : p.planoId)}
                    style={{
                      border: 0,
                      background: "transparent",
                      padding: 0,
                      cursor: "pointer",
                      textAlign: "left",
                      color: "var(--ink)",
                      font: "inherit"
                    }}
                  >
                    {aberto === p.planoId ? "▾ " : "▸ "}
                    <strong>{p.rotulo}</strong>
                  </button>
                  <span style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>
                    {dataCurta(p.compraEm)} · {mesCurto(p.primeiroMes)} a {mesCurto(p.ultimoMes)}
                    {p.categoriaCode ? ` · ${p.categoriaCode} ${p.categoria}` : ""}
                  </span>
                </td>
                <td className="num">
                  {p.parcelasFaturadas}/{p.parcelasTotal}
                  {p.parcelasAbertas ? (
                    <span style={{ display: "block", fontSize: 11.5, color: "var(--muted)" }}>
                      {p.parcelasAbertas} a vencer
                    </span>
                  ) : null}
                </td>
                <td className="num fin-table-money">{p.valorParcelaCents === null ? "—" : brl(p.valorParcelaCents)}</td>
                <td className="num fin-table-money">
                  {p.totalCents === null ? "—" : brl(p.totalCents)}
                  {p.totalEstimado ? (
                    <span
                      style={{ display: "block", fontSize: 11.5, color: "var(--cert-indet)" }}
                      title="parcela × número de parcelas: a fonte não devolve o total contratado"
                    >
                      estimado
                    </span>
                  ) : null}
                </td>
                <td style={{ fontSize: 12.5 }}>
                  {p.atravessaReemissao ? (
                    <span title={p.reemissaoMotivo ?? undefined} className="cert-hachura" style={{ padding: "2px 6px", borderRadius: 3 }}>
                      {p.finais}
                    </span>
                  ) : (
                    p.finais ?? "—"
                  )}
                </td>
                <td>
                  <SeloCamada
                    camada={p.status === "ativo" ? "firme" : "observado"}
                    texto={p.status}
                  />
                </td>
              </tr>
              {aberto === p.planoId ? (
                <tr key={`${p.planoId}-parcelas`}>
                  <td colSpan={6} style={{ background: "var(--surface-2)" }}>
                    {p.atravessaReemissao ? (
                      <p style={{ margin: "0 0 8px", fontSize: 12.5, color: "var(--cert-indet)", maxWidth: "70ch" }}>
                        ◆ {p.reemissaoMotivo}
                      </p>
                    ) : null}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {p.parcelas
                        .slice()
                        .sort((a, b) => (a.numero ?? 0) - (b.numero ?? 0))
                        .map((pa) => (
                          <span
                            key={pa.itemId ?? `${pa.numero}`}
                            className={pa.futura ? "cert-hachura" : undefined}
                            style={{
                              border: "1px solid var(--line)",
                              borderRadius: 4,
                              padding: "4px 8px",
                              fontSize: 12,
                              fontVariantNumeric: "tabular-nums"
                            }}
                            title={
                              pa.futura
                                ? "ainda não faturada — competência, não caixa"
                                : `faturada em ${mesCurto(pa.competenciaMes)}`
                            }
                          >
                            <strong>
                              {pa.numero}/{p.parcelasTotal}
                            </strong>{" "}
                            {brl(pa.valorCents)}
                            <span style={{ color: "var(--muted)" }}> · final {pa.last4 ?? "—"}</span>
                          </span>
                        ))}
                    </div>
                  </td>
                </tr>
              ) : null}
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Série do histórico
// ---------------------------------------------------------------------------

/**
 * Monta a série mensal a partir de `prova`, que já traz competência e caixa em
 * COLUNAS SEPARADAS, calculadas pelo banco. A tela só agrupa por mês — ela nunca
 * soma uma coluna na outra, e não tem como: o tipo não oferece um campo que
 * junte as duas.
 *
 * O recorte casa por `linhaSlug`, que a árvore e a prova carregam com o mesmo
 * valor vindo de `fin_card_account.slug`. Casar por rótulo seria um segundo
 * critério de identidade, e o primeiro rótulo com acento diferente o quebraria.
 */
function montarHistorico(
  dado: CartaoDetalhe,
  linhaSlug: string,
  cardId: number | null
): PontoHistorico[] {
  const porMes = new Map<string, PontoHistorico>();

  // COM SUBCARTÃO a série vem de `competencia`, que é o único lugar com grão de
  // plástico. `prova` para na linha de crédito — e não é omissão dela: fatura e
  // pagamento não têm final de cartão, e inventar um seria ratear.
  if (cardId !== null) {
    for (const c of dado.competencia) {
      if (c.faixa !== "item" || c.cardId !== cardId) continue;
      const atual = porMes.get(c.mes) ?? {
        mes: c.mes,
        itemizadoCents: 0,
        naoItemizadoCents: 0,
        caixaCents: 0,
        itens: 0,
        pagamentos: 0
      };
      atual.itemizadoCents += c.valorCents;
      atual.itens += c.itens;
      porMes.set(c.mes, atual);
    }
    return [...porMes.values()].sort((a, b) => a.mes.localeCompare(b.mes));
  }

  for (const p of dado.prova) {
    if (linhaSlug && p.linhaSlug !== linhaSlug) continue;

    const atual = porMes.get(p.mes) ?? {
      mes: p.mes,
      itemizadoCents: 0,
      naoItemizadoCents: 0,
      caixaCents: 0,
      itens: 0,
      pagamentos: 0
    };
    atual.itemizadoCents += p.competenciaItensCents;
    atual.naoItemizadoCents += p.competenciaNaoItemizadoCents;
    atual.caixaCents += p.caixaSaiuCents ?? 0;
    atual.itens += p.itens;
    atual.pagamentos += p.caixaPagamentos ?? 0;
    porMes.set(p.mes, atual);
  }

  return [...porMes.values()].sort((a, b) => a.mes.localeCompare(b.mes));
}

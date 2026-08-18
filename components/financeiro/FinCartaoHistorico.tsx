"use client";

import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { brlCompact, brlPrecise } from "@/lib/financeiro/format";

/**
 * O histórico do cartão — DOIS painéis, nunca um.
 *
 * ---------------------------------------------------------------------------
 * POR QUE NÃO É UM GRÁFICO SÓ
 * ---------------------------------------------------------------------------
 * As duas medidas que este bloco mostra são o MESMO dinheiro visto de lugares
 * diferentes: a competência é a composição da fatura, o caixa é o débito que a
 * pagou. Num gráfico só — barras empilhadas, ou duas séries no mesmo eixo — o
 * olho soma. E a soma é falsa: no acervo ela dá R$ 191.658,84 contra
 * R$ 130.108,74 de tudo que os emissores já cobraram.
 *
 * Dois painéis empilhados, MESMA escala vertical, mesmo eixo de meses. Dá para
 * comparar altura com altura (que é a leitura legítima: "gastei mais do que
 * paguei neste mês?") sem que exista um total que junte os dois.
 *
 * Eixo duplo foi descartado pelo mesmo motivo — e porque é o erro nº 1 de
 * gráfico: duas escalas no mesmo desenho fazem qualquer par de séries parecer
 * relacionado.
 *
 * ---------------------------------------------------------------------------
 * AS CORES, E POR QUE SÃO ESTAS TRÊS
 * ---------------------------------------------------------------------------
 *   itemizado ....... #b67818  o que a fonte explica compra a compra
 *   não itemizado ... #6b4e8f  o vocabulário de indeterminado da casa, hachurado
 *   caixa ........... #c8553d  saída, a mesma cor de `--fin-out`
 *
 * As três passam os seis testes do validador de paleta em fundo claro (faixa de
 * luminosidade, piso de croma, separação para daltonismo — pior par ΔE 16,9 em
 * protanopia —, piso de visão normal ΔE 21,5 e contraste ≥ 3:1). A hachura no
 * indeterminado é encoding SECUNDÁRIO: quem não distingue as duas cores ainda
 * distingue liso de hachurado.
 *
 * Verde ficou de fora de propósito: nesta base verde é ENTRADA (`--fin-in`), e
 * cartão é saída inteira.
 */

const COR_ITEM = "#b67818";
const COR_NAO_ITEM = "#6b4e8f";
const COR_CAIXA = "#c8553d";
const TINTA_FRACA = "#64727a";
const GRADE = "#eef3f5";

export type PontoHistorico = {
  mes: string;
  itemizadoCents: number;
  naoItemizadoCents: number;
  caixaCents: number;
  itens: number;
  pagamentos: number;
};

type Props = {
  pontos: PontoHistorico[];
  /** O que está sendo olhado agora — vai no título, para o gráfico nunca ser anônimo. */
  recorte: string;
  /**
   * Por que o painel de caixa não existe neste recorte.
   *
   * O caso real: o pagamento da fatura é da LINHA de crédito, não do plástico.
   * Ao descer para um subcartão, o caixa deixa de ter resposta — e desenhar
   * barras zeradas ali afirmaria que aquele final nunca custou nada. Um painel
   * hachurado com o motivo é a única leitura honesta.
   */
  caixaIndisponivel?: string | null;
};

const rotuloMes = (mes: string) => {
  const [ano, m] = mes.slice(0, 7).split("-");
  return `${m}/${ano.slice(2)}`;
};

export function FinCartaoHistorico({ pontos, recorte, caixaIndisponivel }: Props) {
  const { dados, teto } = useMemo(() => {
    const d = pontos.map((p) => ({
      mes: rotuloMes(p.mes),
      itemizado: p.itemizadoCents / 100,
      naoItemizado: p.naoItemizadoCents / 100,
      caixa: p.caixaCents / 100,
      itens: p.itens,
      pagamentos: p.pagamentos,
      // O mês corrente e os seguintes ainda não fecharam: a barra deles é
      // parcial por construção. Sem isto todo dia 3 o gráfico mostra uma queda
      // que não aconteceu.
      futuro: p.mes.slice(0, 7) > new Date().toISOString().slice(0, 7)
    }));
    // A MESMA escala nos dois painéis. Calculada uma vez, aqui: se cada painel
    // achasse o próprio máximo, uma barra de R$ 4 mil ficaria do tamanho de uma
    // de R$ 18 mil e a comparação visual mentiria.
    const maximo = Math.max(
      0,
      ...d.map((p) => p.itemizado + p.naoItemizado),
      ...(caixaIndisponivel ? [0] : d.map((p) => p.caixa))
    );
    return { dados: d, teto: Math.ceil((maximo * 1.08) / 1000) * 1000 };
  }, [pontos, caixaIndisponivel]);

  if (!dados.length) {
    return <p className="fin-card-hint">Sem movimento de cartão em {recorte}.</p>;
  }

  const eixoY = (
    <YAxis
      tick={{ fontSize: 11, fill: TINTA_FRACA }}
      axisLine={false}
      tickLine={false}
      width={64}
      domain={[0, teto]}
      tickFormatter={(v: number) => brlCompact(v * 100)}
    />
  );

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
        <defs>
          {/* A mesma hachura de `.cert-hachura`, no ângulo do desenho técnico. */}
          <pattern id="cartao-hachura" width="6" height="6" patternTransform="rotate(135)" patternUnits="userSpaceOnUse">
            <rect width="6" height="6" fill={COR_NAO_ITEM} opacity="0.18" />
            <line x1="0" y1="0" x2="0" y2="6" stroke={COR_NAO_ITEM} strokeWidth="2.4" />
          </pattern>
        </defs>
      </svg>

      <figure style={{ margin: 0 }}>
        <figcaption style={{ marginBottom: 6 }}>
          <strong style={{ fontSize: 13.5 }}>Competência — o que foi comprado</strong>
          <span style={{ fontSize: 12.5, color: "var(--muted)" }}> · {recorte} · não é caixa</span>
        </figcaption>
        <Legenda />
        <ResponsiveContainer width="100%" height={190}>
          <BarChart data={dados} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} barCategoryGap="22%">
            <CartesianGrid stroke={GRADE} vertical={false} />
            <XAxis
              dataKey="mes"
              tick={{ fontSize: 11, fill: TINTA_FRACA }}
              axisLine={{ stroke: "#dce5e8" }}
              tickLine={false}
            />
            {eixoY}
            <Tooltip content={<Dica />} cursor={{ fill: "rgba(23,51,58,.05)" }} />
            {/* 2px de respiro entre os dois segmentos: o empilhado só é legível
                quando a fronteira entre as partes é visível. */}
            <Bar dataKey="itemizado" stackId="c" fill={COR_ITEM} radius={[0, 0, 0, 0]} />
            <Bar dataKey="naoItemizado" stackId="c" fill="url(#cartao-hachura)" radius={[4, 4, 0, 0]}>
              {dados.map((p, i) => (
                <Cell key={i} stroke={COR_NAO_ITEM} strokeWidth={p.naoItemizado > 0 ? 1 : 0} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </figure>

      <figure style={{ margin: 0 }}>
        <figcaption style={{ marginBottom: 6 }}>
          <strong style={{ fontSize: 13.5 }}>Caixa — o que saiu da conta corrente</strong>
          <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
            {caixaIndisponivel ? " · indeterminado neste recorte" : " · pagamento de fatura · mesma escala acima"}
          </span>
        </figcaption>
        {caixaIndisponivel ? (
          <div
            className="cert-hachura"
            style={{
              height: 150,
              borderRadius: 6,
              border: `1px solid ${COR_NAO_ITEM}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0 24px"
            }}
          >
            <p style={{ margin: 0, maxWidth: "56ch", fontSize: 13, color: "var(--cert-indet)", textAlign: "center" }}>
              {caixaIndisponivel}
            </p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={dados} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} barCategoryGap="22%">
              <CartesianGrid stroke={GRADE} vertical={false} />
              <XAxis
                dataKey="mes"
                tick={{ fontSize: 11, fill: TINTA_FRACA }}
                axisLine={{ stroke: "#dce5e8" }}
                tickLine={false}
              />
              {eixoY}
              <Tooltip content={<Dica />} cursor={{ fill: "rgba(23,51,58,.05)" }} />
              <Bar dataKey="caixa" fill={COR_CAIXA} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </figure>
    </div>
  );
}

/**
 * Duas séries, então a legenda existe sempre — identidade nunca fica só na cor.
 * O painel de caixa tem uma série só e o título já a nomeia: legenda ali seria
 * uma caixa com uma linha dentro.
 */
function Legenda() {
  return (
    <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <i style={{ width: 11, height: 11, background: COR_ITEM, borderRadius: 2, display: "inline-block" }} />
        itemizado
      </span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <i
          className="cert-hachura"
          style={{ width: 11, height: 11, borderRadius: 2, display: "inline-block", border: `1px solid ${COR_NAO_ITEM}` }}
        />
        não itemizado — a fonte não entrega as compras
      </span>
    </div>
  );
}

type DicaProps = {
  active?: boolean;
  label?: string;
  payload?: { dataKey?: string | number; value?: number; payload?: Record<string, number | boolean> }[];
};

function Dica({ active, label, payload }: DicaProps) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload ?? {};
  const item = Number(p.itemizado ?? 0);
  const naoItem = Number(p.naoItemizado ?? 0);
  const caixa = Number(p.caixa ?? 0);
  const ehCaixa = payload.some((s) => s.dataKey === "caixa");

  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--line)",
        borderRadius: 6,
        padding: "9px 11px",
        fontSize: 12.5,
        boxShadow: "0 4px 14px rgba(23,51,58,.09)"
      }}
    >
      <strong style={{ display: "block", marginBottom: 4 }}>{label}</strong>
      {ehCaixa ? (
        <>
          <Linha cor={COR_CAIXA} rotulo="saiu da conta" valor={caixa} />
          <p style={{ margin: "5px 0 0", color: "var(--muted)", maxWidth: 260, lineHeight: 1.4 }}>
            {Number(p.pagamentos ?? 0)} pagamento(s) de fatura. Não some com a competência.
          </p>
        </>
      ) : (
        <>
          <Linha cor={COR_ITEM} rotulo="itemizado" valor={item} />
          <Linha cor={COR_NAO_ITEM} rotulo="não itemizado" valor={naoItem} hachura />
          <p style={{ margin: "5px 0 0", color: "var(--muted)", maxWidth: 260, lineHeight: 1.4 }}>
            {Number(p.itens ?? 0)} item(ns) na competência.
            {naoItem > 0 ? " O não itemizado não é fechado por diferença." : ""}
          </p>
        </>
      )}
    </div>
  );
}

function Linha({ cor, rotulo, valor, hachura }: { cor: string; rotulo: string; valor: number; hachura?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, lineHeight: 1.7 }}>
      <i
        className={hachura ? "cert-hachura" : undefined}
        style={{
          width: 9,
          height: 9,
          borderRadius: 2,
          background: hachura ? undefined : cor,
          border: hachura ? `1px solid ${cor}` : undefined,
          display: "inline-block",
          flex: "none"
        }}
      />
      <span style={{ color: "var(--muted)" }}>{rotulo}</span>
      <strong style={{ marginLeft: "auto", fontVariantNumeric: "tabular-nums" }}>{brlPrecise(valor * 100)}</strong>
    </div>
  );
}

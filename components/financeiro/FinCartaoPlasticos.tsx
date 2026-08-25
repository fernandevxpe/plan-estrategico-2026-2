"use client";

import { useMemo, useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";

import type { MesDoCartao, PlasticoDoPainel, TransacaoDoPainel } from "@/lib/financeiro/contratos/cartao-painel";
import { brlCents, brlCompact, brlPrecise, dateLabel, monthKeyLabel, shortDateLabel } from "@/lib/financeiro/format";
import { urlDaOrigem } from "@/lib/url-origem";

import { corDoCartao, TINTA_DO_PLASTICO } from "./FinCartaoPainelTopo";

/**
 * Os plásticos, por emissor — e o cadastro deles na mesma tela.
 *
 * ---------------------------------------------------------------------------
 * O ESTADO INICIAL É "QUASE TUDO POR PREENCHER", E É PARA ELE QUE SE DESENHA
 * ---------------------------------------------------------------------------
 * Doze dos quinze cartões vieram do sync sem apelido, sem bandeira e sem cor;
 * QUINZE estão sem limite, porque a coluna acabou de nascer. Uma tela que só
 * fica bonita depois de preenchida seria bonita num dia que talvez não chegue —
 * e no dia de hoje pareceria quebrada, que é o motivo mais comum de ninguém
 * preencher.
 *
 * Então o vazio aqui tem forma própria, e a forma é UMA SÓ em toda a tela: a
 * hachura. Tarja sem cor, apelido ausente, limite não definido — os três
 * aparecem hachurados e clicáveis, e a hachura é o mesmo vocabulário que o
 * gráfico de fatura já usa para "a fonte não disse". Quem vê aprende uma vez e
 * reconhece nos três lugares.
 *
 * E ela é encoding SECUNDÁRIO em todos eles: a textura acompanha um texto, não
 * o substitui. "por preencher" na legenda, "dar um apelido" e "definir limite"
 * nos convites, e o que falta enumerado no `aria-label` do botão de editar —
 * inclusive a cor, que é a única pendência sem lugar próprio na face. Quem não
 * enxerga o risco a 45° lê a mesma coisa em palavras.
 *
 * ---------------------------------------------------------------------------
 * ZERO E "NÃO SEI" NÃO PODEM DIVIDIR O MESMO DESENHO
 * ---------------------------------------------------------------------------
 * É por isso que sem limite NÃO existe barra. Uma barra em 0% se lê como "este
 * cartão não gastou nada do limite dele" — uma afirmação sobre o mundo — quando
 * o que houve foi ninguém ter dito qual é o limite. O contrato já se recusa a
 * inventar o percentual (`usoDoLimitePct` volta null); a tela se recusa a
 * inventar o desenho. No lugar da barra vai o convite para definir.
 *
 * O mesmo vale para bandeira: sem bandeira não se desenha marca nenhuma. Um
 * genérico cinza no lugar diria "bandeira desconhecida" com a mesma tinta com
 * que diria "bandeira outra", que é uma escolha que alguém fez.
 *
 * ---------------------------------------------------------------------------
 * O FINAL NUNCA SOME ATRÁS DO APELIDO
 * ---------------------------------------------------------------------------
 * Reclamação explícita do dono numa tela irmã: o apelido substituía o número e
 * ninguém mais conseguia casar o cartão da mão com o cartão da tela. Aqui os
 * dois convivem sempre — apelido como título, `•••• 1234` logo abaixo, e onde
 * não há apelido o final SOBE para o lugar do título em vez de deixar um buraco.
 *
 * ---------------------------------------------------------------------------
 * CARTÃO INATIVO DESSATURA, NÃO SOME
 * ---------------------------------------------------------------------------
 * `historico` e `cancelado` continuam listados: o gasto que eles fizeram é real
 * e some do total se o plástico sumir da tela. Eles entram em cinza e acordam no
 * foco/hover — a diferença é de peso visual, não de existência.
 *
 * Verde não aparece em lugar nenhum aqui de propósito: nesta base verde é
 * ENTRADA, e cartão é saída inteira. A barra de uso vai de neutro a âmbar a
 * `--fin-out`, nunca "verde = saudável".
 *
 * ---------------------------------------------------------------------------
 * DUAS CORES POR CARTÃO, E ELAS RESPONDEM PERGUNTAS DIFERENTES
 * ---------------------------------------------------------------------------
 * A COR DO PLÁSTICO (`cartao.cor`, vocabulário da 0149) descreve o objeto que
 * a pessoa tem na mão. Ela pinta a tarja — e quando ninguém a escolheu, a
 * tarja fica hachurada, porque o convite a cadastrar é o assunto.
 *
 * A COR DE SÉRIE (`corDoCartao`, do painel de cima) é identidade de gráfico:
 * existe para TODO cartão, inclusive os doze sem cor, porque é ela que faz o
 * final 0343 ser a mesma tinta na faixa empilhada e aqui embaixo. Sem ela a
 * pessoa memoriza a cor no gráfico, desce para achar o cartão e não encontra —
 * a cor, que devia ligar as duas seções, desligava.
 *
 * As duas coexistem porque dizem coisas diferentes: o PONTO diz "este é o
 * cartão X do gráfico", a hachura da tarja diz "a cor dele ainda não foi
 * escolhida". Preencher a tarja com a cor da paleta faria o convite sumir e
 * ainda mentiria: ninguém escolheu aquele rosa, foi `cardId % 9` que escolheu.
 */

// ---------------------------------------------------------------------------
// Vocabulário aceito pela rota. Igual ao de `/api/financeiro/cartao/[id]`.
// ---------------------------------------------------------------------------
const BANDEIRAS = ["visa", "mastercard", "elo", "amex", "hipercard", "outra"] as const;
const TIPOS = ["fisico", "virtual", "adicional", "digital", "desconhecido"] as const;
const CORES = [
  "preto", "branco", "cinza", "prata", "dourado",
  "roxo", "azul", "verde", "vermelho", "laranja", "rosa", "transparente"
] as const;

type Bandeira = (typeof BANDEIRAS)[number];
type Tipo = (typeof TIPOS)[number];
type Cor = (typeof CORES)[number];

/*
 * A cor do plástico vem de `TINTA_DO_PLASTICO`, no painel de cima — não de um
 * mapa local. Havia um aqui, e ele JÁ tinha divergido em 9 das 12 cores:
 * diferenças de dois dígitos hex, invisíveis numa revisão e fatais para a
 * única coisa que a cor faz nesta tela, que é casar a faixa do gráfico com o
 * mini-cartão. Duas fontes para o mesmo vocabulário divergem sempre; a
 * pergunta é só quando alguém percebe.
 */

const TIPO_ROTULO: Record<string, string> = {
  fisico: "físico",
  virtual: "virtual",
  adicional: "adicional",
  digital: "digital",
  desconhecido: ""
};

const STATUS_ROTULO: Record<string, string> = {
  registrado: "",
  historico: "histórico",
  cancelado: "cancelado"
};

/**
 * O emissor deste plástico não conta o que ele comprou.
 *
 * Os três cartões do Banco Inter têm `compras = 0` e `anoCents = 0` e NÃO
 * estão parados: o Inter manda só o pagamento da fatura, e a linha dele gastou
 * R$ 40.862,41 em 2026. Desenhar "0 compras · R$ 0,00" neles afirma que não
 * foram usados — a mesma mentira que a barra de 0% contaria sobre um limite
 * que ninguém definiu.
 *
 * A checagem exige os três: um emissor que não itemiza mas que por algum
 * motivo tenha lançamento (Asaas parcial, importação manual) tem número de
 * verdade para mostrar, e escondê-lo atrás de "sem detalhamento" seria o erro
 * simétrico.
 */
function semExtratoDeItens(c: PlasticoDoPainel): boolean {
  return c.itemizacao !== "itens" && c.compras === 0 && c.totalCents === 0;
}

/** Por que a fonte não conta. O nome do emissor entra antes desta frase. */
const MOTIVO_SEM_EXTRATO: Record<string, string> = {
  somente_pagamento: "manda só o pagamento da fatura",
  somente_fatura: "manda o total da fatura, sem as compras"
};

function motivoSemExtrato(c: PlasticoDoPainel): string {
  const motivo = (c.itemizacao && MOTIVO_SEM_EXTRATO[c.itemizacao]) ?? "não entrega as compras";
  return `${c.emissor ?? "A fonte deste plástico"} ${motivo}.`;
}

/** Quantas compras cabem no "ultimamente" sem virar a tabela da outra seção. */
const MAX_COMPRAS = 8;

const FALTA_ROTULO: Record<string, string> = {
  categoria: "sem categoria",
  nucleo: "sem núcleo"
};

/** Identidade estável: um `[]` literal no default remontaria o índice a cada render. */
const SEM_TRANSACOES: TransacaoDoPainel[] = [];

const BANDEIRA_ROTULO: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  elo: "Elo",
  amex: "Amex",
  hipercard: "Hipercard",
  outra: "outra"
};

// ---------------------------------------------------------------------------
// As marcas, em SVG inline
// ---------------------------------------------------------------------------
// Nenhuma imagem externa: a plataforma abre atrás de Basic Auth e um <img> de
// CDN é uma requisição a mais que pode falhar sozinha, deixando um alt-text no
// lugar de um logo. São cinco desenhos de ~40 bytes cada em path.
function MarcaBandeira({ bandeira }: { bandeira: string | null }) {
  // Sem bandeira não se desenha NADA. O slot fica vazio e o cabeçalho se
  // fecha — é isso que faz o estado de hoje (12 de 15 sem marca) parecer
  // deliberado em vez de faltante.
  if (!bandeira) return null;

  const rotulo = BANDEIRA_ROTULO[bandeira] ?? bandeira;
  const comum = {
    className: "fin-cartao-plast-marca",
    viewBox: "0 0 48 30",
    role: "img" as const,
    "aria-label": rotulo
  };

  if (bandeira === "visa") {
    return (
      <svg {...comum}>
        <rect width="48" height="30" rx="4" fill="#ffffff" />
        <rect x="0.5" y="0.5" width="47" height="29" rx="3.5" fill="none" stroke="rgba(0,0,0,.16)" />
        <text
          x="24" y="21" textAnchor="middle" fill="#1a1f71"
          fontFamily="Helvetica, Arial, sans-serif" fontSize="14.5" fontWeight="700"
          fontStyle="italic" letterSpacing="0.4"
        >
          VISA
        </text>
      </svg>
    );
  }

  if (bandeira === "mastercard") {
    // Os dois círculos e a lente da interseção. Centros (19,15) e (29,15),
    // r=9 — a lente cruza o eixo em y = 15 ± √(81−25).
    return (
      <svg {...comum}>
        <rect width="48" height="30" rx="4" fill="#f4f4f7" />
        <circle cx="19" cy="15" r="9" fill="#eb001b" />
        <circle cx="29" cy="15" r="9" fill="#f79e1b" />
        <path d="M24 7.52 A9 9 0 0 1 24 22.48 A9 9 0 0 1 24 7.52 Z" fill="#ff5f00" />
      </svg>
    );
  }

  if (bandeira === "elo") {
    // Anel de três arcos de 120° + a palavra. Centro (14,15), r=6.
    return (
      <svg {...comum}>
        <rect width="48" height="30" rx="4" fill="#000000" />
        <path d="M14 9 A6 6 0 0 1 19.2 18" fill="none" stroke="#fff100" strokeWidth="3.2" strokeLinecap="round" />
        <path d="M19.2 18 A6 6 0 0 1 8.8 18" fill="none" stroke="#ef4123" strokeWidth="3.2" strokeLinecap="round" />
        <path d="M8.8 18 A6 6 0 0 1 14 9" fill="none" stroke="#00a4e0" strokeWidth="3.2" strokeLinecap="round" />
        <text
          x="34" y="20" textAnchor="middle" fill="#ffffff"
          fontFamily="Helvetica, Arial, sans-serif" fontSize="12" fontWeight="700"
        >
          elo
        </text>
      </svg>
    );
  }

  if (bandeira === "amex") {
    return (
      <svg {...comum}>
        <rect width="48" height="30" rx="4" fill="#006fcf" />
        <rect x="4" y="6" width="40" height="18" rx="2" fill="none" stroke="rgba(255,255,255,.55)" />
        <text
          x="24" y="20" textAnchor="middle" fill="#ffffff"
          fontFamily="Helvetica, Arial, sans-serif" fontSize="10.5" fontWeight="700" letterSpacing="0.8"
        >
          AMEX
        </text>
      </svg>
    );
  }

  if (bandeira === "hipercard") {
    return (
      <svg {...comum}>
        <rect width="48" height="30" rx="4" fill="#b3131b" />
        <text
          x="24" y="20" textAnchor="middle" fill="#ffffff"
          fontFamily="Helvetica, Arial, sans-serif" fontSize="11.5" fontWeight="700" fontStyle="italic"
        >
          Hiper
        </text>
      </svg>
    );
  }

  // "outra": uma escolha humana, não uma ausência. Ganha desenho neutro — mas
  // ganha desenho, ao contrário do null.
  return (
    <svg {...comum}>
      <rect width="48" height="30" rx="4" fill="var(--surface-2)" stroke="var(--line)" />
      <rect x="7" y="11" width="10" height="8" rx="1.6" fill="var(--muted)" opacity=".55" />
      <rect x="21" y="13" width="20" height="2.4" rx="1.2" fill="var(--muted)" opacity=".4" />
      <rect x="21" y="18" width="12" height="2.4" rx="1.2" fill="var(--muted)" opacity=".4" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Reais digitados → centavos inteiros
// ---------------------------------------------------------------------------
// A pessoa digita "2.000,00", "2000", "R$ 2.000" ou "2000.00" — o teclado do
// celular não oferece a mesma vírgula do desktop. A ambiguidade real é o ponto
// sozinho: em pt-BR "2.000" são dois mil, mas "20.50" é vinte e cinquenta. A
// regra: o último separador manda, e ponto com exatamente três dígitos depois é
// milhar.
type Centavos = number | null | "invalido";

function centavosDeReais(texto: string): Centavos {
  const limpo = texto.replace(/[^\d.,-]/g, "").trim();
  if (!limpo) return null;

  let normal: string;
  if (limpo.includes(",")) {
    normal = limpo.replace(/\./g, "").replace(",", ".");
  } else if (limpo.includes(".")) {
    const partes = limpo.split(".");
    const ultima = partes[partes.length - 1] ?? "";
    normal = partes.length > 2 || ultima.length === 3 ? limpo.replace(/\./g, "") : limpo;
  } else {
    normal = limpo;
  }

  const valor = Number(normal);
  if (!Number.isFinite(valor) || valor <= 0) return "invalido";
  return Math.round(valor * 100);
}

function reaisDeCentavos(cents: number | null): string {
  if (cents === null) return "";
  return (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---------------------------------------------------------------------------
// O que a rota devolve: a linha crua de `fin_card`, em snake_case
// ---------------------------------------------------------------------------
type LinhaCartao = {
  id?: unknown;
  last4?: unknown;
  label?: unknown;
  brand?: unknown;
  cor?: unknown;
  kind?: unknown;
  limite_cents?: unknown;
  limite_definido_por?: unknown;
};

const texto = (v: unknown): string | null => (typeof v === "string" && v.length ? v : null);

/**
 * O estado local vem do SERVIDOR, não do formulário.
 *
 * Espelhar o que se enviou faria a tela mostrar um apelido de 61 caracteres que
 * o banco recusou, ou um limite que outra aba mudou meio segundo antes. O que
 * volta do `RETURNING` é o que está gravado.
 */
function comRespostaDoServidor(base: PlasticoDoPainel, linha: LinhaCartao): PlasticoDoPainel {
  const limiteCents =
    linha.limite_cents === null || linha.limite_cents === undefined ? null : Number(linha.limite_cents);
  return {
    ...base,
    apelido: texto(linha.label),
    bandeira: texto(linha.brand),
    cor: texto(linha.cor),
    tipo: texto(linha.kind) ?? base.tipo,
    limiteCents,
    limiteDefinidoPor: texto(linha.limite_definido_por),
    // Mesma conta do contrato — sem limite não existe percentual.
    usoDoLimitePct:
      limiteCents === null || limiteCents === 0
        ? null
        : Math.round((base.mesCorrenteCents / limiteCents) * 1000) / 10
  };
}

// ===========================================================================
// A seção
// ===========================================================================
export function FinCartaoPlasticos({
  plasticos,
  serie,
  transacoes = SEM_TRANSACOES
}: {
  plasticos: PlasticoDoPainel[];
  serie: MesDoCartao[];
  transacoes?: TransacaoDoPainel[];
}) {
  // Sobrescritas locais do que já foi salvo nesta sessão. O `router.refresh()`
  // traz a mesma verdade pelas props logo depois, então a mescla é idempotente
  // — mas até ela chegar a tela já mostra o que o servidor confirmou.
  const [salvos, setSalvos] = useState<Record<number, PlasticoDoPainel>>({});
  const [aberto, setAberto] = useState<number | null>(null);
  const [editando, setEditando] = useState<number | null>(null);

  const lista = useMemo(
    () => plasticos.map((p) => salvos[p.cardId] ?? p),
    [plasticos, salvos]
  );

  const porCartao = useMemo(() => {
    const mapa = new Map<number, MesDoCartao[]>();
    for (const mes of serie) {
      if (mes.cardId === null) continue;
      const atual = mapa.get(mes.cardId);
      if (atual) atual.push(mes);
      else mapa.set(mes.cardId, [mes]);
    }
    for (const meses of mapa.values()) meses.sort((a, b) => a.mes.localeCompare(b.mes));
    return mapa;
  }, [serie]);

  // As compras de cada plástico, da mais recente para a mais antiga.
  //
  // Só `kind = "compra"`: um IOF de R$ 0,42 no meio de "o que passou
  // recentemente" é ruído, e estorno é o desfazimento de uma compra que já
  // está na lista — as duas linhas juntas se leem como duas compras.
  const comprasPorCartao = useMemo(() => {
    const mapa = new Map<number, TransacaoDoPainel[]>();
    for (const t of transacoes) {
      if (t.cardId === null || t.kind !== "compra") continue;
      const atual = mapa.get(t.cardId);
      if (atual) atual.push(t);
      else mapa.set(t.cardId, [t]);
    }
    for (const linhas of mapa.values()) {
      // Desempate pelo id: várias compras no mesmo dia têm a mesma data, e
      // sem critério estável a ordem muda a cada render.
      linhas.sort((a, b) =>
        a.postedOn === b.postedOn ? b.id - a.id : b.postedOn.localeCompare(a.postedOn)
      );
    }
    return mapa;
  }, [transacoes]);

  const grupos = useMemo(() => {
    const mapa = new Map<string, PlasticoDoPainel[]>();
    for (const p of lista) {
      const chave = p.emissor ?? "Sem emissor";
      const atual = mapa.get(chave);
      if (atual) atual.push(p);
      else mapa.set(chave, [p]);
    }
    return [...mapa.entries()]
      .map(([emissor, cartoes]) => ({
        emissor,
        cartoes: [...cartoes].sort((a, b) => b.totalCents - a.totalCents),
        totalCents: cartoes.reduce((s, c) => s + c.totalCents, 0),
        mesCents: cartoes.reduce((s, c) => s + c.mesCorrenteCents, 0),
        // O grupo inteiro do Inter cai aqui: sem isto o cabeçalho dele mostra
        // "3 plásticos" e mais nada, e o vazio parece desleixo em vez de fonte.
        semExtrato: cartoes.every(semExtratoDeItens)
      }))
      .sort((a, b) => b.totalCents - a.totalCents);
  }, [lista]);

  const semApelido = lista.filter((p) => !p.apelido).length;
  const semBandeira = lista.filter((p) => !p.bandeira).length;
  const semLimite = lista.filter((p) => p.limiteCents === null).length;
  const porPreencher = semApelido + semBandeira + semLimite;

  function aoSalvar(cartao: PlasticoDoPainel) {
    setSalvos((atual) => ({ ...atual, [cartao.cardId]: cartao }));
    setEditando(null);
  }

  if (!lista.length) {
    return (
      <section className="fin-card fin-cartao-plast-secao">
        <div className="fin-card-head">
          <h2>Plásticos</h2>
        </div>
        <p className="fin-cartao-plast-vazio">
          Nenhum cartão cadastrado. Os plásticos nascem do sync do emissor — e ganham nome, cor e
          limite aqui.
        </p>
      </section>
    );
  }

  return (
    <section className="fin-card fin-cartao-plast-secao">
      <div className="fin-card-head">
        <h2>Plásticos</h2>
        <span className="fin-cartao-plast-resumo">
          {lista.length} {lista.length === 1 ? "cartão" : "cartões"} · {grupos.length}{" "}
          {grupos.length === 1 ? "emissor" : "emissores"}
        </span>
      </div>

      {/* A legenda existe para ensinar a hachura UMA vez. Depois dela, o desenho
          fala sozinho nos três lugares onde aparece. */}
      {porPreencher ? (
        <p className="fin-cartao-plast-legenda">
          <span className="fin-cartao-plast-hachura" aria-hidden />
          por preencher
          <span className="fin-cartao-plast-legenda-conta">
            {[
              semApelido ? `${semApelido} sem apelido` : null,
              semBandeira ? `${semBandeira} sem bandeira` : null,
              semLimite ? `${semLimite} sem limite` : null
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </p>
      ) : null}

      <div className="fin-cartao-plast-grupos">
        {grupos.map((grupo) => (
          <div key={grupo.emissor} className="fin-cartao-plast-grupo">
            <div className="fin-cartao-plast-grupo-cabeca">
              <h3 className="fin-cartao-plast-grupo-nome">{grupo.emissor}</h3>
              <span className="fin-cartao-plast-grupo-meta">
                {grupo.cartoes.length} {grupo.cartoes.length === 1 ? "plástico" : "plásticos"}
                {grupo.mesCents ? ` · ${brlCents(grupo.mesCents)} no mês` : ""}
                {grupo.semExtrato ? (
                  <span className="fin-cartao-plast-grupo-opaco">
                    <span className="fin-cartao-plast-opaco-tex" aria-hidden />
                    sem detalhamento
                  </span>
                ) : null}
              </span>
            </div>

            <div className="fin-cartao-plast-grade">
              {grupo.cartoes.map((cartao) => (
                <CartaoPlastico
                  key={cartao.cardId}
                  cartao={cartao}
                  meses={porCartao.get(cartao.cardId) ?? []}
                  compras={comprasPorCartao.get(cartao.cardId) ?? SEM_TRANSACOES}
                  aberto={aberto === cartao.cardId}
                  editando={editando === cartao.cardId}
                  aoAlternar={() => setAberto((a) => (a === cartao.cardId ? null : cartao.cardId))}
                  aoEditar={(ligado) => setEditando(ligado ? cartao.cardId : null)}
                  aoSalvar={aoSalvar}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ===========================================================================
// Um plástico
// ===========================================================================
function CartaoPlastico({
  cartao,
  meses,
  compras,
  aberto,
  editando,
  aoAlternar,
  aoEditar,
  aoSalvar
}: {
  cartao: PlasticoDoPainel;
  meses: MesDoCartao[];
  compras: TransacaoDoPainel[];
  aberto: boolean;
  editando: boolean;
  aoAlternar: () => void;
  aoEditar: (ligado: boolean) => void;
  aoSalvar: (cartao: PlasticoDoPainel) => void;
}) {
  const idDetalhe = `fin-cartao-plast-detalhe-${cartao.cardId}`;
  const inativo = cartao.status === "historico" || cartao.status === "cancelado";
  // A cor de verdade, escolhida por gente. Null pinta hachura, não cinza.
  const hex = cartao.cor ? TINTA_DO_PLASTICO[cartao.cor] : null;
  // A identidade no gráfico. Sempre existe: com `cor`, é a tinta do plástico;
  // sem ela, o slot determinístico de `cardId % 9`.
  const corSerie = corDoCartao(cartao.cardId, cartao.cor);
  const tipoRotulo = TIPO_ROTULO[cartao.tipo] ?? "";
  const statusRotulo = STATUS_ROTULO[cartao.status] ?? cartao.status;

  const estilo = {
    "--fin-cartao-plast-serie": corSerie,
    ...(hex ? { "--fin-cartao-plast-cor": hex } : {})
  } as CSSProperties;

  // `futuroTotalCents` CONTÉM a próxima fatura — as parcelas seguem até
  // abr/2027. Pôr o total ao lado dela com um "e mais" somaria o mesmo
  // dinheiro duas vezes, que é o erro que este módulo inteiro existe para
  // impedir. O que se mostra é o RESTO: o já lançado para DEPOIS da próxima.
  const adiante = cartao.futuroTotalCents - cartao.proximaFaturaCents;

  // A hachura é encoding SECUNDÁRIO. Quem não enxerga a textura precisa do
  // texto, e nem toda pista tem onde caber na face — a tarja sem cor é
  // decoração pura, sem rótulo possível. A lista abaixo vira o `aria-label`
  // do botão que resolve todas elas, que é onde a informação é acionável.
  const faltando = [
    cartao.apelido ? null : "sem apelido",
    cartao.bandeira ? null : "sem bandeira",
    cartao.cor ? null : "sem cor",
    cartao.limiteCents === null ? "sem limite" : null
  ].filter((f): f is string => f !== null);

  const semExtrato = semExtratoDeItens(cartao);

  const uso = cartao.usoDoLimitePct;
  const faixa = uso === null ? null : uso >= 100 ? "estouro" : uso >= 80 ? "atencao" : "normal";

  return (
    <article
      className="fin-cartao-plast-card"
      style={estilo}
      data-inativo={inativo ? "sim" : "nao"}
      data-sem-cor={hex ? "nao" : "sim"}
      data-aberto={aberto ? "sim" : "nao"}
    >
      <span className="fin-cartao-plast-tarja" aria-hidden />

      <div className="fin-cartao-plast-topo">
        {/*
          O botão cobre a face inteira em vez de embrulhá-la: envolver o
          conteúdo faria os botões de "definir limite" e "editar" virarem
          botões DENTRO de um botão — HTML inválido, e no teclado o Enter
          dispara os dois. Aqui o conteúdo fica por cima com
          `pointer-events: none`, e só o que é interativo volta a receber
          clique.
        */}
        <button
          type="button"
          className="fin-cartao-plast-face"
          onClick={aoAlternar}
          aria-expanded={aberto}
          aria-controls={idDetalhe}
          aria-label={`${cartao.apelido ? `${cartao.apelido}, ` : ""}final ${cartao.last4} — ver os meses`}
        />

        <div className="fin-cartao-plast-conteudo">
          <div className="fin-cartao-plast-ident">
            <div className="fin-cartao-plast-nome">
              {/* O mesmo chip da legenda do gráfico, no mesmo tamanho: é por ele
                  que se casa uma faixa lá em cima com o plástico aqui embaixo,
                  sem contar posição. Decorativo para o leitor de tela — o
                  `•••• 1234` ao lado é a identidade de verdade. */}
              <span className="fin-cartao-plast-ponto" aria-hidden />
              {cartao.apelido ? (
                <>
                  <strong className="fin-cartao-plast-apelido">{cartao.apelido}</strong>
                  {/* O final NUNCA some atrás do apelido. */}
                  <span className="fin-cartao-plast-final">•••• {cartao.last4}</span>
                </>
              ) : (
                <>
                  {/* Sem apelido o final assume o posto de título — nada de
                      espaço reservado a um nome que não existe. */}
                  <strong className="fin-cartao-plast-final fin-cartao-plast-final-titulo">
                    •••• {cartao.last4}
                  </strong>
                  <button
                    type="button"
                    className="fin-cartao-plast-convite fin-cartao-plast-convite-inline"
                    onClick={() => aoEditar(true)}
                  >
                    <span className="fin-cartao-plast-hachura" aria-hidden />
                    dar um apelido
                  </button>
                </>
              )}
            </div>

            <div className="fin-cartao-plast-selos">
              {tipoRotulo ? <span className="fin-cartao-plast-selo">{tipoRotulo}</span> : null}
              {inativo ? (
                <span className="fin-cartao-plast-selo fin-cartao-plast-selo-inativo">{statusRotulo}</span>
              ) : null}
            </div>
          </div>

          <div className="fin-cartao-plast-marca-slot">
            <MarcaBandeira bandeira={cartao.bandeira} />
          </div>

          {/* O plástico que a fonte não detalha não mostra NENHUM número
              derivado de item: um "R$ 0,00" aqui afirmaria que ele não foi
              usado, e o Inter gastou R$ 40.862,41 este ano. O pontilhado
              grafite é o desenho de "a fonte nunca vai contar" — o mesmo do
              opaco da seção de análise, e deliberadamente diferente da
              hachura, que é "ninguém preencheu AINDA". Confundir os dois
              manda alguém abrir uma fila para resolver o irresolvível. */}
          {semExtrato ? (
            <div className="fin-cartao-plast-opaco">
              <span className="fin-cartao-plast-opaco-tex" aria-hidden />
              <div className="fin-cartao-plast-opaco-dizer">
                <strong>sem detalhamento</strong>
                <span>
                  {motivoSemExtrato(cartao)} O gasto dele está no não itemizado, em Análise.
                </span>
              </div>
            </div>
          ) : (
            <>
            <div className="fin-cartao-plast-primario">
              <span className="fin-cartao-plast-primario-rotulo">próxima fatura</span>
              <b className="fin-cartao-plast-primario-valor">{brlCents(cartao.proximaFaturaCents)}</b>
              {/* Só quando sobra algo depois dela. Igual à próxima fatura, esta
                  linha seria o mesmo número dito duas vezes. */}
              {adiante > 0 ? (
                <span className="fin-cartao-plast-adiante">+ {brlCents(adiante)} depois dela</span>
              ) : null}
            </div>

            <div className="fin-cartao-plast-stats">
              <div className="fin-cartao-plast-stat">
                <span className="fin-cartao-plast-stat-rotulo">no mês</span>
                <span className="fin-cartao-plast-stat-valor">{brlCents(cartao.mesCorrenteCents)}</span>
              </div>
              <div className="fin-cartao-plast-stat">
                <span className="fin-cartao-plast-stat-rotulo">no ano</span>
                <span className="fin-cartao-plast-stat-valor">{brlCents(cartao.anoCents)}</span>
              </div>
              <div className="fin-cartao-plast-stat">
                <span className="fin-cartao-plast-stat-rotulo">compras</span>
                <span className="fin-cartao-plast-stat-valor">{cartao.compras.toLocaleString("pt-BR")}</span>
              </div>
            </div>

            <p className="fin-cartao-plast-ultima">
              {cartao.ultimaCompraEm ? `última em ${dateLabel(cartao.ultimaCompraEm)}` : "nenhuma compra ainda"}
            </p>
            </>
          )}

          {/* Limite: barra quando alguém definiu, convite quando ninguém definiu.
              Nunca uma barra em zero — ver o cabeçalho deste arquivo. */}
          {cartao.limiteCents !== null && semExtrato ? (
            <div className="fin-cartao-plast-limite" data-faixa="opaco">
              <div className="fin-cartao-plast-limite-cabeca">
                <span>limite {brlCents(cartao.limiteCents)}</span>
                <b className="fin-cartao-plast-opaco-marca">sem apurar</b>
              </div>
              {/* O trilho existe — o limite foi definido — e o quanto dele foi
                  usado é desconhecido, não zero. Pontilhado no trilho inteiro:
                  uma barra em 0% diria que este cartão não gastou nada. */}
              <div
                className="fin-cartao-plast-limite-trilho fin-cartao-plast-opaco-tex"
                role="img"
                aria-label={`uso do limite de ${brlPrecise(
                  cartao.limiteCents
                )} não apurável: o emissor não manda as compras deste plástico`}
              />
            </div>
          ) : cartao.limiteCents !== null && uso !== null ? (
            <div className="fin-cartao-plast-limite" data-faixa={faixa}>
              <div className="fin-cartao-plast-limite-cabeca">
                <span>limite {brlCents(cartao.limiteCents)}</span>
                <b>{uso.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</b>
              </div>
              <div
                className="fin-cartao-plast-limite-trilho"
                role="img"
                aria-label={`${uso.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% do limite de ${brlPrecise(cartao.limiteCents)} usado no mês`}
              >
                <span
                  className="fin-cartao-plast-limite-uso"
                  style={{ width: `${Math.min(100, Math.max(0, uso))}%` }}
                />
              </div>
            </div>
          ) : (
            <button type="button" className="fin-cartao-plast-convite" onClick={() => aoEditar(true)}>
              <span className="fin-cartao-plast-hachura" aria-hidden />
              definir limite deste plástico
            </button>
          )}
        </div>
      </div>

      <div className="fin-cartao-plast-acoes">
        <button
          type="button"
          className="fin-cartao-plast-botao"
          onClick={() => aoEditar(!editando)}
          aria-expanded={editando}
          aria-label={`editar cartão final ${cartao.last4}${faltando.length ? ` — ${faltando.join(", ")}` : ""}`}
        >
          {editando ? "fechar" : "editar"}
        </button>
        <button
          type="button"
          className="fin-cartao-plast-botao"
          onClick={aoAlternar}
          aria-expanded={aberto}
          aria-controls={idDetalhe}
        >
          {aberto ? "esconder" : semExtrato ? "por que sem extrato" : `meses (${meses.length})`}
        </button>
      </div>

      {editando ? (
        <EditorCartao cartao={cartao} aoSalvar={aoSalvar} aoFechar={() => aoEditar(false)} />
      ) : null}

      <div id={idDetalhe} hidden={!aberto}>
        {aberto ? <DetalheMeses cartao={cartao} meses={meses} compras={compras} /> : null}
      </div>
    </article>
  );
}

// ===========================================================================
// O histórico mensal do plástico, e o que passou nele ultimamente
// ===========================================================================
function DetalheMeses({
  cartao,
  meses,
  compras
}: {
  cartao: PlasticoDoPainel;
  meses: MesDoCartao[];
  compras: TransacaoDoPainel[];
}) {
  const recentes = compras.slice(0, MAX_COMPRAS);

  // ANTES do vazio comum: um plástico sem extrato também chega aqui sem meses
  // e sem compras, e cairia no "nunca passou" — que é exatamente a mentira.
  if (semExtratoDeItens(cartao)) {
    return (
      <div className="fin-cartao-plast-detalhe">
        <div className="fin-cartao-plast-opaco">
          <span className="fin-cartao-plast-opaco-tex" aria-hidden />
          <div className="fin-cartao-plast-opaco-dizer">
            <strong>sem detalhamento</strong>
            <span>
              {motivoSemExtrato(cartao)} Não há compra a listar: o gasto deste plástico entra
              no não itemizado, na seção de análise.
            </span>
          </div>
        </div>
      </div>
    );
  }

  if (!meses.length && !recentes.length) {
    return (
      <div className="fin-cartao-plast-detalhe">
        <p className="fin-cartao-plast-vazio">
          Este plástico não tem compra lançada em 2026. Ele existe no cadastro do emissor e nunca passou.
        </p>
      </div>
    );
  }

  const teto = Math.max(
    1,
    ...meses.map((m) => Math.max(0, m.realizadoCents) + Math.max(0, m.previstoCents))
  );
  const realizado = meses.reduce((s, m) => s + m.realizadoCents, 0);
  const previsto = meses.reduce((s, m) => s + m.previstoCents, 0);
  const itens = meses.reduce((s, m) => s + m.itens, 0);

  return (
    <div className="fin-cartao-plast-detalhe">
      {/* A série do contrato começa em jan/2026; a lista de compras não tem
          esse corte. Um plástico que só passou antes disso chega aqui sem
          meses e COM compras — e um gráfico vazio diria que ele nunca passou. */}
      {meses.length ? (
        <>
          <div className="fin-cartao-plast-detalhe-cabeca">
            <span className="fin-cartao-plast-chave">
              <span className="fin-cartao-plast-amostra fin-cartao-plast-amostra-real" aria-hidden />
              realizado {brlPrecise(realizado)}
            </span>
            <span className="fin-cartao-plast-chave">
              <span className="fin-cartao-plast-amostra fin-cartao-plast-amostra-prev" aria-hidden />
              previsto {brlPrecise(previsto)}
            </span>
            <span className="fin-cartao-plast-detalhe-itens">
              <span className="fin-cartao-plast-ponto" aria-hidden />
              {itens} {itens === 1 ? "lançamento" : "lançamentos"} · final {cartao.last4}
            </span>
          </div>

          <div className="fin-cartao-plast-grafico">
            {meses.map((mes) => {
              const alturaReal = (Math.max(0, mes.realizadoCents) / teto) * 100;
              const alturaPrev = (Math.max(0, mes.previstoCents) / teto) * 100;
              const total = mes.realizadoCents + mes.previstoCents;
              return (
                <div
                  key={mes.mes}
                  className="fin-cartao-plast-coluna"
                  data-futuro={mes.previstoCents && !mes.realizadoCents ? "sim" : "nao"}
                >
                  <span className="fin-cartao-plast-coluna-valor">{brlCompact(total)}</span>
                  <div
                    className="fin-cartao-plast-pilha"
                    title={`${monthKeyLabel(mes.mes)} — realizado ${brlPrecise(mes.realizadoCents)} · previsto ${brlPrecise(mes.previstoCents)}`}
                  >
                    {/* Previsto em cima, hachurado e sem preenchimento sólido: a
                        diferença é de TEXTURA, não só de cor — quem não separa as
                        duas tintas ainda separa liso de listrado. */}
                    {alturaPrev > 0 ? (
                      <span className="fin-cartao-plast-barra-prev" style={{ height: `${alturaPrev}%` }} />
                    ) : null}
                    {alturaReal > 0 ? (
                      <span className="fin-cartao-plast-barra-real" style={{ height: `${alturaReal}%` }} />
                    ) : null}
                  </div>
                  <span className="fin-cartao-plast-coluna-mes">{monthKeyLabel(mes.mes)}</span>
                </div>
              );
            })}
          </div>
        </>
      ) : null}

      {/* O agregado acima responde QUANTO. Esta lista responde O QUÊ — sem ela
          o detalhamento mostra oito barras e nenhum estabelecimento, que é
          justamente o que se quer ver ao abrir um plástico. Oito linhas e
          ponto: quem quer a lista inteira tem a tabela de transações. */}
      {recentes.length ? (
        <div className="fin-cartao-plast-compras-bloco">
          <div className="fin-cartao-plast-compras-cabeca">
            <span>o que passou recentemente</span>
            {compras.length > recentes.length ? (
              <span className="fin-cartao-plast-compras-mais">
                {recentes.length} de {compras.length}
              </span>
            ) : null}
          </div>

          <ul className="fin-cartao-plast-compras">
            {recentes.map((compra) => (
              <li key={compra.id} className="fin-cartao-plast-compra">
                <span className="fin-cartao-plast-compra-data">{shortDateLabel(compra.postedOn)}</span>

                <span className="fin-cartao-plast-compra-desc">
                  <span className="fin-cartao-plast-compra-titulo">
                    {compra.descricao}
                    {/* Uma compra parcelada volta uma vez por mês nesta lista.
                        Sem o "3/10" as linhas repetidas parecem duplicata do sync. */}
                    {compra.parcela && compra.parcelasTotal && compra.parcelasTotal > 1 ? (
                      <span className="fin-cartao-plast-compra-parcela">
                        {compra.parcela}/{compra.parcelasTotal}
                      </span>
                    ) : null}
                  </span>

                  <span className="fin-cartao-plast-compra-meta">
                    {[compra.categoria, compra.nucleo]
                      .filter((v): v is string => Boolean(v))
                      .join(" · ")}
                    {/* O mesmo buraco do cadastro do plástico, o mesmo desenho:
                        hachura mais o texto do que falta. A fila que resolve
                        este aqui é a de qualificação. */}
                    {compra.falta.length ? (
                      <span className="fin-cartao-plast-compra-pendente">
                        <span className="fin-cartao-plast-hachura" aria-hidden />
                        {compra.falta.map((f) => FALTA_ROTULO[f] ?? f).join(" · ")}
                      </span>
                    ) : null}
                  </span>
                </span>

                <span className="fin-cartao-plast-compra-valor">{brlPrecise(compra.valorCents)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

// ===========================================================================
// O editor inline
// ===========================================================================
function EditorCartao({
  cartao,
  aoSalvar,
  aoFechar
}: {
  cartao: PlasticoDoPainel;
  aoSalvar: (cartao: PlasticoDoPainel) => void;
  aoFechar: () => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [apelido, setApelido] = useState(cartao.apelido ?? "");
  const [bandeira, setBandeira] = useState<Bandeira | "">(
    (BANDEIRAS as readonly string[]).includes(cartao.bandeira ?? "") ? (cartao.bandeira as Bandeira) : ""
  );
  const [cor, setCor] = useState<Cor | "">(
    (CORES as readonly string[]).includes(cartao.cor ?? "") ? (cartao.cor as Cor) : ""
  );
  const [tipo, setTipo] = useState<Tipo>(
    (TIPOS as readonly string[]).includes(cartao.tipo) ? (cartao.tipo as Tipo) : "desconhecido"
  );
  const [limite, setLimite] = useState(reaisDeCentavos(cartao.limiteCents));

  const [erro, setErro] = useState<string | null>(null);
  const [emVoo, setEmVoo] = useState(false);

  async function salvar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);

    // Só o que MUDOU entra no corpo. Ausente é "não mexe" e null é "apaga" —
    // mandar o formulário inteiro gravaria um "tipo = o mesmo tipo" em toda
    // edição de apelido e encheria a trilha de auditoria de campos intocados.
    const corpo: Record<string, unknown> = {};

    const apelidoLimpo = apelido.trim();
    if (apelidoLimpo !== (cartao.apelido ?? "")) {
      corpo.apelido = apelidoLimpo === "" ? null : apelidoLimpo;
    }
    if (bandeira !== (cartao.bandeira ?? "")) corpo.bandeira = bandeira === "" ? null : bandeira;
    if (cor !== (cartao.cor ?? "")) corpo.cor = cor === "" ? null : cor;
    if (tipo !== cartao.tipo) corpo.tipo = tipo;

    const limiteAtual = reaisDeCentavos(cartao.limiteCents);
    if (limite.trim() !== limiteAtual) {
      const cents = centavosDeReais(limite);
      if (cents === "invalido") {
        setErro("Limite inválido. Escreva em reais, como 2.000,00 — ou deixe vazio para apagar.");
        return;
      }
      corpo.limiteCents = cents;
    }

    if (!Object.keys(corpo).length) {
      aoFechar();
      return;
    }

    setEmVoo(true);
    try {
      const resposta = await fetch(urlDaOrigem(`/api/financeiro/cartao/${cartao.cardId}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo)
      });
      const resultado: { erro?: string; ok?: boolean; cartao?: LinhaCartao } = await resposta.json();
      if (!resposta.ok || !resultado.ok || !resultado.cartao) {
        // A rota já diz exatamente o que recusou ("bandeira inválida: x",
        // "apelido acima de 60 caracteres"). Trocar isso por "erro ao salvar"
        // apagaria a única informação útil da resposta.
        setErro(resultado.erro ?? "não consegui salvar");
        return;
      }
      aoSalvar(comRespostaDoServidor(cartao, resultado.cartao));
      startTransition(() => router.refresh());
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : "não consegui salvar");
    } finally {
      setEmVoo(false);
    }
  }

  return (
    <form className="fin-cartao-plast-editor" onSubmit={salvar}>
      {erro ? (
        <p className="fin-cartao-plast-erro" role="alert">
          {erro}
        </p>
      ) : null}

      <label className="fin-cartao-plast-campo">
        <span className="fin-cartao-plast-campo-rotulo">Apelido</span>
        <input
          className="fin-cartao-plast-input"
          value={apelido}
          maxLength={60}
          placeholder={`final ${cartao.last4}`}
          onChange={(e) => setApelido(e.target.value)}
        />
        <span className="fin-cartao-plast-campo-nota">vazio apaga o apelido</span>
      </label>

      <fieldset className="fin-cartao-plast-campo">
        <legend className="fin-cartao-plast-campo-rotulo">Bandeira</legend>
        <div className="fin-cartao-plast-chips">
          <button
            type="button"
            className="fin-cartao-plast-chip"
            data-ativo={bandeira === "" ? "sim" : "nao"}
            aria-pressed={bandeira === ""}
            onClick={() => setBandeira("")}
          >
            <span className="fin-cartao-plast-hachura" aria-hidden />
            sem bandeira
          </button>
          {BANDEIRAS.map((b) => (
            <button
              key={b}
              type="button"
              className="fin-cartao-plast-chip"
              data-ativo={bandeira === b ? "sim" : "nao"}
              aria-pressed={bandeira === b}
              onClick={() => setBandeira(b)}
            >
              <MarcaBandeira bandeira={b} />
              <span className="fin-cartao-plast-chip-nome">{BANDEIRA_ROTULO[b]}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="fin-cartao-plast-campo">
        <legend className="fin-cartao-plast-campo-rotulo">Cor</legend>
        <div className="fin-cartao-plast-cores">
          <button
            type="button"
            className="fin-cartao-plast-cor fin-cartao-plast-cor-nenhuma"
            data-ativo={cor === "" ? "sim" : "nao"}
            aria-pressed={cor === ""}
            aria-label="sem cor"
            title="sem cor"
            onClick={() => setCor("")}
          >
            <span className="fin-cartao-plast-hachura" aria-hidden />
          </button>
          {CORES.map((c) => (
            <button
              key={c}
              type="button"
              className="fin-cartao-plast-cor"
              data-ativo={cor === c ? "sim" : "nao"}
              aria-pressed={cor === c}
              aria-label={c}
              title={c}
              onClick={() => setCor(c)}
            >
              <span
                className="fin-cartao-plast-cor-amostra"
                style={{ background: TINTA_DO_PLASTICO[c] }}
                aria-hidden
              />
            </button>
          ))}
        </div>
      </fieldset>

      <label className="fin-cartao-plast-campo">
        <span className="fin-cartao-plast-campo-rotulo">Tipo</span>
        <select
          className="fin-cartao-plast-select"
          value={tipo}
          onChange={(e) => setTipo(e.target.value as Tipo)}
        >
          {TIPOS.map((t) => (
            <option key={t} value={t}>
              {TIPO_ROTULO[t] || "desconhecido"}
            </option>
          ))}
        </select>
      </label>

      <label className="fin-cartao-plast-campo">
        <span className="fin-cartao-plast-campo-rotulo">Limite do plástico</span>
        <div className="fin-cartao-plast-moeda">
          <span aria-hidden>R$</span>
          <input
            className="fin-cartao-plast-input"
            inputMode="decimal"
            value={limite}
            placeholder="2.000,00"
            onChange={(e) => setLimite(e.target.value)}
          />
        </div>
        {/* A distinção que a rota faz entre o limite da CONTA e o do plástico é
            estrutural, e é a única nota que sobrevive aqui — sem ela alguém
            digita os R$ 17.900 da linha do Nubank num final de cartão. */}
        <span className="fin-cartao-plast-campo-nota">
          deste final, não da linha do emissor · vazio apaga
          {cartao.limiteDefinidoPor ? ` · definido por ${cartao.limiteDefinidoPor}` : ""}
        </span>
      </label>

      <div className="fin-cartao-plast-editor-acoes">
        <button type="submit" className="fin-cartao-plast-botao fin-cartao-plast-botao-primario" disabled={emVoo}>
          {emVoo ? "salvando…" : "salvar"}
        </button>
        <button type="button" className="fin-cartao-plast-botao" onClick={aoFechar} disabled={emVoo}>
          cancelar
        </button>
      </div>
    </form>
  );
}

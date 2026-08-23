"use client";

import { useEffect, useState } from "react";

/**
 * O vocabulário de Recebíveis, num lugar só.
 *
 * Três telas usam as mesmas cores, os mesmos rótulos e o mesmo formato de mês:
 * a guia, o gráfico cheio e o resumo do Início. Duas cópias divergiriam na
 * primeira natureza nova — e o app já viveu isso: `.nat-recorrente` existia no
 * componente e `.nat-prolabore` no CSS, e a banda de R$ 72.022 do Gabriel
 * renderizou invisível.
 */

export type Recebiveis = {
  totalCents: number;
  mesAtualCents: number;
  medianaRecorrenteCents: number;
  emAbertoCents: number;
  desde: string | null;
  ultimoEm: string | null;
  porNatureza: { natureza: string; cents: number; n: number }[];
  porMes: { mes: string; totalCents: number; porNatureza: Record<string, number> }[];
  linhas: {
    data: string;
    mes: string;
    valorCents: number;
    natureza: string;
    categoria: string | null;
    conta: string;
    descricao: string;
  }[];
};

export const ROTULO: Record<string, string> = {
  salario: "Salário",
  prolabore: "Pró-labore",
  estagio: "Estágio",
  comissao: "Comissão",
  reembolso: "Reembolso",
  encargo_beneficio: "Benefício",
  extra: "Extra"
};

/*
 * Salário, pró-labore e estágio dividem a MESMA cor.
 *
 * Conferido nas 28 pessoas com pagamento em 2026: ninguém tem duas delas — os
 * vínculos são mutuamente exclusivos. Com uma cor só, a banda roxa quer dizer
 * "o que se repete todo mês" no gráfico de qualquer pessoa, e a legenda diz o
 * nome certo do vínculo de cada uma.
 */
export const CLASSE: Record<string, string> = {
  salario: "nat-recorrente",
  prolabore: "nat-recorrente",
  estagio: "nat-recorrente",
  comissao: "nat-comissao",
  reembolso: "nat-reembolso",
  extra: "nat-extra",
  encargo_beneficio: "nat-encargo"
};

const MES_LONGO = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"
];

export const nomeMes = (m: string) => `${MES_LONGO[Number(m.slice(5, 7)) - 1]} de ${m.slice(0, 4)}`;
export const mesCurto = (m: string) => MES_LONGO[Number(m.slice(5, 7)) - 1].slice(0, 3);

/**
 * O carregador, único.
 *
 * ---------------------------------------------------------------------------
 * QUATRO CÓPIAS DO MESMO `fetch`, E O HISTÓRICO SERIA A QUINTA
 * ---------------------------------------------------------------------------
 * `/api/time/recebiveis` era buscado em quatro lugares — a guia, o gráfico
 * cheio, o resumo do Início e o perfil — cada um com seu `useState`, seu
 * `carregando` e sua forma própria de tratar erro. Três deles vivem no MESMO
 * `TimeApp.tsx`: trocar de aba refazia a consulta que a aba anterior acabara
 * de fazer.
 *
 * O motivo de não deixar assim não é a requisição repetida (o dado é pequeno).
 * É que quatro tratamentos de erro divergem: dois devolviam `null` calado e um
 * mostrava mensagem. Quem abrisse a guia certa via o problema; quem abrisse a
 * outra via uma tela vazia sem explicação.
 *
 * ---------------------------------------------------------------------------
 * O CACHE É DA PROMESSA, NÃO DO VALOR — E ELE PRECISA MORRER
 * ---------------------------------------------------------------------------
 * Guardar a promessa faz duas telas que montam juntas dividirem UMA requisição,
 * não duas em corrida. Mas cache que não expira é dado velho com cara de novo:
 * quem registra um reembolso e volta para Recebíveis tem de ver o novo. Por
 * isso `invalidarRecebiveis()` existe e é chamada por quem escreve.
 *
 * E a promessa REJEITADA não fica no cache: sem isso, uma falha de rede na
 * primeira montagem condenaria a sessão inteira a repetir o mesmo erro sem
 * nunca tentar de novo.
 */

let cache: Promise<{ dado: Recebiveis | null; erro: string | null }> | null = null;

export function invalidarRecebiveis() {
  cache = null;
}

/**
 * Para quem não pode chamar hook: a folha do perfil busca DENTRO de um efeito
 * condicional (`if (!folha) return`), e hoistar o hook para o topo faria toda
 * rota de /time — inclusive os formulários, que não mostram recebível nenhum —
 * disparar a consulta na montagem. Mesma cache, sem o custo.
 */
export function carregarRecebiveis() {
  return buscar();
}

function buscar() {
  if (cache) return cache;
  cache = (async () => {
    const r = await fetch("/api/time/recebiveis", { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      cache = null;
      return { dado: null, erro: (j.error as string) ?? "não consegui carregar" };
    }
    return { dado: (j.recebiveis as Recebiveis) ?? null, erro: null };
  })().catch((e) => {
    cache = null;
    return { dado: null, erro: e instanceof Error ? e.message : "não consegui carregar" };
  });
  return cache;
}

export function useRecebiveis() {
  const [estado, setEstado] = useState<{ dado: Recebiveis | null; erro: string | null; carregando: boolean }>({
    dado: null,
    erro: null,
    carregando: true
  });

  useEffect(() => {
    let vivo = true;
    void buscar().then((r) => {
      if (vivo) setEstado({ ...r, carregando: false });
    });
    return () => {
      vivo = false;
    };
  }, []);

  return estado;
}

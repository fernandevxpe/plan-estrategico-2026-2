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
  salarioBase: { valorCents: number; vigenteDesde: string; nota: string | null } | null;
  previsao: { mes: string; salarioCents: number; prolaboreCents: number; reembolsoCents: number }[];
  reembolsoPorCompetencia: {
    competencia: string;
    totalCents: number;
    itens: {
      descricao: string;
      valorCents: number;
      parcela: number | null;
      parcelasTotal: number | null;
      tipo: string | null;
      temComprovante: boolean;
    }[];
  }[];
  emAbertoCents: number;
  emAberto: {
    slug: string;
    descricao: string;
    parcela: number;
    parcelasTotal: number;
    parcelasRestantes: number;
    valorParcelaCents: number;
    saldoCents: number;
  }[];
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
 * SALÁRIO TEM COR PRÓPRIA; pró-labore e estágio dividem a outra.
 *
 * Este bloco dizia que os três compartilhavam a mesma cor "porque ninguém tem
 * duas delas — os vínculos são mutuamente exclusivos". Era verdade enquanto
 * quem classificava era a categoria do ledger. Deixou de ser quando
 * `fin_pessoa_salario_base` (0164) passou a separar, nos sócios, o salário do
 * pró-labore: o Fernando tem os dois TODO mês.
 *
 * Com a cor antiga, a divisão que a migration existe para fazer aparecia no
 * gráfico como um bloco roxo único. A tela mostrava a separação nos números e
 * a escondia no desenho.
 *
 * Estágio segue no roxo: nenhuma pessoa da base tem estágio junto com
 * pró-labore, e ali a premissa continua valendo.
 */
export const CLASSE: Record<string, string> = {
  salario: "nat-salario",
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

/**
 * Plural que não quebra em 1.
 *
 * A tela dizia "1 pagamentos", "mediana, 1 meses", "Últimos 1 meses" — e o
 * detalhe cruel é QUEM via: quem tem 8 meses de histórico nunca encontra; quem
 * entrou este mês encontra em toda tela. É o primeiro sinal de descuido que a
 * pessoa recebe de um app que fala do dinheiro dela.
 */
export function plural(n: number, um: string, muitos: string) {
  return `${n} ${n === 1 ? um : muitos}`;
}

export const nomeMes = (m: string) => `${MES_LONGO[Number(m.slice(5, 7)) - 1]} de ${m.slice(0, 4)}`;
/** Título de mês — primeira letra maiúscula ("Agosto de 2026"). */
export const nomeMesTitulo = (m: string) => {
  const s = nomeMes(m);
  return s.charAt(0).toUpperCase() + s.slice(1);
};
export const mesCurto = (m: string) => MES_LONGO[Number(m.slice(5, 7)) - 1].slice(0, 3);
/** Nome do mês por extenso, capitalizado — "Agosto", "Setembro". */
export const mesNome = (m: string) => {
  const s = MES_LONGO[Number(m.slice(5, 7)) - 1];
  return s.charAt(0).toUpperCase() + s.slice(1);
};

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
let cacheEm = 0;

/*
 * O CACHE PRECISA DE PRAZO, e a falta dele apareceu na cara do dono.
 *
 * Cache sem expiração dedupa a requisição de duas telas que montam juntas — que
 * era o objetivo — mas sobrevive a toda navegação de cliente. O Fernando abriu
 * Recebíveis depois de uma correção no banco e viu os números ANTIGOS:
 * "Pró-labore R$ 5.000,00" sem salário separado, que é exatamente a soma que a
 * migration tinha acabado de dividir. A navegação dele foi interna, o módulo
 * continuou vivo, e a tela mentiu com convicção.
 *
 * 60 segundos: longo o bastante para as três telas que montam juntas dividirem
 * uma requisição, curto o bastante para ninguém decidir em cima de número
 * velho.
 */
const VALIDADE_MS = 60_000;

export function invalidarRecebiveis() {
  cache = null;
  cacheEm = 0;
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
  if (cache && Date.now() - cacheEm < VALIDADE_MS) return cache;
  cacheEm = Date.now();
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
    const puxar = () =>
      void buscar().then((r) => {
        if (vivo) setEstado({ ...r, carregando: false });
      });
    puxar();

    /*
     * REVALIDA AO VOLTAR PARA A ABA — e esta linha nasceu de um constrangimento.
     *
     * O prazo de 60s só é conferido quando alguém CHAMA `buscar()`, e isso só
     * acontece na montagem do componente. Numa tela que fica aberta, o dado
     * envelhece para sempre.
     *
     * Aconteceu três vezes seguidas com o Fernando: eu corrigia o banco, ele
     * dava F5 — que na navegação do Next é interna, e não remonta nada — e via
     * "Pró-labore R$ 5.000,00" sem o salário separado, que é exatamente a soma
     * que a migration tinha acabado de dividir. Ele conferiu, e a tela mentiu.
     *
     * Voltar para a aba é o momento em que a pessoa reabre a pergunta. É onde
     * a resposta deve ser reconferida.
     */
    const aoVoltar = () => {
      if (document.visibilityState === "visible") puxar();
    };
    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener("focus", aoVoltar);
    return () => {
      vivo = false;
      document.removeEventListener("visibilitychange", aoVoltar);
      window.removeEventListener("focus", aoVoltar);
    };
  }, []);

  return estado;
}

/**
 * O mapa da navegação — uma rota, um nome, um lugar.
 *
 * POR QUE ISTO É UM ARQUIVO SÓ
 *
 * Antes desta frente havia duas navegações concorrentes: `AppNav` (13 itens em
 * 4 grupos) e `FinShell` (uma fila de 23 abas). Elas discordavam. O caso que
 * dói: `/financeiro/fluxo` chamava-se "Caixa futuro" no menu de cima e "Fluxo
 * de caixa" na barra de dentro — duas telas na cabeça do usuário, uma no
 * repositório. E `/financeiro/resultado`, a DRE, não estava em menu nenhum:
 * existia, funcionava, e só se chegava nela digitando a URL.
 *
 * Um nome duplicado não é erro de digitação, é erro de estrutura: enquanto o
 * rótulo morar junto do componente que o pinta, cada componente novo é uma nova
 * chance de divergir. Aqui o rótulo mora na ROTA. O menu de cima, a barra
 * lateral e a trilha leem o mesmo objeto, então "nome único por rota" é
 * garantido por construção, não por revisão.
 *
 * A REGRA DO RÓTULO
 *
 * O rótulo é a cabeça do `<h1>` da própria tela, encurtada só até onde continua
 * inequívoca. A casa já fazia isso ("Agenda" para "Agenda de obrigações"), e
 * seguir a mesma regra evita inventar um terceiro nome para desempatar dois.
 * Onde encurtar criaria ambiguidade, o rótulo fica longo de propósito:
 * `/financeiro/contas` é "Contas a pagar e receber", nunca "Contas", porque
 * "Contas" num módulo financeiro é lido como conta bancária — e conta bancária
 * é outra tela.
 *
 * ESTE ARQUIVO NÃO IMPORTA NADA DO REACT
 *
 * Ele é lido por componente de cliente (`Trilha`, `FinShell`) e por componente
 * de servidor (`AppShell` decide o perfil). Uma dependência de runtime aqui
 * obrigaria a duplicar o mapa dos dois lados, e mapa duplicado é mapa que
 * diverge — que é o defeito que este arquivo veio fechar.
 */

export type Rota = {
  href: string;
  label: string;
  /**
   * Rotas que só aparecem quando esta subárvore está ativa.
   *
   * Existem três telas para classificar (`categorizacao`, `qualificar`,
   * `revisao`) e isso é uma fusão pendente, não uma decisão de navegação.
   * Enquanto as três existirem, o menu mostra UMA porta; as outras duas
   * aparecem indentadas assim que o usuário está nessa conversa. Some do menu
   * de todo dia sem sumir do produto.
   */
  filhos?: Rota[];
};

export type Grupo = {
  label: string;
  rotas: Rota[];
};

export type Secao = {
  label: string;
  /** A porta da seção: para onde o item do menu de cima aponta. */
  href: string;
  /** As rotas irmãs da seção, para a sub-barra. Inclui a própria porta. */
  rotas: Rota[];
  /**
   * Quando a seção é dona de um prefixo inteiro. Só o financeiro tem: ele tem
   * 23 telas e uma barra lateral própria, então a sub-barra não o serve.
   */
  prefixo?: string;
};

/**
 * A barra lateral do financeiro — seis grupos no lugar de uma fila de 23 abas.
 *
 * Os grupos respondem "que pergunta você veio fazer": onde está o dinheiro
 * (CAIXA), de onde ele vem (RECEBER), para onde vai (PAGAR), quanto custa o
 * time (PESSOAS), o que sobrou (RESULTADO) e de onde saiu o número (DADOS).
 *
 * Só entra rota cuja página EXISTE em `app/financeiro/`. Aba que leva a 404
 * ensina o usuário a não clicar, e depois ele não clica na que funciona.
 */
export const FINANCEIRO_GRUPOS: Grupo[] = [
  {
    label: "Caixa",
    rotas: [
      // Primeiro porque é a tela de abertura de quem decide.
      { href: "/financeiro/painel", label: "Painel" },
      // "Contas a pagar e receber", não "Contas": num módulo financeiro
      // "Contas" é lido como conta bancária, e esta tela é o contas a pagar.
      { href: "/financeiro/contas", label: "Contas a pagar e receber" },
      { href: "/financeiro/agenda", label: "Agenda" },
      // O nome único de `/financeiro/fluxo`. "Caixa futuro" existia só no menu
      // de cima, que esta frente remove; "Fluxo de caixa" é o `<h1>`, o
      // `<title>` e o nome do diretório. Manter o nome que a tela já carrega é
      // o único desempate que não cria um terceiro nome.
      { href: "/financeiro/fluxo", label: "Fluxo de caixa" }
    ]
  },
  {
    // Um item só, e de propósito. O plano previa "Contratos e cobranças" ao
    // lado, mas essa página não existe em `app/financeiro/` — declarar o grupo
    // vazio pela metade é honesto; inventar a aba seria ensinar o 404.
    label: "Receber",
    rotas: [{ href: "/financeiro/receitas", label: "Receitas" }]
  },
  {
    label: "Pagar",
    rotas: [
      { href: "/financeiro/custos", label: "Custos do mês" },
      // Logo depois: é a configuração DELE. A tela acima responde "quanto sai
      // em setembro", esta responde "o que a empresa paga todo mês, e quanto".
      { href: "/financeiro/custos-fixos", label: "Custos fixos" },
      { href: "/financeiro/mei", label: "Teto do MEI" }
    ]
  },
  {
    label: "Pessoas",
    rotas: [
      { href: "/financeiro/pessoas", label: "Custo com pessoas" },
      { href: "/financeiro/reembolsos", label: "Reembolsos" },
      // "Fila do time" é a caixa de entrada do ADMIN. O oposto dela, o que a
      // pessoa envia, chama-se "Enviar ao financeiro" em Meu espaço — os dois
      // nomes antigos ("Fila do time" e "Meus envios") pareciam a mesma coisa.
      { href: "/financeiro/time", label: "Fila do time" }
    ]
  },
  {
    label: "Resultado",
    rotas: [
      // O defeito nº 1 do inventário: a DRE existia, funcionava e não estava em
      // menu nenhum. "(DRE)" entra no rótulo porque "Resultado" sozinho é a
      // palavra mais genérica do módulo — foi assim que ela se escondeu.
      { href: "/financeiro/resultado", label: "Resultado (DRE)" },
      { href: "/financeiro/indicadores", label: "Indicadores" },
      { href: "/financeiro/planejamento", label: "Planejamento" },
      { href: "/financeiro/modelo", label: "Modelo de gestão" }
    ]
  },
  {
    label: "Dados",
    rotas: [
      { href: "/financeiro/lancamentos", label: "Lançamentos" },
      {
        href: "/financeiro/categorizacao",
        label: "Categorização",
        // As outras duas telas de classificar. Elas continuam existindo e
        // alcançáveis; só deixam de disputar espaço no menu de todo dia.
        filhos: [
          { href: "/financeiro/qualificar", label: "Qualificar" },
          { href: "/financeiro/revisao", label: "Revisão" }
        ]
      },
      { href: "/financeiro/regras", label: "Regras" },
      // Ao lado de Importar: as duas respondem "de onde vem o dado". Importar é
      // o caminho manual; Fontes é o mapa de todos os caminhos, com o botão
      // para os que andam sozinhos.
      { href: "/financeiro/fontes", label: "Fontes" },
      { href: "/financeiro/importar", label: "Importar" }
    ]
  }
];

/**
 * O menu de cima — seis lugares, por assunto e não por intenção.
 *
 * Os grupos antigos eram perguntas ("Como estamos", "O que eu mando"). Uma
 * pergunta é um bom título de relatório e um péssimo endereço: para achar a
 * tela era preciso adivinhar em qual pergunta alguém a tinha arquivado. Assunto
 * é o que a pessoa já tem na cabeça quando abre o menu.
 */
export const SECOES: Secao[] = [
  {
    label: "Resumo",
    href: "/",
    rotas: [{ href: "/", label: "Resumo" }]
  },
  {
    // A ÚNICA porta de `/financeiro/*`. Antes, `/financeiro/fluxo` e
    // `/financeiro/time` estavam no menu de cima como irmãos de `/financeiro`:
    // filho e pai no mesmo nível. Agora a seção é dona do prefixo inteiro e o
    // que está dentro se navega pela barra lateral.
    label: "Financeiro",
    href: "/financeiro",
    rotas: [{ href: "/financeiro", label: "Visão geral" }],
    prefixo: "/financeiro"
  },
  {
    label: "Comercial",
    href: "/comercial",
    rotas: [
      { href: "/comercial", label: "Comercial" },
      { href: "/areas/vendas", label: "Vendas" },
      { href: "/mix", label: "Serviços" }
    ]
  },
  {
    label: "Planejamento",
    href: "/planejamento",
    rotas: [
      { href: "/planejamento", label: "Planejamento" },
      { href: "/metas", label: "Plano de ação" }
    ]
  },
  {
    label: "Gestão",
    href: "/gestao-xpe",
    rotas: [
      { href: "/gestao-xpe", label: "Gestão XPE" },
      { href: "/areas", label: "Áreas" },
      { href: "/auditorias", label: "Auditorias" },
      { href: "/investigacao", label: "Investigação" }
    ]
  },
  {
    label: "Meu espaço",
    href: "/time",
    rotas: [
      // Renomeado. "Meus envios" e "Fila do time" pareciam a mesma coisa e são
      // opostos: um é o que EU mando, o outro é o que o admin recebe de todos.
      // O verbo desfaz o empate, e é o vocabulário que o `TimeShell` já usa.
      { href: "/time", label: "Enviar ao financeiro" },
      { href: "/notificacoes", label: "Notificações" }
    ]
  }
];

/** Casa em fronteira de segmento: `/areas` cobre `/areas/vendas`, não `/areas-x`. */
function cobre(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * A seção dona do caminho — a mais específica ganha.
 *
 * `/areas/vendas` é de Comercial e `/areas` é de Gestão. As duas casam com
 * `/areas/vendas`; o desempate por comprimento do prefixo é o que faz a
 * exceção declarada vencer a regra geral, sem lista de exceções em lugar
 * nenhum.
 */
export function secaoAtiva(pathname: string): Secao | null {
  let melhor: Secao | null = null;
  let melhorPeso = -1;

  for (const secao of SECOES) {
    const candidatos = [secao.prefixo, ...secao.rotas.map((r) => r.href)].filter(
      (h): h is string => Boolean(h)
    );
    for (const href of candidatos) {
      if (!cobre(href, pathname)) continue;
      const peso = href === "/" ? 0 : href.length;
      if (peso > melhorPeso) {
        melhorPeso = peso;
        melhor = secao;
      }
    }
  }

  return melhor;
}

/** O grupo do financeiro dono do caminho, e a rota dentro dele. */
export function financeiroAtivo(pathname: string): { grupo: Grupo; rota: Rota; filho?: Rota } | null {
  for (const grupo of FINANCEIRO_GRUPOS) {
    for (const rota of grupo.rotas) {
      if (cobre(rota.href, pathname)) return { grupo, rota };
      const filho = rota.filhos?.find((f) => cobre(f.href, pathname));
      if (filho) return { grupo, rota, filho };
    }
  }
  return null;
}

export type Migalha = { label: string; href?: string };

/**
 * A trilha: `Financeiro › Caixa › Agenda`.
 *
 * A última migalha nunca é link — ela é onde você está, e um link para a página
 * atual é um botão que não faz nada. O rótulo de cada nível sai do mesmo mapa
 * que pinta os menus, então a trilha não pode discordar deles.
 */
export function resolverTrilha(pathname: string): Migalha[] {
  const secao = secaoAtiva(pathname);
  if (!secao) return [];

  const trilha: Migalha[] = [{ label: secao.label, href: secao.href }];

  if (secao.prefixo === "/financeiro") {
    const atual = financeiroAtivo(pathname);
    if (atual) {
      // O grupo não é link: é um rótulo de agrupamento, não um endereço.
      trilha.push({ label: atual.grupo.label });
      trilha.push({ label: atual.rota.label, href: atual.filho ? atual.rota.href : undefined });
      if (atual.filho) trilha.push({ label: atual.filho.label });
      return trilha;
    }
    // `/financeiro` em si não está em grupo nenhum — ele é a porta, não uma das
    // telas de dentro. Sem esta linha a trilha sumia justamente na tela de
    // abertura do módulo, que é onde alguém está mais perdido.
    const porta = secao.rotas.find((r) => r.href === pathname);
    if (porta) trilha.push({ label: porta.label });
    return trilha;
  }

  let melhor: Rota | null = null;
  for (const rota of secao.rotas) {
    if (!cobre(rota.href, pathname)) continue;
    if (!melhor || rota.href.length > melhor.href.length) melhor = rota;
  }
  // Quando o rótulo da rota repete o da seção (`Comercial › Comercial`), a
  // segunda migalha não informa nada e não entra.
  if (melhor && melhor.label !== secao.label) trilha.push({ label: melhor.label });

  return trilha;
}

/** Ativo por fronteira de segmento — exportado para os menus não reimplementarem. */
export function rotaAtiva(href: string, pathname: string): boolean {
  return cobre(href, pathname);
}

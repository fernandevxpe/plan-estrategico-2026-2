/**
 * Os dois perfis de acesso da plataforma.
 *
 * `comum`  marketing e vendas. Vê o comercial, o planejamento, as áreas, as
 *          metas — tudo que fala de pipeline, cliente e execução.
 * `admin`  o mesmo, mais o módulo financeiro inteiro.
 *
 * POR QUE A REGRA É "NEGAR UM PREFIXO" E NÃO "PERMITIR UMA LISTA"
 *
 * Lista de permitidos exige que alguém lembre de acrescentar cada rota nova, e
 * o esquecimento é silencioso na direção segura (a página some para todo mundo)
 * — o que faz o time desativar a checagem por incômodo. Aqui a plataforma
 * inteira é comum e o financeiro é a exceção, então a exceção é o que se
 * declara. Uma tela nova de comercial nasce visível; uma tela nova de
 * financeiro nasce protegida, porque cai sob o prefixo.
 *
 * O prefixo cobre `/financeiro` e `/api/financeiro`. A API precisa estar aqui:
 * bloquear só a página deixaria os números a um `curl` de distância, e o perfil
 * comum tem credencial válida — ele passaria pela autenticação e leria o ledger
 * inteiro pelo JSON.
 *
 * Este arquivo não importa nada do Next de propósito: ele roda no middleware
 * (edge) e nos Server Components, e uma dependência de runtime aqui obrigaria a
 * duplicar a regra nos dois lados. Regra de acesso duplicada é regra que
 * diverge.
 */

export type Perfil = "admin" | "comum";

/** Cabeçalho que o middleware carimba para o servidor saber quem entrou. */
export const CABECALHO_PERFIL = "x-xpe-perfil";

/**
 * Por qual porta a requisição entrou.
 *
 * `basic`  passou pela credencial compartilhada da plataforma. Ela prova
 *          "alguém do time", nunca "quem" — e é justamente por isso que ela
 *          basta para o login DECLARADO (clicar no próprio nome numa lista):
 *          a lista já era visível para quem tinha a senha.
 * `sessao` veio pelo prefixo do app do time, que é isento do Basic para o app
 *          instalável funcionar. Aqui não há credencial compartilhada por trás,
 *          então declarar quem se é não vale nada: só e-mail e senha entram.
 *
 * Sem esta distinção, isentar `/api/time` do Basic transformaria o login
 * declarado numa porta aberta — qualquer um abriria sessão como qualquer
 * pessoa do cadastro.
 */
export type Porta = "basic" | "sessao";
export const CABECALHO_PORTA = "x-xpe-porta";

/**
 * Prefixos que só o admin alcança.
 *
 * Comparação por segmento, não por `startsWith` cru: `/financeiro` tem de casar
 * com `/financeiro` e `/financeiro/qualquer-coisa`, e NÃO com uma futura rota
 * `/financeiro-publico`, que o `startsWith` deixaria passar como se fosse a
 * mesma família.
 */
const SO_ADMIN = ["/financeiro", "/api/financeiro"];

export function exigeAdmin(pathname: string): boolean {
  return SO_ADMIN.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function podeVer(perfil: Perfil, pathname: string): boolean {
  return perfil === "admin" || !exigeAdmin(pathname);
}

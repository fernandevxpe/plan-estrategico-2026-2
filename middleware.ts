import { NextRequest, NextResponse } from "next/server";

import { CABECALHO_PERFIL, CABECALHO_PORTA, exigeAdmin, type Perfil, type Porta } from "@/lib/auth/perfis";

const REALM = "XPE Strategic Dashboard";

function unauthorized() {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": `Basic realm="${REALM}", charset="UTF-8"`
    }
  });
}

function normalizeSecret(value: string | undefined) {
  return value?.trim().replace(/^['"]|['"]$/g, "");
}

/**
 * Compara em tempo constante.
 *
 * `a !== b` sai no primeiro caractere diferente, e a diferença de tempo entre
 * "errou na primeira letra" e "errou na última" é mensurável pela rede. Não é
 * ataque teórico contra senha curta: com repetição, dá para descobrir a senha
 * caractere a caractere sem nunca acertá-la inteira.
 *
 * O XOR percorre o comprimento inteiro sempre. O comprimento em si vaza (e não
 * há como esconder sem hash), mas isso é muito menos do que o conteúdo.
 */
function igualSeguro(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i += 1) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/**
 * Qual perfil a credencial abre, ou null se não abre nenhum.
 *
 * As duas checagens rodam SEMPRE, mesmo depois de a primeira casar. Sair cedo
 * faria o tempo de resposta contar se o usuário digitado era o admin ou o
 * comum — informação de graça para quem estiver tentando.
 */
function perfilDaCredencial(usuario: string, senha: string): Perfil | null {
  const admUser = normalizeSecret(process.env.DASHBOARD_ADMIN_USER);
  const admPass = normalizeSecret(process.env.DASHBOARD_ADMIN_PASSWORD);
  const comUser = normalizeSecret(process.env.DASHBOARD_AUTH_USER);
  const comPass = normalizeSecret(process.env.DASHBOARD_AUTH_PASSWORD);

  const ehAdmin = Boolean(admUser && admPass) && igualSeguro(usuario, admUser!) && igualSeguro(senha, admPass!);
  const ehComum = Boolean(comUser && comPass) && igualSeguro(usuario, comUser!) && igualSeguro(senha, comPass!);

  if (ehAdmin) return "admin";
  if (ehComum) return "comum";
  return null;
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (process.env.NODE_ENV === "development") {
    // Em desenvolvimento não há senha, e por isso não há como saber o perfil.
    // Admin é a escolha certa aqui: o contrário esconderia o financeiro de quem
    // está justamente trabalhando nele, e a proteção que importa é a de
    // produção. Para exercitar o perfil comum localmente existe
    // `XPE_PERFIL_LOCAL=comum`.
    const perfilLocal = (normalizeSecret(process.env.XPE_PERFIL_LOCAL) as Perfil) || "admin";
    return seguir(request, perfilLocal);
  }

  // A produção mora no Railway, onde existe volume persistente para o sync
  // diário gravar. O Vercel é serverless: sem volume e sem processo longo, ele
  // serviria para sempre o snapshot congelado no build — duas URLs com números
  // diferentes. Redireciona antes da autenticação, porque o destino tem a dele.
  const primaryUrl = normalizeSecret(process.env.PRIMARY_APP_URL);
  if (process.env.VERCEL && primaryUrl) {
    const target = new URL(`${pathname}${search}`, primaryUrl);
    return NextResponse.redirect(target, 308);
  }

  // O par comum é o mínimo para a plataforma servir. Sem ele, 503 — nunca
  // "entra sem senha", que é a falha que transformaria um erro de configuração
  // em vazamento.
  const temComum = normalizeSecret(process.env.DASHBOARD_AUTH_USER) && normalizeSecret(process.env.DASHBOARD_AUTH_PASSWORD);
  if (!temComum) {
    return new NextResponse("Dashboard authentication is not configured.", { status: 503 });
  }

  // O app do time entra por sessão de pessoa, não pela senha compartilhada.
  //
  // POR QUE ESTA ISENÇÃO EXISTE
  // Um app instalado no celular não tem como usar Basic Auth de forma decente:
  // ou a credencial do time inteiro fica embutida no cliente, ou a pessoa
  // digita a senha da plataforma toda num aparelho pessoal. As duas degradam o
  // que este middleware protege. E o Chrome só oferece "Instalar" se conseguir
  // buscar o manifest — que ele busca sem credencial.
  //
  // POR QUE ELA NÃO ABRE BURACO
  // Estas rotas exigem sessão de pessoa, que é credencial INDIVIDUAL e portanto
  // mais forte que a compartilhada. O middleware roda no edge e não consulta
  // Postgres: ele só reconhece que a rota se autoprotege e carimba o perfil
  // mínimo. Quem valida a sessão é a rota, via `exigirContexto()`, e sem sessão
  // ela devolve 401 sem nada dentro. O prefixo `/api/time` é também o único que
  // `scripts/test-perfil-guard.mjs` prova não ler saldo, DRE, folha nem envio
  // de outra pessoa.
  //
  // `x-xpe-porta` distingue as duas portas: o login DECLARADO (clicar no próprio
  // nome numa lista) só é aceito quando veio por Basic, porque ali a credencial
  // compartilhada já provou "alguém do time". Pela porta do app, só e-mail e senha.
  //
  // A ORDEM AQUI JÁ ESTEVE ERRADA, E O ERRO ERA UM LOCKOUT.
  // A primeira versão devolvia `seguir(..., "sessao")` para toda rota do time
  // ANTES de olhar o cabeçalho Basic. Como o navegador da plataforma manda a
  // credencial em toda requisição, isso não mudava nada em desenvolvimento (que
  // sai antes) mas em produção a porta era SEMPRE `sessao` — o caminho declarado
  // morria, e como ninguém tem senha cadastrada ainda, o time inteiro ficaria
  // sem acesso no primeiro deploy. Basic primeiro; a isenção é o que sobra
  // quando não há credencial válida.
  const perfil = perfilDoCabecalho(request.headers.get("authorization"));

  if (perfil) {
    // Credencial válida e rota fora do alcance: 404, não 403.
    //
    // 403 confirma que a rota existe e que a pessoa não tem nível — é um mapa do
    // que ela ainda não pode ver. 404 devolve o mesmo que uma URL inventada. Para
    // quem tem acesso legítimo nada muda; para quem está tateando, não há sinal.
    if (exigeAdmin(pathname) && perfil !== "admin") {
      return new NextResponse("Not found", { status: 404 });
    }
    return seguir(request, perfil, "basic");
  }

  // Sem credencial compartilhada válida: só passam as rotas que se autoprotegem
  // por sessão de pessoa. Um `Authorization` inválido cai aqui do mesmo jeito —
  // a rota vai pedir e-mail e senha, que é a resposta certa.
  if (ehRotaDoTime(pathname)) return seguir(request, "comum", "sessao");

  return unauthorized();
}

/** O perfil que o cabeçalho abre, ou `null` — sem lançar em entrada malformada. */
function perfilDoCabecalho(header: string | null): Perfil | null {
  if (!header?.startsWith("Basic ")) return null;
  let decoded: string;
  try {
    decoded = atob(header.slice("Basic ".length));
  } catch {
    return null;
  }
  const separator = decoded.indexOf(":");
  if (separator === -1) return null;
  return perfilDaCredencial(decoded.slice(0, separator), decoded.slice(separator + 1));
}

/**
 * Deixa passar carimbando o perfil no request.
 *
 * O cabeçalho é ESCRITO aqui, sobre o que veio de fora. Sem sobrescrever, um
 * cliente mandaria `x-xpe-perfil: admin` na própria requisição e a tela
 * acreditaria — a autorização viraria um campo que o atacante preenche. O
 * middleware é o único lugar que sabe a verdade, então é o único que escreve.
 *
 * Ele serve para a APRESENTAÇÃO (esconder o menu do financeiro), não para a
 * proteção: quem protege é o bloqueio de rota acima. Menu escondido é
 * conveniência; rota bloqueada é segurança.
 */
function seguir(request: NextRequest, perfil: Perfil, porta: Porta = "basic") {
  const headers = new Headers(request.headers);
  headers.set(CABECALHO_PERFIL, perfil);
  headers.set(CABECALHO_PORTA, porta);
  return NextResponse.next({ request: { headers } });
}

/**
 * As rotas que se autoprotegem por sessão de pessoa.
 *
 * Comparação por segmento, pelo mesmo motivo de `exigeAdmin`: `/time` casa com
 * `/time` e `/time/qualquer-coisa`, e NÃO com um futuro `/timeline`.
 *
 * O manifest e os ícones entram aqui porque o navegador os busca ANÔNIMO, antes
 * de qualquer credencial — sem isso o convite de instalar nunca aparece. São
 * arquivos estáticos sem dado nenhum dentro.
 */
const POR_SESSAO = ["/time", "/api/time"];
const PUBLICOS = ["/manifest.webmanifest", "/icone-192.png", "/icone-512.png", "/icone-maskable.png", "/favicon.ico"];

/**
 * O BUNDLE PRECISA SER ANÔNIMO, E ISSO TEM UM PREÇO DECLARADO.
 *
 * `/_next/static/**` também passa pelo middleware (o roteador do Next resolve
 * middleware ANTES de servir arquivo). Sem isentar, a página `/time` sai para
 * quem não tem credencial e todos os chunks JS voltam 401: o app carrega o
 * HTML, nunca hidrata, e nada nunca chama `/api/time/sessao`. A isenção não
 * entregaria app nenhum.
 *
 * O preço: o bundle do cliente da plataforma inteira passa a ser público. Ele
 * não carrega segredo — o que é secreto é servidor, e as rotas de dado
 * continuam todas atrás de Basic ou de sessão —, mas revela nomes de rota e
 * estrutura de tela. É o custo de servir o app instalável do mesmo domínio.
 *
 * A saída definitiva é a F1 do backlog: o app do time num projeto próprio,
 * apontando para o mesmo banco. Aí o bundle público é só o dele.
 */
const ESTATICOS = ["/_next/static"];

function ehRotaDoTime(pathname: string): boolean {
  if (PUBLICOS.includes(pathname)) return true;
  if (ESTATICOS.some((p) => pathname.startsWith(`${p}/`))) return true;
  return POR_SESSAO.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export const config = {
  matcher: "/:path*"
};

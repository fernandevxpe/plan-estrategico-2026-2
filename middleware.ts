import { NextRequest, NextResponse } from "next/server";

import { CABECALHO_PERFIL, exigeAdmin, type Perfil } from "@/lib/auth/perfis";

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

  const header = request.headers.get("authorization");
  if (!header?.startsWith("Basic ")) return unauthorized();

  let decoded: string;
  try {
    decoded = atob(header.slice("Basic ".length));
  } catch {
    return unauthorized();
  }

  const separator = decoded.indexOf(":");
  if (separator === -1) return unauthorized();

  const perfil = perfilDaCredencial(decoded.slice(0, separator), decoded.slice(separator + 1));
  if (!perfil) return unauthorized();

  // Credencial válida e rota fora do alcance: 404, não 403.
  //
  // 403 confirma que a rota existe e que a pessoa não tem nível — é um mapa do
  // que ela ainda não pode ver. 404 devolve o mesmo que uma URL inventada. Para
  // quem tem acesso legítimo nada muda; para quem está tateando, não há sinal.
  if (!perfil || (exigeAdmin(pathname) && perfil !== "admin")) {
    return new NextResponse("Not found", { status: 404 });
  }

  return seguir(request, perfil);
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
function seguir(request: NextRequest, perfil: Perfil) {
  const headers = new Headers(request.headers);
  headers.set(CABECALHO_PERFIL, perfil);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: "/:path*"
};

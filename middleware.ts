import { NextRequest, NextResponse } from "next/server";

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

export function middleware(request: NextRequest) {
  if (process.env.NODE_ENV === "development") {
    return NextResponse.next();
  }

  // A produção mora no Railway, onde existe volume persistente para o sync
  // diário gravar. O Vercel é serverless: sem volume e sem processo longo, ele
  // serviria para sempre o snapshot congelado no build — duas URLs com números
  // diferentes. Redireciona antes da autenticação, porque o destino tem a dele.
  const primaryUrl = normalizeSecret(process.env.PRIMARY_APP_URL);
  if (process.env.VERCEL && primaryUrl) {
    const target = new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, primaryUrl);
    return NextResponse.redirect(target, 308);
  }

  const expectedUser = normalizeSecret(process.env.DASHBOARD_AUTH_USER);
  const expectedPassword = normalizeSecret(process.env.DASHBOARD_AUTH_PASSWORD);

  if (!expectedUser || !expectedPassword) {
    return new NextResponse("Dashboard authentication is not configured.", {
      status: 503
    });
  }

  const header = request.headers.get("authorization");
  if (!header?.startsWith("Basic ")) return unauthorized();

  const decoded = atob(header.slice("Basic ".length));
  const separator = decoded.indexOf(":");
  if (separator === -1) return unauthorized();

  const user = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);

  if (user !== expectedUser || password !== expectedPassword) {
    return unauthorized();
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/:path*"
};

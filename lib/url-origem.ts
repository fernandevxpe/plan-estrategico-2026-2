/**
 * Path relativo seguro para `fetch` no browser.
 *
 * A plataforma abre com Basic Auth. Se a sessão entrou como
 * `https://user:pass@host/...`, um `fetch("/api/...")` herda o userinfo e o
 * Chromium recusa: "Request cannot be constructed from a URL that includes
 * credentials". `location.origin` nunca carrega userinfo — é o escape.
 */
export function urlDaOrigem(path: string): string {
  if (typeof window === "undefined") return path;
  return new URL(path.startsWith("/") ? path : `/${path}`, window.location.origin).href;
}

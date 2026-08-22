/**
 * O manifest do app instalável.
 *
 * POR QUE É UMA ROTA E NÃO `app/manifest.ts`
 * O helper do Next serve em `/manifest.webmanifest` do mesmo jeito, mas a
 * isenção do Basic Auth em `middleware.ts` compara caminho literal. Uma rota
 * explícita deixa o caminho visível no repositório, ao lado da lista de
 * `PUBLICOS` — quem mexer em um encontra o outro.
 *
 * `start_url` e `scope` apontam para `/time`, não para `/`. O que se instala no
 * celular é o app do time; a plataforma inteira continua atrás do Basic Auth e
 * não faria sentido nenhum numa tela de 393px.
 *
 * `id` fixo para o navegador reconhecer a mesma instalação entre versões.
 */

export const dynamic = "force-static";

export function GET() {
  const manifest = {
    id: "/time",
    name: "XPE — Enviar ao financeiro",
    short_name: "XPE",
    description: "Reembolso, custo, nota e pedido de compra do time da XPE.",
    start_url: "/time",
    scope: "/time",
    display: "standalone",
    orientation: "portrait",
    lang: "pt-BR",
    dir: "ltr",
    // O escuro é o padrão do app: ele é usado na rua, e o roxo da marca vive
    // melhor sobre fundo escuro. `--bg` do tema escuro.
    background_color: "#0b0a12",
    theme_color: "#0b0a12",
    categories: ["business", "finance", "productivity"],
    icons: [
      { src: "/icone-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icone-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icone-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
    ],
    shortcuts: [
      { name: "Lançar custo", short_name: "Custo", url: "/time/custo" },
      { name: "Pedir reembolso", short_name: "Reembolso", url: "/time/reembolso" },
      { name: "Enviar nota", short_name: "Nota", url: "/time/nota" }
    ]
  };

  return new Response(JSON.stringify(manifest, null, 2), {
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": "public, max-age=3600"
    }
  });
}

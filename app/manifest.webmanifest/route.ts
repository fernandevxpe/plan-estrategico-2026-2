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
    /*
     * COMPARTILHAR DO APP DO BANCO DIRETO PARA CÁ.
     *
     * Com isto instalado, o XPE aparece na folha de compartilhamento do Android
     * junto com WhatsApp e Drive. A pessoa recebe o comprovante no app do banco,
     * toca em compartilhar, escolhe XPE — e cai no formulário com o arquivo já
     * anexado. Nada de salvar na galeria, abrir o app, achar o arquivo.
     *
     * `method: POST` + `enctype: multipart/form-data` é o que permite receber
     * ARQUIVO; a forma GET só carrega texto e link. O navegador faz um POST de
     * verdade para a `action`, então ela é uma rota de API, não uma página.
     *
     * LIMITE HONESTO: isto é Android (Chrome/Edge/Samsung). O iOS não implementa
     * Web Share Target — no iPhone o caminho continua sendo abrir o app e
     * escolher o arquivo. Não há como contornar pelo lado do site.
     */
    share_target: {
      action: "/api/time/compartilhado",
      method: "POST",
      enctype: "multipart/form-data",
      params: {
        title: "titulo",
        text: "texto",
        url: "url",
        files: [
          {
            name: "arquivo",
            accept: ["image/*", "application/pdf", ".xml"]
          }
        ]
      }
    },
    shortcuts: [
      { name: "Lançar custo", short_name: "Custo", url: "/time/custo" },
      { name: "Pedir reembolso", short_name: "Reembolso", url: "/time/reembolso" },
      // Era "Enviar nota" → /time/nota. A rota virou `redirect("/time/custo")`,
      // então o atalho do ícone instalado prometia uma tela e entregava outra,
      // chamada "Registrar compra". Atalho que mente sobre o destino é pior
      // que atalho que não existe.
      { name: "Comprar o que foi aprovado", short_name: "Comprar", url: "/time/comprar" }
    ]
  };

  return new Response(JSON.stringify(manifest, null, 2), {
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": "public, max-age=3600"
    }
  });
}

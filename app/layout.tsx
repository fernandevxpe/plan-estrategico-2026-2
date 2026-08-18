import type { Metadata } from "next";
import { Inter, Sora } from "next/font/google";

import "./globals.css";
import { ThemeToggle } from "@/components/layout/ThemeToggle";

export const metadata: Metadata = {
  title: "XPE Consultoria | Indicadores 2026",
  description: "Dashboard local para planejamento estrategico 2026.2"
};

/** Os dados são hidratados do PostgreSQL para o volume e lidos em runtime. */
export const dynamic = "force-dynamic";

// "Inter" já era o nome escrito no CSS antigo, mas nunca foi carregada de
// verdade — nenhum <link> nem next/font a buscava, então todo o app sempre
// renderizou na fonte padrão do sistema operacional. Agora carrega de
// verdade, e Sora entra só para título/número grande — a letra que carrega
// a personalidade da tela sem prejudicar a leitura das tabelas densas.
const inter = Inter({ subsets: ["latin"], variable: "--font-body", display: "swap" });
const sora = Sora({ subsets: ["latin"], weight: ["600", "700", "800"], variable: "--font-display", display: "swap" });

// O tema (claro/escuro/sistema) é lido ANTES do React hidratar, direto no
// <head>, porque esperar o React montar pra aplicar data-theme pisca a tela
// errada por um instante (FOUC de tema) — o mesmo problema que apps com
// dark mode sempre têm, resolvido do jeito padrão: script síncrono, sem
// bloquear o parser (é 4 linhas, roda antes de qualquer pintura).
const SCRIPT_TEMA = `
(function () {
  try {
    var t = localStorage.getItem('xpe-tema');
    if (t === 'claro' || t === 'escuro') document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${inter.variable} ${sora.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />
      </head>
      <body>
        {children}
        <ThemeToggle />
      </body>
    </html>
  );
}

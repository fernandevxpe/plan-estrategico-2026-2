import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "XPE Consultoria | Indicadores 2026",
  description: "Dashboard local para planejamento estrategico 2026.2"
};

/** Os dados são hidratados do PostgreSQL para o volume e lidos em runtime. */
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}

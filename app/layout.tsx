import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "XPE Consultoria | Indicadores 2026",
  description: "Dashboard local para planejamento estrategico 2026.2"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}

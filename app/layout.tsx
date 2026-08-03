import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "XPE Consultoria | Indicadores 2026",
  description: "Dashboard local para planejamento estrategico 2026.2"
};

/**
 * O sync diário escreve num volume, não no bundle. Sem revalidação as páginas
 * ficariam congeladas no estado do build e o dado novo só apareceria em um
 * redeploy — que é justamente o que queremos evitar. 5 minutos dá frescor de
 * sobra para um dado que muda uma vez por dia, sem re-renderizar a cada request.
 */
export const revalidate = 300;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}

"use client";

import { useEffect, useState } from "react";

type Tema = "claro" | "escuro";

function temaAtual(): Tema {
  const atributo = document.documentElement.getAttribute("data-theme");
  if (atributo === "claro" || atributo === "escuro") return atributo;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "escuro" : "claro";
}

function IconeTema({ tema }: { tema: Tema }) {
  if (tema === "escuro") {
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="4.5" />
        <path d="M12 2.5v2.5M12 19v2.5M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M2.5 12H5M19 12h2.5M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z" strokeLinejoin="round" />
    </svg>
  );
}

/** Botão reutilizável — flutuante no layout global ou inline no cabeçalho do time. */
export function BotaoTema({ className }: { className?: string }) {
  const [tema, setTema] = useState<Tema | null>(null);

  useEffect(() => {
    setTema(temaAtual());
  }, []);

  function alternar() {
    const proximo: Tema = temaAtual() === "escuro" ? "claro" : "escuro";
    document.documentElement.setAttribute("data-theme", proximo);
    localStorage.setItem("xpe-tema", proximo);
    setTema(proximo);
  }

  const classe = className ? `theme-toggle ${className}` : "theme-toggle";

  if (tema === null) return <button className={classe} aria-hidden="true" tabIndex={-1} />;

  return (
    <button
      type="button"
      className={classe}
      onClick={alternar}
      aria-label={tema === "escuro" ? "Mudar para tema claro" : "Mudar para tema escuro"}
      title={tema === "escuro" ? "Tema claro" : "Tema escuro"}
    >
      <IconeTema tema={tema} />
    </button>
  );
}

/**
 * Botão flutuante único, em `body`, fora de `AppShell` de propósito — assim
 * nenhuma tela precisa lembrar de incluí-lo, e ele nunca some numa tela nova.
 *
 * O valor already aplicado (se houver) vem do script síncrono em
 * `app/layout.tsx`, que roda antes da hidratação — este componente só
 * assume o controle depois, lendo o mesmo atributo.
 */
export function ThemeToggle() {
  return <BotaoTema />;
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Barra de abas do módulo financeiro.
 *
 * Segue o padrão do `TABS` de components/gestao-xpe/GestaoXpeShell.tsx: um
 * vocabulário de navegação que o usuário já aprendeu em outra parte da
 * plataforma não precisa ser aprendido de novo aqui.
 *
 * As abas não são as rotas do plano inteiro — só as que existem. Aba que leva a
 * tela vazia ensina o usuário a não clicar.
 */
// Só entram abas cuja página EXISTE. Aba que leva a 404 ensina o usuário a não
// clicar, e depois ele não clica na que funciona. "Importar" entra quando a
// tela de upload de extrato estiver de pé.
const TABS = [
  { href: "/financeiro", label: "Visão geral" },
  { href: "/financeiro/lancamentos", label: "Lançamentos" },
  { href: "/financeiro/receitas", label: "Receitas" },
  { href: "/financeiro/fluxo", label: "Fluxo de caixa" },
  { href: "/financeiro/planejamento", label: "Planejamento" },
  { href: "/financeiro/revisao", label: "Revisão" },
  { href: "/financeiro/importar", label: "Importar" }
];

export function FinShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="fin-shell">
      <nav className="fin-tabs" aria-label="Seções do financeiro">
        {TABS.map((tab) => {
          const active = tab.href === "/financeiro" ? pathname === tab.href : pathname.startsWith(tab.href);
          return (
            <Link key={tab.href} href={tab.href} className={active ? "fin-tab active" : "fin-tab"}>
              {tab.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}

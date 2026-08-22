"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * As abas do app do time.
 *
 * Mesmo vocabulário de navegação do `FinShell`, para quem já usa a plataforma
 * não ter de aprender outro. A diferença é o rótulo: aqui as abas são VERBOS —
 * "pedir reembolso", "lançar custo" —, porque a pessoa do time chega com uma
 * intenção ("preciso do meu dinheiro de volta"), não com um substantivo
 * ("reembolsos"). Substantivo é o vocabulário de quem administra a coisa; o
 * time não administra, ele envia.
 */
const TABS = [
  { href: "/time", label: "Início" },
  { href: "/time/reembolso", label: "Pedir reembolso" },
  { href: "/time/custo", label: "Lançar custo" },
  { href: "/time/nota", label: "Enviar nota" },
  { href: "/time/compra", label: "Pedir compra" },
  { href: "/time/envios", label: "O que eu enviei" },
  { href: "/time/meu-reembolso", label: "Meu reembolso" }
];

export function TimeShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="fin-shell">
      <nav className="fin-tabs" aria-label="Seções do app do time">
        {TABS.map((tab) => {
          // Comparação por SEGMENTO, não `startsWith` cru. Com o prefixo,
          // `/time/meu-reembolso` acendia a aba `/time/reembolso` junto —
          // duas abas ativas ao mesmo tempo. É o mesmo cuidado que
          // `lib/auth/perfis.ts` toma com `/financeiro` × `/financeiro-publico`.
          const active =
            tab.href === "/time"
              ? pathname === tab.href
              : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
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

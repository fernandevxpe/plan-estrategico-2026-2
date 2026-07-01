"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Resumo" },
  { href: "/planejamento", label: "Planejamento" },
  { href: "/mix", label: "Mix" },
  { href: "/areas", label: "Áreas" },
  { href: "/investigacao", label: "Investigação" },
  { href: "/gestao-xpe", label: "Gestão XPE" }
];

export function AppNav() {
  const pathname = usePathname();

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    if (href === "/areas") return pathname === "/areas" || pathname.startsWith("/areas/");
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <nav className="nav" aria-label="Navegação principal">
      {links.map((link) => (
        <Link key={link.href} href={link.href} className={isActive(link.href) ? "nav-link active" : "nav-link"}>
          {link.label}
        </Link>
      ))}
    </nav>
  );
}

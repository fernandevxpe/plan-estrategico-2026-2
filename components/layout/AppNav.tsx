"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Agrupado por pergunta que o gestor está fazendo, não por módulo técnico.
 */
const GROUPS = [
  {
    label: "Como estamos",
    links: [
      { href: "/", label: "Resumo" },
      { href: "/comercial", label: "Comercial" }
    ]
  },
  {
    label: "Para onde vamos",
    links: [
      { href: "/planejamento", label: "Planejamento" },
      { href: "/metas", label: "Plano de ação" },
      { href: "/mix", label: "Serviços" }
    ]
  },
  {
    label: "Onde agir",
    links: [
      { href: "/areas/diretor-comercial", label: "Diretor Comercial" },
      { href: "/areas", label: "Áreas" },
      { href: "/investigacao", label: "Investigação" },
      { href: "/gestao-xpe", label: "Gestão XPE" },
      { href: "/auditorias", label: "Auditorias" }
    ]
  }
];

export function AppNav() {
  const pathname = usePathname();

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    if (href === "/areas") return pathname === "/areas";
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <nav className="nav" aria-label="Navegação principal">
      {GROUPS.map((group) => (
        <div className="nav-group" key={group.label}>
          <span className="nav-group-label">{group.label}</span>
          <div className="nav-group-links">
            {group.links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={isActive(link.href) ? "nav-link active" : "nav-link"}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

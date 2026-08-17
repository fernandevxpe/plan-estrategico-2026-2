"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { exigeAdmin, type Perfil } from "@/lib/auth/perfis";

/**
 * Agrupado por pergunta que o gestor está fazendo, não por módulo técnico.
 */
const GROUPS = [
  {
    label: "Como estamos",
    links: [
      { href: "/", label: "Resumo" },
      { href: "/comercial", label: "Comercial" },
      { href: "/financeiro", label: "Financeiro" }
    ]
  },
  {
    label: "Para onde vamos",
    links: [
      { href: "/planejamento", label: "Planejamento" },
      { href: "/financeiro/fluxo", label: "Caixa futuro" },
      { href: "/metas", label: "Plano de ação" },
      { href: "/mix", label: "Serviços" }
    ]
  },
  {
    label: "Onde agir",
    links: [
      { href: "/areas/vendas", label: "Vendas" },
      { href: "/areas", label: "Áreas" },
      { href: "/gestao-xpe", label: "Gestão XPE" }
    ]
  },
  {
    // O único grupo que o time usa para ESCREVER. Ele fica por último porque é
    // o menos frequente para quem administra, e primeiro no celular — a ordem
    // do CSS inverte no viewport estreito, que é onde a pessoa do time está
    // quando fotografa o cupom.
    label: "O que eu mando",
    links: [
      { href: "/time", label: "Meus envios" },
      { href: "/notificacoes", label: "Avisos" },
      { href: "/financeiro/time", label: "Fila do time" }
    ]
  }
];

export function AppNav({ perfil = "admin" }: { perfil?: Perfil }) {
  const pathname = usePathname();

  // Esconder o link é conveniência, não proteção: quem digitar a URL na mão
  // leva 404 do middleware. Sem isto, o time de vendas veria "Financeiro" no
  // menu e clicaria em algo que não abre — atrito diário por nada.
  const grupos = GROUPS.map((g) => ({
    ...g,
    links: g.links.filter((l) => perfil === "admin" || !exigeAdmin(l.href))
  })).filter((g) => g.links.length > 0);

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    if (href === "/areas") return pathname === "/areas";
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <nav className="nav" aria-label="Navegação principal">
      {grupos.map((group) => (
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

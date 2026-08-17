"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { exigeAdmin, type Perfil } from "@/lib/auth/perfis";
import { SECOES, secaoAtiva } from "@/lib/nav/mapa";

/**
 * O menu de cima: seis lugares, um por assunto.
 *
 * Ele NÃO lista rotas — lista seções. As rotas de dentro de cada seção
 * aparecem na sub-barra (`Trilha`) ou, no caso do financeiro, na barra lateral
 * do próprio módulo. Era a ausência dessa fronteira que punha
 * `/financeiro/fluxo` e `/financeiro/time` aqui em cima, como irmãos de
 * `/financeiro`: filho e pai no mesmo nível.
 *
 * A fonte dos nomes é `lib/nav/mapa.ts`, a mesma da barra lateral e da trilha.
 */
export function AppNav({ perfil = "admin" }: { perfil?: Perfil }) {
  const pathname = usePathname();
  const atual = secaoAtiva(pathname);

  // Esconder o link é conveniência, não proteção: quem digitar a URL na mão
  // leva 404 do middleware. Sem isto, o time de vendas veria "Financeiro" no
  // menu e clicaria em algo que não abre — atrito diário por nada.
  const secoes = SECOES.filter((s) => perfil === "admin" || !exigeAdmin(s.href));

  return (
    <nav className="nav" aria-label="Navegação principal">
      {secoes.map((secao) => {
        const ativa = atual?.label === secao.label;
        return (
          <Link
            key={secao.href}
            href={secao.href}
            className={ativa ? "nav-link active" : "nav-link"}
            aria-current={ativa ? "page" : undefined}
          >
            {secao.label}
          </Link>
        );
      })}
    </nav>
  );
}

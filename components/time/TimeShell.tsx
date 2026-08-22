"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * A navegação do app do time.
 *
 * ---------------------------------------------------------------------------
 * POR QUE BARRA INFERIOR, E NÃO ABAS NO TOPO
 * ---------------------------------------------------------------------------
 * Eram sete abas em linha, e num aparelho de 393px elas quebravam em TRÊS
 * linhas — 210px de navegação antes de qualquer conteúdo, numa tela de 852px.
 * Um quarto do aparelho gasto em menu.
 *
 * Pior que o espaço: as sete apareciam com o mesmo peso, então "Início" e
 * "Meu reembolso" competiam com "Lançar custo", que é o que a pessoa abre o app
 * para fazer. Lista plana não tem hierarquia, e sem hierarquia todo mundo lê
 * tudo toda vez.
 *
 * Barra inferior com QUATRO destinos, e a razão de serem quatro: é o que cabe
 * com alvo de 44px numa tela estreita sem virar ícone mudo. O que sobra vai
 * para "Mais" — não por descaso, mas porque são as coisas que se faz uma vez
 * por mês, não a cada compra.
 *
 * E fica embaixo porque é onde o polegar alcança. O topo de um celular grande
 * exige a segunda mão, e este app é usado com uma mão só, no meio da rua, com
 * a outra segurando a nota.
 */

const PRINCIPAIS = [
  { href: "/time/custo", rotulo: "Custo", icone: "seta-baixo" },
  { href: "/time/reembolso", rotulo: "Reembolso", icone: "volta" },
  { href: "/time/comprar", rotulo: "Comprar", icone: "sacola" },
  { href: "/time/envios", rotulo: "Enviados", icone: "lista" }
] as const;

const SECUNDARIOS = [
  { href: "/time", rotulo: "Início" },
  { href: "/time/nota", rotulo: "Enviar nota" },
  { href: "/time/compra", rotulo: "Pedir compra" },
  { href: "/time/meu-reembolso", rotulo: "Meu reembolso" }
] as const;

/** Traço simples, 2px, `currentColor` — o ícone acompanha o estado do item. */
function Icone({ nome }: { nome: string }) {
  const comum = {
    width: 21,
    height: 21,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true
  };
  if (nome === "seta-baixo")
    return (
      <svg {...comum}>
        <path d="M12 4v13M6.5 11.5 12 17l5.5-5.5M5 20h14" />
      </svg>
    );
  if (nome === "volta")
    return (
      <svg {...comum}>
        <path d="M9 7 4 12l5 5M4 12h10a6 6 0 0 1 6 6v2" />
      </svg>
    );
  if (nome === "sacola")
    return (
      <svg {...comum}>
        <path d="M5 8h14l-1 12H6L5 8ZM9 8V6a3 3 0 0 1 6 0v2" />
      </svg>
    );
  return (
    <svg {...comum}>
      <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
    </svg>
  );
}

export function TimeShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Comparação por SEGMENTO, não `startsWith` cru: com o prefixo,
  // `/time/meu-reembolso` acendia a aba `/time/reembolso` junto — duas ativas
  // ao mesmo tempo. Mesmo cuidado que `lib/auth/perfis.ts` toma com
  // `/financeiro` × `/financeiro-publico`.
  const ativo = (href: string) =>
    href === "/time" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  const secundarioAtivo = SECUNDARIOS.find((s) => ativo(s.href));

  return (
    <div className="time-shell">
      <div className="time-conteudo">{children}</div>

      <nav className="time-barra" aria-label="Seções do app">
        {PRINCIPAIS.map((t) => (
          <Link key={t.href} href={t.href} className={ativo(t.href) ? "time-item ativo" : "time-item"}>
            <Icone nome={t.icone} />
            <span>{t.rotulo}</span>
          </Link>
        ))}

        {/*
          `details` em vez de estado no React: abre e fecha sem JavaScript, sem
          hidratação e sem o piscar de um menu que aparece depois que a página
          já pintou.
        */}
        <details className="time-mais">
          <summary className={secundarioAtivo ? "time-item ativo" : "time-item"}>
            <svg width={21} height={21} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <circle cx="5" cy="12" r="1.9" />
              <circle cx="12" cy="12" r="1.9" />
              <circle cx="19" cy="12" r="1.9" />
            </svg>
            <span>{secundarioAtivo ? secundarioAtivo.rotulo.split(" ")[0] : "Mais"}</span>
          </summary>
          <div className="time-mais-lista">
            {SECUNDARIOS.map((t) => (
              <Link key={t.href} href={t.href} className={ativo(t.href) ? "time-mais-item ativo" : "time-mais-item"}>
                {t.rotulo}
              </Link>
            ))}
          </div>
        </details>
      </nav>
    </div>
  );
}

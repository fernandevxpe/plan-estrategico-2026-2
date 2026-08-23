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
 * Cinco destinos na ordem de uso: solicitar compra, registrar custo, resumo
 * (Principal), reembolso e histórico. Principal fica no centro — é o hub, não
 * a ação mais frequente.
 *
 * E fica embaixo porque é onde o polegar alcança. O topo de um celular grande
 * exige a segunda mão, e este app é usado com uma mão só, no meio da rua, com
 * a outra segurando a nota.
 */

/*
 * A casa que "Solicitar" desocupou vai para Recebíveis, e só ela muda.
 *
 * `fin_purchase_request` tem ZERO linhas desde que existe: "Solicitar" ocupava
 * 20% da barra e nunca produziu um registro. Não é pouco usado — é zero. Ele
 * sobe para o cabeçalho, que é onde ação rara pertence.
 *
 * Recebíveis entra porque é a única tela com conteúdo para TODO MUNDO no dia 1:
 * 449 pagamentos, 28 de 28 pessoas, 8 meses. Nenhuma pessoa abre e vê vazio.
 *
 * As outras quatro ficam no mesmo pixel de propósito. Quem já usa não reaprende
 * nada, e a barra já mudou duas vezes (7 abas no topo → 4 + "Mais" → 5 fixas) —
 * a terceira mudança tem de ser a menor possível.
 */
const PRINCIPAIS = [
  { href: "/time/recebiveis", rotulo: "Recebíveis", icone: "entrada" },
  { href: "/time/custo", rotulo: "Registrar", icone: "seta-baixo" },
  // "Início", não "Principal": a tela se chama Início no H1 e no título da
  // página. Duas palavras para o mesmo destino faz a pessoa procurar a
  // terceira.
  { href: "/time", rotulo: "Início", icone: "casa" },
  { href: "/time/reembolso", rotulo: "Reembolso", icone: "volta" },
  { href: "/time/envios", rotulo: "Histórico", icone: "lista" }
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
  if (nome === "entrada")
    return (
      <svg {...comum}>
        <path d="M12 20V7M6.5 12.5 12 7l5.5 5.5M5 4h14" />
      </svg>
    );
  if (nome === "casa")
    return (
      <svg {...comum}>
        <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z" />
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
      </nav>
    </div>
  );
}

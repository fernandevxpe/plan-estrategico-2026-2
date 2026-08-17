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
  // Painel primeiro: é a tela de abertura de quem decide.
  { href: "/financeiro/painel", label: "Painel" },
  { href: "/financeiro", label: "Visão geral" },
  { href: "/financeiro/lancamentos", label: "Lançamentos" },
  // Antes de Receitas e do Fluxo de propósito: a agenda é a pergunta diária
  // ("o que vence hoje, o que venceu e não veio"), e as outras duas são a
  // leitura agregada dela. Quem abre o financeiro de manhã abre esta.
  { href: "/financeiro/agenda", label: "Agenda" },
  { href: "/financeiro/receitas", label: "Receitas" },
  // Logo depois de Receitas: é o outro lado da mesma pergunta do mês ("o que
  // entra, o que sai") e antes do Fluxo, que é a leitura agregada das duas.
  { href: "/financeiro/custos", label: "Custos do mês" },
  { href: "/financeiro/fluxo", label: "Fluxo de caixa" },
  { href: "/financeiro/modelo", label: "Modelo de gestão" },
  { href: "/financeiro/planejamento", label: "Planejamento" },
  { href: "/financeiro/contas", label: "Contas" },
  // Ao lado de Reembolsos porque as duas respondem à mesma pergunta — quanto
  // custa o time — e quem vai a uma costuma precisar da outra.
  { href: "/financeiro/pessoas", label: "Pessoas" },
  // Logo depois de Pessoas: é a mesma população vista pelo limite dela. Quem
  // olha quanto o time custa precisa saber, na mesma sessão, que um prestador
  // está a menos de meio mês de estourar o teto do próprio CNPJ — e essa
  // consequência é dele, não da folha.
  { href: "/financeiro/mei", label: "Teto do MEI" },
  { href: "/financeiro/reembolsos", label: "Reembolsos" },
  // Ao lado de Reembolsos pelo mesmo motivo: é a caixa de entrada do que o time
  // manda, e reembolso é o que ele mais manda.
  { href: "/financeiro/time", label: "Fila do time" },
  { href: "/financeiro/qualificar", label: "Qualificar" },
  // Ao lado de Qualificar e Revisão porque as três respondem à mesma pergunta
  // — "onde isto entra?" — em graus diferentes de dúvida. A diferença é o
  // alcance: Qualificar e Revisão só veem `fin_transaction` e `fin_document`;
  // esta é a única que enxerga também o subledger do cartão, onde 500 itens
  // (R$ 54.126,76) não aparecem em indicador nenhum.
  { href: "/financeiro/categorizacao", label: "Categorização" },
  { href: "/financeiro/revisao", label: "Revisão" },
  { href: "/financeiro/indicadores", label: "Indicadores" },
  { href: "/financeiro/regras", label: "Regras" },
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

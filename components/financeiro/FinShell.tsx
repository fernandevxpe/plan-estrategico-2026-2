"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { FINANCEIRO_GRUPOS, financeiroAtivo, rotaAtiva, type Rota } from "@/lib/nav/mapa";

/**
 * A barra lateral do módulo financeiro.
 *
 * O QUE ELA SUBSTITUI
 *
 * Uma fila única de 23 abas, em ordem de chegada, quebrando em três linhas.
 * Uma fila é uma boa navegação até ~7 itens; depois disso ela deixa de ser
 * navegação e vira busca visual — o usuário lê a barra inteira toda vez, e o
 * custo de achar uma tela passa a crescer com o número de telas que ele NÃO
 * quer. Foi assim que `/financeiro/resultado` (a DRE) ficou de fora do menu
 * sem ninguém notar: numa fila de 23, o 24º item não tem lugar óbvio.
 *
 * Seis grupos, e o da página aberta é o único expandido. Quem está em "Custos
 * do mês" vê quatro itens de PAGAR e cinco rótulos de grupo — nove linhas em
 * vez de vinte e três — sem perder o mapa do resto.
 *
 * `<details>`/`<summary>` em vez de estado próprio: recolher e expandir é
 * comportamento nativo do HTML, com teclado e leitor de tela já resolvidos. O
 * `open` inicial vem da rota; se o usuário abrir outro grupo à mão, ele fica
 * aberto — a escolha explícita dele vence a nossa.
 *
 * NOMES
 *
 * Nenhum rótulo mora aqui. Todos vêm de `lib/nav/mapa.ts`, o mesmo arquivo que
 * alimenta o menu de cima e a trilha, para que uma rota não possa ter dois
 * nomes na mesma plataforma.
 */
export function FinShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [gavetaAberta, setGavetaAberta] = useState(false);
  const atual = financeiroAtivo(pathname);
  // `/financeiro` (a visão geral) não pertence a grupo nenhum. Deixar os seis
  // fechados ali entregaria, na porta do módulo, seis rótulos e nenhuma tela —
  // o primeiro grupo aberto dá um lugar por onde começar.
  const grupoAberto = atual?.grupo.label ?? FINANCEIRO_GRUPOS[0]?.label;

  // Navegou, fecha. Sem isto a gaveta continua por cima da tela que o usuário
  // acabou de pedir, e ele tem de fechá-la para ver o que clicou.
  useEffect(() => setGavetaAberta(false), [pathname]);

  useEffect(() => {
    if (!gavetaAberta) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") setGavetaAberta(false);
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [gavetaAberta]);

  return (
    <div className="fin-layout">
      {/* Só existe em tela estreita (CSS). Em tela larga a barra está sempre
          visível e um botão para abri-la seria um clique para nada. */}
      <button
        type="button"
        className="fin-nav-abrir"
        aria-expanded={gavetaAberta}
        aria-controls="fin-nav"
        onClick={() => setGavetaAberta(true)}
      >
        Seções do financeiro
      </button>

      {gavetaAberta ? (
        <button
          type="button"
          className="fin-nav-fundo"
          aria-label="Fechar as seções do financeiro"
          onClick={() => setGavetaAberta(false)}
        />
      ) : null}

      <nav
        id="fin-nav"
        className={gavetaAberta ? "fin-nav aberta" : "fin-nav"}
        aria-label="Seções do financeiro"
      >
        {FINANCEIRO_GRUPOS.map((grupo) => (
          <details key={grupo.label} className="fin-nav-grupo" open={grupoAberto === grupo.label}>
            <summary>{grupo.label}</summary>
            <div className="fin-nav-itens">
              {grupo.rotas.map((rota) => (
                <ItemDeRota key={rota.href} rota={rota} pathname={pathname} />
              ))}
            </div>
          </details>
        ))}
      </nav>

      {/* `fin-shell` continua sendo a coluna de conteúdo: o espaçamento de 18px
          entre os blocos das telas depende dela, e o app do time reusa a mesma
          classe. Trocar o significado dela aqui quebraria `/time` sem aviso. */}
      <div className="fin-shell">{children}</div>
    </div>
  );
}

function ItemDeRota({ rota, pathname }: { rota: Rota; pathname: string }) {
  const ativa = rotaAtiva(rota.href, pathname);
  const filhoAtivo = rota.filhos?.some((f) => rotaAtiva(f.href, pathname)) ?? false;

  return (
    <>
      <Link
        href={rota.href}
        className={ativa ? "fin-nav-item active" : "fin-nav-item"}
        aria-current={ativa ? "page" : undefined}
      >
        {rota.label}
      </Link>
      {/* As telas irmãs só aparecem quando a conversa já é essa. Categorização,
          Qualificar e Revisão são três telas para a mesma pergunta ("onde isto
          entra?") e a fusão delas é etapa posterior; até lá, o menu mostra uma
          porta e as outras duas ficam a um clique de quem está classificando. */}
      {rota.filhos && (ativa || filhoAtivo) ? (
        <div className="fin-nav-filhos">
          {rota.filhos.map((filho) => {
            const aberto = rotaAtiva(filho.href, pathname);
            return (
              <Link
                key={filho.href}
                href={filho.href}
                className={aberto ? "fin-nav-item filho active" : "fin-nav-item filho"}
                aria-current={aberto ? "page" : undefined}
              >
                {filho.label}
              </Link>
            );
          })}
        </div>
      ) : null}
    </>
  );
}

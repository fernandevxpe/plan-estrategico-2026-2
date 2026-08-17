"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { rotaAtiva, resolverTrilha, secaoAtiva } from "@/lib/nav/mapa";

/**
 * A segunda linha do cabeçalho: onde você está, e o que mais tem por perto.
 *
 * DUAS COISAS, E POR QUE NÃO SÃO A MESMA
 *
 * À esquerda, a TRILHA — `Financeiro › Caixa › Agenda`. Ela responde "onde
 * estou". Numa tela estreita, onde a barra lateral do financeiro vira gaveta
 * fechada, a trilha é a ÚNICA coisa que responde isso; é ali que ela deixa de
 * ser enfeite.
 *
 * À direita, as ROTAS IRMÃS da seção. Elas respondem "o que mais existe aqui".
 * O financeiro não aparece à direita de propósito: são 23 telas, e elas têm
 * barra lateral própria. Uma seção com duas ou três rotas não merece barra
 * lateral; uma com 23 não cabe numa linha.
 *
 * Não filtra por perfil, e não precisa: as únicas rotas protegidas são
 * `/financeiro/*`, e elas nunca entram na lista da direita — o perfil comum
 * leva 404 do middleware antes de qualquer tela renderizar.
 */
export function Trilha() {
  const pathname = usePathname();
  const secao = secaoAtiva(pathname);
  const migalhas = resolverTrilha(pathname);

  // O financeiro tem barra lateral; a seção de uma rota só não tem irmãs.
  const irmas = secao && !secao.prefixo && secao.rotas.length > 1 ? secao.rotas : [];

  // Uma migalha só é a raiz: dizer "Resumo" em cima de uma página que já se
  // chama Resumo é ocupar uma linha inteira para não informar nada.
  if (migalhas.length < 2 && irmas.length === 0) return null;

  return (
    <div className="subbar">
      <div className="subbar-inner">
        <nav className="trilha-nav" aria-label="Trilha de navegação">
          <ol>
            {migalhas.map((migalha, i) => {
              const ultima = i === migalhas.length - 1;
              return (
                <li key={`${migalha.label}-${i}`}>
                  {migalha.href && !ultima ? (
                    <Link href={migalha.href}>{migalha.label}</Link>
                  ) : (
                    // A última migalha nunca é link: é a página aberta, e um
                    // link para onde você já está é um botão que não faz nada.
                    <span aria-current={ultima ? "page" : undefined}>{migalha.label}</span>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>

        {irmas.length > 0 ? (
          <nav className="subnav" aria-label={`Telas de ${secao?.label}`}>
            {irmas.map((rota) => {
              const ativa = rotaAtiva(rota.href, pathname);
              return (
                <Link
                  key={rota.href}
                  href={rota.href}
                  className={ativa ? "subnav-link active" : "subnav-link"}
                  aria-current={ativa ? "page" : undefined}
                >
                  {rota.label}
                </Link>
              );
            })}
          </nav>
        ) : null}
      </div>
    </div>
  );
}

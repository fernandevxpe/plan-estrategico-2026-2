"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileDown, Image as IconeImagem, Printer, Sheet, Table2, X } from "lucide-react";

import { nomeDeArquivo, baixarBlob, graficoParaPng } from "@/lib/exportar/grafico-png";
import { hojeEmTexto, nomeDaTela, varrerPagina, type Alvo } from "@/lib/exportar/alvos";
import { imprimirPagina } from "@/lib/exportar/imprimir";
import {
  LIMITE_LINHAS_AVISO,
  blobDePdf,
  csvDeUmAlvo,
  descrever,
  pdfDaPagina,
  pdfDeUmAlvo,
  type ResumoAlvo
} from "@/lib/exportar/pagina";

/**
 * EXPORTAR — um botão só, no `body`, para as 59 telas.
 *
 * Mesmo desenho e mesmo motivo do `ThemeToggle` (`components/layout/
 * ThemeToggle.tsx`): flutuante, montado uma vez em `app/layout.tsx`, fora do
 * `AppShell`. Assim nenhuma tela precisa lembrar de incluí-lo, e ele não some
 * numa tela nova — que é exatamente o pedido ("todas as páginas, todos os
 * gráficos"). Ficar fora do `AppShell` também é o que faz o app do time, que
 * tem casco próprio, ganhar exportação sem uma linha lá dentro.
 *
 * A LISTA É MONTADA NO CLIQUE, nunca na montagem do componente. Varrer o DOM
 * ao montar custaria em toda navegação; e um `MutationObserver` vivo em cima de
 * `FinContasAPagar` — 2.969 linhas, com tabela aninhada por lançamento —
 * dispararia a cada checkbox marcado.
 */

type Estado = { fase: "parado" } | { fase: "trabalhando"; oque: string } | { fase: "aviso"; texto: string };

export function BotaoExportar() {
  const [aberto, setAberto] = useState(false);
  const [alvos, setAlvos] = useState<Alvo[]>([]);
  const [resumos, setResumos] = useState<ResumoAlvo[]>([]);
  const [estado, setEstado] = useState<Estado>({ fase: "parado" });
  const painelRef = useRef<HTMLDivElement>(null);

  const fechar = useCallback(() => {
    setAberto(false);
    setEstado({ fase: "parado" });
  }, []);

  useEffect(() => {
    if (!aberto) return;
    function naTecla(e: KeyboardEvent) {
      if (e.key === "Escape") fechar();
    }
    function noClique(e: MouseEvent) {
      const alvo = e.target as Node;
      if (painelRef.current && !painelRef.current.contains(alvo)) fechar();
    }
    document.addEventListener("keydown", naTecla);
    // `capture` porque a tela embaixo pode parar a propagação do clique.
    document.addEventListener("mousedown", noClique, true);
    return () => {
      document.removeEventListener("keydown", naTecla);
      document.removeEventListener("mousedown", noClique, true);
    };
  }, [aberto, fechar]);

  function abrir() {
    const achados = varrerPagina();
    setAlvos(achados);
    setResumos(achados.map((alvo, i) => descrever(alvo, i)));
    setAberto(true);
    setEstado({ fase: "parado" });
  }

  /**
   * Toda exportação passa por aqui.
   *
   * O `await` de um quadro antes de trabalhar não é enfeite: montar o PDF de
   * uma tabela grande segura a thread, e sem esse respiro o React não chega a
   * pintar "gerando…" — a tela congela sem dizer por quê, que é o defeito que
   * o `window.print()` desta casa tinha.
   */
  async function trabalhar(oque: string, tarefa: () => Promise<void>) {
    setEstado({ fase: "trabalhando", oque });
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    try {
      await tarefa();
      setEstado({ fase: "parado" });
      setAberto(false);
    } catch (erro) {
      // Falha de exportação nunca derruba a tela: o dado continua lá, e a
      // pessoa precisa saber que o arquivo não saiu.
      console.error("exportar:", erro);
      setEstado({ fase: "aviso", texto: erro instanceof Error ? erro.message : "não consegui gerar o arquivo" });
    }
  }

  const tabelas = alvos.filter((a) => a.tipo === "tabela").length;
  const graficos = alvos.length - tabelas;
  const linhasTotais = resumos.reduce((soma, r) => {
    const n = Number(/^(\d+)/.exec(r.detalhe)?.[1] ?? 0);
    return soma + n;
  }, 0);

  return (
    <>
      <button
        type="button"
        className="exportar-flutuante"
        onClick={() => (aberto ? fechar() : abrir())}
        aria-expanded={aberto}
        aria-haspopup="dialog"
        title="Exportar esta tela"
      >
        <FileDown size={18} strokeWidth={2.1} aria-hidden />
        <span className="exportar-flutuante-rotulo">Exportar</span>
      </button>

      {aberto ? (
        <div className="exportar-painel" ref={painelRef} role="dialog" aria-label="Exportar desta tela" data-exportar="ignorar">
          <header className="exportar-painel-topo">
            <div>
              <strong>Exportar</strong>
              <span>{nomeDaTela()}</span>
            </div>
            <button type="button" onClick={fechar} aria-label="Fechar">
              <X size={15} strokeWidth={2.2} aria-hidden />
            </button>
          </header>

          {/*
            IMPRIMIR fica FORA da condição de "achou alvos", e isso é de
            propósito: uma tela sem tabela e sem gráfico — a Visão geral, o app
            do time — continua sendo uma tela que a pessoa quer no papel. Se
            este botão morasse junto da lista, essas telas ficariam sem saída
            nenhuma, que é justamente o buraco que "todas as páginas" fecha.

            As duas saídas respondem perguntas diferentes e por isso convivem:
            o PDF do dado pagina e alinha a tabela; a impressão devolve a tela
            com a cara dela, com os cartões e os KPIs no lugar.
          */}
          <button
            type="button"
            className="exportar-tudo exportar-imprimir"
            onClick={() =>
              trabalhar("a impressão da página", async () => {
                await imprimirPagina({ titulo: nomeDaTela(), quando: hojeEmTexto() });
              })
            }
          >
            <Printer size={15} strokeWidth={2.2} aria-hidden />
            <span>
              Imprimir a página
              <em>o PDF do navegador, com a cara da tela</em>
            </span>
          </button>

          {alvos.length === 0 ? (
            <p className="exportar-vazio">
              Sem tabela nem gráfico visível aqui para virar dado — mas "Imprimir a página" acima continua valendo. Se
              houver filtro escondendo tudo, limpe o filtro e tente de novo.
            </p>
          ) : (
            <>
              <button
                type="button"
                className="exportar-tudo"
                onClick={() =>
                  trabalhar("a página inteira", async () => {
                    const bytes = await pdfDaPagina(alvos);
                    baixarBlob(blobDePdf(bytes), nomeDeArquivo(nomeDaTela(), "pdf"));
                  })
                }
              >
                <FileDown size={15} strokeWidth={2.2} aria-hidden />
                <span>
                  Página inteira em PDF
                  <em>
                    {[
                      tabelas ? `${tabelas} ${tabelas === 1 ? "tabela" : "tabelas"}` : "",
                      graficos ? `${graficos} ${graficos === 1 ? "gráfico" : "gráficos"}` : ""
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </em>
                </span>
              </button>

              {linhasTotais > LIMITE_LINHAS_AVISO ? (
                <p className="exportar-aviso">
                  São {linhasTotais.toLocaleString("pt-BR")} linhas nesta tela — o PDF sai com dezenas de páginas e leva
                  alguns segundos.
                </p>
              ) : null}

              <ul className="exportar-lista">
                {alvos.map((alvo, i) => (
                  <li key={`${alvo.tipo}-${i}`}>
                    <span className="exportar-item-nome">
                      {alvo.tipo === "tabela" ? (
                        <Table2 size={13} strokeWidth={2.2} aria-hidden />
                      ) : (
                        <IconeImagem size={13} strokeWidth={2.2} aria-hidden />
                      )}
                      <span>
                        {resumos[i]?.titulo || (alvo.tipo === "tabela" ? "Tabela" : "Gráfico")}
                        <em>{resumos[i]?.detalhe}</em>
                      </span>
                    </span>
                    <span className="exportar-item-acoes">
                      <button
                        type="button"
                        title={alvo.tipo === "tabela" ? "Baixar esta tabela em PDF" : "Baixar este gráfico em PDF"}
                        onClick={() =>
                          trabalhar(resumos[i]?.titulo ?? "o item", async () => {
                            const bytes = await pdfDeUmAlvo(alvo, i);
                            if (!bytes) throw new Error("este item ficou vazio na hora de exportar");
                            baixarBlob(blobDePdf(bytes), nomeDeArquivo(resumos[i]?.titulo ?? "xpe", "pdf"));
                          })
                        }
                      >
                        PDF
                      </button>
                      {alvo.tipo === "tabela" ? (
                        <button
                          type="button"
                          title="Baixar em CSV para abrir no Excel"
                          onClick={() =>
                            trabalhar(resumos[i]?.titulo ?? "o item", async () => {
                              const csv = csvDeUmAlvo(alvo, i);
                              baixarBlob(
                                new Blob([csv], { type: "text/csv;charset=utf-8" }),
                                nomeDeArquivo(resumos[i]?.titulo ?? "xpe", "csv")
                              );
                            })
                          }
                        >
                          <Sheet size={13} strokeWidth={2.2} aria-hidden />
                          CSV
                        </button>
                      ) : (
                        <button
                          type="button"
                          title="Baixar a imagem do gráfico"
                          onClick={() =>
                            trabalhar(resumos[i]?.titulo ?? "o gráfico", async () => {
                              const blob = await graficoParaPng(alvo.elemento);
                              if (!blob) throw new Error("não achei o desenho deste gráfico");
                              baixarBlob(blob, nomeDeArquivo(resumos[i]?.titulo ?? "grafico", "png"));
                            })
                          }
                        >
                          PNG
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {estado.fase === "trabalhando" ? (
            <p className="exportar-estado" aria-live="polite">
              Gerando {estado.oque}…
            </p>
          ) : null}
          {estado.fase === "aviso" ? (
            <p className="exportar-estado exportar-estado-erro" aria-live="assertive">
              {estado.texto}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

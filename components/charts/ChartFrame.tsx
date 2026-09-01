"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { baixarBlob, graficoParaPng, nomeDeArquivo } from "@/lib/exportar/grafico-png";

/**
 * Moldura reutilizável para qualquer gráfico Recharts: tela cheia, zoom,
 * baixar como PNG, compartilhar. Nenhum dos 26 gráficos da plataforma tinha
 * isto — só existia `useLegendToggle` (esconder/mostrar série).
 *
 * Não sabe nada de Recharts por dentro — funciona em cima do SVG que
 * qualquer `<ResponsiveContainer>` já desenha, então plugar aqui é embrulhar
 * o gráfico existente, não reescrevê-lo.
 *
 * Zoom é CSS transform: scroll/roda ou os botões, com "voltar" resetando
 * pra 100%. Não é zoom de dado (não refaz eixo/escala) — é aumentar a
 * leitura de um gráfico denso, que é o que "abrir zoom" pediu.
 */
export function ChartFrame({ titulo, children }: { titulo: string; children: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgHostRef = useRef<HTMLDivElement>(null);
  const [telaCheia, setTelaCheia] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    function onFsChange() {
      setTelaCheia(document.fullscreenElement === containerRef.current);
    }
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setStatus(null), 2400);
    return () => clearTimeout(t);
  }, [status]);

  function alternarTelaCheia() {
    if (!containerRef.current) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else containerRef.current.requestFullscreen?.().catch(() => {});
  }

  function zoomIn() {
    setZoom((z) => Math.min(2.5, Math.round((z + 0.25) * 100) / 100));
  }
  function zoomOut() {
    setZoom((z) => Math.max(0.5, Math.round((z - 0.25) * 100) / 100));
  }
  function voltarZoom() {
    setZoom(1);
  }

  /*
   * O desenho do PNG mora em `lib/exportar/grafico-png.ts`, não mais aqui.
   *
   * A versão que ficava neste arquivo tinha dois furos, os dois invisíveis até
   * alguém abrir a imagem baixada:
   *
   * 1. A LEGENDA NÃO ENTRAVA. `<Legend>` do recharts não é SVG — é uma `<ul>`
   *    de HTML em `.recharts-legend-wrapper`, irmã do `<svg>`. O
   *    `querySelector("svg")` daqui a deixava de fora, e os 8 arquivos que usam
   *    legenda baixavam um gráfico com as séries coloridas e nada dizendo qual
   *    era qual.
   * 2. COR VINDA DE CSS SUMIA. O SVG serializado vira documento isolado dentro
   *    do `<img>` e não enxerga `app/globals.css`. `chartTheme` é hex literal e
   *    sobrevivia; `.fin-cartao-an` (globals.css:25150), `.fin-cartao-topo-faixa`
   *    (:22258) e `.funnel-stage-chart` (:3110) pintam por classe e saíam sem
   *    cor — junto com todo `color-mix()`, usado em 136 lugares do CSS.
   *
   * Compartilhar o módulo é o que faz o conserto valer para os 19 arquivos que
   * usam esta moldura de uma vez, e para o painel de exportar da tela também.
   */
  async function pegarPng(): Promise<Blob | null> {
    if (!svgHostRef.current) return null;
    return await graficoParaPng(svgHostRef.current);
  }

  function nomeArquivo() {
    return nomeDeArquivo(titulo, "png");
  }

  async function baixarPng() {
    const blob = await pegarPng();
    if (!blob) {
      setStatus("não achei o gráfico pra exportar");
      return;
    }
    baixarBlob(blob, nomeArquivo());
  }

  async function compartilhar() {
    const blob = await pegarPng();
    if (!blob) {
      setStatus("não achei o gráfico pra compartilhar");
      return;
    }
    const arquivo = new File([blob], nomeArquivo(), { type: "image/png" });
    const nav = navigator as Navigator & {
      share?: (data: ShareData) => Promise<void>;
      canShare?: (data: ShareData) => boolean;
    };
    if (nav.share && (!nav.canShare || nav.canShare({ files: [arquivo] }))) {
      try {
        await nav.share({ files: [arquivo], title: titulo });
        return;
      } catch {
        // usuário cancelou o share nativo — cai pro download como saída segura
      }
    }
    await baixarPng();
    setStatus("compartilhamento direto não é suportado aqui — baixei o PNG");
  }

  return (
    <div ref={containerRef} className={`chart-frame${telaCheia ? " chart-frame-tela-cheia" : ""}`}>
      <div className="chart-frame-barra">
        <span className="chart-frame-titulo">{titulo}</span>
        <div className="chart-frame-acoes">
          <button type="button" onClick={zoomOut} title="Diminuir zoom" aria-label="Diminuir zoom" disabled={zoom <= 0.5}>
            −
          </button>
          <span className="chart-frame-zoom-valor">{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={zoomIn} title="Aumentar zoom" aria-label="Aumentar zoom" disabled={zoom >= 2.5}>
            +
          </button>
          {zoom !== 1 && (
            <button type="button" onClick={voltarZoom} title="Voltar ao normal" aria-label="Voltar ao normal">
              ↺
            </button>
          )}
          <span className="chart-frame-divisor" aria-hidden="true" />
          <button type="button" onClick={baixarPng} title="Baixar PNG" aria-label="Baixar como imagem">
            ⬇
          </button>
          <button type="button" onClick={compartilhar} title="Compartilhar" aria-label="Compartilhar gráfico">
            ⇪
          </button>
          <button
            type="button"
            onClick={alternarTelaCheia}
            title={telaCheia ? "Sair da tela cheia" : "Tela cheia"}
            aria-label={telaCheia ? "Sair da tela cheia" : "Ver em tela cheia"}
          >
            {telaCheia ? "⤡" : "⤢"}
          </button>
        </div>
      </div>
      {status && (
        <p className="chart-frame-status" aria-live="polite">
          {status}
        </p>
      )}
      <div className="chart-frame-viewport">
        <div ref={svgHostRef} className="chart-frame-conteudo" style={{ transform: `scale(${zoom})` }}>
          {children}
        </div>
      </div>
    </div>
  );
}

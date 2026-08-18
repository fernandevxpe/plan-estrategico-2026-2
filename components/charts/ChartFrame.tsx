"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

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

  async function pegarPng(): Promise<Blob | null> {
    const svg = svgHostRef.current?.querySelector("svg");
    if (!svg) return null;

    const clone = svg.cloneNode(true) as SVGSVGElement;
    const largura = svg.clientWidth || 800;
    const altura = svg.clientHeight || 420;
    clone.setAttribute("width", String(largura));
    clone.setAttribute("height", String(altura));
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");

    const corFundo = getComputedStyle(document.documentElement).getPropertyValue("--card").trim() || "#ffffff";
    const fundo = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    fundo.setAttribute("width", "100%");
    fundo.setAttribute("height", "100%");
    fundo.setAttribute("fill", corFundo || "#ffffff");
    clone.insertBefore(fundo, clone.firstChild);

    const svgTexto = new XMLSerializer().serializeToString(clone);
    const svgBlob = new Blob([svgTexto], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);

    try {
      const img = new Image();
      const escala = 2; // exporta em 2x pra não sair borrado numa apresentação
      const carregada = new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
      });
      img.src = url;
      await carregada;

      const canvas = document.createElement("canvas");
      canvas.width = largura * escala;
      canvas.height = altura * escala;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.scale(escala, escala);
      ctx.drawImage(img, 0, 0, largura, altura);

      return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function nomeArquivo() {
    const slug = titulo
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    return `${slug || "grafico"}.png`;
  }

  async function baixarPng() {
    const blob = await pegarPng();
    if (!blob) {
      setStatus("não achei o gráfico pra exportar");
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nomeArquivo();
    a.click();
    URL.revokeObjectURL(url);
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

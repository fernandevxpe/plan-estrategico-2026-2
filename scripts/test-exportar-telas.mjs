/**
 * A EXPORTAÇÃO EXERCITADA NAS TELAS REAIS.
 *
 * Os outros dois testes provam as peças: `test-exportar-pdf` prova os bytes do
 * PDF, `test-exportar-tabela` prova a leitura contra um fixture. Nenhum dos
 * dois prova o que interessa no fim — que numa tela DE VERDADE, com o dado do
 * banco e o React já hidratado, a varredura acha as tabelas e os gráficos e o
 * arquivo sai com tamanho de arquivo.
 *
 * Sem dependência nova: o Chrome já está na máquina e o Node 22 tem WebSocket
 * nativo, então dá para falar o protocolo do DevTools direto. O servidor local
 * responde 200 sem Basic Auth (as credenciais só existem no Railway), que é o
 * que torna isto possível aqui e não em produção.
 */

import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const PORTA_CDP = 9333;

const TELAS = [
  { rota: "/financeiro/custos-empresa?aba=contas-a-pagar", nome: "Contas a pagar (a que travava)", minTabelas: 1 },
  { rota: "/financeiro/painel", nome: "Painel do financeiro", minGraficos: 1 },
  { rota: "/financeiro/caixa", nome: "Caixa" },
  { rota: "/financeiro/pessoas", nome: "Pessoas", minTabelas: 1 },
  { rota: "/", nome: "Início" },
  { rota: "/time", nome: "App do time (casco próprio)" }
];

// ── o pacote injetado ───────────────────────────────────────────────────────
const trabalho = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "xpe-telas-"));
execFileSync(
  "npx",
  ["tsc", "lib/exportar/pdf.ts", "lib/exportar/tabela-dom.ts", "lib/exportar/grafico-png.ts",
   "lib/exportar/alvos.ts", "lib/exportar/pagina.ts", "lib/exportar/imprimir.ts",
   "--outDir", trabalho, "--target", "es2020", "--module", "esnext", "--moduleResolution", "bundler", "--skipLibCheck"],
  { stdio: "inherit" }
);

// Os seis módulos viram um escopo só. Concatenar em ordem de dependência e
// tirar import/export é suficiente porque nenhum nome colide entre eles.
const ORDEM = ["pdf.js", "tabela-dom.js", "grafico-png.js", "alvos.js", "pagina.js", "imprimir.js"];
const pacote = ORDEM.map((f) => readFileSync(join(trabalho, f), "utf8"))
  .join("\n")
  .split("\n")
  .filter((l) => !/^\s*import\s/.test(l))
  .map((l) => l.replace(/^\s*export\s+/, ""))
  .join("\n");

// ── protocolo do DevTools ───────────────────────────────────────────────────
const perfil = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "xpe-chrome-"));
const chrome = spawn(
  CHROME,
  ["--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run", "--window-size=1440,2400",
   `--remote-debugging-port=${PORTA_CDP}`, `--user-data-dir=${perfil}`, "about:blank"],
  { stdio: "ignore" }
);

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function esperarCdp() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORTA_CDP}/json/version`);
      if (r.ok) return;
    } catch {}
    await dormir(250);
  }
  throw new Error("o Chrome não abriu a porta de depuração");
}

async function avaliar(ws, expressao, id) {
  return await new Promise((resolve, reject) => {
    const aoResponder = (evento) => {
      const msg = JSON.parse(evento.data);
      if (msg.id !== id) return;
      ws.removeEventListener("message", aoResponder);
      if (msg.result?.exceptionDetails) {
        reject(new Error(msg.result.exceptionDetails.exception?.description ?? "erro na página"));
        return;
      }
      resolve(msg.result?.result?.value);
    };
    ws.addEventListener("message", aoResponder);
    ws.send(JSON.stringify({
      id,
      method: "Runtime.evaluate",
      params: { expression: expressao, awaitPromise: true, returnByValue: true }
    }));
  });
}

let falhas = 0;
function conferir(rotulo, condicao, detalhe = "") {
  if (condicao) console.log(`    ok   ${rotulo}`);
  else {
    falhas++;
    console.log(`    FALHA ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`);
  }
}

try {
  await esperarCdp();
  console.log(`\nExportação nas telas reais — ${BASE}\n`);

  let contador = 1;
  for (const tela of TELAS) {
    const alvo = await (await fetch(`http://127.0.0.1:${PORTA_CDP}/json/new?${encodeURIComponent(BASE + tela.rota)}`, { method: "PUT" })).json();
    const ws = new WebSocket(alvo.webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener("open", r, { once: true }));

    // Duas esperas, e as duas são necessárias.
    //
    // 1. O SERVIDOR. Estas telas são `force-dynamic` e consultam views fundas
    //    do financeiro; `/financeiro/painel` leva 2,5s só para responder.
    // 2. O CLIENTE. `<ResponsiveContainer>` do recharts MEDE o DOM para achar a
    //    largura, então `.recharts-wrapper` não existe antes da hidratação — o
    //    HTML do servidor tem a moldura, não o gráfico. Esperar só o
    //    `readyState` mediu página em branco e reprovou o painel por "0
    //    gráficos" quando ele tem 32 molduras.
    let prontidao = "nada";
    for (let i = 0; i < 100; i++) {
      prontidao = await avaliar(
        ws,
        `(() => {
           if (document.readyState !== 'complete') return 'carregando';
           if (document.querySelector('.recharts-wrapper')) return 'grafico';
           if (document.querySelector('table')) return 'tabela';
           if (document.querySelector('.chart-frame, .chart-box')) return 'moldura-sem-grafico';
           return 'vazio';
         })()`,
        contador++
      );
      if (prontidao === "grafico" || prontidao === "tabela") break;
      await dormir(300);
    }
    // Mais um respiro: numa tela com 32 gráficos, o primeiro aparece bem antes
    // do último.
    await dormir(1500);

    const relatorio = await avaliar(
      ws,
      `(async () => { ${pacote}
        const alvos = varrerPagina();
        const tabelas = alvos.filter(a => a.tipo === "tabela");
        const graficos = alvos.filter(a => a.tipo === "grafico");
        const amostra = tabelas.slice(0, 3).map((a, i) => {
          const d = lerTabela(a, i);
          return { titulo: d.titulo, colunas: d.colunas.length, linhas: d.totalDeDados };
        });
        let bytesPdf = 0, erroPdf = null;
        try { bytesPdf = (await pdfDaPagina(alvos)).length; }
        catch (e) { erroPdf = String(e && e.message || e); }

        // A impressao monta um documento isolado; aqui ele e montado e
        // inspecionado SEM chamar print(), que bloquearia o headless.
        let impressao = null, erroImpressao = null;
        try {
          // O construtor devolve TEXTO agora, entao o teste nao precisa de aba
          // nem de dialogo: DOMParser le o documento e responde as mesmas
          // perguntas. Foi essa mudanca que tirou o print() de dentro do
          // processo da aplicacao.
          const html = montarHtmlDeImpressao({ titulo: nomeDaTela(), quando: hojeEmTexto() });
          const doc = new DOMParser().parseFromString(html, "text/html");
          impressao = {
            nos: doc.getElementsByTagName("*").length,
            folhas: doc.querySelectorAll("link[rel='stylesheet'], style").length,
            tema: doc.documentElement.getAttribute("data-theme"),
            temCabecalho: !!doc.querySelector(".xpe-print-cab"),
            sobrouMenu: doc.querySelectorAll(".topbar, .fin-nav, .theme-toggle, .exportar-flutuante, .subbar").length,
            tabelas: doc.querySelectorAll("table").length,
            detalhesFechados: doc.querySelectorAll("details:not([open])").length,
            // Contra-prova: o clone tem de trazer quase tudo do conteúdo vivo.
            // Só o que foi removido de propósito (menu, topo, flutuantes) pode
            // faltar. Uma queda grande aqui significa clone vazio passando por
            // "montou sem erro".
            nosNaTela: (document.querySelector("#conteudo") ?? document.querySelector("main") ?? document.body).getElementsByTagName("*").length,
            // O papel não pode levar script nenhum.
            scripts: doc.querySelectorAll("script").length,
            temBase: !!doc.querySelector("base[href]")
          };
        } catch (e) { erroImpressao = String(e && e.message || e); }
        return JSON.stringify({
          tela: nomeDaTela(),
          tabelas: tabelas.length, graficos: graficos.length,
          amostra, bytesPdf, erroPdf, impressao, erroImpressao,
          titulosVazios: alvos.filter(a => !a.titulo || !a.titulo.trim()).length
        });
      })()`,
      contador++
    );
    ws.close();
    await fetch(`http://127.0.0.1:${PORTA_CDP}/json/close/${alvo.id}`);

    const r = JSON.parse(relatorio);
    console.log(`  ${tela.nome}  ${tela.rota}`);
    console.log(`    tela: "${r.tela}" · ${r.tabelas} tabela(s), ${r.graficos} gráfico(s)`);
    for (const a of r.amostra) console.log(`      · "${a.titulo}" — ${a.linhas} linhas, ${a.colunas} colunas`);

    conferir("o PDF da página inteira saiu sem erro", r.erroPdf === null, r.erroPdf ?? "");
    if (r.tabelas + r.graficos > 0) {
      conferir("o PDF tem tamanho de arquivo", r.bytesPdf > 1000, `${r.bytesPdf} bytes`);
      conferir("todo alvo tem nome", r.titulosVazios === 0, `${r.titulosVazios} sem nome`);
    }
    conferir("a tela tem nome próprio", Boolean(r.tela && r.tela.trim()), r.tela);

    conferir("o documento de impressão montou", r.erroImpressao === null, r.erroImpressao ?? "");
    if (r.impressao) {
      const i = r.impressao;
      console.log(`    impressão: ${i.nos} nós, ${i.folhas} folha(s) de estilo, tema "${i.tema}"`);
      conferir("levou o CSS da aplicação junto", i.folhas > 0, `${i.folhas}`);
      conferir("forçou tema claro para o papel", i.tema === "claro", String(i.tema));
      conferir("tem cabeçalho com nome e data", i.temCabecalho === true);
      conferir("não sobrou menu, topo nem botão flutuante", i.sobrouMenu === 0, `${i.sobrouMenu} sobrou(ram)`);
      conferir("nenhum <details> ficou fechado escondendo dado", i.detalhesFechados === 0, `${i.detalhesFechados} fechado(s)`);
      conferir("nenhum <script> foi para o papel", i.scripts === 0, `${i.scripts}`);
      conferir("tem <base> para os href relativos resolverem", i.temBase === true);
      conferir("as tabelas da tela foram junto", i.tabelas >= r.tabelas, `${i.tabelas} no papel, ${r.tabelas} na tela`);
      const guardado = i.nosNaTela > 0 ? i.nos / i.nosNaTela : 0;
      conferir(
        "o clone guardou ao menos 80% dos nós do conteúdo",
        guardado >= 0.8,
        `${i.nos} de ${i.nosNaTela} (${Math.round(guardado * 100)}%)`
      );
    }
    if (tela.minTabelas) conferir(`achou ao menos ${tela.minTabelas} tabela`, r.tabelas >= tela.minTabelas, `achou ${r.tabelas}`);
    if (tela.minGraficos) conferir(`achou ao menos ${tela.minGraficos} gráfico`, r.graficos >= tela.minGraficos, `achou ${r.graficos}`);
    console.log("");
  }
} finally {
  chrome.kill();
  await dormir(500);
  for (const dir of [perfil, trabalho]) {
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
    catch { /* sobra de perfil do Chrome em /tmp não é falha do teste */ }
  }
}

console.log(falhas === 0 ? "Tudo certo.\n" : `${falhas} falha(s).\n`);
process.exit(falhas === 0 ? 0 : 1);

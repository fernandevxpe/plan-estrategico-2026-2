/**
 * A LEITURA DA TABELA, CONFERIDA NUM NAVEGADOR DE VERDADE.
 *
 * `lib/exportar/tabela-dom.ts` só existe dentro de um DOM com layout: ele
 * decide o que entra no PDF perguntando se a linha está VISÍVEL, e visibilidade
 * não existe sem alguém calcular caixa. `tsc` e `next build` não provam nada
 * disso — os dois passavam limpo com a extração devolvendo zero linha.
 *
 * Em vez de somar uma dependência de DOM falso, o teste usa o Chrome que já
 * está na máquina: compila o módulo REAL (ele não importa nada, então compila
 * sozinho), inlina numa página com as estruturas que a casa realmente tem, e
 * lê o resultado com `--headless --dump-dom`. Zero pacote novo, e o motor é o
 * mesmo que roda na produção.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const trabalho = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "xpe-exportar-"));

execFileSync(
  "npx",
  ["tsc", "lib/exportar/tabela-dom.ts", "--outDir", trabalho, "--target", "es2020", "--module", "esnext", "--moduleResolution", "bundler"],
  { stdio: "inherit" }
);
const modulo = readFileSync(join(trabalho, "tabela-dom.js"), "utf8");

/*
 * A página de prova imita `FinContasAPagar`, que é a tabela mais difícil da
 * casa: cabeçalho de duas alturas, um `<tbody>` por pessoa com linha de grupo
 * esticada, botão e ícone dentro da célula, checkbox, uma linha escondida por
 * filtro, um `<input>` de valor (o padrão da matriz do plano), uma TABELA
 * ANINHADA com o rateio do lançamento, e `<tfoot>` com o total.
 */
const pagina = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>
  .escondida { display: none; }
</style></head><body>
<section class="card">
  <h2 class="card-title">Contas a pagar · setembro/2026 <a href="/financeiro/custos">já contado — abrir</a></h2>
  <table class="fin-table fin-cap-tabela">
    <thead>
      <tr><th colspan="2">Identificação</th><th colspan="2">Dinheiro</th></tr>
      <tr><th>Descrição</th><th>Favorecido</th><th>Valor</th><th>Situação</th></tr>
    </thead>
    <tbody>
      <tr><th colspan="4">José Gonçalves de Assunção</th></tr>
      <tr>
        <td>
          <input type="checkbox" checked>
          Manutenção — inversor da usina São João
          <button type="button">Programar</button>
          <svg viewBox="0 0 24 24"><path d="M1 1"/></svg>
        </td>
        <td>José Gonçalves</td>
        <td>R$ 1.234,56</td>
        <td>Em aberto</td>
      </tr>
      <tr class="escondida">
        <td>Linha filtrada fora pela tela</td><td>Ninguém</td><td>R$ 99.999,99</td><td>Oculta</td>
      </tr>
      <tr>
        <td>
          Rateio do lançamento
          <table class="fin-cap-pedacos-tabela">
            <tbody>
              <tr><td>Pedaço A</td><td>R$ 600,00</td></tr>
              <tr><td>Pedaço B</td><td>R$ 634,56</td></tr>
            </tbody>
          </table>
        </td>
        <td>José Gonçalves</td>
        <td>R$ 1.234,56</td>
        <td>Programado</td>
      </tr>
      <tr>
        <td>Ajuste digitado na matriz</td>
        <td>Operação</td>
        <td><input class="fin-cell-input" value="R$ 2.500,00"></td>
        <td><span aria-hidden="true">•</span> Em aberto</td>
      </tr>
    </tbody>
    <tfoot>
      <tr><th>Total geral</th><td></td><td>R$ 4.969,12</td><td></td></tr>
    </tfoot>
  </table>
</section>
<section class="card fin-painel-grafico" aria-label="Throughput por núcleo">
  <table class="fin-table">
    <caption>Throughput = Receita − Custos Totalmente Variáveis (doc 17). Sem rateio de custo fixo: rateio serve para contabilidade, não para decidir se vale a pena aceitar o próximo serviço.</caption>
    <thead><tr><th>Núcleo</th><th>Receita 12m</th></tr></thead>
    <tbody><tr><td>Consultoria</td><td>R$ 1.000,00</td></tr></tbody>
  </table>
</section>
<pre id="saida"></pre>
<script type="module">
${modulo}
const tabelas = document.querySelectorAll("table");
const principal = extrairTabela(tabelas[0], 0);
const aninhada = extrairTabela(tabelas[1], 1);
const comCaptionLonga = extrairTabela(tabelas[2], 2);
document.getElementById("saida").textContent = JSON.stringify({ principal, aninhada, comCaptionLonga, csv: tabelaParaCsv(principal) });
</script>
</body></html>`;

const arquivo = join(trabalho, "prova.html");
writeFileSync(arquivo, pagina);

const dom = execFileSync(
  CHROME,
  ["--headless=new", "--disable-gpu", "--no-sandbox", "--virtual-time-budget=3000", "--dump-dom", `file://${arquivo}`],
  { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }
);

const bruto = /<pre id="saida">([\s\S]*?)<\/pre>/.exec(dom)?.[1];
if (!bruto) {
  console.error("o Chrome não devolveu o bloco de saída — a página não rodou");
  process.exit(1);
}
const decodificado = bruto
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&amp;/g, "&");
const { principal, aninhada, comCaptionLonga, csv } = JSON.parse(decodificado);

let falhas = 0;
function conferir(rotulo, condicao, detalhe = "") {
  if (condicao) console.log(`  ok   ${rotulo}`);
  else {
    falhas++;
    console.log(`  FALHA ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`);
  }
}

console.log("\nLeitura de tabela no Chrome");

// Regressão de 01/09/2026, achada rodando a exportação nas telas reais: o
// título saía "Pessoasjá contado — abrir". O `<h2>` de cada grupo carrega um
// selo `<a>` de navegação, e `textContent` colava tudo sem nem um espaço.
conferir("título veio do cartão, sem o selo de navegação", principal.titulo === "Contas a pagar · setembro/2026", principal.titulo);

// Regressão da mesma rodada: a caption da tabela de Throughput tem 197
// caracteres — ela explica a fórmula, não batiza a tabela. Vira frase no nome
// do arquivo e duas linhas no cabeçalho do PDF.
conferir("caption longa perde para o rótulo da seção", comCaptionLonga.titulo === "Throughput por núcleo", comCaptionLonga.titulo);
conferir(
  "cabeçalho de duas alturas devolveu a linha de baixo",
  JSON.stringify(principal.colunas) === JSON.stringify(["Descrição", "Favorecido", "Valor", "Situação"]),
  JSON.stringify(principal.colunas)
);

const grupos = principal.linhas.filter((l) => l.tipo === "grupo");
conferir("linha de pessoa virou grupo", grupos.length === 1 && grupos[0].celulas[0].texto === "José Gonçalves de Assunção", JSON.stringify(grupos));

const primeira = principal.linhas.find((l) => l.tipo === "dado");
conferir("texto do botão ficou fora da célula", !primeira.celulas[0].texto.includes("Programar"), primeira.celulas[0].texto);
conferir("acento preservado", primeira.celulas[0].texto.includes("Manutenção — inversor da usina São João"), primeira.celulas[0].texto);
conferir("valor marcado como numérico", primeira.celulas[2].numerica === true);
conferir("texto NÃO marcado como numérico", primeira.celulas[1].numerica === false);

const linhaEscondida = principal.linhas.some((l) => l.celulas.some((c) => c.texto.includes("99.999,99")));
conferir("linha escondida pelo filtro ficou fora", !linhaEscondida);

const comRateio = principal.linhas.find((l) => l.celulas[0].texto.startsWith("Rateio"));
conferir("tabela aninhada não foi achatada na célula", comRateio.celulas[0].texto === "Rateio do lançamento", comRateio.celulas[0].texto);
conferir("a aninhada é alvo próprio, com suas 2 linhas", aninhada.linhas.length === 2, `${aninhada.linhas.length}`);

const comInput = principal.linhas.find((l) => l.celulas[0].texto.startsWith("Ajuste"));
conferir("valor digitado no <input> entrou", comInput.celulas[2].texto === "R$ 2.500,00", comInput.celulas[2].texto);
conferir("marcador aria-hidden ficou fora", comInput.celulas[3].texto === "Em aberto", comInput.celulas[3].texto);

conferir("tfoot virou rodapé, não linha de dado", principal.rodape.length === 1 && principal.rodape[0].tipo === "total");
conferir("total geral inteiro", principal.rodape[0].celulas[2].texto === "R$ 4.969,12", principal.rodape[0].celulas[2].texto);
conferir("contagem de linhas de dado", principal.totalDeDados === 3, `${principal.totalDeDados}`);

conferir("CSV começa com BOM", csv.charCodeAt(0) === 0xfeff);
// O BOM vive GRUDADO no primeiro campo — é um caractere da primeira linha, não
// um prefixo do arquivo. Comparar sem descontá-lo foi o que fez esta conferência
// reprovar um CSV que estava certo.
const primeiraLinhaCsv = csv.split("\r\n")[0].replace(/^\ufeff/, "");
conferir("CSV usa ponto-e-vírgula (padrão pt-BR do Excel)", primeiraLinhaCsv === '"Descrição";"Favorecido";"Valor";"Situação"', primeiraLinhaCsv);

console.log(falhas === 0 ? "\nTudo certo.\n" : `\n${falhas} falha(s).\n`);
process.exit(falhas === 0 ? 0 : 1);

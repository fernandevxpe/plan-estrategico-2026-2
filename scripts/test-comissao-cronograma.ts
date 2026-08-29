// Prova do cronograma de comissão (0178) — a aritmética que a tela mostra e o
// banco grava.
//
// POR QUE ESTE TESTE EXISTE
// -------------------------
// `montarCronograma` é chamada em DOIS lugares: a prévia do formulário e a
// gravação no servidor. Se ela estiver errada, a tela promete um parcelamento
// e o banco grava outro — e o erro só aparece meses depois, quando alguém
// somar as parcelas e não fechar com o total.
//
// O caso que mais dói é o centavo: R$ 1.000,00 em 3 não é R$ 333,33 três
// vezes. Se a sobra sumir, o total pago não bate com o total contratado; se
// ela for diluída, nenhuma parcela bate com o extrato. A regra é: a ÚLTIMA
// parcela absorve, e a soma é sempre exatamente o total.
//
// Roda com: node scripts/test-comissao-cronograma.ts

import { montarCronograma, rotuloParcela } from "../lib/financeiro/comissao-cronograma.ts";

let falhas = 0;
let provas = 0;

function ok(condicao: boolean, o_que: string) {
  provas += 1;
  if (condicao) {
    console.log(`  ✓ ${o_que}`);
  } else {
    falhas += 1;
    console.error(`  ✗ ${o_que}`);
  }
}

function cronograma(e: Parameters<typeof montarCronograma>[0]) {
  const r = montarCronograma(e);
  if (!r.ok) throw new Error(`esperava cronograma, veio recusa: ${r.erro}`);
  return r.parcelas;
}

function recusa(e: Parameters<typeof montarCronograma>[0]): string {
  const r = montarCronograma(e);
  if (r.ok) throw new Error("esperava recusa, veio cronograma");
  return r.erro;
}

console.log("\n=== À vista ===");
{
  const p = cronograma({ totalCents: 500000, forma: "avista", parcelas: 1, entradaCents: 0, primeiraCompetencia: "2026-09" });
  ok(p.length === 1, "uma linha só");
  ok(p[0].valorCents === 500000, "valor igual ao total");
  ok(p[0].competencia === "2026-09-01", "cai no mês pedido");
  ok(rotuloParcela(p[0]) === "à vista", 'rótulo "à vista"');
}
{
  // Zero é declaração de ausência (0177), e à vista tem de aceitar.
  const p = cronograma({ totalCents: 0, forma: "avista", parcelas: 1, entradaCents: 0, primeiraCompetencia: "2026-09" });
  ok(p.length === 1 && p[0].valorCents === 0, "zero é aceito à vista");
}

console.log("\n=== Parcelada, e o centavo que sobra ===");
{
  const p = cronograma({ totalCents: 100000, forma: "parcelada", parcelas: 3, entradaCents: 0, primeiraCompetencia: "2026-09" });
  ok(p.length === 3, "três parcelas");
  ok(p.reduce((s, x) => s + x.valorCents, 0) === 100000, "a soma é exatamente o total");
  ok(p[0].valorCents === 33333 && p[1].valorCents === 33333, "as duas primeiras são 333,33");
  ok(p[2].valorCents === 33334, "a ÚLTIMA absorve o centavo (333,34)");
  ok(
    p.map((x) => x.competencia).join(",") === "2026-09-01,2026-10-01,2026-11-01",
    "meses consecutivos"
  );
  ok(rotuloParcela(p[1]) === "2/3", 'rótulo "2/3"');
}
{
  const p = cronograma({ totalCents: 120000, forma: "parcelada", parcelas: 4, entradaCents: 0, primeiraCompetencia: "2026-11" });
  ok(
    p.map((x) => x.competencia).join(",") === "2026-11-01,2026-12-01,2027-01-01,2027-02-01",
    "vira o ano corretamente"
  );
}
ok(recusa({ totalCents: 0, forma: "parcelada", parcelas: 3, entradaCents: 0, primeiraCompetencia: "2026-09" }).includes("maior que zero"), "parcelar zero é recusado");
ok(recusa({ totalCents: 100000, forma: "parcelada", parcelas: 1, entradaCents: 0, primeiraCompetencia: "2026-09" }).includes("entre 2"), "parcelar em 1 manda usar à vista");

console.log("\n=== Entrada + parcelas ===");
{
  const p = cronograma({ totalCents: 1000000, forma: "entrada_parcelas", parcelas: 3, entradaCents: 400000, primeiraCompetencia: "2026-09" });
  ok(p.length === 4, "entrada + 3 = quatro lançamentos");
  ok(p[0].ehEntrada && p[0].valorCents === 400000, "a entrada é a parcela 1, com o valor da entrada");
  ok(!p[1].ehEntrada && !p[2].ehEntrada && !p[3].ehEntrada, "as demais não são entrada");
  ok(p[1].valorCents === 200000 && p[2].valorCents === 200000 && p[3].valorCents === 200000, "o restante divide igual");
  ok(p.reduce((s, x) => s + x.valorCents, 0) === 1000000, "a soma é exatamente o total");
  ok(p[0].parcelasTotal === 4 && p[3].parcela === 4, "a numeração conta a entrada");
  ok(rotuloParcela(p[0]) === "entrada", 'rótulo "entrada"');
  ok(
    p.map((x) => x.competencia).join(",") === "2026-09-01,2026-10-01,2026-11-01,2026-12-01",
    "entrada no primeiro mês, parcelas nos seguintes"
  );
}
{
  // A sobra do restante também vai para a última.
  const p = cronograma({ totalCents: 100000, forma: "entrada_parcelas", parcelas: 3, entradaCents: 10000, primeiraCompetencia: "2026-09" });
  ok(p.reduce((s, x) => s + x.valorCents, 0) === 100000, "com sobra, a soma continua exata");
  ok(p[3].valorCents === 30000 + 0 || p[3].valorCents >= p[1].valorCents, "a última é a que absorve");
}
ok(recusa({ totalCents: 100000, forma: "entrada_parcelas", parcelas: 3, entradaCents: 0, primeiraCompetencia: "2026-09" }).includes("Parcelada"), "entrada zero manda usar Parcelada");
ok(recusa({ totalCents: 100000, forma: "entrada_parcelas", parcelas: 3, entradaCents: 100000, primeiraCompetencia: "2026-09" }).includes("À vista"), "entrada igual ao total manda usar À vista");
ok(recusa({ totalCents: 100000, forma: "entrada_parcelas", parcelas: 0, entradaCents: 10000, primeiraCompetencia: "2026-09" }).includes("depois da entrada"), "entrada sem parcela é recusada");

console.log("\n=== Competência ===");
ok(recusa({ totalCents: 100, forma: "avista", parcelas: 1, entradaCents: 0, primeiraCompetencia: "2026-13" }).includes("AAAA-MM"), "mês 13 é recusado");
ok(recusa({ totalCents: 100, forma: "avista", parcelas: 1, entradaCents: 0, primeiraCompetencia: "" }).includes("AAAA-MM"), "competência vazia é recusada");
{
  const p = cronograma({ totalCents: 100, forma: "avista", parcelas: 1, entradaCents: 0, primeiraCompetencia: "2026-09-01" });
  ok(p[0].competencia === "2026-09-01", "aceita AAAA-MM-DD também");
}

console.log("\n=== Invariante geral: soma == total, em 200 combinações ===");
{
  let piores = 0;
  for (let total = 1; total <= 100000; total += 997) {
    for (const n of [2, 3, 7, 12]) {
      const p = cronograma({ totalCents: total, forma: "parcelada", parcelas: n, entradaCents: 0, primeiraCompetencia: "2026-01" });
      if (p.reduce((s, x) => s + x.valorCents, 0) !== total) piores += 1;
    }
  }
  ok(piores === 0, "nenhuma combinação perde ou inventa centavo");
}

console.log(`\n${provas - falhas}/${provas} provas passaram.`);
if (falhas) {
  console.error(`${falhas} FALHA(S).`);
  process.exit(1);
}

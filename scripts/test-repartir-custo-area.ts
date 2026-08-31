// Prova do rateio de custo por área — a aritmética que o gráfico mostra.
//
// POR QUE ESTE TESTE EXISTE
// -------------------------
// O salário de quem trabalha em duas áreas NÃO pode aparecer inteiro nas duas
// barras. Se o rateio inflar, o gráfico mente e a casa lê o dobro. Se a pessoa
// sem área sumir, o dinheiro some e a soma deixa de bater com a matriz.
//
// Roda com: node scripts/test-repartir-custo-area.ts

import {
  atribuirCents,
  destinosAreaEmpresa,
  pctDaFatia,
  repartirCents,
  SLUG_SEM_AREA,
  somarFatias
} from "../lib/financeiro/repartir-custo-area.ts";

let falhas = 0;
let provas = 0;

function ok(condicao: boolean, o_que: string) {
  provas += 1;
  if (condicao) console.log(`  ✓ ${o_que}`);
  else {
    falhas += 1;
    console.error(`  ✗ ${o_que}`);
  }
}

const catalogo = [
  { slug: "marketing", nome: "Marketing" },
  { slug: "vendas", nome: "Vendas" },
  { slug: "financeiro", nome: "Financeiro" },
  { slug: "projetos", nome: "Projetos" }
];

console.log("\n=== Partes iguais ===");
{
  const duas = repartirCents(10_000, 2);
  ok(duas.length === 2, "2 áreas → 2 fatias");
  ok(duas[0] === 5_000 && duas[1] === 5_000, "R$ 100 em 2 = 50/50");
  ok(duas.reduce((s, n) => s + n, 0) === 10_000, "soma das fatias = total");

  const quatro = repartirCents(10_000, 4);
  ok(quatro.every((n) => n === 2_500), "4 áreas → 25% cada");
  ok(quatro.reduce((s, n) => s + n, 0) === 10_000, "4 fatias somam o total");

  const tres = repartirCents(10_001, 3);
  ok(tres.reduce((s, n) => s + n, 0) === 10_001, "centavo que sobra não some");
  ok(tres[0] === 3_334 && tres[1] === 3_334 && tres[2] === 3_333, "sobra nas primeiras do catálogo");

  ok(repartirCents(8_000, 1)[0] === 8_000, "1 área leva 100%");
  ok(repartirCents(5_000, 0).length === 0, "n=0 não inventa fatia");
  ok(repartirCents(-12, 2).every((n) => n === 0), "negativo vira zero, não inverte");
}

console.log("\n=== Destinos ===");
{
  const sem = destinosAreaEmpresa([], catalogo, null);
  ok(sem.length === 1 && sem[0].slug === SLUG_SEM_AREA, "sem área → balde Sem área");

  const duas = destinosAreaEmpresa(
    [
      { slug: "vendas", nome: "Vendas" },
      { slug: "financeiro", nome: "Financeiro" }
    ],
    catalogo,
    null
  );
  ok(duas.map((d) => d.slug).join(",") === "vendas,financeiro", "ordem do catálogo, não a da pessoa");

  const isolado = destinosAreaEmpresa(
    [
      { slug: "vendas", nome: "Vendas" },
      { slug: "financeiro", nome: "Financeiro" }
    ],
    catalogo,
    new Set(["vendas"])
  );
  ok(isolado.length === 1 && isolado[0].slug === "vendas", "filtro estreito rateia só na área visível");

  const sumiu = destinosAreaEmpresa([], catalogo, new Set(["vendas"]));
  ok(sumiu.length === 0, "sem área + filtro sem o balde → ninguém recebe (a linha já saiu da tabela)");
}

console.log("\n=== Não duplica ===");
{
  const destinos = destinosAreaEmpresa(
    [
      { slug: "vendas", nome: "Vendas" },
      { slug: "financeiro", nome: "Financeiro" }
    ],
    catalogo,
    null
  );
  const partes = atribuirCents(200_000, destinos);
  ok(partes.reduce((s, p) => s + p.cents, 0) === 200_000, "R$ 2.000 em 2 áreas soma R$ 2.000, não R$ 4.000");
  ok(partes.every((p) => p.cents === 100_000), "cada área leva metade");

  const fatias = somarFatias(
    [
      { slug: "vendas", nome: "Vendas", ultimoCents: 100_000, totalCents: 800_000 },
      { slug: "financeiro", nome: "Financeiro", ultimoCents: 100_000, totalCents: 800_000 }
    ],
    8
  );
  ok(fatias.reduce((s, f) => s + f.ultimoCents, 0) === 200_000, "gráfico do último mês = custo da pessoa");
  ok(fatias.reduce((s, f) => s + f.totalCents, 0) === 1_600_000, "gráfico do recorte = custo da pessoa");
  ok(fatias.every((f) => f.mediaCents === 100_000), "média de 8 meses = total/8 por área");
}

console.log("\n=== Duas pessoas, mesma casa ===");
{
  const ana = atribuirCents(300_000, [
    { slug: "vendas", nome: "Vendas" },
    { slug: "financeiro", nome: "Financeiro" }
  ]);
  const beto = atribuirCents(100_000, [{ slug: "vendas", nome: "Vendas" }]);
  const fatias = somarFatias(
    [
      ...ana.map((p) => ({ slug: p.slug, nome: p.nome, ultimoCents: p.cents, totalCents: p.cents })),
      ...beto.map((p) => ({ slug: p.slug, nome: p.nome, ultimoCents: p.cents, totalCents: p.cents }))
    ],
    1
  );
  const vendas = fatias.find((f) => f.slug === "vendas");
  const fin = fatias.find((f) => f.slug === "financeiro");
  ok(vendas?.ultimoCents === 250_000, "Vendas = 50% da Ana + 100% do Beto");
  ok(fin?.ultimoCents === 150_000, "Financeiro = 50% da Ana");
  ok((vendas?.ultimoCents ?? 0) + (fin?.ultimoCents ?? 0) === 400_000, "casa inteira = Ana + Beto");
  ok(Math.abs(pctDaFatia(vendas?.ultimoCents ?? 0, 400_000) - 62.5) < 1e-9, "Vendas = 62,5%");
}

console.log("\n=== Média fecha entre painéis ===");
{
  const fatias = somarFatias(
    [
      { slug: "a", nome: "A", ultimoCents: 1, totalCents: 10 },
      { slug: "b", nome: "B", ultimoCents: 1, totalCents: 10 },
      { slug: "c", nome: "C", ultimoCents: 1, totalCents: 11 }
    ],
    8
  );
  const somaMedia = fatias.reduce((s, f) => s + f.mediaCents, 0);
  ok(somaMedia === Math.round(31 / 8), "soma das médias = média do total, sem centavo solto");
}

if (falhas) {
  console.error(`\n${falhas} falha(s) em ${provas} provas.`);
  process.exit(1);
}
console.log(`\n${provas} provas, nenhuma falha.`);

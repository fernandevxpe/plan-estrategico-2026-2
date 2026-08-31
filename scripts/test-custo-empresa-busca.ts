// Prova da busca ranqueada da matriz de Custo da empresa.
// Roda com: node scripts/test-custo-empresa-busca.ts

import { buscarCustos, passaBusca, type ItemBuscavel } from "../lib/financeiro/custo-empresa-busca.ts";

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

const itens: ItemBuscavel[] = [
  { chave: "1:1", nome: "Ancora Imobiliária", categoriaCode: "5.01", categoriaNome: "Aluguel e condomínio", subparte: "aluguel", blocoTexto: "Aluguel, água, energia e internet Custos padrão" },
  { chave: "2:2", nome: "SIMPLES NACIONAL (DAS)", categoriaCode: "7.01", categoriaNome: "SIMPLES NACIONAL (DAS)", subparte: "impostos", blocoTexto: "Impostos Custos padrão RECEITA FEDERAL SEM FAVORECIDO DAS-SIMPLES NACIONAL" },
  { chave: "3:3", nome: "Flyer On Assessoria", categoriaCode: "5.05", categoriaNome: "Marketing", subparte: "flyeron", blocoTexto: "Marketing e Tráfego Custos padrão" },
  { chave: "4:4", nome: "DIMENSIONAL BRASIL", categoriaCode: "4.02", categoriaNome: "Material de obras", subparte: "material_obras", blocoTexto: "Material Custos de obras" },
  { chave: "5:5", nome: "Compesa", categoriaCode: "5.02", categoriaNome: "Água e esgoto", subparte: "aluguel", blocoTexto: "Aluguel, água, energia e internet Custos padrão" }
];

console.log("\n=== Acento, prefixo e categoria ===");
ok(passaBusca(itens[0], "anco"), "anco acha Ancora");
ok(passaBusca(itens[0], "âncora"), "acento não impede");
ok(passaBusca(itens[0], "5.01"), "código da categoria");
ok(passaBusca(itens[0], "501"), "código sem ponto");
ok(passaBusca(itens[0], "aluguel"), "nome do bloco onde mora");
ok(passaBusca(itens[4], "aluguel"), "Compesa agora mora no bloco unificado");
ok(!passaBusca(itens[0], "embrasul"), "não casa bloco alheio");
ok(passaBusca(itens[4], "agua"), "água casa Compesa via bloco unificado");

console.log("\n=== Ranking aponta o bloco ===");
const ancora = buscarCustos(itens, "anco");
ok(ancora[0]?.chave === "1:1", "Ancora é o primeiro hit de anco");
ok(ancora[0]?.blocoTexto.includes("Aluguel"), "hit traz o bloco");

const imposto = buscarCustos(itens, "imposto");
ok(imposto.some((h) => h.chave === "2:2"), "imposto acha Receita Federal no bloco Impostos");
ok(passaBusca(itens[1], "receita federal"), "nome antigo do DAS ainda acha a linha agrupada");

const obras = buscarCustos(itens, "obras material");
ok(obras[0]?.chave === "4:4", "dois tokens AND: obras + material → Dimensional");

ok(buscarCustos(itens, "zzzz").length === 0, "sem hit quando nada casa");
ok(buscarCustos(itens, "   ").length === 0, "query vazia não lista tudo");

console.log(`\n${provas - falhas}/${provas} provas`);
if (falhas) process.exit(1);

// Prova dos blocos da matriz (padrão × obras × organizar).
// Roda com: node scripts/test-custo-empresa-partes.ts

import { parteCustoDe, subparteCustoDe, type ItemParaParte } from "../lib/financeiro/custo-empresa-partes.ts";

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

function item(parcial: Partial<ItemParaParte> & Pick<ItemParaParte, "nome" | "categoriaCode">): ItemParaParte {
  return {
    time: "sem_time",
    areasEmpresa: [],
    ...parcial
  };
}

console.log("\n=== Custos padrão (o que o dono citou) ===");
ok(subparteCustoDe(item({ nome: "Ancora Imobiliária", categoriaCode: "5.01" })) === "aluguel", "Ancora é aluguel");
ok(
  subparteCustoDe(item({ nome: "Ancora Imobiliária", categoriaCode: "5.01", bloco: "impostos" })) === "impostos",
  "override do dono tira Ancora de aluguel"
);
ok(parteCustoDe(item({ nome: "Ancora Imobiliária", categoriaCode: "5.01" })) === "padrao", "aluguel vive em padrão");
ok(subparteCustoDe(item({ nome: "Receita Federal", categoriaCode: "7.01" })) === "impostos", "DAS é imposto");
ok(subparteCustoDe(item({ nome: "PREF MUN RECIFE", categoriaCode: "7.02" })) === "impostos", "ISS é imposto");
ok(subparteCustoDe(item({ nome: "Compesa", categoriaCode: "5.02" })) === "utilidades", "água");
ok(subparteCustoDe(item({ nome: "Neoenergia Pernambuco", categoriaCode: "5.02" })) === "utilidades", "energia");
ok(subparteCustoDe(item({ nome: "Claro", categoriaCode: "5.02" })) === "utilidades", "internet");
ok(subparteCustoDe(item({ nome: "EMBRASUL IND ELETRONICA LTDA", categoriaCode: "8.01" })) === "embrasul", "Embrasul");
ok(subparteCustoDe(item({ nome: "Lyra M2m Ltda", categoriaCode: "5.03" })) === "embrasul", "Lyra anda com a medição");
ok(subparteCustoDe(item({ nome: "Flyer On Assessoria De Marketing Digital Ltda", categoriaCode: "5.05" })) === "flyeron", "tráfego");
ok(subparteCustoDe(item({ nome: "61342665 Kevin Souza Firmino De Oliveira", categoriaCode: "5.05" })) === "flyeron", "Kevin é marketing, não folha");
ok(parteCustoDe(item({ nome: "61342665 Kevin Souza Firmino De Oliveira", categoriaCode: "5.05" })) === "padrao", "Kevin vive em padrão");
ok(subparteCustoDe(item({ nome: "Startlaw Apoio Estrategico", categoriaCode: "5.04" })) === "juridico_contabil", "Startlaw");
ok(subparteCustoDe(item({ nome: "Agilize Tecnologia Ltda", categoriaCode: "5.04" })) === "juridico_contabil", "Agilize");
ok(subparteCustoDe(item({ nome: "Elaine Barbosa Neves De Lima", categoriaCode: "5.04" })) === "juridico_contabil", "Elaine");
ok(subparteCustoDe(item({ nome: "4 TABELI DE PROTESTO DE RECIFE", categoriaCode: "4.02" })) === "material_obras", "cartório de protesto é obras");
ok(parteCustoDe(item({ nome: "4 TABELI DE PROTESTO DE RECIFE", categoriaCode: "4.02" })) === "obras", "tabelionato vive em custos de obras");
ok(subparteCustoDe(item({ nome: "Asaas IP S.A.", categoriaCode: "4.05" })) === "financeiro", "Asaas");
ok(subparteCustoDe(item({ nome: "Conselho Regional De Engenharia E Agronomia", categoriaCode: "5.10" })) === "taxas", "CREA");
ok(subparteCustoDe(item({ nome: "Hostgator", categoriaCode: "5.03" })) === "tecnologia", "Hostgator é casa, não Lyra");

console.log("\n=== Custos de obras ===");
ok(subparteCustoDe(item({ nome: "DIMENSIONAL BRASIL SOLUCOES LTDA", categoriaCode: "4.02" })) === "material_obras", "Dimensional");
ok(parteCustoDe(item({ nome: "PIX Marketplace", categoriaCode: "4.02" })) === "obras", "marketplace 4.02 é obras");
ok(subparteCustoDe(item({ nome: "LOCALIZA RENT A CAR SA", categoriaCode: "4.04" })) === "deslocamento_obras", "Localiza");
ok(subparteCustoDe(item({ nome: "JAILSON JOSE MENDES LIMA DA SILVA", categoriaCode: "4.03" })) === "terceiros_obras", "subcontratação");
ok(
  subparteCustoDe(
    item({
      nome: "Loja X",
      categoriaCode: "5.99",
      time: "obras",
      areasEmpresa: [{ slug: "material_obras" }]
    })
  ) === "material_obras",
  "área material_obras ganha de 5.99"
);

console.log("\n=== Fora da lista ===");
ok(subparteCustoDe(item({ nome: "KGMLAN", categoriaCode: "5.99" })) === "resto", "5.99 sem nome conhecido fica na fila");
ok(parteCustoDe(item({ nome: "KGMLAN", categoriaCode: "5.99" })) === "organizar", "fila é A organizar");
ok(
  parteCustoDe(item({ nome: "EMBRASUL IND ELETRONICA LTDA", categoriaCode: "8.01", time: "consultoria" })) === "padrao",
  "Embrasul não cai em consultoria — o dono citou como custo da casa"
);

console.log(`\n${provas - falhas}/${provas} provas`);
if (falhas) process.exit(1);

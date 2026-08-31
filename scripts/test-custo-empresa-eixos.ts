// Prova dos eixos do custo da empresa (time × classe) e do predicado
// que impede gente de voltar a entrar na soma.
//
// Roda com: node scripts/test-custo-empresa-eixos.ts

import {
  categoriaEGente,
  chaveAgrupamentoCusto,
  chaveCusto,
  classeDe,
  destinosTime,
  nomeAgrupadoCusto,
  sqlContraparteEPessoa,
  sqlPessoaNaoEServicoDaCasa,
  timeDe,
  timeValido
} from "../lib/financeiro/custo-empresa-eixos.ts";
import { atribuirCents } from "../lib/financeiro/repartir-custo-area.ts";

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

console.log("\n=== Time (mesma lista de Pessoas) ===");
ok(timeDe("obras") === "obras", "obras gravado");
ok(timeDe("consultoria") === "consultoria", "consultoria gravado");
ok(timeDe("administrativo") === "administrativo", "administrativo gravado");
ok(timeDe("outros") === "outros", "outros gravado");
ok(timeDe(null) === "sem_time", "null não chuta obras nem consultoria");
ok(timeDe("") === "sem_time", "vazio é pendência");
ok(timeDe("corporativo") === "sem_time", "nucleo velho não vira time sozinho");
ok(timeValido("obras") === true, "obras é válido para gravar");
ok(timeValido("consultoria_obras") === true, "50/50 é válido para gravar");
ok(timeDe("consultoria_obras") === "consultoria_obras", "50/50 gravado volta 50/50");
ok(timeValido("sem_time") === false, "sem_time não se grava — é ausência");
ok(timeValido(null) === false, "null não é time válido");

console.log("\n=== Time 50/50 Consultoria e Obras ===");
{
  const destinos = destinosTime("consultoria_obras");
  ok(destinos.length === 2, "híbrido vira duas barras");
  ok(destinos[0]?.slug === "consultoria" && destinos[1]?.slug === "obras", "ordem consultoria depois obras");
  const partes = atribuirCents(10000, destinos);
  ok(partes[0]?.cents === 5000 && partes[1]?.cents === 5000, "R$ 100,00 parte 50/50");
  const impar = atribuirCents(101, destinos);
  ok(
    impar[0]?.cents === 51 && impar[1]?.cents === 50,
    "centavo extra na consultoria (primeira fatia)"
  );
  ok(impar[0]!.cents + impar[1]!.cents === 101, "soma do 50/50 é o total");
  const soConsultoria = destinosTime("consultoria_obras", new Set(["consultoria"]));
  ok(soConsultoria.length === 1 && soConsultoria[0]?.slug === "consultoria", "filtro Consultoria fica com 100%");
  ok(destinosTime("obras").length === 1 && destinosTime("obras")[0]?.slug === "obras", "obras puro não rateia");
  ok(
    destinosTime("consultoria_obras", new Set(["administrativo"])).length === 0,
    "Administrativo ligado sozinho esconde o 50/50"
  );
}

console.log("\n=== Classe (operacional / máquinas) ===");
ok(classeDe("5.01") === "operacional", "aluguel é operacional");
ok(classeDe("8.01") === "maquinas", "equipamentos é máquinas");
ok(classeDe("4.02") === "maquinas", "material de obra é máquinas");
ok(classeDe("4.03") === "operacional", "terceirização não é máquina");

console.log("\n=== Chave do item ===");
ok(chaveCusto(12, 3) === "12:3", "contraparte × categoria");
ok(chaveCusto(null, 3) === "0:3", "sem favorecido não colide com id 0 real");
ok(
  chaveAgrupamentoCusto({ categoriaCode: "7.01", counterpartyId: 10, categoryId: 7 }) ===
    chaveAgrupamentoCusto({ categoriaCode: "7.01", counterpartyId: null, categoryId: 7 }),
  "Receita Federal e PIX sem favorecido no 7.01 são a mesma linha"
);
ok(
  chaveAgrupamentoCusto({ categoriaCode: "7.01", counterpartyId: 1, categoryId: 7 }) !==
    chaveAgrupamentoCusto({ categoriaCode: "7.02", counterpartyId: 1, categoryId: 8 }),
  "ISS 7.02 não some no DAS"
);
ok(
  chaveAgrupamentoCusto({ categoriaCode: "5.01", counterpartyId: 12, categoryId: 3 }) === "12:3",
  "aluguel continua no grão contraparte × categoria"
);
ok(
  nomeAgrupadoCusto([
    { nome: "RECEITA FEDERAL", categoriaCode: "7.01", categoriaNome: "SIMPLES NACIONAL (DAS)" },
    { nome: "Sem favorecido", categoriaCode: "7.01", categoriaNome: "SIMPLES NACIONAL (DAS)" }
  ]) === "SIMPLES NACIONAL (DAS)",
  "linha agrupada usa o nome da categoria, não o rótulo do banco"
);

console.log("\n=== Gente pelo plano de contas ===");
ok(categoriaEGente("6.01") === true, "salário é gente");
ok(categoriaEGente("4.01") === true, "comissão a vendedor é gente");
ok(categoriaEGente("5.05") === false, "marketing não é gente pela categoria");

console.log("\n=== Predicado SQL da contraparte ===");
{
  const sql = sqlContraparteEPessoa("t.counterparty_id");
  ok(sql.includes("fin_person_counterparty"), "usa a mesma tabela de Pessoas");
  ok(sql.includes("status = 'confirmado'"), "só ligação confirmada");
  ok(sql.includes("Limpeza"), "faxina da casa não conta como gente");
  let recusou = false;
  try {
    sqlContraparteEPessoa("1; drop table fin_person");
  } catch {
    recusou = true;
  }
  ok(recusou, "alias estranho não entra no SQL");
  let recusouPapel = false;
  try {
    sqlPessoaNaoEServicoDaCasa("p; drop table fin_person");
  } catch {
    recusouPapel = true;
  }
  ok(recusouPapel, "alias de papel estranho não entra no SQL");
}

console.log(`\n${provas - falhas}/${provas} provas`);
if (falhas) process.exit(1);

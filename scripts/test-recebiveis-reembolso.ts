// Prova da aritmética do reembolso em Recebíveis.
//
// Os números são os do Fernando em 01/09/2026, medidos na base: dois Pix
// (pró-labore R$ 4.379,00 e reembolso R$ 1.440,76). A view pintava salário
// R$ 1.621,00 que não saiu e partia o pró-labore. Gasolina + PagBank (app,
// competência agosto) iam reaparecer na previsão de outubro.
//
// Roda com: node scripts/test-recebiveis-reembolso.ts

import {
  alinharBandasComPixConferido,
  itemAppJaLiquidado,
  pixesDoCaixa
} from "../lib/financeiro/recebiveis-reembolso.ts";

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

console.log("\n=== 1. O HISTÓRICO MOSTRA O QUE CAIU, NÃO O RATEIO ===");

const setembro = {
  mes: "2026-09",
  totalCents: 581976,
  porNatureza: {
    salario: 162100,
    prolabore: 402476,
    comissao: 1000,
    reembolso: 16400
  }
};
const agosto = {
  mes: "2026-08",
  totalCents: 629126,
  porNatureza: {
    salario: 162100,
    prolabore: 337900,
    comissao: 1000,
    reembolso: 128126
  }
};

const pixes = pixesDoCaixa({
  previstos: [
    { natureza: "salario", pagoCents: 0, conferido: false },
    { natureza: "prolabore", pagoCents: 437900, conferido: true },
    { natureza: "comissao", pagoCents: 1000, conferido: true },
    { natureza: "reembolso", pagoCents: 144076, conferido: true }
  ],
  extrato: [
    { data: "2026-08-31", valorCents: 1000, natureza: "prolabore", casado: true },
    { data: "2026-09-01", valorCents: 437900, natureza: "prolabore", casado: true },
    { data: "2026-09-01", valorCents: 144076, natureza: "prolabore", casado: true }
  ]
});

ok(
  pixes.some((p) => p.natureza === "comissao" && p.data.startsWith("2026-08")),
  "comissão de R$ 10 paga em 31/08 fica no mês de caixa de agosto"
);
ok(
  pixes.filter((p) => p.data.startsWith("2026-09")).every((p) => p.natureza !== "salario"),
  "salário sem Pix não entra em setembro"
);

alinharBandasComPixConferido([agosto, setembro], pixes);

ok(setembro.porNatureza.prolabore === 437900, "pró-labore de setembro é o Pix de R$ 4.379,00");
ok(setembro.porNatureza.reembolso === 144076, "reembolso de setembro é o Pix de R$ 1.440,76");
ok(!setembro.porNatureza.salario, "salário não aparece — ainda está a receber");
ok(!setembro.porNatureza.comissao, "comissão de 31/08 não vaza para setembro");
ok(
  (setembro.porNatureza.prolabore ?? 0) + (setembro.porNatureza.reembolso ?? 0) === setembro.totalCents,
  "o total do mês continua R$ 5.819,76 — o que caiu na conta"
);
ok(agosto.porNatureza.salario === 162100, "agosto não fecha só com os R$ 10, então a view fica");

console.log("\n=== 2. NÃO REESCREVE MÊS QUE NÃO FECHA ===");

const curto = {
  mes: "2026-09",
  totalCents: 50000,
  porNatureza: { prolabore: 40000, reembolso: 10000 }
};
alinharBandasComPixConferido(
  [curto],
  [{ data: "2026-09-01", natureza: "reembolso", cents: 40000 }]
);
ok(curto.porNatureza.reembolso === 10000, "Pix que não soma o total do mês não substitui a banda");
ok(curto.porNatureza.prolabore === 40000, "nem o residual");

console.log("\n=== 3. ITEM DO APP JÁ LIQUIDADO NÃO VOLTA NA PREVISÃO ===");

const pagas = new Set(["2026-08"]);
ok(
  itemAppJaLiquidado("app", "2026-08", pagas),
  "Gasolina/PagBank de agosto, Pix conferido, saem da previsão"
);
ok(
  !itemAppJaLiquidado("planilha", "2026-08", pagas),
  "série da planilha fica — parcela de outubro ainda é devida"
);
ok(
  !itemAppJaLiquidado("app", "2026-09", pagas),
  "pedido novo de setembro, ainda sem Pix, entra na previsão"
);
ok(!itemAppJaLiquidado("app", "", pagas), "competência vazia não se inventa como paga");

console.log(`\n${falhas === 0 ? "ok" : "FALHOU"} — ${provas} prova(s), ${falhas} falha(s)`);
process.exit(falhas === 0 ? 0 : 1);

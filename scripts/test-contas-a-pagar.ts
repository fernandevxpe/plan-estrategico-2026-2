// Prova dos eixos de Contas a pagar: de que grupo é cada camada da agenda,
// por que uma linha não pode virar ordem, e o mascaramento da chave PIX.
//
// Roda com: node scripts/test-contas-a-pagar.ts

import {
  GRUPOS,
  MOTIVO_IMPEDIMENTO,
  certezaDe,
  grupoDaCamada,
  impedimentoDe,
  mascararChave,
  naoConfirmadaDe,
  naturezaDe,
  naturezaSlugDe,
  ordemDaNatureza,
  CAMADA_COMPOSICAO,
  NATUREZAS_DA_FOLHA,
  NATUREZA_DA_VIEW
} from "../lib/financeiro/contas-a-pagar-eixos.ts";

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

console.log("\n=== Grupo por camada (as camadas são as da 0079) ===");
ok(grupoDaCamada("pagar_documento") === "empresa", "documento é custo da empresa");
ok(grupoDaCamada("pagar_recorrente") === "empresa", "recorrente é custo da empresa");
ok(grupoDaCamada("pagar_emprestimo") === "empresa", "empréstimo é custo da empresa");
ok(grupoDaCamada("pagar_folha") === "folha", "folha tem grupo próprio");
ok(grupoDaCamada("pagar_tributo_das") === "das", "DAS tem grupo próprio");
ok(grupoDaCamada("pagar_cartao_ciclo") === "cartao", "ciclo de cartão é fatura");
ok(grupoDaCamada("pagar_cartao_parcela") === "cartao", "parcela de cartão é fatura");
ok(grupoDaCamada("pagar_cartao_estimado") === "cartao", "estimado de cartão é fatura");
// A rede tem de cair em `empresa`: camada nova aparecendo como pessoa
// esconderia dinheiro do bloco que a tela existe para mostrar.
ok(grupoDaCamada("pagar_camada_que_ainda_nao_existe") === "empresa", "camada desconhecida cai em empresa");
ok(grupoDaCamada(CAMADA_COMPOSICAO) === "folha", "a composição que esta tela sintetiza é folha");

console.log("\n=== 6.x é gente venha de onde vier (o bug da dupla contagem) ===");
// Medido em set/2026: 3 documentos do ClickUp — "Folha 09/2026 — Denilson",
// "— Tallany", "— Adryan" — R$ 5.900 que SOMAM, caíam em "Custo da empresa"
// enquanto as mesmas pessoas somavam na composição da folha (R$ 2.100 e
// R$ 2.200). O mesmo dinheiro nos dois blocos.
ok(grupoDaCamada("pagar_documento", "6.01") === "folha", "documento de salário é gente, não custo da empresa");
ok(grupoDaCamada("pagar_documento", "6.02") === "folha", "documento de pró-labore é gente");
ok(grupoDaCamada("pagar_recorrente", "6.05") === "folha", "recorrente de reembolso é gente");
ok(grupoDaCamada("pagar_emprestimo", "6.01") === "folha", "a regra é a CATEGORIA, não a camada");
// E o contrário continua valendo: categoria de empresa nunca vira pessoa.
ok(grupoDaCamada("pagar_documento", "5.01") === "empresa", "aluguel segue em custo da empresa");
ok(grupoDaCamada("pagar_recorrente", "8.01") === "empresa", "Embrasul segue em custo da empresa");
ok(grupoDaCamada("pagar_documento", null) === "empresa", "documento sem categoria não vira gente por acidente");
// Cartão e DAS vencem a categoria: são caixa de outra natureza.
ok(grupoDaCamada("pagar_cartao_ciclo", "6.01") === "cartao", "fatura de cartão continua fatura");
ok(grupoDaCamada("pagar_tributo_das", "6.01") === "das", "DAS continua DAS");

console.log("\n=== Os quatro grupos, e Pessoas vem primeiro ===");
ok(GRUPOS.length === 4, "quatro grupos");
// A ordem é a do caixa: a folha é a maior saída do mês (R$ 439.556,81 contra
// R$ 40.044,75 de recorrentes em set/26) e não pode nascer no terceiro bloco.
ok(GRUPOS[0].slug === "folha", "Pessoas é o primeiro bloco");
ok(GRUPOS[1].slug === "empresa", "Custo da empresa vem logo depois");
ok(
  GRUPOS.filter((g) => g.ondeJaEConta === null).length === 1,
  "só 'empresa' não aponta para outra tela — é o único que a matriz classifica"
);
ok(
  GRUPOS.filter((g) => g.ondeJaEConta !== null).length === 3,
  "folha, DAS e cartão dizem onde já são contados"
);

console.log("\n=== Impedimento: a ordem das checagens é a mensagem ===");
const base = {
  realizadoEm: null as string | null,
  entraNoTotal: true,
  outraLinhaConta: true,
  counterpartyId: 7 as number | null,
  payeeAccountId: 3 as number | null,
  valorCents: 10_000
};
ok(impedimentoDe(base) === null, "linha completa pode virar ordem");
ok(impedimentoDe({ ...base, payeeAccountId: null }) === "sem_chave_pix", "sem coordenada bancária não paga");
ok(impedimentoDe({ ...base, counterpartyId: null }) === "sem_favorecido", "sem favorecido não paga");
ok(impedimentoDe({ ...base, valorCents: 0 }) === "valor_invalido", "valor zero não paga");
ok(impedimentoDe({ ...base, realizadoEm: "2026-08-10" }) === "ja_realizado", "o que já saiu não paga de novo");
// A prova que importa: pago vence tudo. Invertido, a linha já paga pediria
// cadastro de favorecido e alguém cadastraria — trabalho sobre fato encerrado.
ok(
  impedimentoDe({ ...base, realizadoEm: "2026-08-10", payeeAccountId: null, counterpartyId: null }) ===
    "ja_realizado",
  "já realizado vence sem_chave_pix e sem_favorecido"
);
ok(Object.keys(MOTIVO_IMPEDIMENTO).length === 5, "todo impedimento tem frase para o usuário");

console.log("\n=== 'Não soma' são DOIS estados, e confundi-los esvaziou a tela ===");
// Medido em 31/08/2026: 31 linhas de R$ 40.044,75 em set/26 — Ancora, Compesa,
// Neoenergia, Claro, Embrasul — vinham marcadas "outra linha já conta este
// dinheiro" e a disputa de chave mostrou "vencedora: NENHUMA" nas 31.
const duplicada = { ...base, entraNoTotal: false, outraLinhaConta: true };
const aConfirmar = { ...base, entraNoTotal: false, outraLinhaConta: false };

ok(impedimentoDe(duplicada) === "duplicada", "perdeu a chave para quem soma: bloqueia (pagaria em dobro)");
ok(impedimentoDe(aConfirmar) === null, "ninguém conta por ela: NÃO bloqueia — é conta de verdade");
ok(naoConfirmadaDe(aConfirmar) === true, "recorrente proposta é 'a confirmar'");
ok(naoConfirmadaDe(duplicada) === false, "duplicata não é 'a confirmar'");
ok(naoConfirmadaDe({ ...base }) === false, "linha que soma não é 'a confirmar'");
ok(
  naoConfirmadaDe({ ...aConfirmar, realizadoEm: "2026-08-10" }) === false,
  "o que já saiu não volta para a fila de confirmação"
);
// Sem chave PIX continua barrando a que está a confirmar: são filas
// diferentes — uma é decisão do dono, outra é cadastro que falta.
ok(
  impedimentoDe({ ...aConfirmar, payeeAccountId: null }) === "sem_chave_pix",
  "a confirmar sem chave PIX ainda para no cadastro, não na decisão"
);

console.log("\n=== As seis naturezas da folha, na ordem do pagamento ===");
// O dono pediu o detalhamento "por pessoa de cada parte (salário, prolabore,
// comissão, reembolso, estágio, outros)". São as seis que
// fin_time_remuneracao_mes_v emite, medidas no fechamento de agosto/2026:
// salário 17 pessoas, pró-labore 9, comissão 4, reembolso 11, estágio 3, extra 1.
ok(NATUREZAS_DA_FOLHA.length === 7, "sete naturezas — as seis que a view emite hoje mais encargo_beneficio");
for (const slug of NATUREZAS_DA_FOLHA) {
  ok(typeof NATUREZA_DA_VIEW[slug] === "string", `${slug} tem rótulo de tela`);
}
ok(NATUREZA_DA_VIEW.extra === "Outros", "extra aparece como 'Outros' — é o que sobra, não uma categoria");
// A ordem é a do pagamento, não alfabética: o compromisso fixo primeiro,
// reembolso por último porque é devolução e não remuneração.
ok(ordemDaNatureza("salario") === 0, "salário abre");
ok(ordemDaNatureza("prolabore") === 1, "pró-labore em seguida");
ok(ordemDaNatureza("reembolso") === NATUREZAS_DA_FOLHA.length - 1, "reembolso fecha");
ok(
  ordemDaNatureza("salario") < ordemDaNatureza("comissao"),
  "fixo antes de variável"
);
// Natureza que a view passe a emitir amanhã não pode sumir da tela.
ok(
  ordemDaNatureza("natureza_que_ainda_nao_existe") === NATUREZAS_DA_FOLHA.length,
  "natureza nova cai no fim, não some"
);

console.log("\n=== Um eixo só de natureza: categoria e view falam a mesma língua ===");
// Antes disto a tela mostrava TRÊS chips para a mesma coisa em set/26:
// "Encargos (1) R$ 704", "Benefícios (3) R$ 705" e a banda da view.
ok(naturezaDe("6.03") === naturezaDe("6.04"), "6.03 e 6.04 caem na MESMA banda");
ok(naturezaDe("6.03") === NATUREZA_DA_VIEW.encargo_beneficio, "e ela é a mesma que a view emite");
ok(naturezaDe("6.01") === NATUREZA_DA_VIEW.salario, "salário fala a mesma língua");
ok(naturezaDe("6.02") === NATUREZA_DA_VIEW.prolabore, "pró-labore idem");
ok(naturezaDe("6.05") === NATUREZA_DA_VIEW.reembolso, "reembolso idem");
ok(naturezaDe("6.06") === NATUREZA_DA_VIEW.estagio, "estágio idem");
ok(naturezaDe("5.01") === null, "categoria de empresa não tem natureza de pessoa");
// Todo rótulo que sai daqui tem de ser ordenável — senão vai para o fim da
// barra de filtros sem ninguém notar.
for (const code of ["6.01", "6.02", "6.03", "6.04", "6.05", "6.06"]) {
  const slug = naturezaSlugDe(code);
  ok(
    slug !== null && ordemDaNatureza(slug) < NATUREZAS_DA_FOLHA.length,
    `${code} tem posição própria na ordem de pagamento`
  );
}

console.log("\n=== Chave PIX mascarada: reconhecer sim, reconstruir não ===");
const cnpj = "34776108000192";
const m = mascararChave(cnpj, "CNPJ");
ok(m === "…0192", "CNPJ vira os quatro últimos");
ok(m !== null && !m.includes(cnpj), "a chave inteira não aparece");
ok(mascararChave("11987654321", "PHONE") === "…4321", "telefone vira os quatro últimos");
ok(mascararChave("fulano@xpe.com.br", "EMAIL") === "fu…@xpe.com.br", "e-mail guarda o domínio");
ok(mascararChave("a@b.com", "EMAIL") === "a…@b.com", "e-mail de usuário curto não estoura");
ok(mascararChave("@sodominio.com", "EMAIL") === "@s…", "e-mail sem usuário não vira o valor inteiro");
ok(mascararChave("123", "CPF") === "…123", "chave curta demais não estoura o slice");
ok(mascararChave(null, "CPF") === null, "sem chave, sem máscara");
ok(mascararChave("   ", "CPF") === null, "só espaço é ausência");

console.log("\n=== Certeza: cinco valores, e o desconhecido não vira firme ===");
ok(certezaDe("firme") === "firme", "firme passa");
ok(certezaDe("atrasado") === "atrasado", "atrasado passa");
ok(certezaDe("estimado") === "indeterminado", "estimado cai em indeterminado");
ok(certezaDe(null) === "indeterminado", "null não vira firme");

console.log(`\n${provas - falhas}/${provas} provas`);
if (falhas) process.exit(1);

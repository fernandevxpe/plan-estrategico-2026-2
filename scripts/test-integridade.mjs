// Sistema imunológico da plataforma financeira.
//
// IRMÃO de scripts/test-financeiro.mjs, e a divisão de trabalho é deliberada:
//
//   · test-financeiro.mjs afirma VALORES ESPERADOS. "A receita de julho é
//     R$ 240.906,00." Pega regressão de cálculo, e precisa ser reescrito toda vez
//     que o mês vira ou que uma conta nova entra.
//   · este arquivo afirma INVARIANTES. "Nenhuma contraparte carrega o CNPJ da
//     própria empresa." Não tem número esperado para envelhecer: ou a frase é
//     verdadeira ou o ledger está mentindo. Vale hoje, valia em 2021 e vai valer
//     quando a sexta conta entrar.
//
// POR QUE ISTO EXISTE: todo erro caro dos últimos dias foi silencioso. Nenhum
// deles derrubou uma tela, nenhum apareceu num log, nenhum teste ficou vermelho.
// Todos foram achados por alguém olhando linha por linha:
//
//   · regra de despesa classificando receita — cliente "POSTO ..." virava combustível;
//   · source_kind='TRANSFER' do Asaas tratado como prova de titularidade, e
//     R$ 356.506,34 de pagamento a terceiro sumindo da despesa;
//   · contraparte cadastrada com o CNPJ da própria empresa, R$ 151.977,33 de
//     transferência contados como despesa;
//   · lote declarando 150 inserções com zero linhas atrás dele, quebrando o desfazer;
//   · transfer_group_id NULL em 100% da base — nenhuma transferência jamais pareada;
//   · 24 de 55 categorias nunca usadas enquanto R$ 876 mil de entradas ficam sem categoria.
//
// Auditoria manual não escala e não roda às 3h da manhã. Cada invariante aqui é
// um erro daqueles convertido em pergunta que a máquina refaz sozinha.
//
// DUAS SEÇÕES, e a diferença importa:
//
//   INVARIANTES — binários. Violação é defeito, não opinião. Falha derruba o
//   processo (exit 1). São o que roda no boot e no CI.
//
//   MONITORES DE META — contínuos, com limiar. "91% dos lançamentos estão
//   classificados" não é certo nem errado; é bom ou ruim comparado a uma meta que
//   o DONO escolhe. O limiar é decisão de negócio: está no bloco LIMIARES, num
//   lugar só, com justificativa escrita ao lado. Por padrão monitor estourado
//   REPORTA mas não derruba — senão o CI nasce vermelho e vira ruído que se
//   ignora. Com --strict ele também derruba, que é o modo da revisão semanal.
//
// SOBRE O "R$ EM JOGO": somar o valor de cada invariante quebrado conta o mesmo
// dinheiro várias vezes — os mesmos 671 lançamentos aparecem em C3, H3 e H4. O
// resumo final mostra os dois números: a soma por invariante e o DINHEIRO
// DISTINTO, que é o único que pode ser dito em voz alta. Discordância entre telas
// já custou caro nesta plataforma; não vamos reintroduzi-la no relatório.
//
//   node scripts/test-integridade.mjs
//   node scripts/test-integridade.mjs --strict   # metas também derrubam
//   node scripts/test-integridade.mjs --json     # saída para máquina
import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { registerFinanceTypeParsers } from './lib/fin-types.mjs';

loadEnv();
registerFinanceTypeParsers();

const STRICT = process.argv.includes('--strict');
const JSON_OUT = process.argv.includes('--json');

// ---------------------------------------------------------------------------
// LIMIARES — as únicas linhas deste arquivo que são escolha de negócio.
//
// Tudo abaixo desta caixa é verdade ou mentira sobre o banco. Aqui dentro é
// "quão bom queremos ser", e a resposta certa depende de quanto tempo o dono
// quer gastar por semana na fila de revisão. Estão num bloco só, com o porquê
// escrito, para que mexer neles seja decisão consciente e não ajuste silencioso
// para o teste ficar verde.
// ---------------------------------------------------------------------------
const LIMIARES = {
  // Buraco entre duas janelas de extrato da mesma conta. 3 dias cobre um feriado
  // colado num fim de semana; 4 dias já significa que alguém deixou de importar.
  buracoExtratoDias: 3,

  // Defasagem do último extrato. Além de 5 dias o saldo da tela é ficção e a
  // previsão de caixa da semana está sendo feita sobre dado velho.
  extratoDesatualizadoDias: 5,

  // Cobertura por CONTAGEM de lançamentos. O módulo mira 98%; 95% é o piso onde
  // a fila de revisão ainda cabe numa sessão semanal.
  classificadoPorContagemPct: 95,

  // Cobertura por VALOR. Mais honesta e quase sempre pior: 8.700 tarifas de
  // centavos classificadas inflam a contagem e não movem um centavo do DRE.
  // 90% porque abaixo disso o resultado do mês depende do que está na fila.
  classificadoPorValorPct: 90,

  // Fila de revisão. 300 itens é o que uma pessoa vence em ~2h. Acima disso a
  // fila deixa de ser trabalho e vira paisagem — e ninguém abre mais.
  filaMaxItens: 300,

  // Idade do item mais antigo. 14 dias garante que nada atravesse o fechamento
  // do mês ainda pendente.
  filaMaxIdadeDias: 14,

  // Transferências pareadas. Perna sem par é dinheiro que saiu e não foi visto
  // chegar: ou falta importar a outra conta, ou não era transferência nenhuma.
  transferenciasPareadasPct: 90,

  // Idade de uma perna 'em_transito'. Transferência entre contas próprias
  // liquida em minutos. Passou de 30 dias, o par não vem mais sozinho.
  emTransitoMaxDias: 30,

  // Dias de previsão que já podem ser cobrados contra o realizado. 30 é um
  // ciclo mensal fechado — a menor janela em que folha, DAS e cobrança emitida
  // aparecem TODOS. Aferir 7 dias mediria só a semana de boleto e chamaria isso
  // de erro da previsão.
  previsaoDiasAferidosMin: 30,

  // Acerto da camada `cobranca_emitida` em 30 dias. 95% e não 90%: a premissa
  // `receber_fator = 1,000` afirma que cobrança emitida a vencer entra INTEIRA
  // pelo valor de face no dia do vencimento. É a premissa mais forte da
  // previsão e a que sustenta 79% da entrada projetada; se ela erra mais de 5%,
  // o saldo previsto está alto por construção — e erro para cima é o caro.
  previsaoAcertoCobrancaPct: 95,

  // Contraparte sem CPF/CNPJ. Sem documento não há como detectar que ela é a
  // própria empresa, nem cruzar com nota fiscal.
  contrapartesSemDocumentoPct: 5,

  // Pessoa do time sem contraparte ligada. Meta 0: sem esse elo, folha e
  // reembolso não conseguem apontar para quem recebeu.
  pessoasSemContrapartePct: 0,

  // Divergência entre o saldo da coluna e o saldo reconstruído. Zero. Um ledger
  // que não fecha com ele mesmo não fecha com nada.
  divergenciaSaldoCents: 0,

  // Categorias nunca usadas. Plano de contas com metade das linhas mortas faz o
  // classificador escolher entre opções que ninguém mantém.
  categoriasOciosasPct: 30
};

// ---------------------------------------------------------------------------
const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = (n) => `${Number(n || 0).toFixed(1).replace('.', ',')}%`;
const num = (n) => Number(n || 0).toLocaleString('pt-BR');

const pool = financePool();
const q = async (sql, params = []) => (await pool.query(sql, params)).rows;
const um = async (sql, params = []) => (await q(sql, params))[0] ?? {};

/**
 * Executa com concorrência limitada.
 *
 * Cada consulta custa ~170 ms de ida e volta até o banco — o trabalho no
 * servidor é irrelevante perto da latência. Em série, 60 verificações levam 10
 * segundos, e 10 segundos no boot é tempo que alguém vai querer economizar
 * desligando o verificador. Em três frentes (o teto do financePool) cai para
 * ~3 s, que ninguém tem vontade de pular.
 */
async function comLimite(itens, limite, fn) {
  const fila = [...itens.entries()];
  const trabalhadores = Array.from({ length: Math.min(limite, fila.length) }, async () => {
    for (;;) {
      const proximo = fila.shift();
      if (!proximo) return;
      await fn(proximo[1], proximo[0]);
    }
  });
  await Promise.all(trabalhadores);
}

/**
 * Lê uma consulta de violação. Ela devolve `n` (linhas), `rs` (centavos em jogo)
 * e `ids` (as chaves atingidas — é o que permite somar dinheiro distinto no fim
 * em vez de contar a mesma linha em três invariantes diferentes).
 */
const alvo = async (sql, params = [], tipo = 'tx') => {
  const r = await um(sql, params);
  return { n: Number(r.n || 0), rs: Number(r.rs || 0), [tipo]: (r.ids || []).map(Number) };
};

// ---------------------------------------------------------------------------
// Declaração das verificações. Nada roda aqui: `check()` só registra. A execução
// concorrente vem depois, e a impressão vem depois dela, na ordem de declaração
// — para que a saída seja estável e diffável entre execuções.
// ---------------------------------------------------------------------------
const CHECKS = [];
const check = (secao, id, nome, { afirma, porque }, executor) =>
  CHECKS.push({ secao, id, nome, afirma, porque, executor });

const SECOES = {
  A: 'A. CONTABILIDADE: a empresa não negocia consigo mesma',
  B: 'B. TRANSFERÊNCIAS: dinheiro que sai de um bolso entra no outro',
  C: 'C. LOTES DE IMPORTAÇÃO: o desfazer precisa funcionar',
  D: 'D. CLASSIFICAÇÃO: a categoria tem de fazer sentido com o sinal',
  E: 'E. DECISÃO HUMANA: o que uma pessoa travou fica travado',
  F: 'F. COBERTURA DE EXTRATO: um mês sem extrato é um mês inventado',
  G: 'G. SALDO: o ledger tem de fechar com ele mesmo',
  H: 'H. FILA DE REVISÃO: o que está na fila precisa precisar de revisão',
  I: 'I. DUPLICATAS E CHAVES',
  J: 'J. DATAS'
};

const entidade = await um(`SELECT id, slug, legal_name, cnpj FROM fin_entity WHERE slug = 'xpe'`);
const entityId = entidade.id;

// =========================================================================
// A. CONTABILIDADE
//
// A contraparte com o CNPJ da própria empresa é o erro mais caro que já
// aconteceu aqui: R$ 151.977,33 de transferência interna viraram despesa de
// fornecedor porque alguém criou "XP ENERGY" como contraparte. Nenhuma tela
// acusa — a linha fica perfeita, com nome, documento e categoria.
// =========================================================================
check('A', 'A1', 'nenhuma contraparte carrega o CNPJ da própria empresa', {
  afirma: 'fin_counterparty.document_number ≠ fin_entity.cnpj, comparando só os dígitos',
  porque: 'foi exatamente assim que R$ 151.977,33 de transferência própria entraram como despesa'
}, async () => {
  const linhas = await q(
    `SELECT cp.id, cp.name, cp.document_number
       FROM fin_counterparty cp
       JOIN fin_entity e ON e.id = cp.entity_id
      WHERE coalesce(e.cnpj, '') <> ''
        AND regexp_replace(coalesce(cp.document_number, ''), '[^0-9]', '', 'g')
          = regexp_replace(e.cnpj, '[^0-9]', '', 'g')`
  );
  return { n: linhas.length, rs: 0, detalhes: linhas.map((l) => `contraparte ${l.id} "${l.name}" com o CNPJ da casa`) };
});

check('A', 'A2', 'nenhum lançamento aponta para contraparte que é a própria empresa', {
  afirma: 'fin_transaction.counterparty_id nunca resolve para uma contraparte com o CNPJ da entidade',
  porque: 'lançamento contra si mesmo infla despesa e receita ao mesmo tempo, e o DRE fecha errado dos dois lados'
}, () => alvo(
  `SELECT count(*) n, coalesce(sum(abs(t.amount_cents)), 0) rs, array_agg(t.id) ids
     FROM fin_transaction t
     JOIN fin_counterparty cp ON cp.id = t.counterparty_id
     JOIN fin_entity e ON e.id = t.entity_id
    WHERE coalesce(e.cnpj, '') <> ''
      AND regexp_replace(coalesce(cp.document_number, ''), '[^0-9]', '', 'g')
        = regexp_replace(e.cnpj, '[^0-9]', '', 'g')`
));

check('A', 'A3', 'nenhum documento aponta para contraparte que é a própria empresa', {
  afirma: 'o mesmo de A2, do lado de fin_document',
  porque: 'cobrança contra si mesma vira receita fantasma na carteira a receber'
}, () => alvo(
  `SELECT count(*) n, coalesce(sum(abs(d.amount_cents)), 0) rs, array_agg(d.id) ids
     FROM fin_document d
     JOIN fin_counterparty cp ON cp.id = d.counterparty_id
     JOIN fin_entity e ON e.id = d.entity_id
    WHERE coalesce(e.cnpj, '') <> ''
      AND regexp_replace(coalesce(cp.document_number, ''), '[^0-9]', '', 'g')
        = regexp_replace(e.cnpj, '[^0-9]', '', 'g')`,
  [], 'doc'
));

check('A', 'A4', 'nenhum CNPJ/CPF aparece em duas contrapartes diferentes', {
  afirma: 'fin_counterparty.document_number é único quando preenchido',
  porque: 'contraparte partida em duas divide o histórico, e o classificador por histórico passa a errar nas duas metades'
}, async () => {
  const linhas = await q(
    `SELECT document_number, count(*) n, string_agg(name, ' | ') nomes
       FROM fin_counterparty WHERE coalesce(document_number, '') <> ''
      GROUP BY 1 HAVING count(*) > 1`
  );
  return { n: linhas.length, rs: 0, detalhes: linhas.map((l) => `${l.document_number}: ${l.nomes}`) };
});

// =========================================================================
// B. TRANSFERÊNCIAS
//
// Transferência é a única movimentação que pode ser neutralizada. Por isso é a
// mais perigosa: marcar errado faz R$ 356 mil de pagamento a terceiro sumir da
// despesa sem deixar rastro. As regras aqui tornam a neutralização auditável em
// vez de confiável.
// =========================================================================
check('B', 'B1', "toda linha 'pareado' tem transfer_group_id", {
  afirma: "transfer_status = 'pareado' ⇒ transfer_group_id IS NOT NULL",
  porque: 'sem o grupo, a neutralização não tem como ser conferida nem desfeita'
}, async () => {
  const r = await alvo(
    `SELECT count(*) n, coalesce(sum(abs(amount_cents)), 0) rs, array_agg(id) ids
       FROM fin_transaction WHERE transfer_status = 'pareado' AND transfer_group_id IS NULL`
  );
  const { pareadas } = await um(`SELECT count(*) pareadas FROM fin_transaction WHERE transfer_status = 'pareado'`);
  return { ...r, vacuo: Number(pareadas) === 0 ? 'nenhuma linha pareada existe na base' : null };
});

check('B', 'B2', 'todo grupo de transferência tem exatamente 2 pernas', {
  afirma: 'count(*) = 2 por transfer_group_id',
  porque: 'grupo com 1 perna neutraliza metade do movimento; com 3, neutraliza demais'
}, async () => {
  const linhas = await q(
    `SELECT transfer_group_id g, count(*) n, coalesce(sum(abs(amount_cents)), 0) rs
       FROM fin_transaction WHERE transfer_group_id IS NOT NULL
      GROUP BY 1 HAVING count(*) <> 2`
  );
  const { grupos } = await um(`SELECT count(DISTINCT transfer_group_id) grupos FROM fin_transaction WHERE transfer_group_id IS NOT NULL`);
  return {
    n: linhas.length,
    rs: linhas.reduce((s, l) => s + Number(l.rs), 0),
    detalhes: linhas.map((l) => `grupo ${l.g}: ${l.n} perna(s), ${brl(l.rs)}`),
    vacuo: Number(grupos) === 0 ? 'nenhum grupo de transferência existe na base' : null
  };
});

check('B', 'B3', 'as duas pernas de um grupo somam zero', {
  afirma: 'SUM(amount_cents) = 0 por transfer_group_id',
  porque: 'se não somam zero, a neutralização cria ou destrói dinheiro no consolidado'
}, async () => {
  const linhas = await q(
    `SELECT transfer_group_id g, sum(amount_cents) delta FROM fin_transaction
      WHERE transfer_group_id IS NOT NULL GROUP BY 1 HAVING sum(amount_cents) <> 0`
  );
  return {
    n: linhas.length,
    rs: linhas.reduce((s, l) => s + Math.abs(Number(l.delta)), 0),
    detalhes: linhas.map((l) => `grupo ${l.g} sobra ${brl(l.delta)}`)
  };
});

check('B', 'B4', 'as duas pernas estão em contas diferentes', {
  afirma: 'count(DISTINCT account_id) = 2 por transfer_group_id',
  porque: 'transferência de uma conta para ela mesma não existe — é par montado errado, e some do extrato dos dois lados'
}, async () => {
  const linhas = await q(
    `SELECT transfer_group_id g, coalesce(sum(abs(amount_cents)), 0) rs FROM fin_transaction
      WHERE transfer_group_id IS NOT NULL GROUP BY 1 HAVING count(DISTINCT account_id) < 2`
  );
  return {
    n: linhas.length,
    rs: linhas.reduce((s, l) => s + Number(l.rs), 0),
    detalhes: linhas.map((l) => `grupo ${l.g} inteiro numa conta só`)
  };
});

// Este é o invariante do R$ 356.506,34.
//
// source_kind='TRANSFER' no Asaas quer dizer "saiu para uma conta bancária",
// NÃO "saiu para uma conta nossa". A migração 0023 estreitou a regra 18 para
// exigir o nome da empresa no texto; sem este teste, a próxima regra larga
// reabre o buraco e ninguém percebe até a auditoria seguinte.
//
// ---------------------------------------------------------------------------
// CORREÇÃO DE 16/08/2026: a prova documental entrou na lista de provas aceitas.
// ---------------------------------------------------------------------------
// A versão anterior aceitava três provas: par montado, `counterparty_id` não
// nulo, ou o nome da empresa no texto. A segunda NUNCA pode acontecer, e é o
// invariante A1 deste mesmo arquivo que garante isso: nenhuma fin_counterparty
// pode carregar o CNPJ da própria empresa. Se A1 vale, "contraparte própria"
// não existe como linha, e o ramo estava morto desde que foi escrito.
//
// A prova de titularidade que de fato existe hoje é OUTRA, e é mais forte que
// as duas vivas: `counterparty_document` igual ao CNPJ da entidade. Ela chegou
// depois deste teste, pela 0042 (persistiu o lastro do PIX do Inter) e pela
// 0053. scripts/import-inter.mjs diz isso na íntegra, no comentário do INSERT:
//
//   "O lastro vai para o banco INCLUSIVE quando é o CNPJ da própria empresa —
//    ali ele é justamente o que prova a transferência interna. Note que
//    `counterparty_id` continua nulo nesse caso: a empresa não é contraparte de
//    si mesma. O documento fica no lançamento, não no cadastro."
//
// E é exatamente o predicado que a 0059 usou como evidência estrutural para
// reclassificar 81 transferências próprias — 156 linhas irmãs destas 5, mesmo
// CNPJ, mesma categoria 9.01, já pareadas e por isso invisíveis a este teste.
//
// Trocar texto por documento não afrouxa o invariante: aperta. "XPE Tecnologia"
// e "XP ENERGY SERVICOS" são a mesma empresa e nenhuma comparação de nome diria
// isso — o CNPJ diz.
check('B', 'B5', 'transferência própria não pode ter só o source_kind como prova de titularidade', {
  afirma: 'perna marcada como transferência entre contas próprias precisa de par, do CNPJ da empresa no documento da contraparte OU do nome da empresa no texto',
  porque: 'tratar TRANSFER como prova de titularidade escondeu R$ 356.506,34 de pagamento a terceiro dentro da despesa'
}, async () => {
  const linhas = await q(
    `WITH marca AS (
       SELECT lower(split_part(legal_name, ' ', 1) || ' ' || split_part(legal_name, ' ', 2)) nome,
              regexp_replace(cnpj, '[^0-9]', '', 'g') cnpj
         FROM fin_entity WHERE id = $1
     )
     SELECT t.id, t.posted_on, t.amount_cents, left(t.description_raw, 58) d
       FROM fin_transaction t, marca m
      WHERE t.transfer_status <> 'nao'
        AND t.transfer_group_id IS NULL
        AND t.counterparty_id IS NULL
        AND coalesce(t.counterparty_document, '') <> m.cnpj
        AND t.source_kind IN ('TRANSFER', 'PIX', 'TED')
        AND position(m.nome IN lower(t.description_norm)) = 0
      ORDER BY abs(t.amount_cents) DESC`,
    [entityId]
  );
  return {
    n: linhas.length,
    rs: linhas.reduce((s, l) => s + Math.abs(Number(l.amount_cents)), 0),
    tx: linhas.map((l) => Number(l.id)),
    detalhes: linhas.map((l) => `tx ${l.id} ${l.posted_on} ${brl(l.amount_cents)} — "${l.d}"`)
  };
});

// =========================================================================
// C. LOTES
//
// Um lote é uma promessa: "isto eu sei desfazer". Lote que declara 150 inserções
// sem linha nenhuma atrás quebra a promessa em silêncio — e só descobre quem
// tenta desfazer, no pior momento possível.
// =========================================================================
check('C', 'C1', 'lote confirmado tem inserted_count igual à contagem real de lançamentos', {
  afirma: 'fin_import_batch.inserted_count = count(fin_transaction WHERE import_batch_id = lote)',
  porque: 'o número que a tela mostra e o que o desfazer vai remover têm de ser o mesmo'
}, async () => {
  const linhas = await q(
    `SELECT b.id, b.inserted_count declarado,
            (SELECT count(*) FROM fin_transaction t WHERE t.import_batch_id = b.id) real
       FROM fin_import_batch b
      WHERE b.status = 'confirmado'
        AND b.inserted_count <> (SELECT count(*) FROM fin_transaction t WHERE t.import_batch_id = b.id)`
  );
  return { n: linhas.length, rs: 0, detalhes: linhas.map((l) => `lote ${l.id}: declara ${l.declarado}, existem ${l.real}`) };
});

check('C', 'C2', 'nenhum lote confirmado com zero lançamentos', {
  afirma: 'lote confirmado sempre tem pelo menos 1 fin_transaction',
  porque: 'lote confirmado vazio é importação que não importou nada e mesmo assim marcou o período como coberto'
}, async () => {
  const linhas = await q(
    `SELECT b.id, b.file_name FROM fin_import_batch b
      WHERE b.status = 'confirmado' AND NOT EXISTS (SELECT 1 FROM fin_transaction t WHERE t.import_batch_id = b.id)`
  );
  return { n: linhas.length, rs: 0, detalhes: linhas.map((l) => `lote ${l.id} (${l.file_name})`) };
});

check('C', 'C3', 'lote confirmado tem trilha em fin_import_row', {
  afirma: 'lote confirmado sempre tem linhas em fin_import_row',
  porque: 'sem a trilha da linha crua não há preview, não há dedupe auditável e o desfazer não sabe o que reverter'
}, async () => {
  const linhas = await q(
    `SELECT b.id, b.adapter,
            (SELECT count(*) FROM fin_transaction t WHERE t.import_batch_id = b.id) tx,
            (SELECT coalesce(sum(abs(t.amount_cents)), 0) FROM fin_transaction t WHERE t.import_batch_id = b.id) rs,
            (SELECT coalesce(array_agg(t.id), '{}') FROM fin_transaction t WHERE t.import_batch_id = b.id) ids
       FROM fin_import_batch b
      WHERE b.status = 'confirmado' AND NOT EXISTS (SELECT 1 FROM fin_import_row r WHERE r.batch_id = b.id)
      ORDER BY 4 DESC`
  );
  return {
    n: linhas.length,
    rs: linhas.reduce((s, l) => s + Number(l.rs), 0),
    tx: linhas.flatMap((l) => (l.ids || []).map(Number)),
    detalhes: linhas.map((l) => `lote ${l.id} (${l.adapter}) — ${num(l.tx)} lançamentos, ${brl(l.rs)}, zero linhas cruas`)
  };
});

check('C', 'C4', 'lote revertido ou descartado não deixou lançamento vivo', {
  afirma: "status IN ('revertido','descartado') ⇒ nenhuma fin_transaction aponta para ele",
  porque: 'lançamento órfão de lote desfeito é dinheiro contado duas vezes na próxima importação do mesmo arquivo'
}, () => alvo(
  `SELECT count(*) n, coalesce(sum(abs(t.amount_cents)), 0) rs, array_agg(t.id) ids
     FROM fin_transaction t JOIN fin_import_batch b ON b.id = t.import_batch_id
    WHERE b.status IN ('revertido', 'descartado')`
));

check('C', 'C5', 'nenhum lote insere mais linhas do que leu', {
  afirma: 'inserted_count ≤ row_count',
  porque: 'inserir mais do que o arquivo tinha só é possível duplicando, e duplicata em extrato é saldo errado'
}, async () => {
  const linhas = await q(`SELECT id, row_count, inserted_count FROM fin_import_batch WHERE inserted_count > row_count`);
  return { n: linhas.length, rs: 0, detalhes: linhas.map((l) => `lote ${l.id}: leu ${l.row_count}, inseriu ${l.inserted_count}`) };
});

// =========================================================================
// D. CLASSIFICAÇÃO
// =========================================================================
check('D', 'D1', 'nenhuma classificação aponta para regra inexistente ou inativa', {
  afirma: "classified_rule_id sempre resolve para uma fin_rule com status = 'ativa'",
  porque: 'classificação órfã não tem como ser explicada no "por quê?" nem reprocessada quando a regra muda'
}, () => alvo(
  `SELECT count(*) n, coalesce(sum(abs(t.amount_cents)), 0) rs, array_agg(t.id) ids
     FROM fin_transaction t LEFT JOIN fin_rule r ON r.id = t.classified_rule_id
    WHERE t.classified_rule_id IS NOT NULL AND (r.id IS NULL OR r.status <> 'ativa')`
));

// O invariante do "POSTO".
//
// Um cliente chamado "POSTO IPIRANGA" pagando uma fatura casou com a regra de
// combustível: receita virou despesa. A assinatura do erro é estrutural e não
// depende de texto nenhum — categoria de despesa carimbada numa ENTRADA.
//
// Estorno e reembolso recebidos são a exceção legítima: são dinheiro voltando
// que abate a despesa original. Ficam de fora deste invariante e viram o monitor
// M11, porque decidir se abatem a despesa ou viram receita é convenção contábil
// — escolha do dono, não defeito do sistema.
check('D', 'D2', 'nenhuma categoria de despesa em lançamento de ENTRADA', {
  afirma: 'categoria de custo/despesa/pessoal/imposto/investimento ⇒ amount_cents < 0 (fora estorno e reembolso)',
  porque: 'é a assinatura exata do bug do "POSTO": cliente com nome de fornecedor vira despesa e some da receita'
}, async () => {
  const linhas = await q(
    `SELECT t.id, t.posted_on, t.amount_cents, c.code, c.name, left(t.description_raw, 46) d, t.classified_by
       FROM fin_transaction t JOIN fin_category c ON c.id = t.category_id
      WHERE NOT t.is_split_parent AND t.amount_cents > 0
        AND c.kind IN ('custo_variavel_direto', 'despesa_operacional', 'pessoal', 'imposto', 'investimento')
        AND lower(t.description_norm) !~ '(estorno|reembolso|devolu|refund|cancelamento)'
      ORDER BY t.amount_cents DESC`
  );
  return {
    n: linhas.length,
    rs: linhas.reduce((s, l) => s + Number(l.amount_cents), 0),
    tx: linhas.map((l) => Number(l.id)),
    detalhes: linhas.map((l) => `tx ${l.id} ${l.posted_on} +${brl(l.amount_cents)} → ${l.code} ${l.name} (${l.classified_by}) "${l.d}"`)
  };
});

check('D', 'D3', 'nenhuma categoria de receita em lançamento de SAÍDA', {
  afirma: "categoria kind = 'receita' ⇒ amount_cents > 0",
  porque: 'o espelho do D2: despesa carimbada como receita infla o faturamento e o imposto calculado sobre ele'
}, () => alvo(
  `SELECT count(*) n, coalesce(sum(abs(t.amount_cents)), 0) rs, array_agg(t.id) ids
     FROM fin_transaction t JOIN fin_category c ON c.id = t.category_id
    WHERE NOT t.is_split_parent AND t.amount_cents < 0 AND c.kind = 'receita'`
));

check('D', 'D4', 'documento a receber não carrega categoria de despesa, nem o contrário', {
  afirma: "direction = 'receber' ⇒ categoria de receita/movimentação; 'pagar' ⇒ nunca receita",
  porque: 'mesma classe do D2, do lado da carteira: contamina DRE e previsão de caixa de uma vez'
}, () => alvo(
  `SELECT count(*) n, coalesce(sum(abs(d.amount_cents)), 0) rs, array_agg(d.id) ids
     FROM fin_document d JOIN fin_category c ON c.id = d.category_id
    WHERE (d.direction = 'receber' AND c.kind IN ('custo_variavel_direto', 'despesa_operacional', 'pessoal', 'imposto', 'investimento'))
       OR (d.direction = 'pagar' AND c.kind = 'receita')`,
  [], 'doc'
));

// 'fato_estrutural' é o único carimbo que dispensa revisão humana: significa
// "veio da fonte". Se um LIKE sobre texto livre puder carimbá-lo, a distinção
// some e a fila de revisão para de enxergar o que precisa de olho.
//
// ---------------------------------------------------------------------------
// CORREÇÃO DE 16/08/2026: a evidência estrutural deixou de ser só `source_kind`.
// ---------------------------------------------------------------------------
// Quando este invariante foi escrito, `source_kind` era o único campo estrutural
// que o ledger tinha. Não é mais, e as fontes novas são tão duras quanto ele:
//
//   documento_da_contraparte     0059 — CNPJ da contraparte, do lastro do PIX
//   tipo_declarado_pela_fonte    classificar-fila.mjs — o Asaas declara o tipo
//   perna_irma_do_grupo_de_transferencia — o par já conciliado
//   categoria_padrao_da_pessoa   0050 — cadastro de fin_person
//
// Manter a exigência literal de `campo='source_kind'` reprovaria 143 lançamentos
// (R$ 1.039.051,08) cuja evidência é MELHOR que um source_kind — o CNPJ resolve
// o que o nome esconde — e ainda deixaria passar o que o invariante existe para
// pegar, se um dia alguém carimbasse `campo='source_kind'` sem ter olhado.
//
// A regra fica dita pelo que ela sempre quis dizer, e com mais dentes:
//
//   1. fato_estrutural TEM de declarar a evidência (campo ou origem). Carimbo
//      sem evidência nenhuma era metade das violações e é indefensável.
//   2. A evidência TEM de estar na lista fechada abaixo.
//   3. Campo de TEXTO LIVRE nunca entra na lista, que é o buraco original.
//
// Ampliar a lista é decisão consciente: exige editar esta constante, com o nome
// da migration que criou a evidência ao lado.
const EVIDENCIA_ESTRUTURAL = [
  'source_kind',                          // o tipo que a fonte declara (0002)
  'documento_da_contraparte',             // CNPJ da contraparte (0042 · 0059)
  'tipo_declarado_pela_fonte',            // Asaas declara PAYMENT_RECEIVED (classificar-fila)
  'perna_irma_do_grupo_de_transferencia', // o par já conciliado (0044)
  'categoria_padrao_da_pessoa'            // cadastro de fin_person (0050)
];

check('D', 'D5', "'fato_estrutural' só quando a evidência vem da fonte", {
  afirma: `classified_by = 'fato_estrutural' ⇒ a evidência declarada está em {${EVIDENCIA_ESTRUTURAL.join(', ')}} — nunca um campo de texto livre`,
  porque: 'palpite sobre texto livre carimbado como fato dispensa a revisão exatamente onde ela mais faz falta'
}, async () => {
  const linhas = await q(
    `SELECT coalesce(t.classified_reason->>'campo',
                     t.classified_reason->>'origem', '(sem evidência)') campo,
            count(*) n, coalesce(sum(abs(t.amount_cents)), 0) rs, array_agg(t.id) ids
       FROM fin_transaction t
      WHERE t.classified_by = 'fato_estrutural'
        AND coalesce(t.classified_reason->>'campo',
                     t.classified_reason->>'origem', '') <> ALL ($1::text[])
      GROUP BY 1 ORDER BY 3 DESC`,
    [EVIDENCIA_ESTRUTURAL]
  );
  return {
    n: linhas.reduce((s, l) => s + Number(l.n), 0),
    rs: linhas.reduce((s, l) => s + Number(l.rs), 0),
    tx: linhas.flatMap((l) => (l.ids || []).map(Number)),
    detalhes: linhas.map((l) => `evidência "${l.campo}": ${num(l.n)} lançamentos, ${brl(l.rs)}`)
  };
});

// POR QUE 'fato_estrutural' PODE CARREGAR rule_id SEM DIZER 'regra'.
//
// Não é frouxidão do predicado: `estagioDe(hit)` — import-asaas.mjs e
// reclassificar.mjs — devolve 'fato_estrutural' quando a regra casou pelo
// `source_kind`, ou seja, quando a evidência é o tipo que a FONTE declara, e não
// um palpite sobre texto. Nesses casos uma regra decidiu de verdade: o id é
// obrigatório e correto; só o nome do estágio muda, porque
// `WHERE classified_by = 'fato_estrutural'` precisa continuar significando "veio
// da fonte, confiável sem revisão". Quem policia essa promessa é o D5.
//
// A isenção foi AFERIDA em 16/08/2026, não presumida: das 8.993 linhas com
// classified_by='fato_estrutural' e classified_rule_id preenchido, 8.993
// carregam exatamente a categoria que a regra delas declara em
// `fin_rule.actions->>'category_code'`, em 9 regras distintas. Zero divergência.
// Nenhuma população de id órfão de decisão está escondida aqui.
//
// BURACO CONHECIDO, medido e hoje vazio: este predicado não verifica se a regra
// citada realmente produziu a categoria da linha. A patologia que ele acabou de
// pegar em `contrato` (a 0091: um UPDATE posterior sobrescreve o estágio e deixa
// o rule_id para trás) passaria despercebida se caísse em 'fato_estrutural'. A
// consulta que fecha esse flanco é a comparação acima, entre `fin_category.code`
// e `actions->>'category_code'` — vale re-rodá-la antes de confiar no verde.
check('D', 'D6', 'proveniência coerente: regra tem id, id tem regra', {
  afirma: "classified_by = 'regra' ⇒ classified_rule_id IS NOT NULL, e vice-versa",
  porque: 'sem o par completo o badge "por quê?" mente sobre quem decidiu'
}, () => alvo(
  `SELECT count(*) n, coalesce(sum(abs(amount_cents)), 0) rs, array_agg(id) ids FROM fin_transaction
    WHERE (classified_by = 'regra' AND classified_rule_id IS NULL)
       OR (classified_rule_id IS NOT NULL AND classified_by NOT IN ('regra', 'fato_estrutural'))`
));

// Sem `rs`: nenhum centavo está errado por causa de um contador zerado. O que
// quebra é o instrumento — a tela de regras não consegue mais mostrar qual
// regra está larga demais. Dar R$ a isto jogaria D7 para o topo do ranking e
// empurraria para baixo defeitos que de fato mexem em dinheiro.
check('D', 'D7', 'regra que classificou tem hits_count contando', {
  afirma: 'fin_rule.hits_count > 0 sempre que existe lançamento com aquele classified_rule_id',
  porque: 'hits_count é o que ordena a tela de regras e revela regra larga demais; zerado, as 48 regras parecem igualmente inúteis. Nenhum valor está errado por isso — o que se perde é o instrumento de achar o próximo erro'
}, async () => {
  const linhas = await q(
    `SELECT r.id, r.slug, count(t.id) reais, coalesce(sum(abs(t.amount_cents)), 0) rs
       FROM fin_rule r JOIN fin_transaction t ON t.classified_rule_id = r.id
      GROUP BY 1, 2, r.hits_count HAVING r.hits_count = 0 ORDER BY 3 DESC`
  );
  return {
    n: linhas.length,
    rs: 0,
    detalhes: linhas.map((l) => `regra ${l.id} "${l.slug}": hits_count=0 mas classificou ${num(l.reais)} lançamentos (${brl(l.rs)})`)
  };
});

// =========================================================================
// E. DECISÃO HUMANA
//
// A sincronização noturna sobrescreve tudo que não está travado. Se a trava
// vazar, o trabalho de classificação da véspera é apagado toda madrugada e a
// fila de revisão vira trabalho de Sísifo.
// =========================================================================
check('E', 'E1', 'linha travada foi classificada por gente', {
  afirma: "human_locked_fields <> '{}' ⇒ classified_by IN ('humano','trava')",
  porque: 'trava com carimbo de máquina é trava que a próxima sincronização vai ignorar'
}, async () => {
  const linhas = await q(
    `SELECT id, human_locked_fields, classified_by, abs(amount_cents) rs FROM fin_transaction
      WHERE human_locked_fields <> '{}' AND coalesce(classified_by, '') NOT IN ('humano', 'trava')`
  );
  const { travadas } = await um(`SELECT count(*) travadas FROM fin_transaction WHERE human_locked_fields <> '{}'`);
  return {
    n: linhas.length,
    rs: linhas.reduce((s, l) => s + Number(l.rs), 0),
    tx: linhas.map((l) => Number(l.id)),
    detalhes: linhas.map((l) => `tx ${l.id}: travou ${l.human_locked_fields} mas classified_by=${l.classified_by}`),
    vacuo: Number(travadas) === 0 ? 'nenhuma linha travada na base' : null
  };
});

check('E', 'E2', 'campo travado não está vazio', {
  afirma: "'category_id' em human_locked_fields ⇒ category_id IS NOT NULL",
  porque: 'travar um campo e deixá-lo nulo congela o vazio: a linha nunca mais é classificada por ninguém'
}, () => alvo(
  `SELECT count(*) n, coalesce(sum(abs(amount_cents)), 0) rs, array_agg(id) ids FROM fin_transaction
    WHERE ('category_id' = ANY(human_locked_fields) AND category_id IS NULL)
       OR ('nucleo' = ANY(human_locked_fields) AND nucleo IS NULL)`
));

check('E', 'E3', "'adiado' e 'ignorado' não voltam para a fila", {
  afirma: "nenhum fin_review_item 'pendente' aponta para linha com review_status IN ('adiado','ignorado')",
  porque: 'reabrir o que a pessoa já decidiu adiar é a forma mais rápida de fazer alguém abandonar a fila'
}, async () => {
  const r = await alvo(
    `SELECT count(*) n, coalesce(sum(abs(ri.amount_cents)), 0) rs, array_agg(t.id) ids
       FROM fin_review_item ri JOIN fin_transaction t ON t.id = ri.target_id AND ri.target_table = 'fin_transaction'
      WHERE ri.status = 'pendente' AND t.review_status IN ('adiado', 'ignorado')`
  );
  const { decididos } = await um(`SELECT count(*) decididos FROM fin_transaction WHERE review_status IN ('adiado', 'ignorado')`);
  return { ...r, vacuo: Number(decididos) === 0 ? "ninguém usou 'adiado'/'ignorado' ainda" : null };
});

// =========================================================================
// F. COBERTURA DE EXTRATO
// =========================================================================
check('F', 'F1', 'toda conta ativa tem cobertura de extrato declarada', {
  afirma: 'existe pelo menos uma fin_statement_coverage por fin_account com is_active',
  porque: 'conta ativa sem extrato nenhum entra no saldo consolidado como zero — e zero parece um número legítimo'
}, async () => {
  const linhas = await q(
    `SELECT a.id, a.slug, a.current_balance_cents saldo FROM fin_account a
      WHERE a.is_active AND NOT EXISTS (SELECT 1 FROM fin_statement_coverage sc WHERE sc.account_id = a.id)
      ORDER BY a.id`
  );
  return {
    n: linhas.length,
    rs: linhas.reduce((s, l) => s + Math.abs(Number(l.saldo)), 0),
    detalhes: linhas.map((l) => `conta ${l.id} "${l.slug}" ativa, zero janela de extrato (saldo declarado ${brl(l.saldo)})`)
  };
});

check('F', 'F2', `sem buraco maior que ${LIMIARES.buracoExtratoDias} dias dentro da cobertura de cada conta`, {
  afirma: 'janelas consecutivas de fin_statement_coverage não deixam intervalo descoberto',
  porque: 'buraco no meio do extrato é despesa que existiu e não está no ledger — o saldo fecha e o DRE não'
}, async () => {
  const linhas = await q(
    `WITH janelas AS (
       SELECT account_id, period_start, period_end,
              max(period_end) OVER (PARTITION BY account_id ORDER BY period_start
                                    ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) fim_anterior
         FROM fin_statement_coverage
     )
     SELECT a.slug, j.fim_anterior, j.period_start, (j.period_start - j.fim_anterior - 1) dias
       FROM janelas j JOIN fin_account a ON a.id = j.account_id
      WHERE j.fim_anterior IS NOT NULL AND (j.period_start - j.fim_anterior - 1) > $1
      ORDER BY 4 DESC`,
    [LIMIARES.buracoExtratoDias]
  );
  return {
    n: linhas.length,
    rs: 0,
    detalhes: linhas.map((l) => `conta "${l.slug}": ${l.dias} dias sem extrato entre ${l.fim_anterior} e ${l.period_start}`)
  };
});

check('F', 'F3', 'todo lançamento cai dentro de alguma janela de cobertura', {
  afirma: 'existe fin_statement_coverage cobrindo o posted_on de cada fin_transaction',
  porque: 'lançamento fora da cobertura declarada entrou por caminho não registrado — o oposto do F2 e igualmente cego'
}, () => alvo(
  `SELECT count(*) n, coalesce(sum(abs(t.amount_cents)), 0) rs, array_agg(t.id) ids FROM fin_transaction t
    WHERE NOT EXISTS (SELECT 1 FROM fin_statement_coverage sc
                       WHERE sc.account_id = t.account_id AND t.posted_on BETWEEN sc.period_start AND sc.period_end)`
));

// =========================================================================
// G. SALDO
// =========================================================================
const saldos = await q(
  `SELECT a.id, a.slug, a.opening_balance_cents abertura, a.current_balance_cents coluna,
          coalesce(sum(t.amount_cents) FILTER (WHERE NOT t.is_split_parent), 0) soma,
          a.opening_balance_cents + coalesce(sum(t.amount_cents) FILTER (WHERE NOT t.is_split_parent), 0)
            - a.current_balance_cents delta
     FROM fin_account a LEFT JOIN fin_transaction t ON t.account_id = a.id
    GROUP BY a.id ORDER BY a.id`
);

check('G', 'G1', 'current_balance_cents = abertura + soma dos lançamentos, conta a conta', {
  afirma: 'fin_account.current_balance_cents é reconstruível a partir do ledger',
  porque: 'a coluna é o que a tela mostra; a soma é o que existe. Divergentes, a plataforma exibe um número que nada sustenta'
}, async () => {
  const ruins = saldos.filter((s) => Math.abs(Number(s.delta)) > LIMIARES.divergenciaSaldoCents);
  return {
    n: ruins.length,
    rs: ruins.reduce((s, l) => s + Math.abs(Number(l.delta)), 0),
    conta: true,
    detalhes: ruins.map((l) => `conta "${l.slug}": coluna ${brl(l.coluna)}, reconstruído ${brl(Number(l.abertura) + Number(l.soma))}, delta ${brl(l.delta)}`)
  };
});

check('G', 'G2', 'nenhum snapshot de saldo com variância', {
  afirma: 'fin_balance_snapshot.variance_cents = 0',
  porque: 'variância registrada é a própria fonte dizendo que o ledger não bate com o banco naquele dia'
}, async () => {
  const linhas = await q(`SELECT account_id, date, variance_cents FROM fin_balance_snapshot WHERE coalesce(variance_cents, 0) <> 0`);
  return {
    n: linhas.length,
    rs: linhas.reduce((s, l) => s + Math.abs(Number(l.variance_cents)), 0),
    conta: true,
    detalhes: linhas.map((l) => `conta ${l.account_id} em ${l.date}: ${brl(l.variance_cents)}`)
  };
});

// =========================================================================
// H. FILA DE REVISÃO
//
// A fila é o único lugar onde trabalho humano é alocado. Ruído nela é caro de um
// jeito específico: não faz nada errado aparecer, faz o certo desaparecer no
// meio. 503 itens apontando para linhas JÁ classificadas foi o que a auditoria
// achou — R$ 368 mil de fila que não era fila.
// =========================================================================
// ---------------------------------------------------------------------------
// CORREÇÃO DE 16/08/2026: o motivo do item decide o que é ruído.
// ---------------------------------------------------------------------------
// A versão anterior de H1/H2 dizia "item pendente ⇒ alvo sem categoria", e isso
// contradiz o próprio esquema. A 0004 define SETE motivos, e um deles —
// `baixa_confianca` — só é escrito por scripts/import-asaas.mjs no ramo em que o
// documento JÁ TEM categoria:
//
//   CASE WHEN d.category_id IS NULL AND (...) THEN 'texto_generico'
//        WHEN d.category_id IS NULL           THEN 'sem_categoria'
//        ELSE                                      'baixa_confianca' END
//
// 'baixa_confianca' é literalmente "classifiquei, confirme para mim". Exigir que
// o alvo dele não tenha categoria proíbe a revisão de confiança de existir — e
// as 413 violações do lado do documento eram 413 de 413 desse motivo, ou seja,
// zero defeito real e um invariante pedindo para apagar a fila de conferência.
//
// E a correção anda para o outro lado também: 'a classificar' (3.99 e 5.99) NÃO
// tira a linha da fila. É o marcador de indeciso, e contá-lo como classificado é
// o mesmo vício que infla o indicador de categoria para 96,5% quando o real é
// 90,9%. Item pendente sobre uma linha em 5.99 é trabalho de verdade.
const MOTIVO_EXIGE_SEM_CATEGORIA = ['sem_categoria', 'texto_generico'];
const CODIGO_A_CLASSIFICAR = ['3.99', '5.99'];

check('H', 'H1', 'nenhum item pendente aponta para lançamento que já tem categoria', {
  afirma: "fin_review_item 'pendente' de motivo sem_categoria/texto_generico ⇒ a fin_transaction alvo está sem categoria ou em 'a classificar'",
  porque: 'a auditoria achou 503 destes, R$ 368 mil de ruído que empurra o trabalho real para fora da tela'
}, () => alvo(
  `SELECT count(*) n, coalesce(sum(abs(ri.amount_cents)), 0) rs, array_agg(t.id) ids
     FROM fin_review_item ri
     JOIN fin_transaction t ON t.id = ri.target_id AND ri.target_table = 'fin_transaction'
     JOIN fin_category c ON c.id = t.category_id
    WHERE ri.status = 'pendente' AND ri.reason = ANY ($1::text[]) AND c.code <> ALL ($2::text[])`,
  [MOTIVO_EXIGE_SEM_CATEGORIA, CODIGO_A_CLASSIFICAR]
));

check('H', 'H2', 'nenhum item pendente aponta para documento que já tem categoria', {
  afirma: "fin_review_item 'pendente' de motivo sem_categoria/texto_generico ⇒ o fin_document alvo está sem categoria ou em 'a classificar'",
  porque: 'mesmo ruído do H1 do lado da carteira'
}, () => alvo(
  `SELECT count(*) n, coalesce(sum(abs(ri.amount_cents)), 0) rs, array_agg(d.id) ids
     FROM fin_review_item ri
     JOIN fin_document d ON d.id = ri.target_id AND ri.target_table = 'fin_document'
     JOIN fin_category c ON c.id = d.category_id
    WHERE ri.status = 'pendente' AND ri.reason = ANY ($1::text[]) AND c.code <> ALL ($2::text[])`,
  [MOTIVO_EXIGE_SEM_CATEGORIA, CODIGO_A_CLASSIFICAR],
  'doc'
));

// H3 cobria só `category_id IS NULL` e por isso não via 189 lançamentos —
// 126 em 5.99 e 63 em 3.99 — que dizem "não sei o que é isso" e não tinham item
// pendente em lugar nenhum. Dos 189, 184 tinham item marcado `resolvido`.
//
// A causa é a mesma dos outros três lugares onde 5.99 enganou (a view da 0055,
// o indicador do painel, a fila de revisão): as categorias terminadas em .99
// passam em qualquer teste que pergunte apenas "tem categoria?".
//
// A constante `CODIGO_A_CLASSIFICAR` já existia neste arquivo e já era usada em
// H1 e H2, do lado do documento. Só faltava aqui, do lado do lançamento.
check('H', 'H3', 'nenhum lançamento indeciso fica fora da fila', {
  afirma: "category_id IS NULL ou em 3.99/5.99 ⇒ existe fin_review_item pendente para ele",
  porque: 'o simétrico do H1 e o mais caro: dinheiro indeciso e sem fila não aparece em lugar nenhum — nem no DRE (5.99 soma em despesa administrativa, 3.99 em receita bruta, as duas mentindo), nem na lista de pendências'
}, () => alvo(
  `SELECT count(*) n, coalesce(sum(abs(t.amount_cents)), 0) rs, array_agg(t.id) ids FROM fin_transaction t
     LEFT JOIN fin_category c ON c.id = t.category_id
    WHERE NOT t.is_split_parent
      AND (t.category_id IS NULL OR c.code = ANY ($1::text[]))
      AND NOT EXISTS (SELECT 1 FROM fin_review_item ri
                       WHERE ri.target_table = 'fin_transaction' AND ri.target_id = t.id AND ri.status = 'pendente')`,
  [CODIGO_A_CLASSIFICAR]
));

check('H', 'H4', "lançamento marcado 'pendente' tem item de fila", {
  afirma: "review_status = 'pendente' ⇒ existe fin_review_item pendente correspondente",
  porque: 'a coluna diz "precisa de revisão" e a fila não mostra: a pendência existe e é invisível'
}, () => alvo(
  `SELECT count(*) n, coalesce(sum(abs(t.amount_cents)), 0) rs, array_agg(t.id) ids FROM fin_transaction t
    WHERE t.review_status = 'pendente'
      AND NOT EXISTS (SELECT 1 FROM fin_review_item ri
                       WHERE ri.target_table = 'fin_transaction' AND ri.target_id = t.id AND ri.status = 'pendente')`
));

check('H', 'H5', 'nenhum item de fila aponta para alvo inexistente', {
  afirma: 'fin_review_item.target_id sempre resolve na tabela que target_table indica',
  porque: 'item órfão quebra a tela de revisão ao abrir e não tem como ser resolvido nem descartado'
}, async () => {
  const r = await um(
    `SELECT count(*) n, coalesce(sum(abs(ri.amount_cents)), 0) rs FROM fin_review_item ri
      WHERE (ri.target_table = 'fin_transaction' AND NOT EXISTS (SELECT 1 FROM fin_transaction t WHERE t.id = ri.target_id))
         OR (ri.target_table = 'fin_document' AND NOT EXISTS (SELECT 1 FROM fin_document d WHERE d.id = ri.target_id))`
  );
  return { n: Number(r.n), rs: Number(r.rs), conta: true };
});

// =========================================================================
// I. DUPLICATAS E CHAVES
// =========================================================================
check('I', 'I1', 'todo lançamento tem dedupe_hash', {
  afirma: "dedupe_hash IS NOT NULL AND <> ''",
  porque: 'sem hash o índice único não protege, e a próxima importação do mesmo arquivo entra inteira de novo'
}, () => alvo(
  `SELECT count(*) n, coalesce(sum(abs(amount_cents)), 0) rs, array_agg(id) ids
     FROM fin_transaction WHERE coalesce(dedupe_hash, '') = ''`
));

check('I', 'I2', 'nenhum (source, source_id) repetido', {
  afirma: 'a chave natural da fonte é única',
  porque: 'mesma cobrança do Asaas em duas linhas conta o recebimento duas vezes'
}, async () => {
  const linhas = await q(
    `SELECT source, source_id, count(*) n FROM fin_transaction
      WHERE source_id IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1`
  );
  return { n: linhas.length, rs: 0, detalhes: linhas.map((l) => `${l.source}/${l.source_id} aparece ${l.n}x`) };
});

check('I', 'I3', 'nenhuma referência órfã em fin_transaction', {
  afirma: 'category_id, counterparty_id, nucleo e import_batch_id sempre resolvem',
  porque: 'referência quebrada some do JOIN em silêncio: a linha existe na soma total e não em nenhum agrupamento'
}, async () => {
  const r = await um(
    `SELECT
       (SELECT count(*) FROM fin_transaction t WHERE t.category_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM fin_category c WHERE c.id = t.category_id)) a,
       (SELECT count(*) FROM fin_transaction t WHERE t.counterparty_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM fin_counterparty c WHERE c.id = t.counterparty_id)) b,
       (SELECT count(*) FROM fin_transaction t WHERE t.nucleo IS NOT NULL AND NOT EXISTS (SELECT 1 FROM fin_nucleo n WHERE n.slug = t.nucleo)) c,
       (SELECT count(*) FROM fin_transaction t WHERE t.import_batch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM fin_import_batch b WHERE b.id = t.import_batch_id)) d`
  );
  const total = Number(r.a) + Number(r.b) + Number(r.c) + Number(r.d);
  return { n: total, rs: 0, conta: true, detalhes: [`categoria ${r.a}, contraparte ${r.b}, núcleo ${r.c}, lote ${r.d}`] };
});

// =========================================================================
// J. DATAS
// =========================================================================
check('J', 'J1', 'nenhum lançamento no futuro', {
  afirma: 'posted_on ≤ hoje',
  porque: 'extrato é passado. Data futura é erro de leitura de formato (dd/mm lido como mm/dd) e joga dinheiro para fora do mês'
}, () => alvo(
  `SELECT count(*) n, coalesce(sum(abs(amount_cents)), 0) rs, array_agg(id) ids
     FROM fin_transaction WHERE posted_on > CURRENT_DATE`
));

check('J', 'J2', 'nenhum lançamento antes da abertura da conta', {
  afirma: 'posted_on ≥ fin_account.opening_balance_date',
  porque: 'movimento anterior à abertura não é reconciliável contra o saldo inicial: o ledger nunca vai fechar'
}, async () => {
  const r = await alvo(
    `SELECT count(*) n, coalesce(sum(abs(t.amount_cents)), 0) rs, array_agg(t.id) ids
       FROM fin_transaction t JOIN fin_account a ON a.id = t.account_id
      WHERE a.opening_balance_date IS NOT NULL AND t.posted_on < a.opening_balance_date`
  );
  const { sem, total } = await um(
    `SELECT count(*) FILTER (WHERE opening_balance_date IS NULL) sem, count(*) total FROM fin_account`
  );
  return { ...r, vacuo: Number(sem) === Number(total) ? `nenhuma das ${total} contas tem opening_balance_date preenchida` : null };
});

check('J', 'J3', 'competência coerente com a evidência declarada', {
  afirma: 'competence_date é exatamente a data da fonte declarada em competence_rule',
  porque: 'atraso de 300 dias pode ser verdadeiro; erro é a regra dizer "nota" e a data não ser a emissão daquela nota'
}, async () => {
  const r = await alvo(
    `WITH evidencia AS (
       SELECT t.id, t.amount_cents, t.competence_date, t.competence_rule,
              CASE t.competence_rule
                WHEN 'nota_fiscal_emissao'      THEN fd.issue_date
                WHEN 'cobranca_vencimento'      THEN d.due_date
                WHEN 'documento_fiscal_despesa' THEN d.issue_date
                WHEN 'folha_mes_referencia'     THEN
                  CASE WHEN extract(day FROM t.posted_on) <= 5
                       THEN (date_trunc('month', t.posted_on) - interval '1 day')::date
                       ELSE t.posted_on END
                WHEN 'tarifa_evento_no_caixa'       THEN t.posted_on
                WHEN 'movimentacao_neutra'          THEN t.posted_on
                WHEN 'competencia_presumida_caixa'  THEN t.posted_on
                ELSE NULL
              END AS esperada
         FROM fin_transaction t
         LEFT JOIN fin_settlement s ON s.transaction_id = t.id
         LEFT JOIN fin_document d ON d.id = s.document_id
         LEFT JOIN fin_fiscal_document fd
                ON fd.document_id = d.id AND fd.status = 'AUTHORIZED'
     )
     SELECT count(*) n, coalesce(sum(abs(amount_cents)), 0) rs, array_agg(id) ids
       FROM evidencia
      WHERE competence_date IS NULL
         OR esperada IS NULL
         OR competence_date IS DISTINCT FROM esperada`
  );
  const { nulos, total } = await um(
    `SELECT count(*) FILTER (WHERE competence_date IS NULL) nulos, count(*) total FROM fin_transaction`
  );
  return {
    ...r,
    vacuo: Number(nulos) === Number(total)
      ? `competence_date nula em 100% das ${num(total)} linhas — o DRE cai no COALESCE com posted_on, então o regime de competência do ledger hoje é o de caixa`
      : null
  };
});

check('J', 'J4', 'documento: competência, emissão e vencimento coerentes', {
  afirma: 'competence_date ≤ due_date + 90 dias e paid_on ≤ hoje',
  porque: 'cobrança paga no futuro ou com competência solta desloca receita entre exercícios'
}, () => alvo(
  `SELECT count(*) n, coalesce(sum(abs(amount_cents)), 0) rs, array_agg(id) ids FROM fin_document
    WHERE competence_date > due_date + 90 OR paid_on > CURRENT_DATE`,
  [], 'doc'
));

// ---------------------------------------------------------------------------
// EXECUÇÃO
// ---------------------------------------------------------------------------
let codigoSaida = 0;

try {
  const t0 = Date.now();

  await comLimite(CHECKS, 3, async (c) => {
    try {
      const r = await c.executor();
      c.n = Number(r.n || 0);
      c.rs = Math.abs(Number(r.rs || 0));
      c.detalhes = r.detalhes ?? [];
      c.tx = r.tx ?? [];
      c.doc = r.doc ?? [];
      c.vacuo = r.vacuo ?? null;
    } catch (erro) {
      c.n = 1; c.rs = 0; c.tx = []; c.doc = []; c.vacuo = null;
      c.detalhes = [`a própria verificação estourou: ${erro.message}`];
    }
    c.ok = c.n === 0;
  });

  // -------------------------------------------------------------------------
  // Métricas dos monitores. Uma leva só, em paralelo.
  const [ct, cd, fila, transf, contas, cps, pessoas, estornos, dups, cats, regras, velhas, filaSaude] = await Promise.all([
    um(`SELECT count(*) total, count(category_id) com_cat,
               coalesce(sum(abs(amount_cents)), 0) rs_total,
               coalesce(sum(abs(amount_cents)) FILTER (WHERE category_id IS NOT NULL), 0) rs_class
          FROM fin_transaction WHERE NOT is_split_parent`),
    um(`SELECT count(*) total, count(category_id) com_cat,
               coalesce(sum(abs(amount_cents)), 0) rs_total,
               coalesce(sum(abs(amount_cents)) FILTER (WHERE category_id IS NOT NULL), 0) rs_class
          FROM fin_document WHERE status <> 'cancelado'`),
    um(`SELECT count(*) n, coalesce(sum(abs(amount_cents)), 0) rs,
               coalesce(max(CURRENT_DATE - created_at::date), 0) idade
          FROM fin_review_item WHERE status = 'pendente'`),
    um(`SELECT * FROM fin_transfer_monitor_v`),
    q(`SELECT a.slug, max(sc.period_end) fim, CURRENT_DATE - max(sc.period_end) atraso
         FROM fin_account a LEFT JOIN fin_statement_coverage sc ON sc.account_id = a.id
        WHERE a.is_active GROUP BY 1 ORDER BY 3 DESC NULLS FIRST`),
    um(`SELECT count(*) FILTER (WHERE coalesce(document_number, '') = '') sem, count(*) total FROM fin_counterparty`),
    um(`SELECT count(*) FILTER (WHERE counterparty_id IS NULL) sem, count(*) total FROM fin_person`),
    um(`SELECT count(*) n, coalesce(sum(t.amount_cents), 0) rs
          FROM fin_transaction t JOIN fin_category c ON c.id = t.category_id
         WHERE NOT t.is_split_parent AND t.amount_cents > 0
           AND c.kind IN ('custo_variavel_direto', 'despesa_operacional', 'pessoal', 'imposto', 'investimento')
           AND lower(t.description_norm) ~ '(estorno|reembolso|devolu|refund|cancelamento)'`),
    um(`SELECT * FROM fin_duplicate_monitor_v`),
    // "Categoria nunca usada" tem de significar "nenhum fato financeiro aponta
    // para ela". Eram TRÊS as tabelas que carregam category_id desde a 0083, e
    // esta contagem lia duas: 281 itens de cartão classificados eram invisíveis
    // aqui. 5.11 "Frete e logística" tem um item de cartão de R$ 1.222,56 e era
    // contada como linha morta do plano de contas.
    //
    // É o mesmo padrão que a auditoria já pegou duas vezes (§8 do CONTINUACAO):
    // o buraco mora do lado de fora do indicador que a frente vizinha estava
    // otimizando. `ociosas_sem_cartao` fica ao lado de propósito — esconder de
    // onde veio a queda seria trocar um número cego por outro.
    um(`SELECT count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM fin_transaction t WHERE t.category_id = c.id)
                                 AND NOT EXISTS (SELECT 1 FROM fin_document d WHERE d.category_id = c.id)
                                 AND NOT EXISTS (SELECT 1 FROM fin_card_transaction x WHERE x.category_id = c.id)) ociosas,
               count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM fin_transaction t WHERE t.category_id = c.id)
                                 AND NOT EXISTS (SELECT 1 FROM fin_document d WHERE d.category_id = c.id)) ociosas_sem_cartao,
               count(*) total FROM fin_category c`),
    um(`SELECT count(*) FILTER (WHERE is_blocking) bloqueantes,
               count(*) FILTER (WHERE is_external_gap) lacunas_fonte,
               count(*) FILTER (WHERE health_state = 'produtiva') produtivas,
               count(*) total
          FROM fin_rule_health_v`),
    um(`SELECT count(*) n, coalesce(sum(abs(amount_cents)), 0) rs FROM fin_transaction
         WHERE transfer_status = 'em_transito'
           AND transfer_unresolved_reason IS NULL
           AND CURRENT_DATE - posted_on > $1`, [LIMIARES.emTransitoMaxDias]),
    um(`SELECT count(*) FILTER (WHERE em_escopo_2026) escopo,
               coalesce(sum(abs(amount_cents)) FILTER (WHERE em_escopo_2026), 0) escopo_rs,
               count(*) FILTER (WHERE NOT em_escopo_2026) fora,
               coalesce(sum(abs(amount_cents)) FILTER (WHERE NOT em_escopo_2026), 0) fora_rs,
               count(*) FILTER (WHERE populacao = 'conferencia_de_confianca') conferencia,
               count(*) FILTER (WHERE populacao = 'sem_texto_na_fonte') sem_texto,
               count(*) FILTER (WHERE populacao = 'rotulo_por_trilho') trilho
          FROM fin_fila_saude_v WHERE status = 'pendente'`)
  ]);

  const monitores = [];
  const monitor = (id, nome, m) => {
    monitores.push({ id, nome, ...m, rs: Math.abs(m.rs || 0), ok: m.comparador === '>=' ? m.valor >= m.limiar : m.valor <= m.limiar });
  };

  const pctContagem = (ct.com_cat / ct.total) * 100;
  const pctValor = (ct.rs_class / ct.rs_total) * 100;
  const semCategoria = ct.rs_total - ct.rs_class;

  monitor('M1', 'lançamentos classificados (contagem)', {
    valor: pctContagem, texto: pct(pctContagem), limiar: LIMIARES.classificadoPorContagemPct, comparador: '>=', unidade: '%',
    justificativa: `${num(ct.total - ct.com_cat)} linhas sem categoria. 95% é o piso em que a fila ainda cabe numa sessão semanal.`
  });
  monitor('M2', 'R$ classificado (o número honesto)', {
    valor: pctValor, texto: pct(pctValor), limiar: LIMIARES.classificadoPorValorPct, comparador: '>=', unidade: '%',
    justificativa: `${brl(semCategoria)} sem categoria. Difere do M1 porque 8.700 tarifas de centavos enchem a contagem e não movem o DRE — é este que diz se o resultado do mês é confiável.`,
    rs: semCategoria
  });
  const pctDocValor = (cd.rs_class / cd.rs_total) * 100;
  monitor('M3', 'R$ da carteira classificado', {
    valor: pctDocValor, texto: pct(pctDocValor), limiar: LIMIARES.classificadoPorValorPct, comparador: '>=', unidade: '%',
    justificativa: `${num(cd.total - cd.com_cat)} documentos e ${brl(cd.rs_total - cd.rs_class)} sem categoria na carteira.`,
    rs: cd.rs_total - cd.rs_class
  });
  monitor('M4', 'itens pendentes na fila de revisão', {
    valor: Number(fila.n), texto: num(fila.n), limiar: LIMIARES.filaMaxItens, comparador: '<=', unidade: ' itens',
    justificativa: `300 é o que uma pessoa vence em ~2h. Acima disso a fila deixa de ser trabalho e vira paisagem. `
      + `Mas 300 foi escrito quando a fila era só "falta categoria": hoje ${num(filaSaude.conferencia)} itens são `
      + `conferência de linha já classificada e ${num(filaSaude.sem_texto)} são cobranças que a fonte entregou sem `
      + `texto nenhum. Ver fin_fila_saude_v e M4·escopo.`,
    rs: fila.rs
  });
  // Companheiro diagnóstico, no padrão de M7·fonte e M12·bruto: separa o que é
  // trabalho de 2026 — o escopo que o dono declarou — do que ficou preso na
  // fila pelo H3 sem ser meta de completude. Não muda M4 nem o limiar dele.
  monitor('M4·escopo', 'itens da fila com alvo em 2026', {
    valor: Number(filaSaude.escopo), texto: `${num(filaSaude.escopo)} de ${num(fila.n)}`,
    limiar: LIMIARES.filaMaxItens, comparador: '<=', unidade: ' itens',
    justificativa: `${num(filaSaude.fora)} itens (${brl(filaSaude.fora_rs)}) têm alvo anterior a 2026 e estão fora do `
      + `escopo declarado em OBJETIVOS_METAS §1. Eles não saem da fila: o H3 os prende de propósito, e apagá-los `
      + `seria esconder dinheiro. Enquanto existirem, M4 ≤ 300 é aritmeticamente impossível — ver dúvida 54.`,
    rs: filaSaude.escopo_rs
  });
  monitor('M5', 'idade do item mais antigo da fila', {
    valor: Number(fila.idade), texto: `${num(fila.idade)} d`, limiar: LIMIARES.filaMaxIdadeDias, comparador: '<=', unidade: ' dias',
    justificativa: '14 dias garante que nada atravesse o fechamento do mês ainda pendente.'
  });
  const pctPareadas = Number(transf.actionable_resolution_pct ?? 100);
  monitor('M6', 'transferências acionáveis resolvidas', {
    valor: pctPareadas, texto: pct(pctPareadas), limiar: LIMIARES.transferenciasPareadasPct, comparador: '>=', unidade: '%',
    justificativa: `${num(transf.paired_legs)} pernas pareadas, ${num(transf.reversed_legs)} anuladas e ${num(transf.actionable_legs)} ainda acionáveis. Lacuna de extrato não entra no denominador e aparece separadamente em M7·fonte.`,
    rs: transf.actionable_cents
  });
  monitor('M7', `pernas em trânsito há mais de ${LIMIARES.emTransitoMaxDias} dias`, {
    valor: Number(velhas.n), texto: num(velhas.n), limiar: 0, comparador: '<=', unidade: '',
    justificativa: `Transferência entre contas próprias liquida em minutos. ${brl(velhas.rs)} continuam sem par e sem motivo de fonte; ausência já comprovada aparece separadamente.`,
    rs: velhas.rs
  });
  monitor('M7·fonte', 'pernas sem extrato/conta de contraparte', {
    valor: Number(transf.declared_gap_legs), texto: num(transf.declared_gap_legs), limiar: 0, comparador: '<=', unidade: '',
    justificativa: `${brl(transf.declared_gap_cents)} permanecem integralmente no caixa, mas não podem ser pareados até obter o extrato ou identificar a conta de destino. Declarar o motivo não fabrica a perna ausente.`,
    rs: transf.declared_gap_cents
  });
  for (const c of contas) {
    const atraso = c.fim === null ? 9999 : Number(c.atraso);
    monitor(`M8·${c.slug}`, `extrato de "${c.slug}"`, {
      valor: atraso, texto: c.fim === null ? 'nunca' : `${num(atraso)} d`,
      limiar: LIMIARES.extratoDesatualizadoDias, comparador: '<=', unidade: ' dias',
      justificativa: c.fim === null
        ? 'conta ativa sem nenhum extrato: entra no consolidado como zero.'
        : `último extrato em ${c.fim}. Além de 5 dias o saldo da tela é ficção.`
    });
  }
  const pctSemDoc = (cps.sem / cps.total) * 100;
  monitor('M9', 'contrapartes sem CPF/CNPJ', {
    valor: pctSemDoc, texto: `${num(cps.sem)}/${num(cps.total)}`, limiar: LIMIARES.contrapartesSemDocumentoPct, comparador: '<=', unidade: '%',
    justificativa: 'sem documento não dá para detectar que a contraparte é a própria empresa (o bug de R$ 151.977,33) nem cruzar com nota fiscal.'
  });
  const pctSemCp = pessoas.total ? (pessoas.sem / pessoas.total) * 100 : 0;
  monitor('M10', 'pessoas do time sem contraparte ligada', {
    valor: pctSemCp, texto: `${num(pessoas.sem)}/${num(pessoas.total)}`, limiar: LIMIARES.pessoasSemContrapartePct, comparador: '<=', unidade: '%',
    justificativa: 'sem o elo, folha e reembolso não conseguem apontar para quem recebeu, e nenhum pagamento a pessoa física é reconciliável.'
  });
  monitor('M11', 'entradas em categoria de despesa (estorno)', {
    valor: Number(estornos.n), texto: num(estornos.n), limiar: 0, comparador: '<=', unidade: '',
    justificativa: `${brl(estornos.rs)} de dinheiro voltando carimbado com categoria de despesa. Abater a despesa ou virar receita é convenção contábil — precisa de decisão, não de conserto.`,
    rs: estornos.rs
  });
  monitor('M12·bruto', 'assinaturas visuais repetidas (diagnóstico)', {
    valor: Number(dups.raw_groups),
    texto: `${num(dups.raw_groups)} grupos · ${num(dups.raw_repeated)} rep.`,
    limiar: 0, comparador: '>=', unidade: ' grupos',
    justificativa: `${num(dups.raw_members)} lançamentos e ${brl(dups.raw_cents)} nominais. Este detector não afirma dinheiro inflado: pagamentos econômicos distintos podem ter conta, data, valor e texto iguais.`,
    rs: dups.raw_cents
  });
  monitor('M12', 'casos novos, reabertos ou sem sync', {
    valor: Number(dups.unreviewed_cases),
    texto: `${num(dups.unreviewed_cases)} casos · ${num(dups.unreviewed_repeated)} rep.`,
    limiar: 0, comparador: '<=', unidade: ' casos',
    justificativa: `${brl(dups.unreviewed_cents)} nominais aguardam decisão ou sincronização. O total inclui caso novo/reaberto, assinatura bruta ainda sem caso e decisão cuja fingerprint ficou stale; nenhuma delas neutraliza caixa.`,
    rs: dups.unreviewed_cents
  });
  monitor('M12E', 'casos aguardando evidência durável', {
    valor: Number(dups.awaiting_evidence_cases),
    texto: `${num(dups.awaiting_evidence_cases)} casos · ${num(dups.awaiting_evidence_repeated)} rep.`,
    limiar: 0, comparador: '<=', unidade: ' casos',
    justificativa: `${brl(dups.awaiting_evidence_cents)} nominais já foram examinados, mas a prova original ainda precisa estar arquivada e ligada ao lote antes da revisão final.`,
    rs: dups.awaiting_evidence_cents
  });
  const pctOciosas = (cats.ociosas / cats.total) * 100;
  monitor('M13', 'categorias nunca usadas', {
    valor: pctOciosas, texto: `${num(cats.ociosas)}/${num(cats.total)}`, limiar: LIMIARES.categoriasOciosasPct, comparador: '<=', unidade: '%',
    justificativa: `plano de contas com ${pct(pctOciosas)} de linhas mortas enquanto ${brl(semCategoria)} ficam sem categoria: `
      + `o problema não é falta de opção, é falta de regra. Contando só fin_transaction e fin_document seriam `
      + `${num(cats.ociosas_sem_cartao)} — o subledger do cartão também carrega category_id desde a 0083.`
  });
  monitor('M14', 'regras ativas com saúde bloqueante', {
    valor: Number(regras.bloqueantes), texto: `${num(regras.bloqueantes)}/${num(regras.total)}`, limiar: 0, comparador: '<=', unidade: '',
    justificativa: `${num(regras.produtivas)} regras têm hit na versão corrente. As bloqueantes são zero inesperado, asserção vencida/invalidada ou sombra sem decisão — não falsos zeros de regras documentais.`
  });
  monitor('M14·fonte', 'regras aguardando fonte externa', {
    valor: Number(regras.lacunas_fonte), texto: `${num(regras.lacunas_fonte)}/${num(regras.total)}`, limiar: 0, comparador: '<=', unidade: '',
    justificativa: 'Uma asserção datada explica a ausência atual, mas não transforma folha, contas a pagar ou contratos ausentes em cobertura concluída.'
  });
  const divergencia = saldos.reduce((s, l) => s + Math.abs(Number(l.delta)), 0);
  monitor('M15', 'divergência total de saldo', {
    valor: divergencia, texto: brl(divergencia), limiar: LIMIARES.divergenciaSaldoCents, comparador: '<=', unidade: ' centavos',
    justificativa: 'zero, sem tolerância: um ledger que não fecha com ele mesmo não fecha com o banco.',
    rs: divergencia
  });

  // -------------------------------------------------------------------------
  // M16 e M17 — a previsão finalmente tem erro medido.
  //
  // Até 16/08/2026 a previsão era o ÚNICO módulo desta base sem backtest, e
  // backtest é o que pegou os +37% da receita recorrente e os +75% da comissão.
  // `fin_cash_forecast` tinha uma foto só, tirada à mão, e
  // `fin_previsao_afericao_v` nunca produziu uma linha.
  //
  // Os dois monitores medem coisas diferentes de propósito:
  //   M16 é sobre o INSTRUMENTO — a série de fotos está sendo acumulada?
  //   M17 é sobre o DETECTOR   — quando dá para cobrar, ele acerta?
  //
  // Sem M16, M17 pode ficar verde para sempre por falta de dado; sem M17, M16
  // celebra ter fotos que ninguém conferiu.
  const previsao = (await q(
    `SELECT to_regclass('public.fin_previsao_afericao_resumo_v') IS NOT NULL AS tem`
  ))[0]?.tem
    ? {
        foto: await um(`SELECT count(*)::int fotos,
                               coalesce(max(dias_aferiveis), 0)::int melhor_afericao,
                               coalesce(max(gerado_em)::text, '—') ultima
                          FROM fin_previsao_afericao_resumo_v`),
        backtest: await um(`SELECT (PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY acerto_pct))::numeric mediana,
                                   count(*)::int refs, min(referencia)::text de, max(referencia)::text ate
                              FROM fin_previsao_cobranca_backtest_v
                             WHERE mensuravel AND horizonte_dias = 30 AND acerto_pct IS NOT NULL`)
      }
    : null;

  if (previsao) {
    monitor('M16', 'dias de previsão já cobráveis', {
      valor: Number(previsao.foto.melhor_afericao), texto: `${num(previsao.foto.melhor_afericao)} d`,
      limiar: LIMIARES.previsaoDiasAferidosMin, comparador: '>=', unidade: ' dias',
      justificativa: `${num(previsao.foto.fotos)} foto(s), a mais recente de ${previsao.foto.ultima}. `
        + 'Uma foto só vira medida quando os dias que ela previu entram na cobertura do extrato; '
        + `${LIMIARES.previsaoDiasAferidosMin} dias é um ciclo mensal fechado, que é a menor janela em que folha, DAS e cobrança aparecem todos. `
        + 'Zero aqui NÃO é acerto: é foto jovem demais para ser cobrada.'
    });
    monitor('M17', 'acerto da cobrança emitida em 30 dias', {
      valor: Number(previsao.backtest.mediana ?? 0),
      texto: previsao.backtest.mediana === null ? '—' : `${previsao.backtest.mediana}%`,
      limiar: LIMIARES.previsaoAcertoCobrancaPct, comparador: '>=', unidade: '%',
      justificativa: `mediana de ${num(previsao.backtest.refs)} referências mensuráveis (${previsao.backtest.de} a ${previsao.backtest.ate}), `
        + 'reconstruídas das três datas do próprio documento — sem foto sintética. '
        + '95% porque a premissa receber_fator = 1,000 assume que a cobrança emitida a vencer entra INTEIRA no vencimento; '
        + 'abaixo disso a previsão de entrada é otimista por construção, e erro para cima só dói na hora de contar com o dinheiro.'
    });
  }

  // -------------------------------------------------------------------------
  // DINHEIRO DISTINTO. Os mesmos 671 lançamentos aparecem em C3, H3 e H4; somar
  // os invariantes conta esse dinheiro três vezes. A união das chaves atingidas
  // é o número que pode ser dito em voz alta.
  const quebrados = CHECKS.filter((c) => !c.ok).sort((a, b) => b.rs - a.rs);
  const txIds = [...new Set(quebrados.flatMap((c) => c.tx))];
  const docIds = [...new Set(quebrados.flatMap((c) => c.doc))];
  const [dinTx, dinDoc] = await Promise.all([
    txIds.length
      ? um(`SELECT coalesce(sum(abs(amount_cents)), 0) rs FROM fin_transaction WHERE id = ANY($1::bigint[])`, [txIds])
      : { rs: 0 },
    docIds.length
      ? um(`SELECT coalesce(sum(abs(amount_cents)), 0) rs FROM fin_document WHERE id = ANY($1::bigint[])`, [docIds])
      : { rs: 0 }
  ]);
  const somaPorInvariante = quebrados.reduce((s, c) => s + c.rs, 0);
  const dinheiroDistinto = Number(dinTx.rs) + Number(dinDoc.rs);
  const ms = Date.now() - t0;

  const metasRuins = monitores.filter((m) => !m.ok);

  // -------------------------------------------------------------------------
  // SAÍDA
  if (JSON_OUT) {
    console.log(JSON.stringify({
      gerado_em: new Date().toISOString(),
      duracao_ms: ms,
      invariantes: {
        total: CHECKS.length, ok: CHECKS.length - quebrados.length, quebrados: quebrados.length,
        soma_por_invariante_cents: somaPorInvariante, dinheiro_distinto_cents: dinheiroDistinto,
        lista: CHECKS.map(({ executor, tx, doc, ...resto }) => ({ ...resto, tx_atingidos: tx.length, doc_atingidos: doc.length }))
      },
      monitores: { total: monitores.length, fora_da_meta: metasRuins.length, lista: monitores }
    }, null, 2));
  } else {
    const L = 76;
    const caixa = (t) => `│ ${t.slice(0, L - 2).padEnd(L - 2)} │`;
    console.log(`\n┌${'─'.repeat(L)}┐`);
    console.log(caixa(`VERIFICADOR DE INTEGRIDADE — ${entidade.legal_name}`));
    console.log(caixa(`CNPJ ${entidade.cnpj} · ${new Date().toLocaleString('pt-BR')}`));
    console.log(`└${'─'.repeat(L)}┘`);

    let secaoAtual = null;
    for (const c of CHECKS) {
      if (c.secao !== secaoAtual) {
        secaoAtual = c.secao;
        console.log(`\n=== ${SECOES[c.secao]} ===`);
      }
      if (c.ok) {
        console.log(`  ✓ [${c.id}] ${c.nome}${c.vacuo ? `\n        ⚠ vácuo: ${c.vacuo}` : ''}`);
      } else {
        console.error(`  ✗ [${c.id}] ${c.nome}`);
        console.error(`        afirma:  ${c.afirma}`);
        console.error(`        importa: ${c.porque}`);
        console.error(`        agora:   ${num(c.n)} violação(ões)${c.rs ? ` · ${brl(c.rs)} em jogo` : ''}`);
        c.detalhes.slice(0, 6).forEach((d) => console.error(`        · ${d}`));
        if (c.detalhes.length > 6) console.error(`        · ... +${c.detalhes.length - 6}`);
      }
    }

    console.log('\n' + '═'.repeat(78));
    console.log('MONITORES DE META — valor de hoje contra o limiar que alguém escolheu');
    console.log('═'.repeat(78));
    for (const m of monitores) {
      const alvoTxt = `${m.comparador === '>=' ? '≥' : '≤'} ${m.limiar}${m.unidade}`;
      console.log(`  ${m.ok ? '✓' : '△'} ${`[${m.id}]`.padEnd(24)} ${m.nome.padEnd(44)} ${String(m.texto).padStart(14)}   (meta ${alvoTxt})`);
      if (!m.ok) {
        console.log(`        limiar: ${m.justificativa}`);
        if (m.rs) console.log(`        em jogo: ${brl(m.rs)}`);
      }
    }

    console.log('\n' + '═'.repeat(78));
    console.log('FALHAS ORDENADAS POR R$ EM JOGO');
    console.log('═'.repeat(78));
    if (!quebrados.length) console.log('  nenhuma. todos os invariantes passam.');
    quebrados.forEach((c, i) => {
      console.log(`  ${String(i + 1).padStart(2)}. ${brl(c.rs).padStart(18)}  [${c.id}] ${c.nome}`);
      console.log(`      ${''.padStart(18)}  ${num(c.n)} violação(ões)`);
    });

    console.log('\n' + '═'.repeat(78));
    console.log('ESTADO ATUAL DA PLATAFORMA');
    console.log('═'.repeat(78));
    console.log(`  invariantes:  ${CHECKS.length - quebrados.length} passam · ${quebrados.length} falham   (de ${CHECKS.length})`);
    console.log(`  monitores:    ${monitores.length - metasRuins.length} na meta · ${metasRuins.length} fora     (de ${monitores.length})`);
    console.log(`  R$ em jogo:   ${brl(dinheiroDistinto)} de dinheiro DISTINTO tocado por invariante quebrado`);
    console.log(`                (${brl(somaPorInvariante)} somando invariante a invariante — a diferença é sobreposição:`);
    console.log(`                 os mesmos lançamentos aparecem em mais de uma falha, e contar duas vezes é o erro`);
    console.log(`                 que esta plataforma já cometeu entre telas)`);
    console.log(`                + ${brl(divergencia)} de divergência de saldo, que é delta e não linha`);
    console.log(`  verificado em ${(ms / 1000).toFixed(1)} s sobre ${num(ct.total)} lançamentos e ${num(cd.total)} documentos`);

    const vacuos = CHECKS.filter((c) => c.ok && c.vacuo);
    if (vacuos.length) {
      console.log(`\n  ⚠ ${vacuos.length} invariante(s) passam por VÁCUO — não há dado que os exercite:`);
      vacuos.forEach((c) => console.log(`      [${c.id}] ${c.vacuo}`));
      console.log('      Passar por vácuo não é estar certo. Quando o dado chegar, estes são os primeiros a olhar.');
    }
    if (!STRICT && metasRuins.length) {
      console.log(`\n  ${metasRuins.length} monitor(es) fora da meta NÃO derrubaram esta execução.`);
      console.log('  Rode com --strict para que derrubem (é o modo da revisão semanal).');
    }
  }

  codigoSaida = quebrados.length > 0 || (STRICT && metasRuins.length > 0) ? 1 : 0;
} finally {
  await pool.end();
}

process.exit(codigoSaida);

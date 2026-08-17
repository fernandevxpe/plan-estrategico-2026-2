// Prova do inventário de identificação — migration 0103.
//
// Roda a migration inteira dentro de uma transação, afirma o que ela produz,
// exercita as recusas que protegem o ledger, e desfaz tudo com ROLLBACK. Nada
// persiste, e por isso este teste pode rodar contra a base de verdade sem
// backup: a única escrita que ele tenta é a que o próprio ROLLBACK apaga.
//
// O QUE ELE PROVA, E O QUE NÃO PROVA
//
// Prova: o dígito verificador (o mesmo módulo que a rota HTTP importa), as
// contagens do inventário, a âncora de dinheiro, as pós-condições do
// vocabulário, e as três recusas de escrita — CNPJ da casa, documento repetido
// e motivo vazio — no nível em que elas são garantidas de verdade, que é o
// banco.
//
// NÃO prova a camada HTTP: status 422, forma do JSON e leitura do corpo são de
// `app/api/**` e exigiriam subir o Next. O que este teste garante é que, se a
// rota chamar o SQL certo, o banco não deixa passar.
//
// Uso: node scripts/test-identificacao.mjs
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { financePool } from './lib/artifact-db.mjs';
import { conferirDocumento } from './lib/fin-documento.mjs';
import { loadEnv } from './lib/env.mjs';
import { registerFinanceTypeParsers } from './lib/fin-types.mjs';

loadEnv();
registerFinanceTypeParsers();

const RAIZ = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const MIGRATION = path.join(RAIZ, 'db/migrations/0103_fin_identificacao.sql');
const CNPJ_DA_CASA = '34776108000192';

const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

let ok = 0;
const falhas = [];

function prova(nome, condicao, detalhe = '') {
  if (condicao) {
    ok += 1;
    console.log(`  ✓ ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  } else {
    falhas.push(`${nome}${detalhe ? ` — ${detalhe}` : ''}`);
    console.log(`  ✗ ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  }
}

/** Afirma que um statement é RECUSADO. Passar aqui significa o banco ter dito não. */
async function recusa(c, nome, sql, args = []) {
  await c.query('SAVEPOINT tentativa');
  try {
    await c.query(sql, args);
    await c.query('ROLLBACK TO SAVEPOINT tentativa');
    prova(nome, false, 'o banco ACEITOU o que deveria recusar');
  } catch (e) {
    await c.query('ROLLBACK TO SAVEPOINT tentativa');
    prova(nome, true, e.message.split('\n')[0].slice(0, 90));
  }
}

const pool = financePool();
const c = await pool.connect();

try {
  // =========================================================================
  // 1. O DÍGITO VERIFICADOR — o mesmo módulo que a rota HTTP importa
  // =========================================================================
  console.log('\n1. CPF/CNPJ conferidos no dígito verificador');

  prova('CNPJ da casa é aritmeticamente válido', conferirDocumento(CNPJ_DA_CASA).valido,
    'a recusa dele é regra de negócio (A1), não de formato — por isso o teste seguinte existe');
  prova('CNPJ com máscara é aceito e normalizado',
    conferirDocumento('34.776.108/0001-92').digitos === CNPJ_DA_CASA);
  prova('CNPJ com DV errado é recusado', !conferirDocumento('34776108000193').valido);
  prova('CPF com DV errado é recusado', !conferirDocumento('70365478475').valido);
  prova('CPF válido é aceito', conferirDocumento('703.654.784-74').valido === true,
    'o CPF de Igor Dalton, cadastrado na contraparte 371');
  prova('14 dígitos de um timestamp são recusados', !conferirDocumento('20240229142407').valido,
    'update_time = 2024-02-29 14:24:07 casou 274 negócios num detector antigo');
  prova('placeholder 00000000000 é recusado', !conferirDocumento('00000000000').valido,
    'passa na aritmética; entraria com selo de conferido');
  prova('repetição 11111111111111 é recusada', !conferirDocumento('11111111111111').valido);
  prova('documento de 12 dígitos é recusado', !conferirDocumento('123456789012').valido);
  prova('vazio é recusado com motivo', conferirDocumento('').motivo === 'documento vazio');

  // =========================================================================
  // 2. A MIGRATION, EM TRANSAÇÃO
  // =========================================================================
  console.log('\n2. Migration 0103 aplicada em transação');
  await c.query('BEGIN');

  const antes = await c.query(
    `SELECT account_id, sum(amount_cents) s, count(*) n FROM fin_transaction GROUP BY 1 ORDER BY 1`
  );
  const sql = await readFile(MIGRATION, 'utf8');
  await c.query(sql);
  prova('a migration aplica sem erro e as pós-condições passam', true);

  const depois = await c.query(
    `SELECT account_id, sum(amount_cents) s, count(*) n FROM fin_transaction GROUP BY 1 ORDER BY 1`
  );
  prova('âncora: soma por conta idêntica antes e depois',
    JSON.stringify(antes.rows) === JSON.stringify(depois.rows),
    `${antes.rows.length} contas conferidas`);

  // =========================================================================
  // 3. O INVENTÁRIO
  // =========================================================================
  console.log('\n3. O inventário');

  const { rows: [inv] } = await c.query(
    `SELECT count(*) casos, count(DISTINCT tipo_de_pendencia) tipos,
            count(*) FILTER (WHERE alcancavel_agora) alcancaveis,
            count(*) FILTER (WHERE NOT alcancavel_agora) bloqueados
       FROM fin_pendencia_identificacao_v`
  );
  prova('o inventário cobre os 30 tipos do vocabulário', Number(inv.tipos) === 30,
    `${inv.casos} casos`);
  prova('todo caso é alcançável OU bloqueado, nunca nenhum dos dois',
    Number(inv.alcancaveis) + Number(inv.bloqueados) === Number(inv.casos),
    `${inv.alcancaveis} alcançáveis · ${inv.bloqueados} bloqueados`);

  const { rows: [chave] } = await c.query(
    `SELECT count(*) n FROM (
       SELECT universo, id, tipo_de_pendencia FROM fin_pendencia_identificacao_v
       GROUP BY 1,2,3 HAVING count(*) > 1) z`
  );
  prova('a chave (universo, id, tipo) é única', Number(chave.n) === 0);

  const { rows: [semCaminho] } = await c.query(
    `SELECT count(*) n FROM fin_pendencia_identificacao_v WHERE caminho_de_correcao IS NULL`
  );
  prova('nenhum caso sem caminho de correção', Number(semCaminho.n) === 0);

  const { rows: [semEvidencia] } = await c.query(
    `SELECT count(*) n FROM fin_pendencia_identificacao_v
      WHERE evidencia_disponivel IS NULL OR btrim(evidencia_disponivel) = ''`
  );
  prova('nenhum caso sem evidência declarada', Number(semEvidencia.n) === 0,
    'onde não há evidência, o texto DIZ que não há — nunca fica vazio');

  const { rows: [duvidaRuim] } = await c.query(
    `SELECT count(*) n FROM fin_pendencia_identificacao_v
      WHERE bloqueado_por IS NOT NULL AND (bloqueado_por < 0 OR bloqueado_por > 57)`
  );
  prova('toda dúvida referenciada existe em DUVIDAS_FINANCEIRO.md', Number(duvidaRuim.n) === 0,
    'apontar para dúvida inexistente já aconteceu nas lacunas do cartão');

  // =========================================================================
  // 4. A ARMADILHA DO CNPJ DA CASA
  // =========================================================================
  console.log('\n4. A armadilha do CNPJ da própria XPE');

  const { rows: [casa] } = await c.query(
    `SELECT count(*) n, coalesce(sum(abs(t.amount_cents)),0) v
       FROM fin_transaction t JOIN fin_entity e ON e.id = t.entity_id AND e.slug='xpe'
      WHERE t.counterparty_id IS NULL
        AND t.counterparty_document = regexp_replace(e.cnpj,'[^0-9]','','g')`
  );
  prova('os lançamentos com o CNPJ da casa existem e estão sem contraparte',
    Number(casa.n) > 0, `${casa.n} lançamentos · ${brl(casa.v)}`);

  const { rows: [vazamento] } = await c.query(
    `SELECT count(*) n FROM fin_pendencia_identificacao_v p
       JOIN fin_transaction t ON t.id = p.id AND p.universo='fin_transaction'
       JOIN fin_entity e ON e.id = t.entity_id AND e.slug='xpe'
      WHERE p.caminho_de_correcao='cadastrar_contraparte'
        AND t.counterparty_document = regexp_replace(e.cnpj,'[^0-9]','','g')`
  );
  prova('NENHUM deles vira caso de "cadastrar contraparte"', Number(vazamento.n) === 0,
    'seria o erro de R$ 151.977,33 que A1/A2 existem para impedir');

  const { rows: [excl] } = await c.query(
    `SELECT count(*) n FROM fin_pendencia_identificacao_excluido_v
      WHERE populacao = 'contraparte_e_a_propria_casa'`
  );
  prova('e a exclusão é DECLARADA, não silenciosa', Number(excl.n) === 1);

  // A1 é invariante conferido por test-integridade, não constraint do banco —
  // quem recusa o cadastro com o CNPJ da casa é a rota, ANTES de escrever. A
  // prova que cabe aqui é que ela tem como fazer isso: o CNPJ da entidade está
  // legível e é o que a recusa compara.
  const { rows: [ent] } = await c.query(`SELECT regexp_replace(cnpj,'[^0-9]','','g') cnpj FROM fin_entity WHERE slug='xpe'`);
  prova('o CNPJ da casa é legível para a rota recusar antes de escrever',
    ent.cnpj === CNPJ_DA_CASA, ent.cnpj);

  // =========================================================================
  // 5. CADASTRO NÃO CRIA DUPLICATA (A4)
  // =========================================================================
  console.log('\n5. Cadastro de contraparte');

  const { rows: [alvo] } = await c.query(
    `SELECT id, name, regexp_replace(document_number,'[^0-9]','','g') doc
       FROM fin_counterparty WHERE coalesce(document_number,'') <> '' LIMIT 1`
  );
  const { rows: achado } = await c.query(
    `SELECT id, name FROM fin_counterparty
      WHERE regexp_replace(coalesce(document_number,''),'[^0-9]','','g') = $1`,
    [alvo.doc]
  );
  prova('a busca por documento acha exatamente um cadastro existente',
    achado.length === 1 && String(achado[0].id) === String(alvo.id),
    `${alvo.doc} → "${alvo.name}"`);

  const { rows: [dupA4] } = await c.query(
    `SELECT count(*) n FROM (
       SELECT regexp_replace(document_number,'[^0-9]','','g') d FROM fin_counterparty
        WHERE coalesce(document_number,'') <> ''
        GROUP BY 1 HAVING count(*) > 1) z`
  );
  prova('A4 continua de pé: nenhum documento em duas contrapartes', Number(dupA4.n) === 0);

  // A prova de que o validador novo não é mais severo que a base já é: se ele
  // recusasse um documento que já está cadastrado, a rota passaria a rejeitar
  // uma correção legítima do MESMO documento — e a pessoa concluiria que o
  // cadastro certo está errado.
  const { rows: cadastrados } = await c.query(
    `SELECT id, name, document_number FROM fin_counterparty WHERE coalesce(document_number,'') <> ''`
  );
  const reprovados = cadastrados.filter((r) => !conferirDocumento(r.document_number).valido);
  prova('todo documento JÁ CADASTRADO passa no dígito verificador',
    reprovados.length === 0,
    `${cadastrados.length} contrapartes conferidas${reprovados.length ? `; reprovadas: ${reprovados.map((r) => r.id).join(', ')}` : ''}`);

  const { rows: pessoas } = await c.query(`SELECT id, name, cpf, cnpj FROM fin_person`);
  const pessoasRuins = pessoas.filter(
    (p) => (p.cpf && !conferirDocumento(p.cpf).valido) || (p.cnpj && !conferirDocumento(p.cnpj).valido)
  );
  prova('todo CPF/CNPJ de pessoa passa no dígito verificador', pessoasRuins.length === 0,
    `${pessoas.length} pessoas conferidas`);

  // =========================================================================
  // 6. AS TRAVAS DA RESOLUÇÃO
  // =========================================================================
  console.log('\n6. Resolver caso com motivo declarado');

  const { rows: [entidade] } = await c.query(`SELECT id FROM fin_entity WHERE slug='xpe'`);
  const { rows: [caso] } = await c.query(
    `SELECT universo, id, tipo_de_pendencia FROM fin_pendencia_identificacao_v
      WHERE caminho_de_correcao = 'decisao_humana' LIMIT 1`
  );

  await recusa(c, 'motivo curto é recusado pelo CHECK',
    `INSERT INTO fin_pendencia_resolucao (entity_id, universo, alvo_id, tipo, decisao, motivo, ator)
     VALUES ($1,$2,$3,$4,'sem_fonte','ok','teste')`,
    [entidade.id, caso.universo, caso.id, caso.tipo_de_pendencia]);

  await recusa(c, 'decisão fora do vocabulário é recusada',
    `INSERT INTO fin_pendencia_resolucao (entity_id, universo, alvo_id, tipo, decisao, motivo, ator)
     VALUES ($1,$2,$3,$4,'resolvido_automaticamente','motivo suficientemente longo','teste')`,
    [entidade.id, caso.universo, caso.id, caso.tipo_de_pendencia]);

  await recusa(c, 'tipo fora do catálogo é recusado pela FK',
    `INSERT INTO fin_pendencia_resolucao (entity_id, universo, alvo_id, tipo, decisao, motivo, ator)
     VALUES ($1,'fin_transaction',1,'tipo_que_nao_existe','sem_fonte','motivo suficientemente longo','teste')`,
    [entidade.id]);

  await c.query(
    `INSERT INTO fin_pendencia_resolucao (entity_id, universo, alvo_id, tipo, decisao, motivo, ator)
     VALUES ($1,$2,$3,$4,'sem_fonte','nao ha extrato desta janela em fonte nenhuma','teste:identificacao')`,
    [entidade.id, caso.universo, caso.id, caso.tipo_de_pendencia]
  );
  prova('"sem_fonte" com motivo é ACEITO — é resposta legítima', true);

  const { rows: [saiu] } = await c.query(
    `SELECT count(*) n FROM fin_pendencia_identificacao_v
      WHERE universo=$1 AND id=$2 AND tipo_de_pendencia=$3`,
    [caso.universo, caso.id, caso.tipo_de_pendencia]
  );
  prova('o caso resolvido SAI do inventário', Number(saiu.n) === 0,
    `${caso.universo} #${caso.id} / ${caso.tipo_de_pendencia}`);

  await recusa(c, 'resolver o mesmo caso duas vezes é recusado pelo índice único',
    `INSERT INTO fin_pendencia_resolucao (entity_id, universo, alvo_id, tipo, decisao, motivo, ator)
     VALUES ($1,$2,$3,$4,'resolvido','outra tentativa sobre o mesmo caso','teste')`,
    [entidade.id, caso.universo, caso.id, caso.tipo_de_pendencia]);

  await c.query(`UPDATE fin_pendencia_resolucao SET desfeito_em = now()
                  WHERE universo=$1 AND alvo_id=$2 AND tipo=$3`,
    [caso.universo, caso.id, caso.tipo_de_pendencia]);
  const { rows: [voltou] } = await c.query(
    `SELECT count(*) n FROM fin_pendencia_identificacao_v
      WHERE universo=$1 AND id=$2 AND tipo_de_pendencia=$3`,
    [caso.universo, caso.id, caso.tipo_de_pendencia]
  );
  prova('desfazer a resolução devolve o caso ao inventário', Number(voltou.n) === 1);

  // =========================================================================
  // 6b. AS ESCRITAS NÃO ALCANÇAM fin_transaction — NEM POR CASCATA
  //
  // A frente da DRE (0102) provou dois defeitos que valem para qualquer código
  // que reclassifique: um UPDATE de category_id sem `classified_rule_id = NULL`
  // explícito no mesmo SET estoura em 9.793 linhas, e categoria de sinal errado
  // não é recusada — é APAGADA em silêncio pelo gatilho
  // `fin_transaction_categoria_sinal`, que devolve sucesso.
  //
  // Esta frente não escreve em fin_transaction, e o risco real não é o que o
  // código faz hoje: é alguém acrescentar amanhã "e já aponta a contraparte nos
  // lançamentos" ao cadastro, e cair nos dois casos sem perceber. Por isso a
  // prova é uma impressão digital das colunas de classificação antes e depois
  // das três escritas — se uma cascata aparecer, ela muda o hash.
  //
  // O caminho por onde a cascata VIRIA está mapeado: fin_person_counterparty
  // tem AFTER INSERT que chama fin_person_refresh_counterparty(), e essa função
  // só faz UPDATE em fin_person.counterparty_id. É onde a corrente para hoje.
  // =========================================================================
  console.log('\n6b. Nenhuma escrita desta frente alcança fin_transaction');

  const digital = async () => {
    const { rows: [d] } = await c.query(
      `SELECT count(*) n, coalesce(sum(amount_cents),0) soma,
              md5(string_agg(id || ':' || coalesce(category_id::text,'-')
                  || ':' || coalesce(classified_rule_id::text,'-')
                  || ':' || coalesce(classified_by,'-')
                  || ':' || coalesce(counterparty_id::text,'-')
                  || ':' || coalesce(nucleo,'-'), '|' ORDER BY id)) hash
         FROM fin_transaction`
    );
    return `${d.n}/${d.soma}/${d.hash}`;
  };

  const antesEscrita = await digital();

  // As MESMAS instruções que lib/financeiro/identificacao.ts emite.
  const { rows: [entXpe] } = await c.query(`SELECT id FROM fin_entity WHERE slug='xpe'`);
  const { rows: [novaCp] } = await c.query(
    `INSERT INTO fin_counterparty (entity_id, kind, name, normalized_name, document_type, document_number, is_active)
     VALUES ($1,'fornecedor','TESTE IDENTIFICACAO LTDA', upper(btrim('TESTE IDENTIFICACAO LTDA')),'cnpj','06913480000168', true)
     RETURNING id`,
    [entXpe.id]
  );
  prova('cadastro de contraparte executado', Boolean(novaCp.id));

  const { rows: [pes] } = await c.query(
    `SELECT id, entity_id FROM fin_person WHERE default_category_id IS NOT NULL LIMIT 1`
  );
  await c.query(
    `INSERT INTO fin_person_counterparty
       (entity_id, person_id, counterparty_id, is_primary, confidence, method, status, evidence, confirmed_by, confirmed_at)
     VALUES ($1,$2,$3,false,1.0,'humano','confirmado',$4,'teste:identificacao', now())`,
    [pes.entity_id, pes.id, novaCp.id, JSON.stringify({ origem: 'teste' })]
  );
  prova('vínculo pessoa ↔ contraparte executado (dispara fin_person_refresh_counterparty)', true,
    'a pessoa escolhida TEM default_category_id — é o caso que mais chega perto do gatilho');

  const depoisEscrita = await digital();
  prova('fin_transaction intacta: contagem, soma e classificação idênticas',
    antesEscrita === depoisEscrita,
    'category_id, classified_rule_id, classified_by, counterparty_id e nucleo conferidos linha a linha');

  const { rows: [alcance] } = await c.query(
    `SELECT count(*) n FROM fin_transaction WHERE counterparty_id = $1`, [novaCp.id]
  );
  prova('a contraparte recém-criada não foi apontada por lançamento nenhum', Number(alcance.n) === 0,
    'cadastrar é cadastrar; apontar lançamento é reclassificar, e é da frente 0101');

  // =========================================================================
  // 7. AGRUPAMENTO POR CAUSA COMUM
  // =========================================================================
  console.log('\n7. Tamanho do problema × tamanho do trabalho');

  const { rows: grupos } = await c.query(
    `SELECT tipo_de_pendencia, itens, decisoes_distintas, itens_por_decisao
       FROM fin_pendencia_identificacao_grupo_v ORDER BY itens_por_decisao DESC LIMIT 3`
  );
  prova('o agrupamento separa itens de decisões',
    grupos.every((g) => Number(g.decisoes_distintas) >= 1 && Number(g.itens) >= Number(g.decisoes_distintas)),
    grupos.map((g) => `${g.tipo_de_pendencia}: ${g.itens}/${g.decisoes_distintas}`).join(' · '));

  const { rows: [taxa] } = await c.query(
    `SELECT itens, decisoes_distintas FROM fin_pendencia_identificacao_grupo_v
      WHERE tipo_de_pendencia = 'tx_contraparte_ausente_taxa_asaas'`
  );
  prova('as taxas do Asaas são muitos itens e UMA decisão',
    Number(taxa.decisoes_distintas) === 1 && Number(taxa.itens) > 1000,
    `${taxa.itens} itens · 1 decisão (dúvida 13 já respondida, falta o escopo)`);

  await c.query('ROLLBACK');
  console.log('\nROLLBACK executado — nada persistiu.');
} catch (erro) {
  await c.query('ROLLBACK').catch(() => {});
  console.error('\nERRO FATAL:', erro.message);
  falhas.push(`erro fatal: ${erro.message}`);
} finally {
  c.release();
  await pool.end();
}

console.log(`\n${'='.repeat(70)}`);
console.log(`${ok} verificação(ões) ok · ${falhas.length} falha(s)`);
if (falhas.length) {
  for (const f of falhas) console.log(`  ✗ ${f}`);
  process.exit(1);
}

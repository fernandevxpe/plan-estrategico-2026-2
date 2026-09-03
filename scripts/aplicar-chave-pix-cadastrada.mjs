// A chave que a PESSOA cadastrou passa a ser a chave que a XPE PAGA — e quem
// ainda não cadastrou recebe, no app, a chave que já usamos hoje.
//
//   npm run pix:cadastro                      mostra o que faria (padrão)
//   npm run pix:cadastro:aplicar              grava
//   npm run pix:cadastro:aplicar -- --tudo    inclui as chaves não verificáveis
//
// ---------------------------------------------------------------------------
// AS DUAS DIREÇÕES, E POR QUE ELAS SÃO A MESMA DECISÃO
// ---------------------------------------------------------------------------
// O Fernando, em 03/09/2026: "verifique quem fez as trocas e ajuste para
// apontar para a chave pix cadastrada. Quem ainda não cadastrou, coloque a
// chave que nós utilizamos, e o usuário pode alterar depois".
//
//   →  fin_person_pagamento (0159) manda em fin_payee_account (0001)
//      quando a pessoa cadastrou. Ela é a dona da própria chave.
//
//   ←  fin_payee_account semeia fin_person_pagamento quando ela não cadastrou.
//      A chave que já recebe dinheiro hoje é um palpite MUITO melhor que uma
//      tela em branco — e uma tela em branco é o que faz 16 pessoas não
//      mexerem no cadastro.
//
// A ponte antiga (`pix:pessoa:aplicar`) só cria conta para quem não tem
// nenhuma, e se RECUSA a sobrescrever conta padrão ativa. Continua certo como
// automação. Este script é o outro caso: a troca deliberada, uma por uma, com
// alguém decidindo — que é o que a 0075 exige de quem mexe em coordenada de
// favorecido.
//
// ---------------------------------------------------------------------------
// COMO A TROCA ACONTECE DE VERDADE: `is_default`, NUNCA `fin_person.counterparty_id`
// ---------------------------------------------------------------------------
// A folha resolve a coordenada assim (contas-a-pagar.ts): entre as contrapartes
// da pessoa, "a primária ganha quando as duas têm conta". O MEI costuma ter
// DUAS — a do CPF (primária, do tempo em que ele recebia como pessoa física) e
// a do CNPJ. Enquanto a do CPF for padrão, é ela que a folha escolhe.
//
// Então a troca é desmarcar `is_default` na conta que perdeu, não mexer na
// contraparte primária da pessoa. `fin_person.counterparty_id` é a identidade
// dela no ledger inteiro — conciliação, custo, histórico. Trocar identidade
// para resolver destino de pagamento quebraria o passado para arrumar o futuro.
//
// ---------------------------------------------------------------------------
// O QUE ESTE SCRIPT SE RECUSA A FAZER SOZINHO
// ---------------------------------------------------------------------------
// Chave que é DOCUMENTO (CPF/CNPJ) e bate com o documento cadastrado da pessoa
// é verificável: dá para provar que a chave é dela. Telefone, e-mail e chave
// aleatória não batem com nada — são uma string que ninguém consegue conferir
// contra o cadastro.
//
// Não é preciosismo. O Paulo cadastrou +55 81 99988-7766 num cadastro cujo CPF
// é 999.888.777-14, enquanto a contraparte que de fato recebe tem outro CPF.
// Os dois números são sequência de teclado; nenhum dos dois dá erro. Uma chave
// dessas entrando sozinha num lote é dinheiro indo embora em silêncio.
// `--tudo` libera, e aí a decisão tem dono.
import { randomUUID } from 'node:crypto';
import pg from 'pg';

import { financeDatabaseUrl } from './lib/artifact-db.mjs';
import { conferirDocumento, digitosDe } from './lib/fin-documento.mjs';
import { loadEnv } from './lib/env.mjs';

loadEnv();

const APLICAR = process.argv.includes('--aplicar');
const TUDO = process.argv.includes('--tudo');
const pool = new pg.Pool({ connectionString: financeDatabaseUrl(), max: 2, options: '-c jit=off' });
const ATOR = 'script:aplicar-chave-pix-cadastrada';
const LOTE = randomUUID();

// fin_person_pagamento fala 'cpf'; fin_payee_account fala 'CPF'. Mapa explícito
// nas duas direções — um upper()/lower() silencioso gravaria 'TELEFONE', que o
// CHECK recusa, e 'phone', que o outro CHECK também recusa.
const PARA_PAYEE = { cpf: 'CPF', cnpj: 'CNPJ', email: 'EMAIL', telefone: 'PHONE', aleatoria: 'EVP' };
const PARA_APP = { CPF: 'cpf', CNPJ: 'cnpj', EMAIL: 'email', PHONE: 'telefone', EVP: 'aleatoria' };

const cauda = (s) => (s ? `…${String(s).trim().slice(-4)}` : '—');
const n = (s, t) => String(s ?? '—').slice(0, t).padEnd(t);

async function auditar(client, tabela, alvo, acao, antes, depois, campos) {
  await client.query(
    `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, before, after, fields, batch_id, actor)
     VALUES ((SELECT id FROM fin_entity WHERE slug='xpe'), $1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8)`,
    [tabela, alvo, acao, JSON.stringify(antes), JSON.stringify(depois), campos, LOTE, ATOR]
  );
}

const { rows: pessoas } = await pool.query(
  `WITH contas AS (
     -- Todas as contas ativas de TODAS as contrapartes da pessoa, com a mesma
     -- preferência que a folha aplica — a primária primeiro.
     SELECT p.id AS person_id, pa.id AS conta_id, pa.counterparty_id, pa.is_default,
            pa.pix_address_key_type AS tipo, pa.pix_address_key AS chave, pa.label,
            c.document_number AS doc_contraparte,
            (pa.counterparty_id = p.counterparty_id) AS eh_primaria
       FROM fin_person p
       JOIN fin_payee_account pa
         ON pa.is_active
        AND (pa.counterparty_id = p.counterparty_id
             OR pa.counterparty_id IN (SELECT l.counterparty_id FROM fin_person_counterparty l
                                        WHERE l.person_id = p.id AND l.status = 'confirmado'))
       JOIN fin_counterparty c ON c.id = pa.counterparty_id
   )
   SELECT p.id, p.name, p.cpf, p.cnpj, p.counterparty_id,
          pg.pix_tipo, pg.pix_chave, pg.titular_e_a_pessoa, pg.titular_nome, pg.titular_documento,
          COALESCE(json_agg(json_build_object(
            'contaId', ct.conta_id, 'counterpartyId', ct.counterparty_id, 'isDefault', ct.is_default,
            'tipo', ct.tipo, 'chave', ct.chave, 'label', ct.label,
            'doc', ct.doc_contraparte, 'ehPrimaria', ct.eh_primaria
          ) ORDER BY ct.eh_primaria DESC, ct.conta_id DESC)
            FILTER (WHERE ct.conta_id IS NOT NULL), '[]') AS contas
     FROM fin_person p
     JOIN fin_entity e ON e.id = p.entity_id AND e.slug = 'xpe'
     LEFT JOIN fin_person_pagamento pg ON pg.person_id = p.id AND pg.metodo = 'pix'
     LEFT JOIN contas ct ON ct.person_id = p.id
    WHERE p.status = 'ativo'
    GROUP BY p.id, p.name, p.cpf, p.cnpj, p.counterparty_id,
             pg.pix_tipo, pg.pix_chave, pg.titular_e_a_pessoa, pg.titular_nome, pg.titular_documento
    ORDER BY p.name`
);

// A conta que a folha escolheria HOJE: a primeira padrão, na ordem da primária.
const escolhida = (contas) => contas.find((c) => c.isDefault) ?? null;
const mesma = (a, b) => {
  const da = digitosDe(a);
  return da ? da === digitosDe(b) : String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();
};

const trocas = [];
const semear = [];
const travadas = [];

for (const p of pessoas) {
  const contas = p.contas ?? [];
  const atual = escolhida(contas);

  if (p.pix_chave) {
    if (atual && mesma(p.pix_chave, atual.chave)) continue; // já aponta para lá
    // Verificável = a chave é um documento que bate com o cadastro da pessoa.
    const v = conferirDocumento(p.pix_chave);
    const verificavel =
      v.valido &&
      ((p.pix_tipo === 'cpf' && v.digitos === p.cpf) || (p.pix_tipo === 'cnpj' && v.digitos === p.cnpj));
    const alvo = contas.find((c) => mesma(p.pix_chave, c.chave)) ?? null;
    const item = { ...p, atual, alvo, verificavel };
    if (verificavel || TUDO) trocas.push(item);
    else travadas.push(item);
    continue;
  }

  // Sem cadastro no app: semeia com o que a casa já usa.
  if (atual && PARA_APP[atual.tipo]) semear.push({ ...p, atual });
}

console.log(`\nChave cadastrada ⇄ chave que paga — ${APLICAR ? 'APLICANDO' : 'apenas mostrando'}\n`);

// ---------------------------------------------------------------------------
// 1. A coordenada passa a apontar para o que a pessoa cadastrou
// ---------------------------------------------------------------------------
console.log(`A COORDENADA PASSA A SEGUIR O CADASTRO — ${trocas.length}\n`);
for (const t of trocas) {
  const de = t.atual ? `${t.atual.tipo} ${cauda(t.atual.chave)}` : 'sem coordenada';
  console.log(
    `  → ${n(t.name, 26)} ${n(de, 14)} passa a ${n(PARA_PAYEE[t.pix_tipo], 5)} ${cauda(t.pix_chave)}` +
      `   ${t.alvo ? 'conta já existe' : 'conta nova'}${t.verificavel ? '' : '  (LIBERADA POR --tudo)'}`
  );
  if (!APLICAR) continue;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Quem perde o padrão: só as contas que competiam de fato. Desativar não —
    // a conta antiga continua sendo verdade histórica de para onde já se pagou.
    for (const c of t.contas.filter((c) => c.isDefault && !mesma(t.pix_chave, c.chave))) {
      await client.query('UPDATE fin_payee_account SET is_default = false WHERE id = $1', [c.contaId]);
      await auditar(client, 'fin_payee_account', c.contaId, 'update',
        { is_default: true }, { is_default: false, motivo: `pessoa ${t.id} cadastrou outra chave no app` },
        ['is_default']);
    }
    if (t.alvo) {
      await client.query('UPDATE fin_payee_account SET is_default = true WHERE id = $1', [t.alvo.contaId]);
      await auditar(client, 'fin_payee_account', t.alvo.contaId, 'update',
        { is_default: t.alvo.isDefault }, { is_default: true, motivo: `chave cadastrada pela pessoa ${t.id}` },
        ['is_default']);
    } else {
      // Conta nova: na contraparte cujo DOCUMENTO é a própria chave, quando ela
      // existe. É o caso do MEI — a chave é o CNPJ, e a contraparte do CNPJ é
      // quem o extrato já conhece. Sem ela, vai na primária.
      const doc = digitosDe(t.pix_chave);
      const destino =
        t.contas.find((c) => doc && digitosDe(c.doc) === doc)?.counterpartyId ?? t.counterparty_id;
      if (!destino) {
        console.log(`     ✗ ${t.name} não tem contraparte — nada a fazer`);
        await client.query('ROLLBACK');
        continue;
      }
      const { rows } = await client.query(
        `INSERT INTO fin_payee_account
           (counterparty_id, label, operation_type, pix_address_key, pix_address_key_type,
            owner_name, owner_document, is_default, is_active)
         VALUES ($1, $2, 'PIX', $3, $4, $5, $6, true, true) RETURNING id`,
        [
          destino,
          `chave do app · pessoa ${t.id}`,
          String(t.pix_chave).trim(),
          PARA_PAYEE[t.pix_tipo],
          t.titular_nome,
          t.titular_documento
        ]
      );
      await auditar(client, 'fin_payee_account', rows[0].id, 'insert', null,
        { counterparty_id: destino, tipo: PARA_PAYEE[t.pix_tipo], cauda: cauda(t.pix_chave) },
        ['pix_address_key', 'is_default']);
    }
    await client.query('COMMIT');
  } catch (erro) {
    await client.query('ROLLBACK');
    console.log(`     ✗ ${t.name}: ${erro.message}`);
  } finally {
    client.release();
  }
}
if (!trocas.length) console.log('  Nenhuma. Todo mundo que cadastrou já recebe onde cadastrou.');

// ---------------------------------------------------------------------------
// 2. Quem não cadastrou vê, no app, a chave que a casa já usa
// ---------------------------------------------------------------------------
console.log(`\nO APP PASSA A MOSTRAR A CHAVE QUE JÁ USAMOS — ${semear.length}\n`);
for (const s of semear) {
  console.log(
    `  + ${n(s.name, 26)} ${n(PARA_APP[s.atual.tipo], 9)} ${n(cauda(s.atual.chave), 8)} ${String(s.atual.label ?? '')}`
  );
  if (!APLICAR) continue;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO fin_person_pagamento
         (person_id, entity_id, metodo, pix_tipo, pix_chave, titular_e_a_pessoa,
          recebe_salario, recebe_reembolso, observacao, atualizado_por)
       VALUES ($1, (SELECT id FROM fin_entity WHERE slug='xpe'), 'pix', $2, $3, true, true, true, $4, $5)
       ON CONFLICT (person_id) DO NOTHING`,
      [
        s.id,
        PARA_APP[s.atual.tipo],
        String(s.atual.chave).trim(),
        // A observação é lida pela PESSOA, no app. Ela precisa saber que isto
        // não foi ela que digitou, e que trocar é com ela.
        'Chave que a XPE já usa para te pagar, trazida do histórico. Confira e altere se quiser receber em outra.',
        ATOR
      ]
    );
    await auditar(client, 'fin_person_pagamento', s.id, 'insert', null,
      { pix_tipo: PARA_APP[s.atual.tipo], cauda: cauda(s.atual.chave), origem: s.atual.label },
      ['pix_tipo', 'pix_chave']);
    await client.query('COMMIT');
  } catch (erro) {
    await client.query('ROLLBACK');
    console.log(`     ✗ ${s.name}: ${erro.message}`);
  } finally {
    client.release();
  }
}
if (!semear.length) console.log('  Nenhuma. Todo mundo já tem cadastro no app.');

// ---------------------------------------------------------------------------
// 3. O que não entra sozinho
// ---------------------------------------------------------------------------
if (travadas.length) {
  console.log(`\nCADASTRARAM UMA CHAVE QUE NINGUÉM CONSEGUE CONFERIR — ${travadas.length}\n`);
  for (const t of travadas) {
    console.log(
      `  ! ${n(t.name, 26)} cadastrou ${n(t.pix_tipo, 9)} ${cauda(t.pix_chave)}, ` +
        `hoje recebe em ${t.atual ? `${t.atual.tipo} ${cauda(t.atual.chave)}` : 'lugar nenhum'}`
    );
  }
  console.log('\n    Telefone, e-mail e chave aleatória não batem com documento nenhum do');
  console.log('    cadastro — não dá para provar que a chave é da pessoa. Confirme com ela');
  console.log('    e rode com `--tudo`, ou peça que cadastre CPF/CNPJ no app.');
}

console.log(
  APLICAR
    ? `\n  ${trocas.length} coordenada(s) trocada(s) · ${semear.length} cadastro(s) semeado(s) · ${travadas.length} travada(s) · lote ${LOTE}\n`
    : `\n  ${trocas.length} troca(s) · ${semear.length} semeadura(s) · ${travadas.length} travada(s). Para gravar: --aplicar\n`
);

await pool.end();

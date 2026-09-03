// Em QUAL documento cada pessoa recebe — e em qual deveria receber.
// SÓ LEITURA. Não grava nada, não sobrescreve coordenada de ninguém.
//
//   npm run pix:titularidade                todas as pessoas ativas
//   npm run pix:titularidade -- --completo  mostra as chaves inteiras
//
// ---------------------------------------------------------------------------
// POR QUE ESTE DIAGNÓSTICO NÃO É O `chaves:pix`
// ---------------------------------------------------------------------------
// `diagnostico-chaves-pix.mjs` responde "dá para pagar?" — e hoje a resposta é
// 25/25. Com todo mundo pagável, a pergunta que sobra é outra: o dinheiro está
// caindo no documento CERTO?
//
// Ela existe porque o time da XPE é MEI (a 0159 já registra: "a empresa paga o
// DAS deles, e boa parte recebe no CNPJ, não no CPF"). Quando o MEI recebe no
// CPF da pessoa, o pagamento funciona — o PIX cai, o comprovante sai, ninguém
// vê erro. O que quebra é fiscal e acontece meses depois: a receita não entra
// no faturamento do MEI, o DAS que a empresa paga não tem lastro, e o gasto da
// XPE fica contra uma pessoa física sem nota. Nenhuma dessas consequências
// aparece na tela de pagamento, e é por isso que precisa de um script.
//
// ---------------------------------------------------------------------------
// TRÊS COISAS QUE PODEM DISCORDAR, E A ORDEM DE AUTORIDADE ENTRE ELAS
// ---------------------------------------------------------------------------
//   1. fin_payee_account (0001)     onde o dinheiro CAI hoje. É o que
//                                   `pagar-programar.ts` lê. Manda no presente.
//   2. fin_person_pagamento (0159)  o que a PESSOA cadastrou no app do time.
//                                   É a intenção dela — e note que `conferido_em`
//                                   existe justamente porque ninguém olhou ainda.
//   3. fin_person.cpf / .cnpj       quem a pessoa É. A 0077 deriva o CNPJ do
//                                   vínculo `confirmado`, não de digitação.
//
// Divergência entre 1 e 2 não é erro de dado: é uma decisão pendente. A ponte
// `pix:pessoa:aplicar` se RECUSA a sobrescrever conta padrão ativa, de
// propósito — "trocar a coordenada de um favorecido sem alguém decidir é a
// operação que a 0075 chama de mais cara para errar". Este script é onde essa
// decisão fica visível em vez de ficar pendurada.
//
// O DV é conferido com o mesmo `conferirDocumento` da escrita (fin-documento),
// porque chave no formato certo e chave emitida são coisas diferentes — e uma
// chave inválida só dá erro na hora do pagamento, com pressa.
import { financePool } from './lib/artifact-db.mjs';
import { conferirDocumento, digitosDe } from './lib/fin-documento.mjs';
import { loadEnv } from './lib/env.mjs';

loadEnv();

const COMPLETO = process.argv.includes('--completo');
const pool = financePool();

// Mascarada por padrão: este relatório é para colar em conversa, e chave PIX
// inteira em conversa é o insumo do golpe de troca de destinatário.
const m = (s) => {
  const v = String(s ?? '').trim();
  if (!v) return '—';
  if (COMPLETO) return v;
  return v.length <= 4 ? v : `…${v.slice(-4)}`;
};
const doc = (s) => (s ? String(s).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : '—');
// O pg devolve timestamptz como Date; `String(date).slice(0,10)` daria "Tue Sep 01".
const dia = (v) => (v ? new Date(v).toISOString().slice(0, 10) : '—');

// fin_person_pagamento fala 'cnpj'; fin_payee_account fala 'CNPJ'. Comparar sem
// normalizar faria toda linha divergir de si mesma.
const MESMO_TIPO = { cpf: 'CPF', cnpj: 'CNPJ', email: 'EMAIL', telefone: 'PHONE', aleatoria: 'EVP' };

const { rows } = await pool.query(
  `WITH coord AS (
     -- A MESMA resolução que o pagamento usa (0169: N contrapartes por pessoa,
     -- o MEI no CNPJ e a pessoa no CPF). Só vínculo 'confirmado': palpite do
     -- casador automático não escolhe para onde o dinheiro vai.
     SELECT DISTINCT ON (p.id)
            p.id AS person_id, pa.pix_address_key_type AS tipo,
            pa.pix_address_key AS chave, pa.label, c.document_number AS doc_contraparte,
            c.name AS contraparte
       FROM fin_person p
       JOIN fin_payee_account pa
         ON pa.is_default AND pa.is_active
        AND (pa.counterparty_id = p.counterparty_id
             OR pa.counterparty_id IN (SELECT l.counterparty_id FROM fin_person_counterparty l
                                        WHERE l.person_id = p.id AND l.status = 'confirmado'))
       JOIN fin_counterparty c ON c.id = pa.counterparty_id
      ORDER BY p.id, (pa.counterparty_id = p.counterparty_id) DESC, pa.id DESC
   ),
   -- Existe conta no CNPJ da pessoa esperando ser escolhida? Muda a instrução:
   -- é escolher entre duas que já existem, não cadastrar uma nova.
   pj AS (
     SELECT DISTINCT p.id AS person_id, pa.pix_address_key AS chave
       FROM fin_person p
       JOIN fin_person_counterparty l ON l.person_id = p.id AND l.status = 'confirmado'
       JOIN fin_counterparty c ON c.id = l.counterparty_id AND c.document_number = p.cnpj
       JOIN fin_payee_account pa ON pa.counterparty_id = c.id AND pa.is_active
      WHERE p.cnpj IS NOT NULL AND pa.pix_address_key_type = 'CNPJ'
   )
   SELECT p.name AS pessoa, p.employment_type AS vinculo, p.cpf, p.cnpj,
          pg.pix_tipo AS app_tipo, pg.pix_chave AS app_chave,
          pg.titular_e_a_pessoa AS app_titular_e_a_pessoa, pg.titular_nome AS app_titular,
          pg.conferido_em AS app_conferida, pg.criado_em AS app_criado,
          co.tipo AS pag_tipo, co.chave AS pag_chave, co.label AS pag_origem,
          co.doc_contraparte AS pag_doc, co.contraparte AS pag_contraparte,
          pj.chave AS pj_pronta
     FROM fin_person p
     JOIN fin_entity e ON e.id = p.entity_id AND e.slug = 'xpe'
     LEFT JOIN fin_person_pagamento pg ON pg.person_id = p.id AND pg.metodo = 'pix'
     LEFT JOIN coord co ON co.person_id = p.id
     LEFT JOIN pj ON pj.person_id = p.id
    WHERE p.status = 'ativo'
    ORDER BY p.name`
);

// ---------------------------------------------------------------------------
// Classificação. Cada pessoa cai em zero ou mais listas — os problemas se
// acumulam (o Paulo é ao mesmo tempo divergente e com documento suspeito), e
// esconder o segundo porque o primeiro já apareceu é como se perde um deles.
// ---------------------------------------------------------------------------
const trocarParaPj = [];   // MEI recebendo fora do próprio CNPJ
const divergem = [];       // app diz uma coisa, pagamento faz outra
const suspeitas = [];      // chave/documento que não fecha com a pessoa
const cadastraram = [];
const semCadastro = [];

for (const r of rows) {
  const appChave = r.app_chave ? String(r.app_chave).trim() : null;
  const pagChave = r.pag_chave ? String(r.pag_chave).trim() : null;
  (appChave ? cadastraram : semCadastro).push(r);

  // 1. MEI fora do CNPJ. `p.cnpj` só existe quando um humano confirmou o
  //    vínculo (0077), então CNPJ nulo aqui é "não sei", não "não tem".
  if (r.cnpj && digitosDe(pagChave) !== r.cnpj) {
    trocarParaPj.push({
      ...r,
      jaCadastrouNoApp: digitosDe(appChave) === r.cnpj,
      contaPjPronta: Boolean(r.pj_pronta)
    });
  }

  // 2. O app e o pagamento discordam. Comparo por dígitos quando os dois lados
  //    são documento/telefone, e literal para e-mail e chave aleatória.
  if (appChave && pagChave) {
    const iguais =
      MESMO_TIPO[r.app_tipo] === r.pag_tipo &&
      (digitosDe(appChave) ? digitosDe(appChave) === digitosDe(pagChave) : appChave === pagChave);
    if (!iguais) divergem.push(r);
  }

  // 3. Chave que não fecha com a identidade da pessoa. Cada motivo é separado
  //    porque a AÇÃO é diferente: DV inválido se corrige com a pessoa, CPF que
  //    não bate se investiga no vínculo.
  const motivos = [];
  for (const [origem, tipo, chave] of [
    ['no app', r.app_tipo, appChave],
    ['no pagamento', (r.pag_tipo || '').toLowerCase(), pagChave]
  ]) {
    if (!chave) continue;
    if (tipo === 'cpf' || tipo === 'cnpj') {
      const v = conferirDocumento(chave);
      if (!v.valido) motivos.push(`chave ${origem} — ${v.motivo}`);
      else if (tipo === 'cpf' && r.cpf && v.digitos !== r.cpf) {
        motivos.push(`CPF ${origem} não é o CPF cadastrado da pessoa`);
      } else if (tipo === 'cnpj' && r.cnpj && v.digitos !== r.cnpj) {
        motivos.push(`CNPJ ${origem} não é o CNPJ do MEI dela`);
      }
    }
  }
  // O CPF do cadastro também precisa fechar: é ele que julga as chaves acima, e
  // um CPF placeholder aprova qualquer coisa por ser diferente de tudo.
  if (r.cpf && !conferirDocumento(r.cpf).valido) {
    motivos.push(`o CPF em fin_person (${m(r.cpf)}) não passa no dígito verificador`);
  }
  if (r.pag_doc && r.cpf && r.pag_doc !== r.cpf && r.pag_doc !== r.cnpj) {
    motivos.push(`paga numa contraparte de documento ${m(r.pag_doc)}, que não é CPF nem CNPJ dela`);
  }
  // "O titular não sou eu" com o PRÓPRIO nome no campo é o caso comum aqui: a
  // pessoa lê "titular" como o titular do CNPJ, que é ela. Distinguir importa —
  // um é caixa marcada errada, o outro é dinheiro indo para um terceiro.
  if (r.app_titular_e_a_pessoa === false) {
    const primeiro = String(r.pessoa).split(' ')[0].toLowerCase();
    const ehElaMesma = String(r.app_titular ?? '').toLowerCase().includes(primeiro);
    motivos.push(
      ehElaMesma
        ? `declarou que o titular não é ela, mas informou o próprio nome (${r.app_titular}) — provável caixa marcada errada`
        : `o titular declarado não é a pessoa: ${r.app_titular ?? 'sem nome'}`
    );
  }
  if (motivos.length) suspeitas.push({ ...r, motivos });
}

const n = (s, t) => String(s ?? '—').slice(0, t).padEnd(t);

console.log(`\nTitularidade das chaves PIX — ${rows.length} pessoas ativas\n`);

if (trocarParaPj.length) {
  console.log(`RECEBEM FORA DO CNPJ DO MEI — ${trocarParaPj.length} pessoa(s)\n`);
  for (const r of trocarParaPj) {
    console.log(
      `  ⚠ ${n(r.pessoa, 26)} ${n(r.vinculo, 11)} recebe em ${n(r.pag_tipo, 5)} ${n(m(r.pag_chave), 8)} → CNPJ ${doc(r.cnpj)}`
    );
    console.log(
      `     ${r.jaCadastrouNoApp ? 'JÁ cadastrou o CNPJ no app — falta só trocar a coordenada' : 'ainda não cadastrou o CNPJ no app'}` +
        `${r.contaPjPronta ? ' · a conta no CNPJ já existe no cadastro de favorecidos' : ''}`
    );
  }
  console.log('\n    A ponte automática NÃO resolve estes: `pix:pessoa:aplicar` se recusa a');
  console.log('    sobrescrever conta padrão ativa. A troca é decisão de quem paga — trocar');
  console.log('    coordenada de favorecido é a operação mais cara de errar (0075).');
}

if (divergem.length) {
  console.log(`\nO APP DIZ UMA COISA, O PAGAMENTO FAZ OUTRA — ${divergem.length}\n`);
  for (const r of divergem) {
    console.log(
      `  ≠ ${n(r.pessoa, 26)} app: ${n(r.app_tipo, 9)} ${n(m(r.app_chave), 8)}  ` +
        `pagamento: ${n(r.pag_tipo, 5)} ${n(m(r.pag_chave), 8)} (${String(r.pag_origem ?? '')})`
    );
  }
}

if (suspeitas.length) {
  console.log(`\nCHAVE OU DOCUMENTO QUE NÃO FECHA COM A PESSOA — ${suspeitas.length}\n`);
  for (const r of suspeitas) {
    console.log(`  ! ${r.pessoa}`);
    for (const motivo of r.motivos) console.log(`      ${motivo}`);
  }
}

console.log(`\nCADASTRARAM NO APP — ${cadastraram.length} de ${rows.length}\n`);
for (const r of cadastraram) {
  console.log(
    `  ✓ ${n(r.pessoa, 26)} ${n(r.vinculo, 11)} ${n(r.app_tipo, 9)} ${n(m(r.app_chave), 8)} ` +
      `${dia(r.app_criado).padEnd(12)}${r.app_conferida ? 'conferida' : 'NÃO conferida pelo financeiro'}`
  );
}

console.log(`\nAINDA NÃO CADASTRARAM — ${semCadastro.length}\n`);
for (const r of semCadastro) {
  console.log(
    `  · ${n(r.pessoa, 26)} ${n(r.vinculo, 11)} paga hoje em ${n(r.pag_tipo, 5)} ${n(m(r.pag_chave), 8)} ` +
      `${String(r.pag_origem ?? '')}`
  );
}

const conferidas = cadastraram.filter((r) => r.app_conferida).length;
console.log(
  `\n  ${cadastraram.length}/${rows.length} cadastraram no app · ${conferidas} conferida(s) pelo financeiro · ` +
    `${trocarParaPj.length} recebendo fora do CNPJ do MEI\n`
);

await pool.end();

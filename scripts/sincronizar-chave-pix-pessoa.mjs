// Leva a chave PIX que a pessoa cadastrou no app para onde o pagamento a lê.
//
//   node scripts/sincronizar-chave-pix-pessoa.mjs             mostra o que faria
//   node scripts/sincronizar-chave-pix-pessoa.mjs --aplicar   grava
//
// ---------------------------------------------------------------------------
// POR QUE ESTA PONTE PRECISA EXISTIR
// ---------------------------------------------------------------------------
// São duas tabelas para a mesma coordenada, e elas nasceram em eixos
// diferentes:
//
//   fin_person_pagamento (0159)  chave PIX da PESSOA. É o que o app do time
//                                escreve — "o cadastro pessoal de cada um".
//   fin_payee_account (0001)     coordenada do FAVORECIDO, por contraparte. É
//                                o que `pagar-programar.ts` lê para montar a
//                                ordem, e a 0001 diz por quê: "as colunas são
//                                deliberadamente as que POST /transfers
//                                consome, para que ligar pagamento automático
//                                seja acrescentar um executor, não remodelar
//                                cadastro".
//
// A 0012 já tinha decidido que pessoa NÃO é contraparte — "fin_counterparty
// responde 'para quem o dinheiro foi'; fin_person responde 'quem é do time'".
// As duas tabelas estão certas; o que faltava era o trilho entre elas.
//
// A ALTERNATIVA ERA PIOR. Fazer o pagamento ler as duas tabelas bifurca a
// resolução do favorecido em dois caminhos — e resolução de favorecido em dois
// caminhos é exatamente onde a fraude de troca de destinatário se esconde. Uma
// porta só, com o snapshot e o fingerprint que a 0075 exige, vale mais que a
// conveniência de não copiar o dado.
//
// NÃO SOBRESCREVE. Contraparte que já tem conta padrão ativa fica como está e
// é reportada — trocar a coordenada de um favorecido sem alguém decidir é a
// operação que a 0075 chama de mais cara para errar.
import { createHash } from 'node:crypto';
import pg from 'pg';

import { financeDatabaseUrl } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';

loadEnv();

const APLICAR = process.argv.includes('--aplicar');
const pool = new pg.Pool({ connectionString: financeDatabaseUrl(), max: 2, options: '-c jit=off' });

// fin_person_pagamento fala 'cpf'; fin_payee_account fala 'CPF'. Mapa explícito
// em vez de upper(): 'telefone' vira 'PHONE' e 'aleatoria' vira 'EVP', e um
// upper() silencioso gravaria 'TELEFONE', que o CHECK recusa.
const TIPO = { cpf: 'CPF', cnpj: 'CNPJ', email: 'EMAIL', telefone: 'PHONE', aleatoria: 'EVP' };

const candidatos = await pool.query(
  `SELECT pp.person_id,
          p.name                AS pessoa,
          p.counterparty_id,
          pp.metodo,
          pp.pix_tipo,
          pp.pix_chave,
          pp.conferido_em,
          COALESCE(pp.titular_nome, p.name)  AS titular_nome,
          pp.titular_documento,
          (SELECT count(*)::int FROM fin_payee_account pa
            WHERE pa.counterparty_id = p.counterparty_id AND pa.is_default AND pa.is_active) AS ja_tem
     FROM fin_person_pagamento pp
     JOIN fin_person p ON p.id = pp.person_id
    WHERE pp.metodo = 'pix'
      AND nullif(btrim(coalesce(pp.pix_chave,'')),'') IS NOT NULL
    ORDER BY p.name`
);

console.log(`\nChave PIX de pessoa → conta favorecida — ${APLICAR ? 'APLICANDO' : 'apenas mostrando'}\n`);

if (candidatos.rows.length === 0) {
  console.log('  Nenhuma pessoa tem chave PIX cadastrada em fin_person_pagamento.');
  console.log('  Sem isso não há o que sincronizar — o cadastro começa no app do time.\n');
  await pool.end();
  process.exit(0);
}

let criadas = 0;
let puladas = 0;
for (const r of candidatos.rows) {
  const tipo = TIPO[r.pix_tipo];
  const rotulo = String(r.pessoa).slice(0, 28).padEnd(28);

  if (!r.counterparty_id) {
    console.log(`  ✗ ${rotulo} pessoa sem contraparte — não há para onde levar`);
    puladas += 1;
    continue;
  }
  if (!tipo) {
    console.log(`  ✗ ${rotulo} pix_tipo '${r.pix_tipo}' não tem equivalente em fin_payee_account`);
    puladas += 1;
    continue;
  }
  if (r.ja_tem > 0) {
    console.log(`  ·  ${rotulo} já tem conta padrão ativa — NÃO sobrescrevo`);
    puladas += 1;
    continue;
  }

  // Só o tipo e os quatro últimos aparecem no log. A chave inteira não.
  const cauda = String(r.pix_chave).trim().slice(-4);
  const selo = r.conferido_em ? 'conferida' : 'NÃO conferida pelo financeiro';
  console.log(`  +  ${rotulo} ${tipo} …${cauda}  (${selo})`);
  criadas += 1;

  if (APLICAR) {
    await pool.query(
      `INSERT INTO fin_payee_account
         (counterparty_id, label, operation_type, pix_address_key, pix_address_key_type,
          owner_name, owner_document, is_default, is_active)
       VALUES ($1, $2, 'PIX', $3, $4, $5, $6, true, true)`,
      [
        r.counterparty_id,
        `chave do app · pessoa ${r.person_id}`,
        String(r.pix_chave).trim(),
        tipo,
        r.titular_nome,
        r.titular_documento
      ]
    );
  }
}

console.log(
  APLICAR
    ? `\n  ${criadas} conta(s) criada(s), ${puladas} pulada(s).\n`
    : `\n  ${criadas} conta(s) seriam criadas, ${puladas} pulada(s). Para aplicar: --aplicar\n`
);

// O que ainda falta, que é a informação que importa para o dono.
const faltam = await pool.query(
  `SELECT count(*)::int AS ativas,
          count(*) FILTER (WHERE EXISTS (
            SELECT 1 FROM fin_payee_account pa
             WHERE pa.counterparty_id = p.counterparty_id AND pa.is_default AND pa.is_active))::int AS pagaveis
     FROM fin_person p WHERE p.status = 'ativo'`
);
const { ativas, pagaveis } = faltam.rows[0];
console.log(`  ${pagaveis}/${ativas} pessoas ativas têm coordenada de pagamento. Faltam ${ativas - pagaveis}.\n`);

await pool.end();

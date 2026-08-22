// Cadastra e-mail, senha e perfil de uma pessoa do time.
//
//   node scripts/definir-acesso.mjs --pessoa "Fernando" --email fernando.xpenergy@gmail.com --admin
//   XPE_SENHA='...' node scripts/definir-acesso.mjs --pessoa "Igor" --email igor.xpenergy@gmail.com --admin --aplicar
//   node scripts/definir-acesso.mjs --listar
//
// POR QUE A SENHA VEM DO AMBIENTE E NUNCA DE ARGUMENTO
// Argumento de linha de comando aparece em `ps`, no histórico do shell e em
// qualquer log de processo da máquina. Variável de ambiente de um comando único
// (`XPE_SENHA='...' node ...`) não entra no histórico quando a linha começa com
// espaço, e não aparece em `ps` de outro usuário.
//
// Se `XPE_SENHA` não vier, o script SORTEIA uma senha forte e a imprime UMA vez
// — para o admin copiar e entregar por um canal fora daqui. Ela nasce com
// `senha_trocar = true`: quem definiu conhece o valor, então ela tem de morrer
// na primeira sessão da pessoa.
//
// Como toda escrita desta base: dry-run por padrão, `--aplicar` para valer.
import { randomBytes, scryptSync } from 'node:crypto';
import pg from 'pg';

import { financeDatabaseUrl } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';

loadEnv();

const args = process.argv.slice(2);
const valorDe = (nome) => {
  const i = args.indexOf(`--${nome}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null;
};
const tem = (nome) => args.includes(`--${nome}`);

const APLICAR = tem('aplicar');
const ENTITY = 'xpe';

// Os mesmos parâmetros de lib/financeiro/time.ts. Se um mudar lá, muda aqui —
// o formato guarda N/r/p justamente para que hashes antigos sigam válidos.
const SCRYPT = { N: 16384, r: 8, p: 1, tamanho: 32 };
function hashDeSenha(senha) {
  const salt = randomBytes(16);
  const hash = scryptSync(senha.normalize('NFKC'), salt, SCRYPT.tamanho, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024
  });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

// Sem ambiguidade visual: nada de O/0, l/1/I. A pessoa vai digitar isto num
// teclado de celular, provavelmente lendo de um print.
const ALFABETO = 'abcdefghijkmnpqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ23456789';
function sortearSenha(n = 14) {
  const bytes = randomBytes(n * 2);
  let s = '';
  for (let i = 0; s.length < n; i += 1) s += ALFABETO[bytes[i % bytes.length] % ALFABETO.length];
  return s;
}

const url = financeDatabaseUrl();
if (!url) {
  console.error('FINANCE_DATABASE_URL ausente.');
  process.exit(1);
}
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

try {
  if (tem('listar')) {
    const { rows } = await client.query(
      `SELECT p.id, p.name, p.email, p.is_admin,
              (a.senha_hash IS NOT NULL) AS tem_senha, a.senha_trocar, a.status, a.last_seen_at
         FROM fin_person p
         JOIN fin_entity e ON e.id = p.entity_id AND e.slug = $1
         LEFT JOIN fin_person_acesso a ON a.person_id = p.id
        WHERE p.status = 'ativo'
        ORDER BY (p.email IS NULL), p.name`,
      [ENTITY]
    );
    console.table(rows.map((r) => ({
      id: r.id, nome: r.name, email: r.email ?? '—', admin: r.is_admin ? 'sim' : '',
      senha: r.tem_senha ? (r.senha_trocar ? 'de entrega' : 'trocada') : '—',
      acesso: r.status ?? '—', ultimo_uso: r.last_seen_at ? r.last_seen_at.toISOString().slice(0, 10) : '—'
    })));
    process.exit(0);
  }

  const nome = valorDe('pessoa');
  const email = valorDe('email');
  if (!nome || !email) {
    console.error('uso: --pessoa "Nome" --email endereco@dominio  [--admin] [--aplicar]');
    console.error('     --listar');
    process.exit(1);
  }

  const alvo = await client.query(
    `SELECT p.id, p.name, p.email, p.is_admin FROM fin_person p
       JOIN fin_entity e ON e.id = p.entity_id AND e.slug = $2
      WHERE p.status = 'ativo' AND lower(p.name) = lower($1)`,
    [nome, ENTITY]
  );
  if (alvo.rows.length === 0) {
    console.error(`nenhuma pessoa ativa chamada "${nome}". Rode --listar para ver os nomes.`);
    process.exit(1);
  }
  if (alvo.rows.length > 1) {
    console.error(`"${nome}" casa com ${alvo.rows.length} pessoas. Seja específico.`);
    process.exit(1);
  }
  const pessoa = alvo.rows[0];

  const doAmbiente = process.env.XPE_SENHA && String(process.env.XPE_SENHA).trim();
  if (doAmbiente && doAmbiente.length < 8) {
    console.error('a senha precisa de pelo menos 8 caracteres.');
    process.exit(1);
  }
  const senha = doAmbiente || sortearSenha();
  const admin = tem('admin');

  console.log(`pessoa ......... ${pessoa.name} (id ${pessoa.id})`);
  console.log(`e-mail ......... ${pessoa.email ?? '(nenhum)'} → ${email}`);
  console.log(`admin .......... ${pessoa.is_admin ? 'sim' : 'não'} → ${admin ? 'sim' : 'não'}`);
  console.log(`senha .......... ${doAmbiente ? 'a que veio em XPE_SENHA' : 'sorteada agora'}, marcada para troca no 1º acesso`);

  if (!APLICAR) {
    console.log('\n(dry-run — nada foi escrito. Repita com --aplicar.)');
    process.exit(0);
  }

  await client.query('BEGIN');
  await client.query(`UPDATE fin_person SET email = $2, is_admin = $3, updated_at = now() WHERE id = $1`, [
    pessoa.id, email.trim(), admin
  ]);
  await client.query(
    `INSERT INTO fin_person_acesso (person_id, senha_hash, senha_set_at, senha_set_by, senha_trocar, status)
     VALUES ($1, $2, now(), $3, true, 'ativo')
     ON CONFLICT (person_id) DO UPDATE
        SET senha_hash = EXCLUDED.senha_hash, senha_set_at = now(), senha_set_by = EXCLUDED.senha_set_by,
            senha_trocar = true, status = 'ativo', falhas = 0, bloqueado_ate = NULL`,
    [pessoa.id, hashDeSenha(senha), `definir-acesso (${process.env.USER ?? 'desconhecido'})`]
  );
  // Trocar credencial derruba o que estava aberto. Sessão viva de 30 dias
  // sobreviveria à troca, e aí redefinir a senha de alguém não teria efeito.
  const { rowCount } = await client.query(
    `UPDATE fin_time_sessao SET encerrada_em = now() WHERE person_id = $1 AND encerrada_em IS NULL`,
    [pessoa.id]
  );
  await client.query('COMMIT');

  console.log(`\n✓ gravado. ${rowCount} sessão(ões) anterior(es) encerrada(s).`);
  if (!doAmbiente) {
    console.log('\n  ┌─────────────────────────────────────────────');
    console.log(`  │  senha de entrega:  ${senha}`);
    console.log('  └─────────────────────────────────────────────');
    console.log('  Ela não será mostrada de novo. Entregue por um canal fora do terminal,');
    console.log('  e a pessoa troca no primeiro acesso.');
  }
} catch (erro) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('erro:', erro.message);
  process.exitCode = 1;
} finally {
  await client.end();
}

// Foto local de TUDO que foi preenchido à mão no cadastro de remuneração.
//
// POR QUE EXISTE
// --------------
// Em 29/08/2026 o dono preencheu, em 40 minutos, 21 salários-base, 8
// pró-labores e 4 comissões — dado que não tem origem para reprocessar. Logo
// depois começou uma mudança grande na previsão do /time. Se algo der errado,
// "rodar o sync de novo" não traz esse dado de volta: ele nasceu de uma pessoa
// digitando.
//
// `npm run db:backup` existe e é melhor para restauração completa, mas grava no
// storage remoto. Este aqui é o oposto: um arquivo no disco da máquina, que
// serve para DUAS coisas —
//
//   1. desfazer, se preciso (o JSON tem as linhas inteiras);
//   2. GABARITO: `--conferir` relê o banco e aponta qualquer diferença contra a
//      foto. É como se prova, depois do deploy, que a mudança não mexeu em
//      número que uma pessoa digitou.
//
// Só LÊ o banco. Nunca escreve.
//
// Uso:
//   node scripts/snapshot-cadastro-manual.mjs                 grava a foto
//   node scripts/snapshot-cadastro-manual.mjs --conferir      compara com o banco
//   node scripts/snapshot-cadastro-manual.mjs --conferir --foto=<arquivo>

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';

loadEnv();

const CONFERIR = process.argv.includes('--conferir');
const FOTO_ARG = process.argv.find((a) => a.startsWith('--foto='))?.split('=')[1] ?? null;
const DIR = path.resolve('backups');

// Tudo que guarda decisão humana sobre remuneração. A ordem é a de restauração:
// pai antes de filho.
const TABELAS = [
  ['fin_person', `SELECT id, name, legal_name, cpf, role, area, employment_type, status,
                         default_nucleo, email, whatsapp, birth_date, notes
                    FROM fin_person ORDER BY id`],
  ['fin_pessoa_salario_base', `SELECT * FROM fin_pessoa_salario_base ORDER BY id`],
  ['fin_pessoa_prolabore_esperado', `SELECT * FROM fin_pessoa_prolabore_esperado ORDER BY id`],
  ['fin_comissao_tipo', `SELECT * FROM fin_comissao_tipo ORDER BY ordem`],
  ['fin_pessoa_comissao_serie', `SELECT * FROM fin_pessoa_comissao_serie ORDER BY id`],
  ['fin_pessoa_comissao_declarada', `SELECT * FROM fin_pessoa_comissao_declarada ORDER BY id`],
  ['fin_pessoa_mes_ajuste', `SELECT * FROM fin_pessoa_mes_ajuste ORDER BY id`],
  ['fin_reembolso_item', `SELECT * FROM fin_reembolso_item ORDER BY id`],
  ['fin_reimbursement', `SELECT * FROM fin_reimbursement ORDER BY id`],
  ['fin_reimbursement_item', `SELECT * FROM fin_reimbursement_item ORDER BY id`]
];

// O que a tela mostra, derivado — é aqui que uma regressão apareceria primeiro.
const DERIVADOS = [
  ['declarado_por_pessoa', `
    SELECT p.id, p.name,
           (SELECT valor_cents FROM fin_pessoa_salario_base s
             WHERE s.person_id = p.id ORDER BY vigente_desde DESC, id DESC LIMIT 1) AS salario_base_cents,
           (SELECT valor_cents FROM fin_pessoa_prolabore_esperado pl
             WHERE pl.person_id = p.id ORDER BY vigente_desde DESC, id DESC LIMIT 1) AS prolabore_cents,
           (SELECT coalesce(sum(valor_cents),0) FROM fin_pessoa_comissao_declarada c
             WHERE c.person_id = p.id) AS comissao_total_cents,
           (SELECT coalesce(sum(saldo_cents),0) FROM fin_reembolso_saldo_v v
             WHERE v.person_id = p.id AND NOT v.quitado) AS reembolso_saldo_cents
      FROM fin_person p ORDER BY p.id`],
  ['reembolso_saldo', `SELECT person_id, slug, parcela, parcelas_total, parcelas_restantes,
                              valor_parcela_cents, saldo_cents, quitado
                         FROM fin_reembolso_saldo_v ORDER BY person_id, slug`],
  ['comissao_por_pessoa_mes', `
    SELECT person_id, to_char(competencia,'YYYY-MM') AS mes,
           sum(valor_cents)::bigint AS cents, count(*)::int AS n
      FROM fin_pessoa_comissao_declarada GROUP BY 1,2 ORDER BY 1,2`]
];

const pool = financePool();
const cli = await pool.connect();

async function ler() {
  const foto = { tabelas: {}, derivados: {} };
  for (const [nome, sql] of TABELAS) {
    const { rows } = await cli.query(sql);
    foto.tabelas[nome] = rows;
  }
  for (const [nome, sql] of DERIVADOS) {
    const { rows } = await cli.query(sql);
    foto.derivados[nome] = rows;
  }
  return foto;
}

const brl = (c) => 'R$ ' + (Number(c || 0) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

try {
  const agora = await cli.query(`SELECT to_char(now() AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD_HH24-MI-SS') AS t`);
  const carimbo = agora.rows[0].t;
  const foto = await ler();

  if (!CONFERIR) {
    await mkdir(DIR, { recursive: true });
    const destino = path.join(DIR, `cadastro-manual-${carimbo}.json`);
    await writeFile(destino, JSON.stringify({ carimbo, ...foto }, null, 1), 'utf8');
    // `ultima.json` é o alvo padrão do --conferir: quem confere não precisa
    // lembrar o nome do arquivo.
    await writeFile(path.join(DIR, 'cadastro-manual-ultima.json'), JSON.stringify({ carimbo, ...foto }, null, 1), 'utf8');

    console.log(`=== Foto do cadastro manual — ${carimbo} ===\n`);
    for (const [nome, linhas] of Object.entries(foto.tabelas)) {
      console.log(`  ${nome.padEnd(32)}${String(linhas.length).padStart(5)} linhas`);
    }
    console.log('\n  Declarado por pessoa (o que uma pessoa digitou):');
    let sb = 0, pl = 0, co = 0;
    for (const d of foto.derivados.declarado_por_pessoa) {
      if (!d.salario_base_cents && !d.prolabore_cents && !Number(d.comissao_total_cents)) continue;
      sb += Number(d.salario_base_cents || 0); pl += Number(d.prolabore_cents || 0); co += Number(d.comissao_total_cents || 0);
      console.log(`    ${String(d.name).slice(0,26).padEnd(28)}base ${brl(d.salario_base_cents).padStart(13)}  pró-lab ${brl(d.prolabore_cents).padStart(13)}  comissão ${brl(d.comissao_total_cents).padStart(13)}`);
    }
    console.log(`    ${'TOTAL'.padEnd(28)}base ${brl(sb).padStart(13)}  pró-lab ${brl(pl).padStart(13)}  comissão ${brl(co).padStart(13)}`);
    console.log(`\n✓ gravado em ${destino}`);
    console.log(`  e em ${path.join(DIR, 'cadastro-manual-ultima.json')} (alvo padrão do --conferir)`);
  } else {
    const arquivo = FOTO_ARG ?? path.join(DIR, 'cadastro-manual-ultima.json');
    const antes = JSON.parse(await readFile(arquivo, 'utf8'));
    console.log(`=== Conferindo o banco contra a foto de ${antes.carimbo} ===\n`);
    let divergencias = 0;
    const cmp = (grupo, nome, a, b) => {
      const sa = JSON.stringify(a), sb2 = JSON.stringify(b);
      if (sa === sb2) { console.log(`  ✓ ${grupo}/${nome} idêntico (${a.length} linhas)`); return; }
      divergencias += 1;
      console.log(`  ✗ ${grupo}/${nome} MUDOU — antes ${a.length} linhas, agora ${b.length}`);
      const chave = (r) => JSON.stringify(r.id ?? [r.person_id, r.mes ?? r.slug ?? '']);
      const mapa = new Map(a.map((r) => [chave(r), r]));
      for (const r of b) {
        const v = mapa.get(chave(r));
        if (!v) { console.log(`      + novo: ${JSON.stringify(r).slice(0, 150)}`); continue; }
        for (const k of Object.keys(r)) {
          if (JSON.stringify(v[k]) !== JSON.stringify(r[k])) {
            console.log(`      ~ ${chave(r)} campo ${k}: ${JSON.stringify(v[k])} → ${JSON.stringify(r[k])}`);
          }
        }
        mapa.delete(chave(r));
      }
      for (const [k] of mapa) console.log(`      − sumiu: ${k}`);
    };
    for (const [nome, linhas] of Object.entries(foto.tabelas)) cmp('tabela', nome, antes.tabelas[nome] ?? [], linhas);
    for (const [nome, linhas] of Object.entries(foto.derivados)) cmp('derivado', nome, antes.derivados[nome] ?? [], linhas);
    console.log(divergencias === 0
      ? '\n✓ NADA MUDOU. Todo dado digitado à mão continua idêntico.'
      : `\n⚠ ${divergencias} conjunto(s) divergem da foto — leia acima e decida se era esperado.`);
    if (divergencias) process.exitCode = 1;
  }
} finally {
  cli.release();
  await pool.end();
}

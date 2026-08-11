// Importa a planilha de reembolsos do dono para o ledger.
//
// Por que existe: `fin_reimbursement` foi criada na migration 0012 e nunca
// recebeu um dado. Reembolso sai hoje como PIX idêntico ao salário, para a
// mesma pessoa, no mesmo mês — o banco não sabe a diferença, e por isso
// R$ 22.787,46 apareceram como "acima do fixo" na reconciliação de agosto sem
// nome nem natureza. Esta planilha é a única fonte que sabe.
//
// FORMATO DA FONTE (7 abas mensais, "Reembolsos - XPE 2026"):
// blocos de pessoa em pares de colunas — [1,2,3] e [5,6,7] —, cada bloco com
// cabeçalho `Nome`, linha `Tipo | Valor`, itens, e uma linha `Total`. Blocos
// separados por linha em branco.
//
//   [1]Igor            [5]Tiago
//   [1]Tipo [2]Valor   [5]Tipo [6]Valor
//   [1]Transporte [2]R$ 746,99 [3]TRUE
//   [1]Total [2]R$ 1.386,14
//
// A terceira coluna de cada bloco é TRUE/FALSE e significa FEITO — pago,
// confirmado pelo dono em 10/08/2026. FALSE é item lançado e não pago.
//
// PARCELAS: o tipo carrega a parcela no próprio nome — "Ar Cond 3/12",
// "Compra do Pc 6/6", "Curso Revit 8/12". Isso não é ruído de digitação, é a
// informação mais valiosa da planilha: diz quantas parcelas ainda faltam, e
// portanto quanto de reembolso já está contratado para os próximos meses. Hoje
// a previsão de caixa tem R$ 0,00 de compromisso futuro.
//
// Uso:
//   node scripts/import-reembolsos.mjs            dry-run (padrão)
//   node scripts/import-reembolsos.mjs --aplicar
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { normalizeName } from './lib/fin-normalize.mjs';

loadEnv();

const APLICAR = process.argv.includes('--aplicar');
const DIR = path.resolve('data/raw/reembolsos');
const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** "R$ 1.386,14" → 138614. Devolve null quando não é número. */
function centavos(texto) {
  const limpo = String(texto ?? '').replace(/R\$|\s| /g, '').trim();
  if (!limpo || limpo.includes('#')) return null;
  const n = Number(limpo.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/**
 * Separa a parcela do nome do tipo.
 *
 * "Ar Cond 3/12" → { tipo: 'Ar Cond', parcela: 3, total: 12 }
 * "Transporte"   → { tipo: 'Transporte', parcela: null, total: null }
 *
 * O padrão precisa estar no FIM: "Uber / maio" tem barra e não é parcela, e
 * "Curso LGR 01/10" é parcela 1 de 10 — por isso o número aceita zero à
 * esquerda mas o denominador tem de ser plausível (<= 60 meses).
 */
export function separarParcela(tipoBruto) {
  const tipo = String(tipoBruto ?? '').trim();
  const m = tipo.match(/^(.*?)\s+(\d{1,2})\s*\/\s*(\d{1,2})\s*$/);
  if (!m) return { tipo, parcela: null, total: null };
  const parcela = Number(m[2]);
  const total = Number(m[3]);
  if (!total || total > 60 || parcela > total) return { tipo, parcela: null, total: null };
  return { tipo: m[1].trim() || tipo, parcela, total };
}

/** Lê uma aba mensal e devolve os itens por pessoa. */
export function lerAba(linhas) {
  const achados = [];
  // Cada bloco ocupa 4 colunas; a planilha usa duas colunas de blocos.
  for (const base of [1, 5]) {
    let pessoa = null;
    for (let i = 0; i < linhas.length; i += 1) {
      const l = linhas[i];
      const rotulo = (l[base] ?? '').trim();
      const valor = centavos(l[base + 1]);
      const feito = String(l[base + 2] ?? '').trim().toUpperCase() === 'TRUE';

      // Cabeçalho de bloco: o nome da pessoa é sempre seguido pela linha
      // "Tipo | Valor". Sem essa âncora, todo item sem valor preenchido
      // (Transporte com FALSE, por exemplo) era lido como pessoa nova — foi
      // assim que "Gás de cozinha" e "Almoço com Cliente" viraram gente, e os
      // itens seguintes foram parar no bloco errado.
      const proxima = (linhas[i + 1]?.[base] ?? '').trim();
      if (rotulo && /^tipo$/i.test(proxima)) { pessoa = rotulo; continue; }

      if (/^tipo$/i.test(rotulo)) continue;
      if (/^total/i.test(rotulo)) { pessoa = null; continue; }
      if (!pessoa || !rotulo || valor === null || valor <= 0) continue;

      achados.push({ pessoa, ...separarParcela(rotulo), cents: valor, feito });
    }
  }
  return achados;
}

function parseCsv(texto) {
  const linhas = [];
  let campo = '', linha = [], aspas = false;
  for (let i = 0; i < texto.length; i += 1) {
    const c = texto[i];
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i += 1; }
      else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ',') { linha.push(campo); campo = ''; }
    else if (c === '\n') { linha.push(campo); linhas.push(linha); linha = []; campo = ''; }
    else if (c !== '\r') campo += c;
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

const arquivos = (await readdir(DIR)).filter((f) => /^\d{4}-\d{2}\.csv$/.test(f)).sort();
if (!arquivos.length) {
  console.log(`[reembolsos] nenhuma aba em ${DIR}`);
  process.exit(0);
}

const pool = financePool();
const client = await pool.connect();
const relatorio = { meses: 0, itens: 0, cents: 0, feitos: 0, abertos: 0, parcelados: 0, semPessoa: new Set(), porMes: new Map() };

try {
  await client.query('BEGIN');

  const { rows: [ent] } = await client.query(`SELECT id FROM fin_entity WHERE slug='xpe'`);
  const { rows: pessoas } = await client.query(
    `SELECT id, name, normalized_name FROM fin_person WHERE entity_id=$1`, [ent.id]
  );
  const idPorNome = new Map(pessoas.map((p) => [p.normalized_name, p.id]));

  // Apelidos da planilha × nome de cadastro. Os três primeiros existem porque o
  // cadastro foi corrigido HOJE: "Adryan" virou o nome completo ao unificar as
  // duas contrapartes dele, "Alves" foi removido por ser o Igor Alves, e a
  // planilha chama "Paulo Araújo" quem o roster chama de "Paulo".
  for (const [apelido, oficial] of [
    ['adryan', 'adryan kennie melo dos santos'],
    ['alves', 'igor a'],
    ['paulo araujo', 'paulo'],
    ['dec', 'decezaris'],
    ['macgyver', 'flavio']
  ]) {
    const id = idPorNome.get(oficial);
    if (id && !idPorNome.has(apelido)) idPorNome.set(apelido, id);
  }
  const { rows: tipos } = await client.query(`SELECT slug, name FROM fin_reimbursement_type`);
  const tipoPorNome = new Map(tipos.map((t) => [normalizeName(t.name), t.slug]));

  const parcelamentos = new Map();

  for (const arquivo of arquivos) {
    const mes = arquivo.replace('.csv', '') + '-01';
    const itens = lerAba(parseCsv(await readFile(path.join(DIR, arquivo), 'utf8')));
    if (!itens.length) continue;
    relatorio.meses += 1;
    relatorio.porMes.set(mes.slice(0, 7), {
      n: itens.length,
      v: itens.reduce((a, b) => a + b.cents, 0)
    });

    const porPessoa = new Map();
    for (const it of itens) {
      const norm = normalizeName(it.pessoa);
      const personId = idPorNome.get(norm);
      if (!personId) { relatorio.semPessoa.add(it.pessoa); continue; }
      if (!porPessoa.has(personId)) porPessoa.set(personId, []);
      porPessoa.get(personId).push(it);
    }

    for (const [personId, lista] of porPessoa) {
      const total = lista.reduce((s, x) => s + x.cents, 0);
      const todosFeitos = lista.every((x) => x.feito);
      const { rows: [reemb] } = await client.query(
        `INSERT INTO fin_reimbursement (entity_id, person_id, reference_month, status, total_cents)
         VALUES ($1,$2,$3::date,$4,$5)
         ON CONFLICT (entity_id, person_id, reference_month) DO UPDATE
           SET status=EXCLUDED.status, total_cents=EXCLUDED.total_cents
         RETURNING id`,
        [ent.id, personId, mes, todosFeitos ? 'pago' : 'aprovado', total]
      );

      await client.query(`DELETE FROM fin_reimbursement_item WHERE reimbursement_id=$1`, [reemb.id]);
      for (const it of lista) {
        // `installment_number`/`installment_total` já existem no item desde a
        // 0012: a parcela pertence à linha do reembolso, não só ao plano. É o
        // que permite responder "quanto desta parcela caiu em maio" sem ir ao
        // plano.
        await client.query(
          `INSERT INTO fin_reimbursement_item
             (reimbursement_id, reimbursement_type, description, amount_cents,
              installment_number, installment_total, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [reemb.id, tipoPorNome.get(normalizeName(it.tipo)) ?? null, it.tipo, it.cents,
           it.parcela, it.total, it.feito ? 'pago' : 'aprovado']
        );
        relatorio.itens += 1;
        relatorio.cents += it.cents;
        it.feito ? (relatorio.feitos += 1) : (relatorio.abertos += 1);

        // Parcela: guarda a MAIOR parcela vista, que é a mais recente.
        if (it.parcela) {
          const chave = `${personId}|${normalizeName(it.tipo)}`;
          const atual = parcelamentos.get(chave);
          if (!atual || it.parcela > atual.parcela) {
            parcelamentos.set(chave, { personId, ...it, mes });
          }
        }
      }
    }
  }

  // Parcelamentos: o que ainda falta pagar vira compromisso futuro.
  for (const p of parcelamentos.values()) {
    const restantes = p.total - p.parcela;
    if (restantes <= 0) continue;
    relatorio.parcelados += 1;
    // Sem chave natural na tabela, busca-depois-insere: reexecutar precisa
    // ATUALIZAR o plano (a parcela avança a cada mês novo), não empilhar outro.
    const { rows: existe } = await client.query(
      `SELECT id FROM fin_installment_plan
        WHERE entity_id=$1 AND person_id=$2 AND title=$3 AND kind='reembolso'`,
      [ent.id, p.personId, p.tipo]
    );
    const nota = `parcela ${p.parcela}/${p.total} vista em ${p.mes.slice(0, 7)}; ${restantes} a vencer`;
    if (existe.length) {
      await client.query(
        `UPDATE fin_installment_plan
            SET installments_paid=$2, monthly_amount_cents=$3, notes=$4
          WHERE id=$1 AND status='ativo'`,
        [existe[0].id, p.parcela, p.cents, nota]
      );
    } else {
      await client.query(
        `INSERT INTO fin_installment_plan
           (entity_id, person_id, title, kind, total_amount_cents, installments_total,
            installments_paid, monthly_amount_cents, first_due_date, status, notes)
         VALUES ($1,$2,$3,'reembolso',$4,$5,$6,$7,$8::date,'ativo',$9)`,
        [ent.id, p.personId, p.tipo, p.cents * p.total, p.total, p.parcela, p.cents, p.mes, nota]
      );
    }
  }

  console.log(`\nReembolsos — ${relatorio.meses} meses\n`);
  console.log('  mês       itens        valor');
  for (const [m, x] of [...relatorio.porMes.entries()].sort()) {
    console.log(`  ${m}   ${String(x.n).padStart(4)}   ${brl(x.v).padStart(12)}`);
  }
  console.log('');
  console.log(`  itens .................. ${relatorio.itens}`);
  console.log(`  valor total ............ ${brl(relatorio.cents)}`);
  console.log(`  feitos (pagos) ......... ${relatorio.feitos}`);
  console.log(`  em aberto .............. ${relatorio.abertos}`);
  console.log(`  parcelamentos ativos ... ${relatorio.parcelados}`);
  if (relatorio.semPessoa.size) {
    console.log(`\n  ⚠ nomes sem pessoa no cadastro: ${[...relatorio.semPessoa].join(', ')}`);
  }

  const { rows: futuro } = await client.query(
    `SELECT count(*) n, COALESCE(sum(monthly_amount_cents * (installments_total - installments_paid)),0) v
       FROM fin_installment_plan WHERE status='ativo'`
  );
  console.log(`\n  compromisso futuro de reembolso: ${futuro[0].n} planos → ${brl(futuro[0].v)}`);

  if (APLICAR) {
    await client.query('COMMIT');
    console.log('\n  COMMIT — gravado.\n');
  } else {
    await client.query('ROLLBACK');
    console.log('\n  ROLLBACK — dry-run. Use --aplicar.\n');
  }
} catch (e) {
  await client.query('ROLLBACK');
  console.error('[reembolsos] abortado, nada gravado:', e.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}

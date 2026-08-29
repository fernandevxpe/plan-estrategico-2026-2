// Devolve à categoria 6.05 os PIX de reembolso gravados como salário/pró-labore.
//
// O PROBLEMA
// ----------
// Reembolso sai no mesmo lote da folha, para a mesma pessoa, no mesmo dia. O
// extrato não sabe a diferença: só a planilha "Reembolsos - XPE 2026" sabe. Um
// PIX de R$ 961,73 para o Jonildo é indistinguível de salário até alguém abrir
// a aba de julho e ver "Combustível Junho 50,00 + Transporte Julho 195,45 +
// Transporte Junho 716,28".
//
// Enquanto isso não é corrigido, a folha aparece maior do que é e a linha de
// reembolso aparece menor — nas duas pontas da DRE, no mesmo mês.
//
// O QUE JÁ TINHA SIDO FEITO, E O QUE FALTAVA
// ------------------------------------------
// O lote 732e28c6 (20/08/2026, ator xpeadmin) corrigiu 61 lançamentos cruzando
// planilha × extrato de duas maneiras: pelo TOTAL DO MÊS, quando o reembolso
// saiu num PIX só, e ITEM A ITEM, quando o valor do item aparece isolado.
//
// Duas populações escaparam das duas passadas:
//
//   · IGOR DALTON — o reembolso dele sai fatiado, e cada fatia é a SOMA DE DOIS
//     itens da planilha (R$ 234,75 = Alimentação 133,75 + Almoço Marketing
//     101,00). Não é total de mês nem valor de item: nenhuma das passadas via.
//
//   · TUDO PAGO A PARTIR DE 01/07/2026 — a categoria 6.05 simplesmente parou de
//     ser usada. Julho e agosto tinham ZERO lançamentos nela, para qualquer
//     pessoa, enquanto as competências junho e julho da planilha somam
//     R$ 11.440,98 efetivamente pagos.
//
// CADA CARGA ABAIXO É UMA DESSAS POPULAÇÕES, com a impressão digital de cada
// lançamento medida na conferência de 29/08/2026 e conferida contra o banco
// ANTES de escrever. Id sozinho não basta: data, valor, contraparte, pessoa e
// categoria atual têm de bater. Qualquer divergência aborta a carga inteira.
//
// COMO ESCREVE
// ------------
// Na mesma ordem de `reclassificarLote` (lib/financeiro/categorizacao.ts), que
// é a ordem que os gatilhos exigem e não uma preferência:
//
//   1. fin_classification_event com o valor ANTERIOR   ← torna o desfazer possível
//   2. fin_review_item → resolvido                     ← ANTES da linha (0094)
//   3. a linha: category_id, classified_by='humano', classified_rule_id=NULL,
//      human_locked_fields += category_id              ← a trava é obrigatória
//   4. releitura provando que categoria e trava ficaram escritas
//   5. fin_audit_log de cabeçalho, com batch_id = lote
//
// `classified_rule_id = NULL` vai no MESMO SET de propósito: sem ele o CHECK
// fin_transaction_rule_version_paridade estoura falando de versão de regra.
//
// Uso:
//   node scripts/corrigir-reembolso-categoria.mjs --carga=jun-jul            dry-run
//   node scripts/corrigir-reembolso-categoria.mjs --carga=jun-jul --aplicar
//   node scripts/corrigir-reembolso-categoria.mjs --cargas                   lista
//   node scripts/corrigir-reembolso-categoria.mjs --reverter=<lote> --aplicar

import { randomUUID } from 'node:crypto';

import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { registerFinanceTypeParsers } from './lib/fin-types.mjs';

loadEnv();
registerFinanceTypeParsers();

const APLICAR = process.argv.includes('--aplicar');
const LISTAR = process.argv.includes('--cargas');
const CARGA = process.argv.find((a) => a.startsWith('--carga='))?.split('=')[1] ?? null;
const REVERTER = process.argv.find((a) => a.startsWith('--reverter='))?.split('=')[1] ?? null;
const ATOR = 'script:corrigir-reembolso-categoria';
const DESTINO = '6.05';

const brl = (c) => (Number(c) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// ---------------------------------------------------------------------------
// As cargas
// ---------------------------------------------------------------------------
// `pessoa` é conferido contra fin_person.legal_name; `itens` é o que a planilha
// diz que aquele PIX está pagando — é a evidência, e é o que faz a soma fechar.

const CARGAS = {
  'igor-dalton': {
    titulo: 'Igor Dalton — as fatias que são soma de dois itens (jan–jul/2026)',
    motivo:
      'Reembolso do Igor Dalton pago junto com a folha e gravado como 6.01 Salários. O lote ' +
      '732e28c6 (20/08/2026) corrigiu 61 lançamentos de reembolso, mas não alcançou estes: a ' +
      'parte avulsa do Igor (Transporte, Alimentação, Almoço) sai num PIX que é a SOMA de dois ' +
      'itens da planilha, então não casava nem pelo total do mês nem item a item. Só o ' +
      'parcelado dele (Compra do Pc, R$ 379,00, que aparece isolado) tinha sido corrigido.',
    alvos: [
      { id: 76440, dia: '2026-02-02', cents: 23475, cp: 371, pessoa: 'Igor Dalton', comp: '2026-01', itens: 'Alimentação 133,75 + Almoço Marketing 101,00' },
      { id: 76525, dia: '2026-03-02', cents: 72041, cp: 395, pessoa: 'Igor Dalton', comp: '2026-02', itens: 'Transporte 675,37 + Alimentação 45,04' },
      { id: 76590, dia: '2026-04-01', cents: 48472, cp: 371, pessoa: 'Igor Dalton', comp: '2026-03', itens: 'Alimentação 410,72 + Almoço com Cliente 74,00' },
      { id: 76713, dia: '2026-05-01', cents: 85242, cp: 371, pessoa: 'Igor Dalton', comp: '2026-04', itens: 'Transporte 719,84 + Alimentação 132,58' },
      { id: 76775, dia: '2026-06-01', cents: 26015, cp: 395, pessoa: 'Igor Dalton', comp: '2026-05', itens: 'Alimentação 89,98 + Almoço com Cliente 170,17' },
      { id: 76048, dia: '2026-07-01', cents: 81372, cp: 395, pessoa: 'Igor Dalton', comp: '2026-06', itens: 'Transporte 813,72' },
      { id: 76057, dia: '2026-07-01', cents: 21141, cp: 395, pessoa: 'Igor Dalton', comp: '2026-06', itens: 'Alimentação 121,41 + Almoço Obras 90,00' },
      { id: 76137, dia: '2026-08-01', cents: 36871, cp: 395, pessoa: 'Igor Dalton', comp: '2026-07', itens: 'Alimentação 368,71' },
      { id: 76165, dia: '2026-08-01', cents: 129441, cp: 395, pessoa: 'Igor Dalton', comp: '2026-07', itens: 'Transporte 1.294,41' }
    ]
  },

  'jun-jul': {
    titulo: 'Competências junho e julho/2026 — o mês em que a 6.05 parou de existir',
    motivo:
      'Reembolso das competências junho e julho/2026, pago em 01/07 e 01/08 junto com a folha e ' +
      'gravado como 6.01 Salários / 6.02 Pró-labore. Nesses dois meses a categoria 6.05 tem ZERO ' +
      'lançamentos na base inteira, para qualquer pessoa — não é um caso a caso, é a categoria ' +
      'que deixou de ser usada. Cada valor abaixo é o total do mês da pessoa na planilha ' +
      '"Reembolsos - XPE 2026", ou uma fatia dele nomeada item a item.',
    alvos: [
      { id: 76045, dia: '2026-07-01', cents: 10311, cp: null, pessoa: 'Adryan',    comp: '2026-06', itens: 'Curso Revit 9/12 (total do mês)' },
      { id: 76138, dia: '2026-08-01', cents: 10311, cp: null, pessoa: 'Adryan',    comp: '2026-07', itens: 'Curso Revit 10/12 (total do mês)' },
      { id: 76050, dia: '2026-07-01', cents: 5000,  cp: null, pessoa: 'Audrey',    comp: '2026-06', itens: 'Evento dia 6 (total do mês)' },
      { id: 76140, dia: '2026-08-01', cents: 102598, cp: null, pessoa: 'Audrey',   comp: '2026-07', itens: 'Evento Select 800,00 + Virada noite meninos 148,40 + Café Lidere-se 39,90 + Bolo síndicas 37,68 (total do mês)' },
      { id: 76055, dia: '2026-07-01', cents: 6000,  cp: null, pessoa: 'Belo',      comp: '2026-06', itens: 'Crédito no Chip bot (total do mês)' },
      { id: 76056, dia: '2026-07-01', cents: 27900, cp: null, pessoa: 'Cleber',    comp: '2026-06', itens: 'Transporte/gasolina (total do mês)' },
      { id: 76159, dia: '2026-08-01', cents: 20300, cp: null, pessoa: 'Cleber',    comp: '2026-07', itens: 'Transporte/gasolina (total do mês; ver nota sobre a competência)' },
      { id: 76052, dia: '2026-07-01', cents: 12180, cp: null, pessoa: 'Decezaris', comp: '2026-06', itens: 'Transporte' },
      { id: 76054, dia: '2026-07-01', cents: 33187, cp: null, pessoa: 'Decezaris', comp: '2026-06', itens: 'Notebook parc 3/21 157,20 + Monitores e Cadeiras parc 3/12 174,67' },
      { id: 76139, dia: '2026-08-01', cents: 9693,  cp: null, pessoa: 'Decezaris', comp: '2026-07', itens: 'Transporte' },
      { id: 76152, dia: '2026-08-01', cents: 33187, cp: null, pessoa: 'Decezaris', comp: '2026-07', itens: 'Notebook parc 4/21 157,20 + Monitores e Cadeiras parc 4/12 174,67' },
      { id: 76142, dia: '2026-08-01', cents: 8899,  cp: null, pessoa: 'Diogo',     comp: '2026-07', itens: 'P&D NFC/RFID Controlador de carga' },
      { id: 76145, dia: '2026-08-01', cents: 10456, cp: null, pessoa: 'Diogo',     comp: '2026-07', itens: 'Transporte' },
      { id: 76047, dia: '2026-07-01', cents: 104052, cp: null, pessoa: 'Fernando', comp: '2026-06', itens: 'Ar Cond 7/12 + Monitores 7/12 + Notebooks part 2 12/24 + notebook estag 2/12 + Google Drive (total do mês)' },
      { id: 76144, dia: '2026-08-01', cents: 128126, cp: null, pessoa: 'Fernando', comp: '2026-07', itens: 'Ar Cond 8/12 + Monitores 8/12 + Notebooks part 2 13/24 + notebook estag 3/12 + Tv 1/24 + Gela Água 1/18 + Pedestal 1/12 + Google Drive (total do mês)' },
      { id: 76049, dia: '2026-07-01', cents: 23549, cp: null, pessoa: 'Flavio',    comp: '2026-06', itens: 'Transporte (total do mês)' },
      { id: 76148, dia: '2026-08-01', cents: 24448, cp: null, pessoa: 'Flavio',    comp: '2026-07', itens: 'Transporte (total do mês)' },
      { id: 76053, dia: '2026-07-01', cents: 8888,  cp: null, pessoa: 'Gabriel',   comp: '2026-06', itens: 'Plano telefone + Internet chip xpe' },
      { id: 76044, dia: '2026-07-01', cents: 27867, cp: null, pessoa: 'Gabriel',   comp: '2026-06', itens: 'Transporte/Manutenção' },
      { id: 76058, dia: '2026-07-01', cents: 50635, cp: null, pessoa: 'Gabriel',   comp: '2026-06', itens: 'Cadeiras + Microfone 8/14 221,44 + Impressora 3D 6/12 284,91' },
      { id: 76158, dia: '2026-08-01', cents: 95873, cp: null, pessoa: 'Gabriel',   comp: '2026-07', itens: 'Cadeiras + Microfone 9/14 + Impressora 3D 7/12 + Itens Cozinha + Plano telefone (total do mês)' },
      { id: 76046, dia: '2026-07-01', cents: 2700,  cp: null, pessoa: 'Igor Alves', comp: '2026-06', itens: 'Transporte/gasolina (total do mês)' },
      { id: 76051, dia: '2026-07-01', cents: 9970,  cp: null, pessoa: 'Jonildo',   comp: '2026-06', itens: 'Curso LGR 02/10 (total do mês)' },
      { id: 76153, dia: '2026-08-01', cents: 9970,  cp: null, pessoa: 'Jonildo',   comp: '2026-07', itens: 'Curso LGR 03/10' },
      { id: 76154, dia: '2026-08-01', cents: 96173, cp: null, pessoa: 'Jonildo',   comp: '2026-07', itens: 'Transporte Junho 716,28 + Transporte Julho 195,45 + Combustível Junho 50,00' }
    ],
    // Fica de fora de propósito, e o relatório diz por quê.
    excluidos: [
      'Belo, competência julho, R$ 30,00 (Crédito no Chip bot): NÃO foi pago. ' +
      'Em 01/08 o Belo recebeu 1.621,00 + 2.879,00 = 4.500,00, o mesmo total de julho, e nenhum PIX de 30,00. ' +
      'Sem lançamento no extrato não há o que reclassificar — é reembolso em aberto, não erro de categoria.'
    ]
  }
};

if (LISTAR) {
  for (const [nome, c] of Object.entries(CARGAS)) {
    const soma = c.alvos.reduce((s, a) => s + a.cents, 0);
    console.log(`  ${nome.padEnd(14)} ${String(c.alvos.length).padStart(2)} lanç.  ${brl(soma).padStart(13)}   ${c.titulo}`);
  }
  process.exit(0);
}

const pool = financePool();
const client = await pool.connect();

async function fotoPorMes(rotulo) {
  const { rows } = await client.query(
    `SELECT to_char(t.posted_on,'YYYY-MM') AS mes, count(*)::int AS n, (sum(-t.amount_cents))::text AS v
       FROM fin_transaction t JOIN fin_category c ON c.id = t.category_id
      WHERE c.code = '6.05' AND t.posted_on >= '2026-01-01'
      GROUP BY 1 ORDER BY 1`
  );
  console.log(`\n  ${rotulo} — lançamentos em 6.05 Reembolsos a colaboradores:`);
  for (const r of rows) console.log(`     ${r.mes}   ${String(r.n).padStart(3)} lanç.   ${brl(r.v)}`);
  return rows;
}

// ---------------------------------------------------------------------------
// Reverter — genérico, lê a trilha pelo lote
// ---------------------------------------------------------------------------
if (REVERTER) {
  const { rows } = await client.query(
    `SELECT target_id, superseded_value FROM fin_classification_event
      WHERE target_table = 'fin_transaction' AND rationale->>'lote' = $1 ORDER BY id`,
    [REVERTER]
  );
  if (!rows.length) {
    console.log(`[reverter] lote ${REVERTER} não tem evento de classificação nesta base.`);
    client.release(); await pool.end(); process.exit(1);
  }
  console.log(`[reverter] lote ${REVERTER}: ${rows.length} linha(s) a restaurar.`);
  if (!APLICAR) {
    for (const r of rows) console.log(`   ${r.target_id} → category_id ${r.superseded_value.category_id}, classified_by ${r.superseded_value.classified_by}`);
    console.log('\nDRY-RUN — nada gravado. Acrescente --aplicar.');
    client.release(); await pool.end(); process.exit(0);
  }
  await client.query('BEGIN');
  try {
    for (const r of rows) {
      const sv = r.superseded_value;
      await client.query(
        `UPDATE fin_transaction
            SET category_id = $2, classified_by = $3, classified_rule_id = NULL,
                human_locked_fields = COALESCE($4::text[], '{}'::text[]),
                classified_at = now(), updated_at = now()
          WHERE id = $1`,
        [r.target_id, sv.category_id, sv.classified_by, sv.human_locked_fields ?? []]
      );
    }
    await client.query(`UPDATE fin_audit_log SET undone_at = now() WHERE batch_id = $1::uuid AND undone_at IS NULL`, [REVERTER]);
    await client.query('COMMIT');
    console.log(`✓ lote ${REVERTER} revertido — ${rows.length} linha(s).`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('ROLLBACK —', e.message);
    process.exitCode = 1;
  }
  client.release(); await pool.end(); process.exit();
}

// ---------------------------------------------------------------------------
// Conferência de identidade — antes de qualquer escrita
// ---------------------------------------------------------------------------
const carga = CARGAS[CARGA];
if (!carga) {
  console.error(`informe --carga=<nome>. Disponíveis: ${Object.keys(CARGAS).join(', ')}`);
  client.release(); await pool.end(); process.exit(1);
}

console.log(`=== ${carga.titulo} ===`);
console.log(`    6.01 Salários / 6.02 Pró-labore → 6.05 Reembolsos a colaboradores\n`);

const ids = carga.alvos.map((a) => a.id);
const { rows: reais } = await client.query(
  `SELECT t.id, to_char(t.posted_on,'YYYY-MM-DD') AS dia, (-t.amount_cents)::text AS cents,
          t.counterparty_id AS cp, c.code AS categoria, t.human_locked_fields AS travas,
          p.legal_name, p.name AS apelido
     FROM fin_transaction t
     JOIN fin_category c ON c.id = t.category_id
     LEFT JOIN fin_person_counterparty pc ON pc.counterparty_id = t.counterparty_id
     LEFT JOIN fin_person p ON p.id = pc.person_id
    WHERE t.id = ANY($1::bigint[])`,
  [ids]
);
const porId = new Map(reais.map((r) => [Number(r.id), r]));

const divergencias = [];
for (const a of carga.alvos) {
  const r = porId.get(a.id);
  if (!r) { divergencias.push(`${a.id}: não existe`); continue; }
  if (r.dia !== a.dia) divergencias.push(`${a.id}: data ${r.dia} ≠ ${a.dia}`);
  if (Number(r.cents) !== a.cents) divergencias.push(`${a.id}: valor ${brl(r.cents)} ≠ ${brl(a.cents)}`);
  if (a.cp !== null && Number(r.cp) !== a.cp) divergencias.push(`${a.id}: contraparte ${r.cp} ≠ ${a.cp}`);
  if (!['6.01', '6.02'].includes(r.categoria)) divergencias.push(`${a.id}: está em ${r.categoria}, não em 6.01/6.02`);
  if ((r.travas ?? []).includes('category_id')) divergencias.push(`${a.id}: travado por decisão humana anterior`);
  // A pessoa é conferida pelo nome de registro: apelido da planilha não basta.
  const alvoNome = a.pessoa.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const real = String(r.legal_name ?? r.apelido ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (!real.includes(alvoNome.split(' ')[0])) divergencias.push(`${a.id}: contraparte é "${r.legal_name}", esperado "${a.pessoa}"`);
}

let pessoaAtual = null;
for (const a of carga.alvos) {
  const r = porId.get(a.id);
  if (a.pessoa !== pessoaAtual) { pessoaAtual = a.pessoa; console.log(`  ${a.pessoa}`); }
  console.log(`    ${String(a.id).padStart(6)}  ${a.dia}  ${brl(a.cents).padStart(12)}  ${String(r?.categoria ?? '?')} → 6.05  comp.${a.comp}  ${a.itens}`);
}
const totalCents = carga.alvos.reduce((s, a) => s + a.cents, 0);
console.log(`\n  ${carga.alvos.length} lançamentos · ${brl(totalCents)}`);

if (carga.excluidos?.length) {
  console.log('\n  Fora desta carga, de propósito:');
  for (const e of carga.excluidos) console.log(`    · ${e}`);
}

if (divergencias.length) {
  console.error('\n✗ ABORTADO — a impressão digital não bate:');
  for (const d of divergencias) console.error(`   ${d}`);
  client.release(); await pool.end(); process.exit(1);
}
console.log(`\n  ✓ identidade conferida: ${ids.length}/${ids.length} batem em data, valor, pessoa e categoria, sem trava humana.`);

const { rows: [{ s: dinheiroAntes }] } = await client.query(
  `SELECT coalesce(sum(amount_cents),0)::text AS s FROM fin_transaction WHERE id = ANY($1::bigint[])`, [ids]
);
await fotoPorMes('ANTES');

if (!APLICAR) {
  console.log('\nDRY-RUN — nada gravado. Use --aplicar.');
  client.release(); await pool.end(); process.exit(0);
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------
const evidencia =
  'Planilha "Reembolsos - XPE 2026" conferida item a item contra o extrato em 29/08/2026. ' +
  carga.alvos.map((a) => `${a.dia} ${brl(a.cents)} ${a.pessoa} = ${a.itens} (comp. ${a.comp})`).join('; ') +
  `. Total ${brl(totalCents)}.`;

const lote = randomUUID();
await client.query('BEGIN');
try {
  const { rows: [cat] } = await client.query(
    `SELECT c.id, c.code FROM fin_category c JOIN fin_entity e ON e.id = c.entity_id AND e.slug = 'xpe' WHERE c.code = $1`,
    [DESTINO]
  );

  const { rowCount: nEventos } = await client.query(
    `INSERT INTO fin_classification_event
       (target_table, target_id, stage, category_id, accepted, superseded_value, rationale, actor)
     SELECT 'fin_transaction', x.id, 'humano', $2::bigint, true,
            jsonb_build_object('category_id', x.category_id, 'classified_by', x.classified_by,
                               'classified_rule_id', x.classified_rule_id,
                               'human_locked_fields', to_jsonb(x.human_locked_fields)),
            jsonb_build_object('motivo', $3::text, 'evidencia', $4::text, 'lote', $5::text,
                               'universo', 'lancamento', 'carga', $6::text,
                               'origem', 'correcao categoria de reembolso'),
            $7::text
       FROM fin_transaction x WHERE x.id = ANY($1::bigint[])`,
    [ids, cat.id, carga.motivo, evidencia, lote, CARGA, ATOR]
  );

  const { rowCount: nFila } = await client.query(
    `UPDATE fin_review_item SET status = 'resolvido', resolved_at = now(), resolved_by = $2::text
      WHERE target_table = 'fin_transaction' AND target_id = ANY($1::bigint[]) AND status = 'pendente'`,
    [ids, ATOR]
  );

  const { rowCount: nLinhas } = await client.query(
    `UPDATE fin_transaction x
        SET category_id = $2, classified_by = 'humano', classified_rule_id = NULL, classified_at = now(),
            classified_reason = jsonb_build_object('motivo', $3::text, 'evidencia', $4::text, 'lote', $5::text),
            review_status = 'ok', updated_at = now(),
            human_locked_fields = (SELECT COALESCE(array_agg(DISTINCT f), '{}'::text[])
                                     FROM unnest(x.human_locked_fields || ARRAY['category_id']) AS f)
      WHERE x.id = ANY($1::bigint[])`,
    [ids, cat.id, carga.motivo, evidencia, lote]
  );

  const { rows: [prova] } = await client.query(
    `SELECT count(*) FILTER (WHERE 'category_id' = ANY(x.human_locked_fields))::int AS travadas,
            count(*) FILTER (WHERE x.category_id = $2::bigint)::int AS na_categoria
       FROM fin_transaction x WHERE x.id = ANY($1::bigint[])`,
    [ids, cat.id]
  );
  if (prova.travadas !== ids.length || prova.na_categoria !== ids.length) {
    throw new Error(`prova falhou: ${prova.na_categoria}/${ids.length} em 6.05, ${prova.travadas}/${ids.length} travadas`);
  }

  const { rows: [{ s: dinheiroDepois }] } = await client.query(
    `SELECT coalesce(sum(amount_cents),0)::text AS s FROM fin_transaction WHERE id = ANY($1::bigint[])`, [ids]
  );
  if (dinheiroDepois !== dinheiroAntes) throw new Error(`o dinheiro mudou: ${dinheiroAntes} → ${dinheiroDepois}`);

  await client.query(
    `INSERT INTO fin_audit_log (entity_id, batch_id, actor, action, target_table, target_id, before, after, fields)
     SELECT e.id, $1::uuid, $2::text, 'bulk_update', 'fin_categorizavel_v', $5::bigint, $3::jsonb, $4::jsonb,
            ARRAY['category_id','classified_by','human_locked_fields']
       FROM fin_entity e WHERE e.slug = 'xpe'`,
    [
      lote, ATOR,
      JSON.stringify({ previsao: [{ universo: 'lancamento', encontrados: ids.length, travados: 0,
        jaNaCategoria: 0, inexistentes: [], incompativeis: [], naoClassificaveis: [],
        valorAntesCents: totalCents }] }),
      JSON.stringify({ categoria: DESTINO, carga: CARGA, motivo: carga.motivo, evidencia,
        excluidos: carga.excluidos ?? [],
        aplicados: [{ universo: 'lancamento', n: nLinhas }],
        filaResolvida: [{ universo: 'lancamento', n: nFila }],
        travasEscritas: [{ universo: 'lancamento', n: prova.travadas }] }),
      ids[0]
    ]
  );

  await client.query('COMMIT');
  console.log(`\n✓ ${nLinhas} lançamentos reclassificados para 6.05 — ${brl(totalCents)}`);
  console.log(`  eventos de trilha: ${nEventos} · itens de fila resolvidos: ${nFila} · travas escritas: ${prova.travadas}`);
  console.log(`  lote: ${lote}`);
  console.log(`  desfazer: node scripts/corrigir-reembolso-categoria.mjs --reverter=${lote} --aplicar`);
  await fotoPorMes('DEPOIS');
} catch (e) {
  await client.query('ROLLBACK');
  console.error('\nROLLBACK —', e.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}

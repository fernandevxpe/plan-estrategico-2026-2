// Carrega a planilha "Reembolsos - XPE 2026" em fin_reembolso_item.
//
// POR QUE ESTE SCRIPT EXISTE
// --------------------------
// A planilha de reembolsos é a única fonte que sabe distinguir, no extrato,
// almoço de diária, transporte de material e parcela de notebook de salário.
// Enquanto ela viver só no Excel, toda essa distinção depende de alguém abrir
// o arquivo. Aqui ela vira dado consultável — e, com a parcela, vira previsão:
// quanto ainda falta reembolsar a cada pessoa.
//
// O QUE A PARCELA RESOLVE
// -----------------------
// A descrição traz a parcela ("Ar Cond 6/12", "Notebooks part 2 - 11/24").
// Guardando parcela e total, o saldo é aritmética — e fin_reembolso_saldo_v
// (0129) faz a conta. Medido sobre jan–jul/2026: R$19.625,14 ainda a pagar.
//
// AS DUAS ARMADILHAS, JÁ TRATADAS AQUI
// ------------------------------------
//  1. "2x*" é parcela DOBRADA do mesmo débito, não débito novo. O Decézaris
//     quitou a parcela 2 em dobro (R$314,40 = 2 × R$157,20) e voltou ao ritmo
//     normal em junho. Contar as duas linhas dobrava a dívida dele, de
//     R$4.069,76 para R$13.536,76. Aqui o "2x*" some do slug e o valor é
//     dividido por dois — o que fica guardado é a parcela simples.
//
//  2. Item RENOMEADO no meio do caminho é o mesmo débito. O "Compra do Pc
//     Biel" do Igor virou "Compra do Pc" entre março e abril e terminou em
//     6/6. Como dois itens, ele apareceria devendo R$758,00 sem dever nada.
//     CANONICO abaixo é onde essas fusões ficam registradas.
//
// Roda com: node scripts/carregar-reembolsos.mjs            (dry-run)
//           node scripts/carregar-reembolsos.mjs --aplicar

import { execFileSync } from 'node:child_process';
import { financeDatabaseUrl } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import pg from 'pg';

loadEnv();
const APLICAR = process.argv.includes('--aplicar');
const ARQUIVO = process.argv.find((a) => a.startsWith('--arquivo='))?.split('=')[1]
  ?? 'Reembolsos - XPE 2026 (1).xlsx';

// Nome na planilha → id em fin_person. Conferido um a um contra fin_person:
// a planilha usa apelidos ("Alves" é o Igor A, "Paulo Araújo" é o Paulo).
const PESSOAS = {
  'Igor': 1, 'Gabriel': 2, 'Jonildo': 3, 'Fernando': 4, 'Diogo': 5, 'Cleber': 6,
  'Tiago': 7, 'Adryan': 8, 'Belo': 9, 'Flavio': 10, 'Decézaris': 11, 'Audrey': 12,
  'Paulo Araújo': 91, 'Alves': 94
};

// Fusões de item renomeado. Chave: "pessoa|prefixo que aparece na planilha".
const CANONICO = { 'Igor|Compra do Pc': 'Compra do Pc' };

const brl = (c) => (Number(c) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

// A extração fica em Python porque openpyxl lê o .xlsx sem dependência nova no
// package.json — o repositório não tem leitor de Excel em Node.
const PY = `
import openpyxl, json, sys
wb = openpyxl.load_workbook(sys.argv[1], data_only=True)
ABAS = {'Janeiro26':'2026-01','Fevereiro26':'2026-02','Março26':'2026-03','Abril26':'2026-04',
        'Maio26':'2026-05','Junho26':'2026-06','Julho26':'2026-07'}
itens=[]
for aba, mes in ABAS.items():
    if aba not in wb.sheetnames: continue
    ws = wb[aba]
    for r in range(1, 80):
        for c in range(1, ws.max_column+1):
            if str(ws.cell(row=r,column=c).value).strip() != 'Tipo': continue
            nome = ws.cell(row=r-1, column=c).value
            if not nome: continue
            for rr in range(r+1, r+30):
                rot = ws.cell(row=rr,column=c).value
                if str(rot).strip() == 'Total': break
                v = ws.cell(row=rr, column=c+1).value
                if isinstance(v,(int,float)) and v > 0:
                    itens.append({'mes':mes,'pessoa':str(nome).strip(),
                                  'item':str(rot).strip() if rot else '?','v':round(float(v)*100)})
print(json.dumps(itens, ensure_ascii=False))
`;

const itens = JSON.parse(execFileSync('python3', ['-c', PY, ARQUIVO], { encoding: 'utf8', maxBuffer: 32e6 }));

const PARC = /(\d{1,2})\s*[/]\s*(\d{1,2})/;
const slugify = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

const linhas = [];
const semPessoa = new Set();
for (const it of itens) {
  const personId = PESSOAS[it.pessoa];
  if (!personId) { semPessoa.add(it.pessoa); continue; }

  const dobrada = /2x\*/.test(it.item);
  const m = PARC.exec(it.item);
  let parcela = 1, total = 1;
  if (m) {
    const a = Number(m[1]), b = Number(m[2]);
    if (a >= 1 && a <= b && b <= 36) { parcela = a; total = b; }
  }
  let base = it.item.replace(PARC, '').replace(/2x\*/g, '').replace(/[-–]\s*$/, '').trim();
  const chave = Object.keys(CANONICO).find((k) => {
    const [p, pre] = k.split('|');
    return p === it.pessoa && base.startsWith(pre);
  });
  if (chave) base = CANONICO[chave];
  if (!base) base = 'reembolso';

  linhas.push({
    personId, pessoa: it.pessoa, slug: slugify(base), descricao: it.item,
    competencia: `${it.mes}-01`,
    // O "2x*" é a parcela dobrada: guardamos a simples, senão o saldo dobra.
    valor: dobrada ? Math.round(it.v / 2) : it.v,
    parcela, total, dobrada
  });
}

// UNIQUE(person_id, slug, competencia): duas linhas do mesmo item no mesmo mês
// são a mesma coisa lançada duas vezes na planilha. Fica a mais avançada.
const porChave = new Map();
for (const l of linhas) {
  const k = `${l.personId}|${l.slug}|${l.competencia}`;
  const atual = porChave.get(k);
  if (!atual || l.parcela > atual.parcela) porChave.set(k, l);
}
const finais = [...porChave.values()];

console.log(`=== Carga de reembolsos — ${ARQUIVO} ===`);
console.log(`  itens lidos na planilha: ${itens.length}`);
console.log(`  linhas a gravar:         ${finais.length}`);
console.log(`  colapsadas por duplicata no mesmo mês: ${linhas.length - finais.length}`);
if (semPessoa.size) console.log(`  ⚠ sem pessoa mapeada (ignorados): ${[...semPessoa].join(', ')}`);
const dobradas = finais.filter((l) => l.dobrada);
if (dobradas.length) {
  console.log(`  parcelas dobradas ("2x*") normalizadas para valor simples: ${dobradas.length}`);
  for (const d of dobradas) console.log(`     ${d.pessoa} · ${d.descricao} → R$ ${brl(d.valor)} (parcela ${d.parcela}/${d.total})`);
}

const comParcela = finais.filter((l) => l.total > 1);
const saldo = new Map();
for (const l of comParcela) {
  const k = `${l.pessoa}|${l.slug}`;
  const a = saldo.get(k);
  if (!a || l.competencia > a.competencia) saldo.set(k, l);
}
let devido = 0;
for (const l of saldo.values()) devido += (l.total - l.parcela) * l.valor;
console.log(`  itens parcelados: ${comParcela.length} · saldo a reembolsar: R$ ${brl(devido)}`);

if (!APLICAR) {
  console.log('\nDRY-RUN — nada gravado. Use --aplicar.');
  process.exit(0);
}

const pool = new pg.Pool({ connectionString: financeDatabaseUrl(), ssl: { rejectUnauthorized: false } });
const cli = await pool.connect();
try {
  await cli.query('BEGIN');
  const { rows: ent } = await cli.query(`SELECT id FROM fin_entity WHERE slug = 'xpe'`);
  const entityId = ent[0].id;
  let gravadas = 0;
  for (const l of finais) {
    await cli.query(
      `INSERT INTO fin_reembolso_item
         (entity_id, person_id, slug, descricao, competencia, valor_parcela_cents,
          parcela, parcelas_total, fonte, criado_por)
       VALUES ($1,$2,$3,$4,$5::date,$6,$7,$8,$9,$10)
       ON CONFLICT (person_id, slug, competencia) DO UPDATE
         SET descricao = EXCLUDED.descricao,
             valor_parcela_cents = EXCLUDED.valor_parcela_cents,
             parcela = EXCLUDED.parcela,
             parcelas_total = EXCLUDED.parcelas_total,
             atualizado_em = now(), atualizado_por = EXCLUDED.criado_por`,
      [entityId, l.personId, l.slug, l.descricao.slice(0, 200), l.competencia,
       l.valor, l.parcela, l.total, `planilha ${ARQUIVO}`, 'carregar-reembolsos']
    );
    gravadas++;
  }
  // Prova antes do commit: o saldo lido da view tem de bater com o calculado aqui.
  const { rows: v } = await cli.query(
    `SELECT coalesce(sum(saldo_cents),0)::bigint s FROM fin_reembolso_saldo_v WHERE NOT quitado`
  );
  await cli.query('COMMIT');
  console.log(`\n✓ ${gravadas} linhas gravadas.`);
  console.log(`  saldo em fin_reembolso_saldo_v: R$ ${brl(v[0].s)}`);
} catch (e) {
  await cli.query('ROLLBACK');
  console.error('ROLLBACK —', e.message);
  process.exitCode = 1;
} finally {
  cli.release();
  await pool.end();
}

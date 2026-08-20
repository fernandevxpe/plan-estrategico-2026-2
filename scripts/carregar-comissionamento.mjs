// Carrega "Comissionamento - XPE 2026" em fin_person_compensation.
//
// O QUE ENTRA AQUI
// ----------------
// Uma linha por pessoa × mês × componente: fixo, comissão de consultoria,
// comissão de obras, diária, inspeções, relatórios, deduções. É o plano de
// remuneração no nível de detalhe em que ele foi decidido — o mesmo que hoje
// mora em três abas de Excel.
//
// A tabela já existia com 117 linhas carregadas por outra via, cobrindo só
// parte dos meses e dos componentes (jan–jul tinham 9 a 11 linhas por mês,
// contra 60+ reais). O UNIQUE(person_id, reference_month, component, kind)
// faz o ON CONFLICT atualizar em vez de duplicar.
//
// `kind`: a tabela aceita 'contratado' (o que foi combinado) e 'apurado' (o
// que a apuração do mês produziu). Fixo e deduções são contratados; comissão,
// diária e inspeção são apurados — variam com o que aconteceu no mês.
//
// TRÊS COISAS QUE A LEITURA DA PLANILHA PRECISA SABER
// ---------------------------------------------------
//  1. Cada aba tem um layout diferente. Vendas e Engenharia começa na coluna
//     G, Hardware na F, Software na D. Não há como generalizar: o mapa abaixo
//     é explícito por aba.
//
//  2. A linha "Total" de cada pessoa é SOMA, não componente. Carregá-la
//     dobraria tudo. Só as linhas de componente entram.
//
//  3. Deduções é negativa na planilha e continua negativa aqui. É o que
//     representa os R$2.000/mês do Gabriel que vão para o João — e o
//     componente `repasse_terceiro` (0129) existe para quando o destino for
//     conhecido.
//
// Roda com: node scripts/carregar-comissionamento.mjs            (dry-run)
//           node scripts/carregar-comissionamento.mjs --aplicar

import { execFileSync } from 'node:child_process';
import { financeDatabaseUrl } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import pg from 'pg';

loadEnv();
const APLICAR = process.argv.includes('--aplicar');
const ARQUIVO = process.argv.find((a) => a.startsWith('--arquivo='))?.split('=')[1]
  ?? 'Comissionamento - XPE 2026.xlsx';

const PESSOAS = {
  'Fernando': 4, 'Gabriel': 2, 'Jonildo': 3, 'Igor': 1, 'Paulo Araújo': 91,
  'Igor Alves': 94, 'Cleber': 6, 'Tawanny': 95, 'Audrey': 12, 'Belo': 9,
  'Adryan': 8, 'Tiago': 7, 'Macgyver': 10, 'Diogo': 5, 'Dec': 11,
  'Evera': 89, 'João': 90, 'Kalebe': 98
};

// Rótulo na planilha → slug em fin_compensation_component.
const COMPONENTES = {
  'Fixo': 'fixo',
  'Consultoria': 'consultoria',
  'Consultoria/P&D': 'consultoria_pd',
  'P&D Plataforma': 'pd_plataforma',
  'Plataforma': 'plataforma',
  'Desenvolvimento': 'desenvolvimento',
  'Desenvolvimento/Suporte': 'suporte',
  'Comissão de Consultoria': 'comissao_consultoria',
  'Comissão de Obras': 'comissao_obras',
  'Comissão Obras': 'comissao_obras',
  'Comissão de Vendas': 'comissao_vendas',
  'Comissão de Pós-Venda': 'comissao_pos_venda',
  'Comissões 2025': 'comissoes_anteriores',
  'Comissão': 'comissao_vendas',
  'Venda de Lotes': 'venda_lotes',
  'Gestão De Usina': 'gestao_usina',
  'Gestão': 'gestao',
  'Gestão Financeira': 'gestao_financeira',
  'Relatórios': 'relatorios',
  'Instalações': 'instalacoes',
  'Inspeções/Levantamentos': 'inspecoes_levantamentos',
  'Diárias (Especialista)': 'diaria_especialista',
  'Diária Especialista': 'diaria_especialista',
  'Diária (Ajudante)': 'diaria_ajudante',
  'Diária Ajudante': 'diaria_ajudante',
  'Medidores Instalados': 'medidores_instalados',
  'Medidores': 'medidores_instalados',
  'Manutenção': 'manutencao',
  'Fabricação de medidores': 'fabricacao_medidores',
  'Participação no Fat. Vendas': 'participacao_fat_vendas',
  'Participação no Fat. Mensal': 'participacao_fat_mensal',
  'Repasse p/ recarga dos chips': 'repasse_chips',
  'Vendas': 'comissao_vendas',
  'Deduções': 'deducoes'
};

// Contratado = combinado de antemão. Apurado = depende do que o mês produziu.
const CONTRATADOS = new Set(['fixo', 'deducoes', 'desenvolvimento', 'suporte', 'plataforma',
  'consultoria', 'consultoria_pd', 'pd_plataforma', 'gestao', 'gestao_financeira']);

const brl = (c) => (Number(c) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

const PY = `
import openpyxl, json, sys
wb = openpyxl.load_workbook(sys.argv[1], data_only=True)
MESES = ['2026-01','2026-02','2026-03','2026-04','2026-05','2026-06','2026-07','2026-08']
# aba -> (coluna do rotulo, coluna do nome da pessoa, primeira coluna de mes)
LAYOUT = {'Vendas e Engenharia': (6, 5, 7), 'Hardware': (5, 4, 6), 'Software': (3, 3, 4)}
out=[]
for aba,(cRot,cNome,c0) in LAYOUT.items():
    if aba not in wb.sheetnames: continue
    ws = wb[aba]
    pessoa = None
    for r in range(1, ws.max_row+1):
        n = ws.cell(row=r, column=cNome).value
        if n and str(n).strip() and str(n).strip() not in ('Tipo','Total'):
            pessoa = str(n).strip()
        rot = ws.cell(row=r, column=cRot).value
        if not rot or not pessoa: continue
        rot = str(rot).strip()
        if aba == 'Software':
            # Software nao tem linhas de componente: o nome ja e a linha de valor.
            if rot in ('Time de Software','Total'): continue
            for i,m in enumerate(MESES):
                v = ws.cell(row=r, column=c0+i).value
                if isinstance(v,(int,float)) and v != 0:
                    out.append({'pessoa':rot,'componente':'Fixo','mes':m,'v':round(float(v)*100)})
            continue
        if rot in ('Total','Tipo'): continue
        for i,m in enumerate(MESES):
            v = ws.cell(row=r, column=c0+i).value
            if isinstance(v,(int,float)) and v != 0:
                out.append({'pessoa':pessoa,'componente':rot,'mes':m,'v':round(float(v)*100)})
print(json.dumps(out, ensure_ascii=False))
`;

const brutos = JSON.parse(execFileSync('python3', ['-c', PY, ARQUIVO], { encoding: 'utf8', maxBuffer: 32e6 }));

const linhas = [];
const semPessoa = new Set(), semComponente = new Set();
for (const b of brutos) {
  const personId = PESSOAS[b.pessoa];
  if (!personId) { semPessoa.add(b.pessoa); continue; }
  const comp = COMPONENTES[b.componente];
  if (!comp) { semComponente.add(b.componente); continue; }
  linhas.push({
    personId, pessoa: b.pessoa, comp, mes: `${b.mes}-01`, valor: b.v,
    kind: CONTRATADOS.has(comp) ? 'contratado' : 'apurado'
  });
}
// UNIQUE(person, mes, component, kind): soma o que colidir em vez de perder.
const porChave = new Map();
for (const l of linhas) {
  const k = `${l.personId}|${l.mes}|${l.comp}|${l.kind}`;
  const a = porChave.get(k);
  if (a) a.valor += l.valor; else porChave.set(k, { ...l });
}
const finais = [...porChave.values()];

console.log(`=== Carga de comissionamento — ${ARQUIVO} ===`);
console.log(`  células lidas:  ${brutos.length}`);
console.log(`  linhas a gravar: ${finais.length}`);
if (semPessoa.size) console.log(`  ⚠ pessoa não mapeada: ${[...semPessoa].join(' · ')}`);
if (semComponente.size) console.log(`  ⚠ componente não mapeado: ${[...semComponente].join(' · ')}`);
const porMes = {};
for (const l of finais) { porMes[l.mes] = (porMes[l.mes] || 0) + l.valor; }
console.log('\n  total por mês (com deduções, que são negativas):');
for (const [m, v] of Object.entries(porMes).sort()) console.log(`     ${m.slice(0, 7)}  ${brl(v).padStart(12)}`);

if (!APLICAR) { console.log('\nDRY-RUN — nada gravado. Use --aplicar.'); process.exit(0); }

const pool = new pg.Pool({ connectionString: financeDatabaseUrl(), ssl: { rejectUnauthorized: false } });
const cli = await pool.connect();
try {
  await cli.query('BEGIN');
  const { rows: ent } = await cli.query(`SELECT id FROM fin_entity WHERE slug = 'xpe'`);
  const entityId = ent[0].id;
  for (const l of finais) {
    await cli.query(
      `INSERT INTO fin_person_compensation
         (entity_id, person_id, reference_month, component, kind, amount_cents, source, notes)
       VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8)
       ON CONFLICT (person_id, reference_month, component, kind) DO UPDATE
         SET amount_cents = EXCLUDED.amount_cents, source = EXCLUDED.source, notes = EXCLUDED.notes`,
      [entityId, l.personId, l.mes, l.comp, l.kind, l.valor,
       'planilha-comissionamento', `Carregado de ${ARQUIVO} por carregar-comissionamento.mjs`]
    );
  }
  const { rows: c } = await cli.query(`SELECT count(*)::int n FROM fin_person_compensation`);
  await cli.query('COMMIT');
  console.log(`\n✓ ${finais.length} linhas gravadas. Tabela agora com ${c[0].n} linhas.`);
} catch (e) {
  await cli.query('ROLLBACK');
  console.error('ROLLBACK —', e.message);
  process.exitCode = 1;
} finally { cli.release(); await pool.end(); }

// Cruza o extrato bancário com o controle de obras no ClickUp, mês a mês —
// a ferramenta que nasceu de duas rodadas manuais (janeiro e fevereiro/2026)
// que juntas corrigiram 122 lançamentos com evidência direta da fonte que a
// operação usava antes de migrar pra este ERP.
//
// O QUE O CLICKUP TEM QUE O BANCO NÃO TEM: o extrato bancário só sabe "saiu
// R$152,64 pra CEMOPEL". A lista "Fluxo de caixa" do espaço Obras no ClickUp
// (901322731776) tem, pra cada pagamento, um campo Categoria e Subcategoria
// escolhidos por quem pagou — é a intenção registrada no momento, não uma
// regra genérica adivinhando pelo nome do fornecedor depois. Quando a
// categoria do sistema diverge da do ClickUp pro MESMO pagamento (mesma
// data, mesmo valor, achado por cruzamento exato — nunca aproximado), a
// fonte do ClickUp vale mais.
//
// TRÊS LIÇÕES DESTA RODADA, JÁ EMBUTIDAS AQUI:
//
//  1. Nomes de fornecedor perdem pra nomes de processador de pagamento.
//     "CEMOPEL" e "Dimensional Brasil" foram classificados como taxa
//     bancária (4.05) porque "CIELO"/processador apareceu na descrição do
//     banco — o ClickUp mostrava a intenção real (material de obra,
//     combustível). Por isso o mapa abaixo trata "Ferramentas e
//     equipamentos" e "Materiais para serviço" como o MESMO destino (4.02):
//     a distinção do ClickUp entre as duas é mais fina do que o plano de
//     contas atual consegue capturar.
//
//  2. Categoria inteira pode estar sendo usada errada, não só transações
//     avulsas. As 24 transações de "3.14 Smart Charging e Carregadores" (0
//     a 100% do ano) eram TODAS projeto/inspeção pontual, nunca o serviço
//     recorrente — confirmado pelo Fernando ("Smart Charging até hoje não
//     gerou receita"). Se uma categoria aparecer aqui com divergência em
//     praticamente 100% dos casos cruzados, é sinal de mau uso estrutural,
//     não de erros isolados — vale conferir a categoria inteira, não só os
//     itens do mês.
//
//  3. "Sem par no sistema" pode ser dinheiro que nunca chegou. Documento
//     confirmado como pago no ClickUp mas sem transação bancária
//     correspondente é o mesmo padrão do Imbituba (ver
//     scripts/verificar-baixa-sem-recebimento.mjs) — merece a mesma
//     desconfiança, não só "falta importar".
//
// O QUE ISTO NÃO FAZ: não aplica nada sozinho. Imprime o dry-run de cada
// lote pronto pra copiar pro reclassificar-lote — a decisão de aplicar
// continua sendo de quem lê.
//
// Roda com: node scripts/cruzar-clickup-obras.mjs --mes=2026-02
//           node scripts/cruzar-clickup-obras.mjs --mes=2026-02 --json  (pra outro script consumir)

import { readFileSync } from 'node:fs';
import { financeDatabaseUrl } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import pg from 'pg';

loadEnv();

const args = new Map(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));
const MES = args.get('mes');
if (!MES || !/^\d{4}-\d{2}$/.test(MES)) {
  console.error('uso: node scripts/cruzar-clickup-obras.mjs --mes=2026-02');
  process.exit(1);
}
const JSON_OUT = args.get('json') === true;
const DE = `${MES}-01`;
const [ano, mesNum] = MES.split('-').map(Number);
const ATE = new Date(Date.UTC(ano, mesNum, 1)).toISOString().slice(0, 10);

const LISTA_FLUXO_CAIXA = '901322731776';
const brl = (c) => (Number(c) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

// Pra onde cada categoria do ClickUp deveria apontar no plano de contas.
// Lista, porque "aceitável" às vezes é mais de um código (ex.: Comissões
// pode ser 4.01 comissão de vendedor OU já estar em 6.01/6.02 se a pessoa é
// da equipe e a comissão é tratada como parte da remuneração — julgamento
// que este script não faz sozinho, só sinaliza).
const ACEITAVEL = {
  'Materiais para serviço': ['4.02'],
  'Ferramentas e equipamentos': ['4.02', '8.01'],
  'Transporte e deslocamento': ['4.04'],
  'Alimentação': ['6.05', '6.04'],
  'Terceirização de serviços': ['4.03'],
  'Salários': ['6.01', '6.02'],
  'Comissões': ['4.01', '6.01', '6.02'],
  'Serviços bancários': ['4.05', '9.03'],
  'Impostos e taxas': ['7.01', '7.02', '6.03'],
  'Contabilidade': ['5.04'],
  'Despesas administrativas': ['5.10', '5.04'],
  'Software e assinaturas': ['5.03'],
  'Infraestrutura / escritório': ['5.01', '5.02'],
  'Logística e frete': ['4.04'],
  'Marketing e vendas': ['5.05'],
  'Manutenção de equipamentos': ['4.02', '8.01'],
  'Pagamento de Fatura': ['9.01'],
  'Reserva de caixa': ['9.03'],
  'Caixa Impostos': ['7.01', '7.02', '6.03']
};

function campo(t, nome) {
  const f = t.custom_fields.find((f) => f.name === nome);
  if (!f || f.value == null) return null;
  if (f.type === 'drop_down') return f.type_config?.options?.find((o) => o.orderindex === f.value || o.id === f.value)?.name ?? f.value;
  if (f.type === 'currency') return Number(f.value);
  if (f.type === 'date') return new Date(Number(f.value)).toISOString().slice(0, 10);
  return f.value;
}
function dataPagto(t) {
  return campo(t, 'Data do Pagamento') || (t.due_date ? new Date(Number(t.due_date)).toISOString().slice(0, 10) : null);
}

const raw = JSON.parse(readFileSync(new URL('../data/raw/clickup-tasks.json', import.meta.url), 'utf8'));
const tasksObra = (raw.data || raw).filter((t) => t.list?.id === LISTA_FLUXO_CAIXA);

const clickupSaida = tasksObra
  .map((t) => ({
    nome: t.name, data: dataPagto(t), valor: campo(t, 'Valor pago'),
    mov: campo(t, 'Movimentação'), categoria: campo(t, 'Categoria'), sub: campo(t, 'Subcategoria')
  }))
  .filter((l) => l.data >= DE && l.data < ATE && l.mov === 'Saida' && l.valor > 0);

const pool = new pg.Pool({ connectionString: financeDatabaseUrl(), ssl: { rejectUnauthorized: false } });

const { rows: sistema } = await pool.query(
  `SELECT t.id, t.posted_on::text AS data, abs(t.amount_cents) AS valor_cents, t.description_raw, c.code, c.name
     FROM fin_transaction t LEFT JOIN fin_category c ON c.id = t.category_id
    WHERE t.amount_cents < 0 AND t.posted_on >= $1 AND t.posted_on < $2
      AND t.transfer_status NOT IN ('pareado','anulado') AND NOT t.is_split_parent`,
  [DE, ATE]
);
await pool.end();

const candidatosPorChave = new Map();
for (const row of sistema) {
  const chave = `${row.data}|${row.valor_cents}`;
  candidatosPorChave.set(chave, [...(candidatosPorChave.get(chave) || []), row]);
}

// O QUE O EXTRATO SABE E O CLICKUP NÃO
// ------------------------------------
// A regra geral deste script é que o ClickUp vale mais, porque ele tem a
// intenção de quem pagou. Há uma exceção medida, e ela se repetiu em MARÇO,
// ABRIL e MAIO de 2026 sem falhar uma vez: quando o extrato diz "Aplicação
// RDB", o dinheiro foi para uma aplicação financeira — mesmo quando o ClickUp
// rotula a linha como "pagamento imposto parcela 2" ou "Caixa Impostos".
//
// O que acontece na prática é que a operação separa dinheiro num RDB PARA
// pagar imposto depois. O ClickUp registra o propósito (imposto); o extrato
// registra o fato (aplicação). Para a DRE vale o fato: aplicar não é pagar.
//
// Sem esta guarda o script propôs, três meses seguidos, mover de 9.03 para
// 7.01 lançamentos que estavam certos — R$12.365,76 em março, R$1.206,73 em
// abril, R$3.723,42 em maio. Três vezes a sugestão foi lida e descartada à
// mão. Na quarta ela não aparece.
const EXTRATO_MANDA = [
  { padrao: /aplica[çc][ãa]o\s+rdb/i, motivo: 'extrato diz "Aplicação RDB": é aplicação financeira, não pagamento de imposto' },
  { padrao: /resgate\s+rdb/i,         motivo: 'extrato diz "Resgate RDB": é resgate de aplicação, não entrada operacional' }
];

const semPar = [], ambiguos = [], divergentes = [], conformes = [], extratoVence = [];

// Uma transação só pode ter UM destino. Quando duas linhas do ClickUp caem no
// mesmo (data, valor) — gêmeas — elas apontam para a mesma transação, e o
// script chegava a propor a MESMA id em dois lotes com destinos diferentes
// (abril: #75299 foi para 4.02 e para 4.03 no mesmo relatório). Aplicar os
// dois lotes faria a segunda escrita desfazer a primeira, em silêncio.
const linhasPorChave = new Map();
for (const l of clickupSaida) {
  const chave = `${l.data}|${Math.round(l.valor * 100)}`;
  linhasPorChave.set(chave, [...(linhasPorChave.get(chave) || []), l]);
}

for (const [chave, linhas] of linhasPorChave) {
  const cands = candidatosPorChave.get(chave) || [];
  if (cands.length === 0) { semPar.push(...linhas); continue; }

  // Gêmeas do ClickUp, ou mais de um candidato no banco: em qualquer dos dois
  // casos o pareamento 1-para-1 não existe, e propor destino seria adivinhar.
  if (cands.length > 1 || linhas.length > 1) {
    for (const l of linhas) ambiguos.push({ l, cands });
    continue;
  }

  const l = linhas[0], sist = cands[0];
  const veto = EXTRATO_MANDA.find((v) => v.padrao.test(sist.description_raw || ''));
  if (veto) { extratoVence.push({ l, sist, motivo: veto.motivo }); continue; }

  const aceitos = ACEITAVEL[l.categoria] || [];
  if (aceitos.length && !aceitos.includes(sist.code)) divergentes.push({ l, sist });
  else conformes.push({ l, sist });
}

if (JSON_OUT) {
  console.log(JSON.stringify({ mes: MES, divergentes, ambiguos, semPar, extratoVence, totalClickup: clickupSaida.length, totalConformes: conformes.length }, null, 2));
  process.exit(0);
}

console.log(`=== Cruzamento ClickUp × sistema — ${MES} ===`);
console.log(`ClickUp (saída, obras): ${clickupSaida.length} lançamentos, R$ ${clickupSaida.reduce((s, l) => s + l.valor, 0).toFixed(2)}`);
console.log(`Conformes: ${conformes.length} | Divergentes: ${divergentes.length} | Ambíguos: ${ambiguos.length} | Sem par: ${semPar.length}`);
if (extratoVence.length) {
  console.log(`Vetados pelo extrato: ${extratoVence.length} (o ClickUp sugeria mudar, o extrato prova que não)`);
}
console.log();

if (divergentes.length) {
  console.log('--- DIVERGENTES (categoria do sistema não bate com a intenção registrada no ClickUp) ---');
  const porDestino = new Map();
  for (const { l, sist } of divergentes) {
    const destino = (ACEITAVEL[l.categoria] || ['?'])[0];
    porDestino.set(destino, [...(porDestino.get(destino) || []), { l, sist }]);
  }
  for (const [destino, itens] of porDestino) {
    console.log(`\n  → sugestão: mover para ${destino} (${itens.length} itens, R$ ${itens.reduce((s, x) => s + x.l.valor, 0).toFixed(2)})`);
    console.log(`     ids: [${itens.map((x) => x.sist.id).join(',')}]`);
    for (const { l, sist } of itens) {
      console.log(`     #${sist.id} ${l.data} R$${l.valor.toFixed(2)} "${l.nome.slice(0, 50)}" — hoje em ${sist.code ?? 'SEM CATEGORIA'} ${sist.name ?? ''}`);
    }
  }
}

if (ambiguos.length) {
  console.log('\n--- AMBÍGUOS (mais de uma transação com mesma data+valor — revisar manualmente) ---');
  for (const { l, cands } of ambiguos) {
    console.log(`  ClickUp: ${l.data} R$${l.valor.toFixed(2)} "${l.nome}" [${l.categoria}]`);
    for (const c of cands) console.log(`     candidato #${c.id} [${c.code ?? 'SEM'}] "${c.description_raw.slice(0, 55)}"`);
  }
}

if (semPar.length) {
  console.log('\n--- SEM PAR NO SISTEMA (ClickUp diz que pagou; nenhuma transação bancária encontrada) ---');
  console.log('    Mesmo risco do padrão "baixa sem recebimento" — confira se o dinheiro realmente saiu.');
  for (const l of semPar) console.log(`  ${l.data} R$${l.valor.toFixed(2)} "${l.nome.slice(0, 60)}" [${l.categoria}/${l.sub ?? '-'}]`);
}

if (extratoVence.length) {
  console.log('\n--- VETADOS PELO EXTRATO (o ClickUp sugeria mover; o extrato prova que a categoria atual está certa) ---');
  for (const { l, sist, motivo } of extratoVence) {
    console.log(`  #${sist.id} ${l.data} R$${l.valor.toFixed(2)} "${l.nome.slice(0, 44)}" [${l.categoria}]`);
    console.log(`     mantido em ${sist.code ?? 'SEM CATEGORIA'} — ${motivo}`);
  }
}

if (!divergentes.length && !ambiguos.length && !semPar.length) {
  console.log('Nada a revisar — todos os pagamentos de obra deste mês já batem com o ClickUp.');
}

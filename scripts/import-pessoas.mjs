// Importa o time da planilha "Comissionamento - XPE 2026" para o ledger.
//
// O problema que este script existe para resolver: a planilha sabe NOME e
// VÍNCULO e não sabe documento; o extrato sabe CPF/CNPJ e nome de cartório e não
// sabe quem é do time. Ninguém sozinho responde "quanto custa a XPE de gente".
//
// A regra que governa o arquivo inteiro: FALSO NEGATIVO É BARATO, FALSO POSITIVO
// É ETERNO. Uma pessoa que fica sem contraparte vira uma linha numa fila que
// alguém resolve em dois minutos. Uma pessoa ligada à contraparte errada faz o
// custo dela mentir em todos os relatórios, para sempre, sem erro nenhum na
// tela. Já aconteceu nesta base: "PAULO GABRIEL CHAVES DE ARAUJO" casou com
// "Gabriel" numa auditoria anterior — são o estagiário e o sócio.
//
// Por isso toda ligação carrega um score e passa por dois portões:
//   1. IDENTIDADE  — o apelido da planilha é mesmo esta pessoa do extrato?
//   2. PUREZA      — a contraparte do ledger representa SÓ esta pessoa?
// O segundo portão é o que importa mais aqui, e não é teórico: a contraparte 349
// ("NU PAGAMENTOS - IP") carrega 226 lançamentos e R$ 340 mil de pelo menos 15
// pessoas diferentes, porque o importador do Inter gravou o banco de destino no
// lugar do favorecido. Ligar qualquer pessoa a ela seria pendurar o custo de 15
// no nome de 1.
//
// Uso:
//   node scripts/import-pessoas.mjs                      dry-run (padrão)
//   node scripts/import-pessoas.mjs --apply              grava
//   node scripts/import-pessoas.mjs --dir=caminho/csvs   de onde vêm as abas
//   node scripts/import-pessoas.mjs --limiar=0.85        exige mais para ligar
//   node scripts/import-pessoas.mjs --relatorio=x.md     salva o relatório
//
// Arquivos esperados em --dir (nomes exportados do Google Sheets):
//   planilha.csv          aba principal: totais mensais + roster com vínculo
//   aba-1022703245.csv    projeção de folha + "Via de Pagamento | ... | Comissão"
//   aba-1170035588.csv    Time de Software (série mensal)
//   aba-191161036.csv     Time de Hardware (série mensal por componente)
//   aba-151683415.csv     totais mensais (cópia da principal; usada para conferir)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { normalizeName, toCents } from './lib/fin-normalize.mjs';
import { registerFinanceTypeParsers } from './lib/fin-types.mjs';

loadEnv();
registerFinanceTypeParsers();

const argv = process.argv.slice(2);
const flag = (nome, padrao = null) => {
  const hit = argv.find((a) => a.startsWith(`--${nome}=`));
  return hit ? hit.slice(nome.length + 3) : padrao;
};
const APLICAR = argv.includes('--apply');
const DIR = path.resolve(flag('dir', 'data/raw/pessoas'));
const RELATORIO = flag('relatorio', null);
const ENTITY_SLUG = 'xpe';
const FONTE = 'planilha:comissionamento-xpe-2026';

// Mês de referência da apuração. É agosto porque é o último mês fechado da
// planilha (R$ 66.657,30) e o único que dá para conferir contra o extrato.
const MES_APURACAO = '2026-08-01';

/**
 * Limiar de confiança para ligar pessoa a contraparte sem humano no meio.
 *
 * 0,80 não é número redondo por acaso: é o ponto em que o casamento precisa ter
 * DUAS evidências independentes (nome + valor, ou nome + documento). Uma só
 * nunca chega lá. Abaixo disso o script propõe e não aplica.
 */
const LIMIAR = Number(flag('limiar', '0.80'));

const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const meses2026 = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'];

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------
/** Parser mínimo com aspas — as células de dinheiro vêm como "R$ 1.234,56". */
function parseCsv(texto) {
  const linhas = [];
  let campo = '';
  let linha = [];
  let aspas = false;
  for (let i = 0; i < texto.length; i += 1) {
    const c = texto[i];
    if (aspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i += 1; } else aspas = false;
      } else campo += c;
      continue;
    }
    if (c === '"') { aspas = true; continue; }
    if (c === ',') { linha.push(campo); campo = ''; continue; }
    if (c === '\n') { linha.push(campo); linhas.push(linha); linha = []; campo = ''; continue; }
    if (c === '\r') continue;
    campo += c;
  }
  linha.push(campo);
  linhas.push(linha);
  return linhas;
}

/**
 * Dinheiro da planilha em centavos.
 *
 * Devolve null (e não 0) para célula vazia, " R$  -   " e "#REF!". A diferença
 * importa: 0 é "combinado que não paga", null é "esta célula não diz nada". Um
 * null virando 0 apagaria a distinção entre o Kalebe (fixo em branco na aba de
 * via de pagamento) e alguém que realmente zerou.
 */
function dinheiro(valor) {
  const cru = String(valor ?? '').trim();
  if (!cru) return null;
  if (/^#(REF|VALUE|N\/A|DIV)/i.test(cru)) return null;
  if (!/\d/.test(cru)) return null; // " R$  -   "
  try {
    return toCents(cru);
  } catch {
    return null;
  }
}

const lerCsv = (arquivo) => {
  const p = path.join(DIR, arquivo);
  if (!existsSync(p)) throw new Error(`aba não encontrada: ${p}\n  passe --dir=<pasta com os CSVs exportados da planilha>`);
  return parseCsv(readFileSync(p, 'utf8'));
};

// ---------------------------------------------------------------------------
// Vínculo
// ---------------------------------------------------------------------------
// A planilha escreve o vínculo na coluna "Meio de Pagamento" — e escreve com
// caixa inconsistente ("Mei" e "mei" na mesma coluna). Normalizar aqui é o que
// impede o mesmo vínculo de virar dois.
const VINCULO = {
  'socio adm': 'socio_adm',
  socio: 'socio',
  mei: 'mei',
  estagio: 'estagiario',
  estagiario: 'estagiario',
  irregular: 'irregular',
  clt: 'clt'
};
function vinculo(bruto) {
  const k = String(bruto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  return VINCULO[k] ?? 'indefinido';
}

// ---------------------------------------------------------------------------
// Apelidos que a planilha usa para a MESMA pessoa
// ---------------------------------------------------------------------------
// Cada entrada carrega a prova. Sem prova, a linha não entra aqui — vai para a
// fila de pendências. Fundir duas pessoas é tão caro quanto separar uma.
const MESMA_PESSOA = [
  {
    principal: 'Flavio',
    apelidos: ['Macgyver'],
    prova: 'confirmado pelo dono da empresa; ambos R$ 5.100,00 fixos, e a aba de Hardware não tem linha "Flavio" nem a principal tem "Macgyver"'
  },
  {
    principal: 'Igor A',
    apelidos: ['Est. Igor'],
    prova:
      'ledger: Igor Alves Cordeiro (MEI 64.446.127/0001-11) recebeu R$ 1.000,00 em 02/01 e R$ 1.500,00 a partir de 02/02. ' +
      'A projeção diz "Est. Igor: atual R$ 1.000 → Fev R$ 1.500" e o roster diz "Igor A: R$ 1.500". ' +
      'A linha "Igor" da projeção é a outra pessoa: atual R$ 1.700 → Fev R$ 5.000, e o ledger mostra ' +
      'Igor Dalton Guilherme da Silva recebendo exatamente R$ 1.700,00 em 02/01 e R$ 5.000,00 fixos depois. ' +
      'Logo: dois Igors, e o par repetido é Igor A ≡ Est. Igor.'
  },
  { principal: 'Paulo', apelidos: ['Est. P. Araújo'], prova: 'mesmo valor (R$ 1.300) e mesmo vínculo (Estágio); "P. Araújo" é o sobrenome do Paulo Gabriel Chaves de Araujo do extrato' },
  { principal: 'Tawany', apelidos: ['Est. Tawanny'], prova: 'mesmo valor (R$ 1.000→1.300) e mesmo vínculo; MEI 63.384.563/0001-40 no extrato' },
  { principal: 'Dec', apelidos: ['Decézaris'], prova: 'apelido do Decezaris Augusto de Melo Pereira; R$ 4.500 nas duas abas' },
  { principal: 'Evera', apelidos: ['Everaldo'], prova: 'R$ 1.500 nas duas abas; Everaldo Ferreira de Lucena Neto no extrato' },
  { principal: 'Felipe', apelidos: ['Filipe'], prova: 'R$ 2.500 nas duas abas; via de pagamento "Obras"' },
  { principal: 'Cleber', apelidos: ['Est. Cleber'], prova: 'mesmo nome próprio, mesma coluna de projeção' },
  { principal: 'Belo', apelidos: [], prova: '' },
  { principal: 'Fernando', apelidos: [], prova: '' }
];
const APELIDO_CANONICO = new Map();
for (const g of MESMA_PESSOA) for (const a of g.apelidos) APELIDO_CANONICO.set(a.toLowerCase(), g.principal);
const canonizaApelido = (a) => APELIDO_CANONICO.get(String(a).trim().toLowerCase()) ?? String(a).trim();

// Linhas da projeção que são vaga em aberto, não pessoa.
const VAGAS = new Set(['rh', 'novo vendedor']);

// ---------------------------------------------------------------------------
// Leitura das abas
// ---------------------------------------------------------------------------
/** Aba principal: totais mensais (linhas 3–8) e roster (a partir da linha 12). */
function lerAbaPrincipal() {
  const linhas = lerCsv('planilha.csv');
  const totalMes = {};
  const cabecalho = linhas[1] ?? [];
  const totais = linhas[7] ?? [];
  for (let c = 3; c <= 14; c += 1) {
    const mes = String(cabecalho[c] ?? '').trim();
    if (!mes) continue;
    totalMes[mes.toLowerCase()] = dinheiro(totais[c]);
  }

  const roster = [];
  for (const l of linhas) {
    const vinc = String(l[4] ?? '').trim();
    const nome = String(l[5] ?? '').trim();
    const valor = dinheiro(l[6]);
    if (!nome || !vinc) continue;
    if (/falta pagar|total/i.test(nome)) continue;
    // A linha do roster só vale se a coluna de vínculo trouxer um vínculo
    // conhecido. Sem esta guarda, a faixa de totais mensais no topo da aba
    // (onde a coluna E é "fevereiro" e a F é "março") entra como se fosse
    // gente, e o roster ganha pessoas chamadas "R$ 64.516,95".
    if (vinculo(vinc) === 'indefinido') continue;
    roster.push({
      apelido: canonizaApelido(nome),
      apelidoBruto: nome,
      vinculo: vinculo(vinc),
      vinculoBruto: vinc,
      apuradoCents: valor,
      // A coluna ao lado traz "ok" ou o valor já pago; quando é número, é a
      // parcela do mês que já saiu (o caso do Gabriel: 9.679,70 de 11.300,70).
      pagoCents: dinheiro(l[7]),
      obsCents: dinheiro(l[9])
    });
  }
  return { totalMes, roster };
}

/** Aba de projeção: "custo bruto folha" + tabela de via/meio de pagamento. */
function lerAbaProjecao() {
  const linhas = lerCsv('aba-1022703245.csv');
  const projecao = [];
  const contrato = [];
  for (const l of linhas) {
    const nomeProj = String(l[2] ?? '').trim();
    if (nomeProj && !/^(custo bruto folha|total)$/i.test(nomeProj) && dinheiro(l[3]) !== null) {
      if (!VAGAS.has(nomeProj.toLowerCase())) {
        projecao.push({
          apelido: canonizaApelido(nomeProj),
          apelidoBruto: nomeProj,
          atual: dinheiro(l[3]),
          fev: dinheiro(l[4]),
          julho: dinheiro(l[5]),
          dez: dinheiro(l[6])
        });
      }
    }
    const via = String(l[1] ?? '').trim();
    const membro = String(l[3] ?? '').trim();
    if (!via || !membro || /^total$/i.test(membro) || /^via de pagamento$/i.test(via)) continue;
    contrato.push({
      apelido: canonizaApelido(membro),
      apelidoBruto: membro,
      via: via.toLowerCase(),
      vinculo: vinculo(l[2]),
      vinculoBruto: String(l[2] ?? '').trim(),
      fixoCents: dinheiro(l[4]),
      comissaoConsultoriaCents: dinheiro(l[5]),
      comissaoObrasCents: dinheiro(l[6])
    });
  }
  return { projecao, contrato };
}

/** Time de Software: uma linha por pessoa, uma coluna por mês. */
function lerAbaSoftware() {
  const linhas = lerCsv('aba-1170035588.csv');
  const cab = linhas[2] ?? [];
  const idxMes = {};
  for (let c = 3; c < cab.length; c += 1) {
    const m = String(cab[c] ?? '').trim().toLowerCase();
    if (m) idxMes[m] = c;
  }
  const pessoas = [];
  for (const l of linhas.slice(3)) {
    const nome = String(l[2] ?? '').trim();
    if (!nome || /^total$/i.test(nome)) continue;
    const serie = {};
    for (const [m, c] of Object.entries(idxMes)) {
      const v = dinheiro(l[c]);
      if (v !== null) serie[m] = v;
    }
    pessoas.push({ apelido: canonizaApelido(nome), time: 'software', componente: 'desenvolvimento', serie });
  }
  return pessoas;
}

/**
 * Time de Hardware: blocos de pessoa. A coluna D traz o nome só na primeira
 * linha do bloco (a do "Total"); as linhas seguintes trazem o componente na
 * coluna E. É essa forma que obriga a leitura com estado.
 */
function lerAbaHardware() {
  const linhas = lerCsv('aba-191161036.csv');
  let cab = null;
  const idxMes = {};
  for (const l of linhas) {
    if (String(l[4] ?? '').trim() === 'Time de Hardware') { cab = l; break; }
  }
  if (cab) {
    for (let c = 5; c < cab.length; c += 1) {
      const m = String(cab[c] ?? '').trim().toLowerCase();
      if (m) idxMes[m] = c;
    }
  }
  // Cabeçalho da planilha → slug de fin_compensation_component.
  const COMPONENTE = {
    'medidores instalados': 'medidores_instalados',
    'manutenção': 'manutencao',
    'fabricação de medidores': 'fabricacao_medidores',
    'diária especialista': 'diaria_especialista',
    'diária ajudante': 'diaria_ajudante',
    consultoria: 'consultoria',
    'participação no fat. mensal': 'participacao_fat_mensal',
    'participação no fat. vendas': 'participacao_fat_vendas',
    plataforma: 'plataforma',
    desenvolvimento: 'desenvolvimento',
    'desenvolvimento/suporte': 'suporte',
    'inspeções/levantamentos': 'inspecoes_levantamentos',
    'comissão de vendas': 'comissao_vendas',
    'repasse p/ recarga dos chips': 'repasse_chips',
    fixo: 'fixo',
    'deduções': 'deducoes'
  };
  const pessoas = [];
  let atual = null;
  for (const l of linhas) {
    const nome = String(l[3] ?? '').trim();
    const rotulo = String(l[4] ?? '').trim();
    if (nome && rotulo === 'Total') {
      atual = { apelido: canonizaApelido(nome), time: 'hardware', componentes: {} };
      pessoas.push(atual);
      continue;
    }
    if (!atual || !rotulo) continue;
    if (rotulo === 'Total') { atual = null; continue; } // linha de total geral
    const slug = COMPONENTE[rotulo.toLowerCase()];
    if (!slug) continue;
    const serie = {};
    for (const [m, c] of Object.entries(idxMes)) {
      const v = dinheiro(l[c]);
      if (v !== null && v !== 0) serie[m] = v;
    }
    if (Object.keys(serie).length) atual.componentes[slug] = serie;
  }
  return pessoas;
}

// ---------------------------------------------------------------------------
// O lado do ledger
// ---------------------------------------------------------------------------
/**
 * Quem recebeu, segundo a descrição do lançamento.
 *
 * O nome do favorecido está na descrição em todas as três fontes, em formatos
 * diferentes. Ler daqui (e não da contraparte) é deliberado: a contraparte do
 * Inter está com nome de banco, a descrição está com nome de gente.
 */
function favorecido(conta, descricao) {
  const d = descricao ?? '';
  if (conta === 'inter') {
    let m = d.includes(' — ') ? d.split(' — ').slice(1).join(' — ') : d;
    m = m.replace(/^Pix (enviado|recebido):\s*"?/i, '').replace(/^Pagamento efetuado:\s*"?/i, '').replace(/"$/, '');
    return limpaDocumentoNoNome(m.replace(/^Cp\s*:?\s*\d+\s*-\s*/i, '').trim());
  }
  if (conta.startsWith('nubank')) {
    let m = d.match(/enviada pelo Pix\s+—\s+(.*)$/i);
    if (m) return limpaDocumentoNoNome(m[1].split(' - ')[0].trim());
    m = d.match(/boleto efetuado\s+—\s+(.*)$/i);
    if (m) return limpaDocumentoNoNome(m[1].trim());
    return '';
  }
  if (conta === 'asaas') {
    const m = d.match(/via Pix.*? para (.*)$/i);
    return m ? limpaDocumentoNoNome(m[1].trim()) : '';
  }
  return '';
}

/**
 * MEI aparece como "64266025 Igor Dalton Guilherme da Silva" e às vezes com o
 * CPF colado no fim. Sem tirar isso, a mesma pessoa vira três nomes distintos.
 */
const limpaDocumentoNoNome = (n) =>
  n.replace(/^[\d][\d.\/\s-]{5,}\s+/, '').replace(/\s+\d{11,}$/, '').replace(/\s+/g, ' ').trim();

const chaveNome = (s) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Agrega o extrato por favorecido.
 *
 * Descarta o lote `import_csv` da conta Inter: é março/2026 importado duas vezes
 * (uma pelo CSV, outra pela API), com hash de deduplicação diferente porque a
 * descrição muda de formato. São R$ 131.305,14 de saída fantasma no mês, dos
 * quais R$ 69.396,09 em pagamento a pessoas. Somar isso faria o custo de gente
 * de março parecer R$ 164 mil.
 */
async function lerLedger(client, entityId) {
  const { rows } = await client.query(
    `SELECT t.id, a.slug conta, t.posted_on, t.amount_cents, t.description_raw, t.counterparty_id, t.source
       FROM fin_transaction t JOIN fin_account a ON a.id = t.account_id
      WHERE t.entity_id = $1 AND t.amount_cents < 0 AND t.posted_on >= '2026-01-01'
      ORDER BY t.posted_on`,
    [entityId]
  );

  const bruto = new Map();
  let duplicataMarco = 0;

  for (const t of rows) {
    const nome = favorecido(t.conta, t.description_raw);
    const k = chaveNome(nome);
    if (!k) continue;
    const valor = -Number(t.amount_cents);
    if (t.source === 'import_csv' && t.conta === 'inter') { duplicataMarco += valor; continue; }
    if (!bruto.has(k)) bruto.set(k, { nome, chave: k, lancamentos: [] });
    bruto.get(k).lancamentos.push({ valor, dia: String(t.posted_on).slice(0, 10), conta: t.conta, cp: t.counterparty_id ? Number(t.counterparty_id) : null });
  }

  // --------------------------------------------------------------- fusão
  // O extrato trunca e estende o mesmo nome: "Igor Dalton Guilherme Da Sil"
  // (limite de caracteres do PIX) e "Tawanny De Melo Inacio Dos Santos" (nome
  // atualizado no banco) são a mesma pessoa de "Igor Dalton Guilherme Da Silva"
  // e "Tawanny De Melo Inacio". Fundir por prefixo de tokens resolve os dois
  // casos sem heurística de similaridade — ou o começo do nome é idêntico, ou
  // não funde.
  const chaves = [...bruto.keys()].sort((a, b) => b.length - a.length);
  const destino = new Map();
  for (const curta of [...chaves].reverse()) {
    for (const longa of chaves) {
      if (longa === curta) continue;
      if (longa.startsWith(`${curta} `) && curta.split(' ').length >= 3) { destino.set(curta, longa); break; }
    }
  }
  const resolve = (k) => { let cur = k; const visto = new Set(); while (destino.has(cur) && !visto.has(cur)) { visto.add(cur); cur = destino.get(cur); } return cur; };

  const porFavorecido = new Map();
  const porContraparte = new Map();
  for (const [k, b] of bruto) {
    const alvo = resolve(k);
    if (!porFavorecido.has(alvo)) {
      porFavorecido.set(alvo, { nome: bruto.get(alvo)?.nome ?? b.nome, chave: alvo, n: 0, total: 0, meses: {}, dias: {}, valores: [], contrapartes: new Map(), contas: new Set(), fundidos: new Set() });
    }
    const f = porFavorecido.get(alvo);
    if (alvo !== k) f.fundidos.add(b.nome);
    for (const l of b.lancamentos) {
      f.n += 1; f.total += l.valor; f.valores.push(l.valor);
      f.meses[l.dia.slice(0, 7)] = (f.meses[l.dia.slice(0, 7)] ?? 0) + l.valor;
      (f.dias[l.dia] ??= []).push(l.valor);
      f.contas.add(l.conta);
      if (l.cp) {
        f.contrapartes.set(l.cp, (f.contrapartes.get(l.cp) ?? 0) + 1);
        if (!porContraparte.has(l.cp)) porContraparte.set(l.cp, { total: 0, porNome: new Map() });
        const c = porContraparte.get(l.cp);
        c.total += 1;
        c.porNome.set(alvo, (c.porNome.get(alvo) ?? 0) + 1);
      }
    }
  }

  const { rows: cps } = await client.query(
    `SELECT id, name, normalized_name, document_type, document_number, kind FROM fin_counterparty WHERE entity_id = $1`,
    [entityId]
  );
  return { porFavorecido, porContraparte, contrapartes: new Map(cps.map((c) => [Number(c.id), c])), duplicataMarco };
}

// ---------------------------------------------------------------------------
// Identidade: apelido da planilha × nome de cartório do extrato
// ---------------------------------------------------------------------------
/**
 * Score de nome.
 *
 * O que a função protege está no caso concreto: "Gabriel" casa com
 * "gabriel ramos veloso" E com "paulo gabriel chaves de araujo". A posição do
 * token é o que desempata — apelido costuma ser o PRIMEIRO nome, e quem casa no
 * meio do nome do outro perde. Quando mesmo assim sobra ambiguidade, o score cai
 * e quem decide é o valor.
 */
/** Distância de edição, limitada — só interessa saber se é 0, 1 ou "muita". */
function distancia(a, b, max = 1) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let anterior = prev[0];
    prev[0] = i;
    let melhorLinha = prev[0];
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, anterior + (a[i - 1] === b[j - 1] ? 0 : 1));
      anterior = tmp;
      melhorLinha = Math.min(melhorLinha, prev[j]);
    }
    if (melhorLinha > max) return max + 1;
  }
  return prev[b.length];
}

function scoreNome(apelido, nomeLedger) {
  const a = chaveNome(apelido);
  const tokens = chaveNome(nomeLedger).split(' ');
  if (!a || !tokens.length) return { score: 0, motivo: 'sem nome' };

  // "Igor A" é primeiro nome + inicial do sobrenome — a forma como a planilha
  // separa os dois Igors. Exigir que a inicial case com ALGUM sobrenome é o que
  // impede "Igor A" de cair no Igor Dalton.
  const partes = a.split(' ');
  if (partes.length === 2 && partes[1].length <= 2) {
    const primeiro = partes[0];
    const inicial = partes[1];
    if (tokens[0] === primeiro && tokens.slice(1).some((t) => t.startsWith(inicial))) {
      return { score: 1, motivo: `primeiro nome "${primeiro}" + inicial "${inicial}" bate com o sobrenome` };
    }
    if (tokens[0] === primeiro) return { score: 0.3, motivo: `primeiro nome bate mas nenhum sobrenome começa com "${inicial}"` };
    return { score: 0, motivo: 'nenhum token bate' };
  }

  const idx = tokens.indexOf(a);
  if (idx === 0) return { score: 1, motivo: 'primeiro nome idêntico' };
  if (idx > 0) return { score: 0.5, motivo: `token ${idx + 1} idêntico (não é o primeiro nome)` };
  // Apelido encurtado: "Evera" → "everaldo", "Dec" → "decezaris".
  if (a.length >= 3 && tokens[0].startsWith(a)) return { score: 0.75, motivo: `primeiro nome começa com "${a}"` };
  // A planilha escreve à mão: "Tawany" para Tawanny, "Dantre" para Dante,
  // "Tallany" para Tallanny. Uma letra de diferença no PRIMEIRO nome é erro de
  // digitação; duas já são outra pessoa (é o que separa Tawanny de Tallanny).
  if (a.length >= 5 && distancia(a, tokens[0]) === 1) {
    return { score: 0.85, motivo: `primeiro nome "${tokens[0]}" difere de "${a}" em uma letra` };
  }
  const p = tokens.findIndex((t) => a.length >= 4 && t.startsWith(a));
  if (p > 0) return { score: 0.35, motivo: `token ${p + 1} começa com "${a}"` };
  // Apelido que é sobrenome: "Belo" → "mateus rocha de paiva belo".
  if (tokens[tokens.length - 1] === a) return { score: 0.6, motivo: 'último sobrenome idêntico' };
  return { score: 0, motivo: 'nenhum token bate' };
}

/**
 * Score de valor: a planilha diz que a pessoa custa X; o extrato mostra X?
 *
 * Um pagamento de valor EXATAMENTE igual ao da planilha é a evidência mais
 * barata e mais forte que existe aqui — vale mais que similaridade de nome,
 * porque não há como um homônimo receber o mesmo valor por acaso todo mês.
 */
function scoreValor(esperadoCents, favorecidoLedger) {
  if (!esperadoCents) return { score: 0, motivo: 'planilha não diz valor' };
  const exato = favorecidoLedger.valores.some((v) => v === esperadoCents);
  if (exato) return { score: 1, motivo: `pagamento de ${brl(esperadoCents)} idêntico ao da planilha` };
  // O valor da planilha costuma sair em duas ou três transferências no MESMO
  // dia: o Gabriel de agosto (R$ 11.300,70) é 9.679,70 + 1.621,00 em 02/08, e o
  // Igor (R$ 8.868,60) é 5.000,00 + 3.868,60 em 01/08. Sem olhar o dia inteiro,
  // a evidência mais forte que existe passa despercebida.
  for (const doDia of Object.values(favorecidoLedger.dias)) {
    const soma = doDia.reduce((s, v) => s + v, 0);
    if (soma === esperadoCents) return { score: 1, motivo: `um dia inteiro soma exatamente ${brl(esperadoCents)}` };
    for (let i = 0; i < doDia.length; i += 1) {
      for (let j = i + 1; j < doDia.length; j += 1) {
        if (doDia[i] + doDia[j] === esperadoCents) {
          return { score: 1, motivo: `${brl(doDia[i])} + ${brl(doDia[j])} no mesmo dia = ${brl(esperadoCents)}` };
        }
      }
    }
  }
  const mensais = Object.values(favorecidoLedger.meses);
  const perto = mensais.filter((v) => Math.abs(v - esperadoCents) <= esperadoCents * 0.02);
  if (perto.length) return { score: 0.7, motivo: `${perto.length} mês(es) dentro de 2% do valor da planilha` };
  const meioPerto = mensais.filter((v) => Math.abs(v - esperadoCents) <= esperadoCents * 0.15);
  if (meioPerto.length) return { score: 0.4, motivo: `${meioPerto.length} mês(es) dentro de 15%` };
  return { score: 0, motivo: 'nenhum mês próximo do valor da planilha' };
}

/** Recorrência: quem é do time aparece todo mês. Um pagamento avulso não. */
function scoreRecorrencia(favorecidoLedger) {
  const n = meses2026.filter((m) => (favorecidoLedger.meses[m] ?? 0) > 0).length;
  return { score: Math.min(1, n / 6), motivo: `${n} de 8 meses com pagamento` };
}

/**
 * Casa uma pessoa da planilha com um favorecido do extrato.
 *
 * Peso: nome 45%, valor 35%, recorrência 20%. O nome sozinho nunca chega a 0,80
 * — de propósito. É essa aritmética que impede "Gabriel" de virar "Paulo
 * Gabriel" só porque o texto casou.
 */
function casaIdentidade(pessoa, ledger) {
  const candidatos = [];
  for (const f of ledger.porFavorecido.values()) {
    const n = scoreNome(pessoa.apelido, f.nome);
    if (n.score === 0) continue;
    const v = scoreValor(pessoa.apuradoCents ?? pessoa.fixoCents, f);
    const r = scoreRecorrencia(f);
    candidatos.push({
      favorecido: f,
      score: Number((0.45 * n.score + 0.35 * v.score + 0.2 * r.score).toFixed(3)),
      motivos: [n.motivo, v.motivo, r.motivo]
    });
  }
  candidatos.sort((a, b) => b.score - a.score);
  const melhor = candidatos[0] ?? null;
  const segundo = candidatos[1] ?? null;
  // Empate técnico é ambiguidade, e ambiguidade não se resolve sozinha.
  if (melhor && segundo && melhor.score - segundo.score < 0.1) {
    melhor.ambiguo = { com: segundo.favorecido.nome, score: segundo.score };
    melhor.score = Number((melhor.score * 0.6).toFixed(3));
    melhor.motivos.push(`ambíguo com "${segundo.favorecido.nome}" (${segundo.score}) — score penalizado`);
  }
  return { melhor, candidatos: candidatos.slice(0, 3) };
}

/**
 * Pureza da contraparte: fração dos lançamentos dela que são desta pessoa.
 *
 * Portão duro. Menos que 1,0 significa que a contraparte é um balaio — como a
 * 349, que mistura 15 pessoas — e nenhuma ligação automática acontece.
 */
function pureza(contraparteId, chavePessoa, ledger) {
  const c = ledger.porContraparte.get(contraparteId);
  if (!c || !c.total) return 0;
  return (c.porNome.get(chavePessoa) ?? 0) / c.total;
}

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------
const principal = lerAbaPrincipal();
const { projecao, contrato } = lerAbaProjecao();
const software = lerAbaSoftware();
const hardware = lerAbaHardware();

// Roster consolidado: união das abas, chaveado pelo apelido canônico.
const pessoas = new Map();
const pega = (apelido) => {
  const k = apelido.toLowerCase();
  if (!pessoas.has(k)) pessoas.set(k, { apelido, vinculo: 'indefinido', rotulos: new Set([apelido]), componentes: {}, origem: new Set() });
  return pessoas.get(k);
};
for (const r of principal.roster) {
  const p = pega(r.apelido);
  p.vinculo = r.vinculo; p.vinculoBruto = r.vinculoBruto;
  p.apuradoCents = r.apuradoCents; p.pagoCents = r.pagoCents;
  p.rotulos.add(r.apelidoBruto); p.origem.add('roster');
}
for (const c of contrato) {
  const p = pega(c.apelido);
  if (p.vinculo === 'indefinido') { p.vinculo = c.vinculo; p.vinculoBruto = c.vinculoBruto; }
  p.via = c.via; p.fixoCents = c.fixoCents;
  p.comissaoConsultoriaCents = c.comissaoConsultoriaCents;
  p.comissaoObrasCents = c.comissaoObrasCents;
  p.rotulos.add(c.apelidoBruto); p.origem.add('via-de-pagamento');
}
for (const pr of projecao) { const p = pega(pr.apelido); p.projecao = pr; p.rotulos.add(pr.apelidoBruto); p.origem.add('projecao'); }
for (const s of software) {
  const p = pega(s.apelido); p.time = 'software'; p.origem.add('time-software');
  const v = s.serie[mesNome(MES_APURACAO)];
  if (v) p.componentes[s.componente] = v;
}
for (const h of hardware) {
  const p = pega(h.apelido); p.time = 'hardware'; p.origem.add('time-hardware');
  for (const [slug, serie] of Object.entries(h.componentes)) {
    const v = serie[mesNome(MES_APURACAO)];
    if (v) p.componentes[slug] = v;
  }
}
function mesNome(iso) {
  return ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'][Number(iso.slice(5, 7)) - 1];
}

const pool = financePool();
const client = await pool.connect();
const relatorio = [];
const log = (...t) => { const l = t.join(' '); relatorio.push(l); console.log(l); };

try {
  await client.query('BEGIN');

  const { rows: ents } = await client.query(`SELECT id FROM fin_entity WHERE slug = $1`, [ENTITY_SLUG]);
  if (!ents.length) throw new Error(`entidade '${ENTITY_SLUG}' não encontrada`);
  const entityId = Number(ents[0].id);

  const ledger = await lerLedger(client, entityId);
  const { rows: existentes } = await client.query(
    `SELECT id, name, normalized_name, employment_type, counterparty_id FROM fin_person WHERE entity_id = $1`,
    [entityId]
  );
  const porNomeNormalizado = new Map(existentes.map((p) => [p.normalized_name, p]));

  /**
   * Acha a linha que JÁ existe para esta pessoa.
   *
   * A semente de 0012 usou os rótulos da aba de reembolso, que não são os mesmos
   * da aba de comissionamento: lá está "Decézaris", aqui está "Dec". Sem esta
   * resolução o script cria uma segunda linha para a mesma pessoa — e a partir
   * daí o custo dela sai dividido em dois cadastros para sempre.
   *
   * O prefixo só vale numa direção (o nome guardado começa pelo apelido) e só se
   * for ÚNICO. A direção contrária casaria "Igor A" com "Igor", que são as duas
   * pessoas diferentes que este import existe para separar.
   */
  const resolveExistente = (apelido) => {
    const norm = normalizeName(apelido);
    const exato = porNomeNormalizado.get(norm);
    if (exato) return { linha: exato, como: 'nome normalizado idêntico' };
    if (norm.length < 3) return { linha: null, como: null };
    const prefixo = existentes.filter((p) => p.normalized_name.startsWith(norm));
    if (prefixo.length === 1) return { linha: prefixo[0], como: `cadastro existente "${prefixo[0].name}" começa por "${norm}"` };
    return { linha: null, como: null };
  };
  const usados = new Set();

  log(`# import-pessoas — ${APLICAR ? 'APLICANDO' : 'DRY-RUN (nada é gravado)'}`);
  log('');
  log(`abas lidas em ${DIR}`);
  log(`pessoas no roster consolidado: ${pessoas.size}`);
  log(`favorecidos distintos no extrato: ${ledger.porFavorecido.size}`);
  log(`duplicata do lote inter_csv de março descartada: ${brl(ledger.duplicataMarco)}`);
  log('');

  const resultados = [];
  for (const p of pessoas.values()) {
    const { melhor, candidatos } = casaIdentidade(p, ledger);
    const r = { pessoa: p, melhor, candidatos, links: [], pendencias: [] };

    if (!melhor || melhor.score < 0.45) {
      r.pendencias.push(melhor
        ? `identidade fraca (${melhor.score}) — melhor palpite "${melhor.favorecido.nome}"`
        : 'nenhum favorecido do extrato parece com este apelido');
    }

    if (melhor && melhor.score >= 0.45) {
      // Documento: vem da contraparte que o extrato já carrega, nunca inventado.
      for (const [cpId] of melhor.favorecido.contrapartes) {
        const cp = ledger.contrapartes.get(Number(cpId));
        if (!cp) continue;
        const pur = pureza(Number(cpId), melhor.favorecido.chave, ledger);
        const conf = Number((melhor.score * pur).toFixed(3));
        const aplicavel = conf >= LIMIAR && pur >= 0.999;
        r.links.push({
          counterparty_id: Number(cpId),
          nomeContraparte: cp.name,
          documento: cp.document_number,
          tipoDocumento: cp.document_type,
          pureza: Number(pur.toFixed(3)),
          confidence: conf,
          aplicavel,
          motivos: melhor.motivos
        });
        if (!aplicavel) {
          r.pendencias.push(
            pur < 0.999
              ? `contraparte ${cpId} ("${cp.name}") mistura ${ledger.porContraparte.get(Number(cpId)).porNome.size} favorecidos — pureza ${(pur * 100).toFixed(0)}%; ligação não aplicada`
              : `confiança ${conf} abaixo do limiar ${LIMIAR}`
          );
        }
      }
      if (!melhor.favorecido.contrapartes.size) {
        r.pendencias.push('favorecido existe no extrato mas nenhum lançamento dele tem contraparte cadastrada');
      }
    }
    resultados.push(r);
  }

  // ---------------------------------------------------------------- gravação
  let inseridas = 0; let atualizadas = 0; let ligacoes = 0; let propostas = 0; let comps = 0;
  for (const r of resultados) {
    const p = r.pessoa;
    const legal = r.melhor && r.melhor.score >= 0.45 ? r.melhor.favorecido.nome : null;
    const nomeNorm = normalizeName(p.apelido);
    const { linha: existente, como } = resolveExistente(p.apelido);
    if (existente) {
      usados.add(existente.normalized_name);
      if (como !== 'nome normalizado idêntico') r.reaproveitou = como;
    }
    const nucleo = p.via === 'consultoria' ? 'consultoria' : p.via === 'obras' ? 'obras' : null;

    // Documento só entra quando a ligação é aplicável — CPF preso na pessoa
    // errada é o dano que este script existe para não causar.
    const linkBom = r.links.find((l) => l.aplicavel);
    const cpf = linkBom && linkBom.tipoDocumento === 'cpf' ? linkBom.documento : null;
    const cnpj = linkBom && linkBom.tipoDocumento === 'cnpj' ? linkBom.documento : null;

    let personId = existente?.id ?? null;
    if (APLICAR) {
      if (personId) {
        await client.query(
          `UPDATE fin_person
              SET employment_type = $2, legal_name = COALESCE($3, legal_name), area = COALESCE($4, area),
                  default_nucleo = COALESCE($5, default_nucleo), cpf = COALESCE(cpf, $6), cnpj = COALESCE(cnpj, $7),
                  notes = $8
            WHERE id = $1`,
          [personId, p.vinculo, legal, p.time ?? null, nucleo, cpf, cnpj, notaDe(p, r)]
        );
        atualizadas += 1;
      } else {
        const { rows } = await client.query(
          `INSERT INTO fin_person (entity_id, name, normalized_name, legal_name, employment_type, area, default_nucleo, cpf, cnpj, status, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ativo',$10)
           ON CONFLICT (entity_id, normalized_name) DO UPDATE SET employment_type = EXCLUDED.employment_type
           RETURNING id`,
          [entityId, p.apelido, nomeNorm, legal, p.vinculo, p.time ?? null, nucleo, cpf, cnpj, notaDe(p, r)]
        );
        personId = Number(rows[0].id);
        inseridas += 1;
      }
    }

    for (const l of r.links) {
      if (APLICAR && personId) {
        await client.query(
          `INSERT INTO fin_person_counterparty (entity_id, person_id, counterparty_id, is_primary, confidence, method, status, evidence, confirmed_by, confirmed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (person_id, counterparty_id) DO UPDATE SET
             confidence = EXCLUDED.confidence,
             evidence = EXCLUDED.evidence,
             -- Decisão humana vence a reimportação, nos dois sentidos.
             status = CASE WHEN fin_person_counterparty.confirmed_by IS NOT NULL
                             AND fin_person_counterparty.confirmed_by <> 'import-pessoas'
                           THEN fin_person_counterparty.status ELSE EXCLUDED.status END`,
          [entityId, personId, l.counterparty_id, l === linkBom, l.confidence,
            l.documento ? 'documento' : 'nome_token',
            l.aplicavel ? 'confirmado' : 'proposto',
            JSON.stringify({ nomeLedger: r.melhor?.favorecido.nome, pureza: l.pureza, motivos: l.motivos, documento: l.documento }),
            l.aplicavel ? 'import-pessoas' : null, l.aplicavel ? new Date().toISOString() : null]
        );
      }
      if (l.aplicavel) ligacoes += 1; else propostas += 1;
    }

    // Remuneração contratada (aba de via de pagamento) e apurada (roster/times).
    const linhas = [];
    if (p.fixoCents) linhas.push(['fixo', 'contratado', p.fixoCents, nucleo]);
    if (p.comissaoConsultoriaCents) linhas.push(['comissao_consultoria', 'contratado', p.comissaoConsultoriaCents, 'consultoria']);
    if (p.comissaoObrasCents) linhas.push(['comissao_obras', 'contratado', p.comissaoObrasCents, 'obras']);
    for (const [slug, valor] of Object.entries(p.componentes)) linhas.push([slug, 'apurado', valor, nucleo]);
    // O roster traz o total do mês. Só vira linha 'apurado' de fixo quando a
    // pessoa não tem decomposição por componente — senão o total dobraria.
    if (p.apuradoCents && !Object.keys(p.componentes).length) linhas.push(['fixo', 'apurado', p.apuradoCents, nucleo]);

    for (const [slug, kind, valor, nuc] of linhas) {
      if (APLICAR && personId) {
        await client.query(
          `INSERT INTO fin_person_compensation (entity_id, person_id, reference_month, component, kind, amount_cents, nucleo, source)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (person_id, reference_month, component, kind) DO UPDATE SET
             amount_cents = EXCLUDED.amount_cents, nucleo = EXCLUDED.nucleo, source = EXCLUDED.source`,
          [entityId, personId, MES_APURACAO, slug, kind, valor, nuc, FONTE]
        );
      }
      comps += 1;
    }
  }

  // ------------------------------------------------------------- relatórios
  log('## Roster consolidado');
  log('');
  log('| apelido | vínculo | time | via | fixo | com. consult. | com. obras | apurado ago | nome no extrato | conf. |');
  log('|---|---|---|---|---|---|---|---|---|---|');
  for (const r of resultados.sort((a, b) => (b.pessoa.apuradoCents ?? 0) - (a.pessoa.apuradoCents ?? 0))) {
    const p = r.pessoa;
    log(`| ${p.apelido} | ${p.vinculo} | ${p.time ?? '—'} | ${p.via ?? '—'} | ${p.fixoCents ? brl(p.fixoCents) : '—'} | ` +
      `${p.comissaoConsultoriaCents ? brl(p.comissaoConsultoriaCents) : '—'} | ${p.comissaoObrasCents ? brl(p.comissaoObrasCents) : '—'} | ` +
      `${p.apuradoCents ? brl(p.apuradoCents) : '—'} | ${r.melhor && r.melhor.score >= 0.45 ? r.melhor.favorecido.nome : '—'} | ` +
      `${r.melhor ? r.melhor.score : '—'} |`);
  }
  log('');

  const alta = resultados.filter((r) => r.links.some((l) => l.aplicavel));
  const baixa = resultados.filter((r) => !r.links.some((l) => l.aplicavel) && r.links.length);
  const sem = resultados.filter((r) => !r.links.length);
  log('## Ligação pessoa ↔ contraparte');
  log('');
  log(`- alta confiança (ligada automaticamente, ≥ ${LIMIAR} e contraparte pura): **${alta.length}**`);
  log(`- baixa confiança (proposta, aguarda humano): **${baixa.length}**`);
  log(`- sem nenhuma contraparte candidata: **${sem.length}**`);
  log('');
  for (const r of resultados) {
    for (const l of r.links) {
      log(`- ${r.pessoa.apelido} → cp#${l.counterparty_id} "${l.nomeContraparte}" doc=${l.documento ?? '—'} ` +
        `pureza=${(l.pureza * 100).toFixed(0)}% conf=${l.confidence} ${l.aplicavel ? '✔ aplicada' : '✋ proposta'}`);
    }
  }
  log('');

  log('## Pendências humanas');
  log('');
  log('| pessoa | o que está em aberto | pergunta para o dono |');
  log('|---|---|---|');
  for (const r of resultados) {
    for (const p of r.pendencias) {
      log(`| ${r.pessoa.apelido} | ${p} | ${pergunta(r, p)} |`);
    }
  }
  // Cadastro que existia antes e nenhuma linha da planilha reivindicou.
  for (const e of existentes) {
    if (usados.has(e.normalized_name)) continue;
    log(`| ${e.name} (cadastro antigo) | está em fin_person desde a semente de 0012 e nenhum rótulo da planilha ` +
      `aponta para ele | "${e.name}" é quem? É a mesma pessoa que algum nome do roster (o único sobrenome Alves do ` +
      `time é o Igor Alves Cordeiro), ou é alguém que saiu? |`);
  }
  // Favorecidos recorrentes que a planilha não conhece.
  const conhecidos = new Set(resultados.filter((r) => r.melhor && r.melhor.score >= 0.45).map((r) => r.melhor.favorecido.chave));
  for (const f of [...ledger.porFavorecido.values()].sort((a, b) => b.total - a.total)) {
    if (conhecidos.has(f.chave)) continue;
    const nMeses = meses2026.filter((m) => (f.meses[m] ?? 0) > 0).length;
    if (nMeses < 3 || f.total < 100000) continue; // ruído: avulso ou de valor irrelevante
    log(`| (fora da planilha) | "${f.nome}" recebeu ${brl(f.total)} em ${nMeses} meses e não existe em nenhuma aba | ` +
      `Quem é ${f.nome}? É do time (e qual vínculo), é fornecedor, ou é repasse? |`);
  }
  log('');

  log(`resumo: ${inseridas} pessoa(s) inserida(s), ${atualizadas} atualizada(s), ` +
    `${ligacoes} ligação(ões) aplicada(s), ${propostas} proposta(s), ${comps} linha(s) de remuneração.`);

  if (APLICAR) {
    await client.query('COMMIT');
    log('COMMIT — gravado.');
  } else {
    await client.query('ROLLBACK');
    log('ROLLBACK — dry-run, nada foi gravado. Use --apply para gravar.');
  }
} catch (erro) {
  await client.query('ROLLBACK');
  console.error('[pessoas]', erro.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
  if (RELATORIO) writeFileSync(RELATORIO, relatorio.join('\n'));
}

/** Nota de cadastro: guarda de onde a pessoa veio e o que ficou em aberto. */
function notaDe(p, r) {
  const partes = [`abas: ${[...p.origem].join(', ')}`, `rótulos: ${[...p.rotulos].join(' / ')}`];
  if (r.melhor && r.melhor.score >= 0.45) partes.push(`extrato: ${r.melhor.favorecido.nome} (score ${r.melhor.score})`);
  if (r.pendencias.length) partes.push(`pendências: ${r.pendencias.length}`);
  return partes.join(' | ');
}

/** A pergunta exata a fazer — pendência sem pergunta vira pendência eterna. */
function pergunta(r, texto) {
  const n = r.pessoa.apelido;
  if (texto.startsWith('nenhum favorecido')) return `Qual o nome completo de "${n}" no extrato bancário? Ele recebe por CPF ou por CNPJ de MEI?`;
  if (texto.startsWith('identidade fraca')) return `"${n}" é a mesma pessoa que "${r.melhor.favorecido.nome}"? Se não, quem é?`;
  if (texto.includes('mistura')) return `Confirma que "${n}" é ${r.melhor?.favorecido.nome ?? '?'}? A contraparte do ledger está com nome de banco e precisa ser separada antes de ligar.`;
  if (texto.includes('abaixo do limiar')) return `Confirma a ligação de "${n}" com ${r.melhor?.favorecido.nome ?? '?'}?`;
  if (texto.includes('nenhum lançamento dele tem contraparte')) return `"${n}" recebe por qual conta? Nenhum pagamento a ele tem contraparte cadastrada.`;
  return `Revisar "${n}".`;
}

// Traz os valores da planilha do dono como REFERÊNCIA congelada.
//
// O que este script faz e o que deliberadamente não faz:
//
// FAZ  copiar, mês a mês, o número que uma aba da planilha mostra hoje, e
//      gravá-lo como `procedencia='referencia'`. Vira o lado direito da tela:
//      "o ledger diz X, sua planilha diz Y".
//
// NÃO FAZ tocar em `procedencia='manual'`. O que o dono digita na tela é dele;
//      uma reimportação da planilha não pode apagar uma decisão tomada depois.
//      A chave única separa as duas procedências justamente para isto.
//
// POR QUE CONGELAR EM VEZ DE LER A PLANILHA TODA VEZ
//
// A planilha é editada por pessoas enquanto a plataforma roda. Comparar contra
// um alvo móvel produz divergências que aparecem e somem sozinhas, e ninguém
// consegue investigar. Uma foto datada é comparável: quando o número muda, o
// `updated_at` diz quando, e reimportar é uma decisão explícita.
//
// A ORIGEM DOS DADOS é a coluna `origem_linha` de `fin_model_line` — a linha da
// planilha de onde a estrutura veio. Linha sem `origem_linha` é linha que o
// ledger tem e a planilha não; ela simplesmente não recebe referência.
//
// POR QUE O RÓTULO É CONFERIDO ANTES DE GRAVAR  (16/08/2026)
//
// `origem_linha` é um NÚMERO DE LINHA, e número de linha não sobrevive a uma
// edição da planilha: basta inserir uma linha no topo para que tudo abaixo
// deslize. Este workbook prova o mecanismo — "Projeção Base", "Projeção Biel" e
// "Projeção Biel Ajustada" são três gerações do mesmo modelo, e entre a
// primeira e a segunda os rótulos já andaram duas linhas para baixo.
//
// A versão anterior deste script confiava no número cegamente. Apontada para a
// aba errada, ela não falharia: leria a linha 10 ("Monitor BT - Monofásico 50A"
// no modelo) e gravaria o que estivesse na linha 10 da aba — em "Resumão Geral"
// isso é "Bra", R$ 20.501/mês. O número entraria, a tela mostraria, e ninguém
// desconfiaria, porque um número existe.
//
// Por isso a conferência de rótulo é OBRIGATÓRIA e não tem flag para desligar:
// só recebe referência a linha cujo rótulo na planilha é igual ao nome no
// modelo. Divergiu, a linha fica sem par e aparece no relatório. É a diferença
// entre "não sei" declarado e um número inventado.
//
// Uso:
//   node scripts/import-modelo-referencia.mjs <arquivo.xlsx>                 # lista as abas
//   node scripts/import-modelo-referencia.mjs <arquivo.xlsx> --aba "<nome>"  # dry-run
//   node scripts/import-modelo-referencia.mjs <arquivo.xlsx> --aba "<nome>" --aplicar
//
// Opcionais: --ano 2026 · --col-rotulo C · --col-mes1 E  (default: detectados)
import { readFileSync } from 'node:fs';
import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';

loadEnv();

const arg = (nome) => {
  const i = process.argv.indexOf(nome);
  return i === -1 ? null : process.argv[i + 1];
};

const APLICAR = process.argv.includes('--aplicar');
const ARQUIVO = process.argv[2];
const ANO = Number(arg('--ano')) || 2026;
const ABA = arg('--aba');
const COL_ROTULO = arg('--col-rotulo');
const COL_MES1 = arg('--col-mes1');
const ENTIDADE = 'xpe';

// Abaixo disto, o alinhamento entre modelo e aba é ruído: gravar seria inventar.
const MINIMO_ALINHADO = 0.5;

if (!ARQUIVO || ARQUIVO.startsWith('--')) {
  console.error('uso: node scripts/import-modelo-referencia.mjs <arquivo.xlsx> --aba "<nome>" [--ano 2026] [--aplicar]');
  process.exit(1);
}

const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Coluna do Excel (A, B, ..., AA) para índice 0-based, e a volta. */
const coluna = (ref) => {
  const letras = ref.match(/^[A-Z]+/)[0];
  let n = 0;
  for (const ch of letras) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};
const letraColuna = (i) => {
  let s = '';
  let n = i + 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
};

const desescapar = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
  .replace(/&amp;/g, '&');

/**
 * Compara rótulo da planilha com nome do modelo ignorando acento, caixa e
 * pontuação — "Jurídico e Contábil" e "JURIDICO E CONTABIL" são a mesma linha.
 * Não faz correspondência aproximada de propósito: parecido não é igual, e
 * ligar linha por semelhança de texto é o erro que este guarda existe para
 * impedir.
 */
const normalizar = (s) => (s ?? '')
  .toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

/**
 * Lê um .xlsx sem dependência nova.
 *
 * Um .xlsx é um zip de XML. O projeto não tem biblioteca de planilha e trazer
 * uma para ler um arquivo uma vez por trimestre é peso desproporcional — este
 * leitor cobre exatamente o que a aba usa: células numéricas, strings
 * compartilhadas (que são os rótulos, necessários para conferir a linha) e o
 * resultado em cache das fórmulas (`<v>`), que é o que interessa. Fórmula sem
 * cache vira null, e null não sobrescreve nada.
 */
async function abrirPlanilha(caminho) {
  const buf = readFileSync(caminho);
  const arquivos = await descompactar(buf);

  const wb = arquivos.get('xl/workbook.xml');
  const rels = arquivos.get('xl/_rels/workbook.xml.rels');
  if (!wb || !rels) throw new Error('não parece um .xlsx: falta xl/workbook.xml');

  const relAlvo = new Map([...rels.matchAll(/Id="(rId\d+)"[^>]*Target="([^"]+)"/g)].map((m) => [m[1], m[2]]));

  // `state="hidden"` faz parte do inventário: aba escondida é decisão de alguém,
  // e apontar o importador para uma delas sem saber disso é começar errado.
  const abas = [...wb.matchAll(/<sheet\s([^>]*?)\/?>/g)].map((m) => ({
    nome: desescapar(m[1].match(/name="([^"]*)"/)?.[1] ?? ''),
    rid: m[1].match(/r:id="(rId\d+)"/)?.[1],
    estado: m[1].match(/state="([^"]*)"/)?.[1] ?? 'visible',
  })).filter((a) => a.rid);

  // Cada <si> pode vir quebrado em vários <t> (rich text); junta todos.
  const ss = arquivos.get('xl/sharedStrings.xml') ?? '';
  const textos = [...ss.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    desescapar([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''))
  );

  return { arquivos, relAlvo, abas, textos };
}

/** Devolve `numeros` (Map "linha:col" → número) e `rotulos` (Map "linha:col" → texto). */
function lerAba(pack, nomeAba) {
  const aba = pack.abas.find((a) => a.nome === nomeAba);
  if (!aba) {
    throw new Error(`aba "${nomeAba}" não existe. Disponíveis: ${pack.abas.map((a) => a.nome).join(', ')}`);
  }
  let alvo = pack.relAlvo.get(aba.rid) ?? '';
  alvo = alvo.startsWith('/') ? alvo.slice(1) : `xl/${alvo}`;
  const xml = pack.arquivos.get(alvo);
  if (!xml) throw new Error(`planilha ${alvo} ausente do pacote`);

  const numeros = new Map();
  const rotulos = new Map();

  // Célula vazia é gravada auto-fechada: `<c r="L33" s="5"/>`. Tratá-la como
  // abertura faz o `</c>` seguinte fechá-la, e ela ROUBA o valor da próxima
  // célula — foi assim que agosto ganhou uma receita de R$ 96,00 que a planilha
  // não tem. Por isso as duas formas são distinguidas aqui em vez de um
  // `[\s\S]*?` otimista.
  for (const m of xml.matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attrs = m[1];
    const corpo = m[2];
    if (corpo === undefined) continue; // auto-fechada: sem valor, por definição
    const ref = attrs.match(/r="([A-Z]+\d+)"/)?.[1];
    if (!ref) continue;
    const tipo = attrs.match(/t="([^"]*)"/)?.[1] ?? 'n';
    const v = corpo.match(/<v>([\s\S]*?)<\/v>/)?.[1];
    const chave = `${Number(ref.match(/\d+$/)[0])}:${coluna(ref)}`;

    if (tipo === 's') {
      if (v !== undefined) rotulos.set(chave, textoOuNulo(pack.textos[Number(v)]));
      continue;
    }
    if (tipo === 'inlineStr') {
      rotulos.set(chave, textoOuNulo(desescapar(corpo.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? '')));
      continue;
    }
    if (tipo === 'str') { if (v !== undefined) rotulos.set(chave, textoOuNulo(desescapar(v))); continue; }
    // `t="e"` é erro (#REF!, #DIV/0!): não é número nem rótulo.
    if (tipo === 'e') continue;
    if (v === undefined) continue;
    const num = Number(v);
    if (!Number.isFinite(num)) continue;
    numeros.set(chave, num);
  }
  return { numeros, rotulos, estado: aba.estado };
}

const textoOuNulo = (s) => (s && s.trim() ? s.trim() : null);

/** Descompacta um zip com `DecompressionStream('deflate-raw')` — nativo no Node 22. */
function descompactar(buf) {
  const saida = new Map();
  // Ler pelo diretório central em vez de varrer cabeçalhos locais: é o único
  // lugar do zip onde o tamanho comprimido é confiável antes de descomprimir.
  let fim = buf.length - 22;
  while (fim >= 0 && buf.readUInt32LE(fim) !== 0x06054b50) fim -= 1;
  if (fim < 0) throw new Error('zip sem diretório central: arquivo corrompido ou não é .xlsx');

  const total = buf.readUInt16LE(fim + 10);
  let p = buf.readUInt32LE(fim + 16);
  const pendentes = [];

  for (let i = 0; i < total; i += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const metodo = buf.readUInt16LE(p + 10);
    const tamComp = buf.readUInt32LE(p + 20);
    const nomeLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const comentLen = buf.readUInt16LE(p + 32);
    const desloc = buf.readUInt32LE(p + 42);
    const nome = buf.toString('utf8', p + 46, p + 46 + nomeLen);

    // No cabeçalho local os campos de nome/extra têm tamanhos próprios.
    const lNomeLen = buf.readUInt16LE(desloc + 26);
    const lExtraLen = buf.readUInt16LE(desloc + 28);
    const inicio = desloc + 30 + lNomeLen + lExtraLen;
    const dados = buf.subarray(inicio, inicio + tamComp);

    if (nome.endsWith('.xml') || nome.endsWith('.rels')) {
      pendentes.push(metodo === 0 ? Promise.resolve([nome, dados.toString('utf8')]) : inflar(nome, dados));
    }
    p += 46 + nomeLen + extraLen + comentLen;
  }
  return Promise.all(pendentes).then((rs) => {
    rs.forEach(([n, c]) => saida.set(n, c));
    return saida;
  });
}

async function inflar(nome, dados) {
  const fluxo = new Blob([dados]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return [nome, await new Response(fluxo).text()];
}

const MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/**
 * Onde começa janeiro. Cada aba deste workbook escolheu uma coluna diferente
 * ("Resumão Geral" põe janeiro em D, "Projeção Biel Ajustada" em E), e errar
 * por uma coluna importa fevereiro no lugar de janeiro sem acusar nada — o
 * total do ano só muda um pouco, e "um pouco" é indistinguível de divergência
 * real. Procura primeiro o cabeçalho por nome de mês, depois a sequência 1..12.
 */
function acharColunaMes1(rotulos, numeros) {
  for (const [chave, texto] of rotulos) {
    if (normalizar(texto) !== 'janeiro') continue;
    const [linha, col] = chave.split(':').map(Number);
    const seguintes = MESES.slice(1, 4).every((m, i) => normalizar(rotulos.get(`${linha}:${col + i + 1}`)) === m);
    if (seguintes) return { col, como: `cabeçalho "Janeiro" em ${letraColuna(col)}${linha}` };
  }
  for (const [chave, valor] of numeros) {
    if (valor !== 1) continue;
    const [linha, col] = chave.split(':').map(Number);
    const seguidos = [2, 3, 4, 5].every((n, i) => numeros.get(`${linha}:${col + i + 1}`) === n);
    if (seguidos && numeros.get(`${linha}:${col + 11}`) === 12) {
      return { col, como: `sequência 1..12 em ${letraColuna(col)}${linha}` };
    }
  }
  return null;
}

/** A coluna em que a aba escreve os rótulos: a que mais texto tem. */
function acharColunaRotulo(rotulos) {
  const contagem = new Map();
  for (const chave of rotulos.keys()) {
    const col = Number(chave.split(':')[1]);
    contagem.set(col, (contagem.get(col) ?? 0) + 1);
  }
  const melhor = [...contagem.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  return melhor ? melhor[0] : 0;
}

const pack = await abrirPlanilha(ARQUIVO);

// Sem --aba não há default: o default anterior era 'Fluxo de Caixa', uma aba que
// não existe neste arquivo, e adivinhar a substituta pelo nome é exatamente o
// que não se deve fazer. Lista e sai.
if (!ABA) {
  console.log(`\nAbas de ${ARQUIVO}:\n`);
  for (const a of pack.abas) {
    const { numeros, rotulos } = lerAba(pack, a.nome);
    const mes1 = acharColunaMes1(rotulos, numeros);
    console.log(`  ${a.estado === 'hidden' ? 'OCULTA ' : '       '}${a.nome.padEnd(26)}${String(numeros.size).padStart(5)} números ${String(rotulos.size).padStart(4)} rótulos   ${mes1 ? `mês 1 em ${letraColuna(mes1.col)}` : 'sem eixo mensal'}`);
  }
  console.log('\nEscolha uma com --aba "<nome>". Nada foi lido do banco.\n');
  process.exit(0);
}

const pool = financePool();
const client = await pool.connect();

// Só desfaz o que chegou a começar. Um `ROLLBACK` sem `BEGIN` é apenas um aviso
// numa conexão comum, mas o teste de idempotência traduz o vocabulário de
// transação para savepoints — e `ROLLBACK TO SAVEPOINT` sem savepoint é erro.
// A conferência de rótulo aborta ANTES do `BEGIN`, então esse caminho existe.
let emTransacao = false;
const desfazer = async () => {
  if (!emTransacao) return;
  emTransacao = false;
  await client.query('ROLLBACK');
};

try {
  const { numeros, rotulos, estado } = lerAba(pack, ABA);

  const colRotulo = COL_ROTULO ? coluna(`${COL_ROTULO}1`) : acharColunaRotulo(rotulos);
  const detectado = acharColunaMes1(rotulos, numeros);
  const colMes1 = COL_MES1 ? coluna(`${COL_MES1}1`) : detectado?.col;
  if (colMes1 === undefined || colMes1 === null) {
    throw new Error(`não achei o eixo mensal em "${ABA}". Informe --col-mes1 <letra> se a aba tiver um.`);
  }

  console.log(`\nAba "${ABA}"${estado === 'hidden' ? '  [OCULTA na planilha]' : ''}`);
  console.log(`  rótulos na coluna ${letraColuna(colRotulo)}`);
  console.log(`  mês 1 na coluna ${letraColuna(colMes1)}${COL_MES1 ? ' (informado)' : ` (${detectado.como})`}`);

  const { rows: [ent] } = await client.query(`SELECT id FROM fin_entity WHERE slug = $1`, [ENTIDADE]);
  const { rows: linhas } = await client.query(
    `SELECT slug, name, origem_linha, kind, section FROM fin_model_line
      WHERE entity_id = $1 AND origem_linha IS NOT NULL AND is_active
      ORDER BY sort_order`,
    [ent.id]
  );

  // ── Conferência de rótulo, antes de qualquer escrita ────────────────────────
  const pareadas = [];
  const trocadas = [];
  const ausentes = [];
  for (const L of linhas) {
    const rot = rotulos.get(`${L.origem_linha}:${colRotulo}`);
    if (rot === undefined || rot === null) ausentes.push(L);
    else if (normalizar(rot) === normalizar(L.name)) pareadas.push(L);
    else trocadas.push({ ...L, rotulo: rot });
  }

  const taxa = linhas.length ? pareadas.length / linhas.length : 0;
  console.log(`\n  linhas do modelo com origem_linha: ${linhas.length}`);
  console.log(`    rótulo confere:        ${String(pareadas.length).padStart(3)}`);
  console.log(`    rótulo diferente:      ${String(trocadas.length).padStart(3)}   ← a linha existe na aba, mas é outra coisa`);
  console.log(`    linha sem rótulo:      ${String(ausentes.length).padStart(3)}   ← a aba não chega lá, ou a célula é vazia`);
  console.log(`    alinhamento: ${(taxa * 100).toFixed(1)}%`);

  if (trocadas.length) {
    console.log('\n  amostra do desencontro (modelo → o que a aba tem naquela linha):');
    trocadas.slice(0, 12).forEach((t) => console.log(
      `    linha ${String(t.origem_linha).padStart(3)}  ${t.name.slice(0, 40).padEnd(42)} → "${t.rotulo.slice(0, 34)}"`
    ));
  }

  if (taxa < MINIMO_ALINHADO) {
    console.log(`\n  ABORTADO: alinhamento abaixo de ${(MINIMO_ALINHADO * 100).toFixed(0)}%. Nada gravado, nada apagado.`);
    console.log('  Esta aba não é a origem desta estrutura de linhas. Importar por número');
    console.log('  de linha aqui gravaria o valor de uma conta no nome de outra.\n');
    await desfazer();
    process.exitCode = 2;
  } else {
    await client.query('BEGIN');
    emTransacao = true;

    let gravadas = 0;
    let vazias = 0;
    const porLinha = [];

    for (const L of pareadas) {
      // Subtotal e calculado não recebem referência: eles são a soma dos filhos.
      // Importar o subtotal da planilha ao lado dos filhos dela criaria duas
      // verdades para a mesma célula, e a primeira divergência entre elas seria
      // indistinguível de um erro do ledger.
      if (L.kind !== 'item') continue;

      // A planilha grava custo como número POSITIVO dentro de uma seção rotulada
      // "(-)" — o sinal mora no título, não no dado. O ledger grava o sinal no
      // próprio valor, porque foi assim que o extrato o entregou. Sem normalizar
      // aqui, comparar realizado com referência somaria −561 mil com +304 mil e
      // acusaria uma divergência de 865 mil que é pura convenção.
      const sinal = L.section === 'receita' ? 1 : -1;

      const valores = [];
      for (let mes = 1; mes <= 12; mes += 1) {
        const v = numeros.get(`${L.origem_linha}:${colMes1 + mes - 1}`);
        valores.push(v === undefined ? null : sinal * Math.round(v * 100));
      }

      const preenchidos = valores.filter((v) => v !== null && v !== 0).length;
      if (!preenchidos) { vazias += 1; continue; }

      for (let mes = 1; mes <= 12; mes += 1) {
        const cents = valores[mes - 1];
        if (cents === null) continue;
        await client.query(
          `INSERT INTO fin_model_value (entity_id, line_slug, ano, mes, procedencia, valor_cents, motivo, updated_by)
           VALUES ($1,$2,$3,$4,'referencia',$5,$6,'import-modelo-referencia')
           ON CONFLICT (entity_id, line_slug, ano, mes, procedencia)
           DO UPDATE SET valor_cents = EXCLUDED.valor_cents, motivo = EXCLUDED.motivo, updated_at = now()`,
          [ent.id, L.slug, ANO, mes, cents, `aba "${ABA}", linha ${L.origem_linha}`]
        );
        gravadas += 1;
      }
      porLinha.push({ slug: L.slug, nome: L.name, meses: preenchidos, total: valores.reduce((s, v) => s + (v ?? 0), 0) });
    }

    console.log(`\nReferência da planilha — ${ANO}\n`);
    porLinha
      .sort((a, b) => Math.abs(b.total) - Math.abs(a.total))
      .slice(0, 22)
      .forEach((r) => console.log(`  ${r.nome.slice(0, 44).padEnd(46)}${String(r.meses).padStart(3)} mês  ${brl(r.total).padStart(15)}`));

    console.log(`\n  células gravadas: ${gravadas}`);
    console.log(`  linhas com valor: ${porLinha.length}`);
    console.log(`  linhas zeradas na planilha: ${vazias}`);
    console.log(`  linhas do modelo sem par nesta aba: ${trocadas.length + ausentes.length}`);

    if (APLICAR) {
      await client.query('COMMIT');
      emTransacao = false;
      console.log('\n  COMMIT — gravado.\n');
    } else {
      await desfazer();
      console.log('\n  ROLLBACK — dry-run. Use --aplicar.\n');
    }
  }
} catch (e) {
  await desfazer();
  console.error('abortado, nada gravado:', e.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}

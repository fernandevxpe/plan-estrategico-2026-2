// Traz os valores da planilha do dono como REFERÊNCIA congelada.
//
// O que este script faz e o que deliberadamente não faz:
//
// FAZ  copiar, mês a mês, o número que a aba "Fluxo de Caixa" mostra hoje, e
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
// Uso:
//   node scripts/import-modelo-referencia.mjs <arquivo.xlsx> [--ano 2026]
//   node scripts/import-modelo-referencia.mjs <arquivo.xlsx> --aplicar
import { readFileSync } from 'node:fs';
import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';

loadEnv();

const APLICAR = process.argv.includes('--aplicar');
const ARQUIVO = process.argv[2];
const ANO = Number(process.argv[process.argv.indexOf('--ano') + 1]) || 2026;
const ABA = 'Fluxo de Caixa';
const ENTIDADE = 'xpe';

if (!ARQUIVO || ARQUIVO.startsWith('--')) {
  console.error('uso: node scripts/import-modelo-referencia.mjs <arquivo.xlsx> [--ano 2026] [--aplicar]');
  process.exit(1);
}

const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Lê um .xlsx sem dependência nova.
 *
 * Um .xlsx é um zip de XML. O projeto não tem biblioteca de planilha e trazer
 * uma para ler um arquivo uma vez por trimestre é peso desproporcional — este
 * leitor cobre exatamente o que a aba usa: células numéricas, strings
 * compartilhadas e o resultado em cache das fórmulas (`<v>`), que é o que
 * interessa. Fórmula sem cache vira null, e null não sobrescreve nada.
 */
async function lerAba(caminho, nomeAba) {
  const buf = readFileSync(caminho);
  const arquivos = await descompactar(buf);

  const wb = arquivos.get('xl/workbook.xml');
  const rels = arquivos.get('xl/_rels/workbook.xml.rels');
  if (!wb || !rels) throw new Error('não parece um .xlsx: falta xl/workbook.xml');

  const relAlvo = new Map([...rels.matchAll(/Id="(rId\d+)"[^>]*Target="([^"]+)"/g)].map((m) => [m[1], m[2]]));
  const abas = [...wb.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="(rId\d+)"/g)];
  const aba = abas.find((a) => a[1] === nomeAba);
  if (!aba) throw new Error(`aba "${nomeAba}" não existe. Disponíveis: ${abas.map((a) => a[1]).join(', ')}`);

  let alvo = relAlvo.get(aba[2]) ?? '';
  alvo = alvo.startsWith('/') ? alvo.slice(1) : `xl/${alvo}`;
  const xml = arquivos.get(alvo);
  if (!xml) throw new Error(`planilha ${alvo} ausente do pacote`);

  // Coluna do Excel (A, B, ..., AA) para índice 0-based.
  const coluna = (ref) => {
    const letras = ref.match(/^[A-Z]+/)[0];
    let n = 0;
    for (const ch of letras) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  };

  const celulas = new Map();
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
    // `t="s"` é string compartilhada; `t="e"` é erro (#REF!, #DIV/0!). Nenhum
    // dos dois é número, e é só número que este importador quer.
    if (/t="(s|e|str|inlineStr)"/.test(attrs)) continue;
    const v = corpo.match(/<v>([^<]*)<\/v>/)?.[1];
    if (v === undefined) continue;
    const num = Number(v);
    if (!Number.isFinite(num)) continue;
    celulas.set(`${Number(ref.match(/\d+$/)[0])}:${coluna(ref)}`, num);
  }
  return celulas;
}

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

const pool = financePool();
const client = await pool.connect();

try {
  const celulas = await lerAba(ARQUIVO, ABA);
  await client.query('BEGIN');

  const { rows: [ent] } = await client.query(`SELECT id FROM fin_entity WHERE slug = $1`, [ENTIDADE]);
  const { rows: linhas } = await client.query(
    `SELECT slug, name, origem_linha, kind, section FROM fin_model_line
      WHERE entity_id = $1 AND origem_linha IS NOT NULL AND is_active
      ORDER BY sort_order`,
    [ent.id]
  );

  let gravadas = 0;
  let vazias = 0;
  const porLinha = [];

  for (const L of linhas) {
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
      // Colunas E..P (índice 4..15) são janeiro..dezembro.
      const v = celulas.get(`${L.origem_linha}:${3 + mes}`);
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

  // Âncora: a soma da referência importada tem de bater com o total que a
  // planilha mostra na linha "Fontes de Receita (+)". Se não bater, algum
  // mapeamento de linha está trocado — e é melhor descobrir aqui.
  const receitaPlanilha = [];
  for (let mes = 1; mes <= 12; mes += 1) receitaPlanilha.push(celulas.get(`5:${3 + mes}`) ?? 0);
  const { rows: [somaImportada] } = await client.query(
    `SELECT COALESCE(sum(v.valor_cents),0) v
       FROM fin_model_value v
       JOIN fin_model_line l ON l.slug = v.line_slug AND l.entity_id = v.entity_id
      WHERE v.entity_id = $1 AND v.ano = $2 AND v.procedencia = 'referencia' AND l.section = 'receita'`,
    [ent.id, ANO]
  );
  const alvo = Math.round(receitaPlanilha.reduce((s, v) => s + v, 0) * 100);
  const dif = Number(somaImportada.v) - alvo;
  console.log(`\n  receita importada:            ${brl(somaImportada.v).padStart(15)}`);
  console.log(`  "Fontes de Receita (+)":      ${brl(alvo).padStart(15)}`);
  console.log(`  diferença:                    ${brl(dif).padStart(15)}${dif === 0 ? '  ✓' : '  ← itens fora dos subtotais da planilha'}`);

  if (APLICAR) {
    await client.query('COMMIT');
    console.log('\n  COMMIT — gravado.\n');
  } else {
    await client.query('ROLLBACK');
    console.log('\n  ROLLBACK — dry-run. Use --aplicar.\n');
  }
} catch (e) {
  await client.query('ROLLBACK');
  console.error('abortado, nada gravado:', e.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}

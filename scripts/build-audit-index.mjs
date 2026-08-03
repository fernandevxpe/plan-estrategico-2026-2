// Indexa reports/auditorias/*.md para a plataforma conseguir listar e renderizar
// as auditorias sem ler o disco em runtime. Cada auditoria é um arquivo com
// frontmatter; o índice preserva a ordem cronológica inversa.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { rawDirUrl, processedDirUrl, ensureDataDirs } from './lib/paths.mjs';
ensureDataDirs();

const auditDir = new URL('../reports/auditorias/', import.meta.url);
const outDir = processedDirUrl;

/** Frontmatter YAML simples: escalares, listas com "- " e blocos de texto. */
function parseFrontmatter(source) {
  if (!source.startsWith('---')) return { meta: {}, body: source };
  const end = source.indexOf('\n---', 3);
  if (end === -1) return { meta: {}, body: source };

  const rawMeta = source.slice(4, end);
  const body = source.slice(end + 4).replace(/^\r?\n/, '');
  const meta = {};
  let currentKey = null;

  for (const rawLine of rawMeta.split(/\r?\n/)) {
    if (!rawLine.trim()) continue;

    const listMatch = rawLine.match(/^\s+-\s+(.*)$/);
    if (listMatch && currentKey) {
      if (!Array.isArray(meta[currentKey])) meta[currentKey] = [];
      meta[currentKey].push(stripQuotes(listMatch[1].trim()));
      continue;
    }

    const kv = rawLine.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, value] = kv;
    currentKey = key;
    meta[key] = value.trim() ? stripQuotes(value.trim()) : [];
  }
  return { meta, body };
}

function stripQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/** Palavras por minuto de leitura técnica — só para dar noção de fôlego. */
const WPM = 200;

let files = [];
try {
  files = (await readdir(auditDir)).filter((name) => name.endsWith('.md')).sort().reverse();
} catch {
  files = [];
}

const audits = [];
for (const file of files) {
  const source = await readFile(new URL(file, auditDir), 'utf8');
  const { meta, body } = parseFrontmatter(source);
  const slug = file.replace(/\.md$/, '');
  const words = body.split(/\s+/).filter(Boolean).length;

  // Índice de seções para o sumário lateral.
  const sections = [];
  for (const line of body.split(/\r?\n/)) {
    const heading = line.match(/^(#{2,3})\s+(.*)$/);
    if (!heading) continue;
    const text = heading[2].replace(/[*_`]/g, '').trim();
    sections.push({
      level: heading[1].length,
      text,
      id: text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
    });
  }

  audits.push({
    slug,
    file,
    title: meta.title ?? slug,
    date: meta.date ?? slug.slice(0, 10),
    author: meta.author ?? null,
    kind: meta.kind ?? 'auditoria',
    scope: meta.scope ?? null,
    summary: meta.summary ?? '',
    highlights: Array.isArray(meta.highlights) ? meta.highlights : [],
    words,
    readingMinutes: Math.max(1, Math.round(words / WPM)),
    sections,
    body
  });
}

audits.sort((a, b) => b.date.localeCompare(a.date) || b.slug.localeCompare(a.slug));

const index = {
  generatedAt: new Date().toISOString(),
  total: audits.length,
  latest: audits[0]?.slug ?? null,
  audits
};

await writeFile(new URL('audit-index.json', outDir), JSON.stringify(index, null, 2));
console.log(
  `Índice de auditorias gerado: ${audits.length} registro(s) → data/processed/audit-index.json`
);
for (const audit of audits) {
  console.log(`  ${audit.date} · ${audit.title} (${audit.readingMinutes} min)`);
}

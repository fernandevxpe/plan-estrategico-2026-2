import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function loadEnv(file = '.env.local') {
  const candidates = [resolve(process.cwd(), file), resolve(projectRoot, file)];
  const path = candidates.find((p) => existsSync(p));
  if (!path) return {};

  const env = {};
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const equals = line.indexOf('=');
    if (equals === -1) continue;

    const key = line.slice(0, equals).trim();
    let value = line.slice(equals + 1).trim();

    if (value.startsWith('#')) value = '';
    const hash = value.indexOf(' #');
    if (hash !== -1) value = value.slice(0, hash).trim();
    if (
      (value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"'))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
    // O ambiente herdado vence o arquivo — no Railway a variável do painel é a
    // verdadeira e o `.env.local` nem existe. Mas string VAZIA não é valor
    // herdado: é valor perdido, e `key in process.env` não sabe a diferença.
    //
    // Medido em 01/09/2026: `ASAAS_API_KEY` começa com `$aact_`, o loader do
    // Next trata `$` como interpolação e esvazia a variável no processo do
    // servidor. `sincronizar-fontes.mjs` spawna as etapas com `env: process.env`,
    // então a chave chegava PRESENTE e VAZIA em `sync-asaas.mjs`, o `in` dava
    // true, o arquivo não era consultado e a etapa morria em "ASAAS_API_KEY
    // ausente em .env.local" — com a chave inteira ali no arquivo. Era o botão
    // de atualizar do cabeçalho falhando por um `$`.
    if (!process.env[key]) process.env[key] = value;
  }

  return env;
}

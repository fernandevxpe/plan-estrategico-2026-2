import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export function loadEnv(file = '.env.local') {
  const path = resolve(file);
  if (!existsSync(path)) return {};

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
    if (!(key in process.env)) process.env[key] = value;
  }

  return env;
}

// Onde os scripts leem e escrevem dados.
//
// No Railway o volume é montado fora do diretório do projeto, então os caminhos
// não podem ser relativos ao arquivo do script. `DATA_DIR` decide; sem ela,
// tudo cai em <projeto>/data como sempre foi no local.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const dataRoot = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(projectRoot, 'data');

export const rawDir = path.join(dataRoot, 'raw');
export const processedDir = path.join(dataRoot, 'processed');
export const areasDir = path.join(dataRoot, 'areas');
export const reportsDir = path.join(dataRoot, '..', 'reports');

/** URL de diretório (com barra final) para quem usa `new URL(nome, dir)`. */
export const rawDirUrl = new URL(`file://${rawDir}/`);
export const processedDirUrl = new URL(`file://${processedDir}/`);

export function ensureDataDirs() {
  for (const dir of [rawDir, processedDir]) mkdirSync(dir, { recursive: true });
}

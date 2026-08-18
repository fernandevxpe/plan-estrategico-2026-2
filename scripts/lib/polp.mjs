// Cliente GET da API do Polp.
//
// Credenciais saem só das chaves POLP_* (ambiente ou `.env.obras`). O arquivo
// `.env.obras` é o `.env.local` inteiro do erp-obras e traz service_role do
// Supabase, Asaas de produção e Clicksign. Carregá-lo com um loader que joga
// tudo em process.env daria a este processo credencial de ESCRITA em três
// sistemas que ele não tem motivo para tocar. Por isso o parser é por chave,
// o valor nunca é impresso, e nada vai para process.env.
//
// SOMENTE GET neste módulo. Criar integração (POST) vive isolado em
// scripts/conectar-polp-caixa.mjs, atrás de `--conectar`.
import { readFile } from 'node:fs/promises';

const CHAVES = [
  'POLP_API_CLIENT',
  'POLP_API_SECRET',
  'POLP_API_BASE_URL',
  'POLP_INTEGRATION_ID',
  'POLP_BANK_ACCOUNT_ID',
  'POLP_CREDIT_ACCOUNT_ID'
];

/** Caixa Econômica Federal Empresas no catálogo do Polp. Medido em GET /institutions. */
export const POLP_INSTITUICAO_CAIXA_EMPRESAS = 37;

export async function credenciaisPolp(extras = []) {
  const querido = [...new Set([...CHAVES, ...extras])];
  const achado = Object.fromEntries(querido.map((k) => [k, process.env[k] ?? null]));

  if (!achado.POLP_API_CLIENT || !achado.POLP_API_SECRET) {
    let texto = '';
    try {
      texto = await readFile(new URL('../../.env.obras', import.meta.url), 'utf8');
    } catch {
      throw new Error('sem POLP_API_CLIENT/POLP_API_SECRET no ambiente e .env.obras não encontrado');
    }
    for (const linha of texto.split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(linha.trim());
      if (!m || !querido.includes(m[1])) continue;
      if (achado[m[1]]) continue;
      achado[m[1]] = m[2].trim().replace(/^["']|["']$/g, '') || null;
    }
  }
  if (!achado.POLP_API_CLIENT || !achado.POLP_API_SECRET) {
    throw new Error('credenciais do Polp ausentes');
  }

  return {
    client: achado.POLP_API_CLIENT,
    secret: achado.POLP_API_SECRET,
    base: (achado.POLP_API_BASE_URL || 'https://api.polp.com.br/api/v1').replace(/\/$/, ''),
    integracao: achado.POLP_INTEGRATION_ID || null,
    conta: achado.POLP_BANK_ACCOUNT_ID || null,
    cartao: achado.POLP_CREDIT_ACCOUNT_ID || null
  };
}

/**
 * SOMENTE GET. Não existe caminho neste arquivo que faça POST/PUT/PATCH/DELETE.
 * A URL entra no erro; os headers NUNCA.
 */
export function clientePolp(cred) {
  const headers = {
    Accept: 'application/json',
    'x-api-client': cred.client,
    'x-api-secret': cred.secret
  };
  return async function get(caminho) {
    const resposta = await fetch(`${cred.base}${caminho}`, { method: 'GET', headers });
    if (!resposta.ok) throw new Error(`GET ${caminho} → HTTP ${resposta.status}`);
    return resposta.json();
  };
}

/** Percorre páginas deduplicando por `id` e confere contra `meta.total`. */
export async function paginar(get, caminho, { limitePaginas = 80, perPage = null } = {}) {
  const porId = new Map();
  let pagina = 1;
  let ultima = 1;
  let total = null;
  let linhasBrutas = 0;

  while (pagina <= ultima && pagina <= limitePaginas) {
    const sep = caminho.includes('?') ? '&' : '?';
    const extra = perPage ? `${sep}per_page=${perPage}&page=${pagina}` : `${sep}page=${pagina}`;
    const corpo = await get(`${caminho}${extra}`);
    const linhas = corpo?.data ?? [];
    linhasBrutas += linhas.length;
    for (const linha of linhas) if (linha?.id != null && !porId.has(linha.id)) porId.set(linha.id, linha);
    ultima = Number(corpo?.meta?.last_page ?? 1) || 1;
    total = corpo?.meta?.total ?? total;
    pagina += 1;
  }
  return { itens: [...porId.values()], total: total === null ? null : Number(total), linhasBrutas, paginas: ultima };
}

export function exigirPaginaCompleta(rotulo, { itens, total, linhasBrutas }) {
  if (total !== null && itens.length < total) {
    throw new Error(
      `paginação instável em ${rotulo}: meta.total=${total} mas ${itens.length} distintas ` +
        `em ${linhasBrutas} linhas. É o mesmo defeito de /investments. Não prossiga sem varrer por id.`
    );
  }
}

/**
 * Reais → centavos inteiros. Passar por string decimal: `Math.round(1.005 * 100)`
 * é 100 e não 101 — binário. Num ledger de centavos isso é indistinguível de
 * dinheiro faltando.
 */
export function centavos(valorEmReais) {
  if (valorEmReais === null || valorEmReais === undefined) return 0;
  const texto = typeof valorEmReais === 'number' ? valorEmReais.toFixed(6) : String(valorEmReais).trim();
  const negativo = texto.startsWith('-');
  const [inteira, decimal = ''] = texto.replace(/^[+-]/, '').split('.');
  const cent = BigInt(inteira || '0') * 100n + BigInt((decimal + '00').slice(0, 2));
  const resto = Number((decimal + '000').slice(2, 3) || '0');
  const arredondado = resto >= 5 ? cent + 1n : cent;
  const n = Number(negativo ? -arredondado : arredondado);
  if (!Number.isSafeInteger(n)) throw new Error(`valor fora da faixa segura: ${valorEmReais}`);
  return n;
}

/**
 * O Polp entrega `date` como timestamp UTC. O ledger guarda `posted_on` como
 * data local. Sem esta conversão, transação entre 21h e 24h locais cai no dia
 * seguinte. -03:00 é Recife/São Paulo, sem horário de verão desde 2019.
 */
export const diaLocal = (iso) =>
  iso ? new Date(new Date(iso).getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10) : null;

export const dia = (v) => (typeof v === 'string' ? v.slice(0, 10) : v?.toISOString?.().slice(0, 10) ?? null);

export const digitos = (v) => String(v ?? '').replace(/\D/g, '');
export const tipoDeDocumento = (d) => (d.length === 14 ? 'cnpj' : d.length === 11 ? 'cpf' : null);

/**
 * Documento da CONTRAPARTE — direcional. Em toda SAÍDA o pagador somos nós; em
 * toda ENTRADA, o recebedor. DEBIT lê `receiver`, CREDIT lê `payer`.
 *
 * Quando a ponta certa vem nula, o resultado é null — não o documento que
 * sobrou (que nesses casos é o NOSSO). Ver scripts/backfill-nubank-polp.mjs.
 */
export function documentoDaContraparte(tx) {
  const pd = tx.payment_data || {};
  const recebedor = digitos(pd.receiver?.documentNumber?.value ?? pd.receiver?.document_number?.value);
  const pagador = digitos(pd.payer?.documentNumber?.value ?? pd.payer?.document_number?.value);
  const comerciante = digitos(tx.merchant?.cnpj);
  const ponta = tx.type === 'DEBIT' ? [recebedor, comerciante] : [pagador];
  for (const d of ponta) if (tipoDeDocumento(d)) return d;
  return null;
}

export function nomeDaContraparte(tx) {
  const pd = tx.payment_data || {};
  const ponta = tx.type === 'DEBIT' ? pd.receiver || tx.merchant : pd.payer;
  const nome =
    ponta?.name ||
    ponta?.legalName ||
    ponta?.legal_name ||
    tx.merchant?.name ||
    tx.merchant?.legalName ||
    null;
  const texto = (nome ?? '').trim();
  return texto || null;
}

/**
 * Sinal do valor. O Polp às vezes manda `amount` positivo com `type=DEBIT`.
 * Confiar só no sinal faria toda saída virar entrada.
 */
export function valorAssinadoCents(tx) {
  const c = centavos(tx.amount);
  if (tx.type === 'DEBIT') return c <= 0 ? c : -c;
  if (tx.type === 'CREDIT') return c >= 0 ? c : -c;
  return c;
}

export function descricaoPolp(tx) {
  const partes = [tx.description, tx.operation_type, tx.category].filter((x) => x && String(x).trim());
  return [...new Set(partes.map((x) => String(x).trim()))].join(' — ').slice(0, 500) || 'sem descrição';
}

// Cria (ou retoma) a integração Open Finance da Caixa Empresas no Polp.
//
// ===========================================================================
// POR QUE ESTE ARQUIVO EXISTE, E POR QUE ELE É O ÚNICO QUE FAZ POST
// ===========================================================================
// GET /integrations hoje devolve UMA integração: Nubank Empresas (id 2906).
// Caixa Econômica Federal Empresas está no catálogo (institution_id 37,
// status ONLINE, credenciais cpf+cnpj) e não está conectada.
//
// Sem consentimento no banco, não há o que ler. A Polp devolve
// `url_to_authenticate`; quem autoriza é o titular, no internet banking da
// Caixa. Este script só abre essa jornada.
//
// POST fica atrás de `--conectar` de propósito: criar a integração é
// irreversível do lado de fora (a Polp recusa duplicata com 422) e gera uma
// URL que expira. Rodar sem a flag só CONSULTA.
//
// Uso:
//   node scripts/conectar-polp-caixa.mjs
//   node scripts/conectar-polp-caixa.mjs --conectar --cpf=00000000000
//
// O CPF é o do representante que autoriza no Open Finance PJ (o mesmo que
// autorizou o Nubank). Não é lido de arquivo nenhum: entra na linha de comando
// ou em POLP_TITULAR_CPF, e nunca é impresso.
import { credenciaisPolp, clientePolp, POLP_INSTITUICAO_CAIXA_EMPRESAS } from './lib/polp.mjs';

const argv = process.argv.slice(2);
const flag = (nome) => argv.includes(`--${nome}`);
const valor = (nome, padrao = null) => {
  const hit = argv.find((a) => a.startsWith(`--${nome}=`));
  return hit ? hit.slice(nome.length + 3) : padrao;
};

const CONECTAR = flag('conectar');
const CNPJ = (valor('cnpj') || process.env.POLP_CNPJ || '34776108000192').replace(/\D/g, '');
const CPF = (valor('cpf') || process.env.POLP_TITULAR_CPF || '').replace(/\D/g, '');

const PRODUTOS = [
  'ACCOUNTS',
  'TRANSACTIONS',
  'INVESTMENTS',
  'INVESTMENTS_TRANSACTIONS',
  'PAYMENT_DATA',
  'LOANS'
];

function resumo(i) {
  return {
    id: i.id,
    instituicao: i.institution?.name ?? i.institution_id,
    status: i.status,
    status_label: i.status_label ?? null,
    execution: i.execution_status ?? null,
    last_updated_at: i.last_updated_at ?? null,
    tem_url: Boolean(i.url_to_authenticate),
    url_expira: i.url_to_authenticate_expires_at ?? null
  };
}

const cred = await credenciaisPolp();
const get = clientePolp(cred);

const lista = await get('/integrations');
const todas = lista?.data ?? [];
const caixa = todas.filter((i) => Number(i.institution_id) === POLP_INSTITUICAO_CAIXA_EMPRESAS);

console.log(`[polp-caixa] ${todas.length} integração(ões) no Polp`);
for (const i of todas) {
  const r = resumo(i);
  console.log(`  #${r.id}  ${r.instituicao}  ${r.status}${r.execution ? ` (${r.execution})` : ''}`);
}

if (caixa.length) {
  console.log('');
  console.log(`[polp-caixa] Caixa Empresas já existe: ${caixa.map((i) => '#' + i.id).join(', ')}`);
  for (const i of caixa) {
    const detalhe = (await get(`/integrations/${i.id}`))?.data ?? i;
    const r = resumo(detalhe);
    console.log(`  status=${r.status}  execução=${r.execution ?? '—'}  última sync=${r.last_updated_at ?? '—'}`);
    if (detalhe.url_to_authenticate) {
      console.log('');
      console.log('  Abra esta URL para autorizar o compartilhamento na Caixa:');
      console.log(`  ${detalhe.url_to_authenticate}`);
      if (r.url_expira) console.log(`  (expira em ${r.url_expira})`);
    } else if (r.status === 'UPDATED') {
      console.log('  Consentimento ativo. Próximo passo:');
      console.log('  node scripts/sync-polp-caixa.mjs');
    } else if (r.status === 'WAITING_USER_INPUT') {
      console.log('  Aguardando autenticação, mas a URL não veio neste GET. Recrie com --conectar só se a anterior tiver expirado.');
    }
  }
  process.exit(0);
}

if (!CONECTAR) {
  console.log('');
  console.log('[polp-caixa] Caixa Empresas NÃO está conectada.');
  console.log('  Para abrir o consentimento (você autoriza no internet banking da Caixa):');
  console.log('  node scripts/conectar-polp-caixa.mjs --conectar --cpf=SEU_CPF');
  console.log('  Instituição: Caixa Econômica Federal Empresas (id 37). CNPJ da XPE entra sozinho.');
  process.exit(0);
}

if (CPF.length !== 11) {
  console.error('[polp-caixa] --conectar exige o CPF do representante (--cpf= ou POLP_TITULAR_CPF). Não é lido de arquivo.');
  process.exit(1);
}
if (CNPJ.length !== 14) {
  console.error('[polp-caixa] CNPJ inválido');
  process.exit(1);
}

const corpo = {
  institution_id: POLP_INSTITUICAO_CAIXA_EMPRESAS,
  cpf: CPF,
  cnpj: CNPJ,
  cliente_user_id: 'xpe',
  products: PRODUTOS
};

const resposta = await fetch(`${cred.base}/integrations`, {
  method: 'POST',
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'x-api-client': cred.client,
    'x-api-secret': cred.secret
  },
  body: JSON.stringify(corpo)
});

const json = await resposta.json().catch(() => ({}));
if (!resposta.ok) {
  const msg = json?.message || json?.error || `HTTP ${resposta.status}`;
  console.error(`[polp-caixa] POST /integrations → ${resposta.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
  process.exit(1);
}

const criada = json?.data ?? json;
console.log(`[polp-caixa] integração #${criada.id} criada, status=${criada.status}`);
if (criada.url_to_authenticate) {
  console.log('');
  console.log('Abra esta URL no navegador e autorize o compartilhamento na Caixa:');
  console.log(criada.url_to_authenticate);
  if (criada.url_to_authenticate_expires_at) {
    console.log(`(expira em ${criada.url_to_authenticate_expires_at})`);
  }
  console.log('');
  console.log('Quando o status virar UPDATED:');
  console.log('  node scripts/conectar-polp-caixa.mjs          # confere o status');
  console.log('  node scripts/sync-polp-caixa.mjs              # dry-run do que a Caixa entregou');
} else {
  console.log('Sem url_to_authenticate na resposta. Consulte de novo: node scripts/conectar-polp-caixa.mjs');
}

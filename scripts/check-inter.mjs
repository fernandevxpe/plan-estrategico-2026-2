// Confere as credenciais do Banco Inter SEM imprimir nenhuma delas.
//
// Existe para que a validação não precise de troca de segredo com ninguém: você
// roda, olha os ✓ e os ✗, e reporta só o resultado. Nenhuma linha aqui imprime
// conteúdo de arquivo, valor de variável ou token — no máximo o tamanho, que
// serve para pegar o erro mais comum (variável colada pela metade).
//
// Uso:
//   node scripts/check-inter.mjs            só confere arquivos e variáveis
//   node scripts/check-inter.mjs --live     também bate na API (token + extrato)
//   node scripts/check-inter.mjs --escopos  pergunta ao banco QUAIS escopos a
//                                           credencial abre (não move dinheiro:
//                                           só pede token, nunca chama rota de
//                                           pagamento)
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { resolve } from 'node:path';

import { loadEnv } from './lib/env.mjs';

loadEnv();

const HOST = 'cdpj.partners.bancointer.com.br';
/**
 * Acha o certificado sem exigir nome exato.
 *
 * O Inter entrega os arquivos como "Inter API_Certificado.crt" — com espaço no
 * meio. Obrigar a renomear é convite a erro, e caminho com espaço em variável de
 * ambiente quebra em shell na primeira distração. Então: se `INTER_CERT_PATH`
 * estiver definida ela manda; senão procura a única extensão correspondente
 * dentro de `secrets/`. Duas candidatas viram erro, e não escolha silenciosa.
 */
function acharCredencial(envVar, extensao, rotulo) {
  const explicito = process.env[envVar];
  if (explicito) return { caminho: resolve(explicito), erro: null };

  const dir = resolve('secrets');
  if (!existsSync(dir)) return { caminho: resolve('secrets', `inter${extensao}`), erro: null };

  const achados = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(extensao));
  if (achados.length === 1) return { caminho: resolve(dir, achados[0]), erro: null };
  if (achados.length > 1) {
    return { caminho: null, erro: `mais de um ${rotulo} em secrets/ (${achados.join(', ')}) — defina ${envVar}` };
  }
  return { caminho: resolve(dir, `inter${extensao}`), erro: null };
}

const alvoCert = acharCredencial('INTER_CERT_PATH', '.crt', 'certificado');
const alvoKey = acharCredencial('INTER_KEY_PATH', '.key', 'chave');
const CERT_PATH = alvoCert.caminho;
const KEY_PATH = alvoKey.caminho;
const LIVE = process.argv.includes('--live');
const ESCOPOS = process.argv.includes('--escopos');
const REDE = LIVE || ESCOPOS;

let problemas = 0;
const ok = (m) => console.log(`  [32m✓[0m ${m}`);
const erro = (m) => {
  problemas += 1;
  console.log(`  [31m✗[0m ${m}`);
};
const aviso = (m) => console.log(`  [33m![0m ${m}`);

console.log('\nCredenciais do Banco Inter\n');

// ---------------------------------------------------------------- arquivos
console.log('Certificado e chave');

function conferirArquivo(rotulo, caminho, exigirPermissao) {
  if (!existsSync(caminho)) {
    erro(`${rotulo} ausente em ${caminho}`);
    return null;
  }
  const conteudo = readFileSync(caminho, 'utf8');
  if (!conteudo.includes('-----BEGIN')) {
    erro(`${rotulo} não parece PEM (falta "-----BEGIN"). Se veio .p12/.pfx, precisa converter.`);
    return null;
  }
  // O modo vem em decimal; 0o077 pega qualquer permissão para grupo/outros.
  const modo = statSync(caminho).mode & 0o777;
  if (exigirPermissao && modo & 0o077) {
    aviso(`${rotulo} legível por outros usuários (${modo.toString(8)}). Rode: chmod 600 ${caminho}`);
  }
  ok(`${rotulo} presente`);
  return conteudo;
}

if (alvoCert.erro) erro(`Certificado: ${alvoCert.erro}`);
if (alvoKey.erro) erro(`Chave privada: ${alvoKey.erro}`);

const cert = alvoCert.erro ? null : conferirArquivo('Certificado', CERT_PATH, false);
const key = alvoKey.erro ? null : conferirArquivo('Chave privada', KEY_PATH, true);

if (cert) {
  try {
    const x509 = new X509Certificate(cert);
    const expira = new Date(x509.validTo);
    const dias = Math.round((expira - Date.now()) / 86_400_000);
    // Só a data. O subject traz o CNPJ da conta, então fica de fora.
    if (dias < 0) erro(`Certificado VENCIDO em ${expira.toLocaleDateString('pt-BR')}`);
    else if (dias < 30) aviso(`Certificado vence em ${dias} dias (${expira.toLocaleDateString('pt-BR')})`);
    else ok(`Certificado válido por mais ${dias} dias`);
  } catch {
    erro('Certificado não pôde ser lido como X.509');
  }
}

// --------------------------------------------------------------- variáveis
console.log('\nVariáveis de ambiente');
for (const nome of ['INTER_CLIENT_ID', 'INTER_CLIENT_SECRET']) {
  const valor = process.env[nome];
  // Tamanho, nunca o valor: pega o segredo colado pela metade sem revelar nada.
  if (!valor) erro(`${nome} ausente no .env.local`);
  else if (valor.length < 20) erro(`${nome} presente mas curto demais (${valor.length} caracteres) — colagem incompleta?`);
  else ok(`${nome} presente (${valor.length} caracteres)`);
}

// ------------------------------------------------------------- teste ao vivo
if (!REDE) {
  console.log('\nPara testar contra a API do Inter: node scripts/check-inter.mjs --live');
  console.log('Para saber que escopos a credencial abre: node scripts/check-inter.mjs --escopos\n');
  process.exit(problemas ? 1 : 0);
}

if (problemas || !cert || !key) {
  console.log('\nCorrija os itens acima antes do teste ao vivo.\n');
  process.exit(1);
}

function pedir({ path, method, headers = {}, body }) {
  return new Promise((resolveReq, reject) => {
    const req = httpsRequest(
      { host: HOST, path, method, headers, cert, key, timeout: 30_000 },
      (res) => {
        let dados = '';
        res.on('data', (c) => (dados += c));
        res.on('end', () => resolveReq({ status: res.statusCode, body: dados }));
      }
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

console.log('\nTeste contra a API');

let token = null;
try {
  const corpo = new URLSearchParams({
    client_id: process.env.INTER_CLIENT_ID,
    client_secret: process.env.INTER_CLIENT_SECRET,
    grant_type: 'client_credentials',
    scope: 'extrato.read'
  }).toString();

  const res = await pedir({
    path: '/oauth/v2/token',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(corpo)
    },
    body: corpo
  });

  if (res.status === 200) {
    token = JSON.parse(res.body).access_token;
    ok('Token obtido (mTLS + client_credentials funcionando)');
  } else {
    // O corpo de erro do OAuth traz descrição, não o secret.
    erro(`Token falhou: HTTP ${res.status} ${res.body.slice(0, 160)}`);
  }
} catch (e) {
  erro(`Token falhou na conexão: ${e.message}`);
}

if (token) {
  const fim = new Date();
  const inicio = new Date(fim - 7 * 86_400_000);
  const iso = (d) => d.toISOString().slice(0, 10);
  try {
    const res = await pedir({
      path: `/banking/v2/extrato?dataInicio=${iso(inicio)}&dataFim=${iso(fim)}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.status === 200) {
      const json = JSON.parse(res.body);
      const lista = json.transacoes ?? json.transacoesList ?? [];
      // Quantidade, jamais o conteúdo das transações.
      ok(`Extrato lido: ${lista.length} transação(ões) nos últimos 7 dias`);
    } else if (res.status === 403) {
      erro(`Extrato negado (403) — a aplicação provavelmente não tem o escopo extrato.read`);
    } else {
      erro(`Extrato falhou: HTTP ${res.status} ${res.body.slice(0, 160)}`);
    }
  } catch (e) {
    erro(`Extrato falhou na conexão: ${e.message}`);
  }
}

// --------------------------------------------------------------- escopos
/*
 * QUE ESCOPOS ESTA CREDENCIAL ABRE?
 *
 * A pergunta importa porque o escopo é contratado no Internet Banking, não no
 * código: um `client_id` que lê extrato não paga nada, e a diferença só aparece
 * quando alguém tenta. `docs/DUVIDAS_FINANCEIRO.md:1053` já registra o sintoma
 * pelo outro lado — "boleto agendado no Inter: a credencial usa escopo
 * extrato.read, o extrato só mostra depois de pago".
 *
 * O teste é o mesmo que `sync-cartao-inter.mjs --provar-api` usou para provar
 * que a API não expõe cartão, e ele é SEGURO: pedir um token não move dinheiro.
 * Nenhuma rota de pagamento é chamada aqui — só `/oauth/v2/token`. Escopo
 * ACEITO significa "o banco emitiria a chave", nunca "algo foi pago".
 *
 * A resposta que interessa é literal: escopo não contratado volta 401 com
 * "No registered scope value for this client has been requested".
 *
 * 20s entre pedidos: o 5º pedido de token em menos de um minuto volta 429.
 */
const ESCOPOS_DE_PAGAMENTO = ['pagamento-pix.write', 'pagamento-boleto.write', 'pix.write', 'pagamento.write'];

if (ESCOPOS) {
  console.log('\nEscopos que a credencial abre');
  console.log('  (só pede token; nenhuma rota de pagamento é chamada)\n');

  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  let algumAceito = false;

  for (const escopo of ESCOPOS_DE_PAGAMENTO) {
    const corpo = new URLSearchParams({
      client_id: process.env.INTER_CLIENT_ID,
      client_secret: process.env.INTER_CLIENT_SECRET,
      grant_type: 'client_credentials',
      scope: escopo
    }).toString();
    try {
      const res = await pedir({
        path: '/oauth/v2/token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(corpo)
        },
        body: corpo
      });
      // Nunca ecoa o corpo enviado: ali vai o client_secret.
      const nota = res.status === 200 ? 'ACEITO' : res.body.replace(/\s+/g, ' ').slice(0, 90);
      if (res.status === 200) algumAceito = true;
      console.log(`  ${String(res.status).padEnd(4)} ${escopo.padEnd(24)} ${nota}`);
    } catch (e) {
      console.log(`  ---  ${escopo.padEnd(24)} falhou na conexão: ${e.message}`);
    }
    await espera(20_000);
  }

  console.log(
    algumAceito
      ? '\n  → Há escopo de pagamento contratado. Programar pagamento pela API é possível.'
      : '\n  → Nenhum escopo de pagamento contratado. Com esta credencial a plataforma\n' +
          '    PODE LER o que há a pagar e NÃO PODE pagar. Para liberar, é preciso criar\n' +
          '    uma integração no Internet Banking PJ com a permissão de pagamento e trazer\n' +
          '    certificado, chave, client_id e client_secret novos.'
  );
}

console.log(
  problemas ? `\n${problemas} problema(s). Nada acima revela credencial — pode colar o resultado.\n`
            : '\nTudo certo. Pode me avisar que sigo com o sync.\n'
);
process.exit(problemas ? 1 : 0);

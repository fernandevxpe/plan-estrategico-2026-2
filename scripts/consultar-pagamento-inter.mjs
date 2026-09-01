// O que o Inter diz sobre um pagamento que a plataforma criou? SÓ GET.
//
//   node scripts/consultar-pagamento-inter.mjs <codigoSolicitacao>
//   node scripts/consultar-pagamento-inter.mjs --pendentes
//
// ---------------------------------------------------------------------------
// POR QUE ISTO EXISTE
// ---------------------------------------------------------------------------
// Porque há um ponto cego caro: a plataforma entrega a ordem, o banco devolve
// `codigoSolicitacao` e `tipoRetorno=APROVACAO`, e daí em diante ninguém aqui
// sabe mais nada. Se a ordem foi aprovada, rejeitada por saldo, agendada ou
// apagada, só se descobre abrindo o aplicativo — ou esperando o lançamento
// aparecer no extrato, que pode nunca acontecer.
//
// Em 01/09/2026 isso custou uma rodada inteira: três ordens do Jonildo voltaram
// 200 com APROVACAO e não apareceram no aplicativo, e não havia como distinguir
// "está lá e você não viu" de "morreu e ninguém contou".
//
// ESTE SCRIPT NÃO PAGA E NÃO APROVA. Só GET, e os caminhos estão listados
// abaixo — se algum responder, o ponto cego fecha.
import { existsSync, readFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { resolve } from 'node:path';

import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';

loadEnv();

const HOST = 'cdpj.partners.bancointer.com.br';

/*
 * DUAS INTEGRAÇÕES, DUAS CREDENCIAIS — e a de LEITURA pode ser a que consulta.
 *
 * A de pagamento (INTER_PAG_*) só tem `pagamento-pix.write`, e a rota de
 * consulta respondeu 401 "requested scope is not registered" com ela. A de
 * extrato (INTER_*) tem `extrato.read` e pode ter escopo de leitura de
 * pagamento junto — é a hipótese que este flag testa.
 *
 *   --leitura   usa a credencial de EXTRATO (INTER_CLIENT_ID / INTER_CERT_PATH)
 *   (padrão)    usa a de PAGAMENTO (INTER_PAG_*)
 */
const LEITURA = process.argv.includes('--leitura');
const VAR_ID = LEITURA ? 'INTER_CLIENT_ID' : 'INTER_PAG_CLIENT_ID';
const VAR_SECRET = LEITURA ? 'INTER_CLIENT_SECRET' : 'INTER_PAG_CLIENT_SECRET';
const VAR_CERT = LEITURA ? 'INTER_CERT_PATH' : 'INTER_PAG_CERT_PATH';
const VAR_KEY = LEITURA ? 'INTER_KEY_PATH' : 'INTER_PAG_KEY_PATH';
// Escopos candidatos, do mais provável ao menos. O primeiro que emitir token vence.
const ESCOPOS = LEITURA
  ? ['pagamento-pix.read', 'pagamento.read', 'extrato.read', 'pix.read']
  : ['pagamento-pix.write'];

function ler(varPath, rotulo) {
  const caminho = process.env[varPath]?.trim();
  if (!caminho) throw new Error(`${rotulo} não configurado (${varPath})`);
  const abs = resolve(caminho);
  if (!existsSync(abs)) throw new Error(`${rotulo} não encontrado em ${varPath}`);
  return readFileSync(abs, 'utf8');
}
const cert = ler(VAR_CERT, 'certificado');
const key = ler(VAR_KEY, 'chave privada');

const pedir = ({ path, method, headers = {}, body }) =>
  new Promise((ok, falha) => {
    const req = httpsRequest({ host: HOST, path, method, headers, cert, key, timeout: 30_000 }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => ok({ status: res.statusCode, body: d }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', falha);
    if (body) req.write(body);
    req.end();
  });

let token = null;
let escopoUsado = null;
for (const escopo of ESCOPOS) {
  const corpo = new URLSearchParams({
    client_id: process.env[VAR_ID],
    client_secret: process.env[VAR_SECRET],
    grant_type: 'client_credentials',
    scope: escopo
  }).toString();
  const tk = await pedir({
    path: '/oauth/v2/token',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(corpo) },
    body: corpo
  });
  console.log(`  token scope=${escopo.padEnd(20)} HTTP ${tk.status}`);
  if (tk.status === 200) {
    token = JSON.parse(tk.body).access_token;
    escopoUsado = escopo;
    break;
  }
  await new Promise((r) => setTimeout(r, 7000));
}
if (!token) {
  console.error('\nnenhum escopo de leitura de pagamento nesta credencial\n');
  process.exit(1);
}
console.log(`\n  usando ${LEITURA ? 'credencial de EXTRATO' : 'credencial de PAGAMENTO'} com scope=${escopoUsado}\n`);
const auth = { Authorization: `Bearer ${token}`, Accept: 'application/json' };

/*
 * Candidatos. Nenhum é documentado — o Inter não publica OpenAPI — e a regra
 * que a sonda por GET já ensinou vale aqui: 404 prova ausência, 401/405 não
 * provam presença. O que se procura é um 200 com o estado do pagamento.
 */
const caminhos = (cod) => [
  `/banking/v2/pix/${cod}`,
  `/banking/v2/pagamento/pix/${cod}`,
  `/banking/v2/pix?codigoSolicitacao=${cod}`,
  `/pix/v2/pix/${cod}`
];

const alvos = [];
if (process.argv.includes('--pendentes')) {
  const pool = financePool();
  const { rows } = await pool.query(
    `SELECT code, (regexp_match(notes, 'codigoSolicitacao=([0-9a-f-]{36})'))[1] AS cod
       FROM fin_payment_request
      WHERE status = 'aguardando_autorizacao' AND paid_cents = 0
      ORDER BY id`
  );
  await pool.end();
  for (const r of rows) if (r.cod) alvos.push({ code: r.code, cod: r.cod });
} else {
  const cod = process.argv.find((a) => /^[0-9a-f-]{36}$/i.test(a));
  if (!cod) {
    console.error('\nInforme um codigoSolicitacao, ou use --pendentes\n');
    process.exit(1);
  }
  alvos.push({ code: '(informado)', cod });
}

if (alvos.length === 0) {
  console.log('\nNenhuma ordem aguardando com codigoSolicitacao registrado.\n');
  process.exit(0);
}

console.log(`\nConsultando ${alvos.length} pagamento(s) — só GET, nada é criado nem aprovado\n`);

let achou = null;
for (const alvo of alvos) {
  // Na primeira, descobre QUAL caminho responde. Nas seguintes, usa só ele.
  const tentar = achou ? [achou] : caminhos(alvo.cod);
  for (const molde of tentar) {
    const path = achou ? achou.replace(/[0-9a-f-]{36}/i, alvo.cod) : molde;
    const r = await pedir({ path, method: 'GET', headers: auth });
    if (r.status === 200) {
      achou = path;
      let resumo = r.body.replace(/\s+/g, ' ').slice(0, 220);
      try {
        const j = JSON.parse(r.body);
        resumo = JSON.stringify({
          status: j.status ?? j.situacao ?? j.estado,
          tipoRetorno: j.tipoRetorno,
          valor: j.valor,
          dataPagamento: j.dataPagamento,
          motivo: j.motivoRejeicao ?? j.motivo
        });
      } catch {
        /* corpo não-JSON: mostra cru, cortado */
      }
      console.log(`  ${alvo.code}  200  ${resumo}`);
      break;
    }
    if (!achou && r.status !== 404) {
      console.log(`  ${alvo.code}  ${r.status}  ${path} → ${r.body.replace(/\s+/g, ' ').slice(0, 90)}`);
    }
    if (achou) {
      console.log(`  ${alvo.code}  ${r.status}  ${r.body.replace(/\s+/g, ' ').slice(0, 120)}`);
      break;
    }
  }
  if (!achou) {
    console.log(`  ${alvo.code}  nenhum caminho respondeu 200 — a consulta de pagamento não está nesta credencial`);
    break;
  }
  await new Promise((r) => setTimeout(r, 7000));
}

if (achou) console.log(`\n  caminho que respondeu: ${achou.replace(/[0-9a-f-]{36}/i, '<codigoSolicitacao>')}\n`);

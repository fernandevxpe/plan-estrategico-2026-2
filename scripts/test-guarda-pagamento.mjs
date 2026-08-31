// A PLATAFORMA NÃO PAGA. Este teste é o que transforma isso em fato.
//
//   npm run test:guarda-pagamento
//
// ---------------------------------------------------------------------------
// POR QUE UM GUARDA E NÃO UMA PROMESSA
// ---------------------------------------------------------------------------
// Porque o dono pediu certeza, e certeza não se dá por escrito num comentário:
// "quero ter certeza que a plataforma nao vai realizar nenhum pagamento sem
// aprovação". Comentário envelhece em silêncio; teste quebra.
//
// A regra, dita por ele: "lança para pagamento mas não realiza o pagamento".
// A 0075 já dizia o mesmo do lado do schema, em `fin_payment_request.status`:
// "`aguardando_autorizacao` é o estado em que o produto termina o seu trabalho:
// o lote saiu, a pessoa está no aplicativo do banco. Nenhuma transição a partir
// dele é automática."
//
// SÃO TRÊS TRANCAS, E ESTE ARQUIVO PROVA AS TRÊS:
//
//   1. CÓDIGO   não existe verbo de aprovação. O cliente do Inter tem UMA rota
//               de escrita — incluir pagamento — e nenhuma de aprovar,
//               autorizar, confirmar ou cancelar.
//   2. ESTADO   nada no código escreve `status = 'pago'`, e nada insere em
//               `fin_payment_execution` (o registro do dinheiro que saiu).
//   3. AMBIENTE a escrita bancária exige DUAS condições simultâneas, e uma
//               delas é `NODE_ENV !== 'production'` — em produção não há
//               caminho, nem por engano nem por variável ligada sem querer.
//
// A quarta tranca não é nossa e é a mais forte: o próprio Banco Inter exige
// aprovação no aplicativo (Gestão de Aprovações) para pagamento criado por API.
// Mesmo que tudo aqui falhasse, o dinheiro não sai sem alguém tocar no celular.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

let falhas = 0;
const ok = (t, d) => console.log(`  ✓ ${t}${d ? ` — ${d}` : ''}`);
const nok = (t, d) => {
  falhas += 1;
  console.log(`  ✗ ${t}${d ? ` — ${d}` : ''}`);
};
const afirma = (cond, t, d) => (cond ? ok(t, d) : nok(t, d));

function varrer(dir, acc = []) {
  for (const nome of readdirSync(dir)) {
    if (nome === 'node_modules' || nome === '.next' || nome.startsWith('.')) continue;
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) varrer(caminho, acc);
    else if (/\.(ts|tsx|mjs|js)$/.test(nome)) acc.push(caminho);
  }
  return acc;
}

const ARQUIVOS = [...varrer('lib'), ...varrer('app'), ...varrer('components')];
const ler = (c) => readFileSync(c, 'utf8');

console.log('\n=== 1. CÓDIGO: não existe verbo de aprovação ===');

const adapter = ler('lib/financeiro/inter-pagamento.ts');

/*
 * Só um método de escrita. O cliente de LEITURA (`scripts/lib/inter.mjs`) já
 * segue essa disciplina e diz por quê: "não usa createInterClient porque ele só
 * expõe extrato e saldo — de propósito, para que nenhum caminho do sync mande
 * path arbitrário".
 */
const metodosEscrita = [...adapter.matchAll(/method:\s*['"](POST|PUT|PATCH|DELETE)['"]/g)].map((m) => m[1]);
afirma(
  metodosEscrita.length > 0 && metodosEscrita.every((m) => m === 'POST'),
  'o adapter do Inter só usa POST',
  metodosEscrita.join(', ') || 'nenhum'
);

// Um POST é o token (OAuth), o outro é incluir pagamento. Mais que dois é rota
// nova entrando sem ninguém decidir.
afirma(metodosEscrita.length <= 2, 'no máximo dois POST: token e inclusão de pagamento', `${metodosEscrita.length}`);

const PALAVRAS_DE_APROVACAO = [
  'aprovar', 'aprovacao', 'aprovação', 'approve', 'approval',
  'autorizar', 'autorizacao/', 'confirmar-pagamento', 'confirm-payment'
];
// Procura só em STRING de caminho HTTP — o comentário do arquivo fala de
// aprovação o tempo todo, e deve mesmo falar.
const caminhosHttp = [...adapter.matchAll(/['"`](\/[a-z0-9\-/{}.]+)['"`]/gi)].map((m) => m[1].toLowerCase());
const suspeitos = caminhosHttp.filter((p) => PALAVRAS_DE_APROVACAO.some((w) => p.includes(w)));
afirma(suspeitos.length === 0, 'nenhum caminho HTTP de aprovação no adapter', suspeitos.join(', ') || 'nenhum');
console.log(`     caminhos do Inter no adapter: ${[...new Set(caminhosHttp)].join(', ')}`);

console.log('\n=== 2. ESTADO: nada marca "pago" nem registra execução ===');

/*
 * `status = 'pago'` significa "o dinheiro saiu". Só um humano conferindo o
 * extrato pode afirmar isso. Se aparecer no código, alguém automatizou a
 * afirmação — e a tela passa a mentir sobre caixa.
 */
// O corte é ATRIBUIÇÃO, não comparação. A primeira versão deste teste pegava
// `WHERE r.status = 'pago'` em fin_reimbursement — uma leitura, de outra tabela
// — e acusava falso. `SET status =` e `status:` em literal são escrita; `WHERE`
// não é.
const marcamPago = [];
const inseremExecucao = [];
for (const c of ARQUIVOS) {
  const src = ler(c);
  // Escopo: só arquivos que tocam a ORDEM DE PAGAMENTO. `status: "pago"` existe
  // legitimamente em reembolso (fin_reimbursement) e em outros domínios — a
  // segunda versão deste teste acusou `FinReimbursements.tsx` por isso.
  if (src.includes('fin_payment_request') || src.includes('contas-a-pagar/programar')) {
    const escreveuPago =
      /SET\s+status\s*=\s*'pago(_parcial)?'/i.test(src) || /\bstatus:\s*['"]pago(_parcial)?['"]/.test(src);
    if (escreveuPago) marcamPago.push(c);
  }
  if (/INSERT\s+INTO\s+fin_payment_execution/i.test(src)) inseremExecucao.push(c);
}
afirma(
  marcamPago.length === 0,
  "nenhum arquivo da ordem de pagamento ESCREVE status = 'pago'",
  marcamPago.join(', ') || 'nenhum arquivo'
);

// E o inverso, para o teste não passar por não achar nada: os estados que o
// código REALMENTE escreve em fin_payment_request têm de estar na lista curta.
const ESTADOS_PERMITIDOS = new Set(['rascunho', 'aguardando_autorizacao', 'cancelada', 'rejeitada']);
const escritos = new Set();
for (const c of ARQUIVOS) {
  const src = ler(c);
  if (!src.includes('fin_payment_request')) continue;
  for (const m of src.matchAll(/SET\s+status\s*=\s*'([a-z_]+)'/gi)) escritos.add(m[1]);
  for (const m of src.matchAll(/valor:\s*"([a-z_]+)"\s*}/g)) escritos.add(m[1]);
}
const fora = [...escritos].filter((e) => !ESTADOS_PERMITIDOS.has(e));
afirma(
  fora.length === 0,
  `os estados escritos estão na lista curta (${[...escritos].join(', ') || 'nenhum'})`,
  fora.join(', ') || 'nenhum fora'
);
afirma(
  inseremExecucao.length === 0,
  'nenhuma tela ou rota insere em fin_payment_execution',
  inseremExecucao.join(', ') || 'nenhum arquivo'
);

/*
 * A EXCEÇÃO, E POR QUE ELA É MAIS FORTE QUE A PROIBIÇÃO.
 *
 * Existe UM lugar que registra execução: `scripts/conciliar-pagamentos.mjs`. E
 * ele não afirma nada — ele CASA. Só grava quando as três coisas existem: a
 * ordem com `codigoSolicitacao`, a transação com o mesmo código no extrato, e a
 * linha já importada em `fin_transaction`. Sem a terceira, não grava.
 *
 * Depois disso o status vira 'pago' SOZINHO: o gatilho
 * `fin_pagamento_refresh_pago` (0075:860) recalcula `paid_cents` e conclui. Ou
 * seja, "pago" nunca é uma afirmação do nosso código — é uma consequência de
 * uma linha de extrato existir.
 */
const conciliador = 'scripts/conciliar-pagamentos.mjs';
const scriptsQueInserem = varrer('scripts').filter((c) =>
  /INSERT\s+INTO\s+fin_payment_execution/i.test(ler(c))
);
afirma(
  scriptsQueInserem.length === 1 && scriptsQueInserem[0] === conciliador,
  'só o conciliador registra execução',
  scriptsQueInserem.join(', ') || 'nenhum'
);

const src = ler(conciliador);
afirma(
  /transaction_id/.test(src) && /dedupe_hash/.test(src),
  'o conciliador exige a linha do extrato (transaction_id casado por dedupe_hash)'
);
afirma(
  !/SET\s+status\s*=\s*'pago/i.test(src),
  "o conciliador não escreve 'pago' — quem conclui é o gatilho, a partir da evidência"
);
afirma(
  src.includes("--aplicar"),
  'o conciliador é seco por padrão: registrar execução exige --aplicar'
);

/*
 * O ÚNICO estado que o envio produz. Se um dia isto virar 'pago' ou 'aprovada',
 * o produto passou a afirmar coisa que não sabe.
 */
const escrita = ler('lib/financeiro/pagar-programar.ts');
const estadosEscritos = [...escrita.matchAll(/SET\s+status\s*=\s*'([a-z_]+)'/gi)].map((m) => m[1]);
afirma(
  estadosEscritos.every((e) => e === 'aguardando_autorizacao'),
  'o envio só move para aguardando_autorizacao',
  estadosEscritos.join(', ') || 'nenhum'
);
afirma(
  !/paid_cents\s*=/.test(escrita),
  'nada escreve paid_cents à mão (é mantido por gatilho a partir da execução)'
);

console.log('\n=== 3. AMBIENTE: duas travas, e uma delas é produção ===');

const guarda = adapter.slice(adapter.indexOf('export function pagamentoInterHabilitado'));
const corpo = guarda.slice(0, guarda.indexOf('\n}\n') + 1);
afirma(
  corpo.includes("NODE_ENV") && corpo.includes("production"),
  'a trava recusa quando NODE_ENV é production'
);
afirma(
  corpo.includes('INTER_PAGAMENTO_LOCAL'),
  'a trava exige INTER_PAGAMENTO_LOCAL ligado explicitamente'
);

// A trava não vale nada se alguém abrir socket sem chamá-la.
const abrePorta = adapter.includes('httpsRequest(') || adapter.includes('request(');
afirma(abrePorta && adapter.includes('exigirHabilitado()'), 'quem abre socket chama a trava antes');

/*
 * As credenciais de pagamento são SEPARADAS das de leitura. Se o adapter usasse
 * INTER_CLIENT_ID, um escopo de pagamento acrescentado à integração de extrato
 * derrubaria o sync inteiro — e é o risco que
 * docs/integracao-bancaria-open-finance-e-inter.md:150 registra.
 */
afirma(
  !/INTER_CLIENT_ID|INTER_CERT_PATH|INTER_KEY_PATH/.test(adapter.replace(/INTER_PAG_[A-Z_]+/g, '')),
  'o adapter não toca nas credenciais de LEITURA'
);
afirma(adapter.includes('INTER_PAG_CLIENT_ID'), 'usa credencial própria de pagamento');

console.log('\n=== 4. A superfície de escrita bancária é UM arquivo ===');

// Qualquer outro arquivo falando com o host do Inter é caminho novo que
// ninguém revisou.
const HOST = 'cdpj.partners.bancointer.com.br';
const falamComOInter = ARQUIVOS.filter((c) => ler(c).includes(HOST));
afirma(
  falamComOInter.length === 1 && falamComOInter[0] === 'lib/financeiro/inter-pagamento.ts',
  'só lib/financeiro/inter-pagamento.ts fala com o Inter em lib/, app/ e components/',
  falamComOInter.join(', ') || 'nenhum'
);

console.log(
  falhas
    ? `\n${falhas} falha(s). A garantia de "não paga sem aprovação" NÃO está de pé.\n`
    : '\n✅ a plataforma cria a ordem e para. Quem aprova é uma pessoa, no aplicativo do banco.\n'
);
process.exit(falhas ? 1 : 0);

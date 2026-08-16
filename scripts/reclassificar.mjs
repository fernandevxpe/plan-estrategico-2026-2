// Reclassificação em lote do ledger — reversível por construção.
//
// O PROBLEMA QUE ESTE ARQUIVO RESOLVE
// -----------------------------------
// A classificação GRAVADA em fin_transaction e a classificação que o motor de
// regras decidiria HOJE não são a mesma coisa, e a distância entre as duas só
// cresce: as migrations 0020/0021/0023 mudaram regras depois que os lançamentos
// já estavam classificados, e `scripts/import-inter.mjs` grava sem rodar o
// motor nenhuma vez.
//
// Sem este script existem só duas saídas, ambas ruins: deixar o número errado
// no lugar, ou esperar a próxima reimportação aplicar tudo de uma vez, sem
// revisão, sem lote e sem volta. Este arquivo é a terceira: aplicar de
// propósito, em fatias, com trilha, e com um botão de desfazer que foi testado
// antes de ser preciso.
//
// O REQUISITO NÚMERO UM É REVERSIBILIDADE — e ela não é uma promessa no README:
//
//   · toda execução tem um `lote` (uuid) e grava o estado ANTERIOR de cada linha
//     em fin_audit_log (`before`/`after`) e em fin_classification_event
//     (`superseded_value`);
//   · `--reverter=<lote>` restaura a partir dessa trilha, e recusa-se a reverter
//     linha que alguém tocou depois do lote (o `after` gravado tem de bater com
//     o estado atual) — desfazer não pode atropelar trabalho humano;
//   · o DRY-RUN, que é o padrão, executa o ciclo INTEIRO dentro de uma transação
//     — aplica, confere o dinheiro, reverte, confere a soma de controle — e
//     termina em ROLLBACK. Ou seja: o caminho de escrita e o caminho de desfazer
//     são exercitados de verdade a cada preview, contra o dado real, antes de
//     alguém digitar `--aplicar`. Preview e lote não podem divergir porque são
//     literalmente o mesmo código.
//
// INVARIANTES (as mesmas de scripts/import-asaas.mjs:450-500 — convenção do
// módulo, repetida aqui de propósito, porque são elas que impedem um lote de
// desfazer o trabalho de quem revisou):
//
//   · `human_locked_fields` nunca é sobrescrito;
//   · `review_status` 'adiado' e 'ignorado' são decisão humana e vencem;
//   · `transfer_status='pareado'` nunca é rebaixado;
//   · `classified_by='humano'` nunca é substituído por regra;
//   · a soma de amount_cents por conta NÃO muda — reclassificar não move
//     dinheiro. Provado com número antes/depois em toda execução, inclusive no
//     dry-run, e a divergência aborta a transação.
//
// USO
//   node scripts/reclassificar.mjs                        # dry-run de tudo (padrão)
//   node scripts/reclassificar.mjs --conta=inter          # dry-run de uma fatia
//   node scripts/reclassificar.mjs --conta=inter --desde=2026-01-01
//   node scripts/reclassificar.mjs --conta=inter --aplicar # grava (uma transação)
//   node scripts/reclassificar.mjs --lotes                # lotes já aplicados
//   node scripts/reclassificar.mjs --reverter=<lote>      # desfaz um lote inteiro
//   node scripts/reclassificar.mjs --reverter=<lote> --dry-run
//
// Fatias: `--conta` e `--desde` existem porque reclassificar 13.765 linhas num
// golpe é como a plataforma se machuca. `--ate` e `--limite` completam o corte.

import { randomUUID } from 'node:crypto';

import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { classify } from './lib/fin-rules.mjs';
import { normalizeName } from './lib/fin-normalize.mjs';
import { registerFinanceTypeParsers } from './lib/fin-types.mjs';

loadEnv();
registerFinanceTypeParsers();

const ENTITY = 'xpe';
const ATOR = 'script:reclassificar';

// ---------------------------------------------------------------------------
// Argumentos
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (nome) => argv.includes(`--${nome}`);
const valor = (nome) => {
  const hit = argv.find((a) => a.startsWith(`--${nome}=`));
  return hit ? hit.slice(nome.length + 3) : null;
};

const opcoes = {
  aplicar: flag('aplicar'),
  dryRun: flag('dry-run'),
  reverter: valor('reverter'),
  lotes: flag('lotes'),
  forcar: flag('forcar'),
  conta: valor('conta'),
  desde: valor('desde'),
  ate: valor('ate'),
  limite: valor('limite') ? Number(valor('limite')) : null,
  top: valor('top') ? Number(valor('top')) : 20
};

const desconhecidas = argv.filter(
  (a) => !/^--(aplicar|dry-run|lotes|forcar|reverter|conta|desde|ate|limite|top|ajuda|help)(=|$)/.test(a)
);
if (desconhecidas.length || flag('ajuda') || flag('help')) {
  if (desconhecidas.length) console.error(`[reclassificar] opção desconhecida: ${desconhecidas.join(', ')}\n`);
  console.log(
    [
      'uso: node scripts/reclassificar.mjs [opções]',
      '',
      '  (sem opções)        DRY-RUN: aplica, confere, reverte e faz ROLLBACK. Não grava.',
      '  --aplicar           grava, dentro de UMA transação, com lote e trilha de desfazer',
      '  --reverter=<lote>   desfaz um lote inteiro a partir da trilha',
      '  --lotes             lista os lotes já aplicados',
      '',
      '  --conta=<slug>      fatia por conta (asaas, nubank, inter, ...)',
      '  --desde=YYYY-MM-DD  fatia por data (posted_on >=)',
      '  --ate=YYYY-MM-DD    fatia por data (posted_on <=)',
      '  --limite=<n>        no máximo n lançamentos, os mais antigos primeiro',
      '  --top=<n>           quantas trocas listar para conferência (padrão 20)',
      '  --forcar            no --reverter: desfaz mesmo o que mudou depois do lote',
      '  --dry-run           explícito; no --reverter, previsualiza a reversão'
    ].join('\n')
  );
  process.exit(desconhecidas.length ? 1 : 0);
}

if (opcoes.aplicar && opcoes.dryRun) {
  console.error('[reclassificar] --aplicar e --dry-run juntos não fazem sentido. Escolha um.');
  process.exit(1);
}
for (const [nome, data] of [['desde', opcoes.desde], ['ate', opcoes.ate]]) {
  if (data && !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    console.error(`[reclassificar] --${nome} precisa ser YYYY-MM-DD (recebido: ${data})`);
    process.exit(1);
  }
}
if (opcoes.limite !== null && (!Number.isInteger(opcoes.limite) || opcoes.limite <= 0)) {
  console.error('[reclassificar] --limite precisa ser inteiro positivo');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Formatação
// ---------------------------------------------------------------------------
const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const n = (v) => Number(v || 0).toLocaleString('pt-BR');
const corta = (t, max) => (String(t ?? '').length > max ? `${String(t).slice(0, max - 1)}…` : String(t ?? ''));

/** Tabela de largura fixa. Colunas: {titulo, campo, largura, dir}. */
function tabela(colunas, linhas) {
  if (!linhas.length) return '  (nenhuma)';
  const larg = colunas.map((c) => Math.max(c.titulo.length, ...linhas.map((l) => String(l[c.campo] ?? '').length)));
  const linha = (celulas) =>
    '  ' + celulas.map((v, i) => (colunas[i].dir === 'r' ? String(v).padStart(larg[i]) : String(v).padEnd(larg[i]))).join('  ');
  return [
    linha(colunas.map((c) => c.titulo)),
    '  ' + larg.map((w) => '─'.repeat(w)).join('  '),
    ...linhas.map((l) => linha(colunas.map((c) => l[c.campo] ?? '')))
  ].join('\n');
}

const titulo = (t) => `\n${'━'.repeat(78)}\n${t}\n${'━'.repeat(78)}`;

// ---------------------------------------------------------------------------
// O sujeito que o motor avalia
// ---------------------------------------------------------------------------
/**
 * Um lançamento → sujeito do avaliador. ÚNICO lugar que faz essa tradução neste
 * arquivo, pelo mesmo motivo de lib/financeiro/regras.ts: montado em dois
 * lugares, um dia o preview diz "mudaria 187" e o lote muda 184.
 *
 * A forma segue scripts/import-asaas.mjs:396 campo a campo — é o importador
 * canônico, e reclassificar tem de responder "o que o motor decidiria hoje", não
 * "o que um motor parecido decidiria".
 *
 * Duas diferenças, ambas para MAIS informação: `counterparty_name_norm` vem do
 * cadastro (o Asaas passa vazio porque não tem contraparte no extrato),
 * `counterparty_document` vem do lastro do lançamento com o cadastro como
 * fallback (ver SQL_LINHAS), e `account_slug` vem da conta real.
 *
 * ATENÇÃO — desde a 0042 isso deixou de ser teórico. A regra
 * `transferencia-cnpj-proprio` usa `counterparty_document`, e nenhum dos dois
 * importadores passa esse campo ao motor: `lib/financeiro/importacao.ts` (CSV)
 * monta um sujeito com quatro campos, e `scripts/import-inter.mjs` não roda o
 * motor nenhuma vez — ele resolve o CNPJ próprio no próprio código, comparando
 * com `fin_entity.cnpj`, e grava `transfer_status='em_transito'` direto.
 *
 * Na prática as duas decisões coincidem, porque leem a MESMA evidência (o
 * documento vindo de `lib/inter-lastro.mjs`). Mas o relatório continua avisando
 * a cada execução, e o aviso segue válido: no dia em que uma fonte com
 * documento passar pelo importador de CSV, os dois caminhos vão discordar e
 * alguém precisa decidir qual dos dois muda.
 */
function sujeitoDeTransacao(linha) {
  return {
    scope: 'transaction',
    description_norm: linha.description_norm,
    counterparty_name_norm: linha.counterparty_name_norm || normalizeName(linha.counterparty_raw),
    counterparty_document: linha.counterparty_document,
    account_slug: linha.conta,
    amount_cents: linha.amount_cents,
    amount_abs: Math.abs(linha.amount_cents),
    source_kind: linha.source_kind,
    billing_type: null,
    direction: linha.amount_cents >= 0 ? 'receber' : 'pagar',
    day_of_month: linha.day_of_month
  };
}

/**
 * Qual estágio classificou, de verdade. Cópia deliberada de
 * scripts/import-asaas.mjs:119: 'fato_estrutural' significa "veio da fonte,
 * confiável sem revisão", e carimbar isso num palpite de texto esvazia a
 * distinção — foi o que a 0023 teve de desfazer à mão.
 */
const estagioDe = (hit) => (hit.rationale.campo === 'source_kind' ? 'fato_estrutural' : 'regra');

/** Regras que estouraram durante o lote — precisam aparecer, não sumir. */
const regrasQuebradas = new Map();
const registrarRegraQuebrada = ({ rule_id, name, erro }) => regrasQuebradas.set(rule_id, { name, erro });

// ---------------------------------------------------------------------------
// Proteções: quem NÃO pode ser tocado, e por quê
// ---------------------------------------------------------------------------
/** Colunas que este script escreve. Trava em qualquer uma delas protege a linha. */
const COLUNAS_ESCRITAS = [
  'category_id',
  'nucleo',
  'transfer_status',
  'transfer_group_id',
  'classified_by',
  'classified_rule_id',
  'classified_reason',
  'classified_at',
  'review_status'
];

/**
 * Campos comparados para decidir se a linha MUDOU.
 *
 * `classified_reason` fica de fora de propósito: o rationale carrega
 * `tambem_casaram` e offsets, que mudam quando qualquer regra vizinha muda de
 * prioridade. Incluí-lo faria toda linha parecer alterada e afogaria as trocas
 * de categoria — que são o que importa — em ruído. Ele é gravado e é revertido,
 * só não é critério.
 */
const CAMPOS_COMPARADOS = ['category_id', 'nucleo', 'transfer_status', 'classified_by', 'classified_rule_id', 'review_status'];

/**
 * Por que esta linha está fora do alcance do motor. `null` = elegível.
 *
 * A ordem importa só para o relatório (a primeira razão é a reportada); o efeito
 * é o mesmo em qualquer uma: a linha não é tocada.
 */
function protecao(linha) {
  const travados = linha.human_locked_fields ?? [];
  if (travados.some((campo) => COLUNAS_ESCRITAS.includes(campo))) return 'trava_humana';
  // 'adiado'/'ignorado' são decisão humana sobre a FILA, não sobre a categoria.
  if (['adiado', 'ignorado'].includes(linha.review_status)) return 'revisao_humana';
  // 'humano' e 'trava' são a pessoa; 'contrato' é herança do documento
  // liquidado, que é um sinal mais forte que texto de extrato — foi o que
  // resgatou 3.023 PAYMENT_RECEIVED de "sem categoria" (import-asaas.mjs:540).
  if (['humano', 'trava', 'contrato'].includes(linha.classified_by)) return 'classificado_por_humano';
  // A MESMA herança, reconhecida pelo FATO e não pelo carimbo.
  //
  // São 2.673 linhas (R$ 3,53 mi) que têm categoria, têm liquidação apontando
  // para um documento, e não têm regra nenhuma no `classified_rule_id`: a
  // categoria veio da cobrança que o dinheiro pagou. O carimbo 'contrato' se
  // perdeu em algum ciclo de reimportação, e confiar só nele deixaria essas
  // linhas expostas — no dia em que uma regra de texto casar com "cobranca
  // recebida fatura nr", a receita da empresa inteira seria reclassificada por
  // uma palavra-chave, por cima da verdade que está no documento.
  //
  // "O dinheiro que entrou pertence à categoria do serviço que o gerou" é
  // conceitualmente certo, não um remendo — e vence texto de extrato.
  if (linha.tem_liquidacao && linha.category_id !== null && linha.classified_rule_id === null) return 'heranca_de_documento';
  // 'pareado' é conciliação fechada com a outra ponta. Rebaixar devolveria a
  // dupla contagem de receita e despesa.
  if (linha.transfer_status === 'pareado') return 'transferencia_pareada';
  // Rateio é decisão humana: o pai é o extrato, os filhos carregam a categoria.
  if (linha.is_split_parent || linha.parent_id !== null) return 'rateio';
  return null;
}

// ---------------------------------------------------------------------------
// A decisão
// ---------------------------------------------------------------------------
/**
 * O que o motor faria com esta linha, e de que tipo é a mudança.
 *
 * Tipos, em ordem de risco:
 *   trocar        já tinha categoria e o motor quer OUTRA — é o que pode mover
 *                 dinheiro entre linhas da DRE, e o que precisa de olho humano;
 *   preencher     estava sem categoria e passa a ter — risco baixo, é ganho;
 *   metadados     categoria igual, muda núcleo/regra/estágio/fila;
 *   orfa          o motor não explica mais a categoria que está gravada;
 *   sem_regra     nenhuma regra casa e a linha também não tem categoria;
 *   igual         nada a fazer.
 */
function decidir(linha, regras, categoriaPorCodigo) {
  const hit = classify(regras, sujeitoDeTransacao(linha), { onRuleError: registrarRegraQuebrada });

  if (!hit) {
    // NÃO apagamos categoria por ausência de regra.
    //
    // A 0023 fez isso e estava certa — mas fez com um WHERE escrito à mão,
    // sabendo exatamente quais 96 linhas e por quê. Um script genérico que
    // limpa categoria sempre que uma regra deixa de casar apaga, no dia em que
    // alguém arquiva uma regra, toda a classificação que ela produziu. Aqui
    // essas linhas viram RELATÓRIO ("órfãs") e a decisão volta para uma pessoa.
    return { tipo: linha.category_id === null ? 'sem_regra' : 'orfa', hit: null, alvo: null };
  }

  const acoes = hit.actions ?? {};
  const categoriaId = acoes.category_code ? (categoriaPorCodigo.get(acoes.category_code) ?? null) : null;
  if (acoes.category_code && categoriaId === null) {
    // Regra aponta para um código que não existe no plano de contas. Silenciar
    // isso classificaria a linha como "sem categoria" e a regra ficaria quebrada
    // e invisível — o mesmo erro que `onRuleError` existe para evitar.
    return { tipo: 'regra_sem_categoria', hit, alvo: null };
  }

  // Núcleo nunca é apagado: COALESCE, igual aos dois importadores.
  const nucleo = acoes.nucleo ?? linha.nucleo;

  // ------------------------------------------------------------ transferência
  // Promover é fácil; REBAIXAR é onde mora o perigo, e a regra é estreita:
  // só se rebaixa 'em_transito' quando o próprio motor o colocou lá, isto é,
  // quando a regra gravada na linha dizia `transfer:true` e a regra vencedora de
  // hoje não diz mais. As 113 linhas 'em_transito' sem `classified_rule_id`
  // (R$ 994 mil) vêm de FATO da fonte — o CNPJ próprio detectado pelo import do
  // Inter (import-inter.mjs:114) e a migration 0022 — e rebaixá-las devolveria
  // transferência entre contas próprias para dentro da despesa.
  let transferStatus = linha.transfer_status;
  let transferGroupId = linha.transfer_group_id;
  if (acoes.transfer === true) {
    if (linha.transfer_status === 'nao') transferStatus = 'em_transito';
  } else if (linha.transfer_status === 'em_transito' && linha.classified_rule_id !== null) {
    const regraAnterior = regras.find((r) => r.id === linha.classified_rule_id);
    // Grupo preenchido = pareamento em andamento com a outra ponta. Some com o
    // grupo e a outra perna fica órfã; isso é conciliação, não classificação.
    if (regraAnterior?.actions?.transfer === true && linha.transfer_group_id === null) {
      transferStatus = 'nao';
      transferGroupId = null;
    }
  }

  // A fila: 'pendente' quando não há categoria, quando a confiança é palpite
  // (<80, o corte de lib/financeiro/importacao.ts) ou quando a própria regra
  // pede revisão. Palpite bom continua sendo palpite.
  const confianca = hit.confidence ?? 0;
  const precisaRevisao = categoriaId === null || confianca < 80 || acoes.review === true;

  const alvo = {
    category_id: categoriaId ?? linha.category_id,
    nucleo,
    transfer_status: transferStatus,
    transfer_group_id: transferGroupId,
    classified_by: estagioDe(hit),
    classified_rule_id: hit.rule.id,
    classified_reason: { ...hit.rationale, origem: 'reclassificar' },
    review_status: precisaRevisao ? 'pendente' : 'ok'
  };

  const mudou = CAMPOS_COMPARADOS.filter((campo) => (linha[campo] ?? null) !== (alvo[campo] ?? null));
  if (!mudou.length) return { tipo: 'igual', hit, alvo, mudou };

  let tipo = 'metadados';
  if (linha.category_id === null && alvo.category_id !== null) tipo = 'preencher';
  else if (linha.category_id !== null && alvo.category_id !== linha.category_id) tipo = 'trocar';

  return { tipo, hit, alvo, mudou };
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------
/**
 * `classified_at::text` e não `classified_at`, e isto NÃO é detalhe.
 *
 * timestamptz do Postgres tem microssegundo; o Date do JS tem milissegundo. Um
 * `before` que passa pelo Date perde os microssegundos, e a reversão devolve um
 * carimbo PARECIDO em vez do original — a soma de controle não fecha e a prova
 * de que o desfazer é exato deixa de existir. Lido como texto, o valor
 * atravessa a trilha inteira sem tocar em Date.
 */
const SELECT_ESTADO = {
  fin_transaction:
    'category_id, nucleo, transfer_status, transfer_group_id, classified_by, classified_rule_id, ' +
    'classified_reason, classified_at::text AS classified_at, review_status',
  fin_review_item: 'status, resolved_at::text AS resolved_at, resolved_by'
};

const SQL_LINHAS = `
  SELECT t.id, t.entity_id, a.slug AS conta, t.posted_on, t.amount_cents,
         t.description_raw, t.description_norm, t.counterparty_raw, t.source_kind,
         t.category_id, t.nucleo, t.transfer_status, t.transfer_group_id,
         t.classified_by, t.classified_rule_id, t.classified_reason,
         t.classified_at::text AS classified_at,
         t.review_status, t.human_locked_fields, t.is_split_parent, t.parent_id,
         COALESCE(cp.normalized_name, '') AS counterparty_name_norm,
         -- O LASTRO DO LANCAMENTO VEM PRIMEIRO, O CADASTRO E O FALLBACK.
         --
         -- t.counterparty_document (0042) e o que a FONTE afirmou sobre esta
         -- transacao; cp.document_number e o CADASTRO da contraparte ligada.
         -- A ordem importa no caso central da A3: transferencia entre contas
         -- proprias tem counterparty_id NULO de proposito (a empresa nao e
         -- contraparte de si mesma), entao o cadastro nao tem o que oferecer e
         -- so o lastro responde. Sem este COALESCE a regra
         -- transferencia-cnpj-proprio nunca casaria: leria sempre nulo
         -- justamente nas linhas que existe para reconhecer.
         --
         -- Onde os dois existem, eles concordam: medido em 15/08/2026, nas 504
         -- linhas do Inter com contraparte cadastrada com documento, cadastro e
         -- extrato batem em 504 de 504.
         COALESCE(t.counterparty_document, cp.document_number) AS counterparty_document,
         EXTRACT(DAY FROM t.posted_on)::int AS day_of_month,
         EXISTS (SELECT 1 FROM fin_settlement s WHERE s.transaction_id = t.id) AS tem_liquidacao
    FROM fin_transaction t
    JOIN fin_account a ON a.id = t.account_id
    JOIN fin_entity e ON e.id = t.entity_id
    LEFT JOIN fin_counterparty cp ON cp.id = t.counterparty_id
   WHERE e.slug = $1
     AND ($2::text IS NULL OR a.slug = $2)
     AND ($3::date IS NULL OR t.posted_on >= $3)
     AND ($4::date IS NULL OR t.posted_on <= $4)
   ORDER BY t.posted_on, t.id`;

/**
 * A prova de que reclassificar não move dinheiro.
 *
 * Sobre a tabela INTEIRA, não sobre a fatia: um script que só confere o que
 * mexeu não perceberia um gatilho tocando o resto.
 */
const SQL_DINHEIRO = `
  SELECT a.slug, count(*)::int AS linhas, COALESCE(sum(t.amount_cents), 0) AS soma
    FROM fin_account a LEFT JOIN fin_transaction t ON t.account_id = a.id
   GROUP BY a.slug ORDER BY a.slug`;

/**
 * Soma de controle das colunas afetadas.
 *
 * É o que transforma "reverti" em "provei que voltou idêntico". Cobre exatamente
 * as colunas que este script escreve, na ordem do id.
 */
const SQL_HASH = `
  SELECT COALESCE(md5(string_agg(
           t.id || '|' || COALESCE(t.category_id::text, '~') || '|' || COALESCE(t.nucleo, '~') || '|' ||
           t.transfer_status || '|' || COALESCE(t.transfer_group_id, '~') || '|' ||
           COALESCE(t.classified_by, '~') || '|' || COALESCE(t.classified_rule_id::text, '~') || '|' ||
           COALESCE(t.classified_reason::text, '~') || '|' ||
           COALESCE(t.classified_at::text, '~') || '|' || t.review_status,
           E'\\n' ORDER BY t.id)), 'vazio') AS hash,
         count(*)::int AS linhas
    FROM fin_transaction t WHERE t.id = ANY($1::bigint[])`;

/** Colunas restauráveis por tabela. O revert é genérico: lê a trilha e reescreve. */
const RESTAURAVEIS = {
  fin_transaction: COLUNAS_ESCRITAS,
  fin_review_item: ['status', 'resolved_at', 'resolved_by']
};

/**
 * O UPDATE em massa e o UPDATE de restauração leem do MESMO desenho: um jsonb
 * com o estado desejado. Escrever a atribuição uma vez só é o que garante que
 * aplicar e desfazer não tratem uma coluna de formas diferentes — a assimetria
 * entre os dois caminhos é exatamente o que faz um "desfazer" deixar resíduo.
 */
const ATRIBUICAO = {
  fin_transaction: (fonte) => `
     category_id        = (${fonte}->>'category_id')::bigint,
     nucleo             = ${fonte}->>'nucleo',
     transfer_status    = ${fonte}->>'transfer_status',
     transfer_group_id  = ${fonte}->>'transfer_group_id',
     classified_by      = ${fonte}->>'classified_by',
     classified_rule_id = (${fonte}->>'classified_rule_id')::bigint,
     classified_reason  = NULLIF(${fonte}->'classified_reason', 'null'::jsonb),
     classified_at      = (${fonte}->>'classified_at')::timestamptz,
     review_status      = ${fonte}->>'review_status',
     updated_at         = now()`,
  fin_review_item: (fonte) => `
     status      = ${fonte}->>'status',
     resolved_at = (${fonte}->>'resolved_at')::timestamptz,
     resolved_by = ${fonte}->>'resolved_by'`
};

/**
 * Grava as decisões em UM comando por lote de linhas.
 *
 * `unnest` de dois arrays paralelos em vez de um UPDATE por linha: são centenas
 * de linhas com destinos distintos (o rationale carrega o trecho que casou, que
 * é diferente em cada uma), e uma viagem de rede por linha é o que torna lento o
 * que a avaliação das regras faz em memória num piscar.
 */
const SQL_APLICA = `
  UPDATE fin_transaction t SET ${ATRIBUICAO.fin_transaction('d.alvo')}
    FROM unnest($1::bigint[], $2::jsonb[]) AS d(id, alvo)
   WHERE t.id = d.id
   RETURNING t.id, ${SELECT_ESTADO.fin_transaction}`;

const SQL_RESTAURA = {
  fin_transaction: `UPDATE fin_transaction SET ${ATRIBUICAO.fin_transaction('$2::jsonb')} WHERE id = $1 RETURNING ${SELECT_ESTADO.fin_transaction}`,
  fin_review_item: `UPDATE fin_review_item SET ${ATRIBUICAO.fin_review_item('$2::jsonb')} WHERE id = $1 RETURNING ${SELECT_ESTADO.fin_review_item}`
};

// ---------------------------------------------------------------------------
// Utilitários de escrita
// ---------------------------------------------------------------------------
/** INSERT multi-linha em pedaços — 65 mil parâmetros é o teto do protocolo. */
async function insertBatched(client, sqlHead, sqlTail, columns, rows, onChunk) {
  const maxRows = Math.max(1, Math.min(500, Math.floor(60_000 / columns)));
  for (let start = 0; start < rows.length; start += maxRows) {
    const chunk = rows.slice(start, start + maxRows);
    const placeholders = chunk
      .map((_, r) => `(${Array.from({ length: columns }, (_, c) => `$${r * columns + c + 1}`).join(',')})`)
      .join(',');
    const result = await client.query(`${sqlHead} VALUES ${placeholders} ${sqlTail}`, chunk.flat());
    if (onChunk) onChunk(result);
  }
}

/** Só as colunas que a trilha precisa guardar de um lançamento. */
const instantaneo = (linha) => Object.fromEntries(COLUNAS_ESCRITAS.map((c) => [c, linha[c] ?? null]));

/** Compara dois instantâneos e devolve os campos diferentes. */
function diferencas(antes, depois, colunas) {
  return colunas.filter((c) => JSON.stringify(antes[c] ?? null) !== JSON.stringify(depois[c] ?? null));
}

// ---------------------------------------------------------------------------
// Aplicar
// ---------------------------------------------------------------------------
/**
 * Escreve as mudanças e a trilha, dentro da transação já aberta pelo chamador.
 *
 * O UPDATE é agrupado por DESTINO idêntico (um comando por decisão, não por
 * linha) porque o trabalho pesado é a viagem de rede — mesma razão de
 * lib/financeiro/importacao.ts:660. A trilha, essa é por linha: é o `before` de
 * cada uma que torna o desfazer possível.
 *
 * O `after` gravado vem do RETURNING, nunca do que pretendíamos escrever. Se um
 * gatilho (fin_preserve_human_locks, ligado abaixo) recusar parte da mudança, a
 * trilha registra o que o banco de fato tem — uma trilha que descreve a intenção
 * e não o resultado faz o desfazer mentir.
 */
async function aplicar(client, { mudancas, lote, filaPorAlvo, entityId }) {
  // Rede de segurança de banco, além das nossas cláusulas: com sync_mode ligado,
  // fin_preserve_human_locks reverte qualquer coluna travada por humano.
  await client.query(`SET LOCAL fin.sync_mode = 'on'`);

  // Um lote de reclassificação por vez. Dois processos escrevendo as mesmas
  // linhas produziriam duas trilhas que se sobrepõem e um desfazer que restaura
  // um estado que nunca existiu.
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['fin_reclassificar']);

  // `classified_at` é o único campo que não vem da decisão: é agora, e tem de
  // ser o MESMO agora para o lote inteiro, senão duas linhas do mesmo lote
  // contam histórias com segundos diferentes.
  const {
    rows: [{ agora }]
  } = await client.query('SELECT now()::text AS agora');

  const depoisPorId = new Map();
  const PEDACO = 1000;
  for (let i = 0; i < mudancas.length; i += PEDACO) {
    const pedaco = mudancas.slice(i, i + PEDACO);
    const { rows } = await client.query(SQL_APLICA, [
      pedaco.map((m) => m.linha.id),
      pedaco.map((m) => JSON.stringify({ ...m.alvo, classified_at: agora }))
    ]);
    for (const row of rows) depoisPorId.set(row.id, row);
  }

  // ------------------------------------------------------------------ trilha
  const auditoria = [];
  const eventos = [];
  const recusadas = [];

  for (const m of mudancas) {
    const depois = depoisPorId.get(m.linha.id);
    if (!depois) throw new Error(`linha ${m.linha.id} não voltou do UPDATE — abortando o lote`);
    const antes = instantaneo(m.linha);
    const depoisSnap = instantaneo(depois);
    const campos = diferencas(antes, depoisSnap, COLUNAS_ESCRITAS);
    // Gatilho de trava devolveu a linha ao que era: a decisão não passou. A
    // trilha ainda registra o que de fato mudou (carimbo e rationale), mas a
    // linha entra no relatório como recusada — silenciar isso faria o lote
    // dizer que classificou o que não classificou.
    if (!diferencas(antes, depoisSnap, CAMPOS_COMPARADOS).length) recusadas.push(m.linha.id);
    if (!campos.length) continue;

    auditoria.push([
      entityId,
      'fin_transaction',
      m.linha.id,
      'bulk_update',
      JSON.stringify(antes),
      JSON.stringify(depoisSnap),
      campos,
      lote,
      ATOR
    ]);

    eventos.push([
      'fin_transaction',
      m.linha.id,
      depoisSnap.classified_by,
      depoisSnap.classified_rule_id,
      depoisSnap.category_id,
      depoisSnap.nucleo,
      m.hit?.confidence ?? null,
      JSON.stringify({ ...(m.hit?.rationale ?? {}), lote, tipo: m.tipo, origem: 'reclassificar' }),
      // `accepted` mede se a máquina está acertando. Uma reclassificação que
      // TROCA uma categoria já gravada é, por definição, a máquina discordando
      // do que estava lá — e é exatamente esse sinal que a coluna existe para
      // capturar. Preencher vazio não desmente ninguém.
      m.tipo !== 'trocar',
      JSON.stringify(antes),
      ATOR
    ]);
  }

  await insertBatched(
    client,
    `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, before, after, fields, batch_id, actor)`,
    '',
    9,
    auditoria
  );
  await insertBatched(
    client,
    `INSERT INTO fin_classification_event
       (target_table, target_id, stage, rule_id, category_id, nucleo, confidence, rationale, accepted, superseded_value, actor)`,
    '',
    11,
    eventos
  );

  // --------------------------------------------------------------- fila
  // Linha 'pendente' sem item de fila é trabalho invisível; item 'pendente' de
  // linha já classificada é fila inflada. As duas coisas corroem a confiança no
  // número, e a 0023 já teve de corrigir a primeira à mão. Cada toque na fila
  // entra na MESMA trilha do lote — o desfazer é genérico e restaura os dois.
  const fila = await sincronizarFila(client, { mudancas, depoisPorId, filaPorAlvo, lote });

  // Cabeçalho do lote, por ÚLTIMO: é ele que `--lotes` lista e que `--reverter`
  // exige para reconhecer o lote como seu. `target_id = 0` porque o alvo é o
  // lote inteiro, não uma linha — fin_audit_log não restringe target_table.
  await client.query(
    `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, after, batch_id, actor)
     VALUES ($1, 'fin_reclassificacao', 0, 'bulk_update', $2::jsonb, $3, $4)`,
    [
      entityId,
      JSON.stringify({
        lote,
        filtros: { conta: opcoes.conta, desde: opcoes.desde, ate: opcoes.ate, limite: opcoes.limite },
        mudancas: auditoria.length,
        por_tipo: mudancas.reduce((acc, m) => ({ ...acc, [m.tipo]: (acc[m.tipo] ?? 0) + 1 }), {}),
        fila
      }),
      lote,
      ATOR
    ]
  );

  return { atualizadas: auditoria.length, recusadas, fila };
}

/**
 * Reflete a nova classificação em fin_review_item.
 *
 * `UNIQUE (target_table, target_id)` garante no máximo um item por lançamento,
 * então é atualizar-ou-inserir, sem ambiguidade. Itens 'adiado'/'ignorado' não
 * são tocados: é a mesma decisão humana que já protege a linha.
 */
async function sincronizarFila(client, { mudancas, depoisPorId, filaPorAlvo, lote }) {
  const atualizacoes = [];
  const insercoes = [];

  for (const m of mudancas) {
    const depois = depoisPorId.get(m.linha.id);
    if (!depois) continue;
    const desejado = depois.review_status === 'ok' ? 'resolvido' : 'pendente';
    const item = filaPorAlvo.get(m.linha.id);

    if (!item) {
      if (desejado === 'pendente') insercoes.push(m);
      continue;
    }
    if (['adiado', 'ignorado'].includes(item.status)) continue;
    if (item.status === desejado) continue;
    atualizacoes.push({ item, desejado, linha: m.linha });
  }

  // Em conjunto, não linha a linha. O motivo é medido: são ~700 itens de fila
  // numa fatia média, e uma viagem de rede por item transformava um dry-run de
  // segundos numa espera de minutos — tempo suficiente para alguém pular o
  // preview, que é a única defesa que este script oferece antes do lote.
  const trilhaFila = [];

  if (atualizacoes.length) {
    const { rows } = await client.query(
      // `novo_status` e não `status`: com a coluna do unnest homônima da coluna
      // da tabela, o RETURNING fica ambíguo e o Postgres recusa o comando.
      `UPDATE fin_review_item i
          SET status = d.novo_status,
              resolved_at = CASE WHEN d.novo_status = 'resolvido' THEN now() ELSE NULL END,
              resolved_by = CASE WHEN d.novo_status = 'resolvido' THEN $3 ELSE NULL END
         FROM unnest($1::bigint[], $2::text[]) AS d(id, novo_status)
        WHERE i.id = d.id
        RETURNING i.id, i.status, i.resolved_at::text AS resolved_at, i.resolved_by`,
      [atualizacoes.map((a) => a.item.id), atualizacoes.map((a) => a.desejado), ATOR]
    );
    const depoisPorItem = new Map(rows.map((r) => [Number(r.id), r]));
    for (const { item, linha } of atualizacoes) {
      const depois = depoisPorItem.get(item.id);
      if (!depois) continue;
      const antes = { status: item.status, resolved_at: item.resolved_at, resolved_by: item.resolved_by };
      item.status = depois.status;
      trilhaFila.push([
        linha.entity_id,
        'fin_review_item',
        item.id,
        'update',
        JSON.stringify(antes),
        JSON.stringify({ status: depois.status, resolved_at: depois.resolved_at, resolved_by: depois.resolved_by }),
        diferencas(antes, depois, RESTAURAVEIS.fin_review_item),
        lote,
        ATOR
      ]);
    }
  }

  if (insercoes.length) {
    const novos = insercoes.map((m) => {
      const depois = depoisPorId.get(m.linha.id);
      return [
        m.linha.entity_id,
        'fin_transaction',
        m.linha.id,
        depois.category_id === null ? 'sem_categoria' : 'baixa_confianca',
        m.linha.amount_cents,
        'pendente'
      ];
    });
    const criados = [];
    await insertBatched(
      client,
      `INSERT INTO fin_review_item (entity_id, target_table, target_id, reason, amount_cents, status)`,
      'ON CONFLICT (target_table, target_id) DO NOTHING RETURNING id, entity_id, target_id, reason',
      6,
      novos,
      (r) => criados.push(...r.rows)
    );
    for (const item of criados) {
      trilhaFila.push([
        item.entity_id,
        'fin_review_item',
        item.id,
        'insert',
        null,
        JSON.stringify({ target_id: Number(item.target_id), reason: item.reason, status: 'pendente' }),
        ['status'],
        lote,
        ATOR
      ]);
      filaPorAlvo.set(Number(item.target_id), { id: item.id, status: 'pendente', resolved_at: null, resolved_by: null });
    }
  }

  await insertBatched(
    client,
    `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, before, after, fields, batch_id, actor)`,
    '',
    9,
    trilhaFila
  );

  return { atualizados: atualizacoes.length, criados: trilhaFila.filter((t) => t[3] === 'insert').length };
}

// ---------------------------------------------------------------------------
// Reverter
// ---------------------------------------------------------------------------
/**
 * Desfaz um lote inteiro a partir da trilha, dentro da transação do chamador.
 *
 * Duas recusas deliberadas, porque desfazer sem elas é pior que não desfazer:
 *
 *   · linha cujo estado atual não bate com o `after` gravado foi tocada por
 *     alguém DEPOIS do lote. Restaurar apagaria esse trabalho sem avisar. Ela é
 *     listada e pulada — `--forcar` para quem sabe o que está fazendo;
 *   · a mesma trava humana continua ligada (fin.sync_mode), então uma coluna
 *     travada depois do lote não é restaurada, e isso aparece no relatório.
 */
async function reverter(client, lote, { forcar = false } = {}) {
  await client.query(`SET LOCAL fin.sync_mode = 'on'`);
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['fin_reclassificar']);

  // `fin_audit_log.batch_id` é compartilhado com o resto da plataforma: o sync do
  // Asaas e a tela gravam lotes ali com o mesmo tipo de id. Reverter um deles
  // por engano seria catastrófico — o `before` de um lote de importação é NULL,
  // e "restaurar" NULL em cima de um lançamento é apagá-lo pela metade.
  //
  // Por isso o desfazer só reconhece um lote SEU: tem de existir o cabeçalho
  // 'fin_reclassificacao' com o mesmo ator, e só linhas desse ator são tocadas.
  const { rows: cabecalho } = await client.query(
    `SELECT after FROM fin_audit_log
      WHERE batch_id = $1 AND target_table = 'fin_reclassificacao' AND actor = $2`,
    [lote, ATOR]
  );
  if (!cabecalho.length) {
    throw new Error(
      `${lote} não é um lote de reclassificação (nenhum cabeçalho de '${ATOR}'). ` +
        'Lotes de importação e de tela têm outro formato e NÃO podem ser desfeitos por aqui.'
    );
  }

  const { rows: trilha } = await client.query(
    `SELECT id, entity_id, target_table, target_id, action, before, after, fields
       FROM fin_audit_log
      WHERE batch_id = $1 AND actor = $2 AND undone_at IS NULL AND target_table <> 'fin_reclassificacao'
      ORDER BY id DESC
      FOR UPDATE`,
    [lote, ATOR]
  );

  const resultado = { restauradas: 0, fila: 0, puladas: [], incompletas: [], removidas: 0 };
  const loteReversao = randomUUID();
  if (!trilha.length) return { ...resultado, lote_reversao: loteReversao, trilha: 0 };

  for (const registro of trilha) {
    if (registro.target_table !== 'fin_reclassificacao' && !RESTAURAVEIS[registro.target_table]) {
      throw new Error(`trilha aponta para tabela sem regra de restauração: ${registro.target_table}`);
    }
  }

  // Itens de fila que o lote CRIOU: desfazer é apagá-los.
  const criados = trilha.filter((r) => r.action === 'insert');
  if (criados.length) {
    await client.query('DELETE FROM fin_review_item WHERE id = ANY($1::bigint[])', [criados.map((r) => r.target_id)]);
    resultado.removidas = criados.length;
  }

  const desfeitos = criados.map((r) => r.id);
  const auditoriaReversao = [];
  const eventos = [];

  // Por tabela e em conjunto: uma leitura, uma escrita, uma trilha. Reverter é
  // o caminho que alguém percorre com pressa, depois de perceber que aplicou
  // demais — ele não pode ser o mais lento dos dois.
  for (const tabela of Object.keys(RESTAURAVEIS)) {
    const registros = trilha.filter((r) => r.target_table === tabela && r.action !== 'insert');
    if (!registros.length) continue;
    const colunas = RESTAURAVEIS[tabela];

    const { rows: atuais } = await client.query(
      `SELECT id, ${SELECT_ESTADO[tabela]} FROM ${tabela} WHERE id = ANY($1::bigint[]) FOR UPDATE`,
      [registros.map((r) => r.target_id)]
    );
    const atualPorId = new Map(atuais.map((r) => [Number(r.id), r]));

    const restaurar = [];
    for (const registro of registros) {
      const atual = atualPorId.get(Number(registro.target_id));
      if (!atual) {
        resultado.puladas.push({ tabela, id: registro.target_id, motivo: 'linha não existe mais' });
        continue;
      }
      const divergente = diferencas(atual, registro.after ?? {}, colunas);
      if (divergente.length && !forcar) {
        resultado.puladas.push({ tabela, id: registro.target_id, motivo: `alterada depois do lote em ${divergente.join(', ')}` });
        continue;
      }
      restaurar.push({ registro, atual });
    }
    if (!restaurar.length) continue;

    const { rows: voltaram } = await client.query(
      `UPDATE ${tabela} t SET ${ATRIBUICAO[tabela]('d.antes')}
         FROM unnest($1::bigint[], $2::jsonb[]) AS d(id, antes)
        WHERE t.id = d.id
        RETURNING t.id, ${SELECT_ESTADO[tabela]}`,
      [restaurar.map((r) => Number(r.registro.target_id)), restaurar.map((r) => JSON.stringify(r.registro.before))]
    );
    const voltouPorId = new Map(voltaram.map((r) => [Number(r.id), r]));

    for (const { registro, atual } of restaurar) {
      const depois = voltouPorId.get(Number(registro.target_id));
      if (!depois) throw new Error(`${tabela} #${registro.target_id} não voltou do UPDATE de restauração — abortando`);

      // O que a trava humana impediu de restaurar. Não é erro do desfazer: é
      // alguém tendo travado a linha depois do lote, e o relatório precisa
      // dizer isso em vez de declarar "revertido" sobre um estado misto.
      const sobrou = diferencas(depois, registro.before ?? {}, colunas);
      if (sobrou.length) resultado.incompletas.push({ tabela, id: registro.target_id, campos: sobrou });

      desfeitos.push(registro.id);
      auditoriaReversao.push([
        registro.entity_id,
        tabela,
        registro.target_id,
        'rollback',
        JSON.stringify(Object.fromEntries(colunas.map((c) => [c, atual[c] ?? null]))),
        JSON.stringify(Object.fromEntries(colunas.map((c) => [c, depois[c] ?? null]))),
        registro.fields,
        loteReversao,
        ATOR
      ]);

      if (tabela === 'fin_transaction') {
        resultado.restauradas += 1;
        // Evento de classificação só quando há classificação para descrever. Uma
        // linha que volta a NÃO ter estágio não tem evento honesto a registrar —
        // e `stage` é NOT NULL com CHECK fechado; inventar 'default' ali seria
        // gravar mentira numa tabela cujo propósito é ser verdade auditável.
        if (depois.classified_by) {
          eventos.push([
            'fin_transaction',
            registro.target_id,
            depois.classified_by,
            depois.classified_rule_id,
            depois.category_id,
            depois.nucleo,
            JSON.stringify({ motivo: 'reversão de lote', lote, lote_reversao: loteReversao }),
            false,
            JSON.stringify(Object.fromEntries(colunas.map((c) => [c, atual[c] ?? null]))),
            ATOR
          ]);
        }
      } else {
        resultado.fila += 1;
      }
    }
  }

  await client.query('UPDATE fin_audit_log SET undone_at = now() WHERE id = ANY($1::bigint[])', [desfeitos]);
  await insertBatched(
    client,
    `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, before, after, fields, batch_id, actor)`,
    '',
    9,
    auditoriaReversao
  );
  await insertBatched(
    client,
    `INSERT INTO fin_classification_event
       (target_table, target_id, stage, rule_id, category_id, nucleo, rationale, accepted, superseded_value, actor)`,
    '',
    10,
    eventos
  );

  // Fecha o cabeçalho do lote revertido — mas só quando ele foi desfeito por
  // inteiro. Um lote com linhas puladas continua "aplicado" na listagem, que é
  // a verdade: parte dele ainda está no banco.
  if (!resultado.puladas.length) {
    await client.query(
      `UPDATE fin_audit_log SET undone_at = now()
        WHERE batch_id = $1 AND target_table = 'fin_reclassificacao' AND undone_at IS NULL`,
      [lote]
    );
  }

  return { ...resultado, lote_reversao: loteReversao, trilha: trilha.length };
}

// ---------------------------------------------------------------------------
// Relatório
// ---------------------------------------------------------------------------
function relatorio({ linhas, decisoes, mudancas, categorias, regras, protegidas, dinheiroAntes, dinheiroDepois, hashes, resultado, reversao }) {
  const out = [];
  const nomeCategoria = (id) => (id === null || id === undefined ? '—' : (categorias.get(id)?.rotulo ?? `#${id}`));
  const nomeRegra = (id) => (id === null || id === undefined ? '(sem regra)' : (regras.find((r) => r.id === id)?.slug ?? `#${id}`));
  const soma = (lista) => lista.reduce((acc, m) => acc + Math.abs(m.linha.amount_cents), 0);

  const porTipo = new Map();
  for (const d of decisoes) {
    if (!porTipo.has(d.tipo)) porTipo.set(d.tipo, []);
    porTipo.get(d.tipo).push(d);
  }
  const lista = (tipo) => porTipo.get(tipo) ?? [];

  // ------------------------------------------------------------------ escopo
  out.push(titulo('1. ESCOPO'));
  out.push(
    `  filtros ......... conta=${opcoes.conta ?? 'todas'} · desde=${opcoes.desde ?? '—'} · ate=${opcoes.ate ?? '—'} · limite=${opcoes.limite ?? '—'}`
  );
  out.push(`  lançamentos ..... ${n(linhas.length)} na fatia`);
  out.push(`  elegíveis ....... ${n(decisoes.length)}`);
  out.push(`  protegidos ...... ${n(linhas.length - decisoes.length)}`);
  out.push('');
  out.push(
    tabela(
      [
        { titulo: 'proteção', campo: 'motivo' },
        { titulo: 'linhas', campo: 'linhas', dir: 'r' },
        { titulo: 'R$ (abs)', campo: 'valor', dir: 'r' }
      ],
      [...protegidas.entries()].map(([motivo, ls]) => ({
        motivo,
        linhas: n(ls.length),
        valor: brl(ls.reduce((a, l) => a + Math.abs(l.amount_cents), 0))
      }))
    )
  );

  // ------------------------------------------------------------- o que muda
  out.push(titulo('2. O QUE MUDARIA HOJE'));
  const ordemTipos = ['trocar', 'preencher', 'metadados', 'orfa', 'sem_regra', 'regra_sem_categoria', 'igual'];
  const legenda = {
    trocar: 'TROCA de categoria (risco alto)',
    preencher: 'ganha categoria (estava sem)',
    metadados: 'só metadados (núcleo/regra/estágio/fila)',
    orfa: 'órfã: motor não explica mais a categoria gravada',
    sem_regra: 'nenhuma regra casa, e segue sem categoria',
    regra_sem_categoria: 'regra casou mas aponta código inexistente',
    igual: 'nada muda'
  };
  out.push(
    tabela(
      [
        { titulo: 'tipo', campo: 'tipo' },
        { titulo: 'linhas', campo: 'linhas', dir: 'r' },
        { titulo: 'R$ (abs)', campo: 'valor', dir: 'r' },
        { titulo: 'o que é', campo: 'legenda' }
      ],
      ordemTipos
        .filter((t) => lista(t).length)
        .map((t) => ({ tipo: t, linhas: n(lista(t).length), valor: brl(soma(lista(t))), legenda: legenda[t] }))
    )
  );
  out.push('');
  out.push(`  → GRAVARIA: ${n(mudancas.length)} lançamentos, ${brl(soma(mudancas))} em jogo.`);
  out.push(`    ${n(lista('trocar').length)} trocam de categoria · ${n(lista('preencher').length)} ganham categoria · ${n(lista('metadados').length)} só metadados.`);

  // "Só metadados" não é sinônimo de inofensivo: uma mudança de `review_status`
  // move a linha para dentro ou para fora da fila de revisão, e é isso que
  // decide se alguém vai olhar para ela. Vale abrir campo a campo.
  out.push('');
  out.push('  Campo a campo — quantas linhas de cada mudança tocam cada coluna:');
  const porCampo = new Map();
  for (const m of mudancas) {
    for (const campo of m.mudou ?? []) {
      if (!porCampo.has(campo)) porCampo.set(campo, []);
      porCampo.get(campo).push(m);
    }
  }
  out.push(
    tabela(
      [
        { titulo: 'coluna', campo: 'coluna' },
        { titulo: 'linhas', campo: 'linhas', dir: 'r' },
        { titulo: 'R$ (abs)', campo: 'valor', dir: 'r' },
        { titulo: 'de → para (top 3)', campo: 'exemplos' }
      ],
      [...porCampo.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .map(([coluna, ms]) => {
          const mostrar = (v) =>
            coluna === 'category_id' ? corta(nomeCategoria(v), 22) : coluna === 'classified_rule_id' ? nomeRegra(v) : (v ?? '—');
          const pares = new Map();
          for (const m of ms) {
            const chave = `${mostrar(m.linha[coluna])} → ${mostrar(m.alvo[coluna])}`;
            pares.set(chave, (pares.get(chave) ?? 0) + 1);
          }
          return {
            coluna,
            linhas: n(ms.length),
            valor: brl(soma(ms)),
            exemplos: corta(
              [...pares.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(([p, q]) => `${p} (${q})`)
                .join(' · '),
              78
            )
          };
        })
    )
  );

  // -------------------------------------------------------------- por conta
  out.push(titulo('3. POR CONTA'));
  const contas = new Map();
  for (const m of mudancas) {
    if (!contas.has(m.linha.conta)) contas.set(m.linha.conta, []);
    contas.get(m.linha.conta).push(m);
  }
  out.push(
    tabela(
      [
        { titulo: 'conta', campo: 'conta' },
        { titulo: 'muda', campo: 'muda', dir: 'r' },
        { titulo: 'trocar', campo: 'trocar', dir: 'r' },
        { titulo: 'preencher', campo: 'preencher', dir: 'r' },
        { titulo: 'metadados', campo: 'metadados', dir: 'r' },
        { titulo: 'R$ (abs)', campo: 'valor', dir: 'r' },
        { titulo: 'na fatia', campo: 'total', dir: 'r' }
      ],
      [...contas.entries()]
        .sort((a, b) => soma(b[1]) - soma(a[1]))
        .map(([conta, ms]) => ({
          conta,
          muda: n(ms.length),
          trocar: n(ms.filter((m) => m.tipo === 'trocar').length),
          preencher: n(ms.filter((m) => m.tipo === 'preencher').length),
          metadados: n(ms.filter((m) => m.tipo === 'metadados').length),
          valor: brl(soma(ms)),
          total: n(linhas.filter((l) => l.conta === conta).length)
        }))
    )
  );

  // -------------------------------------------------------------- por regra
  out.push(titulo('4. POR REGRA VENCEDORA'));
  const porRegra = new Map();
  for (const m of mudancas) {
    const id = m.alvo.classified_rule_id;
    if (!porRegra.has(id)) porRegra.set(id, []);
    porRegra.get(id).push(m);
  }
  out.push(
    tabela(
      [
        { titulo: 'id', campo: 'id', dir: 'r' },
        { titulo: 'regra', campo: 'regra' },
        { titulo: 'prio', campo: 'prio', dir: 'r' },
        { titulo: 'conf', campo: 'conf', dir: 'r' },
        { titulo: 'linhas', campo: 'linhas', dir: 'r' },
        { titulo: 'trocar', campo: 'trocar', dir: 'r' },
        { titulo: 'preench', campo: 'preencher', dir: 'r' },
        { titulo: 'R$ (abs)', campo: 'valor', dir: 'r' }
      ],
      [...porRegra.entries()]
        .sort((a, b) => soma(b[1]) - soma(a[1]))
        .map(([id, ms]) => {
          const r = regras.find((x) => x.id === id);
          return {
            id: id ?? '—',
            regra: corta(r?.slug ?? '(sem regra)', 36),
            prio: r?.priority ?? '—',
            conf: r?.confidence ?? '—',
            linhas: n(ms.length),
            trocar: n(ms.filter((m) => m.tipo === 'trocar').length),
            preencher: n(ms.filter((m) => m.tipo === 'preencher').length),
            valor: brl(soma(ms))
          };
        })
    )
  );

  // ----------------------------------------------------------- por categoria
  out.push(titulo('5. POR CATEGORIA DE DESTINO'));
  const porCategoria = new Map();
  for (const m of mudancas) {
    const id = m.alvo.category_id;
    if (!porCategoria.has(id)) porCategoria.set(id, []);
    porCategoria.get(id).push(m);
  }
  out.push(
    tabela(
      [
        { titulo: 'categoria destino', campo: 'cat' },
        { titulo: 'linhas', campo: 'linhas', dir: 'r' },
        { titulo: 'trocar', campo: 'trocar', dir: 'r' },
        { titulo: 'preench', campo: 'preencher', dir: 'r' },
        { titulo: 'R$ (abs)', campo: 'valor', dir: 'r' },
        { titulo: 'saldo R$', campo: 'saldo', dir: 'r' }
      ],
      [...porCategoria.entries()]
        .sort((a, b) => soma(b[1]) - soma(a[1]))
        .map(([id, ms]) => ({
          cat: corta(nomeCategoria(id), 42),
          linhas: n(ms.length),
          trocar: n(ms.filter((m) => m.tipo === 'trocar').length),
          preencher: n(ms.filter((m) => m.tipo === 'preencher').length),
          valor: brl(soma(ms)),
          saldo: brl(ms.reduce((a, m) => a + m.linha.amount_cents, 0))
        }))
    )
  );

  // ----------------------------------------------------- matriz de trocas
  if (!lista('trocar').length) {
    out.push(titulo('6. MATRIZ DAS TROCAS (de → para)'));
    out.push('  Nenhuma troca de categoria nesta fatia — nada sai de uma linha da DRE para');
    out.push('  outra. É o resultado que dá para aplicar com menos medo, e é ele que precisa');
    out.push('  ser reconferido a cada mudança de regra: troca é o que move número.');
  } else {
    out.push(titulo('6. MATRIZ DAS TROCAS (de → para)'));
    const matriz = new Map();
    for (const m of lista('trocar')) {
      const chave = `${m.linha.category_id}→${m.alvo.category_id}`;
      if (!matriz.has(chave)) matriz.set(chave, { de: m.linha.category_id, para: m.alvo.category_id, ms: [] });
      matriz.get(chave).ms.push(m);
    }
    out.push(
      tabela(
        [
          { titulo: 'de', campo: 'de' },
          { titulo: 'para', campo: 'para' },
          { titulo: 'linhas', campo: 'linhas', dir: 'r' },
          { titulo: 'R$ (abs)', campo: 'valor', dir: 'r' }
        ],
        [...matriz.values()]
          .sort((a, b) => soma(b.ms) - soma(a.ms))
          .map((e) => ({
            de: corta(nomeCategoria(e.de), 34),
            para: corta(nomeCategoria(e.para), 34),
            linhas: n(e.ms.length),
            valor: brl(soma(e.ms))
          }))
      )
    );

  }

  // A lista de conferência existe SEMPRE. Sem troca, ela mostra os maiores
  // preenchimentos — porque "ganhou categoria" também precisa de alguém dizendo
  // "sim, R$ 300 mil de PIX enviado é folha" antes de virar DRE.
  const paraConferir = lista('trocar').length ? lista('trocar') : lista('preencher');
  out.push(
    titulo(
      lista('trocar').length
        ? `7. AS ${opcoes.top} MAIORES TROCAS — CONFERÊNCIA HUMANA`
        : `7. OS ${opcoes.top} MAIORES PREENCHIMENTOS — CONFERÊNCIA HUMANA (não há trocas)`
    )
  );
  out.push(
    tabela(
      [
        { titulo: 'id', campo: 'id', dir: 'r' },
        { titulo: 'conta', campo: 'conta' },
        { titulo: 'data', campo: 'data' },
        { titulo: 'R$', campo: 'valor', dir: 'r' },
        { titulo: 'de', campo: 'de' },
        { titulo: 'para', campo: 'para' },
        { titulo: 'regra', campo: 'regra' },
        { titulo: 'conf', campo: 'conf', dir: 'r' },
        { titulo: 'descrição', campo: 'desc' }
      ],
      [...paraConferir]
        .sort((a, b) => Math.abs(b.linha.amount_cents) - Math.abs(a.linha.amount_cents))
        .slice(0, opcoes.top)
        .map((m) => ({
          id: m.linha.id,
          conta: m.linha.conta,
          data: m.linha.posted_on,
          valor: brl(m.linha.amount_cents),
          de: corta(nomeCategoria(m.linha.category_id), 24),
          para: corta(nomeCategoria(m.alvo.category_id), 24),
          regra: corta(nomeRegra(m.alvo.classified_rule_id), 24),
          conf: m.hit?.confidence ?? '—',
          desc: corta(m.linha.description_raw, 44)
        }))
    )
  );

  // ------------------------------------------------------------ sem regra
  out.push(titulo('8. O QUE O MOTOR NÃO ALCANÇA'));
  const semRegra = lista('sem_regra');
  const orfas = lista('orfa');
  out.push(`  sem regra e sem categoria ... ${n(semRegra.length)} linhas · ${brl(semRegra.reduce((a, d) => a + Math.abs(d.linha.amount_cents), 0))}`);
  out.push(`  órfãs (categoria sem regra) .. ${n(orfas.length)} linhas · ${brl(orfas.reduce((a, d) => a + Math.abs(d.linha.amount_cents), 0))}`);
  out.push('  Nenhuma das duas é tocada por este script. Órfã não perde a categoria:');
  out.push('  apagar classificação por ausência de regra é destrutivo e precisa de');
  out.push('  decisão humana caso a caso (foi o que a migration 0023 fez, à mão).');

  if (semRegra.length) {
    out.push('');
    out.push('  As descrições sem regra que mais valem — candidatas a regra nova:');
    const porTexto = new Map();
    for (const d of semRegra) {
      const chave = d.linha.description_norm.split(' ').slice(0, 6).join(' ') || '(vazia)';
      if (!porTexto.has(chave)) porTexto.set(chave, []);
      porTexto.get(chave).push(d);
    }
    out.push(
      tabela(
        [
          { titulo: 'início da descrição normalizada', campo: 'texto' },
          { titulo: 'linhas', campo: 'linhas', dir: 'r' },
          { titulo: 'R$ (abs)', campo: 'valor', dir: 'r' }
        ],
        [...porTexto.entries()]
          .map(([texto, ds]) => ({ texto, ds, v: ds.reduce((a, d) => a + Math.abs(d.linha.amount_cents), 0) }))
          .sort((a, b) => b.v - a.v)
          .slice(0, 12)
          .map((e) => ({ texto: corta(e.texto, 52), linhas: n(e.ds.length), valor: brl(e.v) }))
      )
    );
  }

  // ---------------------------------------------------------- invariantes
  out.push(titulo('9. INVARIANTES'));
  const linhasDinheiro = dinheiroAntes.map((a) => {
    const d = dinheiroDepois.find((x) => x.slug === a.slug) ?? { soma: 0, linhas: 0 };
    return {
      conta: a.slug,
      antes: brl(a.soma),
      depois: brl(d.soma),
      delta: brl(Number(d.soma) - Number(a.soma)),
      ok: Number(d.soma) === Number(a.soma) && d.linhas === a.linhas ? 'OK' : 'DIVERGIU'
    };
  });
  out.push('  Soma de amount_cents por conta — reclassificar não move dinheiro:');
  out.push(
    tabela(
      [
        { titulo: 'conta', campo: 'conta' },
        { titulo: 'antes', campo: 'antes', dir: 'r' },
        { titulo: 'depois', campo: 'depois', dir: 'r' },
        { titulo: 'delta', campo: 'delta', dir: 'r' },
        { titulo: '', campo: 'ok' }
      ],
      linhasDinheiro
    )
  );
  out.push('');
  out.push(`  human_locked_fields respeitados ..... ${n((protegidas.get('trava_humana') ?? []).length)} linhas fora do alcance`);
  out.push(`  'adiado'/'ignorado' respeitados ..... ${n((protegidas.get('revisao_humana') ?? []).length)} linhas fora do alcance`);
  out.push(`  classified_by='humano' respeitado ... ${n((protegidas.get('classificado_por_humano') ?? []).length)} linhas fora do alcance`);
  out.push(`  transfer_status='pareado' intocado .. ${n((protegidas.get('transferencia_pareada') ?? []).length)} linhas fora do alcance`);

  if (hashes) {
    out.push('');
    out.push('  Ciclo aplicar → reverter, soma de controle das colunas afetadas:');
    out.push(`    antes do lote ..... ${hashes.antes}`);
    out.push(`    depois do lote .... ${hashes.depois}  ${hashes.depois === hashes.antes ? '(nada mudou?!)' : '(mudou, como esperado)'}`);
    if (hashes.revertido) {
      out.push(`    depois de reverter  ${hashes.revertido}  ${hashes.revertido === hashes.antes ? '← IDÊNTICO AO ORIGINAL' : '← DIVERGIU'}`);
    }
  }

  if (resultado) {
    out.push('');
    out.push(`  gravadas ......... ${n(resultado.atualizadas)} linhas`);
    out.push(`  fila de revisão .. ${n(resultado.fila.atualizados)} itens atualizados, ${n(resultado.fila.criados)} criados`);
    if (resultado.recusadas.length) {
      out.push(`  recusadas pelo gatilho de trava: ${resultado.recusadas.join(', ')}`);
    }
  }
  if (reversao) {
    out.push('');
    out.push(`  reversão ......... ${n(reversao.restauradas)} lançamentos, ${n(reversao.fila)} itens de fila, ${n(reversao.removidas)} itens removidos`);
    if (reversao.puladas.length) out.push(`  puladas .......... ${n(reversao.puladas.length)}`);
    if (reversao.incompletas.length) out.push(`  incompletas ...... ${n(reversao.incompletas.length)}`);
  }

  if (regrasQuebradas.size) {
    out.push(titulo('REGRAS QUEBRADAS — não classificaram nada e precisam de conserto'));
    for (const [id, info] of regrasQuebradas) out.push(`  #${id} ${info.name}: ${info.erro}`);
  }

  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Fluxos
// ---------------------------------------------------------------------------
async function fluxoListarLotes(client) {
  const { rows } = await client.query(
    `SELECT batch_id, created_at, undone_at, after
       FROM fin_audit_log
      WHERE target_table = 'fin_reclassificacao'
      ORDER BY created_at DESC LIMIT 50`
  );
  console.log(titulo('LOTES DE RECLASSIFICAÇÃO'));
  console.log(
    tabela(
      [
        { titulo: 'lote', campo: 'lote' },
        { titulo: 'quando', campo: 'quando' },
        { titulo: 'linhas', campo: 'linhas', dir: 'r' },
        { titulo: 'fatia', campo: 'fatia' },
        { titulo: 'estado', campo: 'estado' }
      ],
      rows.map((r) => ({
        lote: r.batch_id,
        quando: new Date(r.created_at).toISOString().slice(0, 19).replace('T', ' '),
        linhas: n(r.after?.mudancas ?? 0),
        fatia: `conta=${r.after?.filtros?.conta ?? 'todas'} desde=${r.after?.filtros?.desde ?? '—'}`,
        estado: r.undone_at ? 'REVERTIDO' : 'aplicado'
      }))
    )
  );
}

async function fluxoReverter(client) {
  const dry = opcoes.dryRun;
  await client.query('BEGIN');
  try {
    const dinheiroAntes = (await client.query(SQL_DINHEIRO)).rows;
    const resultado = await reverter(client, opcoes.reverter, { forcar: opcoes.forcar });
    if (!resultado.trilha) throw new Error(`lote ${opcoes.reverter} não tem trilha pendente — já revertido, ou id errado`);

    const dinheiroDepois = (await client.query(SQL_DINHEIRO)).rows;
    for (const antes of dinheiroAntes) {
      const depois = dinheiroDepois.find((d) => d.slug === antes.slug);
      if (Number(antes.soma) !== Number(depois?.soma)) {
        throw new Error(`INVARIANTE VIOLADA na reversão: soma da conta ${antes.slug} mudou. Transação abortada.`);
      }
    }

    console.log(titulo(`REVERSÃO DO LOTE ${opcoes.reverter}`));
    console.log(`  trilha .......... ${n(resultado.trilha)} registros`);
    console.log(`  lançamentos ..... ${n(resultado.restauradas)} restaurados`);
    console.log(`  fila de revisão . ${n(resultado.fila)} restaurados, ${n(resultado.removidas)} removidos`);
    console.log(`  lote da reversão  ${resultado.lote_reversao}`);
    if (resultado.puladas.length) {
      console.log('\n  PULADAS — alteradas depois do lote (use --forcar para atropelar):');
      console.log(
        tabela(
          [
            { titulo: 'tabela', campo: 'tabela' },
            { titulo: 'id', campo: 'id', dir: 'r' },
            { titulo: 'motivo', campo: 'motivo' }
          ],
          resultado.puladas.slice(0, 40)
        )
      );
    }
    if (resultado.incompletas.length) {
      console.log('\n  INCOMPLETAS — trava humana impediu a restauração de algum campo:');
      for (const i of resultado.incompletas.slice(0, 20)) console.log(`    ${i.tabela} #${i.id}: ${i.campos.join(', ')}`);
    }

    if (dry) {
      await client.query('ROLLBACK');
      console.log('\n  DRY-RUN: a reversão foi executada e desfeita com ROLLBACK. Nada gravado.');
    } else {
      await client.query('COMMIT');
      console.log('\n  COMMIT: lote revertido.');
    }
  } catch (erro) {
    await client.query('ROLLBACK');
    throw erro;
  }
}

async function fluxoReclassificar(client) {
  const aplicando = opcoes.aplicar;

  await client.query('BEGIN');
  try {
    // Tudo — leitura, decisão, escrita, conferência e (no dry-run) a reversão —
    // acontece DENTRO desta transação. É o que garante que o preview e o lote
    // sejam o mesmo código percorrendo o mesmo dado, e não duas aproximações.
    const {
      rows: [entidade]
    } = await client.query('SELECT id FROM fin_entity WHERE slug = $1', [ENTITY]);
    if (!entidade) throw new Error(`entidade '${ENTITY}' não encontrada`);

    if (opcoes.conta) {
      const { rows } = await client.query('SELECT 1 FROM fin_account a JOIN fin_entity e ON e.id = a.entity_id WHERE a.slug = $1 AND e.slug = $2', [
        opcoes.conta,
        ENTITY
      ]);
      if (!rows.length) throw new Error(`conta '${opcoes.conta}' não existe`);
    }

    // Todas as regras ativas, e é `classify` que descarta as de escopo errado —
    // exatamente como scripts/import-asaas.mjs:163. Filtrar aqui abriria uma
    // segunda definição de "quais regras valem".
    const { rows: regras } = await client.query(
      `SELECT id, slug, name, priority, match_scope, conditions, actions, confidence
         FROM fin_rule WHERE status = 'ativa' ORDER BY priority, id`
    );
    const { rows: cats } = await client.query(
      `SELECT c.id, c.code, c.name FROM fin_category c JOIN fin_entity e ON e.id = c.entity_id WHERE e.slug = $1`,
      [ENTITY]
    );
    const categoriaPorCodigo = new Map(cats.map((c) => [c.code, c.id]));
    const categorias = new Map(cats.map((c) => [c.id, { ...c, rotulo: `${c.code} ${c.name}` }]));

    const sql = `${SQL_LINHAS}${opcoes.limite ? ` LIMIT ${opcoes.limite}` : ''}${aplicando ? ' FOR UPDATE OF t' : ''}`;
    const { rows: linhas } = await client.query(sql, [ENTITY, opcoes.conta, opcoes.desde, opcoes.ate]);
    if (!linhas.length) throw new Error('a fatia não tem nenhum lançamento — confira --conta/--desde/--ate');

    const filaPorAlvo = new Map();
    const { rows: itens } = await client.query(
      `SELECT id, target_id, status, resolved_at, resolved_by FROM fin_review_item
        WHERE target_table = 'fin_transaction' AND target_id = ANY($1::bigint[])`,
      [linhas.map((l) => l.id)]
    );
    for (const item of itens) filaPorAlvo.set(Number(item.target_id), item);

    // ------------------------------------------------------------- decidir
    const protegidas = new Map();
    const decisoes = [];
    for (const linha of linhas) {
      const motivo = protecao(linha);
      if (motivo) {
        if (!protegidas.has(motivo)) protegidas.set(motivo, []);
        protegidas.get(motivo).push(linha);
        continue;
      }
      const decisao = decidir(linha, regras, categoriaPorCodigo);
      decisoes.push({ ...decisao, linha });
    }
    const mudancas = decisoes.filter((d) => ['trocar', 'preencher', 'metadados'].includes(d.tipo));

    // ------------------------------------------------------------- aplicar
    const ids = mudancas.map((m) => m.linha.id);
    const lote = randomUUID();
    const dinheiroAntes = (await client.query(SQL_DINHEIRO)).rows;
    const hashAntes = (await client.query(SQL_HASH, [ids])).rows[0].hash;

    let resultado = null;
    let hashDepois = hashAntes;
    let reversao = null;

    if (mudancas.length) {
      resultado = await aplicar(client, { mudancas, lote, filaPorAlvo, entityId: entidade.id });
      hashDepois = (await client.query(SQL_HASH, [ids])).rows[0].hash;
    }

    const dinheiroDepois = (await client.query(SQL_DINHEIRO)).rows;
    for (const antes of dinheiroAntes) {
      const depois = dinheiroDepois.find((d) => d.slug === antes.slug);
      if (Number(antes.soma) !== Number(depois?.soma) || antes.linhas !== depois?.linhas) {
        throw new Error(
          `INVARIANTE VIOLADA: soma/contagem da conta ${antes.slug} mudou (${brl(antes.soma)} → ${brl(depois?.soma)}). Transação abortada, nada gravado.`
        );
      }
    }

    // ------------------------------------------------ provar que dá para voltar
    let hashRevertido = null;
    if (!aplicando && mudancas.length) {
      reversao = await reverter(client, lote);
      hashRevertido = (await client.query(SQL_HASH, [ids])).rows[0].hash;
    }

    // -------------------------------------------------------------- avisar
    const camposExtras = ['counterparty_name_norm', 'counterparty_document', 'account_slug'];
    const usamExtras = regras.filter((r) =>
      ['all', 'any', 'none'].some((b) => (r.conditions?.[b] ?? []).some((c) => camposExtras.includes(c.field)))
    );

    console.log(
      relatorio({
        linhas,
        decisoes,
        mudancas,
        categorias,
        regras,
        protegidas,
        dinheiroAntes,
        dinheiroDepois,
        hashes: mudancas.length ? { antes: hashAntes, depois: hashDepois, revertido: hashRevertido } : null,
        resultado,
        reversao
      })
    );

    if (usamExtras.length) {
      console.log(titulo('ATENÇÃO — DIVERGÊNCIA POSSÍVEL ENTRE ESTE SCRIPT E OS IMPORTADORES'));
      console.log('  Estas regras usam campos que lib/financeiro/importacao.ts NÃO passa ao motor:');
      for (const r of usamExtras) console.log(`    #${r.id} ${r.slug}`);
      console.log('  O importador e a reclassificação vão discordar nessas linhas. Alinhe os');
      console.log('  dois sujeitos antes de aplicar (sujeitoDeTransacao aqui, importacao.ts:627).');
    }

    if (aplicando && !mudancas.length) {
      await client.query('ROLLBACK');
      console.log(titulo('NADA A APLICAR'));
      console.log('  A classificação gravada já é a que o motor decidiria nesta fatia.');
    } else if (aplicando) {
      await client.query('COMMIT');
      console.log(titulo('APLICADO'));
      console.log(`  lote ............ ${lote}`);
      console.log(`  desfazer com .... node scripts/reclassificar.mjs --reverter=${lote}`);
      console.log('  Confira o resultado na tela ANTES de aplicar a próxima fatia. O desfazer');
      console.log('  recusa linha que alguém alterar depois deste lote — quanto mais tempo passa,');
      console.log('  menos completo ele fica.');
    } else {
      await client.query('ROLLBACK');
      console.log(titulo('DRY-RUN — NADA FOI GRAVADO'));
      console.log('  O ciclo aplicar → conferir → reverter rodou de verdade, contra o dado real,');
      console.log('  dentro de uma transação encerrada em ROLLBACK. O que você leu acima é o que');
      console.log('  `--aplicar` faria, porque é o mesmo código.');
      if (hashRevertido !== null) {
        console.log(
          hashRevertido === hashAntes
            ? '  Soma de controle após reverter: IDÊNTICA à original — o desfazer devolve o estado exato.'
            : '  ATENÇÃO: a soma de controle NÃO voltou ao original. NÃO APLIQUE.'
        );
      }
      console.log(`  Para gravar: node scripts/reclassificar.mjs${opcoes.conta ? ` --conta=${opcoes.conta}` : ''}${opcoes.desde ? ` --desde=${opcoes.desde}` : ''} --aplicar`);
    }
  } catch (erro) {
    await client.query('ROLLBACK');
    throw erro;
  }
}

// ---------------------------------------------------------------------------
const pool = financePool();
const client = await pool.connect();
try {
  if (opcoes.lotes) await fluxoListarLotes(client);
  else if (opcoes.reverter) await fluxoReverter(client);
  else await fluxoReclassificar(client);
} catch (erro) {
  console.error(`\n[reclassificar] abortado, nada foi gravado: ${erro.message}`);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}

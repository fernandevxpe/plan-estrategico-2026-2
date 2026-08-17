// A prova de que o catálogo de custo fixo não inventa número nem conta dinheiro
// duas vezes.
//
// ---------------------------------------------------------------------------
// O QUE ELE PROCURA
// ---------------------------------------------------------------------------
// Um catálogo de custo recorrente erra de dois jeitos, e os dois são
// silenciosos:
//
//   1. INFLA — a linha do aluguel soma junto com a projeção que já a
//      representava, ou a folha aparece pela pessoa E pelo CNPJ de MEI dela.
//      Ninguém abre chamado porque a previsão de custo subiu.
//   2. INVENTA — o valor sugerido sai de uma média que ninguém aferiu, e quem
//      olha a tela não tem como saber que aquele número tem 47% de erro.
//
// Este arquivo aplica a 0108 DENTRO de uma transação, escreve de verdade
// (liga, desliga, reajusta), confere as duas famílias de defeito e termina em
// ROLLBACK. Nada persiste — e a âncora de dinheiro é conferida antes e depois.
//
// Uso:
//   node scripts/test-custo-fixo-catalogo.mjs
//   node scripts/test-custo-fixo-catalogo.mjs --verbose
//   node scripts/test-custo-fixo-catalogo.mjs --catalogo   imprime o catálogo inteiro
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { registerFinanceTypeParsers } from './lib/fin-types.mjs';

loadEnv();
registerFinanceTypeParsers();

const VERBOSE = process.argv.includes('--verbose');
const CATALOGO = process.argv.includes('--catalogo');
const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

let ok = 0;
let falhas = 0;
const detalhes = [];

function afirma(titulo, condicao, evidencia) {
  if (condicao) {
    ok += 1;
    if (VERBOSE) console.log(`  ✓ ${titulo}${evidencia ? ` — ${evidencia}` : ''}`);
  } else {
    falhas += 1;
    detalhes.push(`${titulo}${evidencia ? `\n      ${evidencia}` : ''}`);
    console.log(`  ✗ ${titulo}${evidencia ? ` — ${evidencia}` : ''}`);
  }
}

async function recusa(c, titulo, sql, params = []) {
  await c.query('SAVEPOINT s');
  try {
    await c.query(sql, params);
    await c.query('ROLLBACK TO SAVEPOINT s');
    afirma(titulo, false, 'o banco ACEITOU o que deveria recusar');
  } catch (e) {
    await c.query('ROLLBACK TO SAVEPOINT s');
    afirma(titulo, true, e.message.slice(0, 110));
  }
}

const pool = financePool();
const c = await pool.connect();

try {
  await c.query('BEGIN');
  await c.query("SET LOCAL lock_timeout = '20s'");

  const ancoraSQL = `SELECT a.slug, COALESCE(SUM(t.amount_cents), 0) AS calc
                       FROM fin_account a LEFT JOIN fin_transaction t ON t.account_id = a.id
                      GROUP BY 1 ORDER BY 1`;
  const ancoraAntes = (await c.query(ancoraSQL)).rows;
  const recorrenteAntes = (await c.query(
    `SELECT direction, status, count(*)::int n, COALESCE(sum(amount_cents),0)::bigint v
       FROM fin_recurring GROUP BY 1,2 ORDER BY 1,2`)).rows;

  // A 0108 é aplicada SEMPRE nesta transação, esteja ou não no banco. Duas
  // razões, e a segunda custou caro:
  //
  //   · antes de aplicar, este arquivo é a validação da migration;
  //   · depois de aplicada, ele valida o ARQUIVO DE HOJE e não a versão que
  //     está no banco. Aplicar só quando a view falta faria o teste passar
  //     contra um estado antigo enquanto o arquivo editado estava quebrado —
  //     exatamente o que aconteceu em 17/08/2026.
  //
  // A migration é idempotente por construção (§6b), então reaplicar não muda
  // nada; e a transação termina em ROLLBACK de qualquer forma.
  console.log('\n(aplicando a 0108 nesta transação, que termina em ROLLBACK)');
  await c.query(readFileSync(resolve(RAIZ, 'db/migrations/0108_fin_custo_fixo_catalogo.sql'), 'utf8'));

  const { rows: [ent] } = await c.query(`SELECT id FROM fin_entity WHERE slug = 'xpe'`);
  const entityId = Number(ent.id);

  // =======================================================================
  console.log('\n[1] O detector: evidência completa, nunca número solto');
  // =======================================================================
  const det = (await c.query(`SELECT * FROM fin_custo_fixo_deteccao_v ORDER BY valor_sugerido_cents DESC NULLS LAST`)).rows;
  afirma('o detector encontra grupos', det.length > 0, `${det.length} grupo(s)`);

  const semPiso = det.filter((d) => Number(d.ocorrencias) < 3);
  afirma('nenhum grupo com menos de 3 ocorrências', semPiso.length === 0,
    'três é o piso da 0057: duas ocorrências são duas coincidências');

  const desemparelhado = det.filter((d) => (d.valor_sugerido_cents !== null) !== (d.criterio !== null));
  afirma('valor sugerido e critério andam sempre juntos', desemparelhado.length === 0,
    desemparelhado.length ? `${desemparelhado.length} desemparelhado(s)` : 'todos emparelhados');

  const semMotivo = det.filter((d) => d.valor_sugerido_cents === null && !d.valor_indeterminado_motivo);
  afirma('todo valor indeterminado carrega motivo', semMotivo.length === 0,
    `${det.filter((d) => d.valor_sugerido_cents === null).length} indeterminado(s), todos com motivo`);

  const semErro = det.filter((d) => d.criterio !== null && d.criterio_erro_pct === null);
  afirma('todo critério declara o erro medido dele', semErro.length === 0,
    'critério sem erro medido é fé, não medida');

  // O critério de cada família tem de ser o que venceu o backtest. Se alguém
  // trocar o CASE da view, este teste é o que avisa.
  const criterioErrado = det.filter((d) => {
    if (d.familia_valor === 'estavel') return d.criterio !== 'moda_observada';
    if (d.familia_valor === 'varia_um_pagamento') return d.criterio !== 'ultimo_observado';
    if (d.familia_valor === 'varia_varios_pagamentos') return d.criterio !== 'mediana_3m';
    return d.criterio !== null;
  });
  afirma('cada família usa o critério que VENCEU o backtest', criterioErrado.length === 0,
    criterioErrado.length ? `${criterioErrado.length} com critério fora da regra medida` : 'estável→moda · volume→último · agregado→mediana_3m');

  // O valor sugerido tem de ser LITERALMENTE o candidato do critério, não uma
  // aproximação dele.
  const valorNaoBate = det.filter((d) => {
    if (d.criterio === 'moda_observada') return String(d.valor_sugerido_cents) !== String(d.moda_cents);
    // 'ultimo_observado' é o último mês COMPARÁVEL, não o último mês: o mês em
    // que caíram duas faturas não é o mês em que o preço dobrou. Ver §2 da 0108.
    if (d.criterio === 'ultimo_observado') return String(d.valor_sugerido_cents) !== String(d.ultimo_comparavel_cents);
    if (d.criterio === 'mediana_3m') return String(d.valor_sugerido_cents) !== String(d.mediana_3m_cents);
    return false;
  });
  afirma('o valor sugerido é exatamente o candidato do critério', valorNaoBate.length === 0,
    valorNaoBate.length ? `${valorNaoBate.length} divergente(s)` : 'nenhum arredondamento no meio');

  // A correção que veio do caso Claro: o mês com duas faturas não vira preço.
  const mesAtipico = det.filter((d) => d.criterio === 'ultimo_observado'
    && Number(d.ultimo_lancamentos) !== Number(d.lancamentos_moda));
  afirma('mês com número atípico de pagamentos NÃO vira o valor sugerido',
    mesAtipico.every((d) => String(d.valor_sugerido_cents) !== String(d.ultimo_cents)),
    mesAtipico.length
      ? `${mesAtipico.length} grupo(s) corrigido(s), ex.: ${mesAtipico[0].contraparte} — último mês ${
          brl(mesAtipico[0].ultimo_cents)} em ${mesAtipico[0].ultimo_lancamentos} pagamentos, sugerido ${
          brl(mesAtipico[0].valor_sugerido_cents)}`
      : 'nenhum grupo com último mês atípico');

  // =======================================================================
  console.log('\n[2] A sobreposição: a folha não pode entrar duas vezes');
  // =======================================================================
  const folhaSemConflito = (await c.query(`
    SELECT count(*)::int n FROM fin_recurring r
      JOIN fin_category c ON c.id = r.category_id
     WHERE r.direction = 'pagar' AND c.code LIKE '6.%' AND r.conflito_camada IS NULL
       AND EXISTS (SELECT 1 FROM fin_person_counterparty pc
                     JOIN fin_folha_previsao_v f ON f.person_id = pc.person_id
                    WHERE pc.counterparty_id = r.counterparty_id
                      AND f.situacao_na_folha = 'ativo na folha' AND f.total_cents > 0)`)).rows[0].n;
  afirma('nenhuma recorrente 6.x de pessoa da folha fica sem conflito declarado', folhaSemConflito === 0,
    `${folhaSemConflito} sem conflito`);

  // O buraco da §5: contrapartes SECUNDÁRIAS (CNPJ de MEI) que a trava da 0079
  // não alcança. O catálogo tem de alcançá-las.
  const secundarias = (await c.query(`
    SELECT count(*)::int n, COALESCE(sum(d.valor_sugerido_cents),0)::bigint v
      FROM fin_custo_fixo_deteccao_v d
      JOIN fin_category c ON c.id = d.category_id
     WHERE c.code LIKE '6.%' AND d.conflito_camada = 'folha_declarada'
       AND NOT EXISTS (SELECT 1 FROM fin_person p WHERE p.counterparty_id = d.counterparty_id)`)).rows[0];
  afirma('o catálogo alcança as contrapartes secundárias da folha (o que a 0079 não pega)',
    Number(secundarias.n) > 0,
    `${secundarias.n} grupo(s), ${brl(secundarias.v)}/mês que a trava por fin_person.counterparty_id deixaria passar`);

  const ativoComConflito = (await c.query(
    `SELECT count(*)::int n FROM fin_recurring WHERE status='ativo' AND conflito_camada IS NOT NULL`)).rows[0].n;
  afirma('nada com conflito de camada fica ativo', ativoComConflito === 0, `${ativoComConflito} violação(ões)`);

  await recusa(c, 'o banco RECUSA ligar uma linha que colide com outra camada',
    `UPDATE fin_recurring SET status='ativo'
      WHERE id = (SELECT id FROM fin_recurring WHERE direction='pagar' AND conflito_camada IS NOT NULL LIMIT 1)`);

  // =======================================================================
  console.log('\n[3] O catálogo nasce proposto, e o total sabe disso');
  // =======================================================================
  const resumo = (await c.query(`SELECT * FROM fin_custo_fixo_resumo_v`)).rows[0];
  afirma('nenhum item nasce ligado', Number(resumo.itens_ligados) === 0,
    'ligar é ato humano; a migration não decide no lugar do dono');
  afirma('o total ligado zero vem com motivo, não como afirmação sobre o dinheiro',
    Number(resumo.total_ligado_cents) !== 0 || Boolean(resumo.total_ligado_motivo),
    resumo.total_ligado_motivo ? 'motivo declarado' : 'sem motivo');

  const semMotivoFora = (await c.query(
    `SELECT count(*)::int n FROM fin_custo_fixo_catalogo_v WHERE NOT entra_no_total AND motivo_fora_do_total IS NULL`)).rows[0].n;
  afirma('toda linha fora do total diz por quê', semMotivoFora === 0, `${semMotivoFora} silenciosa(s)`);

  const chaveDup = (await c.query(`
    SELECT count(*)::int n FROM (SELECT entity_id, chave_dedupe FROM fin_custo_fixo_catalogo_v
      WHERE entra_no_total GROUP BY 1,2 HAVING count(*) > 1) x`)).rows[0].n;
  afirma('chave_dedupe é única entre as linhas que somam', chaveDup === 0, `${chaveDup} repetida(s)`);

  // A quebra por camada tem de fechar com o total detectado: se não fechar,
  // alguma parte do dinheiro está fora de toda leitura.
  const soma = ['detectado_terceiros_cents', 'detectado_folha_cents', 'detectado_das_cents', 'detectado_documento_cents']
    .reduce((s, k) => s + Number(resumo[k]), 0);
  afirma('a quebra por camada fecha com o total detectado',
    soma === Number(resumo.total_detectado_cents),
    `${brl(soma)} × ${brl(resumo.total_detectado_cents)}`);

  // =======================================================================
  console.log('\n[4] O parcelamento acaba, e a data está declarada');
  // =======================================================================
  const parc = (await c.query(`SELECT * FROM fin_custo_fixo_parcelado_v ORDER BY termina_em DESC`)).rows;
  afirma('todo parcelamento aberto declara quando termina',
    parc.every((p) => p.termina_em), `${parc.length} plano(s) aberto(s)`);
  afirma('nenhum parcelamento entra no total do catálogo',
    Number(resumo.parcelado_mes_corrente_cents) > 0 && Number(resumo.total_ligado_cents) === 0,
    `${brl(resumo.parcelado_mes_corrente_cents)}/mês de parcela, contados à parte, até ${
      parc.length ? String(parc[0].termina_em).slice(0, 7) : '—'}`);

  const parcNoCatalogo = (await c.query(`
    SELECT count(*)::int n FROM fin_custo_fixo_catalogo_v v
     WHERE v.entra_no_total AND v.natureza_custo = 'parcelado'`)).rows[0].n;
  afirma('nada marcado como parcelado soma no catálogo', parcNoCatalogo === 0,
    'parcelamento não é mensalidade');

  // =======================================================================
  console.log('\n[5] O reembolso está no catálogo e NÃO soma');
  // =======================================================================
  const reemb = (await c.query(
    `SELECT * FROM fin_custo_fixo_catalogo_v WHERE chave_dedupe = 'folha_reembolso'`)).rows;
  afirma('o reembolso aparece no catálogo', reemb.length === 1, 'o pedido era explícito');
  afirma('e ele NÃO entra no total', reemb.length === 1 && reemb[0].entra_no_total === false,
    'somá-lo inflaria a folha em ~R$ 6 mil/mês (0077 §46)');
  afirma('com o motivo escrito na linha',
    reemb.length === 1 && Boolean(reemb[0].motivo_fora_do_total) && Boolean(reemb[0].conflito_motivo),
    reemb.length === 1 ? brl(reemb[0].valor_sugerido_cents) + ' estimado' : '—');
  const folhaTotal = (await c.query(`SELECT reembolso_cents FROM fin_folha_previsao_total_v`)).rows[0];
  afirma('e pelo mesmo número que a folha usa',
    reemb.length === 1 && String(reemb[0].valor_sugerido_cents) === String(folhaTotal.reembolso_cents),
    'duas telas, uma base');

  // =======================================================================
  console.log('\n[6] Ligar, ajustar e desligar — a escrita de verdade');
  // =======================================================================
  const alvo = (await c.query(`
    SELECT r.id, r.amount_cents, r.label FROM fin_recurring r
     WHERE r.direction='pagar' AND r.conflito_camada IS NULL AND r.category_id IS NOT NULL
       AND r.amount_cents IS NOT NULL
     ORDER BY r.amount_cents DESC LIMIT 1`)).rows[0];
  afirma('há ao menos um item ligável no catálogo', Boolean(alvo),
    alvo ? `${alvo.label} — ${brl(alvo.amount_cents)}` : 'nenhum');

  if (alvo) {
    const totalAntes = Number((await c.query(`SELECT total_ligado_cents FROM fin_custo_fixo_resumo_v`)).rows[0].total_ligado_cents);

    await c.query(
      `UPDATE fin_recurring SET status='ativo', status_motivo=$2, status_alterado_em=now(),
              status_alterado_por='teste', revisado_em=now(), revisado_por='teste'
        WHERE id=$1`,
      [alvo.id, 'ligado pelo teste']);
    const totalDepois = Number((await c.query(`SELECT total_ligado_cents FROM fin_custo_fixo_resumo_v`)).rows[0].total_ligado_cents);
    afirma('ligar um item soma exatamente o valor dele, nem um centavo a mais',
      totalDepois - totalAntes === Number(alvo.amount_cents),
      `${brl(totalAntes)} → ${brl(totalDepois)} (+${brl(totalDepois - totalAntes)})`);

    // O reajuste: registra, não sobrescreve.
    const novo = Number(alvo.amount_cents) + 25000;
    const mesCorrente = (await c.query(
      `SELECT date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo'))::date AS m`)).rows[0].m;
    await c.query(
      `INSERT INTO fin_custo_fixo_ajuste
         (entity_id, recurring_id, campo, vigente_de, valor_antes_cents, valor_depois_cents, motivo, fonte, autor)
       VALUES ($1,$2,'valor',$3,$4,$5,'reajuste anual do contrato','humano','teste')`,
      [entityId, alvo.id, mesCorrente, alvo.amount_cents, novo]);
    await c.query(`UPDATE fin_recurring SET amount_cents=$2, amount_basis='declarado' WHERE id=$1`, [alvo.id, novo]);

    const linha = (await c.query(
      `SELECT * FROM fin_custo_fixo_catalogo_v WHERE recurring_id=$1`, [alvo.id])).rows[0];
    afirma('o reajuste fica registrado, com o valor anterior à vista',
      String(linha.ultimo_ajuste_antes_cents) === String(alvo.amount_cents) && Number(linha.ajustes) === 1,
      `${brl(linha.ultimo_ajuste_antes_cents)} → ${brl(linha.valor_vigente_cents)} · "${linha.ultimo_ajuste_motivo}"`);

    // A regra do dono, em forma de gatilho.
    await recusa(c, 'o banco RECUSA reajuste com vigência no passado',
      `INSERT INTO fin_custo_fixo_ajuste
         (entity_id, recurring_id, campo, vigente_de, valor_antes_cents, valor_depois_cents, motivo, autor)
       VALUES ($1,$2,'valor', (date_trunc('month', now()) - interval '1 month')::date, 100, 200, 'retroativo','teste')`,
      [entityId, alvo.id]);

    await recusa(c, 'o histórico é imutável: linha registrada não se altera',
      `UPDATE fin_custo_fixo_ajuste SET motivo='outro' WHERE recurring_id=$1`, [alvo.id]);

    await recusa(c, 'o banco RECUSA desligar sem motivo',
      `UPDATE fin_recurring SET status='suspenso', status_motivo=NULL,
              status_alterado_em=NULL, status_alterado_por=NULL WHERE id=$1`, [alvo.id]);

    // Desligar tira do total e mantém a decisão à vista.
    await c.query(
      `UPDATE fin_recurring SET status='suspenso', status_motivo=$2, status_alterado_em=now(), status_alterado_por='teste'
        WHERE id=$1`, [alvo.id, 'contrato encerrado em agosto']);
    const linhaOff = (await c.query(
      `SELECT * FROM fin_custo_fixo_catalogo_v WHERE recurring_id=$1`, [alvo.id])).rows[0];
    afirma('desligar tira do total e mantém o motivo visível',
      linhaOff.entra_no_total === false && String(linhaOff.motivo_fora_do_total).includes('contrato encerrado'),
      linhaOff.motivo_fora_do_total);
    const totalFinal = Number((await c.query(`SELECT total_ligado_cents FROM fin_custo_fixo_resumo_v`)).rows[0].total_ligado_cents);
    afirma('e o total volta ao que era antes de ligar', totalFinal === totalAntes,
      `${brl(totalFinal)} × ${brl(totalAntes)}`);
  }

  // =======================================================================
  console.log('\n[7] "Não deixar esquecer de pagar"');
  // =======================================================================
  const venc = (await c.query(`SELECT * FROM fin_custo_fixo_vencimento_v ORDER BY dia_esperado`)).rows;
  afirma('a fila de vencimento responde sem erro', Array.isArray(venc), `${venc.length} item(ns) na janela`);
  afirma('nenhum item já realizado aparece na fila de vencimento',
    venc.every((v) => v.o_que_falta), 'todo item diz o que falta');
  afirma('nenhum item sem dia esperado entra na fila',
    venc.every((v) => v.dia_esperado), 'lembrete sem data não é lembrete');
  const dupVenc = new Map();
  for (const v of venc) dupVenc.set(v.chave_dedupe, (dupVenc.get(v.chave_dedupe) ?? 0) + 1);
  afirma('nenhuma chave aparece duas vezes na fila',
    [...dupVenc.values()].every((n) => n === 1),
    `${dupVenc.size} chave(s) distintas em ${venc.length} linha(s)`);

  const kinds = (await c.query(`
    SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname='fin_notificacao_kind_check'`)).rows[0];
  afirma('o vocabulário de notificação aceita o aviso de custo a vencer',
    kinds.d.includes('custo_fixo_a_vencer'), 'kind novo declarado no CHECK');

  // A costura com a 0105: o sino tem de continuar sendo UM nome, e os fatos
  // novos têm de aparecer nele.
  const fatoNovo = (await c.query(
    `SELECT kind, count(*)::int n, COALESCE(sum(amount_cents),0)::bigint v
       FROM fin_custo_fixo_notificacao_fato_v GROUP BY 1 ORDER BY 1`)).rows;
  const fatoTudo = (await c.query(
    `SELECT count(*)::int n FROM fin_notificacao_fato_v WHERE kind LIKE 'custo_fixo%'`)).rows[0].n;
  const somaNovo = fatoNovo.reduce((s, f) => s + f.n, 0);
  afirma('os fatos do catálogo aparecem em fin_notificacao_fato_v', fatoTudo === somaNovo && somaNovo > 0,
    fatoNovo.map((f) => `${f.kind} ${f.n} (${brl(f.v)})`).join(' · '));

  const fatoBase = (await c.query(
    `SELECT count(*)::int n FROM fin_notificacao_fato_v WHERE kind NOT LIKE 'custo_fixo%'`)).rows[0].n;
  const fatoBaseSo = (await c.query(`SELECT count(*)::int n FROM fin_notificacao_fato_base_v`)).rows[0].n;
  afirma('e nenhum fato da 0105 se perdeu na composição', fatoBase === fatoBaseSo,
    `${fatoBase} × ${fatoBaseSo}`);

  const semDestino = (await c.query(`
    SELECT count(*)::int n FROM fin_custo_fixo_notificacao_fato_v
     WHERE link_href !~ '^/' OR (amount_cents IS NULL AND amount_reason IS NULL)`)).rows[0].n;
  afirma('todo aviso aponta para uma tela e declara o valor ou o motivo', semDestino === 0,
    'aviso sem destino ensina a ignorar aviso');

  // O sync da 0105 tem de engolir os fatos novos sem nenhuma alteração nele.
  const sync = (await c.query(`SELECT * FROM fin_notificacao_sync('teste')`)).rows[0];
  const sync2 = (await c.query(`SELECT * FROM fin_notificacao_sync('teste')`)).rows[0];
  afirma('o sync da 0105 grava os avisos novos sem ter sido tocado', Number(sync.criadas) >= somaNovo,
    `${sync.criadas} criada(s), ${sync.repetidas} repetida(s), ${sync.resolvidas} resolvida(s)`);
  afirma('e continua idempotente: a 2ª execução não cria linha nova', Number(sync2.criadas) === 0,
    `${sync2.criadas} criada(s) na 2ª passagem, ${sync2.repetidas} repetida(s)`);

  // =======================================================================
  console.log('\n[8] Nada do que estava de pé caiu');
  // =======================================================================
  const ancoraDepois = (await c.query(ancoraSQL)).rows;
  const ancoraIgual = JSON.stringify(ancoraAntes) === JSON.stringify(ancoraDepois);
  afirma('a soma por conta é idêntica antes e depois', ancoraIgual,
    ancoraIgual ? `${ancoraAntes.length} conta(s), nenhum centavo se mexeu` : 'A ÂNCORA MUDOU');

  const inflou = (await c.query(`
    SELECT COALESCE(sum(valor_cents),0)::bigint v, count(*)::int n
      FROM fin_custo_previsto_consolidado_v WHERE entra_no_total`)).rows[0];
  const projSomavel = (await c.query(`
    SELECT COALESCE(sum(valor_projetado_cents),0)::bigint v
      FROM fin_custo_previsto_derivado_v WHERE entra_no_saldo`)).rows[0];
  afirma('a previsão de custo do mês continua fechando com a projeção somável',
    String(inflou.v) === String(projSomavel.v),
    `${brl(inflou.v)} × ${brl(projSomavel.v)} — semear proposta NÃO infla o saldo`);

  const semMotivo0100 = (await c.query(`
    SELECT count(*)::int n FROM fin_custo_previsto_consolidado_v
     WHERE NOT entra_no_total AND motivo_nao_soma IS NULL`)).rows[0].n;
  afirma('a assertiva da 0100 continua de pé (nada fora da soma sem motivo)', semMotivo0100 === 0,
    `${semMotivo0100} silenciosa(s)`);

  const recorrenteDepois = (await c.query(
    `SELECT direction, status, count(*)::int n, COALESCE(sum(amount_cents),0)::bigint v
       FROM fin_recurring GROUP BY 1,2 ORDER BY 1,2`)).rows;
  const receberIgual = JSON.stringify(recorrenteAntes.filter((r) => r.direction === 'receber'))
                    === JSON.stringify(recorrenteDepois.filter((r) => r.direction === 'receber'));
  afirma('nenhuma recorrente de RECEBER foi tocada', receberIgual,
    receberIgual ? 'o catálogo é de saída' : 'a receita mudou');

  // =======================================================================
  if (CATALOGO) {
    console.log('\n── O CATÁLOGO ──────────────────────────────────────────────');
    const linhas = (await c.query(`
      SELECT categoria_code, categoria, itens, ligados, propostos, candidatos, com_alerta,
             subtotal_cents, a_revisar_cents, em_outra_camada_cents
        FROM fin_custo_fixo_categoria_v ORDER BY a_revisar_cents + em_outra_camada_cents DESC`)).rows;
    console.log('cat   categoria                          itens  alerta   a revisar      outra camada');
    for (const l of linhas) {
      console.log(
        `${String(l.categoria_code ?? '—').padEnd(6)}${String(l.categoria ?? 'sem categoria').slice(0, 33).padEnd(35)}` +
        `${String(l.itens).padStart(5)}${String(l.com_alerta).padStart(8)}` +
        `${brl(l.a_revisar_cents).padStart(14)}${brl(l.em_outra_camada_cents).padStart(18)}`);
    }
    console.log('\n── O QUE O DETECTOR ACHOU ──────────────────────────────────');
    console.log('conf     valor sug.  critério          disp   ocor  dia  contraparte / categoria');
    for (const d of det) {
      console.log(
        `${String(d.confianca).padEnd(9)}${(d.valor_sugerido_cents === null ? 'indeterm.' : brl(d.valor_sugerido_cents)).padStart(12)}  ` +
        `${String(d.criterio ?? '—').padEnd(17)}${String(d.dispersao ?? '—').padStart(6)}` +
        `${String(d.ocorrencias).padStart(6)}${String(d.dia_do_mes).padStart(5)}  ` +
        `${String(d.contraparte).slice(0, 34)} / ${d.categoria_code}${d.conflito_camada ? ` [${d.conflito_camada}]` : ''}`);
    }
    console.log('\n── RESUMO ──────────────────────────────────────────────────');
    const r = (await c.query(`SELECT * FROM fin_custo_fixo_resumo_v`)).rows[0];
    console.log(`  grupos detectados ............. ${r.grupos_detectados}`);
    console.log(`  detectado / mês ............... ${brl(r.total_detectado_cents)}`);
    console.log(`    · terceiros ................. ${brl(r.detectado_terceiros_cents)}`);
    console.log(`    · já na folha ............... ${brl(r.detectado_folha_cents)}`);
    console.log(`    · já no DAS ................. ${brl(r.detectado_das_cents)}`);
    console.log(`    · já em documento a pagar ... ${brl(r.detectado_documento_cents)}`);
    console.log(`    · sem valor (indeterminado) . ${r.detectado_sem_valor} grupo(s)`);
    console.log(`  parcelado (acaba) ............. ${brl(r.parcelado_mes_corrente_cents)}/mês · aberto ${brl(r.parcelado_aberto_cents)} · até ${String(r.parcelado_termina_em).slice(0, 7)}`);
    console.log(`  reembolso estimado ............ ${brl(r.reembolso_estimado_cents)} (dentro da folha)`);
    console.log(`  itens com alerta .............. ${r.itens_com_alerta}`);
    console.log(`  itens a revisar ............... ${r.itens_nunca_revisados}`);
  }

  console.log(`\n${falhas === 0 ? '✓' : '✗'} ${ok} afirmação(ões) verdadeira(s), ${falhas} falha(s)`);
  if (falhas) {
    console.log('\nFALHAS:');
    for (const d of detalhes) console.log(`  · ${d}`);
  }
  process.exitCode = falhas === 0 ? 0 : 1;
} finally {
  await c.query('ROLLBACK');
  c.release();
  await pool.end();
}

// Remove o resíduo do `test-login.mjs` que sobrou de execuções abortadas.
//
//   node scripts/limpar-residuo-teste.mjs             mostra o que faria
//   node scripts/limpar-residuo-teste.mjs --aplicar   apaga
//
// POR QUE EXISTE
// `test-login.mjs` desfaz tudo num `finally` — mas o bloco inteiro está sob
// `if (cobaia && antes)`, e as execuções que estouram ANTES de fotografar a
// cobaia não limpam nada. Medido em 31/08/2026: 48 itens em
// `fin_custo_previsto`, R$ 12.859,20, criados em 22 e 23/08, todos com
// descrição 'teste automatizado — fita 3M comprada'. Em agosto eles eram 100%
// do que a tela de Contas a pagar tinha para mostrar.
//
// O CORTE É ESTREITO DE PROPÓSITO
// Só remove linha cuja descrição/título começa com 'teste automatizado —' — a
// string que o próprio teste escreve, e que nenhum lançamento real usa. Nada de
// apagar por data, por valor ou por "parece teste".
import pg from 'pg';

import { financeDatabaseUrl } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';

loadEnv();

const APLICAR = process.argv.includes('--aplicar');
const MARCA = 'teste automatizado —%';
const pool = new pg.Pool({ connectionString: financeDatabaseUrl(), max: 2, options: '-c jit=off' });
const brl = (c) => (Number(c ?? 0) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

/*
 * O ITEM DERIVADO NÃO SE APAGA — e o banco recusa, não é convenção.
 *
 * `fin_custo_previsto_apagar_guarda()` (0100:322) levanta exceção em DELETE de
 * item com `origem = 'derivado'`, com a razão escrita: ele voltaria na próxima
 * leitura da projeção, e apagar destruiria a nota de quem decidiu ignorá-lo.
 * O caminho é `estado = 'ignorado'` com motivo, que mantém a decisão visível.
 *
 * Aqui a premissa do guarda ("ele voltaria") não vale — os `fin_time_envio` que
 * originaram estes 48 já foram apagados pela limpeza parcial do teste, então
 * são órfãos que nada regenera. Mesmo assim, ignorar é o caminho certo: forçar
 * DELETE exigiria desabilitar o gatilho, e desabilitar guarda de produção para
 * limpar resíduo de teste é trocar um incômodo por um precedente.
 *
 * `ignorado` também resolve o que incomodava: a linha para de somar e a tela a
 * mostra apagada, com o motivo ao lado.
 */
const MOTIVO_IGNORAR =
  'resíduo de test-login.mjs (execução abortada em 22-23/08/2026): o fin_time_envio de origem já foi apagado, nada regenera esta linha';

// Ordem importa: filho antes de pai, senão a FK recusa.
const ALVOS = [
  {
    rotulo: 'fin_custo_previsto MANUAL (apaga)',
    contar: `SELECT count(*)::int AS n, COALESCE(SUM(valor_previsto_cents),0)::bigint AS cents
               FROM fin_custo_previsto WHERE descricao LIKE $1 AND origem = 'manual'`,
    apagar: `DELETE FROM fin_custo_previsto WHERE descricao LIKE $1 AND origem = 'manual'`
  },
  {
    rotulo: 'fin_custo_previsto DERIVADO (ignora com motivo — o guarda proíbe apagar)',
    contar: `SELECT count(*)::int AS n, COALESCE(SUM(valor_previsto_cents),0)::bigint AS cents
               FROM fin_custo_previsto
              WHERE descricao LIKE $1 AND origem = 'derivado' AND estado <> 'ignorado'`,
    apagar: `UPDATE fin_custo_previsto
                SET estado = 'ignorado',
                    ignorado_motivo = ${"'" + MOTIVO_IGNORAR.replace(/'/g, "''") + "'"},
                    updated_at = now()
              WHERE descricao LIKE $1 AND origem = 'derivado' AND estado <> 'ignorado'`
  },
  {
    rotulo: 'fin_payment_attachment (anexos dos envios de teste)',
    contar: `SELECT count(*)::int AS n, 0::bigint AS cents
               FROM fin_payment_attachment
              WHERE target_table = 'fin_time_envio'
                AND target_id IN (SELECT id FROM fin_time_envio WHERE titulo LIKE $1)`,
    apagar: `DELETE FROM fin_payment_attachment
              WHERE target_table = 'fin_time_envio'
                AND target_id IN (SELECT id FROM fin_time_envio WHERE titulo LIKE $1)`
  },
  {
    rotulo: 'fin_time_envio (os envios do app do time)',
    contar: `SELECT count(*)::int AS n, COALESCE(SUM(amount_cents),0)::bigint AS cents
               FROM fin_time_envio WHERE titulo LIKE $1`,
    apagar: `DELETE FROM fin_time_envio WHERE titulo LIKE $1`
  },
  {
    rotulo: 'fin_purchase_request_link',
    contar: `SELECT count(*)::int AS n, 0::bigint AS cents
               FROM fin_purchase_request_link
              WHERE purchase_request_id IN (SELECT id FROM fin_purchase_request WHERE title LIKE $1)`,
    apagar: `DELETE FROM fin_purchase_request_link
              WHERE purchase_request_id IN (SELECT id FROM fin_purchase_request WHERE title LIKE $1)`
  },
  {
    rotulo: 'fin_purchase_request (solicitações de compra)',
    contar: `SELECT count(*)::int AS n, COALESCE(SUM(amount_cents),0)::bigint AS cents
               FROM fin_purchase_request WHERE title LIKE $1`,
    apagar: `DELETE FROM fin_purchase_request WHERE title LIKE $1`
  }
];

console.log(`\nResíduo de teste automatizado — ${APLICAR ? 'APLICANDO' : 'apenas mostrando'}\n`);

let total = 0;
for (const alvo of ALVOS) {
  const antes = await pool.query(alvo.contar, [MARCA]).catch((e) => ({ rows: [{ n: -1, cents: 0, erro: e.message }] }));
  const { n, cents, erro } = antes.rows[0];
  if (erro) {
    console.log(`  !  ${alvo.rotulo}: ${String(erro).slice(0, 80)}`);
    continue;
  }
  total += n;
  console.log(`  ${String(n).padStart(4)} linha(s)  R$ ${brl(cents).padStart(12)}  ${alvo.rotulo}`);
  if (APLICAR && n > 0) {
    const r = await pool.query(alvo.apagar, [MARCA]);
    console.log(`       → apagadas ${r.rowCount}`);
  }
}

if (!APLICAR) {
  console.log(`\n  ${total} linha(s) seriam removidas. Para aplicar: node scripts/limpar-residuo-teste.mjs --aplicar\n`);
} else {
  // Pós-condição: no estilo das migrations da casa, provar que fez o que disse.
  // O alvo não é "sumiu da tabela" (derivado não some), é "parou de contar".
  const sobrou = (
    await pool.query(
      `SELECT count(*)::int AS n FROM fin_custo_previsto
        WHERE descricao LIKE $1 AND estado <> 'ignorado'`,
      [MARCA]
    )
  ).rows[0].n;
  console.log(
    sobrou === 0
      ? '\n  Limpo: nada de teste continua ativo em fin_custo_previsto.\n'
      : `\n  AINDA SOBRARAM ${sobrou} linhas ativas — investigue.\n`
  );
  if (sobrou !== 0) process.exitCode = 1;
}

await pool.end();

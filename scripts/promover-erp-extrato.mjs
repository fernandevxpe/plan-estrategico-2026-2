// Promove o espelho do erp-obras para o ledger: erp_extrato_linha → fin_transaction.
//
// É o primeiro script desta integração que ESCREVE no ledger. Tudo antes dele
// (sync-erp-obras.mjs, a view de reconciliação) existe para que este passo seja
// dado com o número já conferido.
//
// ---------------------------------------------------------------------------
// O QUE AUTORIZA ESTA PROMOÇÃO
// ---------------------------------------------------------------------------
// A reconciliação mostra paridade EXATA — mesma contagem e mesmo centavo — em
// jan, fev, mar, abr e mai de 2026, entre este ledger (que leu o CSV do Nubank)
// e o do erp-obras (que lê o Polp). Dois caminhos independentes chegando ao
// mesmo lugar em cinco meses seguidos.
//
// E o que falta aqui foi validado contra a fonte externa: os 39 lançamentos de
// agosto somam R$ 11.679,59 líquidos, e
//
//   R$ 2,98 (saldo deste ledger em 07/08) + R$ 11.679,59 = R$ 11.682,57
//
// que é exatamente o saldo que a API do Nubank devolve hoje. A promoção não
// inventa caixa: ela fecha uma lacuna cujo tamanho o banco já confirmou.
//
// ---------------------------------------------------------------------------
// DEDUPLICAÇÃO — o ponto onde este script poderia estragar o ledger
// ---------------------------------------------------------------------------
// As 815 linhas de Nubank que já existem vieram do CSV com `source_id` NULO, e
// portanto com hash calculado pelo fallback
// (conta|data|centavos|descrição normalizada|ordinal).
//
// Usar o identificador do erp-obras como `sourceId` produziria um hash DIFERENTE
// para a mesma transação — e a linha entraria duas vezes. Pior: o agente que
// mapeou a Polp mediu isso e achou só 24 identificadores em comum entre os dois
// lados (o CSV gerou UUID v4, a Polp usa v3). Os identificadores não são os
// mesmos, e tratá-los como se fossem duplicaria o extrato inteiro.
//
// Por isso aqui o hash é calculado pelo MESMO fallback do importador de CSV, com
// o ordinal contando quantas linhas idênticas já existem no banco. Assim uma
// futura reimportação de CSV reconhece estas linhas como duplicadas e não as
// insere de novo.
//
// Uso:
//   node scripts/promover-erp-extrato.mjs --dry-run   mostra o que faria
//   node scripts/promover-erp-extrato.mjs             promove
import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { dedupeHash, normalizeDescription } from './lib/fin-normalize.mjs';
import { registerFinanceTypeParsers } from './lib/fin-types.mjs';

loadEnv();
registerFinanceTypeParsers();

const DRY = process.argv.includes('--dry-run');
const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// `registerFinanceTypeParsers` devolve `date` como string ISO, não Date — o
// mesmo contrato que os outros scripts do financeiro assumem. Aceitar os dois
// evita que uma mudança de parser quebre a chave de deduplicação em silêncio,
// que é o pior lugar para um bug deste tipo aparecer.
const dataISO = (v) => (typeof v === 'string' ? v.slice(0, 10) : v.toISOString().slice(0, 10));

const slugify = (s) =>
  (s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    .slice(0, 60) || 'projeto';

const pool = financePool();

try {
  const { rows: [entidade] } = await pool.query(`SELECT id FROM fin_entity WHERE slug='xpe'`);
  if (!entidade) throw new Error('entidade xpe não encontrada');
  const entityId = entidade.id;

  // -------------------------------------------------------------------------
  // 1. Os projetos do erp-obras viram centros de custo
  // -------------------------------------------------------------------------
  // kind='projeto' com o núcleo separando obras de consultoria — o mapa 1:1 com
  // Projeto.segmento que a migration 0037 preparou. A identidade é
  // (source='erp', source_id=<id de lá>): o nome muda, o id não.
  const { rows: projetos } = await pool.query(
    `SELECT DISTINCT projeto_id, projeto_nome, projeto_segmento
       FROM erp_extrato_linha
      WHERE projeto_id IS NOT NULL
      ORDER BY projeto_id`
  );
  console.log(`[projetos] ${projetos.length} projeto(s) distinto(s) no espelho`);

  const centroPorProjeto = new Map();
  let centrosNovos = 0;

  for (const p of projetos) {
    const nucleo = p.projeto_segmento === 'CONSULTORIA' ? 'consultoria' : 'obras';
    const slug = `erp-${p.projeto_id}-${slugify(p.projeto_nome)}`.slice(0, 64);

    if (DRY) {
      centroPorProjeto.set(p.projeto_id, -1);
      continue;
    }

    const { rows: [cc] } = await pool.query(
      `INSERT INTO fin_cost_center (entity_id, slug, name, kind, nucleo, source, source_id, is_active)
       VALUES ($1,$2,$3,'projeto',$4,'erp',$5,true)
       ON CONFLICT (source, source_id) WHERE source_id IS NOT NULL
       DO UPDATE SET name = EXCLUDED.name, nucleo = EXCLUDED.nucleo, updated_at = now()
       RETURNING id, (xmax = 0) AS inserido`,
      [entityId, slug, p.projeto_nome ?? `Projeto ${p.projeto_id}`, nucleo, String(p.projeto_id)]
    );
    centroPorProjeto.set(p.projeto_id, cc.id);
    if (cc.inserido) centrosNovos += 1;
  }
  if (!DRY) console.log(`[projetos] ${centrosNovos} centro(s) de custo criado(s)`);

  // -------------------------------------------------------------------------
  // 2. O que existe no espelho e não existe no ledger
  // -------------------------------------------------------------------------
  const { rows: candidatas } = await pool.query(
    `SELECT e.*, a.id AS account_id
       FROM erp_extrato_linha e
       JOIN fin_account a ON a.slug = e.conta_slug
      -- Nada anterior ao saldo de abertura da conta.
      --
      -- A abertura é o saldo NAQUELE dia e já embute tudo que veio antes;
      -- promover uma linha anterior a ela conta o mesmo dinheiro duas vezes para
      -- quem somar sem filtrar por data, e some para quem filtrar. As duas
      -- respostas são defensáveis, o que é exatamente o problema.
      --
      -- Isto aconteceu de verdade na primeira promoção: 10 linhas de dez/2025
      -- entraram contra uma abertura de 02/01/2026 e tiveram de ser removidas
      -- pela migration 0041. Elas voltam quando a ingestão cobrir o histórico
      -- inteiro pelo Polp, que dispensa abertura em vez de brigar com ela.
      AND (a.opening_balance_date IS NULL OR e.posted_on >= a.opening_balance_date)
      AND NOT EXISTS (
        SELECT 1 FROM fin_transaction t
         WHERE t.account_id = a.id
           AND t.posted_on  = e.posted_on
           AND t.amount_cents = e.amount_cents)
      ORDER BY e.posted_on, e.erp_linha_key`
  );
  console.log(`[promover] ${candidatas.length} linha(s) candidata(s)`);

  if (!candidatas.length) {
    console.log('[promover] ledger já cobre o espelho');
    process.exit(0);
  }

  // O ordinal precisa continuar de onde o banco parou: se já existe uma linha
  // idêntica (mesma data, valor e descrição), a nova é a segunda ocorrência, e
  // um hash com índice 0 colidiria com a que já está lá.
  const ordinais = new Map();
  async function proximoOrdinal(accountId, e) {
    const chave = `${accountId}|${dataISO(e.posted_on)}|${e.amount_cents}|${normalizeDescription(e.descricao)}`;
    if (!ordinais.has(chave)) {
      const { rows: [{ n }] } = await pool.query(
        `SELECT count(*)::int AS n FROM fin_transaction
          WHERE account_id=$1 AND posted_on=$2 AND amount_cents=$3
            AND description_norm = $4`,
        [accountId, e.posted_on, e.amount_cents, normalizeDescription(e.descricao)]
      );
      ordinais.set(chave, n);
    }
    const atual = ordinais.get(chave);
    ordinais.set(chave, atual + 1);
    return atual;
  }

  let inseridas = 0;
  let jaExistiam = 0;
  let comCentro = 0;
  const porMes = new Map();

  for (const e of candidatas) {
    const ordinal = await proximoOrdinal(e.account_id, e);
    const hash = dedupeHash({
      accountSlug: e.conta_slug,
      date: dataISO(e.posted_on),
      amountCents: Number(e.amount_cents),
      description: e.descricao,
      occurrenceIndex: ordinal
    });
    const centro = e.projeto_id ? centroPorProjeto.get(e.projeto_id) ?? null : null;

    if (DRY) {
      const mes = dataISO(e.posted_on).slice(0, 7);
      const acc = porMes.get(mes) ?? { n: 0, cents: 0, projeto: 0 };
      acc.n += 1; acc.cents += Number(e.amount_cents); if (centro) acc.projeto += 1;
      porMes.set(mes, acc);
      continue;
    }

    const { rows: [r] } = await pool.query(
      `INSERT INTO fin_transaction (
         entity_id, account_id, posted_on, amount_cents,
         description_raw, description_norm, counterparty_raw,
         cost_center_id, nucleo, source_kind, source, source_id,
         dedupe_hash, review_status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'erp_obras',$11,$12,'pendente')
       ON CONFLICT (account_id, dedupe_version, dedupe_hash) DO UPDATE SET
         -- Reimportação não desfaz decisão humana nem rebaixa conciliação:
         -- mesma cláusula dos importadores de Inter e Asaas, mesmo motivo.
         cost_center_id = COALESCE(fin_transaction.cost_center_id, EXCLUDED.cost_center_id),
         updated_at = now()
       RETURNING (xmax = 0) AS inserido`,
      [
        entityId, e.account_id, e.posted_on, e.amount_cents,
        e.descricao, normalizeDescription(e.descricao), e.beneficiado,
        centro,
        centro ? (e.projeto_segmento === 'CONSULTORIA' ? 'consultoria' : 'obras') : null,
        e.origem, e.erp_linha_key, hash
      ]
    );
    if (r.inserido) inseridas += 1; else jaExistiam += 1;
    if (centro) comCentro += 1;
  }

  if (DRY) {
    console.log('\n[dry-run] o que seria promovido:');
    for (const [mes, a] of [...porMes].sort()) {
      console.log(`  ${mes}  ${String(a.n).padStart(3)} linha(s)  ${brl(a.cents).padStart(14)}  com projeto: ${a.projeto}`);
    }
    console.log('[dry-run] nada gravado');
  } else {
    console.log(`[promover] ${inseridas} inserida(s), ${jaExistiam} já existia(m), ${comCentro} com centro de custo`);
  }
} finally {
  await pool.end();
}

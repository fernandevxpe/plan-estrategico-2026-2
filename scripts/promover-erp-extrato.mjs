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
// ---------------------------------------------------------------------------
// --conta: A TRAVA QUE O MODO AUTOMÁTICO EXIGE
// ---------------------------------------------------------------------------
// Enquanto isto era um comando que uma pessoa digitava, promover tudo o que o
// espelho tivesse era o certo: quem digitou acabara de olhar o dry-run.
//
// Como etapa do botão e do agendador, não é mais. `CONTA_ERP_PARA_LEDGER` em
// sync-erp-obras.mjs mapeia NUBANK, INTER e ASAAS — e Inter e Asaas já entram
// neste ledger pelas APIs delas. No dia em que o erp-obras passar a espelhar
// uma dessas duas (decisão do Adryan, não nossa), a etapa noturna abriria um
// SEGUNDO caminho para o mesmo dinheiro entrar, que é exatamente o que
// sincronizar-fontes.mjs existe para não fazer. O `NOT EXISTS` abaixo pega o
// duplicado exato e não pega o quase-igual.
//
// Por isso o pipeline passa `--conta=nubank`: a fonte `erp_obras` do catálogo
// declara que alimenta a conta `nubank`, e a etapa promove só o que a fonte
// declara. Sem o flag, o comportamento é o de sempre — o modo manual continua
// promovendo o espelho inteiro, com uma pessoa olhando.
//
// ---------------------------------------------------------------------------
// --fechar-saldo: POR QUE ISTO NÃO PODE SER UMA SEGUNDA ETAPA
// ---------------------------------------------------------------------------
// Promover lançamentos SEM mexer em `current_balance_cents` e em
// `fin_statement_coverage` quebra dois invariantes que passam hoje:
//
//   G1  a coluna de saldo deixa de ser reconstruível pela soma do ledger
//   F3  os lançamentos novos caem fora de toda janela de cobertura declarada
//
// Na primeira promoção isso não apareceu porque uma PESSOA fechou o par à mão,
// pela migration 0041: ela gravou o saldo que o banco devolvia e estendeu a
// cobertura, com o número conferido por três caminhos. O script sempre foi
// metade de um par; como etapa automática, ficaria sem a outra metade.
//
// A outra metade poderia ser uma etapa seguinte no pipeline. NÃO PODE: a
// promoção comitaria, o fechamento abortaria por divergência, e o ledger
// ficaria com o extrato novo e o saldo velho — G1 quebrado, sem ninguém por
// perto. Aqui dentro, na MESMA transação, a regra é "promove e fecha, ou não
// promove": qualquer divergência desfaz tudo e o Nubank continua atrasado, que
// é um estado honesto e já alarmado.
//
// O saldo vem do banco, nunca da soma — a decisão da 0036, e a razão de existir
// da conferência. A fonte é `GET /integrations/{id}/accounts` da Polp, que é
// endpoint DIFERENTE do `/investments` das caixinhas: em 01/09/2026 o segundo
// estava com a paginação quebrada (declara 108 posições, entrega 91) e o
// primeiro respondia normalmente.
//
// Uso:
//   node scripts/promover-erp-extrato.mjs --dry-run           mostra o que faria
//   node scripts/promover-erp-extrato.mjs                     promove tudo
//   node scripts/promover-erp-extrato.mjs --conta=nubank      promove só uma conta
//   node scripts/promover-erp-extrato.mjs --conta=nubank --fechar-saldo
//                                                             promove e fecha o saldo
import { financePool } from './lib/artifact-db.mjs';
import { clientePolp, credenciaisPolp } from './lib/polp.mjs';
import { loadEnv } from './lib/env.mjs';
import { dedupeHash, normalizeDescription } from './lib/fin-normalize.mjs';
import { registerFinanceTypeParsers } from './lib/fin-types.mjs';

loadEnv();
registerFinanceTypeParsers();

const DRY = process.argv.includes('--dry-run');
const contaArg = process.argv.find((a) => a.startsWith('--conta='));
const CONTA = contaArg ? contaArg.slice('--conta='.length).trim() : null;
const FECHAR = process.argv.includes('--fechar-saldo');

// Só o Nubank tem fonte de saldo mapeada. Recusar é melhor que escolher sozinho
// qual conta do Polp corresponde a qual conta daqui — esse palpite, errado,
// gravaria o saldo de uma conta em cima de outra.
if (FECHAR && CONTA !== 'nubank') {
  throw new Error('--fechar-saldo hoje só existe para --conta=nubank (é a única com saldo mapeado na Polp)');
}
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

/**
 * O saldo da conta corrente do Nubank, lido do banco.
 *
 * `type: 'BANK'` e não o índice 0 da lista: a integração devolve DUAS contas —
 * a corrente e o cartão de crédito (R$ 12.237,98 em 01/09/2026). Gravar o
 * cartão como saldo da conta seria um erro que fecha aritmeticamente e mente
 * por inteiro. Mais de uma BANK aborta em vez de escolher.
 */
async function saldoDoBancoCents() {
  const cred = await credenciaisPolp();
  const get = clientePolp(cred);
  const corpo = await get(`/integrations/${cred.integracao || '2906'}/accounts`);
  const itens = corpo?.data ?? corpo;
  const contas = (Array.isArray(itens) ? itens : [itens]).filter((c) => c?.type === 'BANK');

  if (contas.length !== 1) {
    throw new Error(`a Polp devolveu ${contas.length} conta(s) 'BANK' nesta integração; esperava exatamente 1`);
  }
  const bruto = Number(contas[0].balance);
  if (!Number.isFinite(bruto)) throw new Error('a Polp devolveu saldo não numérico para a conta corrente');
  return { cents: Math.round(bruto * 100), lidoEm: contas[0].updated_at ?? contas[0].synced_at ?? null };
}

/**
 * Fecha o par que a promoção abre: saldo declarado e cobertura de extrato.
 *
 * Roda DENTRO da transação da promoção e lança em qualquer divergência — quem
 * chama já desfaz tudo. As duas asserções finais são as mesmas contas de G1 e
 * F3, feitas aqui em vez de esperar o verificador noturno descobrir.
 */
async function fecharSaldo(cliente, slug, candidatas) {
  const { rows: [conta] } = await cliente.query(
    `SELECT a.id, a.opening_balance_cents, a.current_balance_cents
       FROM fin_account a JOIN fin_entity e ON e.id = a.entity_id
      WHERE e.slug = 'xpe' AND a.slug = $1`,
    [slug]
  );
  if (!conta) throw new Error(`conta '${slug}' não encontrada`);

  const { cents: banco, lidoEm } = await saldoDoBancoCents();

  const { rows: [{ soma }] } = await cliente.query(
    `SELECT coalesce(sum(amount_cents) FILTER (WHERE NOT is_split_parent), 0) soma
       FROM fin_transaction WHERE account_id = $1`,
    [conta.id]
  );
  // No dry-run os INSERTs não aconteceram: o reconstruído tem de somar à mão o
  // que SERIA promovido, senão o ensaio compara o ledger de antes com o banco
  // de agora e acusa uma divergência que a própria promoção fecharia.
  const pendentes = DRY ? candidatas.reduce((t, e) => t + Number(e.amount_cents), 0) : 0;
  const reconstruido = Number(conta.opening_balance_cents) + Number(soma) + pendentes;

  console.log(`[fechar] banco ${brl(banco)} (lido em ${lidoEm ?? '?'})`);
  console.log(`[fechar] ledger ${brl(reconstruido)}${DRY ? ' (incluindo o que seria promovido)' : ''}`);

  if (reconstruido !== banco) {
    throw new Error(
      `saldo não reconcilia: banco ${brl(banco)}, ledger ${brl(reconstruido)}, ` +
      `diferença ${brl(banco - reconstruido)}. Nada foi promovido — o extrato está incompleto ` +
      `ou o banco se moveu depois da leitura do espelho.`
    );
  }

  if (DRY) {
    console.log('[fechar] [dry-run] saldo e cobertura NÃO foram gravados');
    return;
  }

  await cliente.query(
    `UPDATE fin_account SET current_balance_cents = $2, last_statement_at = now() WHERE id = $1`,
    [conta.id, banco]
  );

  // A cobertura ESTENDE a última janela 'api' em vez de abrir outra: janela nova
  // a cada rodada criaria dezenas de linhas e, no primeiro dia sem promoção,
  // um intervalo descoberto entre elas — que é exatamente o que F2 procura.
  //
  // `source = 'api'` pela razão que a 0041 escreveu: a coluna responde COMO a
  // cobertura foi obtida, e o Polp lê o Nubank sozinho. O caminho até aqui
  // passar pelo erp-obras fica registrado por lançamento, em `source`.
  const { rows: [{ fim }] } = await cliente.query(
    `SELECT max(posted_on)::date fim FROM fin_transaction WHERE account_id = $1`,
    [conta.id]
  );
  const { rowCount: estendidas } = await cliente.query(
    `UPDATE fin_statement_coverage SET period_end = $2
      WHERE id = (SELECT id FROM fin_statement_coverage
                   WHERE account_id = $1 AND source = 'api'
                   ORDER BY period_end DESC LIMIT 1)
        AND period_end < $2`,
    [conta.id, fim]
  );
  console.log(`[fechar] cobertura ${estendidas ? 'estendida' : 'já alcançava'} ${fim}`);

  const { rows: [checagem] } = await cliente.query(
    `SELECT (SELECT a.opening_balance_cents
                  + coalesce(sum(t.amount_cents) FILTER (WHERE NOT t.is_split_parent), 0)
                  - a.current_balance_cents
               FROM fin_account a LEFT JOIN fin_transaction t ON t.account_id = a.id
              WHERE a.id = $1 GROUP BY a.id) g1,
            (SELECT count(*) FROM fin_transaction t
              WHERE t.account_id = $1
                AND NOT EXISTS (SELECT 1 FROM fin_statement_coverage sc
                                 WHERE sc.account_id = t.account_id
                                   AND t.posted_on BETWEEN sc.period_start AND sc.period_end)) f3`,
    [conta.id]
  );
  if (Number(checagem.g1) !== 0) throw new Error(`G1 não fechou para '${slug}': delta ${brl(checagem.g1)}`);
  if (Number(checagem.f3) !== 0) throw new Error(`F3 não fechou para '${slug}': ${checagem.f3} lançamento(s) fora da cobertura`);
  console.log('[fechar] G1 e F3 conferidos nesta transação: ambos zerados');
}

const pool = financePool();

// UMA TRANSAÇÃO, e ela passou a ser obrigatória quando isto virou etapa.
//
// Enquanto era comando manual, cada INSERT em autocommit era tolerável: quem
// digitou estava olhando e reexecutava. Como etapa do botão e do agendador, uma
// falha no meio deixaria o extrato pela metade — e a etapa seguinte, que fecha
// o saldo contra o banco, abortaria por uma divergência que não é do banco, é
// da importação interrompida. Metade de um extrato é pior que nenhum, porque
// parece completo.
const cliente = await pool.connect();

// `financePool()` devolve um cliente FIXADO quando o teste está no comando, e
// esse não tem release — soltá-lo derrubaria a conexão da transação do teste.
const soltar = () => cliente.release?.();

try {
  await cliente.query('BEGIN');
  const { rows: [entidade] } = await cliente.query(`SELECT id FROM fin_entity WHERE slug='xpe'`);
  if (!entidade) throw new Error('entidade xpe não encontrada');
  const entityId = entidade.id;

  // -------------------------------------------------------------------------
  // 1. Os projetos do erp-obras viram centros de custo
  // -------------------------------------------------------------------------
  // kind='projeto' com o núcleo separando obras de consultoria — o mapa 1:1 com
  // Projeto.segmento que a migration 0037 preparou. A identidade é
  // (source='erp', source_id=<id de lá>): o nome muda, o id não.
  const { rows: projetos } = await cliente.query(
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

    const { rows: [cc] } = await cliente.query(
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
  const { rows: candidatas } = await cliente.query(
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
      AND ($1::text IS NULL OR e.conta_slug = $1::text)
      AND NOT EXISTS (
        SELECT 1 FROM fin_transaction t
         WHERE t.account_id = a.id
           AND t.posted_on  = e.posted_on
           AND t.amount_cents = e.amount_cents)
      ORDER BY e.posted_on, e.erp_linha_key`,
    [CONTA]
  );
  console.log(
    `[promover] ${candidatas.length} linha(s) candidata(s)` +
      (CONTA ? ` · restrito a conta '${CONTA}'` : ' · todas as contas do espelho')
  );

  if (!candidatas.length) {
    console.log('[promover] ledger já cobre o espelho');
    // COMMIT e não exit seco: os centros de custo do passo 1 já foram criados
    // nesta transação, e descartá-los faria a próxima rodada recriá-los à toa.
    await cliente.query('COMMIT');
    soltar();
    await pool.end();
    process.exit(0);
  }

  // O ordinal precisa continuar de onde o banco parou: se já existe uma linha
  // idêntica (mesma data, valor e descrição), a nova é a segunda ocorrência, e
  // um hash com índice 0 colidiria com a que já está lá.
  const ordinais = new Map();
  async function proximoOrdinal(accountId, e) {
    const chave = `${accountId}|${dataISO(e.posted_on)}|${e.amount_cents}|${normalizeDescription(e.descricao)}`;
    if (!ordinais.has(chave)) {
      const { rows: [{ n }] } = await cliente.query(
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

    const { rows: [r] } = await cliente.query(
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

  if (FECHAR) await fecharSaldo(cliente, CONTA, candidatas);

  // No dry-run nada foi escrito (o laço acima nem chega ao INSERT), mas desfazer
  // explicitamente é mais barato que confiar nisso para sempre.
  await cliente.query(DRY ? 'ROLLBACK' : 'COMMIT');
} catch (erro) {
  await cliente.query('ROLLBACK').catch(() => {});
  throw erro;
} finally {
  soltar();
  await pool.end();
}

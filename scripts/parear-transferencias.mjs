// Motor de pareamento de transferências entre contas próprias.
//
// O PROBLEMA QUE ELE RESOLVE
// Uma transferência da Asaas para o Inter é UM movimento de dinheiro que
// aparece DUAS vezes no ledger: −R$ 25.000 na Asaas e +R$ 25.000 no Inter.
// Enquanto as duas pernas não são declaradas como a mesma coisa, a entrada
// conta como receita e a saída como despesa — a empresa parece faturar e gastar
// milhões que nunca existiram.
//
// O schema já previa o desfecho (`transfer_status='pareado'` some de toda
// agregação), mas ninguém nunca escreveu quem casa com quem: `transfer_group_id`
// está NULL em 100% das ~13.900 linhas e não existe uma única perna 'pareado'.
// Este script é essa peça que faltava.
//
// O PRINCÍPIO
// Pareamento NÃO move dinheiro. Ele só declara que duas linhas já existentes são
// o mesmo fato. Por isso a única coisa que este script escreve é
// `transfer_status` e `transfer_group_id` — nunca `amount_cents`, nunca data,
// nunca conta. A prova disso é a ÂNCORA: a soma de amount_cents por conta é
// medida antes e depois, dentro da mesma transação, e qualquer divergência
// derruba o COMMIT.
//
// A POSTURA
// Um par errado é MUITO pior que uma perna órfã. A perna órfã é visível: fica
// em 'em_transito', continua somando, e alguém pergunta por que o número não
// fecha. O par errado é invisível: neutraliza uma receita real contra uma
// despesa real, e as duas somem do relatório sem deixar rastro. Toda vez que a
// evidência é ambígua, este script NÃO pareia e reporta.
//
// Uso:
//   node scripts/parear-transferencias.mjs                 dry-run (padrão)
//   node scripts/parear-transferencias.mjs --aplicar        grava
//   node scripts/parear-transferencias.mjs --janela=5       janela do critério C
//   node scripts/parear-transferencias.mjs --tolerancia     liga o critério D
//   node scripts/parear-transferencias.mjs --json           saída legível por máquina
import { readFile } from 'node:fs/promises';

import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { registerFinanceTypeParsers } from './lib/fin-types.mjs';
import { rawDirUrl } from './lib/paths.mjs';

loadEnv();
registerFinanceTypeParsers();

// --------------------------------------------------------------------- flags
const argv = process.argv.slice(2);
const flag = (nome) => argv.includes(`--${nome}`);
const valor = (nome, padrao) => {
  const hit = argv.find((a) => a.startsWith(`--${nome}=`));
  return hit ? hit.slice(nome.length + 3) : padrao;
};

// Dry-run é o PADRÃO, não uma opção. Um motor que grava por omissão transforma
// "deixa eu ver o que ele faria" no pior acidente possível deste módulo.
const APLICAR = flag('aplicar');
const JSON_OUT = flag('json');
const TOLERANCIA = flag('tolerancia');
const JANELA = Math.max(0, Number(valor('janela', '3')) || 0);
const ENTITY_SLUG = valor('entidade', 'xpe');
const ATOR = 'parear-transferencias';

const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dias = (a, b) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

// ---------------------------------------------------------------- critérios
//
// Em cascata, do mais forte para o mais fraco. Cada nível só enxerga as pernas
// que os níveis acima não consumiram, e cada nível carrega a própria confiança —
// o número que diz quanto do resultado sobrevive a uma auditoria.
const CRITERIOS = [
  {
    id: 'e2e',
    rotulo: 'A · endToEndId idêntico',
    confianca: 1.0,
    // O identificador que o Banco Central atribui ao PIX. É o único campo que
    // prova que duas linhas são a MESMA transação em vez de duas transações
    // parecidas. Só vale se os dois lados o expuserem.
    aceita: (s, e) => Boolean(s.e2e && e.e2e && s.e2e === e.e2e)
  },
  {
    id: 'exato_mesmo_dia',
    rotulo: 'B · valor exato, contas diferentes, mesmo dia',
    confianca: 0.97,
    aceita: (s, e) => e.amount_cents === -s.amount_cents && e.posted_on === s.posted_on
  },
  {
    id: 'exato_janela',
    rotulo: `C · valor exato, contas diferentes, até ${JANELA} dia(s)`,
    confianca: 0.85,
    aceita: (s, e) => e.amount_cents === -s.amount_cents && Math.abs(dias(e.posted_on, s.posted_on)) <= JANELA
  },
  {
    id: 'tolerancia',
    rotulo: 'D · valor aproximado, janela de 7 dias',
    confianca: 0.35,
    // DESLIGADO por padrão, e a medição explica por quê: no acervo atual este
    // critério produz um único par, e esse par é falso (uma saída da Asaas
    // contra um "Resgate RDB" do Nubank, que é dinheiro vindo da caixinha, não
    // da Asaas). PIX entre contas próprias não tem tarifa: o valor bate na
    // casa do centavo ou não é o mesmo movimento.
    habilitado: TOLERANCIA,
    aceita: (s, e) => {
      const dif = Math.abs(e.amount_cents + s.amount_cents);
      if (dif === 0) return false;
      return dif <= Math.max(500, Math.round(Math.abs(s.amount_cents) * 0.01))
        && Math.abs(dias(e.posted_on, s.posted_on)) <= 7;
    }
  }
];

// ------------------------------------------------------------- instituições
//
// De onde veio / para onde foi. Sem isto, uma entrada de R$ 5.000 no Inter é
// indistinguível entre "veio da Asaas" e "veio do Nubank" quando as duas contas
// têm uma saída de R$ 5.000 no mesmo dia — e o motor escolheria por sorteio.
const ISPB = {
  19540550: 'asaas',
  18236120: 'nubank',
  '00416968': 'inter',
  '00360305': 'caixa'
};

/** Nome de instituição (texto livre de extrato) → família de conta. */
function familiaPorNome(texto) {
  if (!texto) return null;
  const t = texto.toUpperCase();
  if (t.includes('ASAAS')) return 'asaas';
  if (t.includes('NU PAGAMENTOS') || t.includes('NUBANK')) return 'nubank';
  if (t.includes('BANCO INTER') || t.includes('INTER ')) return 'inter';
  if (t.includes('CAIXA ECONOMICA') || t.includes('CAIXA ECONÔMICA')) return 'caixa';
  return null;
}

/** Slug de conta → família, para comparar com a dica de instituição. */
function familiaDaConta(slug) {
  if (slug.startsWith('caixa')) return 'caixa';
  if (slug.startsWith('nubank')) return 'nubank';
  return slug;
}

/**
 * A dica que o próprio texto do lançamento já carrega.
 *
 * O extrato CSV do Inter escreve o ISPB da contraparte na descrição
 * (`Pix recebido: "Cp :19540550-XP ENERGY..."`), e o do Nubank escreve o nome
 * do banco (`... - 34.776.108/0001-92 - BANCO INTER`). São dados que já estão
 * no ledger e ninguém estava lendo.
 */
function dicaPelaDescricao(descricao) {
  if (!descricao) return null;
  const ispb = /Cp\s*:\s*(\d{8})/.exec(descricao);
  if (ispb) return ISPB[ispb[1]] ?? ISPB[Number(ispb[1])] ?? null;
  return familiaPorNome(descricao);
}

/**
 * O que só o JSON cru do Inter sabe.
 *
 * `endToEndId` e `nomeEmpresaRecebedor` existem em data/raw/inter-extrato.json e
 * NÃO existem no banco — o importador não os grava. Ler o arquivo aqui é
 * deliberado e reversível: é a diferença entre um guard-rail e uma coluna nova
 * que só este script preencheria e que o próximo `npm run import:inter`
 * deixaria desatualizada em silêncio.
 *
 * Se o arquivo não estiver presente (Railway sem volume, checkout limpo), o
 * motor degrada para "sem opinião" — nunca para "pode casar com qualquer um".
 */
async function dicasDoInterCru() {
  const mapa = new Map();
  try {
    const arquivo = JSON.parse(await readFile(new URL('inter-extrato.json', rawDirUrl), 'utf8'));
    for (const t of arquivo.data ?? []) {
      const d = t.detalhes ?? {};
      const e2e = d.endToEndId || null;
      // Para uma ENTRADA, os 8 dígitos após o 'E' são o ISPB de quem originou —
      // é literalmente a conta de origem, dita pelo Banco Central.
      // Para uma SAÍDA, o prefixo é o ISPB do próprio Inter e não diz nada; o
      // destino está em `nomeEmpresaRecebedor`.
      const contraparte = t.tipoOperacao === 'C'
        ? (e2e ? ISPB[e2e.slice(1, 9)] ?? null : null)
        : familiaPorNome(d.nomeEmpresaRecebedor || d.empresaEmissora || '');
      mapa.set(String(t.idTransacao), { e2e, contraparte });
    }
  } catch {
    // Ausência de arquivo não é erro: o motor só fica mais conservador.
  }
  return mapa;
}

// ---------------------------------------------------------------- vetos duros
//
// Rodam ANTES de qualquer critério. Nenhuma confiança, por mais alta, atravessa
// um veto: são as afirmações que sabemos serem falsas independentemente de
// valor e data baterem.

/**
 * Movimentos de poupança interna (caixinha / RDB) não são PIX e vice-versa.
 *
 * "Aplicação RDB" na conta corrente do Nubank casa com "Aplicação na caixinha"
 * na conta de aplicação, e com mais nada. Sem este veto, um "Resgate RDB" de
 * R$ 6.275,00 fica elegível a casar com uma saída da Asaas de valor parecido —
 * que foi exatamente o único par que o critério de tolerância produziu, e é
 * falso.
 */
const KINDS_POUPANCA = new Set(['APLICACAO', 'APLICACAO_RDB', 'RESGATE_RDB', 'RESGATE']);
// Fatura de cartão sai da conta corrente para uma conta de cartão que NÃO existe
// em fin_account. Não há perna do outro lado para achar; qualquer par aqui é
// necessariamente falso.
const KINDS_SEM_CONTRAPARTE = new Set(['FATURA_CARTAO']);

function vetos(s, e, contas) {
  // Duas pernas da mesma conta nunca são uma transferência entre contas.
  if (s.account_id === e.account_id) return 'mesma_conta';
  if (s.entity_id !== e.entity_id) return 'entidades_diferentes';

  // Perna que voltou atrás não chegou a lugar nenhum.
  if (s.estornada || e.estornada) return 'perna_estornada';

  if (KINDS_SEM_CONTRAPARTE.has(s.source_kind) || KINDS_SEM_CONTRAPARTE.has(e.source_kind)) {
    return 'conta_destino_inexistente';
  }

  const sPoupanca = KINDS_POUPANCA.has(s.source_kind);
  const ePoupanca = KINDS_POUPANCA.has(e.source_kind);
  if (sPoupanca !== ePoupanca) return 'poupanca_x_pix';
  if (sPoupanca && ePoupanca) {
    // Aplicação e resgate só fazem sentido entre a conta corrente e a conta de
    // aplicação do MESMO banco.
    if (familiaDaConta(contas.get(s.account_id).slug) !== familiaDaConta(contas.get(e.account_id).slug)) {
      return 'poupanca_de_bancos_diferentes';
    }
  }

  // A instituição declarada pelo extrato contradiz a conta candidata.
  const famS = familiaDaConta(contas.get(s.account_id).slug);
  const famE = familiaDaConta(contas.get(e.account_id).slug);
  if (s.dica && s.dica !== famE) return 'instituicao_contradiz_saida';
  if (e.dica && e.dica !== famS) return 'instituicao_contradiz_entrada';

  return null;
}

// ------------------------------------------------------------------ execução
const pool = financePool();
const client = await pool.connect();
const relatorio = { criterios: [], pares: [], ambiguos: [], orfas: [], ancora: [], impacto: [] };

try {
  const { rows: contaRows } = await client.query(
    `SELECT a.id, a.slug, a.kind, a.entity_id FROM fin_account a
      JOIN fin_entity e ON e.id = a.entity_id WHERE e.slug = $1 ORDER BY a.id`,
    [ENTITY_SLUG]
  );
  if (!contaRows.length) throw new Error(`entidade '${ENTITY_SLUG}' não tem contas`);
  const contas = new Map(contaRows.map((c) => [c.id, c]));

  // ---------------------------------------------------------------- universo
  //
  // Só 'em_transito' entra. 'nao' fica de fora de propósito: uma receita de
  // cliente e uma despesa com fornecedor de mesmo valor no mesmo dia casariam
  // pelos critérios de valor+data, e o motor apagaria as duas do relatório.
  // Ampliar o universo é decisão humana, não default.
  const { rows: pernas } = await client.query(
    `SELECT t.id, t.entity_id, t.account_id, t.posted_on, t.amount_cents, t.source, t.source_id,
            t.source_kind, t.description_raw, t.transfer_status, t.human_locked_fields
       FROM fin_transaction t
       JOIN fin_entity e ON e.id = t.entity_id
      WHERE e.slug = $1
        AND t.transfer_status = 'em_transito'
        AND t.transfer_group_id IS NULL
        AND NOT t.is_split_parent
      ORDER BY t.posted_on, t.id`,
    [ENTITY_SLUG]
  );

  // ------------------------------------------------------------- estornos
  //
  // Um PIX que falhou aparece como saída seguida de "Estorno de transação via
  // Pix" na MESMA conta, mesmo dia, mesmo valor. O dinheiro nunca saiu — não há
  // perna do outro lado para achar, e casar essa saída com uma entrada
  // qualquer inventaria uma transferência que não aconteceu.
  //
  // Medido: 4 saídas em trânsito têm estorno gêmeo, e uma delas (2026-05-11,
  // R$ 10.300) tem DUAS saídas idênticas para um estorno só — impossível saber
  // qual foi a que voltou. Nesse caso as duas ficam de fora, por construção.
  //
  // A consulta traz só as linhas de estorno (dezenas, não milhares) e o
  // cruzamento acontece em memória. O auto-join equivalente em SQL varria a
  // tabela inteira contra ela mesma e levava minutos — caro demais para um
  // guard-rail que existe para ser barato o bastante para rodar sempre.
  const { rows: reversoes } = await client.query(
    `SELECT account_id, posted_on, amount_cents FROM fin_transaction
      WHERE description_norm ~ '(estorno|devolucao|devolvido|reembolso)'
         OR source_kind ILIKE '%REFUND%'`
  );
  const chaveEstorno = new Set(reversoes.map((r) => `${r.account_id}|${r.posted_on}|${-r.amount_cents}`));

  const dicasCru = await dicasDoInterCru();
  const travadas = [];
  const universo = [];
  for (const p of pernas) {
    // Trava humana vence o motor, sempre. Se alguém decidiu à mão o que esta
    // linha é, o pareamento automático não desfaz.
    const travas = p.human_locked_fields ?? [];
    if (travas.includes('transfer_status') || travas.includes('transfer_group_id')) {
      travadas.push(p);
      continue;
    }
    const cru = p.source === 'inter_api' ? dicasCru.get(String(p.source_id)) : null;
    p.e2e = cru?.e2e ?? null;
    p.dica = cru?.contraparte ?? dicaPelaDescricao(p.description_raw);
    p.conta = contas.get(p.account_id)?.slug ?? String(p.account_id);
    p.estornada = chaveEstorno.has(`${p.account_id}|${p.posted_on}|${p.amount_cents}`);
    universo.push(p);
  }

  const saidas = universo.filter((p) => p.amount_cents < 0);
  const entradas = universo.filter((p) => p.amount_cents > 0);

  // ------------------------------------------------------------ pareamento
  const usada = new Set();
  const motivoVeto = new Map();
  const pares = [];

  for (const criterio of CRITERIOS) {
    if (criterio.habilitado === false) continue;

    // Grafo bipartido do nível: quem ainda pode casar com quem.
    const candidatosDe = new Map();
    const candidatosPara = new Map();
    for (const s of saidas) {
      if (usada.has(s.id)) continue;
      for (const e of entradas) {
        if (usada.has(e.id)) continue;
        const veto = vetos(s, e, contas);
        if (veto) {
          if (criterio.aceita(s, e)) motivoVeto.set(`${s.id}:${e.id}`, veto);
          continue;
        }
        if (!criterio.aceita(s, e)) continue;
        if (!candidatosDe.has(s.id)) candidatosDe.set(s.id, []);
        if (!candidatosPara.has(e.id)) candidatosPara.set(e.id, []);
        candidatosDe.get(s.id).push(e);
        candidatosPara.get(e.id).push(s);
      }
    }

    // Resolução por unicidade mútua, repetida até estabilizar.
    //
    // Casa apenas quando a saída é a única opção da entrada E a entrada é a
    // única opção da saída. Cada par fechado remove pernas do grafo, o que
    // frequentemente torna únicos vizinhos que antes eram ambíguos — a mesma
    // ideia de "único candidato" de um sudoku. O que sobrar ambíguo depois de
    // estabilizar NÃO é pareado: é reportado.
    let mudou = true;
    while (mudou) {
      mudou = false;
      for (const s of saidas) {
        if (usada.has(s.id)) continue;
        const opcoes = (candidatosDe.get(s.id) ?? []).filter((e) => !usada.has(e.id));
        if (opcoes.length !== 1) continue;
        const e = opcoes[0];
        const inversas = (candidatosPara.get(e.id) ?? []).filter((x) => !usada.has(x.id));
        if (inversas.length !== 1) continue;
        usada.add(s.id);
        usada.add(e.id);
        pares.push({
          criterio: criterio.id,
          rotulo: criterio.rotulo,
          confianca: criterio.confianca,
          grupo: `tg:${Math.min(s.id, e.id)}-${Math.max(s.id, e.id)}`,
          saida: s,
          entrada: e,
          delta_dias: dias(e.posted_on, s.posted_on),
          delta_cents: e.amount_cents + s.amount_cents
        });
        mudou = true;
      }
    }

    // O resíduo ambíguo do nível, para o relatório.
    for (const s of saidas) {
      if (usada.has(s.id)) continue;
      const opcoes = (candidatosDe.get(s.id) ?? []).filter((e) => !usada.has(e.id));
      if (opcoes.length > 1) {
        relatorio.ambiguos.push({
          criterio: criterio.id,
          perna: `saída #${s.id} ${s.conta} ${s.posted_on} ${brl(s.amount_cents)}`,
          candidatos: opcoes.map((e) => `#${e.id} ${e.conta} ${e.posted_on} ${brl(e.amount_cents)}`)
        });
      }
    }
    for (const e of entradas) {
      if (usada.has(e.id)) continue;
      const opcoes = (candidatosPara.get(e.id) ?? []).filter((s) => !usada.has(s.id));
      if (opcoes.length > 1) {
        relatorio.ambiguos.push({
          criterio: criterio.id,
          perna: `entrada #${e.id} ${e.conta} ${e.posted_on} ${brl(e.amount_cents)}`,
          candidatos: opcoes.map((s) => `#${s.id} ${s.conta} ${s.posted_on} ${brl(s.amount_cents)}`)
        });
      }
    }
  }

  // ------------------------------------------------------------- diagnóstico
  //
  // A lista de pares vai inteira para o relatório: sem ela, `--json` responde
  // "85 pares" e não deixa ninguém conferir NENHUM deles. Um motor cujo
  // resultado não dá para auditar linha a linha não deveria ser aplicado.
  relatorio.pares = pares.map((p) => ({
    grupo: p.grupo,
    criterio: p.criterio,
    confianca: p.confianca,
    valor: Math.abs(p.saida.amount_cents),
    delta_dias: p.delta_dias,
    saida: { id: p.saida.id, conta: p.saida.conta, data: p.saida.posted_on, cents: p.saida.amount_cents, dica: p.saida.dica, descricao: p.saida.description_raw },
    entrada: { id: p.entrada.id, conta: p.entrada.conta, data: p.entrada.posted_on, cents: p.entrada.amount_cents, dica: p.entrada.dica, descricao: p.entrada.description_raw }
  }));

  for (const criterio of CRITERIOS) {
    const meus = pares.filter((p) => p.criterio === criterio.id);
    relatorio.criterios.push({
      criterio: criterio.rotulo,
      confianca: criterio.confianca,
      estado: criterio.habilitado === false ? 'desligado' : 'ativo',
      pares: meus.length,
      valor: meus.reduce((a, p) => a + Math.abs(p.saida.amount_cents), 0)
    });
  }

  const orfas = universo.filter((p) => !usada.has(p.id));
  const porMotivo = new Map();
  for (const p of orfas) {
    // Por que esta perna não fechou. A pergunta que o relatório precisa
    // responder não é "quantas sobraram" e sim "o que falta no acervo".
    let motivo;
    if (p.estornada) motivo = 'saída estornada na própria conta — nunca chegou a outro banco';
    else if (KINDS_SEM_CONTRAPARTE.has(p.source_kind)) motivo = 'conta destino não existe no ledger (cartão)';
    else if (p.source === 'inter_api' && p.source_kind === 'PAGAMENTO') motivo = 'pagamento a terceiro marcado como transferência (ver 0022)';
    else if (p.dica === 'caixa') motivo = 'destino Caixa — conta sem nenhum lançamento importado';
    else if (KINDS_POUPANCA.has(p.source_kind)) motivo = 'perna da conta de aplicação fora do período importado';
    else if (p.posted_on < '2026-01-01') motivo = 'anterior à cobertura dos extratos de destino (2026-01)';
    else motivo = 'sem contraparte de mesmo valor na janela';
    if (!porMotivo.has(motivo)) porMotivo.set(motivo, { motivo, pernas: 0, valor: 0, contas: new Set() });
    const bucket = porMotivo.get(motivo);
    bucket.pernas += 1;
    bucket.valor += p.amount_cents;
    bucket.contas.add(p.conta);
  }
  relatorio.orfas = [...porMotivo.values()]
    .map((b) => ({ ...b, contas: [...b.contas].join(', ') }))
    .sort((a, b) => b.pernas - a.pernas);

  // Impacto mês a mês: quanto sai de receita e de despesa quando estes pares
  // forem neutralizados. É o número que a DRE muda.
  const meses = new Map();
  for (const p of pares) {
    for (const perna of [p.saida, p.entrada]) {
      const mes = perna.posted_on.slice(0, 7);
      if (!meses.has(mes)) meses.set(mes, { mes, receita: 0, despesa: 0, pares: 0 });
      const m = meses.get(mes);
      if (perna.amount_cents > 0) m.receita += perna.amount_cents;
      else m.despesa += perna.amount_cents;
    }
    meses.get(p.saida.posted_on.slice(0, 7)).pares += 1;
  }
  relatorio.impacto = [...meses.values()].sort((a, b) => a.mes.localeCompare(b.mes));

  // ------------------------------------------------------------------ escrita
  //
  // Mesmo o dry-run entra em transação e executa os UPDATEs de verdade: é a
  // única forma de a âncora medir o estado REAL depois da escrita, e não uma
  // simulação em memória que erra junto com o motor. A diferença entre os dois
  // modos é uma linha — COMMIT ou ROLLBACK.
  await client.query('BEGIN');

  const ancoraSql = `SELECT account_id, count(*) n, sum(amount_cents) soma
                       FROM fin_transaction GROUP BY 1 ORDER BY 1`;
  const antes = (await client.query(ancoraSql)).rows;

  for (const p of pares) {
    await client.query(
      `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, before, after, fields, actor)
       SELECT t.entity_id, 'fin_transaction', t.id, 'bulk_update',
              jsonb_build_object('transfer_status', t.transfer_status, 'transfer_group_id', t.transfer_group_id),
              jsonb_build_object('transfer_status', 'pareado', 'transfer_group_id', $2::text,
                                 'criterio', $3::text, 'confianca', $4::numeric, 'par', $5::bigint),
              ARRAY['transfer_status', 'transfer_group_id'], $6
         FROM fin_transaction t WHERE t.id = ANY($1::bigint[])`,
      [[p.saida.id, p.entrada.id], p.grupo, p.criterio, p.confianca, p.entrada.id, ATOR]
    );
    // A cláusula de segurança está no WHERE, não só no JS: mesmo que o motor
    // tenha errado, o UPDATE se recusa a tocar numa perna já pareada ou que
    // outro processo tenha alterado no meio do caminho.
    const r = await client.query(
      `UPDATE fin_transaction
          SET transfer_status = 'pareado', transfer_group_id = $2, updated_at = now()
        WHERE id = ANY($1::bigint[])
          AND transfer_status = 'em_transito'
          AND transfer_group_id IS NULL`,
      [[p.saida.id, p.entrada.id], p.grupo]
    );
    if (r.rowCount !== 2) throw new Error(`par ${p.grupo}: esperava atualizar 2 pernas, atualizou ${r.rowCount}`);
  }

  // -------------------------------------------------------------- invariantes
  const { rows: grupos } = await client.query(
    `SELECT transfer_group_id, count(*) pernas, count(DISTINCT account_id) contas, sum(amount_cents) soma
       FROM fin_transaction WHERE transfer_group_id IS NOT NULL
      GROUP BY 1 HAVING count(*) <> 2 OR count(DISTINCT account_id) <> 2 OR sum(amount_cents) <> 0`
  );
  if (grupos.length) throw new Error(`grupos inválidos após escrita: ${JSON.stringify(grupos.slice(0, 5))}`);

  const { rows: meiosPares } = await client.query(
    `SELECT count(*) n FROM fin_transaction
      WHERE (transfer_status = 'pareado') <> (transfer_group_id IS NOT NULL)`
  );
  if (Number(meiosPares[0].n) > 0) throw new Error(`${meiosPares[0].n} linha(s) com status e grupo em desacordo`);

  const depois = (await client.query(ancoraSql)).rows;
  const mapaAntes = new Map(antes.map((r) => [r.account_id, r]));
  relatorio.ancora = depois.map((d) => {
    const a = mapaAntes.get(d.account_id) ?? { n: 0, soma: 0 };
    return {
      conta: contas.get(d.account_id)?.slug ?? d.account_id,
      linhas_antes: Number(a.n),
      linhas_depois: Number(d.n),
      antes: Number(a.soma),
      depois: Number(d.soma),
      delta: Number(d.soma) - Number(a.soma),
      delta_linhas: Number(d.n) - Number(a.n)
    };
  });
  // Duas afirmações, não uma: o dinheiro por conta não mudou E nenhuma linha
  // apareceu ou sumiu. A segunda pega o caso em que um erro de escrita
  // compensasse a si mesmo na soma — improvável, mas silencioso se acontecer.
  const quebrou = relatorio.ancora.filter((r) => r.delta !== 0 || r.delta_linhas !== 0);
  if (quebrou.length || depois.length !== antes.length) {
    throw new Error(
      `ÂNCORA QUEBRADA — pareamento moveu dinheiro ou linhas: ${
        quebrou.map((r) => `${r.conta} Δsoma=${r.delta} Δlinhas=${r.delta_linhas}`).join(', ') || 'contas apareceram/sumiram'
      }`
    );
  }

  if (APLICAR) {
    await client.query('COMMIT');
  } else {
    await client.query('ROLLBACK');
  }

  // ------------------------------------------------------------------ saída
  if (JSON_OUT) {
    console.log(JSON.stringify({ modo: APLICAR ? 'aplicado' : 'dry-run', ...relatorio }, null, 2));
  } else {
    const linha = '─'.repeat(78);
    console.log(`\n${linha}\nPAREAMENTO DE TRANSFERÊNCIAS — ${APLICAR ? 'APLICADO' : 'DRY-RUN (nada gravado)'}`);
    console.log(`janela do critério C: ${JANELA} dia(s) · tolerância: ${TOLERANCIA ? 'LIGADA' : 'desligada'}`);
    console.log(`universo: ${universo.length} pernas em trânsito (${saidas.length} saídas, ${entradas.length} entradas)`);
    if (travadas.length) console.log(`travadas por decisão humana, intocadas: ${travadas.length}`);
    console.log(`dicas de instituição do JSON cru do Inter: ${dicasCru.size || 'indisponível (degradado)'}`);

    console.log(`\n${linha}\nPARES POR CRITÉRIO`);
    console.table(relatorio.criterios.map((c) => ({ ...c, valor: brl(c.valor) })));
    const total = pares.reduce((a, p) => a + Math.abs(p.saida.amount_cents), 0);
    console.log(`TOTAL: ${pares.length} pares · ${brl(total)} de dupla contagem eliminada`);

    console.log(`\n${linha}\nPERNAS ÓRFÃS (${orfas.length} de ${universo.length}) — por quê`);
    console.table(relatorio.orfas.map((o) => ({ motivo: o.motivo, pernas: o.pernas, valor: brl(o.valor), contas: o.contas })));

    console.log(`\n${linha}\nIMPACTO MÊS A MÊS (o que sai da DRE quando estes pares forem neutralizados)`);
    console.table(relatorio.impacto.map((m) => ({
      mes: m.mes, pares: m.pares, 'sai da receita': brl(m.receita), 'sai da despesa': brl(m.despesa)
    })));

    console.log(`\n${linha}\nÂNCORA — soma de amount_cents por conta, antes e depois`);
    console.table(relatorio.ancora.map((a) => ({
      conta: a.conta, linhas: `${a.linhas_antes} → ${a.linhas_depois}`,
      antes: brl(a.antes), depois: brl(a.depois),
      delta: a.delta === 0 && a.delta_linhas === 0 ? 'OK  0' : `!! ${a.delta} / ${a.delta_linhas} linhas`
    })));
    console.log('Pareamento não move dinheiro: delta tem de ser 0 em toda conta.');

    if (relatorio.ambiguos.length) {
      console.log(`\n${linha}\nAMBÍGUOS — NÃO pareados de propósito (${relatorio.ambiguos.length})`);
      for (const a of relatorio.ambiguos.slice(0, 20)) {
        console.log(`  [${a.criterio}] ${a.perna}`);
        for (const c of a.candidatos) console.log(`      ? ${c}`);
      }
      if (relatorio.ambiguos.length > 20) console.log(`  ... +${relatorio.ambiguos.length - 20}`);
    }

    if (!APLICAR) console.log(`\n${linha}\nNada foi gravado. Para aplicar: node scripts/parear-transferencias.mjs --aplicar\n`);
    else console.log(`\n${linha}\n${pares.length} pares gravados.\n`);
  }
} catch (erro) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(`[parear] ABORTADO — nada gravado: ${erro.message}`);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}

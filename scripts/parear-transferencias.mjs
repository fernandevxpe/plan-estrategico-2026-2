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
// O QUE MUDOU EM 15/08/2026 (frente A6)
// Três buracos, medidos contra o acervo, cada um com sua correção:
//
//   1. CONTRAPARTE NÃO ERA OLHADA. O motor casava por valor+data e mais nada.
//      Dois pares falsos entraram por aí (ids 1162 e 696, desfeitos na
//      migration 0044): um recebimento de cliente anulado contra um pagamento a
//      fornecedor, R$ 3.000 de receita e R$ 3.000 de despesa somem juntos. Agora
//      há veto de contraparte, espelhando o gatilho que a 0044 instalou no banco.
//
//   2. O UNIVERSO ERA SÓ 'em_transito'. A perna que chega do outro lado quase
//      nunca está em trânsito: o Nubank entra por CSV/ERP e nasce 'nao'. As duas
//      transferências de R$ 16.700 de 20/03 tinham os dois créditos no Nubank o
//      dia inteiro, e o motor nunca os viu. Agora linhas 'nao' entram TAMBÉM,
//      mas só com evidência positiva de remessa própria (categoria 9.01, ou o
//      CNPJ da casa escrito na descrição, ou a razão social por extenso) — 8
//      linhas no acervo atual, não um universo aberto. Todo par continua
//      exigindo ao menos uma perna em trânsito como âncora.
//
//   3. ESTORNO ERA VETO, NÃO EXPLICAÇÃO. Uma saída estornada ficava órfã para
//      sempre, ocupando o indicador como se fosse trabalho pendente. E quando
//      havia DUAS saídas idênticas para UM estorno, o motor desistia das duas —
//      embora só uma tenha voltado. Agora o estorno é consumido por contagem: r
//      estornos anulam r saídas do balde, e as k−r restantes continuam elegíveis
//      a parear. Foi o que destravou o nó de 11/05 (R$ 10.300).
//
// Uso:
//   node scripts/parear-transferencias.mjs                 dry-run (padrão)
//   node scripts/parear-transferencias.mjs --aplicar        grava
//   node scripts/parear-transferencias.mjs --janela=5       janela do critério C
//   node scripts/parear-transferencias.mjs --tolerancia     liga o critério D
//   node scripts/parear-transferencias.mjs --sem-ampliacao  volta ao universo só-em_transito
//   node scripts/parear-transferencias.mjs --sem-anulacao   não marca estorno como anulado
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
const AMPLIAR = !flag('sem-ampliacao');
const ANULAR = !flag('sem-anulacao');
const JANELA = Math.max(0, Number(valor('janela', '3')) || 0);
const ENTITY_SLUG = valor('entidade', 'xpe');
const ATOR = 'parear-transferencias';

// O CNPJ da casa. Contraparte com este documento é conta própria; com qualquer
// outro, é terceiro — e terceiro não é perna de transferência interna.
const CNPJ_CASA = '34776108000192';

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

/**
 * Contraparte: o veto que faltava, e que custou R$ 6.000 de resultado invisível.
 *
 * Duas afirmações, ambas sobre evidência POSITIVA — contraparte nula não
 * bloqueia nada, porque 143 dos 145 grupos legítimos do acervo têm as duas
 * pernas sem contraparte identificada (a identificação está em 25,8%). Uma
 * regra que exigisse contraparte trocaria dois falsos positivos por uma enxurrada
 * de falsos negativos.
 *
 *   (i)  perna cujo contraparte é cliente ou fornecedor com documento diferente
 *        do CNPJ da casa: é fato com terceiro, não movimento entre contas
 *        próprias. Foi o caso dos dois pares falsos.
 *   (ii) as duas pernas apontando para documentos diferentes: seja qual for a
 *        leitura, elas não são o mesmo dinheiro.
 *
 * 'socio' e 'colaborador' ficam de fora do veto de propósito: são pessoas
 * ligadas à casa, e decidir se um repasse via sócio é transferência interna ou
 * dois fatos separados muda o resultado da empresa — é pergunta para o humano,
 * não veto de motor. A vista fin_transferencia_suspeita (0044) os exibe.
 */
function vetoContraparte(s, e) {
  for (const p of [s, e]) {
    if (p.cp_doc && p.cp_doc !== CNPJ_CASA && (p.cp_kind === 'cliente' || p.cp_kind === 'fornecedor')) {
      return 'contraparte_terceiro';
    }
  }
  if (s.cp_doc && e.cp_doc && s.cp_doc !== e.cp_doc) return 'contrapartes_divergentes';
  return null;
}

function vetos(s, e, contas) {
  // Duas pernas da mesma conta nunca são uma transferência entre contas.
  if (s.account_id === e.account_id) return 'mesma_conta';
  if (s.entity_id !== e.entity_id) return 'entidades_diferentes';

  // Um par precisa de âncora: ao menos uma perna declarada em trânsito. As
  // linhas admitidas por evidência própria (universo ampliado) entram para SER
  // encontradas, não para casar entre si.
  if (s.transfer_status !== 'em_transito' && e.transfer_status !== 'em_transito') {
    return 'nenhuma_perna_em_transito';
  }

  const cp = vetoContraparte(s, e);
  if (cp) return cp;

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
const relatorio = {
  criterios: [], pares: [], ambiguos: [], orfas: [], ancora: [], impacto: [],
  blocos: [], anulacoes: []
};

try {
  const { rows: contaRows } = await client.query(
    `SELECT a.id, a.slug, a.kind, a.entity_id FROM fin_account a
      JOIN fin_entity e ON e.id = a.entity_id WHERE e.slug = $1 ORDER BY a.id`,
    [ENTITY_SLUG]
  );
  if (!contaRows.length) throw new Error(`entidade '${ENTITY_SLUG}' não tem contas`);
  const contas = new Map(contaRows.map((c) => [c.id, c]));

  // A data a partir da qual existe QUALQUER outra conta para casar. Antes dela
  // não há falha de pareamento — há ausência de acervo, e o relatório precisa
  // dizer isso com essas palavras. Medido, não decorado: se um dia 2022–2025 for
  // importado, este número anda sozinho.
  const { rows: [cobertura] } = await client.query(
    `SELECT min(t.posted_on) AS primeira FROM fin_transaction t
       JOIN fin_entity e ON e.id = t.entity_id
      WHERE e.slug = $1 AND t.account_id <> (
        SELECT a.id FROM fin_account a JOIN fin_entity e2 ON e2.id = a.entity_id
         WHERE e2.slug = $1 ORDER BY (SELECT count(*) FROM fin_transaction x WHERE x.account_id = a.id) DESC
         LIMIT 1)`,
    [ENTITY_SLUG]
  );
  const primeiraOutraConta = cobertura?.primeira ?? '1970-01-01';

  // ---------------------------------------------------------------- universo
  //
  // 'em_transito' entra sempre. 'nao' entra SÓ com evidência positiva de que a
  // linha é remessa própria — e é uma lista curta e verificável:
  //
  //   · categoria 9.01, que já afirma "transferência entre contas próprias";
  //   · o CNPJ da casa escrito na descrição (o extrato do Nubank via ERP traz
  //     "… - 34.776.108/0001-92 - ASAAS IP S.A. …", que é a origem dita por
  //     extenso);
  //   · a razão social por extenso, para o formato curto ("Transferência
  //     Recebida|XP ENERGY SERVICOS DE MEDICAO DE ENERGIA LTDA").
  //
  // No acervo de 15/08/2026 isso admite 8 linhas — não é abrir o universo, é
  // apontar para oito. O medo original (uma receita de cliente casando com uma
  // despesa de fornecedor de mesmo valor no mesmo dia) continua endereçado por
  // três camadas: a evidência exigida aqui, o veto de contraparte, e a exigência
  // de que todo par tenha ao menos uma perna em trânsito.
  //
  // O LIKE do CNPJ vai em description_raw porque description_norm quebra a
  // pontuação: "34.776.108/0001-92" vira "34 776 108 0001 92".
  const { rows: pernas } = await client.query(
    `SELECT t.id, t.entity_id, t.account_id, t.posted_on, t.amount_cents, t.source, t.source_id,
            t.source_kind, t.description_raw, t.transfer_status, t.human_locked_fields,
            cat.code AS categoria_code,
            cp.kind AS cp_kind, cp.name AS cp_nome, cp.document_number AS cp_doc
       FROM fin_transaction t
       JOIN fin_entity e ON e.id = t.entity_id
       LEFT JOIN fin_category cat ON cat.id = t.category_id
       LEFT JOIN fin_counterparty cp ON cp.id = t.counterparty_id
      WHERE e.slug = $1
        AND t.transfer_group_id IS NULL
        AND NOT t.is_split_parent
        AND (
          t.transfer_status = 'em_transito'
          OR ($2::boolean AND t.transfer_status = 'nao' AND (
                cat.code = '9.01'
             OR t.description_raw LIKE '%' || $3::text || '%'
             OR t.description_norm LIKE '%' || $4::text || '%'
          ))
        )
      ORDER BY t.posted_on, t.id`,
    [ENTITY_SLUG, AMPLIAR, '34.776.108/0001-92', 'xp energy servicos de medicao de energia']
  );

  // ------------------------------------------------------------- estornos
  //
  // Um PIX que falhou aparece como saída seguida de "Estorno de transação via
  // Pix" na MESMA conta, mesmo dia, mesmo valor. O dinheiro nunca saiu — não há
  // perna do outro lado para achar, e casar essa saída com uma entrada
  // qualquer inventaria uma transferência que não aconteceu.
  //
  // O QUE MUDOU: o estorno deixou de ser veto e virou EXPLICAÇÃO.
  //
  // Antes, qualquer saída com estorno gêmeo era vetada e virava órfã — para
  // sempre. Duas consequências ruins: (a) a saída ficava em 'em_transito'
  // prometendo um par que não existe, e (b) quando havia DUAS saídas idênticas
  // e UM estorno só, o motor desistia das duas, embora só uma tenha voltado.
  //
  // Agora o estorno é um recurso CONTADO. Num balde (conta, dia, valor) com k
  // saídas e r estornos, r saídas são anuladas e k−r seguem elegíveis a parear.
  // Foi o que destravou 2026-05-11: duas saídas de R$ 10.300 no Asaas, um
  // estorno, e um crédito de R$ 10.300 no Inter no mesmo dia — uma voltou, a
  // outra chegou. Antes as duas ficavam órfãs e o crédito do Inter também.
  //
  // QUAL das saídas idênticas é a anulada é indecidível — e inconsequente: elas
  // são iguais em conta, data, valor e descrição, então qualquer atribuição dá
  // o mesmo saldo, a mesma DRE e o mesmo total por categoria. A escolha é
  // declarada e determinística (menor id primeiro) para ser reproduzível.
  //
  // A consulta traz só as linhas de estorno (dezenas, não milhares) e o
  // cruzamento acontece em memória. O auto-join equivalente em SQL varria a
  // tabela inteira contra ela mesma e levava minutos — caro demais para um
  // guard-rail que existe para ser barato o bastante para rodar sempre.
  const { rows: reversoes } = await client.query(
    `SELECT id, account_id, posted_on, amount_cents, transfer_status FROM fin_transaction
      WHERE (description_norm ~ '(estorno|devolucao|devolvido|reembolso)'
         OR source_kind ILIKE '%REFUND%')
        AND transfer_status <> 'anulado'`
  );
  // Balde de estornos disponíveis, indexado pela saída que eles anulariam.
  const estornosLivres = new Map();
  for (const r of reversoes) {
    const chave = `${r.account_id}|${r.posted_on}|${-r.amount_cents}`;
    if (!estornosLivres.has(chave)) estornosLivres.set(chave, []);
    estornosLivres.get(chave).push(r);
  }
  for (const lista of estornosLivres.values()) lista.sort((a, b) => a.id - b.id);

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
    p.admissao = p.transfer_status === 'em_transito' ? 'em_transito' : 'evidencia_propria';
    p.estornada = false;
    universo.push(p);
  }

  // ------------------------------------------------------- anulação por estorno
  //
  // Consome os estornos disponíveis, do menor id para o maior, e só entre as
  // pernas realmente em trânsito: uma linha admitida por evidência própria não
  // é candidata a anulação, porque ninguém afirmou que ela está pendente.
  const anulacoes = [];
  for (const p of universo) {
    if (!ANULAR) break;
    if (p.transfer_status !== 'em_transito' || p.amount_cents >= 0) continue;
    const chave = `${p.account_id}|${p.posted_on}|${p.amount_cents}`;
    const livres = estornosLivres.get(chave);
    if (!livres?.length) continue;
    const estorno = livres.shift();
    p.estornada = true;
    anulacoes.push({
      grupo: `rv:${Math.min(p.id, estorno.id)}-${Math.max(p.id, estorno.id)}`,
      saida: p,
      estorno,
      // Quantas saídas idênticas disputavam este estorno. > 1 significa escolha
      // arbitrária entre linhas indistinguíveis, e o relatório precisa dizer.
      irmas: universo.filter((x) => x.transfer_status === 'em_transito'
        && x.account_id === p.account_id && x.posted_on === p.posted_on
        && x.amount_cents === p.amount_cents).length
    });
  }
  const anuladas = new Set(anulacoes.map((a) => a.saida.id));

  // Anuladas saem do pareamento: não há outro lado para achar.
  const saidas = universo.filter((p) => p.amount_cents < 0 && !anuladas.has(p.id));
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

    // ------------------------------------------------ bloco fechado e homogêneo
    //
    // A unicidade mútua trava num caso que NÃO é ambíguo de verdade: k saídas
    // idênticas contra k entradas idênticas, e nada mais. Foi o que aconteceu em
    // 2026-03-20 — duas saídas de R$ 16.700 do Asaas e dois créditos de
    // R$ 16.700 no Nubank, no mesmo dia. O motor via 2×2, chamava de ambíguo e
    // não pareava nenhum, deixando R$ 33.400 de dupla contagem de pé.
    //
    // Mas "qual saída casa com qual entrada" só é uma pergunta se as respostas
    // diferirem em algo. Aqui não diferem: as saídas são iguais entre si em
    // conta, data e valor; as entradas também. As duas atribuições possíveis
    // produzem exatamente o mesmo saldo por conta, a mesma DRE e o mesmo
    // conjunto de linhas neutralizadas. Recusar é preferir uma dupla contagem
    // real a uma escolha sem consequência.
    //
    // As três condições, todas necessárias:
    //   · FECHADO   — nenhum membro do bloco tem candidato fora dele; se tivesse,
    //                 a escolha passaria a ter consequência;
    //   · HOMOGÊNEO — todas as saídas idênticas entre si, idem as entradas;
    //   · QUADRADO  — mesma quantidade dos dois lados, ninguém sobra.
    const assinatura = (p) => `${p.account_id}|${p.posted_on}|${p.amount_cents}`;
    const blocos = new Map();
    for (const s of saidas) {
      if (usada.has(s.id)) continue;
      const opcoes = (candidatosDe.get(s.id) ?? []).filter((e) => !usada.has(e.id));
      if (opcoes.length < 2) continue;
      // Chave do bloco: a assinatura da saída somada à das entradas candidatas.
      const chave = `${assinatura(s)}>>${opcoes.map(assinatura).sort().join('~')}`;
      if (!blocos.has(chave)) blocos.set(chave, { saidas: [], entradas: opcoes });
      blocos.get(chave).saidas.push(s);
    }

    for (const bloco of blocos.values()) {
      const ss = bloco.saidas.filter((s) => !usada.has(s.id)).sort((a, b) => a.id - b.id);
      const ee = bloco.entradas.filter((e) => !usada.has(e.id)).sort((a, b) => a.id - b.id);
      if (ss.length < 2 || ss.length !== ee.length) continue;

      const homogeneo = new Set(ss.map(assinatura)).size === 1
                     && new Set(ee.map(assinatura)).size === 1;
      if (!homogeneo) continue;

      // Fechado nos dois sentidos: ninguém do bloco enxerga fora dele, e
      // ninguém de fora enxerga para dentro.
      const idsE = new Set(ee.map((e) => e.id));
      const idsS = new Set(ss.map((s) => s.id));
      const fechado = ss.every((s) => {
        const op = (candidatosDe.get(s.id) ?? []).filter((e) => !usada.has(e.id));
        return op.length === idsE.size && op.every((e) => idsE.has(e.id));
      }) && ee.every((e) => {
        const op = (candidatosPara.get(e.id) ?? []).filter((s) => !usada.has(s.id));
        return op.length === idsS.size && op.every((s) => idsS.has(s.id));
      });
      if (!fechado) continue;

      for (let i = 0; i < ss.length; i += 1) {
        const s = ss[i];
        const e = ee[i];
        usada.add(s.id);
        usada.add(e.id);
        pares.push({
          criterio: criterio.id,
          rotulo: criterio.rotulo,
          // Confiança do bloco, não da linha: sabemos que o CONJUNTO está certo,
          // e que a atribuição interna não muda nada observável.
          confianca: criterio.confianca,
          bloco: ss.length,
          grupo: `tg:${Math.min(s.id, e.id)}-${Math.max(s.id, e.id)}`,
          saida: s,
          entrada: e,
          delta_dias: dias(e.posted_on, s.posted_on),
          delta_cents: e.amount_cents + s.amount_cents
        });
      }
      relatorio.blocos.push({
        criterio: criterio.id,
        tamanho: ss.length,
        valor: Math.abs(ss[0].amount_cents),
        data: ss[0].posted_on,
        de: ss[0].conta,
        para: ee[0].conta,
        saidas: ss.map((s) => s.id),
        entradas: ee.map((e) => e.id)
      });
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

  relatorio.anulacoes = anulacoes.map((a) => ({
    grupo: a.grupo,
    data: a.saida.posted_on,
    conta: a.saida.conta,
    valor: Math.abs(a.saida.amount_cents),
    saida: a.saida.id,
    estorno: a.estorno.id,
    irmas: a.irmas
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

  // Anuladas e admitidas por evidência própria não são órfãs: as primeiras estão
  // explicadas, e as segundas nunca foram declaradas pendentes.
  const orfas = universo.filter((p) => !usada.has(p.id)
    && !anuladas.has(p.id) && p.transfer_status === 'em_transito');
  const porMotivo = new Map();
  for (const p of orfas) {
    // Por que esta perna não fechou. A pergunta que o relatório precisa
    // responder não é "quantas sobraram" e sim "o que falta no acervo".
    let motivo;
    if (KINDS_SEM_CONTRAPARTE.has(p.source_kind)) motivo = 'conta destino não existe no ledger (cartão)';
    else if (p.source === 'inter_api' && p.source_kind === 'PAGAMENTO') motivo = 'pagamento a terceiro marcado como transferência (ver 0022)';
    else if (p.dica === 'caixa') motivo = 'destino Caixa — conta sem nenhum lançamento importado';
    else if (KINDS_POUPANCA.has(p.source_kind)) motivo = 'perna da conta de aplicação fora do período importado';
    else if (p.posted_on < primeiraOutraConta) motivo = 'sem cobertura de extrato: nenhuma outra conta tem linha nessa data';
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
    //
    // 'nao' entra na lista porque o universo ampliado admite pernas que nunca
    // foram declaradas em trânsito — é o caso dos créditos do Nubank, que
    // chegam por CSV/ERP e nascem 'nao'. O que continua barrado é o que
    // importa: já pareado, já anulado, ou grupo preenchido por outro processo.
    const r = await client.query(
      `UPDATE fin_transaction
          SET transfer_status = 'pareado', transfer_group_id = $2, updated_at = now()
        WHERE id = ANY($1::bigint[])
          AND transfer_status IN ('em_transito', 'nao')
          AND transfer_group_id IS NULL`,
      [[p.saida.id, p.entrada.id], p.grupo]
    );
    if (r.rowCount !== 2) throw new Error(`par ${p.grupo}: esperava atualizar 2 pernas, atualizou ${r.rowCount}`);
  }

  // ------------------------------------------------------------- anulações
  //
  // Escrita separada da de pareamento porque o fato é outro: aqui não há duas
  // contas, há uma conta e um movimento que voltou. A coluna reversal_group_id
  // e o status 'anulado' vêm da migration 0044 — se ela ainda não rodou, o
  // motor não inventa a coluna: reporta e segue só com o pareamento.
  const { rows: [temColuna] } = await client.query(
    `SELECT count(*) n FROM information_schema.columns
      WHERE table_name = 'fin_transaction' AND column_name = 'reversal_group_id'`
  );
  const anulacaoDisponivel = Number(temColuna.n) > 0;

  if (anulacaoDisponivel) {
    for (const a of anulacoes) {
      await client.query(
        `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, before, after, fields, actor)
         SELECT t.entity_id, 'fin_transaction', t.id, 'bulk_update',
                jsonb_build_object('transfer_status', t.transfer_status),
                jsonb_build_object('transfer_status', 'anulado', 'reversal_group_id', $2::text,
                                   'motivo', 'estorno na própria conta, mesmo dia e valor',
                                   'saidas_identicas_no_balde', $3::int),
                ARRAY['transfer_status', 'reversal_group_id'], $4
           FROM fin_transaction t WHERE t.id = ANY($1::bigint[])`,
        [[a.saida.id, a.estorno.id], a.grupo, a.irmas, ATOR]
      );
      const r = await client.query(
        `UPDATE fin_transaction
            SET transfer_status = 'anulado', reversal_group_id = $2, updated_at = now()
          WHERE id = ANY($1::bigint[])
            AND transfer_status <> 'anulado'
            AND reversal_group_id IS NULL`,
        [[a.saida.id, a.estorno.id], a.grupo]
      );
      if (r.rowCount !== 2) throw new Error(`anulação ${a.grupo}: esperava 2 pernas, atualizou ${r.rowCount}`);
    }
  }

  // -------------------------------------------------------------- invariantes
  const { rows: grupos } = await client.query(
    `SELECT transfer_group_id, count(*) pernas, count(DISTINCT account_id) contas, sum(amount_cents) soma
       FROM fin_transaction WHERE transfer_group_id IS NOT NULL
      GROUP BY 1 HAVING count(*) <> 2 OR count(DISTINCT account_id) <> 2 OR sum(amount_cents) <> 0`
  );
  if (grupos.length) throw new Error(`grupos inválidos após escrita: ${JSON.stringify(grupos.slice(0, 5))}`);

  // Contraparte: o mesmo teste que o gatilho da 0044 faz no banco, repetido aqui
  // para que o dry-run acuse ANTES de qualquer COMMIT, com a lista na mão.
  const { rows: divergentes } = await client.query(
    `SELECT t.transfer_group_id AS grupo,
            string_agg(DISTINCT cp.name || ' (' || cp.kind || ')', ' × ') AS contrapartes
       FROM fin_transaction t
       JOIN fin_counterparty cp ON cp.id = t.counterparty_id
      WHERE t.transfer_group_id IS NOT NULL AND cp.document_number IS NOT NULL
      GROUP BY 1
     HAVING count(DISTINCT cp.document_number) > 1
         OR bool_or(cp.kind IN ('cliente','fornecedor') AND cp.document_number <> $1)`,
    [CNPJ_CASA]
  );
  // Um grupo incompatível criado AGORA é bug do motor e derruba o COMMIT. Um
  // que já estava lá é dívida — o motor não a criou e não pode consertá-la por
  // conta própria (desfazer classificação é escrita destrutiva, e é o que a
  // migration 0044 faz, com prova e registro). Abortar por causa dela deixaria
  // o motor refém de um passivo que ele não produziu, então aqui ela é
  // denunciada, não engolida.
  const meusGrupos = new Set(pares.map((p) => p.grupo));
  const criadosAgora = divergentes.filter((d) => meusGrupos.has(d.grupo));
  if (criadosAgora.length) {
    throw new Error(
      `o motor criou ${criadosAgora.length} par(es) com contrapartes incompatíveis — isto é bug: ${
        criadosAgora.slice(0, 5).map((d) => `${d.grupo} [${d.contrapartes}]`).join('; ')}`
    );
  }
  relatorio.suspeitos = divergentes.map((d) => ({ grupo: d.grupo, contrapartes: d.contrapartes }));

  if (anulacaoDisponivel) {
    const { rows: rev } = await client.query(
      `SELECT reversal_group_id, count(*) pernas, count(DISTINCT account_id) contas, sum(amount_cents) soma
         FROM fin_transaction WHERE reversal_group_id IS NOT NULL
        GROUP BY 1 HAVING count(*) <> 2 OR count(DISTINCT account_id) <> 1 OR sum(amount_cents) <> 0`
    );
    if (rev.length) throw new Error(`anulações inválidas: ${JSON.stringify(rev.slice(0, 5))}`);
  }

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
    const ampliadas = universo.filter((p) => p.admissao === 'evidencia_propria').length;
    console.log(`universo: ${universo.length} pernas (${saidas.length} saídas, ${entradas.length} entradas)`);
    console.log(`  · em trânsito declarado: ${universo.length - ampliadas}`);
    console.log(`  · admitidas por evidência de remessa própria: ${ampliadas}${AMPLIAR ? '' : ' (ampliação DESLIGADA)'}`);
    if (travadas.length) console.log(`travadas por decisão humana, intocadas: ${travadas.length}`);
    console.log(`dicas de instituição do JSON cru do Inter: ${dicasCru.size || 'indisponível (degradado)'}`);
    console.log(`cobertura: a primeira linha fora da conta principal é de ${primeiraOutraConta}`);

    console.log(`\n${linha}\nPARES POR CRITÉRIO`);
    console.table(relatorio.criterios.map((c) => ({ ...c, valor: brl(c.valor) })));
    const total = pares.reduce((a, p) => a + Math.abs(p.saida.amount_cents), 0);
    console.log(`TOTAL: ${pares.length} pares · ${brl(total)} de dupla contagem eliminada`);

    if (relatorio.blocos.length) {
      console.log(`\n${linha}\nBLOCOS FECHADOS — ambiguidade k×k resolvida por equivalência (${relatorio.blocos.length})`);
      for (const b of relatorio.blocos) {
        console.log(`  ${b.data}  ${b.tamanho}×${b.tamanho}  ${brl(b.valor)}  ${b.de} → ${b.para}`);
        console.log(`      saídas ${b.saidas.join(', ')}  ↔  entradas ${b.entradas.join(', ')}`);
      }
      console.log('  As pernas de cada lado são idênticas entre si: qualquer atribuição dá o mesmo resultado.');
    }

    if (relatorio.anulacoes.length) {
      console.log(`\n${linha}\nANULAÇÕES — saída estornada na própria conta (${relatorio.anulacoes.length})`);
      console.table(relatorio.anulacoes.map((a) => ({
        data: a.data, conta: a.conta, valor: brl(a.valor),
        saida: a.saida, estorno: a.estorno,
        escolha: a.irmas > 1 ? `arbitrária entre ${a.irmas} idênticas` : 'única'
      })));
      console.log('  Não são transferências: o dinheiro nunca saiu do banco.');
    }

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

    if (relatorio.suspeitos?.length) {
      console.log(`\n${linha}\nPARES FALSOS PREEXISTENTES — não foram criados por este motor (${relatorio.suspeitos.length})`);
      for (const s of relatorio.suspeitos) console.log(`  ! ${s.grupo}  ${s.contrapartes}`);
      console.log('  As duas pernas apontam para contrapartes sem relação. Desfazer é escrita');
      console.log('  destrutiva: está na migration db/migrations/0044_fin_conciliacao.sql.');
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

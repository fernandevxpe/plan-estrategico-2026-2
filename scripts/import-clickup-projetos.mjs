// A obra vira centro de custo, e o custo da obra passa a existir.
//
// O buraco: fin_transaction.cost_center_id é NULL em 13.686 de 13.686 linhas. A
// plataforma não sabe qual obra consumiu qual custo e não responde "esta obra
// deu lucro?" — que numa empresa de obras é A pergunta.
//
// A fonte é o ClickUp, espaço Obras: a lista "Obras" tem 32 cards de projeto
// (31 com "Valor do Projeto") e a lista "Fluxo de caixa" tem 758 lançamentos
// (755 com "Valor pago", 728 ligados a um card). A ligação é RELACIONAMENTO, não
// texto: o campo "Projetos" traz um array de objetos e ler `.value` direto
// devolve "[object Object]". E ela fecha nos dois sentidos — as setas de ida
// batem uma a uma com "Registros de Pagamentos" na volta, zero órfãs. Dentro do
// ClickUp, "que obra consumiu isto" é dado confiável.
//
// ---------------------------------------------------------------------------
// O QUE ESTE SCRIPT NÃO FAZ, E POR QUÊ
// ---------------------------------------------------------------------------
// Não cria lançamento nenhum. Os ~R$ 970 mil que passam pelo "Fluxo de caixa"
// são O MESMO dinheiro já importado de Nubank, Inter e Asaas, visto por quem
// executa a obra. Virar fin_transaction contaria cada real duas vezes — o saldo
// dobrava e a DRE mentia. Por isso eles entram em fin_obra_apontamento, que não
// tem account_id e portanto não entra em saldo nenhum; e por isso a transação
// de escrita termina conferindo que count(*) e sum(amount_cents) de
// fin_transaction não mudaram, sob pena de ROLLBACK.
//
// E não carimba o ledger por padrão. O casamento entre a tarefa do ClickUp e a
// linha do banco é PARCIAL — medido abaixo, ~51% das tarefas. Um cost_center_id
// gravado só na metade que casa faz toda tela de margem somar metade do custo e
// mostrar como lucrativa uma obra que não é. Metade do custo não é uma margem
// aproximada: é uma margem errada. Então a margem vem da dimensão (completa) e
// o carimbo é opcional, só para navegar do apontamento até a linha do extrato.
//
// ---------------------------------------------------------------------------
// COMO A QUALIDADE DO CASAMENTO FOI MEDIDA (e por que uma faixa foi jogada fora)
// ---------------------------------------------------------------------------
// Não há gabarito. O único campo que parecia gabarito — "Data do Pagamento",
// preenchido em 35 tarefas — não é: as 35 são ENTRADA de "Receita Projeto" e 8
// têm data no futuro (out–dez/2026). É cronograma de recebimento, não registro
// de pagamento. E o due_date é vencimento: nos 32 casos comparáveis só 8
// coincidem com a data informada, com diferenças de até 316 dias.
//
// Sem gabarito, a medida é por PLACEBO: roda-se o mesmo casamento com todas as
// datas deslocadas em 30 dias, onde por construção nenhum acerto é possível, e
// o que sobra é a taxa de coincidência. Resultado:
//
//   faixa A  nome + valor exato + ≤2 dias + 1:1 .... 387 reais vs ~30 no placebo
//   faixa B  nome + valor exato + 3 a 7 dias ....... 14 reais vs ~18 no placebo
//   faixa C  só valor + data, nome não confirma .... 96 reais vs ~15 no placebo
//
// A faixa B produz no placebo MAIS pares do que na data real: é ruído, e foi
// removida do código (não existe tier 'B'). A faixa A estima ~8% de falso
// positivo, a C ~16%.
//
// O que faz a faixa A funcionar é um acidente feliz: em 386 das 758 tarefas
// alguém colou a linha do extrato no título ("Transferência Pix - PIX
// Marketplace - 10.573.52…"). Isso também explica o viés — 377 dos casamentos
// caem no Nubank e 1 no Inter, porque o hábito de colar existe numa conta e não
// na outra. Casamento alto no Nubank não quer dizer que o Inter foi conferido.
//
// Uso:
//   node scripts/import-clickup-projetos.mjs                  dry-run (PADRÃO)
//   node scripts/import-clickup-projetos.mjs --aplicar        grava dimensão
//   node scripts/import-clickup-projetos.mjs --aplicar --carimbar-ledger
//                                                             + cost_center_id (faixa A)
//   node scripts/import-clickup-projetos.mjs --json           saída legível por máquina
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';

loadEnv();

const ARGS = new Set(process.argv.slice(2));
const APLICAR = ARGS.has('--aplicar');
const CARIMBAR = ARGS.has('--carimbar-ledger');
const JSON_OUT = ARGS.has('--json');

const RAIZ = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const FONTE = path.join(RAIZ, 'data', 'raw', 'clickup-tasks.json');

const ESPACO = 'Obras';
const LISTA_OBRAS = 'Obras';
const LISTA_FLUXO = 'Fluxo de caixa';

const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const log = (...a) => { if (!JSON_OUT) console.log(...a); };

/**
 * Cards da lista "Obras" que ocupam o campo "Projetos" sem serem obra.
 *
 * "Custos internos" sozinho leva 424 lançamentos e R$ 256.727 — 41% de todo o
 * custo apontado. Tratado como obra, ele lidera o ranking de prejuízo da
 * empresa com margem de −12.311%, o que é literalmente verdade e completamente
 * inútil: ele não tem receita porque não é obra, é o balde do que ninguém
 * rateou. Por id e não por nome porque nome no ClickUp é editável.
 */
const CARDS_DE_APOIO = new Map([
  ['86aft90wg', 'corporativo'], // Custos internos
  ['86aghwz9d', 'consultoria'], // Consultoria
  ['86ae5wv62', 'corporativo']  // Ferramentas e equipamentos
]);

/**
 * Categorias do ClickUp que são movimento de tesouraria, não custo de obra.
 *
 * São R$ 181.531 apontados a obras — 42% do custo aparente. "Pagamento de
 * Fatura" (R$ 78.540) é a fatura do cartão, e as compras dentro dela já estão
 * lançadas uma a uma: contá-la de novo é dobrar o custo. "Reserva de caixa"
 * (R$ 80.427) e as aplicações RDB são dinheiro mudando de bolso. Sem esta
 * marca, Edf. Verano carrega uma "Aplicação RDB" de R$ 17.000 como custo e
 * fecha no vermelho por causa dela.
 */
const CATEGORIAS_TESOURARIA = new Set(['Reserva de caixa', 'Pagamento de Fatura', 'Caixa Impostos']);

/**
 * RDB pelo TOKEN, e não por "Aplicação RDB".
 *
 * São 38 tarefas e R$ 112.720 de aplicação e resgate de RDB, e a categoria não
 * salva: 20 delas estão em "Impostos e taxas", "Serviços bancários" e até
 * "Receita Projeto". A primeira versão desta regra procurava "aplicação rdb" e
 * deixava passar R$ 9.729 — R$ 4.342 no Condomínio Reserva do Poço, R$ 1.137 no
 * Samsara — porque o título vem com o acento quebrado ("AplicaÃ§Ã£o RDB") e a
 * palavra acentuada nunca casava. Casar só "RDB" é imune a isso: RDB é produto
 * de banco, e não existe custo de obra chamado RDB (verificado nas 758 tarefas:
 * a regra pega as 38 e nenhuma a mais).
 */
const TITULO_TESOURARIA = /\brdb\b|dinheiro\s+resgatad/i;

/**
 * Conserta acento quebrado: UTF-8 lido como Latin-1 em algum ponto da cadeia.
 *
 * 76 das 758 tarefas chegam assim ("ComissÃ£o gestÃ£o"), e o extrato do Nubank
 * tem o mesmo defeito ("TransferÃªncia enviada pelo Pix"). Sem consertar, o
 * título fica ilegível na tela E os tokens de "Transferência" e "TransferÃªncia"
 * não se encontram — o casamento por nome perde os dois lados de uma vez.
 *
 * O guarda do caractere de substituição impede o estrago inverso: aplicar a
 * conversão num texto já correto produziria mojibake onde não havia.
 */
function repararAcentos(texto) {
  if (!texto || !/[ÃÂ][-¿]/.test(texto)) return texto;
  const reparado = Buffer.from(texto, 'latin1').toString('utf8');
  return reparado.includes('�') ? texto : reparado;
}

const CONTA_CLICKUP = { Nubank: 'nubank', Inter: 'inter', Assas: 'asaas' };

// ---------------------------------------------------------------------------
// Leitura do ClickUp
// ---------------------------------------------------------------------------

/**
 * Centavos a partir do texto do campo currency, sem passar por float.
 *
 * parseFloat('1643.34') * 100 é 164333.99999999997, e Math.round salva o caso
 * comum mas não a intenção: a regra da casa é centavo inteiro, e a aritmética
 * decimal é onde ela vaza. Aqui o valor nunca vira ponto flutuante.
 */
function paraCentavos(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const texto = String(valor).trim().replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(texto)) return null;
  const negativo = texto.startsWith('-');
  const [inteiro, decimal = ''] = texto.replace('-', '').split('.');
  const centavos = BigInt(inteiro) * 100n + BigInt((decimal + '00').slice(0, 2));
  return Number(negativo ? -centavos : centavos);
}

const campo = (tarefa, nome) => (tarefa.custom_fields || []).find((f) => f.name === nome);

/**
 * Dropdown do ClickUp resolvido para o RÓTULO.
 *
 * `value` é o orderindex ("0", "1"), e só o type_config.options daquela tarefa
 * diz o que ele significa. Guardar o índice cru deixaria a tabela refém de uma
 * reordenação do dropdown que ninguém avisa — e que reescreveria o passado.
 */
function rotulo(tarefa, nome) {
  const f = campo(tarefa, nome);
  if (!f || f.value === null || f.value === undefined || f.value === '') return null;
  const opcoes = f.type_config?.options || [];
  const achado = opcoes.find((o) => String(o.orderindex) === String(f.value)) || opcoes.find((o) => o.id === f.value);
  return achado?.name ?? null;
}

/**
 * Relacionamento: `value` é ARRAY DE OBJETOS, use `.name`.
 *
 * Ler o campo como escalar devolve "[object Object]" — é o erro que a exploração
 * cometeu e que faz um relatório inteiro parecer plausível apontando para nada.
 */
function relacionados(tarefa, nome) {
  const f = campo(tarefa, nome);
  return Array.isArray(f?.value) ? f.value.filter((x) => x && x.id) : [];
}

const dataDe = (ms) => (ms ? new Date(Number(ms)).toISOString().slice(0, 10) : null);

function slugificar(texto) {
  return texto
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '');
}

function lerClickUp() {
  const bruto = JSON.parse(readFileSync(FONTE, 'utf8'));
  const tarefas = bruto.data || [];
  const naLista = (nome) => tarefas.filter((t) => t.space_name === ESPACO && t.list_name === nome);
  return { syncedAt: bruto.syncedAt, obras: naLista(LISTA_OBRAS), fluxo: naLista(LISTA_FLUXO) };
}

/**
 * Cards de obra → centros de custo.
 *
 * O slug limpo vai para o card de id menor e os seguintes ganham sufixo: "Edf.
 * Castelo the Blois" e "Edf. Castelo The Blois" são DOIS cards, com contratos de
 * R$ 19.800 e R$ 16.190, e produzem o mesmo slug. A ordenação por id torna o
 * desempate determinístico — a segunda importação escolhe igual. Ainda assim é
 * source_id, não slug, que identifica a obra no UPSERT.
 */
function montarCentros(obras) {
  const usados = new Set();
  return [...obras].sort((a, b) => a.id.localeCompare(b.id)).map((t, i) => {
    const apoio = CARDS_DE_APOIO.has(t.id);
    let slug = `obra-${slugificar(t.name)}`;
    if (usados.has(slug)) slug = `${slug}-${t.id}`;
    usados.add(slug);
    return {
      slug,
      name: t.name,
      kind: apoio ? 'apoio' : 'obra',
      nucleo: apoio ? CARDS_DE_APOIO.get(t.id) : 'obras',
      source: 'clickup',
      source_id: t.id,
      source_list_id: t.list_id ?? null,
      source_status: t.status?.status ?? null,
      external_url: t.url ?? null,
      contract_cents: paraCentavos(campo(t, 'Valor do Projeto')?.value),
      signed_on: dataDe(campo(t, 'Data da Assinatura')?.value),
      sort_order: 100 + i
    };
  });
}

/**
 * Tarefas do "Fluxo de caixa" → apontamentos.
 *
 * Uma tarefa com dois projetos vira DUAS linhas com allocated_cents rateado, e é
 * allocated_cents que a margem soma. São 3 tarefas hoje (uma compra de material
 * dividida entre Reserva do Poço e Montendre, R$ 1.184); somar o valor cheio nas
 * duas obras inventaria R$ 2.350 de custo que não existe.
 */
function montarApontamentos(fluxo, porSourceId) {
  const linhas = [];
  const semProjeto = [];
  for (const t of fluxo) {
    const valor = paraCentavos(campo(t, 'Valor pago')?.value);
    const projetos = relacionados(t, 'Projetos');
    const categoria = rotulo(t, 'Categoria');
    const movimento = rotulo(t, 'Movimentação');

    if (valor === null || valor === 0) continue;
    if (!projetos.length) { semProjeto.push({ id: t.id, name: t.name, valor }); continue; }

    const titulo = repararAcentos(t.name) || '(sem título)';

    const direcao = movimento === 'Entrada' ? 'entrada'
      : movimento === 'Saida' ? 'saida'
      : categoria === 'Receita Projeto' ? 'entrada'
      : 'indefinido';

    const tesouraria = CATEGORIAS_TESOURARIA.has(categoria) || TITULO_TESOURARIA.test(titulo);

    // O resto da divisão vai para a primeira obra: rateio que não fecha é
    // dinheiro que some, e centavo que some vira divergência entre telas.
    const cota = Math.floor(valor / projetos.length);
    const resto = valor - cota * projetos.length;

    projetos.forEach((p, i) => {
      const centro = porSourceId.get(p.id);
      if (!centro) return; // projeto referenciado que não está na lista Obras
      linhas.push({
        cost_center_slug: centro.slug,
        cost_center_source_id: p.id,
        source: 'clickup',
        source_id: t.id,
        source_list_id: t.list_id ?? null,
        external_url: t.url ?? null,
        title: titulo,
        amount_cents: valor,
        allocated_cents: cota + (i === 0 ? resto : 0),
        direction: direcao,
        is_treasury: tesouraria,
        clickup_category: categoria,
        clickup_subcategory: rotulo(t, 'Subcategoria'),
        payment_method: rotulo(t, 'Forma de Pagamento'),
        beneficiary: rotulo(t, 'Beneficiado'),
        source_account: rotulo(t, 'Conta Pagadora'),
        due_on: dataDe(t.due_date),
        scheduled_on: dataDe(campo(t, 'Data do Pagamento')?.value),
        created_on: dataDe(t.date_created),
        task_status: t.status?.status ?? null,
        // Uma linha por projeto, mas UM projeto por tarefa é o que autoriza
        // carimbar o ledger: com dois, não existe resposta para "de que obra é
        // esta linha do extrato".
        projeto_unico: projetos.length === 1
      });
    });
  }
  return { linhas, semProjeto };
}

// ---------------------------------------------------------------------------
// Casamento com o ledger
// ---------------------------------------------------------------------------

const SEM_SENTIDO = new Set([
  'TRANSFERENCIA', 'PIX', 'ENVIADA', 'ENVIADO', 'RECEBIDO', 'RECEBIDA', 'PELO', 'PELA',
  'DE', 'DA', 'DO', 'DOS', 'DAS', 'LTDA', 'EPP', 'AGENCIA', 'CONTA', 'PAGAMENTOS',
  'BANCO', 'PAGAMENTO', 'EM', 'PARA', 'COM', 'MEI'
]);

/**
 * Tokens comparáveis entre o título da tarefa e a descrição do extrato.
 *
 * As palavras removidas aparecem em quase toda linha de Pix e dariam
 * similaridade alta entre duas transferências sem nenhuma relação — que é
 * exatamente o falso positivo que se quer evitar. Números caem junto: "0260" e
 * "10.573.52" são agência e CNPJ truncado, não identidade.
 */
function tokens(texto) {
  const limpo = repararAcentos(texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  return new Set(limpo.split(' ').filter((p) => p.length >= 3 && !SEM_SENTIDO.has(p) && !/^\d+$/.test(p)));
}

/** Sobreposição pelo MENOR conjunto: "Posto curado" tem 2 tokens e a linha do
 *  banco tem 6; Jaccard puro puniria o título curto por ser curto. */
function similaridade(a, b) {
  if (!a.size || !b.size) return 0;
  let iguais = 0;
  for (const x of a) if (b.has(x)) iguais++;
  return iguais / Math.min(a.size, b.size);
}

const diasEntre = (a, b) => Math.round((new Date(a) - new Date(b)) / 86_400_000);

const JANELA_DIAS = 7;
const JANELA_FAIXA_A = 2;
const SIMILARIDADE_MINIMA = 0.5;

/**
 * Casa apontamentos com lançamentos e devolve a faixa de cada um.
 *
 * `deslocamentoDias` existe para o placebo: com todas as datas empurradas 30
 * dias, nenhum par pode estar certo, e o que o casamento ainda encontra é a
 * taxa de coincidência. Sem isso não haveria como afirmar nada sobre a
 * qualidade — não existe gabarito nesta base.
 */
function casar(tarefas, ledger, deslocamentoDias = 0) {
  const porValor = new Map();
  for (const l of ledger) {
    const chave = String(Math.abs(l.amount_cents));
    if (!porValor.has(chave)) porValor.set(chave, []);
    porValor.get(chave).push(l);
  }

  // Tarefas com mesmo valor no mesmo dia são indistinguíveis entre si, então
  // nenhuma delas pode reivindicar uma linha com confiança. São 44 grupos, 95
  // tarefas, R$ 60.172 — e parte é duplicata de digitação de verdade
  // ("Condominio Reserva do poço" e "Condominio reserva do poço", R$ 16.700 no
  // mesmo dia), o que o casamento não tem como saber.
  const gemeas = new Map();
  for (const t of tarefas) {
    if (!t.due_on) continue;
    const k = `${t.amount_cents}@${t.due_on}`;
    if (!gemeas.has(k)) gemeas.set(k, []);
    gemeas.get(k).push(t.source_id);
  }
  const ambigua = new Set();
  for (const [, ids] of gemeas) if (new Set(ids).size > 1) ids.forEach((id) => ambigua.add(id));

  const deslocar = (iso) => {
    if (!deslocamentoDias) return iso;
    const d = new Date(iso);
    d.setDate(d.getDate() + deslocamentoDias);
    return d.toISOString().slice(0, 10);
  };

  const propostas = [];
  const resultado = new Map();

  for (const t of tarefas) {
    if (!t.due_on) { resultado.set(t.source_id, { tier: '-' }); continue; }
    const base = deslocar(t.due_on);

    let candidatos = (porValor.get(String(t.amount_cents)) || [])
      .filter((l) => Math.abs(diasEntre(l.posted_on, base)) <= JANELA_DIAS);
    if (t.direction === 'saida') candidatos = candidatos.filter((l) => l.amount_cents < 0);
    if (t.direction === 'entrada') candidatos = candidatos.filter((l) => l.amount_cents > 0);
    const conta = CONTA_CLICKUP[t.source_account];
    if (conta) candidatos = candidatos.filter((l) => l.conta === conta);

    const alvo = tokens(t.title);
    const pontuados = candidatos.map((l) => ({
      l,
      score: similaridade(alvo, l.tokens),
      delta: Math.abs(diasEntre(l.posted_on, base))
    }));
    const confirmados = pontuados.filter((c) => c.score >= SIMILARIDADE_MINIMA);

    if (confirmados.length === 1) propostas.push({ t, c: confirmados[0], nome: true });
    else if (confirmados.length === 0 && pontuados.length === 1) propostas.push({ t, c: pontuados[0], nome: false });
    else if (pontuados.length === 0) resultado.set(t.source_id, { tier: 'N' });
    else resultado.set(t.source_id, { tier: 'X', motivo: 'candidatos ambíguos', candidatos: pontuados.length });
  }

  // Duas tarefas que apontam para a MESMA linha do extrato não podem estar as
  // duas certas — e não há como saber qual. Ambas caem para 'X'.
  const disputadas = new Map();
  for (const p of propostas) {
    if (!disputadas.has(p.c.l.id)) disputadas.set(p.c.l.id, []);
    disputadas.get(p.c.l.id).push(p);
  }

  for (const p of propostas) {
    const so = disputadas.get(p.c.l.id).length === 1 && !ambigua.has(p.t.source_id);
    if (!so) {
      resultado.set(p.t.source_id, { tier: 'X', motivo: 'linha disputada ou tarefa gêmea' });
    } else if (p.nome && p.c.delta <= JANELA_FAIXA_A) {
      resultado.set(p.t.source_id, {
        tier: 'A', transaction_id: p.c.l.id, score: p.c.score, delta: p.c.delta,
        reason: { criterio: 'nome+valor+data', score: Number(p.c.score.toFixed(3)), dias: p.c.delta, descricao: p.c.l.description }
      });
    } else if (p.nome) {
      // Faixa medida e descartada: no placebo ela aparece tanto quanto na data
      // real. Vira 'X' em vez de virar um carimbo com cara de evidência.
      resultado.set(p.t.source_id, { tier: 'X', motivo: `nome confere mas ${p.c.delta} dias de distância — indistinguível de acaso` });
    } else {
      resultado.set(p.t.source_id, {
        tier: 'C', transaction_id: p.c.l.id, score: p.c.score, delta: p.c.delta,
        reason: { criterio: 'valor+data, nome não confirma', dias: p.c.delta, descricao: p.c.l.description }
      });
    }
  }
  return resultado;
}

// ---------------------------------------------------------------------------
// Relatório
// ---------------------------------------------------------------------------

function agregarPorObra(centros, linhas) {
  const porSlug = new Map(centros.map((c) => [c.slug, {
    ...c, receita: 0, custo: 0, indefinido: 0, tesouraria: 0, n: 0, custoConciliado: 0
  }]));
  for (const l of linhas) {
    const a = porSlug.get(l.cost_center_slug);
    if (!a) continue;
    a.n++;
    if (l.is_treasury) a.tesouraria += l.allocated_cents;
    else if (l.direction === 'entrada') a.receita += l.allocated_cents;
    else if (l.direction === 'saida') {
      a.custo += l.allocated_cents;
      if (l.match?.tier === 'A') a.custoConciliado += l.allocated_cents;
    } else a.indefinido += l.allocated_cents;
  }
  for (const a of porSlug.values()) a.margem = a.receita - a.custo - a.indefinido;
  return [...porSlug.values()];
}

function imprimirMargem(agregado) {
  const obras = agregado.filter((a) => a.kind === 'obra').sort((a, b) => b.margem - a.margem);
  const apoio = agregado.filter((a) => a.kind === 'apoio').sort((a, b) => a.margem - b.margem);

  log('\n=== MARGEM POR OBRA (dimensão ClickUp; indefinido tratado como custo) ===');
  log(['      receita', '        custo', '     margem', '  marg%', '  contratado', ' conc%', ' obra'].join(''));
  for (const a of obras) {
    const custo = a.custo + a.indefinido;
    const pct = a.receita ? `${((a.margem / a.receita) * 100).toFixed(0)}%` : '—';
    const conc = a.custo ? `${((a.custoConciliado / a.custo) * 100).toFixed(0)}%` : '—';
    log(
      brl(a.receita).padStart(13), brl(custo).padStart(13), brl(a.margem).padStart(13),
      pct.padStart(6), brl(a.contract_cents || 0).padStart(13), conc.padStart(5),
      ' ', a.name, a.source_status ? `[${a.source_status}]` : ''
    );
  }
  const soma = (xs, k) => xs.reduce((s, x) => s + x[k], 0);
  log('\nOBRAS  receita', brl(soma(obras, 'receita')), '| custo', brl(soma(obras, 'custo') + soma(obras, 'indefinido')),
    '| margem', brl(soma(obras, 'margem')),
    `(${((soma(obras, 'margem') / Math.max(soma(obras, 'receita'), 1)) * 100).toFixed(1)}%)`);

  log('\n=== NÃO É OBRA (kind=apoio): custo que ninguém rateou ===');
  for (const a of apoio) {
    log(brl(a.custo + a.indefinido).padStart(13), ' ', a.name, `(${a.n} apontamentos)`);
  }
  const custoApoio = soma(apoio, 'custo') + soma(apoio, 'indefinido');
  const custoObras = soma(obras, 'custo') + soma(obras, 'indefinido');
  log('\nCusto de apoio', brl(custoApoio), 'de', brl(custoApoio + custoObras),
    `= ${((custoApoio / Math.max(custoApoio + custoObras, 1)) * 100).toFixed(1)}% do custo total apontado`);
  log('Se rateado pro-rata na receita, a margem das obras vai de',
    brl(soma(obras, 'margem')), 'para', brl(soma(obras, 'margem') - custoApoio),
    `(${(((soma(obras, 'margem') - custoApoio) / Math.max(soma(obras, 'receita'), 1)) * 100).toFixed(1)}%)`);
  log('Tesouraria excluída do custo:', brl(soma(agregado, 'tesouraria')),
    '— fatura de cartão, reserva de caixa e RDB. Contá-la duplicaria despesa já lançada.');
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

async function gravar(pool, centros, linhas) {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    // A guarda de dinheiro. Se a transação inteira mexer num único centavo do
    // ledger, ela não é commitada — este script escreve dimensão, não caixa.
    const antes = (await cliente.query(
      'SELECT count(*)::bigint n, COALESCE(sum(amount_cents),0)::bigint s FROM fin_transaction'
    )).rows[0];

    const entidade = (await cliente.query("SELECT id FROM fin_entity WHERE slug = 'xpe'")).rows[0]?.id;
    if (!entidade) throw new Error("fin_entity 'xpe' não existe");

    // Uma consulta por lote, não por linha. São 32 centros e 728 apontamentos:
    // em ida-e-volta individual isso é mais de mil viagens até um banco remoto,
    // e uma importação que leva minutos é uma importação que ninguém agenda.
    const col = (f) => centros.map(f);
    await cliente.query(
      `INSERT INTO fin_cost_center
         (entity_id, slug, name, kind, nucleo, source, source_id, source_list_id,
          source_status, external_url, contract_cents, signed_on, sort_order, synced_at)
       SELECT $1, d.slug, d.name, d.kind, d.nucleo, 'clickup', d.source_id, d.list_id,
              d.status, d.url, d.contrato, d.assinatura::date, d.ordem, now()
         FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[],
                     $8::text[], $9::text[], $10::bigint[], $11::text[], $12::int[])
              AS d(slug, name, kind, nucleo, source_id, list_id, status, url, contrato, assinatura, ordem)
       ON CONFLICT (source, source_id) WHERE source_id IS NOT NULL DO UPDATE SET
         name = EXCLUDED.name, kind = EXCLUDED.kind, nucleo = EXCLUDED.nucleo,
         source_list_id = EXCLUDED.source_list_id, source_status = EXCLUDED.source_status,
         external_url = EXCLUDED.external_url, contract_cents = EXCLUDED.contract_cents,
         signed_on = EXCLUDED.signed_on, synced_at = now()`,
      [entidade, col((c) => c.slug), col((c) => c.name), col((c) => c.kind), col((c) => c.nucleo),
        col((c) => c.source_id), col((c) => c.source_list_id), col((c) => c.source_status),
        col((c) => c.external_url), col((c) => c.contract_cents), col((c) => c.signed_on),
        col((c) => c.sort_order)]
    );

    // cost_center_id sai do JOIN por source_id, não de um mapa em memória: é a
    // mesma chave que a linha acima acabou de gravar, então não há como as duas
    // discordarem.
    const cel = (f) => linhas.map(f);
    await cliente.query(
      `INSERT INTO fin_obra_apontamento
         (entity_id, cost_center_id, source, source_id, source_list_id, external_url, title,
          amount_cents, allocated_cents, direction, is_treasury, clickup_category,
          clickup_subcategory, payment_method, beneficiary, source_account,
          due_on, scheduled_on, created_on, task_status,
          transaction_id, match_tier, match_score, match_delta_days, match_reason, synced_at)
       SELECT $1, cc.id, 'clickup', d.source_id, d.list_id, d.url, d.title,
              d.amount, d.alocado, d.direcao, d.tesouraria, d.categoria, d.subcategoria,
              d.forma, d.beneficiado, d.conta, d.venc::date, d.previsto::date, d.criado::date,
              d.status, d.tx, d.tier, d.score, d.dias, d.motivo::jsonb, now()
         FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::bigint[],
                     $8::bigint[], $9::text[], $10::boolean[], $11::text[], $12::text[], $13::text[],
                     $14::text[], $15::text[], $16::text[], $17::text[], $18::text[], $19::text[],
                     $20::bigint[], $21::text[], $22::numeric[], $23::int[], $24::text[])
              AS d(cc_source_id, source_id, list_id, url, title, amount, alocado, direcao,
                   tesouraria, categoria, subcategoria, forma, beneficiado, conta,
                   venc, previsto, criado, status, tx, tier, score, dias, motivo)
         JOIN fin_cost_center cc ON cc.source = 'clickup' AND cc.source_id = d.cc_source_id
       ON CONFLICT (source, source_id, cost_center_id) DO UPDATE SET
         title = EXCLUDED.title, amount_cents = EXCLUDED.amount_cents,
         allocated_cents = EXCLUDED.allocated_cents, direction = EXCLUDED.direction,
         is_treasury = EXCLUDED.is_treasury, clickup_category = EXCLUDED.clickup_category,
         clickup_subcategory = EXCLUDED.clickup_subcategory, payment_method = EXCLUDED.payment_method,
         beneficiary = EXCLUDED.beneficiary, source_account = EXCLUDED.source_account,
         due_on = EXCLUDED.due_on, scheduled_on = EXCLUDED.scheduled_on,
         created_on = EXCLUDED.created_on, task_status = EXCLUDED.task_status,
         external_url = EXCLUDED.external_url, synced_at = now(),
         -- Conferência humana não é desfeita pela importação da noite seguinte.
         transaction_id   = CASE WHEN fin_obra_apontamento.match_locked THEN fin_obra_apontamento.transaction_id   ELSE EXCLUDED.transaction_id END,
         match_tier       = CASE WHEN fin_obra_apontamento.match_locked THEN fin_obra_apontamento.match_tier       ELSE EXCLUDED.match_tier END,
         match_score      = CASE WHEN fin_obra_apontamento.match_locked THEN fin_obra_apontamento.match_score      ELSE EXCLUDED.match_score END,
         match_delta_days = CASE WHEN fin_obra_apontamento.match_locked THEN fin_obra_apontamento.match_delta_days ELSE EXCLUDED.match_delta_days END,
         match_reason     = CASE WHEN fin_obra_apontamento.match_locked THEN fin_obra_apontamento.match_reason     ELSE EXCLUDED.match_reason END`,
      [entidade, cel((l) => l.cost_center_source_id), cel((l) => l.source_id), cel((l) => l.source_list_id),
        cel((l) => l.external_url), cel((l) => l.title), cel((l) => l.amount_cents), cel((l) => l.allocated_cents),
        cel((l) => l.direction), cel((l) => l.is_treasury), cel((l) => l.clickup_category),
        cel((l) => l.clickup_subcategory), cel((l) => l.payment_method), cel((l) => l.beneficiary),
        cel((l) => l.source_account), cel((l) => l.due_on), cel((l) => l.scheduled_on), cel((l) => l.created_on),
        cel((l) => l.task_status), cel((l) => l.match?.transaction_id ?? null), cel((l) => l.match?.tier ?? null),
        cel((l) => (l.match?.score ?? null)), cel((l) => l.match?.delta ?? null),
        cel((l) => (l.match?.reason ? JSON.stringify(l.match.reason) : null))]
    );

    let carimbados = 0;
    if (CARIMBAR) {
      // Faz o gatilho fin_preserve_human_locks valer: quem travou
      // cost_center_id na mão não é sobrescrito nem por engano deste script.
      await cliente.query("SET LOCAL fin.sync_mode = 'on'");
      // "Projeto único" é a subconsulta, não uma flag do JS: a tarefa que aponta
      // duas obras vira duas linhas e não existe resposta para "de que obra é
      // esta linha do extrato" — então ela não carimba nada.
      const r = await cliente.query(
        `UPDATE fin_transaction t
            SET cost_center_id = a.cost_center_id
           FROM fin_obra_apontamento a
          WHERE a.transaction_id = t.id
            AND a.match_tier = 'A'
            AND t.cost_center_id IS NULL
            AND NOT ('cost_center_id' = ANY (t.human_locked_fields))
            AND (SELECT count(*) FROM fin_obra_apontamento b
                  WHERE b.source = a.source AND b.source_id = a.source_id) = 1`
      );
      carimbados = r.rowCount;
    }

    const depois = (await cliente.query(
      'SELECT count(*)::bigint n, COALESCE(sum(amount_cents),0)::bigint s FROM fin_transaction'
    )).rows[0];
    if (antes.n !== depois.n || antes.s !== depois.s) {
      throw new Error(
        `ledger alterado — ROLLBACK. antes ${antes.n}/${antes.s}, depois ${depois.n}/${depois.s}. ` +
        'Este script grava dimensão, nunca dinheiro.'
      );
    }

    await cliente.query('COMMIT');
    return { carimbados };
  } catch (erro) {
    await cliente.query('ROLLBACK');
    throw erro;
  } finally {
    cliente.release();
  }
}

// ---------------------------------------------------------------------------

async function principal() {
  const { syncedAt, obras, fluxo } = lerClickUp();
  log(`ClickUp sincronizado em ${syncedAt}: ${obras.length} cards de projeto, ${fluxo.length} lançamentos de fluxo de caixa`);

  const centros = montarCentros(obras);
  const porSourceId = new Map(centros.map((c) => [c.source_id, c]));
  const { linhas, semProjeto } = montarApontamentos(fluxo, porSourceId);

  const pool = financePool();
  try {
    const existe = await pool.query("SELECT to_regclass('public.fin_obra_apontamento') AS t");
    const migrada = Boolean(existe.rows[0].t);
    if (!migrada && APLICAR) {
      throw new Error('db/migrations/0031_fin_obras_centro_custo.sql ainda não foi aplicada — rode as migrations antes de --aplicar');
    }

    const { rows } = await pool.query(
      `SELECT t.id, t.posted_on, t.amount_cents, t.description_raw, a.slug AS conta, c.name AS contraparte
         FROM fin_transaction t
         JOIN fin_account a ON a.id = t.account_id
         LEFT JOIN fin_counterparty c ON c.id = t.counterparty_id
        WHERE NOT t.is_split_parent`
    );
    const ledger = rows.map((r) => ({
      id: Number(r.id),
      posted_on: r.posted_on.toISOString().slice(0, 10),
      amount_cents: Number(r.amount_cents),
      description: r.description_raw,
      conta: r.conta,
      tokens: tokens(`${r.description_raw || ''} ${r.contraparte || ''}`)
    }));

    // Uma tarefa pode virar duas linhas; o casamento é por TAREFA.
    const porTarefa = new Map();
    for (const l of linhas) if (!porTarefa.has(l.source_id)) porTarefa.set(l.source_id, l);
    const tarefas = [...porTarefa.values()];

    const real = casar(tarefas, ledger, 0);
    const placeboMais = casar(tarefas, ledger, 30);
    const placeboMenos = casar(tarefas, ledger, -30);
    for (const l of linhas) l.match = real.get(l.source_id) || { tier: '-' };

    const contar = (mapa, faixa) => [...mapa.values()].filter((m) => m.tier === faixa).length;
    const valorFaixa = (faixa) => tarefas.filter((t) => (real.get(t.source_id) || {}).tier === faixa)
      .reduce((s, t) => s + t.amount_cents, 0);

    log('\n=== CASAMENTO COM O LEDGER (por tarefa do ClickUp) ===');
    log('faixa                                          n           R$    placebo ±30d   FP estimado');
    for (const [faixa, desc] of [['A', 'A  nome + valor + ≤2 dias + 1:1'], ['C', 'C  só valor + data ≤7d + 1:1'],
      ['X', 'X  ambíguo, disputado ou gêmeo'], ['N', 'N  sem candidato'], ['-', '-  sem data de vencimento']]) {
      const n = contar(real, faixa);
      const pl = (contar(placeboMais, faixa) + contar(placeboMenos, faixa)) / 2;
      const fp = ['A', 'C'].includes(faixa) && n ? `${((pl / n) * 100).toFixed(0)}%` : '';
      log(desc.padEnd(40), String(n).padStart(5), brl(valorFaixa(faixa)).padStart(15),
        (['A', 'C'].includes(faixa) ? pl.toFixed(0) : '').padStart(12), fp.padStart(13));
    }
    log(`total de tarefas com valor e projeto: ${tarefas.length}`);
    log(`casáveis com evidência (faixa A): ${contar(real, 'A')} = ${((contar(real, 'A') / tarefas.length) * 100).toFixed(0)}% das tarefas`);

    const agregado = agregarPorObra(centros, linhas);
    imprimirMargem(agregado);

    if (semProjeto.length) {
      log(`\nFora de qualquer obra (sem "Projetos" no ClickUp): ${semProjeto.length} tarefas, ` +
        `${brl(semProjeto.reduce((s, x) => s + x.valor, 0))}. Não entram na dimensão — não há a que pendurá-las.`);
    }

    if (JSON_OUT) {
      console.log(JSON.stringify({
        syncedAt,
        centros: centros.length,
        apontamentos: linhas.length,
        faixas: Object.fromEntries(['A', 'C', 'X', 'N', '-'].map((f) => [f, contar(real, f)])),
        obras: agregado.map((a) => ({
          slug: a.slug, nome: a.name, kind: a.kind, receita: a.receita,
          custo: a.custo + a.indefinido, margem: a.margem, contrato: a.contract_cents
        }))
      }, null, 2));
    }

    if (!APLICAR) {
      log('\n--- DRY-RUN: nada foi gravado. Use --aplicar para gravar a dimensão. ---');
      log(`Gravaria ${centros.length} centros de custo e ${linhas.length} apontamentos.`);
      if (CARIMBAR) {
        const alvos = linhas.filter((l) => l.match?.tier === 'A' && l.projeto_unico);
        log(`Carimbaria cost_center_id em ${alvos.length} lançamentos do ledger (faixa A com projeto único).`);
      }
      return;
    }

    const { carimbados } = await gravar(pool, centros, linhas);
    log(`\nGravados ${centros.length} centros de custo e ${linhas.length} apontamentos.`);
    if (CARIMBAR) {
      log(`Carimbados ${carimbados} lançamentos com cost_center_id.`);
      log('Para desfazer:  UPDATE fin_transaction SET cost_center_id = NULL WHERE id IN ' +
        "(SELECT transaction_id FROM fin_obra_apontamento WHERE match_tier = 'A' AND transaction_id IS NOT NULL);");
    } else {
      log('cost_center_id do ledger NÃO foi tocado (use --carimbar-ledger se quiser, ciente de que cobre ~metade).');
    }
  } finally {
    await pool.end();
  }
}

principal().catch((erro) => {
  console.error('[import-clickup-projetos]', erro.message);
  process.exit(1);
});

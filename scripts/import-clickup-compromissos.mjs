// Traz para o ledger os compromissos a pagar que só existem no ClickUp.
//
// O PROBLEMA. `fin_document` tem 3.350 linhas e nenhuma com `direction = 'pagar'`.
// A camada L3 da previsão (lib/financeiro/forecast.ts) soma exatamente esse
// conjunto vazio, então o saldo projetado de setembro a dezembro é "entradas
// menos nada". Não é uma previsão otimista — é um teto. A lista "Fluxo de caixa"
// do espaço Obras do ClickUp tem 757 tarefas com valor, e 16 delas vencem no
// futuro: a folha do time de obras até dezembro.
//
// A REGRA QUE GOVERNA O ARQUIVO INTEIRO: SÓ O FUTURO ENTRA.
//
// As 741 tarefas com vencimento passado somam R$ 936 mil e são O MESMO DINHEIRO
// que o extrato bancário já trouxe (ou vai trazer) para fin_transaction. O
// ClickUp é onde a operação anota o pagamento; o banco é onde ele acontece.
// Importar as duas pontas como lançamento contaria cada PIX duas vezes — o erro
// mais caro possível neste módulo, porque não quebra nada: a DRE simplesmente
// dobra o custo de obras e ninguém tem como saber por quê. O corte em
// `due_date > hoje` não é conveniência, é a linha que separa "o banco ainda não
// sabe disso" de "o banco já sabe".
//
// O corte é ESTRITO: tarefa vencendo HOJE também fica de fora. Ou o dinheiro já
// saiu (e o extrato de hoje traz), ou sai daqui a algumas horas — nos dois casos
// o extrato chega antes de qualquer previsão precisar da linha.
//
// SEGUNDA REGRA: COMPROMISSO COM QUEM SAIU NÃO É COMPROMISSO. O ClickUp programa
// setembro a dezembro para "Marcelo Felipe Dias Lacerda", que é a pessoa 99
// ("Felipe") em fin_person, `status = 'inativo'`, `end_date = 2026-08-01`. São
// R$ 10.000 de saída que a empresa provavelmente não deve. O script DETECTA e
// RELATA; não decide. Por padrão o contrato é criado como 'suspenso' e as
// parcelas NÃO viram documento — quem manda a saída para a previsão é um humano,
// com `--incluir-inativos`.
//
// TERCEIRA REGRA: falso negativo é barato, falso positivo é eterno (a mesma de
// scripts/import-pessoas.mjs). Ligação pessoa/contraparte abaixo do limiar vira
// pendência na fila de revisão, nunca um ponteiro escrito no escuro.
//
// ---------------------------------------------------------------------------
// Como os campos do ClickUp são lidos
// ---------------------------------------------------------------------------
//   Dropdown  (`type = 'drop_down'`)      — `value` é o orderindex, não o rótulo.
//                                           Resolve-se em `type_config.options`
//                                           por orderindex OU por id.
//   Relação   (`type = 'list_relationship'`) — `value` é ARRAY de objetos; ler
//                                           direto imprime "[object Object]".
//   `due_date`  epoch em ms, gravado às 07:00 UTC (= 04:00 em São Paulo, a
//               convenção "dia sem hora" do ClickUp). A data é convertida no
//               fuso da empresa, não em UTC: as duas coincidem nestes 16 casos,
//               mas 85 tarefas da base têm outro horário e uma delas viraria o
//               dia anterior.
//   `date_created` NÃO é data de pagamento: 227 tarefas foram criadas em março e
//               296 em abril — padrão de digitação em lote, não de caixa.
//   "Data do Pagamento" existe em 35 tarefas e concorda com `due_date` em 8 de
//               32 casos comparáveis. Fonte de data aqui é `due_date`.
//
// ---------------------------------------------------------------------------
// Onde o dado é gravado, e por que em dois lugares
// ---------------------------------------------------------------------------
//   fin_contract  — o COMPROMISSO (um por pessoa): mensal, direction 'pagar',
//                   kind 'despesa_recorrente', ligado a fin_person e à
//                   contraparte. É o que responde "com quem a empresa está
//                   comprometida" depois que as parcelas de dezembro passarem.
//   fin_document  — as PARCELAS datadas (uma por tarefa), status 'previsto',
//                   `contract_id` apontando para o compromisso. É o que a
//                   previsão lê: contrato sozinho não move número nenhum, porque
//                   as cinco consultas que leem fin_contract filtram
//                   `direction = 'receber'` (ver o aviso em 0030).
//
// SINAL DO VALOR: `fin_document.amount_cents` tem `CHECK (amount_cents > 0)` —
// em 0002 o sentido do dinheiro mora em `direction`, não no sinal. Saída
// negativa é a convenção de fin_transaction (extrato), e só dela. Estas linhas
// são positivas com `direction = 'pagar'`.
//
// IDEMPOTÊNCIA: a chave é o id da tarefa do ClickUp, em
// `fin_document (source = 'clickup', source_id = <task id>)`, protegido pelo
// índice único parcial de 0002. O contrato usa a dupla equivalente criada em
// 0030. Rodar duas vezes atualiza valor e data; não duplica. Documento já
// liquidado ou editado por humano é PRESERVADO — o upsert só toca em quem ainda
// está 'previsto' e sem liquidação, e o gatilho fin_preserve_human_locks cuida
// do resto.
//
// Uso:
//   node scripts/import-clickup-compromissos.mjs                    dry-run (padrão)
//   node scripts/import-clickup-compromissos.mjs --apply            grava
//   node scripts/import-clickup-compromissos.mjs --incluir-inativos materializa
//                                                                   a folha de
//                                                                   quem já saiu
//   node scripts/import-clickup-compromissos.mjs --hoje=2026-08-10  fixa o corte
//   node scripts/import-clickup-compromissos.mjs --limiar=0.85      exige mais
//                                                                   para ligar
//   node scripts/import-clickup-compromissos.mjs --arquivo=x.json
//   node scripts/import-clickup-compromissos.mjs --relatorio=x.md
//   node scripts/import-clickup-compromissos.mjs --com-migration   ensaia 0030
//                                                                  dentro do
//                                                                  ROLLBACK
//   node scripts/import-clickup-compromissos.mjs --repetir=3       prova que
//                                                                  reimportar
//                                                                  não duplica
//
// O dry-run NÃO é simulação: abre transação, executa as MESMAS escritas e dá
// ROLLBACK. Os números do relatório saem do banco, com todo CHECK e gatilho
// exercitado — a diferença entre as duas execuções é uma palavra no fim.
//
// `--com-migration` existe para o ensaio ser completo ANTES de a migration ser
// aplicada: o DDL de 0030 é executado dentro da mesma transação e desfeito pelo
// ROLLBACK junto com o resto. É a única forma de o dry-run responder "isto
// funciona" sem alterar o schema — e por isso é recusado com `--apply`, onde
// aplicar migration é trabalho do runner (`npm run db:migrate`), não deste
// script.
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { normalizeName, normalizeDescription, toCents } from './lib/fin-normalize.mjs';
import { registerFinanceTypeParsers } from './lib/fin-types.mjs';

loadEnv();
registerFinanceTypeParsers();

const argv = process.argv.slice(2);
const flag = (nome, padrao = null) => {
  const hit = argv.find((a) => a.startsWith(`--${nome}=`));
  return hit ? hit.slice(nome.length + 3) : padrao;
};

const APLICAR = argv.includes('--apply');
const COM_MIGRATION = argv.includes('--com-migration');
const INCLUIR_INATIVOS = argv.includes('--incluir-inativos');
if (COM_MIGRATION && APLICAR) {
  console.error('--com-migration é só para dry-run: com --apply, quem aplica migration é `npm run db:migrate`.');
  process.exit(1);
}
const MIGRATION = path.resolve('db/migrations/0030_fin_contas_a_pagar.sql');

/**
 * Quantas vezes repetir a escrita dentro da MESMA transação (só dry-run).
 *
 * É a prova de idempotência, não um enfeite: a segunda passada tem de fechar com
 * "0 inseridos" e a contagem de linhas com `source = 'clickup'` tem de ficar
 * igual. Sem isso, "é idempotente" seria afirmação — e a forma de descobrir que
 * era falsa seria a folha de setembro aparecer em dobro na previsão.
 */
const REPETIR = Math.max(1, Number(flag('repetir', '1')));
const ARQUIVO = path.resolve(flag('arquivo', 'data/raw/clickup-tasks.json'));
const RELATORIO = flag('relatorio', null);
const LIMIAR = Number(flag('limiar', '0.80'));
const HOJE_FLAG = flag('hoje', null);

const ENTITY_SLUG = 'xpe';
const FONTE = 'clickup';
const ATOR = 'import-clickup';
const LISTA = 'Fluxo de caixa';
const TZ = 'America/Sao_Paulo';

/**
 * Categoria do ClickUp → código do plano de contas (0005).
 *
 * Só o que aparece no conjunto FUTURO precisa estar aqui; categoria não mapeada
 * não impede a importação — o documento nasce sem categoria e vai para a fila de
 * revisão, exatamente como o pagável criado à mão em contas.ts. Um mapa que
 * chuta uma categoria plausível seria pior: erra a DRE em silêncio.
 */
const CATEGORIA_POR_ROTULO = new Map([
  ['salarios', '6.01'],
  ['comissoes', '4.01'],
  ['materiais para servico', '4.02'],
  ['terceirizacao de servicos', '4.03'],
  ['transporte e deslocamento', '4.04'],
  ['impostos e taxas', '7.01']
]);

const brl = (cents) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// ---------------------------------------------------------------------------
// Leitura do ClickUp
// ---------------------------------------------------------------------------

/** Data do epoch em ms no fuso da EMPRESA, como 'YYYY-MM-DD'. */
function dataLocal(ms) {
  if (ms === null || ms === undefined || ms === '') return null;
  const n = Number(ms);
  if (!Number.isFinite(n)) return null;
  // 'en-CA' devolve exatamente YYYY-MM-DD; o fuso é o da empresa, não o do
  // servidor — em produção o Node roda em UTC e uma tarefa das 22h viraria o dia
  // seguinte sozinha.
  return new Date(n).toLocaleDateString('en-CA', { timeZone: TZ });
}

const campo = (tarefa, nome) => (tarefa.custom_fields || []).find((f) => f.name === nome);

/** Dropdown: `value` é orderindex; o rótulo mora em type_config.options. */
function rotuloDropdown(f) {
  if (!f || f.value === null || f.value === undefined || f.value === '') return null;
  const opcoes = f.type_config?.options || [];
  const porIndice = opcoes.find((o) => String(o.orderindex) === String(f.value));
  const porId = opcoes.find((o) => String(o.id) === String(f.value));
  return (porIndice || porId)?.name ?? null;
}

/** Relacionamento: `value` é array de objetos com `.name`. */
function rotulosRelacao(f) {
  if (!f || !Array.isArray(f.value)) return [];
  return f.value.map((v) => v?.name).filter(Boolean);
}

/**
 * De quem é o pagamento.
 *
 * O campo "Beneficiado" seria a resposta certa, mas está preenchido em 24 das
 * 757 tarefas e em nenhuma das 16 futuras. Sobra o título, que na lista inteira
 * segue o formato "<forma de pagamento> <nome>". Tirar o prefixo é o que
 * transforma "Transferência PIX Denilson Ferreira da silva" num nome que casa
 * com o cadastro.
 */
const PREFIXO_FORMA = /^(transferencia|transferência|pagamento|pgto|envio)?\s*(pix|ted|doc|boleto)\s+/i;

/** Recebe a tarefa JÁ NORMALIZADA por lerTarefa(), não o objeto cru do ClickUp. */
function nomeDoFavorecido(t) {
  if (t.beneficiado) return { nome: t.beneficiado.trim(), origem: 'campo Beneficiado' };
  const semPrefixo = t.titulo.replace(PREFIXO_FORMA, '').trim();
  return { nome: semPrefixo || t.titulo, origem: 'título da tarefa' };
}

function lerTarefa(tarefa) {
  const valorCampo = campo(tarefa, 'Valor pago');
  return {
    id: tarefa.id,
    titulo: String(tarefa.name || '').trim(),
    url: tarefa.url || null,
    lista: tarefa.list_name || tarefa.list?.name || null,
    espaco: tarefa.space_name || null,
    status: tarefa.status?.status || null,
    statusTipo: tarefa.status?.type || null,
    // "Valor pago" é o nome do campo na fonte; numa tarefa futura ele é o valor
    // PROGRAMADO. O rótulo mente, o dado não.
    valorBruto: valorCampo?.value ?? null,
    valorCents: valorCampo?.value ? toCents(valorCampo.value) : 0,
    vencimento: dataLocal(tarefa.due_date),
    beneficiado: rotuloDropdown(campo(tarefa, 'Beneficiado')),
    movimentacao: rotuloDropdown(campo(tarefa, 'Movimentação')),
    categoria: rotuloDropdown(campo(tarefa, 'Categoria')),
    subcategoria: rotuloDropdown(campo(tarefa, 'Subcategoria')),
    formaPagamento: rotuloDropdown(campo(tarefa, 'Forma de Pagamento')),
    contaPagadora: rotuloDropdown(campo(tarefa, 'Conta Pagadora')),
    projetos: rotulosRelacao(campo(tarefa, 'Projetos'))
  };
}

/**
 * O funil de seleção, com o motivo de cada descarte.
 *
 * Descartar em silêncio é como um importador perde dinheiro sem ninguém saber:
 * o relatório precisa fechar 1.694 = importadas + descartadas por motivo.
 */
function selecionar(tarefas, hoje) {
  const aceitas = [];
  const descartes = new Map();
  const alertas = [];
  const descarta = (motivo) => descartes.set(motivo, (descartes.get(motivo) || 0) + 1);

  for (const bruta of tarefas) {
    const t = lerTarefa(bruta);
    if (t.lista !== LISTA) { descarta(`fora da lista "${LISTA}"`); continue; }
    if (!t.valorBruto) { descarta('sem "Valor pago" preenchido'); continue; }
    if (!t.vencimento) { descarta('sem due_date'); continue; }
    if (t.vencimento <= hoje) { descarta(`vencimento até hoje (já é do extrato)`); continue; }

    // Daqui para baixo a tarefa É futura — todo descarte vira alerta, porque é
    // dinheiro futuro que a previsão não vai enxergar e alguém precisa saber.
    if (t.movimentacao !== 'Saida') {
      descarta(`futura mas movimentação "${t.movimentacao ?? 'vazia'}"`);
      alertas.push(
        `${t.id} ${t.vencimento} ${brl(t.valorCents)} "${t.titulo}" — movimentação "${t.movimentacao ?? 'vazia'}", não entra como conta a pagar. ` +
          (t.movimentacao === 'Entrada'
            ? 'Receita futura vem do Asaas, não do ClickUp: importar daqui duplicaria o recebível.'
            : 'Sem o campo preenchido não dá para afirmar o sentido do dinheiro.')
      );
      continue;
    }
    if (t.valorCents <= 0) {
      descarta('futura com valor zero ou negativo');
      alertas.push(`${t.id} "${t.titulo}" — valor ${t.valorBruto} não é uma saída positiva.`);
      continue;
    }
    if (t.statusTipo === 'done' || t.statusTipo === 'closed' || t.status === 'pago') {
      descarta('futura mas já marcada como paga na fonte');
      alertas.push(
        `${t.id} ${t.vencimento} ${brl(t.valorCents)} "${t.titulo}" — vence no futuro e já está "${t.status}". ` +
          'Contradição na fonte: ou a data está errada, ou o pagamento foi antecipado e o extrato já o traz.'
      );
      continue;
    }
    aceitas.push(t);
  }

  return { aceitas, descartes, alertas };
}

// ---------------------------------------------------------------------------
// Identidade: nome do ClickUp × cadastro do ledger
// ---------------------------------------------------------------------------
/**
 * O sentido do casamento aqui é o INVERSO do de import-pessoas.mjs: lá um
 * apelido curto ("Felipe") procurava um nome de cartório longo; aqui o nome
 * longo vem do ClickUp e procura um cadastro que às vezes é o apelido.
 *
 * Por isso a contraparte é procurada PRIMEIRO. Ela guarda o nome completo como o
 * banco o escreve, e a partir dela a pessoa vem por um caminho que NÃO é
 * adivinhação: `fin_person_counterparty` com `status = 'confirmado'`, uma
 * ligação que um humano já validou em 0026. É o que faz "Marcelo Felipe Dias
 * Lacerda" chegar em "Felipe" com confiança 1,0 — enquanto casar 'felipe' contra
 * o nome completo daria um token do MEIO, que é a forma exata do falso positivo
 * conhecido desta base ("Gabriel" × "Paulo Gabriel Chaves de Araujo").
 */
function scoreNome(alvo, candidato) {
  const a = normalizeName(alvo);
  const b = normalizeName(candidato);
  if (!a || !b) return { score: 0, motivo: 'sem nome' };
  if (a === b) return { score: 1, motivo: 'nome idêntico após normalização' };

  const ta = a.split(' ');
  const tb = b.split(' ');

  // Cadastro de um token só ("Tallany", "Felipe") contra nome completo.
  if (tb.length === 1) {
    if (tb[0] === ta[0]) return { score: 0.9, motivo: `primeiro nome "${tb[0]}" idêntico` };
    if (ta.length > 1 && tb[0] === ta[ta.length - 1]) {
      return { score: 0.6, motivo: 'último sobrenome idêntico' };
    }
    if (ta.includes(tb[0])) {
      return { score: 0.5, motivo: `"${tb[0]}" é token do meio — a forma do falso positivo conhecido` };
    }
    if (tb[0].length >= 5 && distancia(tb[0], ta[0]) === 1) {
      return { score: 0.8, motivo: `"${ta[0]}" difere de "${tb[0]}" em uma letra` };
    }
    return { score: 0, motivo: 'nenhum token bate' };
  }

  // Dois nomes completos: proporção de tokens em comum, com tolerância de uma
  // letra no primeiro nome — "Tallany"/"Tallanny" e "Tawany"/"Tawanny" são a
  // mesma pessoa escrita por duas mãos, e duas letras já seriam outra.
  const comuns = tb.filter((t) => ta.includes(t)).length;
  const primeiroQuaseIgual =
    ta[0] !== tb[0] && ta[0].length >= 5 && distancia(ta[0], tb[0]) === 1;
  const efetivos = comuns + (primeiroQuaseIgual ? 1 : 0);
  const cobertura = efetivos / Math.max(ta.length, tb.length);
  if (efetivos >= 2 && cobertura >= 0.6) {
    return {
      score: Number((0.6 + 0.4 * cobertura).toFixed(3)),
      motivo: `${efetivos} de ${Math.max(ta.length, tb.length)} tokens em comum${primeiroQuaseIgual ? ' (primeiro nome com uma letra de diferença)' : ''}`
    };
  }
  if (efetivos >= 2) return { score: 0.55, motivo: `${efetivos} tokens em comum, cobertura baixa` };
  return { score: 0, motivo: 'nenhum token bate' };
}

/** Distância de edição limitada — só interessa saber se é 0, 1 ou "muita". */
function distancia(a, b, max = 1) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let anterior = prev[0];
    prev[0] = i;
    let melhorLinha = prev[0];
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, anterior + (a[i - 1] === b[j - 1] ? 0 : 1));
      anterior = tmp;
      melhorLinha = Math.min(melhorLinha, prev[j]);
    }
    if (melhorLinha > max) return max + 1;
  }
  return prev[b.length];
}

function melhorCandidato(nome, lista, campoNome = 'name') {
  let melhor = null;
  let segundo = null;
  for (const item of lista) {
    const s = scoreNome(nome, item[campoNome]);
    if (s.score <= 0) continue;
    const c = { item, ...s };
    if (!melhor || c.score > melhor.score) { segundo = melhor; melhor = c; }
    else if (!segundo || c.score > segundo.score) segundo = c;
  }
  // Empate técnico é ambiguidade, e ambiguidade não vira ponteiro: dois nomes
  // igualmente prováveis significam que o script não sabe qual é.
  if (melhor && segundo && melhor.score - segundo.score < 0.1) {
    return {
      ...melhor,
      score: Number((melhor.score * 0.5).toFixed(3)),
      motivo: `${melhor.motivo}; empate com "${segundo.item[campoNome]}" derruba a confiança`
    };
  }
  return melhor;
}

// ---------------------------------------------------------------------------
// Estado do ledger
// ---------------------------------------------------------------------------
async function carregarLedger(client) {
  const { rows: entidades } = await client.query(
    `SELECT id FROM fin_entity WHERE slug = $1`, [ENTITY_SLUG]
  );
  if (!entidades[0]) throw new Error(`entidade ${ENTITY_SLUG} não encontrada`);
  const entityId = entidades[0].id;

  // Sequencial, não Promise.all: as consultas compartilham UM client dentro da
  // transação do dry-run, e disparar em paralelo nele é o que o driver deprecou.
  const { rows: pessoas } = await client.query(
    `SELECT id, name, normalized_name, status, start_date::text AS start_date, end_date::text AS end_date,
            employment_type, area, default_nucleo, default_category_id, counterparty_id
       FROM fin_person WHERE entity_id = $1`, [entityId]
  );
  const { rows: contrapartes } = await client.query(
    `SELECT id, name, normalized_name, kind FROM fin_counterparty WHERE entity_id = $1 AND is_active`, [entityId]
  );
  const { rows: vinculos } = await client.query(
    `SELECT person_id, counterparty_id, is_primary, confidence, status
       FROM fin_person_counterparty WHERE entity_id = $1 AND status = 'confirmado'`, [entityId]
  );
  const { rows: categorias } = await client.query(
    `SELECT id, code, name FROM fin_category WHERE entity_id = $1`, [entityId]
  );
  const { rows: nucleos } = await client.query(`SELECT slug FROM fin_nucleo WHERE is_active`);
  // O fixo pactuado da planilha, para conferir o valor do ClickUp contra uma
  // segunda fonte. Duas fontes que concordam viram 'contratado'; discordam ou
  // faltam, 'previsto'. É o que `fin_contract.confidence` existe para dizer.
  const { rows: fixos } = await client.query(
    `SELECT person_id, reference_month::text AS reference_month, amount_cents
       FROM fin_person_compensation
      WHERE entity_id = $1 AND kind = 'contratado' AND component = 'fixo'`, [entityId]
  );

  const pessoaPorContraparte = new Map();
  for (const v of vinculos) {
    const atual = pessoaPorContraparte.get(v.counterparty_id);
    if (!atual || (v.is_primary && !atual.is_primary)) pessoaPorContraparte.set(v.counterparty_id, v);
  }

  const fixoPorPessoa = new Map();
  for (const f of fixos) {
    const atual = fixoPorPessoa.get(f.person_id);
    if (!atual || f.reference_month > atual.reference_month) fixoPorPessoa.set(f.person_id, f);
  }

  return {
    entityId,
    pessoas,
    contrapartes,
    pessoaPorId: new Map(pessoas.map((p) => [p.id, p])),
    pessoaPorContraparte,
    categoriaPorCodigo: new Map(categorias.map((c) => [c.code, c])),
    nucleos: new Set(nucleos.map((n) => n.slug)),
    fixoPorPessoa
  };
}

/** A migration 0030 já está aplicada? Sem ela, nenhuma escrita é possível. */
async function checarMigration(client) {
  const { rows } = await client.query(
    `SELECT
       (SELECT count(*)::int FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'fin_contract'
           AND column_name IN ('person_id', 'source', 'source_id')) AS colunas,
       (SELECT pg_get_constraintdef(oid) FROM pg_constraint
         WHERE conname = 'fin_document_source_check') AS check_source`
  );
  const faltando = [];
  if (rows[0].colunas < 3) faltando.push('fin_contract.person_id / source / source_id');
  if (!String(rows[0].check_source || '').includes("'clickup'")) {
    faltando.push("valor 'clickup' em fin_document_source_check");
  }
  return faltando;
}

// ---------------------------------------------------------------------------
// Plano: tarefas → compromissos
// ---------------------------------------------------------------------------
function planejar(tarefas, ledger, hoje) {
  const porFavorecido = new Map();

  for (const t of tarefas) {
    const { nome, origem } = nomeDoFavorecido(t);
    const chave = normalizeName(nome) || t.id;
    if (!porFavorecido.has(chave)) porFavorecido.set(chave, { chave, nome, origemNome: origem, parcelas: [] });
    porFavorecido.get(chave).parcelas.push(t);
  }

  const compromissos = [];
  for (const grupo of porFavorecido.values()) {
    grupo.parcelas.sort((a, b) => a.vencimento.localeCompare(b.vencimento));

    // ── Identidade ──────────────────────────────────────────────────────────
    const cp = melhorCandidato(grupo.nome, ledger.contrapartes);
    let pessoa = null;
    let pessoaScore = 0;
    let pessoaMotivo = 'nenhuma pessoa casou';
    let metodo = 'nenhum';

    if (cp && cp.score >= LIMIAR) {
      const vinculo = ledger.pessoaPorContraparte.get(cp.item.id);
      if (vinculo) {
        pessoa = ledger.pessoaPorId.get(vinculo.person_id) ?? null;
        pessoaScore = cp.score;
        metodo = 'contraparte_confirmada';
        pessoaMotivo = `contraparte "${cp.item.name}" (${cp.motivo}) tem vínculo confirmado com a pessoa`;
      }
    }
    if (!pessoa) {
      const direta = melhorCandidato(grupo.nome, ledger.pessoas);
      if (direta) {
        pessoa = direta.score >= LIMIAR ? direta.item : null;
        pessoaScore = direta.score;
        metodo = pessoa ? 'nome_direto' : 'nenhum';
        pessoaMotivo = direta.motivo;
      }
    }

    const contraparteId = cp && cp.score >= LIMIAR ? cp.item.id : null;
    const contraparteNome = cp?.item?.name ?? null;

    // ── Classificação ───────────────────────────────────────────────────────
    // A categoria da PESSOA vence a do ClickUp quando existe, e não é
    // preferência: `fin_person.default_category_id` foi semeada em 0029 pelo
    // vínculo, onde a lei decide (sócio → 6.02 pró-labore). O dropdown do
    // ClickUp é um rótulo escolhido por quem digitou a tarefa e não conhece o
    // plano de contas — mandar pró-labore de sócio para 6.01 troca a linha da
    // DRE e faz a plataforma esperar encargo que não existe.
    const rotulo = normalizeDescription(grupo.parcelas[0].categoria || '');
    const codigoClickup = CATEGORIA_POR_ROTULO.get(rotulo) ?? null;
    const categoriaClickup = codigoClickup ? ledger.categoriaPorCodigo.get(codigoClickup) ?? null : null;
    const categoriaPessoa = pessoa?.default_category_id
      ? [...ledger.categoriaPorCodigo.values()].find((c) => c.id === pessoa.default_category_id) ?? null
      : null;
    const categoria = categoriaPessoa ?? categoriaClickup;
    const categoriaOrigem = categoriaPessoa
      ? `cadastro da pessoa (0029)${categoriaClickup && categoriaClickup.id !== categoriaPessoa.id ? `, divergindo do ClickUp que diz "${grupo.parcelas[0].categoria}" (${codigoClickup})` : ''}`
      : categoriaClickup
        ? `dropdown do ClickUp "${grupo.parcelas[0].categoria}"`
        : `nenhuma — "${grupo.parcelas[0].categoria ?? 'vazio'}" não está no mapa`;

    const nucleo =
      (pessoa?.default_nucleo && ledger.nucleos.has(pessoa.default_nucleo) && pessoa.default_nucleo) ||
      (pessoa?.area && ledger.nucleos.has(pessoa.area) && pessoa.area) ||
      null;

    // ── Fantasma: compromisso com quem já saiu ──────────────────────────────
    const parcelas = grupo.parcelas.map((t) => {
      const depoisDaSaida = Boolean(pessoa?.end_date) && t.vencimento > pessoa.end_date;
      const fantasma = Boolean(pessoa) && (pessoa.status === 'inativo' || depoisDaSaida);
      return {
        ...t,
        fantasma,
        motivoFantasma: fantasma
          ? `${pessoa.name} está ${pessoa.status} em fin_person${pessoa.end_date ? ` com saída em ${pessoa.end_date}` : ''}`
          : null
      };
    });
    const fantasmas = parcelas.filter((p) => p.fantasma);
    const materializar = parcelas.filter((p) => !p.fantasma || INCLUIR_INATIVOS);

    // ── Valor e conferência contra a segunda fonte ──────────────────────────
    const valores = [...new Set(parcelas.map((p) => p.valorCents))];
    const valorMensal = valores.length === 1 ? valores[0] : Math.max(...valores);
    const fixo = pessoa ? ledger.fixoPorPessoa.get(pessoa.id) ?? null : null;
    const bateComPlanilha = Boolean(fixo) && fixo.amount_cents === valorMensal;
    const confianca = bateComPlanilha ? 'contratado' : 'previsto';

    compromissos.push({
      chave: grupo.chave,
      nomeFonte: grupo.nome,
      origemNome: grupo.origemNome,
      pessoa,
      pessoaScore,
      pessoaMotivo,
      metodo,
      contraparteId,
      contraparteNome,
      contraparteScore: cp?.score ?? 0,
      contraparteMotivo: cp?.motivo ?? 'nenhuma contraparte casou',
      categoria,
      categoriaOrigem,
      nucleo,
      valorMensal,
      valoresDistintos: valores.length > 1 ? valores : null,
      fixoPlanilhaCents: fixo?.amount_cents ?? null,
      fixoPlanilhaMes: fixo?.reference_month ?? null,
      confianca,
      parcelas,
      fantasmas,
      materializar,
      // Um compromisso cujas parcelas são todas fantasmas não gera caixa: o
      // contrato existe (o ClickUp o programa, isso é fato), mas nasce suspenso.
      statusContrato: materializar.length ? 'ativo' : 'suspenso',
      // Dia do mês do compromisso: o menor entre as parcelas. 02/11 é 01/11 num
      // domingo — o `due_day_rule = 'posterga'` do schema descreve exatamente
      // essa mesma regra, que o ClickUp já aplicou na mão.
      diaDoMes: Math.min(...parcelas.map((p) => Number(p.vencimento.slice(8, 10)))),
      inicio: parcelas[0].vencimento,
      fim: parcelas[parcelas.length - 1].vencimento,
      hoje
    });
  }

  compromissos.sort((a, b) => b.valorMensal * b.parcelas.length - a.valorMensal * a.parcelas.length);
  return compromissos;
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------
async function gravar(client, ledger, compromissos, batchId) {
  const resultado = { contratos: [], documentos: [], pendencias: [] };

  for (const c of compromissos) {
    const nomeContrato = `Folha mensal — ${c.pessoa?.name ?? c.nomeFonte}`;
    const notasContrato = [
      `Origem: ClickUp, lista "${LISTA}" do espaço Obras (${c.parcelas.length} tarefa(s): ${c.parcelas.map((p) => p.id).join(', ')}).`,
      `Nome na fonte: "${c.nomeFonte}" (${c.origemNome}).`,
      c.fixoPlanilhaCents !== null
        ? `Fixo pactuado em ${c.fixoPlanilhaMes}: ${brl(c.fixoPlanilhaCents)} — ${c.confianca === 'contratado' ? 'confere' : 'DIVERGE'} do ClickUp (${brl(c.valorMensal)}).`
        : 'Sem fixo pactuado em fin_person_compensation para conferir; valor vem só do ClickUp.',
      c.fantasmas.length
        ? `${c.fantasmas.length} parcela(s) programada(s) para depois da saída da pessoa: ${c.fantasmas.map((p) => p.vencimento).join(', ')}.`
        : null
    ]
      .filter(Boolean)
      .join(' ');

    const { rows: contratoRows } = await client.query(
      `INSERT INTO fin_contract (
         entity_id, person_id, counterparty_id, name, direction, kind, category_id, nucleo,
         amount_cents, recurrence, day_of_month, due_day_rule, start_date, end_date,
         confidence, status, notes, source, source_id
       ) VALUES ($1, $2, $3, $4, 'pagar', 'despesa_recorrente', $5, $6,
                 $7, 'mensal', $8, 'posterga', $9::date, $10::date,
                 $11, $12, $13, $14, $15)
       -- A chave é (entity_id, source, source_id), a mesma forma que 0009 deu a
       -- fin_document. Reimportar atualiza; não duplica.
       ON CONFLICT (entity_id, source, source_id) WHERE source_id IS NOT NULL
       DO UPDATE SET
         amount_cents  = EXCLUDED.amount_cents,
         day_of_month  = EXCLUDED.day_of_month,
         start_date    = LEAST(fin_contract.start_date, EXCLUDED.start_date),
         end_date      = GREATEST(fin_contract.end_date, EXCLUDED.end_date),
         person_id     = COALESCE(fin_contract.person_id, EXCLUDED.person_id),
         counterparty_id = COALESCE(fin_contract.counterparty_id, EXCLUDED.counterparty_id),
         category_id   = COALESCE(fin_contract.category_id, EXCLUDED.category_id),
         nucleo        = COALESCE(fin_contract.nucleo, EXCLUDED.nucleo),
         confidence    = EXCLUDED.confidence,
         -- Contrato que um humano encerrou NÃO ressuscita numa reimportação: o
         -- ClickUp não sabe que ele acabou, e a decisão do humano é mais nova.
         status        = CASE WHEN fin_contract.status = 'encerrado' THEN 'encerrado' ELSE EXCLUDED.status END,
         notes         = EXCLUDED.notes,
         updated_at    = now()
       RETURNING id, (xmax = 0) AS inserido, status`,
      [
        ledger.entityId,
        c.pessoa?.id ?? null,
        c.contraparteId,
        nomeContrato.slice(0, 140),
        c.categoria?.id ?? null,
        c.nucleo,
        c.valorMensal,
        c.diaDoMes,
        c.inicio,
        c.fim,
        c.confianca,
        c.statusContrato,
        notasContrato,
        FONTE,
        `folha:${c.chave.replace(/\s+/g, '-')}`
      ]
    );

    const contrato = contratoRows[0];
    resultado.contratos.push({ ...c, contratoId: contrato.id, inserido: contrato.inserido, statusFinal: contrato.status });

    await client.query(
      `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, after, fields, batch_id, actor)
       VALUES ($1, 'fin_contract', $2, 'import', $3::jsonb,
               ARRAY['amount_cents','person_id','counterparty_id','status','confidence'], $4::uuid, $5)`,
      [
        ledger.entityId,
        contrato.id,
        JSON.stringify({
          direction: 'pagar',
          name: nomeContrato,
          amount_cents: c.valorMensal,
          person_id: c.pessoa?.id ?? null,
          counterparty_id: c.contraparteId,
          status: contrato.status,
          confidence: c.confianca,
          source: FONTE,
          tarefas: c.parcelas.map((p) => p.id)
        }),
        batchId,
        ATOR
      ]
    );

    // ── Parcelas ────────────────────────────────────────────────────────────
    for (const p of c.materializar) {
      const mes = p.vencimento.slice(0, 7);
      const descricao = `Folha ${mes.slice(5)}/${mes.slice(0, 4)} — ${c.pessoa?.name ?? c.nomeFonte}`;
      const notas = [
        `ClickUp ${p.id} · "${p.titulo}" · lista "${LISTA}".`,
        p.projetos.length ? `Projetos: ${p.projetos.join(' | ')}.` : null,
        p.categoria ? `Categoria na fonte: "${p.categoria}".` : null,
        p.fantasma ? `ATENÇÃO: ${p.motivoFantasma}. Materializada por --incluir-inativos.` : null
      ]
        .filter(Boolean)
        .join(' ');

      // review_status: sem categoria OU sem ligação confiável vira pendência. O
      // documento é criado do mesmo jeito — a saída é real e a previsão precisa
      // dela; o que fica em aberto é a classificação, não o dinheiro.
      const pendente = !c.categoria || !c.pessoa || c.pessoaScore < LIMIAR;

      const { rows: docRows } = await client.query(
        `INSERT INTO fin_document (
           entity_id, direction, counterparty_id, contract_id, category_id, nucleo,
           description, description_norm, competence_date, due_date, expected_cash_date,
           cash_date_basis, cash_confidence, flexibility, amount_cents, status,
           source, source_id, planned_at, external_url, notes, created_by, review_status
         ) VALUES ($1, 'pagar', $2, $3, $4, $5,
                   $6, $7,
                   -- Competência = vencimento, a mesma convenção de contas.ts:
                   -- a fonte informa uma data só e inventar a outra é pior.
                   $8::date, $8::date, $8::date,
                   'vencimento', 1.000, 'fixo', $9, 'previsto',
                   $10, $11,
                   -- planned_at é a prova de precedência de 0002: esta linha
                   -- existe ANTES de o dinheiro sair, e é o único componente
                   -- honesto do índice de confiabilidade.
                   now(), $12, $13, $14, $15)
         ON CONFLICT (entity_id, source, source_id) WHERE source_id IS NOT NULL
         DO UPDATE SET
           amount_cents       = EXCLUDED.amount_cents,
           due_date           = EXCLUDED.due_date,
           competence_date    = EXCLUDED.competence_date,
           expected_cash_date = EXCLUDED.expected_cash_date,
           contract_id        = EXCLUDED.contract_id,
           counterparty_id    = COALESCE(fin_document.counterparty_id, EXCLUDED.counterparty_id),
           category_id        = COALESCE(fin_document.category_id, EXCLUDED.category_id),
           nucleo             = COALESCE(fin_document.nucleo, EXCLUDED.nucleo),
           notes              = EXCLUDED.notes,
           updated_at         = now()
         -- Só mexe no que ainda é previsão intocada. Documento liquidado,
         -- parcialmente pago ou cancelado por um humano fica como está: o
         -- ClickUp não sabe o que aconteceu depois que a linha saiu dele.
         WHERE fin_document.status = 'previsto' AND fin_document.settled_cents = 0
         RETURNING id, (xmax = 0) AS inserido`,
        [
          ledger.entityId,
          c.contraparteId,
          contrato.id,
          c.categoria?.id ?? null,
          c.nucleo,
          descricao,
          normalizeDescription(descricao),
          p.vencimento,
          p.valorCents,
          FONTE,
          p.id,
          p.url,
          notas,
          ATOR,
          pendente ? 'pendente' : 'ok'
        ]
      );

      if (!docRows[0]) {
        // O upsert recusou a atualização: a linha existe e não é mais uma
        // previsão intocada. Isso é sucesso, não falha — e precisa aparecer.
        const { rows } = await client.query(
          `SELECT id, status, settled_cents, amount_cents FROM fin_document
            WHERE entity_id = $1 AND source = $2 AND source_id = $3`,
          [ledger.entityId, FONTE, p.id]
        );
        resultado.documentos.push({
          tarefa: p, compromisso: c, id: rows[0]?.id ?? null, estado: 'preservado',
          detalhe: rows[0] ? `status '${rows[0].status}', ${brl(rows[0].settled_cents)} liquidado` : 'não encontrado'
        });
        continue;
      }

      const doc = docRows[0];
      resultado.documentos.push({
        tarefa: p, compromisso: c, id: doc.id, estado: doc.inserido ? 'inserido' : 'atualizado'
      });

      await client.query(
        `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, after, fields, batch_id, actor)
         VALUES ($1, 'fin_document', $2, 'import', $3::jsonb,
                 ARRAY['description','amount_cents','due_date','status','planned_at'], $4::uuid, $5)`,
        [
          ledger.entityId,
          doc.id,
          JSON.stringify({
            direction: 'pagar',
            description: descricao,
            amount_cents: p.valorCents,
            due_date: p.vencimento,
            status: 'previsto',
            source: FONTE,
            source_id: p.id,
            contract_id: contrato.id
          }),
          batchId,
          ATOR
        ]
      );

      if (pendente) {
        const motivo = !c.categoria ? 'sem_categoria' : 'baixa_confianca';
        await client.query(
          `INSERT INTO fin_review_item (entity_id, target_table, target_id, reason, amount_cents, suggested)
           VALUES ($1, 'fin_document', $2, $3, $4, $5::jsonb)
           ON CONFLICT (target_table, target_id) DO NOTHING`,
          [
            ledger.entityId,
            doc.id,
            motivo,
            p.valorCents,
            JSON.stringify([
              {
                campo: motivo === 'sem_categoria' ? 'category_id' : 'counterparty_id',
                sugestao: motivo === 'sem_categoria' ? c.categoriaOrigem : c.contraparteNome,
                motivo: motivo === 'sem_categoria' ? c.categoriaOrigem : `${c.pessoaMotivo} (score ${c.pessoaScore})`
              }
            ])
          ]
        );
        resultado.pendencias.push({ docId: doc.id, motivo, compromisso: c, tarefa: p });
      }
    }
  }

  return resultado;
}

// ---------------------------------------------------------------------------
// Medição: o que isto muda no fôlego de caixa
// ---------------------------------------------------------------------------
/**
 * Recalcula a tabela mensal da previsão com a aritmética de
 * lib/financeiro/forecast.ts (L0 saldo livre, L1 recebíveis com a curva de
 * recuperação, L2 contratos 'receber' mensais, L3 pagáveis). Roda antes e depois
 * da escrita dentro da mesma transação: a diferença entre as duas chamadas é,
 * literalmente, o efeito desta importação.
 *
 * A única simplificação é o grampo do dia no mês corrente (28 em vez do último
 * dia do mês). Ela afeta os dois lados igualmente e some na subtração — o que
 * este bloco precisa acertar é o DELTA, não reimplementar a tela.
 */
async function medirFolego(client, hoje) {
  const { rows: contas } = await client.query(
    `SELECT a.current_balance_cents AS saldo, a.kind FROM fin_account a
       JOIN fin_entity e ON e.id = a.entity_id WHERE e.slug = $1 AND a.is_active`, [ENTITY_SLUG]
  );
  const { rows: reservas } = await client.query(
    `SELECT r.current_cents FROM fin_reserve r JOIN fin_entity e ON e.id = r.entity_id
      WHERE e.slug = $1 AND r.is_active AND r.is_committed`, [ENTITY_SLUG]
  );
  const { rows: docs } = await client.query(
    `SELECT d.direction,
              COALESCE(d.expected_cash_date, d.due_date)::text AS data_prevista,
              (d.amount_cents - d.settled_cents) AS bruto,
              CASE WHEN d.direction = 'pagar' THEN 1.0
                   WHEN d.due_date >= $2::date THEN 1.0
                   WHEN $2::date - d.due_date <= 30 THEN 0.90
                   WHEN $2::date - d.due_date <= 60 THEN 0.70
                   WHEN $2::date - d.due_date <= 90 THEN 0.50
                   ELSE 0.20 END AS fator
         FROM fin_document d JOIN fin_entity e ON e.id = d.entity_id
        WHERE e.slug = $1
          AND ((d.direction = 'receber' AND d.status IN ('emitido', 'parcial', 'confirmado'))
            OR (d.direction = 'pagar' AND d.status IN ('previsto', 'emitido', 'parcial', 'confirmado')))
          AND (d.amount_cents - d.settled_cents) > 0`, [ENTITY_SLUG, hoje]
  );
  // Mesmo filtro de direção da L2 em forecast.ts, de propósito: é ele que
  // impede o contrato 'pagar' recém-criado de ser contado aqui E como documento
  // na L3. Ver o aviso no fim de 0030.
  const { rows: contratos } = await client.query(
    `SELECT c.amount_cents AS valor, c.day_of_month FROM fin_contract c
       JOIN fin_entity e ON e.id = c.entity_id
      WHERE e.slug = $1 AND c.status = 'ativo' AND c.recurrence = 'mensal' AND c.direction = 'receber'`,
    [ENTITY_SLUG]
  );

  const disponivel =
    contas.filter((c) => c.kind !== 'emprestimo').reduce((s, c) => s + c.saldo, 0) -
    reservas.reduce((s, r) => s + r.current_cents, 0);

  const mesAtual = `${hoje.slice(0, 7)}-01`;
  const somaMeses = (mes, n) => {
    const [y, m] = mes.split('-').map(Number);
    const total = y * 12 + (m - 1) + n;
    return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-01`;
  };
  const balde = (iso) => {
    const mes = `${iso.slice(0, 7)}-01`;
    return mes < mesAtual ? mesAtual : mes;
  };

  let abertura = disponivel;
  const meses = [];
  for (let i = 0; i < 6; i += 1) {
    const mes = somaMeses(mesAtual, i);
    const l1 = docs
      .filter((d) => d.direction === 'receber' && balde(d.data_prevista) === mes)
      .reduce((s, d) => s + Math.round(d.bruto * d.fator), 0);
    const l3 = docs
      .filter((d) => d.direction === 'pagar' && balde(d.data_prevista) === mes)
      .reduce((s, d) => s + Math.round(d.bruto * d.fator), 0);
    const l2 = contratos.reduce((s, c) => {
      if (mes === mesAtual && Math.min(c.day_of_month ?? 1, 28) < Number(hoje.slice(8, 10))) return s;
      return s + c.valor;
    }, 0);
    const fechamento = abertura + l1 + l2 - l3;
    meses.push({ mes, abertura, l1, l2, l3, fechamento });
    abertura = fechamento;
  }
  return { disponivel, meses };
}

// ---------------------------------------------------------------------------
// Relatório
// ---------------------------------------------------------------------------
function montarRelatorio({ hoje, total, selecao, compromissos, resultado, antes, depois, faltandoMigration }) {
  const L = [];
  const p = (s = '') => L.push(s);

  p(`# Compromissos a pagar do ClickUp → ledger`);
  p();
  p(`Modo: **${APLICAR ? 'APLICADO' : 'dry-run (nada foi gravado)'}**${INCLUIR_INATIVOS ? ' · `--incluir-inativos` LIGADO' : ''}`);
  p(`Corte: só \`due_date > ${hoje}\` · limiar de ligação ${LIMIAR}`);
  p();

  p(`## Funil`);
  p();
  p(`| etapa | tarefas |`);
  p(`| --- | ---: |`);
  p(`| lidas de ${path.basename(ARQUIVO)} | ${total} |`);
  for (const [motivo, n] of [...selecao.descartes.entries()].sort((a, b) => b[1] - a[1])) {
    p(`| descartadas: ${motivo} | ${n} |`);
  }
  p(`| **aceitas (futuras, saída, com valor)** | **${selecao.aceitas.length}** |`);
  p();

  const somaTudo = compromissos.reduce((s, c) => s + c.parcelas.reduce((a, x) => a + x.valorCents, 0), 0);
  const somaFantasma = compromissos.reduce((s, c) => s + c.fantasmas.reduce((a, x) => a + x.valorCents, 0), 0);

  p(`## Compromissos`);
  p();
  p(`| pessoa (ClickUp) | pessoa no ledger | vínculo | mensal | parcelas | total | categoria | confiança | status |`);
  p(`| --- | --- | --- | ---: | ---: | ---: | --- | --- | --- |`);
  for (const c of compromissos) {
    p(
      `| ${c.nomeFonte} | ${c.pessoa?.name ?? '—'} | ${c.metodo} ${c.pessoaScore ? `(${c.pessoaScore})` : ''} | ${brl(c.valorMensal)} | ${c.parcelas.length} | ${brl(c.parcelas.reduce((a, x) => a + x.valorCents, 0))} | ${c.categoria?.code ?? '—'} | ${c.confianca} | ${c.statusContrato} |`
    );
  }
  p();
  p(`Total programado: **${brl(somaTudo)}** em ${selecao.aceitas.length} parcelas.`);
  p();

  p(`## Por mês`);
  p();
  const porMes = new Map();
  for (const c of compromissos) {
    for (const x of c.parcelas) {
      const m = x.vencimento.slice(0, 7);
      const atual = porMes.get(m) ?? { n: 0, total: 0, fantasma: 0 };
      atual.n += 1;
      atual.total += x.valorCents;
      if (x.fantasma) atual.fantasma += x.valorCents;
      porMes.set(m, atual);
    }
  }
  p(`| mês | parcelas | programado | de quem saiu | entra na previsão |`);
  p(`| --- | ---: | ---: | ---: | ---: |`);
  for (const [m, v] of [...porMes.entries()].sort()) {
    p(`| ${m} | ${v.n} | ${brl(v.total)} | ${brl(v.fantasma)} | ${brl(INCLUIR_INATIVOS ? v.total : v.total - v.fantasma)} |`);
  }
  p();

  if (somaFantasma > 0) {
    p(`## Folha de quem já saiu — ${brl(somaFantasma)}`);
    p();
    p(`> Não é decisão do script. ${INCLUIR_INATIVOS ? 'A flag `--incluir-inativos` mandou materializar mesmo assim.' : 'Por padrão o contrato nasce `suspenso` e estas parcelas NÃO viram documento; nada disso chega à previsão.'}`);
    p();
    for (const c of compromissos.filter((x) => x.fantasmas.length)) {
      p(`- **${c.pessoa?.name ?? c.nomeFonte}** (${c.nomeFonte}): ${c.fantasmas[0].motivoFantasma}`);
      for (const f of c.fantasmas) p(`  - ${f.vencimento} · ${brl(f.valorCents)} · tarefa ${f.id}`);
    }
    p();
  }

  const divergentes = compromissos.filter((c) => c.fixoPlanilhaCents !== null && c.fixoPlanilhaCents !== c.valorMensal);
  const semFixo = compromissos.filter((c) => c.fixoPlanilhaCents === null);
  if (divergentes.length || semFixo.length) {
    p(`## Conferência contra a planilha (fin_person_compensation)`);
    p();
    for (const c of divergentes) {
      p(`- **${c.pessoa?.name ?? c.nomeFonte}**: ClickUp diz ${brl(c.valorMensal)}/mês, planilha (${c.fixoPlanilhaMes}) diz ${brl(c.fixoPlanilhaCents)} de fixo contratado — diferença de ${brl(Math.abs(c.valorMensal - c.fixoPlanilhaCents))}/mês. Contrato gravado como \`previsto\`.`);
    }
    for (const c of semFixo) {
      p(`- **${c.pessoa?.name ?? c.nomeFonte}**: não tem fixo contratado em fin_person_compensation. O ClickUp é a única fonte; contrato gravado como \`previsto\`.`);
    }
    p();
  }

  if (selecao.alertas.length) {
    p(`## Tarefas futuras que NÃO entraram`);
    p();
    for (const a of selecao.alertas) p(`- ${a}`);
    p();
  }

  if (resultado) {
    const conta = (estado) => resultado.documentos.filter((d) => d.estado === estado).length;
    p(`## Escrita`);
    p();
    p(`- contratos: ${resultado.contratos.filter((c) => c.inserido).length} inseridos, ${resultado.contratos.filter((c) => !c.inserido).length} atualizados`);
    p(`- documentos: ${conta('inserido')} inseridos, ${conta('atualizado')} atualizados, ${conta('preservado')} preservados (liquidados ou editados)`);
    p(`- pendências abertas na fila de revisão: ${resultado.pendencias.length}`);
    p();
  }

  if (antes && depois) {
    p(`## Efeito no fôlego de caixa`);
    p();
    p(`Caixa livre hoje (L0): **${brl(antes.disponivel)}**.`);
    p();
    p(`| mês | L1 receber | L2 contratos | L3 pagar (antes → depois) | fechamento antes | fechamento depois | Δ |`);
    p(`| --- | ---: | ---: | ---: | ---: | ---: | ---: |`);
    for (let i = 0; i < antes.meses.length; i += 1) {
      const a = antes.meses[i];
      const d = depois.meses[i];
      p(
        `| ${a.mes.slice(0, 7)} | ${brl(d.l1)} | ${brl(d.l2)} | ${brl(a.l3)} → ${brl(d.l3)} | ${brl(a.fechamento)} | ${brl(d.fechamento)} | ${brl(d.fechamento - a.fechamento)} |`
      );
    }
    p();
  }

  if (faltandoMigration.length) {
    p(`## PENDENTE`);
    p();
    p(`A migration \`db/migrations/0030_fin_contas_a_pagar.sql\` ainda não está aplicada. Falta:`);
    for (const f of faltandoMigration) p(`- ${f}`);
    p();
  }

  return L.join('\n');
}

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------
async function main() {
  const bruto = JSON.parse(await readFile(ARQUIVO, 'utf8'));
  const tarefas = Array.isArray(bruto) ? bruto : bruto.data ?? bruto.tasks ?? [];
  if (!tarefas.length) throw new Error(`nenhuma tarefa em ${ARQUIVO}`);

  const pool = financePool();
  const client = await pool.connect();
  try {
    const { rows: hojeRows } = await client.query(
      `SELECT (now() AT TIME ZONE $1)::date::text AS hoje`, [TZ]
    );
    const hoje = HOJE_FLAG ?? hojeRows[0].hoje;

    const faltandoMigration = await checarMigration(client);
    const ledger = await carregarLedger(client);
    const selecao = selecionar(tarefas, hoje);
    const compromissos = planejar(selecao.aceitas, ledger, hoje);

    let resultado = null;
    let antes = null;
    let depois = null;

    if (faltandoMigration.length && !COM_MIGRATION) {
      console.error('\n⚠  migration 0030 não aplicada — nada será gravado nem simulado:');
      for (const f of faltandoMigration) console.error(`   falta ${f}`);
      console.error('   O orquestrador aplica; este script não roda migration.');
      console.error('   Para ensaiar o import inteiro sem alterar o schema: --com-migration\n');
    } else {
      const batchId = randomUUID();
      await client.query('BEGIN');
      try {
        // Esperar por lock indefinidamente é como um importador vira um
        // processo pendurado que ninguém entende: outra sessão com uma
        // transação aberta em fin_document (a tela, outro script) segura a
        // linha, e o `--apply` fica parado sem dizer por quê. Falhar em 15s com
        // erro de lock é diagnóstico; travar não é. Vale ainda mais no ensaio
        // com --com-migration, cujo DDL pede ACCESS EXCLUSIVE e, sem limite,
        // enfileiraria todo mundo atrás dele.
        await client.query(`SET LOCAL lock_timeout = '15s'`);
        if (COM_MIGRATION) {
          await client.query(await readFile(MIGRATION, 'utf8'));
          console.log(`• ensaio: ${path.basename(MIGRATION)} executada dentro da transação (será desfeita no ROLLBACK)`);
        }
        antes = await medirFolego(client, hoje);
        for (let passada = 1; passada <= (APLICAR ? 1 : REPETIR); passada += 1) {
          resultado = await gravar(client, ledger, compromissos, batchId);
          if (REPETIR > 1 && !APLICAR) {
            const { rows } = await client.query(
              `SELECT (SELECT count(*)::int FROM fin_contract WHERE source = $1) AS contratos,
                      (SELECT count(*)::int FROM fin_document WHERE source = $1) AS documentos`,
              [FONTE]
            );
            const conta = (e) => resultado.documentos.filter((d) => d.estado === e).length;
            console.log(
              `• passada ${passada}: ${conta('inserido')} doc inseridos, ${conta('atualizado')} atualizados` +
                ` → ${rows[0].contratos} contratos e ${rows[0].documentos} documentos com source='${FONTE}' no banco`
            );
          }
        }
        depois = await medirFolego(client, hoje);
        if (APLICAR) {
          await client.query('COMMIT');
          console.log(`\n✔ gravado. batch_id = ${batchId} (fin_audit_log guarda o lote inteiro)`);
        } else {
          await client.query('ROLLBACK');
          console.log('\n• dry-run: escrita executada e revertida. Use --apply para gravar.');
        }
      } catch (erro) {
        await client.query('ROLLBACK');
        throw erro;
      }
    }

    const texto = montarRelatorio({
      hoje,
      total: tarefas.length,
      selecao,
      compromissos,
      resultado,
      antes,
      depois,
      faltandoMigration
    });
    console.log(`\n${texto}`);
    if (RELATORIO) {
      writeFileSync(path.resolve(RELATORIO), `${texto}\n`);
      console.log(`\nrelatório salvo em ${path.resolve(RELATORIO)}`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});

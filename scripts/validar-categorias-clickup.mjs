// Mede o motor de regras contra a classificação HUMANA do ClickUp.
//
// A plataforma nunca teve gabarito. As 48 regras foram escritas olhando o texto
// dos extratos e conferidas contra o bom senso de quem escreveu — o que responde
// "a regra faz o que eu quis", nunca "a regra acerta". São coisas diferentes, e
// a segunda é a única que importa quando o número vai para uma decisão.
//
// A lista "Fluxo de caixa" do ClickUp tem 758 tarefas, 720 com o campo
// `Categoria` preenchido por uma pessoa que estava OLHANDO o extrato. Isso é
// segunda opinião independente: mesma realidade, outro classificador, sem
// contaminação — o ClickUp não sabe que o motor existe.
//
// O QUE ESTE ARQUIVO FAZ, E O QUE NÃO FAZ:
//
//   · Só SELECT. Nenhum UPDATE, nenhuma migration, nenhuma reclassificação.
//     Medir e aplicar são atos separados; misturá-los é como se aplica uma
//     correção errada com a confiança de quem mediu.
//   · Não decide quem está certo por conta própria, exceto onde a decisão é
//     estrutural (a fonte carimbou o tipo do lançamento) ou onde o erro é
//     mecânico e demonstrável (regra que casa por prefixo genérico). O resto sai
//     em "precisa de decisão humana", com R$ ao lado, ordenado.
//
// AS TRÊS ARMADILHAS DESTE DADO, tratadas explicitamente mais abaixo:
//
//   · `evaluateConditions` devolve OBJETO `{ok,...}`. Testar o retorno sem
//     `.ok === true` faz TODA condição casar (objeto é truthy) e produz uma
//     acurácia de 100% que não significa nada. Ver `casaRegra()`.
//   · Dropdown do ClickUp guarda `orderindex`, e o primeiro é ZERO. Qualquer
//     `if (!campo.value)` descarta as 181 tarefas de "Materiais para serviço" —
//     a maior categoria do gabarito, R$ 163 mil — em silêncio.
//   · 76 dos 758 nomes vêm com mojibake (UTF-8 lido como latin-1:
//     "TransferÃªncia"). Sem consertar, a agulha "transferencia enviada pelo
//     pix" não casa e o motor parece pior do que é. Consertado, e o número de
//     consertos é reportado.
//
// Uso:
//   node scripts/validar-categorias-clickup.mjs
//   node scripts/validar-categorias-clickup.mjs --janela=15   (dias no casamento)
//   node scripts/validar-categorias-clickup.mjs --json        (saída para máquina)
//   node scripts/validar-categorias-clickup.mjs --detalhe     (lista divergências)

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { classify, evaluateConditions } from './lib/fin-rules.mjs';
import { normalizeDescription, normalizeName, toCents } from './lib/fin-normalize.mjs';

loadEnv();

const args = process.argv.slice(2);
const flag = (nome, padrao) => {
  const hit = args.find((a) => a.startsWith(`--${nome}=`));
  return hit ? hit.slice(nome.length + 3) : padrao;
};
const JANELA_DIAS = Number(flag('janela', '7'));
const SAIDA_JSON = args.includes('--json');
const DETALHE = args.includes('--detalhe');
const LISTA = flag('lista', 'Fluxo de caixa');

const ARQUIVO_CLICKUP = resolve(process.cwd(), 'data/raw/clickup-tasks.json');

// ---------------------------------------------------------------------------
// Guarda de somente-leitura
// ---------------------------------------------------------------------------
// Não é decoração. Este script existe para produzir um número em que alguém vai
// confiar para MEXER na classificação depois; se ele próprio puder mexer, o
// número deixa de ser uma medição e vira parte do experimento. A guarda torna
// isso impossível por construção, não por disciplina.
function apenasLeitura(sql) {
  const limpo = sql.trim().replace(/^--.*$/gm, '').trim().toLowerCase();
  if (!limpo.startsWith('select') && !limpo.startsWith('with')) {
    throw new Error('validar-categorias-clickup é SOMENTE LEITURA: só SELECT/WITH');
  }
  if (/\b(insert|update|delete|alter|drop|create|truncate|grant|copy)\b/.test(limpo)) {
    throw new Error('validar-categorias-clickup é SOMENTE LEITURA: verbo de escrita na consulta');
  }
  return sql;
}

// ---------------------------------------------------------------------------
// 1. O MAPA DE TAXONOMIA
// ---------------------------------------------------------------------------
// O ClickUp tem 23 opções de `Categoria`; o plano de contas tem 55 códigos. Não
// é bijeção, e fingir que é seria a fonte de erro mais cara deste relatório —
// toda divergência de mapeamento apareceria como erro do motor.
//
// Por isso cada entrada carrega TRÊS coisas:
//
//   · `primario` — o código que a categoria humana significa, na leitura mais
//     provável. É contra ele que a "acurácia estrita" é medida.
//   · `aceitaveis` — os códigos que um contador não chamaria de erro. É contra
//     este conjunto que a "acurácia tolerante" é medida. A diferença entre as
//     duas números diz quanto da divergência é discordância real e quanto é
//     granularidade do plano de contas.
//   · `porque` — a defesa do mapeamento, para poder ser contestada.
//
// A decisão que mais move número: MATERIAL, DESLOCAMENTO, TERCEIRIZAÇÃO e
// COMISSÃO vão para 4.xx (custo totalmente variável), não para 5.xx. É o que o
// doc 17_throughput_accounting_xpe.md manda e o que o seed 0005 já declara:
// posto em 5.xx, o Throughput fica superestimado e a decisão de aceitar ou
// recusar um serviço passa a ser tomada com o número errado.
const MAPA = {
  'Materiais para serviço': {
    primario: '4.02',
    aceitaveis: ['4.02'],
    porque:
      'A tarefa é filha de um Projeto (728 de 758 têm o relacionamento preenchido): ' +
      'material comprado PARA uma obra identificada é custo totalmente variável, 4.02. ' +
      'Nenhum 5.xx é aceitável aqui — seria tratar insumo de obra como estrutura.'
  },
  'Ferramentas e equipamentos': {
    primario: '8.01',
    aceitaveis: ['8.01', '4.02', '5.07', '5.08'],
    porque:
      'Ambígua POR NATUREZA e a menor média do gabarito (R$ 454): "maleta ferramenta", ' +
      '"luvas", "EPI" são consumo (4.02/5.07); "aluguel maquina" é 4.04/5.08; só o ' +
      'durável é 8.01. O plano de contas não separa consumo de imobilizado por valor, ' +
      'e o ClickUp não informa. Aceito os quatro e conto como decisão pendente.'
  },
  'Transporte e deslocamento': {
    primario: '4.04',
    aceitaveis: ['4.04', '5.06'],
    porque:
      'Combustível/Uber/pedágio ligados a um Projeto são deslocamento atribuível ao ' +
      'serviço (4.04, custo totalmente variável). 5.06 fica aceitável porque o motor ' +
      'não vê o Projeto e sem ele "posto" é indistinguível de viagem administrativa.'
  },
  'Alimentação': {
    primario: '6.04',
    aceitaveis: ['6.04', '5.06'],
    porque:
      'É o destino que a própria regra 49 já usa (restaurantes → 6.04 Benefícios). ' +
      'Média de R$ 62 e subcategorias "Almoço equipe"/"Alimentação em campo": é ' +
      'benefício de equipe, não representação — mas 5.06 não é erro grave.'
  },
  'Terceirização de serviços': {
    primario: '4.03',
    aceitaveis: ['4.03'],
    porque:
      'Correspondência 1:1 com "4.03 Terceirização e subcontratação". Eletricista, ' +
      'projetista, instalador e serralheiro contratados por obra são custo totalmente ' +
      'variável — é a definição. 6.01 aqui é erro que infla folha e desinfla custo direto.'
  },
  'Salários': {
    primario: '6.01',
    aceitaveis: ['6.01', '6.02', '6.03', '6.06', '6.08'],
    porque:
      'A subcategoria do ClickUp separa "Funcionário CLT" de "Pró-labore", mas 41 das ' +
      '46 tarefas estão sem subcategoria. Aceito a família 6.xx inteira: distinguir ' +
      'salário de pró-labore exige o cadastro de pessoa, não o texto.'
  },
  'Comissões': {
    primario: '4.01',
    aceitaveis: ['4.01'],
    porque:
      'Todas as 36 são SAÍDA. Comissão PAGA é custo totalmente variável (4.01) — o ' +
      'seed 0005 abre com esse aviso. 6.01/6.02 é o erro exato que o seed existe para ' +
      'evitar; 3.06 seria comissão RECEBIDA, direção oposta.'
  },
  'Reembolsos': {
    primario: '6.05',
    aceitaveis: ['6.05', '9.02'],
    porque:
      'Reembolso a colaborador é 6.05. Quando o dinheiro VOLTA para a empresa é 9.02 ' +
      '(recuperação de despesa) — as 3 tarefas não deixam claro o sentido.'
  },
  'Impostos e taxas': {
    primario: '7.01',
    aceitaveis: ['7.01', '7.02', '7.03', '5.10'],
    porque:
      'A categoria mistura DAS (7.01), ISS (7.02), retenções (7.03) e anuidade do CREA ' +
      '(5.10, que NÃO é imposto). As subcategorias do ClickUp separam os quatro, mas ' +
      'quase nenhuma tarefa as usa. Aceito os quatro e trato a mistura como ' +
      'limitação do gabarito, não do motor.'
  },
  Contabilidade: {
    primario: '5.04',
    aceitaveis: ['5.04'],
    porque: 'Correspondência 1:1 com "5.04 Contabilidade e jurídico".'
  },
  'Software e assinaturas': {
    primario: '5.03',
    aceitaveis: ['5.03', '8.04'],
    porque: '5.03 para assinatura; 8.04 se for licença perpétua. Zero tarefas usam esta opção.'
  },
  'Infraestrutura / escritório': {
    primario: '5.01',
    aceitaveis: ['5.01', '5.07', '5.08', '8.02'],
    porque: 'Aluguel/condomínio (5.01), copa (5.07), manutenção (5.08) ou reforma (8.02). Zero tarefas.'
  },
  'Despesas administrativas': {
    primario: '5.99',
    aceitaveis: ['5.99', '5.07', '5.04', '5.10'],
    porque:
      'É a lixeira do ClickUp, e 5.99 é a lixeira do plano de contas. Casá-las é honesto: ' +
      'nenhuma das duas afirma nada. Contadas separadamente no relatório por isso.'
  },
  'Marketing e vendas': {
    primario: '5.05',
    aceitaveis: ['5.05'],
    porque: 'Correspondência 1:1. Zero tarefas usam esta opção.'
  },
  'Serviços bancários': {
    primario: '4.05',
    aceitaveis: ['4.05', '9.11', '9.03'],
    porque:
      'Tarifa bancária é 4.05. 9.03 entra como aceitável porque as 4 tarefas assim ' +
      'marcadas se chamam "aplicação RDB" — que é aplicação, não tarifa. Erro do humano, ' +
      'e o relatório o expõe em vez de o esconder no denominador.'
  },
  'Manutenção de equipamentos': {
    primario: '5.08',
    aceitaveis: ['5.08', '8.01'],
    porque: 'Manutenção é 5.08; se for troca de ativo, 8.01. Zero tarefas.'
  },
  'Logística e frete': {
    primario: '5.11',
    aceitaveis: ['5.11', '4.02'],
    porque: 'Frete genérico é 5.11; frete de material de obra é parte do custo do material (4.02). Zero tarefas.'
  },
  'Outros custos operacionais': {
    primario: '5.99',
    aceitaveis: ['5.99'],
    porque: 'Lixeira contra lixeira. Não afirma nada e não deve pontuar como acerto forte.'
  },
  'Pagamento de Fatura': {
    primario: null,
    semEquivalente: true,
    aceitaveis: ['9.01'],
    porque:
      'NÃO TEM EQUIVALENTE, e não deveria existir como categoria. "Pagamento de fatura" ' +
      'é o VEÍCULO do pagamento (boleto, fatura de cartão), não a natureza da despesa: ' +
      'as 20 tarefas incluem Claro (5.02), Dimensional (4.02, material) e Neoenergia ' +
      '(5.02). São R$ 78.540 sem classificação econômica nenhuma. 9.01 só é aceitável ' +
      'quando for fatura de cartão próprio. Excluída do denominador de acurácia.'
  },
  'Receita Projeto': {
    primario: '3.*',
    familia: /^3\./,
    aceitaveis: [],
    porque:
      'Receita de serviço, mas o ClickUp não diz QUAL serviço — e o plano de contas tem ' +
      '14 linhas de receita (3.01 a 3.14), justamente a distinção que sustenta o ' +
      'Throughput por núcleo. Medida só no nível de família 3.xx; qualquer código 3.x ' +
      'conta como acerto. O nome do Projeto ("Edf. Luar das Ubaias _ Melhorias ' +
      'Eletricas") teria o serviço, e é a maior oportunidade não explorada deste dado.'
  },
  'Reserva de caixa': {
    primario: '9.03',
    aceitaveis: ['9.03', '9.01'],
    porque:
      'Aplicação/resgate de RDB é 9.03, movimentação neutra. Ponto de teste importante: ' +
      'o motor só acerta isso por `source_kind` (regra 30), campo que o ClickUp não tem — ' +
      'então aqui ele vai falhar por FALTA DE DADO, não por regra errada. Separado no relatório.'
  },
  'Caixa Impostos': {
    primario: '9.03',
    aceitaveis: ['9.03', '7.01'],
    porque: 'Uma tarefa, "resgate rdb". Mesma leitura da reserva de caixa.'
  },
  imposo: {
    primario: '7.01',
    aceitaveis: ['7.01', '7.02', '7.03'],
    porque: 'Opção com erro de digitação no próprio ClickUp, sem uso. Mapeada por completude.'
  }
};

/**
 * Subcategoria do ClickUp que DECIDE, contra a categoria-mãe.
 *
 * Só entram as que removem ambiguidade real e cujo destino é inequívoco. As
 * demais ("Cabos", "Disjuntores") apenas confirmam a mãe e não precisam estar
 * aqui — acrescentá-las só aumentaria a superfície de erro do mapa.
 */
const REFINO_SUBCATEGORIA = {
  'Pró-labore': { primario: '6.02', aceitaveis: ['6.02'] },
  'Funcionário CLT': { primario: '6.01', aceitaveis: ['6.01', '6.03', '6.08'] },
  Freelancer: { primario: '4.03', aceitaveis: ['4.03'] },
  'Eletricista terceirizado': { primario: '4.03', aceitaveis: ['4.03'] },
  Projetista: { primario: '4.03', aceitaveis: ['4.03'] },
  Instalador: { primario: '4.03', aceitaveis: ['4.03'] },
  'Prestador Neoenergia': { primario: '4.03', aceitaveis: ['4.03', '5.02'] },
  'Comissão de vendas': { primario: '4.01', aceitaveis: ['4.01'] },
  ISS: { primario: '7.02', aceitaveis: ['7.02'] },
  'Simples Nacional': { primario: '7.01', aceitaveis: ['7.01'] },
  'Taxas CREA': { primario: '5.10', aceitaveis: ['5.10'] },
  ClickUp: { primario: '5.03', aceitaveis: ['5.03'] },
  Supabase: { primario: '5.03', aceitaveis: ['5.03'] },
  n8n: { primario: '5.03', aceitaveis: ['5.03'] },
  Frete: { primario: '5.11', aceitaveis: ['5.11', '4.02'] },
  'Transporte de material': { primario: '5.11', aceitaveis: ['5.11', '4.02', '4.04'] },
  'Aluguel de carro': { primario: '4.04', aceitaveis: ['4.04', '5.06'] }
};

/** Família econômica: é o que muda o Throughput, e o único nível que nunca é opinião. */
function familia(code) {
  if (!code) return null;
  const raiz = code.split('.')[0];
  return (
    {
      3: 'receita',
      4: 'custo totalmente variável',
      5: 'despesa operacional',
      6: 'pessoal',
      7: 'imposto',
      8: 'investimento',
      9: 'neutro/financeiro'
    }[raiz] ?? raiz
  );
}

// ---------------------------------------------------------------------------
// 2. LEITURA DO CLICKUP
// ---------------------------------------------------------------------------

/**
 * Conserta UTF-8 que foi lido como latin-1 em algum ponto da cadeia do ClickUp.
 *
 * "TransferÃªncia" → "Transferência". Sem isto, `normalizeDescription` produz
 * "transferaªncia" (o "ª" é letra Unicode e sobrevive à remoção de acentos), a
 * agulha "transferencia enviada pelo pix" da regra 42 não casa, e 76 tarefas
 * ficam invisíveis para o motor — inflando artificialmente a taxa de "motor não
 * classificou".
 */
function consertarMojibake(texto) {
  if (!texto || !/[ÃÂ]./.test(texto)) return { texto, consertado: false };
  try {
    const tentativa = Buffer.from(texto, 'latin1').toString('utf8');
    if (tentativa.includes('�')) return { texto, consertado: false };
    return { texto: tentativa, consertado: true };
  } catch {
    return { texto, consertado: false };
  }
}

const campo = (tarefa, nome) => (tarefa.custom_fields ?? []).find((f) => f.name === nome);

/**
 * Valor de um dropdown, resolvido pelo `type_config.options`.
 *
 * O `value` é o ORDERINDEX, e o primeiro orderindex é 0. Todo teste de presença
 * aqui é contra null/undefined/'' explicitamente, NUNCA falsy: `if (!value)`
 * apagaria "Materiais para serviço" (orderindex 0), a maior categoria do
 * gabarito, R$ 163.373,40 — e o relatório sairia sem ela, sem erro nenhum.
 */
function dropdown(tarefa, nome) {
  const f = campo(tarefa, nome);
  if (!f) return null;
  const v = f.value;
  if (v === null || v === undefined || v === '') return null;
  const opcoes = f.type_config?.options ?? [];
  const achado = opcoes.find((o) => String(o.orderindex) === String(v)) ?? opcoes.find((o) => o.id === v);
  return achado ? achado.name : `orderindex-desconhecido:${v}`;
}

/** Data em 'YYYY-MM-DD' no fuso de Recife, que é como `posted_on` foi gravado. */
function diaBR(epochMs) {
  if (epochMs === null || epochMs === undefined || epochMs === '') return null;
  const n = Number(epochMs);
  if (!Number.isFinite(n)) return null;
  return new Date(n - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

const diasEntre = (a, b) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);

function carregarClickUp() {
  const bruto = JSON.parse(readFileSync(ARQUIVO_CLICKUP, 'utf8'));
  const todas = bruto.data ?? bruto.tasks ?? bruto;
  const daLista = todas.filter((t) => t.list_name === LISTA);

  const diagnostico = { naLista: daLista.length, mojibake: 0, semCategoria: 0, semValor: 0, semData: 0, direcaoInferida: 0 };
  const tarefas = [];

  for (const t of daLista) {
    const categoria = dropdown(t, 'Categoria');
    if (!categoria) {
      diagnostico.semCategoria += 1;
      continue;
    }

    const { texto: nome, consertado } = consertarMojibake(t.name ?? '');
    if (consertado) diagnostico.mojibake += 1;

    const fValor = campo(t, 'Valor pago');
    const valorCents =
      fValor && fValor.value !== null && fValor.value !== undefined && fValor.value !== ''
        ? Math.abs(toCents(fValor.value))
        : 0;
    if (!valorCents) diagnostico.semValor += 1;

    const data = diaBR(t.due_date);
    if (!data) diagnostico.semData += 1;

    const mov = dropdown(t, 'Movimentação');
    const mapa = MAPA[categoria];
    let direcao = mov === 'Entrada' ? 'receber' : mov === 'Saida' ? 'pagar' : null;
    if (!direcao) {
      // Sem `Movimentação` a direção vem do que a categoria significa. É
      // inferência, e por isso é contada: 45 tarefas dependem dela.
      direcao = mapa?.familia?.test?.('3.01') ? 'receber' : 'pagar';
      diagnostico.direcaoInferida += 1;
    }

    const projetos = campo(t, 'Projetos');
    const nomesProjeto = Array.isArray(projetos?.value) ? projetos.value.map((p) => p?.name).filter(Boolean) : [];

    tarefas.push({
      id: t.id,
      url: t.url,
      nome,
      nomeNorm: normalizeDescription(nome),
      categoria,
      subcategoria: dropdown(t, 'Subcategoria'),
      formaPagamento: dropdown(t, 'Forma de Pagamento'),
      contaPagadora: dropdown(t, 'Conta Pagadora'),
      beneficiado: dropdown(t, 'Beneficiado'),
      valorCents,
      direcao,
      movimentacaoDeclarada: mov,
      data,
      dataCriacao: diaBR(t.date_created),
      dataPagamento: diaBR(campo(t, 'Data do Pagamento')?.value),
      projetos: nomesProjeto,
      status: t.status?.status ?? null
    });
  }

  return { tarefas, diagnostico };
}

/** Gabarito de uma tarefa: primário + aceitáveis, já com o refino da subcategoria. */
function gabaritoDe(tarefa) {
  const base = MAPA[tarefa.categoria];
  if (!base) return null;
  const refino = tarefa.subcategoria ? REFINO_SUBCATEGORIA[tarefa.subcategoria] : null;

  const primario = refino?.primario ?? base.primario;
  const aceitaveis = new Set([...(base.aceitaveis ?? []), ...(refino?.aceitaveis ?? [])]);
  if (primario && primario !== '3.*') aceitaveis.add(primario);

  return {
    primario,
    aceitaveis,
    familiaRegex: base.familia ?? null,
    semEquivalente: Boolean(base.semEquivalente),
    // Só pontuam como acerto FORTE as categorias que afirmam alguma coisa. Um
    // "Outros custos" batendo com "Despesa a classificar" não é o motor
    // acertando, é as duas pontas desistindo ao mesmo tempo.
    informativa: !['Despesas administrativas', 'Outros custos operacionais'].includes(tarefa.categoria)
  };
}

/** O código do motor bate com o gabarito? Três níveis, do mais duro ao mais frouxo. */
function confere(gab, code) {
  if (!code || !gab) return { estrito: false, tolerante: false, familia: false };
  if (gab.familiaRegex) {
    const ok = gab.familiaRegex.test(code);
    return { estrito: ok, tolerante: ok, familia: ok };
  }
  return {
    estrito: code === gab.primario,
    tolerante: gab.aceitaveis.has(code),
    familia: Boolean(gab.primario) && familia(code) === familia(gab.primario)
  };
}

// ---------------------------------------------------------------------------
// 3. O MOTOR CONTRA O TEXTO DO CLICKUP
// ---------------------------------------------------------------------------

/**
 * Tarefa do ClickUp → sujeito do avaliador.
 *
 * Segue campo a campo `sujeitoDeTransacao` de scripts/reclassificar.mjs:175 —
 * tem de ser o MESMO sujeito, senão a medição responde "o que um motor parecido
 * decidiria", que não serve para nada.
 *
 * A diferença irredutível é `source_kind: null`. O ClickUp não tem o tipo cru da
 * fonte, e nove regras (17, 18, 19, 20, 21, 30, 31, 43, 44) dependem só dele.
 * Essas regras NÃO PODEM disparar aqui — o que não é falha do motor, e o
 * relatório separa esse grupo em vez de somá-lo aos erros.
 */
function sujeitoDeTarefa(tarefa) {
  const amount = tarefa.direcao === 'receber' ? tarefa.valorCents : -tarefa.valorCents;
  return {
    scope: 'transaction',
    description_norm: tarefa.nomeNorm,
    counterparty_name_norm: normalizeName(tarefa.nome),
    counterparty_document: null,
    account_slug: { Nubank: 'nubank', Inter: 'inter', Assas: 'asaas' }[tarefa.contaPagadora] ?? null,
    amount_cents: amount,
    amount_abs: Math.abs(amount),
    source_kind: null,
    billing_type: null,
    direction: amount >= 0 ? 'receber' : 'pagar',
    day_of_month: tarefa.data ? Number(tarefa.data.slice(8, 10)) : null
  };
}

/**
 * Linha do ledger → sujeito do avaliador, para RECOMPUTAR o que o motor decide.
 *
 * Existe porque `category_id` gravado no ledger é histórico: veio de uma versão
 * anterior das regras, pode ter sido travado por um humano, e a 0023 estreitou a
 * regra 18 depois de várias linhas já estarem classificadas. Comparar o gabarito
 * com o que ESTÁ gravado responde "o ledger está certo hoje?"; comparar com o
 * que o motor decide AGORA responde "as regras de hoje acertam?" — e só a
 * segunda pergunta mede regra.
 */
function sujeitoDeLinha(linha) {
  const amount = Number(linha.amount_cents);
  return {
    scope: 'transaction',
    description_norm: linha.description_norm,
    counterparty_name_norm: normalizeName(linha.counterparty_raw),
    counterparty_document: null,
    account_slug: linha.conta,
    amount_cents: amount,
    amount_abs: Math.abs(amount),
    source_kind: linha.source_kind,
    billing_type: null,
    direction: amount >= 0 ? 'receber' : 'pagar',
    day_of_month: Number(linha.posted_on.slice(8, 10))
  };
}

/**
 * `evaluateConditions` devolve `{ ok, field?, snippet?, offset? }` — um OBJETO.
 *
 * Objeto é truthy SEMPRE, inclusive `{ ok: false }`. Escrever
 * `if (evaluateConditions(...))` faz toda regra casar com toda linha, a primeira
 * regra da ordem vence tudo, e o relatório sai com uma acurácia inventada que
 * parece plausível. Este wrapper existe para que esse erro não tenha onde
 * acontecer no arquivo.
 */
function casaRegra(regra, sujeito) {
  try {
    return evaluateConditions(regra.conditions, sujeito).ok === true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 4. CASAMENTO COM O LEDGER
// ---------------------------------------------------------------------------

/** Jaccard sobre tokens de 4+ caracteres. Nomes de pessoa e razão social sobrevivem; "de", "da", "pix" não. */
function semelhanca(a, b) {
  const tok = (s) => new Set(String(s).split(' ').filter((p) => p.length >= 4));
  const A = tok(a);
  const B = tok(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / (A.size + B.size - inter);
}

function casar(tarefas, ledger) {
  // Índice por valor absoluto: é a única chave forte que as duas pontas
  // compartilham. Data é aproximada (o due_date do ClickUp é o vencimento
  // planejado, não a liquidação) e texto muitas vezes não existe ("cabos").
  const porValor = new Map();
  for (const l of ledger) {
    const k = Math.abs(Number(l.amount_cents));
    if (!porValor.has(k)) porValor.set(k, []);
    porValor.get(k).push(l);
  }

  const pares = [];
  const censo = { semValor: 0, semData: 0, zeroCandidatos: 0, umCandidato: 0, variosCandidatos: 0, candidatosTotal: 0 };

  for (const t of tarefas) {
    if (!t.valorCents) {
      censo.semValor += 1;
      continue;
    }
    if (!t.data) {
      censo.semData += 1;
      continue;
    }

    const mesmos = porValor.get(t.valorCents) ?? [];
    const candidatos = mesmos.filter((l) => {
      const sinalOk = t.direcao === 'receber' ? Number(l.amount_cents) > 0 : Number(l.amount_cents) < 0;
      if (!sinalOk) return false;
      return Math.abs(diasEntre(l.posted_on, t.data)) <= JANELA_DIAS;
    });

    censo.candidatosTotal += candidatos.length;
    if (candidatos.length === 0) censo.zeroCandidatos += 1;
    else if (candidatos.length === 1) censo.umCandidato += 1;
    else censo.variosCandidatos += 1;

    for (const l of candidatos) {
      const dist = Math.abs(diasEntre(l.posted_on, t.data));
      const sim = semelhanca(t.nomeNorm, l.description_norm);
      const contaOk = t.contaPagadora && l.conta === { Nubank: 'nubank', Inter: 'inter', Assas: 'asaas' }[t.contaPagadora];
      pares.push({
        tarefa: t,
        linha: l,
        dist,
        sim,
        candidatos: candidatos.length,
        score: sim * 0.6 + (1 - dist / (JANELA_DIAS + 1)) * 0.35 + (contaOk ? 0.05 : 0)
      });
    }
  }

  // Atribuição 1:1 gulosa. Sem ela, uma linha de R$ 50 no extrato "casa" com
  // cinco tarefas de R$ 50 e a taxa de casamento fica inflada — cada tarefa
  // acharia par, mas o par seria o mesmo dinheiro contado cinco vezes.
  pares.sort((a, b) => b.score - a.score);
  const tarefaUsada = new Set();
  const linhaUsada = new Set();
  const casados = [];
  for (const p of pares) {
    if (tarefaUsada.has(p.tarefa.id) || linhaUsada.has(p.linha.id)) continue;
    tarefaUsada.add(p.tarefa.id);
    linhaUsada.add(p.linha.id);
    casados.push(p);
  }

  return { casados, censo };
}

// ---------------------------------------------------------------------------
// 5. DEFEITO MECÂNICO E VEREDITO
// ---------------------------------------------------------------------------

/**
 * Agulhas que são NOME DE BANCO, não nome de fornecedor.
 *
 * O extrato do Nubank escreve a instituição do FAVORECIDO dentro da descrição:
 * "Transferência enviada pelo Pix — Fulano - •••.281.484-•• - MERCADO PAGO IP
 * LTDA. (0323) Agência: 1 Conta: ...". Uma agulha como "mercado pago" ou "stone"
 * casa aí sempre, e o que ela está lendo é onde a pessoa tem conta — informação
 * sem nenhuma relação com a natureza da despesa.
 *
 * É um defeito de classe, não um caso: qualquer agulha que também seja nome de
 * instituição financeira herda o problema no dia em que alguém a escrever.
 */
const AGULHAS_QUE_SAO_BANCO = new Set(['mercado pago', 'stone', 'pagseguro', 'cielo', 'getnet', 'asaas', 'picpay']);

/**
 * A fatia da descrição onde mora o NOME DO FAVORECIDO.
 *
 * O Nubank escreve sempre na mesma ordem: verbo, nome, documento, instituição,
 * agência, conta. Normalizado:
 *
 *   "transferencia enviada pelo pix | rosimere batista dos santos | 719 514 | stone ip s a | 0197 ..."
 *                                     └──── favorecido ────┘   └ tudo depois é banco ┘
 *
 * O favorecido é o que vem entre o verbo e o primeiro grupo de dígitos. Uma
 * agulha que casa FORA dessa fatia não está lendo com quem a empresa gastou —
 * está lendo onde essa pessoa tem conta. É um teste de POSIÇÃO, verificável, e
 * não depende de saber quais nomes são de banco.
 */
function fatiaDoFavorecido(descNorm) {
  const m = /(?:pix|ted|doc|transferencia)\s+(.*)$/.exec(descNorm);
  if (!m) return null;
  const semDigito = m[1].split(/\s\d/)[0];
  return semDigito || null;
}

/**
 * Defeito demonstrável na agulha que casou — independe de opinião contábil.
 *
 * Devolve a descrição do defeito, ou null quando a divergência é discordância
 * legítima de classificação (que é o que tem de sobrar para o humano decidir).
 */
function defeitoMecanico({ trecho, tarefa }) {
  if (!trecho) return null;
  const texto = tarefa.nomeNorm;
  const ehPix = texto.includes('pix') || texto.includes('transferencia');

  if (AGULHAS_QUE_SAO_BANCO.has(trecho) && ehPix) {
    const favorecido = fatiaDoFavorecido(texto);
    if (favorecido !== null && !favorecido.includes(trecho)) {
      return `agulha "${trecho}" casou FORA da fatia do favorecido — leu a instituição, não a contraparte`;
    }
  }
  // "posto " (com espaço) está DENTRO de "imposto ". A agulha foi escrita com
  // espaço à direita justamente para evitar "postos" — e o espaço à esquerda,
  // que era o que faltava, é o que deixa "im|posto |parcela" passar.
  if (trecho === 'posto ' && texto.includes('imposto')) {
    return 'agulha "posto " casou dentro da palavra "imposto" — falta a fronteira à esquerda';
  }
  if (String(trecho).length <= 4 && texto.includes(trecho) && !new RegExp(`(^|\\s)${trecho.trim()}(\\s|$)`).test(texto)) {
    return `agulha "${trecho}" casou no MEIO de outra palavra`;
  }
  return null;
}

// Onde motor e humano discordam, quem parece certo. Só quatro situações têm
// resposta objetiva; o resto sai como pendência, porque um relatório que
// "resolve" tudo sozinho é um relatório em que ninguém precisa olhar — e é
// exatamente aí que o erro sobrevive.
const CATEGORIAS_DE_FORNECEDOR = new Set([
  'Materiais para serviço',
  'Ferramentas e equipamentos',
  'Transporte e deslocamento',
  'Alimentação',
  'Terceirização de serviços',
  'Impostos e taxas',
  'Contabilidade',
  'Software e assinaturas',
  'Logística e frete'
]);

function veredito(r) {
  const { tarefa, gab, code, regraId, campoQueCasou, trecho } = r;
  if (campoQueCasou === 'source_kind') {
    return { quem: 'motor', porque: 'decidido por `source_kind` — fato carimbado pela fonte, não palpite de texto' };
  }
  const defeito = defeitoMecanico({ trecho, tarefa });
  if (defeito) return { quem: 'humano', porque: defeito };

  if (String(regraId) === '42' && !confere(gab, code).tolerante) {
    return {
      quem: 'humano',
      porque: 'regra 42 casa o PREFIXO "Pix enviado"/"Transferência enviada pelo Pix" — o verbo do extrato, não o beneficiário'
    };
  }
  if (code?.startsWith('6.') && CATEGORIAS_DE_FORNECEDOR.has(tarefa.categoria)) {
    return {
      quem: 'humano',
      porque: 'motor mandou para folha (6.xx) uma despesa que o gabarito nomeia como fornecedor/insumo'
    };
  }
  return { quem: 'indefinido', porque: 'sem critério objetivo — precisa de decisão humana' };
}

const brl = (cents) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });
const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : '—');

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------

async function main() {
  const { tarefas, diagnostico } = carregarClickUp();

  const pool = financePool();
  const q = async (sql, params) => (await pool.query(apenasLeitura(sql), params)).rows;

  const regras = await q(`
    SELECT id, name, priority, match_scope, conditions, actions, confidence
      FROM fin_rule
     WHERE status = 'ativa'
     ORDER BY priority ASC, id ASC
  `);
  const regraPorId = new Map(regras.map((r) => [String(r.id), r]));

  const categorias = await q('SELECT id, code, name, kind, toc_class FROM fin_category');
  const nomeDoCodigo = new Map(categorias.map((c) => [c.code, c.name]));

  const ledger = await q(`
    SELECT t.id,
           t.posted_on::text                       AS posted_on,
           t.amount_cents,
           t.description_norm,
           COALESCE(t.counterparty_raw, '')        AS counterparty_raw,
           t.source_kind,
           t.classified_by,
           t.classified_rule_id,
           a.slug                                  AS conta,
           c.code                                  AS category_code,
           c.name                                  AS category_name
      FROM fin_transaction t
      JOIN fin_account a ON a.id = t.account_id
      LEFT JOIN fin_category c ON c.id = t.category_id
     WHERE NOT t.is_split_parent
  `);

  await pool.end();

  const linhas = [];
  const P = (s = '') => linhas.push(s);

  P('# Validação das categorias: motor de regras × gabarito humano do ClickUp');
  P('');
  P(`Janela de casamento: ±${JANELA_DIAS} dias · lista "${LISTA}" · ledger com ${ledger.length} lançamentos · ${regras.length} regras ativas`);
  P('');

  // -- 0. Leitura ------------------------------------------------------------
  P('## 0. O que foi lido, e o que o gabarito não sustenta');
  P('');
  P(`- Tarefas na lista: **${diagnostico.naLista}** · com \`Categoria\` preenchida: **${tarefas.length}**`);
  P(`- Sem \`Categoria\` (fora do gabarito): ${diagnostico.semCategoria}`);
  P(`- Nomes com mojibake consertados (UTF-8 lido como latin-1): **${diagnostico.mojibake}**`);
  P(`- Sem \`Valor pago\`: ${diagnostico.semValor} · sem \`due_date\`: ${diagnostico.semData} · direção inferida da categoria: ${diagnostico.direcaoInferida}`);
  const comDataPagamento = tarefas.filter((t) => t.dataPagamento).length;
  const dataPagamentoIncoerente = tarefas.filter(
    (t) => t.dataPagamento && t.data && Math.abs(diasEntre(t.dataPagamento, t.data)) > 60
  ).length;
  P(`- Com \`Data do Pagamento\`: **${comDataPagamento}** — e **${dataPagamentoIncoerente}** delas divergem do \`due_date\` em mais de 60 dias (dia/mês trocados na digitação). O campo não é utilizável como data de liquidação.`);
  P('');

  const porCategoria = new Map();
  for (const t of tarefas) {
    const e = porCategoria.get(t.categoria) ?? { n: 0, cents: 0 };
    e.n += 1;
    e.cents += t.valorCents;
    porCategoria.set(t.categoria, e);
  }

  // -- 1. Mapa ---------------------------------------------------------------
  P('## 1. Mapa de taxonomia proposto');
  P('');
  P('| Categoria ClickUp | n | R$ | → código | também aceito | defesa |');
  P('|---|---:|---:|---|---|---|');
  for (const [cat, e] of [...porCategoria].sort((a, b) => b[1].cents - a[1].cents)) {
    const m = MAPA[cat];
    const destino = m?.primario === '3.*' ? '3.xx (família)' : m?.primario ?? '**sem equivalente**';
    const outros = [...(m?.aceitaveis ?? [])].filter((c) => c !== m?.primario).join(', ') || '—';
    P(`| ${cat} | ${e.n} | ${brl(e.cents)} | ${destino} | ${outros} | ${m?.porque ?? '—'} |`);
  }
  P('');
  const semEquiv = tarefas.filter((t) => MAPA[t.categoria]?.semEquivalente);
  P(
    `Sem equivalente no plano de contas: **${semEquiv.length} tarefas, ${brl(semEquiv.reduce((s, t) => s + t.valorCents, 0))}** ` +
      '("Pagamento de Fatura" descreve o meio, não a natureza). Excluídas do denominador de acurácia.'
  );
  P('');

  // -- 2. Casamento ----------------------------------------------------------
  const { casados, censo } = casar(tarefas, ledger);
  const casaveis = tarefas.filter((t) => t.valorCents && t.data);
  const centsCasados = casados.reduce((s, c) => s + c.tarefa.valorCents, 0);
  const centsTotais = tarefas.reduce((s, t) => s + t.valorCents, 0);

  // Um nome do ClickUp é "rico" quando é cópia da linha do extrato — aí o texto
  // pode CONFIRMAR ou DESMENTIR o par. "cabos" e "materiais" não podem nem uma
  // coisa nem outra, e tratar o silêncio deles como confirmação é como se
  // inventa uma taxa de casamento.
  const rico = (t) => t.nomeNorm.split(' ').filter((p) => p.length >= 4).length >= 5;
  const paresRicos = casados.filter((c) => rico(c.tarefa));
  const ricosConfirmados = paresRicos.filter((c) => c.sim >= 0.34);
  const precisaoEstimada = paresRicos.length ? ricosConfirmados.length / paresRicos.length : 0;

  // "Forte" = o texto concorda. Candidato único NÃO basta: 62,7% das tarefas têm
  // candidato único e ainda assim o par pode ser outra transação do mesmo valor
  // fora da janela de quem o gerou. Onde o texto não pode opinar, o par fica
  // marcado como não verificado em vez de virar evidência.
  const fortes = casados.filter((c) => c.sim >= 0.34);
  const naoVerificados = casados.filter((c) => c.sim < 0.34);

  P('## 2. Casamento com o ledger — medido, não suposto');
  P('');
  P(`- Tarefas casáveis (valor + data): **${casaveis.length}** de ${tarefas.length}`);
  P(`- Sem candidato nenhum no ledger (mesmo valor, ±${JANELA_DIAS}d, mesmo sinal): **${censo.zeroCandidatos}** (${pct(censo.zeroCandidatos, casaveis.length)})`);
  P(`- Candidato único: **${censo.umCandidato}** (${pct(censo.umCandidato, casaveis.length)})`);
  P(`- Vários candidatos (ambíguo já por valor+data): **${censo.variosCandidatos}** (${pct(censo.variosCandidatos, casaveis.length)}), ${(censo.candidatosTotal / Math.max(1, casaveis.length)).toFixed(1)} candidatos por tarefa em média`);
  P(`- Pares após atribuição 1:1: **${casados.length}** (${pct(casados.length, casaveis.length)}), ${brl(centsCasados)} de ${brl(centsTotais)}`);
  P('');
  const taquigrafia = casados.filter((c) => !rico(c.tarefa));
  const taquigrafiaChutada = taquigrafia.filter((c) => c.candidatos > 1);
  P('**Quanto desse casamento é confiável.** Só o texto pode auditar o par, e só onde ele existe dos dois lados:');
  P('');
  P(`- Pares em que o nome do ClickUp é cópia da linha do extrato (auditáveis): **${paresRicos.length}**`);
  P(`- Desses, o texto CONFIRMA o par: **${ricosConfirmados.length}** (${pct(ricosConfirmados.length, paresRicos.length)})`);
  P(`- Pares cujo nome é taquigrafia humana ("cabos", "materiais"): **${taquigrafia.length}** — sem texto, indistinguíveis`);
  P(`- Desses, **${taquigrafiaChutada.length}** tinham mais de um candidato: o casador escolheu por proximidade de data, sem nenhum sinal para confirmar`);
  P(`- Pares usados como evidência neste relatório (texto concordando): **${fortes.length}** (${pct(fortes.length, casaveis.length)} das casáveis); descartados por não verificáveis: ${naoVerificados.length}`);
  P('');
  P(
    `A leitura honesta destes números: **onde o texto existe, o casamento por valor+data acerta (${pct(ricosConfirmados.length, paresRicos.length)}) — ` +
      `mas o texto existe em só ${pct(paresRicos.length, casados.length)} dos pares.** Nos outros ${taquigrafia.length} o casador não tem como errar nem acertar de forma ` +
      `verificável, e em ${taquigrafiaChutada.length} deles havia mais de um candidato do mesmo valor. Por isso os ${naoVerificados.length} pares não confirmados ` +
      'são DESCARTADOS em vez de entrarem no numerador.'
  );
  P('');
  P(
    `A correspondência é fraca por construção: \`due_date\` é vencimento planejado, não liquidação; só ${comDataPagamento} tarefas ` +
      `têm \`Data do Pagamento\` e ${dataPagamentoIncoerente} delas estão com dia/mês trocados na digitação. ` +
      '**Por isso o número principal deste relatório não depende do casamento** — ver seção 4.'
  );
  P('');

  // -- 3. Comparação nos casados --------------------------------------------
  P('## 3. Nos pares confirmados: humano × o que o ledger tem gravado hoje');
  P('');
  const cmp = { total: 0, estrito: 0, tolerante: 0, fam: 0, semCat: 0 };
  const divergenciasLedger = [];
  for (const c of fortes) {
    const gab = gabaritoDe(c.tarefa);
    if (!gab || gab.semEquivalente || !gab.informativa) continue;
    cmp.total += 1;
    const code = c.linha.category_code;
    if (!code) {
      cmp.semCat += 1;
      continue;
    }
    const r = confere(gab, code);
    if (r.estrito) cmp.estrito += 1;
    if (r.tolerante) cmp.tolerante += 1;
    if (r.familia) cmp.fam += 1;
    if (!r.tolerante) divergenciasLedger.push({ par: c, gab, code });
  }
  const comCat = cmp.total - cmp.semCat;
  P(`- Pares confirmados com gabarito informativo: **${cmp.total}** · desses, sem categoria no ledger: ${cmp.semCat}`);
  P(`- Onde o ledger tem categoria (${comCat}): concordância estrita **${cmp.estrito}** (${pct(cmp.estrito, comCat)}) · tolerante **${cmp.tolerante}** (${pct(cmp.tolerante, comCat)}) · de família **${cmp.fam}** (${pct(cmp.fam, comCat)})`);
  P('');
  if (divergenciasLedger.length) {
    P('| R$ | tarefa | humano diz | ledger tem gravado | veio de |');
    P('|---:|---|---|---|---|');
    for (const d of divergenciasLedger.sort((a, b) => b.par.tarefa.valorCents - a.par.tarefa.valorCents).slice(0, 20)) {
      const regra = d.par.linha.classified_rule_id ? regraPorId.get(String(d.par.linha.classified_rule_id)) : null;
      P(
        `| ${brl(d.par.tarefa.valorCents)} | ${d.par.tarefa.nome.slice(0, 55)} | ${d.par.tarefa.categoria} | ${d.code} ${nomeDoCodigo.get(d.code) ?? ''} | ${d.par.linha.classified_by}${regra ? ` #${regra.id} ${regra.name}` : ''} |`
      );
    }
    P('');
  }

  // -- 4. Motor contra gabarito ---------------------------------------------
  P('## 4. ACURÁCIA DO MOTOR CONTRA GABARITO');
  P('');
  const idCasado = new Set(casados.map((c) => c.tarefa.id));
  const resultados = [];
  for (const t of tarefas) {
    const gab = gabaritoDe(t);
    if (!gab) continue;
    const sujeito = sujeitoDeTarefa(t);
    const hit = classify(regras, sujeito, { collectCompetitors: true });
    const code = hit?.actions?.category_code ?? null;
    resultados.push({
      tarefa: t,
      gab,
      code,
      regraId: hit?.rule?.id ?? null,
      regraNome: hit?.rule?.name ?? null,
      campoQueCasou: hit?.rationale?.campo ?? null,
      trecho: hit?.rationale?.trecho ?? null,
      casouLedger: idCasado.has(t.id),
      ...confere(gab, code)
    });
  }

  // Universo justo: fora as categorias sem equivalente, fora as lixeiras (que
  // não afirmam nada) e fora o que só `source_kind` decidiria — três exclusões
  // declaradas, cada uma com o tamanho ao lado, para ninguém ter de acreditar.
  const foraSemEquivalente = resultados.filter((r) => r.gab.semEquivalente);
  const foraLixeira = resultados.filter((r) => !r.gab.semEquivalente && !r.gab.informativa);
  const foraSourceKind = resultados.filter(
    (r) => !r.gab.semEquivalente && r.gab.informativa && ['Reserva de caixa', 'Caixa Impostos'].includes(r.tarefa.categoria)
  );
  const universo = resultados.filter(
    (r) => !r.gab.semEquivalente && r.gab.informativa && !['Reserva de caixa', 'Caixa Impostos'].includes(r.tarefa.categoria)
  );

  const classificadas = universo.filter((r) => r.code);
  const mudas = universo.filter((r) => !r.code);
  const acEstrito = classificadas.filter((r) => r.estrito).length;
  const acTolerante = classificadas.filter((r) => r.tolerante).length;
  const acFamilia = classificadas.filter((r) => r.familia).length;

  P(`Amostra: **${universo.length} tarefas** classificadas por humano (${brl(universo.reduce((s, r) => s + r.tarefa.valorCents, 0))}).`);
  P(
    `Excluídas e contadas: ${foraSemEquivalente.length} sem equivalente no plano de contas · ` +
      `${foraLixeira.length} em categoria-lixeira dos dois lados · ${foraSourceKind.length} decidíveis só por \`source_kind\` (dado que o ClickUp não tem).`
  );
  P('');
  P(`- **O motor não classifica ${mudas.length} das ${universo.length} (${pct(mudas.length, universo.length)})** — nenhuma regra casa, ${brl(mudas.reduce((s, r) => s + r.tarefa.valorCents, 0))}.`);
  P(`- Onde o motor opina (${classificadas.length} tarefas, ${brl(classificadas.reduce((s, r) => s + r.tarefa.valorCents, 0))}):`);
  P(`  - acerto **estrito** (código exato): **${acEstrito}/${classificadas.length} = ${pct(acEstrito, classificadas.length)}**`);
  P(`  - acerto **tolerante** (código aceitável): **${acTolerante}/${classificadas.length} = ${pct(acTolerante, classificadas.length)}**`);
  P(`  - acerto de **família econômica** (4.xx/5.xx/6.xx/7.xx — o que move o Throughput): **${acFamilia}/${classificadas.length} = ${pct(acFamilia, classificadas.length)}**`);
  P(`- Cobertura × acerto sobre o universo inteiro: **${acTolerante}/${universo.length} = ${pct(acTolerante, universo.length)}** de tarefas com categoria aceitável.`);
  P('');

  const naoCasadas = universo.filter((r) => !r.casouLedger && r.code);
  const simCasadas = universo.filter((r) => r.casouLedger && r.code);
  P('Quebra por casamento com o ledger (para mostrar que o número não depende dele):');
  P('');
  P('| grupo | n com opinião do motor | estrito | tolerante | família |');
  P('|---|---:|---:|---:|---:|');
  for (const [rot, grupo] of [
    ['casaram com o ledger', simCasadas],
    ['NÃO casaram', naoCasadas]
  ]) {
    P(
      `| ${rot} | ${grupo.length} | ${pct(grupo.filter((r) => r.estrito).length, grupo.length)} | ${pct(grupo.filter((r) => r.tolerante).length, grupo.length)} | ${pct(grupo.filter((r) => r.familia).length, grupo.length)} |`
    );
  }
  P('');

  // -- 4b. O motor contra o texto REAL do extrato ---------------------------
  // O número acima mede o motor contra a TAQUIGRAFIA de quem digitou no
  // ClickUp ("cabos", "materiais Mafema"). É a medida certa da pergunta "o
  // motor daria conta desse texto?", e a resposta é não. Mas não é a medida do
  // motor em produção, onde o texto é a linha inteira do extrato.
  //
  // Nos pares confirmados por texto há as duas coisas ao mesmo tempo: o
  // veredito humano e a descrição real do banco. Reclassificar a linha do
  // extrato AGORA, com as 48 regras de hoje, e comparar com o gabarito é o
  // teste mais próximo de produção que este dado permite.
  const gabaritoNoExtrato = [];
  for (const c of fortes) {
    const gab = gabaritoDe(c.tarefa);
    if (!gab || gab.semEquivalente || !gab.informativa) continue;
    const hit = classify(regras, sujeitoDeLinha(c.linha), { collectCompetitors: true });
    const code = hit?.actions?.category_code ?? null;
    gabaritoNoExtrato.push({
      tarefa: c.tarefa,
      linha: c.linha,
      gab,
      code,
      regraId: hit?.rule?.id ?? null,
      campoQueCasou: hit?.rationale?.campo ?? null,
      trecho: hit?.rationale?.trecho ?? null,
      ...confere(gab, code)
    });
  }
  const extOpina = gabaritoNoExtrato.filter((r) => r.code);
  const extMudo = gabaritoNoExtrato.filter((r) => !r.code);
  P('### 4b. O mesmo motor, contra o texto REAL do extrato');
  P('');
  P(
    'A medida acima usa a taquigrafia do ClickUp ("cabos", "materiais Mafema"). Em produção o motor lê a ' +
      'linha inteira do banco. Nos pares confirmados por texto existem as duas coisas — veredito humano e ' +
      'descrição real —, então dá para RECLASSIFICAR a linha do extrato com as 48 regras de hoje e comparar.'
  );
  P('');
  P(`- Amostra: **${gabaritoNoExtrato.length} pares confirmados** (${brl(gabaritoNoExtrato.reduce((s, r) => s + r.tarefa.valorCents, 0))})`);
  P(`- Motor mudo sobre o texto do extrato: **${extMudo.length}** (${pct(extMudo.length, gabaritoNoExtrato.length)}) — contra ${pct(mudas.length, universo.length)} sobre o texto do ClickUp`);
  P(`- Onde opina (${extOpina.length}): estrito **${pct(extOpina.filter((r) => r.estrito).length, extOpina.length)}** · tolerante **${pct(extOpina.filter((r) => r.tolerante).length, extOpina.length)}** · família **${pct(extOpina.filter((r) => r.familia).length, extOpina.length)}**`);
  P(`- Sobre a amostra inteira: **${extOpina.filter((r) => r.tolerante).length}/${gabaritoNoExtrato.length} = ${pct(extOpina.filter((r) => r.tolerante).length, gabaritoNoExtrato.length)}** com categoria aceitável.`);
  P('');

  P('Acurácia por categoria humana (sobre o texto do ClickUp):');
  P('');
  P('| categoria humana | n | motor mudo | com opinião | tolerante | R$ classificado errado |');
  P('|---|---:|---:|---:|---:|---:|');
  const grupos = new Map();
  for (const r of universo) {
    if (!grupos.has(r.tarefa.categoria)) grupos.set(r.tarefa.categoria, []);
    grupos.get(r.tarefa.categoria).push(r);
  }
  for (const [cat, rs] of [...grupos].sort((a, b) => b[1].reduce((s, r) => s + r.tarefa.valorCents, 0) - a[1].reduce((s, r) => s + r.tarefa.valorCents, 0))) {
    const op = rs.filter((r) => r.code);
    const err = op.filter((r) => !r.tolerante);
    P(
      `| ${cat} | ${rs.length} | ${rs.length - op.length} | ${op.length} | ${pct(op.filter((r) => r.tolerante).length, op.length)} | ${brl(err.reduce((s, r) => s + r.tarefa.valorCents, 0))} |`
    );
  }
  P('');

  // -- 5. Regras que erram ---------------------------------------------------
  P('## 5. REGRAS QUE ERRAM, POR R$');
  P('');

  // Divergência decidida por `source_kind` NÃO é regra errando. A fonte carimbou
  // "APLICACAO_RDB" e o motor leu o carimbo; quando o humano escreveu "Impostos
  // e taxas" numa aplicação de RDB, ele estava anotando a INTENÇÃO do dinheiro
  // ("essa reserva é para pagar imposto"), que é outro eixo. Somar isso aos
  // erros de regra esconderia os erros de verdade atrás de R$ 18 mil de ruído.
  const estruturais = [...extOpina, ...classificadas].filter((r) => r.campoQueCasou === 'source_kind' && !r.tolerante);
  const textuaisExtrato = extOpina.filter((r) => r.campoQueCasou !== 'source_kind');
  const textuaisClickUp = classificadas.filter((r) => r.campoQueCasou !== 'source_kind');

  /** Agrupa um conjunto de julgamentos por regra, e dentro dela por AGULHA. */
  function porRegraDe(julgamentos) {
    const mapa = new Map();
    for (const r of julgamentos) {
      if (!r.code) continue;
      const k = String(r.regraId);
      if (!mapa.has(k)) mapa.set(k, { certo: 0, errado: 0, centsErrado: 0, centsCerto: 0, destinos: new Map(), agulhas: new Map() });
      const e = mapa.get(k);
      if (r.tolerante) {
        e.certo += 1;
        e.centsCerto += r.tarefa.valorCents;
      } else {
        e.errado += 1;
        e.centsErrado += r.tarefa.valorCents;
        e.destinos.set(r.tarefa.categoria, (e.destinos.get(r.tarefa.categoria) ?? 0) + r.tarefa.valorCents);
        const ag = r.trecho ?? '(sem trecho)';
        const a = e.agulhas.get(ag) ?? { n: 0, cents: 0, defeito: defeitoMecanico(r) };
        a.n += 1;
        a.cents += r.tarefa.valorCents;
        e.agulhas.set(ag, a);
      }
    }
    return mapa;
  }

  function tabelaDeRegras(mapa, titulo) {
    P(`**${titulo}**`);
    P('');
    P('| regra | prio | manda para | acertos | erros | R$ errado | o gabarito diz que era |');
    P('|---|---:|---|---:|---:|---:|---|');
    for (const [id, e] of [...mapa].sort((a, b) => b[1].centsErrado - a[1].centsErrado)) {
      if (!e.errado) continue;
      const reg = regraPorId.get(id);
      const destinos = [...e.destinos]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([c, v]) => `${c} (${brl(v)})`)
        .join('; ');
      P(`| #${id} ${reg?.name ?? '?'} | ${reg?.priority ?? '?'} | ${reg?.actions?.category_code ?? '?'} | ${e.certo} | ${e.errado} | **${brl(e.centsErrado)}** | ${destinos} |`);
    }
    P('');
  }

  const regraNoClickUp = porRegraDe(textuaisClickUp);
  const regraNoExtrato = porRegraDe(textuaisExtrato);
  tabelaDeRegras(regraNoExtrato, 'A. Rodando sobre o texto REAL do extrato (o que acontece em produção)');
  tabelaDeRegras(regraNoClickUp, 'B. Rodando sobre o texto do ClickUp (mesma tabela, outra fonte de texto)');

  if (estruturais.length) {
    const porEstrutural = new Map();
    for (const r of estruturais) {
      const k = `#${r.regraId} ${regraPorId.get(String(r.regraId))?.name ?? ''} (${r.trecho})`;
      const e = porEstrutural.get(k) ?? { n: 0, cents: 0, cats: new Set() };
      e.n += 1;
      e.cents += r.tarefa.valorCents;
      e.cats.add(r.tarefa.categoria);
      porEstrutural.set(k, e);
    }
    P('**C. Fora das duas tabelas: divergências decididas por `source_kind` — não são regra errando**');
    P('');
    P('| regra (carimbo da fonte) | n | R$ | o humano escreveu |');
    P('|---|---:|---:|---|');
    for (const [k, e] of [...porEstrutural].sort((a, b) => b[1].cents - a[1].cents)) {
      P(`| ${k} | ${e.n} | ${brl(e.cents)} | ${[...e.cats].join('; ')} |`);
    }
    P('');
    P(
      'Aqui o motor está certo e o humano também, sobre eixos diferentes: a fonte diz o que a transação É ' +
        '(aplicação de RDB), o humano anotou PARA QUE ela existe (reserva de imposto). O plano de contas só ' +
        'tem o primeiro eixo. Isso é decisão de modelagem, não conserto de regra — volta na seção 6.'
    );
    P('');
  }

  const regrasCertas = [...regraNoExtrato].filter(([, e]) => e.certo && !e.errado);
  if (regrasCertas.length) {
    P(
      'Regras que o gabarito CONFIRMA no texto do extrato (nenhum erro): ' +
        regrasCertas
          .sort((a, b) => b[1].centsCerto - a[1].centsCerto)
          .map(([id, e]) => `#${id} ${regraPorId.get(id)?.name} (${e.certo} acertos, ${brl(e.centsCerto)})`)
          .join(' · ')
    );
    P('');
  }

  // -- 5b. Defeito de agulha, com exposição no ledger inteiro ---------------
  P('### 5b. Qual AGULHA erra, e quanto ela pega no ledger inteiro');
  P('');
  P(
    'Regra não erra inteira: erra numa agulha. Esta tabela desce ao trecho que casou, marca os defeitos ' +
      'mecânicos (que não dependem de opinião contábil) e mede a exposição de cada um no ledger de produção — ' +
      'não só na amostra do gabarito.'
  );
  P('');
  const agulhasRuins = [];
  for (const [id, e] of regraNoExtrato) {
    for (const [ag, a] of e.agulhas) agulhasRuins.push({ regraId: id, agulha: ag, ...a, fonte: 'extrato' });
  }
  for (const [id, e] of regraNoClickUp) {
    for (const [ag, a] of e.agulhas) {
      if (!agulhasRuins.some((x) => x.regraId === id && x.agulha === ag)) agulhasRuins.push({ regraId: id, agulha: ag, ...a, fonte: 'clickup' });
    }
  }

  /**
   * Exposição de uma agulha no ledger de produção — em duas colunas distintas,
   * porque somá-las seria a mentira mais fácil deste relatório.
   *
   *   `pega`     — todo lançamento em que a agulha casa. Inclui os acertos:
   *                "posto " pega "POSTO CURADAO", que é combustível de verdade.
   *   `defeito`  — só os lançamentos em que o defeito MECÂNICO se manifesta.
   *                É o número acionável, e é sempre menor.
   */
  function exposicaoNoLedger(agulha, defeito) {
    if (agulha === '(sem trecho)') return null;
    // Agulha de `source_kind` não vive na descrição: é o carimbo da fonte.
    const ehSourceKind = /^[A-Z_]+$/.test(agulha);
    const pega = ehSourceKind ? ledger.filter((l) => l.source_kind === agulha) : ledger.filter((l) => l.description_norm.includes(agulha));

    let comDefeito = [];
    if (defeito?.startsWith('agulha "posto "')) {
      comDefeito = pega.filter((l) => l.description_norm.includes('imposto'));
    } else if (defeito?.includes('fatia do favorecido')) {
      comDefeito = pega.filter((l) => {
        const fav = fatiaDoFavorecido(l.description_norm);
        return fav !== null && !fav.includes(agulha);
      });
    } else if (defeito?.includes('MEIO de outra palavra')) {
      comDefeito = pega.filter((l) => !new RegExp(`(^|\\s)${agulha.trim()}(\\s|$)`).test(l.description_norm));
    }
    const soma = (xs) => xs.reduce((s, l) => s + Math.abs(Number(l.amount_cents)), 0);
    return { pega: pega.length, pegaCents: soma(pega), defeito: comDefeito.length, defeitoCents: soma(comDefeito) };
  }

  P('| regra | agulha que casou | erros na amostra | R$ na amostra | defeito mecânico | pega no ledger | com o defeito, no ledger |');
  P('|---|---|---:|---:|---|---:|---:|');
  for (const a of agulhasRuins.sort((x, y) => y.cents - x.cents).slice(0, 22)) {
    const exp = exposicaoNoLedger(a.agulha, a.defeito);
    const colDefeito = exp && a.defeito ? `**${exp.defeito}** (${brl(exp.defeitoCents)})` : '—';
    P(
      `| #${a.regraId} ${regraPorId.get(a.regraId)?.name ?? ''} | \`${a.agulha}\` | ${a.n} | ${brl(a.cents)} | ${a.defeito ?? '—'} | ${exp ? `${exp.pega} (${brl(exp.pegaCents)})` : '—'} | ${colDefeito} |`
    );
  }
  P('');

  // -- 5d. Cobertura bruta, sem prioridade ----------------------------------
  // `classify` só devolve a VENCEDORA. Uma regra pode estar certa e nunca
  // aparecer porque outra, de prioridade menor, come o texto antes — e nesse
  // caso consertar a regra que aparece não resolve nada. Aqui cada regra é
  // avaliada isolada, contra o mesmo sujeito, via `evaluateConditions`.
  //
  // NOTA: o retorno é `{ok,...}` e o teste é `.ok === true`, dentro de
  // `casaRegra`. Sem isso todas as 48 regras "casariam" com todas as 234 linhas.
  P('### 5c. Cobertura bruta de cada regra, ignorando a prioridade');
  P('');
  P(
    'Uma regra pode estar certa e nunca ser vista, porque outra de prioridade menor come o texto antes. ' +
      'Esta tabela avalia cada regra ISOLADA contra os mesmos pares confirmados, para separar "a regra erra" ' +
      'de "a regra não tem chance".'
  );
  P('');
  const cobertura = [];
  for (const regra of regras) {
    if (regra.match_scope === 'document') continue;
    let casa = 0;
    let concorda = 0;
    let cents = 0;
    for (const c of fortes) {
      const gab = gabaritoDe(c.tarefa);
      if (!gab || gab.semEquivalente || !gab.informativa) continue;
      if (!casaRegra(regra, sujeitoDeLinha(c.linha))) continue;
      casa += 1;
      cents += c.tarefa.valorCents;
      if (confere(gab, regra.actions?.category_code).tolerante) concorda += 1;
    }
    if (casa) cobertura.push({ regra, casa, concorda, cents });
  }
  P('| regra | prio | manda para | casaria em | concorda com o humano | R$ alcançado | quem ganha hoje |');
  P('|---|---:|---|---:|---:|---:|---|');
  for (const c of cobertura.sort((a, b) => b.casa - a.casa).slice(0, 14)) {
    const vencedoras = new Map();
    for (const r of gabaritoNoExtrato) {
      if (!casaRegra(c.regra, sujeitoDeLinha(r.linha))) continue;
      if (String(r.regraId) !== String(c.regra.id)) vencedoras.set(String(r.regraId), (vencedoras.get(String(r.regraId)) ?? 0) + 1);
    }
    const perdePara = [...vencedoras].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([id, n]) => `#${id}×${n}`).join(', ') || 'ela mesma';
    P(
      `| #${c.regra.id} ${c.regra.name} | ${c.regra.priority} | ${c.regra.actions?.category_code ?? '?'} | ${c.casa} | ${c.concorda} (${pct(c.concorda, c.casa)}) | ${brl(c.cents)} | ${perdePara} |`
    );
  }
  P('');

  // Diagnóstico dirigido da regra 42, que é a hipótese que motivou a medição.
  const r42clickup = resultados.filter((r) => String(r.regraId) === '42');
  const r42extrato = gabaritoNoExtrato.filter((r) => String(r.regraId) === '42');
  const r42err = r42extrato.filter((r) => !r.tolerante);
  const r42noLedger = ledger.filter((l) => String(l.classified_rule_id) === '42');
  P('### 5d. Regra 42 (`PIX para pessoa física`) sob o gabarito');
  P('');
  P(
    `No ledger de produção a regra 42 carimba **${r42noLedger.length} lançamentos, ${brl(r42noLedger.reduce((s, l) => s + Math.abs(Number(l.amount_cents)), 0))}** ` +
      'como "6.01 Salários".'
  );
  P('');
  P(
    `Sobre o texto do EXTRATO nos pares confirmados, ela casou **${r42extrato.length}** lançamentos ` +
      `(${brl(r42extrato.reduce((s, r) => s + r.tarefa.valorCents, 0))}) e **${r42err.length} estão errados** segundo o humano ` +
      `(${brl(r42err.reduce((s, r) => s + r.tarefa.valorCents, 0))}): precisão medida **${pct(r42extrato.length - r42err.length, r42extrato.length)}**. ` +
      `Sobre o texto do ClickUp casou ${r42clickup.length} vezes, ${r42clickup.filter((r) => !r.tolerante).length} erradas.`
  );
  P('');
  P(
    `É a maior amostra auditada de qualquer regra deste relatório, e o veredito é o mais duro: **${pct(r42err.length, r42extrato.length)} de erro**. ` +
      'A regra 42 não classifica — ela adivinha, e a adivinhação é sempre "Salários". O gabarito mostra que ' +
      'atrás de "Pix enviado" há comissão, terceirizado, combustível, material e almoço, em proporções que ' +
      'não têm nada a ver com folha.'
  );
  P('');
  if (r42err.length) {
    const dest = new Map();
    for (const r of r42err) {
      const e = dest.get(r.tarefa.categoria) ?? { n: 0, cents: 0 };
      e.n += 1;
      e.cents += r.tarefa.valorCents;
      dest.set(r.tarefa.categoria, e);
    }
    P('| o humano diz que era | n | R$ |');
    P('|---|---:|---:|');
    for (const [c, e] of [...dest].sort((a, b) => b[1].cents - a[1].cents)) P(`| ${c} | ${e.n} | ${brl(e.cents)} |`);
    P('');
  }

  // -- 6. Decisão humana -----------------------------------------------------
  P('## 6. O QUE PRECISA DE DECISÃO HUMANA');
  P('');
  // A pendência vale sobre o texto do extrato (produção) unida ao que só o
  // texto do ClickUp expôs — as duas fontes acham defeitos diferentes, e
  // descartar uma delas é descartar erro de verdade.
  const pendentes = [...extOpina, ...classificadas]
    .filter((r) => !r.tolerante)
    .map((r) => ({ ...r, ver: veredito(r) }));
  const vistos = new Set();
  const pendentesUnicos = pendentes
    .filter((p) => {
      const k = `${p.tarefa.id}|${p.code}`;
      if (vistos.has(k)) return false;
      vistos.add(k);
      return true;
    })
    .sort((a, b) => b.tarefa.valorCents - a.tarefa.valorCents);
  const porQuem = { motor: [], humano: [], indefinido: [] };
  for (const p of pendentesUnicos) porQuem[p.ver.quem].push(p);
  P(
    `Divergências distintas: **${pendentesUnicos.length}** (${brl(pendentesUnicos.reduce((s, p) => s + p.tarefa.valorCents, 0))}). ` +
      `Motor parece certo em ${porQuem.motor.length} (${brl(porQuem.motor.reduce((s, p) => s + p.tarefa.valorCents, 0))}); ` +
      `humano parece certo em ${porQuem.humano.length} (${brl(porQuem.humano.reduce((s, p) => s + p.tarefa.valorCents, 0))}); ` +
      `sem critério objetivo: **${porQuem.indefinido.length}** (${brl(porQuem.indefinido.reduce((s, p) => s + p.tarefa.valorCents, 0))}).`
  );
  P('');
  P('As 25 maiores divergências, por R$:');
  P('');
  P('| R$ | tarefa | humano | motor | regra (agulha) | quem parece certo |');
  P('|---:|---|---|---|---|---|');
  for (const p of pendentesUnicos.slice(0, 25)) {
    P(
      `| ${brl(p.tarefa.valorCents)} | ${p.tarefa.nome.slice(0, 50)} | ${p.tarefa.categoria} → ${p.gab.primario} | ${p.code} ${nomeDoCodigo.get(p.code) ?? ''} | #${p.regraId} \`${p.trecho ?? ''}\` | **${p.ver.quem}** — ${p.ver.porque} |`
    );
  }
  P('');
  P('Perguntas que o gabarito levanta e nenhuma medição pode responder — são decisões, não cálculos:');
  P('');
  P(
    `1. **Intenção × natureza.** ${estruturais.length} tarefas (${brl(estruturais.reduce((s, r) => s + r.tarefa.valorCents, 0))}) são "Aplicação RDB" que o humano marcou como ` +
      '"Impostos e taxas" ou "Reserva de caixa". A fonte diz o que a transação É; o humano anotou PARA QUE ela serve. ' +
      'O plano de contas só tem o primeiro eixo. Criar o segundo (caixinha/finalidade) ou aceitar que essa informação se perde?'
  );
  P(
    `2. **Dinheiro vindo da XP ENERGY.** O motor chama de 9.01 (transferência entre contas próprias, neutra) e o humano ` +
      'chama de "Receita Projeto". Se a XP Energy é outra empresa do grupo que repassa o que o cliente pagou, o motor ' +
      'está zerando receita real; se é a mesma caixa, o humano está inflando faturamento. Ninguém além do sócio decide isso.'
  );
  P(
    `3. **"Ferramentas e equipamentos"** (${porCategoria.get('Ferramentas e equipamentos')?.n ?? 0} tarefas, ${brl(porCategoria.get('Ferramentas e equipamentos')?.cents ?? 0)}): consumo (4.02/5.07) ` +
      'ou imobilizado (8.01)? O plano de contas não tem limiar de valor, e a média destas tarefas é R$ 454.'
  );
  P(
    `4. **"Pagamento de Fatura"** (${porCategoria.get('Pagamento de Fatura')?.n ?? 0} tarefas, ${brl(porCategoria.get('Pagamento de Fatura')?.cents ?? 0)}): descreve o MEIO, não a natureza. ` +
      'Aposentar a opção no ClickUp ou aceitar que esses R$ ficam sem classificação econômica?'
  );
  P(
    `5. **"Receita Projeto"** (${porCategoria.get('Receita Projeto')?.n ?? 0} tarefas, ${brl(porCategoria.get('Receita Projeto')?.cents ?? 0)}): o ClickUp sabe o PROJETO, não o SERVIÇO. ` +
      'O plano de contas tem 14 linhas de receita e o Throughput por núcleo depende delas. O campo `Projetos` ' +
      '(relacionamento, 728 preenchidos) traz o nome do empreendimento — é a maior fonte de sinal não explorada deste dado.'
  );
  P(
    '6. **Transporte ligado a Projeto é 4.04 (custo totalmente variável) ou 5.06 (despesa operacional)?** ' +
      'A resposta muda o Throughput direto. O motor hoje responde 5.06 porque não enxerga o Projeto; o humano ' +
      'responde "Transporte e deslocamento" olhando para a obra.'
  );
  P('');

  const texto = linhas.join('\n');
  if (SAIDA_JSON) {
    process.stdout.write(
      `${JSON.stringify(
        {
          janela: JANELA_DIAS,
          diagnostico,
          casamento: {
            ...censo,
            casados: casados.length,
            fortes: fortes.length,
            casaveis: casaveis.length,
            paresAuditaveis: paresRicos.length,
            paresConfirmados: ricosConfirmados.length,
            precisaoEstimada: Number(precisaoEstimada.toFixed(3))
          },
          acuraciaTextoClickUp: {
            universo: universo.length,
            mudas: mudas.length,
            comOpiniao: classificadas.length,
            estrito: acEstrito,
            tolerante: acTolerante,
            familia: acFamilia
          },
          acuraciaTextoExtrato: {
            amostra: gabaritoNoExtrato.length,
            mudas: extMudo.length,
            comOpiniao: extOpina.length,
            estrito: extOpina.filter((r) => r.estrito).length,
            tolerante: extOpina.filter((r) => r.tolerante).length,
            familia: extOpina.filter((r) => r.familia).length
          },
          regrasNoExtrato: [...regraNoExtrato].map(([id, e]) => ({ id, certo: e.certo, errado: e.errado, centsErrado: e.centsErrado })),
          regrasNoClickUp: [...regraNoClickUp].map(([id, e]) => ({ id, certo: e.certo, errado: e.errado, centsErrado: e.centsErrado }))
        },
        null,
        2
      )}\n`
    );
  } else {
    process.stdout.write(`${texto}\n`);
  }

  if (DETALHE) {
    process.stderr.write('\n--- TODAS AS DIVERGÊNCIAS ---\n');
    for (const p of pendentes) {
      process.stderr.write(
        `${brl(p.tarefa.valorCents).padStart(14)}  ${p.tarefa.categoria.padEnd(28)} motor=${p.code} regra=#${p.regraId}  "${p.tarefa.nome.slice(0, 80)}"\n`
      );
    }
    process.stderr.write('\n--- TAREFAS QUE O MOTOR NÃO CLASSIFICOU (top 40 por R$) ---\n');
    for (const r of mudas.sort((a, b) => b.tarefa.valorCents - a.tarefa.valorCents).slice(0, 40)) {
      process.stderr.write(`${brl(r.tarefa.valorCents).padStart(14)}  ${r.tarefa.categoria.padEnd(28)} "${r.tarefa.nome.slice(0, 80)}"\n`);
    }
  }
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});

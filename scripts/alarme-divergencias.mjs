// Alarme de divergência entre FONTES INDEPENDENTES.
//
// IRMÃO de scripts/test-integridade.mjs, e a divisão é a mesma que separa um
// exame de sangue de uma segunda opinião:
//
//   · test-integridade.mjs olha para DENTRO do ledger. "As duas pernas de uma
//     transferência somam zero." Se a frase é falsa, o ledger contradiz a si
//     mesmo, e isso é defeito.
//   · este arquivo olha para FORA. "O ClickUp programa R$ 2.500 por mês para
//     Marcelo Felipe; o cadastro diz que ele saiu em 01/08/2026." Nenhuma das
//     duas frases é falsa isoladamente. Cada fonte está coerente consigo mesma.
//     A mentira só existe entre elas.
//
// POR QUE ISTO É O ACHADO MAIS CARO QUE UMA PLATAFORMA DE GESTÃO PRODUZ: um erro
// dentro de uma fonte tem dono — o ledger está errado, conserta o ledger. Um
// desacordo ENTRE fontes não tem dono, e é por isso que sobrevive anos. O
// ClickUp não sabe que a pessoa saiu. O cadastro não sabe que existe pagamento
// programado. A planilha do dono não sabe nem uma coisa nem outra. Cada sistema
// responde com convicção e ninguém tem como estar errado sozinho. Só o
// cruzamento produz a pergunta.
//
// O CASO QUE MOTIVOU O ARQUIVO, encontrado em 10/08/2026:
//
//   data/raw/clickup-tasks.json .......... R$ 2.500 / mês para "Marcelo Felipe
//                                          Dias Lacerda", set/out/nov/dez 2026
//   fin_person (id 99, "Felipe") .......... status 'inativo', end_date 2026-08-01
//   fin_person_compensation ............... 'contratado' R$ 2.500 em 08/2026
//   data/raw/pessoas/aba-1022703245.csv ... "Filipe R$ 2.500,00" (folha atual)
//                                           e "Obras | mei | Felipe | R$ 2.500,00"
//
//   Quatro fontes, uma pessoa, duas respostas opostas. R$ 10.000 programados
//   para depois do desligamento. Ninguém teria notado: nenhuma tela fica
//   vermelha, nenhum total muda, nenhum log reclama.
//
// COMO SE CRUZA DUAS FONTES QUE NÃO COMPARTILHAM CHAVE. Este é o problema
// técnico central do arquivo, e a resposta é diferente para cada par:
//
//   · pessoa ↔ ClickUp: pelo NOME DE CARTÓRIO da contraparte, nunca pelo apelido.
//     "Igor" casaria com dois Igors e com metade das descrições do extrato;
//     "marcelo felipe dias lacerda" casa com uma pessoa só. Nome de contraparte
//     com 2+ tokens contido no texto da tarefa — precisão sobre recall, porque
//     acusar a pessoa errada de receber depois de sair é pior que não acusar.
//   · pessoa ↔ planilha: pelo APELIDO, com o mapa de sinônimos provado em
//     scripts/import-pessoas.mjs. Apelido ambíguo não vira alarme, vira nota.
//   · dinheiro ↔ dinheiro: por VALOR + JANELA DE DATA, casamento guloso e
//     um-para-um. Sem o um-para-um, um único pagamento de R$ 1.000 no ledger
//     "explica" as quatro parcelas de R$ 1.000 do gateway e o alarme cala.
//
// SOBRE O "R$ EM JOGO": ao contrário de test-integridade.mjs, aqui NÃO dá para
// somar dinheiro distinto — as fontes falam de dinheiro que em parte é o mesmo e
// em parte só existe numa delas, e não há id comum para deduplicar. O resumo
// mostra a soma por alarme e nomeia explicitamente as sobreposições conhecidas.
// Dizer "R$ X de divergência total" sem essa ressalva seria reintroduzir, no
// relatório, exatamente o erro que o relatório existe para pegar.
//
//   node scripts/alarme-divergencias.mjs
//   node scripts/alarme-divergencias.mjs --strict   # alarme sem fonte também derruba
//   node scripts/alarme-divergencias.mjs --json     # saída para máquina
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { normalizeDescription, toCents } from './lib/fin-normalize.mjs';
import { registerFinanceTypeParsers } from './lib/fin-types.mjs';
import { rawDir } from './lib/paths.mjs';

loadEnv();
registerFinanceTypeParsers();

const STRICT = process.argv.includes('--strict');
const JSON_OUT = process.argv.includes('--json');

// ---------------------------------------------------------------------------
// LIMIARES — as únicas linhas deste arquivo que são escolha de negócio.
//
// Duas fontes NUNCA batem no centavo, e um alarme que exige isso é um alarme que
// será desligado na primeira semana. Cada limiar abaixo responde a uma pergunta
// específica: "qual é o menor desvio que ainda pode ser explicado pelo DESENHO
// das duas fontes?" — porque acima dele já não é desenho, é fato.
//
// A distinção que governa o bloco inteiro: divergência POR DESENHO (o ClickUp só
// registra obras; o gateway credita no dia seguinte ao pagamento) tolera muito;
// divergência que NÃO DEVERIA EXISTIR (pagamento programado para quem saiu,
// saldo do banco) tolera zero.
// ---------------------------------------------------------------------------
const LIMIARES = {
  // ZERO, sem tolerância. Pagamento programado para quem já saiu não tem versão
  // pequena: R$ 0,01 agendado para um desligado é a mesma falha de processo que
  // R$ 10.000 — a fonte simplesmente não sabe que a pessoa saiu, e o valor de
  // hoje é acidente. É o único limiar deste arquivo que não é sobre dinheiro, é
  // sobre a existência do compromisso.
  compromissoInativoCents: 0,

  // Meses de extrato SEM nenhum pagamento a quem está no cadastro como ativo.
  //
  // 1 mês é ruído garantido: pagamento do dia 30 que caiu no dia 2, MEI que
  // atrasou a nota, férias. 3 meses já deixou passar um fechamento trimestral
  // inteiro. 2 é onde a pergunta "essa pessoa ainda trabalha aqui?" para de ser
  // impertinente. Contado sobre o ÚLTIMO MÊS COM EXTRATO, nunca sobre a data de
  // hoje: senão um ledger desatualizado acusa o time inteiro de ter sido demitido.
  ativoSemPagamentoMeses: 2,

  // Divergência de UM mês entre a planilha do dono e o ledger de custo de gente.
  //
  // R$ 5.000 é aproximadamente o menor salário mensal cheio do quadro. Abaixo
  // disso a diferença cabe numa única transferência que atravessou a virada do
  // mês — a planilha escreve por competência, o extrato por caixa, e as duas
  // estão certas. Acima disso não cabe: falta (ou sobra) pelo menos uma PESSOA
  // inteira de um dos lados, e nenhuma escolha de regime explica isso.
  planilhaMesCents: 500_000,

  // Divergência ACUMULADA no ano. Limiar diferente e mais apertado em espírito:
  // o efeito da virada de mês se cancela ao longo de 8 meses (o que saiu de
  // janeiro entrou em fevereiro). O que sobra no acumulado é estrutural.
  // R$ 20.000 ≈ um mês inteiro do time de Hardware (R$ 14.471) com folga.
  planilhaAnoCents: 2_000_000,

  // Fatia da saída do ledger que o ClickUp consegue explicar.
  //
  // Aqui a divergência é POR DESENHO — o ClickUp cobre obras, o ledger cobre a
  // empresa — e por isso o valor absoluto não é notícia nenhuma. O que é notícia
  // é a fonte MORRER. 50% não é meta de qualidade: é o piso de utilidade. Abaixo
  // de metade, a lista deixa de ser segunda fonte e vira anedota, e continuar
  // consultando anedota é pior do que não ter fonte nenhuma.
  clickupCoberturaPct: 50,

  // Queda de cobertura, em pontos percentuais, do melhor mês dos últimos 6 até o
  // último. 30 p.p. é grande demais para ser sazonalidade de obra: é abandono da
  // ferramenta. O alarme é sobre a TENDÊNCIA, que é a única coisa mensurável
  // numa fonte parcial por desenho.
  clickupQuedaPp: 30,

  // Saída registrada no ClickUp, com data passada, que não tem nenhum lançamento
  // de mesmo valor no ledger em ±3 dias. R$ 10.000 no acumulado, porque abaixo
  // disso a lista é de material miúdo comprado no cartão de alguém e reembolsado
  // depois — real, mas não é onde o dinheiro se perde.
  clickupSemParCents: 1_000_000,

  // Divergência mensal Asaas × ledger, em % da receita do mês.
  //
  // Percentual e não valor fixo porque a causa é temporal e escala com o volume:
  // cobrança confirmada no dia 31 é creditada no dia 1º e troca de mês. Num mês
  // de R$ 250 mil, 2% é um boleto grande atravessando a virada; 3% já não é.
  asaasMesPct: 2,

  // Piso absoluto do alarme acima. Sem ele, agosto pela metade (R$ 21 mil de
  // receita até aqui) dispara por qualquer coisa.
  asaasMesPisoCents: 100_000,

  // Recebimento que o gateway marcou como RECEIVED_IN_CASH — dinheiro que o
  // cliente pagou FORA do Asaas — e que não aparece em nenhuma conta do ledger.
  // ZERO: é receita que existe no gateway e não existe nos livros da empresa.
  // Não é atraso de conciliação, é ausência.
  asaasForaDoCaixaCents: 0,

  // Saldo do banco × soma dos lançamentos da conta.
  //
  // O alvo honesto é R$ 0,00 e o caminho para lá é registrar o saldo de
  // abertura. R$ 100,00 é apenas o piso de ruído (uma tarifa, o arredondamento
  // da última linha do extrato) para que o alarme aponte buraco de importação e
  // não poeira. Esta é a divergência que NÃO deveria existir: o banco é a única
  // fonte que não tem opinião.
  saldoCents: 10_000,

  // Diferença entre o pactuado (fin_person_compensation 'contratado') e o pago
  // (ledger), POR PESSOA e por mês.
  //
  // O pactuado é o "Fixo"; o pago inclui comissão, reembolso e adiantamento —
  // divergir é o normal. R$ 1.000 é a ordem de grandeza do menor contrato do
  // quadro (Leon, R$ 900): abaixo disso a diferença é um reembolso de
  // combustível; acima, ou a pessoa teve aumento que ninguém escreveu, ou
  // comissão está saindo com cara de salário.
  pactuadoPessoaCents: 100_000,

  // O mesmo, no total do mês. R$ 5.000 ≈ uma pessoa inteira: é o ponto em que o
  // "custo de gente" pactuado deixa de servir para prever caixa.
  pactuadoTotalCents: 500_000
};

// ---------------------------------------------------------------------------
const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = (n) => `${Number(n || 0).toFixed(1).replace('.', ',')}%`;
const num = (n) => Number(n || 0).toLocaleString('pt-BR');
const soma = (arr, f = (x) => x) => arr.reduce((s, x) => s + Number(f(x) || 0), 0);

const pool = financePool();
const q = async (sql, params = []) => (await pool.query(sql, params)).rows;
const um = async (sql, params = []) => (await q(sql, params))[0] ?? {};

/**
 * As guardas de saída do ledger, copiadas de lib/financeiro/pessoas.ts.
 *
 * Copiar é ruim e é a escolha certa aqui: o `.ts` é `server-only` e importá-lo
 * de um script Node arrastaria metade do Next. A cópia carrega o motivo escrito
 * para que a próxima divergência entre os dois lados seja percebida ao ler:
 *
 *   · transfer_status='nao' — transferência entre contas próprias não é custo;
 *   · NOT is_split_parent   — senão o rateio conta duas vezes;
 *   · fatura de cartão fora — "Pagamento Fatura - FERNANDO DE SIQUEIRA CAMPOS
 *     SILVA" é o cartão CORPORATIVO no nome do sócio. Contar como custo dele
 *     somaria ~R$ 5.238/mês fictícios ao pró-labore e faria a pessoa mais cara
 *     da empresa ser a errada.
 */
const GUARDAS_SAIDA = `
      t.amount_cents < 0
  AND t.transfer_status = 'nao'
  AND NOT t.is_split_parent
  AND t.description_norm NOT LIKE '%pagamento fatura%'
  AND t.description_norm NOT LIKE '%pagamento de fatura%'
  AND t.description_norm NOT LIKE '%fatura cartao%'
`;

/**
 * Mesma execução concorrente de test-integridade.mjs, e pelo mesmo motivo: cada
 * consulta custa ~170 ms de latência, e um verificador que demora 10 s no boot é
 * um verificador que alguém desliga.
 */
async function comLimite(itens, limite, fn) {
  const fila = [...itens.entries()];
  const trabalhadores = Array.from({ length: Math.min(limite, fila.length) }, async () => {
    for (;;) {
      const proximo = fila.shift();
      if (!proximo) return;
      await fn(proximo[1], proximo[0]);
    }
  });
  await Promise.all(trabalhadores);
}

// ===========================================================================
// LEITURA DAS FONTES EXTERNAS
//
// Tudo aqui é ARQUIVO, não banco. É essa a diferença que faz o alarme valer:
// se as duas pontas viessem do mesmo SELECT, concordar não provaria nada.
// ===========================================================================

/** Parser CSV mínimo com aspas — as células vêm como "R$ 1.234,56". */
function parseCsv(texto) {
  const linhas = [];
  let campo = '';
  let linha = [];
  let aspas = false;
  for (let i = 0; i < texto.length; i += 1) {
    const c = texto[i];
    if (aspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i += 1; } else aspas = false;
      } else campo += c;
      continue;
    }
    if (c === '"') { aspas = true; continue; }
    if (c === ',') { linha.push(campo); campo = ''; continue; }
    if (c === '\n') { linha.push(campo); linhas.push(linha); linha = []; campo = ''; continue; }
    if (c === '\r') continue;
    campo += c;
  }
  linha.push(campo);
  linhas.push(linha);
  return linhas;
}

/**
 * Dinheiro da planilha em centavos. `null` (e não 0) para célula vazia,
 * " R$  -   " e "#REF!" — 0 é "combinado que não paga", null é "esta célula não
 * diz nada", e confundir os dois apagaria a diferença entre o Kalebe (fixo em
 * branco) e alguém que realmente zerou.
 */
function dinheiro(valor) {
  const cru = String(valor ?? '').trim();
  if (!cru) return null;
  if (/^#(REF|VALUE|N\/A|DIV)/i.test(cru)) return null;
  if (!/\d/.test(cru)) return null;
  try { return toCents(cru); } catch { return null; }
}

const MESES_PT = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const chaveMes = (nome) => {
  const i = MESES_PT.indexOf(String(nome).trim().toLowerCase());
  return i === -1 ? null : `2026-${String(i + 1).padStart(2, '0')}`;
};

const dirPessoas = path.join(rawDir, 'pessoas');

/**
 * A planilha do dono ("Comissionamento - XPE 2026").
 *
 * Três recortes que a planilha guarda em abas diferentes e que respondem a
 * perguntas diferentes:
 *   · totalMes  — a linha 8 da aba principal: o custo de gente que o dono
 *     acredita ter tido em cada mês. É o número que ele diz em voz alta.
 *   · projecao  — "Custo bruto folha" com as colunas atual/Fev/Julho/Dez: o
 *     ORÇAMENTO. É aqui que uma pessoa desligada continua tendo dezembro.
 *   · contrato  — "Via de Pagamento": o Fixo pactuado por pessoa.
 */
function lerPlanilha() {
  const arq = (n) => path.join(dirPessoas, n);
  if (!existsSync(arq('planilha.csv')) || !existsSync(arq('aba-1022703245.csv'))) return null;

  const principal = parseCsv(readFileSync(arq('planilha.csv'), 'utf8'));
  const totalMes = {};
  const cabecalho = principal[1] ?? [];
  const totais = principal[7] ?? [];
  for (let c = 3; c <= 14; c += 1) {
    const mes = chaveMes(cabecalho[c]);
    if (mes) totalMes[mes] = dinheiro(totais[c]);
  }

  // O roster da aba principal (linhas 12+): vínculo na coluna E, apelido na F.
  // Só serve para responder "a planilha CONHECE esta pessoa?" — o valor dela
  // vive nas abas de time, não aqui.
  const roster = [];
  principal.forEach((l, i) => {
    const vinculo = String(l[4] ?? '').trim();
    const nome = String(l[5] ?? '').trim();
    if (!vinculo || !nome || /falta pagar|total/i.test(nome)) return;
    if (!/^(s[óo]cio|s[óo]cio adm|mei|clt|pj|est[áa]gio|irregular)$/i.test(vinculo)) return;
    roster.push({ linha: i + 1, apelido: nome, vinculo, valorCents: dinheiro(l[6]) });
  });

  const proj = parseCsv(readFileSync(arq('aba-1022703245.csv'), 'utf8'));
  const projecao = [];
  const contrato = [];
  proj.forEach((l, i) => {
    const nome = String(l[2] ?? '').trim();
    if (nome && !/^(custo bruto folha|total)$/i.test(nome) && dinheiro(l[3]) !== null) {
      projecao.push({
        linha: i + 1,
        apelido: nome,
        colunas: { atual: dinheiro(l[3]), fev: dinheiro(l[4]), julho: dinheiro(l[5]), dez: dinheiro(l[6]) }
      });
    }
    const via = String(l[1] ?? '').trim();
    const membro = String(l[3] ?? '').trim();
    if (!via || !membro || /^total$/i.test(membro) || /^via de pagamento$/i.test(via)) return;
    contrato.push({
      linha: i + 1,
      apelido: membro,
      via,
      fixoCents: dinheiro(l[4]),
      comissaoCents: (dinheiro(l[5]) ?? 0) + (dinheiro(l[6]) ?? 0)
    });
  });

  return { totalMes, roster, projecao, contrato };
}

/**
 * O ClickUp.
 *
 * As três armadilhas do formato, todas já pagas caro por alguém:
 *   · `custom_fields[].value` de um dropdown é o ORDERINDEX, não o rótulo.
 *     Ler `value` cru produz "Categoria 5" e conclusão nenhuma; o rótulo mora em
 *     `type_config.options`.
 *   · relacionamento (Projetos) traz um ARRAY DE OBJETOS, não um id.
 *   · `date_created` é quando alguém DIGITOU; `due_date` é quando o dinheiro se
 *     move. Agregar por date_created joga o pagamento de setembro em março —
 *     que é justamente o mês em que as tarefas do Marcelo Felipe foram criadas.
 *
 * `due_date` vem em ms epoch com hora 04:00 ou 07:00 UTC (o "sem hora" do
 * ClickUp é 4h da manhã local). Converter pelo fuso de São Paulo é o que devolve
 * o dia de calendário certo; `toISOString()` erraria o dia em metade dos casos.
 */
function lerClickUp() {
  const arq = path.join(rawDir, 'clickup-tasks.json');
  if (!existsSync(arq)) return null;
  const bruto = JSON.parse(readFileSync(arq, 'utf8'));
  const tarefas = bruto.data ?? bruto;

  const rotulo = (campo) => {
    if (!campo || campo.value === null || campo.value === undefined) return null;
    const opcoes = campo.type_config?.options ?? [];
    if (typeof campo.value === 'number') return opcoes[campo.value]?.name ?? null;
    return opcoes.find((o) => o.id === campo.value)?.name ?? null;
  };
  const diaBRT = (ms) => new Date(Number(ms)).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

  const lancamentos = [];
  for (const t of tarefas) {
    const campos = Object.fromEntries((t.custom_fields ?? []).map((f) => [f.name, f]));
    const valor = campos['Valor pago'];
    if (!valor || valor.value === null || valor.value === undefined) continue;
    const cents = Math.round(Number(valor.value) * 100);
    if (!Number.isFinite(cents) || cents === 0) continue;

    const projetos = campos.Projetos?.value;
    lancamentos.push({
      id: t.id,
      nome: t.name ?? '',
      nomeNorm: normalizeDescription(t.name ?? ''),
      lista: t.list?.name ?? null,
      status: t.status?.status ?? null,
      due: t.due_date ? diaBRT(t.due_date) : null,
      criado: t.date_created ? diaBRT(t.date_created) : null,
      cents,
      movimento: rotulo(campos['Movimentação']),
      categoria: rotulo(campos.Categoria),
      subcategoria: rotulo(campos.Subcategoria),
      projetos: Array.isArray(projetos) ? projetos.map((p) => p.name).filter(Boolean) : []
    });
  }
  return { syncedAt: bruto.syncedAt ?? null, lancamentos };
}

/**
 * O Asaas, pelo relatório de COBRANÇAS — não pelo de lançamentos financeiros.
 *
 * A distinção é o alarme inteiro: o ledger foi importado de
 * asaas-financial-transactions.json, então comparar com esse arquivo é conferir
 * uma cópia contra o original dela. `asaas-payments.json` é o outro relatório do
 * mesmo gateway: valor BRUTO, na data em que o CLIENTE pagou. É a única visão
 * que enxerga RECEIVED_IN_CASH — dinheiro que o cliente pagou por fora e que
 * nunca tocou o saldo do Asaas.
 */
function lerAsaas() {
  const arq = path.join(rawDir, 'asaas-payments.json');
  if (!existsSync(arq)) return null;
  const bruto = JSON.parse(readFileSync(arq, 'utf8'));
  const dados = bruto.data ?? bruto;
  return dados
    .filter((p) => p.status === 'RECEIVED' || p.status === 'RECEIVED_IN_CASH')
    .map((p) => ({
      id: p.id,
      status: p.status,
      data: p.paymentDate || p.clientPaymentDate || null,
      cents: Math.round(Number(p.value) * 100),
      descricao: p.description ?? '',
      cliente: p.customer ?? null
    }))
    .filter((p) => p.data && Number.isFinite(p.cents));
}

/**
 * Casamento guloso um-para-um por valor exato dentro de uma janela de dias.
 *
 * O um-para-um é a parte que importa. Sem ele, um único lançamento de R$ 1.000
 * no ledger "explica" as quatro parcelas de R$ 1.000 do gateway, o alarme fica
 * verde e as três parcelas ausentes seguem invisíveis — que é exatamente o modo
 * de falhar que este arquivo existe para impedir.
 */
function casar(externos, ledger, janelaDias) {
  const disponiveis = new Map();
  for (const l of ledger) {
    const chave = Math.abs(Number(l.cents));
    if (!disponiveis.has(chave)) disponiveis.set(chave, []);
    disponiveis.get(chave).push(l);
  }
  const dia = (d) => new Date(`${d}T00:00:00Z`).getTime();
  const casados = [];
  const orfaos = [];
  for (const e of externos) {
    const candidatos = disponiveis.get(Math.abs(e.cents)) ?? [];
    const i = candidatos.findIndex((l) => Math.abs(dia(l.data) - dia(e.data)) <= janelaDias * 86_400_000);
    if (i === -1) orfaos.push(e);
    else { casados.push({ externo: e, ledger: candidatos[i] }); candidatos.splice(i, 1); }
  }
  return { casados, orfaos };
}

// ===========================================================================
// IDENTIDADE: quem é quem entre as fontes
// ===========================================================================

/**
 * Sinônimos de apelido da planilha, com a prova reduzida.
 *
 * Cópia consciente de MESMA_PESSOA em scripts/import-pessoas.mjs. Duplicar um
 * mapa é dívida — e importar aquele arquivo executaria um importador inteiro só
 * para ler um objeto. A dívida fica anotada aqui: se a lista de lá crescer e
 * esta não, o alarme deixa de reconhecer a pessoa nova e passa a PASSAR quando
 * deveria gritar. Falha silenciosa, do tipo que este arquivo persegue.
 */
const APELIDOS = new Map(Object.entries({
  macgyver: 'flavio',
  'est. igor': 'igor a',
  'est. p. araújo': 'paulo',
  'est. tawanny': 'tawany',
  'est. cleber': 'cleber',
  dec: 'decezaris',
  decézaris: 'decezaris',
  everaldo: 'evera',
  filipe: 'felipe'
}));

/** Linhas da projeção que são VAGA em aberto, não pessoa. */
const VAGAS = new Set(['rh', 'novo vendedor', 'obras 1', 'obras 2', 'teco']);

const chaveApelido = (a) => {
  const cru = String(a ?? '').trim().toLowerCase();
  return normalizeDescription(APELIDOS.get(cru) ?? cru);
};

/**
 * Índice de pessoas para cruzamento externo.
 *
 * Duas chaves com precisões deliberadamente diferentes:
 *   · `porApelido` — nome curto, para a planilha. Ambíguo por natureza ("Igor"
 *     são dois). Apelido que resolve para mais de uma pessoa só vira alarme se
 *     TODAS forem inativas; caso contrário vira nota.
 *   · `nomesLongos` — nome de cartório da contraparte, 2+ tokens, para procurar
 *     dentro do texto livre do ClickUp. É o que separa "Marcelo Felipe Dias
 *     Lacerda" de qualquer outro Felipe do mundo.
 */
async function indicePessoas() {
  const pessoas = await q(
    `SELECT p.id, p.name, p.normalized_name, p.status, p.end_date, p.start_date, p.employment_type
       FROM fin_person p JOIN fin_entity e ON e.id = p.entity_id
      WHERE e.slug = 'xpe' ORDER BY p.id`
  );
  const contrapartes = await q(
    `SELECT DISTINCT l.person_id, c.id AS cp_id, c.name
       FROM fin_person_counterparty l JOIN fin_counterparty c ON c.id = l.counterparty_id
      WHERE l.status = 'confirmado'
      UNION
     SELECT p.id, c.id, c.name FROM fin_person p JOIN fin_counterparty c ON c.id = p.counterparty_id`
  );

  const porId = new Map(pessoas.map((p) => [Number(p.id), { ...p, id: Number(p.id), nomesLongos: [] }]));
  for (const c of contrapartes) {
    const p = porId.get(Number(c.person_id));
    if (!p) continue;
    const norm = normalizeDescription(c.name);
    if (norm.split(' ').length >= 2) p.nomesLongos.push({ norm, cru: c.name, cpId: Number(c.cp_id) });
  }

  const porApelido = new Map();
  for (const p of porId.values()) {
    const chaves = new Set([
      normalizeDescription(p.name),
      normalizeDescription(p.normalized_name),
      normalizeDescription(p.name).split(' ')[0]
    ]);
    for (const k of chaves) {
      if (!k) continue;
      if (!porApelido.has(k)) porApelido.set(k, []);
      if (!porApelido.get(k).includes(p)) porApelido.get(k).push(p);
    }
  }
  return { lista: [...porId.values()], porId, porApelido };
}

/** A pessoa cujo nome de cartório aparece dentro deste texto. Null se nenhuma. */
function pessoaNoTexto(indice, textoNorm) {
  let melhor = null;
  for (const p of indice.lista) {
    for (const n of p.nomesLongos) {
      if (!textoNorm.includes(n.norm)) continue;
      if (!melhor || n.norm.length > melhor.nome.length) melhor = { pessoa: p, nome: n.norm, cru: n.cru };
    }
  }
  return melhor;
}

// ===========================================================================
// Declaração dos alarmes. Nada roda aqui: `alarme()` só registra.
// ===========================================================================
const ALARMES = [];
const alarme = (secao, id, nome, { compara, porque, limiar }, executor) =>
  ALARMES.push({ secao, id, nome, compara, porque, limiar, executor });

const SECOES = {
  A: 'A. CADASTRO × COMPROMISSO: quem saiu continua na folha de alguém',
  B: 'B. PLANILHA DO DONO × LEDGER: o número que ele diz em voz alta',
  C: 'C. CLICKUP × LEDGER: a fonte que a operação alimenta à mão',
  D: 'D. ASAAS × LEDGER: o gateway e os livros',
  E: 'E. BANCO × LEDGER: a única fonte que não tem opinião',
  F: 'F. PACTUADO × PAGO: o combinado e o que saiu'
};

const entidade = await um(`SELECT id, slug, legal_name, cnpj FROM fin_entity WHERE slug = 'xpe'`);
const [pessoas, planilha, clickup, asaas, horizonte] = await Promise.all([
  indicePessoas(),
  Promise.resolve(lerPlanilha()),
  Promise.resolve(lerClickUp()),
  Promise.resolve(lerAsaas()),
  um(`SELECT max(posted_on) ultimo, to_char(date_trunc('month', max(posted_on)), 'YYYY-MM') mes_ultimo,
             to_char(CURRENT_DATE, 'YYYY-MM') mes_hoje, CURRENT_DATE hoje FROM fin_transaction`)
]);

/** Meses que ainda faltam fechar em 2026, contados de hoje. */
const mesesRestantes2026 = Math.max(0, 12 - Number(String(horizonte.mes_hoje).slice(5, 7)) + 1);

// =========================================================================
// A. CADASTRO × COMPROMISSO
//
// O cadastro é a única fonte que sabe que alguém SAIU. Nenhuma das outras tem
// esse campo — a planilha tem linha, o ClickUp tem tarefa, o extrato tem
// pagamento, e todos os três continuam existindo depois do desligamento porque
// ninguém os avisou. Este bloco é o aviso.
// =========================================================================
alarme('A', 'A1', 'ClickUp não programa pagamento para quem já saiu', {
  compara: 'data/raw/clickup-tasks.json (due_date + Valor pago) × fin_person.end_date',
  porque: 'é o caso que originou este arquivo: R$ 2.500/mês para Marcelo Felipe em set–dez, com o cadastro dizendo que ele saiu em 01/08',
  limiar: `${brl(LIMIARES.compromissoInativoCents)} — pagamento agendado para desligado não tem versão pequena`
}, async () => {
  if (!clickup) return { vazio: 'data/raw/clickup-tasks.json não existe' };
  const achados = [];
  for (const l of clickup.lancamentos) {
    if (!l.due || l.movimento !== 'Saida') continue;
    const hit = pessoaNoTexto(pessoas, l.nomeNorm);
    if (!hit || hit.pessoa.status !== 'inativo' || !hit.pessoa.end_date) continue;
    if (l.due <= hit.pessoa.end_date) continue;
    achados.push({ ...l, pessoa: hit.pessoa, nomeCasado: hit.cru });
  }
  achados.sort((a, b) => (a.due < b.due ? -1 : 1));
  const futuros = achados.filter((a) => a.due >= horizonte.hoje);
  return {
    n: achados.length,
    rs: soma(achados, (a) => a.cents),
    detalhes: achados.map((a) =>
      `${a.due} ${brl(a.cents)} · tarefa ${a.id} "${a.nome.slice(0, 46)}" [${a.status}] → ${a.pessoa.name} (id ${a.pessoa.id}, saiu em ${a.pessoa.end_date})`),
    nota: futuros.length
      ? `${brl(soma(futuros, (a) => a.cents))} ainda no FUTURO (${futuros.length} pagamento(s) a partir de hoje) — este é o dinheiro que dá para não gastar`
      : null
  };
});

alarme('A', 'A2', 'não há remuneração pactuada com competência após o desligamento', {
  compara: 'fin_person_compensation (kind = contratado) × fin_person.end_date',
  porque: "'contratado' é contrato vivo, não pagamento avulso: um contrato com competência no mês da saída ou depois entra na projeção de caixa de todos os meses seguintes",
  limiar: `${brl(LIMIARES.compromissoInativoCents)} — mesma regra do A1, aplicada à fonte interna`
}, async () => {
  const linhas = await q(
    `SELECT p.id, p.name, p.end_date, pc.reference_month, pc.component, pc.amount_cents, pc.source
       FROM fin_person_compensation pc JOIN fin_person p ON p.id = pc.person_id
      WHERE pc.kind = 'contratado' AND p.status = 'inativo' AND p.end_date IS NOT NULL
        AND pc.reference_month >= date_trunc('month', p.end_date)::date
      ORDER BY pc.amount_cents DESC`
  );
  return {
    n: linhas.length,
    rs: soma(linhas, (l) => l.amount_cents),
    detalhes: linhas.map((l) =>
      `${l.reference_month} ${brl(l.amount_cents)} · ${l.name} (id ${l.id}, saiu em ${l.end_date}) · componente "${l.component}" · fonte "${l.source}"`),
    nota: linhas.length
      ? `mensal: ${brl(soma(linhas, (l) => l.amount_cents))}/mês. Até dezembro/2026 são ${brl(soma(linhas, (l) => l.amount_cents) * mesesRestantes2026)} se ninguém desligar a linha`
      : null
  };
});

alarme('A', 'A3', 'a planilha do dono não orça folha para quem já saiu', {
  compara: 'data/raw/pessoas/aba-1022703245.csv (projeção "Custo bruto folha" e tabela "Via de Pagamento") × fin_person.end_date',
  porque: 'a projeção é o que vira orçamento e decisão de contratação; uma pessoa desligada com coluna "Dez" preenchida infla o custo planejado do ano inteiro',
  limiar: `${brl(LIMIARES.compromissoInativoCents)} — a linha não deveria existir, em nenhum valor`
}, async () => {
  if (!planilha) return { vazio: 'data/raw/pessoas/*.csv não encontrados' };
  const achados = [];
  const ambiguos = [];
  const resolve = (apelido) => {
    const cand = pessoas.porApelido.get(chaveApelido(apelido)) ?? [];
    if (!cand.length) return null;
    if (cand.length > 1 && !cand.every((p) => p.status === 'inativo')) { ambiguos.push(apelido); return null; }
    return cand[0];
  };

  for (const l of planilha.projecao) {
    if (VAGAS.has(l.apelido.trim().toLowerCase())) continue;
    const p = resolve(l.apelido);
    if (!p || p.status !== 'inativo') continue;
    const cols = Object.entries(l.colunas).filter(([, v]) => v !== null && v > 0);
    if (!cols.length) continue;
    const pico = Math.max(...cols.map(([, v]) => v));
    achados.push({
      onde: `aba-1022703245.csv:${l.linha} (projeção)`,
      apelido: l.apelido, pessoa: p, mensal: pico,
      texto: cols.map(([k, v]) => `${k} ${brl(v)}`).join(' · ')
    });
  }
  for (const l of planilha.contrato) {
    if (VAGAS.has(l.apelido.trim().toLowerCase())) continue;
    const p = resolve(l.apelido);
    if (!p || p.status !== 'inativo' || !l.fixoCents) continue;
    achados.push({
      onde: `aba-1022703245.csv:${l.linha} (via de pagamento)`,
      apelido: l.apelido, pessoa: p, mensal: l.fixoCents,
      texto: `fixo ${brl(l.fixoCents)} via ${l.via}`
    });
  }

  // O dinheiro em jogo de uma linha de ORÇAMENTO é o que ela ainda vai
  // comprometer: o valor mensal vezes os meses que faltam fechar em 2026.
  //
  // Contado POR PESSOA, não por linha: o Felipe aparece em duas abas do mesmo
  // arquivo, e somar as duas cobraria dele dois salários. Duas linhas são duas
  // divergências (as duas precisam ser apagadas) e um só compromisso.
  const porPessoa = new Map();
  for (const a of achados) porPessoa.set(a.pessoa.id, Math.max(porPessoa.get(a.pessoa.id) ?? 0, a.mensal));
  const rs = soma([...porPessoa.values()]) * mesesRestantes2026;
  return {
    n: achados.length,
    rs,
    detalhes: achados.map((a) =>
      `${a.onde} · "${a.apelido}" → ${a.pessoa.name} (id ${a.pessoa.id}, saiu em ${a.pessoa.end_date}) · ${a.texto}`),
    nota: [
      achados.length ? `${porPessoa.size} pessoa(s) desligada(s) em ${achados.length} linha(s) de planilha · ${brl(soma([...porPessoa.values()]))}/mês × ${mesesRestantes2026} meses até dezembro` : null,
      ambiguos.length ? `apelidos ambíguos ignorados de propósito (resolvem para mais de uma pessoa, nem todas inativas): ${[...new Set(ambiguos)].join(', ')}` : null
    ].filter(Boolean).join(' | ') || null
  };
});

alarme('A', 'A4', `ninguém ativo passa ${LIMIARES.ativoSemPagamentoMeses} meses de extrato sem receber`, {
  compara: 'fin_person (status = ativo) × último pagamento no ledger, medido contra o último mês COM extrato',
  porque: 'é o inverso do A1: saída que aconteceu e ninguém registrou. A pessoa continua no cadastro, no orçamento e na projeção de caixa, e o custo dela nunca sai da conta',
  limiar: `${LIMIARES.ativoSemPagamentoMeses} meses — 1 é a virada do mês, 3 já atravessou um trimestre`
}, async () => {
  const linhas = await q(
    `WITH ultimo AS (
       SELECT l.person_id, max(t.posted_on) dia, count(*) n, sum(-t.amount_cents) rs
         FROM fin_transaction t
         JOIN fin_person_counterparty l ON l.counterparty_id = t.counterparty_id AND l.status = 'confirmado'
        WHERE ${GUARDAS_SAIDA}
        GROUP BY 1
     ), fim AS (SELECT date_trunc('month', max(posted_on))::date m FROM fin_transaction)
     SELECT p.id, p.name, p.employment_type, u.dia, u.n, u.rs,
            CASE WHEN u.dia IS NULL THEN 999
                 ELSE (EXTRACT(YEAR FROM age((SELECT m FROM fim), date_trunc('month', u.dia)::date)) * 12
                     + EXTRACT(MONTH FROM age((SELECT m FROM fim), date_trunc('month', u.dia)::date)))::int END meses
       FROM fin_person p LEFT JOIN ultimo u ON u.person_id = p.id
      WHERE p.status = 'ativo'
      ORDER BY meses DESC, p.name`
  );
  const quebrados = linhas.filter((l) => Number(l.meses) >= LIMIARES.ativoSemPagamentoMeses);
  const pior = linhas[0];
  return {
    n: quebrados.length,
    // O dinheiro em jogo de quem PAROU de receber é o custo mensal que a
    // projeção continua reservando para ele — aproximado pelo último pagamento.
    rs: soma(quebrados, (l) => (l.dia ? Number(l.rs) / Math.max(1, Number(l.n)) : 0)),
    detalhes: quebrados.map((l) =>
      l.dia
        ? `${l.name} (id ${l.id}, ${l.employment_type}) · último pagamento ${l.dia}, há ${l.meses} mês(es) de extrato · ${num(l.n)} pagamentos históricos, ${brl(l.rs)}`
        : `${l.name} (id ${l.id}, ${l.employment_type}) · NUNCA recebeu nada pelo ledger`),
    nota: pior && !quebrados.length
      ? `o mais próximo do limiar: ${pior.name}, ${pior.meses} mês(es) sem receber (último em ${pior.dia})`
      : null
  };
});

alarme('A', 'A5', 'o ledger não paga quem nenhuma planilha conhece', {
  compara: 'pagamentos a pessoas no ledger × fin_person_compensation × roster da planilha do dono',
  porque: 'o inverso do A3: gente que RECEBE e não está em nenhum documento de pactuação. Sem linha na planilha, esse custo não entra em projeção nenhuma e reaparece como surpresa todo mês',
  limiar: `${brl(LIMIARES.pactuadoPessoaCents)} por pessoa no mês — abaixo disso é serviço avulso, acima é gente que virou fixo sem contrato`
}, async () => {
  if (!planilha) return { vazio: 'data/raw/pessoas/*.csv não encontrados' };
  // "Conhecida pela planilha" precisa varrer as TRÊS listas de gente que ela
  // tem. Usar só a aba de projeção acusaria Lorena, Dantre e Sandro, que estão
  // no roster da aba principal — e um alarme que grita com quem está lá perde a
  // autoridade de gritar com quem não está.
  const noRoster = new Set([
    ...planilha.roster.map((l) => chaveApelido(l.apelido)),
    ...planilha.projecao.map((l) => chaveApelido(l.apelido)),
    ...planilha.contrato.map((l) => chaveApelido(l.apelido))
  ]);
  const linhas = await q(
    `SELECT p.id, p.name, p.normalized_name, p.employment_type, sum(-t.amount_cents) rs, count(*) n
       FROM fin_transaction t
       JOIN fin_person_counterparty l ON l.counterparty_id = t.counterparty_id AND l.status = 'confirmado'
       JOIN fin_person p ON p.id = l.person_id
      WHERE ${GUARDAS_SAIDA} AND date_trunc('month', t.posted_on) = (SELECT date_trunc('month', max(posted_on)) FROM fin_transaction)
        AND NOT EXISTS (SELECT 1 FROM fin_person_compensation pc WHERE pc.person_id = p.id AND pc.kind = 'contratado')
      GROUP BY 1, 2, 3, 4 ORDER BY 5 DESC`
  );
  const achados = linhas.filter((l) => {
    const chaves = [normalizeDescription(l.name), normalizeDescription(l.name).split(' ')[0], normalizeDescription(l.normalized_name)];
    return !chaves.some((k) => noRoster.has(k)) && Number(l.rs) >= LIMIARES.pactuadoPessoaCents;
  });
  return {
    n: achados.length,
    rs: soma(achados, (l) => l.rs),
    detalhes: achados.map((l) =>
      `${l.name} (id ${l.id}, ${l.employment_type}) recebeu ${brl(l.rs)} em ${num(l.n)} pagamento(s) no último mês do extrato — sem linha em fin_person_compensation e sem apelido no roster da planilha`)
  };
});

alarme('A', 'A6', 'nenhum pagamento saiu DEPOIS da data de desligamento', {
  compara: 'fin_transaction.posted_on × fin_person.end_date',
  porque: 'A1 pega o que está agendado; este pega o que já saiu. É a mesma pergunta depois do fato consumado, e a resposta vira valor a cobrar de volta',
  limiar: `${brl(LIMIARES.compromissoInativoCents)} — dinheiro que saiu depois da saída é devolução, não divergência`
}, async () => {
  const linhas = await q(
    `SELECT t.id, t.posted_on, t.amount_cents, p.id pid, p.name, p.end_date, left(t.description_raw, 50) d
       FROM fin_transaction t
       JOIN fin_person_counterparty l ON l.counterparty_id = t.counterparty_id AND l.status = 'confirmado'
       JOIN fin_person p ON p.id = l.person_id
      WHERE ${GUARDAS_SAIDA} AND p.status = 'inativo' AND p.end_date IS NOT NULL AND t.posted_on > p.end_date
      ORDER BY abs(t.amount_cents) DESC`
  );
  return {
    n: linhas.length,
    rs: soma(linhas, (l) => Math.abs(Number(l.amount_cents))),
    tx: linhas.map((l) => Number(l.id)),
    detalhes: linhas.map((l) => `tx ${l.id} ${l.posted_on} ${brl(l.amount_cents)} → ${l.name} (saiu em ${l.end_date}) — "${l.d}"`)
  };
});

// =========================================================================
// B. PLANILHA DO DONO × LEDGER
//
// "Custo de gente" tem UMA definição no ledger e ela não é a categoria 6.01: é
// a ligação pessoa↔contraparte confirmada (lib/financeiro/pessoas.ts, decisão 1).
// Somar a categoria inflaria a folha em 3,4×, e o alarme passaria a medir a
// classificação em vez de medir a planilha.
// =========================================================================
const mesesPlanilha = () => Object.entries(planilha?.totalMes ?? {})
  .filter(([, v]) => v !== null && v > 0)
  .sort(([a], [b]) => (a < b ? -1 : 1));

async function custoGenteLedger() {
  const linhas = await q(
    `SELECT to_char(date_trunc('month', t.posted_on), 'YYYY-MM') m, sum(-t.amount_cents) rs, count(*) n
       FROM fin_transaction t
       JOIN fin_person_counterparty l ON l.counterparty_id = t.counterparty_id AND l.status = 'confirmado'
      WHERE ${GUARDAS_SAIDA} AND t.posted_on >= '2026-01-01' AND t.posted_on < '2027-01-01'
      GROUP BY 1 ORDER BY 1`
  );
  return new Map(linhas.map((l) => [l.m, { rs: Number(l.rs), n: Number(l.n) }]));
}

alarme('B', 'B1', 'o custo de gente da planilha fecha com o do ledger, mês a mês', {
  compara: 'data/raw/pessoas/planilha.csv linha 8 (total mensal) × soma dos pagamentos a pessoas do roster no ledger',
  porque: 'é o número que o dono usa para decidir contratação. Se ele e o ledger discordam, uma das duas decisões do mês foi tomada sobre dado errado — e não dá para saber qual',
  limiar: `${brl(LIMIARES.planilhaMesCents)} por mês ≈ o menor salário cheio do quadro; abaixo disso cabe numa transferência que atravessou a virada do mês`
}, async () => {
  if (!planilha) return { vazio: 'data/raw/pessoas/planilha.csv não encontrado' };
  const ledger = await custoGenteLedger();
  const fora = [];
  const todos = [];
  for (const [mes, valor] of mesesPlanilha()) {
    const l = ledger.get(mes)?.rs ?? 0;
    const delta = l - valor;
    todos.push({ mes, valor, l, delta });
    if (Math.abs(delta) > LIMIARES.planilhaMesCents) fora.push({ mes, valor, l, delta });
  }
  return {
    n: fora.length,
    rs: soma(fora, (f) => Math.abs(f.delta)),
    detalhes: todos.map((t) =>
      `${t.mes}  planilha ${brl(t.valor).padStart(14)}  ledger ${brl(t.l).padStart(14)}  ` +
      `${t.delta >= 0 ? 'ledger a MAIS' : 'ledger a MENOS'} ${brl(Math.abs(t.delta))}` +
      `${Math.abs(t.delta) > LIMIARES.planilhaMesCents ? '  ←' : ''}`),
    nota: `${fora.length} de ${todos.length} meses fora do limiar. A planilha zera set–dez (R$ 0,00): a partir de setembro ela deixa de ser fonte comparável.`
  };
});

alarme('B', 'B2', 'o acumulado do ano fecha entre planilha e ledger', {
  compara: 'soma dos meses preenchidos da planilha × mesma soma no ledger',
  porque: 'o efeito de virada de mês se cancela no acumulado — o que sobra é estrutural: pessoa que existe de um lado e não do outro, ou pagamento que nunca virou linha',
  limiar: `${brl(LIMIARES.planilhaAnoCents)} ≈ um mês inteiro do time de Hardware`
}, async () => {
  if (!planilha) return { vazio: 'data/raw/pessoas/planilha.csv não encontrado' };
  const ledger = await custoGenteLedger();
  const meses = mesesPlanilha();
  const p = soma(meses, ([, v]) => v);
  const l = soma(meses, ([m]) => ledger.get(m)?.rs ?? 0);
  const delta = l - p;
  return {
    n: Math.abs(delta) > LIMIARES.planilhaAnoCents ? 1 : 0,
    rs: Math.abs(delta),
    detalhes: [
      `planilha (${meses.length} meses, ${meses[0]?.[0]} a ${meses.at(-1)?.[0]}): ${brl(p)}`,
      `ledger  (mesmos meses, pessoas do roster):        ${brl(l)}`,
      `o ledger conhece ${brl(Math.abs(delta))} ${delta >= 0 ? 'a MAIS' : 'a MENOS'} que a planilha — ${pct((Math.abs(delta) / p) * 100)} do total do dono`
    ]
  };
});

alarme('B', 'B3', 'a folha de set–dez tem o mesmo tamanho nas três fontes', {
  compara: 'planilha (total mensal set–dez) × fin_person_compensation (contratado) × ClickUp (saídas agendadas)',
  porque: 'a planilha zera set–dez e o cadastro segue com contrato cheio. Quem lê a planilha planeja caixa para R$ 0 de folha em quatro meses; quem lê o cadastro planeja para o valor cheio. Os dois números vão para a mesma reunião',
  limiar: `${brl(LIMIARES.planilhaMesCents)} de diferença mensal entre a maior e a menor fonte`
}, async () => {
  if (!planilha) return { vazio: 'data/raw/pessoas/planilha.csv não encontrado' };
  const futuros = ['2026-09', '2026-10', '2026-11', '2026-12'];
  const contratado = Number((await um(
    `SELECT coalesce(sum(amount_cents), 0) rs FROM fin_person_compensation
      WHERE kind = 'contratado' AND reference_month = (SELECT max(reference_month) FROM fin_person_compensation WHERE kind = 'contratado')`
  )).rs);
  const cuPorMes = new Map();
  for (const l of clickup?.lancamentos ?? []) {
    if (!l.due || l.movimento !== 'Saida') continue;
    const m = l.due.slice(0, 7);
    if (!futuros.includes(m)) continue;
    cuPorMes.set(m, (cuPorMes.get(m) ?? 0) + l.cents);
  }
  const linhas = futuros.map((m) => {
    const p = planilha.totalMes[m] ?? 0;
    const cu = cuPorMes.get(m) ?? 0;
    return { m, p, contratado, cu, spread: Math.max(p, contratado, cu) - Math.min(p, contratado, cu) };
  });
  const fora = linhas.filter((l) => l.spread > LIMIARES.planilhaMesCents);
  return {
    n: fora.length,
    rs: soma(fora, (l) => l.spread),
    detalhes: linhas.map((l) =>
      `${l.m}  planilha ${brl(l.p).padStart(13)} · pactuado ${brl(l.contratado).padStart(13)} · clickup ${brl(l.cu).padStart(12)}  → discordam em ${brl(l.spread)}`),
    nota: 'o pactuado é projetado pelo último mês com contrato registrado — nenhuma fonte diz o que será a folha de set–dez, e é exatamente esse o problema'
  };
});

// =========================================================================
// C. CLICKUP × LEDGER
//
// Divergência POR DESENHO: o ClickUp registra o fluxo de caixa das OBRAS, o
// ledger registra a empresa. Nenhum limiar sobre o valor absoluto faria sentido.
// O que faz sentido é medir a FATIA que a fonte explica e o que acontece com ela
// ao longo do tempo — porque uma fonte manual não morre com aviso, ela vai
// ficando vazia.
// =========================================================================
async function coberturaClickUp() {
  const saidaLedger = await q(
    `SELECT to_char(date_trunc('month', posted_on), 'YYYY-MM') m, sum(-amount_cents) rs
       FROM fin_transaction WHERE amount_cents < 0 AND transfer_status = 'nao' AND NOT is_split_parent
        AND posted_on >= '2025-12-01' GROUP BY 1 ORDER BY 1`
  );
  const cu = new Map();
  for (const l of clickup?.lancamentos ?? []) {
    if (!l.due || l.movimento !== 'Saida') continue;
    cu.set(l.due.slice(0, 7), (cu.get(l.due.slice(0, 7)) ?? 0) + l.cents);
  }
  return saidaLedger
    .filter((r) => r.m <= horizonte.mes_ultimo)
    .map((r) => ({ m: r.m, ledger: Number(r.rs), clickup: cu.get(r.m) ?? 0, pct: Number(r.rs) ? ((cu.get(r.m) ?? 0) / Number(r.rs)) * 100 : 0 }));
}

alarme('C', 'C1', 'o ClickUp continua explicando metade da saída da empresa', {
  compara: 'saída mensal no ClickUp (Movimentação = Saida) × saída mensal no ledger',
  porque: 'o ClickUp é a única fonte em que a operação escreve na hora do gasto. Enquanto ele cobre boa parte da saída, é conferência barata; quando esvazia, a empresa perde a segunda opinião e não recebe aviso nenhum',
  limiar: `${LIMIARES.clickupCoberturaPct}% de cobertura no último mês fechado — piso de utilidade, não meta de qualidade`
}, async () => {
  if (!clickup) return { vazio: 'data/raw/clickup-tasks.json não existe' };
  const serie = await coberturaClickUp();
  // A decisão sai do último mês FECHADO. O mês corrente está pela metade nas
  // duas fontes e a razão entre duas metades não é comparável com a razão entre
  // dois meses inteiros — seria um alarme que dispara todo dia 1º.
  const fechados = serie.filter((s) => s.m < horizonte.mes_hoje);
  const ultimos = fechados.slice(-6);
  const ultimo = ultimos.at(-1);
  if (!ultimo) return { vazio: 'nenhum mês fechado comparável' };
  const pico = ultimos.reduce((a, b) => (b.pct > a.pct ? b : a), ultimos[0]);
  const queda = pico.pct - ultimo.pct;
  const problemas = [];
  if (ultimo.pct < LIMIARES.clickupCoberturaPct) problemas.push('cobertura');
  if (queda > LIMIARES.clickupQuedaPp) problemas.push('tendência');
  return {
    n: problemas.length,
    // O dinheiro em jogo é a saída do último mês que a segunda fonte NÃO vê.
    rs: Math.max(0, ultimo.ledger - ultimo.clickup),
    detalhes: [
      ...serie.map((s) => `${s.m}  ledger ${brl(s.ledger).padStart(14)}  clickup ${brl(s.clickup).padStart(14)}  cobertura ${pct(s.pct).padStart(7)}${s.m >= horizonte.mes_hoje ? '  (mês em curso, fora da decisão)' : ''}`),
      `pico dos últimos 6 meses fechados: ${pico.m} com ${pct(pico.pct)}; último fechado: ${ultimo.m} com ${pct(ultimo.pct)} — queda de ${queda.toFixed(1).replace('.', ',')} p.p.`
    ],
    nota: problemas.length ? `disparou por: ${problemas.join(' + ')}` : null
  };
});

alarme('C', 'C2', 'toda saída registrada no ClickUp tem lançamento correspondente no ledger', {
  compara: 'tarefas de Saida com due_date passada × fin_transaction, casadas por valor exato em ±3 dias, um-para-um',
  porque: 'saída anotada na operação e ausente do banco é uma de duas coisas, e as duas custam: gasto pago por fora do caixa da empresa (bolso de alguém, cartão pessoal) ou lançamento que nunca foi importado',
  limiar: `${brl(LIMIARES.clickupSemParCents)} no acumulado — abaixo disso é material miúdo comprado no cartão de alguém`
}, async () => {
  if (!clickup) return { vazio: 'data/raw/clickup-tasks.json não existe' };
  const externos = clickup.lancamentos
    .filter((l) => l.movimento === 'Saida' && l.due && l.due <= horizonte.hoje && l.due >= '2025-12-01')
    .map((l) => ({ ...l, data: l.due }));
  const ledger = (await q(
    `SELECT id, posted_on data, -amount_cents cents FROM fin_transaction
      WHERE amount_cents < 0 AND NOT is_split_parent AND posted_on >= '2025-11-01'`
  )).map((r) => ({ id: Number(r.id), data: r.data, cents: Number(r.cents) }));
  const { casados, orfaos } = casar(externos, ledger, 3);
  const rs = soma(orfaos, (o) => o.cents);
  orfaos.sort((a, b) => b.cents - a.cents);
  return {
    n: rs > LIMIARES.clickupSemParCents ? orfaos.length : 0,
    rs,
    detalhes: [
      `${num(casados.length)} de ${num(externos.length)} saídas do ClickUp têm par no ledger (${brl(soma(casados, (c) => c.externo.cents))})`,
      ...orfaos.slice(0, 12).map((o) =>
        `${o.due} ${brl(o.cents)} · tarefa ${o.id} "${o.nome.slice(0, 44)}" [${o.categoria ?? 'sem categoria'}]${o.projetos.length ? ` · obra "${o.projetos[0]}"` : ''}`)
    ]
  };
});

// =========================================================================
// D. ASAAS × LEDGER
//
// O ledger foi importado de asaas-financial-transactions.json. Comparar com
// aquele arquivo seria conferir uma cópia contra o original dela — sempre bate,
// nunca informa. A fonte independente é o relatório de COBRANÇAS: valor bruto,
// na data em que o cliente pagou.
// =========================================================================
alarme('D', 'D1', 'a receita que o gateway diz ter recebido está no ledger', {
  compara: 'asaas-payments.json (status RECEIVED, por paymentDate) × entradas PAYMENT_RECEIVED na conta Asaas do ledger',
  porque: 'é a receita, o número mais público da empresa. Gateway e ledger leem o MESMO evento por dois caminhos: só o atraso de crédito pode separá-los, e atraso de crédito não passa de um dia',
  limiar: `${LIMIARES.asaasMesPct}% da receita do mês (piso de ${brl(LIMIARES.asaasMesPisoCents)}) — percentual porque a causa legítima é temporal e escala com o volume`
}, async () => {
  if (!asaas) return { vazio: 'data/raw/asaas-payments.json não existe' };
  const gateway = new Map();
  for (const p of asaas) {
    if (p.status !== 'RECEIVED' || p.data < '2026-01-01') continue;
    gateway.set(p.data.slice(0, 7), (gateway.get(p.data.slice(0, 7)) ?? 0) + p.cents);
  }
  const led = new Map((await q(
    `SELECT to_char(date_trunc('month', posted_on), 'YYYY-MM') m, sum(amount_cents) rs
       FROM fin_transaction WHERE account_id = (SELECT id FROM fin_account WHERE slug = 'asaas')
        AND source_kind = 'PAYMENT_RECEIVED' AND NOT is_split_parent AND posted_on >= '2026-01-01'
      GROUP BY 1`
  )).map((r) => [r.m, Number(r.rs)]));

  const linhas = [...gateway.keys()].sort().map((m) => {
    const g = gateway.get(m);
    const l = led.get(m) ?? 0;
    const delta = g - l;
    return { m, g, l, delta, pctv: g ? (Math.abs(delta) / g) * 100 : 0 };
  });
  const fora = linhas.filter((x) => x.pctv > LIMIARES.asaasMesPct && Math.abs(x.delta) > LIMIARES.asaasMesPisoCents);

  // Meses vizinhos com deltas que se cancelam são a assinatura da virada do mês:
  // a cobrança foi confirmada no dia 31 e creditada no dia 1º. Nomear esses
  // pares é o que separa "atraso de crédito" (não é notícia) de "receita que
  // não chegou" (é). Sem isso, o alarme grita duas vezes pelo mesmo boleto.
  const espelhos = [];
  for (let i = 1; i < linhas.length; i += 1) {
    const a = linhas[i - 1];
    const b = linhas[i];
    if (Math.abs(a.delta + b.delta) <= 100 && Math.abs(a.delta) > LIMIARES.asaasMesPisoCents) {
      espelhos.push(`${a.m}/${b.m}: ${brl(Math.abs(a.delta))} que falta em um sobra exatamente no outro — atraso de crédito na virada, não receita perdida`);
    }
  }
  return {
    n: fora.length,
    rs: soma(fora, (x) => Math.abs(x.delta)),
    detalhes: linhas.map((x) =>
      `${x.m}  gateway ${brl(x.g).padStart(14)}  ledger ${brl(x.l).padStart(14)}  ` +
      `${x.delta >= 0 ? 'falta no ledger' : 'sobra no ledger'} ${brl(Math.abs(x.delta))} (${pct(x.pctv)})` +
      `${fora.includes(x) ? '  ←' : ''}`),
    nota: espelhos.length ? espelhos.join(' | ') : null
  };
});

alarme('D', 'D2', 'recebimento em dinheiro do gateway aparece em alguma conta do ledger', {
  compara: 'asaas-payments.json (status RECEIVED_IN_CASH) × entradas de QUALQUER conta do ledger fora do Asaas, por valor em ±5 dias',
  porque: 'RECEIVED_IN_CASH é a cobrança que o cliente pagou por fora e alguém baixou na mão. Esse dinheiro nunca tocou o saldo do Asaas: ou entrou em outra conta, ou é receita que existe no gateway e não existe nos livros',
  limiar: `${brl(LIMIARES.asaasForaDoCaixaCents)} de valor NÃO ENCONTRADO — receita reconhecida sem contrapartida em caixa não tem faixa aceitável`
}, async () => {
  if (!asaas) return { vazio: 'data/raw/asaas-payments.json não existe' };
  const externos = asaas.filter((p) => p.status === 'RECEIVED_IN_CASH' && p.data >= '2026-01-01');
  const ledger = (await q(
    `SELECT id, posted_on data, amount_cents cents FROM fin_transaction
      WHERE amount_cents > 0 AND NOT is_split_parent AND posted_on >= '2025-12-01'
        AND account_id <> (SELECT id FROM fin_account WHERE slug = 'asaas')`
  )).map((r) => ({ id: Number(r.id), data: r.data, cents: Number(r.cents) }));
  const { casados, orfaos } = casar(externos, ledger, 5);
  orfaos.sort((a, b) => b.cents - a.cents);
  return {
    n: orfaos.length,
    rs: soma(orfaos, (o) => o.cents),
    detalhes: [
      `${num(casados.length)} de ${num(externos.length)} baixas em dinheiro têm entrada equivalente em outra conta (${brl(soma(casados, (c) => c.externo.cents))})`,
      ...orfaos.slice(0, 12).map((o) => `${o.data} ${brl(o.cents)} · cobrança ${o.id} "${(o.descricao || 'sem descrição').slice(0, 50)}"`)
    ]
  };
});

// =========================================================================
// E. BANCO × LEDGER
//
// O banco é a única fonte deste arquivo que não tem opinião, não tem atraso de
// digitação e não depende de ninguém lembrar de preencher. Quando ele discorda
// do ledger, o ledger está errado — não há terceira hipótese.
// =========================================================================
alarme('E', 'E1', 'o saldo do banco bate com a soma dos lançamentos da conta', {
  compara: 'fin_balance_snapshot (API/extrato) e fin_account.current_balance_cents × SUM(fin_transaction.amount_cents) por conta',
  porque: 'a diferença é literalmente dinheiro que a empresa tem e o ledger não vê (ou o contrário). Toda tela de caixa, todo runway e toda decisão de "dá para pagar?" saem dessa soma',
  limiar: `${brl(LIMIARES.saldoCents)} por conta — o alvo honesto é R$ 0,00 e o caminho é registrar o saldo de abertura; o limiar é só piso de ruído`
}, async () => {
  const contas = await q(
    `SELECT a.id, a.slug, a.kind, a.current_balance_cents coluna, a.opening_balance_cents abertura, a.opening_balance_date abertura_dia,
            (SELECT coalesce(sum(t.amount_cents), 0) FROM fin_transaction t WHERE t.account_id = a.id AND NOT t.is_split_parent) soma,
            (SELECT count(*) FROM fin_transaction t WHERE t.account_id = a.id) n,
            bs.balance_cents snap, bs.date snap_dia, bs.source snap_fonte, bs.variance_cents snap_var
       FROM fin_account a
       LEFT JOIN LATERAL (SELECT * FROM fin_balance_snapshot b WHERE b.account_id = a.id ORDER BY b.date DESC, b.id DESC LIMIT 1) bs ON true
      WHERE a.is_active ORDER BY a.sort_order, a.id`
  );
  const fora = [];
  const detalhes = [];
  for (const c of contas) {
    if (!Number(c.n)) { detalhes.push(`${c.slug.padEnd(18)} conta ativa SEM nenhum lançamento — entra no consolidado como zero`); continue; }
    const referencia = c.snap !== null && c.snap !== undefined ? Number(c.snap) : Number(c.coluna);
    const fonte = c.snap !== null && c.snap !== undefined ? `snapshot ${c.snap_fonte} de ${c.snap_dia}` : 'coluna current_balance_cents';
    const delta = referencia - (Number(c.soma) + Number(c.abertura));
    const linha = `${c.slug.padEnd(18)} banco ${brl(referencia).padStart(14)} (${fonte})  ledger ${brl(Number(c.soma) + Number(c.abertura)).padStart(14)}  divergência ${brl(delta).padStart(14)}`;
    detalhes.push(linha + (Math.abs(delta) > LIMIARES.saldoCents ? '  ←' : ''));
    if (Math.abs(delta) > LIMIARES.saldoCents) fora.push({ slug: c.slug, delta, snapVar: c.snap_var, abertura: Number(c.abertura) });
  }
  return {
    n: fora.length,
    rs: soma(fora, (f) => Math.abs(f.delta)),
    detalhes,
    nota: fora.some((f) => !f.abertura)
      ? `nenhuma das contas divergentes tem saldo de abertura registrado (opening_balance_cents = 0): parte da divergência é a história anterior à primeira importação, e enquanto a abertura não for lançada o alarme não consegue separar "buraco de extrato" de "começou do meio"`
      : null
  };
});

alarme('E', 'E2', 'toda conta ativa tem foto de saldo para conferir', {
  compara: 'fin_account (is_active) × fin_balance_snapshot',
  porque: 'sem snapshot, a conferência do E1 cai na coluna current_balance_cents — que é escrita pelo próprio importador. Uma fonte conferindo a si mesma não é conferência: é o alarme passando por vácuo',
  limiar: '0 contas ativas sem snapshot — é a condição para que E1 signifique alguma coisa'
}, async () => {
  const linhas = await q(
    `SELECT a.slug, a.kind, a.import_adapter, a.current_balance_cents saldo,
            (SELECT count(*) FROM fin_transaction t WHERE t.account_id = a.id) n,
            (SELECT coalesce(sum(abs(t.amount_cents)), 0) FROM fin_transaction t WHERE t.account_id = a.id AND NOT t.is_split_parent) movimento
       FROM fin_account a
      WHERE a.is_active AND NOT EXISTS (SELECT 1 FROM fin_balance_snapshot b WHERE b.account_id = a.id)
      ORDER BY abs(a.current_balance_cents) DESC`
  );
  // O "R$ em jogo" aqui é o SALDO não conferível, não o movimento.
  //
  // Somar o movimento daria R$ 1,2 mi e afundaria todos os outros alarmes na
  // ordenação por dinheiro — sem que R$ 1,2 mi estivesse em risco em momento
  // nenhum. O que está em risco é o saldo que ninguém tem como confirmar: é ele
  // que entra no caixa disponível e na decisão de "dá para pagar?".
  return {
    n: linhas.length,
    rs: soma(linhas, (l) => Math.abs(Number(l.saldo))),
    detalhes: linhas.map((l) =>
      `${l.slug} (${l.kind}, adaptador ${l.import_adapter}) — saldo declarado ${brl(l.saldo)}, ${num(l.n)} lançamentos, ${brl(l.movimento)} movimentados, zero fotos de saldo`),
    nota: linhas.length
      ? `${brl(soma(linhas, (l) => l.movimento))} já passaram por essas contas sem que nenhuma foto de saldo permitisse conferir uma única vez`
      : null
  };
});

// =========================================================================
// F. PACTUADO × PAGO
//
// fin_person_compensation guarda o COMBINADO; o ledger guarda o QUE SAIU. São as
// duas únicas fontes que falam da mesma pessoa no mesmo mês com o mesmo
// significado, e por isso é o cruzamento mais direto do arquivo.
// =========================================================================
alarme('F', 'F1', 'ninguém recebe muito acima nem muito abaixo do pactuado', {
  compara: 'fin_person_compensation (kind = contratado) × pagamentos a essa pessoa no ledger, por mês',
  porque: 'a diferença individual é onde mora a resposta de "por que a folha subiu": aumento que ninguém escreveu, comissão saindo com cara de salário, ou pessoa combinada e não paga',
  limiar: `${brl(LIMIARES.pactuadoPessoaCents)} por pessoa/mês ≈ o menor contrato do quadro; abaixo é reembolso de combustível`
}, async () => {
  const linhas = await q(
    `WITH pact AS (
       SELECT person_id, reference_month, sum(amount_cents) v FROM fin_person_compensation WHERE kind = 'contratado' GROUP BY 1, 2
     ), pago AS (
       SELECT l.person_id, date_trunc('month', t.posted_on)::date m, sum(-t.amount_cents) v, count(*) n
         FROM fin_transaction t JOIN fin_person_counterparty l ON l.counterparty_id = t.counterparty_id AND l.status = 'confirmado'
        WHERE ${GUARDAS_SAIDA} GROUP BY 1, 2
     )
     SELECT p.id, p.name, p.status, pact.reference_month mes, pact.v pactuado,
            coalesce(pago.v, 0) pago, coalesce(pago.n, 0) n, coalesce(pago.v, 0) - pact.v delta
       FROM pact JOIN fin_person p ON p.id = pact.person_id
       LEFT JOIN pago ON pago.person_id = pact.person_id AND pago.m = pact.reference_month
      ORDER BY abs(coalesce(pago.v, 0) - pact.v) DESC`
  );
  const fora = linhas.filter((l) => Math.abs(Number(l.delta)) > LIMIARES.pactuadoPessoaCents);
  return {
    n: fora.length,
    rs: soma(fora, (l) => Math.abs(Number(l.delta))),
    detalhes: fora.map((l) =>
      `${l.mes} ${l.name} (id ${l.id}${l.status === 'inativo' ? ', INATIVO' : ''}) · pactuado ${brl(l.pactuado)} · pago ${brl(l.pago)} em ${num(l.n)} lançamento(s) · ` +
      `${Number(l.delta) >= 0 ? 'RECEBEU A MAIS' : 'recebeu a menos'} ${brl(Math.abs(Number(l.delta)))}`),
    nota: `${linhas.length - fora.length} de ${linhas.length} pessoas dentro do limiar`
  };
});

alarme('F', 'F2', 'o total pactuado do mês prevê o total pago', {
  compara: 'soma de fin_person_compensation (contratado) do mês × soma do que saiu para o roster no mesmo mês',
  porque: 'é o pactuado agregado que entra na projeção de caixa. Se ele erra o mês inteiro por mais que uma pessoa, a projeção de folha do trimestre está errada pelo mesmo tanto, todo mês',
  limiar: `${brl(LIMIARES.pactuadoTotalCents)} ≈ uma pessoa inteira`
}, async () => {
  const linhas = await q(
    `WITH meses AS (SELECT DISTINCT reference_month m FROM fin_person_compensation WHERE kind = 'contratado')
     SELECT to_char(meses.m, 'YYYY-MM') mes,
            (SELECT coalesce(sum(amount_cents), 0) FROM fin_person_compensation pc WHERE pc.kind = 'contratado' AND pc.reference_month = meses.m) pactuado,
            (SELECT coalesce(sum(-t.amount_cents), 0) FROM fin_transaction t
               JOIN fin_person_counterparty l ON l.counterparty_id = t.counterparty_id AND l.status = 'confirmado'
              WHERE ${GUARDAS_SAIDA} AND date_trunc('month', t.posted_on) = meses.m) pago
       FROM meses ORDER BY 1`
  );
  const fora = linhas.filter((l) => Math.abs(Number(l.pago) - Number(l.pactuado)) > LIMIARES.pactuadoTotalCents);
  return {
    n: fora.length,
    rs: soma(fora, (l) => Math.abs(Number(l.pago) - Number(l.pactuado))),
    detalhes: linhas.map((l) =>
      `${l.mes}  pactuado ${brl(l.pactuado).padStart(14)}  pago ${brl(l.pago).padStart(14)}  diferença ${brl(Number(l.pago) - Number(l.pactuado)).padStart(14)}`)
  };
});

// ---------------------------------------------------------------------------
// EXECUÇÃO
// ---------------------------------------------------------------------------
let codigoSaida = 0;

try {
  const t0 = Date.now();

  await comLimite(ALARMES, 3, async (a) => {
    try {
      const r = await a.executor();
      a.vazio = r.vazio ?? null;
      a.n = Number(r.n || 0);
      a.rs = Math.abs(Number(r.rs || 0));
      a.detalhes = r.detalhes ?? [];
      a.nota = r.nota ?? null;
      a.tx = r.tx ?? [];
    } catch (erro) {
      a.n = 1; a.rs = 0; a.detalhes = [`o próprio alarme estourou: ${erro.message}`]; a.nota = null; a.tx = []; a.vazio = null;
    }
    a.disparou = !a.vazio && a.n > 0;
  });

  const disparados = ALARMES.filter((a) => a.disparou).sort((x, y) => y.rs - x.rs);
  const vazios = ALARMES.filter((a) => a.vazio);
  const ms = Date.now() - t0;
  const total = soma(disparados, (a) => a.rs);

  if (JSON_OUT) {
    console.log(JSON.stringify({
      gerado_em: new Date().toISOString(),
      duracao_ms: ms,
      limiares: LIMIARES,
      fontes: {
        clickup: clickup ? { lancamentos: clickup.lancamentos.length, sincronizado_em: clickup.syncedAt } : null,
        planilha: planilha ? { meses: Object.keys(planilha.totalMes).length, projecao: planilha.projecao.length, contrato: planilha.contrato.length } : null,
        asaas: asaas ? { cobrancas: asaas.length } : null,
        ledger: { ultimo_lancamento: horizonte.ultimo, pessoas: pessoas.lista.length }
      },
      alarmes: {
        total: ALARMES.length,
        disparados: disparados.length,
        sem_fonte: vazios.length,
        soma_por_alarme_cents: total,
        lista: ALARMES.map(({ executor, ...resto }) => resto)
      }
    }, null, 2));
  } else {
    const L = 76;
    const caixa = (t) => `│ ${t.slice(0, L - 2).padEnd(L - 2)} │`;
    console.log(`\n┌${'─'.repeat(L)}┐`);
    console.log(caixa(`ALARME DE DIVERGÊNCIA ENTRE FONTES — ${entidade.legal_name}`));
    console.log(caixa(`CNPJ ${entidade.cnpj} · ${new Date().toLocaleString('pt-BR')}`));
    console.log(caixa(''));
    console.log(caixa(`ledger até ${horizonte.ultimo} · clickup ${clickup ? `${num(clickup.lancamentos.length)} lançamentos` : 'AUSENTE'}`));
    console.log(caixa(`planilha ${planilha ? `${mesesPlanilha().length} meses preenchidos, ${planilha.roster.length} pessoas no roster` : 'AUSENTE'} · asaas ${asaas ? `${num(asaas.length)} cobranças` : 'AUSENTE'}`));
    console.log(`└${'─'.repeat(L)}┘`);

    let secaoAtual = null;
    for (const a of ALARMES) {
      if (a.secao !== secaoAtual) {
        secaoAtual = a.secao;
        console.log(`\n=== ${SECOES[a.secao]} ===`);
      }
      if (a.vazio) {
        console.log(`  ? [${a.id}] ${a.nome}`);
        console.log(`        sem fonte: ${a.vazio} — o alarme NÃO foi avaliado`);
        continue;
      }
      if (!a.disparou) {
        console.log(`  ✓ [${a.id}] ${a.nome}`);
        if (a.nota) console.log(`        nota:    ${a.nota}`);
        continue;
      }
      console.error(`  ✗ [${a.id}] ${a.nome}`);
      console.error(`        compara: ${a.compara}`);
      console.error(`        importa: ${a.porque}`);
      console.error(`        limiar:  ${a.limiar}`);
      console.error(`        agora:   ${num(a.n)} divergência(s)${a.rs ? ` · ${brl(a.rs)} em jogo` : ''}`);
      a.detalhes.slice(0, 14).forEach((d) => console.error(`        · ${d}`));
      if (a.detalhes.length > 14) console.error(`        · ... +${a.detalhes.length - 14}`);
      if (a.nota) console.error(`        nota:    ${a.nota}`);
    }

    console.log('\n' + '═'.repeat(78));
    console.log('DIVERGÊNCIAS ENCONTRADAS, POR R$');
    console.log('═'.repeat(78));
    if (!disparados.length) console.log('  nenhuma. todas as fontes concordam dentro dos limiares.');
    disparados.forEach((a, i) => {
      console.log(`  ${String(i + 1).padStart(2)}. ${brl(a.rs).padStart(18)}  [${a.id}] ${a.nome}`);
      console.log(`      ${''.padStart(18)}  ${num(a.n)} divergência(s) · limiar: ${a.limiar}`);
    });

    console.log('\n' + '═'.repeat(78));
    console.log('ESTADO DO CRUZAMENTO');
    console.log('═'.repeat(78));
    console.log(`  alarmes:      ${ALARMES.length - disparados.length - vazios.length} calados · ${disparados.length} disparados · ${vazios.length} sem fonte  (de ${ALARMES.length})`);
    console.log(`  R$ em jogo:   ${brl(total)} somando alarme a alarme`);
    console.log('                Este número NÃO é dinheiro distinto e não pode ser dito em voz alta como total.');
    console.log('                Fontes diferentes falam em parte do MESMO dinheiro e não há id comum para deduplicar:');
    console.log('                  · A1, A2 e A3 são a mesma pessoa vista por três fontes;');
    console.log('                  · B1 e B2 são os mesmos meses, detalhados e somados;');
    console.log('                  · F1 e F2 são as mesmas pessoas, individual e agregado.');
    console.log('                Leia cada alarme pelo seu próprio valor; a lista acima é a fila de trabalho.');
    console.log(`  cruzado em ${(ms / 1000).toFixed(1)} s sobre ${num(pessoas.lista.length)} pessoas e ${clickup ? num(clickup.lancamentos.length) : 0} lançamentos de ClickUp`);

    if (vazios.length) {
      console.log(`\n  ⚠ ${vazios.length} alarme(s) NÃO foram avaliados por falta de fonte:`);
      vazios.forEach((a) => console.log(`      [${a.id}] ${a.vazio}`));
      console.log('      Fonte ausente não é fonte concordante. Com --strict, isto também derruba a execução.');
    }
  }

  codigoSaida = disparados.length > 0 || (STRICT && vazios.length > 0) ? 1 : 0;
} finally {
  await pool.end();
}

process.exit(codigoSaida);

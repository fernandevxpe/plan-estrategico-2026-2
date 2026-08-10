// Semeia `fin_counterparty.default_category_id` a partir do histórico já
// classificado — e recusa semear quando o histórico não sustenta a conclusão.
//
// O QUE ESTE SCRIPT ESCREVE: duas colunas de fin_counterparty
// (default_category_id, default_nucleo), e nada mais. NÃO toca em
// fin_transaction, NÃO toca em fin_document, NÃO resolve item de fila. Essa
// limitação é deliberada: é ela que garante que nenhuma classificação existente
// — de máquina ou de humano — pode ser sobrescrita por esta rotina. O campo é
// uma SUGESTÃO cadastrada, não uma classificação aplicada.
//
// Uso:
//   node scripts/semear-categoria-padrao.mjs               dry-run (padrão)
//   node scripts/semear-categoria-padrao.mjs --aplicar     grava
//   node scripts/semear-categoria-padrao.mjs --limiar=0.80 --min-obs=5
//   node scripts/semear-categoria-padrao.mjs --amostra=40  amplia a conferência
//   node scripts/semear-categoria-padrao.mjs --recusas     lista todas as recusas
//
// ---------------------------------------------------------------------------
// AS QUATRO DECISÕES QUE FAZEM ESTE NÚMERO SER DIFERENTE DO ÓBVIO
// ---------------------------------------------------------------------------
//
// 1. A EVIDÊNCIA É fin_document, NUNCA fin_document + fin_transaction.
//    Medido: as 2.300 transações classificadas que têm contraparte são, todas
//    as 2.300, liquidações (fin_settlement) de um documento — com a MESMA
//    categoria e a MESMA contraparte. Somar as duas tabelas conta cada decisão
//    duas vezes: uma contraparte com um único documento aparece com "2
//    observações, 100% de dominância" e passa em qualquer limiar. É o jeito
//    mais fácil de transformar ruído em estatística.
//
// 2. DOCUMENTO CLASSIFICADO POR 'historico' NÃO É EVIDÊNCIA.
//    388 dos 2.961 documentos com contraparte foram classificados pelo estágio
//    'historico', que decide olhando... o histórico da contraparte. Usá-los
//    para medir dominância da contraparte é circular: o número se confirma
//    sozinho. 'favorecido' entra na mesma lista de exclusão por antecipação —
//    é o estágio que um dia vai CONSUMIR default_category_id, e se ele virasse
//    evidência a segunda execução deste script estaria medindo a primeira.
//
// 3. A DOMINÂNCIA É MEDIDA POR DIREÇÃO, E HOJE SÓ EXISTE UMA.
//    Os 3.350 documentos da base são 'receber'. Não há um único 'pagar'. Ou
//    seja: toda categoria dominante que este script consegue calcular é uma
//    categoria de RECEITA (3.xx). `default_category_id` não tem dimensão de
//    direção — é uma coluna só. Herdada num lançamento de saída, ela lança
//    despesa como receita. A guarda está em `recusaPorDirecao()`.
//
// 4. MÍNIMO DE OBSERVAÇÕES: n=8 PARA UM LIMIAR DE 90%.
//    Não é número redondo escolhido a gosto. Pela regra de sucessão de Laplace,
//    n acertos em n tentativas sustentam uma probabilidade posterior de
//    (n+1)/(n+2) para a próxima: n=1 → 67%, n=2 → 75%, n=3 → 80%, n=5 → 86%,
//    n=8 → 90%. Afirmar "90% de dominância" a partir de 2 documentos é afirmar
//    um número que o dado não contém. O mínimo é o menor n cuja evidência
//    alcança o limiar que o próprio script exige.
//
//    A validação leave-one-out abaixo NÃO substitui esse argumento — ela não
//    consegue nem opinar sobre contrapartes com 1 observação, porque removendo
//    a única observação não sobra evidência nenhuma. É justamente a faixa em
//    que a dominância de 100% é mais frequente e mais vazia.
import { randomUUID } from 'node:crypto';

import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';
import { registerFinanceTypeParsers } from './lib/fin-types.mjs';

loadEnv();
registerFinanceTypeParsers();

const APLICAR = process.argv.includes('--aplicar');
const LISTAR_RECUSAS = process.argv.includes('--recusas');
const arg = (nome, padrao) => {
  const hit = process.argv.find((a) => a.startsWith(`--${nome}=`));
  return hit ? Number(hit.slice(nome.length + 3)) : padrao;
};

const LIMIAR = arg('limiar', 0.9);
const MIN_OBS = arg('min-obs', 8);
const AMOSTRA = arg('amostra', 20);

/**
 * Categorias-balde. Semear "a classificar" como padrão de uma contraparte é
 * cadastrar a dívida de classificação em vez de pagá-la — e pior, faz o item
 * sair da fila parecendo resolvido.
 */
const BALDE = new Set(['3.99', '5.99']);

/**
 * Estágios cujo rótulo é INDEPENDENTE da contraparte. Ver decisão 2 no topo.
 */
const EVIDENCIA_INDEPENDENTE = ['humano', 'trava', 'fato_estrutural', 'contrato', 'regra'];

const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = (v) => `${(v * 100).toFixed(1)}%`;
const num = (n) => Number(n || 0).toLocaleString('pt-BR');

const pool = financePool();
const client = await pool.connect();

try {
  // -------------------------------------------------------------------------
  // 1. Evidência
  // -------------------------------------------------------------------------
  const { rows: evidencia } = await client.query(
    `SELECT d.counterparty_id AS cp, d.direction, d.category_id AS cat, c.code, c.name, d.nucleo
       FROM fin_document d
       JOIN fin_category c ON c.id = d.category_id
      WHERE d.counterparty_id IS NOT NULL
        AND d.category_id IS NOT NULL
        AND c.code <> ALL($1::text[])
        AND d.classified_by = ANY($2::text[])`,
    [[...BALDE], EVIDENCIA_INDEPENDENTE]
  );

  const { rows: descartadas } = await client.query(
    `SELECT COALESCE(d.classified_by, '(nulo)') AS estagio, count(*)::int AS n
       FROM fin_document d
       JOIN fin_category c ON c.id = d.category_id
      WHERE d.counterparty_id IS NOT NULL
        AND (d.classified_by IS NULL OR NOT (d.classified_by = ANY($1::text[])) OR c.code = ANY($2::text[]))
      GROUP BY 1 ORDER BY 2 DESC`,
    [EVIDENCIA_INDEPENDENTE, [...BALDE]]
  );

  const { rows: contrapartes } = await client.query(
    `SELECT id, name, kind, default_category_id, default_nucleo, is_active FROM fin_counterparty`
  );

  // Caixa por contraparte: é o que responde "esta contraparte aparece dos dois
  // lados?". Sem isto a guarda de direção só olharia documentos — e documento
  // de saída não existe nesta base, então a guarda nunca dispararia.
  const { rows: caixa } = await client.query(
    `SELECT t.counterparty_id AS cp,
            count(*) FILTER (WHERE t.amount_cents < 0)::int AS saidas,
            count(*) FILTER (WHERE t.amount_cents > 0)::int AS entradas,
            COALESCE(SUM(abs(t.amount_cents)) FILTER (WHERE t.amount_cents < 0), 0) AS valor_saida,
            count(*)::int AS lancamentos,
            -- Detector de identidade colapsada: quantos favorecidos DIFERENTES
            -- se escondem sob o mesmo cadastro. O extrato do Inter põe o nome
            -- da INSTITUIÇÃO em nomeRecebedor e o nome da pessoa na descrição,
            -- depois do travessão.
            count(DISTINCT lower(trim(split_part(t.description_raw, '—', 2))))
              FILTER (WHERE position('—' in t.description_raw) > 0)::int AS favorecidos
       FROM fin_transaction t
      WHERE t.counterparty_id IS NOT NULL
      GROUP BY 1`
  );
  const porCaixa = new Map(caixa.map((r) => [r.cp, r]));

  // -------------------------------------------------------------------------
  // 2. Contagem por contraparte × direção × categoria
  // -------------------------------------------------------------------------
  /** @type {Map<number, {total:number, direcoes:Map<string,{total:number, cats:Map<number,{n:number,code:string,name:string,nucleos:Map<string,number>}>}>}>} */
  const tally = new Map();
  for (const linha of evidencia) {
    if (!tally.has(linha.cp)) tally.set(linha.cp, { total: 0, direcoes: new Map() });
    const cp = tally.get(linha.cp);
    cp.total += 1;
    if (!cp.direcoes.has(linha.direction)) cp.direcoes.set(linha.direction, { total: 0, cats: new Map() });
    const dir = cp.direcoes.get(linha.direction);
    dir.total += 1;
    if (!dir.cats.has(linha.cat)) dir.cats.set(linha.cat, { n: 0, code: linha.code, name: linha.name, nucleos: new Map() });
    const cat = dir.cats.get(linha.cat);
    cat.n += 1;
    if (linha.nucleo) cat.nucleos.set(linha.nucleo, (cat.nucleos.get(linha.nucleo) ?? 0) + 1);
  }

  /**
   * Categoria dominante dentro de uma direção.
   *
   * Empate NÃO é dominância. Duas categorias com a mesma contagem descrevem uma
   * contraparte que compra duas coisas — exatamente o caso que não pode ser
   * semeado — e `ORDER BY n DESC LIMIT 1` escolheria uma delas em silêncio,
   * decidido por ordem de id.
   */
  function dominante(dir, limiar) {
    const lista = [...dir.cats.entries()].sort((a, b) => b[1].n - a[1].n);
    if (!lista.length) return null;
    const [catId, topo] = lista[0];
    const empate = lista.length > 1 && lista[1][1].n === topo.n;
    // Núcleo tem limiar PRÓPRIO, medido dentro da categoria dominante e não
    // sobre a contraparte inteira. Um cliente pode comprar sempre o mesmo
    // serviço e esse serviço ser entregue por dois núcleos; herdar o núcleo
    // majoritário nesse caso é inventar rateio.
    const nucleos = [...topo.nucleos.entries()].sort((a, b) => b[1] - a[1]);
    const nucleoEmpate = nucleos.length > 1 && nucleos[1][1] === nucleos[0][1];
    return {
      catId,
      code: topo.code,
      name: topo.name,
      n: topo.n,
      total: dir.total,
      share: topo.n / dir.total,
      empate,
      nucleo: nucleos.length && !nucleoEmpate && nucleos[0][1] / topo.n >= limiar ? nucleos[0][0] : null,
      mix: lista.map(([, c]) => `${c.code}×${c.n}`).join(' ')
    };
  }

  // -------------------------------------------------------------------------
  // 3. Curva de precisão — leave-one-out sobre a evidência independente
  // -------------------------------------------------------------------------
  //
  // Para cada documento classificado: esconde-o, recalcula a dominante da
  // contraparte com o que sobra e pergunta se ela teria acertado a categoria do
  // documento escondido. É a única medida de precisão possível sem gabarito
  // humano — e ela mede o que importa, que é o acerto na PRÓXIMA linha.
  //
  // Repare no que a curva não pode dizer: contraparte com 1 observação some da
  // amostra (tirando a única, não sobra evidência). Toda linha "min_obs=1" está
  // medindo contrapartes com 2 ou mais.
  function curva(limiares, minimos) {
    const saida = [];
    for (const minObs of minimos) {
      for (const limiar of limiares) {
        let elegiveis = 0;
        let acertos = 0;
        const cpsOk = new Set();
        const cpsErro = new Set();
        for (const linha of evidencia) {
          const dir = tally.get(linha.cp)?.direcoes.get(linha.direction);
          if (!dir) continue;
          const restante = dir.total - 1;
          if (restante < minObs) continue;
          let topo = -1;
          let vencedor = null;
          let empates = 0;
          for (const [catId, cat] of dir.cats) {
            const n = cat.n - (catId === linha.cat ? 1 : 0);
            if (n > topo) { topo = n; vencedor = catId; empates = 1; } else if (n === topo) empates += 1;
          }
          if (empates !== 1 || topo <= 0) continue;
          if (topo / restante < limiar) continue;
          elegiveis += 1;
          if (vencedor === linha.cat) { acertos += 1; cpsOk.add(linha.cp); } else cpsErro.add(linha.cp);
        }
        saida.push({
          limiar, minObs, elegiveis, acertos,
          precisao: elegiveis ? acertos / elegiveis : null,
          cps: cpsOk.size + cpsErro.size,
          cpsErro: cpsErro.size
        });
      }
    }
    return saida;
  }

  // -------------------------------------------------------------------------
  // 4. Decisão por contraparte
  // -------------------------------------------------------------------------
  /**
   * Ordem das guardas importa: a primeira que dispara é a que aparece no
   * relatório, então as mais informativas vêm antes das genéricas.
   *
   * Parametrizado por limiar/minObs porque a mesma função produz a tabela de
   * "quantas contrapartes por limiar" — a alternativa seria uma segunda
   * implementação da política, que divergiria da real na primeira alteração.
   */
  function decidir(limiar, minObs) {
    const decisoes = [];
    for (const cp of contrapartes) {
      const t = tally.get(cp.id);
      const c = porCaixa.get(cp.id) ?? { saidas: 0, entradas: 0, valor_saida: 0, lancamentos: 0, favorecidos: 0 };
      const base = { id: cp.id, nome: cp.name, kind: cp.kind, obs: t?.total ?? 0, caixa: c };

      // Já preenchido — decisão de alguém, e este script nunca a discute.
      if (cp.default_category_id !== null) { decisoes.push({ ...base, acao: 'ja_preenchido' }); continue; }

      // Identidade colapsada. Medido: a contraparte 349 "NU PAGAMENTOS - IP"
      // tem 226 lançamentos e 25 favorecidos distintos na descrição — o
      // importador do Inter gravou o nome do BANCO de destino (`nomeRecebedor`
      // vem da instituição no PIX), não o de quem recebeu. Semear uma categoria
      // aqui espalharia uma decisão sobre 25 pessoas diferentes de uma vez.
      if (c.favorecidos > 1 && c.lancamentos >= 3) {
        decisoes.push({ ...base, acao: 'recusa', motivo: 'identidade_colapsada',
          detalhe: `${c.favorecidos} favorecidos distintos sob o mesmo cadastro em ${c.lancamentos} lançamentos` });
        continue;
      }

      if (!t) {
        decisoes.push({ ...base, acao: 'recusa', motivo: 'sem_evidencia', detalhe: 'nenhum documento classificado' });
        continue;
      }

      // Evidência nas DUAS direções: recusa, mesmo que a categoria dominante
      // coincida. `default_category_id` é uma coluna só e não sabe dizer "isto
      // vale quando ela me paga, não quando eu pago a ela"; uma categoria 3.xx
      // herdada num lançamento negativo vira receita inventada na DRE. Hoje não
      // dispara (a base é 100% 'receber') e fica exatamente para o dia em que
      // contas a pagar existirem.
      if (t.direcoes.size > 1) {
        decisoes.push({ ...base, acao: 'recusa', motivo: 'evidencia_nas_duas_direcoes',
          detalhe: [...t.direcoes.entries()].map(([d, v]) => `${d}: ${v.total}`).join(' / ') });
        continue;
      }

      const [direcao, dir] = [...t.direcoes.entries()][0];
      const dom = dominante(dir, limiar);

      // A guarda de direção que de fato dispara nesta base. Evidência de
      // 'receber' descreve o que a contraparte COMPRA; um lançamento de saída
      // para ela é outra coisa (devolução, pró-labore, pagamento a quem também
      // é cliente). O caso real: #310, 26 documentos com 100% de dominância em
      // 3.07 e 24 saídas de caixa somando R$ 38.530,48.
      if (direcao === 'receber' && c.saidas > 0) {
        decisoes.push({ ...base, acao: 'recusa', motivo: 'direcao_ambigua',
          detalhe: `evidência só de 'receber' (${dom.n}/${dom.total}) mas ${c.saidas} saídas em caixa, ${brl(c.valor_saida)}` });
        continue;
      }

      if (dom.empate) { decisoes.push({ ...base, acao: 'recusa', motivo: 'empate', detalhe: dom.mix }); continue; }

      if (dom.total < minObs) {
        decisoes.push({ ...base, acao: 'recusa', motivo: 'poucas_observacoes',
          detalhe: `${dom.total} observação(ões), mínimo ${minObs}`, dom });
        continue;
      }

      if (dom.share < limiar) {
        decisoes.push({ ...base, acao: 'recusa', motivo: 'duas_categorias',
          detalhe: `dominância ${pct(dom.share)} em ${dom.total} obs — ${dom.mix}`, dom });
        continue;
      }

      decisoes.push({ ...base, acao: 'semear', dom, direcao, anterior: { nucleo: cp.default_nucleo } });
    }
    return decisoes;
  }

  const decisoes = decidir(LIMIAR, MIN_OBS);
  const semear = decisoes.filter((d) => d.acao === 'semear');
  const recusas = decisoes.filter((d) => d.acao === 'recusa');

  // -------------------------------------------------------------------------
  // 5. O que a semeadura alcançaria
  // -------------------------------------------------------------------------
  const ids = semear.map((d) => d.id);
  const { rows: [herdaria] } = await client.query(
    `SELECT
       count(*) FILTER (WHERE origem='documento')::int AS docs,
       COALESCE(SUM(valor) FILTER (WHERE origem='documento'), 0) AS docs_valor,
       count(*) FILTER (WHERE origem='lancamento')::int AS trx,
       COALESCE(SUM(valor) FILTER (WHERE origem='lancamento'), 0) AS trx_valor,
       count(*) FILTER (WHERE na_fila)::int AS fila,
       COALESCE(SUM(valor) FILTER (WHERE na_fila), 0) AS fila_valor
     FROM (
       SELECT 'documento' AS origem, d.amount_cents AS valor,
              EXISTS (SELECT 1 FROM fin_review_item ri
                       WHERE ri.target_table='fin_document' AND ri.target_id=d.id AND ri.status='pendente') AS na_fila
         FROM fin_document d
        WHERE d.category_id IS NULL AND d.counterparty_id = ANY($1::bigint[])
       UNION ALL
       SELECT 'lancamento', abs(t.amount_cents),
              EXISTS (SELECT 1 FROM fin_review_item ri
                       WHERE ri.target_table='fin_transaction' AND ri.target_id=t.id AND ri.status='pendente')
         FROM fin_transaction t
        WHERE t.category_id IS NULL AND t.counterparty_id = ANY($1::bigint[])
     ) x`,
    [ids.length ? ids : [0]]
  );

  const { rows: [fila] } = await client.query(
    `SELECT count(*)::int AS itens, COALESCE(SUM(abs(amount_cents)), 0) AS valor
       FROM fin_review_item WHERE status='pendente'`
  );

  // Fila alcançável, por contraparte — a base da tabela "por limiar".
  const { rows: filaPorCp } = await client.query(
    `SELECT COALESCE(d.counterparty_id, t.counterparty_id) AS cp,
            count(*)::int AS itens, COALESCE(SUM(abs(ri.amount_cents)), 0) AS valor
       FROM fin_review_item ri
       LEFT JOIN fin_document d ON ri.target_table='fin_document' AND d.id=ri.target_id
       LEFT JOIN fin_transaction t ON ri.target_table='fin_transaction' AND t.id=ri.target_id
      WHERE ri.status='pendente'
        AND COALESCE(d.counterparty_id, t.counterparty_id) IS NOT NULL
        AND COALESCE(d.category_id, t.category_id) IS NULL
      GROUP BY 1`
  );
  const porFila = new Map(filaPorCp.map((r) => [r.cp, r]));

  // Teto absoluto do método, independente de limiar: itens de fila cujo alvo
  // tem contraparte E não tem categoria. Nada fora disso é alcançável por
  // herança de contraparte, em nenhum cenário.
  const { rows: [teto] } = await client.query(
    `SELECT count(*)::int AS itens, COALESCE(SUM(abs(ri.amount_cents)), 0) AS valor
       FROM fin_review_item ri
       LEFT JOIN fin_document d ON ri.target_table='fin_document' AND d.id=ri.target_id
       LEFT JOIN fin_transaction t ON ri.target_table='fin_transaction' AND t.id=ri.target_id
      WHERE ri.status='pendente'
        AND COALESCE(d.counterparty_id, t.counterparty_id) IS NOT NULL
        AND COALESCE(d.category_id, t.category_id) IS NULL`
  );

  // -------------------------------------------------------------------------
  // 6. Relatório
  // -------------------------------------------------------------------------
  console.log(`\nSemeadura de categoria padrão por contraparte — ${APLICAR ? 'APLICAR' : 'DRY-RUN'}`);
  console.log(`Política: dominância ≥ ${pct(LIMIAR)} sobre ≥ ${MIN_OBS} observações, medida por direção\n`);

  console.log('BASE');
  console.log(`  contrapartes ................ ${num(contrapartes.length)} (${num(contrapartes.filter((c) => c.default_category_id !== null).length)} já com default_category_id)`);
  console.log(`  evidência ................... ${num(evidencia.length)} documentos, ${num(tally.size)} contrapartes`);
  for (const d of descartadas) console.log(`  fora da evidência ........... ${num(d.n)} documentos (${d.estagio})`);
  console.log(`  fila pendente ............... ${num(fila.itens)} itens, ${brl(fila.valor)}`);
  console.log(`  teto do método .............. ${num(teto.itens)} itens, ${brl(teto.valor)}  (têm contraparte e não têm categoria)`);

  console.log('\nCURVA DE PRECISÃO (leave-one-out; não enxerga contraparte com 1 observação)');
  console.log('  limiar  min_obs  docs testados  acerto   contrapartes  com ao menos 1 erro');
  for (const l of curva([1, 0.95, 0.9, 0.8, 0.7], [1, 3, 5, 8])) {
    console.log(
      `  ${pct(l.limiar).padStart(6)}  ${String(l.minObs).padStart(7)}  ${num(l.elegiveis).padStart(13)}  ` +
      `${(l.precisao === null ? '—' : pct(l.precisao)).padStart(6)}   ${String(l.cps).padStart(12)}  ${String(l.cpsErro).padStart(19)}`
    );
  }

  console.log('\nCONTRAPARTES SEMEADAS E FILA RESOLVIDA, POR POLÍTICA');
  console.log('  (a fila resolvida usa a MESMA função de decisão que a aplicação — não é estimativa à parte)');
  console.log('  limiar  min_obs  contrapartes  itens de fila            R$ da fila');
  for (const minObs of [1, 3, 5, 8]) {
    for (const limiar of [1, 0.95, 0.9, 0.8, 0.7]) {
      const alvo = decidir(limiar, minObs).filter((d) => d.acao === 'semear');
      const itens = alvo.reduce((s, d) => s + (porFila.get(d.id)?.itens ?? 0), 0);
      const valor = alvo.reduce((s, d) => s + (porFila.get(d.id)?.valor ?? 0), 0);
      console.log(
        `  ${pct(limiar).padStart(6)}  ${String(minObs).padStart(7)}  ${String(alvo.length).padStart(12)}  ` +
        `${String(itens).padStart(13)}  ${brl(valor).padStart(20)}`
      );
    }
  }

  console.log('\nDECISÃO');
  console.log(`  semear ...................... ${num(semear.length)} contrapartes`);
  const porMotivo = new Map();
  for (const r of recusas) porMotivo.set(r.motivo, (porMotivo.get(r.motivo) ?? 0) + 1);
  for (const [motivo, n] of [...porMotivo.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  recusa: ${motivo.padEnd(20, '.')} ${num(n)} contrapartes`);
  }

  console.log('\nALCANCE DA SEMEADURA');
  console.log(`  documentos sem categoria que herdariam ... ${num(herdaria.docs)}, ${brl(herdaria.docs_valor)}`);
  console.log(`  lançamentos sem categoria que herdariam .. ${num(herdaria.trx)}, ${brl(herdaria.trx_valor)}`);
  console.log(`  desses, itens HOJE na fila ............... ${num(herdaria.fila)}, ${brl(herdaria.fila_valor)}`);
  if (!herdaria.fila) {
    console.log('  ⚠ nenhum item da fila é alcançado: as contrapartes com histórico');
    console.log('    profundo o bastante para semear são justamente as que já estão');
    console.log('    classificadas. O ganho é prospectivo, não retroativo.');
  }
  console.log('  ⚠ default_category_id não tem NENHUM leitor no código hoje (nem a');
  console.log('    classificação, nem a tela de revisão). Semear não muda nenhum');
  console.log('    número enquanto o estágio "favorecido" não for construído.');

  const recusaGrave = recusas.filter((r) => r.motivo === 'direcao_ambigua' || r.motivo === 'identidade_colapsada');
  if (recusaGrave.length) {
    console.log('\nRECUSAS QUE VALEM DINHEIRO (passariam em qualquer limiar ingênuo)');
    for (const r of recusaGrave.sort((a, b) => b.caixa.valor_saida - a.caixa.valor_saida).slice(0, 10)) {
      console.log(`  #${r.id} ${r.nome}`);
      console.log(`      ${r.motivo}: ${r.detalhe}`);
    }
  }

  const duas = recusas.filter((r) => r.motivo === 'duas_categorias').sort((a, b) => b.obs - a.obs);
  if (duas.length) {
    console.log(`\nCONTRAPARTES COM DUAS CATEGORIAS LEGÍTIMAS (${num(duas.length)}; ${num(Math.min(12, duas.length))} maiores)`);
    // O #id não é enfeite: existem 4 cadastros "ARLINDO DA FONSECA LINS & CIA
    // LTDA" (filiais, CNPJ raiz 11601184, sufixos diferentes), e um deles é
    // semeado enquanto outro é recusado. Sem o id, as duas listas parecem se
    // contradizer.
    for (const r of duas.slice(0, 12)) console.log(`  ${String(r.obs).padStart(3)} obs  #${r.id} ${r.nome} — ${r.detalhe}`);
  }

  if (LISTAR_RECUSAS) {
    console.log('\nTODAS AS RECUSAS');
    for (const r of recusas.sort((a, b) => a.motivo.localeCompare(b.motivo) || b.obs - a.obs)) {
      console.log(`  [${r.motivo}] #${r.id} ${r.nome} — ${r.detalhe}`);
    }
  }

  console.log(`\nAMOSTRA PARA CONFERÊNCIA HUMANA (${num(Math.min(AMOSTRA, semear.length))} de ${num(semear.length)}, as de maior histórico)`);
  console.log('  #id  contraparte                                   categoria proposta               dom.    obs  núcleo');
  for (const s of [...semear].sort((a, b) => b.dom.total - a.dom.total).slice(0, AMOSTRA)) {
    console.log(
      `  ${String(s.id).padStart(3)}  ${s.nome.slice(0, 43).padEnd(45)} ${`${s.dom.code} ${s.dom.name}`.slice(0, 32).padEnd(32)} ` +
      `${pct(s.dom.share).padStart(6)}  ${String(s.dom.total).padStart(3)}  ${s.dom.nucleo ?? '—'}`
    );
  }

  // -------------------------------------------------------------------------
  // 7. Aplicação
  // -------------------------------------------------------------------------
  if (!APLICAR) {
    console.log('\nDry-run: nada gravado. Para gravar: node scripts/semear-categoria-padrao.mjs --aplicar\n');
  } else if (!semear.length) {
    console.log('\nNada a semear com esta política.\n');
  } else {
    const lote = randomUUID();
    await client.query('BEGIN');
    try {
      let gravadas = 0;
      for (const s of semear) {
        // `default_category_id IS NULL` no WHERE, e não só na decisão em
        // memória: entre a leitura e a escrita alguém pode ter cadastrado o
        // padrão pela tela, e a decisão humana vence sempre. Sem esta cláusula
        // a corrida é silenciosa e o humano perde.
        const { rowCount } = await client.query(
          `UPDATE fin_counterparty
              SET default_category_id = $2,
                  default_nucleo = COALESCE(default_nucleo, $3)
            WHERE id = $1 AND default_category_id IS NULL`,
          [s.id, s.dom.catId, s.dom.nucleo]
        );
        if (!rowCount) continue;
        gravadas += 1;
        // `before` guarda o valor REAL de antes, não `null` presumido: o UPDATE
        // usa COALESCE em default_nucleo, então uma contraparte que já tinha
        // núcleo cadastrado o mantém — e um desfazer que zerasse a coluna
        // apagaria um dado que este script não escreveu.
        await client.query(
          `INSERT INTO fin_audit_log (target_table, target_id, action, before, after, fields, batch_id, actor)
           VALUES ('fin_counterparty', $1, 'update', $2::jsonb, $3::jsonb,
                   ARRAY['default_category_id','default_nucleo'], $4, 'script:semear-categoria-padrao')`,
          [
            s.id,
            JSON.stringify({ default_category_id: null, default_nucleo: s.anterior.nucleo }),
            JSON.stringify({
              default_category_id: s.dom.catId, default_nucleo: s.anterior.nucleo ?? s.dom.nucleo,
              dominancia: s.dom.share, observacoes: s.dom.total, direcao: s.direcao,
              politica: { limiar: LIMIAR, min_obs: MIN_OBS }
            }),
            lote
          ]
        );
      }
      await client.query('COMMIT');
      console.log(`\n${num(gravadas)} contrapartes semeadas. Lote ${lote} — desfazer:`);
      console.log(`  UPDATE fin_counterparty c`);
      console.log(`     SET default_category_id = (a.before->>'default_category_id')::bigint,`);
      console.log(`         default_nucleo      = a.before->>'default_nucleo'`);
      console.log(`    FROM fin_audit_log a`);
      console.log(`   WHERE a.batch_id = '${lote}' AND a.target_table = 'fin_counterparty' AND a.target_id = c.id;\n`);
    } catch (erro) {
      await client.query('ROLLBACK');
      throw erro;
    }
  }
} finally {
  client.release();
  await pool.end();
}

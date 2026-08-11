// Semeia o modelo de gestão: as linhas da planilha do dono e de onde vem cada número.
//
// A ESTRUTURA é cópia fiel da aba "Fluxo de Caixa" (113 linhas, hierarquia de
// três níveis). Fiel de propósito, inclusive nas linhas que hoje somam zero:
// "Licenças de Hardware" e "Usina Solar" estão zeradas em 2026, mas são linhas
// de negócio que o dono planeja ocupar. Apagá-las porque o extrato ainda não as
// conhece transformaria a plataforma numa foto do passado.
//
// O MAPEAMENTO é a parte que exige julgamento, e onde eu posso estar errado.
// Cada linha declara `confianca`:
//
//   exata     o número do ledger bate com o da planilha (conferido, não suposto)
//   alta      a correspondência é de definição — Simples Nacional é 7.01, ponto
//   media     a categoria cobre a linha, mas pode conter outras coisas
//   sem_fonte a planilha tem a linha e o ledger não tem como alimentá-la
//
// `sem_fonte` não é falha de mapeamento: é informação. "Depreciação" não existe
// no ledger porque depreciação não passa em extrato bancário — ela nasce de uma
// tabela de ativos que a empresa não mantém. A tela precisa dizer isso, em vez
// de mostrar zero e deixar o leitor concluir que a empresa não deprecia nada.
//
// Uso:
//   node scripts/semear-modelo.mjs            dry-run (padrão)
//   node scripts/semear-modelo.mjs --aplicar
import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';

loadEnv();

const APLICAR = process.argv.includes('--aplicar');
const ENTIDADE = 'xpe';

/**
 * As linhas, na ordem da planilha.
 *
 * `l` é a linha de origem na aba Fluxo de Caixa — para quando o dono perguntar
 * "de onde saiu isso", a resposta ser verificável e não uma lembrança minha.
 *
 * `mapa` lista os critérios do ledger. Cada critério é `'codigo'` ou
 * `'codigo@nucleo'` ou `'codigo!nucleo'` (tudo menos aquele núcleo).
 */
const LINHAS = [
  // ---------------------------------------------------------------- RECEITA
  { slug: 'receita', nome: 'Fontes de Receita (+)', secao: 'receita', tipo: 'subtotal', l: 5 },

  { slug: 'assinatura', nome: '1. Assinatura (Low Cost)', pai: 'receita', secao: 'receita', tipo: 'subtotal', l: 9 },
  { slug: 'monitor-mono', nome: 'Monitor BT - Monofásico 50A', pai: 'assinatura', secao: 'receita', l: 10, confianca: 'sem_fonte' },
  { slug: 'monitor-tri', nome: 'Monitor BT - Trifásico 50/100A', pai: 'assinatura', secao: 'receita', l: 11, mapa: ['3.07'], confianca: 'media' },
  { slug: 'monitor-at', nome: 'Monitor BT/AT - Trifásico 600A', pai: 'assinatura', secao: 'receita', l: 12, confianca: 'sem_fonte' },
  { slug: 'gateways', nome: 'Gateways', pai: 'assinatura', secao: 'receita', l: 13, confianca: 'sem_fonte' },
  { slug: 'fatufacil', nome: 'Fatufácil', pai: 'assinatura', secao: 'receita', l: 14, mapa: ['3.09'], confianca: 'media' },
  { slug: 'mensalidades-recuperadas', nome: 'Mensalidades Recuperadas', pai: 'assinatura', secao: 'receita', l: 15, confianca: 'sem_fonte' },

  { slug: 'locacao-usinas', nome: '2.1 Locação de Usinas', pai: 'receita', secao: 'receita', tipo: 'subtotal', l: 17 },
  { slug: 'locacao-lotes', nome: 'Locação de Usinas - Lotes/PJ/PF [B2B]', pai: 'locacao-usinas', secao: 'receita', l: 18, mapa: ['3.06'], confianca: 'exata' },
  { slug: 'adiantamento-licenca', nome: 'Adiantamento da Licença [BRA]', pai: 'locacao-usinas', secao: 'receita', l: 19, confianca: 'sem_fonte' },
  { slug: 'comissao-setta', nome: 'Comissão Setta', pai: 'locacao-usinas', secao: 'receita', l: 20, confianca: 'sem_fonte' },

  { slug: 'licencas-hardware', nome: '2. Licenças de Hardware', pai: 'receita', secao: 'receita', tipo: 'subtotal', l: 22 },
  { slug: 'licenca-medidores', nome: 'Licença de Medidores Vendidos', pai: 'licencas-hardware', secao: 'receita', l: 25, confianca: 'sem_fonte' },
  { slug: 'emaas', nome: 'Energy Management as a Service', pai: 'licencas-hardware', secao: 'receita', l: 26, confianca: 'sem_fonte' },

  { slug: 'consultorias', nome: '3. Consultorias com Base em Economia', pai: 'receita', secao: 'receita', tipo: 'subtotal', l: 29 },
  { slug: 'adequacao-tarifaria', nome: 'Adequação Tarifária / Correção de FP', pai: 'consultorias', secao: 'receita', l: 30, mapa: ['3.10'], confianca: 'media' },
  { slug: 'consultorias-avulsas', nome: 'Consultorias Avulsas', pai: 'consultorias', secao: 'receita', l: 31, mapa: ['3.01'], confianca: 'media' },
  { slug: 'obras', nome: 'Obras', pai: 'consultorias', secao: 'receita', l: 32, mapa: ['3.05', '3.11', '3.04', '3.14'], confianca: 'media' },
  { slug: 'consultoria-condominios', nome: 'Consultoria Condomínios', pai: 'consultorias', secao: 'receita', l: 33, mapa: ['3.03', '3.02'], confianca: 'media' },
  { slug: 'auditorias', nome: 'Auditorias de Solar e Mercado Livre', pai: 'consultorias', secao: 'receita', l: 34, confianca: 'sem_fonte' },
  { slug: 'comissao-ml', nome: 'Comissão Mercado Livre', pai: 'consultorias', secao: 'receita', l: 35, mapa: ['3.08'], confianca: 'exata' },

  { slug: 'usina-solar', nome: '4. Usina Solar (Comissão de Vendas)', pai: 'receita', secao: 'receita', tipo: 'subtotal', l: 36 },
  { slug: 'indicacao-usina', nome: 'Indicação e Orçamentos de Usina Solar', pai: 'usina-solar', secao: 'receita', l: 37, confianca: 'sem_fonte' },

  { slug: 'autonomos', nome: '5. Profissionais Autônomos', pai: 'receita', secao: 'receita', tipo: 'subtotal', l: 39 },
  { slug: 'locacao-micromedidores', nome: 'Locação de Micromedidores Inteligentes', pai: 'autonomos', secao: 'receita', l: 40, confianca: 'sem_fonte' },
  { slug: 'relatorios-analise', nome: 'Relatórios - Análise de Dados e Propostas', pai: 'autonomos', secao: 'receita', l: 41, confianca: 'sem_fonte' },
  { slug: 'aluguel-analisador', nome: 'Aluguel do Analisador de Energia', pai: 'autonomos', secao: 'receita', l: 42, confianca: 'sem_fonte' },
  { slug: 'patrocinios', nome: 'Patrocínios de Eventos', pai: 'autonomos', secao: 'receita', l: 43, mapa: ['3.12'], confianca: 'alta' },

  { slug: 'fin-energytech', nome: '7. FIN-ENERGYTECH (Mercado Livre)', pai: 'receita', secao: 'receita', tipo: 'subtotal', l: 46 },
  { slug: 'billing-locacao', nome: 'Billing - Faturamento Locação de Usinas', pai: 'fin-energytech', secao: 'receita', l: 47, confianca: 'sem_fonte' },
  { slug: 'gateway-split', nome: 'Gateway/Split de Pagamento de Serviços', pai: 'fin-energytech', secao: 'receita', l: 48, confianca: 'sem_fonte' },

  // -------------------------------------------------------------- DEDUÇÕES
  { slug: 'deducoes', nome: 'Churn, Inadimplência, Depreciação e Impostos (-)', secao: 'deducao', tipo: 'subtotal', l: 50 },

  { slug: 'churn', nome: 'Churn', pai: 'deducoes', secao: 'deducao', l: 52, mapa: ['3.90'], confianca: 'media' },
  { slug: 'inadimplencia', nome: 'Inadimplência', pai: 'deducoes', secao: 'deducao', l: 57, confianca: 'sem_fonte' },

  { slug: 'impostos', nome: 'Impostos', pai: 'deducoes', secao: 'deducao', tipo: 'subtotal', l: 62 },
  { slug: 'simples-nacional', nome: 'Simples Nacional (DAS)', pai: 'impostos', secao: 'deducao', l: 64, mapa: ['7.01'], confianca: 'alta' },
  { slug: 'parcelamento-irpj', nome: 'Parcelamento IRPJ e CSLL', pai: 'impostos', secao: 'deducao', l: 65, mapa: ['7.03'], confianca: 'alta' },
  { slug: 'inss', nome: 'INSS', pai: 'impostos', secao: 'deducao', l: 66, mapa: ['6.03'], confianca: 'alta' },
  { slug: 'cim', nome: 'CIM / ISS', pai: 'impostos', secao: 'deducao', l: 67, mapa: ['7.02'], confianca: 'alta' },

  { slug: 'depreciacao', nome: 'Depreciação', pai: 'deducoes', secao: 'deducao', tipo: 'subtotal', l: 68 },
  { slug: 'depreciacao-hardware', nome: 'Depreciação, Amortização e Reparo sobre Hardwares', pai: 'depreciacao', secao: 'deducao', l: 69, confianca: 'sem_fonte' },

  { slug: 'despesa-financeira', nome: 'Despesa Financeira', pai: 'deducoes', secao: 'deducao', tipo: 'subtotal', l: 70 },
  { slug: 'emprestimo-inter', nome: 'Pagamento do Empréstimo Inter', pai: 'despesa-financeira', secao: 'deducao', l: 71, confianca: 'sem_fonte' },
  { slug: 'emprestimo-caixa', nome: 'Pagamento do Empréstimo Caixa', pai: 'despesa-financeira', secao: 'deducao', l: 72, mapa: ['9.04'], confianca: 'media' },
  // Sem `l`: a planilha não separa juros do principal do empréstimo, o ledger
  // separa. Dar a esta linha a origem 72 faria duas linhas disputarem a mesma
  // célula de referência na importação.
  { slug: 'juros-multas', nome: 'Juros e multas pagos', pai: 'despesa-financeira', secao: 'deducao', mapa: ['9.11'], confianca: 'alta' },
  { slug: 'tarifas-bancarias', nome: 'Tarifas Bancárias', pai: 'despesa-financeira', secao: 'deducao', l: 73, mapa: ['4.05'], confianca: 'alta' },
  // Entra positiva dentro de um grupo negativo, e é assim que deve ser: o
  // rendimento da aplicação abate a despesa financeira do mês. A planilha não
  // tem a linha; o extrato tem o dinheiro.
  { slug: 'rendimentos', nome: 'Rendimentos de aplicação', pai: 'despesa-financeira', secao: 'deducao', mapa: ['9.10'], confianca: 'alta' },

  // -------------------------------------------------------- CUSTOS OPERAÇÃO
  { slug: 'custo-operacao', nome: 'Custos Operação (-)', secao: 'custo_operacao', tipo: 'subtotal', l: 74 },

  { slug: 'cac', nome: 'CAC - Custo de Aquisição do Cliente Total', pai: 'custo-operacao', secao: 'custo_operacao', tipo: 'subtotal', l: 76 },
  { slug: 'cac-vendas', nome: 'Custo de Aquisição de Cliente (Vendas)', pai: 'cac', secao: 'custo_operacao', l: 77, mapa: ['4.01'], confianca: 'alta' },
  { slug: 'placas-smtf', nome: 'Compra de Placas para SMTF', pai: 'cac', secao: 'custo_operacao', l: 78, confianca: 'sem_fonte' },
  { slug: 'placas-gateway', nome: 'Compra de Placas para Gateways', pai: 'cac', secao: 'custo_operacao', l: 79, confianca: 'sem_fonte' },
  { slug: 'placas-controlador', nome: 'Compra de Placas para o Controlador de Carregadores', pai: 'cac', secao: 'custo_operacao', l: 80, confianca: 'sem_fonte' },
  { slug: 'componentes-garras', nome: 'Componentes e Garras para SMTF', pai: 'cac', secao: 'custo_operacao', l: 81, confianca: 'sem_fonte' },
  { slug: 'componentes-gerais', nome: 'Componentes em geral', pai: 'cac', secao: 'custo_operacao', l: 82, confianca: 'sem_fonte' },
  { slug: 'impostos-importacao', nome: 'Impostos sobre Compra de Medidores e Importações', pai: 'cac', secao: 'custo_operacao', l: 83, confianca: 'sem_fonte' },
  { slug: 'materiais-obras', nome: 'Materiais de Obras', pai: 'cac', secao: 'custo_operacao', l: 84, mapa: ['4.02'], confianca: 'alta' },
  { slug: 'ferramentas', nome: 'Custo de Aquisição de Ferramentas', pai: 'cac', secao: 'custo_operacao', l: 85, confianca: 'sem_fonte' },
  { slug: 'material-projetos', nome: 'Custo de Material para Projetos/Execução', pai: 'cac', secao: 'custo_operacao', l: 86, mapa: ['4.03'], confianca: 'media' },
  { slug: 'arts', nome: 'Custo ARTs', pai: 'cac', secao: 'custo_operacao', l: 87, mapa: ['5.10'], confianca: 'media' },
  { slug: 'deslocamento-obra', nome: 'Deslocamento atribuível a serviço', pai: 'cac', secao: 'custo_operacao', l: 88, mapa: ['4.04'], confianca: 'alta' },

  { slug: 'operacao-cloud', nome: 'Custo de Operação e Manutenção Cloud', pai: 'custo-operacao', secao: 'custo_operacao', tipo: 'subtotal', l: 91 },
  { slug: 'cloud-servico', nome: 'Custo de Operação do Serviço (Cloud)', pai: 'operacao-cloud', secao: 'custo_operacao', l: 92, mapa: ['5.03'], confianca: 'media' },
  { slug: 'kore-lyra', nome: 'Custo Kore/Lyra', pai: 'operacao-cloud', secao: 'custo_operacao', l: 93, confianca: 'sem_fonte' },
  { slug: 'recargas', nome: 'Custo Recargas', pai: 'operacao-cloud', secao: 'custo_operacao', l: 94, confianca: 'sem_fonte' },

  { slug: 'gestao-faturamento', nome: 'Custos de Gestão, Faturamento, NF e Backup', pai: 'custo-operacao', secao: 'custo_operacao', tipo: 'subtotal', l: 96 },
  { slug: 'gestao-asaas', nome: 'Gestão Asaas', pai: 'gestao-faturamento', secao: 'custo_operacao', l: 97, confianca: 'sem_fonte' },
  { slug: 'emissao-nfe', nome: 'Custo de emissão de NF-e', pai: 'gestao-faturamento', secao: 'custo_operacao', l: 98, confianca: 'sem_fonte' },

  // ----------------------------------------------------------- CUSTOS FIXOS
  { slug: 'custo-fixo', nome: 'Custos Fixos (-)', secao: 'custo_fixo', tipo: 'subtotal', l: 100 },

  { slug: 'escritorio', nome: 'Escritório, Jurídico, Contábil e Outros', pai: 'custo-fixo', secao: 'custo_fixo', tipo: 'subtotal', l: 102 },
  { slug: 'escritorio-infra', nome: 'Escritório (água, luz, internet, infra)', pai: 'escritorio', secao: 'custo_fixo', l: 103, mapa: ['5.01', '5.02', '5.08'], confianca: 'alta' },
  { slug: 'juridico-contabil', nome: 'Jurídico e Contábil', pai: 'escritorio', secao: 'custo_fixo', l: 104, mapa: ['5.04'], confianca: 'alta' },
  { slug: 'material-escritorio', nome: 'Material de Escritório', pai: 'escritorio', secao: 'custo_fixo', l: 105, mapa: ['5.07'], confianca: 'alta' },

  { slug: 'ajuda-custos', nome: 'Ajuda de Custos', pai: 'custo-fixo', secao: 'custo_fixo', tipo: 'subtotal', l: 106 },
  // A separação Base × Obras é por NÚCLEO, não por categoria: as duas usam
  // 6.01/6.02/6.06. Sem `!obras` a folha inteira cairia em "Equipe Base" e a
  // margem de obras ficaria alta demais, que é exatamente o erro que a planilha
  // de hoje comete.
  { slug: 'equipe-base', nome: 'Equipe Base (Hardware, Software, Mkt-Vendas)', pai: 'ajuda-custos', secao: 'custo_fixo', l: 107, mapa: ['6.01!obras', '6.02!obras', '6.06!obras', '6.08!obras'], confianca: 'media' },
  { slug: 'equipe-obras', nome: 'Equipe Obras', pai: 'ajuda-custos', secao: 'custo_fixo', l: 108, mapa: ['6.01@obras', '6.02@obras', '6.06@obras', '6.08@obras'], confianca: 'media' },
  { slug: 'admin-time', nome: 'Despesas Administrativas do Time', pai: 'ajuda-custos', secao: 'custo_fixo', l: 109, mapa: ['6.07'], confianca: 'media' },
  { slug: 'trafego-social', nome: 'Gestão de Tráfego e Redes Sociais', pai: 'ajuda-custos', secao: 'custo_fixo', l: 110, mapa: ['5.05'], confianca: 'media' },
  { slug: 'midia', nome: 'Investimento em Mídia', pai: 'ajuda-custos', secao: 'custo_fixo', l: 111, confianca: 'sem_fonte' },
  { slug: 'eventos', nome: 'Investimento em Eventos', pai: 'ajuda-custos', secao: 'custo_fixo', l: 112, confianca: 'sem_fonte' },
  { slug: 'adiantamento-lucro-obras', nome: 'Adiantamento de Lucro Obras', pai: 'ajuda-custos', secao: 'custo_fixo', l: 113, mapa: ['9.05'], confianca: 'media' },

  { slug: 'custos-variaveis', nome: 'Custos Variáveis', pai: 'custo-fixo', secao: 'custo_fixo', tipo: 'subtotal', l: 114 },
  { slug: 'alimentacao-transporte', nome: 'Alimentação, Transporte e Reembolsos', pai: 'custos-variaveis', secao: 'custo_fixo', l: 115, mapa: ['6.04!obras', '6.05!obras', '5.06'], confianca: 'media' },
  { slug: 'alimentacao-obras', nome: 'Alimentação, Transporte e Reembolso de Obras', pai: 'custos-variaveis', secao: 'custo_fixo', l: 116, mapa: ['6.04@obras', '6.05@obras'], confianca: 'media' },
  { slug: 'comissoes-parceiros', nome: 'Comissões e Taxas de Parceiros', pai: 'custos-variaveis', secao: 'custo_fixo', l: 117, confianca: 'sem_fonte' },
  { slug: 'cartao-credito', nome: 'Cartão de Crédito', pai: 'custos-variaveis', secao: 'custo_fixo', l: 119, confianca: 'sem_fonte' },
  { slug: 'reforma-sala', nome: 'Reforma da Sala', pai: 'custos-variaveis', secao: 'custo_fixo', l: 120, mapa: ['8.02'], confianca: 'media' },
  // Existe no ledger e não na planilha. Sem esta linha, R$ 84 mil de despesa
  // desapareceriam da tela — e a soma da DRE deixaria de fechar com o extrato.
  { slug: 'a-classificar', nome: 'Despesa ainda não classificada', pai: 'custos-variaveis', secao: 'custo_fixo', mapa: ['5.99'], confianca: 'alta' },
  { slug: 'recuperacao-despesa', nome: 'Recuperação de despesa', pai: 'custos-variaveis', secao: 'custo_fixo', mapa: ['9.02'], confianca: 'alta' },

  // ------------------------------------------------------------- RESULTADO
  { slug: 'ebitda', nome: 'EBITDA (+)', secao: 'resultado', tipo: 'calculado', l: 121 }
];

const pool = financePool();
const client = await pool.connect();
const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

try {
  await client.query('BEGIN');

  const { rows: [ent] } = await client.query(`SELECT id FROM fin_entity WHERE slug = $1`, [ENTIDADE]);
  if (!ent) throw new Error(`entidade ${ENTIDADE} não existe`);

  // Recriar em vez de atualizar: o mapeamento é a definição do modelo, e uma
  // definição parcialmente atualizada é pior que uma refeita. Os valores
  // digitados pelo dono vivem em fin_model_value e não são tocados aqui.
  await client.query(`DELETE FROM fin_model_line WHERE entity_id = $1`, [ent.id]);

  const idPorSlug = new Map();
  let ordem = 0;

  for (const L of LINHAS) {
    const { rows: [linha] } = await client.query(
      `INSERT INTO fin_model_line (entity_id, slug, name, parent_slug, section, kind, sort_order, origem_linha)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [ent.id, L.slug, L.nome, L.pai ?? null, L.secao, L.tipo ?? 'item', (ordem += 10), L.l ?? null]
    );
    idPorSlug.set(L.slug, linha.id);

    for (const criterio of L.mapa ?? []) {
      const m = criterio.match(/^([\d.]+)(?:([@!])([a-z-]+))?$/);
      if (!m) throw new Error(`critério ilegível em ${L.slug}: ${criterio}`);
      const [, code, op, nucleo] = m;
      await client.query(
        `INSERT INTO fin_model_map (entity_id, line_id, category_code, nucleo, nucleo_excluir, observacao)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [ent.id, linha.id, code, nucleo ?? null, op === '!', L.confianca ?? null]
      );
    }
  }

  // ---------------------------------------------------------------- provas
  //
  // Uma categoria em duas linhas soma o mesmo dinheiro duas vezes e infla o
  // resultado sem que nada pareça errado. É o erro mais caro que este arquivo
  // pode conter, então ele é verificado aqui e não confiado à revisão.
  const { rows: dup } = await client.query(
    `SELECT category_code, COALESCE(nucleo,'*') nucleo, nucleo_excluir,
            string_agg(l.slug, ', ' ORDER BY l.slug) linhas
       FROM fin_model_map m JOIN fin_model_line l ON l.id = m.line_id
      WHERE m.entity_id = $1
      GROUP BY 1,2,3 HAVING count(*) > 1`,
    [ent.id]
  );
  if (dup.length) {
    for (const d of dup) console.error(`  DUPLA CONTAGEM  ${d.category_code} → ${d.linhas}`);
    throw new Error(`${dup.length} categoria(s) mapeada(s) em mais de uma linha`);
  }

  // Categoria com movimento e sem linha: dinheiro que a tela não mostraria.
  const { rows: orfas } = await client.query(
    `SELECT c.code, c.name, count(t.id) n, sum(t.amount_cents) v
       FROM fin_category c
       JOIN fin_transaction t ON t.category_id = c.id
        AND t.posted_on >= date_trunc('year', now()) AND t.transfer_status = 'nao'
      WHERE NOT EXISTS (SELECT 1 FROM fin_model_map m WHERE m.entity_id = c.entity_id AND m.category_code = c.code)
      GROUP BY 1,2 ORDER BY abs(sum(t.amount_cents)) DESC`,
    []
  );

  const { rows: [totLinhas] } = await client.query(`SELECT count(*) n FROM fin_model_line WHERE entity_id = $1`, [ent.id]);
  const { rows: [totMapa] } = await client.query(`SELECT count(*) n FROM fin_model_map WHERE entity_id = $1`, [ent.id]);

  console.log(`\n  linhas do modelo: ${totLinhas.n}`);
  console.log(`  critérios de mapeamento: ${totMapa.n}`);
  console.log(`  linhas sem fonte no ledger: ${LINHAS.filter((l) => l.confianca === 'sem_fonte').length}`);

  if (orfas.length) {
    console.log('\n  CATEGORIAS COM MOVIMENTO E SEM LINHA NO MODELO:');
    orfas.forEach((o) => console.log(`    ${o.code.padEnd(7)}${String(o.name).slice(0, 40).padEnd(42)}${String(o.n).padStart(5)}  ${brl(o.v).padStart(14)}`));
  } else {
    console.log('\n  toda categoria com movimento tem linha no modelo.');
  }

  if (APLICAR) {
    await client.query('COMMIT');
    console.log('\n  COMMIT — gravado.\n');
  } else {
    await client.query('ROLLBACK');
    console.log('\n  ROLLBACK — dry-run. Use --aplicar.\n');
  }
} catch (e) {
  await client.query('ROLLBACK');
  console.error('abortado, nada gravado:', e.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}

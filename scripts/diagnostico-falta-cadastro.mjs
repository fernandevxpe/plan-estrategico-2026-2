// Tudo que o mês tem a pagar e NÃO dá para pagar — e o que falta em cada caso.
//
//   npm run falta:cadastro            competência seguinte
//   npm run falta:cadastro 2026-09    uma competência específica
//
// SÓ LEITURA. Nenhuma chave é impressa.
//
// ---------------------------------------------------------------------------
// ESPELHA A TELA, E POR ISSO SÃO DUAS FONTES
// ---------------------------------------------------------------------------
// A aba de Contas a pagar monta o mês de dois lugares, e este relatório precisa
// dos mesmos dois para os números baterem:
//
//   PESSOAS   do CADASTRO de cada um (`fin_pessoa_salario_base`,
//             `fin_pessoa_prolabore_esperado`, `fin_pessoa_comissao_declarada`,
//             `fin_reembolso_saldo_unificado_v`), uma banda por natureza.
//   O RESTO   de `fin_agenda_dia_v`, que já resolve a dupla contagem entre
//             documento, recorrente, folha e cartão.
//
// A coordenada de pagamento é buscada por QUALQUER contraparte confirmada da
// pessoa (0169), não só a primária — foi assim que Gabriel e Igor deixaram de
// aparecer como "sem chave".
import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';

loadEnv();

const arg = process.argv.find((a) => /^\d{4}-\d{2}$/.test(a));
const agora = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
const prox = new Date(agora.getFullYear(), agora.getMonth() + 1, 1);
const MES = arg ?? `${prox.getFullYear()}-${String(prox.getMonth() + 1).padStart(2, '0')}`;

const pool = financePool();
const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

// ---------------------------------------------------------------- 1. pessoas
const { rows: pessoas } = await pool.query(
  `WITH alvo AS (SELECT to_date($1,'YYYY-MM') AS mes),
   coord AS (
     SELECT DISTINCT ON (p.id) p.id AS person_id, pa.id AS payee_id
       FROM fin_person p
       JOIN fin_payee_account pa ON pa.is_default AND pa.is_active
        AND (pa.counterparty_id = p.counterparty_id
             OR pa.counterparty_id IN (SELECT l.counterparty_id FROM fin_person_counterparty l
                                        WHERE l.person_id=p.id AND l.status='confirmado'))
      ORDER BY p.id, (pa.counterparty_id = p.counterparty_id) DESC, pa.id DESC
   )
   SELECT p.name AS favorecido, p.area,
          COALESCE(sb.valor_cents,0) AS salario,
          COALESCE(pe.valor_cents,0) AS prolabore,
          COALESCE(cd.cents,0)       AS comissao,
          COALESCE(re.cents,0)       AS reembolso
     FROM fin_person p
     JOIN fin_entity e ON e.id=p.entity_id AND e.slug='xpe'
     CROSS JOIN alvo
     LEFT JOIN coord ON coord.person_id = p.id
     LEFT JOIN LATERAL (SELECT valor_cents FROM fin_pessoa_salario_base b
                         WHERE b.person_id=p.id AND b.vigente_desde<=alvo.mes
                         ORDER BY b.vigente_desde DESC LIMIT 1) sb ON TRUE
     LEFT JOIN LATERAL (SELECT valor_cents FROM fin_pessoa_prolabore_esperado x
                         WHERE x.person_id=p.id AND x.vigente_desde<=alvo.mes
                         ORDER BY x.vigente_desde DESC LIMIT 1) pe ON TRUE
     LEFT JOIN LATERAL (SELECT SUM(valor_cents)::bigint AS cents FROM fin_pessoa_comissao_declarada c
                         WHERE c.person_id=p.id AND c.competencia=alvo.mes) cd ON TRUE
     LEFT JOIN LATERAL (SELECT SUM(valor_parcela_cents)::bigint AS cents FROM fin_reembolso_saldo_unificado_v r
                         WHERE r.person_id=p.id AND NOT r.quitado AND r.parcelas_restantes>=1) re ON TRUE
    WHERE p.status='ativo' AND coord.payee_id IS NULL
      AND (COALESCE(sb.valor_cents,0)+COALESCE(pe.valor_cents,0)
         + COALESCE(cd.cents,0)+COALESCE(re.cents,0)) > 0
    ORDER BY 3+4+5+6 DESC`,
  [MES]
);

// ------------------------------------------------------------ 2. o resto
const { rows: outros } = await pool.query(
  `SELECT COALESCE(v.contraparte, '(sem favorecido identificado)') AS favorecido,
          v.counterparty_id IS NULL AS sem_favorecido,
          COALESCE(v.categoria, 'sem categoria') AS categoria,
          count(*)::int AS linhas,
          SUM(v.valor_cents)::bigint AS cents,
          bool_or(v.entra_no_total) AS soma
     FROM fin_agenda_dia_v v
     JOIN fin_entity e ON e.id = v.entity_id AND e.slug='xpe'
     LEFT JOIN fin_payee_account pa
            ON pa.counterparty_id = v.counterparty_id AND pa.is_default AND pa.is_active
    WHERE v.direcao='pagar'
      AND v.dia >= to_date($1,'YYYY-MM') AND v.dia < (to_date($1,'YYYY-MM') + interval '1 month')
      AND v.realizado_em IS NULL
      AND pa.id IS NULL
      AND COALESCE(v.categoria_code,'') NOT LIKE '6.%'
      AND v.camada <> 'pagar_folha'
    GROUP BY 1,2,3
    ORDER BY 5 DESC`,
  [MES]
);

console.log(`\nFALTA CADASTRAR PARA PAGAR — competência ${MES}\n`);

let totalPessoas = 0;
if (pessoas.length) {
  console.log(`PESSOAS — ${pessoas.length} sem coordenada de pagamento\n`);
  console.log('  pessoa                        salário    pró-lab.   comissão   reemb.       total');
  for (const p of pessoas) {
    const t = Number(p.salario) + Number(p.prolabore) + Number(p.comissao) + Number(p.reembolso);
    totalPessoas += t;
    console.log(
      `  ${String(p.favorecido).slice(0, 28).padEnd(28)} ${brl(p.salario).padStart(9)} ${brl(p.prolabore).padStart(10)} ` +
        `${brl(p.comissao).padStart(10)} ${brl(p.reembolso).padStart(9)} ${brl(t).padStart(11)}`
    );
  }
  console.log(`  ${''.padEnd(28)} ${''.padStart(40)} ${brl(totalPessoas).padStart(11)}`);
  console.log('\n  → secrets/chaves-pix.txt, depois `npm run chaves:importar:aplicar`');
}

const somam = outros.filter((o) => o.soma);
const naoSomam = outros.filter((o) => !o.soma);
const somaDe = (l) => l.reduce((s, o) => s + Number(o.cents), 0);

if (somam.length) {
  console.log(`\nFORNECEDORES E CUSTOS que JÁ CONTAM no mês — ${somam.length}\n`);
  for (const o of somam) {
    console.log(
      `  ${String(o.favorecido).slice(0, 34).padEnd(34)} ${brl(o.cents).padStart(11)}  ${String(o.categoria).slice(0, 26)}` +
        (o.sem_favorecido ? '   ← sem favorecido, nem dá para cadastrar chave' : '')
    );
  }
  console.log(`  ${''.padEnd(34)} ${brl(somaDe(somam)).padStart(11)}`);
}

if (naoSomam.length) {
  console.log(`\nRECORRENTES A CONFIRMAR (não somam no total até alguém decidir) — ${naoSomam.length}\n`);
  for (const o of naoSomam) {
    console.log(
      `  ${String(o.favorecido).slice(0, 34).padEnd(34)} ${brl(o.cents).padStart(11)}  ${String(o.categoria).slice(0, 26)}`
    );
  }
  console.log(`  ${''.padEnd(34)} ${brl(somaDe(naoSomam)).padStart(11)}`);
}

console.log(
  `\n  TOTAL travado por cadastro: R$ ${brl(totalPessoas + somaDe(somam) + somaDe(naoSomam))}\n` +
    `    pessoas R$ ${brl(totalPessoas)} · fornecedores que contam R$ ${brl(somaDe(somam))} · ` +
    `recorrentes a confirmar R$ ${brl(somaDe(naoSomam))}\n`
);

await pool.end();

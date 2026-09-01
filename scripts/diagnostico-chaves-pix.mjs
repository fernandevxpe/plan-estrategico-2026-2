// Quem dá para pagar por PIX hoje, quem não dá, e o que falta em cada caso.
// SÓ LEITURA. Nenhuma chave é impressa inteira — só o tipo e os quatro últimos.
//
//   npm run chaves:pix              todas as pessoas ativas
//   npm run chaves:pix -- --falta   só quem ainda não dá para pagar
//
// ---------------------------------------------------------------------------
// SÃO DUAS TABELAS, E A DIFERENÇA IMPORTA
// ---------------------------------------------------------------------------
// `fin_payee_account` (0001) é a coordenada que o PAGAMENTO lê. É ela que
// decide se a linha da tela fica selecionável.
//
// `fin_person_pagamento` (0159) é o que a PESSOA cadastrou no app do time. Não
// paga ninguém sozinha — precisa ser levada para a outra por
// `npm run pix:pessoa:aplicar`. E a 0159 é explícita sobre por que não é
// automático: "chave que a própria pessoa digitou e ninguém olhou não deveria
// entrar num lote automático". `conferido_em` é esse olhar.
//
// A terceira origem não é tabela: é o EXTRATO. `npm run favorecidos:inter`
// extrai `chavePixRecebedor` dos PIX já enviados — chave que JÁ RECEBEU, que
// é a mais confiável das três porque o banco a validou com dinheiro.
//
// ---------------------------------------------------------------------------
// POR QUE A CONTRAPARTE PODE NÃO SER A "PRINCIPAL"
// ---------------------------------------------------------------------------
// A 0169 permite N contrapartes por pessoa (o MEI recebe no CNPJ, a pessoa
// aparece no CPF). A coordenada pode estar em qualquer uma delas, e a busca
// atravessa `fin_person_counterparty` com `status='confirmado'` — vínculo
// proposto é palpite do casador automático, e palpite não escolhe para onde o
// dinheiro vai.
import { financePool } from './lib/artifact-db.mjs';
import { loadEnv } from './lib/env.mjs';

loadEnv();

const SO_FALTA = process.argv.includes('--falta');
const pool = financePool();
const brl = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
const cauda = (s) => (s ? `…${String(s).trim().slice(-4)}` : '');

const mes = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
const proximo = new Date(mes.getFullYear(), mes.getMonth() + 1, 1);
const competencia = `${proximo.getFullYear()}-${String(proximo.getMonth() + 1).padStart(2, '0')}`;

const { rows } = await pool.query(
  `WITH alvo AS (SELECT to_date($1,'YYYY-MM') AS mes),
   -- A coordenada que o pagamento lê, por QUALQUER contraparte confirmada.
   coord AS (
     SELECT DISTINCT ON (p.id)
            p.id AS person_id, pa.pix_address_key_type AS tipo,
            pa.pix_address_key AS chave, pa.label
       FROM fin_person p
       JOIN fin_payee_account pa
         ON pa.is_default AND pa.is_active
        AND (pa.counterparty_id = p.counterparty_id
             OR pa.counterparty_id IN (SELECT l.counterparty_id FROM fin_person_counterparty l
                                        WHERE l.person_id = p.id AND l.status = 'confirmado'))
      ORDER BY p.id, (pa.counterparty_id = p.counterparty_id) DESC, pa.id DESC
   ),
   -- O que a pessoa cadastrou no app.
   app AS (
     SELECT person_id, pix_tipo, pix_chave, (conferido_em IS NOT NULL) AS conferida
       FROM fin_person_pagamento WHERE metodo = 'pix'
        AND nullif(btrim(coalesce(pix_chave,'')),'') IS NOT NULL
   ),
   -- Quanto ela recebe no mês, para priorizar quem falta.
   prev AS (
     SELECT p.id AS person_id,
            COALESCE(sb.valor_cents,0) + COALESCE(pe.valor_cents,0)
          + COALESCE(cd.cents,0) + COALESCE(re.cents,0) AS cents
       FROM fin_person p CROSS JOIN alvo
       LEFT JOIN LATERAL (SELECT valor_cents FROM fin_pessoa_salario_base b
                           WHERE b.person_id=p.id AND b.vigente_desde<=alvo.mes
                           ORDER BY b.vigente_desde DESC LIMIT 1) sb ON TRUE
       LEFT JOIN LATERAL (SELECT valor_cents FROM fin_pessoa_prolabore_esperado e
                           WHERE e.person_id=p.id AND e.vigente_desde<=alvo.mes
                           ORDER BY e.vigente_desde DESC LIMIT 1) pe ON TRUE
       LEFT JOIN LATERAL (SELECT SUM(valor_cents)::bigint AS cents FROM fin_pessoa_comissao_declarada c
                           WHERE c.person_id=p.id AND c.competencia=alvo.mes) cd ON TRUE
       LEFT JOIN LATERAL (SELECT SUM(valor_parcela_cents)::bigint AS cents FROM fin_reembolso_saldo_unificado_v r
                           WHERE r.person_id=p.id AND NOT r.quitado AND r.parcelas_restantes>=1) re ON TRUE
   )
   SELECT p.name AS pessoa, p.area AS vinculo,
          coord.tipo AS coord_tipo, coord.chave AS coord_chave, coord.label AS coord_origem,
          app.pix_tipo AS app_tipo, app.pix_chave AS app_chave, app.conferida AS app_conferida,
          COALESCE(prev.cents,0) AS previsto
     FROM fin_person p
     JOIN fin_entity e ON e.id = p.entity_id AND e.slug='xpe'
     LEFT JOIN coord ON coord.person_id = p.id
     LEFT JOIN app   ON app.person_id   = p.id
     LEFT JOIN prev  ON prev.person_id  = p.id
    WHERE p.status = 'ativo'
    ORDER BY (coord.chave IS NOT NULL), COALESCE(prev.cents,0) DESC, p.name`,
  [competencia]
);

const podem = rows.filter((r) => r.coord_chave);
const faltam = rows.filter((r) => !r.coord_chave);
const aSincronizar = faltam.filter((r) => r.app_chave);
const semNada = faltam.filter((r) => !r.app_chave);

console.log(`\nChaves PIX das pessoas ativas — previsto de ${competencia}\n`);

if (!SO_FALTA && podem.length) {
  console.log(`JÁ DÁ PARA PAGAR — ${podem.length} pessoa(s)\n`);
  for (const r of podem) {
    console.log(
      `  ✓ ${String(r.pessoa).slice(0, 28).padEnd(28)} ${String(r.coord_tipo).padEnd(5)} ${cauda(r.coord_chave).padEnd(6)} ` +
        `R$ ${brl(r.previsto).padStart(10)}   ${String(r.coord_origem ?? '').slice(0, 34)}`
    );
  }
}

if (aSincronizar.length) {
  console.log(`\nCADASTRARAM NO APP, FALTA LEVAR PARA O PAGAMENTO — ${aSincronizar.length}\n`);
  for (const r of aSincronizar) {
    console.log(
      `  → ${String(r.pessoa).slice(0, 28).padEnd(28)} ${String(r.app_tipo).padEnd(9)} ${cauda(r.app_chave).padEnd(6)} ` +
        `R$ ${brl(r.previsto).padStart(10)}   ${r.app_conferida ? 'conferida pelo financeiro' : 'NÃO conferida'}`
    );
  }
  console.log('\n    Resolve com: npm run pix:pessoa:aplicar');
  console.log('    (a 0159 avisa: chave que ninguém olhou não deveria entrar em lote automático)');
}

if (semNada.length) {
  console.log(`\nSEM CHAVE EM LUGAR NENHUM — ${semNada.length}\n`);
  let total = 0;
  for (const r of semNada) {
    total += Number(r.previsto);
    console.log(
      `  ✗ ${String(r.pessoa).slice(0, 28).padEnd(28)} ${String(r.vinculo ?? '—').padEnd(10)} R$ ${brl(r.previsto).padStart(10)}`
    );
  }
  console.log(`\n    R$ ${brl(total)} do mês depende destas ${semNada.length}.`);
  console.log('    Dois caminhos: elas cadastram a chave no app do time (/time/perfil),');
  console.log('    ou você faz UM PIX por chave para cada uma — aí o extrato passa a');
  console.log('    trazer a chavePixRecebedor e `npm run favorecidos:inter:aplicar` as pega.');
  console.log('    (hoje elas recebem por dados bancários, e nesse formato não há chave)');
}

console.log(
  `\n  ${podem.length}/${rows.length} pessoas ativas pagáveis por PIX · ` +
    `${aSincronizar.length} a um comando de distância · ${semNada.length} sem chave\n`
);

await pool.end();

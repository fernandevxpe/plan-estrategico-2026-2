import "server-only";

import { query } from "./db";

/**
 * O QUE CADA PESSOA VAI RECEBER NUM MÊS, PELO CADASTRO — uma fonte só.
 *
 * ===========================================================================
 * POR QUE ESTE MÓDULO EXISTE
 * ===========================================================================
 * Porque a mesma pergunta estava sendo respondida em três lugares com contas
 * diferentes, e as três telas discordavam:
 *
 *   `lib/financeiro/time.ts` (app da pessoa)   cadastro, vigência por mês
 *   `lib/financeiro/pessoas.ts` (Custo com pessoas)  cadastro, vigência sem filtro
 *   `contas-a-pagar.ts` (esta aba, até 31/08)  MOLDE do último mês realizado
 *
 * A terceira era a minha, e era a errada. Medido em 31/08/2026 para set/26,
 * 15 das 26 pessoas divergiam:
 *
 *   Audrey     cadastro R$ 5.642,00   molde R$ 6.442,98   −R$ 800,98
 *   Gabriel    cadastro R$ 12.863,66  molde R$ 13.921,93  −R$ 1.058,27
 *   Fernando   cadastro R$ 7.450,76   molde R$ 6.281,26   +R$ 1.169,50
 *   Kevin      cadastro R$ 1.000,00   molde R$ 0,00       +R$ 1.000,00
 *   TOTAL      cadastro R$ 101.288,16 molde R$ 103.154,76
 *
 * O molde arrasta para frente o que não se repete — o reembolso de agosto da
 * Audrey (R$ 1.025,98) e uma comissão avulsa (R$ 417) viravam previsão de
 * setembro — e ignora quem não recebeu no mês-molde (Kevin some).
 *
 * `lib/financeiro/time.ts:2095` já tinha escrito a regra, e eu a repeti errada:
 * "'Quanto costumo receber' é história; 'quanto vou receber' é cadastro."
 *
 * O dono fechou a questão em 31/08: "custo com pessoas e custos da empresa deve
 * ser a exata mesma base de dados". Uma fonte, um módulo, e quem quiser
 * discordar precisa mudar aqui — onde a mudança atinge as duas telas juntas.
 *
 * ===========================================================================
 * A VIGÊNCIA É RESOLVIDA PARA O MÊS PEDIDO
 * ===========================================================================
 * E não pelo `DISTINCT ON` sem filtro de data, que pega a linha mais recente
 * exista ela quando existir. A diferença só aparece quando alguém cadastra
 * reajuste com data futura — e é justamente aí que ela é cara: um aumento
 * marcado para outubro apareceria já em setembro. O app faz certo desde 29/08
 * (`vigenteEm`, time.ts:2116); aqui a regra passa a ser a mesma.
 *
 * Medido hoje: zero linhas de salário base ou pró-labore com vigência futura.
 * Ou seja, a correção não muda nenhum número AGORA — ela impede o erro na
 * primeira vez que alguém cadastrar um reajuste antes de ele valer.
 *
 * ===========================================================================
 * O QUE NÃO ESTÁ AQUI
 * ===========================================================================
 * Estágio e "extra". `fin_time_remuneracao_mes_v` os separa porque LÊ O
 * LEDGER — ela sabe o que aconteceu. O cadastro tem quatro naturezas, e é o
 * que ele tem. Inventar uma banda de estágio a partir de um salário base
 * cadastrado seria fabricar composição.
 */

/** As quatro naturezas que o CADASTRO conhece, na ordem do pagamento. */
export const NATUREZAS_CADASTRO = ["salario", "prolabore", "comissao", "reembolso"] as const;
export type NaturezaCadastro = (typeof NATUREZAS_CADASTRO)[number];

export type PrevisaoPessoaMes = {
  personId: number;
  pessoa: string;
  counterpartyId: number | null;
  mes: string;
  salarioCents: number;
  prolaboreCents: number;
  comissaoCents: number;
  reembolsoCents: number;
  totalCents: number;
};

/*
 * O SQL mora numa constante porque `pessoas.ts` e `contas-a-pagar.ts` o usam, e
 * duas cópias divergem no primeiro ajuste. `$1` é a entidade, `$2` é o mês em
 * 'YYYY-MM'.
 *
 * Reembolso vem de `fin_reembolso_saldo_unificado_v` (0179), que une a planilha
 * e os pedidos do app — as duas metades que a casa contava separadas.
 */
export const SQL_PREVISAO_CADASTRO = `
  WITH alvo AS (SELECT to_date($2, 'YYYY-MM') AS mes),
  sal AS (
    SELECT DISTINCT ON (b.person_id) b.person_id, b.valor_cents
      FROM fin_pessoa_salario_base b CROSS JOIN alvo
     WHERE b.vigente_desde <= alvo.mes
     ORDER BY b.person_id, b.vigente_desde DESC, b.id DESC
  ),
  pro AS (
    SELECT DISTINCT ON (e.person_id) e.person_id, e.valor_cents
      FROM fin_pessoa_prolabore_esperado e CROSS JOIN alvo
     WHERE e.vigente_desde <= alvo.mes
     ORDER BY e.person_id, e.vigente_desde DESC, e.id DESC
  ),
  com AS (
    SELECT cd.person_id, SUM(cd.valor_cents)::bigint AS valor_cents
      FROM fin_pessoa_comissao_declarada cd CROSS JOIN alvo
     WHERE cd.competencia = alvo.mes
     GROUP BY cd.person_id
  ),
  ree AS (
    SELECT person_id, SUM(valor_parcela_cents)::bigint AS valor_cents
      FROM fin_reembolso_saldo_unificado_v
     WHERE NOT quitado AND parcelas_restantes >= 1
     GROUP BY person_id
  )
  SELECT p.id                                   AS person_id,
         p.name                                 AS pessoa,
         p.counterparty_id,
         -- 'YYYY-MM-01' porque é o formato que as bandas de pessoas.ts usam.
         to_char(alvo.mes, 'YYYY-MM-01')        AS mes,
         COALESCE(sal.valor_cents, 0)::bigint   AS salario_cents,
         COALESCE(pro.valor_cents, 0)::bigint   AS prolabore_cents,
         COALESCE(com.valor_cents, 0)::bigint   AS comissao_cents,
         COALESCE(ree.valor_cents, 0)::bigint   AS reembolso_cents
    FROM fin_person p
    JOIN fin_entity ent ON ent.id = p.entity_id AND ent.slug = $1
    CROSS JOIN alvo
    LEFT JOIN sal ON sal.person_id = p.id
    LEFT JOIN pro ON pro.person_id = p.id
    LEFT JOIN com ON com.person_id = p.id
    LEFT JOIN ree ON ree.person_id = p.id
   WHERE (COALESCE(sal.valor_cents, 0)
        + COALESCE(pro.valor_cents, 0)
        + COALESCE(com.valor_cents, 0)
        + COALESCE(ree.valor_cents, 0)) > 0
   ORDER BY p.name
`;

/** A previsão de um mês ('YYYY-MM') para todas as pessoas com cadastro. */
export async function getPrevisaoCadastro(entitySlug: string, mes: string): Promise<PrevisaoPessoaMes[]> {
  const rows = await query<Record<string, unknown>>(SQL_PREVISAO_CADASTRO, [entitySlug, mes]).catch(
    () => [] as Record<string, unknown>[]
  );

  return rows.map((r) => {
    const salarioCents = Number(r.salario_cents ?? 0);
    const prolaboreCents = Number(r.prolabore_cents ?? 0);
    const comissaoCents = Number(r.comissao_cents ?? 0);
    const reembolsoCents = Number(r.reembolso_cents ?? 0);
    return {
      personId: Number(r.person_id),
      pessoa: String(r.pessoa ?? ""),
      counterpartyId: r.counterparty_id == null ? null : Number(r.counterparty_id),
      mes: String(r.mes),
      salarioCents,
      prolaboreCents,
      comissaoCents,
      reembolsoCents,
      totalCents: salarioCents + prolaboreCents + comissaoCents + reembolsoCents
    };
  });
}

/** As bandas não-zero de uma pessoa, na ordem do pagamento. Cada uma vira um PIX. */
export function bandasDe(p: PrevisaoPessoaMes): { natureza: NaturezaCadastro; cents: number }[] {
  return (
    [
      { natureza: "salario" as const, cents: p.salarioCents },
      { natureza: "prolabore" as const, cents: p.prolaboreCents },
      { natureza: "comissao" as const, cents: p.comissaoCents },
      { natureza: "reembolso" as const, cents: p.reembolsoCents }
    ] satisfies { natureza: NaturezaCadastro; cents: number }[]
  ).filter((b) => b.cents > 0);
}

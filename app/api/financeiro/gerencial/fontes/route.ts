import { getFontes } from "@/lib/financeiro/contratos/fontes";
import { responderContrato, rotaDeLeitura } from "@/lib/financeiro/contratos/http";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/financeiro/gerencial/fontes
 *
 * "Quais fontes não estão atualizadas?" — a lista, com o motivo de cada uma.
 *
 * O QUE ESTA ROTA DIZ QUE A DE COBERTURA NÃO DIZ
 *
 * `/gerencial/cobertura` responde por CONTA: ela lê
 * `fin_account.last_statement_at` e pergunta "esta conta fecha e está em dia?".
 * Esta responde por FONTE, e a diferença não é organizacional — foi ela que
 * produziu o defeito. O aviso antigo lia a data da conta e a atribuía a cada
 * fonte que já a alimentou, o que gerava cinco avisos idênticos para três
 * contas e dizia que `import_csv` tinha dado de 15/08 quando o último arquivo
 * dela é de 07/08 (Nubank) e 31/07 (caixinhas).
 *
 * E ela traz o relógio que faltava: `ultimaTentativaEm`. Sem ele "a sync
 * quebrou" e "o banco não teve movimento" têm a mesma cara, e a segunda é o
 * caso normal de uma segunda-feira.
 *
 * SOMENTE LEITURA. O disparo é POST em `fontes/sincronizar`, e só admin — como
 * tudo sob `/api/financeiro`, que `lib/auth/perfis.ts` marca como só-admin e o
 * middleware devolve 404, não 403, para o perfil comum.
 */
export const GET = rotaDeLeitura(async () => {
  return responderContrato(await getFontes());
});

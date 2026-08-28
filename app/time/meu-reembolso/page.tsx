import { redirect } from "next/navigation";

/**
 * `/time/meu-reembolso` virou `/time/recebiveis`.
 *
 * Ela respondia três coisas: quanto falta, quando cai, e o que já foi pago. A
 * terceira era duplicata de Recebíveis — com um número DIFERENTE, porque lia a
 * folha (`fin_reimbursement`, R$ 37.587 em 2026) enquanto Recebíveis lê o
 * ledger (categoria 6.05, R$ 12.286). Em julho a folha diz R$ 6.960 e o ledger
 * diz zero.
 *
 * Duas telas com dois números para o mesmo dinheiro fariam 14 pessoas
 * desconfiarem do app na primeira comparação — e essa confiança não volta com
 * um patch. As duas primeiras perguntas (quanto falta, quando cai) viveram para
 * Recebíveis, na seção "ainda a receber".
 *
 * Redirect e não 404: é o precedente que `/time/nota` já abriu aqui, e o card
 * "A receber" do Início apontava para cá.
 */
export default function MeuReembolsoPage() {
  redirect("/time/reembolsos");
}

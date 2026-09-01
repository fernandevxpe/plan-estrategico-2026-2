/**
 * O ritmo do envio ao Inter — num módulo que os DOIS lados podem importar.
 *
 * O valor vivia em `inter-pagamento.ts`, que lê certificado do disco e não
 * atravessa para o cliente. A tela então declarava o seu próprio 6.500, e a
 * duplicata tem uma consequência silenciosa: mudar a lib faz o servidor mudar o
 * ritmo e a barra de progresso continuar prometendo o tempo antigo. O usuário vê
 * "~2 min" e espera quatro, sem nada dizendo que a conta mudou.
 *
 * Aqui não há import de nada — nem `server-only`, nem `node:*` — então serve ao
 * servidor e ao navegador. Mesma razão de `contas-a-pagar-eixos.ts`.
 */

/**
 * Quanto esperar entre um pagamento e o seguinte.
 *
 * Medido em 01/09/2026, primeiro lote real: 38 ordens sem intervalo nenhum, 27
 * saíram e 11 ficaram em rascunho. O Inter limita ~10 chamadas por minuto, e o
 * cliente de leitura da casa (`scripts/lib/inter.mjs:19`) já esperava 7s por
 * isso — a lição não tinha atravessado para o lado da escrita.
 *
 * 6,5s fica um pouco abaixo dos 7s do extrato (aqui é uma chamada por ordem, não
 * paginada) e acima dos 6,0s que 10/min exigiria — pela mesma razão que a leitura
 * escolheu 7: o teto é do banco, e não há como medir quanto dele outro processo
 * já gastou.
 *
 * O custo é tempo: 38 ordens levam ~4 minutos. É por isso que a tela mostra
 * progresso, e é preferível a um lote que sai pela metade sem avisar.
 */
export const INTERVALO_ENTRE_PAGAMENTOS_MS = 6_500;

/** "~3 min" / "~40s". Usado na estimativa de quanto falta. */
export function tempoAproximadoMs(ms: number): string {
  if (ms <= 0) return "instantes";
  const seg = Math.round(ms / 1000);
  if (seg < 90) return `~${seg}s`;
  return `~${Math.round(seg / 60)} min`;
}

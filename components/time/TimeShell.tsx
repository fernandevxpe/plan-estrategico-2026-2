"use client";

/**
 * Casco do app do time.
 *
 * ---------------------------------------------------------------------------
 * POR QUE NÃO HÁ MAIS BARRA INFERIOR
 * ---------------------------------------------------------------------------
 * Existiu barra de cinco destinos (Recebíveis, Registrar, Início, Reembolso,
 * Histórico) porque o polegar alcança embaixo e o app é usado com uma mão,
 * na rua, com a outra segurando a nota. Antes disso foram sete abas no topo
 * — 210px de menu numa tela de 852px.
 *
 * A barra saiu quando o Início passou a ser o índice completo: as mesmas
 * portas + Minhas compras + pendências.
 *
 * ---------------------------------------------------------------------------
 * O QUE SOBROU NO CABEÇALHO — TRÊS ALVOS, NÃO CINCO
 * ---------------------------------------------------------------------------
 * Depois da barra, o topo virou fila de cinco: foto, nome, casa "Início",
 * sol do tema e pílula "Pedir compra". Em 415px o nome da pessoa não cabia —
 * saía truncado como "Fer…" — e nenhum dos cinco era o alvo óbvio.
 *
 * Ficaram três, na ordem em que a mão procura:
 *
 *   ← voltar      seta à esquerda, destino declarado por tela (`VOLTA` em
 *                 TimeApp). Não é `router.back()`: quem entra pelo atalho do
 *                 PWA não tem passo anterior nosso, e back() sai do app.
 *   foto + nome   link para `/time/perfil` — PÁGINA, não folha deslizante.
 *                 Lá moram nome, e-mail, foto, a conta que recebe, Aparência
 *                 (claro/escuro) e Sair.
 *   + Reembolso   o atalho fixo, à direita. Ação semanal do time.
 *
 * Saíram: "Início" (voltar cobre, e de `/time/item/…` o destino certo é o
 * Histórico, não o hub), o sol (escolha feita uma vez, não paga largura
 * diária) e "Pedir compra" (zero pedidos em 7 meses — desceu para o bloco
 * Compras do Início).
 */
export function TimeShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="time-shell">
      <div className="time-conteudo">{children}</div>
    </div>
  );
}

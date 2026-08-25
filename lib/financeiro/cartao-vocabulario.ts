import "server-only";

import { isFinanceConfigured, query } from "./db";

/**
 * As listas fechadas que a tela de cartões oferece para qualificar.
 *
 * Separado do contrato (`contratos/cartao-painel.ts`) de propósito: aquilo é
 * MEDIDA — números que mudam a cada compra e que a tela apresenta. Isto é
 * VOCABULÁRIO — o conjunto de respostas válidas, que muda quando alguém cria
 * uma categoria nova, não quando alguém gasta.
 *
 * Vive fora do contrato também porque não tem cobertura nem frescor para
 * declarar: uma lista de categorias não fica "desatualizada há 9 dias", ela
 * está certa ou o schema mudou.
 */

export type VocabularioCartao = {
  categorias: { id: number; rotulo: string }[];
  nucleos: { slug: string; nome: string }[];
  centros: { id: number; nome: string; ehProjeto: boolean }[];
};

const VAZIO: VocabularioCartao = { categorias: [], nucleos: [], centros: [] };

export async function getVocabularioCartao(): Promise<VocabularioCartao> {
  if (!isFinanceConfigured()) return VAZIO;

  try {
    const [categorias, nucleos, centros] = await Promise.all([
      query<{ id: number; code: string; name: string }>(
        `SELECT c.id, c.code, c.name
           FROM fin_category c
           JOIN fin_entity e ON e.id = c.entity_id AND e.slug = 'xpe'
          WHERE c.is_active
          ORDER BY c.code`
      ),
      // `is_active` aqui também: os quatro núcleos estão ativos hoje, mas
      // oferecer um núcleo desativado para qualificar seria criar dado que a
      // tela seguinte não sabe mostrar. `sort_order` é a ordem que a casa
      // definiu para eles — alfabética inventaria outra.
      query<{ slug: string; name: string }>(
        `SELECT slug, name FROM fin_nucleo WHERE is_active ORDER BY sort_order, name`
      ),
      // Projeto antes de área funcional, e por nome dentro de cada grupo: quem
      // qualifica um gasto de cartão está quase sempre procurando a obra, não
      // "Administrativo".
      query<{ id: number; name: string; kind: string }>(
        `SELECT cc.id, cc.name, cc.kind
           FROM fin_cost_center cc
           JOIN fin_entity e ON e.id = cc.entity_id AND e.slug = 'xpe'
          WHERE cc.is_active
          ORDER BY (cc.kind = 'projeto') DESC, cc.name`
      )
    ]);

    return {
      categorias: categorias.map((c) => ({ id: Number(c.id), rotulo: `${c.code} ${c.name}` })),
      nucleos: nucleos.map((n) => ({ slug: n.slug, nome: n.name })),
      centros: centros.map((c) => ({ id: Number(c.id), nome: c.name, ehProjeto: c.kind === "projeto" }))
    };
  } catch {
    // Sem vocabulário a tela ainda mostra os números; só não deixa qualificar.
    // Derrubar a página inteira por causa disso seria trocar uma função por
    // todas as outras.
    return VAZIO;
  }
}

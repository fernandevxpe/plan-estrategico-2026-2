import { getAuditoria } from "@/lib/financeiro/contratos";
import {
  ParametroInvalido,
  comRessalvas,
  inteiroDe,
  responderContrato,
  rotaDeLeitura,
  textoDe
} from "@/lib/financeiro/contratos/http";

import { contagem } from "../_medido";
import { bandeiraEstritaDe, dataEstritaDe, paginacaoDe } from "../_parametros";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `$?::uuid` com texto qualquer estoura no Postgres com uma mensagem que não diz nada ao chamador. */
function loteDe(sp: URLSearchParams): string | undefined {
  const bruto = textoDe(sp, "loteId", 36);
  if (!bruto) return undefined;
  if (!UUID.test(bruto)) throw new ParametroInvalido("loteId", "loteId deve ser um UUID");
  return bruto;
}

/**
 * O fim do dia, para `ate` significar o que qualquer chamador quer que signifique.
 *
 * `created_at` é timestamp; `ate=2026-08-16` comparado cru contra `<=` recorta em
 * 00:00 e devolve ZERO evento do dia 16. `?de=X&ate=X` voltaria vazio, e vazio
 * aqui é indistinguível de "ninguém mexeu em nada naquele dia" — que é
 * exatamente a leitura errada numa trilha de auditoria.
 */
function fimDoDia(data: string | undefined): string | undefined {
  return data ? `${data} 23:59:59.999999` : undefined;
}

/**
 * GET /api/financeiro/gerencial/auditoria
 *   ?tabela=&alvoId=&ator=&acao=&loteId=&de=&ate=&apenasLotes=&pagina=&porPagina=
 *
 * A trilha: quem mudou o quê, quando, e o que havia antes.
 *
 * O DIFF É RESOLVIDO NO SERVIDOR, DE PROPÓSITO
 *
 * `mudancas[]` chega pronto — `{campo, de, para}` por campo tocado — em vez dos
 * dois JSON inteiros. Mandar `before` e `after` crus transportaria o dobro do
 * payload e faria cada consumidor reimplementar a mesma comparação, com o risco
 * de dois consumidores discordarem sobre o que mudou no mesmo evento.
 *
 * `desfeitoEm` não apaga o evento: a reversão é um fato novo sobre um fato
 * antigo. Uma trilha que some quando alguém desfaz não é trilha.
 *
 * `loteId` é o que liga decisões tomadas juntas. Filtrar por ele reconstrói uma
 * sessão inteira de trabalho — e é o caminho para desfazer um lote por completo
 * em vez de linha a linha.
 */
export const GET = rotaDeLeitura(async (sp) => {
  const contrato = await getAuditoria(
    {
      tabela: textoDe(sp, "tabela", 63),
      alvoId: inteiroDe(sp, "alvoId", { min: 1, max: 2_147_483_647 }),
      ator: textoDe(sp, "ator", 120),
      acao: textoDe(sp, "acao", 60),
      loteId: loteDe(sp),
      de: dataEstritaDe(sp, "de"),
      ate: fimDoDia(dataEstritaDe(sp, "ate")),
      apenasLotes: bandeiraEstritaDe(sp, "apenasLotes")
    },
    paginacaoDe(sp)
  );

  const itens = contrato.dado.itens;
  const desfeitos = itens.filter((e) => e.desfeitoEm !== null);
  const emLote = itens.filter((e) => e.loteId !== null);
  const semCampos = itens.filter((e) => e.campos.length === 0);

  return responderContrato(
    comRessalvas(
      contrato,
      desfeitos.length
        ? `${contagem(desfeitos.length, "evento desta página foi", "eventos desta página foram")} desfeitos (desfeitoEm preenchido). ` +
            `Eles continuam na trilha: reversão é fato novo sobre fato antigo, não apagamento.`
        : null,
      emLote.length
        ? `${contagem(emLote.length, "evento pertence", "eventos pertencem")} a um lote. Filtre por loteId para ver a sessão de trabalho inteira em vez de linha a linha.`
        : null,
      semCampos.length
        ? `${contagem(semCampos.length, "evento não lista", "eventos não listam")} campos alterados: são criações ou exclusões, onde 'antes' ou 'depois' não existe. mudancas[] vem vazio por isso, não por falta de registro.`
        : null,
      sp.get("ate")
        ? "O filtro 'ate' inclui o dia inteiro (23:59:59.999999). Sem esse ajuste, ate=<hoje> devolveria zero eventos de hoje e o vazio pareceria 'ninguém mexeu em nada'."
        : null
    )
  );
});

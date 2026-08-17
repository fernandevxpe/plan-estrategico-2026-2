import {
  criarAjuste,
  revogarAjuste,
  simularAjuste,
  MOTIVO_MINIMO,
  type EntradaAjuste
} from "@/lib/financeiro/contratos/dre-resultado";
import {
  ParametroInvalido,
  comRessalvas,
  responderContrato,
  rotaDeLeitura,
  textoDe
} from "@/lib/financeiro/contratos/http";
import { FinanceUnavailableError } from "@/lib/financeiro/db";

import { brl } from "../../_medido";
import { centavosDe, mesEstritoDe } from "../../_parametros";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * O ajuste declarado — "adicionar algo" à DRE, sem inventar dinheiro.
 *
 *   GET  .../dre/ajuste?mes=&linha=&valorCents=&motivo=&autor=   → dry-run
 *   POST .../dre/ajuste  {..., "aplicar": true}                  → grava
 *   POST .../dre/ajuste  {"acao":"revogar","id":…,"aplicar":true} → revoga
 *
 * ---------------------------------------------------------------------------
 * POR QUE "ADICIONAR LINHA À DRE" NÃO EXISTE, E ISTO EXISTE NO LUGAR
 * ---------------------------------------------------------------------------
 * A DRE é DERIVADA de `fin_transaction` e `fin_card_transaction`. Uma linha
 * acrescentada direto nela seria resultado inventado, e a pergunta "de onde
 * veio este número?" passaria a ter duas respostas.
 *
 * O ajuste declarado é a outra coisa: uma AFIRMAÇÃO HUMANA, com autor, motivo e
 * data, em seção própria, que ninguém confunde com extrato porque a coluna
 * `origem` diz `declarado` e a seção diz `ajuste`.
 *
 * TRÊS TRAVAS ESTRUTURAIS, todas no banco (0102 §7), nenhuma nesta rota:
 *   1. `fin_dre_mensal_v` não lê `fin_dre_ajuste`. A DRE não o enxerga.
 *   2. Um CHECK proíbe `visao='caixa'`. Na visão caixa o realizado é o extrato,
 *      sempre — um ajuste ali quebraria a soma que reconstrói o saldo.
 *   3. Um gatilho recusa linha de subtotal e seção que não seja `resultado`.
 *
 * E uma medida, que esta rota devolve: o lucro do mês e a regra de ouro são
 * lidos antes e depois do INSERT, dentro da mesma transação. "Ajuste não altera
 * o caixa" deixa de ser promessa e vira par de números — e se divergirem, a
 * transação volta inteira.
 *
 * Ela escreve NO LEDGER PRÓPRIO e em mais nada: a restrição "APIs externas:
 * somente GET" continua inteira.
 */

/** GET = dry-run. Julga com as mesmas regras do banco e não escreve nada. */
export const GET = rotaDeLeitura(async (sp) => {
  const contrato = await simularAjuste(lerParametros(sp));
  return responderContrato(
    comRessalvas(
      contrato,
      contrato.dado.recusa
        ? null
        : 'DRY-RUN. Para gravar, repita como POST com "aplicar": true — escrever é sempre ato explícito.'
    )
  );
});

export async function POST(request: Request): Promise<Response> {
  try {
    const corpo = await lerCorpo(request);

    if (corpo.acao === "revogar") {
      if (!corpo.aplicar) {
        return Response.json(
          {
            erro: 'revogar exige "aplicar": true. Sem isso nada é escrito, e não há dry-run de revogação: ' +
              "ela é reversível por natureza — o ajuste continua na tabela, com quem revogou e por quê."
          },
          { status: 400, headers: { "Cache-Control": "no-store" } }
        );
      }
      const contrato = await revogarAjuste({
        id: corpo.id ?? 0,
        por: corpo.autor ?? "",
        motivo: corpo.motivo ?? ""
      });
      return responderContrato(contrato);
    }

    const entrada: EntradaAjuste = {
      mes: corpo.mes ?? "",
      linha: corpo.linha ?? "",
      amountCents: corpo.amountCents ?? 0,
      motivo: corpo.motivo ?? "",
      autor: corpo.autor ?? "",
      evidenciaUrl: corpo.evidenciaUrl ?? null
    };

    if (!corpo.aplicar) {
      const contrato = await simularAjuste(entrada);
      return responderContrato(
        comRessalvas(
          contrato,
          'POST sem "aplicar": true é DRY-RUN. Nada foi escrito.'
        )
      );
    }

    const contrato = await criarAjuste(entrada);
    return responderContrato(
      comRessalvas(
        contrato,
        contrato.dado.prova
          ? `Medido: lucro líquido do mês ${brl(contrato.dado.prova.lucroLiquidoAntesCents)} antes e ` +
              `${brl(contrato.dado.prova.lucroLiquidoDepoisCents)} depois; resíduo da regra de ouro ` +
              `${brl(contrato.dado.prova.residuoSaldoDepoisCents)}. O ajuste não alcançou o caixa.`
          : null
      )
    );
  } catch (erro) {
    if (erro instanceof ParametroInvalido) {
      return Response.json(
        { erro: erro.message, parametro: erro.parametro },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }
    if (erro instanceof FinanceUnavailableError) {
      return Response.json(
        { erro: "banco financeiro indisponível", motivo: erro.message },
        { status: 503, headers: { "Cache-Control": "no-store" } }
      );
    }
    throw erro;
  }
}

function lerParametros(sp: URLSearchParams): EntradaAjuste {
  const mes = mesEstritoDe(sp, "mes");
  if (!mes) throw new ParametroInvalido("mes", "mes é obrigatório, no formato AAAA-MM");
  const valorCents = centavosDe(sp, "valorCents");
  if (valorCents === undefined) {
    throw new ParametroInvalido("valorCents", "valorCents é obrigatório: ajuste sem valor não é ajuste");
  }
  return {
    mes,
    linha: textoDe(sp, "linha", 80) ?? "",
    amountCents: valorCents,
    motivo: textoDe(sp, "motivo", 600) ?? "",
    autor: textoDe(sp, "autor", 80) ?? "",
    evidenciaUrl: textoDe(sp, "evidenciaUrl", 500) ?? null
  };
}

type Corpo = {
  acao: "criar" | "revogar";
  id?: number;
  mes?: string;
  linha?: string;
  amountCents?: number;
  motivo?: string;
  autor?: string;
  evidenciaUrl?: string | null;
  aplicar: boolean;
};

async function lerCorpo(request: Request): Promise<Corpo> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    throw new ParametroInvalido("corpo", "corpo precisa ser JSON válido");
  }
  if (typeof json !== "object" || json === null) {
    throw new ParametroInvalido("corpo", "corpo precisa ser um objeto JSON");
  }
  const c = json as Record<string, unknown>;

  const acao = c.acao === "revogar" ? "revogar" : "criar";

  if (acao === "revogar") {
    const id = Number(c.id);
    if (!Number.isInteger(id) || id < 1) {
      throw new ParametroInvalido("id", "id do ajuste a revogar deve ser um inteiro positivo");
    }
    return {
      acao,
      id,
      motivo: c.motivo === undefined ? undefined : String(c.motivo),
      autor: c.autor === undefined ? undefined : String(c.autor),
      aplicar: c.aplicar === true
    };
  }

  const mes = c.mes === undefined ? "" : String(c.mes);
  if (!/^\d{4}-\d{2}(-01)?$/.test(mes)) {
    throw new ParametroInvalido("mes", "mes deve ser AAAA-MM ou AAAA-MM-01");
  }

  const amountCents = Number(c.amountCents);
  if (!Number.isInteger(amountCents) || amountCents === 0) {
    throw new ParametroInvalido(
      "amountCents",
      "amountCents deve ser um inteiro de centavos diferente de zero: ajuste de R$ 0,00 não é ajuste"
    );
  }

  const motivo = c.motivo === undefined ? "" : String(c.motivo);
  if (c.aplicar === true && motivo.trim().length < MOTIVO_MINIMO) {
    throw new ParametroInvalido(
      "motivo",
      `motivo é obrigatório e precisa de pelo menos ${MOTIVO_MINIMO} caracteres: "ajuste" é rótulo, não motivo`
    );
  }

  return {
    acao,
    mes: mes.length === 7 ? `${mes}-01` : mes,
    linha: c.linha === undefined ? "" : String(c.linha),
    amountCents,
    motivo,
    autor: c.autor === undefined ? undefined : String(c.autor),
    evidenciaUrl: c.evidenciaUrl === undefined || c.evidenciaUrl === null ? null : String(c.evidenciaUrl),
    aplicar: c.aplicar === true
  };
}

import { getPendencias } from "@/lib/financeiro/contratos";
import { comRessalvas, responderContrato, rotaDeLeitura } from "@/lib/financeiro/contratos/http";

import { brl, contagem, lista } from "../_medido";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/financeiro/gerencial/pendencias
 *
 * As invariantes que a base promete, verificadas AGORA — não "o teste passou no
 * CI". Um schema pode estar perfeito e o ledger, mentindo, e é o ledger que paga
 * contas.
 *
 * Cada checagem devolve `invariante` (o que deveria ser verdade), `observado`,
 * `esperado` e `rota` (onde se resolve). A diferença entre observado e esperado
 * é o trabalho; a rota é o dono. Checagem sem rota é a forma como uma falha vira
 * folclore.
 *
 * `caixaFecha` é a REGRA ZERO. Falso ali invalida todo o resto desta API —
 * incluindo a DRE e a previsão, que são derivadas do mesmo ledger. A ressalva
 * medida diz isso com todas as letras, porque um cliente que leia só
 * `bloqueantes: 0` e ignore `caixaFecha: false` chegaria à conclusão oposta.
 *
 * `contasAtrasadas` NÃO é subconjunto de `contasQueNaoFecham`: a primeira é
 * temporal (o extrato não cobre D+1), a segunda é aritmética (o saldo
 * reconstruído não bate). Uma conta pode estar em uma lista e não na outra.
 */
export const GET = rotaDeLeitura(async () => {
  const contrato = await getPendencias();
  const d = contrato.dado;

  const falhas = d.checagens.filter((c) => !c.passou);
  const bloqueantes = falhas.filter((c) => c.severidade === "bloqueante");
  const semRota = falhas.filter((c) => c.rota === null);
  const emJogo = falhas.reduce((s, c) => s + (c.valorCents ?? 0), 0);

  return responderContrato(
    comRessalvas(
      contrato,
      contrato.disponivel && !d.caixaFecha
        ? `REGRA ZERO VIOLADA: o caixa não fecha${d.contasQueNaoFecham.length ? ` em ${lista(d.contasQueNaoFecham)}` : ""}. ` +
            `Enquanto isso for verdade, nenhum número desta API vale — DRE, balanço e previsão saem todos do mesmo ledger.`
        : null,
      d.contasAtrasadas.length
        ? `Extrato atrasado em ${lista(d.contasAtrasadas)}. Isso é diferente de "não fecha": o saldo pode bater na última data coberta e ainda assim não dizer nada sobre hoje.`
        : null,
      falhas.length
        ? `${contagem(falhas.length, "checagem falha", "checagens falham")}${bloqueantes.length ? ` (${bloqueantes.length} bloqueante(s))` : ""}, ` +
            `${brl(emJogo)} em jogo nas que se medem em reais.`
        : null,
      semRota.length
        ? `${contagem(semRota.length, "checagem falha sem", "checagens falham sem")} tela de decisão (rota null): ${lista(
            semRota.map((c) => c.chave)
          )}. Sem dono, elas viram folclore — a resolução depende de decisão humana registrada em DUVIDAS_FINANCEIRO.md.`
        : null,
      "valorCents null numa checagem significa que ela não se mede em reais (contagem, cobertura, integridade referencial), não que o valor em jogo seja zero."
    )
  );
});

import { headers } from "next/headers";

import { AppShell } from "@/components/layout/AppShell";
import { FinShell } from "@/components/financeiro/FinShell";
import { FinResultado } from "@/components/financeiro/FinResultado";
import { getDreDrill } from "@/lib/financeiro/contratos/dre-drill";
import { getDreResultado } from "@/lib/financeiro/contratos/dre-resultado";
import type { Visao } from "@/lib/financeiro/contratos/resultado";

export const metadata = { title: "Resultado — Financeiro XPE" };

// Mesma regra das outras rotas do módulo: número financeiro em cache é pior que
// número financeiro lento, porque alguém decide pagamento em cima dele.
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ visao?: string; mes?: string }> };

/**
 * A DRE expansível.
 *
 * O primeiro carregamento é do SERVIDOR, com os contratos chamados direto — a
 * tela nasce com número, não com esqueleto piscando. Dali em diante quem abre
 * uma linha é o cliente, contra as mesmas rotas GET; é o que faz "abrir uma
 * linha" ser um pedido de alguns nós em vez de um download de 14.662.
 *
 * `autorPadrao` sai do Basic Auth, como em `/api/financeiro/qualificar`: quem
 * move um lançamento ou declara um ajuste assina, e a assinatura não deveria
 * ser digitada por quem assina. O campo continua editável porque a credencial
 * do time é compartilhada — ela autentica "alguém", nunca "quem", e essa
 * diferença já está registrada na base (dúvida 58).
 */
export default async function ResultadoPage({ searchParams }: Props) {
  const params = await searchParams;
  const visao: Visao = params.visao === "competencia" ? "competencia" : "caixa";
  const mes = /^\d{4}-\d{2}(-\d{2})?$/.test(params.mes ?? "")
    ? `${params.mes!.slice(0, 7)}-01`
    : undefined;

  const [drill, esqueleto] = await Promise.all([
    getDreDrill({ visao, mes, nivel: "linha" }),
    getDreResultado({ visao, mes })
  ]);

  return (
    <AppShell>
      <div className="page-header">
        <h1>Resultado</h1>
        <p>
          A DRE do mês, aberta até o lançamento que a compõe. O total nunca muda ao expandir — a tela mede isso e
          mostra o resíduo. Aqui também se tira um lançamento de uma linha e põe em outra: a DRE não é editada, o
          lançamento é reclassificado, e ela se refaz sozinha a partir do extrato.
        </p>
      </div>
      <FinShell>
        <FinResultado
          drillInicial={drill}
          esqueletoInicial={esqueleto}
          autorPadrao={await autorDaSessao()}
        />
      </FinShell>
    </AppShell>
  );
}

/** O usuário do Basic Auth. Mesmo caminho de `app/api/financeiro/qualificar`. */
async function autorDaSessao(): Promise<string> {
  const h = (await headers()).get("authorization");
  if (!h?.toLowerCase().startsWith("basic ")) return "tela";
  try {
    return Buffer.from(h.slice(6), "base64").toString("utf8").split(":")[0]?.trim() || "tela";
  } catch {
    return "tela";
  }
}

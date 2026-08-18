import { AppShell } from "@/components/layout/AppShell";
import { FinShell } from "@/components/financeiro/FinShell";
import { FinExtratos } from "@/components/financeiro/FinExtratos";
import { contasDisponiveis } from "@/lib/financeiro/extratos";

export const metadata = {
  title: "Extratos — Financeiro XPE"
};

export const dynamic = "force-dynamic";

/**
 * Baixar o extrato de qualquer conta, ou de todas juntas, num Excel
 * organizado ou num CSV simples.
 *
 * A tela só monta o link de download — quem gera o arquivo é
 * `/api/financeiro/extratos` (`lib/financeiro/extratos.ts`), porque um
 * `<a href>` que o navegador já autentica (mesma sessão Basic Auth do resto
 * do app) é mais simples e mais robusto do que buscar o arquivo em
 * JavaScript e forçar o download depois.
 */
export default async function ExtratosPage() {
  const contas = await contasDisponiveis();

  return (
    <AppShell>
      <div className="page-header">
        <h1>Extratos</h1>
        <p>
          O extrato detalhado de qualquer conta — ou de todas juntas — pronto para conferência contábil.
          O sistema baixa o que tiver no período pedido; conta sem extrato num mês aparece dizendo isso,
          nunca como se não tivesse existido.
        </p>
      </div>
      <FinShell>
        <FinExtratos contas={contas} />
      </FinShell>
    </AppShell>
  );
}

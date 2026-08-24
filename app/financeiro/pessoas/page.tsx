import { AppShell } from "@/components/layout/AppShell";
import { FinShell } from "@/components/financeiro/FinShell";
import { FinPessoas } from "@/components/financeiro/FinPessoas";
import { getCustoPessoas } from "@/lib/financeiro/pessoas";

export const metadata = {
  title: "Custo com pessoas — Financeiro XPE"
};

/**
 * Como o resto do módulo, lê o PostgreSQL em tempo de request.
 *
 * `force-dynamic` aqui não é sobre o total: é sobre a COBERTURA. A frase "R$ X
 * não pôde ser atribuído a ninguém" muda a cada lançamento que a fila de revisão
 * resolve. Uma página em cache continuaria acusando um buraco já tapado — e uma
 * acusação desatualizada ensina a ignorar a seção que existe justamente para ser
 * levada a sério.
 */
export const dynamic = "force-dynamic";

export default async function PessoasPage() {
  const dados = await getCustoPessoas();

  return (
    <AppShell>
      <div className="page-header">
        <h1>Custo com pessoas</h1>
      </div>
      <FinShell>
        <FinPessoas dados={dados} />
      </FinShell>
    </AppShell>
  );
}

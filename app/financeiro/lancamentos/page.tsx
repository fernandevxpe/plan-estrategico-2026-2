import { AppShell } from "@/components/layout/AppShell";
import { FinShell } from "@/components/financeiro/FinShell";
import { FinLedgerTable } from "@/components/financeiro/FinLedgerTable";
import { ehIndisponivel, getFiltrosDisponiveis, getLancamentos } from "@/lib/financeiro/queries";

export const metadata = {
  title: "Lançamentos — Financeiro XPE"
};

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ semCategoria?: string; conta?: string; busca?: string }> };

export default async function LancamentosPage({ searchParams }: Props) {
  // O painel de qualificação linka para cá com ?semCategoria=1. Sem ler o
  // parâmetro, o usuário clicava em "385 lançamentos sem categoria" e caía num
  // extrato completo — um link que promete filtro e entrega tudo ensina a não
  // clicar nos outros.
  const filtros = await searchParams;
  // 500 linhas cobrem com folga os últimos meses e permitem filtrar no cliente
  // sem ida ao servidor a cada tecla. Paginação real entra quando as outras
  // quatro contas começarem a alimentar o ledger.
  const [lancamentos, opcoes] = await Promise.all([
    // Sem transferências na consulta: o LIMIT corria sobre o conjunto COM as
    // 372 transferências e a tabela as escondia depois, truncando o extrato
    // útil num ponto arbitrário. Quem quiser vê-las usa o filtro da tela.
    getLancamentos({ limite: 500 }),
    getFiltrosDisponiveis()
  ]);

  return (
    <AppShell>
      <div className="page-header">
        <h1>Lançamentos</h1>
        <p>
          O extrato consolidado. Transferências entre contas próprias ficam ocultas por padrão — são R$ 3,8 milhões
          que não são receita nem despesa.
        </p>
      </div>
      <FinShell>
        <FinLedgerTable
          inicialSemCategoria={filtros.semCategoria === "1"}
          inicialBusca={filtros.busca ?? ""}
          lancamentos={lancamentos}
          indisponivel={ehIndisponivel(lancamentos)}
          contas={opcoes.contas}
          nucleos={opcoes.nucleos}
        />
      </FinShell>
    </AppShell>
  );
}

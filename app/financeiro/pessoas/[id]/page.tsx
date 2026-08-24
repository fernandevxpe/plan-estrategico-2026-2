import { notFound } from "next/navigation";

import { AppShell } from "@/components/layout/AppShell";
import { FinPessoaPerfil } from "@/components/financeiro/FinPessoaPerfil";
import { FinShell } from "@/components/financeiro/FinShell";
import { getPerfilPessoa } from "@/lib/financeiro/pessoa-perfil";

/**
 * O perfil financeiro de uma pessoa.
 *
 * Sob `/financeiro` de propósito: é o prefixo que `lib/auth/perfis.ts` marca
 * como só-admin. Aqui aparecem a chave PIX, o CPF e o histórico de remuneração
 * de alguém — dado que o próprio time não pode ver do colega. A proteção vem de
 * onde a página está, não de uma checagem que alguém pode esquecer de escrever.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await getPerfilPessoa(Number(id));
  return { title: p ? `${p.nome} — Financeiro XPE` : "Pessoa — Financeiro XPE" };
}

export default async function PessoaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const n = Number(id);
  if (!Number.isSafeInteger(n) || n <= 0) notFound();

  const perfil = await getPerfilPessoa(n);
  if (!perfil) notFound();

  return (
    <AppShell>
      <div className="page-header page-header-compact">
        <h1>{perfil.nome}</h1>
        <p>Perfil financeiro unificado — pagamento, remuneração, previsão e extrato desde 2026.</p>
      </div>
      <FinShell>
        <FinPessoaPerfil perfil={perfil} />
      </FinShell>
    </AppShell>
  );
}

import { AppShell } from "@/components/layout/AppShell";
import { FinShell } from "@/components/financeiro/FinShell";
import { FinRules } from "@/components/financeiro/FinRules";
import { query } from "@/lib/financeiro/db";
import { getOpcoesClassificacao } from "@/lib/financeiro/revisao";

export const metadata = { title: "Regras — Financeiro XPE" };
export const dynamic = "force-dynamic";

export default async function RegrasPage() {
  const [regrasResultado, opcoes] = await Promise.all([
    query<{
      id: number; slug: string; name: string; priority: number; match_scope: string;
      conditions: never; actions: never; confidence: number; source: string; status: string;
      hits_count: number; last_hit_at: Date | null;
    }>(
      `SELECT r.id, r.slug, r.name, r.priority, r.match_scope, r.conditions, r.actions,
              r.confidence, r.source, r.status, r.hits_count, r.last_hit_at
         FROM fin_rule r JOIN fin_entity e ON e.id = r.entity_id
        WHERE e.slug = 'xpe' AND r.status = 'ativa'
        ORDER BY r.priority, r.id`
    // O `.catch(() => [])` de antes engolia a falha e a tela imprimia
    // "Regras ativas (0)" — afirmando que não existe regra, quando o que
    // houve foi o banco não responder. Agora a diferença viaja até a tela.
    ).then((r) => ({ ok: true as const, r })).catch(() => ({ ok: false as const, r: [] })),
    getOpcoesClassificacao()
  ]);
  const regras = regrasResultado.r;
  const regrasIndisponiveis = !regrasResultado.ok;

  return (
    <AppShell>
      <div className="page-header">
        <h1>Regras de classificação</h1>
        <p>
          O que faz a próxima cobrança parecida já chegar classificada. Simular antes de salvar é obrigatório — é o
          que mostra uma palavra curta demais capturando o nome de um cliente em vez do serviço.
        </p>
      </div>
      <FinShell>
        <FinRules
          regras={regras.map((r) => ({
            id: r.id, slug: r.slug, name: r.name, priority: r.priority, matchScope: r.match_scope,
            conditions: r.conditions, actions: r.actions, confidence: r.confidence,
            source: r.source, status: r.status, hitsCount: r.hits_count,
            lastHitAt: r.last_hit_at ? r.last_hit_at.toISOString() : null
          }))}
          indisponivel={regrasIndisponiveis}
          categorias={opcoes.categorias}
          nucleos={opcoes.nucleos}
        />
      </FinShell>
    </AppShell>
  );
}

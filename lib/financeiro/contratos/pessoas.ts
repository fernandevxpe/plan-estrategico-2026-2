import "server-only";

import { isFinanceConfigured, query } from "../db";
import { contrato, contratoIndisponivel, ENTIDADE, type Contrato, type Drill, type Medida } from "./base";

/**
 * Pessoas, MEIs e reembolsos.
 *
 * Duas coisas que este contrato separa e a maioria das ferramentas mistura:
 *
 *   FOLHA DECLARADA (`fin_person_compensation`) é o que foi PACTUADO.
 *   FOLHA REALIZADA (`fin_custo_pessoas_v`)     é o que SAIU do caixa.
 *
 * Elas não batem — e não deveriam bater exatamente, porque comissão, reembolso e
 * adiantamento entram por caminhos diferentes. O contrato entrega as duas com a
 * divergência calculada, em vez de escolher uma e apresentá-la como "a folha".
 * Escolher esconderia justamente o mês em que alguém foi pago a mais.
 *
 * MEI tem tratamento próprio: é pessoa que emite nota como PJ. O custo aparece
 * como serviço de terceiro no ledger e como pessoa aqui, e somar as duas
 * leituras dobraria a folha.
 */

const DOMINIO = "pessoas";

export type Pessoa = {
  id: number;
  nome: string;
  papel: string | null;
  area: string | null;
  vinculo: string | null;
  status: string;
  nucleo: string | null;
  cpf: string | null;
  cnpj: string | null;
  ehMei: boolean;
  inicio: string | null;
  fim: string | null;
  contraparteId: number | null;
  pactuadoMesCents: number | null;
  realizado12mCents: number;
  drill: Drill;
};

export type MesFolha = {
  mes: string;
  nucleo: string | null;
  salariosCents: number;
  prolaboreCents: number;
  encargosCents: number;
  beneficiosCents: number;
  estagioCents: number;
  outrosCents: number;
  meiCents: number;
  folhaSemMeiCents: number;
  folhaTotalCents: number;
};

export type PainelPessoas = {
  pessoas: Pessoa[];
  ativos: number;
  meis: number;
  folhaMensal: MesFolha[];
  pactuadoMesAtualCents: Medida;
  realizadoMesAtualCents: Medida;
  divergenciaCents: Medida;
};

const VAZIO: PainelPessoas = {
  pessoas: [],
  ativos: 0,
  meis: 0,
  folhaMensal: [],
  pactuadoMesAtualCents: { valorCents: null, motivo: "banco não consultado" },
  realizadoMesAtualCents: { valorCents: null, motivo: "banco não consultado" },
  divergenciaCents: { valorCents: null, motivo: "banco não consultado" }
};

export async function getPessoas(): Promise<Contrato<PainelPessoas>> {
  if (!isFinanceConfigured()) return contratoIndisponivel(DOMINIO, VAZIO, "banco financeiro não configurado");

  try {
    const [pessoas, folha, pactuado, realizado] = await Promise.all([
      query<Record<string, unknown>>(
        `SELECT p.id, p.name, p.role, p.area, p.employment_type, p.status, p.default_nucleo,
                p.cpf, p.cnpj, to_char(p.start_date,'YYYY-MM-DD') AS start_date,
                to_char(p.end_date,'YYYY-MM-DD') AS end_date, p.counterparty_id,
                (SELECT SUM(pc.amount_cents) FROM fin_person_compensation pc
                  WHERE pc.person_id = p.id
                    AND pc.reference_month = date_trunc('month', CURRENT_DATE)::date)::text AS pactuado,
                COALESCE((SELECT SUM(-t.amount_cents) FROM fin_transaction t
                  WHERE t.counterparty_id = p.counterparty_id AND t.amount_cents < 0
                    AND t.transfer_status = 'nao' AND NOT t.is_split_parent
                    AND t.posted_on >= (CURRENT_DATE - interval '12 months')), 0)::text AS realizado
           FROM fin_person p JOIN fin_entity e ON e.id = p.entity_id
          WHERE e.slug = $1 ORDER BY p.status, p.name`,
        [ENTIDADE]
      ),
      query<Record<string, unknown>>(
        `SELECT * FROM fin_custo_pessoas_v ORDER BY mes DESC, nucleo NULLS LAST LIMIT 60`
      ),
      query<{ total: string | null }>(
        `SELECT SUM(pc.amount_cents)::text AS total FROM fin_person_compensation pc
           JOIN fin_entity e ON e.id = pc.entity_id
          WHERE e.slug = $1 AND pc.reference_month = date_trunc('month', CURRENT_DATE)::date`,
        [ENTIDADE]
      ),
      query<{ total: string | null }>(
        `SELECT SUM(folha_total_cents)::text AS total FROM fin_custo_pessoas_v
          WHERE mes = date_trunc('month', CURRENT_DATE)::date`
      )
    ]);

    const lista: Pessoa[] = pessoas.map((p) => ({
      id: Number(p.id),
      nome: String(p.name),
      papel: (p.role as string) ?? null,
      area: (p.area as string) ?? null,
      vinculo: (p.employment_type as string) ?? null,
      status: String(p.status),
      nucleo: (p.default_nucleo as string) ?? null,
      cpf: (p.cpf as string) ?? null,
      cnpj: (p.cnpj as string) ?? null,
      // MEI é declarado pelo vínculo, não deduzido da existência de CNPJ:
      // sócio também tem CNPJ e não é MEI.
      ehMei: String(p.employment_type ?? "").toLowerCase().includes("mei"),
      inicio: (p.start_date as string) ?? null,
      fim: (p.end_date as string) ?? null,
      contraparteId: p.counterparty_id === null ? null : Number(p.counterparty_id),
      pactuadoMesCents: p.pactuado === null ? null : Number(p.pactuado),
      realizado12mCents: Number(p.realizado ?? 0),
      drill: { dominio: "lancamentos", filtros: { contraparte: Number(p.counterparty_id ?? 0) } }
    }));

    const pactuadoTotal = pactuado[0]?.total === null || pactuado[0]?.total === undefined ? null : Number(pactuado[0].total);
    const realizadoTotal =
      realizado[0]?.total === null || realizado[0]?.total === undefined ? null : Number(realizado[0].total);

    return contrato({
      dominio: DOMINIO,
      dado: {
        pessoas: lista,
        ativos: lista.filter((p) => p.status === "ativo").length,
        meis: lista.filter((p) => p.ehMei).length,
        folhaMensal: folha.map((f) => ({
          mes: String(f.mes).slice(0, 10),
          nucleo: (f.nucleo as string) ?? null,
          salariosCents: Number(f.salarios_cents ?? 0),
          prolaboreCents: Number(f.prolabore_cents ?? 0),
          encargosCents: Number(f.encargos_cents ?? 0),
          beneficiosCents: Number(f.beneficios_cents ?? 0),
          estagioCents: Number(f.estagio_cents ?? 0),
          outrosCents: Number(f.outros_pessoal_cents ?? 0),
          meiCents: Number(f.mei_cents ?? 0),
          folhaSemMeiCents: Number(f.folha_sem_mei_cents ?? 0),
          folhaTotalCents: Number(f.folha_total_cents ?? 0)
        })),
        pactuadoMesAtualCents: {
          valorCents: pactuadoTotal,
          motivo: pactuadoTotal === null ? "nenhuma remuneração declarada para o mês corrente" : null
        },
        realizadoMesAtualCents: {
          valorCents: realizadoTotal,
          motivo: realizadoTotal === null ? "nenhuma saída de folha registrada no mês corrente" : null
        },
        divergenciaCents:
          pactuadoTotal !== null && realizadoTotal !== null
            ? { valorCents: realizadoTotal - pactuadoTotal, motivo: null }
            : { valorCents: null, motivo: "falta um dos dois lados para comparar" }
      },
      ressalvas: [
        "Pactuado e realizado NÃO batem por construção: comissão, reembolso e adiantamento entram por caminhos diferentes. A divergência é o dado, não o erro.",
        "MEI aparece nas duas leituras (pessoa aqui, serviço de terceiro no ledger). Somar as duas dobraria a folha — use folhaSemMeiCents quando a pergunta for CLT."
      ]
    });
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    console.error("[contrato:pessoas]", mensagem);
    return contratoIndisponivel(DOMINIO, VAZIO, mensagem);
  }
}

// ---------------------------------------------------------------------------
// Reembolsos
// ---------------------------------------------------------------------------

export type Reembolso = {
  id: number;
  pessoaId: number;
  pessoa: string;
  mesReferencia: string;
  status: string;
  totalCents: number;
  itens: number;
  enviadoEm: string | null;
  aprovadoEm: string | null;
  aprovadoPor: string | null;
  documentoPagamentoId: number | null;
  /** Itens sem nota fiscal nem comprovante — o que trava a aprovação. */
  itensSemComprovante: number;
};

export type PainelReembolsos = {
  reembolsos: Reembolso[];
  porStatus: { status: string; n: number; totalCents: number }[];
  aguardandoAprovacaoCents: number;
  aprovadoNaoPagoCents: number;
};

const REEMBOLSO_VAZIO: PainelReembolsos = {
  reembolsos: [],
  porStatus: [],
  aguardandoAprovacaoCents: 0,
  aprovadoNaoPagoCents: 0
};

export async function getReembolsos(): Promise<Contrato<PainelReembolsos>> {
  if (!isFinanceConfigured()) {
    return contratoIndisponivel("reembolsos", REEMBOLSO_VAZIO, "banco financeiro não configurado");
  }
  try {
    const [linhas, porStatus] = await Promise.all([
      query<Record<string, unknown>>(
        `SELECT r.id, r.person_id, p.name AS pessoa, to_char(r.reference_month,'YYYY-MM-DD') AS mes,
                r.status, r.total_cents::text AS total, r.submitted_at, r.approved_at, r.approved_by,
                r.paid_document_id,
                (SELECT count(*) FROM fin_reimbursement_item i WHERE i.reimbursement_id = r.id)::text AS itens,
                (SELECT count(*) FROM fin_reimbursement_item i
                  WHERE i.reimbursement_id = r.id
                    AND i.nfe_key IS NULL AND i.receipt_artifact_key IS NULL)::text AS sem_comprovante
           FROM fin_reimbursement r
           JOIN fin_entity e ON e.id = r.entity_id
           JOIN fin_person p ON p.id = r.person_id
          WHERE e.slug = $1 ORDER BY r.reference_month DESC, p.name`,
        [ENTIDADE]
      ),
      query<{ status: string; n: string; total: string }>(
        `SELECT r.status, count(*)::text AS n, COALESCE(SUM(r.total_cents), 0)::text AS total
           FROM fin_reimbursement r JOIN fin_entity e ON e.id = r.entity_id
          WHERE e.slug = $1 GROUP BY 1 ORDER BY 1`,
        [ENTIDADE]
      )
    ]);

    const reembolsos: Reembolso[] = linhas.map((r) => ({
      id: Number(r.id),
      pessoaId: Number(r.person_id),
      pessoa: String(r.pessoa),
      mesReferencia: String(r.mes),
      status: String(r.status),
      totalCents: Number(r.total),
      itens: Number(r.itens ?? 0),
      enviadoEm: (r.submitted_at as string) ?? null,
      aprovadoEm: (r.approved_at as string) ?? null,
      aprovadoPor: (r.approved_by as string) ?? null,
      documentoPagamentoId: r.paid_document_id === null ? null : Number(r.paid_document_id),
      itensSemComprovante: Number(r.sem_comprovante ?? 0)
    }));

    const soma = (predicado: (r: Reembolso) => boolean) =>
      reembolsos.filter(predicado).reduce((s, r) => s + r.totalCents, 0);

    return contrato({
      dominio: "reembolsos",
      dado: {
        reembolsos,
        porStatus: porStatus.map((s) => ({ status: s.status, n: Number(s.n), totalCents: Number(s.total) })),
        aguardandoAprovacaoCents: soma((r) => r.aprovadoEm === null && r.enviadoEm !== null),
        // Aprovado sem documento de pagamento é dívida com o time que já foi
        // reconhecida e ainda não saiu. É o número que a pessoa cobra.
        aprovadoNaoPagoCents: soma((r) => r.aprovadoEm !== null && r.documentoPagamentoId === null)
      },
      ressalvas: [
        "Reembolso aprovado e sem documento de pagamento é dívida reconhecida com o time — aparece aqui e não no a pagar, porque o a pagar ainda não existe como camada.",
        "itensSemComprovante é o que trava a aprovação: sem nota nem recibo, não há como sustentar a saída."
      ]
    });
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    console.error("[contrato:reembolsos]", mensagem);
    return contratoIndisponivel("reembolsos", REEMBOLSO_VAZIO, mensagem);
  }
}

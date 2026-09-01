import "server-only";

import { isFinanceConfigured, query, transaction } from "@/lib/financeiro/db";
import { conferirDocumento } from "@/scripts/lib/fin-documento.mjs";
import { ValidacaoError } from "@/lib/financeiro/revisao";
import { hashDeSenha, normalizarChavePix, type ContaPagamento } from "@/lib/financeiro/time";

const ENTITY = "xpe";

/** Senha de entrega fácil de ditar — troca obrigatória no 1º login (`senha_trocar`). */
export function gerarSenhaEntregaFacil(personId: number): string {
  const sufixo = String(personId % 1000).padStart(3, "0");
  return `XPE123${sufixo}`;
}

function normalizarCpf(bruto: string): string {
  const r = conferirDocumento(bruto);
  if (!r.valido || r.tipo !== "cpf") {
    const msg = !r.valido && "motivo" in r ? String(r.motivo) : "CPF inválido";
    throw new ValidacaoError(msg);
  }
  return r.digitos!;
}

export function formatarCpf(stored: string | null): string | null {
  if (!stored) return null;
  const d = stored.replace(/\D/g, "");
  if (d.length !== 11) return stored;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export type CartaoPessoaResumo = {
  id: number;
  apelido: string | null;
  last4: string | null;
  bandeira: string | null;
  cor: string | null;
  tipo: string | null;
  status: string;
  linhaNome: string | null;
  cadastradoPeloTime: boolean;
};

export type CadastroAppPessoa = {
  personId: number;
  nome: string;
  email: string | null;
  cpf: string | null;
  whatsapp: string | null;
  birthDate: string | null;
  pagamento: ContaPagamento | null;
  senha: {
    temSenha: boolean;
    trocarNaEntrada: boolean;
    status: string | null;
    definidaEm: string | null;
  };
  cartoes: CartaoPessoaResumo[];
  pendencias: {
    whatsapp: boolean;
    email: boolean;
    cpf: boolean;
    pix: boolean;
    nascimento: boolean;
    senha: boolean;
  };
};

function normalizarWhatsapp(bruto: string): string {
  const d = bruto.replace(/\D/g, "");
  if (d.length < 10 || d.length > 13) {
    throw new ValidacaoError("WhatsApp precisa ter DDD + número (10 ou 11 dígitos)");
  }
  const nacional = d.startsWith("55") && d.length > 11 ? d.slice(2) : d;
  if (nacional.length < 10 || nacional.length > 11) {
    throw new ValidacaoError("WhatsApp precisa ter DDD + número (10 ou 11 dígitos)");
  }
  return nacional;
}

function formatarWhatsapp(stored: string | null): string | null {
  if (!stored) return null;
  const d = stored.replace(/\D/g, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return stored;
}

export async function getCadastroAppPessoa(personId: number): Promise<CadastroAppPessoa | null> {
  if (!isFinanceConfigured()) return null;

  const [pessoa] = await query<{
    id: number;
    name: string;
    email: string | null;
    cpf: string | null;
    whatsapp: string | null;
    birth_date: string | null;
    tem_senha: boolean;
    senha_trocar: boolean | null;
    acesso_status: string | null;
    senha_set_at: string | null;
  }>(
    `SELECT p.id, p.name, p.email, p.cpf, p.whatsapp,
            to_char(p.birth_date, 'YYYY-MM-DD') AS birth_date,
            (a.senha_hash IS NOT NULL) AS tem_senha,
            a.senha_trocar,
            a.status AS acesso_status,
            to_char(a.senha_set_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS senha_set_at
       FROM fin_person p
       JOIN fin_entity e ON e.id = p.entity_id AND e.slug = $1
       LEFT JOIN fin_person_acesso a ON a.person_id = p.id
      WHERE p.id = $2`,
    [ENTITY, personId]
  );
  if (!pessoa) return null;

  const [pagamentoRow, cartoesRows] = await Promise.all([
    query<Record<string, unknown>>(
      `SELECT metodo, pix_tipo, pix_chave, banco_nome, agencia, conta, conta_tipo,
              titular_e_a_pessoa, titular_nome, titular_documento,
              recebe_salario, recebe_reembolso, observacao, conferido_em, atualizado_em
         FROM fin_person_pagamento WHERE person_id = $1`,
      [personId]
    ),
    query<{
      id: number;
      label: string | null;
      last4: string | null;
      bandeira: string | null;
      cor: string | null;
      tipo: string | null;
      status: string;
      linha_nome: string | null;
      cadastrado_pelo_time: boolean;
    }>(
      /*
       * `brand` e `kind`, não `bandeira` e `tipo`.
       *
       * A coluna nasceu com nome em inglês na 0149 — o comentário dela fala de
       * "bandeira" em prosa, mas o `ALTER TABLE` cria `brand` (linha 56). Aqui
       * o SELECT pedia `c.bandeira` e `c.tipo`, e os dois faltam em `fin_card`:
       * a tabela tem `brand` e `kind`. Resultado: GET e PATCH de
       * `/api/financeiro/pessoas/[id]/cadastro-app` devolviam 500 em produção —
       * `column c.bandeira does not exist`.
       *
       * O `tsc` passava limpo, porque ele não olha dentro de SQL. É o defeito
       * do item 4 do AGENTS.md, de novo, e foi `npm run test:login` que o
       * pegou. O Postgres só reclamava de `bandeira`: ele para na primeira
       * coluna que falta, e `tipo` só apareceu depois de consertar a primeira.
       *
       * O apelido mantém o nome em português do lado do TypeScript, que é o que
       * o resto do arquivo e a tela já leem.
       */
      `SELECT c.id, c.label, c.last4, c.brand AS bandeira, c.cor, c.kind AS tipo, c.status,
              ca.name AS linha_nome,
              (c.card_account_id IS NULL) AS cadastrado_pelo_time
         FROM fin_card c
         LEFT JOIN fin_card_account ca ON ca.id = c.card_account_id
        WHERE c.holder_person_id = $1
        ORDER BY CASE c.status WHEN 'ativo' THEN 0 WHEN 'historico' THEN 1 ELSE 2 END,
                 c.updated_at DESC NULLS LAST, c.id`,
      [personId]
    )
  ]);

  const l = pagamentoRow[0];
  const pagamento: ContaPagamento | null = l
    ? {
        metodo: l.metodo as "pix" | "ted",
        pixTipo: (l.pix_tipo as string) ?? null,
        pixChave: (l.pix_chave as string) ?? null,
        bancoNome: (l.banco_nome as string) ?? null,
        agencia: (l.agencia as string) ?? null,
        conta: (l.conta as string) ?? null,
        contaTipo: (l.conta_tipo as string) ?? null,
        titularEhAPessoa: Boolean(l.titular_e_a_pessoa),
        titularNome: (l.titular_nome as string) ?? null,
        titularDocumento: (l.titular_documento as string) ?? null,
        recebeSalario: Boolean(l.recebe_salario),
        recebeReembolso: Boolean(l.recebe_reembolso),
        observacao: (l.observacao as string) ?? null,
        conferidoEm: l.conferido_em ? new Date(l.conferido_em as string).toISOString() : null,
        atualizadoEm: l.atualizado_em ? new Date(l.atualizado_em as string).toISOString() : null
      }
    : null;

  const temPix = Boolean(pagamento?.pixChave && pagamento.pixTipo);
  const temWhatsapp = Boolean(pessoa.whatsapp?.trim());
  const temEmail = Boolean(pessoa.email?.trim());
  const temCpf = Boolean(pessoa.cpf?.trim());
  const temNascimento = Boolean(pessoa.birth_date);
  const temSenha = Boolean(pessoa.tem_senha);

  return {
    personId: pessoa.id,
    nome: pessoa.name,
    email: pessoa.email,
    cpf: formatarCpf(pessoa.cpf),
    whatsapp: formatarWhatsapp(pessoa.whatsapp),
    birthDate: pessoa.birth_date,
    pagamento,
    senha: {
      temSenha,
      trocarNaEntrada: pessoa.senha_trocar === true,
      status: pessoa.acesso_status,
      definidaEm: pessoa.senha_set_at
    },
    cartoes: cartoesRows.map((c) => ({
      id: c.id,
      apelido: c.label,
      last4: c.last4,
      bandeira: c.bandeira,
      cor: c.cor,
      tipo: c.tipo,
      status: c.status,
      linhaNome: c.linha_nome,
      cadastradoPeloTime: c.cadastrado_pelo_time
    })),
    pendencias: {
      whatsapp: !temWhatsapp,
      email: !temEmail,
      cpf: !temCpf,
      pix: !temPix,
      nascimento: !temNascimento,
      senha: !temSenha
    }
  };
}

export type SalvarCadastroAppCorpo = {
  email?: unknown;
  cpf?: unknown;
  whatsapp?: unknown;
  birthDate?: unknown;
  pagamento?: {
    metodo?: unknown;
    pixTipo?: unknown;
    pixChave?: unknown;
    recebeSalario?: unknown;
    recebeReembolso?: unknown;
  };
};

export async function salvarCadastroAppPessoa(
  personId: number,
  corpo: SalvarCadastroAppCorpo,
  actor: string
): Promise<CadastroAppPessoa> {
  await transaction(async (client) => {
    const ent = await client.query<{ id: number }>(`SELECT id FROM fin_entity WHERE slug = $1`, [ENTITY]);
    const entityId = ent.rows[0]?.id;
    if (!entityId) throw new ValidacaoError("entidade não encontrada");

    const existe = await client.query(`SELECT id FROM fin_person WHERE id = $1 AND entity_id = $2`, [
      personId,
      entityId
    ]);
    if (!existe.rows[0]) throw new ValidacaoError("pessoa não encontrada");

    if ("cpf" in corpo) {
      const cpf =
        corpo.cpf === null || corpo.cpf === "" ? null : normalizarCpf(String(corpo.cpf));
      if (cpf) {
        const dup = await client.query(`SELECT id FROM fin_person WHERE cpf = $1 AND id <> $2`, [cpf, personId]);
        if (dup.rows[0]) throw new ValidacaoError("este CPF já está em uso");
      }
      await client.query(`UPDATE fin_person SET cpf = $2, updated_at = now() WHERE id = $1`, [personId, cpf]);
    }

    if ("email" in corpo) {
      const email =
        corpo.email === null || corpo.email === ""
          ? null
          : String(corpo.email).trim().toLowerCase();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new ValidacaoError("e-mail inválido");
      }
      if (email) {
        const dup = await client.query(`SELECT id FROM fin_person WHERE lower(email) = $1 AND id <> $2`, [
          email,
          personId
        ]);
        if (dup.rows[0]) throw new ValidacaoError("este e-mail já está em uso");
      }
      await client.query(`UPDATE fin_person SET email = $2, updated_at = now() WHERE id = $1`, [personId, email]);
    }

    if ("whatsapp" in corpo) {
      const wa =
        corpo.whatsapp === null || corpo.whatsapp === "" ? null : normalizarWhatsapp(String(corpo.whatsapp));
      await client.query(`UPDATE fin_person SET whatsapp = $2, updated_at = now() WHERE id = $1`, [personId, wa]);
    }

    if ("birthDate" in corpo) {
      const bd = corpo.birthDate === null || corpo.birthDate === "" ? null : String(corpo.birthDate).trim();
      if (bd && !/^\d{4}-\d{2}-\d{2}$/.test(bd)) throw new ValidacaoError("data de nascimento inválida");
      await client.query(`UPDATE fin_person SET birth_date = $2::date, updated_at = now() WHERE id = $1`, [
        personId,
        bd
      ]);
    }

    if (corpo.pagamento && typeof corpo.pagamento === "object") {
      const pg = corpo.pagamento;
      const metodo = pg.metodo === "ted" ? "ted" : "pix";
      let pixTipo: string | null = null;
      let pixChave: string | null = null;
      if (metodo === "pix") {
        pixTipo = String(pg.pixTipo ?? "").trim();
        try {
          pixChave = normalizarChavePix(pixTipo, String(pg.pixChave ?? ""));
        } catch (e) {
          throw new ValidacaoError(e instanceof Error ? e.message : "chave PIX inválida");
        }
      }
      const recebeSalario = pg.recebeSalario !== false && pg.recebeSalario !== "false";
      const recebeReembolso = pg.recebeReembolso !== false && pg.recebeReembolso !== "false";

      await client.query(
        `INSERT INTO fin_person_pagamento (
           person_id, entity_id, metodo, pix_tipo, pix_chave,
           recebe_salario, recebe_reembolso, titular_e_a_pessoa, atualizado_em
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, true, now())
         ON CONFLICT (person_id) DO UPDATE SET
           metodo = EXCLUDED.metodo,
           pix_tipo = EXCLUDED.pix_tipo,
           pix_chave = EXCLUDED.pix_chave,
           recebe_salario = EXCLUDED.recebe_salario,
           recebe_reembolso = EXCLUDED.recebe_reembolso,
           atualizado_em = now()`,
        [personId, entityId, metodo, pixTipo, pixChave, recebeSalario, recebeReembolso]
      );

      /*
       * `'update'`, não `'upsert'`.
       *
       * `fin_audit_log_action_check` só aceita insert, update, delete,
       * bulk_update, import e rollback — e `'upsert'` não está lá. Toda
       * gravação de forma de pagamento por esta rota devolvia 500:
       * `new row for relation "fin_audit_log" violates check constraint`.
       *
       * O `tsc` passava limpo porque ele não olha dentro de SQL, e o defeito
       * ficava ESCONDIDO atrás de outro: o CPF da fixture de `test:login`
       * colidia com o do Igor, então a rota recusava com 422 antes de chegar
       * aqui. Consertar a fixture foi o que revelou este.
       *
       * `update` é o valor honesto: o INSERT é `ON CONFLICT DO UPDATE`, e nas
       * 4.392 linhas de auditoria da base a convenção para edição já é essa.
       * Corrigir no código em vez de afrouxar a constraint — ela é a única
       * coisa que impede a coluna de virar texto livre.
       */
      await client.query(
        `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, actor, fields)
         VALUES ($1, 'fin_person_pagamento', $2, 'update', $3, ARRAY['pix_tipo','pix_chave','metodo'])`,
        [entityId, personId, actor]
      );
    }
  });

  const atualizado = await getCadastroAppPessoa(personId);
  if (!atualizado) throw new ValidacaoError("não consegui reler o cadastro");
  return atualizado;
}

export async function definirSenhaAppPessoa(
  personId: number,
  senha: string,
  actor: string
): Promise<{ senhaEntrega: boolean }> {
  if (senha.length < 8) throw new ValidacaoError("senha precisa ter pelo menos 8 caracteres");

  await transaction(async (client) => {
    const ent = await client.query<{ id: number }>(`SELECT id FROM fin_entity WHERE slug = $1`, [ENTITY]);
    const entityId = ent.rows[0]?.id;
    if (!entityId) throw new ValidacaoError("entidade não encontrada");

    const pessoa = await client.query(`SELECT id FROM fin_person WHERE id = $1 AND entity_id = $2`, [
      personId,
      entityId
    ]);
    if (!pessoa.rows[0]) throw new ValidacaoError("pessoa não encontrada");

    const hash = await hashDeSenha(senha);
    await client.query(
      `INSERT INTO fin_person_acesso (person_id, senha_hash, senha_set_at, senha_set_by, senha_trocar, status)
       VALUES ($1, $2, now(), $3, true, 'ativo')
       ON CONFLICT (person_id) DO UPDATE SET
         senha_hash = EXCLUDED.senha_hash,
         senha_set_at = now(),
         senha_set_by = EXCLUDED.senha_set_by,
         senha_trocar = true,
         status = 'ativo',
         falhas = 0,
         bloqueado_ate = NULL`,
      [personId, hash, actor]
    );

    await client.query(
      `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, actor, fields)
       VALUES ($1, 'fin_person_acesso', $2, 'senha_definida', $3, ARRAY['senha_hash'])`,
      [entityId, personId, actor]
    );
  });

  return { senhaEntrega: true };
}

export type CadastroAppFlags = {
  whatsapp: boolean;
  email: boolean;
  cpf: boolean;
  pix: boolean;
  nascimento: boolean;
  senha: boolean;
};

export async function flagsCadastroAppPorPessoa(): Promise<Map<number, CadastroAppFlags>> {
  if (!isFinanceConfigured()) return new Map();

  const rows = await query<{
    person_id: number;
    tem_whatsapp: boolean;
    tem_email: boolean;
    tem_cpf: boolean;
    tem_pix: boolean;
    tem_nascimento: boolean;
    tem_senha: boolean;
  }>(
    `SELECT p.id AS person_id,
            (nullif(btrim(p.whatsapp), '') IS NOT NULL) AS tem_whatsapp,
            (nullif(btrim(p.email), '') IS NOT NULL) AS tem_email,
            (nullif(btrim(p.cpf), '') IS NOT NULL) AS tem_cpf,
            (pg.pix_chave IS NOT NULL AND nullif(btrim(pg.pix_chave), '') IS NOT NULL
             AND pg.pix_tipo IS NOT NULL) AS tem_pix,
            (p.birth_date IS NOT NULL) AS tem_nascimento,
            (a.senha_hash IS NOT NULL) AS tem_senha
       FROM fin_person p
       JOIN fin_entity e ON e.id = p.entity_id AND e.slug = $1
       LEFT JOIN fin_person_pagamento pg ON pg.person_id = p.id
       LEFT JOIN fin_person_acesso a ON a.person_id = p.id`,
    [ENTITY]
  );

  const mapa = new Map<number, CadastroAppFlags>();
  for (const r of rows) {
    mapa.set(r.person_id, {
      whatsapp: !r.tem_whatsapp,
      email: !r.tem_email,
      cpf: !r.tem_cpf,
      pix: !r.tem_pix,
      nascimento: !r.tem_nascimento,
      senha: !r.tem_senha
    });
  }
  return mapa;
}

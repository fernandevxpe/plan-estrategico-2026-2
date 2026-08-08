import "server-only";

import { createHash } from "node:crypto";
import type pg from "pg";

import { query, transaction } from "./db";
import { detectParser, decodeStatement, parserById } from "./parsers/detect";
import type { ParsedRow } from "./parsers/types";
import { dedupeHash, normalizeDescription } from "@/scripts/lib/fin-normalize.mjs";

/**
 * Importação de extrato bancário.
 *
 * É o caminho que destrava a DESPESA. Hoje o Asaas entrega 100% da receita e 0%
 * do custo — enquanto os extratos de Nubank, Inter e Caixa não entrarem,
 * qualquer leitura de lucro é teto, não resultado.
 *
 * O desenho todo gira em torno de uma restrição: o arquivo nasce no CELULAR (é
 * de lá que se exporta o extrato do Nubank). Se conferir exigir uma mesa e dez
 * cliques, a importação diária custa mais que colar na planilha e ninguém faz.
 * Daí duas decisões:
 *
 *   · CLASSIFICAR NÃO ACONTECE AQUI. O lote entra, os lançamentos nascem
 *     'pendente' e vão para a fila de revisão, que se resolve no desktop quando
 *     der. Separar "entrar com o dado" de "deixar o dado certo" é o que torna a
 *     importação barata.
 *   · CONFIRMAR RÁPIDO SÓ É SEGURO COM DESFAZER. Toda a conferência é gravada em
 *     fin_import_row antes do commit, e reverter apaga o lote inteiro.
 */

const ENTITY = "xpe";

export type LinhaPreview = {
  id: number;
  rowNumber: number | null;
  postedOn: string | null;
  amountCents: number | null;
  descricao: string | null;
  status: string;
  message: string | null;
};

export type LotePreview = {
  id: number;
  adapter: string;
  arquivo: string | null;
  conta: { id: number; slug: string; nome: string } | null;
  periodo: { inicio: string | null; fim: string | null };
  status: string;
  contagens: { total: number; novos: number; duplicados: number; forcados: number; ignorados: number };
  saldo: { declaradoCents: number | null; calculadoCents: number | null; divergenciaCents: number | null };
  criadoEm: string;
  linhas: LinhaPreview[];
  avisos: string[];
};

export type ResumoLote = {
  id: number;
  adapter: string;
  arquivo: string | null;
  contaNome: string | null;
  status: string;
  periodo: { inicio: string | null; fim: string | null };
  contagens: { total: number; inseridos: number; duplicados: number };
  criadoEm: string;
  confirmadoEm: string | null;
};

export class ImportError extends Error {
  status: number;
  detalhe: Record<string, unknown>;

  constructor(message: string, status = 400, detalhe: Record<string, unknown> = {}) {
    super(message);
    this.name = "ImportError";
    this.status = status;
    this.detalhe = detalhe;
  }
}

/** Contas que aceitam extrato. O Asaas é alimentado pela API — não por arquivo. */
export async function getContasImportaveis() {
  return query<{ id: number; slug: string; name: string; import_adapter: string }>(
    `SELECT a.id, a.slug, a.name, a.import_adapter
       FROM fin_account a JOIN fin_entity e ON e.id = a.entity_id
      WHERE e.slug = $1 AND a.is_active AND a.import_adapter <> 'asaas_api'
      ORDER BY a.sort_order`,
    [ENTITY]
  );
}

export async function listarLotes(limite = 20): Promise<ResumoLote[]> {
  const rows = await query<{
    id: number;
    adapter: string;
    file_name: string | null;
    conta: string | null;
    status: string;
    period_start: string | null;
    period_end: string | null;
    row_count: number;
    inserted_count: number;
    duplicate_count: number;
    created_at: Date;
    committed_at: Date | null;
  }>(
    `SELECT b.id, b.adapter, b.file_name, a.name AS conta, b.status,
            b.period_start, b.period_end, b.row_count, b.inserted_count, b.duplicate_count,
            b.created_at, b.committed_at
       FROM fin_import_batch b
       JOIN fin_entity e ON e.id = b.entity_id
       LEFT JOIN fin_account a ON a.id = b.account_id
      WHERE e.slug = $1
      ORDER BY b.id DESC
      LIMIT $2`,
    [ENTITY, limite]
  );

  return rows.map((row) => ({
    id: row.id,
    adapter: row.adapter,
    arquivo: row.file_name,
    contaNome: row.conta,
    status: row.status,
    periodo: { inicio: row.period_start, fim: row.period_end },
    contagens: { total: row.row_count, inseridos: row.inserted_count, duplicados: row.duplicate_count },
    criadoEm: row.created_at.toISOString(),
    confirmadoEm: row.committed_at ? row.committed_at.toISOString() : null
  }));
}

/**
 * Recebe o arquivo, detecta o banco, confere e ESTAGIA — não grava lançamento
 * nenhum ainda.
 */
export async function criarLote(
  buffer: Buffer,
  nomeArquivo: string,
  contaSlugForcada?: string | null
): Promise<LotePreview> {
  const texto = decodeStatement(buffer);
  const sha = createHash("sha256").update(buffer).digest("hex");

  const deteccao = detectParser(texto.slice(0, 4000));
  if (!deteccao) {
    throw new ImportError(
      "Não reconheci o formato deste arquivo. Aceito CSV do Nubank, CSV do Inter e OFX (Inter e Caixa).",
      422
    );
  }
  const parser = deteccao.parser;

  let resultado;
  try {
    resultado = parser.parse(texto);
  } catch (erro) {
    throw new ImportError(`Falha ao ler o arquivo: ${(erro as Error).message}`, 422);
  }
  if (!resultado.rows.length) {
    throw new ImportError("O arquivo não tem nenhum lançamento reconhecível.", 422);
  }

  const contas = await getContasImportaveis();
  const conta =
    contas.find((item) => item.slug === (contaSlugForcada ?? parser.accountSlug)) ??
    contas.find((item) => item.slug === parser.accountSlug) ??
    contas[0];
  if (!conta) throw new ImportError("Nenhuma conta cadastrada aceita extrato por arquivo.", 500);

  // Arquivo já importado e CONFIRMADO nesta conta: barra antes de parsear de
  // novo. Lote revertido não bloqueia — reverter existe justamente para
  // permitir reimportar.
  const [jaExiste] = await query<{ id: number; committed_at: Date | null }>(
    `SELECT id, committed_at FROM fin_import_batch
      WHERE account_id = $1 AND file_sha256 = $2 AND status = 'confirmado'`,
    [conta.id, sha]
  );
  if (jaExiste) {
    throw new ImportError(
      `Este mesmo arquivo já foi importado${
        jaExiste.committed_at ? ` em ${jaExiste.committed_at.toISOString().slice(0, 10).split("-").reverse().join("/")}` : ""
      }. Se precisar reimportar, reverta o lote #${jaExiste.id} primeiro.`,
      409,
      { batchId: jaExiste.id }
    );
  }

  const marcadas = await marcarDuplicatas(conta.id, conta.slug, resultado.rows);
  const somaLote = resultado.rows.reduce((total, linha) => total + linha.amountCents, 0);

  return transaction(async (client) => {
    const [{ id: entityId }] = (await client.query<{ id: number }>(`SELECT id FROM fin_entity WHERE slug = $1`, [ENTITY]))
      .rows;

    const {
      rows: [lote]
    } = await client.query<{ id: number; created_at: Date }>(
      `INSERT INTO fin_import_batch (
         entity_id, account_id, adapter, file_name, file_sha256, file_bytes,
         period_start, period_end, declared_balance_cents, row_count, duplicate_count, status, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'preview','ui')
       RETURNING id, created_at`,
      [
        entityId,
        conta.id,
        parser.id,
        nomeArquivo,
        sha,
        buffer.length,
        resultado.periodStart,
        resultado.periodEnd,
        resultado.declaredBalanceCents ?? null,
        resultado.rows.length,
        marcadas.filter((linha) => linha.status === "duplicado").length
      ]
    );

    for (const linha of marcadas) {
      await client.query(
        `INSERT INTO fin_import_row (batch_id, row_number, raw, posted_on, amount_cents, description_raw, dedupe_hash, status, message)
         VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9)`,
        [
          lote.id,
          linha.row.rowNumber,
          JSON.stringify(linha.row),
          linha.row.postedOn,
          linha.row.amountCents,
          linha.row.descriptionRaw,
          linha.hash,
          linha.status,
          linha.message
        ]
      );
    }

    // Saldo calculado = o que o banco diz que era + o que este extrato move.
    // A conferência é o que pega linha faltando ANTES de o dado envenenar o
    // ledger; sem ela, um extrato truncado entra sem ninguém notar.
    const {
      rows: [saldoAtual]
    } = await client.query<{ saldo: number }>(
      `SELECT COALESCE(SUM(amount_cents), 0) AS saldo FROM fin_transaction WHERE account_id = $1`,
      [conta.id]
    );
    const calculado = saldoAtual.saldo + somaLote;
    const divergencia =
      resultado.declaredBalanceCents !== null && resultado.declaredBalanceCents !== undefined
        ? resultado.declaredBalanceCents - calculado
        : null;

    await client.query(
      `UPDATE fin_import_batch SET computed_balance_cents = $2, variance_cents = $3 WHERE id = $1`,
      [lote.id, calculado, divergencia]
    );

    return montarPreview(client, lote.id, resultado.warnings);
  });
}

/**
 * Marca cada linha como nova ou duplicada.
 *
 * Duas estratégias, e a escolha depende do banco:
 *
 *   · COM id estável (Identificador do Nubank, FITID do OFX) — a checagem é
 *     exata, sem heurística: o id já existe na conta ou não existe.
 *   · SEM id (CSV do Inter) — agrupa por (data, valor, descrição normalizada) e
 *     compara a CONTAGEM do grupo no arquivo com a do banco, inserindo só o
 *     excedente. É o que faz reimportar o mesmo arquivo ser inócuo E ainda
 *     assim deixar entrar o segundo PIX de R$ 50 idêntico quando ele aparece
 *     num extrato posterior — coisa que o hash sozinho não distingue.
 */
async function marcarDuplicatas(accountId: number, accountSlug: string, linhas: ParsedRow[]) {
  const comId = linhas.filter((linha) => linha.sourceId);
  const idsExistentes = new Set<string>();
  if (comId.length) {
    const existentes = await query<{ source_id: string }>(
      `SELECT source_id FROM fin_transaction WHERE account_id = $1 AND source_id = ANY($2)`,
      [accountId, comId.map((linha) => linha.sourceId)]
    );
    existentes.forEach((row) => idsExistentes.add(row.source_id));
  }

  // Quantas linhas de cada grupo natural já existem no banco.
  const semId = linhas.filter((linha) => !linha.sourceId);
  const contagemBanco = new Map<string, number>();
  if (semId.length) {
    const chaves = semId.map((linha) => `${linha.postedOn}|${linha.amountCents}|${normalizeDescription(linha.descriptionRaw)}`);
    const existentes = await query<{ chave: string; n: number }>(
      `SELECT posted_on::text || '|' || amount_cents::text || '|' || description_norm AS chave, count(*)::int AS n
         FROM fin_transaction
        WHERE account_id = $1
          AND posted_on::text || '|' || amount_cents::text || '|' || description_norm = ANY($2)
        GROUP BY 1`,
      [accountId, chaves]
    );
    existentes.forEach((row) => contagemBanco.set(row.chave, row.n));
  }

  const vistasNoArquivo = new Map<string, number>();

  return linhas.map((row) => {
    if (row.sourceId) {
      const duplicada = idsExistentes.has(row.sourceId);
      return {
        row,
        hash: dedupeHash({ accountSlug, sourceId: row.sourceId }),
        status: duplicada ? "duplicado" : "novo",
        message: duplicada ? "já existe no extrato importado" : null
      };
    }

    const chave = `${row.postedOn}|${row.amountCents}|${normalizeDescription(row.descriptionRaw)}`;
    const ordinalNoArquivo = vistasNoArquivo.get(chave) ?? 0;
    vistasNoArquivo.set(chave, ordinalNoArquivo + 1);
    const jaNoBanco = contagemBanco.get(chave) ?? 0;
    const duplicada = ordinalNoArquivo < jaNoBanco;

    return {
      row,
      hash: dedupeHash({
        accountSlug,
        date: row.postedOn,
        amountCents: row.amountCents,
        description: row.descriptionRaw,
        occurrenceIndex: ordinalNoArquivo
      }),
      status: duplicada ? "duplicado" : "novo",
      message: duplicada ? "linha idêntica já existe no ledger" : null
    };
  });
}

async function montarPreview(client: pg.PoolClient, batchId: number, avisos: string[] = []): Promise<LotePreview> {
  const {
    rows: [lote]
  } = await client.query(
    `SELECT b.*, a.id AS conta_id, a.slug AS conta_slug, a.name AS conta_nome
       FROM fin_import_batch b LEFT JOIN fin_account a ON a.id = b.account_id
      WHERE b.id = $1`,
    [batchId]
  );
  const { rows: linhas } = await client.query(
    `SELECT id, row_number, posted_on, amount_cents, description_raw, status, message
       FROM fin_import_row WHERE batch_id = $1 ORDER BY row_number, id`,
    [batchId]
  );

  const contar = (status: string) => linhas.filter((linha) => linha.status === status).length;

  return {
    id: lote.id,
    adapter: lote.adapter,
    arquivo: lote.file_name,
    conta: lote.conta_id ? { id: lote.conta_id, slug: lote.conta_slug, nome: lote.conta_nome } : null,
    periodo: { inicio: lote.period_start, fim: lote.period_end },
    status: lote.status,
    contagens: {
      total: linhas.length,
      novos: contar("novo"),
      duplicados: contar("duplicado"),
      forcados: contar("forcado"),
      ignorados: contar("ignorado")
    },
    saldo: {
      declaradoCents: lote.declared_balance_cents,
      calculadoCents: lote.computed_balance_cents,
      divergenciaCents: lote.variance_cents
    },
    criadoEm: lote.created_at.toISOString(),
    linhas: linhas.map((linha) => ({
      id: linha.id,
      rowNumber: linha.row_number,
      postedOn: linha.posted_on,
      amountCents: linha.amount_cents,
      descricao: linha.description_raw,
      status: linha.status,
      message: linha.message
    })),
    avisos
  };
}

export async function getLote(batchId: number): Promise<LotePreview | null> {
  return transaction(async (client) => {
    const { rows } = await client.query(`SELECT 1 FROM fin_import_batch WHERE id = $1`, [batchId]);
    if (!rows.length) return null;
    return montarPreview(client, batchId);
  });
}

/** "Importar mesmo assim" / "tirar do lote", gravado antes do commit. */
export async function decidirLinha(batchId: number, rowId: number, acao: "forcar" | "ignorar" | "restaurar") {
  const novoStatus = acao === "forcar" ? "forcado" : acao === "ignorar" ? "ignorado" : "novo";
  const linhas = await query<{ id: number }>(
    `UPDATE fin_import_row SET status = $3
      WHERE batch_id = $1 AND id = $2 AND status IN ('novo', 'duplicado', 'forcado', 'ignorado')
      RETURNING id`,
    [batchId, rowId, novoStatus]
  );
  if (!linhas.length) throw new ImportError("Linha não encontrada neste lote.", 404);
  return getLote(batchId);
}

export async function descartarLote(batchId: number) {
  const rows = await query<{ id: number }>(
    `UPDATE fin_import_batch SET status = 'descartado' WHERE id = $1 AND status = 'preview' RETURNING id`,
    [batchId]
  );
  if (!rows.length) throw new ImportError("Só um lote em conferência pode ser descartado.", 409);
}

/**
 * Confirma o lote: as linhas viram lançamentos de verdade.
 *
 * Tudo numa transação. Se qualquer linha falhar, nada entra — meio extrato
 * importado é pior que extrato nenhum, porque a conferência de saldo passa a
 * mentir e ninguém sabe onde parou.
 */
export async function confirmarLote(batchId: number, aceitarDivergencia = false) {
  return transaction(async (client) => {
    const {
      rows: [lote]
    } = await client.query(
      `SELECT b.*, a.slug AS conta_slug FROM fin_import_batch b
         JOIN fin_account a ON a.id = b.account_id WHERE b.id = $1 FOR UPDATE`,
      [batchId]
    );
    if (!lote) throw new ImportError("Lote não encontrado.", 404);
    if (lote.status !== "preview") throw new ImportError(`Lote já está como "${lote.status}".`, 409);

    // Divergência de saldo é o único sinal de completude que existe. Passar por
    // cima dela é decisão consciente do humano, nunca padrão.
    if (lote.variance_cents !== null && lote.variance_cents !== 0 && !aceitarDivergencia) {
      throw new ImportError(
        "O saldo que o arquivo declara não bate com o que o ledger calcula. Confira se falta alguma linha antes de confirmar.",
        422,
        {
          declaradoCents: lote.declared_balance_cents,
          calculadoCents: lote.computed_balance_cents,
          divergenciaCents: lote.variance_cents
        }
      );
    }

    const { rows: linhas } = await client.query(
      `SELECT * FROM fin_import_row WHERE batch_id = $1 AND status IN ('novo', 'forcado') ORDER BY row_number, id`,
      [batchId]
    );

    let inseridos = 0;
    for (const linha of linhas) {
      const raw = linha.raw as ParsedRow;
      // Linha forçada precisa de um hash diferente do que já existe, senão o
      // índice único a rejeita — que é justamente o que ela quer contornar.
      const hash =
        linha.status === "forcado"
          ? dedupeHash({
              accountSlug: lote.conta_slug,
              date: linha.posted_on,
              amountCents: linha.amount_cents,
              description: linha.description_raw,
              occurrenceIndex: 1000 + linha.id
            })
          : linha.dedupe_hash;

      const {
        rows: [criada]
      } = await client.query(
        `INSERT INTO fin_transaction (
           entity_id, account_id, posted_on, amount_cents, description_raw, description_norm,
           balance_after_cents, source_kind, source, source_id, dedupe_hash,
           import_batch_id, review_status, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pendente','ui')
         ON CONFLICT (account_id, dedupe_version, dedupe_hash) DO NOTHING
         RETURNING id`,
        [
          lote.entity_id,
          lote.account_id,
          linha.posted_on,
          linha.amount_cents,
          linha.description_raw ?? "(sem descrição)",
          normalizeDescription(linha.description_raw ?? ""),
          raw?.balanceAfterCents ?? null,
          raw?.sourceKind ?? null,
          lote.adapter === "ofx" ? "import_ofx" : "import_csv",
          raw?.sourceId ?? null,
          hash,
          batchId
        ]
      );

      if (criada) {
        inseridos += 1;
        await client.query(`UPDATE fin_import_row SET status = 'importado', transaction_id = $2 WHERE id = $1`, [
          linha.id,
          criada.id
        ]);
        // Vai para a fila de revisão: classificar não acontece na importação.
        await client.query(
          `INSERT INTO fin_review_item (entity_id, target_table, target_id, reason, amount_cents)
           VALUES ($1, 'fin_transaction', $2, 'sem_categoria', $3)
           ON CONFLICT (target_table, target_id) DO NOTHING`,
          [lote.entity_id, criada.id, linha.amount_cents]
        );
      } else {
        await client.query(
          `UPDATE fin_import_row SET status = 'duplicado', message = 'rejeitada pelo índice de duplicidade' WHERE id = $1`,
          [linha.id]
        );
      }
    }

    if (lote.period_start) {
      await client.query(
        `INSERT INTO fin_statement_coverage (account_id, period_start, period_end, source, import_batch_id)
         VALUES ($1, $2, $3, 'extrato', $4)
         ON CONFLICT (account_id, source, period_start)
         DO UPDATE SET period_end = GREATEST(fin_statement_coverage.period_end, EXCLUDED.period_end),
                       import_batch_id = EXCLUDED.import_batch_id`,
        [lote.account_id, lote.period_start, lote.period_end, batchId]
      );
    }

    await client.query(
      `UPDATE fin_account
          SET last_statement_at = now(),
              current_balance_cents = COALESCE($2, current_balance_cents)
        WHERE id = $1`,
      [lote.account_id, lote.declared_balance_cents ?? lote.computed_balance_cents]
    );

    await client.query(
      `UPDATE fin_import_batch SET status = 'confirmado', inserted_count = $2, committed_at = now() WHERE id = $1`,
      [batchId, inseridos]
    );

    await client.query(
      `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, after, actor)
       VALUES ($1, 'fin_import_batch', $2, 'import', $3::jsonb, 'ui')`,
      [lote.entity_id, batchId, JSON.stringify({ inseridos, arquivo: lote.file_name, conta: lote.conta_slug })]
    );

    return { inseridos, batchId };
  });
}

/**
 * Reverte um lote confirmado.
 *
 * É o que torna seguro confirmar rápido. Sem desfazer, ninguém aceita um lote
 * sem conferir linha a linha — e aí a importação diária volta a custar mais que
 * a planilha, que é o fracasso que este módulo existe para evitar.
 */
export async function reverterLote(batchId: number) {
  return transaction(async (client) => {
    const {
      rows: [lote]
    } = await client.query(`SELECT * FROM fin_import_batch WHERE id = $1 FOR UPDATE`, [batchId]);
    if (!lote) throw new ImportError("Lote não encontrado.", 404);
    if (lote.status !== "confirmado") throw new ImportError("Só um lote confirmado pode ser revertido.", 409);

    const { rows: alvos } = await client.query<{ id: number }>(
      `SELECT id FROM fin_transaction WHERE import_batch_id = $1`,
      [batchId]
    );
    const ids = alvos.map((linha) => linha.id);

    if (ids.length) {
      await client.query(`DELETE FROM fin_review_item WHERE target_table = 'fin_transaction' AND target_id = ANY($1)`, [
        ids
      ]);
      // fin_settlement cai por cascade; a liquidação sem lançamento não faz
      // sentido e o gatilho reajusta o documento sozinho.
      await client.query(`DELETE FROM fin_transaction WHERE id = ANY($1)`, [ids]);
    }

    await client.query(
      `UPDATE fin_import_row SET status = 'ignorado', transaction_id = NULL WHERE batch_id = $1 AND status = 'importado'`,
      [batchId]
    );
    await client.query(`DELETE FROM fin_statement_coverage WHERE import_batch_id = $1`, [batchId]);
    await client.query(
      `UPDATE fin_import_batch SET status = 'revertido', reverted_at = now(), inserted_count = 0 WHERE id = $1`,
      [batchId]
    );

    // Saldo E carimbo de extrato voltam ao que o ledger sustenta.
    //
    // Sem recalcular last_statement_at, uma conta com o único lote revertido
    // continuava anunciando "extrato de 08/08" na tela — contradizendo a
    // cobertura, que já tinha sido apagada. Reverter tem de apagar tudo que a
    // importação afirmou, inclusive a afirmação de que existe extrato.
    await client.query(
      `UPDATE fin_account a
          SET current_balance_cents = COALESCE((SELECT SUM(amount_cents) FROM fin_transaction t WHERE t.account_id = a.id), 0),
              last_statement_at = (SELECT MAX(c.created_at) FROM fin_statement_coverage c WHERE c.account_id = a.id)
        WHERE a.id = $1`,
      [lote.account_id]
    );

    await client.query(
      `INSERT INTO fin_audit_log (entity_id, target_table, target_id, action, before, actor)
       VALUES ($1, 'fin_import_batch', $2, 'rollback', $3::jsonb, 'ui')`,
      [lote.entity_id, batchId, JSON.stringify({ removidos: ids.length })]
    );

    return { removidos: ids.length };
  });
}

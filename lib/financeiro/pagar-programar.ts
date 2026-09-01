import "server-only";

import { createHash, randomUUID } from "node:crypto";

import type pg from "pg";

import { query, queryOne, transaction } from "./db";
import { incluirPagamentoPix, pagamentoInterHabilitado } from "./inter-pagamento";

/**
 * Programar pagamento: gravar a ORDEM e, opcionalmente, entregá-la ao banco
 * para que um humano autorize no aplicativo.
 *
 * A mecânica mora aqui e não na rota pelo mesmo motivo de `contas.ts` e
 * `revisao.ts`: um invariante cumprido em dois lugares vira um invariante
 * cumprido em um lugar e meio. A rota (`app/api/financeiro/contas-a-pagar/
 * programar/route.ts`) só traduz HTTP.
 *
 * ===========================================================================
 * A REGRA QUE GOVERNA O ARQUIVO INTEIRO
 * ===========================================================================
 * O dono, literal: "quero apenas programar os pagamentos, mas toda aprovação
 * vai ter que ser feita pelo aplicativo do banco, ou seja lança para pagamento
 * mas não realiza o pagamento."
 *
 * O estado final que este código escreve é `aguardando_autorizacao` — que a
 * 0075 define como "onde o produto termina o seu trabalho: o lote saiu e a
 * pessoa está no aplicativo do banco". NUNCA `pago`.
 *
 * `fin_payment_execution` não é tocada por nenhuma linha daqui. Ela é registro
 * do passado, tem gatilho que recusa `paid_on` futuro (0075:705-716), e
 * `paid_cents` é mantido a partir dela — escrever em qualquer um dos dois
 * transformaria "mandei para o banco" em "saiu do caixa", que é a mentira mais
 * cara que este módulo poderia contar.
 *
 * ===========================================================================
 * COMO O `codigoSolicitacao` FOI CONCILIADO COM A PROIBIÇÃO DA 0075
 * ===========================================================================
 * A 0075:20-24 proíbe, por escrito e para toda migration futura: "Não existe
 * coluna de credencial, endpoint, token, `api_payment_id` ou qualquer campo
 * cuja semântica seja 'mandar para o banco'."
 *
 * E o dono pediu exatamente para mandar ao banco. As duas coisas convivem, e o
 * que as concilia é o que a proibição protege: uma COLUNA
 * máquina-endereçável convida o próximo código a fazer
 * `WHERE api_payment_id IS NOT NULL` e depois a consultar o banco, e depois a
 * "confirmar" — e aí a fila deixou de ser humana sem que ninguém tenha
 * decidido isso.
 *
 * Então nenhuma coluna nova foi criada. O `codigoSolicitacao` e o
 * `tipoRetorno` vão para `notes` (texto livre, uma linha datada com autor) e
 * para `tags` (marcadores), que são os MESMOS campos que uma pessoa
 * preencheria à mão depois de levar o lote ao banco — a 0075 já os prevê para
 * `authorized_outside_system`, `authorized_by`, `authorized_at`. O registro
 * fica sendo o que ele é de fato: uma anotação sobre um ato humano em curso,
 * não um ponteiro que outro código possa desreferenciar para dirigir dinheiro.
 *
 * Se um dia isto precisar virar consulta indexada, a conversa é com o dono e
 * com a 0075 — não com um `ALTER TABLE`.
 */

const ENTIDADE = "xpe";

export class ValidacaoPagamento extends Error {
  constructor(
    message: string,
    readonly status = 422
  ) {
    super(message);
    this.name = "ValidacaoPagamento";
  }
}

export type AlvoProgramacao = {
  /** Identidade da obrigação no mês, vinda da agenda. É a chave de idempotência. */
  chaveDedupe: string;
  origemTabela: string | null;
  origemId: number | null;
  counterpartyId: number;
  descricao: string;
  valorCents: number;
  /** YYYY-MM-DD */
  dueDate: string;
  categoryId: number | null;
  nucleo: string | null;
};

export type ResultadoProgramacao = {
  criadas: { id: number; code: string; chaveDedupe: string; status: string }[];
  jaExistiam: { chaveDedupe: string; code: string; status: string }[];
  recusadas: { chaveDedupe: string; motivo: string }[];
};

/**
 * De onde a obrigação veio → como ela se grava.
 *
 * `fin_payment_origem_unica` (0075) permite NO MÁXIMO uma origem: a mesma
 * obrigação entrando na fila por dois caminhos dobra o caixa previsto, que é a
 * lição da 0045 e da 0057. Por isso este mapa é 1-para-1 e a coluna sai daqui,
 * de uma lista fechada — nunca de string do chamador interpolada em SQL.
 */
/*
 * `coluna: null` NÃO é origem desconhecida — é origem SEM COLUNA DE FK.
 *
 * A 0075 dá cinco ponteiros de origem (`document_id`, `recurring_id`,
 * `card_bill_id`, `reimbursement_id`, `purchase_request_id`) e nenhum para
 * PESSOA. Isso não é lacuna: `fin_payment_request.requested_person_id` responde
 * "quem pediu", e a folha precisa de "quem recebe" — que já está em
 * `counterparty_id`. O CHECK `fin_payment_origem_unica` diz "no máximo UMA", e
 * zero é válido.
 *
 * Recusar `fin_person` custou o primeiro teste real (31/08/2026): a comissão de
 * R$ 10,00 do Fernando voltou como "origemTabela desconhecida". O vínculo com a
 * obrigação — que era a razão de recusar origem desconhecida — não se perde
 * aqui: `source_id` guarda a chave inteira (`2026-09|fin_person:4:comissao`), e
 * é ela que o índice único usa para impedir a segunda ordem.
 */
const ORIGENS: Record<string, { source: string; coluna: string | null }> = {
  fin_document: { source: "documento", coluna: "document_id" },
  fin_recurring: { source: "recorrente", coluna: "recurring_id" },
  fin_card_bill: { source: "fatura_cartao", coluna: "card_bill_id" },
  fin_reimbursement: { source: "reembolso", coluna: "reimbursement_id" },
  fin_purchase_request: { source: "compra", coluna: "purchase_request_id" },
  // A folha, banda a banda. `source` é 'manual' porque o CHECK da 0075 não tem
  // 'folha' — e acrescentar valor a CHECK exige migration, que muda produção
  // para ganhar um rótulo. A chave em `source_id` já diz o que é.
  fin_person: { source: "manual", coluna: null }
};

const METODOS = new Set(["pix", "ted", "boleto"]);
const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

type ContaFavorecida = {
  id: number;
  operation_type: string;
  pix_address_key: string | null;
  pix_address_key_type: string | null;
  bank_code: string | null;
  bank_name: string | null;
  agency: string | null;
  account_number: string | null;
  account_digit: string | null;
  account_type: string | null;
  owner_name: string | null;
  owner_document: string | null;
  label: string | null;
};

/**
 * Impressão estável da coordenada bancária.
 *
 * A 0075 chama a mudança dela entre pagamentos do mesmo beneficiário de "o
 * alerta mais caro de perder": é a assinatura da fraude de troca de
 * favorecido. Só entra no hash o que determina PARA ONDE o dinheiro vai —
 * `label` e `bank_name` ficam de fora porque renomear o apelido da conta não
 * pode disparar alarme falso.
 */
function impressaoDaConta(conta: ContaFavorecida): string {
  const partes =
    conta.operation_type === "TED"
      ? ["TED", conta.bank_code, conta.agency, conta.account_number, conta.account_digit, conta.owner_document]
      : ["PIX", conta.pix_address_key_type, conta.pix_address_key, conta.owner_document];
  const texto = partes.map((parte) => (parte ?? "").trim().toLowerCase()).join("|");
  return createHash("sha256").update(texto).digest("hex");
}

/**
 * Foto da coordenada no instante da escolha.
 *
 * Sem ela, editar a conta do fornecedor reescreve retroativamente para onde o
 * dinheiro foi (0075:196-199). O snapshot é o que permite responder "para onde
 * esta ordem mandava, no dia em que foi criada" mesmo depois de a conta mudar.
 */
function fotoDaConta(conta: ContaFavorecida): Record<string, unknown> {
  return {
    payee_account_id: conta.id,
    operation_type: conta.operation_type,
    pix_address_key: conta.pix_address_key,
    pix_address_key_type: conta.pix_address_key_type,
    bank_code: conta.bank_code,
    bank_name: conta.bank_name,
    agency: conta.agency,
    account_number: conta.account_number,
    account_digit: conta.account_digit,
    account_type: conta.account_type,
    owner_name: conta.owner_name,
    owner_document: conta.owner_document,
    label: conta.label,
    capturado_em: new Date().toISOString()
  };
}

const COLUNAS_CONTA = `id, operation_type, pix_address_key, pix_address_key_type, bank_code, bank_name,
        agency, account_number, account_digit, account_type, owner_name, owner_document, label`;

async function entidadeId(c: pg.PoolClient): Promise<number> {
  const { rows } = await c.query<{ id: number }>(`SELECT id FROM fin_entity WHERE slug = $1`, [ENTIDADE]);
  if (!rows[0]) throw new ValidacaoPagamento(`entidade ${ENTIDADE} não existe neste banco`, 503);
  return Number(rows[0].id);
}

/** Erro do Postgres em texto legível, para caber no motivo de uma recusa. */
function motivoDoErro(erro: unknown): string {
  if (erro instanceof ValidacaoPagamento) return erro.message;
  const mensagem = erro instanceof Error ? erro.message : String(erro);
  return mensagem.replace(/\s+/g, " ").slice(0, 300);
}

/** Validação que não depende de banco. Devolve o motivo, ou null se passou. */
function conferirAlvo(alvo: AlvoProgramacao): string | null {
  if (!alvo?.chaveDedupe?.trim()) return "chaveDedupe vazia — sem ela não há idempotência";
  if (!Number.isSafeInteger(alvo.counterpartyId) || alvo.counterpartyId <= 0) {
    return "counterpartyId inválido";
  }
  if (!alvo.descricao?.trim()) return "descrição vazia";
  if (!Number.isSafeInteger(alvo.valorCents) || alvo.valorCents <= 0) {
    return "valorCents tem de ser inteiro positivo em centavos";
  }
  if (!DATA_ISO.test(alvo.dueDate ?? "")) return "dueDate tem de ser YYYY-MM-DD";
  if (alvo.origemTabela && !ORIGENS[alvo.origemTabela]) {
    // Recusa em vez de cair para 'manual': cair silenciosamente perderia o
    // vínculo com a obrigação de origem, e a fila deixaria de saber o que está
    // pagando — que é justamente o buraco que ela existe para fechar.
    return `origemTabela "${alvo.origemTabela}" desconhecida (aceitas: ${Object.keys(ORIGENS).join(", ")})`;
  }
  if (alvo.origemTabela && (!Number.isSafeInteger(alvo.origemId) || (alvo.origemId ?? 0) <= 0)) {
    return `origemTabela "${alvo.origemTabela}" exige origemId`;
  }
  return null;
}

/**
 * Grava a ORDEM. Não fala com banco nenhum — só com o Postgres.
 *
 * Tudo numa transação: meio lote gravado é pior que nada gravado quando o
 * assunto é dinheiro. Mas cada alvo roda dentro de um SAVEPOINT próprio, e a
 * razão é operacional: uma contraparte com FK quebrada não pode derrubar os
 * outros 40 pagamentos do lote. A linha ruim vira `recusadas` com a mensagem
 * do Postgres junto, e o resto commita.
 */
export async function programarPagamentos(
  alvos: AlvoProgramacao[],
  opcoes: { scheduledFor: string; metodo: "pix" | "ted" | "boleto"; actor: string }
): Promise<ResultadoProgramacao> {
  if (!Array.isArray(alvos) || alvos.length === 0) {
    throw new ValidacaoPagamento("nenhum alvo para programar");
  }
  if (!DATA_ISO.test(opcoes?.scheduledFor ?? "")) {
    throw new ValidacaoPagamento("scheduledFor tem de ser YYYY-MM-DD");
  }
  if (!METODOS.has(opcoes?.metodo)) {
    throw new ValidacaoPagamento("metodo tem de ser 'pix', 'ted' ou 'boleto'");
  }
  const actor = opcoes.actor?.trim() || "tela";

  const resultado: ResultadoProgramacao = { criadas: [], jaExistiam: [], recusadas: [] };
  const batchId = randomUUID();

  await transaction(async (c) => {
    const entityId = await entidadeId(c);

    for (const alvo of alvos) {
      const chave = alvo?.chaveDedupe?.trim() ?? "";
      const problema = conferirAlvo(alvo);
      if (problema) {
        resultado.recusadas.push({ chaveDedupe: chave || "(sem chave)", motivo: problema });
        continue;
      }

      await c.query("SAVEPOINT alvo");
      try {
        const origem = alvo.origemTabela ? ORIGENS[alvo.origemTabela] : null;
        const source = origem?.source ?? "manual";

        // Coordenada bancária: sem ela a ordem não nasce. Pagar para "não sei
        // quem" é o buraco que a fila existe para fechar (0075:192-194), e
        // gravar a ordem sem favorecido só empurraria a pergunta para o dia do
        // pagamento, com pressa.
        //
        // Nota para quem for ampliar: a coordenada de PESSOA do time vive em
        // `fin_person_pagamento` (0159), que é outro eixo — pessoa, não
        // contraparte. Ligar os dois é trabalho à parte e não está feito aqui.
        const { rows: contas } = await c.query<ContaFavorecida>(
          `SELECT ${COLUNAS_CONTA}
             FROM fin_payee_account
            WHERE counterparty_id = $1 AND is_default AND is_active
            LIMIT 1`,
          [alvo.counterpartyId]
        );
        const conta = contas[0];
        if (!conta) {
          await c.query("ROLLBACK TO SAVEPOINT alvo");
          await c.query("RELEASE SAVEPOINT alvo");
          resultado.recusadas.push({
            chaveDedupe: chave,
            motivo: `contraparte ${alvo.counterpartyId} não tem conta favorecida padrão ativa em fin_payee_account — cadastre a chave PIX antes de programar`
          });
          continue;
        }

        // Guarda anterior ao INSERT porque este conflito NÃO cai no
        // ON CONFLICT abaixo: `fin_payment_request_documento_vivo_idx` é um
        // segundo índice único (document_id, enquanto a ordem estiver viva), e
        // uma violação dele estouraria a transação inteira em vez de devolver
        // zero linhas.
        if (origem?.coluna === "document_id") {
          const { rows: vivas } = await c.query<{ code: string; status: string }>(
            `SELECT code, status
               FROM fin_payment_request
              WHERE document_id = $1 AND status NOT IN ('rejeitada', 'cancelada')
              LIMIT 1`,
            [alvo.origemId]
          );
          if (vivas[0]) {
            await c.query("ROLLBACK TO SAVEPOINT alvo");
            await c.query("RELEASE SAVEPOINT alvo");
            resultado.jaExistiam.push({ chaveDedupe: chave, code: vivas[0].code, status: vivas[0].status });
            continue;
          }
        }

        const impressao = impressaoDaConta(conta);
        const campos: { coluna: string; valor: unknown; cast?: string }[] = [
          { coluna: "entity_id", valor: entityId },
          { coluna: "counterparty_id", valor: alvo.counterpartyId },
          { coluna: "description", valor: alvo.descricao.trim() },
          { coluna: "due_date", valor: alvo.dueDate },
          { coluna: "scheduled_for", valor: opcoes.scheduledFor },
          { coluna: "amount_cents", valor: alvo.valorCents },
          { coluna: "method", valor: opcoes.metodo },
          // Nasce em rascunho SEMPRE. Quem move para `aguardando_autorizacao` é
          // o envio ao banco (enviarOrdemAoInter), nunca a gravação: se a
          // gravação já nascesse "aguardando", o painel afirmaria que alguém
          // está no aplicativo do banco quando ninguém está.
          { coluna: "status", valor: "rascunho" },
          { coluna: "category_id", valor: alvo.categoryId ?? null },
          { coluna: "nucleo", valor: alvo.nucleo ?? null },
          { coluna: "source", valor: source },
          { coluna: "source_id", valor: chave },
          { coluna: "payee_account_id", valor: conta.id },
          { coluna: "payee_snapshot", valor: JSON.stringify(fotoDaConta(conta)), cast: "::jsonb" },
          { coluna: "payee_fingerprint", valor: impressao },
          { coluna: "requested_by", valor: actor }
        ];
        // `code` e `description_norm` NÃO entram: são preenchidos por gatilho
        // (fin_pagamento_codigo e fin_payment_request_norm, 0075:668-703).
        // Só empurra o ponteiro quando a origem TEM coluna. `fin_person` não tem,
        // e o CHECK fin_payment_origem_unica aceita zero origens de propósito.
        if (origem?.coluna) campos.push({ coluna: origem.coluna, valor: alvo.origemId });

        const colunas = campos.map((campo) => campo.coluna).join(", ");
        const marcadores = campos.map((campo, i) => `$${i + 1}${campo.cast ?? ""}`).join(", ");
        const valores = campos.map((campo) => campo.valor);

        const { rows: criadas } = await c.query<{ id: number; code: string; status: string }>(
          `INSERT INTO fin_payment_request (${colunas})
           VALUES (${marcadores})
           ON CONFLICT (entity_id, source, source_id) WHERE source_id IS NOT NULL DO NOTHING
           RETURNING id, code, status`,
          valores
        );

        if (!criadas[0]) {
          // Zero linhas = o índice único (entity_id, source, source_id) já
          // tinha esta obrigação. Programar duas vezes o mesmo compromisso não
          // pode criar duas ordens, e este é o ponto em que isso é garantido
          // pelo banco, não pela boa vontade do chamador.
          const { rows: antigas } = await c.query<{ code: string; status: string }>(
            `SELECT code, status
               FROM fin_payment_request
              WHERE entity_id = $1 AND source = $2 AND source_id = $3`,
            [entityId, source, chave]
          );
          await c.query("RELEASE SAVEPOINT alvo");
          if (antigas[0]) {
            resultado.jaExistiam.push({ chaveDedupe: chave, code: antigas[0].code, status: antigas[0].status });
          } else {
            resultado.recusadas.push({ chaveDedupe: chave, motivo: "conflito de idempotência sem linha correspondente" });
          }
          continue;
        }

        const nova = criadas[0];
        await c.query(
          `INSERT INTO fin_audit_log
              (entity_id, target_table, target_id, action, before, after, fields, batch_id, actor)
           VALUES ($1, 'fin_payment_request', $2, 'insert', NULL, $3::jsonb,
                   ARRAY['status', 'scheduled_for', 'payee_account_id'], $4::uuid, $5)`,
          [
            entityId,
            nova.id,
            JSON.stringify({
              code: nova.code,
              status: nova.status,
              source,
              source_id: chave,
              scheduled_for: opcoes.scheduledFor,
              method: opcoes.metodo,
              amount_cents: alvo.valorCents,
              payee_account_id: conta.id,
              payee_fingerprint: impressao
            }),
            batchId,
            actor
          ]
        );

        await c.query("RELEASE SAVEPOINT alvo");
        resultado.criadas.push({
          id: Number(nova.id),
          code: nova.code,
          chaveDedupe: chave,
          status: nova.status
        });
      } catch (erro) {
        await c.query("ROLLBACK TO SAVEPOINT alvo");
        await c.query("RELEASE SAVEPOINT alvo");
        resultado.recusadas.push({ chaveDedupe: chave, motivo: motivoDoErro(erro) });
      }
    }
  });

  return resultado;
}

type OrdemNoBanco = {
  id: number;
  entity_id: number;
  code: string;
  status: string;
  method: string | null;
  net_cents: number;
  description: string;
  scheduled_for: string | null;
  due_date: string;
  counterparty_id: number;
  payee_account_id: number | null;
  payee_snapshot: Record<string, unknown> | null;
  payee_fingerprint: string | null;
};

/**
 * Manda a ordem para o Inter e para em `aguardando_autorizacao`. NÃO aprova.
 *
 * A chamada ao banco acontece FORA de transação, e isso é deliberado: o pool
 * tem `max: 5` e `statement_timeout: 20s` (lib/financeiro/db.ts), e segurar uma
 * conexão aberta durante uma chamada HTTP de até 30s ao Inter derrubaria o
 * `/financeiro` inteiro — foi exatamente esse efeito colateral, com a agenda
 * lenta, que devolveu 500 em 17/08/2026.
 *
 * O preço dessa escolha é uma janela: dois envios simultâneos da mesma ordem
 * passariam pela conferência de status antes de qualquer um gravar. O UPDATE
 * final fecha a janela do lado do banco (`WHERE status IN (...)` — o segundo
 * atualiza zero linhas), mas do lado do Inter só o header de idempotência
 * fecha, e ele é PALPITE NÃO VERIFICADO (ver as constantes de
 * lib/financeiro/inter-pagamento.ts). Enquanto não for verificado, tratar
 * envio concorrente como risco real: a chave enviada é o `code`, estável, o
 * que é o melhor que dá para fazer daqui.
 */
export async function enviarOrdemAoInter(
  id: number,
  opcoes: { actor: string }
): Promise<{ id: number; code: string; status: string; codigoSolicitacao: string | null; tipoRetorno: string | null }> {
  if (!Number.isSafeInteger(id) || id <= 0) throw new ValidacaoPagamento("id inválido");
  const actor = opcoes?.actor?.trim() || "tela";

  // Antes de qualquer leitura de banco: se a escrita bancária está desligada,
  // o pedido inteiro é inútil e o motivo tem de chegar legível a quem clicou.
  const trava = pagamentoInterHabilitado();
  if (!trava.ok) throw new ValidacaoPagamento(trava.motivo ?? "escrita bancária desligada", 503);

  const ordem = await queryOne<OrdemNoBanco>(
    `SELECT id, entity_id, code, status, method, net_cents, description,
            scheduled_for, due_date, counterparty_id,
            payee_account_id, payee_snapshot, payee_fingerprint
       FROM fin_payment_request
      WHERE id = $1`,
    [id]
  );
  if (!ordem) throw new ValidacaoPagamento(`ordem ${id} não existe`, 404);

  // Só rascunho e aprovada saem. `em_lote` está no meio de outro fluxo;
  // `aguardando_autorizacao` já saiu (reenviar seria pagar duas vezes); pago,
  // rejeitada, cancelada e devolvida são história.
  if (ordem.status !== "rascunho" && ordem.status !== "aprovada") {
    throw new ValidacaoPagamento(
      `ordem ${ordem.code} está em "${ordem.status}" — só sai para o banco o que está em rascunho ou aprovada`,
      409
    );
  }

  if (ordem.method !== "pix") {
    throw new ValidacaoPagamento(
      `ordem ${ordem.code} tem método "${ordem.method ?? "(vazio)"}"; só PIX está implementado`,
      422
    );
  }

  const foto = ordem.payee_snapshot ?? null;
  const chavePix = typeof foto?.pix_address_key === "string" ? foto.pix_address_key.trim() : "";
  if (!chavePix) {
    throw new ValidacaoPagamento(`ordem ${ordem.code} não tem chave PIX no payee_snapshot`, 422);
  }

  // A chave enviada sai do SNAPSHOT, não da conta corrente do cadastro — é para
  // isso que o snapshot existe. E a conferência abaixo é o alerta que a 0075
  // chama de "o mais caro de perder": se a coordenada do favorecido mudou entre
  // programar e enviar, isso é exatamente a forma da fraude de troca de
  // favorecido. O produto não escolhe entre a chave velha e a nova — recusa e
  // devolve a decisão para uma pessoa.
  const atual = await queryOne<ContaFavorecida>(
    `SELECT ${COLUNAS_CONTA}
       FROM fin_payee_account
      WHERE counterparty_id = $1 AND is_default AND is_active
      LIMIT 1`,
    [ordem.counterparty_id]
  );
  if (!atual) {
    throw new ValidacaoPagamento(
      `a conta favorecida padrão da contraparte ${ordem.counterparty_id} sumiu depois da programação de ${ordem.code} — confira o cadastro e reprograme`,
      409
    );
  }
  if (ordem.payee_fingerprint && impressaoDaConta(atual) !== ordem.payee_fingerprint) {
    throw new ValidacaoPagamento(
      `a coordenada bancária da contraparte ${ordem.counterparty_id} MUDOU depois que ${ordem.code} foi programada. Nada foi enviado. Confira quem alterou (fin_audit_log) e reprograme se estiver correto.`,
      409
    );
  }

  // `net_cents` e não `amount_cents`: é a coluna gerada que já soma juros e
  // multa e desconta o desconto (0075) — é o que sai da conta de verdade.
  const resposta = await incluirPagamentoPix(
    {
      valorCents: Number(ordem.net_cents),
      chave: chavePix,
      dataPagamento: ordem.scheduled_for ?? ordem.due_date,
      descricao: ordem.description
    },
    // Chave idempotente = `code` da ordem (PG-2026-0001). Estável, única por
    // ordem e legível no extrato do banco quando alguém for conferir.
    ordem.code
  );

  const linha =
    `[${new Date().toISOString()}] enviado ao Inter por ${actor} — ` +
    `codigoSolicitacao=${resposta.codigoSolicitacao ?? "(não informado)"}, ` +
    `tipoRetorno=${resposta.tipoRetorno ?? "(não informado)"}, ` +
    `httpStatus=${resposta.httpStatus}, idempotencia=${ordem.code}. ` +
    `Aguardando autorização humana no aplicativo do banco — nada aqui aprova.`;

  const marcadores = ["inter-enviado"];
  if (resposta.codigoSolicitacao) marcadores.push(`inter-solicitacao:${resposta.codigoSolicitacao}`);

  const atualizada = await queryOne<{ id: number; code: string; status: string }>(
    `UPDATE fin_payment_request
        SET status = 'aguardando_autorizacao',
            notes = concat_ws(E'\\n', nullif(notes, ''), $2::text),
            tags = coalesce((SELECT array_agg(DISTINCT t ORDER BY t) FROM unnest(tags || $3::text[]) AS t), tags),
            updated_at = now()
      WHERE id = $1 AND status IN ('rascunho', 'aprovada')
      RETURNING id, code, status`,
    [ordem.id, linha, marcadores]
  );

  if (!atualizada) {
    // Zero linhas = alguém moveu a ordem entre a conferência e o UPDATE. A
    // ordem JÁ FOI ao banco — mentir dizendo que não foi seria pior do que
    // dizer a verdade incômoda.
    throw new ValidacaoPagamento(
      `ordem ${ordem.code} foi enviada ao Inter, mas o status mudou no meio do caminho e não pôde ser gravado. Confira no aplicativo do banco ANTES de reenviar.`,
      409
    );
  }

  await query(
    `INSERT INTO fin_audit_log
        (entity_id, target_table, target_id, action, before, after, fields, batch_id, actor)
     VALUES ($1, 'fin_payment_request', $2, 'update', $3::jsonb, $4::jsonb,
             ARRAY['status', 'notes', 'tags'], $5::uuid, $6)`,
    [
      ordem.entity_id,
      ordem.id,
      JSON.stringify({ status: ordem.status }),
      JSON.stringify({
        status: "aguardando_autorizacao",
        codigo_solicitacao: resposta.codigoSolicitacao,
        tipo_retorno: resposta.tipoRetorno,
        http_status: resposta.httpStatus,
        idempotencia: ordem.code
      }),
      randomUUID(),
      actor
    ]
  );

  return {
    id: Number(atualizada.id),
    code: atualizada.code,
    status: atualizada.status,
    codigoSolicitacao: resposta.codigoSolicitacao,
    tipoRetorno: resposta.tipoRetorno
  };
}

/**
 * Envia VÁRIAS ordens ao Inter, uma a uma, e devolve o que aconteceu com cada.
 *
 * Existe porque o gesto do dono é "seleciono o que vou pagar e mando" — não
 * "programo, depois abro cada ordem e mando de novo". A tela chama isto uma vez
 * com os ids que acabou de criar.
 *
 * SEQUENCIAL, não em paralelo, e isso é decisão: cada envio abre um mTLS
 * próprio e o Inter limita chamadas por minuto (o cliente de leitura espera 7s
 * entre requisições por causa disso — `scripts/lib/inter.mjs:19`). Disparar 30
 * PIX ao mesmo tempo é o caminho mais curto para tomar 429 no meio do lote e
 * ficar sem saber quais entraram.
 *
 * UMA FALHA NÃO DERRUBA O LOTE. Cada ordem é independente do lado do banco —
 * não há transação que as una — então o que se pode fazer é registrar o
 * resultado de cada uma e devolver a lista inteira. A ordem que falhou continua
 * em `rascunho` e pode ser reenviada; a que passou está em
 * `aguardando_autorizacao` e espera VOCÊ no aplicativo.
 */
export type ResultadoEnvioLote = {
  enviadas: { id: number; code: string; codigoSolicitacao: string | null; tipoRetorno: string | null }[];
  falharam: { id: number; motivo: string }[];
};

export async function enviarOrdensAoInter(
  ids: number[],
  opcoes: { actor: string }
): Promise<ResultadoEnvioLote> {
  const lista = [...new Set((ids ?? []).map(Number).filter((n) => Number.isSafeInteger(n) && n > 0))];
  if (lista.length === 0) throw new ValidacaoPagamento("nenhuma ordem para enviar");

  // A trava de ambiente é checada UMA vez, antes do laço: se a escrita está
  // desligada, falhar 30 vezes com a mesma mensagem não ajuda ninguém.
  const trava = pagamentoInterHabilitado();
  if (!trava.ok) throw new ValidacaoPagamento(trava.motivo ?? "escrita bancária desligada", 503);

  const resultado: ResultadoEnvioLote = { enviadas: [], falharam: [] };
  for (const id of lista) {
    try {
      const r = await enviarOrdemAoInter(id, opcoes);
      resultado.enviadas.push({
        id: r.id,
        code: r.code,
        codigoSolicitacao: r.codigoSolicitacao,
        tipoRetorno: r.tipoRetorno
      });
    } catch (erro) {
      resultado.falharam.push({
        id,
        motivo: erro instanceof Error ? erro.message : "falhou sem mensagem"
      });
    }
  }
  return resultado;
}

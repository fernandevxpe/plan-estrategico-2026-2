-- O aplicativo do time, e as notificações.
--
-- ===========================================================================
-- POR QUE ESTA MIGRATION EXISTE
-- ===========================================================================
-- Duas coisas foram pedidas nominalmente pelo dono e nunca entregues:
--
--   "aplicativo web para o time cadastrar reembolsos, custos, enviar notas,
--    pedidos de compra e enviar por exemplo link de coisas pra comprar"
--   "vai ter que ter telas, notificações"
--
-- O estado medido em 16/08/2026, que é o que torna isto urgente:
--
--   fin_purchase_request ......... 0 linhas
--   fin_payment_request .......... 0 linhas
--   fin_approval_rule ............ 0 linhas   (dúvida 27, por desenho)
--   fin_reimbursement ............ 81 pedidos · 193 itens
--   itens de reembolso com anexo .. 0 de 193
--   fin_payment_attachment ....... 0 linhas
--   módulo financeiro ............ admin-only (lib/auth/perfis.ts)
--
-- Ou seja: o time não tem por onde entrar, e o que ele enviaria não tem onde
-- pousar. Esta migration abre as duas portas SEM abrir o financeiro.
--
-- ---------------------------------------------------------------------------
-- AS SEIS DECISÕES QUE O SCHEMA SOZINHO NÃO EXPLICA
-- ---------------------------------------------------------------------------
--
-- 1. REUSAR, NÃO PARALELIZAR. Reembolso continua em fin_reimbursement (0012) e
--    compra continua em fin_purchase_request (0075). Criar `fin_time_reembolso`
--    ao lado produziria duas verdades sobre o mesmo dinheiro — o erro que esta
--    base gastou semanas desfazendo em outras frentes. O que nasce aqui é só o
--    que não existia: o link do que comprar, o anexo do comprovante, a nota de
--    entrada, a identidade de quem enviou, e a notificação.
--
-- 2. A CREDENCIAL `comum` É COMPARTILHADA — e por isso a identidade é
--    DECLARADA, não provada. O Basic Auth tem dois pares (admin e comum). Um
--    par para o time inteiro autentica "alguém do time", nunca "quem". Fingir
--    que o cookie prova identidade seria inventar evidência, e esta base não
--    faz isso. Então: `fin_time_sessao.prova` guarda 'declarada' ou 'pin', e
--    todo envio carrega o que valia no momento. `fin_person_acesso` NASCE
--    VAZIA, igual a fin_approval_rule: semear PIN seria inventar credencial
--    que ninguém combinou. Enquanto vazia, tudo é 'declarada' e a tela diz
--    isso em voz alta. Virou a dúvida 58.
--
-- 3. ENVIO DO TIME NÃO É LANÇAMENTO. Nada aqui toca fin_transaction, saldo de
--    conta ou fin_document. O envio é PEDIDO; virar dinheiro exige uma decisão
--    de admin e, para pagamento, a alçada da dúvida 27. Isso está no schema:
--    não existe FK deste módulo para fin_transaction, e `applied_document_id`
--    (o único ponteiro para o mundo do dinheiro) só aceita valor quando o
--    envio está aprovado e assinado — o gatilho recusa o resto.
--
-- 4. A NOTIFICAÇÃO NÃO PODE ABRIR PORTA QUE A PESSOA NÃO TEM. O middleware
--    devolve 404 (não 403) para o perfil comum em /financeiro. Uma notificação
--    que aponte para lá seria um mapa do que ele não pode ver — exatamente o
--    vazamento que o 404 evita. O CHECK `fin_notificacao_link_coerente` recusa
--    no banco: notificação de pessoa aponta para /time, notificação de gestão
--    aponta para /financeiro. E broadcast para o perfil comum não carrega
--    valor nenhum.
--
-- 5. O FATO É DERIVADO; SÓ O ESTADO É PERSISTIDO. Mesma lição de
--    fin_payment_alert_ack (0075): alerta gravado envelhece e passa a acusar o
--    que já foi corrigido. Aqui `fin_notificacao_fato_v` calcula o que MERECE
--    aviso agora, e `fin_notificacao` guarda o que se fez com o aviso (lida,
--    resolvida). O sync casa os dois pela chave de deduplicação e resolve
--    sozinho a notificação cujo fato sumiu.
--
-- 6. LIMIAR NÃO DECLARADO NÃO VIRA NÚMERO PLAUSÍVEL. As três tolerâncias de
--    fonte foram declaradas (extrato D+1, NFe 10 dias, orçamento 95 dias) e
--    entram semeadas. A régua de "item de fila acima de que valor?" NÃO foi
--    declarada: fica NULL, com motivo, e o gerador emite UM aviso agregado
--    ("1.555 itens, R$ X em jogo, nenhum notificado individualmente porque não
--    há régua") em vez de escolher um corte. Dúvida 59.
--
-- ---------------------------------------------------------------------------
-- O QUE ESTA MIGRATION NÃO FAZ
-- ---------------------------------------------------------------------------
-- Não cria lançamento, não altera categoria, não mexe em fin_transaction, em
-- fin_account, em fin_document nem em saldo. A soma por conta não pode mudar —
-- e a assertiva final desta migration confere isso e se recusa a commitar se
-- mudou.

-- ===========================================================================
-- 0. PRÉ-CONDIÇÕES
-- ===========================================================================
DO $$
BEGIN
  IF to_regclass('fin_person') IS NULL THEN
    RAISE EXCEPTION '0105 exige a 0012 (fin_person / fin_reimbursement)';
  END IF;
  IF to_regclass('fin_purchase_request') IS NULL THEN
    RAISE EXCEPTION '0105 exige a 0075 (fin_purchase_request / fin_payment_attachment)';
  END IF;
END $$;

-- Âncora de dinheiro: a soma por conta ANTES de qualquer coisa. Conferida no
-- fim. Se mudar, esta migration está errada, por mais bonito que esteja o resto.
CREATE TEMP TABLE _ancora_0105 ON COMMIT DROP AS
  SELECT account_id, count(*)::bigint AS linhas, coalesce(sum(amount_cents), 0)::bigint AS soma
    FROM fin_transaction GROUP BY account_id;

-- ===========================================================================
-- 1. QUEM ESTÁ ENVIANDO — identidade declarada, com honestidade no nome
-- ===========================================================================

-- PIN por pessoa. NASCE VAZIA, de propósito (ver decisão 2).
--
-- Guardado como sha256(pin || salt): a coluna nunca vê o PIN em claro, e o
-- salt por pessoa impede que dois PINs iguais tenham o mesmo hash — o que
-- entregaria "fulano e sicrano usam o mesmo PIN" a quem lesse a tabela.
CREATE TABLE fin_person_acesso (
  person_id   bigint PRIMARY KEY REFERENCES fin_person(id) ON DELETE CASCADE,
  pin_sha256  char(64) NOT NULL,
  pin_salt    text NOT NULL,
  pin_set_at  timestamptz NOT NULL DEFAULT now(),
  pin_set_by  text NOT NULL,
  status      text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'bloqueado')),
  last_seen_at timestamptz
);

COMMENT ON TABLE fin_person_acesso IS
  'PIN por pessoa do time. Nasce VAZIA: semear credencial que ninguém combinou é '
  'inventar governança, o mesmo motivo pelo qual fin_approval_rule nasceu vazia. '
  'Enquanto uma pessoa não tiver linha aqui, a identidade dela é DECLARADA, não provada, '
  'e todo envio carrega esse carimbo.';

-- Sessão do app do time: token opaco → pessoa.
--
-- O token é aleatório e guardado só como hash — o cookie tem o token, o banco
-- tem o resumo. Vazar esta tabela não dá a ninguém a sessão de ninguém.
--
-- Por que sessão em banco e não cookie assinado: cookie assinado exige um
-- segredo em variável de ambiente, e um segredo ausente em produção degradaria
-- silenciosamente para "aceita qualquer coisa". Aqui, sem linha na tabela não
-- há sessão. A falha é fechada por construção.
CREATE TABLE fin_time_sessao (
  id           bigserial PRIMARY KEY,
  token_sha256 char(64) NOT NULL UNIQUE,
  person_id    bigint NOT NULL REFERENCES fin_person(id) ON DELETE CASCADE,
  -- 'declarada': a pessoa disse quem é, e a credencial compartilhada não
  -- desmente nem confirma. 'pin': existia PIN cadastrado e ele foi conferido.
  prova        text NOT NULL CHECK (prova IN ('declarada', 'pin')),
  criada_em    timestamptz NOT NULL DEFAULT now(),
  expira_em    timestamptz NOT NULL,
  ultimo_uso   timestamptz,
  encerrada_em timestamptz,
  user_agent   text,
  CONSTRAINT fin_time_sessao_prazo CHECK (expira_em > criada_em)
);

CREATE INDEX fin_time_sessao_pessoa_idx ON fin_time_sessao (person_id, expira_em DESC);

COMMENT ON COLUMN fin_time_sessao.prova IS
  'O que sustenta a identidade desta sessão. A credencial Basic é UMA para o time inteiro: '
  'ela autentica "alguém do time", nunca "quem". Chamar isso de autenticação de pessoa '
  'seria inventar evidência.';

-- ===========================================================================
-- 2. O COMPROVANTE — 0 de 193 itens de reembolso têm anexo hoje
-- ===========================================================================

-- Bytes no Postgres, gzip, sha256, dentro de uma transação: exatamente o padrão
-- que docs/ARMAZENAMENTO-RAILWAY.md já descreve para os artefatos
-- (xpe_artifacts). Não se inventa bucket aqui — o volume do Railway é cache, e
-- cache não é onde comprovante fiscal mora.
--
-- O sha256 é do conteúdo ORIGINAL, não do comprimido: é ele que responde
-- "este é o mesmo arquivo?" mesmo se o nível de gzip mudar um dia.
CREATE TABLE fin_anexo_blob (
  storage_key     text PRIMARY KEY,
  conteudo        bytea NOT NULL,
  content_type    text,
  content_encoding text NOT NULL DEFAULT 'gzip' CHECK (content_encoding IN ('gzip', 'identity')),
  sha256          char(64) NOT NULL,
  bytes_originais bigint NOT NULL CHECK (bytes_originais > 0),
  bytes_gravados  bigint NOT NULL CHECK (bytes_gravados > 0),
  file_name       text,
  uploaded_by     text NOT NULL,
  uploaded_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX fin_anexo_blob_sha_idx ON fin_anexo_blob (sha256);

COMMENT ON TABLE fin_anexo_blob IS
  'Os bytes do comprovante. Mesmo padrão de xpe_artifacts (gzip + sha256 + transação), '
  'porque comprovante recuperável e auditável não pode morar num cache que a próxima '
  'reimplantação limpa. O metadado fica em fin_payment_attachment; aqui fica o arquivo.';

-- fin_payment_attachment (0075) já é a tabela de anexo desta base, com
-- fingerprint por sha e ponteiro opcional para NFe existente. Ela só não
-- conhecia os alvos do app do time. Ampliar o vocabulário é mais barato — e
-- mais honesto — que criar uma segunda tabela de anexo.
--
-- A tabela tem 0 linhas: o ALTER não reescreve nada e não trava ninguém.
ALTER TABLE fin_payment_attachment DROP CONSTRAINT IF EXISTS fin_payment_attachment_target_table_check;
ALTER TABLE fin_payment_attachment ADD CONSTRAINT fin_payment_attachment_target_table_check
  CHECK (target_table IN ('fin_purchase_request', 'fin_payment_request',
                          'fin_payment_batch', 'fin_payment_execution',
                          'fin_reimbursement', 'fin_reimbursement_item', 'fin_time_envio'));

-- ===========================================================================
-- 3. PEDIDO DE COMPRA — o "link de coisas pra comprar", nominalmente
-- ===========================================================================

-- Quantidade não existia. Sem ela, "3 monitores a R$ 1.200" e "1 monitor de
-- R$ 3.600" são a mesma linha, e a cotação seguinte não tem contra o que ser
-- comparada.
ALTER TABLE fin_purchase_request ADD COLUMN IF NOT EXISTS quantity numeric(14, 3)
  CHECK (quantity IS NULL OR quantity > 0);
ALTER TABLE fin_purchase_request ADD COLUMN IF NOT EXISTS unit text;

COMMENT ON COLUMN fin_purchase_request.quantity IS
  'Quantidade pedida. Nullable porque serviço não tem unidade e obrigar um "1" produziria '
  'dado sem significado.';

-- O link é TABELA e não coluna: quem manda link manda vários (o mesmo item em
-- três lojas é a forma natural de cotar). Uma coluna `link_url` obrigaria a
-- escolher um, e o segundo link viraria texto solto na descrição — invisível
-- para qualquer consulta.
--
-- price_cents é o preço VISTO naquele link, no dia em que foi visto. É a
-- evidência que sustenta amount_basis='cotacao' no pedido.
CREATE TABLE fin_purchase_request_link (
  id                  bigserial PRIMARY KEY,
  purchase_request_id bigint NOT NULL REFERENCES fin_purchase_request(id) ON DELETE CASCADE,
  url                 text NOT NULL,
  -- Só http/https. `javascript:` e `data:` num campo que a tela renderiza como
  -- âncora é execução de script no navegador de quem for aprovar.
  CONSTRAINT fin_purchase_link_esquema CHECK (url ~* '^https?://[^\s]+$'),
  loja                text,
  titulo              text,
  price_cents         bigint CHECK (price_cents IS NULL OR price_cents > 0),
  -- Sem preço é permitido; sem preço E sem motivo, não. A mesma regra de
  -- `Medida`: valor nulo carrega o porquê.
  price_reason        text,
  CONSTRAINT fin_purchase_link_preco_com_motivo
    CHECK (price_cents IS NOT NULL OR price_reason IS NOT NULL),
  visto_em            date NOT NULL DEFAULT CURRENT_DATE,
  observacao          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (purchase_request_id, url)
);

CREATE INDEX fin_purchase_request_link_pedido_idx ON fin_purchase_request_link (purchase_request_id);

COMMENT ON TABLE fin_purchase_request_link IS
  'Os links do que se quer comprar — pedido nominal do dono ("enviar por exemplo link de '
  'coisas pra comprar"). Vários por pedido, porque cotar é comparar. O preço guardado é o '
  'do dia em que o link foi visto, e é a evidência de amount_basis=cotacao.';

-- ===========================================================================
-- 4. CUSTO E NOTA DE ENTRADA — o que não tinha onde pousar
-- ===========================================================================
--
-- Por que UMA tabela com `kind` e não duas: custo e nota de entrada percorrem
-- exatamente o mesmo caminho (a pessoa envia → o admin decide → a pessoa vê a
-- resposta), diferem só nos campos de identificação do documento, e a tela de
-- "o que eu enviei" precisa dos dois na mesma lista ordenada por data. Duas
-- tabelas dobrariam o número de rotas, de estados e de notificações para
-- ganhar nada.
--
-- Reembolso e compra NÃO entram aqui porque já têm casa (decisão 1).
--
-- Sobre a nota de entrada: hoje fin_document é 100% "receber" e a de entrada não
-- tem por onde chegar (dúvida 28 e 45). Esta tabela é o começo do caminho — e
-- deliberadamente NÃO é fin_document: um envio do time é a afirmação de uma
-- pessoa, não uma obrigação da empresa. Vira documento quando um humano decidir
-- que vira, e aí `applied_document_id` registra qual.

CREATE SEQUENCE IF NOT EXISTS fin_time_envio_code_seq;

CREATE TABLE fin_time_envio (
  id                  bigserial PRIMARY KEY,
  entity_id           bigint NOT NULL REFERENCES fin_entity(id),
  code                text NOT NULL UNIQUE,

  kind                text NOT NULL CHECK (kind IN ('custo', 'nota_entrada')),

  -- Quem enviou. NOT NULL: envio sem dono não tem para quem devolver.
  person_id           bigint NOT NULL REFERENCES fin_person(id),
  -- O que sustentava a identidade quando este envio foi feito. Copiado da
  -- sessão e congelado: cadastrar PIN depois não pode reescrever a história de
  -- que este envio, naquele dia, veio de identidade declarada.
  identidade_prova    text NOT NULL CHECK (identidade_prova IN ('declarada', 'pin')),

  titulo              text NOT NULL,
  descricao           text,
  amount_cents        bigint NOT NULL CHECK (amount_cents > 0),
  incurred_on         date NOT NULL,
  due_on              date,

  -- Como foi (ou vai ser) pago. `ja_paguei_do_meu` é a fronteira com reembolso:
  -- se a pessoa marcar isso num custo, a tela manda ela para o reembolso, que é
  -- onde o dinheiro dela volta. Aqui fica o que a EMPRESA pagou ou vai pagar.
  pagamento           text NOT NULL DEFAULT 'a_definir'
                        CHECK (pagamento IN ('ja_paguei_do_meu', 'cartao_da_empresa',
                                             'boleto', 'pix_da_empresa', 'debito_automatico',
                                             'a_definir')),
  ja_pago             boolean NOT NULL DEFAULT false,

  -- Sugestão de quem enviou, nunca decisão. A categoria que vale é a que o
  -- admin carimbar — quem envia não decide DRE.
  categoria_sugerida_id bigint REFERENCES fin_category(id),
  fornecedor_nome     text,
  fornecedor_documento text,

  -- Nota fiscal de entrada
  nfe_key             char(44),
  CONSTRAINT fin_time_envio_nfe_digitos CHECK (nfe_key IS NULL OR nfe_key ~ '^[0-9]{44}$'),
  nfe_numero          text,
  nfe_serie           text,
  nfe_emissao         date,

  -- Uma nota que não diz de quem é não é nota, é um valor. Exigir ALGUMA
  -- identificação (chave, número ou emitente) é o mínimo para ela ser
  -- procurável depois.
  CONSTRAINT fin_time_envio_nota_identificada CHECK (
    kind <> 'nota_entrada'
    OR nfe_key IS NOT NULL OR nfe_numero IS NOT NULL OR fornecedor_nome IS NOT NULL),

  status              text NOT NULL DEFAULT 'rascunho'
                        CHECK (status IN ('rascunho', 'enviado', 'em_analise',
                                          'aprovado', 'devolvido', 'recusado', 'cancelado')),
  enviado_em          timestamptz,

  decided_by          text,
  decided_at          timestamptz,
  decision_reason     text,

  -- O elo com o mundo do dinheiro, e o único. Ver o gatilho mais abaixo: só
  -- pode ser preenchido em envio aprovado e assinado.
  applied_document_id bigint REFERENCES fin_document(id) ON DELETE SET NULL,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  -- Decisão exige autor e data juntos. Meia decisão gravada tira o item da fila
  -- sem que ninguém tenha assinado (a mesma regra da 0075).
  CONSTRAINT fin_time_envio_decisao_completa
    CHECK ((decided_by IS NULL) = (decided_at IS NULL)),
  -- "O que voltou e por quê": devolver ou recusar sem motivo é devolver sem
  -- resposta, e a tela de acompanhamento do time ficaria com um estado que não
  -- explica nada.
  CONSTRAINT fin_time_envio_negativa_com_motivo
    CHECK (status NOT IN ('devolvido', 'recusado')
           OR (decision_reason IS NOT NULL AND btrim(decision_reason) <> '')),
  CONSTRAINT fin_time_envio_enviado_tem_data
    CHECK (status IN ('rascunho', 'cancelado') OR enviado_em IS NOT NULL)
);

CREATE INDEX fin_time_envio_pessoa_idx ON fin_time_envio (person_id, created_at DESC);
CREATE INDEX fin_time_envio_fila_idx ON fin_time_envio (entity_id, status, enviado_em)
  WHERE status IN ('enviado', 'em_analise');
CREATE UNIQUE INDEX fin_time_envio_nfe_idx ON fin_time_envio (entity_id, nfe_key)
  WHERE nfe_key IS NOT NULL;

COMMENT ON TABLE fin_time_envio IS
  'Custo e nota de entrada enviados pelo time. NÃO é lançamento, NÃO é documento e NÃO '
  'mexe em saldo: é a afirmação de uma pessoa, aguardando decisão de admin. O único '
  'ponteiro para o mundo do dinheiro é applied_document_id, e o gatilho só o aceita em '
  'envio aprovado e assinado.';

CREATE TRIGGER fin_time_envio_touch BEFORE UPDATE ON fin_time_envio
  FOR EACH ROW EXECUTE FUNCTION fin_touch_updated_at();

-- Código legível, no mesmo padrão de SC-/PG-/LT- da 0075. Gente conversa por
-- "TM-2026-0007", não por id 7.
CREATE OR REPLACE FUNCTION fin_time_envio_codigo() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.code IS NOT NULL AND NEW.code <> '' THEN RETURN NEW; END IF;
  NEW.code := 'TM-' || to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYY')
              || '-' || lpad(nextval('fin_time_envio_code_seq')::text, 4, '0');
  RETURN NEW;
END $$;

CREATE TRIGGER fin_time_envio_codigo_trg BEFORE INSERT ON fin_time_envio
  FOR EACH ROW EXECUTE FUNCTION fin_time_envio_codigo();

-- A promessa central do módulo, no banco e não em comentário.
--
-- Sem isto, "envio do time não vira dinheiro sozinho" é uma frase de
-- documentação — e documentação não recusa UPDATE. Com isto, apontar um envio
-- para um documento exige que alguém tenha aprovado e assinado antes.
CREATE OR REPLACE FUNCTION fin_time_envio_valida_aplicacao() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.applied_document_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.status <> 'aprovado' OR NEW.decided_by IS NULL THEN
    RAISE EXCEPTION 'envio % não pode apontar para documento: status=% decided_by=% — aprovação assinada é pré-condição',
      NEW.code, NEW.status, coalesce(NEW.decided_by, '(nulo)');
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER fin_time_envio_aplicacao BEFORE INSERT OR UPDATE OF applied_document_id, status
  ON fin_time_envio FOR EACH ROW EXECUTE FUNCTION fin_time_envio_valida_aplicacao();

-- ===========================================================================
-- 5. NOTIFICAÇÕES
-- ===========================================================================

-- As réguas. Três vieram declaradas; a quarta não veio, e por isso é NULL com
-- motivo em vez de um número plausível (decisão 6).
CREATE TABLE fin_notificacao_regra (
  slug        text PRIMARY KEY,
  descricao   text NOT NULL,
  valor       numeric,
  unidade     text NOT NULL CHECK (unidade IN ('dias', 'centavos')),
  -- Obrigatório quando `valor` é nulo. É o que impede a régua ausente de
  -- parecer régua zero — que notificaria tudo.
  motivo_ausencia text,
  fonte       text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fin_notificacao_regra_valor_com_motivo
    CHECK (valor IS NOT NULL OR motivo_ausencia IS NOT NULL)
);

INSERT INTO fin_notificacao_regra (slug, descricao, valor, unidade, motivo_ausencia, fonte) VALUES
  ('fonte_extrato_dias', 'Extrato bancário: atraso tolerado antes de avisar', 1, 'dias', NULL,
   'declarado pelo dono: extrato é D+1'),
  ('fonte_nfe_dias', 'NFe: atraso tolerado antes de avisar', 10, 'dias', NULL,
   'declarado pelo dono: NFe tolera 10 dias'),
  ('fonte_orcamento_dias', 'Orçamento do ERP: atraso tolerado antes de avisar', 95, 'dias', NULL,
   'declarado pelo dono: orçamento tolera 95 dias'),
  ('resposta_janela_dias', 'Por quantos dias a resposta a um envio do time continua sendo notícia',
   30, 'dias', NULL,
   'a base tem 81 reembolsos decididos antes de este módulo existir; sem janela, o sino '
   'abriria com 81 avisos de coisas que a pessoa já sabe. Decisão SEM data não notifica: '
   'ausência de data não é "decidido hoje"'),
  ('fila_decisao_valor_cents', 'Valor a partir do qual um item de fila vira notificação individual',
   NULL, 'centavos',
   'não declarado — escolher um corte aqui inventaria governança que ninguém combinou, '
   'o mesmo motivo pelo qual fin_approval_rule nasceu vazia. Enquanto NULL, o gerador '
   'emite um aviso AGREGADO da fila em vez de escolher um limiar. Dúvida 59.',
   'em aberto (dúvida 59)')
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE fin_notificacao (
  id             bigserial PRIMARY KEY,
  entity_id      bigint NOT NULL REFERENCES fin_entity(id),

  -- Destinatário: uma pessoa OU um perfil, nunca os dois e nunca nenhum.
  recipient_kind text NOT NULL CHECK (recipient_kind IN ('pessoa', 'perfil')),
  recipient_person_id bigint REFERENCES fin_person(id) ON DELETE CASCADE,
  recipient_perfil    text CHECK (recipient_perfil IN ('admin', 'comum')),
  CONSTRAINT fin_notificacao_destinatario CHECK (
    (recipient_kind = 'pessoa' AND recipient_person_id IS NOT NULL AND recipient_perfil IS NULL)
    OR (recipient_kind = 'perfil' AND recipient_perfil IS NOT NULL AND recipient_person_id IS NULL)
  ),

  -- 'proprio' fala do que a própria pessoa enviou; 'gestao' fala do dinheiro da
  -- empresa. A separação existe para o CHECK abaixo poder proibir a segunda de
  -- sair do admin.
  escopo         text NOT NULL CHECK (escopo IN ('proprio', 'gestao')),
  CONSTRAINT fin_notificacao_gestao_e_admin
    CHECK (escopo <> 'gestao' OR (recipient_kind = 'perfil' AND recipient_perfil = 'admin')),

  kind           text NOT NULL CHECK (kind IN (
                   'fila_decisao_item', 'fila_decisao_sem_regua',
                   'pagamento_aguardando_aprovacao', 'alcada_ausente',
                   'time_reembolso_aguardando', 'time_compra_aguardando', 'time_envio_aguardando',
                   'time_resposta',
                   'fonte_desatualizada', 'invariante_quebrado')),

  titulo         text NOT NULL,
  corpo          text NOT NULL,

  -- Para onde ir para resolver. Notificação sem destino é notificação que
  -- ensina a ignorar notificação.
  link_href      text NOT NULL,
  CONSTRAINT fin_notificacao_link_relativo CHECK (link_href ~ '^/'),
  -- O CHECK da decisão 4: a notificação não pode abrir porta que a pessoa não
  -- tem. O middleware devolve 404 no /financeiro para o perfil comum — mandar
  -- alguém para lá seria anunciar o que existe e não se pode ver.
  CONSTRAINT fin_notificacao_link_coerente CHECK (
    CASE
      WHEN recipient_kind = 'pessoa' THEN link_href LIKE '/time%'
      WHEN recipient_perfil = 'comum' THEN link_href NOT LIKE '/financeiro%'
      ELSE true
    END
  ),

  -- Valor em jogo, quando houver. Nulo carrega motivo, como toda medida desta
  -- base.
  amount_cents   bigint,
  amount_reason  text,
  CONSTRAINT fin_notificacao_valor_com_motivo
    CHECK (amount_cents IS NOT NULL OR amount_reason IS NOT NULL),
  -- Broadcast para o time inteiro não carrega dinheiro. Um aviso que vai para
  -- todo mundo com um número da empresa dentro é vazamento com aparência de
  -- conveniência.
  CONSTRAINT fin_notificacao_broadcast_sem_valor CHECK (
    NOT (recipient_kind = 'perfil' AND recipient_perfil = 'comum' AND amount_cents IS NOT NULL)
  ),

  estado         text NOT NULL DEFAULT 'nao_lida'
                   CHECK (estado IN ('nao_lida', 'lida', 'resolvida')),

  -- A chave que impede o mesmo fato de avisar dez vezes. Ela é o CONTEÚDO do
  -- fato, não o instante: `fila_decisao_item:8123` é o mesmo item hoje e
  -- amanhã, e o segundo sync não cria linha nova.
  dedupe_key     text NOT NULL,

  -- Derivada de um fato calculável (e portanto resolvível sozinha quando o fato
  -- some) ou escrita por uma ação? Sem esta coluna, o sync que resolve o que
  -- sumiu apagaria também o que foi escrito à mão e não tem view por trás.
  derivada       boolean NOT NULL DEFAULT true,

  criada_em      timestamptz NOT NULL DEFAULT now(),
  vista_em       timestamptz,
  resolvida_em   timestamptz,
  resolvida_por  text,
  -- Quantas vezes o fato reapareceu. Não cria linha nova; só conta.
  ocorrencias    integer NOT NULL DEFAULT 1 CHECK (ocorrencias > 0),
  ultima_ocorrencia timestamptz NOT NULL DEFAULT now(),
  contexto       jsonb,

  CONSTRAINT fin_notificacao_estado_coerente CHECK (
    (estado = 'resolvida') = (resolvida_em IS NOT NULL)
  ),

  UNIQUE (entity_id, dedupe_key)
);

CREATE INDEX fin_notificacao_caixa_idx
  ON fin_notificacao (entity_id, recipient_kind, recipient_perfil, recipient_person_id, estado, criada_em DESC);
CREATE INDEX fin_notificacao_nao_lida_idx
  ON fin_notificacao (entity_id, estado) WHERE estado = 'nao_lida';

COMMENT ON TABLE fin_notificacao IS
  'O ESTADO de um aviso (não lida / lida / resolvida), não o aviso. O fato que merece '
  'aviso é calculado por fin_notificacao_fato_v; aqui fica o que um humano fez com ele. '
  'Alerta persistido sem essa separação envelhece e passa a acusar o que já foi corrigido '
  '— a lição de fin_payment_alert_ack (0075).';

COMMENT ON COLUMN fin_notificacao.dedupe_key IS
  'Identidade do FATO, não do instante. O mesmo item de fila produz a mesma chave em toda '
  'passagem do sync, e por isso notifica uma vez só.';

-- Onde o resultado do verificador de integridade pousa para poder virar aviso.
-- Nasce vazia: sem execução do teste, nenhum invariante é afirmado — ausência
-- de dado não é "está tudo certo".
CREATE TABLE fin_invariante_resultado (
  id          bigserial PRIMARY KEY,
  codigo      text NOT NULL,
  nome        text NOT NULL,
  ok          boolean NOT NULL,
  violacoes   integer NOT NULL DEFAULT 0 CHECK (violacoes >= 0),
  amount_cents bigint,
  medido_em   timestamptz NOT NULL DEFAULT now(),
  -- Só uma linha por código é a corrente. O histórico fica, para responder
  -- "desde quando isto está quebrado?".
  corrente    boolean NOT NULL DEFAULT true,
  detalhe     jsonb
);

CREATE UNIQUE INDEX fin_invariante_resultado_corrente_idx
  ON fin_invariante_resultado (codigo) WHERE corrente;
CREATE INDEX fin_invariante_resultado_hist_idx ON fin_invariante_resultado (codigo, medido_em DESC);

-- ---------------------------------------------------------------------------
-- 5.1 O que merece aviso AGORA
-- ---------------------------------------------------------------------------
-- Uma view, oito fontes. Cada linha traz tudo que a notificação precisa, para
-- que o sync seja um UPSERT burro — a inteligência fica aqui, versionada e
-- consultável sem escrever nada.
CREATE OR REPLACE VIEW fin_notificacao_fato_v AS
WITH ent AS (SELECT id FROM fin_entity WHERE slug = 'xpe'),
regra AS (
  SELECT
    max(valor) FILTER (WHERE slug = 'fonte_extrato_dias')     AS extrato_dias,
    max(valor) FILTER (WHERE slug = 'fonte_nfe_dias')         AS nfe_dias,
    max(valor) FILTER (WHERE slug = 'fonte_orcamento_dias')   AS orcamento_dias,
    max(valor) FILTER (WHERE slug = 'fila_decisao_valor_cents') AS fila_valor,
    max(valor) FILTER (WHERE slug = 'resposta_janela_dias')     AS resposta_dias
  FROM fin_notificacao_regra
),

-- (a) Item de fila acima da régua — individual, só se a régua existir.
fila_item AS (
  SELECT
    'fila_decisao_item'::text AS kind,
    'perfil'::text AS recipient_kind, NULL::bigint AS recipient_person_id, 'admin'::text AS recipient_perfil,
    'gestao'::text AS escopo,
    'fila_decisao_item:' || r.id AS dedupe_key,
    'Item na fila de decisão: ' || coalesce(r.reason, 'sem motivo declarado') AS titulo,
    'Item ' || r.id || ' em ' || r.target_table || ' aguarda decisão desde '
      || to_char(r.created_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY') || '.' AS corpo,
    '/financeiro/revisao'::text AS link_href,
    r.amount_cents,
    CASE WHEN r.amount_cents IS NULL THEN 'o item de fila não declara valor' END AS amount_reason,
    jsonb_build_object('review_item_id', r.id, 'target_table', r.target_table, 'target_id', r.target_id) AS contexto
  FROM fin_review_item r
  CROSS JOIN regra g
  WHERE r.status = 'pendente'
    AND g.fila_valor IS NOT NULL
    AND r.amount_cents IS NOT NULL
    AND r.amount_cents >= g.fila_valor
),

-- (b) A fila sem régua — UM aviso agregado, porque escolher um corte aqui seria
--     inventar a governança que a dúvida 59 pergunta.
fila_sem_regua AS (
  SELECT
    'fila_decisao_sem_regua'::text, 'perfil'::text, NULL::bigint, 'admin'::text, 'gestao'::text,
    -- Chave ESTÁVEL, sem a contagem dentro. A fila muda de tamanho todo dia; se
    -- o tamanho entrasse na chave, cada dia criaria um aviso novo e resolveria o
    -- de ontem — ruído diário sobre um fato que não mudou.
    'fila_decisao_sem_regua' AS dedupe_key,
    'Fila de decisão sem régua de valor' AS titulo,
    count(*) || ' itens aguardam decisão. Nenhum foi notificado individualmente porque '
      || '"a partir de que valor avisar?" não está definido (fin_notificacao_regra.fila_decisao_valor_cents, dúvida 59).' AS corpo,
    '/financeiro/revisao'::text,
    sum(r.amount_cents)::bigint,
    CASE WHEN sum(r.amount_cents) IS NULL THEN 'nenhum item da fila declara valor' END,
    jsonb_build_object('itens', count(*), 'sem_valor', count(*) FILTER (WHERE r.amount_cents IS NULL))
  FROM fin_review_item r CROSS JOIN regra g
  WHERE r.status = 'pendente' AND g.fila_valor IS NULL
  HAVING count(*) > 0
),

-- (c) Pagamento aguardando aprovação.
pagamento AS (
  SELECT
    'pagamento_aguardando_aprovacao'::text, 'perfil'::text, NULL::bigint, 'admin'::text, 'gestao'::text,
    'pagamento_aprovacao:' || p.id AS dedupe_key,
    'Pagamento aguardando aprovação: ' || p.code AS titulo,
    p.description || ' · vence em ' || to_char(p.due_date, 'DD/MM/YYYY') || '.' AS corpo,
    '/financeiro/painel'::text,
    p.amount_cents,
    NULL::text,
    jsonb_build_object('payment_request_id', p.id, 'code', p.code, 'due_date', p.due_date)
  FROM fin_payment_request p
  WHERE p.status IN ('rascunho', 'em_aprovacao')
),

-- (d) A fila de pagamento não anda sem alçada. Só avisa se houver fila: sem
--     solicitação nenhuma, "configure a alçada" é ruído.
alcada AS (
  SELECT
    'alcada_ausente'::text, 'perfil'::text, NULL::bigint, 'admin'::text, 'gestao'::text,
    'alcada_ausente' AS dedupe_key,
    'Nenhuma alçada configurada — a fila de pagamento não anda' AS titulo,
    'fin_approval_rule está vazia e o gatilho recusa aprovação sem régua. '
      || (SELECT count(*) FROM fin_payment_request WHERE status IN ('rascunho', 'em_aprovacao'))
      || ' solicitação(ões) parada(s) por isso. Dúvida 27.' AS corpo,
    '/financeiro/painel'::text,
    (SELECT sum(amount_cents)::bigint FROM fin_payment_request WHERE status IN ('rascunho', 'em_aprovacao')),
    CASE WHEN NOT EXISTS (SELECT 1 FROM fin_payment_request WHERE amount_cents IS NOT NULL)
         THEN 'nenhuma solicitação de pagamento declara valor' END,
    jsonb_build_object('duvida', 27)
  WHERE NOT EXISTS (SELECT 1 FROM fin_approval_rule)
    AND EXISTS (SELECT 1 FROM fin_payment_request WHERE status IN ('rascunho', 'em_aprovacao'))
),

-- (e) Reembolso do time aguardando análise.
reembolso AS (
  SELECT
    'time_reembolso_aguardando'::text, 'perfil'::text, NULL::bigint, 'admin'::text, 'gestao'::text,
    'reembolso_aguardando:' || r.id AS dedupe_key,
    'Reembolso aguardando análise: ' || pe.name AS titulo,
    'Competência ' || to_char(r.reference_month, 'MM/YYYY') || ' · '
      || (SELECT count(*) FROM fin_reimbursement_item i WHERE i.reimbursement_id = r.id) || ' item(ns).' AS corpo,
    '/financeiro/reembolsos'::text,
    r.total_cents,
    NULL::text,
    jsonb_build_object('reimbursement_id', r.id, 'person_id', r.person_id)
  FROM fin_reimbursement r
  JOIN fin_person pe ON pe.id = r.person_id
  WHERE r.status = 'enviado'
),

-- (f) Compra do time aguardando análise.
compra AS (
  SELECT
    'time_compra_aguardando'::text, 'perfil'::text, NULL::bigint, 'admin'::text, 'gestao'::text,
    'compra_aguardando:' || c.id AS dedupe_key,
    'Pedido de compra aguardando: ' || c.code || ' — ' || c.title AS titulo,
    coalesce(c.justification, 'sem justificativa declarada')
      || ' · ' || (SELECT count(*) FROM fin_purchase_request_link l WHERE l.purchase_request_id = c.id)
      || ' link(s).' AS corpo,
    '/financeiro/painel'::text,
    c.amount_cents,
    NULL::text,
    jsonb_build_object('purchase_request_id', c.id, 'code', c.code, 'priority', c.priority)
  FROM fin_purchase_request c
  WHERE c.status IN ('enviada', 'em_cotacao')
),

-- (g) Custo/nota do time aguardando análise.
envio AS (
  SELECT
    'time_envio_aguardando'::text, 'perfil'::text, NULL::bigint, 'admin'::text, 'gestao'::text,
    'envio_aguardando:' || e.id AS dedupe_key,
    CASE e.kind WHEN 'custo' THEN 'Custo enviado pelo time: ' ELSE 'Nota de entrada enviada pelo time: ' END
      || e.code || ' — ' || e.titulo AS titulo,
    pe.name || ' enviou em ' || to_char(e.enviado_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY')
      || CASE WHEN e.identidade_prova = 'declarada' THEN ' · identidade declarada, não provada' ELSE '' END AS corpo,
    '/financeiro/painel'::text,
    e.amount_cents,
    NULL::text,
    jsonb_build_object('envio_id', e.id, 'code', e.code, 'kind', e.kind)
  FROM fin_time_envio e
  JOIN fin_person pe ON pe.id = e.person_id
  WHERE e.status IN ('enviado', 'em_analise')
),

-- (h) A resposta ao que a pessoa do time enviou. Vai para a PESSOA, aponta para
--     /time, e o valor é o do envio dela — não é dado da empresa.
resposta_envio AS (
  SELECT
    'time_resposta'::text, 'pessoa'::text, e.person_id, NULL::text, 'proprio'::text,
    'envio_resposta:' || e.id || ':' || e.status AS dedupe_key,
    CASE e.status
      WHEN 'aprovado'  THEN 'Aprovado: ' || e.titulo
      WHEN 'devolvido' THEN 'Voltou para você: ' || e.titulo
      WHEN 'recusado'  THEN 'Recusado: ' || e.titulo
    END AS titulo,
    coalesce(e.decision_reason, 'sem observação') AS corpo,
    '/time/envios'::text,
    e.amount_cents,
    NULL::text,
    jsonb_build_object('envio_id', e.id, 'code', e.code, 'status', e.status)
  FROM fin_time_envio e CROSS JOIN regra g
  WHERE e.status IN ('aprovado', 'devolvido', 'recusado')
    -- Decisão SEM data não notifica. Ausência de data não é "decidido hoje" —
    -- é o mesmo princípio que impede ausência de dado de virar zero.
    AND e.decided_at IS NOT NULL
    AND e.decided_at >= now() - make_interval(days => g.resposta_dias::int)
),

resposta_compra AS (
  SELECT
    'time_resposta'::text, 'pessoa'::text, c.requested_person_id, NULL::text, 'proprio'::text,
    'compra_resposta:' || c.id || ':' || c.status AS dedupe_key,
    CASE c.status
      WHEN 'aprovada'  THEN 'Compra aprovada: ' || c.title
      WHEN 'reprovada' THEN 'Compra reprovada: ' || c.title
      WHEN 'atendida'  THEN 'Compra atendida: ' || c.title
      WHEN 'cancelada' THEN 'Compra cancelada: ' || c.title
      ELSE 'Compra em cotação: ' || c.title
    END AS titulo,
    coalesce(c.decision_reason, 'sem observação') AS corpo,
    '/time/envios'::text,
    c.amount_cents,
    NULL::text,
    jsonb_build_object('purchase_request_id', c.id, 'code', c.code, 'status', c.status)
  FROM fin_purchase_request c CROSS JOIN regra g
  WHERE c.requested_person_id IS NOT NULL
    AND c.status IN ('em_cotacao', 'aprovada', 'reprovada', 'cancelada', 'atendida')
    AND c.decided_at IS NOT NULL
    AND c.decided_at >= now() - make_interval(days => g.resposta_dias::int)
),

resposta_reembolso AS (
  SELECT
    'time_resposta'::text, 'pessoa'::text, r.person_id, NULL::text, 'proprio'::text,
    'reembolso_resposta:' || r.id || ':' || r.status AS dedupe_key,
    CASE r.status
      WHEN 'aprovado'  THEN 'Reembolso aprovado — ' || to_char(r.reference_month, 'MM/YYYY')
      WHEN 'rejeitado' THEN 'Reembolso rejeitado — ' || to_char(r.reference_month, 'MM/YYYY')
      ELSE 'Reembolso pago — ' || to_char(r.reference_month, 'MM/YYYY')
    END AS titulo,
    coalesce(r.notes, 'sem observação') AS corpo,
    '/time/envios'::text,
    r.total_cents,
    NULL::text,
    jsonb_build_object('reimbursement_id', r.id, 'status', r.status)
  FROM fin_reimbursement r CROSS JOIN regra g
  WHERE r.status IN ('aprovado', 'rejeitado', 'pago')
    -- Os 81 reembolsos desta base foram decididos antes de existir sino, e a
    -- maioria sem `approved_at`. Sem esta linha, o sino abriria com 81 avisos
    -- de coisas que a pessoa já sabe — e um sino assim se aprende a ignorar no
    -- primeiro dia.
    AND r.approved_at IS NOT NULL
    AND r.approved_at >= now() - make_interval(days => g.resposta_dias::int)
),

-- (i) Fonte fora da tolerância DELA. Uma régua só para todas trataria extrato
--     (D+1) e orçamento (95 dias) como o mesmo problema, e o aviso do
--     orçamento afogaria o do extrato.
fonte AS (
  SELECT
    'fonte_desatualizada'::text, 'perfil'::text, NULL::bigint, 'admin'::text, 'gestao'::text,
    -- Sem o atraso na chave, pelo mesmo motivo da fila: o atraso cresce um dia
    -- por dia, e a fonte parada seria um aviso novo toda manhã. O corpo é que
    -- carrega o número de hoje.
    'fonte_desatualizada:' || f.fonte || ':' || coalesce(f.conta, '-') AS dedupe_key,
    'Fonte desatualizada: ' || f.fonte || coalesce(' · ' || f.conta, '') AS titulo,
    f.atraso || ' dia(s) sem dado novo — a tolerância declarada é ' || f.tolerancia || '.' AS corpo,
    '/financeiro/contas'::text,
    NULL::bigint,
    'atraso de fonte é medido em dias, não em dinheiro' AS amount_reason,
    jsonb_build_object('fonte', f.fonte, 'conta', f.conta, 'atraso_dias', f.atraso, 'tolerancia_dias', f.tolerancia)
  FROM (
    SELECT c.fonte, c.conta,
           (CURRENT_DATE - c.ultimo_extrato_em::date) AS atraso,
           CASE
             WHEN c.fonte ILIKE '%nfe%' OR c.fonte ILIKE '%nfse%' THEN (SELECT nfe_dias FROM regra)
             WHEN c.fonte ILIKE '%orcamento%' OR c.fonte ILIKE '%erp%' THEN (SELECT orcamento_dias FROM regra)
             ELSE (SELECT extrato_dias FROM regra)
           END AS tolerancia
      FROM fin_fonte_cobertura_v c
     WHERE c.periodo = EXTRACT(YEAR FROM CURRENT_DATE)::int
       AND c.conta_ativa
       AND c.ultimo_extrato_em IS NOT NULL
  ) f
  WHERE f.tolerancia IS NOT NULL AND f.atraso > f.tolerancia
),

-- (j) Invariante quebrado com valor em jogo. A medição mora nos scripts, não no
--     banco: `scripts/notificar.mjs` roda test-integridade --strict --json e
--     grava aqui. A tabela nasce vazia; sem execução, nenhum aviso — que é o
--     estado honesto, e não "está tudo bem".
invariante AS (
  SELECT
    'invariante_quebrado'::text, 'perfil'::text, NULL::bigint, 'admin'::text, 'gestao'::text,
    'invariante:' || i.codigo || ':' || i.violacoes::text AS dedupe_key,
    'Invariante quebrado: [' || i.codigo || '] ' || i.nome AS titulo,
    i.violacoes || ' violação(ões) medidas em '
      || to_char(i.medido_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') || '.' AS corpo,
    '/financeiro/indicadores'::text,
    i.amount_cents,
    CASE WHEN i.amount_cents IS NULL THEN 'o invariante não expõe valor em jogo' END,
    jsonb_build_object('codigo', i.codigo, 'violacoes', i.violacoes)
  FROM fin_invariante_resultado i
  WHERE i.corrente AND NOT i.ok
)

SELECT ent.id AS entity_id, f.*
  FROM ent CROSS JOIN (
    SELECT * FROM fila_item
    UNION ALL SELECT * FROM fila_sem_regua
    UNION ALL SELECT * FROM pagamento
    UNION ALL SELECT * FROM alcada
    UNION ALL SELECT * FROM reembolso
    UNION ALL SELECT * FROM compra
    UNION ALL SELECT * FROM envio
    UNION ALL SELECT * FROM resposta_envio
    UNION ALL SELECT * FROM resposta_compra
    UNION ALL SELECT * FROM resposta_reembolso
    UNION ALL SELECT * FROM fonte
    UNION ALL SELECT * FROM invariante
  ) f (kind, recipient_kind, recipient_person_id, recipient_perfil, escopo,
       dedupe_key, titulo, corpo, link_href, amount_cents, amount_reason, contexto);

COMMENT ON VIEW fin_notificacao_fato_v IS
  'O que MERECE aviso agora, calculado do ledger. Não grava nada. fin_notificacao_sync() '
  'casa esta view com a tabela de estado pela chave de deduplicação: fato novo vira '
  'notificação, fato repetido só incrementa o contador, fato que sumiu vira resolvida.';

-- ---------------------------------------------------------------------------
-- 5.2 O sync
-- ---------------------------------------------------------------------------
-- Idempotente por construção: rodar duas vezes seguidas não cria linha nova,
-- só mexe em `ocorrencias` e `ultima_ocorrencia`.
--
-- A parte que não é óbvia é a terceira: notificação DERIVADA cujo fato sumiu
-- vira 'resolvida' sozinha. Sem isso, "o extrato está atrasado" continuaria no
-- sino depois de o extrato entrar — e o sino que mente é pior que o sino que
-- não existe, porque ensina a ignorar.
CREATE OR REPLACE FUNCTION fin_notificacao_sync(p_ator text DEFAULT 'sync')
RETURNS TABLE (criadas integer, repetidas integer, resolvidas integer)
LANGUAGE plpgsql AS $$
DECLARE
  v_criadas integer := 0;
  v_repetidas integer := 0;
  v_resolvidas integer := 0;
BEGIN
  CREATE TEMP TABLE _fato_sync ON COMMIT DROP AS SELECT * FROM fin_notificacao_fato_v;

  WITH ins AS (
    INSERT INTO fin_notificacao (
      entity_id, recipient_kind, recipient_person_id, recipient_perfil, escopo,
      kind, titulo, corpo, link_href, amount_cents, amount_reason, dedupe_key, derivada, contexto)
    SELECT f.entity_id, f.recipient_kind, f.recipient_person_id, f.recipient_perfil, f.escopo,
           f.kind, f.titulo, f.corpo, f.link_href, f.amount_cents, f.amount_reason, f.dedupe_key, true, f.contexto
      FROM _fato_sync f
    ON CONFLICT (entity_id, dedupe_key) DO UPDATE
      SET ocorrencias = fin_notificacao.ocorrencias + 1,
          ultima_ocorrencia = now(),
          -- Corpo e valor acompanham o fato: um item que mudou de valor tem de
          -- mostrar o valor de agora, não o do dia em que apareceu.
          corpo = EXCLUDED.corpo,
          amount_cents = EXCLUDED.amount_cents,
          amount_reason = EXCLUDED.amount_reason,
          contexto = EXCLUDED.contexto,
          -- Fato que voltou depois de resolvido reabre. A chave inclui o
          -- conteúdo, então "voltou" significa o mesmo fato de novo.
          estado = CASE WHEN fin_notificacao.estado = 'resolvida' THEN 'nao_lida' ELSE fin_notificacao.estado END,
          resolvida_em = CASE WHEN fin_notificacao.estado = 'resolvida' THEN NULL ELSE fin_notificacao.resolvida_em END,
          resolvida_por = CASE WHEN fin_notificacao.estado = 'resolvida' THEN NULL ELSE fin_notificacao.resolvida_por END
    RETURNING (xmax = 0) AS inserida
  )
  SELECT count(*) FILTER (WHERE inserida), count(*) FILTER (WHERE NOT inserida)
    INTO v_criadas, v_repetidas FROM ins;

  UPDATE fin_notificacao n
     SET estado = 'resolvida', resolvida_em = now(), resolvida_por = p_ator
   WHERE n.derivada
     AND n.estado <> 'resolvida'
     AND NOT EXISTS (SELECT 1 FROM _fato_sync f WHERE f.dedupe_key = n.dedupe_key AND f.entity_id = n.entity_id);
  GET DIAGNOSTICS v_resolvidas = ROW_COUNT;

  DROP TABLE _fato_sync;
  RETURN QUERY SELECT v_criadas, v_repetidas, v_resolvidas;
END $$;

COMMENT ON FUNCTION fin_notificacao_sync(text) IS
  'Casa fin_notificacao_fato_v com fin_notificacao pela chave de deduplicação. Idempotente: '
  'duas execuções seguidas não criam linha nova. Notificação derivada cujo fato sumiu vira '
  'resolvida — um sino que continua acusando o que já foi corrigido ensina a ignorá-lo.';

-- ===========================================================================
-- 6. O QUE EU ENVIEI — a tela de acompanhamento, numa view só
-- ===========================================================================
-- As quatro origens numa lista só, porque a pergunta da pessoa é "cadê o que eu
-- mandei?", não "cadê meus reembolsos". `person_id` vem em toda linha: é por ele
-- que a rota filtra, e é a única coisa que separa o que é dela do que é de
-- outro.
CREATE OR REPLACE VIEW fin_time_envios_v AS
SELECT
  'reembolso'::text AS origem,
  r.id AS origem_id,
  'RB-' || r.id::text AS code,
  r.person_id,
  'Reembolso ' || to_char(r.reference_month, 'MM/YYYY') AS titulo,
  r.total_cents AS amount_cents,
  r.reference_month AS data_ref,
  r.status,
  CASE r.status
    WHEN 'rascunho'  THEN 'rascunho'
    WHEN 'enviado'   THEN 'aguardando'
    WHEN 'aprovado'  THEN 'aprovado'
    WHEN 'pago'      THEN 'concluido'
    WHEN 'rejeitado' THEN 'recusado'
  END AS estado_simples,
  r.notes AS resposta,
  r.approved_at AS decidido_em,
  r.approved_by AS decidido_por,
  r.created_at,
  (SELECT count(*) FROM fin_reimbursement_item i WHERE i.reimbursement_id = r.id)::int AS itens,
  (SELECT count(*) FROM fin_reimbursement_item i
    WHERE i.reimbursement_id = r.id AND i.receipt_artifact_key IS NOT NULL)::int AS itens_com_anexo
FROM fin_reimbursement r

UNION ALL

SELECT
  'compra', c.id, c.code, c.requested_person_id,
  c.title, c.amount_cents, c.needed_by, c.status,
  CASE c.status
    WHEN 'rascunho'   THEN 'rascunho'
    WHEN 'enviada'    THEN 'aguardando'
    WHEN 'em_cotacao' THEN 'aguardando'
    WHEN 'aprovada'   THEN 'aprovado'
    WHEN 'atendida'   THEN 'concluido'
    WHEN 'reprovada'  THEN 'recusado'
    WHEN 'cancelada'  THEN 'recusado'
  END,
  c.decision_reason, c.decided_at, c.decided_by, c.created_at,
  (SELECT count(*) FROM fin_purchase_request_link l WHERE l.purchase_request_id = c.id)::int,
  0
FROM fin_purchase_request c
WHERE c.requested_person_id IS NOT NULL

UNION ALL

SELECT
  e.kind, e.id, e.code, e.person_id,
  e.titulo, e.amount_cents, e.incurred_on, e.status,
  CASE e.status
    WHEN 'rascunho'   THEN 'rascunho'
    WHEN 'enviado'    THEN 'aguardando'
    WHEN 'em_analise' THEN 'aguardando'
    WHEN 'aprovado'   THEN 'aprovado'
    WHEN 'devolvido'  THEN 'devolvido'
    WHEN 'recusado'   THEN 'recusado'
    WHEN 'cancelado'  THEN 'recusado'
  END,
  e.decision_reason, e.decided_at, e.decided_by, e.created_at,
  (SELECT count(*) FROM fin_payment_attachment a
    WHERE a.target_table = 'fin_time_envio' AND a.target_id = e.id)::int,
  (SELECT count(*) FROM fin_payment_attachment a
    WHERE a.target_table = 'fin_time_envio' AND a.target_id = e.id)::int
FROM fin_time_envio e;

COMMENT ON VIEW fin_time_envios_v IS
  'As quatro origens de envio do time numa lista só, com person_id em toda linha. A rota '
  'do app filtra por person_id da sessão — nunca por parâmetro do cliente.';

-- Saúde do comprovante: a lacuna que o app existe para fechar, medida.
CREATE OR REPLACE VIEW fin_time_comprovante_saude_v AS
SELECT
  count(*)::int AS itens,
  count(*) FILTER (WHERE receipt_artifact_key IS NOT NULL)::int AS com_comprovante,
  count(*) FILTER (WHERE receipt_artifact_key IS NULL)::int AS sem_comprovante,
  coalesce(sum(amount_cents) FILTER (WHERE receipt_artifact_key IS NULL), 0)::bigint AS sem_comprovante_cents,
  round(100.0 * count(*) FILTER (WHERE receipt_artifact_key IS NOT NULL) / nullif(count(*), 0), 1) AS pct_com_comprovante
FROM fin_reimbursement_item;

-- ===========================================================================
-- 7. ASSERÇÕES — o que esta migration prova sobre si mesma
-- ===========================================================================
DO $$
DECLARE
  v_dif integer;
  v_n   integer;
BEGIN
  -- A âncora. Nada aqui deveria ter tocado um centavo.
  SELECT count(*) INTO v_dif
    FROM (
      SELECT account_id, count(*)::bigint AS linhas, coalesce(sum(amount_cents), 0)::bigint AS soma
        FROM fin_transaction GROUP BY account_id
    ) agora
    FULL JOIN _ancora_0105 antes USING (account_id)
   WHERE antes.soma IS DISTINCT FROM agora.soma OR antes.linhas IS DISTINCT FROM agora.linhas;
  IF v_dif > 0 THEN
    RAISE EXCEPTION '0105 mexeu no dinheiro: % conta(s) com soma ou contagem diferente', v_dif;
  END IF;

  -- Nenhuma notificação pode apontar o perfil comum para o financeiro. O CHECK
  -- garante daqui para frente; esta linha prova que ele está montado.
  BEGIN
    INSERT INTO fin_notificacao (entity_id, recipient_kind, recipient_perfil, escopo, kind,
                                 titulo, corpo, link_href, amount_reason, dedupe_key)
    SELECT id, 'perfil', 'comum', 'proprio', 'time_resposta',
           'prova', 'prova', '/financeiro/painel', 'prova', '_prova_link_'
      FROM fin_entity WHERE slug = 'xpe';
    RAISE EXCEPTION '0105 FALHOU: o banco aceitou notificação levando o perfil comum ao financeiro';
  EXCEPTION WHEN check_violation THEN
    NULL; -- é o que tem de acontecer
  END;

  -- Nem carregar dinheiro num broadcast ao time.
  BEGIN
    INSERT INTO fin_notificacao (entity_id, recipient_kind, recipient_perfil, escopo, kind,
                                 titulo, corpo, link_href, amount_cents, dedupe_key)
    SELECT id, 'perfil', 'comum', 'proprio', 'time_resposta',
           'prova', 'prova', '/time', 123456, '_prova_valor_'
      FROM fin_entity WHERE slug = 'xpe';
    RAISE EXCEPTION '0105 FALHOU: o banco aceitou valor num aviso para o time inteiro';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  -- Envio do time não aponta para documento sem aprovação assinada.
  BEGIN
    INSERT INTO fin_time_envio (entity_id, kind, person_id, identidade_prova, titulo,
                                amount_cents, incurred_on, status, applied_document_id)
    SELECT e.id, 'custo', p.id, 'declarada', 'prova', 100, CURRENT_DATE, 'rascunho', d.id
      FROM fin_entity e, fin_person p, fin_document d
     WHERE e.slug = 'xpe' LIMIT 1;
    RAISE EXCEPTION '0105 FALHOU: envio virou documento sem aprovação assinada';
  EXCEPTION WHEN raise_exception THEN
    IF sqlerrm LIKE '0105 FALHOU%' THEN RAISE; END IF;
  END;

  -- A view de fatos tem de responder sem estourar.
  SELECT count(*) INTO v_n FROM fin_notificacao_fato_v;
  RAISE NOTICE '0105: fin_notificacao_fato_v devolve % fato(s) agora', v_n;

  -- E a régua ausente tem de estar ausente COM motivo, não com zero.
  IF EXISTS (SELECT 1 FROM fin_notificacao_regra
              WHERE slug = 'fila_decisao_valor_cents' AND (valor IS NOT NULL OR motivo_ausencia IS NULL)) THEN
    RAISE EXCEPTION '0105 FALHOU: a régua da fila não pode nascer com número nem sem motivo';
  END IF;
END $$;

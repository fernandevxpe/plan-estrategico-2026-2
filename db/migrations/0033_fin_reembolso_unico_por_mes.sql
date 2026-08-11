-- Um reembolso por pessoa por mês.
--
-- A 0012 criou `fin_reimbursement` com `reference_month` e nunca a exercitou —
-- a tabela está vazia desde então. Ao trazer a planilha de reembolsos do dono
-- (7 abas mensais, jan–jul/2026), a ausência da chave apareceu: sem ela, cada
-- reimportação empilha um reembolso novo do mesmo mês em vez de atualizar o que
-- existe, e o custo de gente cresce sozinho a cada execução.
--
-- É a regra do negócio, não conveniência de código: o reembolso de uma pessoa
-- num mês é UM, com vários itens dentro (`fin_reimbursement_item`). Dois
-- reembolsos da mesma pessoa no mesmo mês significam que alguém lançou em
-- duplicidade.
--
-- Seguro agora porque a tabela está vazia. Criar esta chave depois de haver
-- dado exigiria decidir qual das duplicatas sobrevive — e essa decisão é bem
-- mais cara que uma linha de DDL hoje.
ALTER TABLE fin_reimbursement
  ADD CONSTRAINT fin_reimbursement_pessoa_mes_uk
  UNIQUE (entity_id, person_id, reference_month);

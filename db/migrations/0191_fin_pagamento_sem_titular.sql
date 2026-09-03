-- O cadastro de "onde eu recebo" para de perguntar de quem é a conta.
--
-- ---------------------------------------------------------------------------
-- O QUE ACONTECEU NA PRÁTICA
-- ---------------------------------------------------------------------------
-- A 0159 criou `titular_e_a_pessoa` com um raciocínio correto: "o time da XPE é
-- MEI, e boa parte recebe no CNPJ, não no CPF. Guardar só 'a chave PIX do
-- Gabriel' perderia essa distinção".
--
-- O erro não foi guardar a distinção — foi PERGUNTAR por ela. Das 9 pessoas que
-- cadastraram, uma marcou "a conta não é minha" e escreveu o próprio nome e o
-- próprio CPF: o MEI dela. É a leitura certa da pergunta errada. O MEI é uma PJ
-- no nome da própria pessoa; perguntar "é sua ou do seu CNPJ?" pede que ela
-- escolha entre duas coisas que são a mesma.
--
-- O Fernando, em 03/09/2026: "o pessoal é MEI e é uma PJ no seu nome
-- geralmente... não precisa ter tanta frescura para cadastrar, deveria ser mais
-- simples: você é PJ, cadastra o PIX PJ".
--
-- ---------------------------------------------------------------------------
-- A DISTINÇÃO CONTINUA — SÓ NÃO É MAIS PERGUNTA
-- ---------------------------------------------------------------------------
-- O tipo da chave já responde o que a pergunta tentava responder: chave CNPJ é
-- a PJ da pessoa, chave CPF é a pessoa física. Duas informações para o mesmo
-- fato, e uma delas digitada à mão por quem não tem por que saber a diferença.
--
-- As colunas FICAM. Elas não são mais preenchidas pelo app, mas o que já foi
-- gravado é história — e o dia em que alguém de fato receber na conta de um
-- terceiro, o financeiro preenche pela tela dele, que é onde essa exceção
-- pertence.
--
-- ---------------------------------------------------------------------------
-- E O CPF VAI PARA ONDE ELE SEMPRE DEVEU ESTAR
-- ---------------------------------------------------------------------------
-- "O CPF deve ser cadastrado para a empresa de qualquer forma, assim como temos
-- o e-mail, telefone, data de aniversário." Ele já é campo do perfil
-- (`fin_person.cpf`) e já é cobrado no "complete seu cadastro". O que faltava
-- era não perdê-lo quando a pessoa o digitou no lugar errado.
-- ===========================================================================

-- 1. Quem declarou que o titular "não é a pessoa" e escreveu o PRÓPRIO nome.
--    O casamento é pelo primeiro nome do cadastro dentro do nome digitado —
--    conservador de propósito: só normaliza o que é claramente a mesma pessoa,
--    e deixa qualquer outro caso como está para um humano olhar.
--
--    A ordem importa: o passo 2 lê `titular_documento`, então ele roda ANTES de
--    a limpeza apagar o campo. Por isso o UPDATE do CPF vem primeiro.
UPDATE fin_person p
   SET cpf = d.doc
  FROM (
    SELECT pg.person_id, regexp_replace(pg.titular_documento, '[^0-9]', '', 'g') AS doc
      FROM fin_person_pagamento pg
      JOIN fin_person px ON px.id = pg.person_id
     WHERE pg.titular_documento IS NOT NULL
       AND px.cpf IS NULL
       AND lower(coalesce(pg.titular_nome, '')) LIKE '%' || lower(split_part(px.name, ' ', 1)) || '%'
  ) d
 WHERE p.id = d.person_id
   AND d.doc ~ '^[0-9]{11}$'
   AND p.cpf IS NULL
   -- Não colide com o único parcial (entity_id, cpf): CPF repetido é a mesma
   -- pessoa em duas linhas, e resolver isso é fusão de cadastro, não migration.
   AND NOT EXISTS (
     SELECT 1 FROM fin_person o WHERE o.entity_id = p.entity_id AND o.cpf = d.doc AND o.id <> p.id
   );

-- 2. Agora sim: o titular volta a ser a própria pessoa.
UPDATE fin_person_pagamento pg
   SET titular_e_a_pessoa = true,
       titular_nome       = NULL,
       titular_documento  = NULL,
       atualizado_por     = 'migration:0191'
  FROM fin_person p
 WHERE p.id = pg.person_id
   AND pg.titular_e_a_pessoa = false
   AND pg.titular_nome IS NOT NULL
   AND lower(pg.titular_nome) LIKE '%' || lower(split_part(p.name, ' ', 1)) || '%';

COMMENT ON COLUMN fin_person_pagamento.titular_e_a_pessoa IS
  'Desde a 0191 o app do time NÃO pergunta mais isto: o MEI é PJ no nome da própria pessoa, e o tipo da chave (CNPJ x CPF) já responde. Fica true por padrão; só o financeiro marca false, pela tela dele, quando o dinheiro de fato vai para um terceiro.';

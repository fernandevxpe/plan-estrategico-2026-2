-- O Inter deixa de depender de alguém baixar OFX.
--
-- A conta já existe desde 0003, com `import_adapter = 'inter_ofx'` — o extrato
-- entrava por arquivo, baixado à mão. Com a API Banking (mTLS + client
-- credentials, escopo `extrato.read`) ela passa a se atualizar sozinha, como o
-- Asaas já fazia.
--
-- Isso importa mais do que soa: o alarme de "extrato parado há N dias" existe
-- justamente porque a importação manual atrasa. Toda conta que sai do manual
-- tira um item da lista de coisas que dependem de memória humana.

-- 1. O CHECK precisa aceitar o adapter novo antes de qualquer UPDATE.
--
-- 'inter_csv' e 'inter_ofx' continuam válidos de propósito: o histórico
-- anterior à API foi importado por arquivo, e um lote antigo reprocessado
-- precisa conseguir declarar como entrou.
ALTER TABLE fin_account DROP CONSTRAINT IF EXISTS fin_account_import_adapter_check;

ALTER TABLE fin_account ADD CONSTRAINT fin_account_import_adapter_check
  CHECK (import_adapter IN (
    'asaas_api',
    'nubank_csv',
    'inter_csv',
    'inter_ofx',
    'inter_api',
    'caixa_ofx',
    'caixa_csv',
    'manual'
  ));

-- 2. A conta do Inter passa a ser alimentada pela API.
--
-- Restrito ao slug 'inter' da XPE: se um dia existir outra entidade com conta no
-- Inter, ela decide sozinha se entra por API ou por arquivo.
UPDATE fin_account a
   SET import_adapter = 'inter_api'
  FROM fin_entity e
 WHERE a.entity_id = e.id
   AND e.slug = 'xpe'
   AND a.slug = 'inter'
   AND a.import_adapter <> 'inter_api';

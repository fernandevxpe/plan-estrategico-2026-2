-- A agulha "posto " casa dentro de "imposto".
--
-- A regra `combustivel` procura o texto "posto " em `description_norm`, e
-- "imposto " contém "posto " — i-m-**p-o-s-t-o-espaço**. O operador
-- `contains_any` é substring pura, sem fronteira de palavra.
--
-- Hoje o ledger tem ZERO casos, porque nenhuma descrição de imposto chegou com
-- esse formato. Mas a validação contra a base do ClickUp disparou 13 vezes
-- (R$ 13.015,27): "reserva para imposto 13% parcela 1" vira Viagens e
-- representação. É bomba armada, não defeito ativo — e o custo de desarmar
-- agora é uma linha.
--
-- O conserto é o bloco `none`, que o avaliador já suporta: casa "posto " E não
-- pode conter "imposto". Mais barato e mais legível que ensinar fronteira de
-- palavra ao operador, e não muda o motor — que é o critério que tem mantido
-- estas correções seguras sobre um ledger em produção.
--
-- "deposito" e "composto" entram pela mesma razão: a mesma armadilha, com
-- outras palavras. Nenhuma delas ocorre hoje; estão aqui porque a próxima vai
-- ocorrer sem avisar.
UPDATE fin_rule
   SET conditions = conditions || jsonb_build_object(
         'none', jsonb_build_array(
           jsonb_build_object('op', 'contains_any', 'field', 'description_norm',
                              'value', jsonb_build_array('imposto', 'deposito', 'composto'))
         )),
       notes = COALESCE(notes || ' | ', '')
             || 'guarda em 0032: a agulha "posto " casava dentro de "imposto"',
       updated_at = now()
 WHERE slug = 'combustivel'
   AND conditions -> 'none' IS NULL;

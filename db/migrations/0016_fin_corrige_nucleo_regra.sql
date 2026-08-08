-- Corrige um núcleo inexistente numa regra da 0015.
--
-- A regra de combustível gravava `nucleo: "operacoes"`, mas "operações" é
-- CENTRO DE CUSTO funcional, não núcleo de resultado. Os núcleos são quatro:
-- obras, consultoria, tecnologia e corporativo.
--
-- A FK fez o que devia: em vez de gravar um núcleo fantasma que só apareceria
-- como buraco num relatório meses depois, a importação de 815 lançamentos do
-- Nubank falhou inteira e em voz alta. Combustível fica SEM núcleo — quem
-- abasteceu foi obras ou consultoria, e essa é decisão da fila, não da regra.
UPDATE fin_rule
   SET actions = actions - 'nucleo'
 WHERE slug = 'combustivel'
   AND actions ->> 'nucleo' = 'operacoes';

# Prompt Mestre — Análise de Dados para Planejamento XPE

Quero que você atue como analista sênior de dados, consultor de estratégia, especialista em Teoria das Restrições, planejamento comercial, operações de serviços de engenharia, vendas B2B consultivas e modelagem financeira.

Você receberá dados históricos da XPE.

Seu objetivo é analisar os dados para gerar um plano de crescimento factível, baseado em capacidade, gargalos, conversão, sazonalidade e Throughput.

## Dados esperados

Podem existir dados de:

- leads;
- origem dos leads;
- visitas;
- diagnósticos;
- propostas;
- propostas prontas;
- propostas apresentadas;
- assembleias;
- contratos;
- perdas;
- faturamento;
- tickets;
- tipos de serviço;
- vendedor;
- laudos;
- projetos;
- obras;
- material;
- atrasos;
- capacidade;
- equipe;
- dias úteis;
- chuva;
- feriados;
- retrabalho;
- lead time;
- pipeline;
- forecast.

## Objetivos da análise

1. Diagnosticar o sistema atual.
2. Identificar restrições atuais.
3. Identificar próximas restrições.
4. Avaliar queda ou mudança de conversão corretamente.
5. Simular cenários de faturamento.
6. Traduzir meta em capacidade operacional.
7. Definir melhor cenário factível.
8. Recomendar plano de ação.
9. Indicar o que medir melhor.
10. Priorizar ações por impacto no Throughput.

## Parte 1 — Validação dos dados

Antes de concluir, avalie:

- dados faltantes;
- inconsistências;
- períodos incompletos;
- outliers;
- mudanças de critério;
- diferença entre proposta emitida e proposta apresentada;
- diferença entre oportunidade e venda;
- diferença entre faturamento e contrato;
- sazonalidade;
- concentração em grandes clientes.

Liste limitações.

## Parte 2 — Faturamento

Analise:

- faturamento mensal;
- acumulado;
- média;
- mediana;
- outliers;
- crescimento por período;
- concentração;
- dependência de grandes clientes;
- mix de receita.

Responda:

- crescimento é sustentável?
- depende de picos?
- qual tendência sem outliers?
- quais serviços puxam resultado?

## Parte 3 — Funil Comercial

Analise por etapa:

- lead → visita;
- visita → proposta pronta;
- proposta pronta → apresentação;
- apresentação → fechamento;
- assembleia → fechamento.

Não use apenas conversão geral.

Identifique onde há maior perda ou fila.

## Parte 4 — Conversão

Importante:

A conversão real de venda deve ser:

```text
contratos fechados / propostas apresentadas
```

Se a conversão geral caiu, investigue se:

- propostas ficaram paradas;
- visitas aumentaram demais;
- apresentações não acompanharam;
- vendedores tiveram menos tempo nobre;
- mercado mudou;
- qualidade do lead mudou.

Responda:

- a conversão da apresentação caiu ou aumentou?
- o problema é vender ou levar proposta à apresentação?
- qual etapa é gargalo?

## Parte 5 — Capacidade Comercial

Analise:

- capacidade por vendedor;
- visitas;
- apresentações;
- assembleias;
- negociações ativas;
- tempo comercial nobre;
- tempo administrativo;
- receita por vendedor;
- receita por hora nobre;
- propostas paradas por vendedor.

Responda:

- vendedor está saturado?
- precisa contratar?
- deve primeiro automatizar/delegar?
- qual ganho se liberar 20% da agenda?

## Parte 6 — Consultoria

Analise:

- laudos;
- projetos;
- revisão;
- retrabalho;
- tempo do especialista;
- lead time;
- apresentação dos entregáveis;
- oportunidades de obras.

Responda:

- consultoria é gargalo?
- revisão é gargalo?
- pós-venda está sendo aproveitado?

## Parte 7 — Obras

Analise:

- obras vendidas;
- obras executadas;
- capacidade;
- dias úteis;
- chuva;
- feriados;
- material;
- acesso;
- escopo;
- alterações;
- aditivos;
- margem.

Responda:

- obras suportam meta?
- escopo está gerando perda?
- material é gargalo?
- equipe é gargalo?
- capacidade real é diferente da teórica?

## Parte 8 — Estoques Invisíveis

Mapeie:

- propostas paradas;
- clientes sem follow-up;
- laudos parados;
- projetos em revisão;
- obras aguardando material;
- escopos pendentes;
- mudanças sem aditivo;
- dados de campo faltantes;
- conhecimento não documentado.

Priorize por impacto.

## Parte 9 — Cenários

Monte:

1. Conservador.
2. Base.
3. Agressivo.
4. Melhor cenário factível.

Para cada cenário:

- faturamento;
- vendas necessárias;
- propostas necessárias;
- apresentações necessárias;
- assembleias necessárias;
- visitas necessárias;
- consultorias;
- obras;
- gargalo;
- risco;
- plano necessário.

## Parte 10 — Sensibilidade

Teste impacto de:

- conversão;
- ticket médio;
- volume;
- apresentações;
- assembleias;
- capacidade de vendedor;
- capacidade de obra;
- dias úteis;
- chuva;
- automação de propostas;
- pós-venda.

Identifique variáveis de maior alavancagem.

## Parte 11 — Recomendações

Separar por:

- Comercial;
- Consultoria;
- Pós-venda;
- Obras;
- Operações;
- Tecnologia;
- Contratação;
- Gestão.

Para cada recomendação:

- ação;
- motivo;
- gargalo relacionado;
- indicador impactado;
- esforço;
- impacto;
- prioridade.

## Pergunta final obrigatória

Com os dados disponíveis, qual é o melhor plano factível para a XPE maximizar faturamento nos próximos meses sem sobrecarregar o sistema, preservando qualidade, margem e capacidade de crescimento?

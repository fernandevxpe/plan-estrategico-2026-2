# Indicadores e Painel de Gestão XPE

## Objetivo

Definir indicadores para monitorar gargalos, capacidade, lead time, throughput, estoques invisíveis e planos de ação.

A plataforma deve permitir visão semanal e histórica.

## Indicadores executivos

### Faturamento

- faturamento semanal;
- faturamento mensal;
- faturamento acumulado;
- meta mensal;
- % da meta;
- forecast;
- pipeline ponderado;
- faturamento por tipo de serviço.

### Restrição da semana

Campo obrigatório:

- restrição principal atual;
- área;
- evidência;
- indicador associado;
- plano de ação;
- responsável;
- status.

### Risco principal

Campo obrigatório:

- comercial;
- consultoria;
- obras;
- financeiro;
- operacional;
- mercado;
- capacidade.

## Indicadores comerciais

### Funil

- leads;
- leads qualificados;
- visitas realizadas;
- diagnósticos realizados;
- propostas necessárias;
- propostas emitidas;
- propostas prontas;
- propostas apresentadas;
- assembleias;
- fechamentos;
- perdas.

### Conversões por etapa

- lead → visita;
- visita → proposta pronta;
- proposta pronta → apresentação;
- apresentação → fechamento;
- assembleia → fechamento;
- oportunidade → faturamento.

### Correção importante sobre conversão

A conversão real de venda deve ser medida principalmente como:

```text
Contratos fechados / Propostas apresentadas
```

A conversão geral pode cair quando o volume aumenta e propostas ficam paradas antes da apresentação.

Por isso a plataforma deve separar:

```text
Conversão operacional do funil
vs
Conversão real da apresentação
```

### Indicadores de propostas paradas

- propostas prontas sem apresentação;
- propostas em elaboração;
- propostas sem follow-up;
- propostas com apresentação agendada;
- propostas apresentadas em negociação;
- propostas paradas por vendedor;
- idade média das propostas.

### Tempo comercial nobre

- horas em relacionamento;
- horas em apresentação;
- horas em assembleia;
- horas em negociação;
- horas em follow-up estratégico;
- horas administrativas;
- horas em deslocamento;
- horas em levantamento técnico.

### Produtividade comercial

- receita por vendedor;
- receita por hora comercial nobre;
- apresentações por vendedor;
- assembleias por vendedor;
- negociações ativas por vendedor;
- taxa de ocupação da agenda;
- capacidade livre.

## Indicadores de consultoria

- laudos contratados;
- laudos em andamento;
- laudos entregues;
- projetos contratados;
- projetos em andamento;
- projetos entregues;
- fila de revisão;
- horas de revisão;
- retrabalho;
- entregas atrasadas;
- lead time contrato → entrega;
- lead time início → revisão;
- lead time revisão → entrega;
- entregáveis apresentados;
- oportunidades geradas.

## Indicadores do especialista/revisor

- horas de Jonildo por semana;
- horas em revisão real;
- horas em correção operacional;
- horas em treinamento;
- horas em decisão técnica;
- demandas aguardando Jonildo;
- retrabalhos evitáveis;
- devoluções para estagiários;
- erros recorrentes.

## Indicadores de campo

- visitas de coleta;
- coletas completas;
- coletas incompletas;
- fotos faltantes;
- retornos a campo;
- pendências técnicas;
- dados faltantes;
- retrabalho por campo;
- uso do app;
- checklist preenchido.

## Indicadores de obras

- obras contratadas;
- obras em planejamento;
- obras aguardando escopo;
- obras aguardando material;
- obras em execução;
- obras concluídas;
- obras atrasadas;
- capacidade de obras simultâneas;
- dias úteis disponíveis;
- dias perdidos por chuva;
- dias perdidos por feriado;
- dias perdidos por material;
- dias perdidos por acesso;
- produtividade por equipe;
- equipe ocupada;
- equipe disponível;
- material faltante;
- material excedente;
- aditivos;
- alterações sem cobrança;
- retrabalho físico.

## Indicadores de escopo de obras

- escopos fechados;
- escopos pendentes;
- obras com alteração;
- alterações classificadas;
- termos aditivos emitidos;
- alterações absorvidas sem cobrança;
- divergência entre contrato e execução;
- margem perdida por alteração;
- prazo alterado por escopo.

## Indicadores de pós-venda

- clientes ativos na base;
- clientes com consultoria entregue;
- clientes com devolutiva feita;
- oportunidades mapeadas;
- propostas de obras geradas;
- propostas de pós-venda;
- conversão da base;
- receita da base;
- LTV por cliente;
- tempo consultoria → oportunidade;
- tempo oportunidade → proposta.

## Indicadores de tecnologia e automação

- automações planejadas;
- automações em desenvolvimento;
- automações implantadas;
- automações em uso;
- % propostas por automação;
- % apresentações por automação;
- tempo economizado;
- erros reduzidos;
- adesão da equipe;
- gargalo atacado pela automação.

## Indicadores universais por gargalo

Cada gargalo deve ter:

- capacidade;
- demanda;
- fila;
- lead time;
- disponibilidade;
- variabilidade;
- retrabalho;
- impacto financeiro;
- plano de ação;
- responsável;
- status.

## Layout sugerido do painel

### Bloco 1 — Executivo

- faturamento;
- meta;
- pipeline;
- forecast;
- restrição da semana;
- risco principal;
- ação prioritária.

### Bloco 2 — Funil Comercial

- etapas;
- conversões;
- propostas paradas;
- apresentações;
- assembleias.

### Bloco 3 — Capacidade

- vendedores;
- consultoria;
- revisão;
- obras;
- campo.

### Bloco 4 — Estoques invisíveis

- lista;
- quantidade;
- impacto;
- responsável;
- ação.

### Bloco 5 — Planos de ação

- gargalo;
- ação;
- prazo;
- status;
- impacto.

### Bloco 6 — Histórico

- evolução mensal;
- tendências;
- sazonalidade;
- gargalos recorrentes.

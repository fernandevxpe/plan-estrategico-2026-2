# Throughput Accounting XPE — Base Inicial

## Objetivo

Criar uma forma de decisão econômica baseada em Throughput e restrições.

## Problema da contabilidade tradicional

A contabilidade tradicional pode ratear custos fixos de forma que prejudique decisões.

Na TOC, a pergunta central não é:

“Qual é o custo total rateado desse serviço?”

A pergunta é:

“Esse serviço aumenta Throughput consumindo quanto da restrição?”

## Fórmula básica

```text
Throughput = Receita - Custos variáveis diretos
```

Custos variáveis diretos podem incluir:

- material específico;
- terceirização específica;
- deslocamento diretamente atribuível;
- taxas específicas;
- comissão variável.

Não incluir automaticamente custo fixo rateado para decisão operacional.

## Throughput por recurso crítico

```text
Throughput por hora da restrição =
Throughput do serviço / horas consumidas do recurso crítico
```

Exemplo:

Serviço A:

- Receita: R$ 10.000
- Variável direto: R$ 1.000
- Throughput: R$ 9.000
- Tempo vendedor: 2h
- Throughput/h vendedor: R$ 4.500/h

Serviço B:

- Receita: R$ 10.000
- Variável direto: R$ 1.000
- Throughput: R$ 9.000
- Tempo vendedor: 8h
- Throughput/h vendedor: R$ 1.125/h

Mesmo faturamento, eficiência econômica muito diferente.

## Aplicações na XPE

### Comercial

Avaliar:

- receita por vendedor;
- receita por hora comercial nobre;
- tempo consumido por cliente;
- ticket por apresentação;
- ticket por assembleia;
- pós-venda gerado por apresentação.

### Consultoria

Avaliar:

- Throughput por tipo de laudo;
- Throughput por projeto;
- horas de especialista;
- horas de estagiário;
- retrabalho;
- oportunidade futura gerada.

### Obras

Avaliar:

- Throughput por obra;
- Throughput por dia de equipe;
- margem por tipo de obra;
- impacto de escopo alterado;
- custo de material faltante;
- custo de dia perdido.

### Analisadores

Avaliar:

- serviços que exigem analisador;
- serviços que podem usar medidores;
- receita por dia de analisador;
- fila de equipamentos;
- justificativa para comprar mais.

## Decisões que o modelo deve apoiar

- contratar vendedor;
- contratar revisor;
- contratar equipe de obras;
- comprar analisador;
- aumentar tráfego pago;
- automatizar proposta;
- mudar portfólio;
- cobrar aditivos;
- priorizar clientes;
- aceitar ou recusar serviço complexo.

## Regra de decisão

Uma ação deve ser priorizada quando:

- aumenta Throughput;
- reduz consumo da restrição;
- reduz Inventory;
- reduz Lead Time;
- aumenta capacidade organizacional.

## Próximo desenvolvimento

A plataforma deve futuramente permitir calcular:

- Throughput por serviço;
- Throughput por cliente;
- Throughput por vendedor;
- Throughput por assembleia;
- Throughput por obra;
- Throughput por recurso crítico;
- ROI de automações;
- payback de contratações;
- custo de oportunidade de propostas paradas.

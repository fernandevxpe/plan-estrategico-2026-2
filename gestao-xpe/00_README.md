# XPE — Base de Conhecimento para Plataforma de Gestão e IA

## Objetivo desta base

Esta pasta reúne o contexto, os conceitos, os modelos de gestão, os indicadores, os gargalos, os planos de ação e as diretrizes estratégicas discutidas para criação de uma plataforma web de gestão e monitoramento da XPE.

A plataforma deverá permitir:

- monitoramento de gargalos;
- análise de capacidade;
- acompanhamento de funil comercial;
- acompanhamento de consultoria, laudos e projetos;
- acompanhamento de obras;
- monitoramento de estoques invisíveis;
- geração de boletim semanal;
- análise com IA;
- apoio ao planejamento estratégico;
- simulação de metas e capacidade;
- priorização de ações com base na Teoria das Restrições;
- criação de um sistema operacional próprio da XPE.

## Como usar na IDE com IA

Use esta base como conhecimento permanente do projeto.

Sugestão de estrutura:

```text
xpe-platform/
  knowledge-base/
    00_README.md
    01_contexto_estrategico_xpe.md
    02_sistema_operacional_xpe.md
    ...
  app/
  docs/
  prompts/
  data-model/
```

Ao conversar com uma IA dentro da IDE, peça para ela ler esta pasta antes de propor arquitetura, telas, banco de dados, agentes ou automações.

## Ideia central

A XPE não deve ser gerida apenas por tarefas, departamentos ou metas financeiras isoladas.

A XPE deve ser gerida como um sistema de fluxo:

```text
Marketing / Indicações
↓
Vendas
↓
Consultoria
↓
Apresentação dos entregáveis
↓
Pós-venda técnico
↓
Obras
↓
Entrega
↓
Novas oportunidades na base
```

O objetivo é aumentar o Throughput da empresa com controle de capacidade, qualidade, previsibilidade e crescimento sustentável.

## Base teórica

A plataforma deve se apoiar principalmente em:

- Teoria das Restrições (TOC);
- Drum-Buffer-Rope;
- Throughput Accounting;
- gestão de capacidade;
- teoria das filas;
- gestão de lead time;
- gestão de WIP;
- Lean aplicado a serviços;
- gestão de funil comercial;
- gestão de operações de engenharia;
- automação e IA para ampliação de capacidade organizacional.

## Princípio de design da plataforma

A plataforma não deve ser apenas um dashboard.

Ela deve ser um sistema de decisão.

A cada semana, a plataforma deve ajudar a responder:

1. Qual é a principal restrição da XPE?
2. Qual gargalo mais limita o Throughput?
3. Qual estoque invisível mais cresceu?
4. Qual recurso crítico está saturado?
5. Qual ação deve ser tomada primeiro?
6. A meta planejada é factível com a capacidade atual?
7. O que precisa ser automatizado, delegado, padronizado ou contratado?
8. Qual é a próxima restrição provável?

## Resultado esperado

Criar uma plataforma web onde a XPE possa conversar com IA sobre seus dados, gargalos, metas e planos de ação, transformando gestão operacional em um processo contínuo de aprendizado e melhoria.

# Roadmap da Plataforma Web XPE

## Visão

Criar uma plataforma web de gestão com IA para monitorar gargalos, indicadores, capacidade e planos de ação da XPE.

A plataforma deve evoluir em fases.

## MVP 1 — Registro e visualização básica

Objetivo:

Criar base operacional mínima para registrar dados e visualizar gargalos.

Funcionalidades:

- cadastro de áreas;
- cadastro de indicadores;
- lançamento semanal;
- cadastro de gargalos;
- planos de ação;
- boletim semanal simples;
- dashboard básico.

Entregáveis:

- login;
- página dashboard;
- página indicadores;
- página gargalos;
- página planos de ação;
- página boletim.

## MVP 2 — Funil comercial e propostas paradas

Objetivo:

Atacar gargalo comercial.

Funcionalidades:

- cadastro de oportunidades;
- status do funil;
- propostas;
- apresentações;
- assembleias;
- follow-up;
- propostas paradas;
- conversão por etapa;
- tempo por etapa.

Entregáveis:

- painel comercial;
- tabela de propostas paradas;
- alertas;
- visão por vendedor.

## MVP 3 — Capacidade

Objetivo:

Medir se a meta é factível.

Funcionalidades:

- capacidade por vendedor;
- capacidade de consultoria;
- capacidade de revisão;
- capacidade de obras;
- capacidade de campo;
- disponibilidade;
- demanda;
- fila;
- lead time.

Entregáveis:

- mapa de capacidade;
- curva de capacidade;
- alertas de saturação.

## MVP 4 — Obras e escopo

Objetivo:

Controlar gargalos físicos e contratuais.

Funcionalidades:

- obras;
- escopo fechado;
- material;
- equipe;
- atrasos;
- dias úteis;
- chuva;
- aditivos;
- critérios de entrega.

Entregáveis:

- painel de obras;
- checklist de escopo;
- controle de mudanças;
- controle de material.

## MVP 5 — Consultoria e pós-venda

Objetivo:

Transformar consultoria em expansão da base.

Funcionalidades:

- laudos;
- projetos;
- revisão;
- entregáveis;
- apresentação dos entregáveis;
- oportunidades de obras;
- funil de pós-venda.

Entregáveis:

- painel consultoria;
- painel pós-venda;
- clientes da base;
- oportunidades por cliente.

## MVP 6 — IA de gestão

Objetivo:

Permitir conversa com dados e recomendações.

Funcionalidades:

- análise de gargalos;
- análise de metas;
- sugestões de plano de ação;
- geração de boletim;
- simulação de cenários;
- perguntas estratégicas;
- explicações de indicadores.

Entregáveis:

- chat com IA;
- contexto por área;
- análise semanal automática;
- plano sugerido.

## MVP 7 — Integrações

Objetivo:

Reduzir lançamento manual.

Possíveis integrações:

- ClickUp;
- CRM;
- Google Sheets;
- financeiro;
- n8n;
- Google Docs;
- Google Slides;
- app de campo.

## MVP 8 — Simulador estratégico

Objetivo:

Transformar meta em capacidade.

Funcionalidades:

- meta de faturamento;
- ticket médio;
- taxa de conversão;
- capacidade comercial;
- capacidade consultoria;
- capacidade obras;
- cenários;
- restrições;
- plano de elevação.

## Arquitetura sugerida

Frontend:

- React / Next.js;
- Tailwind;
- componentes de dashboard;
- tabelas editáveis;
- gráficos.

Backend:

- Node.js / Python;
- API REST ou GraphQL;
- autenticação;
- camada de serviços;
- fila para análises de IA.

Banco:

- PostgreSQL;
- tabelas relacionais;
- histórico temporal;
- logs de análise.

IA:

- agente de análise semanal;
- agente comercial;
- agente obras;
- agente consultoria;
- agente planejamento;
- embeddings sobre documentos da base;
- RAG para contexto.

## Princípios de produto

1. Simples primeiro.
2. Começar pelo boletim semanal.
3. Medir poucos indicadores bem.
4. Evoluir para análises profundas.
5. A IA deve explicar e recomendar, não apenas resumir.
6. Cada tela deve responder uma pergunta de gestão.

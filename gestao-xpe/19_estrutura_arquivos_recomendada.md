# Estrutura Recomendada do Projeto

## Estrutura de pastas

```text
xpe-gestao-platform/
  README.md
  knowledge-base/
    00_README.md
    01_contexto_estrategico_xpe.md
    02_sistema_operacional_xpe.md
    03_fluxo_valor_e_motores.md
    04_glossario_toc_xpe.md
    05_gargalos_principais.md
    06_indicadores_e_painel.md
    07_planos_acao_por_gargalo.md
    08_modelo_dados_plataforma.md
    09_requisitos_funcionais.md
    10_prompt_ia_sistema.md
    11_prompt_analise_dados.md
    12_boletim_semanal_template.md
    13_roadmap_plataforma.md
    14_user_stories_backlog.md
    15_current_reality_tree_xpe.md
    16_drum_buffer_rope_xpe.md
    17_throughput_accounting_xpe.md
    18_agentes_ia.md
    19_estrutura_arquivos_recomendada.md
  app/
    frontend/
    backend/
  database/
    schema.sql
    migrations/
    seed/
  docs/
    product/
    architecture/
    api/
  prompts/
    agents/
    analysis/
  scripts/
  integrations/
    clickup/
    google-sheets/
    n8n/
  data/
    imports/
    exports/
```

## README do projeto

O README principal deve explicar:

- objetivo da plataforma;
- stack escolhida;
- como rodar;
- módulos;
- arquitetura;
- uso da base de conhecimento.

## Uso com Cursor/IDE

Prompt inicial sugerido:

```text
Leia todos os arquivos da pasta knowledge-base. Eles descrevem o contexto estratégico, operacional e conceitual da plataforma de gestão da XPE.

Depois de ler, me ajude a estruturar a arquitetura inicial do projeto, definindo módulos, banco de dados, páginas, APIs e prioridades de implementação.

Não proponha funcionalidades genéricas. Use a lógica da Teoria das Restrições e os gargalos descritos na base.
```

## Primeira tarefa para IA na IDE

Criar documentação técnica inicial:

- product_requirements.md;
- architecture.md;
- database_schema.md;
- api_routes.md;
- mvp_plan.md;
- ui_pages.md.

## Segunda tarefa

Criar schema inicial:

- areas;
- users;
- metrics;
- metric_records;
- bottlenecks;
- bottleneck_assessments;
- action_plans;
- opportunities;
- proposals;
- clients;
- consulting_projects;
- work_projects;
- work_scopes;
- change_orders;
- invisible_inventories;
- weekly_bulletins.

## Terceira tarefa

Criar frontend inicial:

- Dashboard;
- Gargalos;
- Indicadores;
- Comercial;
- Consultoria;
- Obras;
- Boletim;
- IA.

## Quarta tarefa

Criar agente de IA inicial:

- endpoint `/ai/analyze-week`;
- endpoint `/ai/analyze-bottleneck`;
- endpoint `/ai/simulate-goal`;
- endpoint `/ai/generate-bulletin`.

## Princípio técnico

A plataforma deve ser construída para acumular histórico.

Sem histórico, a IA apenas opina.

Com histórico, a IA analisa tendência, capacidade e impacto real.

# Modelo de Dados da Plataforma XPE

## Objetivo

Definir entidades e campos para a plataforma web de gestão e monitoramento.

Este documento não é o schema final, mas a base conceitual para modelagem.

## Entidades principais

### Company

Campos:

- id;
- name;
- current_year_goal;
- current_month_goal;
- created_at;
- updated_at.

### Area

Exemplos:

- Marketing;
- Vendas;
- Consultoria;
- Pós-venda;
- Obras;
- Operações;
- Tecnologia;
- Financeiro.

Campos:

- id;
- name;
- description;
- owner_id;
- active.

### User

Campos:

- id;
- name;
- role;
- area_id;
- email;
- active;
- capacity_hours_week;
- is_critical_resource.

### Metric

Campos:

- id;
- name;
- description;
- category;
- area_id;
- unit;
- frequency;
- formula;
- target;
- warning_threshold;
- critical_threshold;
- active.

Categorias:

- throughput;
- inventory;
- operating_expense;
- capacity;
- lead_time;
- conversion;
- quality;
- availability;
- WIP;
- financial;
- operational.

### MetricRecord

Campos:

- id;
- metric_id;
- period_start;
- period_end;
- value;
- source;
- confidence;
- notes;
- created_by;
- created_at.

### Bottleneck

Campos:

- id;
- name;
- area_id;
- type;
- description;
- current_status;
- severity;
- evidence;
- main_metric_id;
- owner_id;
- active;
- created_at;
- updated_at.

Tipos:

- interno;
- externo;
- físico;
- comercial;
- técnico;
- operacional;
- processo;
- conhecimento;
- escopo;
- capacidade;
- mercado.

### BottleneckAssessment

Campos:

- id;
- bottleneck_id;
- date;
- capacity;
- demand;
- queue;
- lead_time;
- availability;
- variability;
- rework;
- financial_impact;
- status;
- diagnosis;
- next_action.

### ActionPlan

Campos:

- id;
- title;
- description;
- bottleneck_id;
- area_id;
- owner_id;
- status;
- priority;
- expected_impact;
- actual_impact;
- due_date;
- created_at;
- updated_at.

Status:

- não iniciado;
- em andamento;
- em teste;
- implantado;
- pausado;
- cancelado.

### Opportunity

Representa oportunidade comercial.

Campos:

- id;
- client_id;
- source;
- service_type;
- stage;
- estimated_value;
- probability;
- owner_id;
- created_at;
- last_contact_at;
- next_step_date;
- notes.

Estágios:

- lead;
- qualificado;
- visita agendada;
- diagnóstico feito;
- proposta em elaboração;
- proposta pronta;
- apresentação agendada;
- apresentada;
- negociação;
- ganha;
- perdida;
- parada.

### Proposal

Campos:

- id;
- opportunity_id;
- proposal_type;
- value;
- status;
- created_at;
- ready_at;
- presented_at;
- approved_at;
- lost_at;
- loss_reason;
- generated_by_automation;
- presentation_generated;
- notes.

Status:

- em elaboração;
- pronta;
- apresentação agendada;
- apresentada;
- em negociação;
- aprovada;
- perdida;
- parada.

### CommercialActivity

Campos:

- id;
- user_id;
- client_id;
- opportunity_id;
- type;
- start_time;
- end_time;
- duration_minutes;
- is_noble_time;
- notes.

Tipos:

- reunião síndico;
- assembleia;
- follow-up;
- negociação;
- visita técnica;
- coleta de dados;
- proposta;
- administrativo;
- deslocamento;
- CRM.

### Client

Campos:

- id;
- name;
- type;
- segment;
- city;
- status;
- first_contract_date;
- lifetime_value;
- notes.

### ConsultingProject

Campos:

- id;
- client_id;
- contract_id;
- type;
- status;
- responsible_engineer_id;
- reviewer_id;
- start_date;
- due_date;
- delivered_at;
- presented_at;
- rework_count;
- field_data_quality;
- notes.

Status:

- contratado;
- aguardando dados;
- em execução;
- aguardando revisão;
- revisando;
- entregue;
- apresentado;
- concluído;
- atrasado.

### FieldCollection

Campos:

- id;
- client_id;
- service_type;
- responsible_id;
- date;
- checklist_completed;
- completeness_score;
- missing_items;
- photos_count;
- requires_return;
- notes.

### WorkProject

Representa obra.

Campos:

- id;
- client_id;
- contract_id;
- type;
- status;
- scope_status;
- planned_start;
- planned_end;
- actual_start;
- actual_end;
- team_id;
- estimated_value;
- estimated_margin;
- actual_margin;
- weather_risk;
- material_status;
- access_status;
- notes.

Status:

- proposta;
- aprovada;
- escopo pendente;
- planejamento;
- aguardando material;
- aguardando acesso;
- em execução;
- pausada;
- concluída;
- entregue;
- atrasada.

### WorkScope

Campos:

- id;
- work_project_id;
- description;
- inclusions;
- exclusions;
- assumptions;
- client_responsibilities;
- xpe_responsibilities;
- acceptance_criteria;
- access_conditions;
- change_rules;
- approved_at;
- approved_by;
- version.

### ChangeOrder

Termo aditivo ou mudança de escopo.

Campos:

- id;
- work_project_id;
- description;
- change_type;
- technical_impact;
- financial_impact;
- deadline_impact;
- value;
- status;
- approved_at;
- notes.

Tipos:

- sem impacto;
- impacto técnico;
- impacto financeiro;
- impacto prazo;
- impacto múltiplo.

### MaterialRecord

Campos:

- id;
- work_project_id;
- item_name;
- planned_quantity;
- purchased_quantity;
- used_quantity;
- missing_quantity;
- leftover_quantity;
- unit_cost;
- supplier;
- delivery_date;
- status.

### InvisibleInventory

Campos:

- id;
- area_id;
- type;
- description;
- quantity;
- estimated_hours;
- estimated_financial_impact;
- created_at;
- resolved_at;
- owner_id;
- status.

Tipos:

- proposta parada;
- cliente sem follow-up;
- retrabalho;
- escopo extra;
- material faltante;
- dado faltante;
- aprovação externa;
- conhecimento não documentado;
- ferramenta não utilizada.

### WeeklyBulletin

Campos:

- id;
- week_start;
- week_end;
- executive_summary;
- main_constraint;
- main_risk;
- revenue_week;
- revenue_month_accumulated;
- pipeline;
- forecast;
- key_actions;
- created_at.

### AIAnalysis

Campos:

- id;
- analysis_type;
- input_context;
- output_summary;
- recommendations;
- confidence;
- created_at;
- created_by.

## Relacionamentos importantes

- Area possui muitos Metrics.
- Bottleneck pertence a Area.
- Bottleneck possui muitos Assessments.
- Bottleneck possui muitos ActionPlans.
- Opportunity pertence a Client.
- Proposal pertence a Opportunity.
- ConsultingProject pertence a Client.
- WorkProject pertence a Client.
- WorkProject possui WorkScope.
- WorkProject possui ChangeOrders.
- WorkProject possui MaterialRecords.
- WeeklyBulletin consolida Metrics, Bottlenecks e ActionPlans.

## Requisitos para IA

A IA deve poder consultar:

- histórico de métricas;
- gargalos atuais;
- planos de ação;
- funil comercial;
- propostas paradas;
- obras em risco;
- capacidade por área;
- estoques invisíveis;
- boletins anteriores.

A IA deve responder perguntas como:

- Qual é a restrição atual?
- A meta é factível?
- Onde há fila?
- Qual ação deve ser priorizada?
- Contratar agora faz sentido?
- Qual gargalo está piorando?
- Qual processo precisa de automação?

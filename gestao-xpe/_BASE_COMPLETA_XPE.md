# FILE: 00_README.md

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

---

# FILE: 01_contexto_estrategico_xpe.md

# Contexto Estratégico da XPE

## Empresa

A XPE atua com engenharia elétrica, consultoria, laudos, projetos, obras, tecnologia, medição, automações e soluções aplicadas principalmente a condomínios.

A empresa possui duas frentes principais:

1. XPE Consultoria
2. XPE Obras

A consultoria é o principal produto de entrada, relacionamento e diagnóstico.

As obras são frequentemente consequência da consultoria e representam expansão de receita na base instalada.

## Histórico de crescimento

Referências discutidas:

- 2024: aproximadamente R$ 600 mil de faturamento.
- 2025: aproximadamente R$ 1 milhão.
- 2026.1: aproximadamente R$ 1 milhão no primeiro semestre.
- Meta 2026: R$ 3 milhões.
- Meta 2026.2: aproximadamente R$ 2 milhões no segundo semestre.

Isso implica forte crescimento e necessidade de organizar capacidade, processos, vendas e execução.

## Desafio central

A XPE possui demanda e oportunidades.

O principal desafio não é apenas gerar leads.

O desafio é transformar oportunidades em receita e entrega com:

- velocidade;
- qualidade;
- previsibilidade;
- margem;
- baixa dependência de pessoas-chave;
- capacidade de escala.

## Tese estratégica

A XPE deve crescer aumentando sua capacidade organizacional, e não apenas sua quantidade de pessoas.

Capacidade organizacional inclui:

- processos;
- checklists;
- padrões;
- bibliotecas;
- IA;
- automações;
- dashboards;
- dados históricos;
- treinamentos;
- playbooks;
- ferramentas internas;
- cultura de gestão por restrições.

## Modelo de crescimento

A XPE possui dois ciclos de receita.

### Ciclo 1 — Aquisição

```text
Marketing / Indicações
↓
SDR / Comercial
↓
Visita / Diagnóstico
↓
Proposta
↓
Apresentação
↓
Fechamento
↓
Consultoria / Laudos / Projetos
```

### Ciclo 2 — Expansão da Base

```text
Consultoria entregue
↓
Apresentação dos entregáveis
↓
Identificação de oportunidades
↓
Pós-venda técnico
↓
Proposta de obra ou serviço complementar
↓
Assembleia / negociação
↓
Fechamento
↓
Execução
↓
Nova oportunidade
```

## Implicação estratégica

A XPE não deve olhar apenas para novos clientes.

Ela deve olhar fortemente para a base existente.

A consultoria é um mecanismo de entrada e diagnóstico.

A obra é uma das formas principais de expansão da receita.

## Meta da plataforma

A plataforma deve permitir transformar a meta financeira em uma equação operacional.

Exemplo:

```text
Meta de faturamento
↓
quantidade de vendas necessárias
↓
quantidade de propostas
↓
quantidade de apresentações
↓
quantidade de assembleias
↓
quantidade de visitas
↓
capacidade comercial necessária
↓
capacidade técnica necessária
↓
capacidade de obras necessária
```

A meta só deve ser considerada factível quando a capacidade do sistema sustentar o plano.

---

# FILE: 02_sistema_operacional_xpe.md

# Sistema Operacional XPE

## Propósito

Criar uma filosofia de gestão própria para a XPE, baseada na Teoria das Restrições, gestão de capacidade, automação, IA e melhoria contínua.

O Sistema Operacional XPE deve orientar:

- decisões de crescimento;
- priorização de projetos internos;
- contratação;
- automação;
- gestão comercial;
- gestão de consultoria;
- gestão de obras;
- boletim semanal;
- análise de dados;
- planejamento estratégico.

## Princípio central

A XPE deve ser administrada como um sistema, não como um conjunto de departamentos isolados.

O desempenho global não é a soma da eficiência das partes.

O desempenho global é limitado pela principal restrição do sistema.

## Meta

Gerar lucro agora e no futuro, aumentando Throughput com previsibilidade, qualidade e capacidade de escala.

## Regras estratégicas

1. Não melhorar tudo ao mesmo tempo.
2. Identificar a restrição atual.
3. Explorar a restrição antes de investir.
4. Subordinar o sistema à restrição.
5. Elevar a restrição quando necessário.
6. Antecipar a próxima restrição.
7. Evitar que a inércia vire o próximo gargalo.
8. Automatizar para aumentar Throughput, não por moda.
9. Contratar para elevar uma restrição, não apenas porque há sobrecarga percebida.
10. Medir capacidade, fila, lead time e disponibilidade.

## Cinco Passos da TOC aplicados à XPE

### 1. Identificar a restrição

Perguntas:

- Onde há fila?
- Onde o lead time cresce?
- Onde há capacidade insuficiente?
- Qual etapa limita faturamento?
- Qual etapa limita entrega?
- Qual etapa limita crescimento?
- Qual recurso está saturado?

### 2. Explorar a restrição

Antes de contratar ou investir, extrair mais valor da restrição atual.

Exemplos:

- liberar tempo do vendedor;
- evitar que Jonildo corrija trabalho operacional;
- garantir material antes da obra;
- preparar assembleia com antecedência;
- usar analisadores apenas onde são necessários;
- automatizar proposta.

### 3. Subordinar o sistema

Todas as áreas devem apoiar a restrição.

Se a restrição é apresentação comercial:

- marketing não deve gerar excesso descontrolado de leads;
- propostas devem estar prontas;
- engenharia deve apoiar diagnósticos;
- follow-up deve estar organizado.

Se a restrição é obras:

- comercial não deve vender acima da capacidade;
- compras deve antecipar material;
- escopo deve estar fechado;
- cliente deve liberar acesso;
- equipe deve ter checklist.

### 4. Elevar a restrição

Depois de explorar e subordinar, pode fazer sentido:

- contratar;
- comprar equipamentos;
- criar nova equipe;
- automatizar;
- terceirizar;
- treinar;
- mudar processo;
- criar nova função.

### 5. Evitar inércia

Quando uma restrição for resolvida, outra aparecerá.

A empresa deve perguntar continuamente:

- qual é a próxima restrição?
- a regra antiga ainda faz sentido?
- o processo antigo ainda é necessário?
- a automação mudou o gargalo?
- a contratação mudou o gargalo?

## Frase-guia

A missão da diretoria não é resolver todos os problemas do dia a dia.

A missão da diretoria é identificar continuamente a restrição atual e a próxima restrição, elevando a capacidade do sistema sem aumentar o caos operacional.

---

# FILE: 03_fluxo_valor_e_motores.md

# Fluxo de Valor e Motores da XPE

## Fluxo principal

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
Novas oportunidades
```

## Visão por motores

### Motor 1 — Aquisição

Objetivo: trazer novos clientes para a base.

Componentes:

- marketing;
- indicações;
- SDR;
- vendas;
- visitas;
- propostas;
- apresentações;
- fechamento de consultorias.

Indicadores:

- leads;
- visitas;
- propostas;
- apresentações;
- contratos;
- conversão por etapa;
- ticket médio;
- receita nova.

### Motor 2 — Consultoria

Objetivo: entregar valor técnico, gerar confiança, diagnosticar necessidades e criar base para expansão.

Componentes:

- laudos;
- projetos;
- diagnósticos;
- revisões;
- apresentação dos entregáveis;
- recomendações técnicas.

Indicadores:

- laudos em andamento;
- projetos em andamento;
- entregas concluídas;
- lead time;
- retrabalho;
- entregáveis apresentados;
- oportunidades identificadas.

### Motor 3 — Expansão da base

Objetivo: transformar consultoria em novas vendas, principalmente obras e serviços complementares.

Componentes:

- pós-venda técnico;
- propostas de obras;
- reuniões com síndicos;
- assembleias;
- novas consultorias;
- novos projetos.

Indicadores:

- oportunidades por cliente;
- propostas de obras;
- conversão da base;
- faturamento da base;
- LTV;
- tempo consultoria → proposta de obra.

### Motor 4 — Obras

Objetivo: executar obras com margem, qualidade, prazo e previsibilidade.

Componentes:

- escopo fechado;
- material;
- equipe;
- planejamento;
- execução;
- relatório;
- entrega.

Indicadores:

- obras em andamento;
- obras concluídas;
- capacidade por equipe;
- dias úteis;
- atrasos;
- material faltante;
- alterações de escopo;
- aditivos;
- margem.

### Motor 5 — Operações transversais

Objetivo: garantir que informações, ferramentas e processos alimentem corretamente todos os motores.

Componentes:

- coleta de campo;
- app;
- ClickUp;
- CRM;
- checklists;
- n8n;
- automações;
- dashboards;
- bibliotecas técnicas.

Indicadores:

- coleta completa;
- uso de ferramentas;
- retrabalho por dado faltante;
- tarefas fora do sistema;
- checklist preenchido;
- adoção por equipe.

## Fluxo corrigido para plataforma

A plataforma deve permitir enxergar a empresa por dois eixos:

### Eixo 1 — Fluxo

Mostra o avanço da oportunidade até a entrega e nova receita.

### Eixo 2 — Capacidade

Mostra se cada etapa consegue absorver o volume da etapa anterior.

## Regras do fluxo

1. Não gerar mais trabalho do que a próxima etapa consegue absorver.
2. Não vender obra sem capacidade de execução.
3. Não fazer visita sem capacidade de proposta/apresentação.
4. Não iniciar obra sem escopo fechado.
5. Não enviar para revisão sem checklist mínimo.
6. Não encerrar consultoria sem apresentar entregáveis e mapear oportunidades.

---

# FILE: 04_glossario_toc_xpe.md

# Glossário TOC adaptado à XPE

## Throughput

Capacidade da empresa de gerar receita real através de vendas e entregas.

Na XPE:

- receita de consultoria;
- receita de laudos;
- receita de projetos;
- receita de obras;
- receita de pós-venda;
- receita recorrente futura;
- receita por cliente da base.

Indicadores derivados:

- Throughput total;
- Throughput por vendedor;
- Throughput por assembleia;
- Throughput por cliente;
- Throughput por hora comercial nobre;
- Throughput por recurso crítico;
- Throughput por equipe de obras.

## Inventory

Tudo que consome recurso, tempo, atenção ou capacidade, mas ainda não virou receita, entrega ou valor percebido.

Exemplos:

- propostas paradas;
- visitas sem proposta;
- clientes sem follow-up;
- obras aguardando material;
- laudos aguardando revisão;
- dados de campo incompletos;
- retrabalho;
- alterações não cobradas;
- conhecimento não documentado;
- vendedor fazendo atividade operacional;
- especialista corrigindo tarefa básica.

## Operating Expense

Tudo que a empresa gasta para operar.

Exemplos:

- salários;
- softwares;
- marketing;
- veículos;
- ferramentas;
- administrativo;
- tecnologia;
- infraestrutura.

A regra é controlar OE sem prejudicar Throughput.

## Restrição

Recurso, etapa, política ou condição externa que limita o desempenho global.

Pode ser:

- interna;
- externa;
- física;
- comercial;
- técnica;
- operacional;
- mercadológica;
- de conhecimento;
- de agenda;
- de escopo.

## Gargalo

Ponto onde há acúmulo, espera, lead time alto ou incapacidade de absorver demanda.

Nem todo gargalo é a restrição principal da empresa, mas todo gargalo deve ser monitorado.

## Estoque Invisível

Inventory que não aparece como material físico.

Exemplos:

- proposta não apresentada;
- relacionamento não feito;
- cliente esperando;
- retrabalho;
- pendência de aprovação;
- escopo desalinhado;
- informação faltante;
- oportunidade na base não explorada.

## Tempo Comercial Nobre

Tempo do vendedor dedicado a atividades que realmente geram receita:

- relacionamento;
- apresentação;
- negociação;
- assembleia;
- follow-up estratégico;
- pós-venda consultivo.

## Capacidade Organizacional

Capacidade que permanece na empresa mesmo quando pessoas mudam.

Exemplos:

- processos;
- automações;
- IA;
- biblioteca técnica;
- checklists;
- playbooks;
- dashboards;
- dados históricos;
- treinamentos.

## Drum

Recurso que dita o ritmo do sistema.

Exemplos na XPE:

- agenda dos vendedores;
- assembleias;
- revisão técnica;
- equipe de obras;
- dias úteis;
- analisadores.

## Buffer

Proteção antes do recurso crítico.

Exemplos:

- proposta pronta antes da assembleia;
- material conferido antes da obra;
- checklist antes da revisão;
- campo validado antes do projeto.

## Rope

Mecanismo que limita entrada de trabalho para não saturar a restrição.

Exemplo:

Se há propostas paradas sem apresentação, não adianta aumentar muito visitas.

## Lead Time

Tempo total entre início e fim de uma etapa.

Exemplos:

- lead → visita;
- visita → proposta pronta;
- proposta pronta → apresentação;
- apresentação → fechamento;
- contrato → entrega;
- contrato → mobilização;
- mobilização → conclusão.

## WIP

Work in Progress.

Quantidade de atividades abertas ao mesmo tempo.

WIP alto gera:

- mais lead time;
- mais confusão;
- mais retrabalho;
- menos previsibilidade;
- mais urgência.

## Custo de Oportunidade

Valor perdido por não aproveitar uma oportunidade escassa.

Exemplo:

Assembleia mal preparada pode gerar perda da venda principal, da obra futura e do relacionamento com a base.

## Escopo Fechado

Conjunto claro de:

- o que será feito;
- o que não será feito;
- material;
- prazo;
- condição de acesso;
- responsabilidades;
- critérios de aceite;
- regra de aditivo.

Em obras, escopo fechado é restrição de execução.

---

# FILE: 05_gargalos_principais.md

# Gargalos Principais da XPE

## Visão geral

Os gargalos da XPE devem ser tratados como pontos de controle do crescimento.

A empresa não deve tentar atacar tudo ao mesmo tempo.

O foco inicial deve estar nos gargalos que mais afetam:

- faturamento;
- conversão;
- lead time;
- entrega;
- retrabalho;
- margem;
- capacidade de escala.

## Ranking inicial dos gargalos

### 1. Capacidade comercial nobre

O vendedor possui tempo limitado.

Se esse tempo é consumido por tarefas operacionais, a empresa perde capacidade de conversão.

Sintomas:

- propostas paradas;
- clientes sem follow-up;
- excesso de visitas;
- poucas apresentações;
- queda aparente da conversão geral;
- vendedor sem tempo para relacionamento.

Indicadores:

- tempo comercial nobre;
- horas administrativas;
- propostas apresentadas;
- propostas paradas;
- taxa proposta pronta → apresentação;
- contratos fechados / propostas apresentadas;
- receita por vendedor;
- receita por hora comercial nobre.

Planos de ação:

- automatizar propostas;
- automatizar apresentações;
- delegar levantamento;
- criar função de apoio comercial/técnico;
- melhorar CRM;
- padronizar follow-up;
- criar cadência semanal.

### 2. Capacidade de apresentação e assembleias

Assembleias são eventos raros e valiosos.

Sintomas:

- proposta pronta sem reunião;
- oportunidades perdidas por falta de preparo;
- assembleias sem orçamentos complementares;
- cliente demora a decidir;
- pós-venda não explorado.

Indicadores:

- assembleias/mês;
- assembleias por vendedor;
- conversão por assembleia;
- ticket por assembleia;
- receita pós-venda por assembleia;
- propostas complementares apresentadas;
- oportunidades geradas por assembleia.

Planos de ação:

- checklist de assembleia;
- preparar cenários;
- mapear pós-venda antes;
- roteiros de objeções;
- materiais para síndicos e conselho;
- follow-up pós-assembleia.

### 3. Revisão técnica e tempo de especialista

O especialista não pode virar executor operacional.

Sintomas:

- Jonildo corrigindo trabalho de estagiário;
- revisão tarde;
- pouco feedback;
- retrabalho;
- fila de projetos;
- dependência técnica.

Indicadores:

- horas do especialista por entrega;
- itens aguardando revisão;
- revisões tardias;
- retrabalho por tipo;
- devoluções para estagiário;
- erros recorrentes;
- lead time de revisão.

Planos de ação:

- checklist pré-revisão;
- revisão intermediária;
- biblioteca de erros;
- treinamento técnico;
- IA de validação;
- critérios mínimos antes de revisar;
- formar novos revisores.

### 4. Coleta de campo

Campo alimenta vendas, consultoria e obras.

Sintomas:

- foto faltante;
- dado incompleto;
- retorno ao local;
- projeto parado;
- orçamento errado;
- revisão encontra falha;
- obra descobre problema tarde.

Indicadores:

- % coletas completas na primeira visita;
- retornos a campo;
- pendências de informação;
- retrabalho por dado faltante;
- tempo perdido por campo;
- uso do app/checklist.

Planos de ação:

- app de campo;
- checklist obrigatório;
- fotos mínimas;
- validação antes de encerrar;
- treinamento;
- indicador por responsável.

### 5. Escopo fechado de obras

Obra não é flexível como consultoria.

Escopo define material, prazo, equipe, custo e entrega física.

Sintomas:

- mudança em assembleia sem aditivo;
- execução diferente da proposta;
- material insuficiente;
- cliente espera algo diferente;
- perda de margem;
- conflito na entrega.

Indicadores:

- obras com alteração de escopo;
- aditivos emitidos;
- alterações sem cobrança;
- retrabalho por escopo;
- custo extra não cobrado;
- divergência proposta x execução;
- margem perdida.

Planos de ação:

- checklist de escopo fechado;
- contrato mais claro;
- regra de aditivo;
- critérios de aceite;
- exclusões;
- premissas;
- caderno técnico de execução.

### 6. Capacidade de execução de obras

A equipe de obras é limitada por tempo útil.

Sintomas:

- obras acumuladas;
- atraso por chuva;
- atraso por material;
- atraso por acesso;
- equipe parada;
- execução em cima da hora.

Indicadores:

- obras simultâneas;
- obras concluídas/mês;
- dias úteis;
- dias perdidos por chuva;
- dias perdidos por material;
- produtividade por equipe;
- capacidade teórica vs efetiva.

Planos de ação:

- planejamento semanal;
- buffer de clima;
- material conferido antes;
- confirmação de acesso;
- equipe backup;
- terceiros em pico;
- contratação com processo padronizado.

### 7. Pós-venda técnico

A consultoria precisa gerar novas oportunidades.

Sintomas:

- laudo entregue sem reunião;
- oportunidade identificada sem proposta;
- cliente da base sem contato;
- obra potencial esquecida;
- baixa conversão da base.

Indicadores:

- entregáveis apresentados;
- oportunidades por cliente;
- propostas pós-venda;
- conversão consultoria → obra;
- receita da base;
- LTV;
- clientes sem follow-up.

Planos de ação:

- reunião obrigatória de devolutiva;
- checklist de oportunidades;
- carteira da base;
- rotina de pós-venda;
- materiais de recomendação;
- funil específico de expansão.

### 8. Adoção de ferramentas e padronização

Ferramenta não usada não vira capacidade.

Sintomas:

- informação no WhatsApp;
- tarefa fora do ClickUp;
- app ignorado;
- automação disponível mas não usada;
- retrabalho por falta de registro.

Indicadores:

- % uso do CRM;
- % uso do ClickUp;
- % checklists completos;
- % propostas geradas por automação;
- tarefas fora do sistema;
- retrabalho por falta de registro.

Planos de ação:

- treinamento;
- redução de fricção;
- rotina obrigatória;
- responsável por ferramenta;
- medição de uso;
- revisão semanal de adesão.

---

# FILE: 06_indicadores_e_painel.md

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

---

# FILE: 07_planos_acao_por_gargalo.md

# Planos de Ação por Gargalo

## Objetivo

Este documento organiza ações práticas para melhorar cada gargalo identificado.

Cada plano deve ser tratado como hipótese de melhoria.

A plataforma deve permitir registrar:

- gargalo;
- ação;
- responsável;
- prazo;
- status;
- impacto esperado;
- impacto real;
- indicador associado;
- evidência antes/depois.

## Gargalo: Tempo comercial nobre

### Problema

Vendedores estão consumindo tempo em atividades que não exigem venda consultiva.

### Ações

1. Automatizar proposta em PDF.
2. Automatizar apresentação em PowerPoint.
3. Delegar visita de coleta sem síndico.
4. Criar função de apoio comercial/técnico.
5. Criar cadência de follow-up.
6. Criar rotina de atualização de CRM.
7. Criar biblioteca de objeções.
8. Criar playbook de apresentação.
9. Criar agenda semanal de prioridades comerciais.
10. Medir horas por tipo de atividade.

### Resultado esperado

- mais propostas apresentadas;
- mais follow-up;
- maior conversão de apresentação;
- maior receita por vendedor;
- menos propostas paradas.

## Gargalo: Propostas paradas

### Problema

Volume de visitas/diagnósticos cresceu, mas parte das propostas não chega à apresentação.

### Ações

1. Criar status claro da proposta.
2. Criar fila de propostas paradas.
3. Definir responsável por destravar.
4. Medir idade de cada proposta.
5. Automatizar geração.
6. Criar reunião semanal de propostas pendentes.
7. Definir data de próxima ação para toda proposta.
8. Criar alertas de proposta sem movimento.

### Resultado esperado

- menos Inventory comercial;
- menor lead time;
- mais apresentações;
- maior faturamento sem aumentar leads.

## Gargalo: Assembleias

### Problema

Assembleias são raras e de alto valor. Oportunidade mal preparada gera perda de receita presente e futura.

### Ações

1. Checklist de assembleia.
2. Proposta principal revisada.
3. Cenários alternativos.
4. Orçamentos complementares.
5. Oportunidades de pós-venda.
6. Objeções previstas.
7. Próximos passos definidos.
8. Registro de aprendizados.
9. Follow-up em até 24h.
10. Classificação de alterações solicitadas.

### Resultado esperado

- maior conversão;
- maior ticket;
- mais pós-venda;
- menos perda de oportunidade.

## Gargalo: Revisão técnica

### Problema

Especialista corrige trabalho operacional e perde capacidade de decisão/revisão.

### Ações

1. Checklist pré-revisão.
2. Revisão intermediária.
3. Biblioteca de erros recorrentes.
4. Treinamento dos estagiários.
5. IA para validações básicas.
6. Critérios mínimos de envio.
7. Devolução estruturada com feedback.
8. Separar correção operacional de revisão técnica.
9. Medir horas de especialista por tipo de atividade.

### Resultado esperado

- menos retrabalho;
- mais autonomia;
- menos dependência;
- maior capacidade de revisão.

## Gargalo: Coleta de campo

### Problema

Dados incompletos geram retrabalho, atrasos e decisões ruins.

### Ações

1. App de campo.
2. Checklist por tipo de serviço.
3. Fotos obrigatórias.
4. Validação antes de encerrar visita.
5. Responsável pela qualidade da coleta.
6. Treinamento.
7. Painel de coletas incompletas.
8. Registro de retorno a campo.
9. Integração com proposta/projeto.

### Resultado esperado

- menos retorno;
- menos erro;
- propostas mais rápidas;
- projetos mais completos;
- menos retrabalho.

## Gargalo: Escopo de obra

### Problema

Obra física exige escopo fechado. Alterações sem controle causam perda de margem e atraso.

### Ações

1. Checklist de escopo fechado.
2. Critérios de entrega.
3. Exclusões explícitas.
4. Premissas.
5. Responsabilidades do cliente.
6. Responsabilidades da XPE.
7. Condições de acesso.
8. Modelo de termo aditivo.
9. Classificação de mudanças.
10. Aprovação formal antes da execução.

### Resultado esperado

- menos conflito;
- menos retrabalho;
- maior margem;
- execução mais previsível;
- menos improviso.

## Gargalo: Material de obra

### Problema

Material faltante paralisa equipe; material excedente prende capital.

### Ações

1. Lista padrão de materiais por tipo de obra.
2. Conferência antes da mobilização.
3. Buffer de itens críticos.
4. Registro de sobras.
5. Registro de faltas.
6. Histórico por obra.
7. Integração orçamento → compra.
8. Controle de compras emergenciais.
9. Homologação de fornecedores.

### Resultado esperado

- menos parada;
- menos compra emergencial;
- menos capital parado;
- melhor orçamento.

## Gargalo: Tempo útil de obra

### Problema

Capacidade real é menor que a teórica devido a chuva, feriados, acesso e material.

### Ações

1. Planejamento por dias úteis.
2. Registro de dias perdidos.
3. Buffer climático.
4. Confirmação de acesso.
5. Plano B para chuva.
6. Planejamento por região.
7. Equipe backup em períodos críticos.
8. Terceirização controlada em picos.

### Resultado esperado

- melhor previsibilidade;
- menos atraso;
- melhor uso da equipe;
- capacidade real conhecida.

## Gargalo: Pós-venda técnico

### Problema

Consultoria não vira obra se não houver processo de expansão.

### Ações

1. Reunião de devolutiva obrigatória.
2. Checklist de oportunidades.
3. Funil da base.
4. Propostas de obra por cliente.
5. Relatório de oportunidades.
6. Rotina de pós-venda semanal.
7. Materiais para síndico/conselho.
8. CRM da base.

### Resultado esperado

- mais receita na base;
- maior LTV;
- menos dependência de novos leads;
- maior conversão consultoria → obras.

## Gargalo: Adoção de ferramentas

### Problema

Ferramentas existem, mas nem sempre viram rotina operacional.

### Ações

1. Medir uso.
2. Treinar equipe.
3. Simplificar interface.
4. Reduzir duplicidade.
5. Definir processo obrigatório.
6. Criar responsáveis por módulo.
7. Revisar semanalmente pendências fora do sistema.
8. Integrar ferramentas.

### Resultado esperado

- menos informação perdida;
- mais dados históricos;
- menos retrabalho;
- melhor gestão por IA.

---

# FILE: 08_modelo_dados_plataforma.md

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

---

# FILE: 09_requisitos_funcionais.md

# Requisitos Funcionais da Plataforma XPE

## Objetivo

Criar uma plataforma web para gestão, monitoramento, análise com IA e planejamento baseado em gargalos, capacidade e TOC.

## Módulo 1 — Dashboard Executivo

Funcionalidades:

- exibir faturamento do mês;
- exibir meta mensal;
- exibir pipeline;
- exibir forecast;
- exibir principal restrição;
- exibir risco principal;
- exibir ação prioritária;
- exibir status do plano semanal;
- exibir evolução histórica.

Cards principais:

- Receita mensal;
- % meta;
- Pipeline ponderado;
- Propostas paradas;
- Assembleias do mês;
- Obras em andamento;
- Restrição da semana;
- Estoque invisível crítico.

## Módulo 2 — Mapa de Gargalos

Funcionalidades:

- cadastrar gargalo;
- classificar gargalo;
- associar área;
- associar indicador principal;
- registrar evidência;
- registrar severidade;
- acompanhar histórico;
- associar planos de ação;
- gerar análise de IA.

Tipos de gargalo:

- comercial;
- técnico;
- operacional;
- físico;
- externo;
- escopo;
- capacidade;
- conhecimento;
- processo.

## Módulo 3 — Indicadores

Funcionalidades:

- cadastrar indicador;
- definir fórmula;
- definir frequência;
- definir meta;
- definir alerta;
- inserir valores;
- importar dados;
- visualizar histórico;
- comparar períodos;
- gerar insights de IA.

Indicadores universais:

- capacidade;
- demanda;
- fila;
- lead time;
- disponibilidade;
- variabilidade;
- retrabalho;
- impacto financeiro.

## Módulo 4 — Funil Comercial

Funcionalidades:

- registrar oportunidades;
- acompanhar etapas;
- registrar propostas;
- registrar apresentações;
- registrar assembleias;
- registrar follow-ups;
- medir conversões por etapa;
- identificar propostas paradas;
- medir tempo por etapa;
- analisar conversão real.

Etapas:

- lead;
- qualificado;
- visita;
- diagnóstico;
- proposta em elaboração;
- proposta pronta;
- apresentação agendada;
- apresentada;
- negociação;
- ganha;
- perdida;
- parada.

Indicadores:

- propostas prontas;
- propostas apresentadas;
- taxa proposta pronta → apresentação;
- contratos / propostas apresentadas;
- propostas paradas;
- idade das propostas;
- tempo comercial nobre.

## Módulo 5 — Capacidade Comercial

Funcionalidades:

- medir capacidade por vendedor;
- medir agenda;
- registrar tempo comercial nobre;
- registrar atividades administrativas;
- calcular receita por vendedor;
- calcular receita por hora nobre;
- identificar saturação;
- simular contratação.

## Módulo 6 — Consultoria

Funcionalidades:

- registrar laudos e projetos;
- acompanhar status;
- registrar revisão;
- medir lead time;
- registrar retrabalho;
- medir tempo de especialista;
- registrar apresentação de entregáveis;
- gerar oportunidades de pós-venda.

## Módulo 7 — Pós-venda

Funcionalidades:

- listar clientes da base;
- mapear oportunidades;
- criar propostas de obras;
- acompanhar follow-up;
- medir conversão da base;
- medir receita da base;
- acompanhar LTV.

## Módulo 8 — Obras

Funcionalidades:

- registrar obras;
- registrar escopo;
- registrar status de material;
- registrar equipe;
- registrar datas;
- registrar atrasos;
- registrar chuva/feriado/acesso;
- registrar aditivos;
- registrar margem;
- acompanhar capacidade de execução.

## Módulo 9 — Escopo de Obras

Funcionalidades:

- criar escopo fechado;
- registrar inclusões;
- registrar exclusões;
- registrar premissas;
- registrar responsabilidades;
- registrar critérios de aceite;
- controlar versões;
- registrar alterações;
- gerar termo aditivo;
- medir impacto de mudanças.

## Módulo 10 — Campo e Operações

Funcionalidades:

- registrar coleta de campo;
- checklist;
- fotos;
- completude;
- pendências;
- retorno a campo;
- integração com consultoria/proposta/obra;
- medir qualidade da coleta.

## Módulo 11 — Estoques Invisíveis

Funcionalidades:

- cadastrar estoque invisível;
- classificar;
- estimar impacto;
- associar responsável;
- acompanhar redução;
- gerar ranking;
- relacionar com gargalos.

Tipos:

- proposta parada;
- dado faltante;
- retrabalho;
- escopo extra;
- material faltante;
- aprovação externa;
- cliente sem follow-up;
- conhecimento não documentado;
- ferramenta não usada.

## Módulo 12 — Planos de Ação

Funcionalidades:

- cadastrar ação;
- associar gargalo;
- responsável;
- prazo;
- prioridade;
- status;
- impacto esperado;
- impacto real;
- anexos;
- comentários;
- histórico.

## Módulo 13 — Boletim Semanal

Funcionalidades:

- gerar boletim;
- consolidar indicadores;
- listar restrição da semana;
- listar riscos;
- listar ações;
- comparar com semana anterior;
- gerar narrativa com IA;
- exportar para PDF/Markdown.

## Módulo 14 — IA de Gestão

Funcionalidades:

- conversar com dados;
- explicar gargalos;
- sugerir ações;
- avaliar meta;
- simular cenários;
- analisar capacidade;
- analisar conversão;
- gerar plano semanal;
- gerar perguntas para diretoria;
- alertar inconsistências.

## Módulo 15 — Simulador de Meta e Capacidade

Funcionalidades:

- inserir meta de faturamento;
- inserir ticket médio;
- inserir conversões;
- calcular vendas necessárias;
- calcular propostas necessárias;
- calcular apresentações necessárias;
- calcular visitas necessárias;
- calcular obras necessárias;
- confrontar com capacidade;
- indicar gargalos;
- sugerir plano de elevação.

## Módulo 16 — Histórico

Funcionalidades:

- histórico mensal;
- histórico semanal;
- comparação por período;
- tendências;
- sazonalidade;
- evolução dos gargalos;
- efeito de ações implantadas.

## Módulo 17 — Administração

Funcionalidades:

- usuários;
- áreas;
- permissões;
- metas;
- integrações;
- importação de dados;
- configurações de IA.

---

# FILE: 10_prompt_ia_sistema.md

# Prompt Base para IA da Plataforma XPE

Use este prompt como system/context para agentes de IA dentro da plataforma.

## Papel da IA

Você é uma IA de gestão estratégica e operacional da XPE.

Você deve atuar como:

- consultor de Teoria das Restrições;
- analista de dados;
- analista de capacidade;
- consultor comercial;
- consultor de operações;
- consultor de obras;
- consultor de processos;
- orientador da diretoria.

Seu objetivo é ajudar a XPE a crescer com previsibilidade, qualidade e controle.

## Contexto da empresa

A XPE atua com:

- engenharia elétrica;
- consultoria para condomínios;
- laudos;
- projetos;
- obras;
- tecnologia;
- medição;
- automações;
- pós-venda técnico.

A consultoria é produto de entrada e diagnóstico.

As obras são frequentemente pós-venda e expansão de receita na base.

## Filosofia de análise

Sempre aplique:

- Teoria das Restrições;
- Throughput;
- Inventory;
- Operating Expense;
- Drum-Buffer-Rope;
- capacidade;
- lead time;
- disponibilidade;
- WIP;
- estoques invisíveis;
- custo de oportunidade;
- priorização por impacto sistêmico.

## Regras de resposta

Nunca analise apenas um indicador isolado.

Sempre diferencie:

- sintoma;
- causa provável;
- causa-raiz;
- restrição;
- indicador;
- plano de ação.

Não recomende contratação antes de avaliar se a restrição foi explorada.

Não recomende aumentar leads se a capacidade comercial está saturada.

Não recomende vender mais obras se a capacidade de execução não suporta.

Não trate queda de conversão como piora comercial sem separar as etapas do funil.

A conversão real de venda deve ser calculada como:

```text
Contratos fechados / Propostas apresentadas
```

A queda da conversão geral pode indicar propostas paradas antes da apresentação.

## Perguntas obrigatórias ao analisar qualquer problema

1. Qual é o impacto no Throughput?
2. Isso aumenta Inventory?
3. Isso aumenta Lead Time?
4. Qual recurso crítico está sendo consumido?
5. Existe fila?
6. Existe retrabalho?
7. Existe capacidade disponível?
8. O problema é interno ou externo?
9. É gargalo real, sintoma ou causa?
10. Qual ação teria maior impacto sistêmico?

## Quando analisar Comercial

Olhar para:

- propostas paradas;
- propostas apresentadas;
- tempo comercial nobre;
- follow-up;
- capacidade de apresentação;
- assembleias;
- receita por vendedor;
- conversão por etapa;
- oportunidades sem próximo passo.

Sempre separar:

- oportunidade → visita;
- visita → proposta pronta;
- proposta pronta → apresentação;
- apresentação → fechamento.

## Quando analisar Consultoria

Olhar para:

- fila de laudos;
- fila de projetos;
- revisão;
- retrabalho;
- dados de campo;
- tempo de especialista;
- apresentação de entregáveis;
- oportunidades de pós-venda.

## Quando analisar Obras

Olhar para:

- escopo fechado;
- material;
- equipe;
- dias úteis;
- chuva;
- feriados;
- acesso;
- aditivos;
- material faltante;
- margem;
- retrabalho físico.

Obra deve ser tratada como processo físico pouco flexível.

## Quando analisar Operações

Olhar para:

- coleta de campo;
- checklists;
- app;
- ferramentas;
- adoção do time;
- dados completos;
- retrabalho por falta de informação.

## Quando analisar metas

Traduzir meta financeira em capacidade.

Sempre calcular:

- vendas necessárias;
- propostas necessárias;
- apresentações necessárias;
- visitas necessárias;
- consultorias necessárias;
- obras necessárias;
- capacidade necessária;
- restrição provável.

## Formato ideal de resposta

1. Diagnóstico.
2. Evidências.
3. Restrição provável.
4. Indicadores para confirmar.
5. Plano de ação.
6. Riscos.
7. Próxima decisão.
8. O que medir na próxima semana.

## Frase-guia

A XPE deve aumentar Throughput reduzindo Inventory, protegendo recursos críticos e elevando capacidade organizacional.

---

# FILE: 11_prompt_analise_dados.md

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

---

# FILE: 12_boletim_semanal_template.md

# Template — Boletim Semanal XPE

## Semana

Período:

Responsável:

Data de emissão:

---

# 1. Resumo Executivo

## Principal conclusão da semana

Texto curto.

## Principal restrição da semana

- Restrição:
- Área:
- Evidência:
- Indicador:
- Impacto:
- Ação:

## Risco principal

- Risco:
- Área:
- Probabilidade:
- Impacto:
- Ação preventiva:

---

# 2. Faturamento e Meta

- Faturamento da semana:
- Faturamento acumulado do mês:
- Meta mensal:
- % da meta:
- Forecast:
- Pipeline ponderado:

Comentário:

---

# 3. Funil Comercial

| Etapa | Quantidade | Variação | Observação |
|---|---:|---:|---|
| Leads | | | |
| Visitas | | | |
| Diagnósticos | | | |
| Propostas prontas | | | |
| Propostas apresentadas | | | |
| Assembleias | | | |
| Fechamentos | | | |
| Perdas | | | |

## Conversões

- Lead → Visita:
- Visita → Proposta pronta:
- Proposta pronta → Apresentação:
- Apresentação → Fechamento:
- Assembleia → Fechamento:

## Propostas paradas

- Total:
- Mais antigas:
- Responsável:
- Ação:

---

# 4. Capacidade Comercial

| Vendedor | Apresentações | Assembleias | Negociações | Receita | Tempo Nobre | Observação |
|---|---:|---:|---:|---:|---:|---|
| | | | | | | |

Comentários:

---

# 5. Consultoria

| Indicador | Valor | Observação |
|---|---:|---|
| Laudos em andamento | | |
| Laudos entregues | | |
| Projetos em andamento | | |
| Projetos entregues | | |
| Fila de revisão | | |
| Retrabalho | | |
| Entregáveis apresentados | | |
| Oportunidades geradas | | |

## Tempo do especialista

- Horas em revisão:
- Horas em correção operacional:
- Pendências aguardando:
- Principal causa de retrabalho:

---

# 6. Pós-venda

- Clientes com entregáveis apresentados:
- Oportunidades mapeadas:
- Propostas de obras geradas:
- Receita potencial:
- Receita fechada:
- Clientes sem follow-up:

---

# 7. Obras

| Indicador | Valor | Observação |
|---|---:|---|
| Obras em execução | | |
| Obras aguardando escopo | | |
| Obras aguardando material | | |
| Obras concluídas | | |
| Dias úteis disponíveis | | |
| Dias perdidos por chuva | | |
| Dias perdidos por material | | |
| Alterações de escopo | | |
| Aditivos emitidos | | |

---

# 8. Operações e Campo

- Coletas realizadas:
- Coletas completas:
- Coletas incompletas:
- Retornos a campo:
- Pendências de informação:
- Uso de checklists:
- Uso do app:

---

# 9. Estoques Invisíveis

| Estoque | Área | Quantidade | Impacto | Responsável | Ação |
|---|---|---:|---|---|---|
| | | | | | |

---

# 10. Planos de Ação

| Ação | Gargalo | Responsável | Prazo | Status | Impacto esperado |
|---|---|---|---|---|---|
| | | | | | |

---

# 11. Decisões Necessárias

1.
2.
3.

---

# 12. Perguntas para IA

1. Qual gargalo mais limita o Throughput esta semana?
2. O volume comercial está compatível com capacidade de apresentação?
3. A consultoria está gerando oportunidades para obras?
4. Obras estão dentro da capacidade real?
5. Qual estoque invisível deve ser atacado primeiro?
6. Qual ação tem maior impacto sistêmico?

---

# FILE: 13_roadmap_plataforma.md

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

---

# FILE: 14_user_stories_backlog.md

# Backlog e User Stories da Plataforma XPE

## Epic 1 — Dashboard Executivo

### US-001

Como diretor, quero ver o faturamento do mês, meta e forecast para saber se estamos no caminho certo.

Critérios:

- mostra faturamento acumulado;
- mostra meta;
- mostra % da meta;
- mostra forecast;
- atualiza por período.

### US-002

Como diretor, quero ver a principal restrição da semana para focar a gestão no ponto correto.

Critérios:

- restrição cadastrada;
- evidência associada;
- indicador associado;
- ação associada.

### US-003

Como diretor, quero ver o principal risco da semana para antecipar problemas.

## Epic 2 — Gargalos

### US-010

Como gestor, quero cadastrar gargalos por área.

Campos:

- nome;
- área;
- tipo;
- descrição;
- indicador;
- severidade;
- status.

### US-011

Como gestor, quero registrar avaliação semanal de um gargalo.

Campos:

- capacidade;
- demanda;
- fila;
- lead time;
- disponibilidade;
- retrabalho;
- impacto.

### US-012

Como gestor, quero ver histórico de gargalos.

## Epic 3 — Indicadores

### US-020

Como gestor, quero cadastrar indicadores.

### US-021

Como gestor, quero lançar valores semanais.

### US-022

Como gestor, quero ver gráficos históricos.

### US-023

Como IA, quero acessar indicadores para gerar análise.

## Epic 4 — Funil Comercial

### US-030

Como vendedor, quero cadastrar oportunidade comercial.

### US-031

Como gestor comercial, quero visualizar funil por etapa.

### US-032

Como gestor comercial, quero ver propostas paradas.

### US-033

Como vendedor, quero registrar apresentação e assembleia.

### US-034

Como diretor, quero ver conversão por etapa.

Importante:

A plataforma deve diferenciar:

- conversão oportunidade → contrato;
- conversão proposta apresentada → contrato.

## Epic 5 — Tempo Comercial Nobre

### US-040

Como vendedor, quero registrar atividades da agenda.

### US-041

Como gestor, quero ver tempo comercial nobre por vendedor.

### US-042

Como diretor, quero ver receita por hora comercial nobre.

## Epic 6 — Consultoria

### US-050

Como gestor técnico, quero cadastrar laudos e projetos.

### US-051

Como gestor técnico, quero ver fila de revisão.

### US-052

Como revisor, quero registrar retrabalho.

### US-053

Como gestor, quero ver entregáveis ainda não apresentados.

## Epic 7 — Pós-venda

### US-060

Como gestor, quero mapear oportunidades por cliente da base.

### US-061

Como comercial, quero criar proposta de pós-venda.

### US-062

Como diretor, quero ver conversão consultoria → obra.

## Epic 8 — Obras

### US-070

Como gestor de obras, quero cadastrar obras.

### US-071

Como gestor de obras, quero cadastrar escopo fechado.

### US-072

Como gestor de obras, quero registrar alteração de escopo.

### US-073

Como gestor, quero registrar material faltante e excedente.

### US-074

Como gestor, quero registrar dias perdidos por chuva, feriado, acesso ou material.

## Epic 9 — Operações de Campo

### US-080

Como técnico, quero registrar coleta de campo.

### US-081

Como gestor, quero ver coletas incompletas.

### US-082

Como gestor, quero ver retornos a campo.

## Epic 10 — Estoques Invisíveis

### US-090

Como gestor, quero cadastrar estoque invisível.

### US-091

Como diretor, quero ver ranking de estoques invisíveis.

### US-092

Como gestor, quero associar estoque invisível a plano de ação.

## Epic 11 — Planos de Ação

### US-100

Como gestor, quero criar plano de ação.

### US-101

Como diretor, quero acompanhar status.

### US-102

Como IA, quero sugerir plano de ação baseado nos gargalos.

## Epic 12 — Boletim Semanal

### US-110

Como diretor, quero gerar boletim semanal.

### US-111

Como IA, quero gerar resumo executivo automático.

### US-112

Como gestor, quero revisar e publicar boletim.

## Epic 13 — IA

### US-120

Como usuário, quero conversar com a IA sobre dados da empresa.

### US-121

Como diretor, quero perguntar se a meta é factível.

### US-122

Como gestor, quero pedir análise de um gargalo.

### US-123

Como diretor, quero simular contratação ou automação.

### US-124

Como gestor, quero receber sugestões de indicadores faltantes.

## Epic 14 — Simulador de Capacidade

### US-130

Como diretor, quero inserir uma meta de faturamento e ver capacidade necessária.

### US-131

Como diretor, quero simular conversão, ticket e volume.

### US-132

Como diretor, quero identificar qual gargalo impede a meta.

### US-133

Como diretor, quero comparar cenários.

## Prioridade sugerida

### Prioridade A

- Dashboard executivo;
- Indicadores;
- Gargalos;
- Planos de ação;
- Boletim semanal.

### Prioridade B

- Funil comercial;
- Propostas paradas;
- Tempo comercial nobre.

### Prioridade C

- Consultoria;
- Pós-venda;
- Obras;
- Campo.

### Prioridade D

- IA;
- simulador;
- integrações.

---

# FILE: 15_current_reality_tree_xpe.md

# Current Reality Tree — XPE

## Objetivo

Mapear causas e efeitos que geram os principais sintomas atuais da XPE.

## Sintomas observados

- propostas paradas;
- clientes sem apresentação;
- queda aparente da conversão geral;
- vendedores com mais tempo em visitas do que apresentações;
- projetos acumulados;
- laudos acumulados;
- revisão tardia;
- Jonildo corrigindo tarefas operacionais;
- dados de campo incompletos;
- obras com escopo alterado;
- material faltante;
- obras afetadas por chuva e feriados;
- pós-venda não totalmente explorado;
- conhecimento concentrado em pessoas;
- ferramentas nem sempre utilizadas.

## Cadeia 1 — Comercial

```text
Crescimento de volume
↓
mais visitas e diagnósticos
↓
vendedor dedica menos tempo a apresentações e follow-up
↓
propostas ficam paradas
↓
conversão geral parece cair
↓
faturamento potencial fica represado
```

Causa sistêmica provável:

- capacidade de apresentação e follow-up não acompanhou o aumento de visitas.

Ação:

- liberar tempo comercial nobre;
- automatizar propostas;
- delegar coleta;
- criar cadência.

## Cadeia 2 — Propostas

```text
proposta ainda depende de esforço manual
↓
tempo entre diagnóstico e proposta aumenta
↓
proposta demora a ficar pronta
↓
apresentação demora a ser marcada
↓
cliente esfria
↓
Throughput cai
```

Ação:

- automação de proposta PDF;
- automação PowerPoint;
- biblioteca de escopos;
- CRM com próximo passo.

## Cadeia 3 — Revisão técnica

```text
dados ou projeto chegam incompletos
↓
revisão encontra erro tarde
↓
não há tempo para devolver ao estagiário
↓
especialista corrige diretamente
↓
estagiário aprende menos
↓
dependência do especialista aumenta
↓
capacidade futura não cresce
```

Ação:

- checklist;
- revisão intermediária;
- treinamento;
- biblioteca de erros.

## Cadeia 4 — Campo

```text
coleta de campo incompleta
↓
projeto assume hipóteses
↓
revisão identifica falta
↓
retrabalho
↓
prazo aperta
↓
entrega vira urgência
```

Ação:

- app de campo;
- checklist;
- validação de completude;
- indicador de qualidade da coleta.

## Cadeia 5 — Obras / escopo

```text
assembleia altera detalhe do escopo
↓
alteração não é formalizada
↓
material e prazo mudam
↓
equipe executa com ambiguidade
↓
custo extra
↓
margem cai
↓
cliente e equipe se frustram
```

Ação:

- regra de aditivo;
- escopo fechado;
- critérios de aceite;
- controle de mudança.

## Cadeia 6 — Obras / tempo útil

```text
planejamento considera capacidade teórica
↓
chuva/feriado/material/acesso reduzem capacidade real
↓
obra atrasa
↓
fila de obras aumenta
↓
pós-venda é prejudicado
↓
Throughput atrasa
```

Ação:

- capacidade efetiva;
- buffers;
- planejamento por dias úteis;
- registro de perdas.

## Cadeia 7 — Pós-venda

```text
consultoria entrega diagnóstico
↓
entregável não é apresentado ou não gera plano
↓
oportunidade de obra não entra no funil
↓
base não é explorada
↓
empresa depende mais de novos leads
```

Ação:

- reunião de devolutiva;
- funil da base;
- oportunidades por cliente;
- follow-up técnico.

## Causa fundamental

A XPE está crescendo mais rápido do que seus sistemas de capacidade, acompanhamento e padronização.

O problema não é falta de competência.

O problema é que parte do conhecimento, da priorização e da gestão ainda depende de esforço humano e percepção.

## Direção de solução

Transformar conhecimento e rotina em sistema:

```text
experiência individual
↓
processo
↓
checklist
↓
dados
↓
automação
↓
IA
↓
capacidade organizacional
```

---

# FILE: 16_drum_buffer_rope_xpe.md

# Drum-Buffer-Rope XPE

## Objetivo

Sincronizar a empresa de acordo com seus recursos restritivos.

## Conceitos

### Drum

Recurso que dita o ritmo.

### Buffer

Proteção antes do recurso.

### Rope

Limite que impede entrada excessiva de trabalho.

## Drums possíveis da XPE

### Drum Comercial

- apresentações;
- assembleias;
- agenda do vendedor;
- tempo comercial nobre.

Quando este é o Drum:

- não aumentar visitas sem capacidade de apresentação;
- priorizar propostas paradas;
- proteger agenda do vendedor;
- automatizar proposta;
- criar follow-up.

### Drum Consultoria

- revisão técnica;
- tempo do especialista;
- capacidade de laudos/projetos.

Quando este é o Drum:

- limitar entrada de novos projetos;
- garantir checklist;
- revisar cedo;
- formar equipe;
- reduzir retrabalho.

### Drum Obras

- equipe de execução;
- dias úteis;
- clima;
- material;
- acesso.

Quando este é o Drum:

- não vender acima da capacidade;
- garantir escopo;
- conferir material;
- planejar buffer;
- considerar chuva/feriados.

### Drum Externo

- assembleias;
- aprovações externas;
- agenda de cliente;
- concessionária;
- prefeitura/bombeiros quando aplicável.

Quando este é o Drum:

- antecipar documentos;
- manter follow-up;
- criar buffer;
- não deixar pendência interna atrasar evento externo.

## Buffers da XPE

### Buffer antes da assembleia

- proposta pronta;
- apresentação pronta;
- cenários;
- orçamento complementar;
- objeções;
- próximos passos.

### Buffer antes da revisão

- checklist;
- dados de campo completos;
- memorial;
- cálculos;
- versão preliminar.

### Buffer antes da obra

- escopo fechado;
- material conferido;
- acesso confirmado;
- equipe definida;
- segurança;
- plano B.

## Ropes da XPE

### Rope comercial

Não gerar mais visitas do que a capacidade de proposta/apresentação/follow-up consegue absorver.

### Rope consultoria

Não iniciar mais projetos do que a revisão consegue validar.

### Rope obras

Não fechar mais obras do que a equipe consegue executar com qualidade.

### Rope tecnologia

Não abrir mais automações do que o time consegue terminar.

## Indicadores DBR

- Drum atual;
- fila antes do Drum;
- consumo do Buffer;
- violações da Rope;
- lead time;
- capacidade;
- demanda;
- disponibilidade.

## Reunião semanal DBR

Perguntas:

1. Qual é o Drum da semana?
2. O Buffer está protegido?
3. Alguma Rope foi rompida?
4. Onde está a maior fila?
5. Qual ação protege ou eleva o Drum?
6. Qual será o próximo Drum?

---

# FILE: 17_throughput_accounting_xpe.md

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

---

# FILE: 18_agentes_ia.md

# Agentes de IA da Plataforma XPE

## Objetivo

Definir agentes especializados para análise e apoio à gestão.

## Agente 1 — Diretor TOC

Função:

- analisar restrições;
- priorizar gargalos;
- avaliar Throughput;
- sugerir foco semanal.

Perguntas que responde:

- Qual é a principal restrição?
- Qual gargalo devemos atacar?
- A meta é factível?
- Qual ação gera mais impacto?

## Agente 2 — Analista Comercial

Função:

- analisar funil;
- propostas paradas;
- conversão por etapa;
- tempo comercial nobre;
- assembleias;
- follow-up.

Perguntas:

- A conversão caiu mesmo?
- Onde o funil está parando?
- Qual vendedor está saturado?
- Quantas apresentações faltam?
- Quais propostas devem ser priorizadas?

## Agente 3 — Analista de Consultoria

Função:

- analisar laudos e projetos;
- revisão;
- retrabalho;
- tempo do especialista;
- entregáveis;
- pós-venda.

Perguntas:

- O que está travando consultoria?
- Jonildo está sendo usado corretamente?
- Qual retrabalho mais aparece?
- Quais entregas precisam de devolutiva?

## Agente 4 — Analista de Obras

Função:

- analisar obras;
- escopo;
- material;
- dias úteis;
- chuva;
- equipe;
- aditivos.

Perguntas:

- A obra está pronta para executar?
- Qual obra está em risco?
- O escopo está fechado?
- Qual material falta?
- A capacidade suporta novas obras?

## Agente 5 — Analista de Operações

Função:

- analisar coleta de campo;
- ferramentas;
- checklists;
- dados incompletos;
- adoção.

Perguntas:

- Qual coleta gerou retrabalho?
- Quais dados faltam?
- O time está usando as ferramentas?
- Onde a informação se perde?

## Agente 6 — Planejador Estratégico

Função:

- simular metas;
- criar cenários;
- confrontar capacidade;
- sugerir plano de crescimento.

Perguntas:

- Como atingir R$ X?
- Quantas propostas preciso?
- Quantas apresentações?
- Quantas obras?
- Qual restrição impede a meta?

## Agente 7 — Gerador de Boletim

Função:

- consolidar dados semanais;
- gerar resumo executivo;
- listar gargalos;
- listar ações.

Formato:

- resumo;
- restrição;
- indicadores;
- riscos;
- planos;
- decisões.

## Agente 8 — Arquiteto de Processos

Função:

- transformar gargalos em processos;
- sugerir checklists;
- sugerir automações;
- sugerir estrutura no ClickUp/n8n.

Perguntas:

- Como padronizar este processo?
- O que automatizar?
- O que delegar?
- Como reduzir retrabalho?

## Estrutura de prompt para qualquer agente

Sempre incluir:

- contexto da área;
- dados disponíveis;
- indicadores;
- gargalos conhecidos;
- pergunta do usuário;
- formato de resposta esperado;
- limitações dos dados.

## Regras para agentes

1. Não inventar dados.
2. Declarar incerteza.
3. Pedir dados faltantes.
4. Separar sintoma e causa.
5. Sugerir indicadores.
6. Recomendar próxima ação.
7. Conectar com Throughput.
8. Considerar capacidade e lead time.

---

# FILE: 19_estrutura_arquivos_recomendada.md

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

---

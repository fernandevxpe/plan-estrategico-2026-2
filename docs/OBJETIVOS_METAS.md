# Objetivos e metas — para que esta plataforma existe

Este documento guarda o **porquê**. `CONTINUACAO.md` guarda o *como* e o *onde*;
aqui ficam as perguntas que a plataforma tem de responder e os números que
definem "pronto".

Quem continuar o trabalho deve poder decidir sozinho se uma tarefa vale a pena,
e a régua é esta: **a tarefa aproxima o Fernando de responder alguma das
perguntas da seção 2?** Se não aproxima, provavelmente não é prioridade, por mais
correta que seja tecnicamente.

---

## 1. O objetivo, nas palavras do Fernando

> *"Quero fazer uma reconstrução completa de tudo que estamos fazendo de gestão
> financeira. Quero rastreabilidade total de cada real: de onde veio, para onde
> foi, de qual contrato, para qual finalidade, sob responsabilidade de quem."*

Escopo declarado depois, e que vale: **"quero tudo organizado que conseguir
2026"**. O histórico anterior a 2026 está fora de escopo — existe na base, é
usado como evidência quando ajuda, mas não é meta de completude. O painel mede
2026 por padrão (`node scripts/painel-financeiro.mjs`); `--tudo` mede a base
inteira e serve para diagnóstico, não para cobrança.

### O princípio inegociável

**Caixa é a validação máxima.** Se o saldo calculado não bate com o saldo real da
conta, nada mais importa — nenhuma DRE, nenhuma projeção, nenhum indicador. Por
isso `painel-financeiro.mjs` abre com essa checagem, e qualquer trabalho que
quebre "6/6 contas fecham" está errado por definição.

### O segundo princípio

**Onde não houver evidência, o valor é indeterminado, com motivo — nunca um
número plausível.** Uma medida pode ser nula; nunca pode ser nula sem explicação.
A plataforma foi construída para não contar mentiras confortáveis, e a
consequência disso aparece nos indicadores: alguns caíram de propósito quando
paramos de chamar "não sei o que é" de "classificado".

---

## 2. As perguntas que a plataforma tem de responder

Esta é a lista de trabalho real. Cada uma veio do Fernando, e ao lado está onde
ela é respondida hoje.

### Sobre o dinheiro que entrou e saiu

| pergunta | onde se responde | estado |
|---|---|---|
| Quanto tenho, agora, conta a conta? | `painel-financeiro.mjs`, `fin_account` | ✅ 6/6 fecham |
| De onde veio cada real e para onde foi? | `fin_transaction` + lastro | ✅ 99,1% com lastro |
| De qual contrato, e para qual finalidade? | `fin_contract`, `fin_category`, núcleo | ⚠️ núcleo 90,6% |
| Sob responsabilidade de quem? | contraparte + pessoa | ✅ 98,5% |
| Qual receita por cliente e por tipo de serviço? | `fin_receita_prioridade_v`, `fin_receita_por_grupo_v` | ⚠️ 45 assinaturas sem serviço declarado |
| Qual custo por obra e por projeto? | `fin_obra_margem_v`, `fin_projeto_margem_v` | ❌ centro de custo 1,1% — teto de fonte |

### Sobre o que vai acontecer

| pergunta | onde se responde | estado |
|---|---|---|
| Quanto entra nos próximos 90 dias, e com que grau de certeza? | `fin_previsao_recebimento_v`, 5 camadas | ✅ |
| Quanto sai? | `fin_previsao_saida_v` (0079) | ⚠️ cobre 71,7% do real |
| Em que dia o caixa aperta? | `fin_caixa_previsto_dia_v` | ⚠️ inútil enquanto a reserva tiver alvo sem saldo (dúvida 32) |
| O que já está fechado e vai virar dinheiro? | camadas `cobranca_emitida` / `assinatura` / `parcelamento` | ✅ |
| O que foi vendido no Pipedrive e ainda não virou cobrança? | `fin_pipeline_ganho` | ✅ — e **não entra na previsão**, por não ter data nem forma de pagamento |
| Quanto está atrasado a receber? | `fin_receber_aging_v`, camada `vencido_a_receber` | ✅ |

### Sobre o resultado

| pergunta | onde se responde | estado |
|---|---|---|
| Qual o resultado do mês? | `fin_dre_mensal_v` — **duas visões, caixa e competência** | ✅ 64 meses |
| O que a empresa tem e o que deve? | `fin_balanco_v` + `fin_balanco_lacuna_v` | ✅ R$ 0,00 não conciliado, 6 lacunas nomeadas |
| Previsto contra realizado | `fin_projetado_realizado_v` | ❌ compara contra planilha fantasma (ver §5 de CONTINUACAO.md) |
| Orçado contra realizado | `fin_orcado_realizado_v` | ❌ 75 linhas, todas com realizado nulo — as metas são 100% de obras |

### Sobre as pessoas

| pergunta | onde se responde | estado |
|---|---|---|
| Quanto custa a equipe, de verdade? | `fin_custo_pessoas_v`, `fin_folha_previsao_total_v` | ✅ R$ 90.186,85 previstos para setembro |
| Contratado bate com pago? | `fin_folha_divergencia_v` | ✅ — acréscimo mediano de R$ 22.299,24/mês, 27% do que sai |
| Os MEIs emitem nota? | — | ❌ não há repositório de documento de entrada |
| Quanto de comissão cada vendedor tem a receber? | `fin_comissao_prevista` | ⚠️ acerta o ano e a obra; erra o mês em 87,7% |

### Sobre obrigações e controle

| pergunta | onde se responde | estado |
|---|---|---|
| Quanto de imposto, e o cálculo está coerente? | `fin_apuracao_tributaria_v` | ⚠️ entrega o insumo e **declara que não calcula** |
| Simples, Presumido ou Real? | — | ❌ frente aberta (migration 0081) |
| Quanto de receita entrou sem nota? | monitor fiscal | ✅ |
| Que pagamentos estão para sair, e quem aprovou? | `fin_pagamento_fila_v` + 12 views | ⚠️ travado até definirem as alçadas (dúvida 27) |
| Posso confiar neste número? | matriz de cobertura de fontes | ❌ frente aberta (migration 0085) |

---

## 3. As metas numéricas

### Meta zero — a que vale mais que todas

```
6/6 contas fecham · divergência de saldo R$ 0,00
```

Não é uma meta de percentual. É binária, e é pré-requisito de tudo.

### Indicadores de 2026 — meta de 90%

Medido em 16/08/2026:

| indicador | hoje | meta | leitura |
|---|---|---|---|
| lastro de origem | **99,1%** | 90% | ✅ |
| categoria atribuída | **98,8%** | 90% | ✅ |
| contraparte identificada | **98,5%** | 90% | ✅ |
| transferência resolvida | **97,8%** | 90% | ✅ |
| revisão concluída | **91,4%** | 90% | ✅ — caiu de 98,8% de propósito |
| núcleo definido | **90,6%** | 90% | ✅ no limite |
| centro de custo (projeto) | **1,1%** | 90% | ❌ **teto de fonte** |

Sobre o centro de custo: **1,1% é o máximo alcançável neste ledger.**
`erp_extrato_linha` tem 861 linhas e 112 carimbadas com projeto, `erp_contrato`
não tem coluna de projeto, `fin_obra_apontamento` está vazia. Não existe segundo
caminho. Ou o Adryan carimba retroativamente no erp-obras (dúvida 19), ou este
indicador não sobe — e insistir nele por outro caminho significaria inventar
margem por obra a partir de palpite, que é pior que não ter.

### Invariantes e monitores

```
invariantes:  38 passam · 3 falham   (de 41)   → meta: 41
monitores:    13 na meta · 7 fora     (de 20)   → meta: 20
```

Os 3 invariantes que falham estão nomeados em `CONTINUACAO.md` §3. Dois são
trabalho (C3, J3); um é bloqueio de dado (F1).

### Metas de orçamento vindas do ERP

114 metas carregadas em `fin_budget_target`, somando **R$ 534.500** — e **100%
delas são de escopo `obras`**, cujo realizado mora no erp-obras. Para a XPE como
empresa não existe meta declarada, e por isso "orçamento disponível" devolve nulo
em todas as 75 linhas. Ver dúvida 30.

### Referência de resultado — os últimos meses medidos

Visão competência, de `fin_dre_mensal_v`:

| mês | receita líquida | margem de contribuição | pessoal | resultado |
|---|---|---|---|---|
| 03/26 | 238.864,85 | 225.416,04 | −94.680,38 | **+80.803,99** |
| 04/26 | 143.007,46 | 106.619,29 | −97.841,41 | **−17.744,92** |
| 05/26 | 125.524,40 | 117.873,75 | −82.400,95 | **−998,56** |
| 06/26 | 175.034,57 | 155.944,58 | −92.292,38 | **+43.321,71** |
| 07/26 | 211.401,33 | 196.984,40 | −106.500,23 | **+68.546,16** |

Agosto ainda não viu a folha dele — salário de agosto é pago em 01/09, e a view
marca isso em coluna própria (`folha_do_mes_ja_paga`). **O mês corrente na visão
competência é sempre otimista**, e a plataforma diz isso em vez de deixar o mês
parecer bom.

Referências operacionais para 2026:

```
receita 2026 (ledger) ........ R$ 1.350.225,21
RBT12 (ago/26) ............... R$ 1.849.940,08
folha 2026 (8 meses) ......... R$   699.466,10
imposto pago 2026 ............ R$   123.842,07  → carga implícita 9,17%
saída real, mediana mensal ... R$   152.271,84
```

---

## 4. Prioridades declaradas pelo Fernando

Na ordem em que ele as colocou:

1. **Rastreabilidade total de cada real.** É a base de tudo — sem ela, nenhum
   relatório é confiável.
2. **Bater com o previsto.** Comparar o que a planilha projeta com o que o ledger
   realizou. *(Hoje comprometida: a planilha de referência aponta para um arquivo
   que não existe mais.)*
3. **Ver as projeções por grupo, com detalhe dos principais.**
   > *"quero ver por grupo e todo detalhe dos principais, facilitando saber quais
   > receitas são importantes não deixar de receber do mês"*

   Respondido pela curva ABC em `fin_receita_prioridade_v`: faixa A é o que, se
   falhar, o mês sente. Uma lista de 255 cobranças ordenada por valor não responde
   essa pergunta; a concentração responde.
4. **Automação de pagamento com aprovação humana.** Preparar, aprovar, agrupar e
   auditar — nunca executar.
5. **App web para o time**, com o financeiro restrito ao admin.

### Regras de negócio que ele declarou, e que valem como lei

**Pró-labore.** *"na prática é salário, mas contabilmente é pró-labore para
reduzir impostos."* Existem dois eixos — o fiscal e o gerencial — e eles não se
misturam.

**A conta Caixa.** *"conta bancária, única e exclusiva para pagar o empréstimo...
Pronampe."* Não é caixa operacional.

**Custo comum: não ratear.** Decisão dele, escolhendo margem de contribuição em
vez de lucro por obra. Ratear inventaria precisão.

**A BRA (cadastrada como PIAU) prevê pelo mês anterior.**
> *"é um parceiro que paga recorrente mas o valor médio pode considerar a
> previsão dos próximos meses igual a do mês anterior"*

Para receita que varia com volume, o mês passado prevê melhor que a média de dois
anos — a média suaviza justamente a informação nova. A projeção estava em
R$ 20.850,40 pela mediana de 32 meses, e nenhum dos oito meses recentes chegou
perto disso.

**Recorrente e parcelado são coisas diferentes.**
> *"recorrente? ou parcelado? sao diferentes, no asaas da pra saber"*

Esta frase dele corrigiu o erro mais caro do projeto. Ver `CONTINUACAO.md` §4.

**Cliente que paga há mais de 12 meses sem contrato formal é ativo de fato.**
Camada própria na previsão, com confiança menor que assinatura declarada.

**Comissão de obras começa a partir da segunda parcela; consultoria é mais
rápida.** Medido: 3 de 6 contratos obedecem. O gatilho real é outro — 6 das 10
datas de pagamento caem entre o dia 1 e o 6, ou seja, **a comissão sai no lote
mensal da folha**. A segunda parcela é consequência do prazo, não causa.

---

## 5. A definição de pronto

`docs/PROMPT_CONCLUSAO_BASE.md` tem 26 critérios. Auditados em 16/08/2026:

```
✅  8 cumpridos
⚠️  7 parciais
❌  9 não cumpridos
🔄  2 em voo
```

O veredito que a frente de auditoria final terá de assinar, com estas palavras:

> *"Se ainda faltar qualquer regra de negócio, ingestão, conciliação, modelo,
> teste, API ou dado alcançável pelas fontes existentes, não dizer que falta
> apenas design."*

**Hoje não falta apenas design.** Faltam 9 critérios com trabalho alcançável
pelas fontes existentes. Os seis maiores estão com frente aberta ou proposta em
`CONTINUACAO.md` §7.

---

## 6. Como saber se uma tarefa nova vale a pena

Quatro perguntas, nesta ordem:

1. **Ela aproxima de responder alguma pergunta da seção 2?** Se não, pare.
2. **O que o indicador que ela melhora NÃO mede?** Os dois maiores buracos
   encontrados — R$ 194 mil de cartão sem categoria e a planilha fantasma —
   moravam exatamente do lado de fora do indicador que a frente vizinha estava
   otimizando.
3. **A evidência existe?** Se a resposta depende de dado que não está em nenhuma
   fonte, o entregável é uma pergunta em `DUVIDAS_FINANCEIRO.md` com o valor em
   jogo — não um número estimado.
4. **O caixa continua fechando depois?** Se não, o trabalho está errado.

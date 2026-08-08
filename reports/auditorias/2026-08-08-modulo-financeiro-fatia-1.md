---
title: Módulo financeiro — fundação e primeira fatia sobre o Asaas
date: 2026-08-08
author: Claude Opus 5
kind: infraestrutura
scope: Financeiro · Ledger · Classificação · Conciliação
summary: O financeiro saiu da planilha e entrou na plataforma. Cinco anos de extrato do Asaas viraram um ledger que reconstrói o saldo do banco ao centavo, com receita conferida contra a API em duas visões e classificação automática de 80% do dinheiro. O Índice de Confiabilidade marca 49% — e é ele que mede o que falta.
highlights:
  - "Ledger reconstrói o saldo do Asaas ao centavo: R$ 49.826,06, divergência zero"
  - "372 transferências internas (R$ 3,82 mi) neutralizadas — sem isso a receita contaria em dobro"
  - "3.483 notas fiscais em tabela separada: juntas às cobranças, dobrariam a receita"
  - "Uma regra de 'medição' capturou 276 transferências porque a razão social contém MEDICAO"
  - "Data de pagamento ≠ data de crédito em 864 das 3.023 cobranças — as duas visões são testadas"
  - "Importação caiu de ~50 min para 65 s ao trocar 19 mil INSERTs por lotes"
  - "57 cadastros do Asaas eram 24 clientes repetidos; unificados por CNPJ"
  - "Índice de Confiabilidade em 49%: cobertura de contas 20%, planejamento 0%"
---

# Módulo financeiro — fundação e primeira fatia

## Por que existe

O financeiro da XPE vivia numa planilha que juntava extratos de cinco bancos,
oito categorias preenchidas à mão, comissões e reembolsos. A rotina começava
todo dia com atualização manual de extrato, e o resultado era um dado que
ninguém confiava o bastante para decidir.

Enquanto isso a empresa quase dobrou: R$ 1,18 mi recebidos em 2025 contra
R$ 1,35 mi só em jan–jul/26. Crescer nesse ritmo com visibilidade de planilha
era o risco real.

## O que foi entregue

A primeira fatia vertical: da API do Asaas até a tela, passando por migrations,
ledger, classificação e conciliação. Escolhida por ser a única fonte que
funciona **sem ninguém baixar arquivo** — e por ter um teste de aceite que já
existia antes do código, conferido direto na API.

| | |
|---|---|
| Cobranças | 3.350 |
| Notas fiscais (NFS-e) | 3.483 |
| Lançamentos de extrato | 12.181, desde maio/2021 |
| Liquidações automáticas | 3.023, pelo `paymentId` |
| Clientes | 344 cadastros → 311 contrapartes |
| Tempo de importação | 65 segundos |
| Verificações no teste de aceite | 20, todas passando |

## Como se sabe que o número está certo

A partida simples não dá balancete. O substituto é mais direto e mais honesto:
**o ledger reconstrói o saldo de fechamento do banco**. Somadas as 12.181
linhas, o resultado é R$ 49.826,06 — exatamente o que a API do Asaas informa,
divergência zero. Se faltasse ou sobrasse um lançamento, não fecharia.

A receita é conferida em duas visões, porque são perguntas diferentes e as duas
são legítimas:

- **por data de pagamento** — quando o cliente pagou, que é o que o painel do
  Asaas mostra: jul/26 R$ 240.905,95 · 2025 R$ 1.183.702,27 · 2026 jan–jul
  R$ 1.350.733,02;
- **por data de crédito** — quando o dinheiro ficou disponível: jul/26
  R$ 227.464,51.

A diferença não é erro: **864 das 3.023 cobranças** têm as duas datas
diferentes, porque boleto pago na sexta cai na conta na segunda. Um único boleto
de R$ 4.941,44 sai de julho e entra em agosto entre uma visão e outra. Testar as
duas é o que impede alguém de "corrigir" uma para bater com a outra.

## Armadilhas encontradas no dado real

**Uma regra de medição capturou 276 transferências.** A descrição do extrato é
`"Transação via Pix para XP ENERGY SERVICOS DE MEDICAO DE ENERGIA"` — a regra
casou com a própria razão social da empresa. A causa raiz não era a palavra, era
a ordem: fatos estruturais (o tipo que o banco carimba) estavam classificados
*depois* das regras de texto. Fato sempre vence texto. Sem a correção, R$ 3,82
milhões de transferência interna entrariam como receita de medição.

**As notas fiscais dobrariam o faturamento.** São 3.483, com 99,6% apontando
para uma cobrança, somando R$ 4,2 mi. Numa tabela só com as 3.350 cobranças,
`SUM(...) WHERE direction='receber'` devolveria quase o dobro — e a suspeita
cairia sobre a neutralização de transferências, que estaria correta.

**"Comissionamento" não é "comissão".** Um *laudo de comissionamento* é inspeção
técnica; "Comissionamento de vendas referente ao mês de X" é a comissão que a
PIAU paga — R$ 700 mil, 20% da receita da empresa. Mesmo radical, categorias
opostas.

**Parcela de equipamento não é receita.** "Compra da Impressora 3D 4/12" chega
como cobrança do Asaas porque foi assim que se cobrou o colaborador. Lançada
como receita, infla o faturamento *e* a base do Simples Nacional.

**46 cobranças pareciam calote e não eram.** Recebidas fora do Asaas, em
dinheiro ou transferência direta: R$ 125 mil que não geram lançamento neste
extrato e por isso ficavam sem liquidação.

**24 CNPJs estavam duplicados** em 57 cadastros — "EDMAR VICTOR LTDA" aparece
seis vezes. Unificados, porque o histórico da contraparte é o sinal mais forte
de classificação e se dilui quando fica repartido.

## O Índice de Confiabilidade

Quatro componentes, medidos em reais e não em número de linhas, no topo da tela:

| Componente | Hoje | Meta |
|---|---|---|
| Cobertura de contas | 20% | 100% |
| Classificação | 80% | 98% |
| Conciliação | 97% | 95% |
| Planejamento | 0% | 90% |
| **Composto** | **49%** | **95%** |

Os 49% são o número honesto: só uma das cinco contas tem extrato, e nenhuma
saída é planejada. Enquanto o composto não passa de 95%, todo relatório derivado
sai marcado como cobertura parcial — porque número financeiro incompleto
apresentado como completo é pior que número nenhum.

## O que este módulo ainda NÃO faz

**O Asaas entrega 100% da receita e 0% da despesa.** Entram ~R$ 193 mil/mês e
saem R$ 130–250 mil/mês para os outros bancos, onde todo o custo acontece.
Qualquer leitura de lucro nesta tela está incompleta por construção, e a tela
diz isso em vez de esconder.

Por isso a Fatia 2 é o lado da despesa: importação de extrato de Nubank, Inter e
Caixa, catálogo de recorrentes, cadastro de favorecidos e fila de revisão. É lá
que a cobertura de contas sai de 20%.

## Riscos registrados

- **Backup existe, restauração nunca foi testada.** O `db-backup.mjs` grava
  NDJSON comprimido em `xpe_artifacts` e falha se alguém criar tabela `fin_*` e
  esquecer de incluí-la. Falta um teste de restauração de verdade antes da
  primeira migration destrutiva.
- **A senha da plataforma é compartilhada.** Quando folha e reembolsos entrarem,
  ficam visíveis a todos que têm a senha, e `fin_audit_log.actor` é chute — o
  que também é o que bloqueia automação de pagamento.
- **`FINANCE_DATABASE_URL` precisa ser definida nos dois ambientes.** Sem ela o
  módulo herda `DATABASE_URL`, que tem valor diferente em cada um: a importação
  gravaria num banco e a tela leria de outro, sem erro nenhum.
- **As três etapas financeiras no agendador são `required: false`** — falha ali
  não pode derrubar o painel comercial. Vira `required: true` quando o módulo
  estiver em uso diário.

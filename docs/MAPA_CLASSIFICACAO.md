# Mapa de classificação de custos e despesas

Levantado em **21/08/2026** contra o ledger (`FINANCE_DATABASE_URL`), a planilha
"Revisão - Gestão & Finanças - XPE 2026.xlsx" e a base estratégica. Todo número
aqui foi medido, não estimado. Releia antes de criar categoria — metade do que
parece faltar já existe com outro nome, e metade do que falta não é categoria.

---

## 1. O erro que este mapa existe para desfazer

A planilha de fluxo de caixa tem uma linha de custo chamada **"Cartão de
Crédito", R$ 12.331 em janeiro**. E tem outra chamada **"Alimentação,
Transporte e Reembolsos"**.

Nenhuma das duas é uma natureza de gasto. A primeira é um *meio de pagamento*;
a segunda mistura natureza com *forma de liquidação*. É por isso que hoje não
se responde "quanto gastamos com alimentação de obras": o dado existe, mas está
picado entre eixos diferentes, e um lançamento só pode morar em uma linha.

Toda vez que uma pergunta nova aparece, a tentação é criar uma linha nova. Foi
assim que a planilha chegou onde chegou. **A saída não é mais categoria — é
separar os eixos.**

---

## 2. Os quatro eixos

Um gasto responde quatro perguntas independentes. Elas não se substituem, e
nenhuma delas deve ser codificada dentro de outra.

| Eixo | Pergunta | Onde mora | Estado |
|---|---|---|---|
| **NATUREZA** | o que foi comprado? | `fin_category` | **56 categorias, saudável** |
| **DESTINO** | para quem/para o quê? | `fin_nucleo` → `fin_cost_center` → `fin_product_line` | **quase vazio** |
| **LIQUIDAÇÃO** | como foi pago? | `fin_card_transaction` × `fin_transaction` | **existe, sem vocabulário próprio** |
| **AUTORIA** | quem registrou, quando, com que prova? | `fin_time_envio`, `fin_person`, `fin_anexo_blob` | **construído, nunca usado** |

### 2.1 NATUREZA — `fin_category`

56 categorias em 7 famílias. A hierarquia é **convenção do prefixo do código**,
não dado: `parent_id` existe e está nulo nas 56.

```
3 · RECEITA                  16 categorias
4 · CUSTO TOTALMENTE VARIÁVEL 5 categorias   ← 4.05 tarifas = 8.875 lançamentos (64% do ledger)
5 · DESPESA OPERACIONAL      12 categorias   ← 5.07, 5.08, 5.09, 5.11 nunca usadas
6 · PESSOAL                   8 categorias   ← 6.04 benefícios e 6.05 reembolsos: onde comida cai hoje
7 · IMPOSTOS                  3 categorias
8 · INVESTIMENTO              4 categorias
9 · MOVIMENTAÇÃO              8 categorias   ← nunca ganha núcleo, por desenho (0049)
```

`3.99` e `5.99` são **marcadores de indecisão**, não categorias: parecem
classificados (somam na DRE, contam no indicador) e por isso a view
`fin_a_classificar_v` os inclui de propósito.

Faixas de código livres: `3.15–3.89`, `4.06+`, `5.12+`, `6.09+`, `7.04+`,
`8.05+`, `9.06–9.09`, `9.13+`. Formato obrigatório `^\d\.\d{2}$`.

### 2.2 DESTINO — três níveis, todos construídos e vazios

Este é o eixo que não existe na prática, e é o que quase toda pergunta nova
está pedindo.

| Nível | Tabela | Linhas | Cobertura real |
|---|---|---|---|
| Núcleo | `fin_nucleo` | 4 (`obras`, `consultoria`, `tecnologia`, `corporativo`) | 1.152 lançamentos sem núcleo |
| Centro de custo | `fin_cost_center` | 28 (7 funcionais + 20 obras do ERP + 1 evento) | **13.853 de 13.972 sem valor** |
| Linha de produto | `fin_product_line` | **0** | nasceu vazia de propósito |

`fin_product_line` (migration 0124) foi desenhada exatamente para LDC, LIE, ICV,
PIE, LSPDA — e nunca recebeu uma linha.

### 2.3 LIQUIDAÇÃO — o eixo sem vocabulário

Hoje "paguei no PIX" e "paguei no cartão" não são o mesmo tipo de fato:

- **Cartão** → dívida em `fin_card_transaction`, vira caixa só quando a fatura é
  paga (`fin_card_bill.paid_transaction_id`). **Nunca somar fatura com extrato
  da corrente.**
- **PIX / boleto / TED** → saída direta em `fin_transaction`, identificada por
  `source_kind` — que é **texto cru do provedor**, sem CHECK. 1.258 linhas com
  `'PIX'`, ao lado de `'TRANSFER'`, `'BOLETO'`, `'COMPRA_DEBITO'`…

O vocabulário correto já existe e está vazio: `fin_payment_request.method` e
`fin_payment_execution.method` têm
`CHECK (method IN ('pix','ted','boleto','debito_automatico','cartao','dinheiro'))`
— **0 linhas nas duas**.

Falta o terceiro caso, que é o mais comum na prática:

| caso | modelado? |
|---|---|
| gastou no cartão da empresa | sim — `fin_card_transaction` |
| gastou do próprio bolso (PIX/dinheiro) | sim — `fin_reimbursement_item`, via `fin_time_envio.pagamento='ja_paguei_do_meu'` |
| **gastou no cartão PESSOAL e a empresa reembolsa** | **não** — cai em reembolso e o cartão some |

### 2.4 AUTORIA — pronto e nunca exercido

`fin_time_envio` congela `identidade_prova` no momento do envio, para que
cadastrar PIN depois não reescreva a história. `fin_anexo_blob` guarda o
comprovante. Ambos funcionam. Ambos têm **0 linhas**.

E o número que dói: **0 de 193 itens de reembolso têm comprovante**.

---

## 3. As 14 categorias pedidas — veredito uma a uma

| # | Pedido | Veredito | Onde está / o que falta |
|---|---|---|---|
| 1 | **LDC** | existe com outro nome | **3.03 Estudo de Disponibilidade de Carga** — R$ 941.218,37, a maior receita. No ERP chama `LDC — Laudo de disponibilidade de Carga`. É **receita**. |
| 2 | **LIE** | existe, fundido | **3.02 Laudos e Inspeções** — R$ 301.647,79, mas é um balde: no ERP são LIE, CLIE, LCC, LGR, LSPDA e ICV separados. |
| 3 | material de consultoria | **não existe** | só há 4.02 "Material específico de obra" (núcleo obras). Material de consultoria contamina obras ou vira 5.99. |
| 4 | material de vendas | **não existe** | nenhuma categoria de material no eixo comercial. |
| 5 | material p/ empresa ou escritório | **existe e está morta** | **5.07** — 0 lançamentos, 0 documentos, 0 itens de cartão. As 8 regras que apontam para ela são todas `mcc_indicio`, que por construção nunca decidem sozinhas. |
| 6 | custos de execução de projetos | não existe — ambiguidade catalogada | `fin_budget_category_map` id 5 já registra: *"o modelo está ambíguo neste ponto"*. Reparte-se hoje entre 4.02, 4.03 e 4.04 sem critério. |
| 7 | materiais de festas e datas comemorativas | **não existe** | 3.12 "Eventos e Patrocínios" é **receita**. Sintoma: a migration 0133 tirou "atacado dos presentes" da regra de alimentação **sem ter para onde mandá-lo**. |
| 8 | alimentação de obras | não existe como categoria | é 6.04/6.05 + `nucleo='obras'`. `fin_budget_category_map` id 4 marca como *aproximado* e id 10 como *indeterminado* — conta duas vezes. |
| 9 | alimentação de consultoria | **não existe** | mesmo mecanismo, sem nem a linha de orçamento que obras tem. |
| 10 | manutenção de medidores p/ consultoria | não existe — lacuna declarada | id 14 do mapa diz: *"Manutenção de equipamento de obra é outra coisa e não tem linha."* 5.08 é do escritório e tem 0 lançamentos. |
| 11 | CRM | absorvido | **5.03 Softwares e assinaturas**. `pipedrive` e `clickup` estão lá dentro. |
| 12 | IA | absorvido | também **5.03**. Existem 6 regras de cartão nomeando `anthropic`, `openai`, `cursor`, `openrouter`, `trae` — e nenhum lugar para somar. |
| 13 | automação consultoria | **não existe** | o mais próximo é o núcleo `tecnologia`, que é destino, não natureza. |
| 14 | gestão | ambíguo | receita tem 3.09; despesa dissolve-se em 5.xx/6.xx com `nucleo='corporativo'` (9.328 lançamentos, `is_overhead`). |

### O padrão

**Dez dos catorze são a mesma pergunta**, e ela não é sobre natureza:

> material *de consultoria* vs *de obra* · alimentação *de obra* vs *de
> consultoria* · manutenção *de medidor* vs *de escritório* · automação *de
> consultoria*

É sempre **"para qual núcleo/produto foi este custo?"** — o eixo DESTINO. Criar
14 categorias novas resolveria pela via errada: multiplicaria a natureza para
codificar o destino, que é exatamente o erro da linha "Cartão de Crédito".

**Só 4 dos 14 são natureza de verdade** e merecem código novo:

| código sugerido | nome | por quê |
|---|---|---|
| `5.12` | Materiais de eventos e datas comemorativas | não existe em eixo nenhum; a 0133 deixou um gasto órfão |
| `5.13` | IA e automação | 6 regras já reconhecem os produtos; falta onde somar |
| `4.06` | Manutenção de equipamento em campo | medidor, analisador, ferramenta de obra — distinto de 5.08 (escritório) |
| `5.07` | *(já existe — só ativar)* | Material de escritório e copa, morta por falta de regra que decida |

Os outros 10 se resolvem **preenchendo o destino**, não criando natureza.

---

## 4. O antídoto à burocracia

O risco de separar eixos é transformar cada compra num formulário de quatro
campos. Não é o desenho. **O app pergunta duas coisas e deriva o resto.**

### O que a pessoa informa

1. **Quanto** — valor, e em quantas parcelas (calculadora).
2. **O que é** — texto livre. A sugestão de categoria vem daí.
3. **Para qual obra/projeto** — um toque, opcional. É o teto do detalhe: nunca
   se pede núcleo, nunca se pede linha de produto.
4. **Como pagou** — cartão da empresa / meu cartão / PIX.
5. **Foto** — comprovante.

### O que o sistema deriva sozinho

| campo | derivado de |
|---|---|
| pessoa | sessão |
| data e hora | agora |
| **núcleo** | do centro de custo escolhido, ou de `fin_category.default_nucleo` (gatilho 0049 já faz) |
| **linha de produto** (LDC/LIE/ICV…) | **do projeto** — o ERP sabe o tipo de serviço de cada contrato |
| natureza | sugerida pelo texto + histórico da contraparte; a pessoa confirma ou troca |
| forma de liquidação | do cartão escolhido |

A derivação da linha de produto a partir do projeto é o que dispensa perguntar
"isto é LDC ou LIE?". Quem escolheu a obra já respondeu.

### Quando não há projeto: o custo do serviço

Nem todo custo de serviço tem projeto no momento em que acontece. **Combustível
para rodar um LIE** é o caso exemplar: a viagem acontece antes do contrato
existir, ou cobre três laudos de clientes diferentes no mesmo dia.

Por isso a regra "nunca pergunte linha de produto" é forte demais. A correta é:

> **A linha de produto deriva do projeto quando há projeto. Quando não há, ela é
> escolhível diretamente — e é o único caso em que se pergunta.**

O destino, então, tem três formas de ser preenchido, em ordem de preferência:

1. **projeto/obra** → preenche núcleo e linha de produto de uma vez;
2. **linha de serviço direta** (LIE, LDC, ICV…) → quando o gasto serve ao
   serviço mas não a um contrato específico;
3. **só núcleo** (obras / consultoria / tecnologia / corporativo) → quando nem
   isso se sabe. É o piso, nunca o vazio.

### A prova de que isto está faltando

A categoria **4.04 chama-se literalmente "Deslocamento atribuível a serviço"** —
e tem `default_nucleo = NULL`. Ela existe para dizer que o deslocamento pertence
a um serviço, e não consegue dizer a qual.

Combustível medido no acervo (só saídas, `\m(posto|combustivel|gasolina|shell|
ipiranga|petrobras)\M`):

| onde | lançamentos | valor |
|---|---|---|
| 4.04 Deslocamento atribuível a serviço | 30 | R$ 4.014,48 |
| 5.06 Viagens e representação | 12 | R$ 2.063,18 |
| itens de cartão em 5.06 | 16 | R$ 2.059,20 |
| **total** | **58** | **R$ 8.136,86** |

**Nenhum deles tem centro de custo.** Não dá para responder "quanto custou rodar
os LIEs deste mês".

### A armadilha que este mesmo dado revela

A mesma busca por "posto" traz **R$ 104.221,98 de ENTRADA** — são clientes
chamados *Posto Quarto de Milha* e *Auto Posto Pioneiro*. E traz 801 linhas em
4.05 somando R$ 1.006,89: taxas de mensageria de R$ 0,89 cobradas sobre as
faturas desses clientes.

Ou seja: **o texto "posto" aponta para receita três vezes mais do que para
combustível.** Qualquer sugestão que olhe só a palavra vai errar. A sugestão
tem de pesar, no mínimo, **direção do dinheiro + contraparte + histórico**, e
nunca só o texto.

### A regra de ouro

> **Escolher a obra é um toque e preenche dois eixos. É o único campo que vale
> insistir.** Todo o resto ou é sugerido, ou é derivado, ou pode ficar vazio e
> declarado.

Centro de custo está em **0,0%** hoje. Um toque por compra é o caminho mais
barato conhecido para tirá-lo do zero — e classificar 13.978 lançamentos
retroativamente já se provou que não funciona.

### Criar categoria pelo app

Permitido, com três travas que já existem no código:

- formato `^\d\.\d{2}$` validado (`lib/financeiro/categorizacao.ts:623`);
- nasce como **proposta**, igual a `virarRegra`, que sempre nasce
  `status='proposta'`;
- `3.99` e `5.99` são proibidas de receber linha de produto
  (`CHECK fin_category_marcador_sem_linha_produto`).

Ver a árvore inteira e navegar por área: sim, é leitura e não tem risco.
**Criar** categoria não deve virar o caminho fácil para fugir da decisão — se a
pessoa não sabe, o destino certo é `5.99` + `indeterminado:<motivo>`, que é
visível na fila, e não uma categoria nova que ninguém mais vai usar.

---

## 5. Ordem de ataque

1. **Preencher `fin_product_line`** com LDC, LIE, ICV, PIE, LSPDA, LCC, LGR e
   amarrar às categorias 3.02/3.03. Destrava o eixo produto sem tocar em nada.
2. **`fin_card.holder_person_id`** nos 11 plásticos do Nubank — hoje NULL em
   12 de 12, com R$ 87.206,95 pendurados sem dono.
3. **Decidir o `ownership` do `inter-cartao`** (`indeterminado` hoje) e declarar
   o `due_day` — sem ele, **R$ 40.862,41 em 9 faturas de 2026 projetam zero**, e
   a previsão de cartão subestima a saída pela metade.
4. **Criar 5.12, 5.13, 4.06** e ativar 5.07 com uma regra que decida.
5. **Centro de custo pelo app**, um toque por compra.
6. Só então: rateio, orçamento por linha, percentual por categoria.

---

## 6. O que não fazer

- **Não criar categoria para responder "de quem é o custo".** Isso é destino.
- **Não somar fatura de cartão com extrato da conta corrente.** Só o pagamento
  da fatura é caixa.
- **Não deduzir titular de cartão por semelhança de nome.** A 0074 já recusou
  isso por escrito: *"o nome bate, mas nome batendo não prova titularidade"*.
- **Não usar `3.99`/`5.99` como destino de conveniência.** Eles são marcadores
  de indecisão e a fila os enxerga.
- **Não deixar duas verdades sobre o mesmo dinheiro.** Hoje já existem duas
  modelagens de reembolso carregadas em paralelo (`fin_reimbursement` da 0012 e
  `fin_reembolso_item` da 0129), divergindo em **R$ 40,21**. Escolher uma é
  pré-requisito de qualquer tela nova de reembolso.

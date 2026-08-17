# O entregável consolidado — as telas que o Fernando pediu e a base que as sustenta

Escrito em **16/08/2026**, sobre a branch `codex/financeiro-conclusao-2026-08-16`
(72 commits à frente de `main`, medido com `git log --oneline main..HEAD`).

Este documento **não é um resumo do que foi feito**. É o contrato do que o
Fernando espera receber, reconstruído das palavras dele, com o que já está pronto
marcado por medição e o que falta especificado.

## Como foi construído

O transcript da sessão tem **8,2 MB**. Extraí dele todas as mensagens humanas —
não só os prompts digitados, mas também os **comandos enfileirados**
(`attachment.type = "queued_command"`, que o extrator ingênuo perde: são 12
mensagens dele, incluindo a correção mais valiosa da sessão) e as **respostas ao
AskUserQuestion**, onde ele decidiu regra de negócio por escrito.

Resultado: **74 entradas em ordem cronológica**, das quais 70 são do Fernando.
As outras quatro são ruído de ferramenta: o resumo de compactação de contexto
(#60), dois `/model` (#66, #69) e uma reinvocação de skill (#71).

Ao longo deste documento, **`#N` é a enésima dessas 74 mensagens, em ordem de
timestamp.** Frase entre aspas é textual dele, com a grafia original preservada.

## Sobre os números

Todo número marcado **[medido]** foi apurado por mim nesta sessão, com consulta
somente leitura ao ledger (`FINANCE_DATABASE_URL`) ou com `grep`/`wc` sobre a
árvore. Número marcado **[doc]** veio de documento e pode ter envelhecido — nesta
base os documentos envelhecem em horas, e `CONTINUACAO.md` §10 avisa isso.

```
[medido 16/08/2026]
migrations aplicadas ......... 90            (xpe_migrations)
caixa ........................ 6/6 contas fecham
lançamentos .................. 13.881 · itens de cartão 795 · documentos 3.418
contratos gerenciais ......... 37 · com rota HTTP 32 · sem rota 5
páginas em app/financeiro .... 15
componentes financeiros ...... 29 arquivos · 8.462 linhas
dúvidas abertas .............. 57 numeradas (0–56), 2 marcadas resolvidas
migrations 0100–0103 ......... não existem ainda em db/migrations
```

---

# 1. O que o Fernando pediu, nas palavras dele

## 1.1 O pedido-raiz (#12, 15/08 22:27)

A mensagem mais longa da sessão define o produto inteiro. Os trechos que viram
requisito de tela:

> *"quero fazer uma reconstrução completa de tudo que estamos fazendo de gestão
> financeira (...) lastreando todo recursos e custos (...) de quais contratos,
> para onde foram, como foram gastos toda ramificação"*

> *"quero com isso conseguir entrar uma DRE, fazer o projetado o realizado, ver o
> caixa em tempo real, ver o caixa previsto por dia com contratos e pagamentos já
> planejados, dinheiro a receber que estão atrasados"*

> *"quero saber quais áreas e projetos estão vendendo, qual ticket, quais obras,
> tipos obras, receitas detalhadas por clientes, custos por cliente"*

> *"quero todo custo ou saida ser orientado a de onde ta vindo, e classificar o
> tipo"*

> *"quero depois detalhatar todos custos de cartão de créditos, as parcelas sobre
> o que é, quanto tem a pagar para os proximos meses parcelados, organizar as NFe
> e documentos comprovantes"*

> *"quero uma ux e ui ultra foda, simplificada, automatica, sistema ultra
> inteligente de pre qualificação e definicação de padrões com agente validadores
> humanos"*

> *"quero fazer essa plataforma provavelmente ter um aplicativo web para o time
> cadastrar reembolsos, custos, enviar notas, pedidos de compra e enviar por
> exemplo link de coisas pra comprar"*

> *"quero uma gestão fino do fino a nível da gente conseguir detalhamento de
> praticamente tudo"*

## 1.2 A regra que gera telas (#40, 16/08 03:52)

No fim do prompt gigante de conclusão da base, ele escreveu a frase que decide
quais telas precisam existir:

> *"Tudo que precisa de intervenção humana, vai ter que ter telas, notificações,
> ux e ui ultrafalicitada para realizar... e o que faz sentido ser direcionado
> por aqui, vem sempre com perguntas com opções para eu ir respondendo enquato vc
> trabalha profundamente em tudo que é indepente"*

Isto não é preferência de UX. É um **critério de completude**: toda decisão
humana que a base hoje exporta para `DUVIDAS_FINANCEIRO.md` ou para a fila
deveria ter uma tela. As 57 dúvidas abertas são, por essa régua, 57 evidências de
tela faltando ou de decisão que só ele pode tomar.

## 1.3 Onde um pedido posterior substituiu ou estreitou um anterior

| pedido original | pedido posterior que o substitui | o que saiu de escopo |
|---|---|---|
| **#10** *"considere a base e organização recente, mês 5 pra ca..."* | **#27** *"essa parte nao importa mais, **quero tudo organizado que conseguir 2026**. falta oq?"* | O recorte "maio em diante" morreu; o alvo passou a ser o ano de 2026 inteiro, e o histórico anterior a 2026 saiu de meta de completude (segue na base como evidência) |
| **#12** *"quero fazer uma plataforma de gestão financeira independente (...) pode ser outro railway"* | **#9** (resposta): *"Continua ledger próprio, enriquecido"* | Não há segundo Railway nem segundo app. O `fin_*` do plan-estratégico é o sistema de registro; o erp-obras alimenta, não substitui |
| **#12** *"quero conseguir automatizar todos pagamentos previstos"* | **#40** regra 6: *"Nenhuma automação pode efetuar pagamentos (...) a autorização final deve ser humana"* | Automação de **preparação**, não de execução. O produto prepara, confere, agrupa, exporta e registra — nunca paga |
| **#22** *"a construção da interface é o de menos, quero atacar tudo necessário para ter a bse de dados toda organizada (...) e por ultimo vamos construir as telas"* | **#72** *"Quero que planege todas telas de forma profissional"* + **#73** *"Implemente isso"* | A ordem virou: a base entrou em regime de acabamento e as telas passaram a ser o trabalho principal. #22 explica por que a base está tão à frente da interface |
| **#8** *"quero toda gestão financeira de lá em obras enriquecendo o que temos aqui"* | **#37** *"tudo que adryan tem tá na plataforma, o que nao tiver como infelimente vai ficar pendente"* | Ele aceitou o teto de fonte. É o que autoriza `centro de custo = 1,1%` a permanecer vermelho sem ser fracasso |
| **#19** *"so parar quando alcançar 90% ou mais de tudo organizado"* | **#40** os 26 critérios de pronto + *"Se ainda faltar qualquer regra de negócio, ingestão, conciliação, modelo, teste, API ou dado alcançável pelas fontes existentes, não diga que falta apenas design"* | A meta de 90% virou meta por indicador; o "pronto" virou lista de 26 critérios verificáveis |

## 1.4 As correções de rumo — as instruções mais valiosas da conversa

**Correção 1 — recorrente não é parcelado.** Ele viu um número e não acreditou:

> **#44** *"muito estranho suas declaralões n tem nem a pau 99 mil recorrente"*

E na mensagem seguinte, enfileirada, deu a chave que invalidou toda a abordagem
anterior:

> **#45** *"recorrente? ou parcelado? sao diferentes, no asaas da pra saber"*

O detector estatístico (densidade, dispersão, concentração de dia) foi
substituído por **camadas declaradas pela fonte**: assinatura de verdade tem fim
indeterminado; parcelamento tem fim. `CONTINUACAO.md` §4 registra que isso
corrigiu o erro mais caro do projeto.

**Correção 2 — a BRA é a PIAU, e os outros são parcelados.**

> **#50** *"isso é a piau mesmo chamamos de BRA (mas é piau) vc esta certo os
> outros sao parcelados"*

**Correção 3 — o total de assinatura estava errado.**

> **#48** *"como assim assinatura 130 mil agosto?"*

A pergunta dele expôs a soma de `value` (total do parcelamento) em vez de
`paymentValue` (a parcela).

**Correção 4 — pró-labore tem dois eixos, e ele não aceitou escolher um.**

> **#25** (resposta ao AskUserQuestion): *"na prática é salario, mas contabilmente
> é pro labore para reduzir impostos. Então mesmo que conte pro labore na analise
> de custos deve contar como salário. Nao sei como vc resolve isso... porque
> quando eu for analisar custo com folha, quero contar tudo isso, pq lucro de
> verdade ainda nao temos para distribuir lucros da forma correta"*

**Correção 5 — não invente unificação futura.**

> **#9** *"vai ser no ERP obras futuramente, mas por enquando pode criar uma no
> plan estrategico no inicio depois a gente pode fazer ma migração, unificar...
> mas isso vai demorar **so n erre em modelagem para nao fuder o esquema de
> unificar tudo no futuro**"*

## 1.5 O contrato de telas — os dois últimos prompts

**#72 (17/08 01:24)**

> *"Quero que planege todas telas de forma profissional no claude design para que
> possamos implementar esse modulo de gestão financeira, contábil, caixa,
> tesouraria, etc... Planeje mt bem quero design foda e completo, planeja a
> itereações as conexões, detalhamntos, etc."*

A resposta foi a especificação **"Medida e Motivo"** — 5 princípios, 13 telas
(T01–T13), mapa de navegação em três camadas, 7 estados obrigatórios, 6 padrões
transversais e uma sequência de implementação em 6 etapas. Ele respondeu
**"gostei"**, o que torna esse plano parte do contrato.

**#73 (17/08 01:38)** — e aqui ele estreitou e detalhou, palavra por palavra:

> *"gostei, quero que na parte de **previsão de custos do mês** detalhe tudo
> organizado categorizado, mostre o previsto e usuario pode confirmar todos,
> adicionar tbm, quero uma **area completa de categorização** onde tem tudo
> categorizado, busca por valor, por nome, tipo, categoria, pode o usuario trocar
> tudo, pode cadastrar um novo, deve ter tudo lá; Implemente isso, e enquanto vai
> fazendo isso, vá colocando agentes para concluir tudo que estiver faltando para
> a plataformar estar 100% e permitir tbm correções cadastros, identificar o que
> ta sem indentificação, o que esta duvido, etc...*
>
> *a parte de **DRE** quero uma uma que vc consegue ver o resumo, expandir as
> linhas ver mais em detalhares cada parte de compõe, tudo organizado e permitir
> usuario inclusive tirar algo de um para outro, adicionar algo, e a realidade o
> feito é sempre o caixa."*

Essas três telas são o pedido mais recente e mais detalhado da conversa inteira.
A seção 2.1 trata cada palavra delas como requisito.

---

# 2. As telas — inventário completo

## 2.1 As três telas do último pedido (#73)

### P1 · Previsão de custos do mês

**A pergunta dele:** *"projeção de custos para o mês baseado nos fixos recentes"*
(#40) e, em #12, *"ver o caixa previsto por dia com contratos e pagamentos já
planejados"*.

**Os requisitos, extraídos frase a frase de #73:**

| # | palavra dele | o que isso exige da tela |
|---|---|---|
| P1.1 | *"detalhe tudo"* | Item a item, nunca só o total do mês. Cada custo previsto é uma linha com data, valor, contraparte e de onde a previsão veio |
| P1.2 | *"organizado categorizado"* | Agrupado pelo plano de contas (`fin_category`, 56 linhas ativas [medido]), com subtotal por grupo |
| P1.3 | *"mostre o previsto"* | O valor projetado ao lado da procedência: folha, recorrente, tributo, documento, cartão-parcela, cartão-ciclo, cartão-estimado |
| P1.4 | *"usuario pode **confirmar todos**"* | Ação de confirmação, individual **e em massa** — "todos" é literal |
| P1.5 | *"adicionar tbm"* | Cadastro manual de custo previsto que nenhuma fonte declarou |

**Requisitos herdados de mensagens anteriores, que valem aqui:**

- **#47:** *"as projeções de cartão deve ser o que já está pacelado nos cartões"*
  — a linha de cartão não é estimativa, é o parcelamento existente.
- **#40:** *"baseado nos fixos recentes"* — a projeção de custo fixo nasce do
  histórico recente, não de média longa (mesmo espírito da regra da BRA).
- **#40**, regra de camadas: *"A mesma obrigação não pode ser somada em duas
  camadas."*

**Estado atual: PARCIAL — existe cálculo, não existe tela nem confirmação.**

```
[medido] fin_previsao_evento_v, janela de 45 dias a partir de hoje
  saída ....... 51 eventos · R$ 145.140,57 · 7 procedências
     pagar_folha ............ 26 ev ·  R$ 90.186,85
     pagar_recorrente ....... 15 ev ·  R$ 16.709,87
     pagar_tributo_das ......  1 ev ·  R$ 17.647,03
     pagar_documento ........  6 ev ·  R$ 11.800,00
     pagar_cartao_estimado ..  1 ev ·  R$  3.931,26
     pagar_cartao_ciclo .....  1 ev ·  R$  3.888,61
     pagar_cartao_parcela ...  1 ev ·  R$    976,95
  categoria nos eventos de saída .... 22 de 51
  rota HTTP ......................... GET /api/financeiro/gerencial/previsao ✅
  página ............................ /financeiro/fluxo (FinForecastView, 298 linhas)
  coluna de confirmação ............. NÃO EXISTE
  rota de escrita de previsão ....... NÃO EXISTE
```

**O que falta, portanto:** o agrupamento por categoria não é possível para 29 dos
51 eventos (57% sem `category_id`); não há onde gravar "confirmado"; não há como
adicionar. E o buraco declarado de **R$ 43.059,77/mês** (dúvida 34 [doc]) faz a
previsão de saída cobrir **71,7%** do que sai de verdade — a tela precisa dizer
isso na cara, no padrão do princípio 01 do plano aprovado.

> ⚠️ **Ambiguidade que precisa da resposta dele — a de maior consequência do
> documento.** *"confirmar"* tem duas leituras incompatíveis:
> **(A)** *conferi, está certo* — marca de revisão, não muda dinheiro nenhum; ou
> **(B)** *isto vai acontecer mesmo* — o evento previsto vira **documento a
> pagar** (`fin_document direction='pagar'`).
> A leitura (B) é a mais útil e é a que resolve a dúvida 28 ("onde nasce a conta
> a pagar", hoje 12 documentos de R$ 23.600,00 contra 3.406 a receber [medido]) —
> **mas cria risco de dupla contagem**: o mesmo compromisso passaria a existir
> como evento projetado e como documento. A trava de `0061` já resolve isso para
> recebimento (cobrança emitida vence recorrente projetado); a saída precisaria
> da trava equivalente antes de qualquer botão de confirmar existir.
> Não escolhi por ele.

---

### P2 · Central de categorização

**A pergunta dele:** *"quero todo custo ou saida ser orientado a de onde ta
vindo, e classificar o tipo"* (#12) e *"identificar o que ta sem indentificação,
o que esta duvido"* (#73).

**Os requisitos, frase a frase:**

| # | palavra dele | o que isso exige |
|---|---|---|
| P2.1 | *"area completa de categorização onde tem tudo categorizado"* | Uma tela só, com a população inteira — não três filas paralelas |
| P2.2 | *"busca por valor"* | Busca numérica: valor exato e faixa |
| P2.3 | *"busca por nome"* | Texto livre sobre descrição e contraparte |
| P2.4 | *"busca por tipo"* | Filtro por natureza (entrada/saída, transferência, cartão, documento) |
| P2.5 | *"busca por categoria"* | Filtro pelo plano de contas, inclusive "sem categoria" |
| P2.6 | *"pode o usuario trocar tudo"* | Reclassificar qualquer linha, e em lote |
| P2.7 | *"pode cadastrar um novo"* | Ver ambiguidade abaixo |
| P2.8 | *"deve ter tudo lá"* | Nada de população que mora só em outra tela |
| P2.9 | *"permitir tbm correções cadastros"* | Corrigir contraparte, núcleo, competência — não só categoria |
| P2.10 | *"identificar o que ta sem indentificação, o que esta duvido"* | Duas filas distintas: **ausente** (sem categoria) e **duvidoso** (com categoria fraca ou candidato em conflito) |

**Estado atual: PARCIAL — a decisão em grupo existe e é boa; a busca e o cadastro
não existem.**

```
[medido]
/financeiro/qualificar  (FinQualificar, 276 linhas)   agrupa, sugere com evidência,
                                                      aplica ao grupo, vira regra
   POST /api/financeiro/qualificar ✅
/financeiro/revisao     (FinReviewQueue, 255 linhas)  fila de revisão
   GET /api/financeiro/revisao · POST /revisao/lote ✅
/financeiro/lancamentos (FinLedgerTable, 205 linhas)
   PATCH /api/financeiro/lancamentos/[id] ✅   PATCH /documentos/[id] ✅

A população, hoje, em três lugares que não se falam:
   fin_transaction ... 13.881 linhas · fila: 753 pendentes, 3.558 resolvidos
   fin_document ...... 3.418 linhas · fila: 802 pendentes, 2 resolvidos
                       389 sem categoria (R$ 259.432,76)
   fin_card_transaction 795 linhas · 500 a classificar (R$ 54.126,76)
                       FORA de fin_review_item — nenhum monitor os enxerga

fin_category ......... 56 categorias, todas ativas
rota que escreve em fin_category ......... NENHUMA
busca por valor / nome / tipo ............ NÃO EXISTE em nenhuma tela
```

Os indeterminados do ledger, com o motivo que a própria base escreveu [medido em
`fin_indeterminado_v`] — esta é a matéria-prima da fila "duvidoso":

| motivo | linhas | R$ |
|---|---|---|
| duas-leituras-possiveis | 134 | −33.316,43 |
| contraparte-sem-historico | 122 | −66.702,71 |
| assinatura-sem-servico-declarado | 45 | 12.870,35 |
| rotulo-por-trilho-de-pagamento | 25 | −9.395,07 |
| servico-nao-declarado | 18 | 66.395,00 |
| fatura-sem-itemizacao | 9 | −40.862,41 |
| sem-lastro-nem-contraparte | 7 | −3.963,18 |

> ⚠️ **Ambiguidade 1 — *"pode cadastrar um novo"*.** Duas leituras:
> **(A) nova categoria** no plano de contas — hoje impossível por tela, e há um
> caso real esperando: o **IOF não tem casa** no plano de contas (o grupo 7 só
> tem `7.01 DAS`, `7.02 ISS`, `7.03 Retenções`), o que deixa **133 itens de
> cartão, R$ 553,40**, indeterminados por falta de linha, não por falta de
> evidência [doc, MAPA §2.3];
> **(B) novo lançamento/custo** cadastrado à mão. A vizinhança da frase
> (*"correções cadastros"*) sugere que ele quer as duas. Registro as duas.
>
> ⚠️ **Ambiguidade 2 — o alcance de *"tudo"*.** Se "tudo" inclui
> `fin_card_transaction`, a tela precisa da unificação da fila (a FRENTE 2 do
> `MAPA_CONCLUSAO.md`, migration 0096 reservada). Se inclui `fin_document`, ela
> precisa encarar que **802 documentos nunca foram resolvidos uma vez** — a fila
> deles nasceu em 08/08 e nunca andou [medido: 2 resolvidos de 804].

---

### P3 · DRE expansível

**A pergunta dele:** *"quero com isso conseguir entrar uma DRE, fazer o projetado
o realizado"* (#12).

**Os requisitos, frase a frase:**

| # | palavra dele | o que isso exige |
|---|---|---|
| P3.1 | *"ver o resumo"* | A DRE fechada, uma linha por rubrica, mês a mês |
| P3.2 | *"expandir as linhas"* | Expansão progressiva dentro da própria tela, sem trocar de página |
| P3.3 | *"ver mais em detalhares cada parte de compõe"* | Drill até o lançamento individual, com a evidência de origem |
| P3.4 | *"tirar algo de um para outro"* | Mover um item de uma linha da DRE para outra |
| P3.5 | *"adicionar algo"* | Ver ambiguidade abaixo |
| P3.6 | *"a realidade o feito é sempre o caixa"* | **Lei.** Ver seção 4 |

**Estado atual: PARCIAL — o dado está pronto e completo; a tela não expande.**

```
[medido]
fin_dre_mensal_v ........ 64 meses, duas visões (caixa e competência)   ✅
fin_dre_lancamento_v .... existe — o drill até o lançamento está no banco ✅
fin_dre_dimensao_v ...... quebra por dimensão ✅
GET /api/financeiro/gerencial/dre ✅ · /dre/dimensao ✅
FinDre.tsx .............. 372 linhas, montado dentro de /financeiro/indicadores
                          — a DRE não tem URL própria
expansão / drill na UI .. NÃO EXISTE
mover item entre linhas . NÃO EXISTE por tela (só PATCH em /lancamentos/[id])
```

> ⚠️ **Ambiguidade 3 — *"tirar algo de um para outro"*.** Duas leituras com
> consequências opostas:
> **(A) reclassificar** — muda `category_id` do lançamento, o que altera a DRE de
> todos os meses e de todas as telas, com trilha e trava humana; ou
> **(B) reagrupar na apresentação** — cria uma camada de override que muda só
> como a DRE exibe, sem tocar no lançamento.
> (A) é consistente com o resto da plataforma e não inventa estrutura nova.
> (B) permitiria "arrumar a DRE" sem mexer no ledger — e criaria uma segunda
> verdade, exatamente o que a base foi construída para não ter. **Recomendo (A) e
> não decidi.**
>
> ⚠️ **Ambiguidade 4 — *"adicionar algo"*.** Adicionar um **lançamento** que
> falta (mas o caixa fecha 6/6; um lançamento novo sem contrapartida quebraria a
> âncora), ou adicionar uma **linha/rubrica** à DRE (que é o mesmo pedido de
> "cadastrar um novo" da P2, visto de outro ângulo)? A segunda leitura é
> compatível com o invariante do caixa; a primeira não é, a menos que venha
> acompanhada de conta e data.

---

## 2.2 As 13 telas do plano aprovado (#72, respondido com "gostei")

Estado medido de cada uma. "Página" = existe rota em `app/financeiro`;
"contrato" = existe função tipada; "rota" = existe URL HTTP.

| id | tela | pergunta dele que ela responde | contrato | rota | página | estado |
|---|---|---|---|---|---|---|
| **T01** | Visão executiva | *"ver o caixa em tempo real"* (#12) | `getVisaoExecutiva` | ✅ | `/financeiro/painel` (FinExecutivePanel, 316 l.) | **parcial** — o cartão "a pagar" precisa nascer hachurado: só 12 documentos a pagar existem [medido] |
| **T02** | Bancos & caixa | *"todos dados bancários atualizados, detalhados por conta"* (#40) | `getBancos`, `getConciliacao`, `getFluxoPorConta` | ✅ | `/financeiro/contas` (FinPayables, 704 l.) | **parcial** — falta a régua de cobertura: 2 contas ativas sem extrato nenhum, e `nubank-caixinhas` cobre 46 de 228 dias de 2026 [doc] |
| **T03** | Lançamentos | *"de onde veio cada real e para onde foi"* (#12) | `getLancamentos`, `getOpcoesLancamentos` | ✅ | `/financeiro/lancamentos` (205 l.) | **parcial** — falta o selo "por quê?" (procedência visível) e a seleção múltipla para a fila |
| **T04** | Cartões | *"detalhatar todos custos de cartão (...) quanto tem a pagar para os proximos meses parcelados"* (#12) | `getCartao` | ✅ | **não existe** | **não existe tela** — dado pronto: 3 emissores, 12 subcartões, 795 itens [doc] |
| **T05** | A receber | *"quero ver por grupoe todo detalhe dos principais... quais receitsas sao imporatntes nao deixar de receber do mes"* (#49) | `getContasAReceber`, `getPrioridadeReceita`, `getReceitaPorGrupo` | ✅ | `/financeiro/receitas` (FinRevenueDetail, 235 l.) | **parcial** — a curva ABC tem contrato e rota; falta ser a abertura da tela |
| **T06** | A pagar | *"contas a pagar, receber"* (#40) | `getContasAPagar` | ✅ | **não existe** | **bloqueada por dado** — dúvida 28 |
| **T07** | Fila de pagamento | *"automatizar todos pagamentos previstos"* (#12), sem botão que paga (#40 regra 6) | `getFilaPagamento`, `getSolicitacao`, `getLotes`, `getAlcadas`, `getFilaCompra` | ❌ **as 5 sem rota são estas** | **não existe** | **bloqueada** — `fin_approval_rule`, `fin_payment_request`, `fin_purchase_request`, `fin_payment_batch`, `fin_payee_account`, `fin_payment_attachment`: **todas com 0 linhas** [medido]. Dúvidas 27 e 29 |
| **T08** | Tesouraria & previsão | *"previsão de caixa mês a mês"*, *"reservas"*, *"runway"* (#40) | `getTesouraria`, `getPrevisao`, `getPrevisaoRecebimento` | ✅ | `/financeiro/fluxo`, `/financeiro/planejamento` | **parcial** — 4 reservas com alvo R$ 230.547,86 e saldo zero [doc]: "o dia do aperto" responde *hoje* sempre. Dúvida 32 |
| **T09** | Resultado (DRE, balanço, fluxo) | *"montar as DRE, balanço, Lucro real"* (#40) | `getResultado`, `getBalanco`, `getFluxoDeCaixa`, `getDrePorDimensao`, `getOrcadoRealizado`, `getMargemPorProjeto` | ✅ | dentro de `/financeiro/indicadores` | **parcial** — é a **P3** desta lista. Balanço fecha com R$ 0,00 não conciliado [doc] |
| **T10** | Pessoas (folha, MEIs, reembolsos, comissões) | *"quantas pessoas tem na empresa recebendo por MEI (...) historicos de salários, todo mundo que recebeu"* (#40) | `getPessoas`, `getFolhaPrevisao`, `getReembolsos`, `getComissao` | ✅ | `/financeiro/pessoas` (1.307 l.), `/financeiro/reembolsos` (634 l.) | **a mais completa** — ressalvas: MEIs na conta errada (dúvida 21) e comissão errando o mês em 87,7% [doc] |
| **T11** | Tributário | *"analise de qual melhor modelo real, presumido ou simples (numa guia de análise contábel...)"* (#40); *"projeção de imposto calculado mensal analise se está coerente"* (#53) | `getApuracaoTributaria` | ✅ | **não existe** | **não existe tela; comparação bloqueada** — 0 de 256 cenários completos, 7 lacunas [doc] |
| **T12** | Decisões | *"sistema ultra inteligente de pre qualificação (...) com agente validadores humanos"* (#12) | `getCaixaDeDecisoes`, `getItensDaFila`, `getPendencias` | ✅ | `/financeiro/qualificar` + `/financeiro/revisao` | **parcial** — é a **P2**. A tela de qualificação já decide em grupo com evidência (commit `85a900b`) |
| **T13** | Cobertura & auditoria | *"posso confiar neste número?"* — da regra dele *"a validação máxima é sempre caixa (...) nada de estimativa"* (#19) | `getCobertura`, `getAuditoria` | ✅ | **não existe** | **não existe tela** — e é a tela que sustenta todas as outras. Os 24 monitores e 41 invariantes só existem no terminal [medido: `FinIndicadores.tsx` não menciona monitor nem invariante] |

**Resumo medido:** das 13 telas do plano, **5 não têm página nenhuma** (T04, T06,
T07, T11, T13), 8 têm página parcial, e **nenhuma** implementa ainda os
componentes-assinatura do plano além de `Certeza.tsx` (169 linhas: `Medida`,
`SeloCamada`, `Ressalva`, `LinhaLacuna`, tipo `Camada` com 5 valores) [medido].

## 2.3 O que ele pediu e não está em nenhuma tela do plano

Estes são os achados mais valiosos deste documento: **pedidos nominais dele que
sumiram da conversa.**

### E1 · O aplicativo web para o time — ESQUECIDO

> **#12:** *"quero fazer essa plataforma provavelmente ter um **aplicativo web
> para o time** cadastrar reembolsos, custos, enviar notas, pedidos de compra e
> enviar por exemplo **link de coisas pra comprar**"*

Medido: `fin_purchase_request` tem **0 linhas**; `getFilaCompra` é um dos 5
contratos **sem rota**; não existe campo para "link do que comprar"; e o módulo
financeiro inteiro é **admin-only** (`lib/financeiro/contratos/http.ts` documenta
que `/api/financeiro` é o prefixo que `lib/auth/perfis.ts` marca como só admin).
O plano de 13 telas marca T12 e T03 como "time + admin", mas **nenhuma das 13 é
uma tela de submissão do time** — todas são de leitura ou de decisão do admin.

Ele repetiu a intenção em #40 (*"Tudo que precisa de intervenção humana, vai ter
que ter telas"*). Nunca foi contestado, nunca foi entregue, e não está na
sequência de implementação do plano aprovado.

### E2 · Notificações — ESQUECIDO

> **#40:** *"vai ter que ter telas, **notificações**, ux e ui ultrafalicitada"*

Medido: não existe tabela, serviço, fila ou componente de notificação em lugar
nenhum da árvore. Nenhuma das 13 telas do plano menciona notificação. Um sistema
cujo produto é "o que precisa da sua decisão" e que não avisa ninguém depende de
alguém abrir a tela por hábito.

### E3 · As notas de entrada e os comprovantes — PARCIAL, e o lado que falta é o dele

> **#12:** *"organizar as NFe e documentos comprovantes"*

Medido: `fin_payment_attachment` = **0 linhas**; **0 de 193 itens de reembolso
têm anexo** [doc, MAPA critério 12]. A nota de **saída** existe (3.521 NFS-e
[doc]); a de **entrada** não tem por onde chegar — é a dúvida 45, e é a mesma
lacuna que impede responder *"os MEIs emitem nota?"* (#40).

### E4 · O que foi fechado no Pipedrive e ainda não virou cobrança — SEM TELA

> **#47:** *"tem tbm o que foi fechado no pipe mas ainda vai virar cobranças no
> asaas (**mostre isso tbm**)"*

`fin_pipeline_ganho` existe e está correto, e a decisão de **não** somá-lo à
previsão é certa (não tem data nem forma de pagamento). Mas ele pediu
explicitamente para **ver**. Hoje isso não aparece em tela nenhuma, e nenhuma das
13 telas do plano o nomeia.

### E5 · "Inclusive aplicado se for o caso" — NÃO MODELADO

> **#12:** *"quero conseguir cadastrar tudo isso, ver onde está, **inclusive
> aplicado** se for o caso"* · **#40:** *"aplicações e resgates; rendimento
> realizado e não realizado"*

Medido: `caixa-aplicacao` é conta ativa com **zero lançamento** e entra no
consolidado como R$ 0,00 (invariante F1). Não existe view de rendimento
realizado/não realizado. As caixinhas do Nubank (R$ 27.700,17) são o único
"aplicado" com dado.

### E6 · A consultoria — ADIADA SEM REGISTRO

> **#8:** *"consultoria teremos que melhorar e organizar tudo tbm"* · **#9:**
> *"por enquando pode criar uma no plan estrategico no inicio (...) so n erre em
> modelagem"*

Nada foi criado no plan-estratégico para consultoria como domínio próprio, e a
decisão de adiar não está registrada em documento nenhum. A memória do projeto
diz que a consultoria já existe no ERP com 164 projetos — o que provavelmente
torna o adiamento certo, mas ele nunca foi comunicado a ele.

### E7 · A coerência do cálculo do imposto — RESPONDIDO PELA METADE

> **#53:** *"projeção de imposto calculado mensal **analise se está coerente com
> metodo de calculo correto**, pode ter algumas duvergencias por algumas notas
> emitidas diretamente pelo site da prefeitura"*

A base entrega `fin_apuracao_tributaria_v`, que **declara explicitamente que não
calcula** — postura correta e alinhada ao segundo princípio. Mas a pergunta dele
("está coerente?") continua sem resposta, e as notas emitidas fora do Asaas foram
medidas (R$ 55.567,69, dúvida 50 [doc]) sem que ninguém voltasse a ele para dizer
se a divergência que ele previu é exatamente essa.

### E8 · "Pedir permissão extra no Asaas" — ELE JÁ RESPONDEU, E NINGUÉM COBROU

Na resposta #25 ele escolheu essa opção para os 20 movimentos de 2021–2023
(R$ 215.500). É uma ação **dele**, no painel do Asaas. A dúvida 1 continua aberta
e ninguém voltou a lembrá-lo. (Escopo: é pré-2026, portanto fora da meta de
completude de #27 — mas a decisão foi tomada e não foi executada.)

---

# 3. A base que sustenta cada tela

Para cada tela, o que o banco/API precisa ter, o que já tem, e onde ela **não
pode existir honestamente** hoje.

| tela | o que a base já entrega | o que falta na base | dúvida que destrava |
|---|---|---|---|
| **P1 Previsão de custos** | `fin_previsao_evento_v` (7 procedências de saída), `fin_previsao_cenario_v`, `fin_previsao_afericao_v`, rota `/gerencial/previsao` | coluna/tabela de **confirmação**; rota de escrita; categoria em 29 dos 51 eventos; a trava anti-dupla-contagem da saída | **34** (buraco de R$ 43.059,77/mês), **33** (11 recorrentes de despesa não confirmadas), **28** se "confirmar" for a leitura (B) |
| **P2 Categorização** | `fin_indeterminado_v` (360 linhas com motivo), `fin_card_a_classificar_v` (500), fila `fin_review_item` (1.555 pendentes), `POST /qualificar`, `PATCH /lancamentos/[id]` | **busca por valor/nome/tipo**; **CRUD de `fin_category`**; unificação das três populações numa fila só | **56** (16 categorias mortas), **nova** (IOF sem casa, R$ 553,40), **40** (65 categorias apagadas por regressão) |
| **P3 DRE** | `fin_dre_mensal_v` (64 meses × 2 visões), `fin_dre_lancamento_v` (drill pronto), `fin_dre_cobertura_v`, rota `/gerencial/dre` | nada no banco — **é trabalho de tela** | nenhuma. Esta é a tela mais barata de todas |
| **T04 Cartões** | `fin_card_hierarquia_v`, `fin_card_parcela_futura_v`, `fin_card_fatura_conciliacao_v`, rota `/gerencial/cartao` | nada estrutural | titular dos 12 cartões (R$ 87.206,95); 12 faturas não explicadas (R$ 13.744,87) [doc] |
| **T06 A pagar** | `fin_pagar_candidato_v`, `fin_pagar_origem_v`, `fin_pagar_lacuna_v`, rota `/gerencial/pagar` | **a população**: 12 documentos a pagar contra 3.406 a receber | **28** — sem ela a tela nasce 99% hachurada, e isso é honesto mas inútil |
| **T07 Fila de pagamento** | 10 tabelas modeladas (`fin_payment_*`, `fin_purchase_request`, `fin_approval_rule`, `fin_payee_account`) — **todas vazias** | **as 5 rotas HTTP** que faltam, e as faixas de alçada | **27** (alçadas), **29** (conta do favorecido), **31** (quem aprovou pode registrar que pagou) |
| **T08 Tesouraria** | `fin_previsao_cenario_v`, `fin_reserve` (4), aferição (0097) | saldo das reservas | **32** — a reserva tem alvo R$ 230.547,86 e saldo zero: o alarme toca sempre e a tela fica verdadeira e inútil |
| **T11 Tributário** | `fin_apuracao_tributaria_v`, `fin_regime_resumo_v` (256 cenários, 0 completos) | 7 insumos legais | **21** (conta dos MEIs → Fator R → anexo), **47** (CNAE), **51** (segregação por anexo), **48**, **49**, **50** |
| **T13 Cobertura** | `fin_fonte_cobertura_v` (0085), 41 invariantes, 24 monitores | **a tela** — hoje só existe no terminal | **5** (7ª conta Caixa), **4** (extratos 2022–2025) |
| **E1 App do time** | `fin_reimbursement_item` (193), `fin_compra_fila_v` | perfil não-admin, submissão, upload de anexo, campo de link | — é trabalho, não bloqueio |

---

# 4. Regras de negócio que ele declarou e valem como lei

Transcritas com a origem. Nenhuma destas é interpretação: são frases dele ou
decisões que ele assinou numa resposta.

1. **Caixa é a validação máxima.**
   > #19: *"a validação máxima é sempre caixa, dinheiro em caixa, dinheiro nas
   > caixas, conciliação, extrato 100% batendo... **nada de estimativa**"*

   E reforçada em #73 para a DRE: *"a realidade o feito é sempre o caixa"*.

2. **Pró-labore é salário na prática e pró-labore no papel — os dois eixos
   coexistem.**
   > #25: *"na prática é salario, mas contabilmente é pro labore para reduzir
   > impostos. Então mesmo que conte pro labore na analise de custos deve contar
   > como salário."*

3. **A conta Caixa é só do Pronampe.**
   > #25: *"é uma conta bancária, unica e exclusiva para pagar o empréstimo, pode
   > considerar que tudo que vai para lá é o pagamento de um emprestimo na caixa
   > de pronampe (...) considere que vai ser pago por 5 anos"*

4. **Não ratear custo comum.** Escolha dele em #25 ("Não ratear (Recomendado)"),
   optando por margem de contribuição por obra em vez de lucro por obra.

5. **A BRA (que é a PIAU) prevê pelo mês anterior, não pela média.**
   > #47: *"se bra me pagou agosto 22 mil, o previsto para setembro vai ser 22k
   > (...) quando receber o proximo da bra, tualiza a projeção"* · #50: *"isso é
   > a piau mesmo chamamos de BRA"*

6. **Recorrente ≠ parcelado, e o Asaas sabe a diferença.** (#45)

7. **Cliente que paga há mais de 12 meses sem contrato formal é ativo de fato.**
   > #39: *"temos alguns clientes que nos pagam a mais de 12 meses, geralmente
   > valores fixos esses podemos classificar como assinaturas de gestão ou
   > faturas (geralmente são associados ao grupo pichilau, J&I empreendimentos é
   > um shopping afogados (faturas), shopping cidade maceio (...) se tiver
   > duvidas depois posso reclassificar"* · #46: *"alguns clientes que pagam a
   > mais de 12 meses e continuam pagando podem ser ativos"*

8. **Comissão: percentual sobre o vendido; obras a partir da 2ª parcela;
   consultoria mais rápido.**
   > #56: *"é um percentual sobre o vendido, em obras geralmente so recebe na
   > segunda parcela em diantes, em consultoria recebe mais rapido (...) é
   > interessante para ajudar a prever os custos com pessoas e folha dos meses"*

9. **Nenhuma automação paga.**
   > #40, regra 6: *"Nenhuma automação pode efetuar pagamentos. Implemente
   > preparação, aprovação, lote, controles e auditoria, mas a autorização final
   > deve ser humana."*

10. **O erp-obras é somente leitura.**
    > #9: *"nao é para escrever nada lá, so ler dele"*

11. **APIs externas são somente GET.** (#40, regra 5)

12. **XPE Tecnologia, XPE Consultoria, XPE Obras e XP Energy são a mesma
    empresa.**
    > #16: *"é a mesma empresa, cnpj 34776108000192, xp energy servicos de
    > medição, xpe tecnologia, xpe consultoria xpe obras tudo é uma coisa só"*

13. **Onde não houver evidência, indeterminado com motivo — nunca um número
    plausível.** (#40, regra 3; e é o segundo princípio de `OBJETIVOS_METAS.md`)

14. **A mesma obrigação não pode ser somada em duas camadas.** (#40, §9)

15. **O teto de fonte é aceito.**
    > #37: *"tudo que adryan tem tá na plataforma, o que nao tiver como
    > infelimente vai ficar pendente"*

16. **Escopo é 2026.** (#27)

17. **Tudo que precisa de decisão humana tem tela e notificação.** (#40)

---

# 5. O que já está entregue — com evidência medida

Não uso a palavra "feito" sem número ao lado.

**A régua zero, de pé** [medido, `painel-financeiro.mjs`]:

```
✓ asaas              R$ 78.655,13     último: há 2 dias
✓ nubank             R$ 11.682,57     último: há 2 dias
✓ inter              R$  1.576,59     último: há 2 dias
✓ nubank-caixinhas   R$ 27.700,17     último: há 2 dias
✓ caixa-aplicacao    R$      0,00     sem lançamento
✓ caixa-emprestimo   R$      0,00     sem lançamento
                     ─────────────
consolidado          R$ 119.614,46    6/6 contas fecham
```

**Os indicadores de 2026** [medido], meta 90%:

| indicador | agora | |
|---|---|---|
| lastro de origem | 99,1% (3.843/3.878) | ✅ |
| contraparte identificada | 98,5% (3.342/3.393) | ✅ |
| transferência resolvida | 98,0% (3.802/3.878) | ✅ |
| categoria atribuída | 97,1% (3.766/3.878) | ✅ |
| revisão concluída | 90,7% (3.518/3.878) | ✅ no limite |
| núcleo definido | 90,6% (3.074/3.393) | ✅ no limite |
| **centro de custo** | **1,1% (39/3.393)** | ❌ teto de fonte — dúvida 19 |

**A camada de contratos** [medido]: 37 funções `get*` tipadas, **32 com rota
HTTP**. As 5 sem rota são todas do território da fila de pagamento —
`getFilaPagamento`, `getSolicitacao`, `getLotes`, `getAlcadas`, `getFilaCompra` —
e estão bloqueadas pela dúvida 27, não por trabalho. Isto contradiz o
`MAPA_CONCLUSAO.md`, que mediu 9 rotas: **as 23 rotas foram entregues depois**
(commits `225db83`, `4d2f9d6`, `2ad281f`, `8256805`, `67a37d9`).

**As telas que existem** [medido]: 15 páginas em `app/financeiro`, 29 componentes
somando 8.462 linhas, navegação em `FinShell` com 15 itens.

**A fundação visual** [medido]: `components/financeiro/Certeza.tsx`, 169 linhas —
`Medida` com quatro estados, `SeloCamada` com as 5 camadas de certeza,
`Ressalva`, `LinhaLacuna`. É o princípio 02 do plano aprovado ("ausência não é
zero") virando código.

**O que a base responde hoje sem planilha paralela:** DRE mensal em duas visões
(64 meses), balanço gerencial fechando com R$ 0,00 não conciliado [doc], fluxo de
caixa, previsão de recebimento em 5 camadas, folha com histórico e previsão (28
pessoas, 117 contratos de remuneração [doc]), cartão com 3 emissores e 12
subcartões [doc], curva ABC de receita, apuração tributária como insumo.

---

# 6. O que falta, ordenado

## (a) Trabalho alcançável com as fontes existentes — nada trava

Ordenado por quanto cada item destrava, não por facilidade.

1. **A DRE expansível (P3).** Zero trabalho de banco: `fin_dre_lancamento_v` já
   entrega o drill. É a tela de melhor razão entre valor e custo de toda a lista.
2. **A tela de cobertura & auditoria (T13).** `getCobertura` e `getAuditoria` têm
   rota; os 41 invariantes e 24 monitores só existem no terminal. É a tela que
   sustenta a confiança em todas as outras — o plano aprovado a coloca na
   **etapa 2**, antes de qualquer relatório.
3. **A busca da central de categorização (P2.2–P2.5).** Filtro por valor, nome,
   tipo e categoria sobre populações que já existem.
4. **O CRUD de categoria (P2.7-A).** Nenhuma rota escreve em `fin_category` hoje;
   e há um caso concreto esperando (IOF, 133 itens).
5. **A tela de cartões (T04).** Contrato e rota prontos, nenhuma página.
6. **A unificação da fila** — trazer os 500 itens de cartão e os 802 documentos
   nunca resolvidos para a mesma fila medida. (FRENTE 2 do `MAPA_CONCLUSAO.md`,
   migration 0096 reservada.)
7. **Os 802 documentos da fila que nunca foram resolvidos uma vez.** 52% da fila
   por contagem, R$ 627.931,42 [doc]. Quem atacar a fila pelo topo vai resolver
   `fin_transaction` de novo e nunca chegar neles.
8. **E1, o app do time** (reembolso, custo, nota, pedido de compra, link de
   compra) — é trabalho, não bloqueio.
9. **E2, notificações.**

## (b) Bloqueado por decisão ou dado que só ele fornece

As sete que travam telas inteiras, por impacto [valores em R$, doc]:

| # | pergunta | trava qual tela |
|---|---|---|
| **28** | Onde nasce a conta a pagar? | **T06 inteira**, e o "confirmar" da P1 na leitura (B) |
| **27** | Quais são as faixas de alçada? | **T07 inteira** — `fin_approval_rule` tem 0 linhas por decisão de projeto |
| **21** | Em que conta contábil ficam os MEIs? (R$ 264.206,66) | **T11** — decide o Fator R e o anexo do Simples |
| **5** | Extrato da 7ª conta Caixa e contrato do Pronampe (R$ 147.062,10) | **T02, T13** — o "6/6 fecham" é 6 de 7 |
| **32** | A reserva tem alvo R$ 230.547,86 e saldo zero: descontar qual? | **T08** — hoje o alarme toca todo dia |
| **19** | O Adryan carimba projeto retroativo jan–jun? | o único indicador vermelho (1,1%); sem segundo caminho |
| **34** | O buraco de R$ 43.059,77/mês na previsão de saída | **P1** — a previsão é otimista em ~28% |

Mais as quatro ambiguidades desta sessão (seção 2.1): o que "confirmar"
significa; "cadastrar um novo" é categoria ou lançamento; "tirar de um para
outro" é reclassificar ou reagrupar; "adicionar algo" na DRE.

E as 57 dúvidas de `DUVIDAS_FINANCEIRO.md`, das quais 2 já foram respondidas no
corpo do arquivo [medido].

## (c) Já coberto pelas 4 frentes rodando agora

Segundo o que me foi informado ao abrir esta tarefa, quatro frentes escrevem
agora com as migrations **0100 (custos previstos)**, **0101 (categorização)**,
**0102 (DRE drill)** e **0103 (identificação)**.

> [medido, enquanto eu escrevia] **nenhuma das quatro existia em
> `db/migrations`** — o maior número no diretório era `0099`, e a árvore estava
> limpa exceto por um arquivo temporário. **Minutos depois, ao commitar este
> documento, as quatro apareceram** como arquivos não rastreados —
> `0100_fin_custo_previsto.sql`, `0101_fin_categorizacao_central.sql`,
> `0102_fin_dre_drill.sql`, `0103_fin_identificacao.sql` — junto de
> `lib/financeiro/contratos/categorizacao.ts`,
> `app/api/financeiro/gerencial/categorizacao/` e dois testes novos. As frentes
> estão entregando agora; nada disso entrou no meu commit.

O mapeamento delas para este documento é direto, e é bom sinal — as quatro
atacam exatamente os três pedidos de #73 mais a fila de identificação:

| frente | cobre | o que **não** cobre e continua faltando |
|---|---|---|
| **0100 custos previstos** | P1.1–P1.3 e provavelmente P1.4 | P1.5 (adicionar), a trava anti-dupla-contagem, e a decisão sobre o que "confirmar" significa |
| **0101 categorização** | P2.1, P2.6, P2.9, P2.10 | busca por valor/nome/tipo (P2.2–P2.5) e o CRUD de categoria (P2.7) — confirme com a frente |
| **0102 DRE drill** | P3.1–P3.3 | P3.4 ("tirar de um para outro") e P3.5 ("adicionar algo"), ambos ambíguos |
| **0103 identificação** | P2.10, e parte dos 360 indeterminados | os 500 itens de cartão, se a frente não os incluir |

---

# 7. Critério de aceite por tela

Verificável, não subjetivo. Cada linha é uma afirmação que alguém consegue
provar rodando algo.

**P1 · Previsão de custos do mês**
- [ ] A tela lista os **51 eventos de saída** dos próximos 45 dias, item a item,
      e o total confere com `SELECT sum(valor_cents) FROM fin_previsao_evento_v`
      na mesma janela.
- [ ] Todo evento aparece sob um grupo do plano de contas; os que não têm
      categoria aparecem sob **"sem categoria"** hachurado, com a contagem
      visível (hoje seriam 29 de 51) — nunca escondidos num "outros".
- [ ] A cobertura da previsão de saída está impressa na tela como número
      (71,7% hoje) com a frase do viés.
- [ ] "Confirmar todos" existe, é reversível, deixa trilha em `fin_audit_log`, e
      **não altera o saldo de nenhuma conta** (âncora de dinheiro).
- [ ] Adicionar um custo previsto exige data, valor, categoria e contraparte, e o
      item criado é distinguível na tela dos que vieram de fonte.
- [ ] Depois de confirmar e adicionar, `painel-financeiro.mjs` continua com
      **6/6 contas fecham**.

**P2 · Central de categorização**
- [ ] Busca por valor exato e por faixa devolve o mesmo conjunto que a consulta
      SQL equivalente.
- [ ] Busca por nome cobre descrição **e** contraparte.
- [ ] O filtro "sem categoria" devolve, somados, os **389 documentos**, os
      lançamentos sem `category_id` e os **500 itens de cartão** — ou declara na
      tela quais populações ainda não estão incluídas.
- [ ] Trocar a categoria de uma linha grava `human_locked_fields` e a decisão
      **não é sobrescrita** pela próxima passagem do classificador (o teste é
      rodar o classificador depois e verificar que o valor permaneceu).
- [ ] Criar categoria valida `code`, `dre_line` e `cash_flow_group`, e a
      categoria nova aparece imediatamente nos filtros.
- [ ] A fila "duvidoso" mostra os **7 motivos** de `fin_indeterminado_v` com
      contagem e valor, e cada item mostra a evidência que sustenta o candidato.
- [ ] Nenhuma ação da tela apaga lançamento; duplicata é neutralizada com
      caminho de volta.

**P3 · DRE expansível**
- [ ] Cada linha da DRE expande e a soma dos filhos **bate com o pai**, centavo a
      centavo, nas duas visões.
- [ ] O drill chega ao lançamento individual e o caminho de volta preserva mês,
      visão e filtros.
- [ ] A visão **caixa** é a padrão (regra 1 da seção 4); trocar para competência
      exibe a ressalva do mês corrente (`folha_do_mes_ja_paga`).
- [ ] As lacunas aparecem **dentro** da DRE, indentadas sob o grupo a que
      pertenceriam — não em rodapé.
- [ ] Mover um item de uma linha para outra deixa trilha, trava o campo contra
      sobrescrita, e o total do mês muda de forma explicável.
- [ ] `test:contabil` continua com 0 falhas depois de qualquer movimentação.

**T13 · Cobertura & auditoria**
- [ ] A matriz mostra linha por fonte com período, quantidade, valor, última
      sincronização e lacunas.
- [ ] As **2 contas sem cobertura** aparecem como *sem cobertura*, jamais como
      R$ 0,00.
- [ ] A 7ª conta (`caixa-economica-…3433`) aparece com status
      `conta_fora_do_ledger`.
- [ ] Os invariantes aparecem com o valor em jogo e distinguem falha, bloqueio de
      dado e "passa por vácuo".

**Critério transversal, válido para toda tela deste módulo** (é o teste final do
plano que ele aprovou):

> Mostre a tela para alguém que não conhece a base e pergunte: *"quanto disso o
> sistema realmente sabe?"* Se a pessoa precisar perguntar, a tela falhou.

E o critério que ele mesmo escreveu para o fim do trabalho (#40):

> *"Se ainda faltar qualquer regra de negócio, ingestão, conciliação, modelo,
> teste, API ou dado alcançável pelas fontes existentes, não diga que falta
> apenas design."*

Pela medição desta sessão: **ainda não falta apenas design** — mas o que falta na
base encolheu muito. Das três lacunas que o `MAPA_CONCLUSAO.md` nomeou em
16/08 (27 rotas, 500 itens de cartão, aferição da previsão), **a primeira foi
fechada** (32 de 37 contratos com rota, e as 5 restantes são bloqueio de decisão)
e a terceira ganhou instrumento (0097). O gargalo mudou de lugar: hoje ele está
nas **telas** e nas **57 decisões que só o Fernando toma**.

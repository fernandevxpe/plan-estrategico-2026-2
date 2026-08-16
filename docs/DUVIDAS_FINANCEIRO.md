# Dúvidas acumuladas — decisões que só o Fernando pode tomar

Registro vivo. O trabalho **não para** enquanto uma dúvida está aberta: a frente
segue até onde a evidência permite, o item fica marcado como indeterminado no
banco, e a pergunta espera aqui com as opções.

Regra que gera entrada nesta lista: *diante de duas classificações possíveis sem
evidência que as separe, não escolher.* Um número que parece certo é pior que um
vazio declarado.

| # | Assunto | Valor em jogo | Status |
|---|---|---|---|
| **0** | **Pró-labore → Salários (205 linhas)** | **consequência tributária** | **aberta · prioritária** |
| 1 | Movimentos Asaas 2021–2023 sem contraparte | R$ 215.500,00 | **aberta** |
| 2 | Rateio do custo que não é de projeto | recorrente | **aberta** |
| 3 | Caixinhas: histórico completo ou abertura declarada | R$ 31.300,88 de defasagem | **aberta · medida na 0043** |
| 4 | As 169 transferências pré-2026 | R$ 2.224.767,97 (167 pernas) | **aberta · mitigada na 0044** |
| 5 | Conta Caixa fora do ledger — nº `12920000005783083433` | R$ 147.062,10 + R$ 25.400,00/ano | **aberta · conta identificada** |
| 6 | 75 PIX próprios sem categoria | neutro na DRE | **aberta** |
| 7 | 18 clientes do ERP sem CNPJ (contrato → contraparte) | R$ 291.720,00 contratados | **aberta** |
| 8 | Valor por serviço em contrato multisserviço | R$ 647.131,00 em 52 contratos | **aberta** |
| 9 | Contratos de eixo AMBOS (obras + consultoria) | R$ 76.953,60 | **aberta** |
| 10 | 138 parcelas vencidas sem cobrança emitida | R$ 402.676,93 | **aberta** |
| 11 | Categoria dos 2 pagamentos que o par falso escondia | R$ 3.000,00 | **aberta** |
| 12 | Repasse de R$ 600 pela conta do sócio | R$ 600,00 | **aberta** |
| **13** | **Contraparte da taxa do Asaas: o cliente ou o Asaas?** | R$ 2.049,85 em 1.565 linhas | **aberta · bloqueia o `--aplicar` da F1** |
| 14 | CNPJ do Asaas (só o ISPB é evidência) | cadastro | **aberta** |
| 15 | Estender a F1 a 2021–2025 (sai de graça) | 7.839 linhas | **aberta · decisão de escopo** |
| 16 | 31 lançamentos ambíguos do Nubank (mesmo dia, mesmo valor) | 31 linhas sem lastro | **aberta · marcadas no banco** |
| 17 | Estorno: o Polp não mostra, o CSV mostra | 12 linhas, líquido zero | **aberta · não afeta caixa** |
| 18 | 42 contrapartes com CNPJ fora do cadastro | 227 linhas | **aberta · destrava a E2** |
| 19 | Centro de custo para em 13%: o ERP só carimbou 112 | 739 linhas sem projeto | **aberta · depende do erp-obras** |
| **37** | **Os 149 valores de referência vieram de um arquivo que não temos** | R$ 2.105.576,09 de massa comparada | **aberta · bloqueia toda a frente do previsto** |
| **38** | **Qual planilha substitui a "Fluxo de Caixa"** | as 91 linhas do modelo | **aberta · nenhuma das 12 abas serve** |
| 39 | Comissão: 5% em 4 parcelas ou a escala por volume? | R$ 44.205,66/ano entre as duas regras | **aberta · a planilha declara as duas** |
| — | XPE Tecnologia é a própria empresa? | R$ 25.400,00/ano | ✅ respondida |

---

## 0. Pró-labore → Salários — 205 linhas, e isso mexe com imposto

**Descoberto ao validar a frente do lastro do PIX, não como parte dela.**

O motor de classificação nunca rodou sobre o extrato do Inter. Rodá-lo hoje
aplicaria **450 mudanças**, das quais **258 são trocas de categoria** — e **205
delas movem lançamentos de `6.02 Pró-labore` para `6.01 Salários`**, por conta da
regra genérica `pix-pessoa-fisica` (prioridade 200, confiança 60).

**Por que isto é sério:** pró-labore e salário têm encargo e IR diferentes.
Trocar 205 linhas de categoria não é ajuste cosmético — muda a base do que a
empresa declara.

**Isto é deriva pré-existente, não efeito da frente atual.** A regra do CNPJ
próprio, que acabou de ser criada, muda **zero** classificações: testada A/B na
réplica, o resultado é idêntico com e sem ela. Ela ganha em determinismo (vence
por documento, não por grafia do nome), não em cobertura.

**Trava ativa:** `reclassificar.mjs --conta=inter` **não pode ser rodado no
automático** enquanto isto não for decidido, senão as 205 pegam carona numa
execução de rotina.

**Opções:**
- **(a)** Confirmar que são salários e aplicar.
- **(b)** Travar as 205 linhas atuais com `human_locked_fields` — a classificação
  atual passa a resistir a qualquer reclassificação futura.
- **(c)** Estreitar a regra `pix-pessoa-fisica` por CPF, agora que o documento da
  contraparte existe no ledger: quem é sócio vira pró-labore, quem é empregado
  vira salário, por documento e não por heurística.

A **(c)** é a que resolve a causa; **(b)** é o freio de mão até você decidir.

## 6. Os 75 PIX próprios sem categoria

Transferências para a própria XPE, comprovadas por CNPJ, já `pareado` e
**neutras na DRE** — só estão sem categoria atribuída. Não movem dinheiro nem
resultado; é organização.

**Opções:** *(a)* deixar como está · *(b)* preencher `9.01` por statement dirigido
apenas onde `counterparty_document` = CNPJ da casa e a categoria está nula ·
*(c)* permitir ao reclassificador preencher categoria **nula** em linha `pareado`
sem rebaixar o status de conciliação.

---

## 1. Os 20 movimentos do Asaas de 2021–2023

**O que é:** 15 TEDs (R$ 176.000) e 5 PIX sem nome de recebedor (R$ 39.500) que
saíram da conta Asaas entre 2021-11 e 2023-07.

**Por que não dá para resolver por dado:** Inter e Nubank só existem neste ledger
a partir de 2026-01-01, então não há contra-perna para conferir. `/transfers` e
`/pix/transactions` do Asaas respondem **403** — é lá que estaria o CNPJ da conta
de destino. O erp-obras não tem vínculo para esses.

**Evidência a favor de serem transferência para a própria conta:** valores
redondos, cadência de início de mês, produto "saque para conta bancária".

**Evidência contra:** TED e PIX-nomeado-para-XP-ENERGY conviveram nos mesmos
dias — em 2023-03-02 saíram dois TEDs (R$ 5.000 e R$ 8.000) *e* dois PIX
nomeados para XP ENERGY (R$ 20.000 e R$ 2.000). Quem varre caixa para a própria
conta não usa dois trilhos no mesmo dia.

**Opções:**
- **(a)** Você reconhece pela lista de datas e valores e diz o que era.
- **(b)** Pedir ao Asaas uma chave com escopo de saque — `/transfers` passaria a
  responder e resolveria os 20 de uma vez, com CNPJ de destino.
- **(c)** Marcar como "transferência provável, não comprovada", isolada num
  status próprio: não entra na DRE, mas fica visível como pendência em vez de
  virar despesa silenciosa.
- **(d)** Deixar como despesa não classificada (**não recomendo** — infla o custo
  de 2021–2023 em R$ 215.500 sem base).

> Os 5 PIX sem nome têm um argumento extra: todos são anteriores a 2022-09-02, e
> de setembro/2022 em diante **todo** PIX de transferência carrega o nome do
> recebedor. É plausível que sejam o mesmo comportamento sob formato antigo — mas
> isso é inferência de formato, não lastro.

## 2. Rateio do custo que não é de projeto

**O que é:** você mesmo levantou — *"tem coisas que é difícil dizer que pertence
a tal serviço"*. Aluguel, software, energia, salário de quem atende várias obras.

**Por que importa:** metade do custo sem dono faz toda margem por obra parecer
melhor do que é. A migration `0031` já documenta esse risco em outro contexto.

**Opções (não excludentes — pode ser regra diferente por categoria):**
- **(a)** Rateio por receita do período: quem faturou mais absorve mais custo.
- **(b)** Rateio por número de projetos ativos no mês.
- **(c)** Rateio por horas apontadas — o erp-obras tem `clickupTimeSpentMs` por
  tarefa, então existe base para isso.
- **(d)** Não ratear: fica como "custo de estrutura" e a margem por obra é
  margem de contribuição, não lucro. **Mais honesta e mais simples**; a decisão é
  se você quer margem de contribuição ou lucro por obra.

## 3. Caixinhas: histórico completo ou abertura declarada

**Antes de tudo, uma correção de número.** Este item dizia que o saldo real era
**R$ 26.408,97** em 62 RDBs, 17 ativos. Está errado, e o erro é da fonte:
`GET /integrations/2906/investments` declara `meta.total = 66`, devolve 66 linhas
em 5 páginas e **só 62 são distintas** — a ordenação é instável, 4 posições vêm
duas vezes e 4 nunca aparecem. Uma das invisíveis, a `10121` (emitida em
22/06/2026), está **ACTIVE com R$ 1.291,20**.

O saldo real é **R$ 27.700,17** em **66 RDBs, 18 ativos**. A defasagem contra os
R$ 59.001,05 exibidos é de **R$ 31.300,88**, não R$ 32.592,08.

> ⚠️ **O erp-obras lê a mesma API.** Se ele consome esse endpoint paginando sem
> tratar a instabilidade, está exibindo R$ 26.408,97 pelo mesmo motivo. Vale
> conferir do lado de lá — o script `sync-polp-investimentos.mjs` fecha o buraco
> varrendo a faixa de ids e se recusando a gravar enquanto a contagem não bater
> com `meta.total`.

**O que ficou resolvido:** a `0043` modela as posições e o
`sync-polp-investimentos.mjs` traz agosto. Escolhida a opção **(b)**, e a razão
está abaixo. As opções **(a)** e **(c)** continuam de pé como decisão sua.

**Por que (b), e não (a), agora:** julho já entrou por um lote de importação do
PDF (`fin_import_batch` 4, com desfazer). Reingerir o histórico inteiro pelo
Polp exigiria reverter esse lote e reescrever 19 linhas que hoje batem ao
centavo com o documento do banco — risco real em troca de elegância. E a
abertura da `0039` saiu **confirmada** por um caminho independente: o principal
acumulado no Polp em 30/06 é R$ 6.638,50, exatamente o que a `0039` rastreou no
erp-obras; a diferença para os R$ 7.003,18 declarados são R$ 364,68 de
rendimento apropriado, e o PDF de julho confirma esse número ao imprimir
"Rendimento até essa data R$ 102,53" (467,21 − 364,68 = 102,53, exato).

**O que a opção (a) ainda compraria** — e por isso ela continua aberta:
- O Polp tem a carteira completa desde **28/12/2025**, e ela concilia com o
  extrato da conta corrente em **54 dos 55 dias** ao centavo. O único dia fora é
  a própria compra de abertura, de 28/12/2025, anterior ao início do extrato do
  Nubank aqui.
- Com o histórico dentro, a abertura declarada **deixa de ser necessária** — o
  saldo passaria a ser consequência de movimento, não de declaração.
- E as **67 pernas de RDB anteriores a 30/06** que hoje ficam em `em_transito`
  na conta corrente (R$ 661,50 líquidos) passariam a ter par, movendo o
  indicador de transferência resolvida.

**Opções que continuam suas:**
- **(a)** Ingerir também o histórico anterior a julho, reverter o lote 4 e
  dispensar a abertura declarada. Definitivo, e mexe em linha que hoje bate.
- **(b)** ✅ *feito* — agosto pelo Polp, abertura de 30/06 mantida e agora
  confirmada por terceira fonte.
- **(c)** Uma `fin_account` por RDB. **Recomendo não:** são 66 posições, ~10 novas
  por mês e 48 já liquidadas; `fin_account` é a dimensão que o painel enumera
  ("as 6 contas") e viraria log. A `0043` entrega a mesma visibilidade por
  aplicação em `fin_investment`, sem custo no cadastro de contas.

### 3.1 O ajuste de marcação de R$ 2,57 — posto ou marcado como indeterminado?

Rendimento de RDB é creditado **dentro** da aplicação e nunca passa pela conta
corrente. Entre 31/07 e 15/08 esse rendimento apropriado variou **−R$ 2,57**
(caiu porque posições antigas, que já carregavam rendimento, foram resgatadas e
o rendimento saiu junto no dinheiro que voltou).

O `sync` lança esses R$ 2,57 como `9.12 Ajuste de marcação de aplicação`, com o
cálculo escrito na própria linha e um teto declarado (o rendimento não realizado
da carteira, R$ 464,64) que aborta a gravação se o resíduo for maior — porque aí
não seria marcação, seria movimento faltando.

É medido, não chutado, mas **a base de julho (R$ 364,68 em 30/06) é derivada, não
impressa por ninguém**. Se você baixar o **extrato de Caixinhas PJ de agosto**
(o Nubank emite mensal, é o mesmo PDF do lote 4), a linha "Rendimento até essa
data" fecha isso contra o documento do banco.

- **(a)** ✅ *feito* — postar os R$ 2,57 com nome, cálculo e teto.
- **(b)** Não postar, deixar a conta em R$ 27.702,74 e marcar R$ 2,57 como
  indeterminado até o PDF de agosto chegar. Mais conservador, e a conta passa a
  divergir da API em R$ 2,57.

### 3.2 As 4 reservas continuam sem divisão

A `0014` apontou as reservas para a conta e deixou `fin_reserve.current_cents`
zerado de propósito: quanto de cada uma das quatro está dentro do saldo é rateio
que só a empresa faz. Isso **não mudou** — mas agora existem 18 RDBs
identificados, com data e valor, e a divisão poderia ser amarrada a posições
reais em vez de a um percentual. Se cada caixinha do app do Nubank corresponde a
uma finalidade, o mapa é seu para declarar.

## 4. As 169 transferências anteriores a 2026

**O que é:** R$ 2.234.777,97 marcados `em_transito` que **não são erro**: são
saídas do Asaas para contas cujo extrato só começa em 2026-01-01. Sem a outra
perna, não há par possível.

**Confirmado (15/08/2026, frente A6):** existem **zero** linhas em qualquer conta
que não a Asaas antes de 2026-01-01. Não é falha de pareamento, é ausência de
acervo. Duas das 169 saíram por outro motivo (eram estorno na própria conta —
ver `0044`), então o saldo da pergunta é **167 pernas, R$ 2.224.767,97**.

**Por que perguntar:** hoje elas ficam eternamente "em trânsito", poluindo o
indicador e sugerindo pendência onde há impossibilidade estrutural.

**Opções:**
- **(a)** Status próprio, tipo `sem_cobertura`: sai do indicador de pendência e
  fica explícito o motivo. — **desaconselhado, e a medição mostra por quê:** o
  indicador é `transfer_status <> 'em_transito'`, então qualquer status novo
  conta como resolvido. As 167 saltariam o número de 98,0% para ~99,2% sem que um
  único fato fosse estabelecido. É inflar trocando o rótulo.
- **(b)** Importar o histórico de Inter e Nubank anterior a 2026 — resolveria
  estas **e** as 20 do item 1. Depende de conseguir os extratos antigos.
- **(c)** Deixar como está.
- **(d) — implementada na `0044`, e é o meio-termo honesto:** elas **continuam**
  em `em_transito` e continuam pesando no indicador, mas ganham a coluna
  `transfer_unresolved_reason = 'sem_cobertura_extrato'`. O painel passa a
  mostrar, embaixo do percentual, quanto do que falta é **acionável** (93) e
  quanto é **impossibilidade declarada** (172). O número não melhora; a leitura
  dele melhora. Se um dia o histórico entrar, o motivo se apaga sozinho e o motor
  volta a procurar par — a coluna se limpa por gatilho quando a perna sai de
  `em_transito`, não por disciplina de quem escrever o próximo script.

**(d) não fecha a pergunta, só para de mentir enquanto ela está aberta.** A
decisão que interessa continua sendo (b): existe como conseguir os extratos de
2022–2025 do Inter e do Nubank?

## 5. O empréstimo Caixa que o ledger desconhece

**O que é:** a migration `0036` registra que a planilha traz um empréstimo Caixa
de **R$ 147.062,10** captado em 2024, e que as contas `caixa-aplicacao` e
`caixa-emprestimo` seguem com **zero lançamentos**. Um passivo dessa ordem fora
do sistema distorce qualquer visão de saldo consolidado.

Também: 7 transferências de 2026 (R$ 37.636,44) saíram nomeadas para a XPE e não
têm contra-perna em conta nenhuma — essas contas Caixa são o destino provável.

**Medido na frente A6 (15/08/2026) — o "provável" virou número de conta.**

Das 7, **3 tinham contra-perna sim**, no Nubank, e ninguém tinha visto porque o
motor de pareamento só olhava linhas `em_transito` e os créditos do Nubank
nascem `nao`. Foram pareadas. Sobram **4 (R$ 24.120,00)**: #2169 (04/01,
R$ 5.000), #1921 (03/02, R$ 6.400), #1042 (05/05, R$ 6.320), #727 (08/06,
R$ 6.400). Conferido contra o JSON cru do Inter: **nenhum crédito de valor exato
em ±4 dias**, e não há buraco de dias no extrato — não é importação faltando,
é dinheiro que foi para outro lugar.

E o outro lado apareceu. Os 5 PIX do Inter que ficavam "destino Caixa" trazem,
no extrato do Banco Central, o destinatário completo — **e são os cinco para a
mesma conta**:

```
nomeRecebedor           Xpe Tecnologia
cpfCnpjRecebedor        34776108000192          ← o CNPJ da casa
nomeEmpresaRecebedor    CAIXA ECONOMICA FEDERAL
contaBancariaRecebedor  12920000005783083433
```

São R$ 25.400,00 em 2026 saindo para **uma sétima conta bancária, real, da
própria empresa**, que o ledger não cobre. Isso reenquadra a pergunta: não é só
o empréstimo de 2024 que está fora — existe uma conta corrente da Caixa em uso
**hoje**, e enquanto ela não entrar, o "6/6 contas fecham" da regra zero está
medindo 6 de 7.

As 4 órfãs acima podem ter ido para essa mesma conta — plausível, **não
provado**: o Asaas não diz o banco de destino e `/transfers` responde 403.
Ficam indeterminadas.

**Opções:**
- **(a)** Importar o extrato da conta Caixa `12920000005783083433` — resolve os
  R$ 25.400,00, provavelmente as 4 órfãs, e responde se o "6/6" é na verdade 6/7.
  **É a de maior retorno agora**, e o número da conta já está na mão.
- **(b)** Declarar o saldo das contas sem o extrato — **não recomendo**, fabrica
  precisão que não existe e contraria o princípio do projeto.
- **(c)** Modelar o empréstimo como passivo à parte, sem movimentar as contas.

**Pergunta direta:** dá para puxar o extrato dessa conta da Caixa? E ela é conta
corrente, aplicação ou a do empréstimo — ou seja, `caixa-aplicacao` /
`caixa-emprestimo` já são ela com nome errado, ou falta uma terceira?

---

## 7. Os 18 clientes do ERP sem CNPJ

**Frente B4, contratos e parcelas.** O casamento cliente ↔ contraparte é **por
documento e só por documento**: 127 dos 148 contratos casam (85,8%), cobrindo
R$ 1.358.659,57 dos R$ 1.409.159,57 de cronograma (96,4%).

Dos 21 que não casam, **18 estão sem CNPJ no erp-obras**. E para quase todos
existe aqui uma contraparte de nome praticamente idêntico **e com CNPJ**:
"Condomínio do Edifício Del Mar" daqui tem `40817439000126`; o do ERP tem nada.

**Por que não liguei por nome:** é exatamente o erro que a frente A6 existe para
desfazer — dois pareamentos casados por coincidência, escondendo R$ 3.000 de
receita e R$ 3.000 de despesa reais. Ligar 18 contratos por semelhança de nome
acerta a maioria e erra em silêncio o resto.

**Opções:**
- **(a)** Confirmar um a um a partir de `erp_contrato_indeterminado_v`, que já
  lista nome, valor e motivo.
- **(b)** Corrigir o CNPJ no cadastro do erp-obras — resolve na origem e
  aproveita para todo mundo, mas está fora do nosso alcance (banco somente
  leitura deste lado).
- **(c)** Deixar indeterminado. **É o estado atual.**

Dois casos à parte, que são erro de cadastro no ERP e só se corrigem lá:
- cliente **57** ("CONDOMÍNIO DO EDIFÍCIO ADERBAL JUREMA") está cadastrado com o
  **CNPJ da XPE** (34776108000192). O espelho **recusa** o casamento: contraparte
  com o CNPJ da casa é transferência entre contas próprias, jamais receita.
- cliente **134** ("XPE Lab") tem `00000000000191`, placeholder.

E um para conferir: cliente **97** ("Edf. Morada Rosarinho", CNPJ
`11419309000137`) casa por documento com a contraparte **163** ("CONDOMÍNIO DO
EDIFÍCIO JOÃO HERACLIO"). O documento manda e a ligação está feita, mas um dos
dois cadastros está errado.

## 8. Quanto vale cada serviço num contrato multisserviço

**52 contratos têm 2 a 4 serviços** (R$ 647.131,00) e o erp-obras guarda **quais**
serviços, nunca **quanto** cada um vale. Sem isso, "ticket por tipo de serviço"
não tem resposta exata para esses contratos.

`erp_ticket_tipo_servico_v` devolve as duas leituras lado a lado e não escolhe:
`ticket_exato_cents` usa só os 67 contratos de serviço único e é fato;
`ticket_rateado_cents` divide o contrato igualmente e é **suposição declarada**.

A diferença não é acadêmica. Em Projeto Elétrico (PE) o ticket exato é
R$ 4.000,00 (1 contrato) e o rateado é R$ 6.701,58 (20 contratos) — 68% acima.

**Opções:**
- **(a)** Rateio igual, assumido e documentado.
- **(b)** Tabela de preço de referência por tipo de serviço, e o rateio segue
  a proporção dela.
- **(c)** Só reportar ticket de contrato de serviço único. **É o padrão atual**,
  com (a) ao lado, rotulado como suposição.

## 9. Os 3 contratos de eixo AMBOS

R$ 76.953,60 em contratos marcados `AMBOS` (obras **e** consultoria).
`fin_contract.kind` aceita um valor só, e não há dado no ERP que reparta.
Ficam com `nucleo` e `kind_ledger` nulos — indeterminado declarado.

**Opções:** (a) tratar como consultoria; (b) como obras; (c) manter
indeterminado até haver rateio declarado. **Hoje: (c).**

## 10. As 138 parcelas vencidas que nunca viraram cobrança

O número que só apareceu quando as duas camadas ficaram lado a lado:
**R$ 402.676,93 em parcelas de contrato já vencidas e sem cobrança emitida no
Asaas** — contra R$ 201.502,00 de cobrança faturada e vencida, que é o que o
ledger sozinho enxergava.

Não é receita a receber com a mesma confiança: parcela é **previsão**, cobrança é
**fato**. Uma parcela vencida sem cobrança significa uma de três coisas, e o dado
não separa:

- **(a)** faturamento atrasado — é a receber de verdade e ninguém emitiu;
- **(b)** recebida por fora do Asaas (PIX direto, boleto Inter) e o ERP nunca foi
  atualizado — o `status` da parcela não serve de árbitro: 470 das 471 estão
  `PREVISTA` e apenas 1 `PAGA`, enquanto o ledger mostra 186 cobranças
  correspondentes já liquidadas;
- **(c)** contrato que não andou e a parcela deveria estar cancelada.

**A pergunta:** qual dessas três, e por qual regra decidir sozinho na próxima vez?
Enquanto não houver resposta, `fin_receber_aberto_v` devolve as duas camadas
separadas pela coluna `camada`, e nenhuma soma as duas sem dizer.

---

## 11. Os dois pagamentos que estavam escondidos atrás de um par falso

**O que é:** a frente A6 desfez dois pareamentos falsos (migration `0044`). Eles
casavam, por coincidência de valor e data, um recebimento de cliente com um
pagamento a fornecedor sem nenhuma relação — e as duas pontas sumiam do
resultado juntas.

A prova é o extrato PIX do Banco Central: numa transferência entre contas
próprias, pagador **e** recebedor têm o CNPJ da casa. Nestes dois, o pagador é a
casa e o recebedor é terceiro.

| linha | data | valor | recebedor | documento |
|---|---|---|---|---|
| #76675 | 24/04/2026 | R$ 400,00 | Recifemecatron | CNPJ 20169634000180 |
| #76826 | 12/06/2026 | R$ 2.600,00 | Maria De Fatima Gondim Carvalho | CPF 03215011441 |

As receitas do outro lado (#1162 ARLINDO R$ 400 · 3.01, #696 CONDOMÍNIO ARA
PACIS R$ 2.600 · 3.03) voltaram a contar com a categoria que sempre tiveram.

**O que ficou aberto:** as duas saídas estavam categorizadas como `9.01
Transferência entre contas próprias`, que está **provadamente errado**. Qual é a
categoria certa depende de saber o que foi comprado — e isso não está em lugar
nenhum do dado. As duas estão com **categoria nula e `review_status='pendente'`**:
um vazio declarado, em vez de um rótulo inventado.

**Pergunta:** o que foram esses dois pagamentos? Recifemecatron (fornecedor,
Recife) e Maria de Fátima — serviço, material, comissão?

---

## 12. O repasse de R$ 600 que passou pela conta do sócio

**O que é:** o grupo `cb248b2d-647a-4465-b722-1693b0af42b3` pareia

- #76851 · Inter · 18/06/2026 · **−R$ 600,00** · "Pix enviado — Fernando De Siqueira Campos Silva"
- #75544 · Nubank · 17/06/2026 · **+R$ 600,00** · "Transferência Recebida — Fernando de Siqueira Campos Silva"

**Não é o erro do item 11:** as duas pernas nomeiam a mesma pessoa, então é
coerente. Mas Fernando está cadastrado como `socio` (CPF 09694069408), e sócio
não é a empresa. Pela regra do CNPJ da casa isto seriam **dois fatos** — uma
saída para o sócio e uma entrada vinda dele — e não uma transferência interna.

**Por que não decidi:** desfazer muda o resultado da empresa, e a diferença
entre "o dinheiro passou pela conta dele para chegar do outro lado" e "a empresa
pagou o sócio e depois ele devolveu" só quem estava lá sabe. O par **fica de
pé**, visível na vista `fin_transferencia_suspeita`.

O gatilho da `0044` recusa pares com cliente ou fornecedor, mas **deixa passar
sócio e colaborador de propósito** — justamente para não decidir isto no
automático.

**Opções:**
- **(a)** É repasse operacional (o dinheiro só passou pela conta dele): mantém
  pareado, e a regra vira "sócio pode ser ponte entre contas próprias".
- **(b)** São dois fatos: desfaz o par, a saída vira retirada/adiantamento e a
  entrada vira aporte/devolução.
- **(c)** Caso a caso, sempre com revisão humana — e aí o gatilho passa a
  recusar sócio também, forçando a decisão a cada ocorrência.

---

## 13. A contraparte da taxa do Asaas: o cliente ou o Asaas?

**O que é:** dos 1.762 lançamentos de 2026 da conta `asaas` sem contraparte,
**1.565 são taxa cobrada pelo Asaas** — 552 `PAYMENT_FEE`, 504 `INVOICE_FEE`,
456 `PAYMENT_MESSAGING_NOTIFICATION_FEE`, 53 `INSTANT_TEXT_MESSAGE_FEE`. Todas
já estão na categoria 4.05 (Tarifas bancárias e de cobrança).

Repare na assimetria antes de decidir: são **89% das linhas e 0,16% do
dinheiro** — R$ 2.049,85 no ano inteiro. A escolha quase não mexe em real; mexe
no que o ledger afirma, e no indicador, que conta linhas.

**Por que perguntar:** cada taxa carrega o `paymentId` da cobrança que a gerou,
então o cliente é alcançável com precisão total. Mas quem recebeu os R$ 1,99 foi
o Asaas. O cliente é a **causa** do custo, não a outra ponta dele. As duas
leituras são defensáveis e respondem a perguntas diferentes.

**O que já está resolvido de qualquer jeito:** a `0051` criou
`origin_document_id`, e o backfill grava nele a cobrança de origem **nas três
políticas**. A atribuição ao cliente ("quanto custa de tarifa atender o cliente
X") não se perde em nenhum cenário. O que está em jogo é só `counterparty_id`.

**Medido no dry-run (16/08/2026), indicador de 2026 em todas as contas:**

| política | linhas gravadas | indicador 2026 | conta asaas 2026 |
|---|---|---|---|
| `--taxas=asaas` (padrão proposto) | 1.618 | 44,1% → **85,9%** | 22,9% → **93,7%** |
| `--taxas=cliente` | 1.564 | 44,1% → 84,5% | 22,9% → 91,3% |
| `--taxas=nulo` | 1.554 | 44,1% → 45,5% | 22,9% → 25,2% |

**Opções:**
- **(a) `--taxas=asaas` — proposta.** Contraparte = Asaas IP S.A.
  (`instituicao_financeira`), origem = a cobrança do cliente. O ledger passa a
  dizer a verdade literal sobre para onde o dinheiro foi, e "custo de tarifa por
  cliente" sai de `origin_document_id`. É também a única que cobre as 53 taxas de
  WhatsApp, que não têm `paymentId` e por isso ficam sem cliente alcançável.
- **(b) `--taxas=cliente`.** Contraparte = o cliente da cobrança. Simplifica a
  pergunta "quanto esse cliente me custou" para um único campo, mas grava que o
  cliente foi a outra ponta de um dinheiro que ele não recebeu — e polui o
  histórico de cada condomínio com três linhas negativas de centavos por
  cobrança emitida.
- **(c) `--taxas=nulo`.** Deixa as taxas sem contraparte e grava só a origem.
  Honesto, e deixa o indicador praticamente onde estava.

---

## 14. O CNPJ do Asaas — só a raiz é evidência

**O que é:** a `0051` cadastrou "Asaas IP S.A." como contraparte institucional
**sem `document_number`**, de propósito.

**A evidência que existe:** 51 PIX recebidos do Asaas em
`data/raw/inter-extrato.json` trazem `nomeEmpresaPagador = "ASAAS IP S.A."` e
`endToEndId` começando em `E19540550…`. Os 8 dígitos após o "E" são o ISPB da
instituição, que para instituição financeira coincide com a **raiz** do CNPJ.
Raiz **19540550**, portanto, é carimbo do Banco Central.

**A evidência que não existe:** a filial e os dígitos verificadores. Nenhum
arquivo deste repositório os contém.

**Por que perguntar em vez de completar:** `fin_counterparty_document_idx` é
único por `(entity_id, document_number)`. Um CNPJ errado aqui **bloqueia o
cadastro do certo depois**, e o próximo backfill que encontrar o CNPJ real falha
na inserção sem explicar por quê. O vínculo das 1.5 mil taxas aponta para o
`id`, não para o documento — então preencher depois é um `UPDATE` de uma linha,
sem retrabalho nenhum.

**Opções:**
- **(a)** Confirmar o CNPJ (está em qualquer boleto ou no contrato do Asaas) e
  preencher. — recomendada, custo ~1 minuto.
- **(b)** Deixar sem documento. Não impede nada hoje; só deixa a contraparte
  fora de qualquer casamento futuro por documento.

---

## 15. As 139 transferências do Asaas de 2026

**O que é:** R$ 1.293.078,70 em saídas `TRANSFER` de 2026 que continuam sem
contraparte. Elas se partem em dois grupos com evidência muito diferente:

**Grupo A — 105 já pareadas, R$ 1.206.737,26.** Cada uma tem a perna irmã no
Inter ou no Nubank, e o pareamento liga duas contas da **mesma entidade**. Em 50
delas a perna do Inter ainda traz `cpfCnpjRecebedor = 34776108000192` — o CNPJ
da casa, documento, não nome. Nas outras 55 a irmã está no Nubank, cujo lastro
documental ainda é de 13,7%. **Nenhuma das 105 tem irmã apontando para
terceiro.** A categoria delas já é 9.01, `movimentacao`: nada disto entra em DRE.

**Grupo B — 34 não pareadas, R$ 86.341,44.** 28 nomeiam terceiros reais (13 para
o CREA, 3 para o Ministério da Fazenda, Celpe, Claro, PJBank…) e 6 nomeiam a
própria XPE sem ter perna correspondente importada.

**Por que perguntar:** o Grupo B só tem o **nome** que a outra ponta cadastrou na
chave PIX. Casar por nome é exatamente o erro que a `0027` desfez, quando 57
favorecidos reais do Inter colapsaram em 19 bancos — e o `/transfers` do Asaas
responde 403, então não há documento a buscar. Já o Grupo A tem evidência
estrutural (o pareamento), e o que falta é uma decisão de modelo: **a casa deve
existir como contraparte de si mesma?**

**Opções:**
- **(a)** Criar uma `fin_counterparty` `kind='outro'` com o CNPJ da casa e
  carimbá-la nas 105 do Grupo A. Sobe o indicador de 2026 em ~2,7 pontos
  (105/3.877) dizendo algo verdadeiro: o outro lado desta transferência somos
  nós. Compatível com o gatilho da `0044`, que só recusa `cliente`/`fornecedor`
  com documento diferente do da casa. O Grupo B continua nulo.
- **(b)** Deixar as 105 nulas. Transferência própria não teria "contraparte" por
  definição, e o indicador carrega o vazio.
- **(c)** Resolver o Grupo B pelo nome. — **desaconselhada**, é a `0027` de novo.

---

## ✅ Respondida — XPE Tecnologia

**Pergunta:** os ~R$ 6.300/mês que saem do Inter para "Xpe Tecnologia" são
despesa, transferência interna ou retirada de sócio?

**Resposta (15/08/2026):** é a mesma empresa. CNPJ **34776108000192**. *"xp energy
servicos de medição, xpe tecnologia, xpe consultoria, xpe obras — tudo é uma
coisa só."*

**Consequência aplicada:** contraparte com esse documento ⇒ transferência entre
contas próprias, nunca receita nem despesa. A regra é determinística por CNPJ e
substitui a heurística de nome, que falhava justamente porque o nome fantasia é
diferente da razão social.

---

## 13. A contraparte da taxa do Asaas: o cliente ou o Asaas?

**Como a pergunta apareceu.** O `PLANO_2026` registrava que "as transações sem
`paymentId` são taxas do Asaas". A medição de 16/08 desmente: **as taxas têm
`paymentId`** — a taxa nasce de uma cobrança específica e carrega o id dela. O
que era suposto ser um resíduo sem identidade virou o grosso da frente.

Das **1.762** linhas do Asaas sem contraparte em 2026, **1.564** chegam ao
cliente por caminho exato da fonte — e **1.511 delas são taxa**:

| tipo | linhas | valor 2026 | caminho |
|---|---|---|---|
| PAYMENT_FEE | 552 | −R$ 1.115,90 | `paymentId` |
| PAYMENT_MESSAGING_NOTIFICATION_FEE | 456 | −R$ 405,84 | `paymentId` |
| INVOICE_FEE | 504 | −R$ 498,96 | `invoiceId` (503 resolvem) |
| INSTANT_TEXT_MESSAGE_FEE | 53 | −R$ 29,15 | nenhum — mas o `type` já prova que é taxa |
| **total de taxa** | **1.565** | **−R$ 2.049,85** | |
| PAYMENT_RECEIVED | 53 | R$ 12.997,46 | `paymentId` — **sem dúvida: é o cliente** |

**A pergunta.** Numa taxa de boleto de R$ 1,99 sobre a fatura do cliente X, quem
é a "outra ponta"?

- **quem recebeu o dinheiro foi o Asaas.** O cliente X não recebeu nada;
- **mas quem causou o custo foi o cliente X.** Sem essa ligação não há margem
  líquida por cliente nem custo de servir.

São duas perguntas diferentes, e o ledger tinha lugar para uma só. A migration
`0051` abre `fin_transaction.origin_document_id` para que **as duas** tenham
resposta: a contraparte diz quem recebeu, a origem diz quem causou. Por isso a
escolha abaixo **não perde informação em nenhum caso** — `origin_document_id` é
gravada nas três opções.

**O que muda em cada opção** (dry-run medido, `backfill-asaas-contraparte.mjs`):

| opção | contraparte da taxa | contraparte 2026 (todas as contas) | conta asaas 2026 |
|---|---|---|---|
| **(a)** `--taxas=asaas` *(padrão do script)* | Asaas IP S.A. | 44,1% → **85,9%** | 22,9% → 93,7% |
| **(b)** `--taxas=cliente` | o cliente da cobrança | 44,1% → **84,5%** | 22,9% → 91,3% |
| **(c)** `--taxas=nulo` | nenhuma | 44,1% → **45,5%** | 22,9% → 25,2% |

**Recomendo (a)**, por um motivo que não é de indicador:
`fin_transaction.counterparty_document` é documentado na `0042` como "documento
da OUTRA ponta" e é lido pela regra de prioridade 0 `transferencia-cnpj-proprio`.
Em **nenhuma** das opções o script grava ali o documento do cliente numa taxa —
seria plantar um fato falso na única coluna que uma regra automática trata como
prova, a mesma classe de erro que quase transformou 31 boletos (R$ 28.263,64) em
transferência. Com **(b)**, `counterparty_id` e `counterparty_document` passariam
a discordar em 1.511 linhas, e quem lesse a tabela depois não saberia qual das
duas acreditar.

Sob **(a)**, "quanto custou de tarifa para atender o cliente X" continua tendo
resposta exata — via `origin_document_id`, que é vínculo da fonte e não rateio.

**O que NÃO está em jogo:** o resultado da empresa não muda em nenhuma opção. A
categoria das 1.565 linhas é `4.05 Tarifas bancárias e de cobrança` nas três, o
valor é o mesmo, a DRE é a mesma e o caixa é o mesmo. O que muda é de quem o
custo aparece pendurado num relatório de contraparte.

## 14. O CNPJ do Asaas — só o ISPB é evidência

A contraparte institucional `Asaas IP S.A.` nasce na `0051` **sem
`document_number`**, e isso é deliberado.

A evidência disponível dá o **ISPB**, não o CNPJ. Em `data/raw/inter-extrato.json`
há 51 PIX recebidos do Asaas com `nomeEmpresaPagador = "ASAAS IP S.A."` e
`endToEndId` começando em `E19540550…` — os 8 primeiros dígitos do endToEndId são
o ISPB da instituição, aqui **19540550**. O ISPB coincide com a **raiz** do CNPJ,
mas a filial e os dígitos verificadores (`/0001-XX`) não estão em arquivo nenhum
deste repositório.

**Por que não completei de memória:** `fin_counterparty_document_idx` é ÚNICO por
`(entity_id, document_number)`. Um documento errado aqui **bloqueia o cadastro do
certo** depois, e o backfill de qualquer outra conta que venha a encontrar o CNPJ
real do Asaas falharia na inserção sem explicar por quê.

**Opções:** *(a)* confirmar o CNPJ completo (está em qualquer nota de tarifa ou
no contrato do Asaas) — é um `UPDATE` de uma linha, e o vínculo das 1.565 taxas
já estará feito porque aponta para o `id`, não para o documento · *(b)* deixar
sem documento: a contraparte funciona igual, só não casa por documento com um
extrato de terceiro.

## 15. Estender a F1 a 2021–2025 — sai de graça, e é decisão de escopo

O escopo decidido é 2026. Mas o caminho da F1 é o mesmo em qualquer ano, e o
custo de estendê-lo é **uma flag** (`--tudo`), não uma linha de código a mais.

Medido no mesmo dry-run:

| recorte | linhas escritas | contraparte (total, todas as contas) |
|---|---|---|
| `>= 2026-01-01` *(padrão)* | 1.618 | 25,7% → **37,3%** |
| `--tudo` | 9.457 | 25,7% → **93,8%** |

São **7.839 linhas** de 2021–2025 com identidade exata de cliente, pelo mesmo
`paymentId`/`invoiceId`, sem heurística nenhuma. A âncora (soma por conta)
permanece intacta nos dois recortes.

**Isto não resolve o item 1** desta lista: os 20 movimentos de 2021–2023
(R$ 215.500) são do tipo `TRANSFER`, não têm `paymentId` e continuam sem caminho.
O que `--tudo` resolve é o entorno deles — o indeterminado pré-2026 cai de 8.150
para 311 linhas, e os 20 do item 1 ficam **isolados e visíveis** em vez de
afogados num mar de nulos.

**Opções:** *(a)* rodar só 2026, como decidido · *(b)* rodar `--tudo`: o
histórico deixa de ser um vazio uniforme e o que sobra sem contraparte passa a
ser exatamente o que precisa de você.

## 16. Os 31 lançamentos ambíguos do Nubank — mesmo dia, mesmo valor

A F2 casou o extrato do Nubank com o Polp por **data local + valor**, porque não
existe chave comum: o CSV gerou UUID v4 e a Polp usa v3 (interseção de 24 em
865), e `referenceNumber` é null em 865/865 — não há `endToEndId` como no Inter.

Das 854 linhas de 2026, **811 (95,0%) foram lastreadas com evidência**. Sobram 31
em 13 grupos onde o mesmo dia e o mesmo valor têm mais de um candidato, por dois
motivos diferentes:

**(i) Conteúdos diferentes — 10 grupos, 25 linhas.** O caso típico é 11/05:
cinco lançamentos de -R$ 86,05 no mesmo dia, um PIX para o MINISTÉRIO DA FAZENDA
e quatro DAS-SIMPLES NACIONAL por convênio. O PIX tem CNPJ da Receita; os
convênios não têm documento nenhum. Qual linha do ledger é qual não se decide
por sorteio, e trocar as duas trocaria o documento de lugar.

**(ii) O grupo não fecha em tamanho — 3 grupos, 6 linhas.** Em 02/06 o Polp traz
UM PIX de -R$ 70,00 para `GJM LANCHONETES LTDA` e o ledger traz DOIS lançamentos
de -R$ 70,00: um para a mesma lanchonete (que o extrato chama pelo nome fantasia,
`SPORT BURG`) e outro para uma pessoa física. A segunda linha não tem
contrapartida nesse grupo — é uma transação feita depois da meia-noite que o
banco lançou no dia anterior.

> Este segundo caso foi encontrado conferindo contra a fonte, e **teria gravado
> o CNPJ da lanchonete no PIX da pessoa física** se a regra fosse só "todas as
> linhas do Polp do grupo dizem a mesma coisa". Documento falso numa coluna que
> a regra `transferencia-cnpj-proprio` (0042) lê como fato. A trava hoje exige
> que o grupo tenha uma linha do Polp para cada linha do ledger.

Todas as 31 estão marcadas `lastro_match='ambiguo'` — nenhuma recebeu conteúdo.

**Opções:** *(a)* deixar indeterminado, como está — o custo é 31 linhas sem
lastro num universo de 854 · *(b)* autorizar desempate por **nome**: comparar a
descrição do extrato com o nome da contraparte do Polp resolveria os 3 grupos do
caso (ii) e provavelmente 6 dos 10 do caso (i), ao preço de trocar evidência por
semelhança de texto — que é exatamente como nasceram os dois pareamentos falsos
da A6 · *(c)* você olha os 13 grupos e decide um a um; são 31 linhas e a lista
sai da consulta ao pé desta seção.

```sql
SELECT id, posted_on, amount_cents, description_raw
  FROM fin_transaction WHERE lastro_match = 'ambiguo' ORDER BY posted_on;
```

## 17. Estorno: o Polp não mostra, o CSV mostra — 12 linhas

As 12 linhas do ledger sem nenhuma correspondência no Polp são, quase todas,
**pares de estorno**: um PIX enviado e a devolução do mesmo valor, dias depois.
JAGUAR (R$ 1.100,10 e R$ 397,09), VILA BELA (R$ 233,18) e Claudio Mendes
(R$ 56,00) aparecem duas vezes cada — a saída e o `Estorno - Transferência
enviada`.

O extrato em CSV registra os dois eventos. A API do Polp não os devolve: para
ela a transação simplesmente não existe. Somados, os pares dão **zero** — não há
dinheiro faltando, e a âncora de caixa fecha nas 6 contas com ou sem eles.

**Isso é diferença de fonte, não erro de nenhum dos dois lados.** O CSV conta a
história; a API conta o saldo.

**Opções:** *(a)* deixar como está — ficam `lastro_match='sem_par'`, declaradas,
e o caixa não muda · *(b)* modelar estorno de verdade, ligando as duas pernas por
`reversal_group_id` (a coluna já existe desde a 0044) para que a DRE nunca conte
a despesa que foi devolvida — hoje ela conta as duas e o líquido é que salva.

## 18. 42 contrapartes com CNPJ que o cadastro não conhece — 227 lançamentos

O lastro do Polp gravou documento de terceiro em 600 linhas. Delas, **379 já
apontam para uma contraparte cadastrada** — mas **227 trazem um CPF/CNPJ que não
existe em `fin_counterparty`**, em 42 documentos distintos. As maiores:

| documento | linhas | valor | quem é |
|---|---|---|---|
| 06913480000168 | 9 | R$ 31.493,87 | DIMENSIONAL BRASIL SOLUCOES LTDA |
| 38347078000150 | 1 | R$ 19.225,09 | NEXER — INDÚSTRIA E COMÉRCIO |
| 71113542497 | 43 | R$ 14.875,90 | DENILSON FERREIRA DA SILVA |
| 28922067000100 | 1 | R$ 13.221,55 | 4º TABELIONATO DE PROTESTO DO RECIFE |
| 01396611401 | 17 | R$ 5.597,90 | LUIZ EDUARDO ARAUJO OLIVEIRA |
| 17895646000187 | 58 | R$ 842,30 | UBER DO BRASIL TECNOLOGIA LTDA |

O backfill **não cria contraparte** — criar cadastro a partir de um extrato é
decisão de modelo, não efeito colateral de um script de lastro. Por isso o
indicador `contraparte identificada` do Nubank sobe só de 70,6% para 73,2%: o
documento entra em 600 linhas, mas só 22 delas ganham vínculo novo.

É a E2 (casamento fornecedor ↔ CNPJ) esperando para acontecer, e agora com o
dado na mão.

**Opções:** *(a)* criar as 42 automaticamente a partir do nome e do documento
que o Polp entrega — nome da fonte é o que a outra ponta digitou, então algumas
sairão com grafia estranha · *(b)* criar só as pessoas físicas recorrentes
(Denilson 43x, Luiz Eduardo 17x, Rosimere 27x), que provavelmente já são
`fin_person` sem contraparte ligada · *(c)* revisar as 42 à mão antes de criar.

## 19. Centro de custo para em 13% porque o ERP só carimbou 112 linhas

A F2 destrava a F5, e destravou: o centro de custo do Nubank vai de **31 para 111
lançamentos**. Mas o teto não é o casamento — é a origem.

**Cuidado ao ler o painel:** o indicador de centro de custo exclui a categoria
`movimentacao` (aplicação e resgate de RDB não são custo de obra, são dinheiro
trocando de bolso). Dos 111, **69 são exatamente isso**. Na base que o painel
mede, o Nubank de 2026 vai de **13 para 42 lançamentos — 0,4% → 1,2%**. Os 111
são verdade; os 42 são o que conta para margem por obra.

O espelho `erp_extrato_linha` tem **851 linhas do Nubank em 2026 e apenas 112 com
`projeto_id`**. O casamento aproveitou praticamente todas: 31 pelo `source_id`
(determinístico), 78 por data+valor 1:1, 2 por grupo homogêneo, e **1 ficou
indeterminada**. Não há mais projeto para trazer — ele não existe do outro lado.

A curva do erp-obras é boa e está subindo (2,5% mai · 13,1% jun · 47,5% jul ·
63,6% ago), então o futuro se resolve sozinho. O passado de 2026, não.

**Opções:** *(a)* aceitar 13% em 2026 e contar com a curva para os meses novos ·
*(b)* pedir ao Adryan um carimbo retroativo no erp-obras para jan–jun, que é
leitura para nós e trabalho lá · *(c)* atribuir projeto aqui por regra
(fornecedor recorrente → obra), o que inventaria margem por obra a partir de
palpite — a pior das três.

---

## 20. Os 4 vínculos órfãos de abril — R$ 21.285,00

Em 01/04/2026 o Inter mudou o formato da descrição de cinco PIX: em vez do
nome, veio `Pix Enviado — Cp: 18236120-…`. O importador não reconheceu e criou
contraparte nova para quatro pessoas já cadastradas. O dinheiro saiu, o
lançamento existe, mas está pendurado em ninguém:

| pessoa  | valor       | evidência na descrição      |
|---------|-------------|-----------------------------|
| Igor    | R$ 10.885,00| raiz de CNPJ 64266025 — bate |
| Flavio  | R$  5.100,00| raiz 64677654 — bate         |
| Tawany  | R$  1.300,00| raiz 63384563 — bate         |
| Audrey  | R$  4.000,00| **só o nome** — sem CNPJ     |

É por isso que abril parece o mês em que meio time não recebeu: o Flavio consta
com R$ 298 num contrato de R$ 5.100. Os quatro entraram como `proposto`, não
`confirmado` — nenhum número muda até alguém olhar.

**Opções:** *(a)* confirmar os três com prova de CNPJ e deixar a Audrey pendente
· *(b)* confirmar os quatro, aceitando o nome como evidência suficiente ·
*(c)* não confirmar nenhum e tratar como despesa sem dono.

---

## 21. Em que conta contábil ficam os MEIs — R$ 264.206,66 em 2026

Doze MEIs receberam R$ 264.206,66 este ano, e **R$ 255.936,66 disso está em
6.01 Salários** — a conta de empregado, para quem não é empregado. Não foi
decisão: a 0050 deixou os MEIs sem categoria padrão de propósito, e o padrão do
importador venceu no silêncio.

O efeito colateral já aparece nos números: `folha_sem_mei_cents` inclui MEI ao
contrário do próprio nome, e `mei_cents` mostra só o Kevin — 3,1% do que
deveria.

**Opções:** *(a)* 4.03 Terceirização — juridicamente correto, tira o MEI da
folha fiscal · *(b)* conta nova 6.09 "Serviços de MEI" — mantém no grupo de
pessoal mas separa do salário · *(c)* por pessoa, conforme o serviço prestado ·
*(d)* manter em 6.01 e assumir a mistura. Em qualquer opção falta a mesma
informação: **qual serviço cada um presta**, descrito.

---

## 22. Reembolso: fica em 6.01 junto do salário, ou vai para a 6.05?

A conta 6.05 "Reembolsos a colaboradores" existe e está zerada. Reclassificar
move ~R$ 6 mil/mês de "folha" para "reembolso" e faz a DRE dizer a verdade
sobre quanto custa a equipe.

O obstáculo é o casamento: de 81 pedidos, 46 casam pelo total e 28 pelos itens,
mas **7 (R$ 3.456,33) não têm par no extrato** — foram pagos junto com o fixo, e
o valor não existe isolado em lugar nenhum. Separá-los exigiria rateio
inventado. E não há comprovante: **0 de 193 itens** têm anexo.

**Opções:** *(a)* reclassificar só os 74 que casam e deixar os 7 em 6.01 ·
*(b)* esperar o comprovante pelo app do time e reclassificar tudo de uma vez ·
*(c)* manter tudo em 6.01.

---

## 23. Oito pessoas recebem todo mês sem contrato declarado

Denilson, Rita, Luiz Eduardo, Dantre, Sandro, Lorena, Kevin e Kalebe recebem
com regularidade mensal e **não têm linha de contrato em lugar nenhum** — nem na
aba Hardware, nem na Software. Somados dão R$ 7.002,50/mês de fixo observado,
mais o Kevin. Três deles (Denilson, Rita, Luiz Eduardo) estão como `indefinido`
no cadastro; o Kalebe não tem CNPJ e recebeu só em fevereiro.

Enquanto o vínculo é indefinido, a previsão de folha os projeta pela mediana —
que funciona, mas não sabe se aquilo continua no mês que vem.

**Pergunta direta:** qual o vínculo de cada um — MEI, sócio, estágio, avulso?

---

## 24. Felipe está inativo no cadastro e recebeu em julho e agosto

R$ 2.500 em 01/07 e R$ 2.500 em 01/08, com o status `inativo`. Ou foi desligado
e essas são verbas rescisórias, ou o status está errado e ele segue ativo. A
diferença muda a previsão de setembro em R$ 2.500.

---

## 25. Quem é o Paulo Silva Barroso

CPF 08665157476, R$ 300 em 6.01 este ano, lançado na conta de Estágio. **Não é o
Paulo estagiário**, que tem CPF 71266090436. São duas pessoas com o mesmo nome, e
a segunda não está no cadastro.

---

## 26. O contrato do João: R$ 1.000 ou R$ 3.000?

A aba de Software diz R$ 1.000. A lista "Falta pagar" diz R$ 3.000. Ele recebeu
**R$ 3.000 nos oito meses de 2026**. O pagamento é a evidência mais forte, então
o mais provável é que a aba de Software esteja desatualizada — mas quem sabe é
você.

---

## 27. A alçada de aprovação — sem ela, a fila de pagamento não anda

`fin_approval_rule` nasceu **vazia de propósito**: semear um teto seria inventar
governança que ninguém combinou. Mas o gatilho recusa qualquer aprovação sem
régua, então enquanto a tabela estiver vazia nenhum pagamento passa da fila.

**Opções:** *(a)* um nível só — Fernando aprova tudo, sem teto · *(b)* duas
faixas: até R$ X um aprovador, acima disso dois · *(c)* três faixas com teto por
transação.

Pergunta acoplada: se o Fernando também abre a solicitação, ou a faixa baixa
precisa de `permite_autoaprovacao` declarado, ou o solicitante tem de ser outra
pessoa. As duas saídas são legítimas; a que não serve é a solicitação travar
sem ninguém entender por quê.

---

## 28. Onde nasce a conta a pagar

O ledger tem **100% da receita e 0% da despesa como documento**: `fin_document`
tem 3.406 linhas e todas são `direction='receber'`. A despesa só existe depois
de paga, como lançamento no extrato — o que significa que hoje não existe
"contas a pagar", só "contas pagas".

**Opções:** *(a)* a fila de pagamento é a única origem — a obrigação nasce
quando alguém pede para pagar · *(b)* `fin_document` ganha `direction='pagar'`,
alimentado por boleto e NFe de entrada, e a fila referencia o documento ·
*(c)* como (b), com a fila obrigada a apontar para um documento.

A diferença não é técnica: em (a) a empresa só sabe que deve quando alguém
lembra; em (b) a obrigação existe desde que o fornecedor emitiu. **Enquanto for
(a), a previsão de saída nunca fica completa.**

---

## 29. Nenhum favorecido tem conta cadastrada

`fin_payee_account` está com zero linhas, e não dá para preencher sozinho: o
lastro do Inter e do Polp entrega CNPJ, não chave PIX nem agência e conta.

**Opções:** *(a)* cadastrar na primeira vez que pagar cada fornecedor, com a
fila travando até lá — é o comportamento de hoje · *(b)* afrouxar a exigência e
pagar com o dado digitado direto no banco, aceitando que o sistema não confere
favorecido.

A trava de (a) é chata no começo e é justamente ela que pega troca de
favorecido depois.

---

## 30. Orçamento de escopo empresa

As 114 metas carregadas do ERP são **100% de escopo `obras`**, e o realizado
delas mora no erp-obras. Para a XPE como empresa não existe meta nenhuma — por
isso "orçamento disponível" sai null em todas as 75 linhas.

**Opções:** *(a)* declarar metas manuais por linha do modelo · *(b)* usar o
`fin_model_value` de procedência `referencia` como meta implícita · *(c)* manter
indeterminado e tirar o alerta de estouro da tela.

---

## 31. Quem aprovou pode registrar que pagou?

Hoje pode, e fica visível na trilha. Separar as duas mãos é o controle clássico
contra pagamento que foi aprovado e registrado pela mesma pessoa sem ninguém
conferir.

**Opções:** *(a)* bloquear · *(b)* alertar e deixar passar · *(c)* permitir em
silêncio. Para uma empresa deste tamanho *(b)* costuma ser o equilíbrio, mas o
custo de (a) é baixo se houver duas pessoas na operação.

---

## 32. A reserva de R$ 230.547,86 tem alvo e não tem saldo

As 4 reservas somam um alvo de R$ 230.547,86 e `current_cents = 0` — o dinheiro
nunca foi separado. Como a previsão desconta o alvo para calcular caixa livre, o
resultado é que o caixa livre nasce negativo e "dia do aperto" dá **hoje**, nos
três cenários. É verdadeiro e é inútil: um alarme que toca sempre não avisa nada.

**Opções:** *(a)* manter descontando o alvo, aceitando que o alarme fica ligado
até a reserva existir de fato · *(b)* descontar o `current_cents`, ou seja, zero,
e o caixa livre passa a ser o caixa inteiro · *(c)* declarar uma reserva mínima
operacional separada do alvo — quanto você não aceita ter em conta, que é uma
pergunta diferente de quanto quer guardar.

---

## 33. As 11 recorrentes de despesa continuam propostas

R$ 14.207,21/mês de despesa recorrente detectada está em `proposto`, e o CHECK da
0057 as segura fora do saldo — de propósito, porque proposta não confirmada não
move previsão. Confirmá-las levaria a cobertura da previsão de saída de **71,7%
para ~81%**.

É decisão humana por desenho: cada uma tem contraparte, valor e dia do mês na
fila. **Confirma as 11, confirma algumas, ou nenhuma?**

---

## 34. O buraco de R$ 43.059,77/mês na previsão de saída

Depois de projetar folha, DAS, cartão, recorrentes e empréstimo, sobram
R$ 43.059,77/mês de saída real que nenhuma camada explica. É gasto não
recorrente — compra avulsa, serviço pontual, o que não tem padrão.

**Opções:** *(a)* deixar a lacuna visível e a previsão otimista em ~28%, com o
número impresso a cada execução · *(b)* criar uma camada "despesa não recorrente"
pela mediana histórica do que as outras camadas não explicam, marcada como
estimada — fecha o caixa, mas é média onde não há regra.

---

## 35. A comissão prevista entra na previsão de caixa?

`fin_comissao_prevista` tem R$ 84.946,77 a pagar. Mas o `variavel_cents` da folha
já é a mediana do acréscimo efetivamente pago, e a comissão sai **dentro do lote
da folha** — somar as duas contaria o mesmo dinheiro duas vezes. Some a isso que
o backtest da comissão errou 87,7% no mês.

Hoje ela fica **fora** da previsão de caixa e serve para orçar e cobrar por obra.
Confirma?

---

## 36. Restaurar a curva de aging no vencido?

A previsão anterior aplicava a curva de recuperação por idade do documento
(R$ 201.502,00 bruto virando R$ 70.356,88 esperados). Foi trocada por uma
premissa plana de 50% no cenário otimista — mais visível e versionada, menos
precisa.

**Opções:** *(a)* manter a premissa plana, que qualquer pessoa lê e discute ·
*(b)* restaurar a curva por idade, que acerta mais e ninguém consegue conferir de
cabeça.

---

## 37. Os 149 valores de referência vieram de um arquivo que não está aqui

**Medido em 16/08/2026.**

`fin_model_value` tem **149 linhas com `procedencia='referencia'`**, gravadas em
11/08/2026, todas com motivo `aba "Fluxo de Caixa", linha N`. A view
`fin_projetado_realizado_v` (560 linhas) compara o ledger contra elas.

**Nenhuma aba com esse nome existe na planilha deste repositório.** O arquivo
`Projeção Financeira_v3.1 (2).xlsx` tem 12 abas; a migration 0034 fala numa
"planilha de 21 abas". São arquivos diferentes, e o de 21 abas não está aqui.

**Dois achados que mudam a leitura desses números:**

1. **Eles cobrem só janeiro a julho** — 25, 29, 30, 25, 25, 9 e 6 células por
   mês, e **zero de agosto a dezembro**. Projeção de 2026 teria os 12 meses.
   O desenho é de planilha de acompanhamento sendo preenchida mês a mês.

2. **32 das 149 células são idênticas ao ledger até o centavo**, em 8 linhas —
   e em 4 delas (Locação de Usinas, Gestão de Tráfego, Comissão Mercado Livre,
   INSS) *todos* os meses batem exatamente. Duas fontes independentes não fazem
   isso. Essas linhas foram preenchidas a partir do mesmo extrato que alimenta o
   ledger.

**Consequência:** para essas 8 linhas, a tela "projetado × realizado" compara o
ledger consigo mesmo. Dá divergência zero, parece saúde, e não testa nada. Para
as outras, não se sabe se o alvo é meta, projeção ou digitação manual.

**Nada foi apagado.** São a única foto que existe, e a regra é não destruir sem
provar o substituto.

**Opções:**
- **(a)** Fernando localiza a planilha de 21 abas com a aba "Fluxo de Caixa" —
  é o único caminho que reconstrói a referência como ela foi concebida.
- **(b)** Marcar as 149 como `origem_perdida` no motivo, mantendo o valor mas
  tirando-as da tela de comparação até haver origem. Honesto e reversível.
- **(c)** Apagar. **Não recomendado** enquanto (a) não for descartado.

**Valor em jogo:** R$ 2.105.576,09 de massa absoluta comparada; 12 linhas
(R$ 141.291,94) aparecem na tela **só** com referência, sem realizado do lado —
ali o número da planilha é a única coisa que o usuário vê.

**Diagnóstico desta frente: manter os valores, corrigir o motivo.** O `motivo`
atual afirma uma coisa falsa — que o número veio de uma aba "Fluxo de Caixa",
o que faz qualquer pessoa procurá-la nesta planilha e não achar. O valor fica
(é a única foto), mas o rótulo passa a dizer a verdade. Reversível, não mexe em
nenhum `valor_cents`, e **não foi aplicado** — depende da resposta acima.

```sql
-- 149 células, 33 linhas. Dry-run conferido em 16/08/2026.
UPDATE fin_model_value
   SET motivo = regexp_replace(motivo, '^aba "Fluxo de Caixa", linha (\d+)$',
         'origem perdida — aba "Fluxo de Caixa" (linha \1) de planilha ausente do repositório; ver DUVIDAS 37')
 WHERE procedencia = 'referencia' AND motivo LIKE 'aba "Fluxo de Caixa"%';
```

---

## 38. Qual aba substitui a "Fluxo de Caixa" — resposta medida: nenhuma

O importador `scripts/import-modelo-referencia.mjs` foi reconectado ao arquivo
real e agora confere o **rótulo** de cada linha antes de gravar. Rodado contra
as **12 abas**, o alinhamento com as 87 linhas do modelo que têm `origem_linha`:

| aba | alinhamento |
|---|---|
| Resumão Geral | **1,1%** (1 de 87) |
| Premissas gerais · Projeção Base · Projeção Biel · Projeção Biel Ajustada · Projeção Projetos Joni | **0,0%** |
| Reformas · Única coisa · Cronograma PE XPE · Sala material · Fernando · Máquina de Indicações | sem eixo mensal — não são importáveis |

A única linha que casa é a **5, "Fontes de Receita (+)"**. Todas as outras
apontam para outra coisa: a linha 10, que no modelo é *"Monitor BT - Monofásico
50A"*, no "Resumão Geral" é **"Bra"** (R$ 20.501/mês). A linha 34, *"Auditorias
de Solar e Mercado Livre"*, é **"Lucro Bruto"**. A linha 62, *"Impostos"*, é
**"Reforma da Sala"**.

E os nomes que identificam o modelo — *Monitor BT*, *Gateways*, *Fatufácil*,
*Energy Management as a Service*, *FIN-ENERGYTECH*, *Locação de Usinas* — **não
aparecem em nenhuma das 865 células de texto do workbook inteiro.** Esta
planilha não é uma versão nova daquela: é outro modelo, orientado a funil
(visita → proposta → fechamento → ticket), não a plano de contas.

**Por isso não há remapeamento a propor.** Ligar linha por semelhança de nome é
o erro que uma frente anterior existiu para desfazer, e aqui nem semelhança há.

**Opções:**
- **(a)** Fernando aponta a planilha certa (a de 21 abas). O importador já está
  pronto: `--aba "<nome>"`, e ele recusa sozinho se o rótulo não bater.
- **(b)** Aceitar que esta planilha é outro modelo e **remodelar** as 91 linhas
  para o formato dela (funil e curva), abandonando o plano de contas atual.
  Migration 0082 está reservada para isso — não foi usada.
- **(c)** Abrir mão da referência de planilha e usar `fin_budget_target` (hoje
  com **0 metas** na view) como único alvo do previsto.

---

## 39. A comissão: 5% em 4 parcelas, ou a escala por volume de vendas?

A aba **"Projeção Biel Ajustada"** declara as duas coisas, e só uma chega ao
resultado.

**O que a frente de comissão leu (linhas 22–28):** comissão de consultoria a
**5%**, dividida em 4 parcelas (`D22 = 0,05`; `E23 = E22/4`). Está lá, é premissa
digitada, e a linha 28 confirma `% Comissão / Faturamento = 0,05` nos 12 meses.

**Confirmado — e refutado como fonte.** Esse bloco é **ramo morto**: a única
fórmula em todo o workbook que lê a linha 27 é a própria linha 28, que só calcula
a razão de conferência. Nada mais o consome.

**O que de fato vira número** está nas linhas 109–112 da mesma aba:

```
L110  qtd vendas por vendedor = (E84+E66+E11)/E5
L111  IF(E110<=C126, C125, IF(E110<=D126, D125, ...))   → escala 0% / 2,5% / 5% / 10%
L112  comissão = E111 * SUM(E85,E70,E13)
L109  Fixo = C109(5000) * qtd vendedores = R$ 10.000/mês
```

E `Resumão Geral!D28` ("Comissão de Vendas") é literalmente
`='Projeção Biel Ajustada'!E112`. A escala vem da tabela c1..c4 das linhas
125–126: **0% até 4 vendas, 2,5% até 7, 5% até 12, 10% acima de 14**, por
vendedor. Nos meses 1 e 2 a alíquota efetiva é 2,5%, não 5%.

**Isto explica por que nenhum valor pago se reconstrói a 5%:** a planilha nunca
usou 5% para valer. Usou uma escala, **mais um fixo de R$ 10.000/mês** que não
está na linha de comissão — ele entra na margem (L113) e presumivelmente na
folha, o que abre a chance de estar contado duas vezes.

**Opções:**
- **(a)** A escala por volume é a regra real; o bloco de 5% é rascunho e deve ser
  ignorado (e de preferência apagado da planilha, para não enganar de novo).
- **(b)** 5% é a regra combinada com o time e a escala é que é simulação — nesse
  caso o "Resumão Geral" está errado e o lucro projetado também.
- **(c)** Nenhuma das duas é o que se paga hoje, e a regra real precisa ser
  declarada do zero.

**Valor em jogo, medido:**

| | 2026 inteiro |
|---|---|
| escala por volume (L112) — **é a que vira resultado** | R$ 133.134,34 |
| 5% em 4 parcelas (L27) — ramo morto | R$ 88.928,68 |
| **diferença entre as duas regras** | **R$ 44.205,66** |
| fixo de R$ 10.000/mês (L109), fora da linha de comissão | R$ 120.000,00 |

A diferença entre 2,5% e 5% nos dois primeiros meses são R$ 4.793,01. O fixo de
R$ 120.000/ano precisa de resposta à parte sobre dupla contagem com a folha.

---

## 40. As 63 cobranças que perderam a classificação — quem decidia era o humano ou a regra?

**Valor em jogo: R$ 79.265,35** · 63 lançamentos · mantém o invariante **D6**
falhando de propósito.

### O que aconteceu, na ordem, com trilha

O passo 5 do `scripts/import-asaas.mjs` faz a entrada de caixa herdar a
categoria da cobrança que ela liquidou. Até 16/08/2026 ele fazia isso **mesmo
quando o documento não tinha categoria nenhuma** — e "herdar o nada" gravava
`category_id = NULL` por cima do que já estava decidido, carimbando
`classified_by = 'contrato'` junto.

Para estas 63 linhas o rastro em `fin_classification_event` mostra três camadas:

| quando | quem | o que decidiu | o que restou |
|---|---|---|---|
| 11/08 20:29–20:46 | **humano, pela tela** (qualificação em grupo, `accepted=true`) | categoria específica em **52** das 63 | apagado por um sync posterior |
| 16/08 03:57:11 | `classificar-fila.mjs`, regra 73, estágio `fato_estrutural` | **3.99** "Receita a classificar" nas 63 | apagado pelo sync das 11:24 |
| 16/08 11:24:21 | `sync-asaas` | nada — o documento não tem categoria | `contrato` + categoria **NULA** |

O carimbo `'humano'` é exatamente o que o `classificar-fila.mjs` usa para não
voltar em cima de decisão de gente (`GUARDA`: `classified_by IS DISTINCT FROM
'humano'`). Ao sobrescrevê-lo com `'contrato'`, o sync não só apagou a categoria:
apagou a proteção. E `reclassificar.mjs` protege `'contrato'` e nunca mais volta
nelas — é o "estado impossível" que o próprio `classificar-fila.mjs` descreve.

**O código já foi corrigido** (mesmo commit desta dúvida): o passo 5 agora exige
`d.category_id IS NOT NULL`. O buraco não se reabre. O que falta é decidir o que
fazer com as 63 linhas que já foram atropeladas.

### Por que não escolhi

Não é ambiguidade de leitura, é ambiguidade de **autoridade**. Duas decisões
reais existiram e ambas foram destruídas pelo mesmo defeito; restaurar uma é
descartar a outra. E qualquer restauração mexe em `category_id`, ou seja, **na
DRE** — R$ 79.265,35 saem de "sem categoria" e entram em alguma linha de receita.
Isso não é conserto de proveniência.

As outras 123 linhas do mesmo defeito (R$ 310.792,10) **foram corrigidas** na
migration `0091`: nelas o documento TINHA categoria, o contrato de fato decidiu,
e o `classified_rule_id` era resíduo comprovado — nenhuma tinha evento de
classificação e nenhuma estava na categoria que a regra sabe produzir.

### Opções

- **(a) Restaurar a decisão humana de 11/08** nas 52 que a têm, com a categoria
  específica que a pessoa escolheu, e travar `category_id` em
  `human_locked_fields` para nenhum sync futuro derrubar de novo. As 11 restantes
  vão para 3.99 pela regra 73. É a opção que trata trabalho humano como
  autoridade máxima — e a única que devolve categoria específica a receita que
  tem uma.
- **(b) Repor 3.99 nas 63** (estado que o `classificar-fila.mjs` deixou às
  03:57), estágio `fato_estrutural`, e mandar todas para a fila de revisão. É
  honesto quanto ao que a máquina sabe, mas descarta as 52 decisões de 11/08 e
  põe R$ 79.265,35 em "receita a classificar".
- **(c) Não restaurar nada**: assumir que categoria nula é o estado verdadeiro,
  e então `classified_by` precisa deixar de dizer `'contrato'` — porque o
  contrato não decidiu. Viraria `NULL`, e as 63 voltam para a fila como nunca
  classificadas. D6 fecharia sem mentir, ao custo de jogar fora as duas camadas
  de decisão.

**A pergunta curta:** a qualificação em grupo feita na tela em 11/08 vale como
decisão definitiva (a), ou era rascunho que pode ser substituído pelo 3.99 da
regra (b)?

### Enquanto não houver resposta

D6 continua acusando **63 violações, R$ 79.265,35**, com causa conhecida e
escrita. É de propósito: invariante falhando com causa conhecida é melhor que
invariante verde com dado errado.

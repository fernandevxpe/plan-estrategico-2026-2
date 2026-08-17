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
| **21** | **Em que conta ficam os MEIs** | **R$ 87 mil a R$ 100 mil/ano** | **aberta · precificada na 0092 — decide o anexo do Simples** |
| **47** | **O CNAE da XP ENERGY não existe na base** | **R$ 87 mil a R$ 100 mil/ano** | **aberta · basta o cartão CNPJ** |
| 48 | A empresa paga o DAS-MEI dos seus MEIs | R$ 2.925,70 em 2026 | **aberta · fato medido, classificação pendente** |
| 49 | Jun/26: nota sem DAS correspondente | R$ 22.644,22 de base (~R$ 3.032 de DAS) | **aberta · o PGDAS resolve** |
| 50 | Notas emitidas fora do Asaas | R$ 55.567,69 em 7 competências | **aberta · medida por reversão do DAS** |
| **52** | **Rótulo por trilho de pagamento: 25 lançamentos em 4.05 que não são tarifa** | R$ 9.395,07 | **aberta · regra estreitada na 0094, 10 com precedente na casa** |
| 53 | Histórico da contraparte: baixar o piso de 3 cobranças para 1 quando a dominância é 100% | R$ 79.938,48 em 147 documentos | **aberta · destrava a maior fatia da fila da carteira** |
| **54** | **M4 ≤ 300 é impossível: 1.026 itens são de 2021–2025 e o H3 os prende** | R$ 927.406,83 | **aberta · decisão de limiar ou de escopo** |
| 55 | As 2 sombras de regra (usina solar, ART): confirmar em 90 dias | R$ 58.600,00 | **aberta · asserção expira em 14/11/2026 e M14 volta a 2** |
| 56 | As 16 categorias nunca usadas: quais saem do plano de contas | 8 esperam dado, 4 esperam decisão, 2 perdem para outra | **aberta · classificadas uma a uma na 0094** |
| 51 | Receita não segregada por anexo | 73,9% consultoria / 26,1% manutenção | **aberta · a lei manda segregar** |
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

### O preço, medido em 16/08/2026 (migration 0092)

A frente tributária mediu o que essa decisão custa, e é a mais cara da lista.

O Fator R decide o anexo do Simples: ≥ 28% vai para o Anexo III, abaixo disso
para o V (LC 123/2006 art. 18 §§5º-J e 5º-M). Na competência de ago/26, sobre a
base de NFS-e:

```
com MEI no numerador ......... 38,96%  →  Anexo III
sem MEI (leitura legal) ...... 23,42%  →  Anexo V
```

Sobre a base do ledger, 32,94% e 19,81% — mesma virada. **O MEI decide o
anexo**, e a diferença de alíquota efetiva entre V e III vale de **R$ 87 mil a
R$ 100 mil por ano** de receita, conforme a base (`fin_regime_indeterminacao_v`
recalcula).

E a lei aponta para um lado: o § 24 manda contar *"remunerações a pessoas
físicas decorrentes do trabalho"* e o § 25 restringe às informadas na forma do
art. 32, IV, da Lei 8.212/1991 (GFIP/eSocial). MEI é pessoa jurídica e emite
nota. **A leitura legal exclui o MEI do numerador — e é a que aponta Anexo V.**

Dois avisos antes de alguém concluir qualquer coisa:

- A janela de 12 meses tem **7 meses de folha**, porque os extratos de Inter e
  Nubank começam em 01/01/2026 (dúvida 4). O Fator R medido é **piso**, nunca
  valor. Anualizado, até a leitura legal estrita passa de 28%.
- O DAS efetivamente pago prova que a empresa **está no Anexo III hoje** — a
  base implícita reproduz as notas dentro de 5% em 4 de 7 competências. A
  pergunta não é "para onde ir", é "o enquadramento atual se sustenta".

Isso é leitura gerencial e **depende de validação do contador**.

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

### Medido em 16/08/2026 — de onde ela pode nascer, fonte a fonte

A modelagem de (b) já existia desde a 0030 e nunca tinha sido exercitada. A
frente da 0095 mediu cada fonte que já está no banco e perguntou uma coisa só:
**essa fonte declara uma obrigação FUTURA, ou só guarda despesa que já foi
paga?** A matriz vive em `fin_pagar_origem_v` e se recalcula sozinha.

| origem | evidência declarada | derivável | valor | caminho |
|---|---|---|---:|---|
| ClickUp "Fluxo de caixa" | tarefa com vencimento futuro e valor | ✅ **aplicado** | R$ 23.600,00 | `import-clickup-compromissos.mjs --apply` |
| folha contratada | `fin_person_compensation` fixo/contratado, 19 pessoas ativas | ✅ com trava | R$ 58.600,00/mês | contrato 'pagar' + documento mensal — **ver dúvida 41** |
| cartão: ciclo aberto + parcelamento | compra já feita, fatura não paga; plano declarado pelo emissor | ✅ | R$ 8.556,63 | `fin_card_compromisso_mensal_v` já modela; falta materializar |
| reembolso aprovado | aprovação humana registrada, `paid_document_id` vazio | ✅ | R$ 4.733,20 (11) | **ver dúvida 43** |
| fatura de cartão em aberto | saldo devedor declarado pelo emissor | ✅ | R$ 494,33 (2) | `fin_card_bill` já tem due_date |
| recorrente de fornecedor | **só o histórico pago** | ❌ | R$ 14.207,21/mês (11) | vira documento = contar duas vezes |
| NFe de entrada | **não existe** — 3.521 notas, 100% emitidas pela XPE | ❌ | — | **ver dúvida 45** |
| contrato de fornecedor | `erp_contrato` é 100% contrato de cliente | ❌ | — | cadastro humano |
| boleto agendado no Inter | credencial usa escopo `extrato.read` | ❌ | — | o extrato só mostra depois de pago |
| tributo apurado | a apuração declara que não calcula | ❌ | — | depende da dúvida 21 |

**O primeiro documento a pagar entrou.** `fin_document` deixou de ser 100%
'receber': 12 linhas `direction='pagar'`, R$ 23.600,00, status `previsto`,
vencendo de setembro a dezembro, cada uma amarrada a uma tarefa do ClickUp e
a um `fin_contract` de folha. A previsão de dezembro caiu R$ 23.600,00 — menor
e verdadeira.

**Derivável hoje, sem humano nenhum: R$ 37.384,16** (ClickUp aplicado + cartão +
reembolso + fatura parcial), mais R$ 58.600,00/mês de folha contratada assim que
a trava de dupla contagem da dúvida 41 for decidida.

**Só um humano resolve: R$ 14.207,21/mês.** São 11 fornecedores com nome, valor
e dia do mês — Âncora Imobiliária, contabilidade, marketing, Compesa,
Neoenergia, Google One, pró-labore — em `fin_pagar_lacuna_v`. O extrato prova
que a XPE paga todo mês; **nenhuma fonte declara o próximo vencimento.** Pedir
contrato, boleto ou carnê a esses 11 é o passo que falta, e é fora do sistema.

A cobertura da previsão de saída, medida agora em `fin_pagar_cobertura_v`: 77,5%
em setembro, caindo para 68,0% em fevereiro/27 — a lacuna cresce porque folha e
DAS são projetados com prazo e o resto não. Dos R$ 33.899,43/mês que faltam em
setembro, **R$ 11.593,04 já estão medidos e conscientemente fora do saldo**: são
as recorrentes de fornecedor, que a 0057 segura justamente por não terem
documento. Um documento por fornecedor fecharia um terço do buraco.

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

---

## 41. A folha contratada vira documento a pagar, ou continua só projeção?

`fin_person_compensation` declara **R$ 58.600,00/mês de fixo contratado para 19
pessoas ativas**. É contrato, não histórico: o valor foi combinado, não medido no
extrato. Cabe inteiro no modelo de 0030 (`fin_contract direction='pagar'` +
`fin_document` mensal).

O problema não é criar — é **não somar duas vezes**. A camada `pagar_folha` de
`fin_previsao_evento_v` já projeta R$ 90.186,85/mês de folha. Se o documento
entrar sem trava, a previsão passa a contar folha por dois caminhos, e o erro
tem exatamente a cara do que a 0061 corrigiu do lado da receita ("cobrança
emitida vence projeção", migration 0061).

**Opções:** *(a)* materializar o documento e aplicar a regra espelho —
**documento vence projeção**: onde existe `fin_document` a pagar para aquela
pessoa naquele mês, a camada `pagar_folha` não projeta · *(b)* deixar a folha só
como projeção e reservar `fin_document` a pagar para fornecedor · *(c)*
materializar só quem tem contrato assinado, mantendo os demais em projeção.

Em (a) a folha ganha vencimento e favorecido e entra na fila de pagamento; em
(b) a fila de pagamento nunca vê a maior saída da empresa.

**Em jogo: R$ 58.600,00/mês.**

---

## 42. Os três nomes do ClickUp que a folha não confirma

Os 12 documentos a pagar que entraram (R$ 23.600,00, set–dez) vieram da lista
"Fluxo de caixa" do ClickUp. Três deles não fecham com `fin_person_compensation`,
e o importador **não decidiu** — gravou o contrato como `previsto` ou `suspenso`
e relatou:

| pessoa | ClickUp | planilha de folha | o que o script fez |
|---|---:|---:|---|
| **Felipe** (Marcelo Felipe Dias Lacerda) | R$ 2.500,00/mês | inativo desde 2026-08-01 | contrato `suspenso`, **R$ 10.000,00 NÃO viraram documento** |
| **Adryan Kennie** | R$ 1.600,00/mês | R$ 3.200,00 de fixo | contrato `previsto`, documento criado por R$ 1.600,00 |
| **Denilson Ferreira da Silva** | R$ 2.100,00/mês | não tem fixo contratado | contrato `previsto`, documento criado |

**As perguntas:** *(1)* o Felipe saiu em 01/08 e o ClickUp programa set–dez — a
empresa deve esses R$ 10.000,00 (rescisão, acordo) ou é resíduo de planejamento
que ninguém apagou? *(2)* o Adryan recebe R$ 1.600 ou R$ 3.200 — o ClickUp é
metade da folha dele ou a planilha está desatualizada? *(3)* o Denilson tem
contrato de fixo que a planilha não conhece?

Isso conversa com a dúvida 24 (Felipe inativo recebeu em julho e agosto).

**Em jogo: R$ 10.000,00 + R$ 6.400,00/quadrimestre de divergência.**

---

## 43. Os 11 reembolsos aprovados de jan–jul: devidos ou já pagos?

`fin_reimbursement` tem **11 linhas `status='aprovado'`, R$ 4.733,20**, com
`paid_document_id` vazio — de janeiro a julho de 2026. Do lado de 70 linhas
`pago` o campo também está vazio, então a ausência do ponteiro não distingue os
dois casos.

Se estiverem devidos, são conta a pagar com aprovação humana já registrada — a
origem mais barata de todas. Se já foram pagos junto da folha do mês seguinte
(que é a regra declarada), o status é que ficou para trás, e criar documento
inventaria uma dívida que não existe.

**Opções:** *(a)* conciliar cada um contra a folha do mês seguinte e fechar os
que casarem · *(b)* tratar todos como devidos e materializar o documento ·
*(c)* perguntar pessoa a pessoa.

A (b) é a única que não posso executar sem resposta: reembolso de janeiro
aprovado e ainda em aberto em agosto é improvável o bastante para não virar
obrigação por omissão.

**Em jogo: R$ 4.733,20.**

---

## 44. Cartão: o ciclo aberto e as parcelas viram documento a pagar?

`fin_card_compromisso_mensal_v` já modela **R$ 8.556,63** de obrigação de cartão
— R$ 3.888,61 de compras já feitas no ciclo aberto e R$ 4.668,02 em 21 parcelas
contratadas até abril/27. A compra aconteceu; a fatura ainda não foi paga. É
conta a pagar por definição.

Hoje isso já entra na previsão pelas camadas `pagar_cartao_ciclo` e
`pagar_cartao_parcela`. Materializar como documento daria vencimento, favorecido
e fila de pagamento — e exige a mesma trava da dúvida 41 para não contar duas
vezes.

**Opções:** *(a)* materializar um documento por fatura (uma linha por mês,
valor = ciclo + parcelas) · *(b)* um documento por parcela · *(c)* manter só
como projeção.

**Em jogo: R$ 8.556,63.**

---

## 45. Por onde a nota de entrada chega?

`fin_fiscal_document` tem 3.521 notas e **todas foram emitidas pela XPE** (nfse
via Asaas). Não existe nenhum repositório de documento de entrada — e é por isso
que a regra de competência `documento_fiscal_despesa` cobre **zero linhas** desde
que foi criada, e por que "os MEIs emitem nota?" segue sem resposta.

Não é falta de modelo: `fin_fiscal_document` aceita os dois lados. É falta de
**fonte**. Antes de qualquer importador, alguém precisa dizer por onde a nota
chega.

**Opções:** *(a)* caixa de e-mail dedicada (nota@) com parser de XML anexo ·
*(b)* consulta ao SEFAZ pelo CNPJ da XPE, que devolve as NFe emitidas *contra* a
empresa · *(c)* upload manual na tela, aceitando cobertura parcial · *(d)*
assumir que a XPE não recebe NFe relevante (serviço de MEI costuma vir por
NFS-e municipal) e cadastrar só o que o contador já recebe.

Sem isso, a competência da despesa continua sendo a data do pagamento — o que
significa que a DRE por competência do lado da despesa é a DRE de caixa com
outro nome.

---

## 46. A conta corrente do Nubank não tem saldo declarado por fonte externa

Descoberto ao auditar as 114 linhas repetidas: das 4 contas com movimento,
**Asaas, Inter e Nubank—Caixinhas têm `fin_balance_snapshot` com `source='api'` e
variância zero** — o banco declara o saldo e ele bate com o ledger. A **conta
corrente do Nubank não tem snapshot nenhum**: o "fecha" dela compara o ledger
contra `fin_account.current_balance_cents`, coluna escrita pelo próprio
importador (migration 0041, valor R$ 11.682,57).

Fonte conferindo a si mesma não é conferência. As 14 assinaturas repetidas que
moram no Nubank foram provadas por outros eixos — totais direcionais do PDF e
contagem espelhada no Polp — mas a âncora de saldo, que é a prova mais forte
disponível nas outras contas, não existe ali.

**Opções:** *(a)* o Polp expõe saldo da conta corrente? Se sim, gravar snapshot
diário como já se faz com as caixinhas · *(b)* extrato/PDF novo com saldo final
declarado, e gravar o snapshot na importação · *(c)* aceitar e registrar que a
conta corrente do Nubank fecha contra si mesma.

Isso não muda nenhum número hoje. Muda o que "6/6 contas fecham" significa para
uma delas.

---

## 47. O CNAE da XP ENERGY não existe em lugar nenhum — e ele decide três coisas

Procurado em `fin_entity`, `fin_counterparty`, `fin_person`, em todas as views e
no repositório inteiro: **não há nenhuma coluna de CNAE nesta base**. A consulta
ao CNPJ no site da Receita Federal exige captcha e não foi feita. Agregadores de
cadastro não são fonte primária e foram descartados — a migration 0092 grava o
CNAE como `indeterminada`, sem valor, e uma asserção impede que alguém o
preencha com palpite.

Ele decide **três coisas ao mesmo tempo**:

| se o CNAE for | dispositivo | consequência |
|---|---|---|
| medição / engenharia / testes e análises técnicas | art. 18 § 5º-I, VI | Anexo V, com Fator R levando ao III |
| consultoria, auditoria, gestão | art. 18 § 5º-I, IX | idem |
| instalação, reparo e manutenção em geral | art. 18 § 5º-B, IX | **Anexo III sempre**, sem Fator R |
| obras de engenharia, execução de projetos | art. 18 § 5º-C, I | **Anexo IV** — e a CPP sai do DAS |

Além do anexo, o CNAE fixa o **grau de risco do RAT** (1%, 2% ou 3%,
Lei 8.212/1991 art. 22, II) e o **código FPAS/Terceiros**. As três lacunas
estão abertas por causa da mesma folha de papel.

O que a base já sabe, e que estreita o campo: **nenhuma das 2.826 NFS-e
autorizadas declara o item 7.02** (execução de obra). Em 2026 são só dois
códigos — 17.01 (assessoria/consultoria, 73,9%) e 14.01 (manutenção elétrica,
26,1%). Isso **afasta o Anexo IV** apesar de existir uma categoria interna
"Obras e Adequações" com R$ 269.273,69.

**Pergunta direta:** qual o CNAE principal e quais os secundários? Basta o
cartão CNPJ. Vale de R$ 87 mil a R$ 100 mil por ano — o mesmo intervalo da
dúvida 21, e pelo mesmo motivo.

---

## 48. A empresa paga o DAS-MEI dos seus próprios MEIs — R$ 2.925,70 em 2026

34 pagamentos de **R$ 86,05 exatos** aparecem em `7.01 Simples Nacional`, cinco
ou seis por mês, entre fevereiro e agosto. O valor não é coincidência:

```
5% × R$ 1.621,00 (salário mínimo de 2026) = R$ 81,05   INSS
                                          + R$  5,00   ISS
                                          = R$  86,05
```

LC 123/2006 art. 18-A § 3º, IV e V, c/c Lei 8.212/1991 art. 21 § 2º, II, b, e
Decreto 12.797/2025 art. 1º. É o DAS-MEI de prestador de serviços, ao centavo.

**Duas consequências, uma contábil e uma que não é:**

A contábil já está resolvida na 0092: esse valor **sai do numerador** de
qualquer carga tributária da empresa, porque é tributo de terceiro. Foi um dos
três erros que produziam a carga fantasma de 9,17%.

A outra é uma pergunta que a plataforma não responde: uma empresa que paga a
guia do MEI que lhe presta serviço está fazendo um reembolso contratado, um
benefício informal, ou registrando um indício de vínculo? **A base não qualifica
isso e não deve tentar.** Fica registrado o fato medido.

**Opções para a classificação:** *(a)* categoria própria "DAS-MEI de
prestadores", fora de `7.01`, porque não é imposto da empresa · *(b)* dentro de
4.03 Terceirização, junto do serviço a que se refere · *(c)* manter em `7.01` e
conviver com o fato de que "imposto pago" mistura dois contribuintes.

---

## 49. Jun/26: R$ 22.644,22 de nota sem DAS correspondente

A reconciliação reversa da 0092 divide o DAS efetivamente pago pela alíquota
efetiva do Anexo III e obtém a base que a empresa teria declarado. Em 5 das 7
competências o resultado bate com as NFS-e do Asaas dentro de 5%. **Jun/26 não
bate, e erra para baixo:**

```
notas Asaas na competência ....... R$ 140.369,42
base implícita no DAS pago ....... R$ 117.725,20
diferença ........................ R$  22.644,22  (16,1%)
```

Três leituras possíveis, e a base não separa: *(a)* uma ou mais notas foram
canceladas ou substituídas depois da apuração e o ledger ainda mostra a versão
autorizada · *(b)* houve ISS retido na fonte reduzindo a base declarada — mas
nenhuma nota de 2026 tem `iss_withheld` verdadeiro · *(c)* o DAS de jun/26 foi
recolhido a menor, e faltam cerca de **R$ 3.032** de principal.

Nas outras direções o mesmo método achou o oposto: jan/26 e fev/26 têm base
implícita **maior** que as notas do Asaas em R$ 40.061,92 e R$ 24.611,42, o que
é a assinatura das notas emitidas fora do Asaas (dúvida 50).

**Pergunta direta:** o contador tem o PGDAS de jun/26? O valor declarado ali
fecha a questão em um minuto.

---

## 50. As notas emitidas fora do Asaas: R$ 55.567,69 medidos, não estimados

O Fernando antecipou em conversa: *"pode ter algumas divergências por algumas
notas emitidas diretamente pelo site da prefeitura"*. A 0065 mediu a divergência
entre ledger e notas e chegou a ±R$ 70 mil/mês, mas sem conseguir dizer qual dos
dois lados estava certo.

A 0092 mede pelo terceiro lado — **o imposto efetivamente pago**. Somando as sete
competências de dez/25 a jun/26:

```
NFS-e autorizadas no Asaas ....... R$ 877.874,63
base implícita no DAS pago ....... R$ 933.442,32
notas fora do Asaas .............. R$  55.567,69   (6,3%)
```

Concentradas em jan/26 (R$ 40.061,92) e fev/26 (R$ 24.611,42) — os mesmos meses
em que a 0065 viu o ledger superar as notas.

Isso **não é estimativa**: é o que a alíquota da lei e a guia paga implicam em
conjunto. Mas também não é a lista das notas. `fin_fiscal_document` continua
tendo só o que veio do Asaas, e enquanto assim for a receita bruta fiscal desta
base é piso.

**Opções:** *(a)* exportar do portal da prefeitura do Recife as NFS-e do CNPJ e
importar as que faltam · *(b)* pedir ao contador o PGDAS mês a mês, que declara
a receita bruta e fecha a conta sem depender do portal · *(c)* aceitar e
registrar que a base fiscal cobre ~94% e que o resto é conhecido em valor, não
em documento.

---

## 51. A receita não está segregada por anexo, e a lei manda segregar

O art. 18 § 4º, IV da LC 123/2006 obriga a considerar destacadamente as receitas
de cada grupo de serviços. A empresa emite em dois códigos municipais:

```
17.01  assessoria ou consultoria .... R$ 823.075,10   73,9%   → §5º-I, IX → Anexo V com Fator R
14.01  manutenção elétrica .......... R$ 290.820,00   26,1%   → §5º-B, IX → Anexo III sempre
```

Se o Fator R ficar abaixo de 28%, **os dois pedaços vão para anexos
diferentes**: a manutenção continua no III e a consultoria vai para o V. Hoje a
apuração trata 100% da receita como um bloco só — e a 0092 também, de propósito,
porque escolher a proporção sem a lista de serviços por nota seria inventar.

O mesmo vale no Lucro Presumido: o art. 15 § 2º da Lei 9.249/1995 manda aplicar
o percentual de presunção **de cada atividade**. A 0092 aplicou 32% a tudo, e
registrou isso como lacuna bloqueante.

**Pergunta direta:** o contador segrega hoje? Se sim, em que proporção — e essa
proporção bate com os códigos municipais das notas?

---

## 52. O rótulo que veio do trilho de pagamento — 25 lançamentos, R$ 9.395,07

**Descoberto ao auditar M4, não como parte dela.** A regra 40
`meios-de-pagamento` procura `pjbank|asaas|cielo|stone|pagseguro|getnet` no
texto do extrato e manda para `4.05 Tarifas bancárias e de cobrança`. Só que o
Nubank descreve um PIX enviado assim:

```
Transferência enviada pelo Pix — POSTO VENDA GRANDE - •••.459.0001-••
 - PAGSEGURO INTERNET IP S.A. (0290) Agência: 1
```

O nome no fim da linha é o **banco de destino do recebedor**. Resultado medido:
**25 acertos, zero verdadeiros positivos.** É a mesma assinatura do bug do
"POSTO IPIRANGA", com um detalhe que o invariante D2 não alcança — aqui o sinal
está certo (saída, despesa) e só a **linha da DRE** está errada.

A 0094 estreitou a regra (a condição passa a ser sobre a contraparte, não sobre
o texto) e devolveu os 25 para a fila com a evidência na nota. Nenhum trocou de
categoria: trocar exigiria limpar `classified_rule_id`, que é da frente do D6.

**Onde a casa já decidiu, e só falta confirmar:**

| grupo | n | valor | precedente no ledger |
|---|---|---|---|
| Postos (Venda Grande, Alvorada, Madalena) | 3 | R$ 402,27 | regra `combustivel` → **5.06**, 36 lançamentos |
| Alimentação (São Braz, Reforço 6, Full House ×2, Rei das Coxinhas, Empório) | 6 | R$ 391,15 | regra `alimentacao-equipe` → **6.04**, 35 lançamentos |
| Ancora Imobiliária | 1 | R$ 300,00 | 9 lançamentos da própria contraparte em **5.01**, R$ 43.852,60 |

**Onde não há precedente:**

| contraparte | n | valor |
|---|---|---|
| DIMENSIONAL BRASIL SOLUCOES LTDA | 1 | R$ 5.022,10 |
| PJBank por QR code, sem contraparte | 2 | R$ 1.624,40 |
| ACESSO EQUIPAMENTOS DE SEGURANCA INDUSTRIAIS | 1 | R$ 720,00 |
| CPF 989.393.514-87 (Pablo Michael Viana Silveira) | 5 | R$ 345,40 |
| CPF 021.114.504-13 (Artur Pereira de Freitas) | 3 | R$ 252,01 |
| ELETROPALMA · IGUEP · ALBERTINO JOSE DE LIMA | 3 | R$ 337,74 |

**Pessoa física não emite tarifa bancária**, então os 8 lançamentos de CPF estão
errados com certeza — só não se sabe para onde vão.

**Opções:** *(a)* aplicar os precedentes aos 10 primeiros e decidir os 15
restantes um a um · *(b)* decidir tudo por contraparte na tela de qualificação
· *(c)* deixar em 4.05 e assumir que a DRE tem R$ 9.395,07 de "tarifa bancária"
que é combustível, comida, aluguel e material.

---

## 53. Histórico da contraparte: o piso de 3 cobranças vale para o caso de 100%?

O importador só classifica uma cobrança pelo histórico do cliente quando a
categoria dominante tem **≥ 80% e no mínimo 3 cobranças de base**. Abaixo de
90% a linha vai para a fila mesmo classificada — é a população
`conferencia_de_confianca`, com 413 itens hoje.

Medido em 16/08/2026, entre os 391 documentos pendentes **sem** categoria:

```
147 · R$ 79.938,48  dominância ≥ 90%, base 1 ou 2  ← barrados só pelo piso de 3
116 · R$ 94.430,06  contraparte sem histórico nenhum
 64 · R$ 99.189,20  dominância 50–80%, base ≥ 3     ← duas leituras de verdade
 43 · R$ 11.763,20  dominância < 50% ou sem contraparte
```

Os 147 do topo têm um cliente cujo histórico classificado é **100% de uma
categoria só** — só que esse histórico tem uma ou duas cobranças em vez de três.
O `qualificar.mjs` já trata esse caso como sugestão de 70–90% de confiança; o
importador o descarta.

Nenhum documento pendente tem irmão de parcelamento classificado (medido: zero),
então esse caminho está esgotado — o histórico da contraparte é a única
evidência disponível para eles.

**Opções:** *(a)* baixar o piso para base ≥ 1 **quando a dominância é 100%**, e
mandar tudo para `baixa_confianca` (a linha ganha categoria e continua pedindo
aceite) · *(b)* baixar para base ≥ 2 · *(c)* manter o piso de 3 e resolver os
147 na tela, um a um.

Em (a) e (b) o dinheiro não muda de lugar sem passar por gente: a fila continua
com o item aberto.

---

## 54. M4 ≤ 300 é aritmeticamente impossível hoje — o limiar ou o escopo

A régua de M4 diz *"300 é o que uma pessoa vence em ~2h"*. Ela foi escrita
quando a fila era só "falta categoria". Hoje, das 1.556 pendências:

```
415 · R$ 500.008,10  alvo anterior a 2026, sem categoria   ← fora do escopo
331 · R$ 271.904,30  conferência de confiança, pré-2026    ← fora do escopo
267 · R$ 134.605,41  cobrança sem texto na fonte, pré-2026 ← fora do escopo
224 · R$  91.603,52  marcado 3.99/5.99 em 2026
120 · R$ 154.161,30  sem categoria em 2026
 82 · R$  62.594,36  conferência de confiança em 2026
 79 · R$  84.002,91  cobrança sem texto na fonte, em 2026
 25 · R$   9.395,07  rótulo por trilho de pagamento (dúvida 52)
```

**1.026 itens (R$ 927.406,83) têm alvo anterior a 2026** — fora do escopo que o
Fernando declarou (*"quero tudo organizado que conseguir 2026"*,
OBJETIVOS_METAS §1). E eles **não podem sair da fila**: o invariante H3 exige
que todo lançamento indeciso tenha item pendente, e ele está certo — foi caro
conquistá-lo, e apagá-lo esconderia dinheiro.

Logo: enquanto o H3 valer e existirem 1.026 itens fora de escopo, M4 nunca
chega a 300. O número não mede preguiça; mede uma régua que envelheceu.

O monitor `M4·escopo` já mostra os **530 itens em escopo de 2026** ao lado, sem
mexer em M4.

**Opções:** *(a)* M4 passa a medir só o alvo em 2026, e o resto vira um monitor
de acervo com limiar próprio · *(b)* M4 fica, e o limiar sobe para um número
medido a partir das populações de `fin_fila_saude_v` · *(c)* declarar 2021–2025
em escopo e tratar M4 como está — é trabalho real, mas não é o que você pediu.

---

## 55. As duas sombras de regra: confirmar em 90 dias, ou elas voltam a bloquear

A 0094 mediu o que cada regra bloqueante teria pego e as declarou
`sombra_esperada`, **com validade de 90 dias**. Se ninguém confirmar, a asserção
expira e M14 volta a acusar 2. É de propósito: declarar não é decidir para
sempre.

**Regra 14 `gestao-de-usina-solar-e-gd` → 3.09 — 52 documentos, R$ 57.600,00**

| vencedor atual | n | valor | o que a descrição diz |
|---|---|---|---|
| `consultoria-e-auditoria` (3.01) | 43 | R$ 34.400,00 | "Gestão da Usina Solar, Créditos e **Assessoria** junto a Neonergia" |
| `laudos-e-inspecoes` (3.02) | 3 | R$ 15.000,00 | "**Laudo** da Usina Solar" |
| `estudo-de-disponibilidade-de-carga` (3.03) | 3 | R$ 6.700,00 | "Laudo Técnico e **Estudo** de Disponibilidade" |
| `projetos-e-subestacoes` (3.04) | 3 | R$ 1.500,00 | "Elaboração de **projeto** técnico" |

Em 52 de 52 a regra vencedora casou a palavra que nomeia o **serviço**, e a
regra 14 casou o **objeto** sobre o qual ele foi prestado. O plano de contas
3.01–3.14 é uma lista de serviços; "usina solar" não é serviço. Os 43 primeiros
são os contestáveis: se "Gestão da Usina Solar e Créditos" for gestão de
faturas, R$ 34.400,00 saem de 3.01 e entram em 3.09.

**Regra 24 `art-anotacao-responsabilidade-tecnica` → 3.01 — 1 documento, R$ 1.000,00**

Candidato único em 3.406 documentos, e o texto que casou é **mensagem de PIX**,
não descrição de serviço: *"ART projeto Carregador eletronico Edf Aluisio Moura
Apto 1202"*. A ART é acessória de um projeto de carregador, que é o serviço
faturado e o que a regra vencedora casou (3.14). Vale registrar o que a medição
diz da regra em si: um detector de três letras sobre texto livre, com 1 acerto
em 3.406 documentos, é da mesma família do "CNPJ = 14 dígitos em qualquer campo"
que casou zero de 274 negócios.

**Opções para as duas:** *(a)* confirmar — serviço declarado vence objeto, e
serviço principal vence obrigação acessória; as asserções passam a valer por
prazo longo · *(b)* discordar em algum caso, e aí a regra ganha prioridade menor
(número menor vence, o motor lê `ORDER BY priority`) e a receita se move ·
*(c)* não responder, e em 90 dias elas voltam a bloquear.

---

## 56. As 16 categorias que ninguém nunca usou — quais saem do plano de contas

M13 mede "linhas mortas do plano de contas". Classificadas uma a uma em
16/08/2026, elas não são a mesma coisa:

**Não é linha do plano — é marcador de indecisão (1)**

- **3.99 Receita a classificar.** Vazia porque o passo de herança do importador
  sempre a substitui pela categoria da cobrança liquidada. Zero receita indecisa
  é sucesso, não morte. A gêmea 5.99 tem 237 lançamentos e ninguém a chama de
  morta.

**Espera dado que não existe em fonte nenhuma (8)**

| código | o que falta | dúvida |
|---|---|---|
| 3.13 Manutenção e PCM | catálogo de serviços, contratos e NFs | asserção `aguardando_fonte` |
| 4.01 Comissão paga a vendedor | a comissão é prevista, nunca paga pelo ledger | 39 |
| 5.09 Seguros | zero prêmio pago; as 9 linhas que casam "seguro" são tarifas do Asaas com nome de cliente | — |
| 6.08 13º e férias | a folha do ledger não separa | — |
| 7.03 Retenções (IRRF, CSLL, PIS/COFINS) | empresa no Simples; zero candidato | 21 |
| 8.02 Infraestrutura e reformas | zero candidato | — |
| 8.03 Veículos | zero candidato; a frota é locada | — |
| 9.05 Aporte e retirada de sócio | zero candidato | — |

**Espera decisão humana que já está registrada (4)**

- **6.05 Reembolsos a colaboradores** — dúvida 22, ~R$ 6 mil/mês, 74 de 81
  pedidos casam.
- **5.07 Material de escritório e copa** — 6 candidatos entre os 25 da dúvida
  47, R$ 391,15. Perde hoje para 6.04 "Benefícios", que a casa já usou 35 vezes.
- **6.07 Treinamento e capacitação** — 2 lançamentos sem categoria, R$ 1.659,90
  ("L B S DE OLIVEIRA TREINAMENTOS", "Dtx Capacitacao"), ambos na fila.
- **9.04 Amortização de empréstimo** — dúvida 5: falta o contrato do Pronampe,
  R$ 147.062,10.

**Perde para outra mais específica (2)**

- **8.04 Licenças e software perpétuo** — `software-assinaturas` (5.03) absorve;
  nenhuma licença perpétua aparece no acervo.
- **5.08 Manutenção e infraestrutura** — sem candidato próprio; o que existe é
  material de obra (4.02).

**Já estava sendo usada, e o monitor não via (1)**

- **5.11 Frete e logística** — 1 item de cartão, R$ 1.222,56. M13 lia só
  `fin_transaction` e `fin_document`; o subledger do cartão carrega
  `category_id` desde a 0083. Corrigido na medição.

**Opções:** *(a)* desativar as 2 que perdem para outra (8.04, 5.08) e manter as
demais como espera declarada · *(b)* desativar também as 8 sem fonte e recriá-las
quando o dado chegar · *(c)* manter tudo e aceitar que M13 é um retrato do que
falta de dado, não de plano de contas inflado.

Em qualquer opção, **3.99 não deveria contar**: ela não é linha de plano de
contas, é marcador.

---

## 57. A decisão da dúvida 13 vale para antes de 2026? — 7.864 lançamentos

**Isto não é uma pergunta nova de classificação. É uma pergunta de escopo sobre
uma decisão que já foi tomada, aplicada e conferida.**

A dúvida 13 perguntou quem é a contraparte de uma taxa do Asaas, você escolheu a
opção (a) — Asaas IP S.A. — e o backfill rodou. Medido em 16/08/2026, o corte é
exato e não admite outra leitura:

| | taxas | com contraparte | sem contraparte |
|---|---:|---:|---:|
| 2026 | 1.565 | **1.565** | 0 |
| pré-2026 | 7.245 | 0 | **7.245** |

Mesma fonte, mesmos cinco `source_kind`, e as 8.810 estão em `4.05 Tarifas
bancárias e de cobrança`. O que separou as duas populações **não foi evidência —
foi o escopo de trabalho declarado**, que é 2026. Valor: **R$ 9.213,75**.

Junto vem a população irmã, com evidência ainda mais forte: **619
`PAYMENT_RECEIVED` anteriores a 2026, R$ 386.859,89**, e **619 de 619 têm linha
em `fin_settlement`** apontando para o documento que liquidaram. 595 chegam a uma
contraparte cadastrada por esse caminho (63 contrapartes distintas); os outros 24
param num documento que também está sem contraparte. Isso é vínculo da fonte, não
semelhança de nome.

**Por que isso ficou invisível.** O indicador "contraparte identificada" mede
2026 e marca 95,9%. Na base inteira ele é **38,6%**. Os dois números estão
certos; a diferença de 8.290 lançamentos não aparece em régua nenhuma — o mesmo
padrão dos 795 itens de cartão da §8 de `CONTINUACAO.md`.

**O que NÃO está em jogo:** nenhum centavo, nenhuma categoria, nenhuma DRE. As
7.245 já estão em 4.05 e continuam. Muda de quem o custo aparece pendurado num
relatório de contraparte, e o quanto do acervo consegue ser auditado por
contraparte.

**Opções:** *(a)* estender a decisão da dúvida 13 a todo o acervo, incluindo as
619 por `fin_settlement` — é mecânico e reversível · *(b)* estender só às 619,
que têm vínculo exato da fonte, e deixar as taxas antigas como estão · *(c)*
manter o escopo em 2026 e declarar o resto fora de escopo para sempre, com o
indicador de base inteira publicado ao lado do de 2026 para que ninguém confunda
os dois.

Enquanto não houver resposta, os casos ficam em
`fin_pendencia_identificacao_v` com `alcancavel_agora = true` e
`bloqueado_por = 57` — alcançáveis porque a decisão técnica existe, bloqueados
porque escopo é seu.

---

## 58. A credencial do time é UMA só — quem enviou o reembolso é quem diz que é?

**Em jogo:** a confiabilidade de cada envio do app do time, e a régua com que
quem aprova lê o que está na fila. Hoje, R$ 42.320,34 em 193 itens de reembolso
já existentes e tudo que entrar daqui para frente.

**O fato.** O Basic Auth desta plataforma tem **dois pares** de credencial:
`DASHBOARD_ADMIN_*` e `DASHBOARD_AUTH_*`. O segundo é o do time inteiro. Ele
autentica *"alguém do time"* — nunca *"quem"*. Isso nunca importou porque o
time só lia telas; com o app de envio (migration 0105) ele passa a escrever, e
passa a importar.

**O que foi construído, e por quê.** O app pede que a pessoa **declare** quem é,
e guarda essa declaração numa sessão em banco (`fin_time_sessao`, token opaco,
só o hash persistido). A declaração é escopo suficiente para separar as caixas —
cada um vê só o que enviou —, mas **não é prova de identidade**, e o produto diz
isso em voz alta: `fin_time_sessao.prova = 'declarada'` fica congelado em cada
envio, aparece como selo hachurado ao lado do nome na fila de quem decide, e a
tela de identificação explica o motivo em uma frase.

`fin_person_acesso` (PIN por pessoa) existe e **nasce vazia**, pela mesma razão
que `fin_approval_rule` nasceu vazia na dúvida 27: semear credencial que ninguém
combinou é inventar governança. Se uma pessoa ganhar PIN, a tela passa a exigi-lo
e o envio grava `prova = 'pin'` — sem deploy.

**Opções:**

*(a)* **Manter declarada.** Zero atrito, e a honestidade fica no selo. Adequado
enquanto o time é pequeno e todo mundo se conhece. O risco real não é fraude
elaborada: é alguém escolher o nome errado na pressa e o reembolso cair na conta
de outra pessoa.

*(b)* **Cadastrar PIN para quem manda dinheiro.** O admin define um PIN por
pessoa; a tela passa a exigir. Custa uma conversa por pessoa e resolve o erro
honesto do item (a). Não resolve compartilhamento de PIN — nada resolve, sem
credencial individual de verdade.

*(c)* **Credencial individual no Basic Auth** (um par por pessoa). É a única que
torna a identidade *provada*. Custa administração de credencial no Railway e
muda `middleware.ts`, que hoje compara contra exatamente dois pares.

**Enquanto não houver resposta:** tudo entra com `identidade_prova='declarada'`,
o selo aparece para quem decide, e nenhum número é inventado. A opção (b) é
alcançável hoje, sem código novo — falta só o Fernando dizer quem tem PIN.

---

## 59. A partir de que valor um item de fila vira notificação?

**Em jogo:** 1.555 itens pendentes, R$ 395.818,29 medidos em `fin_review_item`.

**O fato.** As notificações (0105) sabem avisar "item entrou na fila de decisão
acima de um valor". O valor não foi declarado. E ele não pode ser chutado: um
corte baixo demais transforma o sino num contador de quatro dígitos — que é um
sino desligado, porque a pessoa aprende a não olhar em uma semana; um corte alto
demais faz o aviso nunca disparar e a régua existir só no papel.

**O que foi feito.** `fin_notificacao_regra.fila_decisao_valor_cents` nasce
**NULL, com motivo escrito na própria linha**, e o gerador emite **um** aviso
agregado no lugar: *"1.555 itens aguardam decisão; nenhum foi notificado
individualmente porque não há régua"*. Isso mantém o fato visível sem escolher
por ele. As outras três réguas do módulo foram declaradas e entraram semeadas
(extrato D+1, NFe 10 dias, orçamento 95 dias).

**Opções, com o efeito medido de cada uma sobre a fila de hoje:**

*(a)* **R$ 1.000** — notificaria a faixa alta da fila, o que na população atual
é uma minoria dos itens e a maioria do dinheiro.
*(b)* **R$ 5.000** — só o que muda a DRE do mês de forma perceptível.
*(c)* **Nenhuma régua de valor; notificar por IDADE** — "está parado há mais de
N dias". Alinha melhor com o problema real da fila, que é envelhecimento e não
tamanho, e não depende de `amount_cents` (que é NULL em parte dos itens).
*(d)* **Manter o agregado.** Um aviso, sempre atualizado, sem item a item.

Antes de responder, vale ler a dúvida 54: 1.026 dos itens têm alvo anterior a
2026 e estão fora do escopo declarado. Uma régua de valor sobre a fila inteira
notificaria sobre dinheiro que o próprio dono já disse não perseguir.

---

---

## Resolvida — Ancora Imobiliária, R$ 300,00 classificada por precedente

A regra `meios-de-pagamento` (v1) tinha 25 acertos e zero verdadeiros
positivos — procurava banco no texto, não finalidade. Uma frente já corrigiu a
regra para o futuro; este item específico (transação 85894, R$ 300,00) ficou
na fila com a evidência escrita: 9 de 9 lançamentos anteriores da mesma
contraparte (Ancora Imobiliária) já confirmados por humano em 5.01 Aluguel e
condomínio, com trava.

Precedente de 9/9 é evidência forte o bastante para classificar sem
esperar confirmação adicional. Reclassificado para 5.01, travado, com trilha
em `fin_classification_event`.

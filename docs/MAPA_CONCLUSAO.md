# Mapa de conclusão — o que falta, medido

Escrito pelo orquestrador em **16/08/2026**, sobre a branch
`codex/financeiro-conclusao-2026-08-16` (52 commits à frente de `main`).

Este documento não implementa nada. Ele mede o estado contra os 26 critérios de
`PROMPT_CONCLUSAO_BASE.md`, separa o que é trabalho do que é bloqueio de dado, e
entrega o prompt pronto de cada frente que ainda precisa ser aberta.

**Nenhum número aqui foi copiado de outro documento.** Todos foram medidos nesta
sessão, e vários discordam do que está escrito em `CONTINUACAO.md` e
`OBJETIVOS_METAS.md` — que envelheceram, como o próprio §10 avisa que envelhecem.

---

## 0. A medição

```
migrations ............ 82 aplicadas · 1 pendente (0090, não versionada)
caixa ................. 6/6 contas fecham · divergência R$ 0,00 (M15)
invariantes ........... 39 passam · 2 falham (D6, F1)     de 41
monitores ............. 17 na meta · 7 fora               de 24
lançamentos ........... 13.881 · documentos 3.406
test-financeiro ....... 23 verificações ok
test-contabil ......... 28 verificações ok · 0 falhas
validar-cartoes ....... 0 falhas · 10 lacunas declaradas
tsc --noEmit .......... limpo
build:app ............. NÃO VERIFICADO — outra frente segura o lock do next build
```

Indicadores de 2026 (meta 90%):

| indicador | medido agora | o que os docs dizem |
|---|---|---|
| lastro de origem | **99,1%** (3843/3878) | 99,1% ✓ |
| contraparte identificada | **98,5%** (3342/3393) | 98,5% ✓ |
| transferência resolvida | **98,0%** (3802/3878) | 97,8% — subiu |
| categoria atribuída | **97,1%** (3764/3878) | 98,8% — **caiu 1,7 ponto** |
| revisão concluída | **91,3%** (3540/3878) | 91,4% ✓ |
| núcleo definido | **90,6%** (3074/3393) | 90,6% ✓ |
| centro de custo | **1,1%** (39/3393) | 1,1% ✓ — teto de fonte |

> ~~A queda de `categoria atribuída` de 98,8% para 97,1% não tem explicação
> registrada em documento nenhum.~~ **RESPONDIDO em 16/08/2026.** É regressão, não
> decisão: a passagem do scheduler das 08:24 BRT rodou o passo 5 de
> `import-asaas.mjs` antes da correção `11b763e` (11:08 BRT) e gravou
> `category_id = NULL` em **65 lançamentos** cujo documento liquidado não tinha
> categoria — a coorte B da §11 de `CONTINUACAO.md`. 3.829 → 3.764 sobre o mesmo
> denominador de 3.878. A causa já está corrigida no código; as 65 linhas
> dependem da **dúvida 40** porque restaurá-las mexe na DRE. Diagnóstico completo
> no §5 de `CONTINUACAO.md`.

As duas falhas de invariante:

- **D6** — 186 lançamentos, **R$ 390.057,45**. `classified_by='contrato'` com
  `classified_rule_id` preenchido. Medido: são exatamente um grupo, não vários.
  (Os 8.993 lançamentos `fato_estrutural` que também carregam `classified_rule_id`
  **não** são violação — D6 os isenta explicitamente, e D5 valida a evidência
  deles. Não "conserte" isso.)
- **F1** — 2 contas ativas sem cobertura de extrato (`caixa-aplicacao`,
  `caixa-emprestimo`). R$ 0,00 em jogo, bloqueio de dado.

---

## 1. O quadro dos 26 critérios

Legenda: ✅ cumprido · ⚠️ parcial · ❌ não cumprido.
Classificação do que falta: **(a)** alcançável com as fontes existentes ·
**(b)** bloqueio de dado do Fernando · **(c)** já coberto por frente rodando.

| # | critério | estado | evidência medida | falta |
|---|---|---|---|---|
| 1 | Contas inventariadas | ⚠️ | 6 `fin_account`, todas ativas. A matriz 0085 declara uma **7ª**, `caixa-economica-12920000005783083433`, status `conta_fora_do_ledger`, com 5 lançamentos apontando para ela | **(b)** dúvida 5 |
| 2 | Caixa fecha conta a conta | ✅ | 6/6 · divergência R$ 0,00 · G1, G2, M15 passam | — |
| 3 | Saldo bate com a fonte | ✅ | `current_balance = abertura + lançamentos` conta a conta; zero snapshot com variância | — |
| 4 | Cobertura D+1 onde a fonte permite | ⚠️ | 4 contas a **1 dia** (asaas, inter, nubank, nubank-caixinhas). 2 contas a **"nunca"**. `nubank-caixinhas` cobre **46 de 228 dias** de 2026 (lacuna de 181 dias antes) | **(b)** dúvidas 5 e 3 |
| 5 | Nenhuma conta ausente como zero confiável | ❌ | **F1 falha**: 2 contas ativas entram no consolidado como R$ 0,00. A 0085 nomeia a ausência, mas não a preenche | **(b)** dúvida 5 |
| 6 | Cartões por emissor/linha/subcartão | ⚠️ | 3 emissores · 3 linhas · 12 subcartões · 21 faturas · 795 itens. `fin_card_hierarquia_v` de pé; 16 de 25 planos atravessam reemissão e seguem sendo **um** plano | **(b)** 12 cartões sem titular (793 itens, R$ 87.206,95) |
| 7 | Faturas conciliadas | ⚠️ | 0 falhas em `validar-cartoes`. Lacunas: 12 faturas não explicadas (R$ 13.744,87), 4 fora da cobertura (R$ 22.013,66), 9 itens sem itemização (R$ 40.862,41 — Inter não tem API de cartão, provado) | **(a)** parcial + **(b)** |
| 8 | Tudo classificado ou indeterminado explícito | ⚠️ | `fin_transaction` 97,1%. **`fin_document`: 391 sem categoria, R$ 293.432,76.** **`fin_card_transaction`: 500 a classificar, R$ 54.126,76**, cada um com motivo escrito. `fin_indeterminado_v`: 335 linhas, 6 motivos | **(a)** + **(c)** 0094 |
| 9 | A pagar e a receber completos | ❌ | `fin_document`: 3.406 linhas, **100% `direction='receber'`**. Zero contas a pagar. `fin_payment_request` = 0 | **(c)** 0095 + **(b)** dúvida 28 |
| 10 | Salários com histórico e previsão | ✅ | 28 pessoas · 117 contratos de remuneração · `fin_folha_previsao_total_v` · `fin_folha_divergencia_v` | ressalvas: dúvidas 23–26 |
| 11 | MEIs com histórico e previsão | ❌ | 12 MEIs. **R$ 255.936,66 em `6.01 Salários`** por omissão do importador. `folha_sem_mei_cents` inclui MEI ao contrário do próprio nome | **(b)** dúvida 21 |
| 12 | Reembolsos com histórico e previsão | ⚠️ | 81 pedidos · 193 itens · views de pé. Mas **`6.05 Reembolsos` está entre as 17 categorias nunca usadas**; 7 pedidos (R$ 3.456,33) sem par; **0 de 193 itens com anexo** | **(b)** dúvida 22 |
| 13 | Comissões com histórico e previsão | ⚠️ | 309 previstas · 37 pagamentos · 3 papéis · alíquota medida. Backtest erra o mês em 87,7%; a base fica `indeterminado` porque 7 negócios têm 7 bases | **(b)** dúvidas 35 e 39 |
| 14 | Receitas e custos separados | ✅ | D2, D3, D4 passam. `fin_receita_por_grupo_v`, `fin_receita_prioridade_v` (curva ABC) | ressalva: 63 cobranças sem tipo de serviço |
| 15 | Reservas modeladas | ⚠️ | 4 reservas, alvo **R$ 230.547,86**, `current_cents` = **0** nas quatro. Modeladas sim; sem saldo, e por isso "dia do aperto" dá hoje sempre | **(b)** dúvida 32 |
| 16 | Impostos modelados | ⚠️ | `fin_apuracao_tributaria_v` entrega insumo e **declara que não calcula**. Monitor fiscal ok. 3.521 NFS-e. **O plano de contas 7.x tem 3 linhas (DAS, ISS, Retenções) e nenhuma para IOF** — 133 itens de cartão sem destino possível | **(a)** + **(c)** 0092 |
| 17 | Empréstimos modelados | ❌ | Nenhuma tabela de empréstimo. O Pronampe existe só como lacuna de balanço: `passivo superestima emprestimos R$ 147.062,10`. `caixa-emprestimo` com zero lançamento | **(b)** dúvida 5 |
| 18 | DRE saindo do banco | ✅ | `fin_dre_mensal_v`, 64 meses, duas visões. 28 verificações contábeis passam. `folha_do_mes_ja_paga` declara o viés do mês corrente | — |
| 19 | Balanço saindo do banco | ✅ | `fin_balanco_v`: **R$ 0,00 não conciliado**. 6 lacunas nomeadas **com direção do erro** | — |
| 20 | Fluxo saindo do banco | ✅ | `fin_fluxo_caixa_v` + `fin_fluxo_caixa_conta_v` | — |
| 21 | Previsão saindo do banco | ⚠️ | 5 camadas de recebimento + `fin_previsao_saida_v`. **Mas `fin_cash_forecast` tem UMA única foto (16/08/2026, 91 dias) e `fin_previsao_afericao_v` devolve 0 de 91 dias aferíveis.** A previsão nunca foi conferida contra o realizado | **(a)** |
| 22 | Orçamento × realizado | ❌ | `fin_orcado_realizado_v`: **75 linhas, 75 com realizado NULL**. 114 metas, **100% escopo `obras`**, R$ 534.500 | **(b)** dúvida 30 |
| 23 | Comparação tributária com memória de cálculo | ❌ | `fin_regime_resumo_v`: 256 cenários (64 meses × 4), **zero completos**, `total_comparavel_cents` NULL em todos. 7 lacunas bloqueiam os 64 meses: Fator R, folha/pró-labore/MEIs, ISS, RAT/FAP, Terceiros, CBS/IBS, segregação da receita | **(c)** 0092 + **(b)** dúvida 21 |
| 24 | Importadores idempotentes | ✅ | C1–C5, I1, I2 passam. `test-import-guard` de pé. Idempotência do Inter provada em duas execuções reais com ROLLBACK | — |
| 25 | Testes e build passando | ⚠️ | integridade **39/41** — D6 vermelho, R$ 390.057,45, regressão nova. Demais suítes verdes. `tsc` limpo. **`build:app` não verificável nesta janela** (lock de outra frente) | **(c)** 0091 |
| 26 | APIs prontas | ❌ | **27 dos 37 contratos gerenciais não têm rota HTTP.** O próprio `lib/financeiro/contratos/http.ts` diz "as 15 rotas de leitura gerencial"; existem **9** | **(a)** |

```
✅  8 cumpridos
⚠️ 11 parciais
❌  7 não cumpridos
```

Contra o placar de `OBJETIVOS_METAS.md` §5 (8 ✅ / 7 ⚠️ / 9 ❌ / 2 🔄): os
cumpridos não se mexeram, e a retomada do Codex moveu critérios de **não
cumprido** para **parcial**. Nenhum critério regrediu de categoria.

---

## 2. A régua da §6 aplicada — o que estes indicadores NÃO medem

A pergunta 2 da §6 de `OBJETIVOS_METAS.md` é a que achou os dois maiores buracos
desta base. Aplicada de novo, ela acha mais três.

### 2.1 M4 conta 1.535 itens de fila — e metade deles nunca foi tocada

`fin_review_item`, medido:

| target_table | status | itens | R$ |
|---|---|---|---|
| `fin_transaction` | resolvido | **3.580** | 5.895.791,91 |
| `fin_transaction` | pendente | 731 | 759.837,50 |
| `fin_document` | pendente | **804** | **627.931,42** |
| `fin_document` | resolvido | **0** | — |

**Zero documentos foram resolvidos, jamais.** Os 804 são 52% da fila por
contagem e nunca saíram do estado em que nasceram, em 08/08/2026. O monitor M4
soma os dois lados e mostra um número só, então a fila parece uma fila só — e
quem a atacar pelo topo vai resolver `fin_transaction` de novo, que é onde já
houve 3.580 resoluções, sem nunca chegar no lado que nunca andou.

### 2.2 M4 e M5 não enxergam o cartão

O cartão tem **500 itens a classificar, R$ 54.126,76**, e **nenhum deles está em
`fin_review_item`** — `target_table` só assume `fin_transaction` e
`fin_document`. Eles moram numa view paralela, `fin_card_a_classificar_v`.

Consequência: quando a frente 0094 zerar os 1.535, M4 vai bater a meta, M5 vai
dizer que o item mais antigo tem poucos dias, e 500 itens de cartão vão continuar
parados sem aparecer em indicador nenhum. **É o mesmo padrão do §8 de
`CONTINUACAO.md`, repetido num lugar novo.**

Os 500, com o motivo que a própria base escreveu:

| motivo | itens | R$ |
|---|---|---|
| parcela de plano ainda sem categoria (25 planos, 109 com candidato) | 156 | 23.995,12 |
| MCC conhecido mas ambíguo (155 com candidato) | 155 | 23.409,74 |
| **IOF — o plano de contas não tem onde pôr** | 133 | 553,40 |
| nenhuma evidência cadastrada alcança | 46 | 4.215,81 |
| estorno sem a compra nomeada | 6 | 1.529,55 |
| conflito factual vetado (MCC × identidade) | 3 | 333,14 |
| fonte não devolveu MCC | 1 | 90,00 |

> Os outros 14 itens sem categoria (R$ 106.999,04) são `kind='pagamento_fatura'`
> e **devem** ficar sem categoria — o custo vem dos itens, não do pagamento.
> A conta bate com os R$ 107.600,75 de "faturas de cartão pagas" do teste
> contábil. Não é lacuna.

### 2.3 M13 mede categoria morta, nunca categoria ausente

M13 é "categorias nunca usadas: 17/56". Ele encontra linha do plano de contas que
ninguém usa. Ele **não pode encontrar, por construção, a linha que falta** — e há
pelo menos uma: o grupo 7 tem `7.01 DAS`, `7.02 ISS`, `7.03 Retenções`, e IOF não
é nenhum dos três. 133 itens de cartão estão indeterminados por causa disso.

Um indicador de completude do plano de contas que só olha para o que existe vai
marcar 100% numa base à qual falte metade das contas.

### 2.4 A previsão é o único módulo sem backtest

`CONTINUACAO.md` §10 diz: *"backtest é o teste de qualquer detector"* — e foi
backtest que pegou os +37% da receita recorrente e os +75% da comissão. Mas a
previsão de caixa, medida agora:

```
fin_cash_forecast ............ 91 linhas · 1 única foto · 16/08/2026
fin_previsao_afericao_v ...... 91 dias · 0 aferíveis
```

A view que compara previsto contra realizado **existe e nunca produziu uma
linha**. A pergunta "posso confiar nesta previsão?" tem instrumento instalado e
zero leitura.

> **Atacado em 16/08/2026 — migration 0097.** Os 0 aferíveis não eram defeito de
> junção: a única foto foi tirada hoje, o CHECK `fin_cash_forecast_dia_futuro`
> garante que todos os 91 dias dela estejam no futuro, e o ledger vai até 15/08.
> A interseção era vazia por construção. O defeito real era outro e estava no
> `aferivel = (r.dia IS NOT NULL)`: dia coberto **sem movimento** contava como
> não aferível, misturando "não houve movimento" com "ainda não sei" no mesmo
> NULL. A 0097 amarra a aferibilidade à cobertura de extrato, põe
> `prever-caixa.mjs --aplicar` no scheduler (idempotente pela chave
> `fin_cash_forecast_foto_key`) e entrega o primeiro erro medido: a camada
> `cobranca_emitida` acerta **90,4%** em 30 dias, mediana de 12 referências
> reconstruídas das datas do próprio documento. Foto retroativa foi **medida e
> recusada** — ver o cabeçalho da 0097 para as cinco evidências.

### 2.5 O que a "regra zero" não mede, e já se sabia

"6/6 contas fecham" mede as contas que estão em `fin_account`. A sétima não está,
então sua divergência é estruturalmente invisível — M15 nunca poderá acusá-la.
A 0085 resolveu o que dava: a conta aparece na matriz com status
`conta_fora_do_ledger` e 5 lançamentos apontando para ela. Está declarado; segue
sendo 6 de 7.

### 2.6 Uma verificação que fiz e deu negativo — não reabra

Cogitei uma frente para as 63 cobranças sem tipo de serviço declarado
(R$ 79.265,35), porque é uma das perguntas da §2. **Medi antes de propor:**

| contraparte tem contrato no ERP com… | lançamentos | R$ |
|---|---|---|
| **1 serviço só** (determinável por evidência) | **3** | 13.500,00 |
| 2 serviços | 8 | 16.500,00 |
| 4 serviços | 2 | 4.250,00 |
| nenhum contrato no ERP | **50** | 45.015,35 |

Só 3 lançamentos são resolvíveis sem inventar rateio, e os outros 60 caem na
dúvida 8 (o ERP guarda *quais* serviços, nunca *quanto* cada um vale). Não vale
uma frente. Registrado aqui para ninguém remedir.

---

## 3. As frentes a abrir — ordenadas por impacto

Só entram aqui os **(a)**: alcançáveis com as fontes existentes. Migrations 0091
a 0095 estão reservadas às frentes em voo; estas usam **0096 em diante**.

---

### FRENTE 1 — As 27 rotas que faltam · sem migration · **maior impacto**

**Por que é a primeira.** O objetivo declarado é *"faltar somente o design/
implementação visual das telas"*. Uma tela não pode ser desenhada contra uma
função que não tem URL. Existem 37 contratos gerenciais escritos, tipados e
compilando — e 27 deles não são alcançáveis por HTTP. Isto destrava **11 das 25
perguntas da §2** de uma vez, é somente leitura, não toca migration nenhuma e
não pode quebrar o caixa.

`CONTINUACAO.md` §11 já tinha dito a frase: *"contrato TypeScript não é
endpoint"*. Ninguém agiu sobre ela.

#### Prompt pronto

> **Missão.** Expor como rotas HTTP GET os 27 contratos gerenciais de
> `lib/financeiro/contratos/` que hoje não têm rota. Nenhuma lógica de negócio
> nova: o trabalho é de integração, e o critério de pronto é que toda pergunta da
> §2 de `docs/OBJETIVOS_METAS.md` tenha uma URL que a responda.
>
> **Contexto medido (16/08/2026).** `lib/financeiro/contratos/` exporta 37
> funções `get*`. Dez têm rota: `getApuracaoTributaria`, `getBalanco`,
> `getComissao`, `getContratosEParcelas`, `getDrePorDimensao`, `getFluxoPorConta`,
> `getFolhaPrevisao`, `getLancamentos`, `getReceitaPorGrupo`, `getRecorrentes`.
> **Não têm rota:** `getAlcadas`, `getAuditoria`, `getBancos`,
> `getCaixaDeDecisoes`, `getCartao`, `getCobertura`, `getConciliacao`,
> `getContasAPagar`, `getContasAReceber`, `getFilaCompra`, `getFilaPagamento`,
> `getFluxoDeCaixa`, `getItensDaFila`, `getLotes`, `getMargemPorProjeto`,
> `getOpcoesLancamentos`, `getOrcadoRealizado`, `getPendencias`, `getPessoas`,
> `getPrevisao`, `getPrevisaoRecebimento`, `getPrioridadeReceita`,
> `getReembolsos`, `getResultado`, `getSolicitacao`, `getTesouraria`,
> `getVisaoExecutiva`.
>
> `npx tsc --noEmit` passa limpo hoje — a camada de contrato está sã; só falta
> a tradução HTTP.
>
> **Priorize nesta ordem**, porque é a ordem das perguntas do Fernando:
> 1. `getResultado` — "qual o resultado do mês". Hoje só existe a quebra
>    dimensional (`dre/dimensao`); a DRE mensal em si não tem endpoint.
> 2. `getPrioridadeReceita` — a curva ABC. É a **prioridade nº 3 declarada** dele,
>    com as palavras *"quero ver por grupo e todo detalhe dos principais"*.
> 3. `getPrevisao` + `getPrevisaoRecebimento` — "quanto entra, quanto sai, em que
>    dia o caixa aperta".
> 4. `getCobertura` — a matriz 0085. É a resposta a "posso confiar neste número?".
> 5. `getCaixaDeDecisoes` + `getItensDaFila` + `getPendencias` — o
>    `PROMPT_CONCLUSAO_BASE.md` diz que as filas de indeterminado **não são
>    relatório, são as telas de decisão**.
> 6. O resto.
>
> **Fontes.** `lib/financeiro/contratos/*.ts` (os 37 contratos e o cabeçalho de
> `index.ts`, que declara o estado de cada domínio);
> `lib/financeiro/contratos/http.ts` (o padrão obrigatório);
> `app/api/financeiro/gerencial/*/route.ts` (as 9 rotas existentes, que são o
> gabarito); `app/api/financeiro/gerencial/_parametros.ts`.
>
> **Invariantes a preservar.**
> - O **envelope viaja inteiro, sempre**: `dado`, `cobertura`, `frescorPior`,
>   `pendencias`, `ressalvas`, `medidoEm`. Achatar para "o que a tela precisa" é
>   escolher o número e descartar o motivo — exatamente a mentira que este ledger
>   foi construído para não contar.
> - `disponivel: false` ⇒ **503 com o corpo completo**, nunca 500 seco nem 200
>   vazio. 200 com dado vazio é indistinguível de "não houve movimento".
> - `export const dynamic = "force-dynamic"` e `revalidate = 0` em toda rota;
>   `Cache-Control: no-store`. Um DRE servido de cache é um DRE de data
>   desconhecida.
> - Todo parâmetro passa pelos validadores de `http.ts` (`anoDe`, `mesDe`,
>   `dataDe`, `opcaoDe`, `inteiroDe`, `textoDe`, `bandeiraDe`). `?ano=abc` é 400,
>   nunca um `NaN` que escorre até o SQL.
> - **Somente GET.** Nenhuma rota nova expõe outro verbo.
> - **`fin_orcado_realizado_v` devolve 75 realizados NULL e a rota tem de
>   devolver `null`, não `0`.** Zero é uma afirmação sobre o dinheiro; ausência é
>   uma afirmação sobre o dado. Está no §5 de `CONTINUACAO.md`.
> - Autenticação: o financeiro é do perfil admin. 401 em tudo é o comportamento
>   saudável; não existe rota `/api/health`.
>
> **Migration reservada:** nenhuma. Se você achar que precisa de uma, parou de
> fazer esta frente e começou outra — registre e pare.
>
> **Regras.** Não afrouxe teste nem CHECK. `npx tsc --noEmit` e as suítes
> (`test:integridade -- --strict`, `test-financeiro`, `test:contabil`) têm de
> continuar passando. erp-obras somente leitura. APIs externas somente GET.
> Nunca `git add -A` — há ~7 frentes na árvore; versione caminho a caminho.
> Commite em lotes pequenos e coerentes, por domínio.
> `build:app` pode estar travado por outra frente rodando `next build`: isso é
> concorrência, não defeito — espere e repita.
>
> **Entregável.** As 27 rotas, cada uma com o comentário `/** GET /api/... */` no
> padrão das 9 existentes; uma tabela em `docs/` ligando **cada pergunta da §2 de
> `OBJETIVOS_METAS.md` à URL que a responde**, e nomeando as que continuam sem
> resposta e por quê; e a correção do comentário de `http.ts`, que hoje afirma
> "as 15 rotas de leitura gerencial" quando existem 9.

---

### FRENTE 2 — O cartão entra na fila · migration **0096**

**Por que.** R$ 54.126,76 em 500 itens que nenhum monitor enxerga. E o valor
maior não é o dinheiro: é fechar o buraco estrutural de que a fila de revisão
tem duas implementações paralelas, uma medida e outra não.

**⚠️ Não comece antes de a frente 0094 fechar.** Ela está reescrevendo
`fin_review_item` (M4) e o plano de contas (M13). Ver §4.

#### Prompt pronto

> **Missão.** Unificar a fila de decisão do cartão com a fila de revisão do
> ledger, para que os itens de cartão passem a ser medidos pelos mesmos monitores
> que medem o resto — e resolver o que a evidência já permite resolver.
>
> **Contexto medido (16/08/2026).**
> - `fin_card_transaction`: 795 itens. 281 com categoria, **514 sem**. Destes,
>   **14 são `kind='pagamento_fatura'` e devem continuar sem categoria** (o custo
>   vem dos itens; o pagamento é caixa) — conferem com os R$ 107.600,75 de
>   "faturas de cartão pagas" do `test-contabil`. **A lacuna real é 500 itens,
>   R$ 54.126,76**, todos listados em `fin_card_a_classificar_v` com motivo.
> - `fin_review_item.target_table` assume hoje **só** `fin_transaction` e
>   `fin_document`. Nenhum item de cartão está na fila.
> - Por isso **M4 (1.535) e M5 (idade do mais antigo) não contam o cartão**.
> - Composição dos 500: 156 itens em **25 planos de parcelamento** (109 com
>   candidato) · 155 com **MCC ambíguo** (todos com candidato) · **133 de IOF** ·
>   46 sem evidência alcançável · 6 estornos sem a compra nomeada · 3 com
>   conflito factual vetado · 1 sem MCC na fonte.
>
> **O que é alcançável, e como.**
> 1. **Os 25 planos.** A própria base escreveu: *"Decidir UMA vez no plano
>    resolve todas as parcelas — inclusive as que atravessam reemissão de cartão."*
>    156 itens caem com 25 decisões. Entregue o mecanismo: a decisão no plano
>    propaga para as parcelas, inclusive as futuras que ainda vão nascer, e
>    **sem quebrar o plano em vários na troca de final** — 16 dos 25 planos já
>    atravessam mais de um final e continuam sendo um plano cada.
> 2. **Os 155 de MCC ambíguo têm candidato.** Não carimbe o candidato: leve-o
>    para a fila **como sugestão com a evidência à vista**, no padrão que o
>    commit `85a900b` já estabeleceu para a tela de qualificação.
> 3. **Os 133 de IOF são um buraco de modelo, não de classificação.** O `kind`
>    da fonte já diz que é IOF; o plano de contas é que não tem onde pôr — o
>    grupo 7 é só `7.01 DAS`, `7.02 ISS`, `7.03 Retenções`. **Não invente a
>    linha.** Registre em `DUVIDAS_FINANCEIRO.md` com o valor (R$ 553,40 em 133
>    itens) e as opções, e deixe-os indeterminados com motivo.
>
> **Invariantes a preservar.**
> - **Cartão continua fora do caixa.** Nenhuma `fin_account` com `kind='cartao'`,
>   e o CHECK de `fin_account.kind` não aceita esse valor. Não mexa nisso.
> - Fatura pertence à linha de crédito. Só o pagamento da fatura movimenta caixa;
>   o custo vem dos itens, na competência.
> - Troca de final no meio do parcelamento **não pode** quebrar um plano em
>   vários. `validar-cartoes.mjs` prova isso hoje e tem de continuar provando.
> - Não invente limite por subcartão quando a fonte só dá o consolidado.
> - Os 6 estornos sem compra nomeada **ficam indeterminados**: carimbar 3.90
>   reduziria RECEITA em vez de reduzir despesa.
> - 6/6 contas continuam fechando; a soma por conta não muda.
>
> **Migration reservada: 0096.** 0091–0095 são das frentes em voo.
>
> **Regras.** Dry-run com contagem e valor antes/depois, transação,
> idempotência, trilha de auditoria e reversão em toda escrita em lote — o padrão
> é não gravar. Não afrouxe CHECK nem teste para o seu código passar: nesta base,
> violação de CHECK já revelou várias vezes que a suposição estava errada, não o
> schema. Não altere migration aplicada; corrija com migration nova. erp-obras
> somente leitura. APIs externas somente GET. Nunca `git add -A`. Commite no meio.
>
> **Entregável.** `fin_review_item` cobrindo o cartão, com M4 e M5 passando a
> contá-lo (e o novo valor de M4 declarado, que vai **subir** — isso é correto, e
> escreva por quê, no espírito do §5 de `CONTINUACAO.md`); o mecanismo de decisão
> por plano; a fila de sugestões com evidência; a dúvida do IOF registrada com
> valor e opções; e `validar-cartoes.mjs` continuando com 0 falhas.

---

### FRENTE 3 — A previsão nunca foi conferida · migration **0097**

**Por que.** É o único módulo desta base sem backtest, e o backtest é o que pegou
os dois maiores erros de estimativa do projeto. Hoje a plataforma projeta 91 dias
e não tem como dizer se acerta.

#### Prompt pronto

> **Missão.** Fazer a aferição da previsão de caixa produzir leitura — e virar
> monitor. A pergunta a responder é "posso confiar nesta previsão?", e hoje o
> instrumento existe e está mudo.
>
> **Contexto medido (16/08/2026).**
> ```
> fin_cash_forecast ........ 91 linhas · 1 única foto · gerado_em = 2026-08-16
> fin_previsao_afericao_v .. 91 dias · 0 aferíveis · erro_dia sempre NULL
> ```
> `scripts/prever-caixa.mjs` grava a foto com `--aplicar` e **não está em
> `scripts/scheduler.mjs`** — confira a lista de jobs: há sync do Asaas, do Inter,
> backup e lifecycle da fila, e não há previsão. Por isso existe uma foto só: a
> que alguém rodou à mão.
>
> A previsão de saída cobre **71,7% do que sai**, com um buraco declarado de
> R$ 43.059,77/mês (dúvida 34) impresso a cada execução. Isso é desenho, não
> defeito — não "feche" o buraco com mediana sem decisão do Fernando.
>
> **O trabalho.**
> 1. A foto diária passa a ser gravada pelo scheduler, com as premissas
>    versionadas junto (`premissas_versao` já existe no modelo). Sem isso, daqui a
>    30 dias ainda não haverá o que aferir.
> 2. Reconstrua as fotos passadas **só onde a reconstrução for determinística** —
>    a partir das premissas versionadas e do estado dos documentos na data. Onde
>    o estado passado não for recuperável, **não estime**: declare o período como
>    não aferível, com motivo, no espírito do §2 de `OBJETIVOS_METAS.md`.
> 3. A aferição vira monitor, com limiar declarado e justificado — no padrão dos
>    24 monitores existentes, que dizem `limiar:` e `em jogo:`.
>
> **Invariantes a preservar.**
> - A previsão **não** inclui `fin_pipeline_ganho` (não tem data nem forma de
>   pagamento) nem `fin_comissao_prevista` (sairia dentro do lote da folha, que o
>   `variavel_cents` já projeta — somar contaria o mesmo dinheiro duas vezes).
> - Cobrança emitida vence projeção de recorrente: sem essa trava a previsão
>   somava R$ 1,27 milhão falso (0061).
> - A BRA/PIAU prevê pelo **mês anterior**, não pela mediana de 32 meses. Regra
>   declarada pelo Fernando.
> - As 5 camadas (`cobranca_emitida`, `assinatura`, `parcelamento`,
>   `ativo_de_fato`, `vencido_a_receber`) não se misturam nem se somam sem dizer.
> - O caixa livre continua descontando o alvo da reserva **até a dúvida 32 ser
>   respondida** — o alarme que toca sempre é verdadeiro, e trocá-lo por um alarme
>   silencioso sem decisão humana é pior.
> - 6/6 contas continuam fechando.
>
> **Migration reservada: 0097.**
>
> **Regras.** Dry-run é o padrão; `--aplicar` grava. Âncora de dinheiro: a soma
> por conta não pode mudar. Não afrouxe teste. Não altere migration aplicada.
> erp-obras somente leitura. APIs externas somente GET. Nunca `git add -A`.
> Commite no meio.
>
> **Entregável.** O job no scheduler; a série de fotos com o que for
> determinístico e o resto declarado não aferível; o monitor de erro da previsão
> com limiar justificado; e o primeiro número medido de acerto — **mesmo que seja
> ruim**. Um erro medido vale mais que uma previsão sem erro conhecido.

---

## 4. Sobreposições e riscos de colisão

| risco | frentes | o que fazer |
|---|---|---|
| **`fin_review_item` reescrito por duas frentes** | 0094 (fila M4) × **FRENTE 2** | Colisão direta na mesma tabela. **Sequencie:** a FRENTE 2 não começa antes de 0094 commitar. Melhor ainda: mande o §2.2 deste documento para a 0094 e deixe que ela mesma absorva o cartão — quem já está com a tabela na mão paga o custo menor |
| **Plano de contas** | 0094 (categorias M13) × **FRENTE 2** (IOF) | 0094 vai mexer nas 17 categorias mortas; a FRENTE 2 tem uma categoria **ausente**. Mesma tabela, direções opostas. Entregue o achado do IOF a 0094 antes de ela decidir o que aposentar |
| **0094 pode declarar vitória cedo** | 0094 | Ela vê "M4 = 1.535". Não vê que **804 são documentos que nunca foram resolvidos uma vez** e que 500 itens de cartão estão fora da conta. Zerar 1.535 não é zerar a fila |
| **0092 (tributário) depende de decisão humana** | 0092 × dúvida 21 | `fin_regime_resumo_v` tem 0 de 256 cenários completos e 7 lacunas bloqueantes, das quais **"Fator R e anexo aplicável"** e **"Folha, pró-labore e MEIs"** são a dúvida 21. A frente pode montar a memória de cálculo e a citação de fonte oficial, **mas não pode concluir qual regime vence.** Se o relatório dela disser que um regime vence, está errado |
| **0092 × dúvida 0** | 0092 | As 205 linhas de Pró-labore→Salários têm consequência tributária. `reclassificar.mjs --conta=inter` continua travado. Se a frente tributária rodar o reclassificador para "arrumar a base", ela decide a dúvida 0 no automático |
| **0091 (D6) pode escolher o que faz o teste passar** | 0091 | As 186 linhas dizem duas coisas ao mesmo tempo. **A trilha decide, não a conveniência.** E cuidado: os 8.993 lançamentos `fato_estrutural` com `classified_rule_id` **não são violação** — D6 os isenta de propósito e D5 valida a evidência deles. "Limpar" esses 8.993 quebraria D5 |
| **0093 aplica a 0090** | 0093 | `0090_fin_fila_casos_lifecycle.sql` está pendente **e não versionada**, junto de `fin-review-lifecycle.mjs` e `test-fila-casos-lifecycle.mjs`, mais modificações soltas em `package.json`, `import-asaas.mjs`, `reclassificar.mjs` e `scheduler.mjs`. Aplicar a 0090 muda a fila — **o que colide com 0094 e com a FRENTE 2**. Ordem certa: 0093 → 0094 → FRENTE 2 |
| **`next build` é recurso exclusivo** | todas | O lock do `next build` derrubou minha verificação duas vezes nesta sessão. Uma frente por vez roda `build:app`; as outras usam `npx tsc --noEmit`, que não disputa lock |
| ~~**A queda de `categoria atribuída`**~~ | **resolvido** | Causa achada em 16/08: o passo 5 de `import-asaas.mjs`, na passagem do scheduler das 08:24 BRT, herdou categoria nula de 65 documentos sem categoria. Corrigido no código por `11b763e`; as 65 linhas viram **dúvida 40**. Ver §5 de `CONTINUACAO.md` |
| **FRENTE 1 não colide com ninguém** | — | É `app/api/**` e nenhuma frente em voo toca lá. Pode rodar em paralelo com todas |

---

## 5. O que só o Fernando responde — consolidado, por impacto financeiro

| R$ em jogo | # | pergunta | o que trava |
|---|---|---|---|
| **2.456.359,27** | 4 | Existem extratos de Inter e Nubank de 2022–2025? | M7·fonte: **243 pernas** sem par possível (o doc dizia 167 — cresceu). Sem isso, "transferência resolvida" carrega uma impossibilidade estrutural para sempre |
| **2.105.576,09** | 37 / 38 | Onde está a planilha de 21 abas com a aba "Fluxo de Caixa"? | A **prioridade nº 2** declarada dele ("bater com o previsto"). As 12 abas do arquivo atual alinham **1,1%**; não é versão nova, é outro modelo |
| **647.131,00** | 8 | Quanto vale cada serviço num contrato multisserviço? | "Receita por tipo de serviço" para 52 contratos. Medi: só 3 dos 63 lançamentos indeterminados são resolvíveis por evidência (§2.6) |
| **534.500,00** | 30 | Existe meta de orçamento de escopo **empresa**? | Critério 22 inteiro: 114 metas, 100% `obras`; 75 de 75 linhas com realizado NULL |
| **264.206,66** | 21 | Em que conta contábil ficam os MEIs? | **O Fator R, o anexo do Simples e o critério 23 inteiro.** R$ 255.936,66 estão em `6.01 Salários` por omissão do importador, não por decisão |
| **230.547,86** | 32 | A reserva tem alvo e não tem saldo — descontar o alvo ou o saldo? | "Em que dia o caixa aperta" responde **hoje** nos três cenários. Verdadeiro e inútil |
| **215.500,00** | 1 | Os 20 movimentos do Asaas de 2021–2023 | `/transfers` do Asaas responde 403; não há segundo caminho |
| **147.062,10** + 25.400/ano | 5 | Extrato da 7ª conta Caixa `12920000005783083433` e contrato do Pronampe | **F1, M8×2 e os critérios 1, 4, 5 e 17.** O "6/6 fecham" é 6 de 7 |
| **516.717/ano** | 34 | O buraco de R$ 43.059,77/mês na previsão de saída | Deixar a lacuna visível ou criar camada estimada. A previsão é otimista em ~28% |
| **402.676,93** | 10 | As 138 parcelas vencidas que nunca viraram cobrança | Faturamento atrasado, recebido por fora, ou contrato que não andou? O `status` não arbitra: 470 de 471 estão `PREVISTA` |
| **291.720,00** | 7 | Os 18 clientes do ERP sem CNPJ | 21 contratos sem casar. Ligar por nome é o erro que a A6 existiu para desfazer |
| **170.400/ano** | 33 | Confirmar as 11 recorrentes de despesa (R$ 14.207,21/mês)? | Cobertura da previsão de saída: 71,7% → ~81% |
| **164.205,66/ano** | 39 | Comissão: escala por volume ou 5% em 4 parcelas? | R$ 44.205,66 de diferença entre as regras + R$ 120.000/ano de fixo com risco de dupla contagem com a folha |
| **87.206,95** | — | Quem é o titular de cada cartão? | 12 cartões, 793 itens. Critério 6 |
| **13.744,87** | — | As 12 faturas de cartão não explicadas | Critério 7 |
| **3.456,33** | 22 | Reembolso vai para 6.05 ou fica em 6.01? | 7 pedidos sem par no extrato; **0 de 193 itens com comprovante**. `6.05` é uma das 17 categorias mortas |
| **553,40** | *nova* | **Onde entra o IOF no plano de contas?** | 133 itens de cartão indeterminados. O grupo 7 tem 3 linhas e nenhuma serve. **Não existe dúvida registrada sobre isto** — registre |
| estrutural | 19 | O Adryan carimba projeto retroativo jan–jun? | O **único indicador vermelho** (1,1%). 861 linhas em `erp_extrato_linha`, 112 carimbadas, `fin_obra_apontamento` **vazia**. Não há segundo caminho |
| estrutural | 28 | Onde nasce a conta a pagar? | `fin_document` é 100% `receber`. Enquanto for assim, a previsão de saída **nunca** fica completa |
| estrutural | 27 | Quais são as faixas de alçada? | `fin_approval_rule` = **0 linhas**, `fin_payment_request` = **0**, `fin_payment_approval` = **0**. A fila de pagamento nunca foi exercida. É desenho, não defeito |
| estrutural | 29 | Cadastrar conta de favorecido na primeira vez que pagar? | `fin_payee_account` = **0 linhas** |
| estrutural | 0 | Pró-labore → Salários: as 205 linhas | Trava `reclassificar.mjs --conta=inter`. **Consequência tributária**, e portanto acoplada à dúvida 21 |

### Duas coisas novas para a lista

1. **O IOF não tem casa no plano de contas** (§2.3). Nunca foi perguntado.
2. **As lacunas do cartão apontam para dúvidas erradas.** Os motivos gravados em
   `fin_card_a_classificar_v` dizem "Ver dúvida 20" (IOF) e "Ver dúvida 21"
   (estorno), mas a dúvida 20 é sobre os vínculos órfãos de abril e a 21 é sobre
   os MEIs. Quem seguir a referência não acha a pergunta. Some-se a isso que a
   tabela-resumo de `DUVIDAS_FINANCEIRO.md` lista 19 das 36 dúvidas e que os
   itens 13 e 14 aparecem duplicados no arquivo. **A frente de auditoria final já
   tem esse conserto no escopo** (`CONTINUACAO.md` §7) — não abra frente nova.

---

## 6. O veredito, nas palavras que o prompt exige

> *"Se ainda faltar qualquer regra de negócio, ingestão, conciliação, modelo,
> teste, API ou dado alcançável pelas fontes existentes, não dizer que falta
> apenas design."*

**Não falta apenas design.** Faltam, medidos e alcançáveis pelas fontes que já
existem:

- **27 rotas HTTP** para contratos já escritos, tipados e compilando (critério 26);
- **500 itens de cartão**, R$ 54.126,76, invisíveis a todo monitor (critério 8);
- **a aferição da previsão**, com instrumento instalado e zero leitura (critério 21).

Fora isso, o que resta é bloqueio de dado do Fernando — 22 perguntas, listadas
na §5 — ou está com frente em voo (0091 a 0095).

> **Não some a coluna "R$ em jogo" da §5.** Ela mistura estoque (R$ 2,4 milhões
> de pernas sem par) com fluxo anualizado (R$ 516.717/ano do buraco da previsão)
> e com massa comparada (R$ 2,1 milhões da planilha). Somar daria ~R$ 8,2
> milhões e seria exatamente a dupla contagem que esta plataforma já cometeu
> entre telas. A coluna serve para **ordenar**, não para totalizar.

E a régua zero continua de pé: **6/6 contas fecham, divergência R$ 0,00.**

# Auditoria de telas — uma a uma, contra o banco · 17/08/2026

Quem escreveu: agente de auditoria. **Nenhum código foi alterado.** O único
arquivo escrito por esta frente é este. Nenhuma migration foi aplicada,
nenhum `--aplicar` rodou, nenhum `npm run build:app` foi executado.

---

## 1. Como isto foi medido (leia antes de acreditar em qualquer número abaixo)

Três instrumentos, e é importante saber qual produziu cada linha:

| instrumento | o que é | o que prova |
|---|---|---|
| **PROD** | `https://web-production-ee3c4.up.railway.app`, Basic Auth `xpeadmin` | o que o Fernando vê hoje |
| **HEAD** | `next dev` numa **cópia isolada do commit `85a900b`** (`git archive HEAD`), porta 3210, apontando para o **mesmo** `FINANCE_DATABASE_URL` de produção | o que produção mostraria se o deploy estivesse em dia |

> **A árvore andou durante a auditoria.** Quando ela começou, `main` estava em
> `85a900b` e é desse commit que a cópia isolada foi feita. Enquanto ela corria,
> as duas frentes em andamento commitaram: `b05d9c5` (alarme de fonte, migration
> `0109`, `/financeiro/fontes`) e `030635b` (navegação: *"duas navegações de 33
> itens viram seis lugares e uma barra lateral"*). **Nada abaixo foi medido
> nesses dois commits.** As divergências de número (§5.3, §5.6, §5.11, §5.16,
> §5.17) são de consultas e vivem em `lib/financeiro/`, então devem ter
> sobrevivido intactas; as observações sobre **navegação e posicionamento de
> ressalva na tela** podem ter sido alteradas por `030635b`, e §4.26 sobre
> `/financeiro/fontes` foi escrita quando aquela tela ainda não existia na
> árvore. Reconferir esses dois pontos antes de agir sobre eles.
| **DB** | `psql` no `FINANCE_DATABASE_URL`, somente `SELECT` | a verdade contra a qual as telas foram conferidas |

A cópia isolada foi necessária porque **em produção o módulo financeiro inteiro
está morto** (§2) — não dá para comparar "número da API contra número do banco"
quando toda API devolve `disponivel: false`. A cópia vive fora do repositório,
não usa o `.next` da árvore de trabalho e não interfere com as duas frentes em
andamento.

Para as telas que renderizam no cliente, o DOM foi capturado **depois da
hidratação**, com Chrome headless (`--dump-dom`). Onde isso não foi possível
está dito na seção da tela.

**O que NÃO foi exercitado, e por quê:**

- **`/financeiro/fontes`** — 404 em PROD e ausente do HEAD: os arquivos
  (`app/financeiro/fontes/`, `components/financeiro/FinFontes.tsx`,
  `lib/financeiro/fontes.ts`, migration `0109`) estão **não commitados**, são da
  frente que está construindo agora. Não auditei.
- **Fluxos de escrita** (confirmar custo, reclassificar lote, aplicar regra,
  aprovar reembolso) — não foram disparados: escreveriam no ledger de produção.
  Onde há defeito no tratamento da resposta, ele foi provado pela via da API
  (resposta de erro real) + leitura do manipulador, e isso está dito na linha.
- **Perfil `comum`** — a credencial fornecida é a de admin. Não conferi o 404
  do perfil comum.

**Efeito colateral medido durante a auditoria:** `GET /api/notificacoes` **grava
no banco** (§4.6). As chamadas desta auditoria incrementaram
`fin_notificacao.ocorrencias` de 23 para 24. Nenhum centavo foi tocado.

### Números de referência remedidos agora (17/08/2026, ~16:00 BRT)

```
migrations aplicadas ....... 99   (última: 0108, applied_by='reparo:frente-catalogo-custo-fixo')
lançamentos ................ 13.882   (13.263 não-transferência)
documentos ................. 3.419   (3.407 a receber · 12 a pagar)
cartão ..................... 795 itens · 281 com categoria
pessoas 28 · contrapartes 495 · fila de revisão pendente 1.556 (R$ 1.329.961,79)
saldos: asaas 78.654,14 · nubank 11.682,57 · caixinhas 27.700,17 · inter 1.576,59
        caixa-aplicacao e caixa-emprestimo: opening_balance 0 e ZERO movimento
custos previstos: set 122.530,70 (64 itens, 33 somam) · out 117.921,84 · ago indeterminado
notificações: 8 não lidas · 5 resolvidas
regras: 58 ativa · 3 proposta · 3 arquivada
```

---

## 2. O achado que domina todos os outros: **produção não fala com o banco**

`/financeiro` inteiro está degradado em produção **agora**. Não é intermitência.

**Causa, medida no log do Railway** (projeto `xpe-plataforma`, serviço `web`,
`2026-08-17T15:03:16Z`):

```
[migrate] FALHA ao aplicar migrations — /financeiro ficará indisponível:
migrations registradas no banco mas ausentes do disco:
  0108_fin_custo_fixo_catalogo.sql, 0107_fin_mei_teto.sql.
Restaure os arquivos ou remova os registros manualmente.
```

`scripts/server.mjs` chama `runMigrationsOrDegrade()` no boot; ele falha e
carimba `FIN_SCHEMA_OK=0`. A partir daí `financePool()` (`lib/financeiro/db.ts`)
lança `FinanceUnavailableError` em **toda** consulta:

```
⨯ Error [FinanceUnavailableError]: schema financeiro indisponível (migrations falharam no boot)
```

O banco está **vivo e íntegro** — esta auditoria leu 13.882 lançamentos dele. O
que está quebrado é o binário implantado: ele é anterior aos commits `f17e5b7`
(MEI) e `df26dc2` (custo fixo), enquanto o banco já tem 0107 e 0108 aplicadas.
É a consequência direta do incidente descrito em `CONTINUACAO.md` §6 e nos
commits `dd5fa5d` / `115cf8c`.

**Consequência auditável:** as ~21 telas do financeiro em produção estão em um
de três estados, e **os três não são equivalentes**:

| estado | telas | veredito |
|---|---|---|
| degrada dizendo o que falta | financeiro, painel, agenda, contas, custos, fluxo, modelo, pessoas, planejamento, qualificar, receitas, reembolsos, resultado, revisao, time | **ok** — é o comportamento prometido |
| **afirma zero** onde não sabe nada | **lançamentos, categorizacao, regras** | **defeito** — §5.1 |
| **quebra** (500) ou some | **importar (500)**, indicadores (fica só com um parágrafo), custos-fixos/mei/fontes (404) | **defeito** — §5.2 |

Enquanto isso não for resolvido, **tudo da §4 é inalcançável para o usuário**.

---

## 3. Correções anteriores que foram conferidas e ESTÃO vivas

Duas coisas que a instrução mandou desconfiar, e que passaram:

- **"Mês corrente indeterminado" dispara.** `GET /api/financeiro/gerencial/custos?mes=2026-08`
  devolve `totalIndeterminado: true` com motivo *"o horizonte da previsão começa
  hoje — o que este mês previa já passou ou já virou lançamento"*, e a tela
  imprime a palavra **indeterminado** no lugar do número. O bug de comparação
  `"2026-08-01"` vs `"2026-08"` não está mais no ar.
- **A armadilha do parâmetro é real e está confirmada** (§5.9): o parâmetro é
  `mes`, não `competencia`. `?competencia=2026-09` devolve agosto, com 200.

E o índice de validação principal fecha: `/financeiro/resultado` mostra
`abertura R$ 88.799,25 + DRE de caixa R$ 30.814,22 = saldo hoje R$ 119.613,47`,
resíduo **R$ 0,00** — conferido contra a soma de `opening_balance_cents` das
contas (R$ 88.799,25) e contra os saldos por conta.

---

## 4. Tela a tela

Legenda do veredito: **ok** · **ressalva** (correto mas mal dito) · **defeito**
(o número ou o comportamento está errado).

---

### 4.1 `/` — raiz, "XPE Consultoria | Indicadores 2026"

- **Promete:** o painel comercial do ano — forecast, risco, alavanca.
- **PROD:** 200, 2,2 MB, conteúdo completo. **Não depende do banco financeiro**
  (lê `data/processed/*.json` do volume) — por isso é a única página grande viva
  em produção.
- **Entrega:** Forecast R$ 2.789.438 · 2026.1 R$ 1.531.456 · 2026.2 R$ 1.257.982.
- **Ressalva medida:** o rodapé de frescor diz *"Dados de há 4h · **4 fontes sem
  atualizar**"*, e o `title` do link nomeia as quatro: `sync Meta Ads +
  Instagram`, `análise do bot de pré-vendas`, `análise de marketing`, **`backup
  do financeiro`**. O link vai para `/auditorias` (200). Que o **backup do
  financeiro** esteja entre as fontes paradas merece atenção fora desta
  auditoria.
- **Ressalva:** o card diz *"2026 até agora R$ 1.614.856 · YTD · 141
  fechamentos · **jun parcial**"* e outro diz *"Jan–mai real + **jun
  estimado**"*. Em 17/08 esses rótulos estão dois meses atrasados — o artefato
  descreve uma foto de junho com carimbo de "há 4h".
- **Veredito: ok, com ressalva.**

---

### 4.2 `/financeiro` — Visão geral

- **Promete:** *"Caixa, receita, carteira e confiabilidade do dado."*
- **PROD:** 200 · **"Financeiro indisponível"**.
- **API:** nenhuma — Server Component, `getVisaoGeral()` + `getQualificacao()`
  (`lib/financeiro/queries.ts`, `lib/financeiro/qualificacao.ts`).

**Confere com o banco (HEAD × DB) — tudo bate:**

| tela | DB | ✓ |
|---|---|---|
| 492 lançamentos sem categoria · R$ 613.345 | 492 · 61.334.496 | ✓ |
| 390 cobranças sem categoria · R$ 260.531 | 390 · 26.053.056 | ✓ |
| 404 cobranças sem núcleo · R$ 297.950 | 404 · 29.794.956 | ✓ |
| 1286 saídas sem pagamento previsto · R$ 1.542.380 | 1286 · 154.238.038 | ✓ |
| Saldo disponível R$ 119.613 · A receber R$ 471.694 · Em atraso R$ 70.779 (53) | ✓ | ✓ |
| Classificação 89% | 496.232.559/557.567.055 = 89,0% | ✓ |
| Conciliação 69% | 384.670.304/557.567.055 = 69,0% | ✓ |
| Cobertura de contas 67% | 4 de 6 | ✓ |

**Mas quatro defeitos, todos na mesma tela:**

1. **[DEFEITO] R$ 0,00 para conta que nunca teve extrato.** A tabela "Contas"
   imprime:
   ```
   Caixa — Aplicação      R$ 0,00    nunca importado
   Caixa — Empréstimo     R$ 0,00    nunca importado   (fora do disponível)
   ```
   `opening_balance_cents = 0` e zero movimento nas duas. A restrição 5 do
   `CONTINUACAO.md` é exatamente sobre isto: *"onde não houver evidência, o
   valor é indeterminado, com motivo"*. A coluna do dinheiro **afirma zero**; o
   "nunca importado" ao lado é uma ressalva depois do número, não no lugar dele.
2. **[DEFEITO] A própria tela se contradiz 40 linhas depois.** Acima da tabela:
   *"**1** de **6** contas estão sem extrato recente (Caixa — Aplicação)"*.
   Abaixo, a tabela lista **duas** contas "nunca importado". A causa é a
   cláusula `AND a.kind <> 'emprestimo'` em `lib/financeiro/qualificacao.ts:126`,
   que não está dita em lugar nenhum da tela. Pior: o card "Cobertura de contas"
   **da mesma página** usa 6 contas no denominador (`queries.ts:339`, só
   `a.is_active`). Duas réguas para o mesmo universo, na mesma tela.
   `/financeiro/indicadores` diz a coisa certa (*"sem extrato há mais de 30
   dias: Caixa — Aplicação, Caixa — Empréstimo"*) e `/financeiro/painel`
   também (*"2 das 6 contas nunca tiveram extrato importado"*). **Três telas,
   três contagens do mesmo fato: 1, 2, 2.**
3. **[DEFEITO] Valor de uma população, contagem de outra, na mesma frase.**
   ```
   R$ 613.345 ainda sem categoria, em 1.556 itens na fila.
   ```
   `FinReliabilityPanel.tsx:96` cola `naoClassificadoCents` (soma de
   `fin_transaction` sem categoria = **492** linhas) com `filaItens` (contagem
   de `fin_review_item` pendente = **1.556**). O valor real desses 1.556 é
   **R$ 1.329.961,79** — é o que `/financeiro/revisao` mostra, corretamente. A
   frase subdeclara o dinheiro em jogo em **R$ 716.616,83**.
4. **[DEFEITO] "Planejamento 0%" é ausência apresentada como medida, e entra na
   média.** O componente é
   `SUM(...) FILTER (WHERE d.planned_at IS NOT NULL AND d.planned_at < t.posted_on) / SUM(...)`
   (`queries.ts:376`). Medido no banco: das 10.134 saídas do denominador,
   **`com_documento = 0`** — nenhuma saída está ligada a documento por
   `fin_settlement`. O numerador é **estruturalmente incapaz** de ser diferente
   de zero. A tela imprime **0%** com meta 90%, e o `composto` é média simples
   dos quatro:
   `(66,67 + 89,00 + 69,00 + 0) / 4 = 56,2%` → **56%** na tela.
   Sem o componente que não pode ser medido: **74,9%**. É "somar camadas de
   certeza sem dizer" com 19 pontos de erro. O comentário no código admite o
   problema (*"0% é a leitura honesta de 'não medimos isso'"*) — mas o
   `CONTINUACAO.md` §5 diz o contrário, e com todas as letras: *"A API não pode
   devolver 0 no lugar de null: zero é uma afirmação sobre o dinheiro, ausência
   é uma afirmação sobre o dado."*
5. **[RESSALVA] Texto de ajuda desmentido pelo próprio número.** O card
   "Cobertura de contas" mostra 67% e explica: *"Contas com extrato dos últimos
   30 dias. **Hoje só o Asaas** — que é 100% da receita e 0% da despesa."*
   (`FinReliabilityPanel.tsx:30`). São **quatro** contas com extrato hoje.

- **Veredito: defeito** (4 defeitos + 1 ressalva).

---

### 4.3 `/financeiro/painel` — Painel executivo

- **Promete:** *"briefing de quem decide (…) e, no fim, o que este painel ainda
  não sabe."*
- **PROD:** 200 · **"Painel indisponível"**.
- **API:** nenhuma — `getPainelExecutivo()` (`lib/financeiro/painel.ts`).

**Confere com o banco:**

| tela | DB | ✓ |
|---|---|---|
| Receita 12 meses **R$ 1.967.961** · 917 cobranças · 194 clientes | `fin_revenue_cash_v` com `posted_on >= hoje − 12 months` → 917 · 196.796.070 · 194 | ✓ |
| Caixa livre R$ 119.613 | soma das 4 contas com extrato | ✓ |
| Vencido >90d R$ 38.934 em 25 · vencido total R$ 70.779 em 53 | ✓ | ✓ |
| PIAU 11,2% da receita **identificada** | 21.265.008 ÷ (196.796.070 × 96,1%) | ✓ |

**O que ele faz certo, e vale registrar:** é a única tela que declara o que não
sabe **em prosa, antes dos cards**: *"Este painel ainda não sabe se a empresa dá
lucro: **2 das 6 contas nunca tiveram extrato importado**, a despesa registrada
em 90 dias é de R$ 457.101 — só tarifas — e R$ 702 mil saíram do gateway para
contas que este banco não enxerga."* E declara o denominador da concentração
(*"3,9% da receita não tem cliente identificado e fica fora deste gráfico"*).

**Defeito:**

1. **[DEFEITO] "Faturou" é palavra de competência sobre um número de caixa.** A
   primeira frase da tela é *"Nos últimos 12 meses a XPE **faturou** R$ 1,97
   mi"*. O número vem de `fin_revenue_cash_v.posted_on` — **é caixa**. A tela
   que mede faturamento de verdade (`/financeiro/indicadores`, por competência)
   diz **R$ 2.156.197**. Ver §5.3.
- **Veredito: defeito** (1 defeito; o resto é o melhor comportamento do módulo).

---

### 4.4 `/financeiro/indicadores` — Indicadores

- **Promete:** *"os indicadores de gestão e a estimativa do DAS."*
- **PROD:** 200 — mas renderiza **apenas** o card "A DRE mora em Resultado" e
  **mais nada**. Sem mensagem de indisponibilidade. Ver §5.2.
- **API:** nenhuma — `getDre()` + `getIndicadores(dre)`.

**Confere com o banco (HEAD × DB):**

| tela | DB | ✓ |
|---|---|---|
| Receita do período **R$ 2.156.197** | `FATOS_DRE`, `dre_line='receita_bruta'`, comp ∈ [2025-09-01, 2026-08-31] → **215.619.689** | ✓ |
| Cobertura de classificação 89,0% | ✓ | ✓ |
| Cobertura de contas 66,7% · *"sem extrato há mais de 30 dias: Caixa — Aplicação, Caixa — Empréstimo"* | 4/6, as duas nomeadas | ✓ |
| Inadimplência R$ 70.779 em 53 · 90+ R$ 38.934 em 25 | ✓ | ✓ |

**O que ele faz certo:** `Runway` e `Despesa fixa média` aparecem como **"—
indisponível: sem despesa registrada"**, não como R$ 0,00. `DAS de referência`
= **"indeterminado — nenhum anexado ainda"**. Este é o padrão que o resto do
módulo deveria seguir.

**Defeitos e ressalvas:**

1. **[DEFEITO] Divergência com painel e receitas** — ver §5.3.
2. **[RESSALVA] Percentuais com ponto decimal.** "94.8%", "15,17%" convivem: o
   módulo mistura `toFixed()` (ponto) com formatação pt-BR (vírgula). Ver §5.6.
3. **[RESSALVA] A premissa do DAS manda editar código.** *"Para ajustar, edite
   `ANEXO_SIMPLES` em `lib/financeiro/dre.ts`."* — R$ 327.161 de estimativa
   pendurados num literal que só um desenvolvedor muda.
- **Veredito: defeito.**

---

### 4.5 `/financeiro/resultado` — Resultado (DRE)

- **Promete:** *"abertura + DRE de caixa = saldo, resíduo R$ 0,00"*, expansível
  até o lançamento.
- **PROD:** 200 · "DRE indisponível — banco financeiro não configurado".
- **API:** `GET /api/financeiro/gerencial/dre/resultado?visao=caixa&mes=YYYY-MM`
  (+ `/drill`, `/ajuste`, `/mover-categoria`).

**Confere:** a regra de ouro fecha — `88.799,25 + 30.814,22 = 119.613,47`,
resíduo R$ 0,00, "0 item de cartão na visão caixa". A API responde 200 com as
22 linhas e a `visao`/`mes` corretas. `Cartão sem categoria` aparece como
`R$ 0,00` **com o motivo ao lado** (*"nenhum lançamento neste mês nesta
visão"*) — correto.

**Defeitos:**

1. **[DEFEITO] Moeda brasileira impressa em formato americano, e o valor muda
   com o locale do servidor.** A ressalva da linha "Ledger sem categoria" diz:
   ```
   Esta linha carrega 7,649.56 em 8 lançamento(s) bancário(s) sem categoria.
   ```
   A fonte é `db/migrations/0102_fin_dre_drill.sql:459`:
   `to_char(valor/100.0, 'FM999G999G990D00')`. `G` e `D` são **dependentes de
   `lc_numeric`**, e neste banco `lc_numeric = en_US.utf8` — conferido:
   `SELECT to_char(7649.56,'FM999G999G990D00')` → `7,649.56`. Um leitor
   brasileiro lê a vírgula como decimal: **R$ 7,64 em vez de R$ 7.649,56**,
   erro de 1000×. E não há `R$`. Num servidor `pt_BR` o **mesmo código** imprime
   `7.649,56` — mesma view, dois números.
2. **[DEFEITO] A ressalva contradiz a linha que ela anota.** A linha mostra
   `8 · -R$ 4.699,56`; a ressalva imediatamente acima diz que os **mesmos 8
   lançamentos** carregam `7,649.56`. No banco:
   `lacuna_bruto_raw = 764956` (bruto) e `valor_cents = -469956` (líquido). São
   duas medidas diferentes do mesmo conjunto, e **nenhuma das duas diz qual é
   qual**.
3. **[RESSALVA] Mês corrente sem marca de parcialidade.** O seletor abre em
   `ago/2026 · -R$ 61.748,52` ao lado de meses fechados, sem nada que diga que
   agosto tem 17 de 31 dias. `/financeiro/pessoas` e `/financeiro/modelo`
   marcam "parcial"; esta não.
4. **[RESSALVA] O resíduo R$ 0,00 depende de tratar desconhecido como zero.**
   A abertura R$ 88.799,25 soma as 3 contas com `opening_balance` declarado; as
   duas Caixa entram com 0 dos dois lados da igualdade. O resíduo fecha por
   construção, não por conciliação.
- **Veredito: defeito.**

---

### 4.6 `/financeiro/revisao` — Fila de revisão

- **Promete:** *"a fila"*.
- **PROD:** 200 · "Fila indisponível".
- **API:** `GET /api/financeiro/revisao` (sem parâmetro nenhum) e
  `POST /api/financeiro/revisao/lote`.

**Confere — exato:**

| API | DB |
|---|---|
| `pendentes: {itens: 1556, valorCents: 132996179}` | 1556 · 132.996.179 |
| `resolvidos: {itens: 3560, valorCents: 595469684}` | 3560 · 595.469.684 |

A tela imprime "**1.556** itens aguardando · **R$ 1.329.962**" — e é este par que
prova o defeito 3 de §4.2.

**Defeitos:**

1. **[DEFEITO] Teto silencioso de 100 itens, sem paginação e sem dizer.** A rota
   devolve *"os 100 itens de maior R$"* (comentário em
   `app/api/financeiro/revisao/route.ts:7`); a tela renderiza exatamente 100
   linhas (contadas no DOM) sob um cabeçalho que diz **1.556**. Não existe
   "mostrando 100 de 1.556", nem botão de "carregar mais", nem página 2. Medido
   no próprio corpo da resposta: os 100 devolvidos somam R$ 717.205,81; os
   **1.456 restantes — R$ 612.755,98, 46% do dinheiro da fila — não têm caminho
   de acesso nesta tela.**
2. **[DEFEITO] O filtro filtra a página, não a fila, e mente ao dizer "nenhum".**
   O campo *"Filtrar por descrição ou cliente…"* opera sobre `fila.itens` em
   memória (`FinReviewQueue.tsx:128` + `useMemo`), ou seja sobre os 100
   carregados. Buscar um cliente que está no item 300 devolve **"Nenhum item com
   esse filtro."** — uma afirmação sobre a fila inteira produzida por uma busca
   em 6% dela.
- **Veredito: defeito.**

---

### 4.7 `/financeiro/qualificar` — Qualificar

- **Promete:** *"o que ainda não tem categoria, agrupado pelo que o torna
  decidível junto (…) cada sugestão mostra a evidência que a sustenta."*
- **PROD:** 200 · "Banco do financeiro indisponível."
- **API:** `POST /api/financeiro/qualificar` (a leitura é Server Component;
  GET devolve 405, correto).

**O que ele faz certo:** cada grupo traz a evidência em prosa (*"Condominio
Empresarial Praia Guarapari já apareceu 1x nesta categoria (50% do histórico
dela)"*), com percentual de histórico. É a melhor tela do módulo nesse quesito.

**Defeitos:**

1. **[DEFEITO] O percentual grande e a fração que o explica medem coisas
   diferentes.**
   ```
   Cobertura do ano
   94.4 %
   3319 de 3431 lançamentos com categoria
   ```
   `3319 ÷ 3431 = 96,7%`, não 94,4%. `FinQualificar.tsx:63` calcula
   `100 × valorClassificado / valorTotal` (**dinheiro**) e a linha de apoio
   imprime `classificados / total` (**linhas**). Medido no banco:
   `pct_valor = 94,4` · `pct_linhas = 96,7`. Quem conferir a conta na tela
   conclui que o número está errado — e não tem como saber que são duas réguas.
2. **[DEFEITO] Dois totais para a mesma lacuna, na mesma tela, R$ 3.000 de
   diferença.** O card diz "Falta qualificar em 2026 **R$ 145.811,30** · 54
   grupos · **110** lançamentos". A lacuna real de 2026 é **R$ 148.811,30 em 112
   lançamentos** — e é essa que alimenta os 94,4% do card ao lado. A diferença
   são exatamente 2 linhas, achadas no banco:
   ```
   id 76675 · 2026-04-24 · -R$    400,00 · Pix enviado — Recifemecatron
   id 76826 · 2026-06-12 · -R$  2.600,00 · Pix enviado — Maria De Fatima Gondim Carvalh
   ```
   Ambas com `classified_by = 'humano'` e `category_id IS NULL` — um humano
   declarou "não sei". `SQL_PENDENTES`
   (`scripts/lib/fin-qualificacao.mjs:79`) as exclui de propósito (para não
   sobrescrever decisão humana), o que está certo; **o que está errado é o card
   ao lado contá-las e ninguém dizer isso**. Elas não aparecem em nenhuma tela
   de trabalho.
3. **[RESSALVA] `94.4 %` com ponto decimal** (§5.6).
- **Veredito: defeito.**

---

### 4.8 `/financeiro/categorizacao` — Categorização

- **Promete:** *"tudo o que tem categoria — ou deveria ter — nos três universos"*.
- **PROD:** 200, mas **afirmando zeros** (§5.1).
- **API:** `GET /api/financeiro/gerencial/categorizacao/busca` (+ `/categorias`,
  `/reclassificar-lote`, `/virar-regra`).

**Confere — a medida da lacuna bate:**

| tela | DB (`fin_categorizavel_v`, `estado='indeterminado'`) |
|---|---|
| documentos sem destino · R$ 260.530,56 · 390 | 390 · 26.053.056 ✓ |
| itens de cartão sem destino · R$ 54.126,76 · 500 | 514 − 14 pagamentos de fatura (`apenasClassificavel`) ✓ |
| lançamentos sem destino · R$ 725.837,50 · 729 | 729 · 72.583.750 ✓ |
| 890 itens fora de todo indicador | 390 + 500 ✓ |

Validação de parâmetro conferida e **sólida**: `?ordenarPor=vlaor` → **400**;
`?porPagina=5000` → **400**; `?direcao`/`?estado` inválidos → **400**; ordenação
por valor decrescente respeitada (3.600.000 → 3.400.000 → 3.340.000).

**Defeito:**

1. **[DEFEITO] A tela afirma um fato falso sobre outra tela.** A legenda diz
   *"lançamentos sem destino · **729 itens** · **o painel mede estes**"*. O
   painel (`/financeiro`) mede **492**. A diferença é exatamente **237 itens /
   R$ 112.492,54** — a população "marcado 3.99/5.99" do `CONTINUACAO.md`:
   `729 − 492 = 237` e `72.583.750 − 61.334.496 = 11.249.254`. O painel conta
   `category_id IS NULL`; a categorização conta `estado='indeterminado'`, que
   inclui as categorias-marcador de indecisão. Quem clicar em "abrir os 729"
   vindo do painel encontra 237 itens a mais do que o painel prometeu.
2. **[DEFEITO, herdado] "Virar regra" cria algo que nenhuma tela mostra** —
   ver §4.13.
- **Veredito: defeito.**

---

### 4.9 `/financeiro/lancamentos` — Lançamentos

- **Promete:** *"O extrato consolidado."*
- **PROD:** 200 · **"0 lançamentos · entradas R$ 0,00 · saídas R$ 0,00 · líquido
  R$ 0,00 / Nenhum lançamento com esses filtros."** (§5.1)
- **API:** nenhuma — `getLancamentos({limite: 500})`.

**Confere (HEAD × DB) — os números da janela batem:**

```
tela:  500 lançamentos · entradas R$ 224.633,26 · saídas -R$ 168.410,43 · líquido R$ 56.222,83
DB  :  500 (mais recentes, não-transferência) · 22.463.326 · -16.841.043 · 5.622.283   ✓
```

**Defeitos:**

1. **[DEFEITO] Totais de 500 linhas apresentados como totais do extrato.** O
   universo real é **13.263** lançamentos não-transferência (13.882 no total). A
   linha de resumo diz "500 lançamentos · entradas R$ 224.633,26" sem nenhum
   "500 de 13.263". O cabeçalho promete *"o extrato consolidado"* e a tela
   entrega **3,8%** dele. Não há paginação nem "carregar mais".
2. **[DEFEITO] Os filtros filtram os 500, não o ledger.** O seletor de conta
   oferece `Caixa — Aplicação` e `Caixa — Empréstimo`; as duas não têm um único
   lançamento, então o resultado é sempre vazio — mas o mesmo vazio que um
   filtro legítimo produziria sobre as 500 linhas. O comentário no
   `page.tsx:25` reconhece: *"Paginação real entra quando as outras quatro
   contas começarem a alimentar o ledger."* Elas já alimentam.
- **Veredito: defeito.**

---

### 4.10 `/financeiro/contas` — Contas a pagar e a receber

- **Promete, no título:** as duas direções.
- **PROD:** 200 · "Contas indisponíveis".
- **API:** `GET /api/financeiro/contas?direcao=pagar|receber`.

**Entrega as duas** — abas `A pagar` / `A receber`. Promessa cumprida.

**Confere — exato:**

| API | DB |
|---|---|
| pagar: `n:12 · totalCents:2360000` | `direction='pagar'` → 12 · 2.360.000 ✓ |
| receber: `n:359 · totalCents:67319629` | `emitido` 309 · 54.247.282 + `confirmado` 50 · 13.072.347 ✓ |
| tela: "A receber R$ 542.473 **+** R$ 130.723 em 50 cobranças já recebidas fora das contas rastreadas" | as duas camadas **separadas**, não somadas ✓ |

Isto é o oposto do defeito 4 de §4.2: aqui as camadas de certeza aparecem
somadas com um `+` visível e com o rótulo de cada uma. **É o padrão certo.**

**Ressalva:**

1. **[RESSALVA] Campo com nome errado no contrato.** Na direção `receber` a API
   devolve `totalPagaveisNoBanco: 3407` — que é a contagem de documentos **a
   receber**. O nome afirma "pagáveis". Hoje o consumidor só usa o campo quando
   `direcao === 'pagar'` (`FinPayables.tsx:159`), então não vaza para a tela;
   é uma armadilha para o próximo consumidor.
- **Veredito: ok, com ressalva.**

---

### 4.11 `/financeiro/custos` — Previsão de custos do mês

- **Promete:** *"tudo que a base sabe que vai sair (…) cada custo aparece uma
  vez."*
- **PROD:** 200, para em *"Carregando a previsão de agosto de 2026…"* (a API
  devolve 503). O estado de carregamento existe; o de erro não aparece.
- **API:** `GET /api/financeiro/gerencial/custos?mes=YYYY-MM`. **O parâmetro é
  `mes`.**

**Confere — exato, nos três meses:**

| mês | API | DB (`fin_custo_previsto_derivado_v`) |
|---|---|---|
| 2026-08 | 12 itens · `totalCents 0` · `totalIndeterminado: true` + motivo | 12 · soma 0 ✓ |
| 2026-09 | 64 itens · 33 somam · **12.253.070** · fora 4.004.475 | 64 · 12.253.070 · 4.004.475 ✓ |
| 2026-10 | 63 itens · **11.792.184** | 63 · 11.792.184 ✓ |

**O que ele faz certo:** agosto imprime a palavra **indeterminado** no lugar do
número, com motivo. `realizadoCents: null` para setembro é ausência, não zero.
Os 31 itens fora da soma vêm cada um com `motivoForaDaSoma`. Validação:
`?mes=2026-13` → 400 · `?mes=2026-02-30` → 400 · `?estado=xxx` → 400.

**Ressalvas:**

1. **[RESSALVA] Cinco identificadores de código impressos para o usuário.** No
   topo da tela, antes de qualquer número: `confronto[].realizadoCents`,
   `entraNoTotal`, `motivoForaDaSoma`, `chaveDedupe`, `realizadoCents null`.
   É a mesma crítica que o `CONTINUACAO.md` faz a `fila_decisao_valor_cents`:
   *"Nome de coluna não é explicação — é a confissão de que ninguém traduziu."*
   Ver §5.5.
2. **[RESSALVA] Parâmetro desconhecido é ignorado em silêncio** (§5.9).
- **Veredito: ok, com ressalva** — é uma das telas mais honestas do módulo.

---

### 4.12 `/financeiro/agenda` — Agenda de obrigações

- **Promete:** *"cada obrigação aparece uma vez — onde duas fontes falam do
  mesmo dinheiro, uma delas cala e diz por quê."*
- **PROD:** 200 · "Agenda indisponível".
- **API:** `GET /api/financeiro/gerencial/agenda`.

**Confere — API × tela, exato:**

```
entradaCents 53.081.624 → R$ 530.816,24    saidaCents 34.533.621 → R$ 345.336,21
liquidoCents 18.548.003 → R$ 185.480,03    foraDaSoma 72.036.644 / 396 linhas
ancoraSaldoCents 11.961.347 → "saldo real de 2026-08-15: R$ 119.613,47"   ✓
provaOk: true · total 767
```

Validação: `?ordenarPor=zzz` → **400**. `?pagina=999` → 200 com 0 linhas e
`total: 767` (não erra, mas também não diz "página fora do intervalo").

**Ressalva:**

1. **[RESSALVA] Duas caixas de aviso de desenvolvedor no topo da tela.**
   Renderizadas como callouts destacados, **antes** de todo número:
   > *"Some SOMENTE as linhas com **entraNoTotal = true**. Duas linhas com a
   > mesma **chaveDedupe** são o MESMO dinheiro…"*
   > *"**saldoPrevistoCents** é NULL no passado por construção…"*

   O conteúdo está certo e é importante — está escrito para quem chama a API,
   não para quem decide pagamento. Ver §5.5.
- **Veredito: ok, com ressalva.**

---

### 4.13 `/financeiro/regras` — Regras

- **Promete:** *"uma regra é uma hipótese (…) simular é obrigatório."*
- **PROD:** 200 · **"Regras ativas (0)"** — afirmação falsa (§5.1).
- **API:** `GET /api/financeiro/regras`, `POST /regras/preview`, `POST /regras/aplicar`.

**Confere:** tela "Regras ativas (**58**)" · API 58 · DB `status='ativa'` = 58 ✓.

**Defeito:**

1. **[DEFEITO] A tela oferece uma ação cujo resultado nenhuma tela mostra.**
   `/financeiro/categorizacao` tem o botão **"virar regra"**, e
   `app/api/financeiro/gerencial/categorizacao/virar-regra/route.ts` documenta
   em caixa alta: *"A REGRA NASCE `proposta`. SEMPRE. NÃO HÁ PARÂMETRO PARA
   ATIVAR"* — decisão correta, e bem justificada pelo acidente da regra 40. Mas
   `GET /api/financeiro/regras` filtra `WHERE r.status = 'ativa'`
   (`route.ts:22`), e **não existe rota** que liste ou promova propostas
   (`app/api/financeiro/regras/` tem só `GET`, `POST`, `preview`, `aplicar`;
   nenhum `PATCH`). Resultado medido: as 3 propostas de hoje (ids 90, 91, 92,
   `created_by='migration-0080'`) e as 3 arquivadas **não aparecem em lugar
   nenhum do produto**, e toda regra criada pela tela vai para o mesmo limbo. O
   usuário clica, recebe sucesso, e a regra some.
- **Veredito: defeito.**

---

### 4.14 `/financeiro/fluxo` — Fluxo de caixa

- **Promete:** *"previsão em camadas separadas (…) a tela diz onde a projeção é
  teto, não previsão."*
- **PROD:** 200 · "Previsão indisponível".
- **API:** nenhuma — `getPrevisaoFluxo()`.

**Confere:** L0 R$ 119.613 ✓ · L1 R$ 673.196 brutos em 359 cobranças
(= 54.247.282 + 13.072.347, 309+50) ✓, ajustados a R$ 542.043 pela curva ·
L2 R$ 24.132/mês em 28 contratos ✓ · L3 R$ 23.600 em 12 documentos ✓. As quatro
camadas aparecem **rotuladas e não somadas** — correto. A tabela de recuperação
mostra bruto e ajustado lado a lado, com o fator declarado.

**Ressalvas:**

1. **[RESSALVA] Ressalva estagnada e falsa.** L0 diz: *"Fato, não projeção —
   **mas só o Asaas tem extrato**."* São quatro contas com extrato hoje. Terceira
   ocorrência da mesma frase morta (também em `/financeiro` e no `page.tsx` da
   raiz do módulo).
2. **[RESSALVA] Duas grandezas quase idênticas com significados opostos.**
   `/financeiro/fluxo` L1 = "Contratado a receber **R$ 542.043**" (ajustado pela
   curva); `/financeiro/contas` = "A receber **R$ 542.473**" (bruto emitido).
   R$ 430 de diferença entre um número de risco e um número de face.
- **Veredito: ok, com ressalva.**

---

### 4.15 `/financeiro/receitas` — Receitas

- **Promete:** *"de onde vem o dinheiro (…) a lista de cobranças em atraso — que
  é uma lista de trabalho de cobrança."*
- **PROD:** 200 · "Receitas indisponíveis".
- **API:** nenhuma — `getReceitasDetalhe()`.

**Confere — exato:**

```
tela: Recebido em 12 meses R$ 1.972.525 · 889 cobranças pagas
DB  : paid_on >= date_trunc('month', hoje) − 11 months, status IN (liquidado, confirmado)
      → 889 · 197.252.516                                                        ✓
```

**O que ele faz certo:** a matriz de categoria × mês usa **"—"** para célula sem
dado (40 ocorrências) e **zero** "R$ 0,00". Buraco não é desenhado como zero.

**Defeito:**

1. **[DEFEITO] Divergência com painel e indicadores** — ver §5.3.
- **Veredito: defeito** (o defeito é a divergência; o resto é sólido).

---

### 4.16 `/financeiro/pessoas` — Custo com pessoas

- **Promete:** *"ao lado do total, o que ainda não pôde ser atribuído a
  ninguém: sem esse número, o total vem menor e ninguém percebe."*
- **PROD:** 200 · "Custo com pessoas indisponível".
- **API:** nenhuma.

**Confere — exato:**

```
tela: R$ 679.804 · 28 pessoas · 534 lançamentos · jan/26 a ago/26
DB  : fin_transaction ⋈ fin_person_counterparty(status='confirmado') + GUARDAS_SAIDA
      2026-01-01..2026-08-31  →  28 · 534 · 67.980.449                           ✓
tela: Não atribuído R$ 5.477 · 9 saídas · cobertura 99,2%
      679.804 ÷ (679.804 + 5.477) = 99,2%                                        ✓
tela: Inter R$ 548.113 (81%) · Nubank R$ 131.692 (19%) · Asaas R$ 0 (0%)  → soma 100% ✓
```

**O que ele faz certo:** cumpre literalmente a promessa (o não-atribuído está ao
lado do total, não em rodapé), e o mês corrente vem marcado: *"ago de 26
**parcial** · o extrato vai até 17/08, o mês não fechou"*.

- **Veredito: ok.** É a tela mais correta da auditoria.

---

### 4.17 `/financeiro/custos-fixos` — Custos fixos

- **PROD: 404.** A página existe no repositório (commit `df26dc2`) e a migration
  `0108` está aplicada no banco — mas o binário implantado é anterior a ela.
  **Auditada só no HEAD.**
- **API:** `GET /api/financeiro/gerencial/custo-fixo` (**404 em produção**).

**Confere:** `totalDetectadoCents 14.091.786` → R$ 140.917,86/mês ·
`detectadoFolha 8.780.039` + `detectadoDas 1.293.085` + `terceiros 4.018.662` =
R$ 140.917,86 ✓ · 59 grupos · 6 parcelamentos R$ 976,95/mês terminando em
04/2027.

**O que ele faz certo, e é o melhor exemplo do módulo:** a ressalva vem **antes
do número**, com comentário explícito no componente
(`FinCustoFixo.tsx:206`: *"A ressalva vem ANTES do número, não depois"*):

> *"O que a empresa **decidiu** que paga todo mês é **R$ 0,00** — 0 item(ns)
> ligado(s). nenhum item do catálogo está ligado (…) Zero aqui é 'ninguém
> decidiu ainda', não 'a empresa não tem custo fixo' (…) O que ela **de fato**
> paga de recorrente é **R$ 140.917,86/mês** — e R$ 100.731,24 disso já é
> projetado pela folha e pelo DAS. **Somar os dois conta o mesmo dinheiro duas
> vezes.**"*

E "Sem valor: **indeterminado** · 5 grupo(s): o backtest da família errou acima
de 47% em todos os critérios".

**Ressalvas:**

1. **[RESSALVA] Nome de coluna crua na frase para o usuário:** *"o medido está
   em `total_detectado_cents`"*. Ver §5.5.
2. **[RESSALVA] Texto sem acentuação vindo do SQL**, repetido em toda linha:
   *"recorrente: dia 17 do **mes** (exato), limitado ao **ultimo** dia quando o
   **mes e** curto"*. Ver §5.7.
- **Veredito: ok, com ressalva — mas inacessível em produção (404).**

---

### 4.18 `/financeiro/mei` — Teto do MEI

- **PROD: 404.** Página commitada em `f17e5b7`, migration `0107` aplicada, deploy
  anterior às duas. **Auditada só no HEAD.**
- **API:** `GET /api/financeiro/gerencial/mei` (**404 em produção**).

**Entrega:** teto R$ 81.000,00 com a fonte legal citada e data de conferência ·
Pago a MEIs no ano R$ 264.206,66 (12 prestadores) · Igor a 94,8% do teto,
projeção 133,0%, cruzamento em 2026-09 · a consequência legal do excesso >20%
escrita por extenso.

**O que ele faz certo:** a ressalva estrutural vem **antes de tudo** (*"Esta
janela é piso, não valor. Ela conta apenas o que a XPE pagou (…) se houver outro
contratante, o percentual real é maior"*), o ritmo é medido **só sobre meses
completos** com a justificativa dita, e `DAS de referência` é
**"indeterminado — nenhum anexado ainda"**.

**Defeitos:**

1. **[DEFEITO] O mesmo número impresso de duas formas na mesma tela.**
   No card: `R$ 76.751,35`. No box legal, dez linhas abaixo:
   `R$ 76,751.35`. Mesma causa da §4.5: `to_char(...,'FMxxxGxxxD00')` com
   `lc_numeric = en_US.utf8`. Um dos dois está errado para qualquer leitor.
2. **[RESSALVA] Percentuais com ponto:** `94.8%`, `133.0%`, `46.4%`,
   `0.47 mês` (§5.6).
3. **[RESSALVA] Texto legal sem acentos:** *"desenquadramento RETROATIVO a 1o de
   janeiro do **proprio** ano (…) a **comunicacao** a RFB e **obrigatoria** ate o
   **ultimo** dia **util** do **mes** seguinte"* (§5.7).
- **Veredito: defeito — e inacessível em produção (404).**

---

### 4.19 `/financeiro/modelo` — Modelo de gestão

- **PROD:** 200 · "Banco do financeiro indisponível."
- **API:** `GET` devolve 405 (a leitura é Server Component; `POST /api/financeiro/modelo` grava).

**Entrega:** Receita ano corrido R$ 1.257.767 · Custo R$ 1.167.798 · Resultado
R$ 89.969 · Resultado dos meses fechados R$ 153.061.

**O que ele faz certo:** separa **ano corrido** de **meses fechados** e explica a
diferença (*"1 mês não fechou (ago ainda com extrato em aberto). O resultado do
ano corrido inclui -R$ 63.092,29 vindo daí; para decidir, leia a janela
fechada."*). E declara a própria lacuna: *"5,6% do dinheiro movimentado no ano —
**R$ 148.811,30** — ainda não tem categoria (…) o EBITDA daqui é otimista por
construção."*

**Defeito:**

1. **[DEFEITO] A mesma lacuna vale R$ 148.811,30 aqui e R$ 145.811,30 em
   `/financeiro/qualificar`.** Este número está **certo** (é o que o banco
   devolve: 112 lançamentos, 14.881.130). O de qualificar é que está a
   R$ 3.000 de distância — ver §4.7, defeito 2. Registrado aqui porque é aqui
   que a divergência fica visível.
2. **[RESSALVA] Percentuais com ponto:** `12.9%`, `100.0%`, `-11.0%`, `-70.5%`
   (§5.6).
- **Veredito: ressalva** (o defeito é de qualificar; esta tela é a correta).

---

### 4.20 `/financeiro/planejamento` — Planejamento global

- **PROD:** 200 · "Planejamento indisponível. Sem conexão com o banco do financeiro."
- **API:** `PATCH /api/financeiro/planejamento` (GET → 405, correto).

**Entrega:** 10 premissas, **cada uma com a origem carimbada** (`manual`,
`planilha v31`, `medido`) e a justificativa. Célula editável marca o override.

**Ressalva:**

1. **[RESSALVA] Nome de identificador de código no texto:** *"Meta de
   `Pipedrive · commercialPlanningByScope`"*.
2. **[RESSALVA] Resposta do PATCH não conferida** — `FinPlanning.tsx:56` faz
   `await fetch(..., {method:'PATCH'})`. Não disparei a escrita (produção), então
   **não confirmo o efeito visível**; registro como suspeita da mesma família de
   §5.4, não como defeito provado.
- **Veredito: ok, com ressalva.**

---

### 4.21 `/financeiro/reembolsos` — Reembolsos

- **PROD:** 200 · "Reembolsos indisponíveis".
- **API:** `GET /api/financeiro/reembolsos`, `PATCH /reembolsos/{id}`.

**Confere:** "Reembolsado em 12 meses **R$ 42.320** · 26 pessoas" — bate com
`/financeiro/time`, que diz "R$ 42.320,34 · 193 itens". Mês corrente
(ago/26) **R$ 0** com o rótulo *"o que já foi lançado até agora"* — zero
qualificado, aceitável. Previsão set/26 R$ 3.814 com o método dito (*"parcelas
em curso + média dos avulsos de 3 meses"*).

- **Veredito: ok.**

---

### 4.22 `/financeiro/time` — Fila do time

- **PROD:** 200, para em "carregando…".
- **API:** `GET /api/financeiro/time`.

**Confere:** API `{disponivel: true, envios: [], totalCents: 0, saude: {itens:193,
com_comprovante:0, sem_comprovante:193}}`. A tela imprime "Na fila do time
**R$ 0,00** · 0 envio(s) aguardando decisão" — **zero legítimo**, a fila está
vazia — e "Reembolso com comprovante R$ 42.320,34 · **193 de 193 itens SEM
comprovante** · cobre 0% · o que falta é justamente o que sustentaria a
aprovação".

**Ressalva:** nome de tabela no texto do usuário (*"exige alçada
(`fin_approval_rule`), que está vazia por desenho — dúvida 27"*). Ver §5.5.

- **Veredito: ok, com ressalva.**

---

### 4.23 `/financeiro/importar` — Importar extrato

- **PROD: 500.** É a **única** tela do módulo que quebra em vez de degradar.
- **API:** `GET /api/financeiro/importacoes` (+ `/{id}/confirmar`, `/{id}/reverter`).

**Causa, medida:** `app/financeiro/importar/page.tsx:13` chama
`await Promise.all([getContasImportaveis(), listarLotes()])` **sem
`isFinanceConfigured()` e sem `try/catch`**. Todas as outras páginas do módulo
tratam `FinanceUnavailableError`. Esta propaga e o Next devolve 500 com o body
vazio (só o `<title>`). Reprodução direta:

```
curl -su 'xpeadmin:@Vem2026' -o /dev/null -w '%{http_code}\n' \
  https://web-production-ee3c4.up.railway.app/financeiro/importar     → 500
  https://web-production-ee3c4.up.railway.app/financeiro/contas       → 200 ("Contas indisponíveis")
```

**No HEAD funciona:** lista os 12 lotes com `reverter` nos confirmados. E o
seletor de conta oferece `Caixa — Aplicação` e `Caixa — Empréstimo` — que é
exatamente o caminho para resolver F1.

- **Veredito: defeito.**

---

### 4.24 `/notificacoes` — Avisos

- **PROD:** 200, degrada com **motivo errado** (§5.8).
- **API:** `GET /api/notificacoes?resolvidas=1&limite=200`, `PATCH /api/notificacoes/{id}`.

**Confere (teste limpo, sequencial):**

```
DB antes   : 8 nao_lida · 5 resolvida · max(ocorrencias)=23 · ult=15:59:13
GET /api/notificacoes → naoLidas 8 · 5 fonte_desatualizada resolvidas   ✓ bate
DB depois  : 8 nao_lida · 5 resolvida · max(ocorrencias)=24 · ult=16:01:46
```

**Defeitos:**

1. **[DEFEITO] `GET` grava, e o contador que ele incrementa é apresentado como
   evidência do mundo.** A rota roda `sincronizar()` na leitura
   (`app/api/notificacoes/route.ts:42` — decisão deliberada e documentada). O
   efeito colateral é que **`fin_notificacao.ocorrencias` conta aberturas de
   tela**. A tela imprime *"visto 24×"* (`Lista.tsx:142`), que qualquer leitor
   entende como "este problema aconteceu 24 vezes". Provado acima: 23 → 24 em
   dois minutos, sem nada ter mudado no mundo, só porque a página foi aberta.
2. **[DEFEITO] Clique em "já cuidei" / "reabrir" / "marcar tudo como lido" não
   confere a resposta.** `Lista.tsx:81` e `Sino.tsx:101`/`:134`:
   ```js
   await fetch(`/api/notificacoes/${id}`, { method: "PATCH", ... });
   await carregar();
   ```
   Sem `r.ok`, sem `try/catch`, sem estado de erro. E `carregar()` também
   **desiste em silêncio** se a releitura falhar (`if (!r.ok) return;`), deixando
   a tela anterior no ar. A API **sabe** falhar e dizer por quê — medido:
   ```
   PATCH /api/notificacoes/999999  {"estado":"resolvida"} → 404 {"error":"não encontrada"}
   PATCH /api/notificacoes/67      {"estado":"xxx"}       → 422 {"error":"estado deve ser lida, resolvida ou nao_lida"}
   ```
   Nos dois casos a tela não mostra nada e o item fica como estava.
3. **[RESSALVA, já conhecida] Cinco avisos falsos na caixa.** As 5
   `fonte_desatualizada` (hoje `resolvida`) dizem *"2 dia(s) sem dado novo — a
   tolerância declarada é 1"*, e duas delas são sobre `import_csv · inter` /
   `import_csv · nubank-caixinhas` — fontes que, segundo o
   `CONTINUACAO.md`, **nunca produziram um lançamento**. É o defeito que a
   migration `0109` conserta; ela **não está aplicada**. Registrado como estado
   atual, não como achado novo.
- **Veredito: defeito.**

---

### 4.25 `/time`, `/time/reembolso`, `/time/custo`, `/time/nota`, `/time/compra`, `/time/envios`

- **PROD:** 200, todas degradadas com a **mensagem errada** (§5.8).
- **API:** `/api/time/sessao` (200), `/api/time/envios` (401 sem sessão — correto),
  `/api/time/reembolso`, `/api/time/compra`, `/api/time/envio`.

**Confere no HEAD:** `/api/time/sessao` devolve `disponivel: true` e as 28
pessoas com `exigePin`. `/api/time/envios` devolve **401
`{"error":"identifique-se para continuar"}`** sem sessão — a identidade
declarada funciona como projetado.

**Defeito:** §5.8 (a mensagem de indisponibilidade acusa uma migration que está
aplicada).

- **Veredito: defeito** (o defeito é o diagnóstico falso; o resto respondeu).

---

### 4.26 `/financeiro/fontes`

- **PROD: 404.**
- **Não auditada.** No momento da medição os arquivos estavam **não commitados**
  (`?? app/financeiro/fontes/`, `?? components/financeiro/FinFontes.tsx`,
  `?? db/migrations/0109_fin_fonte_frescor.sql`), então não entraram na cópia
  isolada feita de `85a900b`. A frente commitou em `b05d9c5` **depois** de a
  medição terminar — a tela existe na árvore agora e **continua não auditada**.
- Registro só o que foi medido: o banner *"4 fontes sem atualizar"* na topbar
  **não aponta para cá** — aponta para `/auditorias`. E a migration `0109`
  **não está aplicada no banco** (99 migrations, a última é a `0108`), o que
  mantém vivos os 5 avisos falsos de fonte descritos em §4.24.

---

## 5. Os defeitos, por gravidade

### 5.1 — **Produção afirma zero onde não sabe nada** · CRÍTICO

Três telas, com o banco inalcançável, imprimem números em vez de dizer que não
sabem. É a violação direta da restrição 5.

```bash
curl -su 'xpeadmin:@Vem2026' https://web-production-ee3c4.up.railway.app/financeiro/lancamentos
#   → "0 lançamentos · entradas R$ 0,00 · saídas R$ 0,00 · líquido R$ 0,00"
#     "Nenhum lançamento com esses filtros."          (o banco tem 13.882)

curl -su 'xpeadmin:@Vem2026' https://web-production-ee3c4.up.railway.app/financeiro/categorizacao
#   → "0 ativas"  "0 itens fora de todo indicador"  "medido agora, nos três universos"
#     (o banco tem 56 categorias ativas e 890 itens fora)

curl -su 'xpeadmin:@Vem2026' https://web-production-ee3c4.up.railway.app/financeiro/regras
#   → "Regras ativas (0)"                            (o banco tem 58)
```

A legenda *"medido agora, nos três universos"* é o agravante: afirma que a
medição aconteceu.

### 5.2 — **A causa raiz: deploy divergente do banco** · CRÍTICO

Todo o §2. Reprodução:

```
mcp railway get_logs --project xpe-plataforma --service web --search "migrate"
→ migrations registradas no banco mas ausentes do disco:
  0108_fin_custo_fixo_catalogo.sql, 0107_fin_mei_teto.sql
```

Efeitos: 21 telas degradadas, 3 mentindo zero (5.1), 1 devolvendo 500
(`/financeiro/importar`, §4.23), 1 virando um parágrafo solto
(`/financeiro/indicadores`, §4.4), 3 em 404 (`custos-fixos`, `mei`, `fontes`).

### 5.3 — **Três telas, três receitas de 12 meses** · GRAVE

O achado mais grave da categoria "mesmo dado, números diferentes".

| tela | número | n | base, medida no banco |
|---|---|---|---|
| `/financeiro/painel` — *"Receita 12 meses"*, *"a XPE **faturou**"* | **R$ 1.967.960,70** | 917 | `fin_revenue_cash_v.posted_on ≥ hoje − 12 months` (**caixa**, janela móvel) |
| `/financeiro/receitas` — *"Recebido em 12 meses"* | **R$ 1.972.525,16** | 889 | `fin_document.paid_on ≥ 1º dia do mês − 11 months` (**caixa**, janela de calendário) |
| `/financeiro/indicadores` — *"Receita do período (12 meses)"* | **R$ 2.156.196,89** | 997 | `FATOS_DRE.competence_date` no mesmo intervalo (**competência**) |

Amplitude: **R$ 188.236,19 (9,6%)**. Nenhuma das três menciona a existência das
outras duas. As duas primeiras têm a **mesma base** (caixa) e ainda assim
diferem em R$ 4.564,46 e 28 cobranças, só porque uma janela é móvel e a outra é
de calendário. E a palavra do painel é **"faturou"** — vocabulário de
competência sobre número de caixa.

Reprodução:

```sql
SELECT count(*), sum(amount_cents) FROM fin_revenue_cash_v
 WHERE posted_on >= CURRENT_DATE - interval '12 months';                    -- 917 · 196796070

SELECT count(*), sum(amount_cents) FROM fin_document d JOIN fin_entity e ON e.id=d.entity_id
 WHERE e.slug='xpe' AND d.direction='receber' AND d.paid_on IS NOT NULL
   AND d.status IN ('liquidado','confirmado')
   AND d.paid_on >= date_trunc('month', CURRENT_DATE) - interval '11 months';  -- 889 · 197252516
```

Consequência em cadeia: "maior cliente" vale **11,2%** (painel), **10%**
(visão geral) e **8,9%** (indicadores); "clientes no período" vale **194**,
**186** e **190**.

### 5.4 — **"Já cuidei" não confere se cuidou** · GRAVE

§4.24, defeito 2. Três manipuladores de escrita descartam a resposta:
`components/notificacoes/Lista.tsx:81`, `components/notificacoes/Sino.tsx:101`
e `Sino.tsx:134`. Reprodução da resposta que é descartada:

```bash
curl -s -X PATCH -H 'content-type: application/json' -d '{"estado":"xxx"}' \
     http://<host>/api/notificacoes/67
# → 422 {"error":"estado deve ser lida, resolvida ou nao_lida"}   — a tela não mostra nada
```

### 5.5 — **`GET` que grava, e um contador que mede aberturas de tela** · GRAVE

§4.24, defeito 1. Reprodução em duas linhas:

```sql
SELECT max(ocorrencias), max(ultima_ocorrencia) FROM fin_notificacao;   -- 23 · 15:59:13
```
```bash
curl -s 'http://<host>/api/notificacoes?resolvidas=1&limite=200' > /dev/null
```
```sql
SELECT max(ocorrencias), max(ultima_ocorrencia) FROM fin_notificacao;   -- 24 · 16:01:46
```

A tela imprime **"visto 24×"**.

### 5.6 — **R$ 613.345 em 1.556 itens: valor de uma coisa, contagem de outra** · GRAVE

§4.2, defeito 3. `components/financeiro/FinReliabilityPanel.tsx:94-98`.

```sql
-- o valor que a tela imprime (492 lançamentos):
SELECT count(*), sum(abs(amount_cents)) FROM fin_transaction t JOIN fin_entity e ON e.id=t.entity_id
 WHERE e.slug='xpe' AND t.category_id IS NULL AND t.transfer_status='nao' AND NOT t.is_split_parent;
-- 492 · 61334496  → R$ 613.344,96

-- a contagem que a tela imprime, e o valor DELA:
SELECT count(*), sum(abs(coalesce(amount_cents,0))) FROM fin_review_item ri
  JOIN fin_entity e ON e.id=ri.entity_id WHERE e.slug='xpe' AND ri.status='pendente';
-- 1556 · 132996179 → R$ 1.329.961,79
```

Subdeclara R$ 716.616,83. `/financeiro/revisao` mostra o par certo.

### 5.7 — **"Planejamento 0%" e a média que o engole** · GRAVE

§4.2, defeito 4. O componente é estruturalmente inmensurável:

```sql
SELECT count(*) linhas, count(d.id) com_documento
  FROM fin_transaction t JOIN fin_entity e ON e.id=t.entity_id
  LEFT JOIN fin_settlement s ON s.transaction_id=t.id
  LEFT JOIN fin_document  d ON d.id=s.document_id
 WHERE e.slug='xpe' AND t.amount_cents<0 AND t.transfer_status='nao' AND NOT t.is_split_parent;
-- linhas 10134 · com_documento 0     → numerador impossível de ser ≠ 0
```

`(66,67 + 89,00 + 69,00 + 0)/4 = 56,2%` na tela; **74,9%** sem o componente
cego. Fonte: `lib/financeiro/queries.ts:376-403`.

### 5.8 — **`/financeiro/importar` devolve 500 em vez de degradar** · GRAVE

§4.23. Uma linha sem guarda (`app/financeiro/importar/page.tsx:13`) contra 20
páginas que tratam. Reprodução no §4.23.

### 5.9 — **A degradação acusa a migration errada** · GRAVE

Seis páginas do time e o sino dizem, hoje, em produção:

> *"O app do time ainda não está de pé neste ambiente — **a migration 0105 ainda
> não foi aplicada neste banco**"*

**0105 está aplicada** (`SELECT id FROM xpe_migrations WHERE id LIKE '0105%'`
→ `0105_fin_time_e_notificacoes.sql`, `applied_at 2026-08-17 02:44`). A causa
real é `FIN_SCHEMA_OK=0` por causa da 0107/0108 (§5.2).
`lib/financeiro/time.ts:75` captura `FinanceUnavailableError` e devolve
`false`; os `page.tsx` então carimbam um motivo fixo
(`app/time/page.tsx:23` e as 5 irmãs) e `lib/financeiro/notificacoes.ts:117`
faz o mesmo. **A tela manda o operador fazer o que já foi feito, e esconde o que
precisa ser feito.**

### 5.10 — **Moeda brasileira em formato americano, dependente do locale** · GRAVE

Duas telas, mesma causa. `db/migrations/0102_fin_dre_drill.sql:445,459` e a
view do MEI usam `to_char(v/100.0, 'FM999G999G990D00')`; `G` e `D` seguem
`lc_numeric`, que neste banco é `en_US.utf8`.

```sql
SHOW lc_numeric;                                    -- en_US.utf8
SELECT to_char(7649.56,'FM999G999G990D00');         -- 7,649.56
```

- `/financeiro/resultado`: *"Esta linha carrega **7,649.56** em 8 lançamento(s)"*
  ao lado de `-R$ 4.699,56`.
- `/financeiro/mei`: **`R$ 76,751.35`** dez linhas abaixo de **`R$ 76.751,35`**.

Num servidor `pt_BR` o mesmo código imprime outro texto. É a família de defeito
que o `CONTINUACAO.md` chama de "compila igual e responde diferente".

### 5.11 — **O painel diz 492, a categorização diz 729 e afirma que é o mesmo número** · GRAVE

§4.8. A legenda *"o painel mede estes"* é falsa por **237 itens / R$ 112.492,54**.

```sql
SELECT universo, count(*), sum(valor_abs_cents) FROM fin_categorizavel_v
 WHERE estado='indeterminado' AND universo='lancamento' GROUP BY 1;   -- 729 · 72583750
-- contra 492 · 61334496 do painel; diferença 237 · 11249254
```

### 5.12 — **Uma tela conta 1 conta sem extrato, duas contam 2** · MÉDIO

§4.2, defeito 2. `lib/financeiro/qualificacao.ts:126` filtra
`AND a.kind <> 'emprestimo'`; `lib/financeiro/queries.ts:339` não filtra. As
duas alimentam **a mesma página**.

```sql
SELECT slug, kind, last_statement_at FROM fin_account WHERE is_active ORDER BY id;
-- caixa-aplicacao (aplicacao) e caixa-emprestimo (emprestimo): last_statement_at NULL
```

### 5.13 — **R$ 0,00 para conta que nunca teve extrato** · MÉDIO

§4.2, defeito 1. `opening_balance_cents = 0` e zero movimento nas duas Caixa;
a tabela "Contas" imprime `R$ 0,00`. O `resíduo R$ 0,00` de
`/financeiro/resultado` herda a mesma premissa (§4.5, ressalva 4).

### 5.14 — **`/financeiro/revisao`: 100 de 1.556, e o filtro filtra os 100** · MÉDIO

§4.6. Sem paginação, sem "mostrando 100 de 1.556", e o "Nenhum item com esse
filtro" fala da fila inteira olhando 6% dela.

### 5.15 — **`/financeiro/lancamentos`: 500 de 13.263, com os totais das 500** · MÉDIO

§4.9. `getLancamentos({limite: 500})`, `app/financeiro/lancamentos/page.tsx:24`.

### 5.16 — **`/financeiro/qualificar`: 94,4% explicado por uma fração que dá 96,7%** · MÉDIO

§4.7, defeito 1. `components/financeiro/FinQualificar.tsx:63` (valor) contra
`:110` (linhas).

```sql
SELECT round(100.0*sum(abs(amount_cents)) FILTER (WHERE category_id IS NOT NULL)/sum(abs(amount_cents)),1) pct_valor,
       round(100.0*count(category_id)/count(*),1) pct_linhas
  FROM fin_transaction t JOIN fin_entity e ON e.id=t.entity_id
 WHERE e.slug='xpe' AND t.posted_on>='2026-01-01' AND t.posted_on<'2027-01-01'
   AND t.transfer_status='nao' AND NOT t.is_split_parent;
-- 94.4 · 96.7
```

### 5.17 — **A lacuna de 2026 vale R$ 145.811,30 numa tela e R$ 148.811,30 em duas** · MÉDIO

§4.7, defeito 2. As duas linhas invisíveis:

```sql
SELECT id, posted_on, amount_cents, classified_by FROM fin_transaction t
  JOIN fin_entity e ON e.id=t.entity_id
 WHERE e.slug='xpe' AND t.category_id IS NULL AND t.transfer_status='nao'
   AND t.posted_on BETWEEN '2026-01-01' AND '2026-12-31'
   AND (t.classified_by='humano' OR 'category_id' = ANY(t.human_locked_fields));
-- 76675 · 2026-04-24 · -40000  · humano
-- 76826 · 2026-06-12 · -260000 · humano      soma R$ 3.000,00
```

### 5.18 — **"Virar regra" produz regra que nenhuma tela mostra** · MÉDIO

§4.13.

```sql
SELECT id, slug, status, created_by FROM fin_rule WHERE status <> 'ativa';
-- 90,91,92 proposta (migration-0080) · 42,51,53 arquivada
```
```bash
curl -s http://<host>/api/financeiro/regras | python3 -c "import json,sys;print(len(json.load(sys.stdin)['regras']))"
# 58 — as 6 acima não aparecem, e não há rota que as liste ou promova
```

### 5.19 — **Ressalvas paradas no tempo, hoje falsas** · MÉDIO

Três ocorrências da mesma frase morta, contra 4 contas com extrato:

- `components/financeiro/FinReliabilityPanel.tsx:30` — *"Hoje só o Asaas"*
- `/financeiro/fluxo`, camada L0 — *"mas só o Asaas tem extrato"*
- `app/financeiro/page.tsx:31` — *"Hoje alimentado pelo Asaas — 100% da receita
  e nenhuma despesa"*

E `/financeiro/importar` — *"hoje o ledger tem toda a receita e nenhum custo"*
— com R$ 1,63 milhão de saídas no ledger.

### 5.20 — **Identificadores de código na tela de quem decide** · MÉDIO

Levantados um a um:

| tela | o que aparece |
|---|---|
| `/financeiro/agenda` | `entraNoTotal`, `chaveDedupe`, `saldoPrevistoCents` — em **dois callouts destacados antes de todo número** |
| `/financeiro/custos` | `confronto[].realizadoCents`, `entraNoTotal`, `motivoForaDaSoma`, `chaveDedupe`, `realizadoCents null` |
| `/financeiro/custos-fixos` | `total_detectado_cents`, `entraNoTotal`, `motivoForaDoTotal`, `totalLigadoCents`, `totalDetectadoCents`, `valorSugeridoCents`, `valorIndeterminadoMotivo`, `fin_custo_fixo_parcelado_v` |
| `/financeiro/time` | `fin_approval_rule` |
| `/financeiro/planejamento` | `commercialPlanningByScope` |
| `/financeiro/indicadores` | *"edite `ANEXO_SIMPLES` em `lib/financeiro/dre.ts`"* |
| `/financeiro/categorizacao` | `fin_transaction` |

É a crítica que o próprio `CONTINUACAO.md` faz a `fila_decisao_valor_cents`,
aplicada a sete telas.

### 5.21 — **Ponto decimal em interface pt-BR** · BAIXO

`toFixed(n)` cru: `94.4 %` (qualificar), `94.8% / 133.0% / 46.4% / 0.47 mês`
(MEI), `12.9% / 100.0% / -11.0% / -11.3% / -70.5% / 5.6%` (modelo) — ao lado de
`66,7%` e `15,17%` formatados em pt-BR nas mesmas telas.

### 5.22 — **Texto sem acentuação vindo do SQL** · BAIXO

Em `/financeiro/custos-fixos` e `/notificacoes`, repetido em toda linha:
*"recorrente: dia 17 do **mes** (exato), limitado ao **ultimo** dia quando o
**mes e** curto"*. Em `/financeiro/mei`, no texto legal: *"desenquadramento
RETROATIVO a 1o de janeiro do **proprio** ano (…) a **comunicacao** a RFB e
**obrigatoria** ate o **ultimo** dia **util**"*.

### 5.23 — **Parâmetro desconhecido é ignorado em silêncio** · BAIXO

A armadilha que a instrução desta auditoria já tinha medido, confirmada:

```bash
curl -s 'http://<host>/api/financeiro/gerencial/custos?competencia=2026-09' | jq '.dado.competencia'
# "2026-08-01"   ← devolve agosto, com 200
```

O contrário está **certo e rígido**: valor inválido é 400 em tudo que testei
(`mes=2026-13`, `mes=2026-02-30`, `estado=xxx`, `ordenarPor=vlaor`,
`porPagina=5000`, `agenda?ordenarPor=zzz`). É só o **nome** do parâmetro que
não é validado. Um "achado" produzido com parâmetro errado custa mais caro que
não testar — e esta assimetria é o que o produz.

### 5.24 — **`totalPagaveisNoBanco` conta recebíveis** · BAIXO

§4.10. Hoje não vaza para a tela; vaza para o próximo consumidor.

---

## 6. O que passou

Registrado porque reprovar tudo é tão inútil quanto aprovar tudo.

- **`/financeiro/pessoas`** — o único "ok" limpo. Número exato (28 · 534 ·
  R$ 679.804,49), não-atribuído **ao lado** do total como a tela promete, mês
  corrente marcado "parcial" com a data do extrato.
- **`/financeiro/custos-fixos`** — a ressalva **antes** do número, com o
  comentário no código dizendo por que; "indeterminado" para os 5 grupos que o
  backtest não sustenta; a advertência explícita de não somar os dois totais.
- **`/financeiro/custos`** — mês corrente **indeterminado com motivo**, itens
  fora da soma com o porquê de cada um, `realizadoCents: null` para o futuro.
- **`/financeiro/contas`** — camadas de certeza somadas com um `+` visível e
  cada uma rotulada.
- **`/financeiro/revisao`** — 1.556 / R$ 1.329.962 exatos; é a régua que
  desmente a visão geral.
- **`/financeiro/indicadores`** — `Runway` e `Despesa fixa média` como
  **"— indisponível: sem despesa registrada"**, não como zero.
- **`/financeiro/receitas`** — matriz mensal com **"—"** em célula sem dado, zero
  ocorrências de "R$ 0,00". Buraco não desenhado como zero.
- **`/financeiro/painel`** — a única tela que abre com o que **não** sabe, em
  prosa, antes dos cards, e declara o denominador de cada concentração.
- **`/financeiro/resultado`** — a regra de ouro fecha com resíduo R$ 0,00 contra
  13.882 lançamentos e 64 meses.
- **Validação de parâmetro das rotas gerenciais** — 400 em todo valor inválido
  testado, ordenação por lista branca respeitada, teto de paginação virando 400
  em vez de corte mudo.
- **`/api/time/envios` → 401** sem sessão: a identidade declarada guarda o que
  deve guardar.

---

## 7. Ordem sugerida de ataque

1. **§5.2** — recolocar 0107/0108 no disco do deploy (ou remover os registros) e
   reimplantar de árvore limpa. Sem isso nada do resto é visível.
2. **§5.1** — as três telas que afirmam zero precisam do mesmo tratamento das
   outras 15 (`isFinanceConfigured()` antes de imprimir número). Junto com
   **§5.8** (`/financeiro/importar`) e **§5.9** (mensagem falsa), é a mesma
   família: *o módulo tem um padrão de degradação e cinco telas não o seguem.*
3. **§5.3** — decidir qual é a receita de 12 meses e fazer as três telas
   dizerem a mesma coisa, ou nomear a base ao lado de cada número.
4. **§5.4 / §5.5** — o sino: conferir a resposta e parar de contar aberturas
   como ocorrências.
5. **§5.6 / §5.7 / §5.11 / §5.12 / §5.13** — os números que misturam populações.
6. O resto.

**Nada aqui foi corrigido. Nada aqui foi inferido de código sem ter sido
exercitado**, e onde não deu para exercitar (`/financeiro/fontes`, os fluxos de
escrita, o perfil comum) está dito que não deu.

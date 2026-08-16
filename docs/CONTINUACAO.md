# Continuação — como retomar esta base sem quebrar nada

Este documento existe para quem chega depois. Ele é auto-suficiente: se você só
puder ler um arquivo antes de tocar em qualquer coisa, leia este.

## Checkpoint Codex — 16/08/2026 04:10 BRT

Este é o checkpoint mais recente. As seções históricas abaixo explicam as
decisões, mas seus números retratam o instante em que a sessão do Claude foi
interrompida. Para retomar sem repetir trabalho, comece por aqui.

### De onde esta continuação partiu

- Branch recebida: `financeiro-2026`, HEAD `992d6c5`, 34 commits à frente de
  `main`, sem branch remota publicada.
- Havia 12 arquivos não commitados da sessão interrompida (migrations 0081,
  0083 e 0085; contratos gerenciais; trilha/idempotência; documentos). Eles
  foram preservados integralmente em `157ce40`, antes de qualquer correção.
- Branch independente desta continuação:
  `codex/financeiro-conclusao-2026-08-16`.
- Nenhum deploy foi feito e nenhuma branch desta frente foi enviada ao remoto
  até este checkpoint.

### Commits concluídos nesta continuação

| commit | entrega | validação |
|---|---|---|
| `157ce40` | checkpoint integral do WIP deixado pelo Claude | 12 caminhos preservados antes das correções |
| `234aa5b` | backup dinâmico de todas as tabelas `fin_*`, manifesto e ordem de restauração por FK | dry-run e backup real: 72 tabelas, 42.152 linhas, 73 migrations registradas |
| `8eca05b` | migration 0084 torna obrigatória a trilha crua de lote confirmado | teste transacional prova rejeição sem linha, aceitação com linha e `ROLLBACK` |
| `ef876de` | J3 valida a fonte declarada da competência, não uma janela arbitrária de 90 dias | integridade estrita: J3 passou e o único invariante restante é F1 |
| `dbb8d25` | matriz de cobertura 0085 distingue ausência de zero e expõe a 7ª conta Caixa | arquivo integral executado em transação e desfeito; 15 linhas, zero chaves duplicadas, totais reconciliados com ledger/M12 |

### Escritas efetivamente realizadas no banco

Antes de qualquer escrita foi produzido backup completo e restaurável. Depois:

1. `sync-inter.mjs --desde=2026-06-30` fez somente GET e atualizou o acervo bruto
   local de 671 para 685 transações, chegando a 16/08/2026.
2. `backfill-inter-import-rows.mjs --aplicar` gravou 13 linhas cruas ausentes do
   lote 30; todas casaram exatamente por `idTransacao`. Não criou lançamento.

As migrations 0081, 0083, 0084 e 0085 **não estavam aplicadas** neste checkpoint.
O banco tinha 73 migrations aplicadas. Não confundir isso com a contagem maior
de objetos/migrations mencionada nas seções históricas abaixo.

### Estado provado neste checkpoint

```text
integridade estrita ........ 40/41 invariantes
falha real restante ........ F1: caixa-aplicacao e caixa-emprestimo sem extrato
idempotência Inter ......... duas execuções reais; 2ª sem novos lançamentos; ROLLBACK
migrations aplicadas ....... 73
migrations pendentes ....... 0081, 0083, 0084, 0085
deploy/push ................ nenhum
```

F1 não deve ser “corrigido” inventando saldo zero, janela de cobertura ou
desativando conta. A 0085 transforma a ausência em dado explícito; o fechamento
depende dos extratos/contratos que só o Fernando pode fornecer.

### Trabalho em curso quando este checkpoint foi escrito

- 0081: correção conservadora do comparador tributário; não pode concluir que
  Simples, Presumido ou Real “vence” sem as entradas contábeis e decisões
  listadas nas pendências.
- 0083: classificação e hierarquia de cartões/subcartões; dry-run retomado após
  o teste de idempotência liberar o lock.
- APIs: exportação dos contratos e rotas GET-only para folha, comissão,
  recorrentes, contratos, DRE dimensional, fluxo por conta, receita por grupo,
  balanço e apuração.

Essas frentes podem deixar diffs não commitados enquanto os agentes estiverem
rodando. Nunca use `git add -A`: revise e versione cada caminho nominalmente.

### Sequência segura para retomar

```bash
git status --short --branch
git log --oneline --decorate -12
npm run db:migrate:status

# Só depois de 0081 e 0083 terem relatório de rollback e commit próprio:
npm run db:backup
npm run db:migrate
npm run db:migrate:status

npm run test:import-guard
npm run test:integridade -- --strict
node scripts/test-financeiro.mjs
npm run test:contabil
node scripts/validar-cartoes.mjs
npm run build:app
```

O critério continua sendo o mesmo: migração validada não é migração aplicada;
contrato TypeScript não é endpoint; número estimado não é obrigação; ausência
de dado não é zero. Atualize este checkpoint e faça um commit claro antes de
encerrar qualquer nova sessão.

Estado em **16/08/2026**, branch `financeiro-2026`, 34+ commits à frente de
`main`. Leia também, nesta ordem:

1. `docs/AGENTE_FINANCEIRO.md` — o prompt operacional, com o mapa do terreno
2. `docs/DUVIDAS_FINANCEIRO.md` — 36 decisões que são do Fernando, com opções
3. `docs/PROMPT_CONCLUSAO_BASE.md` — a definição de pronto, 26 critérios

---

## 1. As cinco restrições absolutas

Não são preferências. Vieram do Fernando, com estas palavras, e valem para
qualquer agente, humano ou não.

**1. O erp-obras é somente leitura.** *"não é para escrever nada lá, só ler
dele."* É o ERP do Adryan, em produção, com o time dele trabalhando em cima.
Abra a sessão com `SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY` e
confira com `SHOW transaction_read_only`. **`PGOPTIONS` não funciona** — o pooler
do Supabase ignora. O que precisar mudar lá se pede ao Adryan.

**2. `secrets.zip` nunca é lido, descompactado, impresso ou versionado.**
Não existe exceção, nem "só para conferir".

**3. APIs externas: somente GET.** Nunca emitir cobrança, pagar, transferir,
estornar ou criar webhook. Asaas, Inter, Polp, Pipedrive — todos.

**4. Nenhuma automação executa pagamento.** O sistema prepara, aprova, agrupa
em lote e audita. A autorização final é humana, fora do sistema. Isso está no
schema, não só em comentário: nenhuma coluna em `fin_payment_*` casa
`token|secret|api|credential|endpoint|webhook|transmit|send|execute`, e
`fin_payment_execution` é registro do passado — um gatilho recusa data futura.
**Se você adicionar uma coluna que quebre isso, quebrou a promessa central.**

**5. Onde não houver evidência, o valor é indeterminado, com motivo.**
Nunca um número plausível. Um vazio declarado vale mais que um rótulo inventado.

---

## 2. Onde as coisas estão

### Os dois bancos, e o erro que custa horas

| variável | banco | o que tem |
|---|---|---|
| `FINANCE_DATABASE_URL` | Postgres do Railway | **o ledger `fin_*`** — é aqui que se trabalha |
| `DATABASE_URL` | outro | não é o financeiro |
| `.env.obras` | Supabase do Adryan | erp-obras, **somente leitura** |

O banco errado **responde sem erro** e devolve zero linhas. Se uma consulta que
deveria achar dados voltar vazia, a primeira hipótese é banco errado, não dado
ausente.

### Produção

Railway, projeto **`xpe-plataforma`** — o nome não bate com o do repositório. Um
`railway up` do diretório errado já derrubou a produção por duas horas. Confira
o projeto vinculado antes de qualquer deploy.

Autenticação: Basic Auth com dois perfis (time vê a operação, admin vê o
financeiro). **401 em tudo é o comportamento saudável.** Não existe rota
`/api/health`.

### Comandos que medem

```bash
npm run db:migrate:status                 # o que está aplicado e o que falta
node scripts/painel-financeiro.mjs        # 2026 por padrão; --tudo para a base inteira
node scripts/painel-financeiro.mjs --json
npm run test:integridade -- --strict      # 41 invariantes + 20 monitores
node scripts/test-financeiro.mjs
npm run test:contabil                     # 28 verificações de DRE/balanço/fluxo
node scripts/validar-cartoes.mjs
node scripts/prever-caixa.mjs             # dry-run; --aplicar grava a foto
npm run build:app
```

---

## 3. Estado medido em 16/08/2026

```
caixa .............. 6/6 contas fecham · divergência de saldo R$ 0,00
invariantes ........ 38 passam · 3 falham (C3, J3, F1)
monitores .......... 13 na meta · 7 fora
migrations ......... 80 aplicadas
lançamentos ........ 13.880 · documentos 3.406
competence_date .... 100% preenchida, cada uma com a regra que a produziu
balanço ............ R$ 0,00 não conciliado em 64 meses
```

Indicadores de 2026 (meta 90%):

```
lastro de origem ........... 99,1%
categoria atribuída ........ 98,8%
contraparte identificada ... 98,5%
transferência resolvida .... 97,8%
revisão concluída .......... 91,4%   ← caiu de 98,8% de propósito (ver §5)
núcleo definido ............ 90,6%
centro de custo ............  1,1%   ← teto de fonte, ver dúvida 19
```

Os três invariantes que falham:

- **C3** (R$ 9.594,69) — `sync-inter.mjs` confirma lote sem gravar
  `fin_import_row`. Não é o lote 30 que está errado; é o comportamento de toda
  sync futura do Inter. Frente aberta.
- **J3** (R$ 7.257,70) — 6 linhas com competência fora da janela de 90 dias.
- **F1** (R$ 0,00) — duas contas Caixa ativas sem cobertura de extrato
  declarada. É bloqueio de dado: falta o extrato. Ver dúvida 5.

---

## 4. O que foi construído, e por quê

Em uma frase cada, na ordem em que importa entender:

**Caixa é a validação máxima.** Se o saldo calculado não bate com o saldo real da
conta, nada mais importa. `painel-financeiro.mjs` abre com essa checagem e
qualquer trabalho que quebre "6/6 fecham" está errado, por mais elegante que
seja.

**Transferência própria não é despesa.** 81 movimentos internos, R$ 966.069,29,
estavam contados como despesa na DRE. Saíram (migration 0059).

**Recorrente e parcelado têm a mesma assinatura estatística e são coisas
diferentes.** Densidade 1,00, dispersão 0,00, concentração 1,00 — idênticos. Mas
parcelado acaba. O detector estatístico superestimava a receita recorrente em
37%. A correção não foi ajustar limiar: foi ler o que o Asaas **declara na
origem** — 11 assinaturas contra 200 parcelamentos com data de fim. A previsão
hoje tem cinco camadas: `cobranca_emitida`, `assinatura`, `parcelamento`,
`ativo_de_fato` e `vencido_a_receber`.

**Cobrança emitida vence projeção.** Onde existe boleto para a contraparte
naquele mês, a recorrente não projeta. Sem essa trava a previsão somava
R$ 1,27 milhão falso (migration 0061).

**A previsão de saída cobria 5,8% do que sai.** Folha e DAS não tinham camada
nenhuma, então o saldo previsto subia sem nunca cair e "quando o caixa aperta"
respondia "nunca". Hoje cobre 71,7%, e o buraco de R$ 43.059,77/mês é impresso
em toda execução em vez de escondido numa média (migration 0079).

**Reembolso já está dentro do caixa.** Ele é pago no mês seguinte junto do fixo
e classificado como salário. Somar a planilha ao extrato inflaria a folha em
~R$ 6 mil/mês. A regra está gravada no schema para ninguém somar de novo.

**A comissão tem três papéis, e a alíquota estava declarada.** 7% vendedor, 3%
engenheiro comercial, 5% execução — este último medido, porque o ERP diz 0% e
três grupos independentes provam 5%. O rótulo do ERP é de pessoa, não de papel:
num contrato o "eng. comercial" recebeu os 7% e o "vendedor" os 3%.

**A base da comissão não é regra.** Sete negócios, sete bases diferentes
(1,00 · 0,50 · 0,4996 · 0,4990 · 0,3571 · 0,1667 · 0,1484 · 1,2230 sobre o valor
do contrato). É decisão humana no fechamento do lote, e por isso a base fica
`indeterminado`.

**A NFe prova que houve serviço, não qual.** O código municipal 17.01.01.501
aparece em 387 linhas já decididas espalhadas por 11 categorias de receita.
Descartada como prova de categoria.

**Detectar por formato sem contexto casa qualquer coisa do tamanho certo.** Uma
primeira versão procurava CNPJ por "14 dígitos em qualquer campo" e casou zero de
274 negócios do Pipedrive, porque `update_time` = `2024-02-29 14:24:07` tem
exatamente 14 dígitos. A chave certa veio de `organization-fields`, pelo nome do
campo.

---

## 5. Custos assumidos de propósito — não "conserte"

Duas quedas de indicador são corretas e alguém vai querer desfazê-las por engano:

**"Revisão concluída" caiu de 98,8% para 91,4%.** 189 lançamentos em 3.99 e 5.99
diziam "não sei o que é isso" e não apareciam na lista de pendências de ninguém.
Dos 189, **184 tinham sido fechados pela primeira versão do próprio script de
classificação**, que resolvia o item de fila de toda linha que tocava — inclusive
das que ele mesmo mandou para "a classificar". A linha ganhava uma categoria que
declara ignorância e saía da lista de quem poderia desfazê-la. Nada mudou de
lugar: o painel parou de chamar "não sei o que é" de revisado.

**A previsão ficou menor.** Ao tirar a dupla contagem e ao separar parcelado de
assinatura, o previsto caiu. Menor e verdadeiro.

**`fin_orcado_realizado_v` devolve 75 linhas com realizado NULL.** Isso é o
correto — as 114 metas são 100% de escopo `obras` e o realizado delas mora no
erp-obras. **A API não pode devolver 0 no lugar de null**: zero é uma afirmação
sobre o dinheiro, ausência é uma afirmação sobre o dado.

---

## 6. Erros de coordenação cometidos — não repita

Três, todos meus, e todos evitáveis:

**Mover migration para fora do diretório enquanto um agente escreve nela apaga o
trabalho dele.** Fiz isso para aplicar uma migration sem arrastar as pendentes
junto. O agente contábil perdeu o arquivo no meio da escrita e teve de recriar.
Se precisar aplicar seletivamente, **copie antes**, avise o agente, e devolva
imediatamente.

**Aplicar 6 migrations de uma vez, incluindo de agentes ainda trabalhando.**
Validei na hora e o caixa estava intacto, mas foi sorte, não processo. Aplique só
o que está declarado concluído.

**`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` pega ACCESS EXCLUSIVE em
`fin_transaction` ANTES de descobrir que a coluna já existe.** Medido: travou 5
sessões de outros agentes por 2min27s. Nunca reaplique migration já aplicada só
para testar.

**`lock timeout` durante `db:migrate` quase sempre é concorrência, não defeito.**
O `migrate.mjs` usa `lock_timeout = 10s`. Espere e repita — um laço de 6
tentativas com 25s entre elas resolveu todas as vezes.

**Um `git add -A` de um agente versiona os temporários dos outros.** Aconteceu
duas vezes (`.valida-sql-tmp.mjs`, `probe-comissao.tmp.mjs`). Prefira `git add`
com caminhos explícitos.

---

## 7. As frentes: o que rodou e o que falta

### Concluídas e commitadas (19 agentes)

Polp/open finance · caixinhas RDB · Asaas TRANSFER · contratos e parcelas ·
cartão (modelagem, 3 emissores, Inter provado sem API de cartão) · lastro PIX do
Inter · conciliação e pares falsos · contraparte Asaas · Nubank pelo Polp ·
testes e invariantes · classificação da fila · recorrentes e previsão de
recebimento · orçamento do ERP · monitor fiscal · apuração tributária (insumo,
sem cálculo de alíquota) · gap Pipedrive→Asaas · **folha e reembolsos** ·
**fila de pagamentos e contratos de tela** · **comissionamento** ·
**DRE/balanço/fluxo/competência** · **previsão de saída e cenários** ·
**auditoria de cobertura**.

### Rodando quando esta sessão acabou (6 agentes)

Se a sessão morreu antes de eles reportarem, o trabalho deles **pode estar em
arquivos não commitados**. Rode `git status` primeiro. As migrations 0081–0085
estão reservadas para eles:

| migration | frente | o que ela resolve |
|---|---|---|
| `0081_fin_regime_tributario.sql` | tributário | Simples × Presumido × Real, com fonte oficial citada |
| `0082_fin_modelo_planilha_v31.sql` | planilha | o importador aborta; ver §8 |
| `0083_fin_cartao_classificacao.sql` | cartão | 795 itens, R$ 194.205,99, zero categoria |
| `0084_fin_import_row_backfill.sql` | trilha | C3 + teste de idempotência real |
| `0085_fin_fonte_cobertura.sql` | matriz | matriz de cobertura de fontes |
| — | APIs | rotas de leitura gerencial (sem migration) |

### Não lançadas — o que abrir a seguir

**Frente D — triagem das 114 linhas repetidas (M12).** R$ 80.499,81 de excedente
em 54 grupos. O monitor diz que é conferência humana, mas isso foi escrito antes
de existir lastro: hoje há `endToEndId` no Inter (87%), `paymentId` no Asaas e
`lastro_match` no Nubank. Par com `endToEndId` diferente é dois PIX distintos,
provado; mesmo `paymentId` é a mesma cobrança duas vezes, provado. Migration
reservada: **0086**. Não apague lançamento — marque e neutralize por caminho
reversível.

**Frente R — saúde das regras (M14).** 26 de 60 regras ativas sem hit. Três
causas possíveis e o dado separa: regra morta, regra nunca exercitada (o motor
nunca rodou sobre o extrato do Inter — dúvida 0), ou regra larga demais que
perdeu para outra. Proponha versionamento (`fin_rule_version`) no padrão
`ModeloObraVersao` do erp-obras. Migration: **0087**.
**Não rode `reclassificar.mjs --conta=inter`** — a dúvida 0 trava isso: 205
linhas migrariam de Pró-labore para Salários, com consequência tributária.

**Frente H — auditoria final datada.** Deve ser a ÚLTIMA. Ela fotografa o
estado; rodada antes das outras fecharem, fotografa algo que já morreu. Entrega
`reports/auditorias/AAAA-MM-DD-base-financeira.md` no padrão das três que já
existem, atualiza o baseline de `docs/AGENTE_FINANCEIRO.md` (não escreve um
quarto documento paralelo), e arruma a tabela de resumo de
`docs/DUVIDAS_FINANCEIRO.md`, que só lista 19 das 36 dúvidas.

O veredito que essa frente assina: *"se ainda faltar qualquer regra de negócio,
ingestão, conciliação, modelo, teste, API ou dado alcançável pelas fontes
existentes, não dizer que falta apenas design."*

---

## 8. Os dois buracos que a auditoria achou, e o padrão que os une

**795 itens de cartão, R$ 194.205,99, com zero categoria.** Nenhuma. O painel diz
98,8% classificado e **está certo** — ele mede `fin_transaction`, e item de
cartão não é `fin_transaction`.

**A planilha está sendo comparada contra um arquivo que não existe.**
`scripts/import-modelo-referencia.mjs` procura uma aba `"Fluxo de Caixa"` que o
arquivo não tem — ele tem 12 abas, a migration 0034 fala em 21. Os 149 valores
de referência gravados em 11/08 vieram de uma versão que não está mais no
repositório. `fin_projetado_realizado_v` compara o ledger contra um fantasma.

**O padrão:** os dois moram *do lado de fora do indicador que a frente vizinha
estava otimizando*. A régua não alcança. Ao abrir qualquer frente nova, pergunte
antes: **o que este indicador não mede?**

---

## 9. O que só o Fernando responde — as cinco que destravam mais

`docs/DUVIDAS_FINANCEIRO.md` tem 36. Estas cinco travam trabalho inteiro:

| # | pergunta | em jogo | trava |
|---|---|---|---|
| 21 | Em que conta ficam os MEIs? R$ 255.936,66 estão em `6.01 Salários` por omissão do importador | R$ 264.206,66 | **o Fator R, e portanto o anexo do Simples — bloqueia a frente tributária inteira** |
| 5 | Extrato da 7ª conta Caixa (`12920000005783083433`) e contrato do Pronampe | R$ 147.062,10 | **F1, M8 e 5 critérios de pronto. O "6/6 fecham" é 6 de 7** |
| 4 | Existem extratos de Inter e Nubank de 2022–2025? | R$ 2.224.767,97 | a raiz de quase todo `em_transito` |
| 19 | O Adryan carimba projeto retroativo jan–jun no erp-obras? | 739 linhas | **o único indicador vermelho (1,1%), e não há segundo caminho neste ledger** |
| 28 | Onde nasce a conta a pagar? Hoje `fin_document` é 100% a receber | estrutural | a empresa não tem "contas a pagar", tem "contas pagas" — só sabe que deve quando alguém lembra |

E uma que trava por construção: **a dúvida 27**. `fin_approval_rule` nasceu vazia
de propósito (semear um teto seria inventar governança que ninguém combinou), e o
gatilho recusa aprovação sem régua. Até as faixas serem definidas, nenhum
pagamento passa da fila. Isso é desenho, não defeito.

---

## 10. Regras de trabalho para quem continuar

- **Meça antes de afirmar.** Todo número deste documento foi medido; nenhum foi
  copiado de doc anterior. Docs envelhecem em horas nesta base.
- **Backtest é o teste de qualquer detector.** Foi o backtest que pegou a
  superestimativa de 37% na receita recorrente e o viés de +75% na comissão.
- **CHECK constraint é vocabulário controlado, e ele te ensina.** Várias
  violações de CHECK durante o trabalho revelaram que a suposição estava errada,
  não o schema. Nunca afrouxe um CHECK para o seu código passar.
- **Dry-run sempre, com contagem e valor antes/depois.** Todo script de escrita
  aqui tem `--aplicar`; o padrão é não gravar.
- **Âncora de dinheiro em toda migração de dados:** a soma por conta não pode
  mudar. Se mudou, o trabalho está errado.
- **Acumule perguntas em vez de bloquear.** Se falta uma decisão humana, registre
  em `DUVIDAS_FINANCEIRO.md` com opções e o valor em jogo, e siga fazendo o que
  não depende dela.
- **Commite sempre**, mesmo no meio. Trabalho não commitado é trabalho perdido.

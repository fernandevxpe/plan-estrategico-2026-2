# Auditoria externa da retomada do Codex — 16/08/2026

Escrito por uma frente que **não construiu nada** desta base e tem autoridade para
reprovar. Cada número aqui foi medido por consulta própria contra
`FINANCE_DATABASE_URL`; nenhum foi copiado de relatório de agente. Onde não
consegui reproduzir uma afirmação anterior, está dito.

**Janela de medição:** 16/08/2026, 10:45–12:15 BRT, sobre
`codex/financeiro-conclusao-2026-08-16`. A árvore se moveu durante a auditoria
(commits `6c80a16`, `190b99e`, `98a16a4` entraram; a frente 0091 começou a
corrigir D6 no meio). Onde um número mudou entre o começo e o fim, os dois estão
registrados.

---

## 1. A bateria, medida

```
node scripts/painel-financeiro.mjs          6/6 contas fecham
node scripts/painel-financeiro.mjs --tudo   6/6 · contraparte 39,3% na base inteira
npm run test:integridade -- --strict        39/41 invariantes · 17/24 monitores  (exit 1)
node scripts/test-financeiro.mjs            23 verificações ok
npm run test:contabil                       28 verificações ok · 0 falhas
node scripts/validar-cartoes.mjs            0 falhas · 10 lacunas declaradas
npm run test:import-guard                   3 asserções ok
npm run build:app                           PASSA  (MAPA_CONCLUSAO dizia "não verificado")
npm run db:migrate:status                   82 aplicadas · 1 pendente (0090)
npm run test:competencia-ciclo              6 asserções ok
npm run test:duplicidades                   7 asserções ok
npm run test:regra-saude                    5 asserções ok
npm run test:transferencias-lacunas         4 asserções ok
npm run test:modelo-referencia              4 asserções ok
npm run db:backup -- --dry-run              81 tabelas · 84 migrations no manifesto
```

Indicadores de 2026 medidos por mim (meta 90%):

```
lastro de origem ........... 99,1%  (3843/3878)
transferência resolvida .... 98,0%  (3802/3878)
contraparte identificada ... 98,5%  (3342/3393)
categoria atribuída ........ 97,1%  (3764/3878)   ← docs dizem 98,8%
revisão concluída .......... 91,3%  (3540/3878)
núcleo definido ............ 90,6%  (3074/3393)
centro de custo ............  1,1%  (39/3393)
```

**A causa da queda de `categoria atribuída` está no achado 3.** `MAPA_CONCLUSAO.md`
registra que ela "não tem explicação em documento nenhum"; agora tem.

### Afirmações de relatório que verifiquei por conta própria

| afirmação | resultado |
|---|---|
| nenhuma coluna em `fin_payment_*` casa `token\|secret\|api\|credential\|endpoint\|webhook\|transmit\|send\|execute` | **confirmada** — 0 linhas em `information_schema.columns` sobre as 7 tabelas `fin_payment_*` |
| `fin_balanco_v` fecha com R$ 0,00 em 64 meses | **confirmada** — 64 meses, 0 com `NÃO CONCILIADO` ≠ 0, soma absoluta R$ 0,00 |
| `competence_date` em 100% | **confirmada** — 13.881/13.881, e `competence_rule` também 100%, distribuída em 6 regras |
| as camadas de previsão não se somam em dupla contagem | **confirmada** — 0 pares de camadas de entrada coincidindo em (contraparte, mês) dentro de `fin_previsao_evento_v`; e nenhuma `origem_id` aparece em duas camadas de `fin_previsao_recebimento_v` |
| `fin_previsao_saida_v` responde "quanto sai" (`OBJETIVOS_METAS.md` §2, `MAPA_CONCLUSAO.md` crit. 21) | **NÃO REPRODUZIDA — a view não existe.** Não está no banco, não está em migration nenhuma, não está em script nenhum. Só aparece nos dois documentos. Quem responde é `fin_previsao_evento_v` |
| cobertura da previsão de saída = 71,7%, buraco R$ 43.059,77/mês | **NÃO REPRODUZIDA** — `prever-caixa.mjs` mede hoje **68,7%** e **R$ 49.709,02/mês** |

---

## 2. Achados, ordenados por R$ em jogo

### 0 · O módulo `/financeiro` inteiro sobe fora do ar — sem R$, e é o mais grave

**Prova.** `npm run start` (= `node scripts/server.mjs`, que é também o
`startCommand` do `railway.json`) aplica migrations pendentes no boot. Log:

```
[migrate] FALHA ao aplicar migrations — /financeiro ficará indisponível:
migration 0090_fin_fila_casos_lifecycle.sql falhou:
0090: fila esperada 1533/135376892, encontrada 1535/138776892
```

`server.mjs` então passa `FIN_SCHEMA_OK=0` ao Next, e `lib/financeiro/db.ts:106`
degrada tudo. Medido com o servidor no ar: **as 9 rotas gerenciais devolvem HTTP
503 com `"disponivel": false` e `motivo: "banco não consultado"`**. Subindo o
mesmo build com `FIN_SCHEMA_OK=1`, as mesmas 9 rotas devolvem **200 com dado
real** (balanço 15 KB, contratos 220 KB, recorrentes 104 KB).

A pré-condição da 0090 é uma fotografia literal do tamanho da fila
(`IF (v_n, v_cents) <> (1533, 135376892) THEN RAISE EXCEPTION`). Ela vai falhar
de novo a cada lançamento novo, mesmo que alguém "acerte" o número hoje.

**Por que a bateria não vê:** `build:app` não roda migration; `db:migrate:status`
diz alegremente "pendentes: 1"; e todos os testes conectam direto ao Postgres,
nunca pela aplicação. É o buraco ao lado da régua, de novo.

**Classificação: defeito.** Não é do Codex — a 0090 é da frente seguinte, e o
commit `190b99e` já a marca REPROVADA. Registro aqui porque nenhum comando da
bateria obrigatória detecta uma indisponibilidade total do módulo.

---

### 1 · R$ 7.803.289,61 — 89% do ledger nunca esteve dentro de um lote de importação

```sql
SELECT t.source, (t.import_batch_id IS NULL) sem_lote,
       count(*) n, sum(abs(t.amount_cents))/100.0 valor
  FROM fin_transaction t GROUP BY 1,2 ORDER BY 3 DESC;
```

```
asaas       sem_lote=true   12288   7.803.289,61
import_csv  sem_lote=false    834   1.215.996,19
inter_api   sem_lote=false    685   1.801.477,52
erp_obras   sem_lote=true      39      65.009,13
polp        sem_lote=true      35      86.462,98
```

Os invariantes C1–C5 ("o desfazer precisa funcionar") e o gatilho novo da 0084
são todos definidos sobre `fin_import_batch`. Existem **6 lotes confirmados,
cobrindo 1.519 lançamentos — 11% da base**. O importador do Asaas, que é a maior
fonte, simplesmente não cria lote, e portanto está estruturalmente fora de toda
a família C e do gatilho da 0084.

O commit `8eca05b` se chama "Trilha de importação vira invariável do banco". É
invariante **de lote confirmado**, não de importação. A frase, como está, promete
mais do que entrega.

Atenuante medido: a idempotência não depende do lote — existe
`CREATE UNIQUE INDEX fin_transaction_dedupe_idx ON (account_id, dedupe_version,
dedupe_hash)` e 0 grupos de `dedupe_hash` repetido. O que falta é a **reversão
auditável**, não a não-duplicação.

**Classificação: critério superdeclarado.** O critério 24 ("importadores
idempotentes") está ✅ nos documentos; é ✅ para idempotência e ❌ para
reversibilidade em 89% do dinheiro.

---

### 2 · R$ 474.729,19 — toda decisão humana do ledger está sem trava, e 54 já foram apagadas

```sql
SELECT count(*) n, sum(abs(amount_cents))/100.0 valor
  FROM fin_transaction
 WHERE classified_by = 'humano'
   AND (human_locked_fields IS NULL OR human_locked_fields = '{}');
-- 217 linhas · R$ 474.729,19

SELECT count(*) FROM fin_transaction
 WHERE human_locked_fields IS NOT NULL AND human_locked_fields <> '{}';
-- 1
```

**Uma** linha no ledger inteiro tem `human_locked_fields` preenchido. 217 estão
marcadas `classified_by='humano'` sem trava nenhuma.

A causa é código, e é do commit mais novo de `main`
(`85a900b`, a tela de qualificação):
`app/api/financeiro/qualificar/route.ts:100-107` grava
`classified_by='humano'` e **lê** `AND NOT ('category_id' = ANY
(human_locked_fields))` — mas nunca **escreve** a trava. O outro caminho de
decisão humana, `lib/financeiro/revisao.ts:414`, escreve. São dois caminhos e só
um arma o mecanismo.

A consequência já aconteceu:

```sql
SELECT count(*) FROM fin_classification_event e
  JOIN fin_transaction t ON t.id = e.target_id AND e.target_table='fin_transaction'
 WHERE t.category_id IS NULL AND e.actor='tela' AND e.stage='humano';
-- 54
```

**54 lançamentos decididos por uma pessoa na tela estão hoje sem categoria
nenhuma.** A trilha guarda o evento; o dado foi por cima.

```sql
SELECT count(*) n, sum(abs(t.amount_cents))/100.0 v FROM fin_transaction t
 WHERE EXISTS (SELECT 1 FROM fin_classification_event e
                WHERE e.target_table='fin_transaction' AND e.target_id=t.id
                  AND e.actor='tela' AND e.stage='humano')
   AND (t.human_locked_fields IS NULL OR t.human_locked_fields='{}');
-- 104 linhas · R$ 153.552,14  (100% do que a tela decidiu, desprotegido)
```

**Classificação: defeito.** Viola a regra 5 das restrições absolutas ("o que uma
pessoa travou fica travado") por omissão de escrita, e explica por que os
invariantes E1 e E2 passam por vácuo (achado da §4).

---

### 3 · R$ 390.057,45 → R$ 79.265,35 — D6: diagnóstico CONFIRMADO, com a linha de código

A regressão conhecida existe, o diagnóstico de `CONTINUACAO.md` §11 está certo na
**primeira** das duas leituras propostas ("a classificação por contrato deveria
ter limpado o `classified_rule_id`"), e a causa raiz é esta:

`scripts/import-asaas.mjs`, blocos 5 e 6, gravam
`classified_by = 'contrato'` **sem zerar `classified_rule_id`**, depois do upsert
já ter carimbado a regra que casou no extrato.

Provas independentes:

```sql
SELECT t.classified_rule_id, r.slug, count(*) n, sum(abs(t.amount_cents))/100.0 v
  FROM fin_transaction t LEFT JOIN fin_rule r ON r.id = t.classified_rule_id
 WHERE t.classified_by='contrato' AND t.classified_rule_id IS NOT NULL
 GROUP BY 1,2;
-- 73 | receita-asaas-cobranca-recebida | 186 | 390.057,45   (às 10:48)
```

1. **Uma única regra**, a 73, criada às 00:56:20 de hoje. `fin_rule.hits_count`
   dela é **exatamente 186** — ou seja, *nenhuma* das linhas que ela classificou
   sobreviveu como `regra`. A sobrescrita é sistemática, 100%.
2. `classified_reason->>'origem'` das 186 é `'herdado do documento liquidado'` —
   a string literal do bloco 5 de `import-asaas.mjs`. Quem escreveu por último foi
   o importador.
3. Todas as 186 tinham `updated_at = 2026-08-16 08:24:21`, o mesmo segundo do
   `fin_audit_log` `actor='sync-asaas' action='import'`. A quebra aconteceu numa
   sincronização de hoje de manhã, **depois** do último commit do Codex (05:32).
4. `git log -L 565,575:scripts/import-asaas.mjs` datou o bloco em `2fbde46`,
   muito anterior à retomada.

**O Codex não escreveu esta regressão.** Ela é a colisão entre a regra 73 (que a
0056 semeou, na sessão do Claude) e um bloco antigo do importador; só apareceu
quando o sync rodou com as duas coisas no lugar.

**A segunda metade do mesmo defeito é pior que D6.** O mesmo `UPDATE` herdava
`d.category_id` **inclusive quando era NULL**, gravando ausência por cima de
decisão. Medido:

```sql
SELECT coalesce(classified_reason->>'origem','(sem)') origem,
       count(*) n, sum(abs(amount_cents))/100.0 v
  FROM fin_transaction WHERE classified_by='contrato' AND category_id IS NULL
 GROUP BY 1;
-- herdado do documento liquidado | 63 | 79.265,35
```

63 lançamentos, **R$ 79.265,35**, no estado que o próprio `classificar-fila.mjs`
chama de impossível: `classified_by='contrato'` com categoria nula. E
`scripts/reclassificar.mjs:255` trata `'contrato'` como
`classificado_por_humano` — **nenhuma regra volta nelas.** Estão congeladas.
São elas que derrubaram `categoria atribuída` de 98,8% para 97,1%.

Estado ao fechar a auditoria: a frente 0091 já corrigiu 123 das 186; restam as 63
congeladas, que precisam da segunda correção (`AND d.category_id IS NOT NULL`)
mais o reparo do que já foi destruído. O diff em curso em `import-asaas.mjs`
chega às mesmas duas correções por caminho independente.

**Classificação: defeito, confirmado (não refutado).**

---

### 4 · R$ 293.432,76 — 391 documentos sem categoria, fora de todo indicador com meta

```sql
SELECT count(*) n, sum(amount_cents)/100.0 v FROM fin_document WHERE category_id IS NULL;
-- 391 · 293.432,76        (2026: 89 · 123.352,91)
SELECT count(*) n, sum(amount_cents)/100.0 v FROM fin_transaction
 WHERE category_id IS NULL AND posted_on >= '2026-01-01';
-- 114 · 59.964,14
```

O painel diz "categoria atribuída 97,1%" e mede `fin_transaction`. Do lado do
documento — que é **de onde a categoria da transação é herdada** — há mais que o
dobro do dinheiro faltando em 2026, e nenhum indicador com meta o mede.
`test-financeiro.mjs` imprime "cobranças sem categoria: 391" como linha de
diagnóstico, sem meta e sem entrar no veredito.

Some-se a isso a fila:

```sql
SELECT target_table, status, count(*) FROM fin_review_item GROUP BY 1,2;
-- fin_document    pendente   802     fin_document    resolvido     2
-- fin_transaction pendente   753     fin_transaction resolvido  3558
```

**802 de 804 itens de documento nunca saíram do estado em que nasceram, em
08/08.** M4 soma os dois lados e mostra um número só.

**Classificação: lacuna de cobertura de indicador (defeito de instrumento).**

---

### 5 · R$ 161.125,80 — o cartão continua majoritariamente sem categoria

```sql
SELECT kind, (category_id IS NULL) sem_cat, count(*) n, sum(abs(amount_cents))/100.0 v
  FROM fin_card_transaction GROUP BY 1,2;
-- compra           sem_cat=true   361   52.043,81
-- iof              sem_cat=true   133      553,40
-- estorno          sem_cat=true     6    1.529,55
-- pagamento_fatura sem_cat=true    14  106.999,04   ← correto ficar sem
SELECT * FROM fin_card_classificacao_cobertura_v;
-- nubank-cartao | 781 itens | 281 com categoria | pct_valor 37,9
```

A frente 0083 (`07362e8`) reduziu a lacuna real de R$ 87.206,95 para
**R$ 54.126,76** e cobre **37,9% do valor itemizado**. Os R$ 106.999,04 de
`pagamento_fatura` **devem** ficar sem categoria e conferem com os R$ 107.600,75
de faturas pagas do `test-contabil`.

Nenhum dos 500 itens está em `fin_review_item` — `target_table` só aceita
`fin_transaction` e `fin_document`. Quando M4 zerar, eles continuarão parados e
invisíveis.

**Classificação: trabalho alcançável (parte) + lacuna de dado (titulares) +
buraco de modelo (o IOF não tem linha no plano de contas: o grupo 7 é só 7.01
DAS, 7.02 ISS, 7.03 Retenções).**

---

### 6 · R$ 80.499,81 — M12 ficou verde por veredito de máquina, e 12 casos não têm a prova que o texto alega

```sql
SELECT workflow_status, verdict, evidence_strength, reviewed_by, count(*) n,
       sum((member_count-1)*abs(amount_cents))/100.0 excedente
  FROM fin_duplicate_case GROUP BY 1,2,3,4;
-- revisado | transacoes_distintas | forte | migration-0087             | 47 | 78.227,19
-- revisado | transacoes_distintas | forte | script:arquivar-nubank-pdf |  7 |  2.272,62
```

Os 54 grupos de repetição que `CONTINUACAO.md` §7 listava como **frente não
lançada** foram fechados pela própria migration, sem humano. O monitor M12 agora
lê "0 casos · na meta", enquanto M12·bruto continua lendo "54 grupos · 114
repetições · R$ 80.499,81".

A qualidade da prova é desigual:

```sql
SELECT evidence->>'proof_kind' proof, count(*) n,
       count(*) FILTER (WHERE (evidence->>'distinct_source_ids')::int >= member_count) por_id,
       sum((member_count-1)*abs(amount_cents))/100.0 excedente
  FROM fin_duplicate_case GROUP BY 1 ORDER BY 4 DESC;
```

| prova | casos | com id externo distinto | excedente |
|---|---|---|---|
| `asaas_financial_transaction_id_distintos` | 25 | 25 | 45.154,04 |
| `pdf_com_contagem_homogenea_no_polp` | 5 | **0** | 17.820,38 |
| `inter_ids_estaveis_e_e2e_distintos` | 14 | 14 | 6.039,36 |
| `erp_linha_key_e_contagem_polp` | 2 | 2 | 4.749,50 |
| `espelho_polp_ids_distintos` | 1 | 1 | 4.463,91 |
| `nubank_pdf_totais_direcionais_e_linhas_distintas` | 7 | **0** | 2.272,62 |

**12 casos, R$ 20.092,99, foram carimbados `evidence_strength='forte'` sem um
único id externo distinto** — e o campo `evidence->>'basis'` desses casos diz,
literalmente, *"ids externos diferentes provam eventos bancarios distintos"*,
que é falso para eles. A trilha de auditoria afirma uma prova que os próprios
contadores do JSON desmentem (`source_ids: 0, end_to_end_ids: 0`).

**Classificação: 42 casos com prova genuína; 12 com texto de evidência
incorreto — defeito de trilha, não de dinheiro.**

---

### 7 · R$ 49.709,02/mês — a previsão de saída cobre 68,7%, não 71,7%, e nunca foi aferida

```
node scripts/prever-caixa.mjs
  saída realizada, mediana dos 7 meses fechados   R$ 158.921,09/mês
  saída prevista que entra no saldo (90d ÷ 3)     R$ 109.212,07/mês
  cobertura 68.7%   ·   faltando R$ 49.709,02/mês
```

```sql
SELECT count(*) linhas, count(DISTINCT gerado_em) fotos FROM fin_cash_forecast;  -- 91 · 1
SELECT count(*) dias, count(erro_dia_cents) afereveis FROM fin_previsao_afericao_v;  -- 91 · 0
```

O instrumento de backtest existe e **nunca produziu uma linha**. `CONTINUACAO.md`
§10 diz que backtest é o teste de qualquer detector; a previsão é o único módulo
que não tem um.

**Classificação: trabalho alcançável** (gravar a foto pelo scheduler) **+ decisão
humana** (dúvida 34, o que fazer com o buraco).

---

### 8 · R$ 11.682,57 — o Nubank fecha por um caminho só

```sql
SELECT a.slug, a.current_balance_cents/100.0 coluna,
       (coalesce(a.opening_balance_cents,0)
        + coalesce((SELECT sum(t.amount_cents) FROM fin_transaction t WHERE t.account_id=a.id),0))/100.0 soma,
       (SELECT s.balance_cents/100.0 FROM fin_balance_snapshot s
         WHERE s.account_id=a.id ORDER BY s.date DESC LIMIT 1) snapshot_api
  FROM fin_account a WHERE a.is_active;
```

| conta | coluna | soma dos lançamentos | snapshot da fonte | fluxo |
|---|---|---|---|---|
| asaas | 78.655,13 | 78.655,13 | 78.655,13 | 78.655,13 |
| inter | 1.576,59 | 1.576,59 | 1.576,59 | 1.576,59 |
| nubank-caixinhas | 27.700,17 | 27.700,17 | 27.700,17 | 27.700,17 |
| **nubank** | 11.682,57 | 11.682,57 | **(nenhum)** | 11.682,57 |
| caixa-aplicacao | 0,00 | 0,00 | (nenhum) | (sem histórico) |
| caixa-emprestimo | 0,00 | 0,00 | (nenhum) | (sem histórico) |

Os quatro caminhos concordam onde existem. Mas **"6/6 contas fecham" mistura três
qualidades diferentes de fechamento**: 3 contas confirmadas contra uma fonte
externa, 1 conta que só fecha consigo mesma (o Nubank vem do erp-obras, sem
snapshot de saldo), e 2 que fecham porque são zero por ausência. O painel não
distingue; a matriz 0085 distingue, e é a única que distingue.

**Classificação: lacuna de dado + limitação declarada do indicador.**

---

### 9 · R$ 1.215.996,19 — I2 não alcança o histórico importado por CSV

`I2` filtra `WHERE source_id IS NOT NULL`. As 834 linhas `import_csv`
(R$ 1.215.996,19) têm `source_id` nulo — o invariante "a chave natural da fonte é
única" não diz nada sobre elas. Atenuado pelo índice único de `dedupe_hash`
(0 grupos repetidos), então não há duplicata; mas o invariante que aparece verde
não é o que está segurando.

**Classificação: invariante mais estreito do que o nome sugere.**

---

## 3. Veredito por frente do Codex

Os 15 commits `992d6c5..e1499bb`. **Nenhuma frente do Codex introduziu regressão
de dinheiro; o caixa ficou intacto em todas.** Onde reprovo, é por promessa acima
da entrega, não por dano.

| commit | frente | veredito | motivo |
|---|---|---|---|
| `157ce40` | WIP preservado | **aprovada** | 12 caminhos preservados antes de qualquer correção; `git merge-base` confirma que nada do Claude foi perdido |
| `234aa5b` | backup do schema | **aprovada** | dry-run cobre 81 tabelas e 84 migrations, com manifesto e ordem de FK |
| `8eca05b` | 0084 trilha de importação | **aprovada com ressalva** | o gatilho funciona (`test-import-guard` prova bloqueio e aceitação com ROLLBACK), mas alcança 11% do ledger e exige **≥1** linha crua, não `row_count`. "Invariável do banco" superestima o alcance — ver achado 1 |
| `ef876de` | J3 competência pela fonte declarada | **aprovada** | J3 passa; 13.881/13.881 com `competence_date` **e** `competence_rule`; a janela arbitrária de 90 dias saiu com razão escrita |
| `dbb8d25` | 0085 matriz de cobertura | **aprovada — a melhor entrega da retomada** | `fin_fonte_cobertura_v` expõe a 7ª conta Caixa como `conta_fora_do_ledger` com 5 lançamentos, separa ausência de zero, e é a única coisa nesta base que enxerga `lotes_sem_trilha` e `lancamentos_sem_lote`. Foi ela que me deu a pista do achado 1 |
| `2ec9035` | documentação da retomada | **aprovada com ressalva** | honesta sobre o que ficou pendente; propaga `fin_previsao_saida_v`, que não existe |
| `04c9657` | 0081 comparador tributário | **aprovada com ressalva** | faz exatamente o que promete: **bloqueia**. 256 cenários, **0 completos**, `total_comparavel_cents` NULL em todos, 7 lacunas nomeadas, `base_legal` e `fonte_url` (planalto.gov.br) em cada rubrica. Não fabricou alíquota. Ressalva: o critério 23 continua ❌ e a frente sabe disso |
| `225db83` | 9 APIs gerenciais | **aprovada com ressalva** | exercitei as 9 com o servidor no ar: 200 com dado real, envelope completo, e `POST/PATCH/PUT/DELETE → 405`. Ressalva dupla: (a) são **9 de 37** contratos; o comentário de `http.ts` diz "as 15 rotas"; (b) em boot normal elas devolvem **503**, pelo achado 0 |
| `ae38cb5` | 0082 proveniência da planilha | **aprovada** | o fantasma foi desarmado do jeito certo: `referencia_cents` = 0 em todas as 149 células, o valor antigo preservado em coluna separada, `referencia_status='origem_perdida'` e motivo apontando a dúvida 37. `fin_projetado_realizado_v` não compara mais contra nada — e diz isso |
| `07362e8` | 0083 cartões | **aprovada com ressalva** | hierarquia de pé, 16 de 25 planos atravessam reemissão sem se partir, `validar-cartoes` com 0 falhas. Ressalva: **37,9% do valor**; R$ 54.126,76 seguem sem categoria e fora de qualquer fila medida (achado 5) |
| `9654188` | 0086 competência no ciclo de vida | **aprovada** | 6 asserções transacionais, cobertura 13.881+795 sem nenhum nulo, conflitos publicados, trava humana testada, ponto fixo do backfill provado |
| `2c2e15b` | 0088 versionamento e saúde de regras | **aprovada com ressalva** | `fin_rule_version` (66 versões) e asserções datadas são o padrão certo. Ressalva séria: **a regra 73 tem `hits_count = 186` e nenhuma dessas 186 linhas continua atribuída a ela** — a tela de saúde de regras mostraria a regra 73 como das mais produtivas da base quando 100% do trabalho dela foi sobrescrito. O contador mede carimbo, não decisão sobrevivente |
| `2c00e51` | 0089 transferências e lacunas de fonte | **aprovada** | 4 asserções com ROLLBACK; as 243 pernas sem par têm motivo e a pendência acionável é zero. Separar "não pareei" de "não há o que parear" é correto |
| `e32cf91` | 0087 duplicidade como caso auditável | **REPROVADA com ressalva parcial** | o mecanismo é excelente (gatilhos por statement, eventos append-only, lock advisory provado com duas conexões). **Mas a migration fechou 47 dos 54 casos sozinha**, marcando `verdict='transacoes_distintas'` e `evidence_strength='forte'`, e em **12 deles (R$ 20.092,99) o `basis` afirma uma prova por id externo que o próprio JSON registra como inexistente** (`source_ids: 0`, `end_to_end_ids: 0`). Isso é carimbar evidência forte sem evidência — exatamente a regra 3 das inegociáveis. Reprovo a **decisão de mérito**, não o mecanismo: separar os 12 para fila humana, ou trocar `forte` por `inferida` com o texto correto, resolve |
| `e1499bb` | monitores de evidência e fonte ausente | **aprovada com ressalva** | M12E, M14·fonte e M7·fonte são bons instrumentos. Ressalva: M12 lê "0 casos, na meta" para os mesmos 54 grupos que M12·bruto lê como R$ 80.499,81 em aberto. Dois monitores adjacentes contando a mesma coisa de formas incompatíveis é o risco que esta base já pagou caro |

**Saldo da retomada, medido:** migrations 80→82 (hoje 82+7 novas versionadas),
invariantes 38/41→39/41, monitores 13/20→17/24, caixa 6/6 intacto,
`build:app` passando. É saldo positivo. Discordo apenas de `CONTINUACAO.md` §11
num ponto: **D6 não é regressão do Codex** — é colisão entre a 0056 (Claude) e um
bloco de 2026-08-1x em `import-asaas.mjs`, disparada por um `sync-asaas` das
08:24 de hoje, muito depois do último commit do Codex.

---

## 4. Os invariantes que passam por VÁCUO

O `test-integridade` declara **um**. São pelo menos **seis**, e o mais grave é o
que ele não declara.

| invariante | população que ele examina | leitura |
|---|---|---|
| **E3** — `'adiado'`/`'ignorado'` não voltam para a fila | **0 linhas** | declarado pelo próprio teste. Correto |
| **E1** — linha travada foi classificada por gente | **1 linha** | vácuo de fato. E o motivo é o achado 2: a tela que decide não escreve a trava. O invariante mais importante da base — o que impede o sync noturno de apagar o trabalho da véspera — é exercitado por **uma** linha, enquanto 217 decisões humanas ficam desprotegidas |
| **E2** — campo travado não está vazio | **1 linha** | idem |
| **D4** — documento a receber não carrega categoria de despesa, **nem o contrário** | metade da afirmação tem **0 linhas**: `fin_document` é 100% `direction='receber'` | a segunda metade nunca foi testada. É também a prova do critério 9 ❌ |
| **C4** — lote revertido não deixou lançamento vivo | 20 lotes, mas **0 lançamentos vivos possíveis fora dos 11%** | e C1, C2, C3, C5 não são vácuo, são **estreitos**: 6 lotes / 1.519 lançamentos / 11% do dinheiro (achado 1) |
| **G2** — nenhum snapshot de saldo com variância | **11 snapshots, 3 contas** | metade das contas ativas nunca teve snapshot. Não é vácuo, é meia-régua |
| **I2** — nenhum `(source, source_id)` repetido | exclui as 834 linhas com `source_id` nulo | achado 9 |

O gatilho de `fin_payment_execution` que "recusa data futura" também nunca foi
exercitado contra dado: `fin_payment_request`, `fin_payment_approval`,
`fin_payment_batch`, `fin_payment_execution`, `fin_approval_rule`,
`fin_payee_account` e `fin_purchase_request` têm **0 linhas cada**. A promessa
"nenhuma automação paga" é verdadeira e, hoje, **vacuamente** verdadeira: não
existe fluxo de pagamento nenhum. Isso é desenho declarado (dúvida 27), não
defeito — mas quem for medir a promessa precisa saber que ela nunca foi posta à
prova.

---

## 5. Os 26 critérios, com evidência medida por mim

Legenda: ✅ cumprido · ⚠️ parcial · ❌ não cumprido.
**(a)** alcançável com as fontes existentes · **(b)** bloqueio de dado do Fernando ·
**(c)** frente em voo.

| # | critério | estado | evidência que eu medi | falta |
|---|---|---|---|---|
| 1 | Contas inventariadas | ⚠️ | 6 em `fin_account`; `fin_fonte_cobertura_v` mostra uma 7ª, `caixa-economica-12920000005783083433`, `status='conta_fora_do_ledger'`, com 5 lançamentos de 2026 (R$ 25.400,00) apontando para ela | (b) dúvida 5 |
| 2 | Caixa fecha conta a conta | ✅ | 6/6 · M15 R$ 0,00 · G1 e G2 passam | — |
| 3 | Saldo bate com a fonte | ⚠️ | 4 caminhos independentes concordam nas 4 contas com movimento. **Mas só 3 têm snapshot da fonte**; o Nubank fecha só consigo mesmo (achado 8) | (a) snapshot do Nubank |
| 4 | Cobertura D+1 onde a fonte permite | ⚠️ | 4 contas a 1 dia; 2 a "nunca". `nubank-caixinhas` cobre 46 de 228 dias de 2026 | (b) dúvidas 5 e 3 |
| 5 | Nenhuma conta ausente como zero confiável | ❌ | F1 falha com 2 violações; a 0085 nomeia, não preenche | (b) dúvida 5 |
| 6 | Cartões por emissor/linha/subcartão | ⚠️ | 3 emissores, 3 linhas, 12 subcartões, 21 faturas, 795 itens; 16/25 planos atravessam reemissão e seguem sendo um | (b) 12 cartões sem titular, 793 itens, R$ 87.206,95 |
| 7 | Faturas conciliadas | ⚠️ | 17 faturas R$ 107.600,75 conciliadas; 4 fora da cobertura R$ 22.013,66; 12 não explicadas R$ 13.744,87; 42% da massa não é explicada por item porque a fonte não itemiza | (a) parcial + (b) |
| 8 | Tudo classificado ou indeterminado explícito | ⚠️ | `fin_transaction` 97,1%; **`fin_document` 391 sem categoria, R$ 293.432,76**; **`fin_card_transaction` 500, R$ 54.126,76**; **63 linhas congeladas em `contrato`+categoria nula, R$ 79.265,35, que regra nenhuma alcança** | (a) + (c) 0091/0094 |
| 9 | A pagar e a receber completos | ❌ | `fin_document` = 3.406 linhas, **0 com `direction='pagar'`**; `fin_payment_request` = 0; `fin_payee_account` = 0 | (b) dúvida 28 |
| 10 | Salários com histórico e previsão | ✅ | 28 pessoas, 117 contratos de remuneração, `fin_folha_previsao_total_v` projeta R$ 90.186,85 para 09/2026 | ressalvas 23–26 |
| 11 | MEIs com histórico e previsão | ❌ | `6.01 Salários` acumula 268 lançamentos e R$ 308.816,46, com os MEIs dentro por omissão do importador | (b) dúvida 21 |
| 12 | Reembolsos com histórico e previsão | ⚠️ | 81 pedidos, 193 itens, views de pé; **0 de 193 com anexo**; `6.05 Reembolsos` está entre as 17 categorias nunca usadas | (b) dúvida 22 |
| 13 | Comissões com histórico e previsão | ⚠️ | 309 previstas, 37 pagamentos, 3 papéis, alíquota medida; base fica `indeterminado` porque 7 negócios têm 7 bases | (b) dúvidas 35 e 39 |
| 14 | Receitas e custos separados | ✅ | D2, D3 passam; a soma direta por `cash_flow_group` reconcilia com a DRE (a diferença de R$ 23.650,83 é a devolução de sinal invertido que o `test-contabil` já imprime) | ressalva: 63 cobranças sem tipo de serviço |
| 15 | Reservas modeladas | ⚠️ | 4 reservas, alvo **R$ 230.547,86**, `current_cents` **= 0** nas quatro; por isso "primeiro dia abaixo da reserva" dá **hoje**, sempre | (b) dúvida 32 |
| 16 | Impostos modelados | ⚠️ | `fin_apuracao_tributaria_v` entrega insumo e declara que não calcula; 3.521 NFS-e; o grupo 7 tem 3 linhas e nenhuma serve para IOF | (a) + (c) |
| 17 | Empréstimos modelados | ❌ | nenhuma tabela; o Pronampe existe só como lacuna do balanço (`passivo superestima emprestimos R$ 147.062,10`); `caixa-emprestimo` com 0 lançamentos | (b) dúvida 5 |
| 18 | DRE saindo do banco | ✅ | `fin_dre_mensal_v`, 64 meses, duas visões; 28 verificações contábeis passam; `folha_do_mes_ja_paga` declara o viés do mês corrente | — |
| 19 | Balanço saindo do banco | ✅ | **verifiquei por consulta própria**: 64 meses, 0 com `NÃO CONCILIADO` ≠ 0; 6 lacunas com direção do erro | — |
| 20 | Fluxo saindo do banco | ✅ | `fin_fluxo_caixa_v` + `fin_fluxo_caixa_conta_v` reconstroem o saldo das 4 contas com movimento; 0 meses com resíduo | — |
| 21 | Previsão saindo do banco | ⚠️ | 6 camadas de entrada (não 5 — há `receber_previsao_contrato`), **sem dupla contagem provada por mim**; saída a **68,7%**; `fin_cash_forecast` com 1 foto e `fin_previsao_afericao_v` com **0 de 91 dias aferíveis** | (a) |
| 22 | Orçamento × realizado | ❌ | `fin_orcado_realizado_v`: **75 linhas, 75 com realizado NULL**; 114 metas, 100% escopo `obras` | (b) dúvida 30 |
| 23 | Comparação tributária com memória de cálculo | ❌ | `fin_regime_resumo_v`: 256 cenários, **0 completos**, `total_comparavel_cents` NULL em 100%; 13 lacunas distintas bloqueiam 2026 | (b) dúvida 21 |
| 24 | Importadores idempotentes | ⚠️ | idempotência **sim** (índice único de `dedupe_hash`, 0 repetidos; Inter provado em duas execuções com ROLLBACK). Reversibilidade **não**: 89% do ledger, R$ 7,80 milhões, sem lote (achado 1) | (a) |
| 25 | Testes e build passando | ⚠️ | `build:app` **passa** (medido; MAPA dizia não verificado). Integridade **39/41**: D6 (R$ 79.265,35 no fim da janela) e F1. Demais suítes verdes | (c) 0091 |
| 26 | APIs prontas | ❌ | 37 contratos `get*`, **9 rotas**. E em boot normal as 9 devolvem **503** (achado 0) | (a) |

```
✅  8 cumpridos
⚠️ 11 parciais
❌  7 não cumpridos
```

Difiro de `MAPA_CONCLUSAO.md` em dois critérios: **3** cai de ✅ para ⚠️ (o Nubank
não tem confirmação externa) e **24** cai de ✅ para ⚠️ (reversibilidade em 11%).

---

## 6. O veredito sobre a frase que fecha o projeto

> *"Se ainda faltar qualquer regra de negócio, ingestão, conciliação, modelo,
> teste, API ou dado alcançável pelas fontes existentes, não dizer que falta
> apenas design."*

**NÃO ASSINO. Não falta apenas design.** Faltam, medidos por mim e alcançáveis
pelas fontes que já existem, sem depender de nenhuma resposta do Fernando:

1. **Uma regra de negócio quebrada em produção de dados.**
   `import-asaas.mjs` grava `classified_by='contrato'` sem limpar
   `classified_rule_id` e herda categoria nula por cima de categoria decidida.
   Cada `sync-asaas` reproduz e amplia o dano. Frente 0091 em curso; 63
   lançamentos e R$ 79.265,35 ainda congelados quando fechei a medição.
2. **Uma trava que não é escrita.** `qualificar/route.ts` marca `humano` e não
   arma `human_locked_fields`. 217 decisões humanas, R$ 474.729,19, sem proteção;
   54 já perdidas. É código, é de uma linha, e não depende de ninguém.
3. **Uma API que existe e não está no ar.** 9 de 37 contratos têm URL, e as 9
   devolvem 503 em boot normal por causa de uma pré-condição literal na 0090.
4. **Uma conciliação com trilha incompleta.** 89% do ledger, R$ 7,80 milhões,
   fora de qualquer `fin_import_batch` — o desfazer não alcança.
5. **Um teste que nunca rodou.** `fin_previsao_afericao_v`: instrumento
   instalado, 0 de 91 dias aferíveis. A previsão é o único módulo sem backtest.
6. **Um modelo incompleto que a fonte já permite fechar.** 500 itens de cartão,
   R$ 54.126,76, dos quais 156 caem com 25 decisões de plano e 155 já têm
   candidato com evidência.
7. **Uma trilha que afirma prova que não tem.** 12 casos de duplicidade,
   R$ 20.092,99, marcados `forte` com `source_ids: 0`.

Fora disso, o que resta é bloqueio de dado do Fernando (dúvidas 5, 21, 28, 30,
32, 4, 19 acima de tudo) ou decisão dele.

**E a régua zero continua de pé, medida por mim quatro vezes nesta janela:
6/6 contas fecham, divergência R$ 0,00.** Nada do que está acima toca o caixa.

---

## 7. O que eu recomendaria fazer primeiro

Ordem por (risco × custo de conserto), não por R$:

1. **A trava humana** (achado 2). Uma linha de SQL em
   `app/api/financeiro/qualificar/route.ts`, e para de destruir trabalho de
   gente toda madrugada. Depois, restaurar as 54 pelo `superseded_value` que
   `fin_classification_event` guardou.
2. **A pré-condição da 0090** (achado 0). Enquanto ela existir na árvore,
   qualquer `npm run start`/`predev` sobe o financeiro cego. Trocar a fotografia
   literal por uma asserção que tolere crescimento, ou remover a pré-condição.
3. **As duas correções do `import-asaas.mjs`** (achado 3) — em curso na 0091 —
   **mais** o reparo das 63 congeladas, que a correção sozinha não desfaz.
4. **Os 12 casos de duplicidade sem prova de id** (achado 6): reabrir ou
   reescrever o `basis`. Não é dinheiro; é a credibilidade da trilha.
5. **`fin_previsao_saida_v`** sai de `OBJETIVOS_METAS.md` e de
   `MAPA_CONCLUSAO.md`, ou passa a existir. Hoje dois documentos citam como prova
   um objeto que não está em lugar nenhum.

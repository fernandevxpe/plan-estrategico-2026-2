# Agente do App do Time — captura e classificação de custos

Prompt operacional. Colar inteiro ao iniciar uma sessão de trabalho no app do
time. Autossuficiente: quem receber isto trabalha sem o histórico da conversa
que o originou.

Terreno medido em **21/08/2026**. Sempre que a sessão começar, **remeça**.

Companheiros obrigatórios: [AGENTE_FINANCEIRO.md](AGENTE_FINANCEIRO.md) (as
restrições de dinheiro valem inteiras aqui) e
[MAPA_CLASSIFICACAO.md](MAPA_CLASSIFICACAO.md) (os quatro eixos).

---

## 1. Missão

Fazer com que **todo custo nasça classificado no momento em que acontece**, pela
mão de quem o fez, com comprovante — em vez de ser classificado meses depois
por quem não estava lá.

O alvo não é uma tela bonita. São dois indicadores parados:

| indicador | hoje | meta |
|---|---|---|
| Centro de custo (projeto) | **0,0%** | 90% |
| Contraparte identificada | **25,8%** | 90% |
| Itens de reembolso com comprovante | **0 de 193** | 90% |

Eles estão parados porque classificar 13.978 lançamentos retroativamente não
funciona. O único instante em que alguém sabe que a fita 3M foi para a obra do
Le Parc é o instante da compra.

## 2. O princípio inegociável

> **Captura não pode criar uma segunda verdade sobre o mesmo dinheiro.**

O app registra uma *intenção* ou um *fato declarado*. O extrato registra o
*caixa*. Os dois precisam se encontrar sem nunca somar duas vezes.

Consequências:

- **Registro do app NUNCA vira `fin_transaction` sozinho.** Ele vira previsto
  (`fin_custo_previsto`) e é ligado ao realizado por `realizado_transaction_id`.
  A 0100 tem CHECK que impede previsto virar realizado sem ponteiro.
- **Nunca somar fatura de cartão com extrato da corrente.** Só o pagamento da
  fatura é caixa.
- Diante de duas classificações possíveis sem evidência, **não escolha**:
  `5.99` + tag `indeterminado:<motivo>`. Um número que parece certo é pior que
  um vazio declarado.
- Casamento errado é muito pior que perna órfã. Na dúvida, fila.

## 3. Restrições absolutas

1. **`erp-obras` é somente leitura.** Sem `INSERT`/`UPDATE`/`DELETE`, sem
   migration. Toda sessão abre com
   `SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY`.
2. **O ledger é o `FINANCE_DATABASE_URL`**, nunca `DATABASE_URL`. Os dois têm
   tabelas `fin_*` e o errado responde sem erro. Confirme com
   `SELECT count(*) FROM fin_account` — o certo tem **6 contas**.
3. **Nenhuma automação executa pagamento.** Prepare o lote; a autorização é
   humana.
4. **Nunca ecoe segredo** em output, log ou arquivo.
5. **Nenhuma função aceita `person_id` do cliente.** A disciplina já está em
   `lib/financeiro/time.ts` e é verificada por `scripts/test-perfil-guard.mjs`.
   O app diz quem é pela sessão, nunca por parâmetro.
6. **Não criar modelo paralelo.** Antes de criar tabela, procure — são 121
   tabelas e a maioria do que parece faltar já existe vazia.

## 4. O terreno — leia antes de escrever qualquer linha

### 4.1 O app já existe

`app/time/{page,reembolso,custo,nota,compra,envios}` + `components/time/TimeApp.tsx`
(814 linhas). Cinco fluxos servidos por URL, com upload de foto/PDF funcionando.

| rota | método | o que faz |
|---|---|---|
| `/api/time/sessao` | GET · POST · DELETE | sessão por pessoa, cookie `xpe_time_sessao` httpOnly, 30 dias |
| `/api/time/envio` | POST | custo ou nota de entrada + anexo |
| `/api/time/reembolso` | POST | despesa do próprio bolso + comprovante |
| `/api/time/compra` | POST | pedido de compra + N links |
| `/api/time/envios` | GET | o que a pessoa mandou, filtrado pela sessão |

`app/api/time/_sessao.ts:83` (`lerCorpo`) aceita **JSON e multipart no mesmo
endpoint**. Anexo: teto 10 MB, allowlist `pdf, jpeg, png, webp, heic, xml`.

**`fin_time_envio` tem 0 linhas.** O app foi entregue e ninguém usou. Descobrir
por quê é trabalho de campo, não de código — comece perguntando a duas pessoas.

### 4.2 O que já está modelado (não reconstrua)

| precisa de | já existe | estado |
|---|---|---|
| cartão, emissor, bandeira, físico/virtual | `fin_card_issuer` · `fin_card_account` · `fin_card` | 3 emissores, 3 linhas, **12 plásticos** |
| PJ vs pessoal | `fin_card_account.ownership` ∈ `pj`\|`pf_socio`\|`indeterminado` | Nubank `pj`, **Inter `indeterminado`** |
| parcelamento | `fin_card_installment_plan` + parcelas `PENDING` em `fin_card_transaction` | **25 planos, 21 parcelas abertas, R$ 4.668,02** |
| "a pagar mês que vem" | `fin_card_parcela_futura_v` | responde — **só para o Nubank** |
| pedido de compra | `fin_purchase_request` + `_link` | completo; **falta frete e parcelamento** |
| reembolso | `fin_reimbursement`/`_item` (0012) **e** `fin_reembolso_item` (0129) | **dois modelos concorrentes, divergindo R$ 40,21** |
| comprovante | `fin_anexo_blob` (bytea, gzip, sha256) | funciona; **sem rota de leitura** |
| PIN por pessoa | `fin_person_acesso` (hash + salt) | **0 linhas, vazia de propósito** |
| método de pagamento | `fin_payment_request.method` com o CHECK certo | **0 linhas** |
| conciliação previsto↔realizado | `fin_custo_previsto.realizado_transaction_id` | **0 linhas**, com índice único e 2 CHECKs prontos |
| registro de decisão | `fin_pendencia_resolucao` + 30 tipos catalogados | **0 linhas** |

### 4.3 Decisões do Fernando (21/08/2026)

- **Cliente: PWA, link web.** Sem loja, sem APK. A UI já existe; falta manifest,
  ícones e tirar o Basic Auth do caminho.
- **Login: e-mail + senha**, padrão simples no começo (a senha inicial é
  combinada, não semeada em código). Login com Google depois, se o custo for
  aceitável. Isso **substitui** a ideia de PIN.
- **Detalhe máximo: projeto ou obra.** Nunca pedir núcleo, nunca pedir linha de
  produto — derive. Ver MAPA_CLASSIFICACAO §4.
- **A pessoa pode navegar áreas e categorias, e criar categoria nova** — nascendo
  como proposta.

### 4.4 As três pedras no caminho

1. **Basic Auth global.** `middleware.ts:139-141` tem `matcher: "/:path*"` sem
   exclusão nenhuma. Ele intercepta o manifest e os ícones, e o Chrome só oferece
   "Instalar" se conseguir buscar o manifest anonimamente. Também não há
   `viewport`, `theme-color` nem `public/`.
2. **Identidade declarada.** `abrirSessao()` deixa a pessoa clicar no próprio
   nome numa lista, e a sessão nasce `prova='declarada'` — o código se recusa a
   chamar isso de login, e está certo. Mostrar dinheiro pessoal com identidade
   auto-declarada é o bloqueio real.
3. **Não existe coluna de e-mail** em `fin_person`, nem em nenhuma das 121
   tabelas. É a peça faltante para o login que o Fernando quer.

### 4.5 O comprovante e o backup

`fin_anexo_blob.conteudo` é `bytea` no Postgres, por decisão escrita na 0105:
*"o volume do Railway é cache, e cache não é onde comprovante fiscal mora"*.
**Não existe object storage neste projeto** — `xpe_artifacts` é tabela, não
bucket.

O risco medido: `scripts/db-backup.mjs:119` usa `row_to_json`, que emite `bytea`
em hex — **2,0x** — e retém 14 dias. Cada MB de anexo vira ~14 MB retidos. 193
fotos de 3 MB levariam o banco de 149 MB para ~728 MB e o backup para ~8 GB.

**Mitigação obrigatória antes da primeira foto:** reduzir a imagem no cliente
(1600px, JPEG q80 → ~250 KB) e excluir a coluna `conteudo` do NDJSON diário.
Com as duas, o problema some por anos.

---

## 5. Ondas

Cada onda diz o indicador que move. Ordem por dependência.

### Onda 1 — destravar o app (nada funciona sem isto)

- [ ] **1.1 E-mail e senha.** `fin_person.email citext UNIQUE` com CHECK de
      domínio; hash de senha em `fin_person_acesso` (a tabela já tem
      `pin_sha256`/`pin_salt` — reuse ou renomeie, não crie outra); terceiro
      valor `'senha'` no CHECK de `prova` em `fin_time_sessao` e
      `fin_time_envio`. → *identidade deixa de ser declarada*
- [ ] **1.2 Isentar `/time` e `/api/time` do Basic Auth.** Early-return em
      `middleware.ts`, **antes** do bloco Basic (linha 93), reconhecendo a
      sessão. O middleware roda no edge e não pode consultar Postgres: ele só
      reconhece a forma e carimba `x-xpe-perfil: comum`; **quem valida é a
      rota**, como `exigirContexto()` já faz. Não mexer no `matcher` para rota
      de dados. → *app abre sem popup de senha compartilhada*
- [ ] **1.3 PWA.** `app/manifest.ts`, ícones 192/512, `viewport` e `themeColor`
      no layout, `<link rel="manifest" crossorigin="use-credentials">`, e os
      ícones/manifest fora do matcher. → *"instalar no celular" passa a existir*
- [ ] **1.4 Rota de leitura do anexo.** `GET /api/time/anexo/[...chave]` com
      sessão. Hoje o comprovante entra e nada o serve de volta — anexo
      write-only não é prova. → *comprovante conferível*
- [ ] **1.5 Compressão de imagem no cliente** + tirar `conteudo` do NDJSON.
      Ver §4.5. Faça **antes** de convidar o time. → *backup não explode*

### Onda 2 — o eixo destino

- [ ] **2.1 Preencher `fin_product_line`** com LDC, LIE, ICV, PIE, LSPDA, LCC,
      LGR; amarrar às categorias 3.02/3.03. → *linha de produto sai de 0*
- [ ] **2.2 Seletor de obra/projeto no app**, um toque, com os 20 centros de
      custo espelhados do ERP + busca. Derivar núcleo e linha de produto da
      escolha. → *centro de custo 0,0% → primeiro dígito diferente de zero*
- [ ] **2.3 `owner_person_id` em `fin_transaction`** (B3 do backlog
      financeiro). O app é quem sabe. → *responsável pelo custo*
- [ ] **2.4 Criar 5.12 (eventos/datas comemorativas), 5.13 (IA e automação),
      4.06 (manutenção de equipamento em campo)** e ativar 5.07 com uma regra
      que decida. Ver MAPA_CLASSIFICACAO §3. → *4 lacunas reais fechadas*

### Onda 3 — cartão e liquidação

- [ ] **3.1 `fin_card.holder_person_id`** nos 11 plásticos do Nubank. É ato
      humano, não código — R$ 87.206,95 sem dono. → *`cartao_sem_titular` zera*
- [ ] **3.2 `due_day` e `ownership` do `inter-cartao`.** Sem `due_day` o Inter
      projeta **zero**, e ele pagou **R$ 40.862,41 em 2026**. A previsão de
      cartão hoje erra por ~metade. → *previsão de cartão deixa de mentir*
- [ ] **3.3 Cartão pessoal usado para a empresa.** `ownership='pf_socio'` +
      `holder_person_id`, e um `card_transaction_id` em
      `fin_reimbursement_item`. É o terceiro caso que hoje não existe. → *cartão
      pessoal rastreado sem segunda verdade*
- [ ] **3.4 Método de pagamento como dimensão.** Alimentar
      `fin_payment_request.method`, que já tem o CHECK. → *"quanto saiu por PIX"
      deixa de depender de texto de provedor*
- [ ] **3.5 Cadastrar cartão pela tela.** Hoje não há caminho de escrita: cartão
      só nasce por migration ou script de sync.

### Onda 4 — reembolso de verdade

- [ ] **4.1 Escolher UM modelo.** A 0129 tem a parcela correta e a view de
      saldo; a 0012 tem o workflow. Mantê-los carregados garante que as telas
      divirjam. → *uma verdade*
- [ ] **4.2 Amarrar item↔plano.** `installment_plan_id` é NULL nos 193 itens,
      e por isso `parcelas_futuras = 0` e o painel do admin mostra
      "faltam 0" para plano com 4 a vencer. → *previsão de reembolso deixa de
      ser R$ 0,00*
- [ ] **4.3 `GET /api/time/meu-reembolso`** — mês corrente, próximo mês, e o
      saldo de `fin_reembolso_saldo_v` (**R$ 19.625,14**, que hoje nenhuma linha
      de TypeScript lê). → *a pessoa vê o próprio dinheiro*
- [ ] **4.4 Carregar agosto.** Os dados param em julho; hoje é 21/08. A tela
      "meu reembolso atual" abriria vazia para todo mundo.
- [ ] **4.5 `fin_payee_account`** está vazia: mesmo aprovando, o documento
      gerado não tem para onde pagar.

### Onda 5 — sugestão e conciliação

- [ ] **5.1 Sugestão de classificação no app.** Reuse `classify()` de
      `scripts/lib/fin-rules.mjs` (73 regras, DSL fechado em jsonb, prioridade
      ASC, primeira que casa vence) e o histórico da contraparte. Mostre as
      concorrentes — `rationale.tambem_casaram` já existe.
- [ ] **5.2 Sugestão vira regra proposta** quando confirmada. `virarRegra` já
      nasce `status='proposta'`.
- [ ] **5.3 Conciliação registro↔extrato.** Ver §6 — é o algoritmo mais
      delicado do projeto.
- [ ] **5.4 Frete e parcelamento no pedido de compra.** `freight_cents` no
      *link* (o frete varia por loja) + `installments` no pedido.

### Onda 6 — leitura

- [ ] Percentual por categoria, custo por obra, "a pagar no cartão nos próximos
      N meses" como número de abertura. **Depois** das ondas 1–5.

---

## 6. Conciliação — o algoritmo, e por que ele é delicado

O precedente maduro é `scripts/parear-transferencias.mjs`. **Copie a
arquitetura, não invente outra:** cascata de critérios com confiança declarada +
vetos duros que nenhuma confiança atravessa + resolução por unicidade mútua +
bloco fechado e homogêneo.

### O risco, medido

| recorte | grupos colidindo | maior grupo |
|---|---|---|
| mesmo valor + contraparte + mês (sem tarifas) | **259** | **19** |
| mesmo **dia** + valor + contraparte | 141 | 18 |

Unicidade num raio de ±5 dias: valor+conta+contraparte dá **83,9%** de candidato
único. **16,1% (822 lançamentos) permanecem ambíguos**, e há um ponto com 18
candidatos indistinguíveis.

Cobertura dos sinais: `end_to_end_id` **4,4%** global (87,2% no Inter),
contraparte **37,5%**, e **0 de 13.978** descrições contêm padrão `N/M` de
parcela.

### Vetos duros (antes de qualquer pontuação)

sinal oposto · conta declarada diferente · |Δdias| > 7 (extrato) ou > 45 (cartão,
por causa do ciclo) · candidato já reivindicado · documento da contraparte
diferente · `installments_total` bate mas `installment_number` não · período fora
de `fin_statement_coverage` (resposta é **"ainda não tenho o extrato"**, nunca
"não existe").

Contraparte **ausente nos dois lados não veta** — com 37,5% de cobertura, exigir
contraparte trocaria falso positivo por enxurrada de falso negativo.

### Faixas de decisão

| score | ação |
|---|---|
| id externo igual | casa sozinho, `confidence=100` |
| ≥ 85 **e candidato único** | casa sozinho, evento em `fin_classification_event` |
| ≥ 85 com ≥2 candidatos a menos de 10 pontos | **não casa** — fila com os candidatos e o que faltou |
| 60–84 | confirmação humana, candidato pré-selecionado, motivo do desconto visível |
| < 60 | não sugere |

### O caso ART

Em **03/02/2026**, 18 linhas byte-a-byte idênticas: mesma conta, mesmo dia,
−R$ 108,39, mesma descrição, mesmo CREA. Só o `source_id` do Inter as separa.

- **Bloco fechado e homogêneo**: se `k` registros enfrentam exatamente `k`
  candidatos, todos idênticos entre si e ninguém enxergando fora do bloco, casa
  em bloco. "Qual saída casa com qual entrada" só é pergunta se as respostas
  diferirem em algo — e aqui não diferem: mesmo saldo, mesma DRE, mesmo centro
  de custo. Grave `matched_by='bloco_homogeneo'` e `bloco_tamanho=k`.
- **`k` diferente nunca casa parcialmente.** Abra **um** item de fila para o
  conjunto: *"19 no extrato, 16 registrados — 3 ARTs sem registro (R$ 325,17)"*.
  Não 19 perguntas idênticas.
- **A identidade individual não existe no banco.** Enquanto o registro não
  carregar número da ART / protocolo CREA / obra, nenhum algoritmo pode
  inventá-la. Se o comprovante for anexado, o casamento vira comprovante↔ART e
  a ambiguidade some de verdade.

### Antes de qualquer coisa disso

`scripts/test-duplicidade-casos.mjs:267` está **quebrado**: espera 54/168/114/
R$ 80.499,81 e o banco tem 55/170/115/R$ 80.500,36. Baseline fotografado em
código quebra sozinho quando o acervo anda. Conserte, ou ninguém confia no
detector que o algoritmo novo usa como piso.

---

## 7. Como trabalhar com agentes

O Fernando pediu três agentes por frente: **execução, revisão, crítica**. Vale
para *construção*, não para levantamento — três agentes lendo a mesma tabela
produzem três resumos da mesma tabela.

Por frente de código:

| papel | encargo | critério de aceite |
|---|---|---|
| **execução** | escreve a migration e o código, com teste | roda e o teste passa |
| **revisão** | lê o diff contra este documento e o AGENTE_FINANCEIRO | nenhuma restrição absoluta violada; nenhum modelo paralelo criado |
| **crítica** | tenta quebrar: qual dado fica errado, que número passa a mentir, o que acontece se a fonte parar | ou acha um furo concreto, ou declara por escrito o que testou |

A crítica **não** aprova por ausência de achado: ela relata o que tentou. Frente
que reprova **duas vezes pela mesma causa** para e vira pergunta.

---

## 8. Quando parar e perguntar

- duas classificações possíveis e nenhuma evidência que separe;
- a decisão muda o resultado da empresa (despesa × transferência × retirada de
  sócio — é literalmente o caso do `inter-cartao` hoje);
- a ação escreve em produção algo sem desfazer;
- o dado exige memória de quem estava lá.

Casos já conhecidos que precisam do Fernando:

- **`ownership` do `inter-cartao`**: R$ 40.862,41 numa linha cujo titular
  declarado é pessoa física. 9.01 ou 9.05 muda o resultado.
- **Qual modelo de reembolso é a verdade** (0012 × 0129, R$ 40,21 de diferença,
  com a dívida do Decézaris inflada no modelo A).
- **Senha inicial do app** — qual é, quem entrega, e quando expira.

## 9. Critério de conclusão

A missão está cumprida quando, **simultaneamente**:

1. uma pessoa instala pelo link, entra com e-mail e senha, e registra uma compra
   com foto em menos de 60 segundos;
2. essa compra nasce com pessoa, natureza, centro de custo e forma de liquidação
   — sem que ninguém tenha digitado núcleo nem linha de produto;
3. centro de custo saiu de 0,0%;
4. o comprovante pode ser aberto de volta pelo admin;
5. o previsto criado pelo app encontra o realizado do extrato sem somar duas
   vezes, e o que não casou está **na fila, declarado**, não escondido;
6. as 6 contas continuam fechando.

Declarar concluído sem os seis é falha, mesmo com a tela pronta.

## 10. Formato de reporte

- o indicador antes e depois, medido;
- o que foi verificado contra qual fonte externa;
- o que ficou indeterminado e por quê;
- o próximo passo e se ele escreve em produção.

Sem adjetivos de progresso. Número medido ou silêncio.

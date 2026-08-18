# Retomar — cole isto numa sessão nova

Este arquivo existe porque agendamento de sessão morre com a sessão. O único
mecanismo durável de continuidade é um documento no repositório que a próxima
sessão leia. É este.

**Estado em 17/08/2026, fim do dia.** Branch `main`, tudo publicado no GitHub,
produção no ar. O desenvolvimento entrou em pausa a pedido do Fernando.

---

## O prompt para colar

> Continue o trabalho da plataforma financeira XPE. Leia `docs/RETOMAR.md`,
> `docs/CONTINUACAO.md` e `docs/ENTREGAVEL_CONSOLIDADO.md` antes de agir.
> Meça o estado atual — não confie nos números escritos em doc, todos
> envelhecem em horas. Depois retome pela lista de pendências abaixo, na
> ordem. Commite sempre com `git add` + `git commit -- <caminhos>` na mesma
> invocação, e publique.

---

## Primeiro: meça, não confie

```bash
git status --short && git log --oneline -8
npm run db:migrate:status          # "pendentes: 0" e nenhum drift
node scripts/painel-financeiro.mjs
npm run test:integridade -- --strict
npm run test:contabil
node scripts/test-financeiro.mjs
node scripts/validar-cartoes.mjs
npm run test:agenda
npm run test:time
npm run test:fonte-frescor
npx tsc --noEmit && npm run build:app
```

Referência do último checkpoint:

```
migrations ..... 103 aplicadas · 0 pendentes · 0 drift
caixa .......... 4/4 contas conferíveis fecham · 2 sem extrato (saldo declarado)
invariantes .... 39 passam · 2 falham  (D6 e F1)
monitores ...... 19 na meta de 27
telas .......... 23 em app/financeiro/ + /time + /notificacoes
produção ....... web-production-ee3c4.up.railway.app · Railway "xpe-plataforma"
```

---

## O que está pendente, em ordem de urgência

### 1. D6 volta todo dia — R$ 390.057,45

**É o item mais urgente.** O invariante de proveniência foi corrigido para 63
violações pela migration 0091, e **o sync das 08:00 o devolveu para 186**. A
correção está no código (`scripts/import-asaas.mjs` linhas ~591 e ~701 fazem
`classified_rule_id = NULL`, e o filtro `d.category_id IS NOT NULL` está nas
linhas ~600 e ~668), mas alguma coisa escapa.

Suspeita não confirmada: o upsert das linhas ~493 e ~325 faz
`classified_rule_id = COALESCE(EXCLUDED.classified_rule_id, ...)`, o que
**preserva** o ponteiro antigo. Se o bloco de herança não alcançar aquela
linha, o ponteiro sobrevive com `classified_by='contrato'`.

Como investigar: rode o import num banco de teste, meça D6 antes e depois, e
identifique quais linhas voltam a violar. Não conserte só o dado — enquanto a
causa estiver de pé, ele volta amanhã.

### 2. A agenda leva ~51 segundos

`/financeiro/agenda` abre, mas devagar demais para uso diário. Já protegi o
resto da aplicação com `statement_timeout` de 20 s (uma consulta lenta estava
esgotando o pool de 5 conexões e derrubando **outras** rotas com "timeout
exceeded when trying to connect").

**Três hipóteses já descartadas com medição** — não repita:
- os quatro `EXISTS` repetidos em `fin_custo_previsto_consolidado_v` (trocar
  por `LEFT JOIN LATERAL` não mudou nada)
- a re-avaliação da pilha de views (`AS MATERIALIZED` não mudou nada)
- a função de janela do `SELECT` final (0,6 s isolada)

O que se sabe: `fin_custo_previsto_consolidado_v` custa ~12 s enquanto todas as
suas fontes somadas dão ~2 s. **Aviso importante:** as medições pelo túnel
remoto oscilam até 8× para a mesma consulta. Meça de dentro da rede do Railway
antes de concluir qualquer coisa.

### 3. Defeitos de tela achados na auditoria e ainda abertos

`docs/AUDITORIA_TELAS.md` tem o detalhe. Os que sobraram:
- **receita de 12 meses vale três coisas** — R$ 1.967.961 no painel,
  R$ 1.972.525 em receitas, R$ 2.156.197 em indicadores. As duas primeiras
  usam a mesma base e divergem por janela móvel × calendário; a tela não diz.
  O painel ainda usa "faturou" sobre número de caixa.
- **um número cola populações diferentes** — "R$ 613.345 em 1.556 itens":
  o valor é de 492 lançamentos. Os 1.556 valem R$ 1.329.962.
- **formatação em padrão americano** em `/resultado` e `/mei`
  (`to_char` com `G`/`D` segue `lc_numeric`, que aqui é `en_US`).
- **`GET /api/notificacoes` grava** e o "visto N×" conta aberturas de página,
  não ocorrências do fato.
- **"já cuidei" descarta a resposta** do PATCH e falha em silêncio.

### 4. Telas que ainda não existem

A pagar, fila de pagamento, tributário e cobertura de fontes têm backend pronto
e nenhuma interface. A de pagamento depende da dúvida 27.

**Cartões saiu desta lista em 18/08/2026**: `/financeiro/cartoes` existe, com a
árvore emissor → linha → fatura → subcartão → item, o histórico em dois painéis
que nunca se somam e os 25 planos de parcelamento. Ela depende da migration
`0114_fin_cartao_detalhe.sql`, que está **validada e NÃO aplicada** — enquanto
não for, a tela degrada nomeando as sete views que faltam. Ver a seção da frente
em `docs/CONTINUACAO.md`.

### 5. A reorganização visual, fase 5

O plano de navegação em cinco lugares está em
`https://claude.ai/code/artifact/c8ffe47d-c7bd-4726-9f22-8cffb7582c5e`.
As fases 1 a 4 foram feitas. Falta o enxugamento visual tela a tela — tirar o
que não codifica informação. O Fernando foi explícito: *"menos é mais, não
quero algo carregado"*.

---

## Regras que já custaram caro — não redescubra

**Migration aplicada é imutável.** Editar gera drift de checksum, e drift
derruba o `/financeiro` inteiro no boot: o runner marca o schema inválido e
todas as rotas voltam 503. Correção é migration nova. Aconteceu três vezes.

**O deploy do Railway empacota o DIRETÓRIO DE TRABALHO, não o commit.** Uma
migration inacabada de agente foi para produção assim e o boot a aplicou. Antes
de qualquer deploy, `git status` tem de estar **limpo**.

**Aplicar migration local sem implantar quebra produção.** O binário fica sem
os arquivos que o banco registrou, o boot recusa, e o financeiro inteiro
degrada. Os dois lados andam juntos.

**`git add` e `git commit -- <caminhos>` na MESMA invocação.** O índice do git
é compartilhado: um `git commit` sem pathspec grava tudo que está staged,
inclusive o que outra frente deixou no meio. Aconteceu quatro vezes.

**Nunca `npm run db:migrate` com agente trabalhando** — aplica arquivo pela
metade. Use um script que aplica por nome. E **nunca** mova migration de outro
agente para fora do diretório: isso já apagou o trabalho de um deles.

**Dois bugs latentes no banco, medidos e de pé:**
1. `UPDATE fin_transaction SET category_id` **sem `classified_rule_id`
   explícito no mesmo SET estoura** em 9.793 linhas (R$ 4.599.435,44), com
   mensagem de erro que fala de versão de regra, não de categoria.
2. Categoria de sinal errado **não é recusada, é apagada**: o gatilho faz
   `category_id := NULL` e devolve sucesso.

**A ordem importa:** o gatilho de revisão lê se há item de fila pendente antes
de aceitar `review_status='ok'`. Resolva o item de fila **antes** de atualizar
o lançamento, ou o "ok" reverte sozinho.

**Código certo que nunca dispara é indistinguível de código ausente.** Uma
correção ficou no ar e inerte porque comparava `"2026-08-01"` com `"2026-08"`.
Verifique em produção, não no commit.

---

## Custos assumidos de propósito — não "conserte"

- **"4/4 conferíveis fecham · 2 sem extrato"** é mais honesto que o antigo
  "6/6". As duas contas Caixa não fecham por reconstrução porque não há
  extrato — elas têm **saldo declarado** (R$ 33.000 e R$ 707) em
  `fin_saldo_declarado`, com data, autor e fonte.
- **F1 vermelho** é bloqueio de dado, não defeito: declarar saldo não cria
  cobertura de extrato.
- **"revisão concluída" em 91,4%** — o painel parou de chamar "não sei o que
  é" de revisado.
- **`fin_orcado_realizado_v` devolve 75 linhas com realizado NULL** — as metas
  são 100% de obras e o realizado mora no erp-obras. **A API não pode devolver
  0 no lugar de null.**

---

## O que só o Fernando responde

`docs/DUVIDAS_FINANCEIRO.md`, ~65 registradas. As que travam mais trabalho:

| # | pergunta | em jogo |
|---|---|---|
| 40 | Nos 63 lançamentos, vale a decisão humana ou a da regra? | R$ 79.265,35 e o invariante D6 |
| 19 | Adryan carimba projeto retroativo no ERP? | único indicador vermelho (1,1%), sem caminho alternativo |
| 4 | Existem extratos de Inter/Nubank de 2022–2025? | R$ 2.456.359,27 em trânsito |
| 63 | Art. 18-B: a XPE deve 20% de CPP sobre serviço de MEI em eletricidade? | R$ 52.841,33 não provisionados |
| 28 | De onde nasce uma conta a pagar? | a empresa só sabe que deve quando alguém lembra |
| 27 | Faixas de alçada de aprovação | nenhum pagamento passa da fila sem isso |
| 30 | Meta de orçamento da empresa (as 114 são de obras) | R$ 534.500 |

Três divergências abertas do Pronampe: janeiro tem R$ 650,00 onde o modelo
prevê R$ 6.326,10; fevereiro, maio e junho não têm pagamento dentro de uma
janela que o extrato cobre; e nada sai de Asaas ou Nubank.

---

## Produção

Railway, projeto **`xpe-plataforma`**, serviço `web`. O nome não bate com o do
repositório, e um `railway up` do diretório errado já derrubou a produção por
duas horas. Deploy explícito com `project_id` e `service_id`, com a árvore
limpa, e acompanhe o boot de fora.

O banco de produção é **o mesmo** que se migra localmente
(`postgres.railway.internal` é a rede interna do Postgres cujo proxy público é
`altaria.proxy.rlwy.net`).

---

## O critério que fecha o projeto

> *"Se ainda faltar qualquer regra de negócio, ingestão, conciliação, modelo,
> teste, API ou dado alcançável pelas fontes existentes, não dizer que falta
> apenas design."*

**Hoje não falta apenas design.** Falta o que está na lista acima.

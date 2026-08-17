# Retomar — cole isto numa sessão nova

Este arquivo existe porque agendamento de sessão **morre com a sessão**. O único
mecanismo durável de continuidade é um documento no repositório que a próxima
sessão leia. É este.

---

## O prompt para colar

> Continue o trabalho da base financeira XPE. Leia `docs/RETOMAR.md`,
> `docs/CONTINUACAO.md` e `docs/ENTREGAVEL_CONSOLIDADO.md` antes de agir.
> Meça o estado atual — não confie nos números escritos em doc, todos
> envelhecem em horas. Depois retome de onde a lista de pendências abaixo
> estiver. Crie agentes para o que for paralelizável, commite sempre com
> `git add` + `git commit -- <caminhos>` na mesma invocação, e publique.

---

## Primeiro: meça, não confie

```bash
git status --short && git log --oneline -8
npm run db:migrate:status          # tem de dizer "pendentes: 0" e nenhum drift
node scripts/painel-financeiro.mjs # 6/6 contas fecham é a regra zero
npm run test:integridade -- --strict
npm run test:contabil
node scripts/test-financeiro.mjs
node scripts/validar-cartoes.mjs
npm run test:agenda
npm run test:time
npx tsc --noEmit
```

Referência do último checkpoint (16/08/2026, madrugada):

```
migrations ..... 97 aplicadas · 0 pendentes · 0 drift
caixa .......... 6/6 contas fecham · divergência R$ 0,00
invariantes .... 39 passam · 2 falham   (D6 e F1, ambos com causa conhecida)
monitores ...... 19 na meta de 27
branch ......... codex/financeiro-conclusao-2026-08-16, publicada no GitHub
```

**As duas falhas não são bugs em aberto:**
- **D6** — 63 lançamentos, R$ 79.265,35, onde um bug de importação apagou decisão
  humana. Restaurar exige escolher entre a decisão da pessoa e a da regra, e mexe
  na DRE. É a **dúvida 40**, do Fernando.
- **F1** — 2 contas Caixa ativas sem extrato nenhum. É a **dúvida 5**: falta o
  extrato e o contrato do Pronampe.

---

## Regras que já custaram caro — não redescubra

**Migration aplicada é imutável.** Editar uma gera drift de checksum, e drift
derruba o `/financeiro` inteiro no boot: o runner marca o schema como inválido e
todas as rotas voltam 503. Correção é migration nova. Aconteceu duas vezes em
16/08.

**Nunca `npm run db:migrate` com agente trabalhando.** Ele aplica tudo que está
pendente, inclusive arquivo pela metade. Use um script que aplica por nome —
há um modelo em `docs/CONTINUACAO.md` §6. **Nunca** mova migration de outro
agente para fora do diretório: isso já apagou o trabalho de um deles.

**`git add` e `git commit -- <caminhos>` na MESMA invocação.** O índice do git é
compartilhado por toda a árvore: um `git commit` sem pathspec grava tudo que
está staged, inclusive o que outra frente deixou no meio do caminho. Aconteceu
três vezes em 16/08 — nada se perdeu, mas as mensagens que explicavam o
raciocínio sumiram e tiveram de ser reconstruídas.

**Dois bugs latentes no banco, medidos e ainda de pé:**
1. `UPDATE fin_transaction SET category_id` **sem `classified_rule_id` explícito
   no mesmo SET estoura** em 9.793 linhas (R$ 4.599.435,44) — e a mensagem de
   erro fala de versão de regra, não de categoria.
2. Categoria de sinal errado **não é recusada, é apagada**: o gatilho faz
   `category_id := NULL` e devolve sucesso. Uma tela pode dizer "movido" enquanto
   o lançamento sumiu para a lacuna. Valide o sinal antes do UPDATE.

**A ordem importa em três lugares.** O gatilho de revisão lê se há item de fila
pendente antes de aceitar `review_status='ok'` — resolva o item de fila
**antes** de atualizar o lançamento, ou o "ok" reverte sozinho.

---

## Estado das frentes

### Aplicadas e commitadas
`0100` custo previsto editável · `0101` categorização central · `0102` DRE drill
em 4 níveis · `0103` inventário de identificação · `0104` agenda diária ·
`0105` app do time e notificações · `0106` correção de FK.

### O que estava em construção no último checkpoint
- **telas** de previsão de custos, categorização e DRE expansível (backends
  prontos e aplicados; faltava a interface)
- **validador de telas** conferindo cada uma contra as frases literais do
  Fernando, com autoridade para reprovar
- **marketing**: sync do Meta, links e criativos das campanhas
- **vendas/pré-vendas**: sync do Chatwoot, funil do Pipedrive, equipe comercial

Confira com `git log` e `ls app/financeiro/` o que chegou a existir.

---

## O que falta para concluir

**Trabalho alcançável:**
1. As telas acima, se não estiverem prontas.
2. As 5 rotas de pagamento (`getFilaPagamento`, `getSolicitacao`, `getFilaCompra`,
   `getLotes`, `getAlcadas`) — bloqueadas pela dúvida 27, não por trabalho.
3. Telas que ainda não existem: cartões, a pagar, fila de pagamento, tributário,
   cobertura de fontes.
4. Auditoria final datada — **por último**, porque fotografa o estado.

**Bloqueado por decisão do Fernando** — `docs/DUVIDAS_FINANCEIRO.md`, ~59 abertas.
As que travam mais trabalho:

| # | pergunta | em jogo |
|---|---|---|
| 21 | Em que conta contábil ficam os 12 MEIs? | R$ 264.206,66 — decide o Fator R e o anexo do Simples |
| 5 | Extrato da 7ª conta Caixa e contrato do Pronampe | R$ 147.062,10 — fecha 4 critérios |
| 4 | Existem extratos de Inter/Nubank de 2022–2025? | R$ 2.456.359,27 em trânsito |
| 19 | Adryan carimba projeto retroativo no ERP? | único indicador vermelho, sem caminho alternativo |
| 40 | Nos 63 lançamentos, vale a decisão humana ou a da regra? | R$ 79.265,35, e o invariante D6 |
| 28 | De onde nasce uma conta a pagar? | a empresa só sabe que deve quando alguém lembra |
| 27 | Faixas de alçada de aprovação | nenhum pagamento passa da fila sem isso |

---

## Produção

Railway, projeto **`xpe-plataforma`** — o nome não bate com o do repositório, e um
`railway up` do diretório errado já derrubou a produção por duas horas. **Confira
o projeto vinculado antes de qualquer deploy**, e só suba com a bateria verde e
nenhuma frente escrevendo.

---

## O critério que fecha tudo

> *"Se ainda faltar qualquer regra de negócio, ingestão, conciliação, modelo,
> teste, API ou dado alcançável pelas fontes existentes, não dizer que falta
> apenas design."*

Não assine por otimismo. Rode a bateria e cole a saída crua.

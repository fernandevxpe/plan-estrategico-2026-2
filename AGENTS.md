# Ponto de partida

Next.js 16 (App Router) + PostgreSQL. Duas coisas num repo só: a **plataforma
de gestão** da XPE Consultoria e o **app do time** — um PWA onde quem compra
fotografa a nota e o custo nasce classificado.

Este arquivo é lido pelo Cursor, pelo Codex e por quem chegar agora. Ele guarda
o que **não** se descobre lendo o código: as armadilhas que já custaram caro.

---

## As cinco coisas que quebram primeiro

### 1. `db:migrate` escreve em PRODUÇÃO

Não existe banco de desenvolvimento. `FINANCE_DATABASE_URL` aponta para o
Postgres do Railway, e é o mesmo banco que a produção lê. Rodar
`node scripts/db-migrate.mjs` na sua máquina **altera o banco real**.

Isso é intencional (a casa é pequena e um segundo banco dessincronizado seria
pior), mas significa que toda migration precisa estar certa na primeira vez.

São **dois** bancos e é fácil errar: `DATABASE_URL` é o da plataforma;
`FINANCE_DATABASE_URL` é o financeiro, onde vivem as `fin_*`. Apontar para o
errado **não dá erro** — as consultas respondem, com o dado de outro sistema.

### 2. Migration aplicada é congelada por hash

`scripts/db-migrate.mjs` guarda o hash de cada arquivo aplicado. Editar um
arquivo já aplicado faz a próxima execução falhar.

Errou numa migration? **Escreva outra.** Ver `0152`, que conserta o eixo de
tempo da `0151`, e `0148`, que corrige uma linha de dado com o motivo escrito.

Toda migration termina com um bloco `DO $$ ... END $$` de **pós-condições** que
levanta exceção se o resultado não for o esperado. Não é decoração: é o que
transforma "rodou" em "fez o que dizia".

### 3. `push` na `main` **é** o deploy

O Railway (projeto `xpe-plataforma`, serviço `web`) builda do GitHub
`fernandevxpe/plan-estrategico-2026-2`. Não há passo separado de deploy.

```bash
git push origin main        # isto publica em produção
```

Domínio: `https://plataforma-gestao.xpeconsultoria.com`.
Nunca rode `railway up` — já derrubou a produção uma vez, a partir do
diretório errado.

### 4. `tsc` não olha dentro de SQL

Foi assim que o cadastro de cartão passou semanas quebrado: o INSERT de
auditoria passava 5 parâmetros e o SQL usava 4. O TypeScript estava limpo, a
tela abria, e todo salvamento dava 500.

**Toda rota nova precisa de um teste que a CHAME.** `scripts/test-login.mjs` é
o lugar: ele sobe credencial temporária, exercita o fluxo de ponta a ponta e
desfaz tudo no `finally`.

### 5. O `perfil-guard` não é burocracia

```bash
npm run test:perfil-guard
```

Ele impõe duas regras que sustentam "cada um vê só o que enviou":

- **Nenhuma função exportada de `lib/financeiro/time.ts` aceita pessoa como
  parâmetro.** O escopo vem sempre da `Sessao`. É por isso que não dá para
  criar reembolso em nome de outra pessoa.
- **`/api/time/*` não menciona tabela do ledger** (`fin_transaction`,
  `fin_account`, `fin_dre`…). Quando o app precisa de um número que vem de lá,
  a resposta é uma **view estreita** — ver `fin_sugestao_categoria_v` (0143) e
  `fin_centro_uso_recente_v` (0144), que expõem contagem e nunca valor.

Se o guard reprovar, a saída certa é respeitar a regra, não mover o SQL de
arquivo até o grep parar de ver.

> O guard tem **2 falhas pré-existentes** sobre `/obras`, anteriores a este
> trabalho. Dois é o número esperado; três significa que você quebrou algo.

---

## Rodar

```bash
npm install
npm run dev          # :3000 — roda migrations pendentes antes (predev)
```

Precisa de `.env.local` com, no mínimo, `FINANCE_DATABASE_URL`,
`DATABASE_URL` e `ANTHROPIC_API_KEY` (esta última só para a leitura de
comprovante; sem ela o botão de foto some em vez de falhar no toque).

### Testes que valem rodar antes de commitar

```bash
npm run test:perfil-guard   # escopo do time — precisa continuar em 2 falhas
npm run test:login          # ponta a ponta do app: login, envio, cartão, anexo
npm run test:time           # notificações, em transação com ROLLBACK
npx tsc --noEmit
npx next build
```

`test:login` precisa do servidor de pé em `:3000`. Ele mexe no banco real e
desfaz tudo — se abortar no meio, confira `fin_person_acesso` e
`fin_time_sessao`.

---

## As duas portas

| | `/time` | resto |
|---|---|---|
| quem entra | o time, e-mail + senha | admin |
| como | cookie `xpe_time_sessao` | Basic Auth |
| onde a regra mora | `middleware.ts` + `lib/auth/perfis.ts` | idem |

`middleware.ts` lê o **Basic primeiro** e só depois considera a rota do time.
A ordem importa: invertida, ela declarou o login morto em produção e trancou 26
pessoas para fora.

`/time` tem casco próprio (`app/time/layout.tsx`) e **não** usa o `AppShell` —
o AppShell vazava mensagem de erro do pipeline e o mapa de rotas da plataforma
numa página que responde sem credencial.

---

## Onde as coisas estão

```
app/time/                 o PWA — custo, reembolso, comprar, enviados
app/financeiro/           a plataforma (admin)
app/api/time/             a única superfície de escrita do perfil comum
components/time/TimeApp.tsx    ~2000 linhas: todos os formulários do app
lib/financeiro/time.ts         o núcleo do app do time
lib/financeiro/ler-comprovante.ts   foto/PDF → campos, via Haiku
lib/financeiro/ler-nfe-xml.ts       XML de NF-e → campos, sem IA
lib/financeiro/ler-cartao.ts        foto do cartão → banco/bandeira/cor
lib/financeiro/gasto-descrito.ts    o painel de gasto (cortes)
db/migrations/            152 arquivos, aplicados em ordem, congelados
scripts/                  testes e utilitários (todos `node`, sem framework)
docs/AGENTE_APP_TIME.md   o histórico longo das decisões do app
```

---

## Dois caminhos de leitura, e por que são dois

**XML de NF-e** → `ler-nfe-xml.ts`. Sem IA: os campos têm nome, o valor é
exato, custa zero e responde em ~0,5s. Mandar isso para um modelo seria pagar
por token para adivinhar o que está escrito ao lado de uma etiqueta.

**Foto, print e PDF** → `ler-comprovante.ts`, Haiku 4.5, ~US$ 0,004 por
comprovante. Lê valor, data, itens com quantidade, cartão, parcelas — e
arrisca categoria e área, sempre como **palpite com a razão ao lado**, nunca
preenchendo em silêncio.

**Foto do cartão** → `ler-cartao.ts`. Devolve banco, bandeira, cor e os quatro
últimos. **A imagem é descartada na mesma requisição** — ela contém o número
completo, e guardá-la seria hospedar PAN. Se você mexer nesse arquivo, essa é a
regra que não pode cair.

Dos quatro últimos dígitos **não** dá para deduzir banco nem bandeira: isso é o
BIN, os primeiros 6–8 dígitos, que a casa não guarda de propósito.

---

## Convenções

- **Português** em nome de função, variável, rota e coluna nova. O código é
  lido por quem toca o negócio.
- **Comentário explica o PORQUÊ, com número medido.** Não "ordena por uso" e
  sim "os cinco centros mais usados cobrem 61,2% dos lançamentos". Quando uma
  decisão contraria uma anterior, o comentário diz qual era e por que mudou.
- **Campo que o modelo não leu volta `null`.** Nunca chutado. Campo vazio a
  pessoa nota e digita; campo errado ela aceita sem olhar.
- **Não somar o descrito com o realizado.** `fin_gasto_descrito_v` é o que
  gente contou; `fin_transaction` e `fin_card_*_v` são o que aconteceu na
  conta. A divergência entre os dois é a fila do financeiro, não um erro —
  somá-los conta a mesma compra duas vezes.
- Mensagem de commit no imperativo, dizendo **o que mudou e por quê**, com os
  números que sustentam a decisão.

---

## Estado em 22/08/2026

Funcionando em produção:

- App instalável, login por e-mail e senha, 26 pessoas cadastradas.
- Botão flutuante "foto da compra" → câmera, galeria ou XML/PDF.
- Leitura automática preenche valor, data, itens, parcelas e cartão.
- Cartão desconhecido abre o cadastro; **o dono do cartão decide** se o
  lançamento é compra da empresa ou reembolso.
- Idempotência por `Idempotency-Key`: rede que cai não cria custo duplicado.
- Painel do gasto descrito em `/financeiro/custos` e `/financeiro/cartoes`.

Aberto, em ordem de tamanho:

1. **R$ 336.245 em 83 lançamentos sem categoria** no ledger, e **193 itens de
   reembolso** (R$ 42.320) sem categoria e sem data. O app resolve na origem
   daqui para frente; o passado continua lá.
2. **Eixo de área em 2,1%** — 67 de 3.120 despesas de 2026 dizem para onde
   foram. As 8 áreas existem e estão zeradas.
3. **Conciliação descrito × fatura**: as duas metades existem e ninguém as
   cruza ainda. É o próximo passo natural do painel.
4. Nove cartões Nubank sem apelido; `Macgyver` não existe na base financeira.
5. Revisão do plano de contas: 38 categorias, 13 sem uso; 11 tipos de
   reembolso, 6 sem uso.

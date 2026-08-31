# Colocar em produção

Guia curto para publicar sem derrubar nada. Contexto de infraestrutura está em
[OPERACAO.md](../OPERACAO.md); este arquivo é só o caminho do commit até o ar,
e as armadilhas que já cobraram um deploy.

---

## O caminho, em uma frase

**`git push origin main` publica.** Não existe botão, não existe passo manual.
O Railway constrói a cada push na `main` e troca o processo quando o build
termina.

```
push na main
   ↓
GitHub Actions (.github/workflows/ci.yml)   ← tsc --noEmit + next build
   ↓                                          NÃO bloqueia o Railway: correm em paralelo
Railway: build (Nixpacks, npm run build:app)
   ↓
Railway: boot (scripts/server.mjs)
   ↓  runMigrationsOrDegrade()  ← as migrations pendentes aplicam AQUI, sozinhas
   ↓
next start
```

Duas consequências que importam:

- **Migration não precisa de comando.** Basta o arquivo estar em
  `db/migrations/` e commitado. Ele aplica no boot, **antes** do Next subir —
  então uma tela nova que depende de coluna nova nunca é servida antes da
  coluna existir.
- **Build que falha não vai ao ar.** O Railway mantém a versão anterior
  rodando. Já aconteceu (ver `7b8c6e8` abaixo) e é o comportamento correto:
  ninguém viu erro, só não viu a novidade.

O CI do GitHub roda as **mesmas** duas verificações do Railway. Ele existe para
falhar rápido e com log legível; o Railway falharia de qualquer forma.

---

## Antes de dar push

Rode os quatro. Levam ~2 minutos juntos e cobrem tudo que já quebrou:

```bash
npx tsc --noEmit          # 1. tipos — é o que mais derruba deploy
npm run build:app         # 2. build — pré-renderização e rotas
npm run test:perfil-guard # 3. o app do time não alcança dado financeiro
node scripts/snapshot-cadastro-manual.mjs   # 4. foto do que foi digitado à mão
```

O item 4 não é teste: é a rede. Ele congela em `backups/` tudo que uma pessoa
digitou (salário-base, pró-labore, comissões, reembolsos). Depois do deploy,
`--conferir` prova que nada mudou:

```bash
node scripts/snapshot-cadastro-manual.mjs --conferir
```

Se acusar divergência, **leia antes de assustar**: normalmente é alguém usando
a plataforma no mesmo momento. O jeito de saber de quem foi:

```sql
SELECT actor, target_table, action, count(*)
  FROM fin_audit_log WHERE created_at >= now() - interval '2 hours'
 GROUP BY 1,2,3 ORDER BY 4 DESC;
```

`ui:xpeadmin` é gente na tela. `app-time:<nome>` é gente no aplicativo.
`script:<nome>` é código — e aí sim vale investigar.

---

## Depois do push

```bash
gh run list --limit 1                      # CI verde?
curl -s -o /dev/null -w "%{http_code}\n" \
  https://web-production-ee3c4.up.railway.app/time     # 200 = no ar
```

`/time` responde **200** (login próprio). O resto do site responde **401** sem
Basic Auth, e isso é sadio — não é erro.

Para conferir uma tela do app como uma pessoa específica, sem saber a senha
dela: abra uma sessão temporária no banco, use, e apague no `finally`. É o
padrão de `scripts/test-login.mjs`.

```js
const token = randomBytes(32).toString('base64url');
await cli.query(
  `INSERT INTO fin_time_sessao (token_sha256, person_id, prova, expira_em, user_agent)
   VALUES ($1, $2, 'senha', now() + interval '5 minutes', 'verificacao')`,
  [createHash('sha256').update(token).digest('hex'), PERSON_ID]
);
await fetch(URL, { headers: { cookie: `xpe_time_sessao=${token}` } });
// finally: DELETE FROM fin_time_sessao WHERE token_sha256 = $1
```

---

## Como desfazer

| o que | como |
|---|---|
| código | `git revert <sha> && git push` — o Railway republica sozinho |
| reclassificação de lançamento | `node scripts/corrigir-reembolso-categoria.mjs --reverter=<lote> --aplicar` |
| comissões de exemplo | `node scripts/semear-comissao-exemplo.mjs --remover --aplicar` |
| dado digitado à mão | a foto em `backups/cadastro-manual-*.json` tem as linhas inteiras |

Migration **não** tem `--reverter`. Reverter schema é migration nova, escrita
com a mesma calma da original.

---

## As armadilhas que já cobraram um deploy

### 1. `NODE_ENV` estreitado pelo TypeScript — derrubou `7b8c6e8`

```ts
if (process.env.NODE_ENV !== "development") return notFound();
// daqui para baixo o tsc SABE que NODE_ENV === "development"
secure: process.env.NODE_ENV === "production"   // TS2367: não há sobreposição
```

Uma guarda no topo estreita o tipo no resto da função. Comparar depois com
outro valor é provadamente falso, e o `tsc` recusa. **Build falhou no CI e no
Railway; produção seguiu na versão anterior.**

Regra: depois de uma guarda que devolve cedo, não volte a comparar a mesma
variável com o valor que a guarda excluiu.

### 2. Grade CSS sem `grid-template-columns` — a bomba de pavio de contagem

`.reemb` era `display: grid` sem colunas declaradas. A coluna implícita é
`auto`, que resolve para o **max-content** do filho mais largo. Com dois
cartões dava 368px e cabia; com **seis** deu 1134px e esticou a página inteira
dentro de um viewport de 390px — o valor de cada linha foi parar fora da tela.

Regra: toda grade que recebe lista de tamanho variável leva
`grid-template-columns: minmax(0, 1fr)` e `min-width: 0` nos filhos. Sem isso,
`overflow-x: auto` nunca ganha largura definida para rolar.

Como flagrar antes: medir, não olhar.

```js
const m = await page.evaluate(() => ({
  doc: document.documentElement.scrollWidth,
  viewport: window.innerWidth
}));
// doc > viewport = estoura
```

### 3. Duas tabelas para a mesma coisa

Reembolso vive em `fin_reembolso_item` (planilha, com parcela) **e** em
`fin_reimbursement_item` (planilha + app, com comprovante e status). O app
fundia as duas na tela; a plataforma lia só a primeira — e reembolso pedido
pelo aplicativo sumia para quem paga.

Resolvido por **view** (`fin_reembolso_saldo_unificado_v`, migration 0179), não
por fusão física: das 195 linhas, 193 já casavam. Apagar 194 para ganhar 2 é
risco sem prêmio.

Regra: quando duas fontes descrevem o mesmo fato, una na **leitura** primeiro.
A fusão física é irreversível e muda número que a casa reporta.

E deduplique por **identidade**, nunca por valor: dois Ubers de R$ 45,00 no
mesmo mês são dois. A regra que funcionou foi `(pessoa, competência)` mais
`valor OU descrição`.

### 4. Zero não é vazio

`fin_pessoa_comissao_declarada` tinha `CHECK (valor_cents > 0)`. Ao preencher a
remuneração do time, quem não tinha comissão não conseguia declarar isso — e
lançou **R$ 0,01** quatro vezes.

Ausência de linha significa "ninguém olhou". Zero significa "olhei e não
havia". São dados diferentes.

Regra: antes de proibir zero num campo de valor, pergunte se "zero" é uma
resposta que alguém precisa dar.

### 5. Histórico não é previsão

A previsão do `/time` vinha da **mediana do que já tinha caído**; a da
plataforma, do **cadastro**. Nunca iam concordar: cadastrar um pró-labore novo
não movia nada no app até cair um pagamento sob a base nova.

Regra: "quanto costumo receber" é história; "quanto vou receber" é cadastro.
Uma não substitui a outra, e a tela precisa dizer qual está mostrando.

---

## Onde as coisas moram

| | |
|---|---|
| Produção | Railway, projeto **`xpe-plataforma`**, serviço `web` |
| URL | https://web-production-ee3c4.up.railway.app |
| Banco financeiro | `FINANCE_DATABASE_URL` — **é o Railway, é produção** |
| Migrations | `db/migrations/NNNN_*.sql`, aplicadas no boot |
| App do time | `/time` — login por sessão, não Basic Auth |

⚠ **`FINANCE_DATABASE_URL` aponta para produção mesmo rodando local.** Qualquer
script com `--aplicar` na sua máquina escreve no banco de verdade. Todo script
de escrita deste repositório tem dry-run como padrão — mantenha assim.

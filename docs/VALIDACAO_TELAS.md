# Validação das telas — conferência independente contra o que o Fernando pediu

Escrito em **17/08/2026, entre 02:45 e 03:10 UTC** (23:45–00:10 BRT), sobre a
branch `codex/financeiro-conclusao-2026-08-16`.

Quem escreve isto **não construiu nenhuma destas telas** e não editou uma linha
de código. O valor deste documento é exatamente essa distância. Reprovar é saída
legítima, e há uma reprovação aqui.

---

## 0. Como validei, e o que não consegui validar

**Servidor de verdade, não leitura de código.** Subi `npx next start -p 3987`
sobre o `.next` que já existia (`BUILD_ID snhwTdSY3oIWemBxyiOnw`, build de
16/08 23:48 BRT). **Não rodei `npm run build:app`** — ele segura lock e travaria
as outras frentes — e **não rodei `npm run start`**, que aplica migrations no
boot.

**Credenciais.** `DASHBOARD_ADMIN_USER`/`_PASSWORD` e
`DASHBOARD_AUTH_USER`/`_PASSWORD` **não estão em `.env.local`** — só no Railway.
Conferi a ausência lendo apenas os nomes das chaves, sem imprimir valor nenhum, e
**não abri `secrets.zip`**. Para exercitar os dois perfis em modo produção
localmente, servi a instância com um par descartável meu em cada perfil. Isso
exercita o middleware real (`middleware.ts`, comparação em tempo constante, 404
para o comum); não é contorno de autenticação e nenhuma credencial do Fernando
foi usada ou descoberta.

**O alvo se moveu embaixo de mim, e isso muda o que este documento pode afirmar.**
Quando comecei, existiam **quatro rotas de API novas e uma única tela**. Entre
23:58 e 00:01 BRT as frentes gravaram no disco `app/financeiro/custos/`,
`app/financeiro/categorizacao/`, `FinCustos.tsx` (65 KB), `FinCategorizacao.tsx`
(60 KB) e `FinPlanoContas.tsx` (24 KB) — **depois** do build que eu estava
servindo. Consequência honesta:

| tela | API exercitada no fio | tela exercitada no fio |
|---|---|---|
| Agenda | ✅ sim | ✅ **sim** — estava no build |
| Custos do mês | ✅ sim | ❌ **não** — só leitura de código |
| Categorização | ✅ sim | ❌ **não** — só leitura de código |
| DRE expansível | ✅ sim | ❌ **não existe tela** |

Onde digo "medido", há URL e resposta. Onde a tela não pôde ser exercitada, digo
"por leitura" e **não infiro comportamento de runtime**.

**Migrations.** Ao abrir, `db:migrate:status` dava **96 aplicadas, 1 pendente
(`0104_fin_agenda_dia.sql`)**. Ao fechar, **97 aplicadas, 0 pendentes** — a
frente da agenda aplicou a 0104 durante a validação. Isso importa para o achado
A3.

`npx tsc --noEmit` termina com **exit 0** sobre a árvore inteira, já com os três
componentes novos.

---

## 1. Quadro por tela

| tela | veredito | motivo em uma frase |
|---|---|---|
| **Agenda diária** `/financeiro/agenda` | **aprovada com ressalva** | Exercitada de ponta a ponta e é a melhor tela do módulo: passado/presente/futuro numa linha só, ressalva antes do número, ausência como "sem lançamento". Perde pontos por vazar vocabulário de API na cara do usuário (A4) e por ter ido para a navegação com a migration pendente (A3). |
| **Previsão de custos do mês** `/financeiro/custos` | **aprovada com ressalva** | Cobre os cinco verbos do #73, e o bloco de sobreposição é o melhor pedaço de honestidade da base. Mas a ressalva desce para baixo do número (A2), e no **mês corrente** a tela abre com **R$ 0,00** onde a resposta é "o horizonte começa hoje" (A1). |
| **Central de categorização** `/financeiro/categorizacao` | **aprovada com ressalva** | As quatro buscas do #73 existem e batem com o SQL centavo a centavo; os três universos estão numa tela só. Falta o verbo "correções cadastros" (A5) e há uma falha silenciosa depois de criar categoria (A6). |
| **DRE expansível** | **REPROVADA** | **Não existe tela.** O dado, a API e as travas estão prontos e são excelentes — mas o pedido #73 é uma tela, e nenhum componente consome `/dre/drill`. `FinDre.tsx` é de 10/08, não expande, e a DRE segue sem URL própria. |
| **Identificação** (0103) | **reprovada — sem tela** | Três rotas de escrita (`contraparte`, `resolucao`, `vinculo`) sem nenhum consumidor. Ele pediu "identificar o que ta sem indentificação, o que esta duvido" com todas as letras. |
| **Perfil de acesso** (transversal) | **aprovada** | 404 para o comum em **todas** as 12 rotas financeiras medidas, inclusive as novas. Nenhum vazamento. |

---

## 2. Matriz requisito × tela

Cada verbo dele, um a um. "onde" é arquivo e linha, ou URL exercitada.

### P1 · Previsão de custos do mês (#73)

| # | palavra dele | estado | onde |
|---|---|---|---|
| P1.1 | *"detalhe tudo"* | **existe** | `GET /api/financeiro/gerencial/custos?mes=2026-09` devolve 42 itens com dia, valor, contraparte, procedência e a **regra que produziu o dia** (`diaRegra`) |
| P1.2 | *"organizado categorizado"* | **parcial** | `porCategoria` agrupa com subtotal (`FinCustos.tsx:781-800`), mas vem **vazio no mês corrente**: em `mes=2026-08` são 6 itens com `categoriaId` preenchido e `porCategoria: []`, porque só entra no grupo o que `entraNoTotal` |
| P1.3 | *"mostre o previsto"* | **existe** | 7 procedências medidas em setembro: `pagar_folha` 26, `pagar_recorrente` 9, `pagar_documento` 3, `pagar_tributo_das` 1, `pagar_cartao_parcela` 1, `pagar_cartao_ciclo` 1, `pagar_cartao_estimado` 1 |
| P1.4 | *"usuario pode **confirmar todos**"* | **existe** | Literal: botão *"Confirmar todos os N do mês"* (`FinCustos.tsx:554`) **e** um segundo, separado, *"Confirmar os N que hoje não somam"* com a consequência escrita: *"Sobe o total do mês em R$ X"* (`:570-575`). Individual em `:855`. Rota `POST /custos/confirmar` |
| P1.5 | *"adicionar tbm"* | **existe** | `POST /api/financeiro/gerencial/custos`; e aceita `indeterminadoMotivo` no lugar do valor (`FinCustos.tsx:1495`) — cadastrar sem saber quanto é possível, e o item não entra em soma |

### P2 · Central de categorização (#73)

| # | palavra dele | estado | onde |
|---|---|---|---|
| P2.1 | *"tudo categorizado numa área completa"* | **existe** | `GET /categorizacao/busca` sem filtro: **18.094 itens** = 13.881 lançamentos + 3.418 documentos + 795 itens de cartão, numa consulta só |
| P2.2 | *"busca por valor"* | **existe** | Exato: `?valorMinCents=115640&valorMaxCents=115640` → 1 documento. Faixa: `?valorMinCents=100000&valorMaxCents=200000` → 1.515 (825 lanç. + 689 doc. + 1 cartão). **Conferido contra SQL direto no ledger: idêntico nos dois casos.** Campos "de R$"/"até R$" em `FinCategorizacao.tsx:577,588` |
| P2.3 | *"busca por nome"* | **existe** | `?busca=palacio` → 16; `?busca=Igor Dalton` → 49 lançamentos, casando **contraparte**, não só descrição. Campo em `:514-519` |
| P2.4 | *"busca por tipo"* | **existe** | `?universo=item_cartao` → 795; `?natureza=saida` → 11.323 |
| P2.5 | *"busca por categoria"* | **existe** | `?categoria=6.01` → 276; `?semCategoria=1` → 1.632 |
| P2.6 | *"pode o usuario trocar tudo"* | **existe** | `POST /reclassificar-lote`, com `aplicar:false` por padrão, `ids` explícitos, teto de 1.000 e recusa de `{"filtro":…}` |
| P2.7 | *"pode cadastrar um novo"* | **existe (leitura A)** | `FinPlanoContas.tsx` + `POST/PATCH /categorizacao/categorias`. Sem DELETE, de propósito. **A leitura B — cadastrar lançamento — não está aqui**; ela mora na agenda e na tela de custos |
| P2.8 | *"deve ter tudo lá"* | **existe, e declarado** | A resposta diz o que fica fora da régua do painel: *"389 em documento e 514 em item_cartao. O indicador 'categoria atribuída' só mede fin_transaction"* |
| P2.9 | *"permitir tbm correções cadastros"* | **AUSENTE** | `nucleo` e `centroCusto` existem só como **filtro** (`FinCategorizacao.tsx:236-237,638`). Não há edição de contraparte, núcleo, centro de custo ou competência. As rotas `identificacao/{contraparte,resolucao,vinculo}` existem e **nenhuma tela as chama** |
| P2.10 | *"identificar o que ta sem indentificação, o que esta duvido"* | **existe** | Duas filas separadas e medidas: `?estado=indeterminado` → 1.632 · `?estado=em_duvida` → 437 |

### P3 · DRE expansível (#73)

| # | palavra dele | estado | onde |
|---|---|---|---|
| P3.1 | *"ver o resumo"* | **parcial** | `FinDre.tsx` (10/08) dentro de `/financeiro/indicadores`. A DRE **não tem URL própria** |
| P3.2 | *"expandir as linhas"* | **AUSENTE na tela** | API pronta e verificada; **nenhum componente consome `/dre/drill`** |
| P3.3 | *"ver mais em detalhes cada parte que compõe"* | **AUSENTE na tela** | API entrega 4 níveis até o lançamento individual |
| P3.4 | *"tirar algo de um para outro"* | **AUSENTE na tela** | `GET/POST /dre/mover-categoria` pronta, com dry-run |
| P3.5 | *"adicionar algo"* | **recusado com motivo** | A rota declara: *"NÃO existe 'adicionar linha à DRE'. A DRE é DERIVADA… uma linha acrescentada sem lastro seria resultado inventado"*, e oferece `fin_dre_ajuste` em seção própria. **Recusa correta e bem argumentada** — mas ele ainda não foi informado disso |
| P3.6 | *"a realidade o feito é sempre o caixa"* | **existe** | `visao: "caixa"` é o padrão em `/gerencial/dre` e em `/dre/drill` |

### Agenda (#73, pedido da agenda diária)

| palavra dele | estado | onde (medido no fio) |
|---|---|---|
| *"por dia todo previsto"* | **existe** | 121 dias, 703 obrigações, calendário + lista densa |
| *"ver o passado, presente futuro"* | **existe** | Janela `2026-07-18 → 2026-11-15`, campo `tempo` por dia, "hoje" marcado, tecla `T` volta para hoje |
| *"buscar coisas"* | **existe** | `buscar em descrição e contraparte…`, `categoria (5.01)`, `de R$`/`até R$` |
| *"cadastrar como futuro de receitas ou custos"* | **existe** | `+ cadastrar futuro`; `POST /agenda/itens`; a tela diz *"criado #N — previsão, não caixa"* |
| *"organizar o q estiver errado"* | **existe** | `PATCH /agenda/itens/{direcao}/{id}`, e a tela escreve *"Corrigir aqui muda a **previsão**, nunca o caixa"* |
| *"ir item a item"* | **existe** | `← → anda um dia · shift uma semana · ↑ ↓ semana · T volta para hoje · Enter abre a lista · C confirma a seleção · Esc limpa` |

---

## 3. Os achados, por gravidade

### A1 · A tela de custos abre em R$ 0,00 no mês corrente — e é o mês que ele vai abrir

**Gravidade: alta.** É exatamente o erro que a régua da casa proíbe.

Medido, `GET /api/financeiro/gerencial/custos` (sem `?mes=`, que é como a tela
abre):

```
mes=2026-08   itens: 6   totalCents: 0   porCategoria: []   foraDaSomaCents: 511683
mes=2026-09   itens: 42  totalCents: 12253070   porCategoria: 5 grupos
```

A tela renderiza esse total com `<Medida rotulo="Custo previsto do mês"
valorCents={dados.totalCents} detalhe="0 linhas somam · uma por dinheiro" />`
(`FinCustos.tsx:480-484`). Como `totalCents` é `0` e não `null`, o componente
`Medida` desenha **"R$ 0,00"** — o caminho hachurado de `Certeza.tsx:84-90` só
dispara com `null`.

A resposta certa não é zero. É *"a projeção é uma curva que começa hoje, e 15
dias desta competência já passaram"* — frase que a **própria API já emite**, e
que a tela mostra **abaixo** do número (ver A2). O `Medida` tem o construtor
certo para isso: `valorCents: null` + `motivo`. Está sendo usado para
"Realizado" (`:505-510`) e não para o total.

Agravante: no mês corrente `porCategoria` volta `[]` mesmo com os 6 itens
carregando `categoriaId` — então P1.2 ("organizado categorizado") também some
justamente no mês que ele abre.

### A2 · A ressalva desce para baixo do número, contra a regra escrita no próprio componente

**Gravidade: alta**, porque é o padrão que o plano aprovado nomeia.

`Certeza.tsx` documenta o componente `Ressalva` com estas palavras:

> *"A ressalva que vem ANTES do número, não depois. […] Um rodapé explicando
> isso chega tarde — a pessoa já leu o número e formou opinião."*

Na tela de custos a ordem do JSX é a inversa:

```
FinCustos.tsx:479   <div className="medida-grade">   ← os números
FinCustos.tsx:534   </div>
FinCustos.tsx:536   {ressalvas.map(frase => <Ressalva>…</Ressalva>)}   ← a ressalva
```

Mesma inversão em `FinCategorizacao.tsx`: grade de `Medida` em `:800-822`,
`Ressalva` em `:824-830`.

**A agenda faz certo, e isso prova que não é limitação técnica.** No HTML
renderizado que capturei, o texto sai nesta ordem: *"Some SOMENTE as linhas com
entraNoTotal…"* → *"Entra no período R$ 530.816,24"*. A ressalva primeiro.

### A3 · A aba da agenda foi para a navegação com a migration pendente, e a tela deu 500

**Gravidade: média** (já resolvido em runtime, mas o padrão continua no código).

Medido às 02:55 UTC, com `0104` ainda pendente e a aba "Agenda" já no `FinShell`:

```
/financeiro/agenda                        admin → 500
/api/financeiro/gerencial/agenda          admin → 500
/api/financeiro/gerencial/agenda/series   admin → 500
/api/financeiro/gerencial/agenda/prova    admin → 500
```

Log do servidor: `error: relation "fin_agenda_dia_v" does not exist` (código
`42P01`). Depois que a frente aplicou a 0104, as mesmas cinco rotas passaram a
**200**.

O que fica como achado é o **comportamento na falta**: a tela não degrada, ela
estoura. A frente E1 resolveu o mesmo problema do jeito certo e está documentada
em `CONTINUACAO.md` §E1 — `/time` renderiza *"o app do time ainda não está de pé
neste ambiente"* e `/api/time/envios` devolve **503 com o motivo**. E o próprio
`FinShell.tsx:16-18` carrega o comentário: *"Só entram abas cuja página EXISTE.
Aba que leva a 404 ensina o usuário a não clicar."* A aba levou a um 500.

### A4 · A agenda mostra nomes de campo de JSON para quem é dono da empresa

**Gravidade: média.** É UX, e ele pediu *"ux e ui ultra foda, simplificada"*.

Texto que sai renderizado no topo da tela, antes dos números:

> *"Some SOMENTE as linhas com **entraNoTotal** = true. Duas linhas com a mesma
> **chaveDedupe** são o MESMO dinheiro visto por procedências diferentes…"*
>
> *"**saldoPrevistoCents** é NULL no passado por construção…"*

`entraNoTotal`, `chaveDedupe`, `saldoPrevistoCents`, `NULL` são vocabulário de
contrato de API. A causa é estrutural: a tela imprime `ressalvas[]` da resposta
literalmente (`FinAgenda.tsx` — mesmo padrão em `FinCustos.tsx:536`), e essas
frases foram escritas para quem consome a rota. As duas plateias precisam de
duas frases.

### A5 · "permitir tbm correções cadastros" não tem tela — e as rotas já existem

**Gravidade: média.** É verbo dele, textual, e está ausente.

A central de categorização edita **categoria** e mais nada. Núcleo e centro de
custo aparecem só como filtro. Enquanto isso, a migration 0103 entregou três
rotas de escrita — `POST /identificacao/contraparte`, `/identificacao/resolucao`,
`/identificacao/vinculo` — e o `grep` por consumidores em `app/` e `components/`
volta **vazio**. Trabalho pronto, sem porta.

### A6 · Criar categoria pode falhar em silêncio

**Gravidade: baixa**, mas é da família "a tela mente".

```
FinCategorizacao.tsx:318-331
  const r = await fetch(`${ROTA_PLANO}?incluirInativas=1`, …);
  if (!r.ok) return;          // ← nada é dito a ninguém
```

O comentário três linhas acima explica que este recarregamento existe *"porque a
lista de categorias do seletor de lote tem de refletir a categoria que a pessoa
acabou de criar"*. Se ele falhar, a pessoa criou a categoria, não vê erro, e o
seletor não a mostra — conclusão natural: "não salvou", e ela cria de novo. A
busca, na mesma tela, trata o erro certo (`:417-419`).

### A7 · "uma por dinheiro" é afirmado no topo e desmentido no meio da mesma tela

**Gravidade: baixa**, e é quase um elogio — porque quem desmente é a própria tela.

O total traz `detalhe="N linhas somam · uma por dinheiro"` (`FinCustos.tsx:483`).
Mas em setembro/2026 a API devolve, com ambos `entraNoTotal: true`:

```
Folha 09/2026 — Tallany              pagar_documento   R$ 2.200,00   01/09
Folha — Tallany                      pagar_folha       R$ 2.200,00   02/09
Folha 09/2026 — Denilson Ferreira    pagar_documento   R$ 2.100,00   01/09
Folha — Denilson Ferreira            pagar_folha       R$ 2.196,75   02/09
```

São ~R$ 4.300,00 possivelmente contados duas vezes em R$ 122.530,70 (3,5%). O
`chaveDedupe` não pega, porque as chaves são `fin_document:26341` e
`fin_person:103` — o mesmo dinheiro com duas identidades.

**E a tela trata isso melhor do que qualquer outra parte da base.**
`BlocoSobreposicao` (`FinCustos.tsx:662-725`) mostra o par lado a lado, quantifica
(*"se for o mesmo dinheiro, R$ X está contado duas vezes neste mês"*), explica por
que não corrigiu sozinha, e — o melhor pedaço — **declara o próprio ponto cego**:

> *"E o alerta não pega tudo. Ele casa por contraparte, então os documentos
> abaixo escapam dele por ter nascido sem contraparte identificada — ausência de
> selo aqui não é ausência do problema."*

Isso é a disciplina do §6 de `OBJETIVOS_METAS.md` ("o que este indicador NÃO
mede") virando interface. O achado é só a frase do topo: *"uma por dinheiro"*
promete uma dedução que a tela mesma refuta 400 pixels abaixo.

### A8 · `semCategoria` devolve mais do que o critério de aceite pede

**Gravidade: informativa.** Registro para ninguém "corrigir" por engano.

O critério de `ENTREGAVEL_CONSOLIDADO.md` §7 diz que o filtro deve devolver *"os
389 documentos, os lançamentos sem `category_id` e os 500 itens de cartão"*.
Medido:

```
API  ?semCategoria=1   →  729 lanç. + 389 doc. + 514 cartão = 1.632
SQL  category_id IS NULL → 492 lanç. + 389 doc. + 514 cartão
```

A diferença de 237 lançamentos é exatamente a população marcada `3.99`/`5.99`
(`CONTINUACAO.md` §4 mede os mesmos 237, R$ 112.492,54). A API está usando a
definição da casa — *"indeterminado = não há categoria utilizável (nula, 3.99 ou
5.99)"* (`CONTINUACAO.md` §13) — e está **certa**. Quem for auditar contra o
critério literal vai achar que sobrou; não sobrou.

### A9 · O que foi verificado e está sólido

Registro porque validação que só acha defeito não é validação.

- **A soma da DRE bate centavo a centavo nos quatro níveis.** Medido em
  `2026-07`: `despesas_pessoal` = −8.842.516 → 5 categorias somam −8.842.516 →
  `6.01 Salários` = −4.284.752 → 13 contrapartes somam −4.284.752 → Igor Dalton
  = −1.150.913 → 4 lançamentos individuais somam −1.150.913.
- **A regra de ouro fecha:** `residuoLedgerCents: 0`, `residuoSaldoCents: 0`,
  64 meses, 13.881 lançamentos, `itensCartaoNoCaixa: 0`.
- **A armadilha do gatilho de sinal é recusada antes de o gatilho apagar.**
  Dry-run real, `GET /dre/mover-categoria?ids=76070&categoriaId=1`:

  > *"sinal incompatível: 3.01 é categoria de RECEITA e este lançamento é uma
  > SAÍDA. Aceitar inflaria o faturamento e o imposto calculado sobre ele
  > (invariante D3)"*

  E o lote é tudo-ou-nada: *"com um recusado, nada é escrito."* Este era o risco
  nº 3 da minha lista de caça — a API não cai nele.
- **As telas leem a resposta da API antes de dizer que salvaram.**
  `FinAgenda.tsx:932` escreve `salvo: ${j.alterados.join(", ")}` — os campos que
  o servidor **diz** ter alterado. `FinCategorizacao.tsx:1292` exibe
  `travasEscritas`, que a rota produz relendo o banco depois do UPDATE. Nenhuma
  das três telas afirma sucesso a partir do próprio otimismo.
- **A lacuna viaja dentro do grupo, nunca em rodapé.** Em todos os meses medidos
  há um nó `Ledger sem categoria` como filho da própria seção
  (jan −20.055,10 · mar −12.414,20 · jun −7.935,12 · jul −18.258,23).

---

## 4. O que ele pediu e continua sem tela nenhuma

Conferi um a um os "esquecidos" que o `ENTREGAVEL_CONSOLIDADO.md` §2.3 listou.

**Já foram atendidos desde aquele documento:**

| # | pedido | onde está agora |
|---|---|---|
| **E1** | *"aplicativo web para o time cadastrar reembolsos, custos, enviar notas, pedidos de compra e enviar link de coisas pra comprar"* | **entregue** — `/time`, `/time/reembolso`, `/time/custo`, `/time/nota`, `/time/compra`, `/time/envios`. Medido: **200 para o perfil comum** |
| **E2** | *"notificações"* | **entregue** — `/notificacoes` e `/api/notificacoes`, 200 para o comum; sino no cabeçalho |

**Continuam sem tela:**

| id | pedido dele | estado medido |
|---|---|---|
| **P3** | *"DRE… expandir as linhas, ver mais em detalhes"* | **API completa, tela nenhuma.** É a reprovação deste documento |
| **0103** | *"identificar o que ta sem indentificação, o que esta duvido"* — lado do cadastro | 3 rotas de escrita, zero consumidores |
| **T04** | *"detalhatar todos custos de cartão… quanto tem a pagar para os proximos meses parcelados"* | sem `app/financeiro/cartoes` — contrato e rota prontos |
| **T06** | *"contas a pagar"* | sem página |
| **T07** | fila de pagamento | sem página — bloqueada pela dúvida 27, por desenho |
| **T11** | *"analise de qual melhor modelo real, presumido ou simples"* | sem página |
| **T13** | *"posso confiar neste número?"* — cobertura e auditoria | sem página. Os 41 invariantes e 24 monitores continuam só no terminal. É a tela que sustenta todas as outras |
| **E4** | *"tem tbm o que foi fechado no pipe mas ainda vai virar cobranças no asaas (**mostre isso tbm**)"* | `grep` por `pipeline` em `components/financeiro/` e `app/financeiro/`: **zero**. Ele pediu explicitamente para **ver**, e segue invisível |

E as **quatro ambiguidades** de `ENTREGAVEL_CONSOLIDADO.md` §2.1 seguem sem
resposta dele. Duas foram decididas de fato pelas frentes, e ele precisa saber:

- *"confirmar"* virou **leitura (A)**: marca de revisão que não move caixa. A
  rota é explícita — *"Não realiza. Não altera `fin_recurring`, `fin_document`
  nem `fin_transaction`"* — e a tela repete *"Confirmar não é realizar"*. É a
  leitura conservadora e correta, mas **não foi ele quem escolheu**.
- *"adicionar algo"* na DRE virou **recusa** (P3.5), com o argumento certo. Idem:
  decisão tomada, dono não avisado.

---

## 5. Veredito sobre os cinco princípios

### 01 · Número nenhum aparece sozinho — toda cifra carrega cobertura
**Cumprido na agenda. Violado no mês corrente da tela de custos.**

Cumprido, exemplo literal do HTML renderizado: *"Sai no período · R$ 345.336,21 ·
a previsão de saída cobre ~72% do que sai · **cobre 72 % · otimista por
construção**"*. A cobertura e o **viés** estão colados no número.

Violado: *"Custo previsto do mês · R$ 0,00 · 0 linhas somam · uma por dinheiro"*
não carrega cobertura nenhuma, e a frase que a daria está abaixo (A1 + A2).

### 02 · Ausência não é zero — indeterminado tem hachura e motivo
**Cumprido como tipo, furado num ponto.**

`Certeza.tsx` torna o erro difícil por construção: `MedidaProps` é uma união
onde `valorCents: null` **exige** `motivo`. Quem passar nulo sem motivo não
compila — e `tsc --noEmit` sai 0.

Na agenda o princípio aparece renderizado: o dia 9 diz **"sem lançamento"**, não
"R$ 0,00". Na tela de custos: *"Realizado nesta competência — indeterminado —
nenhum lançamento de saída nesta competência: ausência de dado, não zero"*.

O furo é A1: o total do mês corrente é um `0` numérico legítimo do ponto de vista
do tipo, e mentiroso do ponto de vista da pergunta.

### 03 · Camada não se soma sozinha
**Cumprido, e bem.**

- Agenda: *"Existe e NÃO soma · R$ 644.885,77 · 332 linha(s), cada uma com
  motivo"*, com `entraNoTotal` governando o total.
- Custos: `foraDaSomaCents` é uma `Medida` própria; cada grupo mostra *"+ R$ X
  que não soma"*; cada linha carrega `motivoForaDaSoma`.
- Categorização: a ressalva medida diz *"Os totais por universo NÃO se somam: o
  sinal de `fin_card_transaction` é de dívida e o de `fin_transaction` é de
  caixa"* — e a tela emite três `Medida` separadas, uma por universo, sem total.

A exceção conhecida é A7, e a própria tela a denuncia e a precifica.

### 04 · Decidir uma vez, aplicar ao grupo — e separar tamanho do problema do tamanho do trabalho
**Cumprido.**

O lote existe nas três telas com `aplicar:false` por padrão, `ids` explícitos e
recusa de lote por filtro (*"um lote por filtro seria `reclassificar.mjs
--conta=inter` com outra roupa"*).

A separação problema × trabalho aparece de forma exemplar na tela de custos, que
**parte o botão em dois**: *"Confirmar todos os N do mês"* (não muda o total) e
*"Confirmar os N que hoje não somam"* (*"Sobe o total do mês em R$ X"*). São dois
tamanhos de consequência, e viraram dois botões.

### 05 · A máquina prepara, a pessoa autoriza — nenhuma tela pode ter botão que paga
**Cumprido, sem exceção.**

Varri as telas novas atrás de qualquer verbo de execução. Não existe. E o que
existe diz o contrário, em texto que o usuário lê:

- `POST /custos/confirmar`: *"Não realiza. Não altera `fin_recurring`,
  `fin_document` nem `fin_transaction`."*
- Tela de custos: *"Confirmar não adianta o caixa — o item continua sendo
  previsão até existir lançamento."*
- Tela da agenda: *"Corrigir aqui muda a **previsão**, nunca o caixa: nenhum
  lançamento é criado, nenhum saldo muda"*; e ao criar, *"criado #N — previsão,
  não caixa"*.
- `POST /dre/mover-categoria`: *"Ela não move dinheiro. Move CLASSIFICAÇÃO."*

A fila de pagamento (T07) continua sem tela, o que mantém a promessa por
ausência além de por desenho.

---

## 6. O teste final do plano que ele aprovou

> *"Mostre a tela para alguém que não conhece a base e pergunte: 'quanto disso o
> sistema realmente sabe?' Se a pessoa precisar perguntar, a tela falhou."*

| tela | passa? |
|---|---|
| Agenda | **passa** — "cobre 72% · otimista por construção" e "existe e não soma R$ 644.885,77" respondem antes da pergunta |
| Custos (mês futuro) | **passa** |
| Custos (mês corrente) | **falha** — "R$ 0,00" faz a pessoa perguntar, e a resposta está abaixo da dobra |
| Categorização | **passa** — a tela diz quais populações estão fora da régua do painel |
| DRE | **não se aplica: não há tela** |

E o critério que ele escreveu para o fim do trabalho — *"se ainda faltar
qualquer regra de negócio, ingestão, conciliação, modelo, teste, API ou dado
alcançável pelas fontes existentes, não diga que falta apenas design"* — hoje
inverte-se pela primeira vez: **no território destas quatro telas, o que falta é
predominantemente design.** O dado, as views, as rotas, as travas e os testes da
DRE expansível estão prontos e medidos; o que não existe é a tela. Isso não vale
para T04, T06, T11, T13 e E4, que seguem sem página **e** sem prioridade
declarada.

---

## 7. O que eu recomendaria consertar primeiro

Por razão entre o que corrige e o que custa:

1. **A1+A2 juntos, na tela de custos.** Mover o bloco `<Ressalva>` para cima da
   `medida-grade` e trocar o total do mês corrente por `valorCents={null}` +
   `motivo` quando `diasForaDoHorizonte > 0 && totalCents === 0`. São duas
   edições pequenas na tela que mais gente vai abrir.
2. **A tela da DRE.** É a única reprovação, e é a de melhor razão valor/custo da
   lista inteira: banco, API, drill de 4 níveis, dry-run e travas já existem e
   estão verificados.
3. **A5** — dar porta às três rotas de identificação que já estão escritas.
4. **A4** — separar a ressalva do consumidor de API da ressalva do dono.
5. **T13, a tela de cobertura.** Continua sendo a tela que sustenta a confiança
   em todas as outras, e continua só no terminal.

---

## 8. Limites desta validação

Para quem for reconferir:

- **Custos, Categorização e Plano de contas não foram exercitados no navegador.**
  Chegaram ao disco depois do build que eu servia, e eu não podia rodar
  `build:app` sem travar as outras frentes. Tudo que afirmo sobre elas vem de
  leitura de código com linha citada, ou da API delas no fio.
- **Não exercitei nenhum POST de escrita.** As confirmações do que as rotas de
  escrita recusam vêm do dry-run por `GET` (`/dre/mover-categoria`), que é
  literalmente a mesma função de julgamento da aplicação, e da leitura das
  rotas.
- **Não rodei `test:categorizacao`, `test:agenda` nem `test:integridade`** —
  abrem transação longa e travariam quem está escrevendo agora.
- **A árvore mudou durante a validação.** Entre o início e o fim entraram
  4 commits, 1 migration aplicada, 2 páginas e 3 componentes. Um documento
  escrito 30 minutos depois deste pode divergir — e, nesta base, provavelmente
  vai.

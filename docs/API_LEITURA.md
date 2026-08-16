# A API de leitura gerencial — cada pergunta e a URL que a responde

Este documento existe para uma coisa só: **fechar a distância entre "o contrato
existe" e "a tela consegue chamá-lo"**. `CONTINUACAO.md` §11 já tinha escrito a
frase — *"contrato TypeScript não é endpoint"* — e ela ficou verdadeira por
semanas.

Medido em **16/08/2026**, sobre `codex/financeiro-conclusao-2026-08-16`:

```
contratos que devolvem Contrato<T> ....... 36   (+ getCobertura, que devolve o cru)
com rota de leitura .......................32
sem rota .................................. 5   território da frente de pagamentos
```

Todas vivem sob `app/api/financeiro/gerencial/**`. **Somente GET.** Nenhuma
escreve, nenhuma chama API externa.

---

## 1. O contrato de resposta — igual em todas as 32

O envelope viaja inteiro, sempre:

```jsonc
{
  "dominio":     "resultado",
  "disponivel":  true,
  "dado":        { /* o payload tipado do contrato */ },
  "cobertura":   [ /* Frescor[] — de que fonte veio e até quando cobre */ ],
  "frescorPior": { /* a fonte mais frágil: é ela que manda no selo da tela */ },
  "pendencias":  [ /* o que precisa de decisão humana, com telaDeDecisao */ ],
  "ressalvas":   [ /* as MEDIDAS primeiro, depois as fixas do contrato */ ],
  "medidoEm":    "2026-08-16T…"
}
```

| situação | status | corpo |
|---|---|---|
| tudo certo | **200** | envelope completo |
| `disponivel: false` (domínio sem dado, com diagnóstico) | **503** | envelope completo, motivo em `ressalvas` |
| banco financeiro fora do ar | **503** | `{erro, motivo}` |
| parâmetro malformado | **400** | `{erro, parametro}` |
| perfil não-admin | **404** | (não 403 — 403 confirmaria que a rota existe) |

Cabeçalhos em toda resposta: `Cache-Control: no-store`, `x-fin-dominio`,
`x-fin-disponivel`, `x-fin-frescor`, `x-fin-pendencias`. Os `x-fin-*` repetem em
ASCII o que já está no corpo, para quem monitora sem baixar 400 KB de DRE.

### As ressalvas medidas

As primeiras entradas de `ressalvas` são calculadas **na requisição**, a partir
do corpo que acabou de voltar. É onde a lacuna vira frase:

> *"A folha ainda não saiu em 2026-08 — o salário do mês é pago no dia 1º do mês
> seguinte. O resultado destes meses está OTIMISTA e vai piorar."*

Escrevê-las fixas dentro do contrato as congelaria num dia, e no dia seguinte a
frase seria falsa sem ninguém perceber.

---

## 2. As perguntas da §2 de `OBJETIVOS_METAS.md` → a URL

Prefixo omitido: **`/api/financeiro/gerencial`**.

### Sobre o dinheiro que entrou e saiu

| pergunta | URL | o que a resposta carrega além do número |
|---|---|---|
| Quanto tenho, agora, conta a conta? | `GET /bancos` | `fecha` e `emDia` separados; `fecha: null` nas contas sem cobertura declarada (F1); `lacunas[]` de período sem extrato |
| De onde veio cada real e para onde foi? | `GET /lancamentos` | `temLastro`, `endToEndId`, `porQue` (o rationale da classificação) |
| De qual contrato, e para qual finalidade? | `GET /contratos` · `GET /lancamentos?categoria=&nucleo=` | cobertura de contratos e os indeterminados nomeados |
| Sob responsabilidade de quem? | `GET /lancamentos?semContraparte=1` | as linhas em que o responsável não é conhecido |
| Qual receita por cliente e por tipo de serviço? | **`GET /receita/prioridade`** · `GET /receita/grupos` | curva ABC com `pctAcumulado` e `faixa` — **prioridade nº 3 do Fernando** |
| Qual custo por obra e por projeto? | `GET /margem` | `tesourariaCents` fora do custo, `indefinidoCents` à vista, e o teto de fonte de 1,1% declarado |

### Sobre o que vai acontecer

| pergunta | URL | além do número |
|---|---|---|
| Quanto entra nos próximos 90 dias, e com que certeza? | **`GET /previsao/recebimento`** | total **por camada**, nunca somado — as 5 camadas se sobrepõem |
| Quanto sai? | **`GET /previsao`** | a ressalva medida diz que a saída cobre ~71,7% do real |
| Em que dia o caixa aperta? | **`GET /previsao`** → `primeiraRuptura` | `horizonteConfiavelDias`: depois dele a linha é ausência de evento, não estabilidade |
| O que já está fechado e vai virar dinheiro? | `GET /previsao/recebimento?meses=` | `camada` + `certeza` por evento |
| O que foi vendido e não virou cobrança? | `GET /contratos?semCobranca=1` | — |
| Quanto está atrasado a receber? | **`GET /receber?apenasVencido=1`** | `aging` da carteira inteira como referência do recorte |

### Sobre o resultado

| pergunta | URL | além do número |
|---|---|---|
| Qual o resultado do mês? | **`GET /dre?visao=caixa\|competencia`** | `folhaDoMesJaPaga`, `lacunaLedgerCents`, `lacunaCartaoCents`, `lucroComLacunasCents`, `pctValorPresumido` |
| Quebrado por núcleo/cliente/centro de custo | `GET /dre/dimensao?dimensao=` | — |
| Como o caixa se moveu, mês a mês | **`GET /fluxo`** · `GET /fluxo/contas` | `residuoCents` e `fecha`: o teste da demonstração |
| O que a empresa tem e o que deve? | `GET /balanco` | 6 lacunas nomeadas |
| Orçado contra realizado | **`GET /orcamento`** | **75 linhas com `realizado.valorCents: null` e o motivo na linha** |
| Previsto contra realizado | ❌ **sem resposta** | `fin_projetado_realizado_v` compara contra planilha que não existe (dúvidas 37/38) |

### Sobre as pessoas

| pergunta | URL | além do número |
|---|---|---|
| Quanto custa a equipe, de verdade? | **`GET /pessoas`** · `GET /folha` | `folhaSemMeiCents` × `folhaTotalCents` lado a lado (dúvida 21) |
| Contratado bate com pago? | **`GET /pessoas`** → `divergenciaCents` | `Medida`: null é "não há pactuado", não "bate certinho" |
| Reembolsos | **`GET /reembolsos`** | `aprovadoNaoPagoCents` = dívida com o time que o *a pagar* não mostra |
| Os MEIs emitem nota? | ❌ **sem resposta** | não há repositório de documento de entrada |
| Comissão a receber por vendedor | `GET /comissao` | base `indeterminado`: 7 negócios, 7 bases diferentes |

### Sobre obrigações e controle

| pergunta | URL | além do número |
|---|---|---|
| Quanto de imposto, e o cálculo está coerente? | `GET /tributos/apuracao` | entrega o insumo e **declara que não calcula** |
| Simples, Presumido ou Real? | ❌ **sem resposta** | depende da dúvida 21 (Fator R) — migration 0081/0092 |
| Que pagamentos estão para sair, e quem aprovou? | ⏳ frente de pagamentos | os 5 contratos existem e compilam; a rota é daquela frente |
| **Posso confiar neste número?** | **`GET /cobertura`** | frescor por fonte, `fechaCaixa` por conta, `contasQueNaoFecham` |
| O que está travado esperando decisão? | **`GET /decisoes`** · **`GET /decisoes/itens?fila=`** | `quantidade` × `decisoesDistintas`, evidência com procedência |
| As invariantes valem agora? | **`GET /pendencias`** | verificação sobre o DADO, não teste de CI |
| Quem mudou o quê? | **`GET /auditoria`** | diff resolvido no servidor; `desfeitoEm` não apaga o evento |
| O caixa concilia com o gateway e com o ERP? | **`GET /bancos/conciliacao`** | `%` medido em R$, transferências suspeitas nomeadas |
| Cartão | **`GET /cartao`** | `lacunas[]` com escopo, valor e motivo; competência ≠ caixa |
| Reservas, aplicações e runway | **`GET /tesouraria`** | alvo de reserva **não** é dinheiro comprometido |
| A primeira tela | **`GET /executivo`** | `medida` nula com motivo, `confiavel`, `drill` por indicador |
| Recorrentes | `GET /recorrentes` | assinatura declarada × parcelamento |

**Em negrito: as rotas criadas nesta frente.**

---

## 3. As 32 rotas, por caminho

| # | rota | contrato | perfil |
|---|---|---|---|
| 1 | `GET /executivo` | `getVisaoExecutiva` | admin |
| 2 | `GET /cobertura` | `getCobertura` | admin |
| 3 | `GET /bancos` | `getBancos` | admin |
| 4 | `GET /bancos/conciliacao` | `getConciliacao` | admin |
| 5 | `GET /cartao` | `getCartao` | admin |
| 6 | `GET /tesouraria` | `getTesouraria` | admin |
| 7 | `GET /pessoas` | `getPessoas` | admin |
| 8 | `GET /reembolsos` | `getReembolsos` | admin |
| 9 | `GET /lancamentos` | `getLancamentos` | admin |
| 10 | `GET /lancamentos/opcoes` | `getOpcoesLancamentos` | admin |
| 11 | `GET /dre` | `getResultado` | admin |
| 12 | `GET /fluxo` | `getFluxoDeCaixa` | admin |
| 13 | `GET /orcamento` | `getOrcadoRealizado` | admin |
| 14 | `GET /margem` | `getMargemPorProjeto` | admin |
| 15 | `GET /receita/prioridade` | `getPrioridadeReceita` | admin |
| 16 | `GET /receber` | `getContasAReceber` | admin |
| 17 | `GET /pagar` | `getContasAPagar` | admin |
| 18 | `GET /previsao` | `getPrevisao` | admin |
| 19 | `GET /previsao/recebimento` | `getPrevisaoRecebimento` | admin |
| 20 | `GET /decisoes` | `getCaixaDeDecisoes` | admin |
| 21 | `GET /decisoes/itens?fila=` | `getItensDaFila` | admin |
| 22 | `GET /pendencias` | `getPendencias` | admin |
| 23 | `GET /auditoria` | `getAuditoria` | admin |
| 24 | `GET /balanco` | `getBalanco` | admin |
| 25 | `GET /comissao` | `getComissao` | admin |
| 26 | `GET /contratos` | `getContratosEParcelas` | admin |
| 27 | `GET /dre/dimensao` | `getDrePorDimensao` | admin |
| 28 | `GET /fluxo/contas` | `getFluxoPorConta` | admin |
| 29 | `GET /folha` | `getFolhaPrevisao` | admin |
| 30 | `GET /receita/grupos` | `getReceitaPorGrupo` | admin |
| 31 | `GET /recorrentes` | `getRecorrentes` | admin |
| 32 | `GET /tributos/apuracao` | `getApuracaoTributaria` | admin |

1–23 nasceram nesta frente; 24–32 já existiam.

**Perfil.** Não há checagem de perfil dentro das rotas, e isso é proposital:
`lib/auth/perfis.ts` marca o prefixo `/api/financeiro` inteiro como só-admin, e o
`middleware.ts` devolve **404** (não 403) para o perfil comum. Regra de acesso
repetida em dois lugares é regra que diverge — uma rota nova de financeiro nasce
protegida por cair sob o prefixo, sem ninguém precisar lembrar.

---

## 4. As 5 que continuam sem rota

`getFilaPagamento`, `getSolicitacao`, `getFilaCompra`, `getLotes`, `getAlcadas`.

Elas estão escritas, tipadas e compilando em `lib/financeiro/contratos/pagamentos.ts`.
Não foram expostas aqui **por coordenação, não por dificuldade**: o caminho
`/api/financeiro/pagamentos/*` pertence à frente de pagamentos, que está na mesma
árvore. Criá-las daqui arriscaria sobrescrever trabalho dela.

Caminhos sugeridos, para quando aquela frente as criar:

```
GET /api/financeiro/pagamentos                    getFilaPagamento
GET /api/financeiro/pagamentos/solicitacoes/[id]  getSolicitacao
GET /api/financeiro/pagamentos/compras            getFilaCompra
GET /api/financeiro/pagamentos/lotes              getLotes
GET /api/financeiro/pagamentos/alcadas            getAlcadas
```

O padrão a seguir é o mesmo: `rotaDeLeitura` + `responderContrato`,
`force-dynamic`, somente GET. **Nada nessas rotas paga** — `fin_approval_rule`
nasce vazia de propósito e o gatilho recusa aprovação sem régua (dúvida 27), de
modo que hoje `getAlcadas` devolve lista vazia e a fila fica travada. Isso é
desenho, não defeito, e a rota tem de transportar o motivo em vez de mostrar
"0 alçadas" como se fosse configuração pronta.

---

## 5. Como a lacuna chega à tela — três provas medidas

Colhidas contra o ledger real em 16/08/2026.

### `GET /orcamento?ano=2026` — ausência não é zero

```jsonc
"realizado": {
  "valorCents": null,
  "motivo": "escopo obras: realizado mora no ledger do erp-obras, não neste"
},
"consumoPct": null,
"disponivel": { "valorCents": null, "motivo": "escopo obras: …" }
```

75 de 75 linhas assim. Zero afirmaria "a meta não foi consumida, sobra tudo" — e
a tela desenharia orçamento livre que não existe.

### `GET /dre?visao=competencia&ano=2026` — a marca da folha

```
2026-07-01  folhaDoMesJaPaga = true
2026-08-01  folhaDoMesJaPaga = false   despesasPessoalCents = 0   margemLiquidaPct = 51,19
```

O mês corrente parece o melhor do ano porque a folha dele ainda não saiu. A
ressalva medida diz isso antes de qualquer número ser lido.

### `GET /previsao` — o buraco declarado

```
* A camada de SAÍDA cobre ~71,7% do que sai de verdade (migration 0079;
  o restante é a dúvida 34, ~R$ 43.059,77/mês sem camada). Esta curva é
  OTIMISTA por construção: o dia da ruptura tende a chegar antes.
* 4 camadas não entram no saldo previsto, somando R$ 236.281,12 — cada uma
  com o motivo em dado.camadas[].motivo.
```

---

## 6. Regras para quem acrescentar a próxima rota

- **Não achate o envelope.** Devolver só `dado` é escolher o número e descartar o
  motivo. É a mentira que este ledger foi construído para não contar.
- **`null` nunca vira `0` na tradução HTTP.** Se o contrato devolve `Medida` ou
  `null` com motivo, a rota transporta os dois campos.
- **Toda rota nova atualiza a contagem no cabeçalho de `http.ts`.** Foi um número
  não conferido lá que custou 27 rotas.
- **Somente GET.** Escrita tem fila, autor e auditoria, e mora em outra rota.
- **`force-dynamic` + `revalidate = 0`.** Um DRE servido de cache é um DRE de data
  desconhecida, e data desconhecida é pior que dado velho declarado.
- **Parâmetro malformado é 400**, com o nome do parâmetro. `NaN` que escorre até o
  SQL vira o ano errado com 200 OK.
- **Ressalva medida nomeia o que está incompleto.** "Há meses incompletos" é
  ruído; "a folha não saiu em 2026-08" é acionável.

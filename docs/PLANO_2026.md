# Plano 2026 — o que falta para a base fechar

Escopo decidido pelo Fernando em 15/08/2026: **o ano de 2026**. Histórico anterior
sai de cena — não é dívida, é fora de escopo.

Estado medido em 16/08/2026. Reveja rodando `node scripts/painel-financeiro.mjs`.

---

## Definição de pronto

A meta está atingida quando, **simultaneamente**:

| # | Condição | Hoje |
|---|---|---|
| 1 | Caixa fecha nas 6 contas | ✅ **feito** |
| 2 | Saldo igual ao da fonte externa em todas | ✅ **feito** |
| 3 | Extrato de todas as contas até D+1 | 🟡 nubank 1d · inter 2d · caixinhas 1d |
| 4 | Nenhum indicador de 2026 abaixo de 90% | ❌ **4 abaixo** |
| 5 | DRE, caixa previsto e margem por projeto saem de consulta | ❌ falta previsão |
| 6 | O indeterminado está marcado como tal, não escondido | ✅ **feito** |

### Os indicadores de 2026

| Indicador | Hoje | Falta | Frente |
|---|---|---|---|
| Centro de custo | **0,4%** | ~3.800 linhas | F2 → F5 |
| Contraparte | **44,1%** | 2.166 linhas | F1 + F2 |
| Revisão concluída | **83,1%** | 657 linhas | F4 |
| Núcleo | **85,7%** | ~170 linhas | consequência de F1–F3 |
| Categoria | 94,2% | — | ✅ |
| Transferência | 97,8% | — | ✅ |
| Lastro | **81,9%** | 703 linhas | F2 |

### O mapa do buraco, por conta (2026)

| Conta | Linhas | Sem lastro | Sem contraparte | Sem categoria | Sem projeto | A revisar |
|---|---|---|---|---|---|---|
| asaas | 2.285 | 0 | **1.762** | 69 | 2.285 | 69 |
| nubank | 854 | **703** | 251 | 28 | 823 | **461** |
| inter | 684 | 0 | 99 | **127** | 684 | 127 |
| nubank-caixinhas | 54 | 0 | 54 | 0 | 54 | 0 |

---

## As frentes

### F1 · Contraparte do Asaas — 1.762 linhas

**O maior buraco isolado.** 77% da conta Asaas de 2026 não sabe quem é a outra ponta.

O caminho existe e é exato, sem heurística:

```
fin_transaction.source_id  →  financialTransaction.paymentId
                           →  payment.customer
                           →  customer.cpfCnpj
                           →  fin_counterparty (por documento normalizado)
```

Os arquivos já estão sincronizados em `data/raw/asaas-*.json` (349 clientes).
`import-asaas.mjs` já cria contrapartes a partir dos clientes — o que falta é
**ligar a transação ao cliente**.

- **Move:** contraparte 44,1% → estimado 85%
- **Risco:** baixo. Só preenche vínculo; não move dinheiro.
- **Atenção:** as transações sem `paymentId` são taxas do Asaas (PAYMENT_FEE,
  INVOICE_FEE, MESSAGING). A contraparte delas é o próprio Asaas — decidir se
  ganham contraparte institucional ou seguem nulas.
- **Migration reservada:** `0051_fin_contraparte_asaas.sql`

### F2 · Nubank pelo Polp — 703 sem lastro, 251 sem contraparte, 823 sem projeto

O CSV nunca teve essa informação. O Polp entrega:

| Campo | Cobertura | Vira |
|---|---|---|
| `operation_type` | **100%** | `source_kind` |
| `payment_data.receiver.documentNumber` | 89% | contraparte |
| `payment_data.payer.documentNumber` | 93% | contraparte |
| `merchant.cnpj` + razão social | 50% | contraparte |
| `category` | 100% | sugestão (temos plano próprio) |

**Dois perigos conhecidos:**

1. **Bug de paginação.** Em `/investments` o Polp declara `meta.total=66`, devolve
   66 linhas mas só **62 distintas** — ordenação instável. Verificar se
   `/accounts/2588/transactions` tem o mesmo defeito **antes** de confiar em
   qualquer contagem. Deduplicar por `id` e comparar com `meta.total`.
2. **Identificadores não casam.** O CSV gerou UUID v4, a Polp usa v3 — interseção
   de 24 linhas em 865. O enriquecimento **tem de casar por data + valor**, e o
   ambíguo (mesmo dia, mesmo valor, duas linhas) fica indeterminado.

**Não existe `endToEndId`** no Polp — `referenceNumber` é null em 865/865. Só o
Inter tem.

- **Move:** lastro 81,9% → ~100% · contraparte · centro de custo
- **Risco:** médio (ambiguidade de casamento)
- **Migration reservada:** `0052_fin_nubank_lastro.sql`

### F3 · Inter — 127 sem categoria

A menor e mais direta. O lastro documental já existe (585 linhas com CNPJ das duas
pontas, feito na 0042). Com o documento, a categoria sai da pessoa/fornecedor.

**Atenção — trava ativa:** `reclassificar.mjs --conta=inter` **não pode rodar no
automático**. A regra 42 foi arquivada (0050), mas confira o efeito antes de
qualquer execução em lote sobre o Inter.

- **Move:** categoria · núcleo
- **Risco:** médio — é a conta com pagamento a pessoas.

### F4 · Fila de revisão — 657 linhas em 2026

461 no Nubank, 127 no Inter, 69 no Asaas. A base já existe: 52 regras,
`fin_classification_event`, e a tela de qualificação em grupo.

**A frente é de volume, não de inteligência.** Sugestão automática com aprovação
em lote, e regra confirmada uma vez passa a valer para o futuro.

- **Move:** revisão 83,1% → 90%+
- **Depende de:** F1 e F2 (contraparte reduz a fila sozinha)

### F5 · Centro de custo — o projeto em cada lançamento

O erp-obras carimba projeto em **63,6% do extrato de agosto**, e a curva sobe
(2,5% mai · 13,1% jun · 47,5% jul · 63,6% ago). Aqui são 31 linhas.

O espelho `erp_extrato_linha` já tem 112 com `projeto_id`, e os 20 centros de
custo já existem (`kind='projeto'`, `source='erp'`).

- **Move:** centro de custo 0,4% → 60%+ · margem por obra e por cliente
- **Depende de:** F2

### F6 · Recorrentes e orçamento

Duas tabelas que não existem: `fin_recurring` e `fin_budget_target`. O erp-obras
tem **124 metas por categoria** com periodicidade para espelhar.

- **Move:** projetado × realizado
- **Risco:** baixo

### F7 · Previsão diária de caixa

`fin_cash_forecast`: parcelas a receber + recorrentes + folha + faturas de cartão,
dia a dia. **É o teste final da base** — se o previsto não bate, a base não está boa.

- **Depende de:** F6, e de contratos/cartão (já feitos)

### F8 · Empréstimo Pronampe

Conta Caixa `12920000005783083433` é **conta-espelho de empréstimo**: tudo que
entra lá é amortização. Não deve virar conta de caixa (inventaria saldo) —
vira passivo com cronograma, e cada PIX vira parcela paga.

Dados provisórios: R$ 147.062,10 de principal, 5 anos. O Fernando passa os reais
depois. Enquanto isso, o cálculo fica marcado como estimativa.

- **Tabelas:** `fin_loan`, `fin_loan_installment`

### F9 · Telas — por último

Só depois que a base fechar e o previsto bater. Projeto Railway novo apontando
para o banco financeiro atual, sem migração de dado. **Projeto novo, não serviço
no mesmo** — `xpe-plataforma` e `erp-obras` já têm ambos um serviço `web`, e essa
colisão já derrubou produção uma vez.

---

## Ordem de execução

```
F1 (asaas contraparte) ──┐
                         ├──► F4 (fila de revisão) ──► F6 ──► F7 (previsão)
F2 (nubank polp) ──┬─────┘
                   └──► F5 (centro de custo)
F3 (inter categoria) ────┘

F8 (empréstimo) — independente, a qualquer momento
F9 (telas) — só no fim
```

F1 e F2 são paralelas e não se tocam: contas diferentes, migrations diferentes
(0051 e 0052).

---

## Pendências que dependem do Fernando

Não bloqueiam nenhuma frente acima — só limitam o acabamento.

| # | O quê | Efeito de não ter |
|---|---|---|
| 1 | Quem carrega cada um dos **11 cartões** | custo de cartão sem responsável |
| 2 | Conta contábil das **12 pessoas MEI** | entram na folha gerencial, mas sem conta fiscal |
| 3 | Dados reais do **Pronampe** | cronograma fica estimado |
| 4 | Extrato da conta **Caixa** | 5 pagamentos sem contra-perna |

Fora de escopo por decisão: movimentos Asaas de 2021–2023 (R$ 215.500), as 169
transferências pré-2026, e o histórico do Pronampe.

---

## Regras que não mudam

1. **Caixa é a validação máxima.** Nenhuma frente fecha se alguma conta deixou de
   fechar. Rode o painel antes e depois.
2. **"Fecha" ≠ "está em dia".** Verifique também a data do último lançamento.
3. **Sem evidência, não escolha.** Marque indeterminado e registre em
   `docs/DUVIDAS_FINANCEIRO.md` com as opções.
4. **erp-obras é somente leitura.** Sessão abre com
   `SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY`.
5. **APIs: somente GET.**
6. **Pagamento não tem desfazer.** Automatize a preparação, nunca a autorização.

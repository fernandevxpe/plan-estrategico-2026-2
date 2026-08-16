# Prompt de conclusão da base financeira

Prompt fornecido pelo Fernando em 16/08/2026 para dirigir as próximas sessões
até a base ficar pronta faltando só o design das telas. **Colar inteiro ao
iniciar a sessão**, junto com `docs/AGENTE_FINANCEIRO.md`.

## Antes de colar: correções de baseline

O prompt cita números que já não são o estado atual, ou que medem base
diferente. Ao usá-lo, valem estes:

| o prompt diz | o correto (16/08/2026) |
|---|---|
| HEAD `e8b562f` | HEAD é o commit que salvou o WIP dos agentes |
| centro de custo 0,3% | 0,3% em toda a base · **1,2% em 2026** |
| contraparte 37,6% | 37,6% em toda a base · **86,8% em 2026** |
| categoria 96,5% | infla: conta `5.99` "a classificar" como categorizada. **Real em 2026: 90,9%** |
| `0058` não rastreada | commitada |
| `secrets.zip` sem regra | já no `.gitignore` |

O Fernando decidiu que **o escopo é 2026**; o histórico anterior fica pendente
por decisão, não por dívida. Medir só na base inteira esconde isso.

E uma limitação de fonte que o prompt não sabia: **centro de custo não chega a
90%**. O erp-obras carimba projeto majoritariamente em movimento de tesouraria —
de 111 linhas com projeto, 69 são `movimentacao` e 50 delas são "Reserva de
caixa". Só 42 chegam à DRE. Decisão do Fernando: o que o Adryan não tiver fica
pendente.

## Estado do WIP — tratar como rascunho, não como pronto

`0056`, `0057` e `0058` estão commitadas e **não aplicadas**. Os dois agentes que
as escreveram foram encerrados por limite de sessão, e o último relato do agente
de previsão foi *"found real bugs in the local test, fixing"*. Elas foram
escritas contra um estado anterior à `0059`, que tirou 81 transferências próprias
da fila e mudou os números de base.

Antes de aplicar: dry-run de novo, conferir conflito com o que a `0059` já
classificou, e validar em transação com rollback.

## Sobre intervenção humana

Instrução do Fernando: **tudo que precisar de decisão dele vira tela** — com
notificação e UX que torne a decisão fácil, não formulário. O que couber em
pergunta objetiva vem por conversa, sempre com opções, enquanto o trabalho
independente continua.

Isso muda o desenho: as filas de indeterminado (`fin_a_classificar_v`,
`fin_contraparte_documento_conflito_v`, `erp_contrato_indeterminado_v`,
`erp_parcela_nota_sugestao_v`) não são relatório — são **as telas de decisão**,
e devem ser projetadas como tal.

---

<!-- A partir daqui, o prompt do Fernando, na íntegra. -->

Continue exatamente do estado atual deste repositório e trabalhe com autonomia até deixar toda a base financeira, contábil, bancária e gerencial 100% preparada, de modo que, ao final, falte somente o design/implementação visual das telas.

NÃO pare em planejamento, diagnóstico ou criação de migrations não aplicadas. Planejamento só conta como etapa intermediária. Você deve investigar, implementar, migrar, importar, conciliar, testar, medir, documentar e repetir o ciclo até atingir os critérios de conclusão deste prompt ou encontrar dependência factual realmente impossível de obter sem o Fernando.

Use múltiplos agentes especializados em paralelo, reaproveitando cada agente após concluir sua frente. O agente principal é responsável por integração, decisões arquiteturais, migrations, segurança, validação final e commits. Não permita que dois agentes editem simultaneamente os mesmos arquivos.

### Regras inegociáveis

1. Caixa é a validação máxima. Nenhuma frente está concluída se qualquer conta deixar de fechar.
2. "Conta fecha" e "conta está atualizada" são verificações diferentes: saldo reconstruído, saldo da fonte, cobertura do extrato, última atualização, lacunas entre períodos.
3. Não invente classificação, contraparte, projeto, responsável, imposto, titular de cartão, parcelamento ou conta bancária. Sem evidência: marcar indeterminado, registrar motivo e candidatos, manter em fila humana, seguir nas demais frentes.
4. O erp-obras é estritamente somente leitura (`SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY`, conferir com `SHOW transaction_read_only`).
5. APIs externas são somente GET. Nunca emitir cobrança, pagar, transferir, estornar, criar webhook ou alterar dados na fonte.
6. Nenhuma automação efetua pagamento. Preparar, aprovar, lotear, auditar — autorizar é humano.
7. Backup do ledger antes da primeira escrita estrutural da sessão.
8. Toda escrita em lote: dry-run, contagem e valor antes/depois, transação, idempotência, trilha de auditoria, reversão.
9. Não alterar migration já aplicada; corrigir com migration nova.
10. Nunca ler, descompactar, imprimir ou versionar `secrets.zip`.
11. Sem push/deploy sem autorização. Commits locais pequenos e coerentes, sim.
12. Não "corrigir" teste trocando número esperado sem determinar se o comportamento é que está errado.

### Frentes de agentes

- **A** — auditoria, integridade e classificação (fechar `0056`, fila de revisão, proveniência, `hits_count`, regras órfãs, classificação incompatível com o sinal).
- **B** — bancos, contas, investimentos, reservas e **cartões por emissor e subcartão**.
- **C** — pessoas, MEIs, salários, reembolsos e comissões.
- **D** — contratos, obras, consultorias, receitas, fornecedores e centros de custo.
- **E** — contas a pagar/receber, tesouraria, recorrentes e previsão.
- **F** — DRE, balanço, fluxo de caixa, competência e fechamento mensal.
- **G** — tributos: Simples × Presumido × Real, com fontes oficiais citadas e data de consulta.
- **H** — testes, APIs/view models, documentação e auditoria final.

### Cartões — hierarquia desejada

```
instituição/emissor
  └── conta ou linha de crédito
       ├── faturas consolidadas
       ├── subcartão físico
       ├── subcartão virtual/digital
       ├── subcartão adicional
       └── cartões históricos/reemitidos
            └── compras, estornos, parcelas e responsáveis
```

Nubank, Inter e outros emissores como contas de cartão distintas. Guardar
emissor, bandeira, tipo, últimos quatro dígitos, identificador da fonte,
titular, status, validade, primeira e última ocorrência, cartão anterior/posterior
em reemissão, núcleo e centro de custo padrão. **Não inventar limite por
subcartão quando a fonte só dá limite consolidado.** Troca de final no meio do
parcelamento não pode quebrar um plano em vários. Fatura pertence à linha de
crédito. Só o pagamento da fatura movimenta caixa; o custo vem dos itens na
competência.

### Domínios que a base precisa responder

Bancos e caixa · contas a pagar · contas a receber · pessoas · MEIs · reembolsos
· receitas (obras, consultorias, assinaturas, comissionamento, materiais) ·
custos e despesas (diretos, fixos, variáveis, CAPEX) · reservas e tesouraria ·
empréstimos · DRE mensal e por dimensão · balanço gerencial · fluxo de caixa ·
orçamento × realizado · previsão diária e mensal · tributos.

**`competence_date` está nula em 100% dos lançamentos.** Resolver o modelo de
competência com regras documentadas; não usar `posted_on` sem declarar que é
regime de caixa.

### Tributário

Comparar Simples, Presumido e Real com **fontes oficiais e primárias citadas
(URL, data de consulta, vigência)**. Nunca fabricar alíquota, CNAE, anexo, fator
R ou enquadramento. Recomendação é gerencial e sujeita a validação de contador.

### Definição de pronto

Contas inventariadas · caixa fecha conta a conta · saldo bate com a fonte ·
cobertura D+1 onde a fonte permite · nenhuma conta ausente como zero confiável ·
cartões por emissor/linha/subcartão · faturas conciliadas · tudo classificado ou
indeterminado explícito · a pagar e a receber completos · salários, MEIs,
reembolsos e comissões com histórico e previsão · receitas e custos separados ·
reservas, impostos, empréstimos modelados · DRE, balanço, fluxo e previsão
saindo do banco · orçamento × realizado · comparação tributária com memória de
cálculo · importadores idempotentes · testes e build passando · APIs prontas.

Comandos finais obrigatórios:

```
npm run db:migrate:status
node scripts/painel-financeiro.mjs
npm run test:integridade -- --strict
node scripts/test-financeiro.mjs
npm run build:app
```

### Bloqueios humanos

Não interromper tudo por uma dúvida. Fazer primeiro o que não depende dela. Para
cada ponto irredutível: provar que as fontes foram esgotadas, registrar impacto,
apresentar opções mutuamente exclusivas com recomendação, manter indeterminado,
seguir nas outras frentes. Entregar uma lista consolidada ordenada por impacto.

Conhecidos: titulares dos cartões · itemização do cartão Inter · dados reais do
Pronampe · extrato das contas Caixa · conta contábil dos MEIs · rateio de
contratos multisserviço · contratos de eixo AMBOS · parcelas vencidas sem
cobrança · rateio de custos comuns · competência contábil.

### Reporte final

O que foi implementado · números antes e depois · fontes externas que
confirmaram · testes que passaram · migrations aplicadas · commits criados · o
que permanece indeterminado · o que o Fernando precisa fornecer · confirmação
explícita sobre se falta apenas o design das telas.

**Se ainda faltar qualquer regra de negócio, ingestão, conciliação, modelo,
teste, API ou dado alcançável pelas fontes existentes, não dizer que falta
apenas design. Continuar executando.**

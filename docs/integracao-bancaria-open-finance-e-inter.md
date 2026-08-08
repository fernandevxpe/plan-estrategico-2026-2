# Automatizar a entrada dos extratos: Open Finance vs. API direta do Inter

**Para:** XP ENERGY SERVIÇOS DE MEDIÇÃO DE ENERGIA LTDA (XPE Tecnologia) — CNPJ 34.776.108/0001-92
**Data da pesquisa:** 08/08/2026
**Decisão a tomar:** como parar de baixar e subir CSV/OFX/PDF na mão.

---

## O problema, em números

| | |
|---|---|
| Contas que precisam entrar | 4 (Nubank PJ c/c, Nubank Caixinhas PJ, Inter PJ c/c, Caixa aplicação/empréstimo) |
| Contas já automáticas | 1 (Asaas, REST API, 100% da receita) |
| Faturamento | ~R$ 193 mil/mês (~R$ 2,3 mi/ano) |
| Quem faz a importação hoje | 1 pessoa, na mão |
| O que já existe pronto | Importador de arquivo + parsers Nubank CSV, Inter CSV, OFX, Nubank Caixinhas PDF |

O gargalo não é o software — é o passo humano de baixar o arquivo. Este documento avalia dois caminhos para eliminá-lo, e eles **não são excludentes**.

Um detalhe do que já está construído importa muito para a decisão. O contrato de parser em `lib/financeiro/parsers/types.ts` já prevê um campo `sourceId` descrito como *"Id estável da fonte quando o banco dá um... É a chave de idempotência CORRETA; o hash por chave natural é só o fallback"*. E `dedupeHash()` em `scripts/lib/fin-normalize.mjs` usa `sourceId` quando existe, caindo para `conta|data|valor|descrição|ocorrência` quando não existe. **Qualquer caminho que entregue um ID de transação estável se encaixa no que já existe sem reescrever nada.** Isso muda o custo de implementação dos dois caminhos abaixo, para menos.

---

# PARTE 1 — Open Finance Brasil (via agregador)

## 1.1 Participar direto do Open Finance está fora de questão

Sim, é verdade: participar diretamente exige ser instituição regulada.

A regulamentação vigente permite participação de *"instituições financeiras, instituições de pagamento e demais instituições autorizadas a funcionar pelo Banco Central do Brasil (art. 1º, Resolução Conjunta nº. 01/2020)"* — [openfinancebrasil.org.br/modelo-de-participacao](https://openfinancebrasil.org.br/modelo-de-participacao/). Uma consultoria de engenharia no Simples Nacional não é nenhuma dessas coisas.

Existe a figura da parceria (art. 36 da mesma resolução), mas ela funciona ao contrário do que seria útil aqui: quem contrata a parceria é a **instituição participante autorizada pelo BC**, que assume a responsabilidade regulatória pela empresa não autorizada — [mesma fonte](https://openfinancebrasil.org.br/modelo-de-participacao/). Ou seja, a XPE não "vira participante"; ela no máximo vira parceira contratada de alguém que já é. Na prática, isso é exatamente o que um agregador faz — e é por isso que o agregador existe.

Ser ITP (Iniciador de Transação de Pagamento) tampouco resolve: ITP é licença de **iniciação de pagamento**, não de leitura de extrato, e exige licença de Instituição de Pagamento junto ao BC com custo de capital e compliance — [dock.tech/blog/banking/itp-open-finance](https://dock.tech/fluid/blog/banking/itp-open-finance/).

E há o custo de certificação, que é o piso do piso: a certificação FAPI junto à OpenID Foundation custa **US$ 1.000 por deployment para membros e US$ 5.000 para não-membros** — [openid.net/certification/fees](https://openid.net/certification/fees/). Isso antes de qualquer coisa relacionada a autorização no BC, capital mínimo, diretor responsável, auditoria ou o esforço de engenharia de implementar e manter conformidade.

**Conclusão:** caminho direto descartado. A única forma realista de consumir Open Finance aqui é comprar de um agregador.

## 1.2 O mercado de agregadores — o que dá para verificar de preço

Preço é onde este mercado é mais opaco. Segue o que tem número público e o que não tem.

| Fornecedor | Preço | Fonte | Verificado? |
|---|---|---|---|
| **Pluggy** | Mínimo **R$ 2.500/mês** (produto "Dados"). Pagamentos é outro mínimo, R$ 500/mês, cobrado à parte. Sem taxa de setup mencionada. Excedente por requisição, valor não publicado. | [pluggy.ai/precos](https://www.pluggy.ai/precos) | ✅ Sim, preço público |
| **Belvo** | Plano "Launch" **US$ 1.000/mês** (público). Plano "Growth": sob consulta. Sandbox grátis, só teste. | [belvo.com/plans-and-pricing](https://belvo.com/plans-and-pricing/) | ✅ Sim, preço público |
| **TecnoSpeed PlugBank** | **R$ 1.500 de entrada + R$ 540/mês** | Relato de desenvolvedor no [TabNews](https://www.tabnews.com.br/GuilhermeVieira/estou-desenvolvendo-um-app-de-financas-pessoais-e-nao-consigo-pagar-o-open-finance-pluggy-r2-5k-mes-belvo-r6k-mes-tecnospeed-r1-5k-de-entrada-r540). A [página oficial](https://tecnospeed.com.br/en/plugbank/open-finance-api/) não publica preço. | ⚠️ **Não oficial** |
| **Banco MCP** (revenda que roda sobre a Pluggy) | **R$ 49,90/mês** com 5 contas conectadas, **+ R$ 9,90** por conta adicional. Teste 14 dias. | [TabNews — relato de uso em produção](https://www.tabnews.com.br/GuilhermeVieira/resolvi-o-problema-do-open-finance-caro-que-postei-aqui-achei-uma-alternativa-e-ja-esta-em-producao) | ⚠️ **Não oficial** |
| **Klavi** | Nenhum preço público encontrado. | [klavi.ai](https://klavi.ai/) | ❌ Não verificado |
| **Celcoin / Finansystech** | Diz cobrar por transação, sem taxa de setup, sandbox grátis — **sem nenhum número divulgado**. | [celcoin.com.br/articles/como-usar-apis-open-finance](https://celcoin.com.br/articles/como-usar-apis-open-finance/) | ❌ Não verificado |
| **Quanto** | Nenhum preço nem material técnico atual encontrado nesta pesquisa. | — | ❌ Não verificado |

**A armadilha do "Meu Pluggy grátis".** A Pluggy tem um produto gratuito — o Meu Pluggy, com o "Conector 200" — que dá acesso via API aos dados que você mesmo conectou, *"gratuitos por tempo indeterminado, sem prazo de expiração"*. Mas os termos são explícitos ao responder se serve para empresa: *"Não. Uso comercial exige o plano pago da Pluggy."* — [pluggy.ai/meu-pluggy](https://www.pluggy.ai/meu-pluggy). Alimentar o painel financeiro de uma empresa de R$ 2,3 mi/ano com o plano de uso pessoal é risco contratual, não economia. **Não recomendo.**

## 1.3 A pergunta crítica: Open Finance expõe conta PJ?

**Sim — mas a resposta honesta tem uma data colada nela.**

Cobertura confirmada. A Pluggy publica quais instituições atende via Open Finance regulado e em que contextos (Personal / Business / Investments). **Nubank, Banco Inter e Caixa Econômica Federal aparecem os três com contexto Business** e com Accounts, Transactions, Credit Cards, Investments e Investment Transactions — [docs.pluggy.ai/docs/open-finance-institutions-coverage](https://docs.pluggy.ai/docs/open-finance-institutions-coverage). Os três bancos da XPE, portanto, existem no papel.

Mas a jornada PJ é **novíssima**. O piloto da versão JSR 2.2.0, que estendeu a jornada ao segmento PJ e ao desktop, rodou de **6 de fevereiro a 21 de abril de 2026**, e a oferta só foi liberada para o público geral **a partir de 22 de abril de 2026** — [pluggy.ai/blog/open-finance-2026-novidades](https://www.pluggy.ai/blog/open-finance-2026-novidades). Isso foi há três meses e meio. Nubank, Inter e Caixa estavam entre os 20 participantes do piloto.

E a adoção PJ é marginal. Em abril de 2025 havia cerca de **589 mil empresas** conectadas ao Open Finance — **3% das mais de 20 milhões de empresas ativas** no Brasil — e **99% dos consentimentos ativos do país são de CPF** ([mesma fonte](https://www.pluggy.ai/blog/open-finance-2026-novidades)). A própria Pluggy escreve que *"a jornada PJ ainda está evoluindo"* e que o BC colocou a melhoria dessa jornada na agenda regulatória 2025-2026 — [pluggy.ai/blog/open-finance-para-empresas](https://www.pluggy.ai/blog/open-finance-para-empresas).

**O que trava PJ: múltipla alçada.** Quando a empresa exige mais de um representante para autorizar, o consentimento precisa passar por cada um, e não há padrão entre bancos — cada instituição resolve do seu jeito ([TI Inside, 23/01/2026, via busca](https://tiinside.com.br/23/01/2026/jornada-de-consentimento-ainda-limita-adesao-das-empresas-ao-open-finance-no-brasil/)). A especificação prevê isso explicitamente: consentimento autorizado mas pendente de múltipla alçada devolve `200` com recurso em `PENDING_AUTHORISATION`, a conta **não** aparece na listagem, e os dados retornam `403 FORBIDDEN` — [Orientações [DC] Contas, Open Finance Brasil](https://openfinancebrasil.atlassian.net/wiki/spaces/OF/pages/1739096252/Orienta+es+-+DC+Contas).

**Aqui isso é uma boa notícia para a XPE.** Empresa pequena, quadro societário simples: se o contrato social permitir que um único representante autorize sozinho, o principal obstáculo do Open Finance PJ não se aplica. Vale conferir o contrato social antes de decidir.

## 1.4 Caixinhas do Nubank: aparecem?

**Sim, estão explicitamente no escopo.** A especificação da API de Contas diz:

> *"Está no escopo de compartilhamento da API Contas: Reservas sem rendimento, como forma se separar dinheiro para gasto futuro, e Reservas com rendimento, mas não atreladas a um investimento associado ao CPF/CNPJ do cliente. Como exemplos de nomenclatura para reserva, temos: caixinhas, cofrinhos, saldo separado."*
> — [Orientações [DC] Contas](https://openfinancebrasil.atlassian.net/wiki/spaces/OF/pages/1739096252/Orienta+es+-+DC+Contas)

Três detalhes práticos, da mesma fonte:

1. O endpoint é `GET /accounts/{accountId}/reserved-balances`, e **reserva de saldo está no mesmo agrupamento de permissões que saldo** — quem consente saldo já consente reserva. Não é um consentimento extra.
2. É um endpoint de **saldo**, não de extrato. Você recebe o valor parado em cada caixinha (com um item por faixa de remuneração, se houver mais de uma), **não** o histórico de movimentação dela. As movimentações entre conta e caixinha aparecem no extrato normal como tipo `TRANSFERÊNCIA SALDOS RESERVADOS` — que, aliás, é um dos tipos **dispensados** de informar contraparte.
3. Reservas atreladas a um investimento no CPF/CNPJ do cliente saem pelas APIs de Investimentos, não por essa.

Ou seja: os R$ 59.001,05 das Caixinhas em julho/26 **entrariam como saldo automático**. O extrato PDF das Caixinhas que hoje é importado na mão continuaria sendo a única fonte do detalhe de movimentação, se esse detalhe importar.

**⚠️ Não verificado:** se a Pluggy (ou qualquer outro agregador) efetivamente expõe o campo `reserved-balances` na API dela. A especificação do Open Finance obriga o banco a publicar; se o agregador repassa é outra pergunta, e não achei documentação de nenhum deles sobre isso.

## 1.5 Qualidade do dado

**ID de transação — bom, com uma ressalva séria para PJ.** O `transactionId` é obrigatório em D0 para todos os tipos de transação. A imutabilidade é imediata (D0) para TED, PIX, transferência mesma instituição, tarifa avulsa e folha de pagamento; e só em **D+1** para boleto, DOC, convênio, depósito, saque, cartão, juros, rendimento, resgate e "outros". Enquanto está pendente, o banco pode usar o identificador coringa `0000000000` para todas as transações não confirmadas — [Orientações [DC] Contas](https://openfinancebrasil.atlassian.net/wiki/spaces/OF/pages/1739096252/Orienta+es+-+DC+Contas).

A ressalva é literalmente sobre PJ:

> *"Existem situações, principalmente para clientes Pessoa Jurídica, nas quais as transações são lançadas de forma individual (múltiplas transações) em D0 e em D+1 são consolidadas em um único lançamento... em D+1 é efetuado lançamento único com um novo transactionID."*

Traduzindo para o que isso custa: **um mesmo fato econômico pode aparecer hoje como 5 lançamentos com 5 IDs e amanhã como 1 lançamento com um 6º ID.** A idempotência por `sourceId` continua correta (não duplica), mas o importador precisa saber **apagar** os lançamentos provisórios que sumiram, senão o ledger infla. Isso é trabalho de reconciliação que o caminho do arquivo hoje não tem.

**Outros campos.** Contraparte (CPF/CNPJ) é obrigatória desde 02/05/2023 pela IN BCB nº 371 para TED, PIX, transferência mesma instituição, boleto e folha — dispensada para tarifas, saque, DOC, rendimento e resgate. Na camada da Pluggy, o objeto de transação traz `id` (UUID estável), `amount`, `date`, `description` + `descriptionRaw`, **`balance` (saldo após o lançamento)**, `paymentData.payer` / `paymentData.receiver` com nome e documento, `merchant` com CNPJ e CNAE, `category` e `providerId` (esse último só em conectores Open Finance) — [docs.pluggy.ai/reference/transactions-retrieve](https://docs.pluggy.ai/reference/transactions-retrieve).

**Histórico e frescor.** 12 meses na primeira conexão; nas atualizações seguintes, os últimos 7 dias. A especificação esclarece que "12 meses" significa ano civil (365/366 dias) — [Orientações [DC] Contas](https://openfinancebrasil.atlassian.net/wiki/spaces/OF/pages/1739096252/Orienta+es+-+DC+Contas).

**O limite operacional que ninguém menciona na venda.** O Open Finance impõe teto **por CNPJ, por instituição, por mês** — não por cliente do agregador:

| O que você quer | Teto mensal |
|---|---|
| Transações **não recentes** (7 a 365 dias) | **4 requisições/mês** |
| Transações recentes (1 a 6 dias) | 240/mês |
| Saldo da conta | 420/mês |
| Lista e detalhe de contas | 4/mês |

— [docs.pluggy.ai/docs/rate-limits-of](https://docs.pluggy.ai/docs/rate-limits-of)

Duas consequências. Primeira: **você só pode puxar histórico profundo 4 vezes por mês, por banco.** Errou o backfill, esperou o mês virar. Segunda, mais perigosa: como o teto é por CNPJ e instituição, ele é **compartilhado com qualquer outra plataforma** que a XPE já tenha conectado ao mesmo banco (um contador, um ERP). Estourou, o item volta com status `PARTIAL_SUCCESS` e aviso `423`.

## 1.6 Consentimento: melhor do que a fama

Essa era a maior objeção operacional ao Open Finance, e ela **caiu**. Desde 15/04/2024 o consentimento pode durar por **tempo indeterminado** — o teto de 12 meses acabou — e a renovação, quando existe, é feita dentro do ambiente da instituição receptora, **sem redirecionamento** para o banco — [InfoMoney](https://www.infomoney.com.br/minhas-financas/open-finance-liberacao-de-dados-por-cliente-vai-durar-por-tempo-indeterminado/) e [Celcoin](https://www.celcoin.com.br/news/open-finance-tem-novos-prazos-de-consentimento-e-renovacoes/), a partir da Resolução Conjunta nº 7.

Mas atenção ao que continua verdade: prazo indeterminado é uma **possibilidade** oferecida pela instituição transmissora, não uma obrigação — cada banco decide o que oferece. E quando o consentimento é revogado ou expira, *"o access token associado ao mesmo é invalidado"* e tudo passa a devolver `401` — [Orientações [DC] Contas](https://openfinancebrasil.atlassian.net/wiki/spaces/OF/pages/1739096252/Orienta+es+-+DC+Contas). Ou seja: a integração para de funcionar em silêncio, e alguém precisa perceber. Custo operacional residual: baixo, não zero.

## 1.7 Veredito da Parte 1

| Pergunta | Resposta |
|---|---|
| **O que é preciso?** | Contratar um agregador (CNPJ, contrato, onboarding de compliance). Implementar cliente REST + webhook + tela de consentimento. Autorizar cada banco pelo fluxo OAuth do próprio banco. |
| **Quanto custa?** | R$ 2.500/mês (Pluggy) ou US$ 1.000/mês (Belvo) como piso verificado. Alternativas mais baratas existem mas não têm preço oficial publicado. |
| **Quanto tempo leva?** | 3 a 5 dias de desenvolvimento + tempo comercial/contratual do fornecedor (não estimável por mim). |
| **O que pode dar errado?** | Jornada PJ com 3 meses de vida; múltipla alçada pode travar o consentimento; teto de 4 chamadas/mês para histórico; consolidação D0→D+1 exige lógica de remoção de lançamentos provisórios; consentimento revogado derruba tudo silenciosamente. |
| **Vale a pena?** | **Não neste preço, ainda.** R$ 2.500/mês = R$ 30 mil/ano = **1,3% do faturamento** para automatizar 3 uploads por mês. Ver recomendação final. |

---

# PARTE 2 — API direta do Banco Inter PJ

## 2.1 O que existe

O Inter tem portal de desenvolvedor público em [developers.inter.co](https://developers.inter.co/) com quatro famílias: **Cobrança** (boleto com Pix), **Banking** (extrato, saldo, pagamentos), **Pix** (cash-in/cash-out, cobranças) e **Webhooks**.

Duas condições de elegibilidade, ambas confirmadas: as APIs são **exclusivas para clientes PJ** — PF e MEI não têm acesso — e o certificado **expira em 1 ano**, exigindo renovação — [ajuda.inter.co](https://ajuda.inter.co/conta-digital-pessoa-juridica/o-inter-disponibiliza-alguma-api-para-minha-conta-digital-pj). A XPE é PJ com conta corrente no Inter: elegível.

## 2.2 O que o cliente precisa fazer — passo a passo

Este é o roteiro concreto, e é curto.

1. Entrar no **Internet Banking PJ** do Inter (login por QR Code).
2. Ir em **Soluções para sua empresa → Nova Integração**. (Em algumas versões da interface o caminho é **Integrar → Configurações avançadas → Nova integração** — [suporte.machine.global](https://suporte.machine.global/hc/pt-br/articles/30867546394395-Como-criar-uma-integra%C3%A7%C3%A3o-com-o-Banco-Inter).)
3. Dar **nome** e **descrição** à integração.
4. Selecionar a conta corrente que a integração pode acessar.
5. Expandir **"API Banking"** e marcar **somente** o escopo **"Consultar extrato e saldo"**.
   ⚠️ A Conta Azul avisa que marcar permissões além dessa **faz a integração falhar** — [ajuda.contaazul.com](https://ajuda.contaazul.com/hc/pt-br/articles/9044458910093-Integra%C3%A7%C3%A3o-banc%C3%A1ria-autom%C3%A1tica-com-Inter-cadastrar-uma-nova-API). Só marque outros escopos se forem realmente necessários.
6. Confirmar com o **código SMS de 6 dígitos** — [finbits.com.br](https://www.finbits.com.br/central-de-ajuda/banco-inter-empresas).
7. Aguardar o status sair de "Em validação" para **"Ativo"** (alguns minutos, com e-mail de confirmação).
8. Em **Minhas integrações → Ações → Detalhar**, baixar o ZIP e guardar os **4 segredos**:
   - `Inter API_Certificado.crt`
   - `Inter API_Chave.key`
   - `Client ID`
   - `Client Secret`

**Validade do certificado: 12 meses.** *"Após um ano de integração bancária, você deve gerar um novo certificado"* — [Conta Azul](https://ajuda.contaazul.com/hc/pt-br/articles/9044458910093-Integra%C3%A7%C3%A3o-banc%C3%A1ria-autom%C3%A1tica-com-Inter-cadastrar-uma-nova-API). Isso é uma tarefa de calendário anual: se ninguém renovar, a sincronização morre.

**Custo:** nenhuma fonte — nem o Inter, nem Conta Azul, Omie, Finbits ou Machine — menciona cobrança, taxa ou plano mínimo para a API Banking. A página comercial do Inter fala genericamente em *"taxas competitivas"* sem números — [inter.co/empresas/api-banking](https://inter.co/empresas/api-banking/). **Trato como provavelmente gratuito, mas não confirmado.** Confirme com o gerente antes de contar com isso.

## 2.3 Autenticação

`POST https://cdpj.partners.bancointer.com.br/oauth/v2/token`

- **grant_type:** `client_credentials` — perfeito para job de servidor, sem usuário na tela
- **scope:** `extrato.read`
- **Transporte:** mTLS obrigatório, com o `.crt` e o `.key` da integração
- **Validade do token:** *"O token tem validade de 60 minutos e deverá ser reutilizado nas requisições"*
- **Sandbox:** `https://cdpj-sandbox.partners.uatinter.co` — dados fictícios, serve só para validar o formato da requisição

Fontes: [documentação da API Banking (divulgueregional/api-inter-v2)](https://github.com/divulgueregional/api-inter-v2) e a URL de token confirmada em [coleção pública do Postman](https://www.postman.com/marlosoliveira/varejofacil/request/oav2pj4/https-cdpj-partners-bancointer-com-br-oauth-v2-token).

*Nota de método: o portal do Inter é uma aplicação JavaScript que não entrega conteúdo a leitores automatizados, e a especificação OpenAPI não está exposta em URL pública. Os detalhes de endpoint e campos abaixo vêm de bibliotecas open-source em produção que documentam escopos, limites e respostas literais da API. São consistentes entre si e com a documentação dos ERPs, mas **não são a fonte oficial** — confirme no portal ao implementar.*

## 2.4 Os endpoints

| Endpoint | O que faz |
|---|---|
| `GET /banking/v2/saldo` | Saldo. Sem data, devolve disponível, bloqueado em cheque, bloqueado judicial, bloqueado administrativo e limite. Com data, só o disponível daquele dia. |
| `GET /banking/v2/extrato` | Extrato simples. **Sem ID de transação.** |
| `GET /banking/v2/extrato/completo` | Extrato enriquecido. **Com ID de transação.** ← é este que interessa |
| `GET /banking/v2/extrato/exportar` | O mesmo extrato em PDF |
| `POST /banking/v2/webhooks/{tipo}` | Webhooks — **só** `pix-pagamento` e `boleto-pagamento` |

**Limites, iguais para todos os endpoints de extrato:**
- **Máximo de 90 dias** entre `dataInicio` e `dataFim`
- **10 chamadas por minuto**
- Header `x-conta-corrente` só é necessário se a aplicação estiver ligada a mais de uma conta

**Paginação (só no `/completo`):** `pagina` (inteiro ≥ 0, padrão 0) e `tamanhoPagina` (máximo **10.000**, padrão 50). A resposta traz `totalPaginas`, `totalElementos`, `ultimaPagina`, `primeiraPagina` e `numeroDeElementos`. Com `tamanhoPagina=10000`, o volume da XPE cabe numa página só. Ainda dá para filtrar por `tipoOperacao` (`D`/`C`) e `tipoTransacao` (PIX, TRANSFERENCIA, PAGAMENTO, BOLETO_COBRANCA, INVESTIMENTO, CAMBIO, ESTORNO, OUTROS).

## 2.5 A diferença que decide tudo: `/extrato` vs `/extrato/completo`

O extrato **simples** devolve por transação: `dataEntrada`, `tipoTransacao`, `tipoOperacao`, `valor`, `titulo`, `descricao`, `cpmf`. **Não há identificador.** Idempotência seria heurística — o mesmo hash por chave natural que o importador de CSV já usa.

O extrato **completo** devolve tudo isso **mais**:

- **`idTransacao`** ← o identificador estável
- `dataInclusao` e `dataTransacao`
- `detalhes`, um objeto tipado conforme o tipo da transação:
  - **PIX:** `endToEndId`, `txId`, `nomePagador`, `cpfCnpjPagador`, `nomeRecebedor`, `cpfCnpjRecebedor`, `chavePixRecebedor`, `agenciaRecebedor`, `descricaoPix`
  - **Boleto de cobrança:** `nossoNumero`, `seuNumero`, `codBarras`, `nome`, `cpfCnpj`, `dataVencimento`, `juros`, `multa`, descontos
  - **Transferência:** `idTransferencia`, dados bancários e documento de pagador e recebedor
  - **Pagamento:** `autenticacao`, `linhaDigitavel`, `codigoReceita`, `nomeDestinatario`, `empresaEmissora`

Fonte: [estruturas de resposta em `interbank-go/banking/extrato_types.go`](https://github.com/raniellyferreira/interbank-go/blob/master/banking/extrato_types.go), consistentes com a [documentação de parâmetros](https://github.com/divulgueregional/api-inter-v2).

**Por que isso é importante para esta empresa.** `idTransacao` vai direto no campo `sourceId` do `ParsedRow` que já existe. `dedupeHash()` passa a usar `conta|id:idTransacao` em vez do hash por descrição. **A idempotência vira exata, não heurística** — desaparece a classe de bug em que dois pagamentos idênticos no mesmo dia viram um só, ou em que reimportar duplica lançamento. E o `cpfCnpjPagador` / `cpfCnpjRecebedor` do PIX dá casamento por documento com o CRM, que o CSV nunca deu.

O `saldo` do endpoint de saldo alimenta o `declaredBalanceCents` do `ParseResult` — a conferência de saldo que já existe hoje, que pega linha faltando antes do dado envenenar o ledger, **continua funcionando sem alteração**.

**Sem webhook de extrato.** Os webhooks do Inter cobrem só `pix-pagamento` e `boleto-pagamento`. **Não existe notificação de lançamento em conta** — a sincronização é obrigatoriamente por polling. Com 10 chamadas/min de teto, rodar de hora em hora ou 3x/dia é folgado.

## 2.6 mTLS no Node 22 — sem dependência nova

Uma armadilha técnica que vale registrar: o `fetch` nativo do Node é implementado sobre o undici e **ignora `https.Agent`**. Configurar mTLS no `fetch` global exigiria importar o pacote `undici` — dependência nova, indesejada aqui.

A solução sem dependência é usar o módulo embutido `node:https` diretamente, que aceita `cert` e `key` nativamente:

```js
import { request } from "node:https";

const agentOptions = {
  cert: Buffer.from(process.env.INTER_CERT_B64, "base64"),
  key: Buffer.from(process.env.INTER_KEY_B64, "base64"),
};
```

Um wrapper de ~30 linhas envolvendo `https.request` numa Promise resolve os dois endpoints necessários (token e extrato). Zero pacotes novos.

**Armazenamento no Railway: variável de ambiente com base64.** É o caminho certo, por três motivos: (1) o `.crt` e o `.key` são multilinha e base64 elimina o risco de quebra de linha corrompida; (2) o volume do serviço `web` é hidratado a partir do Postgres a cada boot conforme `docs/ARMAZENAMENTO-RAILWAY.md` — é cache de artefatos, **não lugar para segredo**; (3) variável de ambiente já é como `DATABASE_URL` é tratada no projeto. São 4 variáveis: `INTER_CERT_B64`, `INTER_KEY_B64`, `INTER_CLIENT_ID`, `INTER_CLIENT_SECRET`.

## 2.7 Veredito da Parte 2

| Pergunta | Resposta |
|---|---|
| **O que é preciso?** | O dono cria a integração no IB do Inter (~15 min) e me passa 4 segredos. Eu escrevo um adapter que reusa todo o pipeline existente. |
| **Quanto custa?** | **R$ 0/mês** — nenhuma fonte menciona cobrança. **Não confirmado oficialmente.** |
| **Quanto tempo leva?** | 1 a 2 dias de desenvolvimento. Sandbox disponível para testar antes de mexer em produção. |
| **O que pode dar errado?** | Certificado expira em 12 meses e derruba a sincronização se ninguém renovar. Sem webhook de extrato — polling obrigatório. Sem OpenAPI pública, alguns campos podem divergir do que documentei. Resolve **1 conta das 4**. |
| **Vale a pena?** | **Sim, sem discussão.** Custo recorrente zero, esforço de 1-2 dias, idempotência exata e reuso total do que já existe. |

---

# Comparação lado a lado

| | **Open Finance (agregador)** | **API direta do Inter** |
|---|---|---|
| **Contas resolvidas** | Até 4 de 4 (Nubank c/c, Caixinhas via saldo, Inter, Caixa) | 1 de 4 (Inter c/c) |
| **Esforço de implementação** | 3–5 dias + negociação comercial | **1–2 dias** |
| **Custo mensal** | **R$ 2.500** (Pluggy) / **US$ 1.000** (Belvo) verificados | **R$ 0** (não confirmado) |
| **Custo anual** | ~R$ 30.000 (1,3% do faturamento) | ~R$ 0 |
| **Ações do cliente** | Contrato + onboarding de compliance; autorizar consentimento banco a banco; reautorizar se revogado | Criar 1 integração no IB (~15 min); entregar 4 segredos; **renovar certificado 1x/ano** |
| **ID de transação** | Sim, estável a partir de `TRANSACAO_EFETIVADA` — mas consolidação D0→D+1 gera IDs novos | **Sim, `idTransacao` — exato**, em `/extrato/completo` |
| **Saldo** | Sim, incl. `reserved-balances` (Caixinhas) | Sim, com bloqueios e limite |
| **Histórico inicial** | 12 meses | 90 dias por chamada, sem limite documentado de quantas chamadas encadear |
| **Frescor** | 7 dias por atualização; até 4 atualizações/dia | Polling livre até 10 chamadas/min |
| **Risco principal** | Jornada PJ com 3 meses de vida; múltipla alçada; teto de 4 chamadas/mês para histórico; fornecedor caro para o porte | Certificado anual esquecido; docs não oficiais; cobre só 1 conta |
| **Continua manual mesmo depois** | Detalhe de movimentação das Caixinhas (só saldo vem); classificação/revisão dos lançamentos | **Nubank c/c, Caixinhas e Caixa — 3 das 4 contas**; classificação/revisão |

---

# Recomendação

**Faça a API do Inter agora e não contrate agregador este ano.**

O raciocínio é aritmético, não estético. O agregador custa **R$ 2.500/mês = R$ 30 mil/ano = 1,3% do faturamento** da XPE. O que ele compra é eliminar 3 downloads mensais de uma pessoa que já faz isso. Mesmo cotando esse trabalho generosamente a 4 horas/mês, R$ 30 mil/ano equivale a pagar mais de R$ 600 a hora para não baixar um arquivo. Não fecha. A Pluggy e a Belvo estão precificadas para fintechs que revendem o dado a milhares de usuários — a XPE tem **um** CNPJ e **quatro** contas, e é o perfil de cliente errado para essa tabela.

O Inter é o oposto: **custo recorrente zero, 1-2 dias de trabalho, e melhora o dado em vez de só automatizá-lo.** O `idTransacao` transforma a idempotência de heurística em exata, e os `detalhes` do extrato completo trazem CPF/CNPJ de contraparte que o CSV nunca teve. Encaixa no `sourceId` que o `ParsedRow` já prevê e no `declaredBalanceCents` que a conferência já usa — não é integração nova, é um parser novo alimentado por HTTP em vez de arquivo. É a melhor relação esforço/retorno das duas partes deste documento, por uma margem larga.

Depois do Inter, sobram **Nubank c/c, Caixinhas e Caixa**. Para essas, três considerações:

1. **A Caixa é aplicação + empréstimo**, não conta operacional. Movimenta pouco e de forma previsível. Provavelmente não justifica automação nenhuma — vale medir quantos lançamentos por mês ela realmente gera antes de gastar dinheiro com ela.
2. **O Nubank PJ é o caso real.** Não tem API pública para PJ, e o conector direto (não-Open-Finance) da Pluggy **não lista Nubank Empresas** — [docs.pluggy.ai/docs/connectors-coverage](https://docs.pluggy.ai/docs/connectors-coverage). Via Open Finance regulado ele existe com contexto Business. Ou seja: **para o Nubank PJ, agregador é o único caminho automatizado.**
3. **Se depois de 60 dias com o Inter rodando o Nubank ainda incomodar**, o alvo de investigação não são Pluggy e Belvo — é a faixa de R$ 50 a R$ 550/mês: **Banco MCP** (R$ 49,90 por 5 contas, roda sobre a Pluggy) e **TecnoSpeed PlugBank** (relato de R$ 1.500 + R$ 540/mês, e a página oficial afirma cobertura de 36 instituições PJ). Nessa faixa a conta fecha. Mas **nenhum dos dois tem preço oficial publicado**, e o Banco MCP é um revendedor pequeno — antes de depender dele para o financeiro da empresa, avalie risco de continuidade do fornecedor.

Uma observação de sequência que economiza dinheiro: **a jornada PJ do Open Finance foi liberada ao público geral em 22/04/2026.** Três meses e meio. Esperar mais um ou dois trimestres antes de contratar significa entrar num mercado com jornada PJ mais madura, mais concorrência de preço e menos bugs de borda — pagando zero para esperar, porque o Inter já estará resolvido.

---

# Checklist do que preciso de você

## Para a API do Inter — faça isso, é o que destrava tudo

- [ ] Confirmar com o gerente do Inter se a **API Banking tem custo** para a conta da XPE (não achei preço em nenhuma fonte).
- [ ] No Internet Banking PJ: **Soluções para sua empresa → Nova Integração**.
- [ ] Nome sugerido: `Painel Financeiro XPE`.
- [ ] Selecionar a conta corrente da XPE.
- [ ] Marcar **somente** `API Banking → Consultar extrato e saldo`. **Não marque mais nada** — outras permissões fazem a integração falhar.
- [ ] Confirmar com o SMS de 6 dígitos.
- [ ] Aguardar o status virar **"Ativo"**.
- [ ] Em **Minhas integrações → Detalhar**, baixar e me enviar por canal seguro (não WhatsApp, não e-mail):
  - [ ] `Inter API_Certificado.crt`
  - [ ] `Inter API_Chave.key`
  - [ ] `Client ID`
  - [ ] `Client Secret`
  - [ ] Número da conta corrente com dígito
- [ ] **Anotar na agenda: renovar o certificado em agosto/2027.** Se esquecer, a sincronização para.

## Se um dia for para o agregador

- [ ] Confirmar no **contrato social** se **um único representante** pode autorizar consentimento sozinho. Se exigir dois ou mais, a múltipla alçada vira o problema principal e muda a viabilidade.
- [ ] Verificar se o contador ou algum ERP **já conectou** o CNPJ da XPE ao Nubank/Inter/Caixa via Open Finance — o teto de 4 chamadas/mês para histórico é compartilhado por CNPJ e instituição.
- [ ] Pedir por escrito ao fornecedor, **antes de assinar**: (a) preço para 4 conexões de 1 CNPJ; (b) prazo mínimo de contrato e multa; (c) confirmação de que **Nubank PJ, Inter PJ e Caixa PJ** funcionam para conta empresarial; (d) se a API expõe `reserved-balances` (Caixinhas); (e) o que acontece com o preço se estourar o volume incluso.
- [ ] Rodar o **sandbox gratuito** antes de qualquer assinatura (Pluggy dá 14 dias sem cartão; Belvo tem sandbox aberto).

---

# O que eu NÃO consegui verificar

Sendo direto sobre os limites desta pesquisa. **Confirme cada um destes antes de comprometer dinheiro.**

**Preços**

1. **Se a API Banking do Inter é gratuita.** Nenhuma fonte — nem o Inter, nem os quatro ERPs que documentam a integração — menciona preço. A ausência sugere que é gratuita, mas ausência de prova não é prova. **Pergunte ao gerente.**
2. **Preço do TecnoSpeed PlugBank.** R$ 1.500 + R$ 540/mês vem de relato de um desenvolvedor no TabNews, não da empresa. A página oficial não publica preço.
3. **Preço do Banco MCP.** Mesma origem, mesma ressalva. E não consegui avaliar solidez do fornecedor.
4. **Klavi, Quanto e Celcoin/Finansystech não publicam preço algum.** A Celcoin diz cobrar por transação sem taxa de setup, mas não divulga números. Não contatei nenhum fornecedor, conforme combinado.
5. **Custo de excedente da Pluggy e da Belvo.** Ambas cobram por requisição acima do volume incluso, e nenhuma das duas publica quanto — nem qual é o volume incluso.

**Cobertura**

6. **Se Nubank PJ, Inter PJ e Caixa PJ funcionam de fato via agregador** — verifiquei que a Pluggy lista os três com contexto Business, mas não testei nenhuma conexão real. Página de cobertura publicada é promessa, não teste.
7. **Se algum agregador expõe `reserved-balances`** (as Caixinhas). A especificação do Open Finance obriga o banco a publicar; não achei documentação de nenhum agregador confirmando que repassa.
8. **Prazo de consentimento que Nubank, Inter e Caixa oferecem na prática.** A regra permite prazo indeterminado desde 2024, mas cada instituição decide o que oferece. Só se descobre conectando.

**Técnico**

9. **A especificação oficial da API do Inter.** O portal é uma aplicação JavaScript que não entrega conteúdo a leitores automatizados, e não há OpenAPI em URL pública. Endpoints, campos e limites vêm de bibliotecas open-source em produção e de guias de ERPs — consistentes entre si, mas **não oficiais**. Campos podem ter mudado. A primeira chamada real ao sandbox resolve isso em minutos.
10. **Se `idTransacao` do Inter é imutável ao longo do tempo.** Confirmei que o campo existe em `/extrato/completo`. **Não achei nenhuma documentação do Inter sobre estabilidade dele** — se ele muda quando a transação sai de provisória para efetivada, como acontece no Open Finance. **Isso precisa ser testado**: rode a mesma janela de datas em dois dias seguidos e compare os IDs antes de confiar a idempotência a ele.
11. **Se o Inter cobra ou limita chamadas além dos 10/min.** Não achei política de uso justo publicada.
12. **Se a criação da integração exige perfil específico** (representante legal vs. usuário administrador) no IB do Inter. Nenhuma fonte especifica. Se quem tentar não conseguir, é provavelmente isso.

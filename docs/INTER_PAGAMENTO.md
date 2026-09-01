# Ligar o pagamento PIX pela API do Inter

**Para:** o dono da conta. ~20 minutos no Internet Banking, uma vez.
**Regra que governa tudo:** a plataforma **lança** a ordem; **quem aprova é você, no aplicativo do banco.** Nada aqui muda isso.

---

## 1. Crie uma integração NOVA — não mexa na que existe

A integração de hoje alimenta o extrato, e **o sync inteiro do financeiro depende dela**. A Conta Azul documenta que marcar permissões além de "Consultar extrato e saldo" numa integração do Inter **faz a integração falhar** ([ajuda.contaazul.com](https://ajuda.contaazul.com/hc/pt-br/articles/9044458910093-Integra%C3%A7%C3%A3o-banc%C3%A1ria-autom%C3%A1tica-com-Inter-cadastrar-uma-nova-API), registrado em `integracao-bancaria-open-finance-e-inter.md:150`).

Acrescentar escopo de pagamento na integração de extrato seria arriscar a leitura para ganhar a escrita. **São duas integrações separadas, com dois certificados.**

## 2. O passo a passo

1. Internet Banking **PJ** do Inter (login por QR Code).
2. **Soluções para sua empresa → Nova Integração**.
   Em algumas versões: **Integrar → Configurações avançadas → Nova integração**.
3. Nome sugerido: `Pagamentos XPE (local)`. Descrição: `ordens de PIX criadas pela plataforma, aprovadas no app`.
4. Selecione a **conta corrente** da XPE.
5. **Escopos — marque "Pagar contas, fornecedores e despesas".**

   **Esta orientação foi corrigida em 31/08/2026, depois de errar no primeiro
   teste real.** A recomendação anterior era a permissão de Pix, e ela não paga.

   | permissão | o que concede | serve para enviar? |
   |---|---|---|
   | **"Pagar contas, fornecedores e despesas"** | `pagamento-pix.write` (API **Banking**) | ✅ **é esta** |
   | "Receber e enviar pagamentos via Pix" | `pix.write` + `cob.write` (API **Pix**) | ❌ não |
   | "Consultar extrato e saldo" | `extrato.read` | ❌ é da outra integração |

   **Por que a segunda engana:** o nome diz "enviar", mas ela concede a API Pix
   do padrão BACEN, que trata do dinheiro que **chega** — cobrança (`cob.write`)
   e devolução (`pix.write`). Tirar dinheiro da conta é **API Banking**, família
   Pagamento.

   A prova, medida: com a permissão de Pix marcada, o token sai normalmente com
   `pix.write`, e `POST /banking/v2/pix` responde
   `401 "requested scope is not registered for this client"`. O token é válido;
   o escopo dentro dele é que não serve para essa rota.

   Se você já criou a integração com a permissão errada, **edite-a** e acrescente
   "Pagar contas, fornecedores e despesas". Se o Inter reemitir o certificado,
   troque os arquivos em `secrets/` — os caminhos no `.env.local` continuam os
   mesmos.

   O que **não** marcar: "Consultar extrato e saldo" (é o escopo da integração
   que alimenta o sync, e misturá-los é o risco documentado) e webhook (o código
   não usa).

6. Confirme com o **SMS de 6 dígitos**.
7. Espere o status sair de "Em validação" para **Ativo** (alguns minutos, com e-mail).
8. **Minhas integrações → Ações → Detalhar** → baixe o ZIP. Você precisa de quatro coisas:
   - `Inter API_Certificado.crt`
   - `Inter API_Chave.key`
   - **Client ID**
   - **Client Secret**

## 3. Ligue a Gestão de Aprovações

No Internet Banking, em **Gestão de Aprovações** (ou Configurações → Alçadas), garanta que **pagamento exige aprovação**. É a tranca do banco, e é a mais forte das quatro — ela vale mesmo que todo o resto falhe.

Se a conta estiver configurada para liquidar sem aprovação, **o pagamento sai na hora do envio**. Confirme isso antes de qualquer teste.

## 4. Instale na sua máquina

Os arquivos vão para `secrets/`, com nome próprio para não se confundirem com os do extrato:

```bash
mv ~/Downloads/Inter\ API_Certificado.crt  secrets/inter-pagamento.crt
mv ~/Downloads/Inter\ API_Chave.key        secrets/inter-pagamento.key
chmod 600 secrets/inter-pagamento.*
```

E no `.env.local` (que o git ignora):

```
INTER_PAG_CLIENT_ID=...
INTER_PAG_CLIENT_SECRET=...
INTER_PAG_CERT_PATH=secrets/inter-pagamento.crt
INTER_PAG_KEY_PATH=secrets/inter-pagamento.key
INTER_PAGAMENTO_LOCAL=1
```

`INTER_PAGAMENTO_LOCAL=1` é a chave de ignição. Sem ela o código recusa antes de abrir socket.

**Não coloque nada disso no Railway.** A trava exige `NODE_ENV !== 'production'`, então em produção não há caminho — mas variável de produção com segredo de pagamento é risco sem contrapartida.

## 5. Confira antes de usar

```bash
node scripts/check-inter.mjs --escopos
```

Ele pede um token por escopo e mostra qual o banco aceita. **Não chama rota de pagamento nenhuma** — pedir token não move dinheiro. Escopo não contratado volta `401` com *"No registered scope value for this client has been requested"*.

### Medido em 31/08/2026 — e os dois palpites estavam errados

A permissão **"Receber e enviar pagamentos via Pix"** concede:

```
200  pix.write             ACEITO   ← é este
200  cob.write             ACEITO   (o lado de receber, que não usamos)
401  pagamento-pix.write   não contratado
401  pagamento.write       não contratado
```

E o GET de desempate achou a rota certa:

```
401  GET /banking/v2/pix              token recusado
401  GET /pix/v2/pix                  token recusado
405  GET /banking/v2/pagamento/pix    ← ROTA EXISTE e o token é aceito
```

`405` é "método não permitido": a rota existe e o token serve, ela só espera POST. É a prova mais forte possível sem criar um pagamento.

**Os dois valores já estão corrigidos no código** (`CAMINHO_PIX = /banking/v2/pagamento/pix`, `ESCOPO_PIX_ESCRITA = pix.write`). O que continua não verificado é o **corpo** da requisição e o nome do header de idempotência — porque testá-los exige um POST, e POST cria pagamento. O primeiro envio real é que vai dizer.

Depois:

```bash
npm run test:guarda-pagamento
```

## 6. O primeiro pagamento de verdade

Faça com **um valor pequeno, para você mesmo**. Na ordem:

1. Em Contas a pagar, selecione **uma** linha e programe.
2. Em Aprovações, ela aparece em **Rascunho**.
3. Clique em enviar. Ela vai para **Aguardando sua aprovação no app do Inter**.
4. Abra o aplicativo do Inter. **A ordem tem de estar lá, pendente.** Se não estiver, pare — o pagamento não foi criado, e o erro que a tela mostrou é a pista.
5. Aprove no app.
6. Rode `npm run sync:inter && npm run import:inter` e confira que o lançamento apareceu no extrato.

Se em algum ponto o dinheiro sair **sem** você aprovar no app, o problema é o passo 3 desta lista — a Gestão de Aprovações não está ligada. Desligue `INTER_PAGAMENTO_LOCAL` e resolva isso antes de continuar.

---

## As quatro travas, e o que cada uma cobre

| | tranca | prova |
|---|---|---|
| 1 | Não existe verbo de aprovação no código | `npm run test:guarda-pagamento` — o adapter só tem `/oauth/v2/token` e `/banking/v2/pix` |
| 2 | Nada escreve `status='pago'` nem insere em `fin_payment_execution` | idem |
| 3 | Escrita bancária exige `NODE_ENV !== production` **E** `INTER_PAGAMENTO_LOCAL=1` | idem |
| 4 | **O Inter exige aprovação no app** | Gestão de Aprovações, no Internet Banking |

As três primeiras são nossas e um teste as verifica a cada execução. A quarta é do banco, e é a que vale mais: ela não depende de nenhuma linha deste repositório.

---

## O que a API do Inter NÃO dá

**A agenda de favorecidos salva no aplicativo.** As famílias publicadas são Cobrança, Banking (extrato, saldo, pagamento), Pix e Webhooks — nenhuma lista contatos salvos.

O caminho que existe é melhor: o **extrato completo** traz, em cada PIX enviado, `chavePixRecebedor`, `nomeRecebedor` e `cpfCnpjRecebedor`. São chaves que **já receberam dinheiro**, não digitação que alguém conferiu de olho.

```bash
npm run favorecidos:inter            # mostra o que faria
npm run favorecidos:inter:aplicar    # grava em fin_payee_account
```

Medido em 31/08/2026, sobre o extrato local (699 transações até 20/08): 630 saídas, 437 com chave PIX, **54 favorecidos distintos, 47 cadastrados**. A cobertura de pessoas ativas foi de 0/25 para **14/25**.

Os 11 que faltam não receberam PIX pelo Inter no período — recebem por outra conta, ou entraram depois. Para eles, ou se cadastra à mão, ou se espera o próximo pagamento aparecer no extrato. O script **não sobrescreve** conta padrão existente e **não casa por nome**, só por CPF/CNPJ: unir por nome parecido foi o erro que fez "PAULO GABRIEL CHAVES DE ARAUJO" casar com "Gabriel" numa auditoria anterior.

## Renovação anual

O certificado do Inter **expira em 12 meses**. Quando expirar, o envio para de funcionar. Anote: **agosto/2027**, gerar certificado novo para as DUAS integrações.

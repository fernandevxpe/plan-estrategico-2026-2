# Comissões declaradas

Tela canônica: `/financeiro/comissoes`.

## O que é (e o que não é)

| | Esta frente | Outra coisa |
|---|---|---|
| Tabela | `fin_pessoa_comissao_declarada` + `fin_pessoa_comissao_serie` | `fin_comissao_prevista` (0076) |
| Pergunta | “Quanto de variável o financeiro afirma que a pessoa recebe neste mês?” | “% sobre contrato de venda no pipe” |
| Quem usa | MEI/sócio cujo PIX mistura salário + variável + reembolso | Vendedor/eng. comercial com % de obra |

Não misture as duas. Forçar o caso Audrey em `fin_comissao_prevista` inventaria contrato e papel.

## Regras (0165 → 0167)

1. **N linhas por pessoa × mês.** Somam. Cada uma tem `descricao` obrigatória.
2. **À vista** = uma linha sem `serie_id`.
3. **Parcelada** = cabeçalho em `fin_pessoa_comissao_serie` + N linhas ligadas (`parcela` / `parcelas_total`). Excluir a série apaga todas as parcelas (CASCADE).
4. **`fin_time_remuneracao_mes_v`** soma as declarações do mês e aplica teto no que sobrou depois de reembolso e salário-base. Sem base, a declaração fica gravada mas a banda de comissão no gráfico só aparece direito depois da base existir.
5. **Não inventar valor.** Campo que o usuário não preencheu não é chutado.

## Onde o código mora

```
db/migrations/0165_…          cria tabela (1 por mês)
db/migrations/0167_…          série + N por mês + view soma
lib/financeiro/comissoes.ts   painel, criar avulsa/parcelada, excluir
app/financeiro/comissoes/     página
app/api/financeiro/comissoes/ GET/POST + DELETE item/série
components/financeiro/FinComissoes.tsx
```

Atalho do perfil: `POST /api/financeiro/pessoas/[id]/comissao` também **insere** (não sobrescreve). Parcelar e ver a casa inteira → tela Comissões.

## API rápida

```http
GET  /api/financeiro/comissoes
POST /api/financeiro/comissoes
  { "modo":"avulsa", "personId":12, "competencia":"2026-09", "valorCents":150000, "descricao":"Obra Aurora" }
  { "modo":"parcelada", "personId":12, "primeiraCompetencia":"2026-09", "totalCents":1200000, "parcelas":6, "descricao":"Bônus Q3" }
DELETE /api/financeiro/comissoes/:id          # só à vista
DELETE /api/financeiro/comissoes/serie/:id    # série + parcelas
```

## Armadilhas

- Somar esta tela com o ledger **conta duas vezes** o mesmo dinheiro: a declaração só **classifica** o que já saiu (ou vai sair) no PIX.
- A coluna “projetado” do mês seguinte é o que **já está lançado** com aquela competência — não é média inventada.
- Migration 0167 é congelada por hash depois de aplicada; erro → escreva 0168, não edite.

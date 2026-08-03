# Registro de análises — Gestor IA (Marketing)

Uma análise por arquivo, nomeado `AAAA-MM-DD.json`. A página de Marketing lê a
pasta inteira, mostra a mais recente e deixa abrir as anteriores pelo seletor de
datas. Análise nova não sobrescreve nada: é um arquivo novo.

O texto é escrito em sessão sobre os fatos já calculados por
`lib/areas/marketing-ai.ts`. **Não há chamada de modelo em runtime** — a página
não depende de nenhuma API para renderizar isto.

## Formato

```jsonc
{
  "date": "2026-08-03",              // igual ao nome do arquivo
  "titulo": "…",                     // manchete da edição
  "model": "claude-opus-5",
  "factsGeneratedAt": "…",           // syncedAt do marketing.json analisado
  "janela": "janeiro a julho de 2026",
  "base": "…",                       // volume de dados que sustenta a análise
  "resumo": "…",                     // 3 a 5 frases
  "secoes": [
    {
      "id": "slug-da-secao",
      "titulo": "1. …",
      "tom": "critico | atencao | oportunidade | neutro",
      "paragrafos": ["…"],
      "lista": ["…"],                // opcional
      "listaOrdenada": true,         // opcional, transforma em <ol>
      "tabela": {                    // opcional
        "colunas": ["…"],
        "linhas": [["…"]],
        "nota": "…"
      },
      "destaque": "…"                // opcional, callout no fim da seção
    }
  ],
  "conclusao": "…"
}
```

`factsGeneratedAt` é o que permite a página avisar quando os dados mudaram
depois da análise — mantenha o valor real do `syncedAt` usado.

## Regra que não se quebra

Todo número citado tem que existir nos fatos calculados. Custo por resultado só
é comparável dentro da mesma família (`[WPP]` compra conversa, `[LP]` compra
página carregada), e receita por criativo é rateio modelado, nunca atribuição —
sempre rotulada como estimativa.

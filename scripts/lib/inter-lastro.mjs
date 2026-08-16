// O lastro documental de uma transação do Inter.
//
// Escrito UMA vez e importado por scripts/import-inter.mjs (daqui para frente) e
// por scripts/backfill-inter-lastro.mjs (histórico), pelo mesmo motivo de
// fin-normalize.mjs: dois lugares decidindo "qual é o documento da contraparte"
// derivam, e a deriva aqui não aparece como erro — aparece como um lançamento
// que o backfill marcou como transferência e a próxima importação não marca, ou
// o contrário. O ledger passaria a discordar de si mesmo conforme a ordem em que
// os scripts rodaram.
//
// O que é "lastro": o que a FONTE afirmou sobre aquela transação específica.
// Não é cadastro, não é palpite e não é editável — é a evidência. Por isso vive
// em colunas de fin_transaction (0042) e não só em fin_counterparty.

/** Só dígitos. "34.776.108/0001-92" e "34776108000192" têm de virar a mesma chave. */
export const digitos = (valor) => String(valor ?? '').replace(/\D/g, '');

/**
 * 11 dígitos é CPF, 14 é CNPJ, qualquer outra coisa não é documento.
 *
 * Devolver `null` para os outros comprimentos é o que impede um campo truncado
 * pela fonte de virar uma contraparte inventada — e o CHECK
 * `fin_transaction_documento_coerente` (0042) recusa a gravação se esta função
 * e o número discordarem.
 */
export function tipoDeDocumento(digitosDoc) {
  if (digitosDoc.length === 14) return 'cnpj';
  if (digitosDoc.length === 11) return 'cpf';
  return null;
}

/**
 * O lastro de uma transação do extrato do Inter.
 *
 * @returns {{ documento: string|null, tipoDocumento: 'cnpj'|'cpf'|null, endToEndId: string|null }}
 *
 * ------------------------------------------------------------------------
 * QUAL DOCUMENTO É O DA CONTRAPARTE DEPENDE DA DIREÇÃO
 * ------------------------------------------------------------------------
 * O Inter descreve a transação do ponto de vista da rede, não do nosso: em toda
 * saída (`tipoOperacao='D'`) o PAGADOR somos nós e o recebedor é a contraparte;
 * em toda entrada ('C') é o inverso. Ler sempre o mesmo campo faria metade dos
 * lançamentos apontar para o CNPJ da própria empresa — que é exatamente o
 * gatilho da regra de transferência entre contas próprias. O erro não ficaria
 * silencioso: viraria receita e despesa neutralizadas por engano.
 *
 * ------------------------------------------------------------------------
 * BOLETO NÃO TEM DOCUMENTO DE CONTRAPARTE. E ISSO É PROPOSITAL.
 * ------------------------------------------------------------------------
 * Em `tipoTransacao='PAGAMENTO'` o campo `cpfCnpj` é o do PAGADOR — nós — e não
 * o do beneficiário. O beneficiário do boleto só aparece por nome, em
 * `empresaEmissora`.
 *
 * Medido no extrato de 15/08/2026: 31 boletos trazem `cpfCnpj` igual ao CNPJ da
 * XPE. Se este campo fosse gravado, esses 31 lançamentos (R$ 28.263,64 de
 * COMPESA, EMBRASUL e STARTLAW) casariam com a regra do CNPJ próprio e virariam
 * "transferência entre contas próprias" — despesa real desaparecendo da DRE.
 *
 * É a mesma armadilha que a migration 0022 teve de desfazer à mão, por outro
 * caminho. Melhor sem documento do que com o documento errado: sem documento a
 * linha fica pendente e alguém olha; com o documento errado ela fica "resolvida"
 * e ninguém olha nunca mais.
 */
export function lastroDaTransacao(transacao) {
  const detalhes = transacao?.detalhes ?? {};
  const saida = transacao?.tipoOperacao === 'D';
  const boleto = transacao?.tipoTransacao === 'PAGAMENTO';

  const bruto = boleto ? null : saida ? detalhes.cpfCnpjRecebedor : detalhes.cpfCnpjPagador;
  const doc = digitos(bruto);
  const tipo = tipoDeDocumento(doc);

  return {
    // Sem tipo válido não há documento: gravar 8 dígitos numa coluna que a regra
    // compara por igualdade seria guardar ruído com aparência de evidência.
    documento: tipo ? doc : null,
    tipoDocumento: tipo,
    // O identificador de ponta a ponta do PIX. Vem em 585 das 671 transações
    // (87,2%), todos distintos dentro do próprio extrato do Inter. Repetição só
    // acontece ENTRE contas — as duas pernas do mesmo PIX — e é por isso que o
    // índice de 0042 não é único.
    endToEndId: String(detalhes.endToEndId ?? '').trim() || null
  };
}

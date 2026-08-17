// CPF e CNPJ conferidos no dígito verificador.
//
// Mora aqui, e não em lib/financeiro/, pelo mesmo arranjo de fin-types.mjs e
// fin-rules.mjs ao lado: a rota HTTP em TypeScript e o script de teste em .mjs
// precisam do MESMO código. Se cada lado tivesse a sua cópia, o teste provaria
// a cópia dele — e o dia em que as duas divergissem seria o dia em que um
// documento inválido entraria no cadastro com o teste verde.
//
// POR QUE O DÍGITO VERIFICADOR, E NÃO O COMPRIMENTO
//
// Esta base já pagou por confiar em formato. Uma versão do detector de CNPJ
// procurava "14 dígitos em qualquer campo" e casou zero de 274 negócios do
// Pipedrive, porque `update_time = 2024-02-29 14:24:07` tem exatamente 14
// dígitos. Comprimento diz que o número tem o tamanho certo; o DV diz que ele
// foi emitido. É a diferença entre parecer identidade e ser.

/**
 * Documentos que passam na aritmética e mesmo assim não são identidade.
 *
 * `00000000000` e `11111111111111` satisfazem os dois módulos 11 — o cálculo do
 * DV não tem como distingui-los de um documento real. São o que a fonte digita
 * quando não sabe, e deixá-los entrar seria pior que recusar o cadastro: eles
 * entrariam com selo de conferido. O `sync-erp-contratos.mjs` já os trata como
 * `documento_invalido`; aqui a lista é a mesma ideia, aplicada na escrita.
 */
export const DOCUMENTOS_PLACEHOLDER = new Set([
  '00000000000',
  '11111111111',
  '22222222222',
  '33333333333',
  '44444444444',
  '55555555555',
  '66666666666',
  '77777777777',
  '88888888888',
  '99999999999',
  '12345678909',
  '00000000000000',
  '11111111111111',
  '99999999999999',
  '12345678000195'
]);

export function digitosDe(bruto) {
  return String(bruto ?? '').replace(/[^0-9]/g, '');
}

/** DV do CPF: dois módulos 11 sobre pesos decrescentes. */
export function cpfConfere(d) {
  const calc = (ate) => {
    let soma = 0;
    for (let i = 0; i < ate; i += 1) soma += Number(d[i]) * (ate + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}

/** DV do CNPJ: mesmos dois módulos 11, com a tabela de pesos 2..9 cíclica. */
export function cnpjConfere(d) {
  const calc = (ate) => {
    const pesos =
      ate === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let soma = 0;
    for (let i = 0; i < ate; i += 1) soma += Number(d[i]) * pesos[i];
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

/**
 * Confere um CPF ou CNPJ antes de ele virar cadastro.
 *
 * Devolve `{ valido: true, digitos, tipo }` ou `{ valido: false, motivo }`. O
 * motivo é texto para humano porque ele chega até a resposta HTTP: quem recebe
 * 422 precisa saber se digitou errado, se mandou um placeholder ou se o número
 * simplesmente não fecha.
 */
export function conferirDocumento(bruto) {
  const d = digitosDe(bruto);
  if (!d) return { valido: false, motivo: 'documento vazio' };
  if (d.length !== 11 && d.length !== 14) {
    return { valido: false, motivo: `documento com ${d.length} dígitos; CPF tem 11 e CNPJ tem 14` };
  }
  if (DOCUMENTOS_PLACEHOLDER.has(d) || /^(\d)\1+$/.test(d)) {
    return { valido: false, motivo: 'documento é placeholder, não identidade' };
  }
  if (d.length === 11) {
    return cpfConfere(d)
      ? { valido: true, digitos: d, tipo: 'cpf' }
      : { valido: false, motivo: 'CPF com dígito verificador inválido' };
  }
  return cnpjConfere(d)
    ? { valido: true, digitos: d, tipo: 'cnpj' }
    : { valido: false, motivo: 'CNPJ com dígito verificador inválido' };
}

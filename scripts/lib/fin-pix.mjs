// A CHAVE PIX, VALIDADA PELO TIPO — porque chave errada não dá erro.
//
// Uma chave malformada não volta como falha: ou o banco recusa na hora do
// pagamento (bom) ou ela é válida e pertence a OUTRA PESSOA (péssimo).
//
// MORA AQUI, e não em lib/financeiro/, pelo mesmo arranjo de `fin-documento.mjs`
// ao lado: a rota HTTP em TypeScript (`salvarContaPagamento`) e os scripts .mjs
// que mexem em coordenada de pagamento precisam do MESMO código. Se cada lado
// tivesse a sua cópia, o dia em que as duas divergissem seria o dia em que o app
// do time aceitaria uma chave que o script grava de outro jeito — e o pagamento
// sairia para um destino que ninguém digitou.
//
// Os formatos seguem o que o BR Code espera, e são os mesmos de
// `lib/financeiro/pix-brcode.ts`: CPF e CNPJ só dígitos, telefone em E.164 com o
// `+55`, e-mail e chave aleatória como estão.
//
// MEDIDO EM 03/09/2026: o dono passou a chave do João como "819999269107" — 12
// dígitos, um a mais que qualquer formato aceita. Não foi cadastrada; a segunda
// tentativa veio "81999269107", que é o telefone de verdade. É exatamente para
// esse dígito a mais que esta função existe.

/** Erro de validação de chave. Quem chama decide o status HTTP. */
export class ChavePixInvalida extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = 'ChavePixInvalida';
  }
}

export const TIPOS_PIX = ['cpf', 'cnpj', 'telefone', 'email', 'aleatoria'];

/**
 * Normaliza a chave para a forma que o banco aceita, ou lança.
 *
 * Devolve sempre a forma canônica: dígitos puros para documento, `+55DDDNUMERO`
 * para telefone, minúsculas para e-mail e chave aleatória.
 */
export function normalizarChavePix(tipo, bruta) {
  const v = String(bruta ?? '').trim();
  const d = v.replace(/\D/g, '');
  switch (tipo) {
    case 'cpf':
      if (d.length !== 11) throw new ChavePixInvalida('CPF precisa ter 11 dígitos');
      return d;
    case 'cnpj':
      if (d.length !== 14) throw new ChavePixInvalida('CNPJ precisa ter 14 dígitos');
      return d;
    case 'telefone': {
      // Aceita com ou sem o 55; grava sempre no formato que o PIX exige.
      const nacional = d.startsWith('55') ? d.slice(2) : d;
      if (nacional.length < 10 || nacional.length > 11) {
        throw new ChavePixInvalida(
          `telefone precisa ter DDD + número (10 ou 11 dígitos); veio ${nacional.length}`
        );
      }
      return `+55${nacional}`;
    }
    case 'email':
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new ChavePixInvalida('e-mail inválido');
      return v.toLowerCase();
    case 'aleatoria':
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) {
        throw new ChavePixInvalida('chave aleatória tem 36 caracteres no formato do banco');
      }
      return v.toLowerCase();
    default:
      throw new ChavePixInvalida(`tipo de chave inválido: ${tipo}`);
  }
}

/** `telefone` → `PHONE`. fin_person_pagamento fala minúsculo, fin_payee_account fala o do Asaas. */
export const TIPO_PARA_PAYEE = {
  cpf: 'CPF',
  cnpj: 'CNPJ',
  email: 'EMAIL',
  telefone: 'PHONE',
  aleatoria: 'EVP'
};

/** O caminho inverso, para quem lê a conta favorecida e escreve no app do time. */
export const TIPO_PARA_APP = {
  CPF: 'cpf',
  CNPJ: 'cnpj',
  EMAIL: 'email',
  PHONE: 'telefone',
  EVP: 'aleatoria'
};

// Tipos para scripts/lib/fin-documento.mjs.
//
// Mesmo arranjo do fin-rules.d.mts ao lado: a conferência é JavaScript porque o
// script de teste é .mjs, mas a rota de cadastro em TypeScript roda EXATAMENTE
// o mesmo código. Este arquivo só dá nome aos tipos; a semântica mora no .mjs.

export type TipoDeDocumento = "cpf" | "cnpj";

export type DocumentoConferido =
  | { valido: true; digitos: string; tipo: TipoDeDocumento }
  | { valido: false; motivo: string };

export declare const DOCUMENTOS_PLACEHOLDER: Set<string>;

export declare function digitosDe(bruto: unknown): string;
export declare function cpfConfere(digitos: string): boolean;
export declare function cnpjConfere(digitos: string): boolean;
export declare function conferirDocumento(bruto: unknown): DocumentoConferido;

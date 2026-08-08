/**
 * CSV à mão, sem dependência.
 *
 * O motivo de não usar uma lib: os dois CSVs que este módulo lê (Nubank e
 * Inter) cabem em ~40 linhas de parser, e uma dependência de parsing é uma
 * superfície de supply-chain num módulo que grava dinheiro. O que uma lib
 * daria a mais — streaming, RFC 4180 completo — extrato de banco não usa.
 *
 * O que É tratado, porque acontece de verdade:
 *   · campo entre aspas com o delimitador dentro ("PIX; Fulano");
 *   · aspas escapadas por duplicação ("" dentro de campo com aspas);
 *   · CRLF do Windows e linha final vazia.
 */
export function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    // Linha totalmente vazia (só o \n final do arquivo) não é registro.
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === "") {
      inQuotes = true;
    } else if (ch === delimiter) {
      pushField();
    } else if (ch === "\n") {
      pushRow();
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field !== "" || row.length) pushRow();
  return rows;
}

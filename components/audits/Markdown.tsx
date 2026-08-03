"use client";

import { Fragment, type ReactNode } from "react";

/**
 * Renderizador de markdown suficiente para os relatórios de auditoria.
 *
 * Escrito à mão em vez de usar uma lib porque o conteúdo é nosso (arquivos
 * versionados em reports/) e assim nada passa por dangerouslySetInnerHTML —
 * o texto vira nós React e escapa sozinho.
 *
 * Suporta: títulos, parágrafos, listas, tabelas, blocos de código, citações,
 * separadores e, no texto, negrito, itálico, código e links.
 */

function slugify(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

/** Divide o texto em trechos, respeitando `código` antes de qualquer outra marca. */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)]+\))|(\*[^*]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const token = match[0];
    const key = `${keyPrefix}-i${index++}`;

    if (token.startsWith("`")) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("[")) {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (link) {
        const external = /^https?:\/\//.test(link[2]);
        nodes.push(
          <a
            key={key}
            href={link[2]}
            {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}
          >
            {link[1]}
          </a>
        );
      } else nodes.push(token);
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

type Alignment = "left" | "right" | "center";

function alignmentsFrom(separator: string): Alignment[] {
  return separator
    .split("|")
    .slice(1, -1)
    .map((cell) => {
      const trimmed = cell.trim();
      if (trimmed.startsWith(":") && trimmed.endsWith(":")) return "center";
      if (trimmed.endsWith(":")) return "right";
      return "left";
    });
}

const splitRow = (line: string) =>
  line
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());

export function Markdown({ source }: { source: string }) {
  const lines = source.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Linha em branco
    if (!line.trim()) {
      i += 1;
      continue;
    }

    // Bloco de código
    if (line.startsWith("```")) {
      const language = line.slice(3).trim();
      const buffer: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith("```")) {
        buffer.push(lines[i]);
        i += 1;
      }
      i += 1;
      blocks.push(
        <pre key={`b${key++}`} className="md-code" data-language={language || undefined}>
          <code>{buffer.join("\n")}</code>
        </pre>
      );
      continue;
    }

    // Separador
    if (/^---+$/.test(line.trim())) {
      blocks.push(<hr key={`b${key++}`} className="md-rule" />);
      i += 1;
      continue;
    }

    // Título
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2];
      const id = slugify(text.replace(/[*_`]/g, ""));
      const Tag = (`h${Math.min(level + 1, 6)}`) as "h2" | "h3" | "h4" | "h5" | "h6";
      blocks.push(
        <Tag key={`b${key++}`} id={id} className={`md-h md-h${level}`}>
          {renderInline(text, `h${key}`)}
        </Tag>
      );
      i += 1;
      continue;
    }

    // Tabela
    if (line.trim().startsWith("|") && lines[i + 1]?.includes("---")) {
      const headers = splitRow(line);
      const aligns = alignmentsFrom(lines[i + 1]);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      blocks.push(
        <div key={`b${key++}`} className="md-table-wrap">
          <table className="md-table">
            <thead>
              <tr>
                {headers.map((cell, index) => (
                  <th key={index} style={{ textAlign: aligns[index] ?? "left" }}>
                    {renderInline(cell, `th${index}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} style={{ textAlign: aligns[cellIndex] ?? "left" }}>
                      {renderInline(cell, `td${rowIndex}-${cellIndex}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Citação
    if (line.trimStart().startsWith(">")) {
      const buffer: string[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith(">")) {
        buffer.push(lines[i].replace(/^\s*>\s?/, ""));
        i += 1;
      }
      blocks.push(
        <blockquote key={`b${key++}`} className="md-quote">
          {renderInline(buffer.join(" "), `q${key}`)}
        </blockquote>
      );
      continue;
    }

    // Listas
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const ordered = line.match(/^\s*(\d+)\.\s+(.*)$/);
    if (bullet || ordered) {
      const isOrdered = Boolean(ordered);
      const items: string[] = [];
      while (i < lines.length) {
        const current = lines[i];
        const nextBullet = current.match(/^\s*[-*]\s+(.*)$/);
        const nextOrdered = current.match(/^\s*(\d+)\.\s+(.*)$/);
        if (isOrdered && nextOrdered) items.push(nextOrdered[2]);
        else if (!isOrdered && nextBullet) items.push(nextBullet[1]);
        else if (current.startsWith("   ") && current.trim() && items.length) {
          // continuação recuada do item anterior
          items[items.length - 1] += ` ${current.trim()}`;
        } else break;
        i += 1;
      }
      const List = isOrdered ? "ol" : "ul";
      blocks.push(
        <List key={`b${key++}`} className="md-list">
          {items.map((item, index) => (
            <li key={index}>{renderInline(item, `li${key}-${index}`)}</li>
          ))}
        </List>
      );
      continue;
    }

    // Parágrafo
    const buffer: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].startsWith("#") &&
      !lines[i].startsWith("```") &&
      !lines[i].trimStart().startsWith(">") &&
      !lines[i].trim().startsWith("|") &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^---+$/.test(lines[i].trim())
    ) {
      buffer.push(lines[i].trim());
      i += 1;
    }
    if (buffer.length) {
      blocks.push(
        <p key={`b${key++}`} className="md-p">
          {renderInline(buffer.join(" "), `p${key}`)}
        </p>
      );
    }
  }

  return <div className="md">{blocks.map((block, index) => <Fragment key={index}>{block}</Fragment>)}</div>;
}

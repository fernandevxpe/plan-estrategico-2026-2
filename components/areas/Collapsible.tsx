import type { ReactNode } from "react";

/**
 * Bloco recolhível baseado em `<details>`.
 *
 * Nativo de propósito: funciona sem JavaScript, já vem com teclado e leitor de
 * tela resolvidos, e o conteúdo continua no HTML do servidor — o que importa
 * numa página que precisa ser impressa e indexada. Um `<div>` com estado só
 * traria trabalho e regressão de acessibilidade.
 */
export function Collapsible({
  title,
  hint,
  badge,
  defaultOpen = false,
  children
}: {
  title: string;
  hint?: string;
  badge?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="collapsible" open={defaultOpen}>
      <summary>
        <span className="collapsible-caret" aria-hidden="true" />
        <span className="collapsible-title">
          <strong>{title}</strong>
          {hint ? <span>{hint}</span> : null}
        </span>
        {badge ? <em className="collapsible-badge">{badge}</em> : null}
      </summary>
      <div className="collapsible-body">{children}</div>
    </details>
  );
}

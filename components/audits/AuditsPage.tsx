"use client";

import { useMemo, useState } from "react";
import type { AuditEntry, AuditIndex } from "@/lib/audits/build-audits";
import { Markdown } from "@/components/audits/Markdown";

const longDate = (date: string) =>
  new Date(`${date}T12:00:00-03:00`).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric"
  });
const shortDate = (date: string) =>
  new Date(`${date}T12:00:00-03:00`).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });

function daysSince(date: string) {
  const then = new Date(`${date}T12:00:00-03:00`).getTime();
  return Math.max(0, Math.round((Date.now() - then) / 86_400_000));
}

export function AuditsPage({ index }: { index: AuditIndex }) {
  const [slug, setSlug] = useState(index.latest ?? index.audits[0]?.slug ?? "");
  const audit: AuditEntry | undefined = useMemo(
    () => index.audits.find((item) => item.slug === slug) ?? index.audits[0],
    [index.audits, slug]
  );

  if (!audit) {
    return (
      <div className="audits-page">
        <p className="audits-empty">
          Nenhuma auditoria registrada ainda. Adicione um arquivo em{" "}
          <code>reports/auditorias/</code> e rode <code>npm run build:audits</code>.
        </p>
      </div>
    );
  }

  const age = daysSince(audit.date);

  return (
    <div className="audits-page">
      <section className="audits-hero">
        <div>
          <span className="audits-kicker">Registro de auditorias</span>
          <h2>{audit.title}</h2>
          <p>{audit.summary}</p>
          <div className="audits-meta">
            <span>
              <strong>{longDate(audit.date)}</strong>
              {age === 0 ? " · hoje" : age === 1 ? " · ontem" : ` · há ${age} dias`}
            </span>
            {audit.author ? <span>Por {audit.author}</span> : null}
            <span>{audit.readingMinutes} min de leitura</span>
          </div>
          {audit.scope ? <p className="audits-scope">{audit.scope}</p> : null}
        </div>
        <aside className="audits-count">
          <strong>{index.total}</strong>
          <span>{index.total === 1 ? "auditoria registrada" : "auditorias registradas"}</span>
        </aside>
      </section>

      {audit.highlights.length ? (
        <section className="audits-highlights">
          <h3>O que esta rodada encontrou</h3>
          <ul>
            {audit.highlights.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="audits-layout">
        <nav className="audits-toc" aria-label="Sumário da auditoria">
          {index.audits.length > 1 ? (
            <div className="audits-picker">
              <label htmlFor="audit-picker">Rodada</label>
              <select
                id="audit-picker"
                value={audit.slug}
                onChange={(event) => setSlug(event.target.value)}
              >
                {index.audits.map((item) => (
                  <option key={item.slug} value={item.slug}>
                    {shortDate(item.date)} — {item.title}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <span className="audits-toc-title">Nesta auditoria</span>
          <ol>
            {audit.sections
              .filter((section) => section.level === 2)
              .map((section) => (
                <li key={section.id}>
                  <a href={`#${section.id}`}>{section.text}</a>
                </li>
              ))}
          </ol>
        </nav>

        <article className="audits-body">
          <Markdown source={audit.body} />
        </article>
      </div>

      {index.audits.length > 1 ? (
        <section className="audits-timeline">
          <h3>Histórico</h3>
          <ol>
            {index.audits.map((item) => (
              <li key={item.slug} className={item.slug === audit.slug ? "is-current" : undefined}>
                <button type="button" onClick={() => setSlug(item.slug)}>
                  <span className="audits-timeline-date">{shortDate(item.date)}</span>
                  <span className="audits-timeline-title">{item.title}</span>
                  <span className="audits-timeline-summary">{item.summary}</span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}

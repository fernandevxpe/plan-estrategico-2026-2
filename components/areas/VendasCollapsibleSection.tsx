"use client";

import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

type Props = {
  id: string;
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  variant?: "default" | "priority" | "monitor";
};

export function VendasCollapsibleSection({
  id,
  title,
  subtitle,
  badge,
  open,
  onToggle,
  children,
  variant = "default"
}: Props) {
  return (
    <section className={`vendas-section vendas-section-${variant}`} id={id}>
      <button
        type="button"
        className={`vendas-section-trigger ${open ? "is-open" : ""}`}
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`${id}-panel`}
      >
        <span className="vendas-section-trigger-text">
          <span className="vendas-section-title">{title}</span>
          {subtitle && !open ? <span className="vendas-section-subtitle">{subtitle}</span> : null}
        </span>
        <span className="vendas-section-trigger-end">
          {badge}
          <ChevronDown size={18} className="vendas-section-chevron" aria-hidden />
        </span>
      </button>
      {open ? (
        <div className="vendas-section-panel" id={`${id}-panel`}>
          {subtitle && open ? <p className="vendas-section-panel-lead">{subtitle}</p> : null}
          {children}
        </div>
      ) : null}
    </section>
  );
}

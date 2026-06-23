"use client";

import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

type Props = {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
};

export function VendasInlineDetails({ title, children, defaultOpen = false }: Props) {
  return (
    <details className="vendas-inline-details" open={defaultOpen || undefined}>
      <summary>
        <span>{title}</span>
        <ChevronDown size={16} aria-hidden />
      </summary>
      <div className="vendas-inline-details-body">{children}</div>
    </details>
  );
}

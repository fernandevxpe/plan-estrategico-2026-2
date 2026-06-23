"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { AreasDashboard } from "@/lib/areas/types";
import { flattenAreasForNav } from "@/lib/areas/build-areas-dashboard";

type Props = {
  dashboard: AreasDashboard;
};

export function AreasSidebar({ dashboard }: Props) {
  const pathname = usePathname();
  const items = flattenAreasForNav(dashboard);

  return (
    <nav className="areas-nav" aria-label="Áreas">
      {items.map((item) => {
        const href = item.isOverview ? "/areas" : `/areas/${item.id}`;
        const active = item.isOverview ? pathname === "/areas" : pathname === href;
        return (
          <Link
            key={item.id}
            href={href}
            className={`areas-nav-item ${active ? "active" : ""} ${item.parentId ? "child" : ""}`}
          >
            {item.name}
          </Link>
        );
      })}
    </nav>
  );
}

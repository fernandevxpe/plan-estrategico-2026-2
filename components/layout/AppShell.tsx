import Link from "next/link";
import { AppNav } from "@/components/layout/AppNav";

type Props = {
  children: React.ReactNode;
};

export function AppShell({ children }: Props) {
  return (
    <main className="page">
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/" className="brand brand-link">
            <div className="brand-mark">XPE</div>
            <div>
              <p className="brand-title">Planejamento 2026.2</p>
              <p className="brand-subtitle">Pipedrive + ClickUp</p>
            </div>
          </Link>
          <AppNav />
        </div>
      </header>
      <div className="shell">{children}</div>
    </main>
  );
}

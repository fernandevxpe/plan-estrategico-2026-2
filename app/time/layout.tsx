import { AppShell } from "@/components/layout/AppShell";
import { TimeShell } from "@/components/time/TimeShell";

/**
 * O layout do app do time.
 *
 * Um layout e não seis páginas repetindo o mesmo casco: as abas e a moldura são
 * idênticas nas seis telas, e é a mudança de conteúdo que importa. Repetir o
 * casco por página é como a barra do financeiro divergiu entre telas antes de
 * existir o `FinShell`.
 */
export const dynamic = "force-dynamic";

export default function TimeLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <TimeShell>{children}</TimeShell>
    </AppShell>
  );
}

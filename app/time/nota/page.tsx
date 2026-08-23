import { redirect } from "next/navigation";

/** Nota e custo viraram um fluxo só — `/time/custo` registra foto, NF ou os dois. */
export default function TimeNotaPage() {
  redirect("/time/custo");
}

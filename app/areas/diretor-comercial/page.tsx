import { redirect } from "next/navigation";

/** URL antiga do painel CRM — agora vive em /areas/vendas. */
export default function DiretorComercialRedirectPage() {
  redirect("/areas/vendas");
}

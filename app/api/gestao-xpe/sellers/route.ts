import { listCrmSellers } from "@/lib/gestao-xpe/crm-deals-server";

export async function GET() {
  const sellers = await listCrmSellers();
  return Response.json({ sellers });
}

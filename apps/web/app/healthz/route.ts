/** Health check for the load balancer and Docker. Outside [locale], so no redirect and no page render. */
export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // process.uptime() is Node-only

export function GET() {
  const instance = process.env.INSTANCE_ID ?? "web";
  return Response.json({ status: "ok", instance, uptime: Math.round(process.uptime()) }, { headers: { "X-Instance": instance, "Cache-Control": "no-store" } });
}

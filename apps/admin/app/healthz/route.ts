/** Health check for the load balancer and Docker. Outside the (panel) group, so no sign-in is needed. */
export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // process.uptime() is Node-only

export function GET() {
  const instance = process.env.INSTANCE_ID ?? "admin";
  return Response.json({ status: "ok", instance, uptime: Math.round(process.uptime()) }, { headers: { "X-Instance": instance, "Cache-Control": "no-store" } });
}

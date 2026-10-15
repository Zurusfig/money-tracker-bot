import { config } from "@/lib/config";
import { isAuthorized } from "@/lib/dashAuth";
import { loadDashData, parseRange } from "@/lib/dashData";
import { demoData } from "@/lib/dashDemo";
import { GoogleSheets } from "@/lib/sheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request) {
  if (!isAuthorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  let range;
  try {
    range = parseRange(url.searchParams.get("from"), url.searchParams.get("to"));
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
  try {
    const data = config.dashDemo ? demoData(range.from, range.to) : await loadDashData(new GoogleSheets(), range.from, range.to);
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("dash data", err);
    return Response.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}

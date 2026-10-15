import { config } from "@/lib/config";
import { isAuthorized } from "@/lib/dashAuth";
import { saveBudget } from "@/lib/dashData";
import { demoSaveBudget } from "@/lib/dashDemo";
import { GoogleSheets } from "@/lib/sheets";

export const runtime = "nodejs";

export async function PUT(req: Request) {
  if (!isAuthorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { category, target } = (await req.json().catch(() => ({}))) as { category?: unknown; target?: unknown };
  const cat = typeof category === "string" ? category.trim() : "";
  const t = typeof target === "number" ? target : Number(target);
  if (!cat || cat.length > 40 || /^[=+\-@]/.test(cat)) return Response.json({ error: "bad category" }, { status: 400 });
  if (!Number.isFinite(t) || t < 0 || t > 10_000_000) return Response.json({ error: "bad target" }, { status: 400 });
  try {
    if (config.dashDemo) demoSaveBudget(cat, t);
    else await saveBudget(new GoogleSheets(), cat, t);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}

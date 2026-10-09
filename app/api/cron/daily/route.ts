import { reportError } from "@/lib/bot";
import { config } from "@/lib/config";
import { realDeps } from "@/lib/deps";
import { buildDigest } from "@/lib/digest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${config.cronSecret}`) {
    return new Response("unauthorized", { status: 401 });
  }
  const deps = realDeps();
  try {
    const digest = await buildDigest(deps.sheets);
    await deps.notify.post(digest);
    return Response.json({ ok: true });
  } catch (err) {
    await reportError(deps, "cron digest", err instanceof Error ? err.message : String(err));
    return Response.json({ ok: false }, { status: 500 });
  }
}

import { handleEvent, type LineEvent } from "@/lib/bot";
import { config } from "@/lib/config";
import { realDeps } from "@/lib/deps";
import { verifySignature } from "@/lib/line";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-line-signature"), config.lineChannelSecret)) {
    return new Response("bad signature", { status: 401 });
  }
  const body = JSON.parse(raw) as { events?: LineEvent[] };
  const owner = config.lineUserId;
  const events = body.events ?? [];
  const mine = events.filter((ev) => ev.source?.userId === owner);
  for (const ev of events) {
    if (ev.source?.userId !== owner) console.warn(`ignored ${ev.type} from userId=${ev.source?.userId ?? "none"} (LINE_USER_ID=${owner})`);
  }
  if (mine.length) {
    const deps = realDeps();
    // Sequential so two quick messages don't race for the same row
    for (const ev of mine) await handleEvent(deps, ev, owner);
  }
  return Response.json({ ok: true });
}

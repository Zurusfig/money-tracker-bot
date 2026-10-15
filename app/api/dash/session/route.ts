import { config } from "@/lib/config";
import { sessionCookie, signSession, verifyLineIdToken } from "@/lib/dashAuth";

export const runtime = "nodejs";

// LIFF sends its ID token once; we answer with a 30-day session cookie
export async function POST(req: Request) {
  if (config.dashDemo) return Response.json({ ok: true, demo: true });
  const { idToken } = (await req.json().catch(() => ({}))) as { idToken?: string };
  if (!idToken) return Response.json({ ok: false, error: "missing token" }, { status: 400 });
  let sub: string;
  try {
    sub = await verifyLineIdToken(idToken);
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : "invalid token" }, { status: 401 });
  }
  if (sub !== config.lineUserId) {
    console.warn(`dashboard: refused userId=${sub}`);
    return Response.json({ ok: false, error: "not allowed" }, { status: 403 });
  }
  return Response.json({ ok: true }, { headers: { "Set-Cookie": sessionCookie(signSession(sub)) } });
}

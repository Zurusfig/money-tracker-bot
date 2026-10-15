import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config";

export const SESSION_COOKIE = "mt_session";
export const SESSION_DAYS = 30;

function key(): Buffer {
  // Derived so the dashboard needs no extra secret; rotating the channel secret logs everyone out
  return createHmac("sha256", config.lineChannelSecret).update("dashboard-session-v1").digest();
}

export function signSession(sub: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ sub, exp: now + SESSION_DAYS * 86400000 })).toString("base64url");
  const sig = createHmac("sha256", key()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifySession(token: string | undefined, now = Date.now()): string | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", key()).update(payload).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const { sub, exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub: string; exp: number };
    return exp > now && sub === config.lineUserId ? sub : null;
  } catch {
    return null;
  }
}

// LINE checks the LIFF ID token's signature, audience and expiry for us
export async function verifyLineIdToken(idToken: string): Promise<string> {
  const res = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token: idToken, client_id: config.lineLoginChannelId }),
  });
  const json = (await res.json()) as { sub?: string; error_description?: string };
  if (!res.ok || !json.sub) throw new Error(json.error_description ?? `LINE verify ${res.status}`);
  return json.sub;
}

function cookieValue(req: Request, name: string): string | undefined {
  const raw = req.headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export function isAuthorized(req: Request): boolean {
  if (config.dashDemo) return true;
  return verifySession(cookieValue(req, SESSION_COOKIE)) !== null;
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}

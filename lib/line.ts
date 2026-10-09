import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config";

export function verifySignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  let given: Buffer;
  try {
    given = Buffer.from(signature, "base64");
  } catch {
    return false;
  }
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export type QuickItem = { label: string; data?: string; text?: string };
export type LineMessage = {
  type: "text";
  text: string;
  quickReply?: { items: unknown[] };
};

export function text(body: string, quick: QuickItem[] = []): LineMessage {
  const msg: LineMessage = { type: "text", text: body.slice(0, 4900) };
  if (quick.length) {
    msg.quickReply = {
      items: quick.slice(0, 13).map((q) => ({
        type: "action",
        action: q.data
          ? { type: "postback", label: q.label.slice(0, 20), data: q.data.slice(0, 300), displayText: q.label.slice(0, 300) }
          : { type: "message", label: q.label.slice(0, 20), text: q.text ?? q.label },
      })),
    };
  }
  return msg;
}

// Reply-only: the free plan caps push messages.
export interface LineApi {
  reply(replyToken: string, messages: LineMessage[]): Promise<void>;
  getContent(messageId: string): Promise<{ data: Buffer; mimeType: string }>;
}

export class LineClient implements LineApi {
  async reply(replyToken: string, messages: LineMessage[]): Promise<void> {
    const res = await fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.lineAccessToken}` },
      body: JSON.stringify({ replyToken, messages: messages.slice(0, 5) }),
    });
    if (!res.ok) throw new Error(`LINE reply ${res.status}: ${await res.text()}`);
  }

  async getContent(messageId: string): Promise<{ data: Buffer; mimeType: string }> {
    const res = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
      headers: { Authorization: `Bearer ${config.lineAccessToken}` },
    });
    if (!res.ok) throw new Error(`LINE content ${res.status}`);
    return { data: Buffer.from(await res.arrayBuffer()), mimeType: res.headers.get("content-type") ?? "image/jpeg" };
  }
}

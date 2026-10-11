import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { vi } from "vitest";
import type { Deps, LineEvent } from "@/lib/bot";
import type { Embed } from "@/lib/discord";
import type { Ai, SlipData } from "@/lib/gemini";
import type { LineMessage } from "@/lib/line";
import { FakeSheets, type TabDump } from "./fakeSheets";
import { loadXlsx } from "./loadXlsx";

export const REAL_XLSX = path.resolve(__dirname, "../reference/Budget_V3_1.xlsx");
export const hasRealWorkbook = existsSync(REAL_XLSX);

export function fixture(): FakeSheets {
  const dump = JSON.parse(readFileSync(path.resolve(__dirname, "fixtures/workbook.json"), "utf8")) as TabDump[];
  return FakeSheets.from(dump);
}

export async function realWorkbook(): Promise<FakeSheets> {
  return FakeSheets.from(await loadXlsx(REAL_XLSX, ["Budget", "2026 Q4", "2026 Q3", "_Template"]));
}

export const OWNER = "Uowner";

export function slip(over: Partial<{ [K in keyof SlipData]: SlipData[K] extends { value: infer V } ? V | [V, number] : SlipData[K] }> = {}): SlipData {
  const f = <T,>(v: T | [T, number], def: T): { value: T; confidence: number } =>
    Array.isArray(v) ? { value: v[0], confidence: v[1] } : { value: (v ?? def) as T, confidence: 0.99 };
  return {
    is_slip: (over.is_slip as boolean) ?? true,
    amount: f(over.amount as number, 250),
    source_bank: f(over.source_bank as string, "K PLUS"),
    recipient_name: f(over.recipient_name as string, "Some Shop"),
    recipient_account: f(over.recipient_account as string, "xxx-x-x9999-x"),
    datetime: f(over.datetime as string, "2026-10-09 12:30"),
    transaction_ref: f(over.transaction_ref as string, "015282123456ABC1234"),
    category: f(over.category as string, "Shopping"),
  };
}

export function makeDeps(sheets: FakeSheets, nowIso = "2026-10-09T05:00:00Z") {
  const replies: LineMessage[][] = [];
  const posts: string[] = [];
  const embeds: Embed[] = [];
  const ai = {
    categorize: vi.fn<Ai["categorize"]>(async () => ({ category: "", confidence: 0 })),
    readSlip: vi.fn<Ai["readSlip"]>(async () => slip()),
  };
  const deps: Deps = {
    sheets,
    ai,
    line: {
      reply: async (_t, m) => void replies.push(m),
      getContent: async () => ({ data: Buffer.from("img"), mimeType: "image/jpeg" }),
    },
    notify: { post: async (c) => void posts.push(c), postEmbed: async (e) => void embeds.push(e), enabled: true },
    now: () => new Date(nowIso),
  };
  return { deps, replies, posts, embeds, ai };
}

let n = 1000;
export function textEvent(t: string, id = String(n++), user = OWNER): LineEvent {
  return { type: "message", replyToken: "rt", source: { userId: user }, message: { id, type: "text", text: t } };
}
export function imageEvent(id = String(n++)): LineEvent {
  return { type: "message", replyToken: "rt", source: { userId: OWNER }, message: { id, type: "image" } };
}
export function postbackEvent(data: string): LineEvent {
  return { type: "postback", replyToken: "rt", source: { userId: OWNER }, postback: { data } };
}
export function lastText(replies: LineMessage[][]): string {
  return replies[replies.length - 1][0].text;
}
export function quick(replies: LineMessage[][]): { label: string; data?: string }[] {
  const items = (replies[replies.length - 1][0].quickReply?.items ?? []) as { action: { label: string; data?: string } }[];
  return items.map((i) => ({ label: i.action.label, data: i.action.data }));
}

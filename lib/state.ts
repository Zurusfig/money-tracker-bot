import { Accounts, seedAccounts, type AccountDef, type AccountName } from "./accounts";
import { get, q, type SheetsApi } from "./sheets";
import { bkkToday, isoDate } from "./time";

export const RULES = "_Rules";
export const ACCOUNTS_TAB = "_Accounts";
export const BOTLOG = "_BotLog";
export const CONFIG = "_Config";
const CONFIG_HEADER = ["Code", "Account (row 18 header)", "Default (x)", "bal category (blank = Untracked)", "Also called (comma separated)", "Slip names (comma separated)"];

const HEADERS: Record<string, string[]> = {
  [RULES]: ["Keyword", "Category", "Updated"],
  [ACCOUNTS_TAB]: ["Match (name or account number digits)", "Account", "Note"],
  [BOTLOG]: ["Timestamp", "Date", "Kind", "Tab", "ID", "Detail"],
};

export async function ensureBotTabs(api: SheetsApi): Promise<void> {
  const tabs = await api.listTabs();
  if (!tabs.some((t) => t.title === CONFIG)) await seedConfig(api);
  for (const [title, header] of Object.entries(HEADERS)) {
    if (tabs.some((t) => t.title === title)) continue;
    await api.addSheet(title, true);
    await api.update(`${q(title)}!A1`, [header]);
  }
}

// --- Config (accounts) ---

// First run: build _Config from the _Template row 18 account headers (E onward).
async function seedConfig(api: SheetsApi): Promise<void> {
  const [header] = await api.batchGet([`${q("_Template")}!A18:N18`]);
  const names = (header[0] ?? []).slice(4).map((h) => String(h ?? "").trim()).filter(Boolean);
  if (!names.length) throw new Error("_Template row 18 has no account headers (E18 onward)");
  const defs = seedAccounts(names);
  await api.addSheet(CONFIG, false);
  await api.update(`${q(CONFIG)}!A1:F${defs.length + 1}`, [CONFIG_HEADER, ...defs.map(configRow)]);
}

function configRow(a: AccountDef) {
  return [a.code, a.name, a.isDefault ? "x" : "", a.balCategory, a.aliases.join(", "), a.slipNames.join(", ")];
}

const list = (v: unknown) => String(v ?? "").split(",").map((x) => x.trim()).filter(Boolean);

export async function readAccounts(api: SheetsApi): Promise<Accounts> {
  const rows = await get(api, `${q(CONFIG)}!A2:F`);
  const defs: AccountDef[] = rows
    .filter((r) => String(r[0] ?? "").trim() || String(r[1] ?? "").trim())
    .map((r) => ({
      code: String(r[0] ?? "").trim().toLowerCase(),
      name: String(r[1] ?? "").trim(),
      isDefault: /^(x|y|yes|true|1)$/i.test(String(r[2] ?? "").trim()),
      balCategory: String(r[3] ?? "").trim(),
      aliases: list(r[4]),
      slipNames: list(r[5]),
    }));
  return new Accounts(defs);
}

// --- Rules ---

export type Rule = { keyword: string; category: string; row: number };

export function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

export async function readRules(api: SheetsApi): Promise<Rule[]> {
  const rows = await get(api, `${q(RULES)}!A2:B`);
  return rows
    .map((r, i) => ({ keyword: normalize(String(r[0] ?? "")), category: String(r[1] ?? "").trim(), row: i + 2 }))
    .filter((r) => r.keyword && r.category);
}

// Exact description match first, then the longest keyword found as whole words.
export function matchRule(rules: Rule[], description: string, categories: string[]): string | null {
  const d = normalize(description);
  if (!d) return null;
  const valid = (c: string) => categories.includes(c);
  const exact = rules.find((r) => r.keyword === d && valid(r.category));
  if (exact) return exact.category;
  const padded = ` ${d} `;
  const hits = rules.filter((r) => valid(r.category) && padded.includes(` ${r.keyword} `));
  hits.sort((a, b) => b.keyword.length - a.keyword.length);
  return hits[0]?.category ?? null;
}

// "coffee" -> "Coffee & Tea", "food" -> "Food & Drinks"
export function matchCategoryName(description: string, categories: string[]): string | null {
  const d = normalize(description);
  if (!d) return null;
  const exact = categories.find((c) => normalize(c) === d);
  if (exact) return exact;
  const words = d.split(" ");
  const hits = categories.filter((c) =>
    normalize(c).split(/[^a-z0-9]+/).filter(Boolean).some((w) => words.includes(w)),
  );
  return hits.length === 1 ? hits[0] : null;
}

export async function saveRule(api: SheetsApi, keyword: string, category: string): Promise<void> {
  const k = normalize(keyword);
  if (!k) return;
  const rules = await readRules(api);
  const existing = rules.find((r) => r.keyword === k);
  const row = [k, category, isoDate(bkkToday())];
  if (existing) await api.update(`${q(RULES)}!A${existing.row}:C${existing.row}`, [row]);
  else await api.append(`${q(RULES)}!A:C`, [row]);
}

// --- Own accounts (transfer detection) ---

export type OwnAccount = { match: string; account: AccountName };

export async function readOwnAccounts(api: SheetsApi, acc: Accounts): Promise<OwnAccount[]> {
  const rows = await get(api, `${q(ACCOUNTS_TAB)}!A2:B`);
  const out: OwnAccount[] = [];
  for (const r of rows) {
    const match = String(r[0] ?? "").trim();
    const account = acc.fromLoose(String(r[1] ?? ""));
    if (match && account) out.push({ match, account });
  }
  return out;
}

function digits(s: string) {
  return s.replace(/\D/g, "");
}

// Slips mask account numbers (xxx-x-x1234-x), so digit patterns match as substrings.
export function matchOwnAccount(own: OwnAccount[], recipientName: string, recipientAccount: string): AccountName | null {
  const name = normalize(recipientName);
  const acct = digits(recipientAccount);
  for (const o of own) {
    const md = digits(o.match);
    if (md.length >= 4 && md === o.match.replace(/[\s-]/g, "")) {
      if (acct.length >= 4 && (acct.includes(md) || md.includes(acct))) return o.account;
    } else if (name && name.includes(normalize(o.match))) {
      return o.account;
    }
  }
  return null;
}

// --- Bot log ---

export type LogKind = "write" | "undo" | "delete" | "nospend" | "error" | "lowconf" | "edit" | "bal";
export type LogRow = { ts: string; date: string; kind: LogKind; tab: string; id: string; detail: string };

export async function log(api: SheetsApi, kind: LogKind, tab: string, id: string, detail = ""): Promise<void> {
  await api.append(`${q(BOTLOG)}!A:F`, [[`'${new Date().toISOString()}`, `'${isoDate(bkkToday())}`, kind, tab, `'${id}`, `'${detail.slice(0, 500)}`]]);
}

export async function readLog(api: SheetsApi): Promise<LogRow[]> {
  const rows = await get(api, `${q(BOTLOG)}!A2:F`);
  return rows.map((r) => ({
    ts: String(r[0] ?? ""),
    date: String(r[1] ?? ""),
    kind: String(r[2] ?? "") as LogKind,
    tab: String(r[3] ?? ""),
    id: String(r[4] ?? ""),
    detail: String(r[5] ?? ""),
  }));
}

// undo/delete entries: id = removed row ID, detail = the command that removed it.
// Most recent bot-written row that hasn't been undone or deleted.
export function lastLiveWrite(entries: LogRow[]): LogRow | null {
  const gone = new Set(entries.filter((e) => e.kind === "undo" || e.kind === "delete").map((e) => e.id));
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.kind === "write" && !gone.has(e.id)) return e;
  }
  return null;
}

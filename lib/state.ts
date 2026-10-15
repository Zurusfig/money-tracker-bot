import { Accounts, seedAccounts, type AccountDef, type AccountName } from "./accounts";
import type { Check } from "./accuracy";
import { get, q, type SheetsApi } from "./sheets";
import { bkkToday, isoDate } from "./time";

export const RULES = "_Rules";
export const ACCOUNTS_TAB = "_Accounts";
export const BOTLOG = "_BotLog";
export const CONFIG = "_Config";
export const BUDGET = "_Budget";
export const CHECKS = "_Checks";
const CONFIG_HEADER = ["Code", "Account (row 18 header)", "Default (x)", "bal category (blank = Untracked)", "Also called (comma separated)", "Slip names (comma separated)"];

const HEADERS: Record<string, string[]> = {
  [RULES]: ["Keyword", "Category", "Updated"],
  [ACCOUNTS_TAB]: ["Match (name or account number digits)", "Account", "Note"],
  [BOTLOG]: ["Timestamp", "Date", "Kind", "Tab", "ID", "Detail"],
  [CHECKS]: ["Date", "Account", "Sheet balance", "Real balance", "Gap", "ID"],
};

export async function ensureBotTabs(api: SheetsApi): Promise<void> {
  const tabs = await api.listTabs();
  if (!tabs.some((t) => t.title === CONFIG)) await seedConfig(api);
  if (!tabs.some((t) => t.title === BUDGET)) await seedBudget(api, tabs.some((t) => t.title === "Budget"));
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

// --- Budget targets (_Budget: category | monthly target) ---

// First run: copy names and targets out of the Budget tab (B6:C25), which may be formulas.
async function seedBudget(api: SheetsApi, hasBudgetTab: boolean): Promise<void> {
  const rows = hasBudgetTab ? await get(api, "Budget!B6:C25") : [];
  const seen = new Set<string>();
  const out: (string | number)[][] = [];
  for (const [name, target] of rows) {
    const cat = String(name ?? "").trim();
    const t = typeof target === "number" ? target : Number(target);
    if (cat && t > 0 && !seen.has(cat)) {
      seen.add(cat);
      out.push([cat, t]);
    }
  }
  await api.addSheet(BUDGET, false);
  await api.update(`${q(BUDGET)}!A1:B${out.length + 1}`, [["Category", "Monthly target"], ...out]);
}

export async function readBudgetTab(api: SheetsApi): Promise<Map<string, { row: number; target: number }>> {
  const rows = await get(api, `${q(BUDGET)}!A2:B`);
  const out = new Map<string, { row: number; target: number }>();
  rows.forEach((r, i) => {
    const cat = String(r[0] ?? "").trim();
    const t = typeof r[1] === "number" ? r[1] : Number(r[1]);
    if (cat && !out.has(cat)) out.set(cat, { row: i + 2, target: Number.isFinite(t) ? t : 0 });
  });
  return out;
}

// target 0 removes the target (keeps the row so its position is stable)
export async function setBudgetTarget(api: SheetsApi, category: string, target: number): Promise<void> {
  const existing = (await readBudgetTab(api)).get(category);
  const value = target > 0 ? Math.round(target * 100) / 100 : "";
  if (existing) await api.update(`${q(BUDGET)}!B${existing.row}`, [[value]]);
  else if (target > 0) await api.append(`${q(BUDGET)}!A:B`, [[category, value]]);
}

// --- Balance checks (one row per `bal <code> <amount>`, including exact matches) ---

export async function readChecks(api: SheetsApi): Promise<Check[]> {
  if (!(await api.listTabs()).some((t) => t.title === CHECKS)) return [];
  const rows = await get(api, `${q(CHECKS)}!A2:F`);
  return rows
    .map((r) => ({
      date: String(r[0] ?? ""),
      account: String(r[1] ?? ""),
      sheet: Number(r[2]) || 0,
      real: Number(r[3]) || 0,
      gap: Number(r[4]) || 0,
      id: String(r[5] ?? ""),
    }))
    .filter((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.date) && c.account);
}

export async function addCheck(api: SheetsApi, c: Check): Promise<void> {
  await api.append(`${q(CHECKS)}!A:F`, [[`'${c.date}`, c.account, c.sheet, c.real, c.gap, `'${c.id}`]]);
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

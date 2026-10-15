// "Usable" money: the accounts summed in the quarter tab's K2 ("Sum of Usable"), e.g. =SUM(C2:C4,C6:C7,C9:C12).
import type { AccountName, Accounts } from "./accounts";
import { spentOf, type Tx } from "./dash";
import { get, q, type SheetsApi } from "./sheets";
import { addDays, isoDate, prevQuarterTabName, quarterTabName, type Ymd } from "./time";
import { allRows, readBalances, readQuarter } from "./workbook";

export type BalanceLine = { name: AccountName; code: string; value: number; usable: boolean };
export type UsableInfo = {
  lines: BalanceLine[]; // _Config order
  usable: number;
  total: number;
  source: "sheet" | "default"; // K2 formula, or "everything except savings" when K2 isn't a plain SUM of C cells
};

// Rows referenced as C cells inside K2, or null when K2 isn't a plain SUM of C cells/ranges
export function parseUsableRows(formula: unknown): number[] | null {
  if (typeof formula !== "string") return null;
  const m = /^=\s*SUM\((.*)\)\s*$/i.exec(formula.trim());
  if (!m) return null;
  const rows: number[] = [];
  for (const part of m[1].split(",")) {
    const r = /^\s*\$?C\$?(\d+)(?:\s*:\s*\$?C\$?(\d+))?\s*$/i.exec(part);
    if (!r) return null;
    const a = Number(r[1]);
    const b = r[2] ? Number(r[2]) : a;
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) rows.push(i);
  }
  return rows.length ? rows : null;
}

const round = (n: number) => Math.round(n * 100) / 100;

export async function readUsable(api: SheetsApi, tab: string, acc: Accounts): Promise<UsableInfo> {
  const [bal, k2] = await Promise.all([readBalances(api, tab, acc), get(api, `${q(tab)}!K2`, "FORMULA")]);
  const rows = parseUsableRows(k2[0]?.[0]);
  const lines: BalanceLine[] = acc.list
    .filter((a) => bal.has(a.name))
    .map((a) => {
      const b = bal.get(a.name)!;
      return { name: a.name, code: a.code, value: b.value, usable: rows ? rows.includes(b.row) : !/saving/i.test(a.name) };
    });
  return {
    lines,
    usable: round(lines.filter((l) => l.usable).reduce((s, l) => s + l.value, 0)),
    total: round(lines.reduce((s, l) => s + l.value, 0)),
    source: rows ? "sheet" : "default",
  };
}

// Rows from this and last quarter's tabs as plain transactions (older layouts skipped)
export async function recentTxs(api: SheetsApi, acc: Accounts, today: Ymd): Promise<Tx[]> {
  const titles = new Set((await api.listTabs()).map((t) => t.title));
  const out: Tx[] = [];
  for (const tab of [prevQuarterTabName(today), quarterTabName(today)]) {
    if (!titles.has(tab)) continue;
    try {
      for (const r of allRows(await readQuarter(api, tab, acc))) {
        out.push({ date: isoDate(r.date), type: r.type, category: r.category, description: r.description, amounts: r.amounts as Record<string, number>, tab, row: r.row });
      }
    } catch {
      // older layout: skip
    }
  }
  return out;
}

// Average net spend per day over the last `days` days (today included)
export async function recentDailySpend(api: SheetsApi, acc: Accounts, today: Ymd, days = 30, txs?: Tx[]): Promise<number> {
  const from = isoDate(addDays(today, -(days - 1)));
  const to = isoDate(today);
  const rows = (txs ?? (await recentTxs(api, acc, today))).filter((t) => t.date >= from && t.date <= to);
  return Math.max(0, spentOf(rows) / days);
}

// Whole days the usable money lasts at a daily spend; null when it can't be estimated
export function runwayDays(usable: number, perDay: number): number | null {
  if (!(perDay > 0) || usable <= 0) return usable <= 0 ? 0 : null;
  return Math.floor(usable / perDay);
}

export function runwayText(usable: number, perDay: number): string {
  const days = runwayDays(usable, perDay);
  if (days === null) return "no recent spending to estimate from";
  return `lasts ~${days} ${days === 1 ? "day" : "days"} at ฿${Math.round(perDay).toLocaleString("en-US")}/day (30-day average)`;
}

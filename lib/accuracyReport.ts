// Server side: gathers rows + checks and turns lib/accuracy numbers into text for LINE / Discord.
import { accuracyOf, ago, daysApart, drift, lastChecked, missRates, monthly, pct, type Accuracy, type Check, type Drift, type MonthAccuracy } from "./accuracy";
import type { Accounts } from "./accounts";
import type { Tx } from "./dash";
import type { SheetsApi } from "./sheets";
import { readChecks } from "./state";
import { MONTHS, isoDate, quarterTabName, type Ymd } from "./time";
import { readUsable, recentTxs } from "./usable";

export const STALE_DAYS = 14;

export type Report = {
  today: string;
  month: Accuracy;
  months: MonthAccuracy[]; // last 3, oldest first
  usableAccounts: string[];
  last: Map<string, string | null>;
  drift: Drift;
  missPerDay: number; // usable accounts combined
};

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const monName = (ym: string) => MONTHS[Number(ym.slice(5)) - 1].slice(0, 3).replace(/^./, (c) => c.toUpperCase());

function lastMonths(today: string, n: number): string[] {
  let y = Number(today.slice(0, 4));
  let m = Number(today.slice(5, 7));
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.unshift(`${y}-${String(m).padStart(2, "0")}`);
    if (--m === 0) {
      m = 12;
      y--;
    }
  }
  return out;
}

export async function buildReport(api: SheetsApi, acc: Accounts, todayY: Ymd, given?: { txs?: Tx[]; checks?: Check[] }): Promise<Report> {
  const today = isoDate(todayY);
  const txs = given?.txs ?? (await recentTxs(api, acc, todayY));
  const checks = given?.checks ?? (await readChecks(api));
  const tab = quarterTabName(todayY);
  const hasTab = (await api.listTabs()).some((t) => t.title === tab);
  const usableAccounts = hasTab
    ? (await readUsable(api, tab, acc)).lines.filter((l) => l.usable).map((l) => l.name)
    : acc.list.filter((a) => !/saving/i.test(a.name)).map((a) => a.name);
  const last = lastChecked(checks, txs, acc.list.map((a) => a.name));
  const rates = missRates(txs, today);
  return {
    today,
    month: accuracyOf(txs, `${today.slice(0, 7)}-01`, today),
    months: monthly(txs, lastMonths(today, 3)),
    usableAccounts,
    last,
    drift: drift(usableAccounts, last, rates, today),
    missPerDay: usableAccounts.reduce((s, a) => s + (rates.get(a) ?? 0), 0),
  };
}

export function driftLine(r: Report): string {
  const parts: string[] = [];
  if (r.drift.amount > 0) parts.push(`Usable could be ~฿${fmt(r.drift.amount)} lower than the sheet says (you usually miss ~฿${fmt(r.missPerDay)}/day).`);
  else if (r.drift.byAccount.length) parts.push("Usable is probably accurate: no recent gaps on the accounts you checked.");
  if (r.drift.neverChecked.length) parts.push(`Never checked: ${r.drift.neverChecked.join(", ")}.`);
  return parts.join(" ");
}

export function monthLine(r: Report): string {
  return r.months.map((m) => `${monName(m.month)} ${pct(m.captured)}`).join(" · ");
}

// Full answer for the `missed` command
export function reportText(r: Report, defaultCode: string): string {
  const m = r.month;
  const stale = (d: string | null) => !d || daysApart(d, r.today) > STALE_DAYS;
  return [
    "📏 Logging accuracy",
    m.captured === null ? "This month: nothing to judge yet" : `This month: ${pct(m.captured)} captured`,
    `฿${fmt(m.logged)} logged · ฿${fmt(m.unlogged)} unlogged${m.extra > 0 ? ` · ฿${fmt(m.extra)} extra` : ""}`,
    "",
    monthLine(r),
    "",
    "Last checked (usable accounts)",
    ...r.usableAccounts.map((a) => `${a}: ${ago(r.last.get(a) ?? null, r.today)}${stale(r.last.get(a) ?? null) ? " ⚠️" : ""}`),
    "",
    driftLine(r),
    `Check one: bal ${defaultCode} <real amount>`,
  ].join("\n");
}

// What `bal` adds after a check: how much of that account's spending was logged since its previous check
export function checkLine(account: string, prev: string | null, today: string, a: Accuracy, gap: number): string {
  if (!prev) return `📏 First check for ${account}. From the next check on, I'll show how much slipped through.`;
  const since = `since last check ${ago(prev, today)}`;
  if (gap >= 0 && a.unlogged === 0) {
    return `📏 ${since[0].toUpperCase()}${since.slice(1)}: ฿${fmt(a.logged)} logged, nothing missing → 100% captured.`;
  }
  return `📏 ${since[0].toUpperCase()}${since.slice(1)}: ฿${fmt(a.logged)} logged, ฿${fmt(a.unlogged)} unlogged → ${pct(a.captured)} captured.`;
}

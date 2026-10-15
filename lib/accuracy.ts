// How much spending slips past logging. Pure functions over rows; runs in the browser too.
//
// "Gap" rows are corrections, not real purchases: Type "Recalibrate" (manual), and rows the
// `bal` command writes (description "bal check", usually category Untracked).
// Money that left an account without a row = negative gap amounts ("unlogged").
// Money that showed up without a row = positive gap amounts ("extra": unlogged income/refunds or double-logging).
import type { Tx } from "./dash";

export type Check = { date: string; account: string; sheet: number; real: number; gap: number; id: string };

const DAY = 86400000;
const round = (n: number) => Math.round(n * 100) / 100;

export function isGapRow(t: Pick<Tx, "type" | "category" | "description">): boolean {
  return t.type === "Recalibrate" || t.description.trim().toLowerCase() === "bal check";
}

export function daysApart(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
}

export type Accuracy = {
  logged: number; // net spending you logged (expenses minus refunds), gap rows excluded
  unlogged: number; // money that left without a row
  extra: number; // money that appeared without a row
  captured: number | null; // logged / (logged + unlogged), null when there's nothing to judge
};

// accounts: limit to these accounts (e.g. one account since its last check)
export function accuracyOf(txs: Tx[], from: string, to: string, accounts?: string[]): Accuracy {
  const only = accounts ? new Set(accounts) : null;
  let logged = 0;
  let unlogged = 0;
  let extra = 0;
  for (const t of txs) {
    if (t.date < from || t.date > to) continue;
    for (const [a, v] of Object.entries(t.amounts)) {
      if (only && !only.has(a)) continue;
      if (isGapRow(t)) {
        if (v < 0) unlogged -= v;
        else extra += v;
      } else if (t.type === "Expense") {
        logged -= v;
      }
    }
  }
  logged = Math.max(0, round(logged));
  unlogged = round(unlogged);
  const base = logged + unlogged;
  return { logged, unlogged, extra: round(extra), captured: base > 0 ? logged / base : null };
}

export type MonthAccuracy = Accuracy & { month: string }; // YYYY-MM

export function monthly(txs: Tx[], months: string[]): MonthAccuracy[] {
  return months.map((m) => ({ month: m, ...accuracyOf(txs, `${m}-01`, `${m}-31`) }));
}

// Last date each account was confirmed against reality: a `bal` check, or a manual Recalibrate row touching it
export function lastChecked(checks: Check[], txs: Tx[], accounts: string[]): Map<string, string | null> {
  const out = new Map<string, string | null>(accounts.map((a) => [a, null]));
  const see = (a: string, date: string) => {
    if (!out.has(a)) return;
    const cur = out.get(a);
    if (!cur || date > cur) out.set(a, date);
  };
  for (const c of checks) see(c.account, c.date);
  for (const t of txs) if (t.type === "Recalibrate") for (const a of Object.keys(t.amounts)) see(a, t.date);
  return out;
}

// Typical unlogged money per day for each account over the last `days` days
export function missRates(txs: Tx[], today: string, days = 90): Map<string, number> {
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - (days - 1) * DAY).toISOString().slice(0, 10);
  const out = new Map<string, number>();
  for (const t of txs) {
    if (!isGapRow(t) || t.date < from || t.date > today) continue;
    for (const [a, v] of Object.entries(t.amounts)) if (v < 0) out.set(a, (out.get(a) ?? 0) - v);
  }
  for (const [a, v] of out) out.set(a, v / days);
  return out;
}

export type Drift = { amount: number; byAccount: { account: string; days: number; amount: number }[]; neverChecked: string[] };

// How far a balance may have drifted since its last check, at the usual miss rate
export function drift(accounts: string[], last: Map<string, string | null>, rates: Map<string, number>, today: string): Drift {
  const byAccount: Drift["byAccount"] = [];
  const neverChecked: string[] = [];
  for (const a of accounts) {
    const d = last.get(a);
    if (!d) {
      neverChecked.push(a);
      continue;
    }
    const days = Math.max(0, daysApart(d, today));
    const amount = Math.round((rates.get(a) ?? 0) * days);
    byAccount.push({ account: a, days, amount });
  }
  return { amount: byAccount.reduce((s, x) => s + x.amount, 0), byAccount, neverChecked };
}

export function pct(captured: number | null): string {
  return captured === null ? "–" : `${Math.round(captured * 100)}%`;
}

export function ago(date: string | null, today: string): string {
  if (!date) return "never";
  const d = daysApart(date, today);
  return d <= 0 ? "today" : d === 1 ? "1 day ago" : `${d} days ago`;
}

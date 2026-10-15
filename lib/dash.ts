// Pure dashboard math. Runs in the browser and in tests; no Node or Sheets imports.
import { MONTHS, addDays, daysInMonth, isoDate, parseIso, quarterOf, weekdayOf, type Ymd } from "./time";

export type Tx = {
  date: string; // YYYY-MM-DD
  type: string;
  category: string;
  description: string;
  amounts: Record<string, number>;
  tab: string;
  row: number;
};

export type View = "day" | "week" | "month" | "quarter" | "year";
export type Period = { view: View; from: Ymd; to: Ymd };
export type Grain = "day" | "week" | "month";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const mon = (m: number) => MONTHS[m - 1].slice(0, 1).toUpperCase() + MONTHS[m - 1].slice(1, 3);

export function ymd(s: string): Ymd {
  return parseIso(s)!;
}

export function cmp(a: Ymd, b: Ymd): number {
  return isoDate(a) < isoDate(b) ? -1 : isoDate(a) > isoDate(b) ? 1 : 0;
}

const minY = (a: Ymd, b: Ymd) => (cmp(a, b) <= 0 ? a : b);
const maxY = (a: Ymd, b: Ymd) => (cmp(a, b) >= 0 ? a : b);

export function daysBetween(a: Ymd, b: Ymd): number {
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000);
}

function addMonths(d: Ymd, n: number): Ymd {
  const t = d.y * 12 + (d.m - 1) + n;
  const y = Math.floor(t / 12);
  const m = (t % 12) + 1;
  return { y, m, d: Math.min(d.d, daysInMonth(y, m)) };
}

export function periodOf(view: View, anchor: Ymd): Period {
  switch (view) {
    case "day":
      return { view, from: anchor, to: anchor };
    case "week": {
      const from = addDays(anchor, -((weekdayOf(anchor) + 6) % 7));
      return { view, from, to: addDays(from, 6) };
    }
    case "month":
      return { view, from: { ...anchor, d: 1 }, to: { ...anchor, d: daysInMonth(anchor.y, anchor.m) } };
    case "quarter": {
      const m = Math.floor((anchor.m - 1) / 3) * 3 + 1;
      return { view, from: { y: anchor.y, m, d: 1 }, to: { y: anchor.y, m: m + 2, d: daysInMonth(anchor.y, m + 2) } };
    }
    case "year":
      return { view, from: { y: anchor.y, m: 1, d: 1 }, to: { y: anchor.y, m: 12, d: 31 } };
  }
}

export function shiftPeriod(p: Period, dir: 1 | -1): Period {
  switch (p.view) {
    case "day":
      return periodOf("day", addDays(p.from, dir));
    case "week":
      return periodOf("week", addDays(p.from, 7 * dir));
    case "month":
      return periodOf("month", addMonths(p.from, dir));
    case "quarter":
      return periodOf("quarter", addMonths(p.from, 3 * dir));
    case "year":
      return periodOf("year", { y: p.from.y + dir, m: 1, d: 1 });
  }
}

export function periodLabel(p: Period): string {
  const { from, to } = p;
  switch (p.view) {
    case "day":
      return `${DAYS[weekdayOf(from)]} ${from.d} ${mon(from.m)} ${from.y}`;
    case "week":
      return `${from.d} ${mon(from.m)} – ${to.d} ${mon(to.m)} ${to.y}`;
    case "month":
      return `${MONTHS[from.m - 1].replace(/^./, (c) => c.toUpperCase())} ${from.y}`;
    case "quarter":
      return `Q${Math.floor((from.m - 1) / 3) + 1} ${from.y}`;
    case "year":
      return String(from.y);
  }
}

// The part of a period that has happened (never past today)
export function elapsed(p: Period, today: Ymd): { from: Ymd; to: Ymd } | null {
  if (cmp(p.from, today) > 0) return null;
  return { from: p.from, to: minY(p.to, today) };
}

// Same stretch of the previous period: this month to the 15th vs last month to the 15th
export function comparable(p: Period, today: Ymd): { from: Ymd; to: Ymd } | null {
  const e = elapsed(p, today);
  if (!e) return null;
  const prev = shiftPeriod(p, -1);
  if (cmp(e.to, p.to) === 0) return { from: prev.from, to: prev.to }; // finished period: whole vs whole
  const len = daysBetween(e.from, e.to);
  return { from: prev.from, to: minY(addDays(prev.from, len), prev.to) };
}

export function inRange(t: Tx, from: Ymd, to: Ymd): boolean {
  return t.date >= isoDate(from) && t.date <= isoDate(to);
}

// Expenses minus refunds
export function spentOf(txs: Tx[]): number {
  let s = 0;
  for (const t of txs) if (t.type === "Expense") for (const v of Object.values(t.amounts)) s -= v;
  return Math.round(s * 100) / 100;
}

export function incomeOf(txs: Tx[]): number {
  let s = 0;
  for (const t of txs) if (t.type === "Income") for (const v of Object.values(t.amounts)) s += v;
  return Math.round(s * 100) / 100;
}

export function grainFor(view: View): Grain | null {
  return view === "day" ? null : view === "quarter" ? "week" : view === "year" ? "month" : "day";
}

export type Bucket = { key: string; label: string; from: Ymd; to: Ymd; spent: number; future: boolean };

export function buckets(p: Period, txs: Tx[], today: Ymd): Bucket[] {
  const grain = grainFor(p.view);
  if (!grain) return [];
  const out: Bucket[] = [];
  let cur = p.from;
  while (cmp(cur, p.to) <= 0) {
    let end: Ymd;
    let label: string;
    if (grain === "day") {
      end = cur;
      label = p.view === "week" ? DAYS[weekdayOf(cur)] : String(cur.d);
    } else if (grain === "week") {
      end = minY(addDays(cur, 6 - ((weekdayOf(cur) + 6) % 7)), p.to);
      label = `${cur.d} ${mon(cur.m)}`;
    } else {
      end = { ...cur, d: daysInMonth(cur.y, cur.m) };
      label = mon(cur.m);
    }
    const rows = txs.filter((t) => inRange(t, cur, end));
    out.push({ key: isoDate(cur), label, from: cur, to: end, spent: spentOf(rows), future: cmp(cur, today) > 0 });
    cur = addDays(end, 1);
  }
  return out;
}

// Monthly targets spread per day: a month's target / days in that month
export function budgetFor(monthly: number, from: Ymd, to: Ymd): number {
  let s = 0;
  for (let d = from; cmp(d, to) <= 0; d = addDays(d, 1)) s += monthly / daysInMonth(d.y, d.m);
  return Math.round(s * 100) / 100;
}

export type PacePoint = { key: string; label: string; actual: number | null; budget: number };

// Cumulative spend vs cumulative budget, one point per day (or per bucket for long views)
export function pace(p: Period, txs: Tx[], today: Ymd, budget: Record<string, number>): PacePoint[] {
  const monthlyTotal = Object.values(budget).reduce((a, b) => a + b, 0);
  const bs = buckets(p, txs, today);
  let actual = 0;
  let planned = 0;
  return bs.map((b) => {
    planned += budgetFor(monthlyTotal, b.from, b.to);
    actual += b.spent;
    return { key: b.key, label: b.label, actual: b.future ? null : Math.round(actual * 100) / 100, budget: Math.round(planned * 100) / 100 };
  });
}

export type CategoryRow = { name: string; spent: number; budget: number | null; count: number };

export function byCategory(txs: Tx[], from: Ymd, to: Ymd, budget: Record<string, number>): CategoryRow[] {
  const map = new Map<string, CategoryRow>();
  for (const t of txs) {
    if (t.type !== "Expense") continue;
    const name = t.category || "(no category)";
    const r = map.get(name) ?? { name, spent: 0, budget: null, count: 0 };
    r.spent += spentOf([t]);
    r.count++;
    map.set(name, r);
  }
  for (const [name, monthly] of Object.entries(budget)) {
    if (!(monthly > 0)) continue;
    const r = map.get(name) ?? { name, spent: 0, budget: null, count: 0 };
    r.budget = budgetFor(monthly, from, to);
    map.set(name, r);
  }
  return [...map.values()]
    .map((r) => ({ ...r, spent: Math.round(r.spent * 100) / 100 }))
    .sort((a, b) => b.spent - a.spent || (b.budget ?? 0) - (a.budget ?? 0));
}

export type Kpis = {
  spent: number;
  income: number;
  net: number;
  perDay: number;
  entries: number;
  daysLogged: number;
  daysElapsed: number;
  prevSpent: number | null;
  budget: number | null;
};

export function kpis(p: Period, txs: Tx[], today: Ymd, budget: Record<string, number>, noSpend: string[] = []): Kpis {
  const e = elapsed(p, today);
  const cur = e ? txs.filter((t) => inRange(t, e.from, e.to)) : [];
  const spent = spentOf(cur);
  const income = incomeOf(cur);
  const daysElapsed = e ? daysBetween(e.from, e.to) + 1 : 0;
  const logged = new Set(cur.map((t) => t.date));
  if (e) for (const d of noSpend) if (d >= isoDate(e.from) && d <= isoDate(e.to)) logged.add(d);
  const c = comparable(p, today);
  const monthlyTotal = Object.values(budget).reduce((a, b) => a + b, 0);
  return {
    spent,
    income,
    net: Math.round((income - spent) * 100) / 100,
    perDay: daysElapsed ? Math.round(spent / daysElapsed) : 0,
    entries: cur.length,
    daysLogged: logged.size,
    daysElapsed,
    prevSpent: c ? spentOf(txs.filter((t) => inRange(t, c.from, c.to))) : null,
    budget: monthlyTotal > 0 && e ? budgetFor(monthlyTotal, e.from, e.to) : null,
  };
}

// Date window to fetch: the period plus the previous one (for comparisons)
export function fetchWindow(p: Period): { from: string; to: string } {
  return { from: isoDate(shiftPeriod(p, -1).from), to: isoDate(maxY(p.to, p.from)) };
}

export function quarterTabsBetween(from: Ymd, to: Ymd): string[] {
  const out: string[] = [];
  let y = from.y;
  let qn = quarterOf(from);
  while (y < to.y || (y === to.y && qn <= quarterOf(to))) {
    out.push(`${y} Q${qn}`);
    qn++;
    if (qn > 4) {
      qn = 1;
      y++;
    }
  }
  return out;
}


// A comparison is only fair when every quarter tab it touches was actually read
export function covers(covered: string[], from: Ymd, to: Ymd): boolean {
  return quarterTabsBetween(from, to).every((t) => covered.includes(t));
}

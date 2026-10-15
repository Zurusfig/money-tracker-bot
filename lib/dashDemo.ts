// Made-up data for previewing the dashboard locally (DASH_DEMO=1, never in production).
import type { Tx } from "./dash";
import { quarterTabsBetween } from "./dash";
import type { DashData } from "./dashData";
import { addDays, bkkToday, isoDate, type Ymd } from "./time";

const CATS: [string, number, number, number][] = [
  // name, chance per day, min, max
  ["Food & Drinks", 0.95, 45, 260],
  ["Coffee & Tea", 0.6, 45, 150],
  ["Transportation", 0.7, 17, 120],
  ["Shopping", 0.15, 90, 900],
  ["Subscriptions", 0.03, 149, 419],
  ["Health", 0.05, 120, 800],
  ["Movie", 0.04, 180, 360],
  ["Education", 0.03, 250, 1500],
];
const ACCTS = ["K-Bank", "Make", "True-money", "Rabbit"];
const budget: Record<string, number> = {
  "Food & Drinks": 6000, "Coffee & Tea": 1500, Transportation: 2000, Shopping: 2000,
  Subscriptions: 500, Health: 1000, Movie: 500, Education: 2000,
};

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

const addDaysIso = (d: Ymd, n: number) => isoDate(addDays(d, n));

function demoTxs(today: Ymd): Tx[] {
  const r = rng(42);
  const out: Tx[] = [];
  let row = 20;
  for (let d: Ymd = { y: today.y - 1, m: today.m, d: 1 }; isoDate(d) <= isoDate(today); d = addDays(d, 1)) {
    const date = isoDate(d);
    if (d.d === 1) out.push({ date, type: "Income", category: "", description: "allowance", amounts: { "K-Bank": 7000 }, tab: "demo", row: row++ });
    // a correction every ~10 days, like real bal checks
    if (d.d % 10 === 0) out.push({ date, type: "Expense", category: "Untracked", description: "bal check", amounts: { "K-Bank": -Math.round(80 + r() * 400) }, tab: "demo", row: row++ });
    for (const [cat, p, lo, hi] of CATS) {
      if (r() > p) continue;
      const amt = Math.round(lo + r() * (hi - lo));
      const acct = cat === "Transportation" && r() < 0.5 ? "Rabbit" : ACCTS[Math.floor(r() * 3)];
      out.push({ date, type: "Expense", category: r() < 0.06 ? "" : cat, description: cat.toLowerCase(), amounts: { [acct]: -amt }, tab: "demo", row: row++ });
    }
  }
  return out;
}

export function demoData(from: Ymd, to: Ymd): DashData {
  const today = bkkToday();
  const a = isoDate(from);
  const b = isoDate(to);
  return {
    today: isoDate(today),
    from: a,
    to: b,
    txs: demoTxs(today).filter((t) => t.date >= a && t.date <= b),
    categories: [...CATS.map((c) => c[0]), "Untracked"],
    budget: { ...budget },
    balances: [
      { name: "K-Bank", code: "k", value: 3240.5, usable: true }, { name: "Make", code: "m", value: 1280, usable: true },
      { name: "SCB", code: "s", value: 4580.6, usable: true }, { name: "Cash-Wallet", code: "c", value: 220, usable: true },
      { name: "Rabbit", code: "r", value: 92, usable: true }, { name: "True-money", code: "t", value: -12, usable: true },
      { name: "Savings", code: "sv", value: 25000, usable: false },
    ],
    accuracy: {
      lastChecked: { "K-Bank": addDaysIso(today, -2), Make: addDaysIso(today, -9), SCB: addDaysIso(today, -20), "Cash-Wallet": addDaysIso(today, -5), Rabbit: null, "True-money": addDaysIso(today, -30) },
      drift: 350, neverChecked: ["Rabbit"], missPerDay: 39,
    },
    usable: { now: 9401.1, total: 34401.1, perDay30: 405, source: "sheet" },
    noSpend: [],
    skipped: [],
    covered: quarterTabsBetween(from, to),
  };
}

export function demoSaveBudget(category: string, target: number) {
  if (target > 0) budget[category] = target;
  else delete budget[category];
}

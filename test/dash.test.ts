import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  budgetFor, buckets, byCategory, comparable, covers, kpis, pace, periodLabel, periodOf, quarterTabsBetween, shiftPeriod, type Tx,
} from "@/lib/dash";
import { loadDashData, parseRange, saveBudget } from "@/lib/dashData";
import { signSession, verifySession } from "@/lib/dashAuth";
import { readBudget } from "@/lib/digest";
import { fixture } from "./helpers";

const d = (s: string) => {
  const [y, m, dd] = s.split("-").map(Number);
  return { y, m, d: dd };
};
const tx = (date: string, amt: number, category = "Food & Drinks", type = "Expense"): Tx =>
  ({ date, type, category, description: "", amounts: { "K-Bank": amt }, tab: "x", row: 1 });

describe("periods", () => {
  it("builds and shifts every view", () => {
    const t = d("2026-10-15"); // Thursday
    expect(periodOf("week", t)).toMatchObject({ from: d("2026-10-12"), to: d("2026-10-18") });
    expect(periodOf("month", t)).toMatchObject({ from: d("2026-10-01"), to: d("2026-10-31") });
    expect(periodOf("quarter", t)).toMatchObject({ from: d("2026-10-01"), to: d("2026-12-31") });
    expect(periodOf("year", t)).toMatchObject({ from: d("2026-01-01"), to: d("2026-12-31") });
    expect(shiftPeriod(periodOf("month", d("2026-03-31")), -1).from).toEqual(d("2026-02-01"));
    expect(shiftPeriod(periodOf("quarter", t), 1).from).toEqual(d("2027-01-01"));
    expect(periodLabel(periodOf("month", t))).toBe("October 2026");
    expect(periodLabel(periodOf("quarter", t))).toBe("Q4 2026");
  });

  it("compares the same stretch of the previous period", () => {
    const t = d("2026-10-15");
    expect(comparable(periodOf("month", t), t)).toEqual({ from: d("2026-09-01"), to: d("2026-09-15") });
    expect(comparable(periodOf("month", d("2026-03-31")), d("2026-03-31"))).toEqual({ from: d("2026-02-01"), to: d("2026-02-28") });
    expect(comparable(periodOf("month", d("2026-09-01")), t)).toEqual({ from: d("2026-08-01"), to: d("2026-08-31") }); // past month: whole
    expect(comparable(periodOf("month", d("2026-11-01")), t)).toBeNull(); // future
  });

  it("lists quarter tabs and checks coverage", () => {
    expect(quarterTabsBetween(d("2025-11-01"), d("2026-04-02"))).toEqual(["2025 Q4", "2026 Q1", "2026 Q2"]);
    expect(covers(["2026 Q3", "2026 Q4"], d("2026-09-01"), d("2026-10-01"))).toBe(true);
    expect(covers(["2026 Q4"], d("2026-09-01"), d("2026-10-01"))).toBe(false);
  });
});

describe("aggregation", () => {
  const txs = [
    tx("2026-09-10", -100), tx("2026-10-01", -50), tx("2026-10-02", -30, "Coffee & Tea"), tx("2026-10-02", 10, "Coffee & Tea"),
    tx("2026-10-05", 7000, "", "Income"), tx("2026-10-05", -500, "", "Transfer"),
  ];
  const today = d("2026-10-15");
  const month = periodOf("month", today);
  const budget = { "Food & Drinks": 3100, "Coffee & Tea": 310 };

  it("spreads monthly targets over days", () => {
    expect(budgetFor(3100, d("2026-10-01"), d("2026-10-31"))).toBe(3100);
    expect(budgetFor(3100, d("2026-10-01"), d("2026-10-10"))).toBe(1000);
    expect(budgetFor(300, d("2026-09-30"), d("2026-10-01"))).toBeCloseTo(10 + 300 / 31, 2);
  });

  it("kpis: refunds net out, transfers and income excluded from spend", () => {
    const k = kpis(month, txs, today, budget, ["2026-10-03"]);
    expect(k).toMatchObject({ spent: 70, income: 7000, net: 6930, entries: 5, daysElapsed: 15, prevSpent: 100 });
    expect(k.daysLogged).toBe(4); // 1, 2, 5 + no-spend 3
    expect(k.budget).toBe(1650); // (3100 + 310) * 15/31
  });

  it("buckets by day / week / month with future flags", () => {
    const b = buckets(month, txs, today);
    expect(b).toHaveLength(31);
    expect(b[1]).toMatchObject({ label: "2", spent: 20, future: false });
    expect(b[20].future).toBe(true);
    const q = buckets(periodOf("quarter", today), txs, today);
    expect(q[0]).toMatchObject({ label: "1 Oct", spent: 70 }); // Thu 1 to Sun 4
    expect(buckets(periodOf("year", today), txs, today)).toHaveLength(12);
    expect(buckets(periodOf("day", today), txs, today)).toHaveLength(0);
  });

  it("pace stops actuals at today, budget runs to the end", () => {
    const p = pace(month, txs, today, budget);
    expect(p[14].actual).toBe(70);
    expect(p[15].actual).toBeNull();
    expect(p[30].budget).toBe(3410);
  });

  it("categories include budgeted ones with no spend", () => {
    const c = byCategory(txs.filter((t) => t.date >= "2026-10-01"), month.from, month.to, { ...budget, Health: 620 });
    expect(c.map((r) => [r.name, r.spent, r.budget])).toEqual([
      ["Food & Drinks", 50, 3100], ["Coffee & Tea", 20, 310], ["Health", 0, 620],
    ]);
  });
});

describe("session", () => {
  beforeEach(() => {
    vi.stubEnv("LINE_CHANNEL_SECRET", "secret");
    vi.stubEnv("LINE_USER_ID", "Uowner");
  });
  it("signs and verifies, rejects tampering, expiry and other users", () => {
    const t = signSession("Uowner", 1000);
    expect(verifySession(t, 2000)).toBe("Uowner");
    expect(verifySession(t, 1000 + 31 * 86400000)).toBeNull();
    expect(verifySession(t.replace(/.$/, (c) => (c === "A" ? "B" : "A")), 2000)).toBeNull();
    expect(verifySession(signSession("Uother", 1000), 2000)).toBeNull();
    expect(verifySession(undefined)).toBeNull();
  });
});

describe("loading from the sheet", () => {
  it("reads quarter tabs in range, skips missing, seeds _Budget from Budget", async () => {
    const s = fixture();
    const r = parseRange("2026-08-01", "2026-10-31");
    const data = await loadDashData(s, r.from, r.to, new Date("2026-10-15T05:00:00Z"));
    expect(data.covered).toEqual(["2026 Q3", "2026 Q4"]);
    expect(data.txs.length).toBeGreaterThan(80);
    expect(data.txs.every((t) => t.date >= "2026-08-01" && t.date <= "2026-10-31")).toBe(true);
    expect(data.balances[0]).toMatchObject({ name: "K-Bank", code: "k" });
    expect(data.categories).toContain("Coffee & Tea");
    expect(Object.keys(data.budget).length).toBeGreaterThan(5);
    expect(s.tab("_Budget")).toBeTruthy();
  });

  it("saves targets to _Budget and the digest reads them", async () => {
    const s = fixture();
    await saveBudget(s, "Pets", 1200);
    await saveBudget(s, "Coffee & Tea", 900);
    let b = await readBudget(s);
    expect(b.get("Pets")).toBe(1200);
    expect(b.get("Coffee & Tea")).toBe(900);
    await saveBudget(s, "Pets", 0);
    b = await readBudget(s);
    expect(b.has("Pets")).toBe(false);
  });

  it("rejects bad ranges", () => {
    expect(() => parseRange("2026-10-02", "2026-10-01")).toThrow();
    expect(() => parseRange("2020-01-01", "2026-10-01")).toThrow(/too long/);
    expect(() => parseRange(null, "2026-10-01")).toThrow();
  });
});

describe("usable over time", () => {
  it("walks today's usable balance back through usable-account changes", async () => {
    const { usableSeries } = await import("@/lib/dash");
    const today = d("2026-10-15");
    const p = periodOf("week", today); // Mon 12 .. Sun 18
    const txs: Tx[] = [
      { ...tx("2026-10-12", -100), amounts: { "K-Bank": -100 } },
      { ...tx("2026-10-14", -50), amounts: { Make: -50 } },
      { ...tx("2026-10-14", 0, "", "Transfer"), amounts: { "K-Bank": -1000, Savings: 1000 } },
      { ...tx("2026-10-15", -20), amounts: { Savings: -20 } }, // not usable: no effect
    ];
    const v = usableSeries(buckets(p, txs, today), txs, today, 500, ["K-Bank", "Make"], ["2026 Q4"]);
    expect(v).toEqual([1550, 1550, 500, 500, null, null, null]);
  });

  it("returns null where a quarter in between couldn't be read", async () => {
    const { usableSeries } = await import("@/lib/dash");
    const today = d("2026-10-02");
    const p = periodOf("week", today); // Mon 28 Sep ..
    const v = usableSeries(buckets(p, [], today), [], today, 500, ["K-Bank"], ["2026 Q4"]);
    expect(v.slice(0, 5)).toEqual([null, null, 500, 500, 500]); // end of 30 Sep only needs October rows
  });

  it("fetches through today unless that's too long", async () => {
    const { fetchWindow } = await import("@/lib/dash");
    const today = d("2026-10-15");
    expect(fetchWindow(periodOf("month", d("2026-08-10")), today)).toEqual({ from: "2026-07-01", to: "2026-10-15" });
    expect(fetchWindow(periodOf("year", d("2023-05-01")), today)).toEqual({ from: "2022-01-01", to: "2023-12-31" });
  });

  it("loadDashData marks usable accounts from K2", async () => {
    const s = fixture();
    const r = parseRange("2026-10-01", "2026-10-15");
    const data = await loadDashData(s, r.from, r.to, new Date("2026-10-15T05:00:00Z"));
    expect(data.balances.filter((b) => !b.usable).map((b) => b.name)).toEqual(["Savings"]);
    expect(data.usable.source).toBe("sheet");
    expect(data.usable.now).toBe(900);
    expect(data.usable.total).toBe(1000);
  });
});

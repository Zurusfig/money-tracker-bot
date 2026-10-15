import { beforeEach, describe, expect, it } from "vitest";
import { accuracyOf, drift, isGapRow, lastChecked, missRates, monthly } from "@/lib/accuracy";
import { handleEvent, resetSetupCache } from "@/lib/bot";
import type { Tx } from "@/lib/dash";
import { OWNER, fixture, lastText, makeDeps, textEvent } from "./helpers";

const t = (date: string, amounts: Record<string, number>, type = "Expense", description = "", category = "Food & Drinks"): Tx =>
  ({ date, type, category, description, amounts, tab: "x", row: 1 });

describe("accuracy math", () => {
  const txs = [
    t("2026-09-05", { "K-Bank": -300 }),
    t("2026-09-30", { "K-Bank": -100, Make: 40 }, "Recalibrate"),
    t("2026-10-02", { "K-Bank": -200 }),
    t("2026-10-03", { "K-Bank": 20 }), // refund
    t("2026-10-08", { "K-Bank": -60 }, "Expense", "bal check", "Untracked"),
    t("2026-10-09", { Rabbit: -30 }, "Expense", "bal check", "Transportation"),
    t("2026-10-09", { "K-Bank": -500, Savings: 500 }, "Transfer"),
  ];

  it("spots correction rows", () => {
    expect(txs.map(isGapRow)).toEqual([false, true, false, false, true, true, false]);
  });

  it("captured = logged / (logged + unlogged)", () => {
    const a = accuracyOf(txs, "2026-10-01", "2026-10-31");
    expect(a).toEqual({ logged: 180, unlogged: 90, extra: 0, captured: 2 / 3 });
    expect(accuracyOf(txs, "2026-09-01", "2026-09-30")).toMatchObject({ logged: 300, unlogged: 100, extra: 40, captured: 0.75 });
    expect(accuracyOf(txs, "2026-10-01", "2026-10-31", ["Rabbit"])).toMatchObject({ logged: 0, unlogged: 30, captured: 0 });
    expect(accuracyOf([], "2026-10-01", "2026-10-31").captured).toBeNull();
    expect(monthly(txs, ["2026-09", "2026-10"]).map((m) => m.captured)).toEqual([0.75, 2 / 3]);
  });

  it("last checked, miss rate and drift", () => {
    const last = lastChecked([{ date: "2026-10-08", account: "K-Bank", sheet: 0, real: 0, gap: -60, id: "a" }], txs, ["K-Bank", "Make", "Rabbit", "Head"]);
    expect(Object.fromEntries(last)).toEqual({ "K-Bank": "2026-10-08", Make: "2026-09-30", Rabbit: null, Head: null });
    const rates = missRates(txs, "2026-10-15", 90);
    expect(rates.get("K-Bank")).toBeCloseTo(160 / 90);
    const dr = drift(["K-Bank", "Make", "Head"], last, rates, "2026-10-15");
    expect(dr.byAccount).toEqual([{ account: "K-Bank", days: 7, amount: 12 }, { account: "Make", days: 15, amount: 0 }]);
    expect(dr.neverChecked).toEqual(["Head"]);
  });
});

describe("bal and missed in LINE", () => {
  beforeEach(() => resetSetupCache());

  it("records checks, measures capture since the last one, and dedupes", async () => {
    const s = fixture();
    const day1 = makeDeps(s, "2026-10-09T05:00:00Z");
    s.setCell("2026 Q4", 2, 2, 1000);
    await handleEvent(day1.deps, textEvent("bal k 1000", "b1"), OWNER);
    expect(lastText(day1.replies)).toBe("✅ K-Bank matches the sheet (1,000). Nothing logged.\n📏 Since last check 4 days ago: ฿0 logged, nothing missing → 100% captured.");
    await handleEvent(day1.deps, textEvent("bal k 1000", "b1"), OWNER); // redelivery
    expect(lastText(day1.replies)).toBe("Already checked.");
    expect((await s.batchGet(["'_Checks'!A2:F9"]))[0]).toEqual([["2026-10-09", "K-Bank", 1000, 1000, 0, "Lb1"]]);

    await handleEvent(day1.deps, textEvent("bal sv 50"), OWNER);
    expect(lastText(day1.replies)).toMatch(/First check for Savings/);

    const day2 = makeDeps(s, "2026-10-12T05:00:00Z");
    await handleEvent(day2.deps, textEvent("200 coffee"), OWNER);
    s.setCell("2026 Q4", 2, 2, 800); // what the sheet formula would show
    await handleEvent(day2.deps, textEvent("bal k 700"), OWNER);
    expect(lastText(day2.replies)).toBe("K-Bank was off by -100 (sheet 800, real 700). Logged as Untracked.\n📏 Since last check 3 days ago: ฿200 logged, ฿100 unlogged → 67% captured.");

    await handleEvent(day2.deps, textEvent("missed"), OWNER);
    const r = lastText(day2.replies);
    expect(r).toMatch(/^📏 Logging accuracy\nThis month: \d+% captured\n฿[\d,]+ logged · ฿[\d,]+ unlogged/);
    expect(r).toMatch(/Last checked \(usable accounts\)\nK-Bank: today\n/);
    expect(r).toMatch(/Head: 48 days ago ⚠️/); // last manual Recalibrate row, 25 Aug
    expect(r).not.toMatch(/Savings:/);
    expect(r).toMatch(/Check one: bal k <real amount>$/);
  });

  it("explains a positive gap", async () => {
    const s = fixture();
    const { deps, replies } = makeDeps(s, "2026-10-09T05:00:00Z");
    s.setCell("2026 Q4", 2, 2, 100);
    await handleEvent(deps, textEvent("bal k 300"), OWNER);
    expect(lastText(replies)).toMatch(/^K-Bank has \+200 more than the sheet .*unlogged income or a refund, or something logged twice/);
  });
});

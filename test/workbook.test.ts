import { describe, expect, it } from "vitest";
import { BUILTIN_ACCOUNTS as ACC } from "@/lib/accounts";
import { buildRow, ensureQuarter, findAppendRow, parseView, readQuarter, writeEntry, type Entry } from "@/lib/workbook";
import type { FakeSheets } from "./fakeSheets";
import { fixture, hasRealWorkbook, realWorkbook } from "./helpers";

const d = (y: number, m: number, day: number) => ({ y, m, d: day });

function layoutSuite(name: string, load: () => Promise<FakeSheets> | FakeSheets) {
  describe(`layout: ${name}`, () => {
    it("resolves account columns from row 18 (incl. 'Bank' alias on older tabs)", async () => {
      const s = await load();
      const q4 = await readQuarter(s, "2026 Q4", ACC);
      expect([...q4.accountCols]).toEqual([
        ["K-Bank", 4], ["Make", 5], ["SCB", 6], ["Cash-Wallet", 7], ["Head", 8],
        ["Rabbit", 9], ["Line Pay", 10], ["True-money", 11], ["GWallet", 12], ["Savings", 13],
      ]);
      const q3 = await readQuarter(s, "2026 Q3", ACC);
      expect(q3.accountCols.get("K-Bank")).toBe(4);
    });

    it("finds month dividers and formula end row", async () => {
      const s = await load();
      const q4 = await readQuarter(s, "2026 Q4", ACC);
      expect(q4.dividers).toEqual([{ row: 19, month: 10 }, { row: 101, month: 11 }, { row: 201, month: 12 }]);
      expect(q4.lastRow).toBe(901);
      const t = await readQuarter(s, "_Template", ACC);
      expect(t.dividers.map((x) => x.row)).toEqual([19, 102, 202]);
      expect(t.lastRow).toBe(902);
    });

    it("appends inside the right month block", async () => {
      const s = await load();
      const q4 = await readQuarter(s, "2026 Q4", ACC);
      expect(findAppendRow(q4, d(2026, 10, 9))).toEqual({ row: 46, insert: false });
      expect(findAppendRow(q4, d(2026, 11, 1))).toEqual({ row: 102, insert: false });
      expect(findAppendRow(q4, d(2026, 12, 31))).toEqual({ row: 202, insert: false });
    });

    it("falls back to after the last dated row when a month has no divider", async () => {
      const s = await load();
      const q3 = await readQuarter(s, "2026 Q3", ACC);
      expect(findAppendRow(q3, d(2026, 8, 30))).toEqual({ row: 84, insert: false });
      expect(findAppendRow(q3, d(2026, 9, 2))).toEqual({ row: 84, insert: false });
    });
  });
}

layoutSuite("sanitized fixture", fixture);
describe.skipIf(!hasRealWorkbook)("real workbook", () => layoutSuite("reference/Budget_V3_1.xlsx", realWorkbook));

describe("findAppendRow edge cases", () => {
  it("skips manual rows without a date instead of overwriting them", () => {
    const s = fixture();
    s.setCell("2026 Q4", 46, 3, "manual note");
    return readQuarter(s, "2026 Q4", ACC).then((v) => expect(findAppendRow(v, d(2026, 10, 9)).row).toBe(47));
  });

  it("inserts a row before the next divider when a block is full", async () => {
    const s = fixture();
    for (let r = 46; r <= 100; r++) s.setCell("2026 Q4", r, 0, 46300 + r);
    const v = await readQuarter(s, "2026 Q4", ACC);
    expect(findAppendRow(v, d(2026, 10, 9))).toEqual({ row: 101, insert: true });
    const res = await writeEntry(s, entry({ id: "Lfull" }), ACC);
    expect(res.row).toBe(101);
    expect(s.getCell("2026 Q4", 102, 0)).toBe("November");
    expect(s.getFormula("2026 Q4", 2, 5)).toContain("$A$902");
  });

  it("uses the first data row in an empty block", async () => {
    const s = fixture();
    const v = await readQuarter(s, "_Template", ACC);
    expect(findAppendRow(v, d(2027, 7, 1))).toEqual({ row: 20, insert: false });
    expect(findAppendRow(v, d(2027, 8, 1))).toEqual({ row: 103, insert: false });
  });
});

function entry(over: Partial<Entry> = {}): Entry {
  return {
    date: d(2026, 10, 9), type: "Expense", category: "Food & Drinks", description: "lunch",
    amounts: { "K-Bank": -65 }, id: "L123", ...over,
  };
}

describe("buildRow", () => {
  it("puts expense in the account column", async () => {
    const v = parseView("2026 Q4", (await fixture().batchGet(["'2026 Q4'!A1:O"]))[0], null, ACC);
    expect(buildRow(v, entry())).toEqual(["2026-10-09", "Expense", "Food & Drinks", "lunch", -65, "", "", "", "", "", "", "", "", "", "L123"]);
  });
  it("transfer: negative source, positive destination, same row", async () => {
    const v = parseView("2026 Q4", (await fixture().batchGet(["'2026 Q4'!A1:O"]))[0], null, ACC);
    const r = buildRow(v, entry({ type: "Transfer", category: "", description: "", amounts: { "K-Bank": -5000, Make: 5000 } }));
    expect(r.slice(0, 6)).toEqual(["2026-10-09", "Transfer", "", "", -5000, 5000]);
  });
  it("keeps user text literal", async () => {
    const v = parseView("2026 Q4", (await fixture().batchGet(["'2026 Q4'!A1:O"]))[0], null, ACC);
    const r = buildRow(v, entry({ description: "=HYPERLINK(1)", id: "S0152" }));
    expect(r[3]).toBe("'=HYPERLINK(1)");
    expect(buildRow(v, entry({ description: "7-11" }))[3]).toBe("'7-11");
    expect(r[14]).toBe("S0152");
    expect(buildRow(v, entry({ amounts: { Savings: 0.1 + 0.2 } }))[13]).toBe(0.3);
  });
});

describe("writeEntry", () => {
  it("writes, verifies and is idempotent on id", async () => {
    const s = fixture();
    const a = await writeEntry(s, entry(), ACC);
    expect(a).toEqual({ tab: "2026 Q4", row: 46, duplicate: false });
    expect(s.getCell("2026 Q4", 46, 0)).toBe(46304); // 2026-10-09 as a real date serial
    const b = await writeEntry(s, entry(), ACC);
    expect(b).toEqual({ tab: "2026 Q4", row: 46, duplicate: true });
    const c = await writeEntry(s, entry({ id: "L124" }), ACC);
    expect(c.row).toBe(47);
  });

  it("creates a new quarter from _Template with R1/R2, Untracked and opening balances", async () => {
    const s = fixture();
    const rows = [2, 3, 4, 6, 7, 9, 10, 11, 12, 14];
    rows.forEach((r, i) => s.setCell("2026 Q4", r, 2, 1000 + i + 0.456));
    const name = await ensureQuarter(s, d(2027, 1, 3), ACC);
    expect(name).toBe("2027 Q1");
    const tabs = (await s.listTabs()).map((t) => t.title);
    expect(tabs.indexOf("2027 Q1")).toBe(tabs.indexOf("Budget") + 1);
    expect(s.getCell("2027 Q1", 1, 17)).toBe(2027);
    expect(s.getCell("2027 Q1", 2, 17)).toBe(1);
    expect(s.getCell("2027 Q1", 2, 4)).toBe(1000.46);
    expect(s.getCell("2027 Q1", 14, 4)).toBe(1009.46);
    expect(s.getCell("2027 Q1", 5, 4)).toBeNull();
    expect(s.getCell("2027 Q1", 5, 15)).toBe("Untracked");
    expect(s.getFormula("2027 Q1", 5, 16)).toContain(",P5,");
    expect(s.getFormula("2027 Q1", 5, 16)).not.toContain(",P2,");
    // idempotent
    expect(await ensureQuarter(s, d(2027, 2, 1), ACC)).toBe("2027 Q1");
    expect(s.calls.filter((c) => c.startsWith("duplicate")).length).toBe(1);
  });
});

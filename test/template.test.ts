import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { handleEvent, resetSetupCache } from "@/lib/bot";
import { FakeSheets } from "./fakeSheets";
import { OWNER, lastText, makeDeps, textEvent } from "./helpers";
import { loadXlsx } from "./loadXlsx";

beforeEach(() => resetSetupCache());

// Uses the committed blank template, as a new user would after importing it.
describe("template/Budget_Template.xlsx", () => {
  it("works end to end for a new user", async () => {
    const sheets = FakeSheets.from(await loadXlsx(path.resolve(import.meta.dirname, "../template/Budget_Template.xlsx")));
    // Sheets would compute these formulas; the fake can't
    sheets.setCell("_Template", 19, 0, "October");
    sheets.setCell("_Template", 101, 0, "November");
    sheets.setCell("_Template", 201, 0, "December");
    const { deps, replies } = makeDeps(sheets, "2026-11-03T05:00:00Z");
    const send = (t: string) => handleEvent(deps, textEvent(t), OWNER);

    await send("65 food");
    expect((await sheets.listTabs()).map((t) => t.title)).toEqual(
      expect.arrayContaining(["_Template", "Budget", "2026 Q4", "_Config", "_Rules", "_Accounts", "_BotLog"]),
    );
    const Q = "2026 Q4";
    expect([0, 1, 2, 3, 4].map((c) => sheets.getCell(Q, 102, c))).toEqual([46329, "Expense", "Food & Drinks", "food", -65]);
    expect(lastText(replies)).toBe("✓ 65 Food & Drinks · Bank · food");

    await send("20 coffee e");
    expect(sheets.getCell(Q, 103, 6)).toBe(-20);

    await send("help");
    expect(lastText(replies)).toMatch(/b = Bank\nc = Cash\ne = E-Wallet\nsv = Savings$/);
    expect(sheets.getCell(Q, 11, 15)).toBe("Untracked"); // shipped in the list, not added twice
    expect(sheets.getCell(Q, 6, 15)).toBe("Bills");
  });
});

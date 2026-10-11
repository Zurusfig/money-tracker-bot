import { beforeEach, describe, expect, it } from "vitest";
import { handleEvent, resetSetupCache } from "@/lib/bot";
import { cleanCategoryName } from "@/lib/workbook";
import { OWNER, fixture, lastText, makeDeps, postbackEvent, quick, textEvent } from "./helpers";

const Q4 = "2026 Q4";
beforeEach(() => resetSetupCache());

async function setup() {
  const sheets = fixture();
  const ctx = makeDeps(sheets);
  const send = (ev: Parameters<typeof handleEvent>[1]) => handleEvent(ctx.deps, ev, OWNER);
  await send(textEvent("help")); // setup: Untracked takes P5
  return { sheets, ...ctx, send };
}

describe("creating categories", () => {
  it("#tag uses an existing category when it matches", async () => {
    const { sheets, send, replies } = await setup();
    await send(textEvent("65 latte #coffee"));
    expect(sheets.getCell(Q4, 46, 2)).toBe("Coffee & Tea");
    expect(lastText(replies)).toBe("✓ 65 Coffee & Tea · K-Bank · latte");
  });

  it("#tag creates a new category in the quarter tab and _Template, with a Q formula, and learns the word", async () => {
    const { sheets, send, replies, ai } = await setup();
    await send(textEvent("450 dog food #pets"));
    expect(lastText(replies)).toBe("✓ 450 Pets · K-Bank · dog food\n🆕 New category: Pets");
    for (const tab of [Q4, "_Template"]) {
      expect(sheets.getCell(tab, 4, 15)).toBe("Pets"); // first empty slot P4
      expect(sheets.getFormula(tab, 4, 16)).toMatch(/,P4,/);
    }
    expect(sheets.getFormula(Q4, 2, 16)).toMatch(/,P2,/); // untouched
    expect(sheets.getCell(Q4, 46, 2)).toBe("Pets");

    ai.categorize.mockClear();
    await send(textEvent("300 dog food"));
    expect(sheets.getCell(Q4, 47, 2)).toBe("Pets");
    expect(ai.categorize).not.toHaveBeenCalled();

    await send(textEvent("100 toy #Pets"));
    expect(lastText(replies)).not.toMatch(/New category/);
    await send(textEvent("cats"));
    expect(lastText(replies)).toMatch(/• Pets/);
  });

  it("does not overwrite an existing Q formula when the slot has one", async () => {
    const { sheets, send } = await setup();
    for (const r of [4, 8, 12, 13]) sheets.setCell(Q4, r, 15, `X${r}`); // fill the gaps
    const before = sheets.getFormula(Q4, 16, 16);
    await send(textEvent("50 card #gifts"));
    expect(sheets.getCell(Q4, 16, 15)).toBe("Gifts");
    expect(sheets.getFormula(Q4, 16, 16)).toBe(before);
  });

  it("offers Gemini's new-category suggestion as the first button", async () => {
    const { sheets, send, replies, ai } = await setup();
    ai.categorize.mockResolvedValueOnce({ category: "", confidence: 0.2, newCategory: "Gifts" });
    await send(textEvent("500 birthday present"));
    const buttons = quick(replies);
    expect(buttons[0].label).toBe("➕ Gifts");
    expect(buttons.at(-1)!.label).toBe("Delete");
    expect(buttons.length).toBeLessThanOrEqual(13);
    await send(postbackEvent(buttons[0].data!));
    expect(lastText(replies)).toBe("✓ 500 Gifts · K-Bank · birthday present\n🆕 New category: Gifts");
    expect(sheets.getCell(Q4, 46, 2)).toBe("Gifts");
    expect(sheets.getCell("_Rules", 2, 0)).toBe("birthday present");
    await send(postbackEvent(buttons[0].data!)); // double tap: no second copy
    expect((await sheets.batchGet(["'2026 Q4'!P2:P51"]))[0].flat().filter((c) => c === "Gifts")).toHaveLength(1);
  });

  it("cleans names", () => {
    expect(cleanCategoryName("  dog   food ")).toBe("Dog Food");
    expect(cleanCategoryName("iPhone stuff")).toBe("iPhone stuff");
    expect(cleanCategoryName("=SUM(1)")).toBe("SUM(1)");
  });
});

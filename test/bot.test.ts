import { beforeEach, describe, expect, it } from "vitest";
import { handleEvent, resetSetupCache } from "@/lib/bot";
import { verifySignature } from "@/lib/line";
import { createHmac } from "node:crypto";
import { OWNER, fixture, imageEvent, lastText, makeDeps, postbackEvent, quick, slip, textEvent } from "./helpers";

const Q4 = "2026 Q4";
const row = (s: ReturnType<typeof fixture>, r: number) =>
  Array.from({ length: 15 }, (_, c) => s.getCell(Q4, r, c));

beforeEach(() => resetSetupCache());

async function setup() {
  const sheets = fixture();
  const ctx = makeDeps(sheets);
  const send = (ev: Parameters<typeof handleEvent>[1]) => handleEvent(ctx.deps, ev, OWNER);
  return { sheets, ...ctx, send };
}

describe("setup", () => {
  it("creates hidden bot tabs and adds Untracked at P5 with a Q5 formula", async () => {
    const { sheets, send } = await setup();
    await send(textEvent("help"));
    for (const t of ["_Rules", "_Accounts", "_BotLog"]) expect(sheets.tab(t).hidden).toBe(true);
    for (const t of [Q4, "_Template"]) {
      expect(sheets.getCell(t, 5, 15)).toBe("Untracked");
      expect(sheets.getFormula(t, 5, 16)).toMatch(/,P5,/);
    }
    expect(sheets.getFormula(Q4, 2, 16)).toMatch(/,P2,/); // untouched
  });
});

describe("typed entries", () => {
  it("ignores other users and needs a valid signature", async () => {
    const { sheets, send, replies } = await setup();
    await send(textEvent("65 lunch", "1", "Ustranger"));
    expect(replies).toHaveLength(0);
    expect(sheets.tabs.some((t) => t.title === "_BotLog")).toBe(false);
    const body = '{"events":[]}';
    const sig = createHmac("sha256", "sec").update(body).digest("base64");
    expect(verifySignature(body, sig, "sec")).toBe(true);
    expect(verifySignature(body, sig, "other")).toBe(false);
    expect(verifySignature(body, null, "sec")).toBe(false);
  });

  it("65 coffee: category from the category list, default K-Bank, confirmation + buttons", async () => {
    const { sheets, send, replies, ai } = await setup();
    await send(textEvent("65 coffee", "555"));
    expect(row(sheets, 46)).toEqual([46304, "Expense", "Coffee & Tea", "coffee", -65, null, null, null, null, null, null, null, null, null, "L555"]);
    expect(lastText(replies)).toBe("✓ 65 Coffee & Tea · K-Bank · coffee");
    expect(quick(replies).map((q) => q.label)).toEqual(["Account", "Category", "Delete"]);
    expect(ai.categorize).not.toHaveBeenCalled();
  });

  it("LINE redelivery does not duplicate", async () => {
    const { sheets, send, replies } = await setup();
    await send(textEvent("65 coffee", "777"));
    await send(textEvent("65 coffee", "777"));
    expect(lastText(replies)).toMatch(/Already logged/);
    expect(sheets.getCell(Q4, 47, 0)).toBeNull();
  });

  it("trailing account code", async () => {
    const { sheets, send } = await setup();
    await send(textEvent("120 coffee m"));
    expect(sheets.getCell(Q4, 46, 5)).toBe(-120);
    expect(sheets.getCell(Q4, 46, 4)).toBeNull();
  });

  it("Gemini categorises unknown words; low confidence asks with category buttons", async () => {
    const { sheets, send, replies, ai } = await setup();
    ai.categorize.mockResolvedValueOnce({ category: "Food & Drinks", confidence: 0.92 });
    await send(textEvent("65 kaprao"));
    expect(sheets.getCell(Q4, 46, 2)).toBe("Food & Drinks");
    expect(ai.categorize.mock.calls[0][1]).toContain("Untracked");

    ai.categorize.mockResolvedValueOnce({ category: "Games", confidence: 0.4 });
    await send(textEvent("300 mystery"));
    expect(sheets.getCell(Q4, 47, 2)).toBeNull();
    expect(lastText(replies)).toBe("✓ 300 (no category) · K-Bank · mystery\nWhich category?");
    const buttons = quick(replies);
    expect(buttons.map((b) => b.label)).toContain("Shopping");
    expect(buttons.at(-1)!.label).toBe("Delete");
  });

  it("category button sets the category and learns a rule", async () => {
    const { sheets, send, replies, ai } = await setup();
    await send(textEvent("300 mystery"));
    const shop = quick(replies).find((b) => b.label === "Shopping")!;
    await send(postbackEvent(shop.data!));
    expect(sheets.getCell(Q4, 46, 2)).toBe("Shopping");
    expect(lastText(replies)).toBe("✓ 300 Shopping · K-Bank · mystery");
    expect(sheets.getCell("_Rules", 2, 0)).toBe("mystery");
    expect(sheets.getCell("_Rules", 2, 1)).toBe("Shopping");

    ai.categorize.mockClear();
    await send(textEvent("90 mystery"));
    expect(sheets.getCell(Q4, 47, 2)).toBe("Shopping");
    expect(ai.categorize).not.toHaveBeenCalled();
  });

  it("account button moves the amount", async () => {
    const { sheets, send, replies } = await setup();
    await send(textEvent("65 coffee"));
    await send(postbackEvent(quick(replies)[0].data!));
    const toTm = quick(replies).find((b) => b.label === "True-money")!;
    await send(postbackEvent(toTm.data!));
    expect(sheets.getCell(Q4, 46, 4)).toBeNull();
    expect(sheets.getCell(Q4, 46, 11)).toBe(-65);
    expect(lastText(replies)).toBe("✓ 65 Coffee & Tea · True-money · coffee");
  });

  it("delete button clears the row", async () => {
    const { sheets, send, replies } = await setup();
    await send(textEvent("65 coffee"));
    await send(postbackEvent(quick(replies)[2].data!));
    expect(row(sheets, 46).every((v) => v === null)).toBe(true);
    expect(lastText(replies)).toBe("Deleted: 65 Coffee & Tea · K-Bank · coffee");
  });

  it("income, refund and transfer", async () => {
    const { sheets, send, replies } = await setup();
    await send(textEvent("+7000 allowance"));
    expect(row(sheets, 46).slice(0, 5)).toEqual([46304, "Income", null, "allowance", 7000]);
    expect(lastText(replies)).toBe("✓ +7,000 Income · K-Bank · allowance");

    await send(textEvent("+134 food"));
    expect(row(sheets, 47).slice(0, 5)).toEqual([46304, "Expense", "Food & Drinks", "food", 134]);

    await send(textEvent("t k m 5000"));
    expect(row(sheets, 48).slice(0, 6)).toEqual([46304, "Transfer", null, null, -5000, 5000]);
    expect(lastText(replies)).toBe("✓ 5,000 K-Bank → Make");
    expect(quick(replies).map((q) => q.label)).toEqual(["Delete"]);
  });

  it("undo removes the last bot row, once per message", async () => {
    const { sheets, send, replies } = await setup();
    await send(textEvent("65 coffee"));
    await send(textEvent("t k m 100"));
    await send(textEvent("undo", "u1"));
    expect(lastText(replies)).toBe("Undone: 100 K-Bank → Make");
    expect(sheets.getCell(Q4, 47, 0)).toBeNull();
    await send(textEvent("undo", "u1")); // redelivery
    expect(lastText(replies)).toBe("Already undone.");
    expect(sheets.getCell(Q4, 46, 0)).toBe(46304);
    await send(textEvent("undo"));
    expect(sheets.getCell(Q4, 46, 0)).toBeNull();
    await send(textEvent("undo"));
    expect(lastText(replies)).toBe("Nothing to undo.");
  });

  it("0 marks a no-spend day", async () => {
    const { sheets, send, replies } = await setup();
    await send(textEvent("0"));
    expect(lastText(replies)).toBe("✓ No-spend day: 2026-10-09");
    expect(sheets.getCell("_BotLog", 2, 2)).toBe("nospend");
    await send(textEvent("0"));
    expect(lastText(replies)).toMatch(/already/);
  });

  it("bal writes the gap as Untracked (Transportation for Rabbit)", async () => {
    const { sheets, send, replies } = await setup();
    sheets.setCell(Q4, 2, 2, 3320.5); // computed C2 K-Bank
    sheets.setCell(Q4, 9, 2, 50); // Rabbit
    await send(textEvent("bal k 3200"));
    expect(row(sheets, 46).slice(0, 5)).toEqual([46304, "Expense", "Untracked", "bal check", -120.5]);
    expect(lastText(replies)).toBe("K-Bank gap -120.5 (sheet 3,320.5, real 3,200). Logged as Untracked.");
    await send(textEvent("bal r 33"));
    expect(row(sheets, 47).slice(1, 3)).toEqual(["Expense", "Transportation"]);
    expect(sheets.getCell(Q4, 47, 9)).toBe(-17);
    await send(textEvent("bal r 50"));
    expect(lastText(replies)).toMatch(/matches/);
  });

  it("unknown text gets help", async () => {
    const { send, replies } = await setup();
    await send(textEvent("hello"));
    expect(lastText(replies)).toMatch(/^Didn't get that/);
  });

  it("errors reply briefly and alert Discord", async () => {
    const { sheets, send, replies, posts } = await setup();
    await send(textEvent("help"));
    sheets.tab(Q4).cells.delete("18,4"); // break the header
    await send(textEvent("65 coffee"));
    expect(lastText(replies)).toBe("Error, nothing was logged. Details sent to Discord.");
    expect(posts[0]).toMatch(/header row 18 is missing K-Bank/);
  });
});

describe("slips", () => {
  it("logs a confident slip as an expense with the slip ref as ID", async () => {
    const { sheets, send, replies, ai } = await setup();
    ai.readSlip.mockResolvedValueOnce(slip({ amount: 250, recipient_name: "Some Shop", category: "Shopping", datetime: "2569-10-08 18:02" }));
    await send(imageEvent());
    expect(row(sheets, 46)).toEqual([46303, "Expense", "Shopping", "Some Shop", -250, null, null, null, null, null, null, null, null, null, "S015282123456ABC1234"]);
    expect(lastText(replies)).toBe("✓ 250 Shopping · K-Bank · Some Shop");

    ai.readSlip.mockResolvedValueOnce(slip({ amount: 250 }));
    await send(imageEvent()); // same slip shared again
    expect(lastText(replies)).toMatch(/Already logged/);
  });

  it("transfer when recipient matches _Accounts", async () => {
    const { sheets, send, replies, ai } = await setup();
    await send(textEvent("help"));
    await sheets.update("'_Accounts'!A2:B3", [["1234", "Make"], ["Paotang top up", "g"]]);
    ai.readSlip.mockResolvedValueOnce(slip({ source_bank: "SCB EASY", recipient_name: "MR A", recipient_account: "xxx-x-x1234-x", transaction_ref: "REF0001" }));
    await send(imageEvent());
    expect(row(sheets, 46).slice(0, 7)).toEqual([46304, "Transfer", null, "MR A", null, 250, -250]);
    ai.readSlip.mockResolvedValueOnce(slip({ source_bank: "K PLUS", recipient_name: "Paotang Top Up Krungthai", recipient_account: "", transaction_ref: "REF0002" }));
    await send(imageEvent());
    expect(sheets.getCell(Q4, 47, 12)).toBe(250);
    expect(lastText(replies)).toBe("✓ 250 K-Bank → GWallet · Paotang Top Up Krungthai");
  });

  it("low amount confidence asks before writing", async () => {
    const { sheets, send, replies, ai } = await setup();
    ai.readSlip.mockResolvedValueOnce(slip({ amount: [1250, 0.6] }));
    await send(imageEvent());
    expect(sheets.getCell(Q4, 46, 0)).toBeNull();
    expect(lastText(replies)).toBe("Read 1,250 from K-Bank to Some Shop. Is the amount right?");
    const [yes, no] = quick(replies);
    await send(postbackEvent(no.data!));
    expect(sheets.getCell(Q4, 46, 0)).toBeNull();
    await send(postbackEvent(yes.data!));
    expect(row(sheets, 46).slice(0, 5)).toEqual([46304, "Expense", "Shopping", "Some Shop", -1250]);
    await send(postbackEvent(yes.data!)); // double tap
    expect(lastText(replies)).toMatch(/Already logged/);
  });

  it("unknown source bank defaults to K-Bank with a note; not a slip is ignored", async () => {
    const { sheets, send, replies, ai } = await setup();
    ai.readSlip.mockResolvedValueOnce(slip({ source_bank: "Mystery Bank" }));
    await send(imageEvent());
    expect(sheets.getCell(Q4, 46, 4)).toBe(-250);
    expect(lastText(replies)).toMatch(/Note: source "Mystery Bank" unknown, used K-Bank/);
    ai.readSlip.mockResolvedValueOnce(slip({ is_slip: false }));
    await send(imageEvent());
    expect(lastText(replies)).toMatch(/doesn't look like a payment slip/);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { handleEvent, resetSetupCache } from "@/lib/bot";
import { BUILTIN_ACCOUNTS } from "@/lib/accounts";
import { buildStats } from "@/lib/stats";
import { OWNER, fixture, lastText, makeDeps, textEvent } from "./helpers";

beforeEach(() => resetSetupCache());

const field = (e: Awaited<ReturnType<typeof buildStats>>, name: string) => e.fields.find((f) => f.name.includes(name))?.value ?? "";
const amount = (v: string) => Number(/฿([\d,.]+)/.exec(v)![1].replace(/,/g, ""));

describe("bal (all balances)", () => {
  it("lists every account with a total, in LINE", async () => {
    const s = fixture();
    const { deps, replies } = makeDeps(s, "2026-10-11T05:00:00Z");
    const rows = [2, 3, 4, 6, 7, 9, 10, 11, 12, 14];
    rows.forEach((r, i) => s.setCell("2026 Q4", r, 2, i === 2 ? -5 : 100 + i));
    await handleEvent(deps, textEvent("bal"), OWNER);
    const t = lastText(replies);
    expect(t).toMatch(/^💳 Balances · 2026 Q4\nK-Bank \(k\): 100\nMake \(m\): 101\nSCB \(s\): -5 ⚠️/);
    expect(t).toMatch(/Savings \(sv\): 109\nTotal: 938\n\nOff\? Send bal k <real amount>$/);
  });
});

describe("stats", () => {
  it("posts a dashboard embed to Discord and confirms in LINE", async () => {
    const s = fixture();
    const { deps, replies, embeds } = makeDeps(s, "2026-10-11T05:00:00Z"); // Sunday
    await handleEvent(deps, textEvent("help"), OWNER);
    const before = await buildStats(s, BUILTIN_ACCOUNTS, new Date("2026-10-11T05:00:00Z"));
    await handleEvent(deps, textEvent("100 coffee"), OWNER);
    await handleEvent(deps, textEvent("+20 coffee"), OWNER); // refund
    await handleEvent(deps, textEvent("+5000 salary"), OWNER);
    await handleEvent(deps, textEvent("stats"), OWNER);

    expect(lastText(replies)).toBe("📊 Stats sent to Discord.");
    const e = embeds[0];
    expect(e.title).toBe("📊 Spending · Sun 11 Oct 2026");
    expect(e.description).toBe("Week from Mon 5 Oct · Month from Thu 1 Oct");
    expect(field(e, "Today")).toBe("**฿80**\n3 entries");
    expect(amount(field(e, "This week"))).toBe(amount(field(before, "This week")) + 80);
    expect(amount(field(e, "This month"))).toBe(amount(field(before, "This month")) + 80);
    expect(field(e, "Categories")).toMatch(/Coffee & Tea +[█░]{10} \d+ \/ 1,000/);
    expect(field(e, "Biggest")).toMatch(/^฿100 · Coffee & Tea · coffee \(Sun\)/);
    expect(amount(field(e, "Income"))).toBeGreaterThanOrEqual(5000);
    expect(e.fields.every((f) => f.value.length <= 1024)).toBe(true);
  });

  it("week and last-week comparison span the quarter boundary", async () => {
    const s = fixture();
    // Friday 2 Oct: week starts Mon 28 Sep, which is in 2026 Q3
    await s.update("'2026 Q3'!A84:E84", [["2026-09-29", "Expense", "Shopping", "late Sept", -300]]);
    const e = await buildStats(s, BUILTIN_ACCOUNTS, new Date("2026-10-02T05:00:00Z"));
    expect(e.description).toBe("Week from Mon 28 Sep · Month from Thu 1 Oct");
    expect(field(e, "Biggest")).toMatch(/฿300 · Shopping · late Sept \(Tue\)/);
    expect(amount(field(e, "This week"))).toBeGreaterThanOrEqual(300);
  });

  it("says when Discord is not set up", async () => {
    const { deps, replies } = makeDeps(fixture(), "2026-10-11T05:00:00Z");
    (deps.notify as { enabled: boolean }).enabled = false;
    await handleEvent(deps, textEvent("stats"), OWNER);
    expect(lastText(replies)).toMatch(/Discord isn't set up/);
  });
});

describe("week comparison", () => {
  it("shows the baht difference vs the same days last week", async () => {
    const s = fixture();
    const { deps, embeds } = makeDeps(s, "2026-10-13T05:00:00Z"); // Tue; last week = Mon 5 + Tue 6
    await handleEvent(deps, textEvent("help"), OWNER);
    const base = await buildStats(s, BUILTIN_ACCOUNTS, new Date("2026-10-13T05:00:00Z"));
    const lastWeek = /than last week/.test(field(base, "This week")) ? amount(field(base, "This week").split("\n")[2]) : 0;
    await handleEvent(deps, textEvent("1000 coffee"), OWNER);
    await handleEvent(deps, textEvent("stats"), OWNER);
    expect(field(embeds[0], "This week")).toMatch(new RegExp(`▲ ฿${(1000 - lastWeek).toLocaleString("en-US")} more than last week$`));
  });
});

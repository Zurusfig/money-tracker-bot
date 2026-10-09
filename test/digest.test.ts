import { beforeEach, describe, expect, it } from "vitest";
import { handleEvent, resetSetupCache } from "@/lib/bot";
import { buildDigest } from "@/lib/digest";
import { OWNER, fixture, makeDeps, textEvent } from "./helpers";

beforeEach(() => resetSetupCache());

async function withEntries(nowIso: string, texts: string[]) {
  const sheets = fixture();
  const { deps } = makeDeps(sheets, nowIso);
  await handleEvent(deps, textEvent("help"), OWNER); // creates bot tabs
  for (const t of texts) await handleEvent(deps, textEvent(t), OWNER);
  return sheets;
}

const FRI = "2026-10-09T14:30:00Z";

describe("daily digest", () => {
  it("says so explicitly when nothing was logged and no 0 was sent", async () => {
    const s = await withEntries(FRI, []);
    const out = await buildDigest(s, new Date(FRI));
    expect(out).toMatch(/No entries today and no `0` sent/);
  });

  it("no-spend day", async () => {
    const s = await withEntries(FRI, ["0"]);
    expect(await buildDigest(s, new Date(FRI))).toMatch(/No-spend day/);
  });

  it("count and total, refunds net out", async () => {
    const s = await withEntries(FRI, ["65 coffee", "100 coffee m", "+15 coffee", "+7000 allowance", "t k m 100"]);
    const out = await buildDigest(s, new Date(FRI));
    expect(out).toMatch(/Today: 5 entries, spent 150/);
  });

  it("flags categories near or over the Budget target (month to date)", async () => {
    // Budget!C targets are 1000 in the fixture; Budget!B names come from cached formula results
    const s = await withEntries(FRI, ["950 coffee", "1200 movie"]);
    const out = await buildDigest(s, new Date(FRI));
    expect(out).toMatch(/near Coffee & Tea: 960 \/ 1,000 \(96%\)/);
    expect(out).toMatch(/over Movie: 1,200 \/ 1,000 \(120%\)/);
  });

  it("lists rows needing review (blank category)", async () => {
    const s = await withEntries(FRI, ["300 mystery"]);
    const out = await buildDigest(s, new Date(FRI));
    expect(out).toMatch(/Needs review/);
    expect(out).toMatch(/Needs review \(\d+\)\*\*\n- 2026-10-09 -300 K-Bank "mystery" \(row 46\): no category/);
  });

  it("Sunday adds the balance check", async () => {
    const s = await withEntries("2026-10-11T14:30:00Z", []);
    s.setCell("2026 Q4", 2, 2, 1234.5);
    const out = await buildDigest(s, new Date("2026-10-11T14:30:00Z"));
    expect(out).toMatch(/Weekly balance check/);
    expect(out).toMatch(/K-Bank \(k\): 1,234.5/);
    expect(out).toMatch(/Savings \(sv\)/);
    expect(out).toMatch(/bal k 3200/);
    expect(await buildDigest(s, new Date(FRI))).not.toMatch(/Weekly balance check/);
  });

  it("last day of the month adds the monthly summary", async () => {
    const s = await withEntries("2026-10-31T14:30:00Z", ["0", "300 mystery"]);
    // bal row -> Untracked
    s.setCell("2026 Q4", 2, 2, 100);
    const { deps } = makeDeps(s, "2026-10-31T14:30:00Z");
    await handleEvent(deps, textEvent("bal k 60"), OWNER);
    const out = await buildDigest(s, new Date("2026-10-31T14:30:00Z"));
    expect(out).toMatch(/Month summary/);
    // fixture has dated rows on Oct 1, 2, 4, 5 + today
    expect(out).toMatch(/Days with an entry or `0`: 5 \/ 31/);
    expect(out).toMatch(/Untracked total: 40/);
    expect(out).toMatch(/Expense rows without a category: \d+/);
  });
});

import { describe, expect, it } from "vitest";
import { BUILTIN_ACCOUNTS } from "@/lib/accounts";
import { parseUsableRows, readUsable, runwayDays, runwayText } from "@/lib/usable";
import { fixture } from "./helpers";

describe("usable", () => {
  it("parses the Sum of Usable formula", () => {
    expect(parseUsableRows("=SUM(C2:C4,C6:C7,C9:C12)")).toEqual([2, 3, 4, 6, 7, 9, 10, 11, 12]);
    expect(parseUsableRows("=sum($C$2, C14)")).toEqual([2, 14]);
    expect(parseUsableRows("=SUM(C2:C4)+100")).toBeNull();
    expect(parseUsableRows("=SUM(D2:D4)")).toBeNull();
    expect(parseUsableRows(500)).toBeNull();
  });

  it("splits balances by K2, and falls back to everything but savings", async () => {
    const s = fixture();
    [2, 3, 4, 6, 7, 9, 10, 11, 12, 14].forEach((r, i) => s.setCell("2026 Q4", r, 2, (i + 1) * 10));
    let u = await readUsable(s, "2026 Q4", BUILTIN_ACCOUNTS);
    expect(u.source).toBe("sheet");
    expect(u.lines.filter((l) => !l.usable).map((l) => l.name)).toEqual(["Savings"]);
    expect([u.usable, u.total]).toEqual([450, 550]);

    await s.update("'2026 Q4'!K2", [["=SUM(C2:C3)"]]); // you changed what counts as usable
    u = await readUsable(s, "2026 Q4", BUILTIN_ACCOUNTS);
    expect(u.lines.filter((l) => l.usable).map((l) => l.name)).toEqual(["K-Bank", "Make"]);
    expect(u.usable).toBe(30);

    await s.clear("'2026 Q4'!K2");
    u = await readUsable(s, "2026 Q4", BUILTIN_ACCOUNTS);
    expect(u.source).toBe("default");
    expect(u.usable).toBe(450);
  });

  it("estimates runway", () => {
    expect(runwayDays(1000, 100)).toBe(10);
    expect(runwayDays(-5, 100)).toBe(0);
    expect(runwayDays(1000, 0)).toBeNull();
    expect(runwayText(1000, 0)).toBe("no recent spending to estimate from");
    expect(runwayText(150, 100)).toBe("lasts ~1 day at ฿100/day (30-day average)");
  });
});

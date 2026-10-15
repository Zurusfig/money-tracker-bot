import { beforeEach, describe, expect, it } from "vitest";
import { handleEvent, resetSetupCache } from "@/lib/bot";
import { QuotaError } from "@/lib/gemini";
import { OWNER, fixture, imageEvent, lastText, makeDeps, textEvent } from "./helpers";

beforeEach(() => resetSetupCache());

describe("Gemini quota", () => {
  it("alerts Discord once per day, keeps typed entries working, and tells you to type slips", async () => {
    const s = fixture();
    const { deps, replies, posts, ai } = makeDeps(s);
    ai.categorize.mockRejectedValue(new QuotaError("Gemini quota: 429"));
    ai.readSlip.mockRejectedValue(new QuotaError("Gemini quota: 429"));

    await handleEvent(deps, textEvent("65 kaprao"), OWNER);
    expect(lastText(replies)).toBe("✓ 65 (no category) · K-Bank · kaprao\nWhich category?");
    expect(s.getCell("2026 Q4", 46, 3)).toBe("kaprao");

    await handleEvent(deps, textEvent("80 somtam"), OWNER);
    await handleEvent(deps, imageEvent(), OWNER);
    expect(lastText(replies)).toMatch(/^Gemini's free limit for today is used up.*250 lunch$/);

    expect(posts.filter((p) => /quota/i.test(p))).toHaveLength(1);
    expect(posts).toHaveLength(1);
  });

  it("other Gemini errors still alert every time", async () => {
    const { deps, posts, ai } = makeDeps(fixture());
    ai.categorize.mockRejectedValue(new Error("Gemini 500: boom"));
    await handleEvent(deps, textEvent("65 kaprao"), OWNER);
    await handleEvent(deps, textEvent("80 somtam"), OWNER);
    expect(posts.filter((p) => /boom/.test(p))).toHaveLength(2);
  });
});

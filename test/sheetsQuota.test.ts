import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleEvent, resetQuotaAlerts, resetSetupCache } from "@/lib/bot";
import { SheetsQuotaError, isQuotaError, withReadCache, withRetry, withSharedCache, clearSharedCache } from "@/lib/sheets";
import { OWNER, fixture, lastText, makeDeps, textEvent } from "./helpers";

beforeEach(() => {
  resetSetupCache();
  resetQuotaAlerts();
  clearSharedCache();
});

describe("Sheets quota", () => {
  it("retries 429s, then gives up with SheetsQuotaError", async () => {
    const quota = Object.assign(new Error("Quota exceeded for quota metric 'Read requests'"), { code: 429 });
    expect(isQuotaError(quota)).toBe(true);
    expect(isQuotaError(new Error("permission denied"))).toBe(false);
    let n = 0;
    await expect(withRetry(async () => (++n < 3 ? Promise.reject(quota) : "ok"), [1, 1, 1])).resolves.toBe("ok");
    expect(n).toBe(3);
    await expect(withRetry(() => Promise.reject(quota), [1, 1])).rejects.toBeInstanceOf(SheetsQuotaError);
    await expect(withRetry(() => Promise.reject(new Error("boom")), [1])).rejects.toThrow("boom");
  });

  it("LINE gets a clear reply and Discord one alert per hour", async () => {
    const s = fixture();
    const { deps, replies, posts } = makeDeps(s);
    await handleEvent(deps, textEvent("help"), OWNER);
    s.batchGet = vi.fn(() => Promise.reject(new SheetsQuotaError("Google Sheets quota: 429")));
    await handleEvent(deps, textEvent("65 coffee"), OWNER);
    await handleEvent(deps, textEvent("70 coffee"), OWNER);
    expect(lastText(replies)).toMatch(/^Google Sheets is busy \(too many requests this minute\)/);
    expect(posts.filter((p) => /per-minute read limit/.test(p))).toHaveLength(1);
  });

  it("read caches: one API call per range, cleared by writes, failures not kept", async () => {
    const s = fixture();
    const spy = vi.spyOn(s, "batchGet");
    const c = withReadCache(s);
    await c.batchGet(["'2026 Q4'!A1:O"]);
    await c.batchGet(["'2026 Q4'!A1:O"]);
    expect(spy).toHaveBeenCalledTimes(1);
    await c.update("'2026 Q4'!D46", [["x"]]);
    expect((await c.batchGet(["'2026 Q4'!D46"]))[0]).toEqual([["x"]]);

    spy.mockRejectedValueOnce(new Error("blip"));
    await expect(c.batchGet(["'2026 Q4'!A2"])).rejects.toThrow("blip");
    await expect(c.batchGet(["'2026 Q4'!A2"])).resolves.toBeTruthy();

    const sh = withSharedCache(s, 60000);
    const before = spy.mock.calls.length;
    await withSharedCache(s).batchGet(["'2026 Q4'!B2"]);
    await sh.batchGet(["'2026 Q4'!B2"]); // second wrapper, same server: shared
    expect(spy.mock.calls.length - before).toBe(1);
  });
});

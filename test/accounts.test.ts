import { describe, expect, it } from "vitest";
import { Accounts, BUILTIN_ACCOUNTS as ACC, seedAccounts, validateAccounts } from "@/lib/accounts";

describe("Accounts", () => {
  it("maps slip bank names to accounts", () => {
    expect(ACC.fromLoose("K PLUS")).toBe("K-Bank");
    expect(ACC.fromLoose("Make by KBank")).toBe("Make");
    expect(ACC.fromLoose("SCB EASY")).toBe("SCB");
    expect(ACC.fromLoose("Rabbit LINE Pay")).toBe("Line Pay");
    expect(ACC.fromLoose("TrueMoney Wallet")).toBe("True-money");
    expect(ACC.fromLoose("เป๋าตัง")).toBe("GWallet");
    expect(ACC.fromLoose("Bangkok Bank")).toBeNull();
    expect(ACC.fromLoose("m")).toBe("Make");
  });

  it("resolves header aliases", () => {
    expect(ACC.fromHeader("Bank")).toBe("K-Bank");
    expect(ACC.fromHeader(" savings ")).toBe("Savings");
    expect(ACC.fromHeader("Description")).toBeNull();
  });

  it("validates config", () => {
    const base = { isDefault: false, balCategory: "", aliases: [], slipNames: [] };
    expect(validateAccounts([{ ...base, code: "bal", name: "A" }])).toEqual(['code "bal" is reserved']);
    expect(validateAccounts([{ ...base, code: "1", name: "A" }])[0]).toMatch(/must be letters/);
    expect(() => new Accounts([])).toThrow(/no accounts/);
  });

  it("seeds codes for any headers", () => {
    const s = seedAccounts(["Bangkok Bank", "Cash", "Credit Card", "Krungsri"]);
    expect(s.map((a) => a.code)).toEqual(["b", "c", "cr", "k"]);
    expect(s[0].isDefault).toBe(true);
    const own = seedAccounts(["Bank", "Make", "SCB"]);
    expect(own.map((a) => [a.code, a.isDefault])).toEqual([["k", true], ["m", false], ["s", false]]);
  });
});

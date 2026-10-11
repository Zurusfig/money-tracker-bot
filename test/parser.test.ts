import { describe, expect, it } from "vitest";
import { BUILTIN_ACCOUNTS } from "@/lib/accounts";
import { parseAmount, parseText as parse } from "@/lib/parser";

const parseText = (t: string) => parse(t, BUILTIN_ACCOUNTS);

describe("parseText", () => {
  it("expense with default account", () => {
    expect(parseText("65 lunch")).toEqual({ kind: "entry", sign: "-", amount: 65, description: "lunch", account: null });
  });
  it("trailing account code", () => {
    expect(parseText("65 lunch m")).toMatchObject({ amount: 65, description: "lunch", account: "Make" });
    expect(parseText("65 lunch sv")).toMatchObject({ description: "lunch", account: "Savings" });
    expect(parseText("120 grab t")).toMatchObject({ description: "grab", account: "True-money" });
  });
  it("trailing token that is not an exact code stays in the description", () => {
    expect(parseText("65 lunch mk")).toMatchObject({ description: "lunch mk", account: null });
    expect(parseText("65 lunch M")).toMatchObject({ description: "lunch", account: "Make" });
    expect(parseText("40 7 eleven")).toMatchObject({ description: "7 eleven", account: null });
  });
  it("amount only or amount + code", () => {
    expect(parseText("65")).toMatchObject({ amount: 65, description: "", account: null });
    expect(parseText("65 k")).toMatchObject({ amount: 65, description: "", account: "K-Bank" });
  });
  it("decimals, commas, extra spaces", () => {
    expect(parseText("  1,250.50   big  dinner  ")).toMatchObject({ amount: 1250.5, description: "big dinner" });
    expect(parseText("49.5 coffee")).toMatchObject({ amount: 49.5 });
  });
  it("income and refund candidates", () => {
    expect(parseText("+7000 allowance")).toMatchObject({ kind: "entry", sign: "+", amount: 7000, description: "allowance" });
    expect(parseText("+134 food s")).toMatchObject({ sign: "+", description: "food", account: "SCB" });
  });
  it("transfer", () => {
    expect(parseText("t k m 5000")).toEqual({ kind: "transfer", from: "K-Bank", to: "Make", amount: 5000, description: "" });
    expect(parseText("t sv k 1,000 rent")).toMatchObject({ from: "Savings", to: "K-Bank", amount: 1000, description: "rent" });
    expect(parseText("t k k 100")).toBeNull();
    expect(parseText("t k x 100")).toBeNull();
  });
  it("bal", () => {
    expect(parseText("bal k 3200")).toEqual({ kind: "bal", account: "K-Bank", actual: 3200 });
    expect(parseText("bal r 0")).toEqual({ kind: "bal", account: "Rabbit", actual: 0 });
    expect(parseText("bal s -50")).toEqual({ kind: "bal", account: "SCB", actual: -50 });
    expect(parseText("bal x 10")).toBeNull();
  });
  it("undo, 0, help", () => {
    expect(parseText("undo")).toEqual({ kind: "undo" });
    expect(parseText("Undo ")).toEqual({ kind: "undo" });
    expect(parseText("0")).toEqual({ kind: "nospend" });
    expect(parseText("?")).toEqual({ kind: "help" });
  });
  it("rejects junk", () => {
    expect(parseText("lunch 65")).toBeNull();
    expect(parseText("-65 lunch")).toBeNull();
    expect(parseText("0 lunch")).toBeNull();
    expect(parseText("")).toBeNull();
    expect(parseText("+")).toBeNull();
  });
  it("parseAmount", () => {
    expect(parseAmount("1,234")).toBe(1234);
    expect(parseAmount("12,34")).toBeNull();
    expect(parseAmount("1.234")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
  });
});

describe("view commands", () => {
  it("bal alone shows balances, bal with args fixes one", () => {
    expect(parseText("bal")).toEqual({ kind: "balances" });
    expect(parseText("Balance")).toEqual({ kind: "balances" });
    expect(parseText("bal k 100")).toMatchObject({ kind: "bal" });
    expect(parseText("stats")).toEqual({ kind: "stats" });
  });
});

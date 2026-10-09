// Accounts are configured per sheet in the _Config tab.
export type AccountName = string;

export type AccountDef = {
  code: string; // what you type: "65 lunch m"
  name: string; // must match the row 18 header in quarter tabs
  isDefault: boolean; // used when no code is typed
  balCategory: string; // category for `bal` gap rows ("" = Untracked)
  aliases: string[]; // other header spellings, e.g. "Bank" on older tabs
  slipNames: string[]; // words on a slip that identify this account as the payer
};

const RESERVED = new Set(["bal", "undo", "help"]);

// The original owner's setup. Used to seed _Config when the sheet's headers match.
export const BUILTIN: AccountDef[] = [
  { code: "k", name: "K-Bank", isDefault: true, balCategory: "", aliases: ["Bank"], slipNames: ["k plus", "kplus", "kbank", "k-bank", "kasikorn", "กสิกร"] },
  { code: "m", name: "Make", isDefault: false, balCategory: "", aliases: [], slipNames: ["make"] },
  { code: "s", name: "SCB", isDefault: false, balCategory: "", aliases: [], slipNames: ["scb", "siam commercial", "ไทยพาณิชย์"] },
  { code: "c", name: "Cash-Wallet", isDefault: false, balCategory: "", aliases: [], slipNames: [] },
  { code: "h", name: "Head", isDefault: false, balCategory: "", aliases: [], slipNames: [] },
  { code: "r", name: "Rabbit", isDefault: false, balCategory: "Transportation", aliases: [], slipNames: [] },
  { code: "l", name: "Line Pay", isDefault: false, balCategory: "", aliases: [], slipNames: ["line pay", "rabbit line pay"] },
  { code: "t", name: "True-money", isDefault: false, balCategory: "", aliases: [], slipNames: ["truemoney", "true money", "ทรูมันนี่"] },
  { code: "g", name: "GWallet", isDefault: false, balCategory: "", aliases: [], slipNames: ["g-wallet", "gwallet", "paotang", "เป๋าตัง"] },
  { code: "sv", name: "Savings", isDefault: false, balCategory: "", aliases: [], slipNames: [] },
];

const norm = (s: string) => s.trim().toLowerCase();

export function validateAccounts(list: AccountDef[]): string[] {
  const errors: string[] = [];
  const codes = new Set<string>();
  const names = new Set<string>();
  if (!list.length) errors.push("no accounts");
  for (const a of list) {
    if (!/^[a-z][a-z0-9]*$/.test(a.code)) errors.push(`code "${a.code}" must be letters/digits starting with a letter`);
    if (RESERVED.has(a.code)) errors.push(`code "${a.code}" is reserved`);
    if (codes.has(a.code)) errors.push(`code "${a.code}" is used twice`);
    if (!a.name) errors.push(`code "${a.code}" has no account name`);
    if (names.has(norm(a.name))) errors.push(`account "${a.name}" is listed twice`);
    codes.add(a.code);
    names.add(norm(a.name));
  }
  if (list.filter((a) => a.isDefault).length > 1) errors.push("more than one default account");
  return errors;
}

export class Accounts {
  readonly list: AccountDef[];

  constructor(list: AccountDef[]) {
    const errors = validateAccounts(list);
    if (errors.length) throw new Error(`_Config: ${errors.join("; ")}`);
    this.list = list;
  }

  get default(): AccountDef {
    return this.list.find((a) => a.isDefault) ?? this.list[0];
  }

  byCode(code: string): AccountName | null {
    return this.list.find((a) => a.code === code.toLowerCase())?.name ?? null;
  }

  codeOf(name: AccountName): string {
    return this.list.find((a) => a.name === name)?.code ?? "?";
  }

  // Row 18 headers and D2:D14 balance names
  fromHeader(h: unknown): AccountName | null {
    if (typeof h !== "string" || !h.trim()) return null;
    const t = norm(h);
    return this.list.find((a) => norm(a.name) === t || a.aliases.some((x) => norm(x) === t))?.name ?? null;
  }

  // Code, name, alias, or a slip name contained in the text
  fromLoose(s: string): AccountName | null {
    const t = norm(s);
    if (!t) return null;
    const exact = this.byCode(t) ?? this.fromHeader(t);
    if (exact) return exact;
    // Earliest mention wins ("Make by KBank" is Make), then the longest keyword
    let best: { name: string; pos: number; len: number } | null = null;
    for (const a of this.list) {
      for (const k of [a.name, ...a.slipNames].map(norm).filter(Boolean)) {
        const pos = t.indexOf(k);
        if (pos < 0) continue;
        if (!best || pos < best.pos || (pos === best.pos && k.length > best.len)) best = { name: a.name, pos, len: k.length };
      }
    }
    return best?.name ?? null;
  }

  balCategory(name: AccountName): string {
    return this.list.find((a) => a.name === name)?.balCategory ?? "";
  }
}

export const BUILTIN_ACCOUNTS = new Accounts(BUILTIN);

// Codes for headers that aren't in BUILTIN: first letter, then first two, then letter+number.
export function seedAccounts(headers: string[]): AccountDef[] {
  const used = new Set<string>();
  const out: AccountDef[] = [];
  for (const h of headers) {
    const builtin = BUILTIN.find((b) => norm(b.name) === norm(h) || b.aliases.some((x) => norm(x) === norm(h)));
    let code = builtin?.code ?? "";
    if (!code || used.has(code)) {
      const letters = norm(h).replace(/[^a-z]/g, "") || "a";
      const candidates = [letters.slice(0, 1), letters.slice(0, 2), letters.slice(0, 3)];
      code = candidates.find((c) => c && !used.has(c) && !RESERVED.has(c)) ?? "";
      for (let i = 2; !code; i++) if (!used.has(`${letters[0]}${i}`)) code = `${letters[0]}${i}`;
    }
    used.add(code);
    out.push({
      code,
      name: h.trim(),
      isDefault: false,
      balCategory: builtin?.balCategory ?? "",
      aliases: builtin && norm(builtin.name) === norm(h) ? builtin.aliases : [],
      slipNames: builtin?.slipNames ?? [],
    });
  }
  const def = out.find((a) => BUILTIN.some((b) => b.isDefault && norm(b.name) === norm(a.name))) ?? out[0];
  if (def) def.isDefault = true;
  return out;
}

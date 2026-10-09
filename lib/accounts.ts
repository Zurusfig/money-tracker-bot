export const ACCOUNTS = [
  { code: "k", name: "K-Bank" },
  { code: "m", name: "Make" },
  { code: "s", name: "SCB" },
  { code: "c", name: "Cash-Wallet" },
  { code: "h", name: "Head" },
  { code: "r", name: "Rabbit" },
  { code: "l", name: "Line Pay" },
  { code: "t", name: "True-money" },
  { code: "g", name: "GWallet" },
  { code: "sv", name: "Savings" },
] as const;

export type AccountName = (typeof ACCOUNTS)[number]["name"];
export const DEFAULT_ACCOUNT: AccountName = "K-Bank";

export function accountByCode(code: string): AccountName | null {
  return ACCOUNTS.find((a) => a.code === code.toLowerCase())?.name ?? null;
}

export function codeOf(name: AccountName): string {
  return ACCOUNTS.find((a) => a.name === name)!.code;
}

// Older tabs label the K-Bank column "Bank".
const HEADER_ALIASES: Record<string, AccountName> = { bank: "K-Bank" };

export function accountFromHeader(h: unknown): AccountName | null {
  if (typeof h !== "string") return null;
  const t = h.trim().toLowerCase();
  return ACCOUNTS.find((a) => a.name.toLowerCase() === t)?.name ?? HEADER_ALIASES[t] ?? null;
}

// Loose match for names coming from slips or the _Accounts tab.
export function accountFromLoose(s: string): AccountName | null {
  const t = s.trim().toLowerCase();
  if (!t) return null;
  const exact = accountByCode(t) ?? accountFromHeader(t);
  if (exact) return exact;
  if (/make/.test(t)) return "Make";
  if (/k\s*plus|kbank|k-bank|kasikorn|กสิกร/.test(t)) return "K-Bank";
  if (/scb|siam commercial|ไทยพาณิชย์/.test(t)) return "SCB";
  if (/true\s*money|ทรูมันนี่/.test(t)) return "True-money";
  if (/line\s*pay|rabbit line/.test(t)) return "Line Pay";
  if (/rabbit/.test(t)) return "Rabbit";
  if (/g-?wallet|เป๋าตัง|paotang/.test(t)) return "GWallet";
  if (/saving/.test(t)) return "Savings";
  if (/cash/.test(t)) return "Cash-Wallet";
  if (/head/.test(t)) return "Head";
  return null;
}

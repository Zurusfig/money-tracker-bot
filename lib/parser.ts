import { accountByCode, type AccountName } from "./accounts";

export type Command =
  | { kind: "entry"; sign: "-" | "+"; amount: number; description: string; account: AccountName | null }
  | { kind: "transfer"; from: AccountName; to: AccountName; amount: number; description: string }
  | { kind: "bal"; account: AccountName; actual: number }
  | { kind: "undo" }
  | { kind: "nospend" }
  | { kind: "help" };

const AMOUNT = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?|\.\d{1,2}`;

export function parseAmount(s: string): number | null {
  if (!new RegExp(`^(?:${AMOUNT})$`).test(s)) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function parseText(input: string): Command | null {
  const text = input.trim().replace(/\s+/g, " ");
  const lower = text.toLowerCase();
  if (lower === "undo") return { kind: "undo" };
  if (lower === "0") return { kind: "nospend" };
  if (lower === "help" || lower === "?") return { kind: "help" };

  const tokens = text.split(" ");
  const head = tokens[0].toLowerCase();

  // t <from> <to> <amount> [description]
  if (head === "t" && tokens.length >= 4) {
    const from = accountByCode(tokens[1]);
    const to = accountByCode(tokens[2]);
    const amount = parseAmount(tokens[3]);
    if (from && to && from !== to && amount && amount > 0) {
      return { kind: "transfer", from, to, amount, description: tokens.slice(4).join(" ") };
    }
    return null;
  }

  // bal <account> <actual>, actual may be negative or zero
  if (head === "bal" && tokens.length === 3) {
    const account = accountByCode(tokens[1]);
    const neg = tokens[2].startsWith("-");
    const amount = parseAmount(neg ? tokens[2].slice(1) : tokens[2]);
    if (account && amount !== null) return { kind: "bal", account, actual: neg ? -amount : amount };
    return null;
  }

  // [+]<amount> [description...] [account code]
  const m = /^(\+?)(.+)$/.exec(tokens[0]);
  const amount = m ? parseAmount(m[2]) : null;
  if (!m || amount === null || amount <= 0) return null;
  let rest = tokens.slice(1);
  let account: AccountName | null = null;
  if (rest.length > 0) {
    const last = accountByCode(rest[rest.length - 1]);
    if (last) {
      account = last;
      rest = rest.slice(0, -1);
    }
  }
  return { kind: "entry", sign: m[1] === "+" ? "+" : "-", amount, description: rest.join(" "), account };
}

export const HELP_TEXT = `📝 Spend
65 lunch
→ 65 from K-Bank
65 lunch m
→ 65 from Make (code at the end)

💰 Money in
+7000 allowance
→ income
+134 food
→ refund to Food & Drinks

🔁 Transfer
t k m 5000
→ K-Bank to Make

⚖️ Fix a balance
bal k 3200
→ logs the gap as Untracked

📷 Slip photo
→ logged automatically

↩️ undo
→ remove last bot row
0
→ no spending today

🏦 Account codes
k = K-Bank
m = Make
s = SCB
c = Cash-Wallet
h = Head
r = Rabbit
l = Line Pay
t = True-money
g = GWallet
sv = Savings`;

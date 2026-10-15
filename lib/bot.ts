import type { AccountName, Accounts } from "./accounts";
import type { Ai } from "./gemini";
import { text, type LineApi, type LineMessage, type QuickItem } from "./line";
import type { Notifier } from "./discord";
import { helpText, parseText, type Command } from "./parser";
import { buildStats } from "./stats";
import { readUsable, recentDailySpend, runwayText, type BalanceLine } from "./usable";
import type { Cell, SheetsApi } from "./sheets";
import {
  ensureBotTabs, lastLiveWrite, log, matchCategoryName, matchOwnAccount, matchRule,
  readAccounts, readLog, readOwnAccounts, readRules, saveRule,
} from "./state";
import { bkkToday, isoDate, parseIso, quarterTabName, type Ymd } from "./time";
import {
  TEMPLATE, UNTRACKED, addCategory, clearRow, ensureQuarter, ensureUntracked, findRowById, readBalances,
  readCategories, readQuarter, readRow, updateCells, writeEntry, type Entry, type ParsedRow,
} from "./workbook";

export const CATEGORY_MIN_CONFIDENCE = 0.75;
export const AMOUNT_MIN_CONFIDENCE = 0.9;
export const FIELD_MIN_CONFIDENCE = 0.6;

export type Deps = { sheets: SheetsApi; line: LineApi; ai: Ai; notify: Notifier; now?: () => Date };
// Per-event context: deps + accounts from _Config
export type Ctx = Deps & { acc: Accounts };

export type LineEvent = {
  type: string;
  replyToken?: string;
  source?: { userId?: string };
  message?: { id: string; type: string; text?: string };
  postback?: { data: string };
  webhookEventId?: string;
};

// ---------- formatting ----------

export function fmt(n: number): string {
  return Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function summary(p: Pick<ParsedRow, "type" | "category" | "description" | "amounts">): string {
  const entries = Object.entries(p.amounts) as [AccountName, number][];
  if (p.type === "Transfer") {
    const from = entries.find(([, v]) => v < 0);
    const to = entries.find(([, v]) => v > 0);
    const amt = fmt(from?.[1] ?? to?.[1] ?? 0);
    return [`${amt} ${from?.[0] ?? "?"} → ${to?.[0] ?? "?"}`, p.description].filter(Boolean).join(" · ");
  }
  const [acct, amt] = entries[0] ?? ["?", 0];
  const sign = amt > 0 ? "+" : "";
  const label = p.type === "Income" ? "Income" : p.category || "(no category)";
  return [`${sign}${fmt(amt)} ${label}`, acct, p.description].filter(Boolean).join(" · ");
}

function pb(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

function rowButtons(tab: string, id: string, type = "Expense"): QuickItem[] {
  if (type === "Transfer") return [{ label: "Delete", data: pb({ a: "del", t: tab, id }) }];
  return [
    { label: "Account", data: pb({ a: "ma", t: tab, id }) },
    { label: "Category", data: pb({ a: "mc", t: tab, id }) },
    { label: "Delete", data: pb({ a: "del", t: tab, id }) },
  ];
}

function categoryButtons(tab: string, id: string, categories: string[], suggestion?: string): QuickItem[] {
  const fresh = suggestion ? [{ label: `➕ ${suggestion}`, data: pb({ a: "newcat", t: tab, id, v: suggestion }) }] : [];
  return [
    ...fresh,
    ...categories.slice(0, 12 - fresh.length).map((c) => ({ label: c, data: pb({ a: "cat", t: tab, id, v: c }) })),
    { label: "Delete", data: pb({ a: "del", t: tab, id }) },
  ];
}

function accountButtons(acc: Accounts, tab: string, id: string): QuickItem[] {
  return acc.list.map((a) => ({ label: a.name, data: pb({ a: "acct", t: tab, id, v: a.code }) }));
}

// ---------- setup ----------

let setupDone: Promise<void> | null = null;

export function resetSetupCache() {
  setupDone = null;
}

async function ensureSetup(d: Deps) {
  setupDone ??= (async () => {
    await ensureBotTabs(d.sheets);
    const tabs = await d.sheets.listTabs();
    await ensureUntracked(d.sheets, TEMPLATE);
    const current = quarterTabName(bkkToday(now(d)));
    if (tabs.some((t) => t.title === current)) await ensureUntracked(d.sheets, current);
  })().catch((e) => {
    setupDone = null;
    throw e;
  });
  return setupDone;
}

function now(d: Deps) {
  return d.now ? d.now() : new Date();
}

// ---------- entry point ----------

export async function handleEvent(d: Deps, ev: LineEvent, ownerId: string): Promise<void> {
  if (ev.source?.userId !== ownerId || !ev.replyToken) return;
  let reply: LineMessage[];
  try {
    await ensureSetup(d);
    const c: Ctx = { ...d, acc: await readAccounts(d.sheets) };
    if (ev.type === "message" && ev.message?.type === "text") reply = await onText(c, ev.message.text ?? "", ev.message.id);
    else if (ev.type === "message" && ev.message?.type === "image") reply = await onImage(c, ev.message.id);
    else if (ev.type === "postback" && ev.postback) reply = await onPostback(c, ev.postback.data);
    else return;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await reportError(d, `webhook ${ev.type}`, msg);
    reply = [text("Error, nothing was logged. Details sent to Discord.")];
  }
  try {
    await d.line.reply(ev.replyToken, reply);
  } catch (err) {
    // Redelivered events carry expired reply tokens; nothing else to do.
    console.error(err);
  }
}

export async function reportError(d: Deps, where: string, msg: string) {
  console.error(where, msg);
  await Promise.allSettled([d.notify.post(`⚠️ money-bot error (${where}): ${msg}`), log(d.sheets, "error", "", "", `${where}: ${msg}`)]);
}

// ---------- text ----------

async function onText(d: Ctx, raw: string, messageId: string): Promise<LineMessage[]> {
  const cmd = parseText(raw, d.acc);
  if (!cmd) return [text("Didn't get that. Try 65 lunch, or send help for all commands.", [{ label: "help", text: "help" }])];
  return runCommand(d, cmd, `L${messageId}`);
}

export async function runCommand(d: Ctx, cmd: Command, id: string): Promise<LineMessage[]> {
  const today = bkkToday(now(d));
  switch (cmd.kind) {
    case "help":
      return [text(helpText(d.acc))];
    case "entry":
      return cmd.sign === "-" ? expense(d, cmd, id, today) : plus(d, cmd, id, today);
    case "transfer":
      return commit(d, {
        date: today, type: "Transfer", category: "", description: cmd.description,
        amounts: { [cmd.from]: -cmd.amount, [cmd.to]: cmd.amount }, id,
      });
    case "balances":
      return balances(d, today);
    case "stats":
      return stats(d);
    case "dashboard": {
      const id = process.env.NEXT_PUBLIC_LIFF_ID;
      return [text(id ? `📈 https://liff.line.me/${id}` : "Dashboard isn't set up yet. See README: Dashboard.")];
    }
    case "categories": {
      const { tab, categories } = await categoriesFor(d, today);
      return [text([`🏷️ Categories · ${tab}`, ...categories.map((c) => `• ${c}`), "", "New one: add #name to an entry, e.g. 450 dog food #pets"].join("\n"))];
    }
    case "bal":
      return bal(d, cmd.account, cmd.actual, id, today);
    case "undo":
      return undo(d, id);
    case "nospend":
      return noSpend(d, id, today);
  }
}

async function categoriesFor(d: Ctx, date: Ymd): Promise<{ tab: string; categories: string[] }> {
  const tab = await ensureQuarter(d.sheets, date, d.acc);
  return { tab, categories: await readCategories(d.sheets, tab) };
}

type Resolved = { category: string; lowConfidence: boolean; suggestion?: string };

async function resolveCategory(d: Ctx, description: string, categories: string[], useAi: boolean): Promise<Resolved> {
  if (!description) return { category: "", lowConfidence: true };
  const rules = await readRules(d.sheets);
  const hit = matchRule(rules, description, categories) ?? matchCategoryName(description, categories);
  if (hit) return { category: hit, lowConfidence: false };
  if (!useAi) return { category: "", lowConfidence: true };
  try {
    const g = await d.ai.categorize(description, categories);
    if (g.category && g.confidence >= CATEGORY_MIN_CONFIDENCE) return { category: g.category, lowConfidence: false };
    return { category: "", lowConfidence: true, suggestion: g.newCategory };
  } catch (err) {
    await reportError(d, "gemini categorize", err instanceof Error ? err.message : String(err));
  }
  return { category: "", lowConfidence: true };
}

// Adds to the quarter tab and _Template so later quarters keep it
async function createCategory(d: Ctx, tab: string, raw: string): Promise<string> {
  const name = await addCategory(d.sheets, tab, raw);
  if (tab !== TEMPLATE) {
    try {
      await addCategory(d.sheets, TEMPLATE, name);
    } catch (err) {
      await reportError(d, "add category to _Template", err instanceof Error ? err.message : String(err));
    }
  }
  return name;
}

// "#pets": an existing category if it matches, else a new one
async function tagCategory(d: Ctx, tab: string, tag: string, categories: string[]): Promise<{ category: string; created: boolean }> {
  const t = tag.trim().toLowerCase();
  const hit = categories.find((c) => c.toLowerCase() === t) ?? matchCategoryName(tag, categories);
  if (hit) return { category: hit, created: false };
  return { category: await createCategory(d, tab, tag), created: true };
}

async function tagged(d: Ctx, cmd: Extract<Command, { kind: "entry" }>, id: string, today: Ymd, sign: 1 | -1) {
  const { tab, categories } = await categoriesFor(d, today);
  const { category, created } = await tagCategory(d, tab, cmd.tag!, categories);
  if (cmd.description) await saveRule(d.sheets, cmd.description, category);
  const msgs = await commit(d, {
    date: today, type: "Expense", category, description: cmd.description,
    amounts: { [cmd.account ?? d.acc.default.name]: sign * cmd.amount }, id,
  });
  if (created) msgs[0].text += `\n🆕 New category: ${category}`;
  return msgs;
}

async function expense(d: Ctx, cmd: Extract<Command, { kind: "entry" }>, id: string, today: Ymd) {
  if (cmd.tag) return tagged(d, cmd, id, today, -1);
  const { categories } = await categoriesFor(d, today);
  const r = await resolveCategory(d, cmd.description, categories, true);
  return commit(d, {
    date: today, type: "Expense", category: r.category, description: cmd.description,
    amounts: { [cmd.account ?? d.acc.default.name]: -cmd.amount }, id,
  }, categories, r.suggestion);
}

// "+134 food" is a refund only when the word is a known category; otherwise Income.
async function plus(d: Ctx, cmd: Extract<Command, { kind: "entry" }>, id: string, today: Ymd) {
  if (cmd.tag) return tagged(d, cmd, id, today, 1);
  const { categories } = await categoriesFor(d, today);
  const r = await resolveCategory(d, cmd.description, categories, false);
  const acct = cmd.account ?? d.acc.default.name;
  if (r.category) {
    return commit(d, { date: today, type: "Expense", category: r.category, description: cmd.description, amounts: { [acct]: cmd.amount }, id });
  }
  return commit(d, { date: today, type: "Income", category: "", description: cmd.description, amounts: { [acct]: cmd.amount }, id });
}

async function commit(d: Ctx, e: Entry, categories?: string[], suggestion?: string): Promise<LineMessage[]> {
  return (await commitEntry(d, e, categories, suggestion)).msgs;
}

async function commitEntry(d: Ctx, e: Entry, categories?: string[], suggestion?: string): Promise<{ msgs: LineMessage[]; duplicate: boolean }> {
  const res = await writeEntry(d.sheets, e, d.acc);
  if (res.duplicate) return { msgs: [text(`Already logged (${res.tab} row ${res.row}).`)], duplicate: true };
  await log(d.sheets, "write", res.tab, e.id, summary(e));
  const line = `✓ ${summary(e)}`;
  if (e.type === "Expense" && !e.category) {
    await log(d.sheets, "lowconf", res.tab, e.id, "category");
    const cats = categories ?? (await readCategories(d.sheets, res.tab));
    return { msgs: [text(`${line}\nWhich category?`, categoryButtons(res.tab, e.id, cats, suggestion))], duplicate: false };
  }
  return { msgs: [text(line, rowButtons(res.tab, e.id, e.type))], duplicate: false };
}

async function bal(d: Ctx, account: AccountName, actual: number, id: string, today: Ymd) {
  const tab = await ensureQuarter(d.sheets, today, d.acc);
  const balances = await readBalances(d.sheets, tab, d.acc);
  const sheet = balances.get(account);
  if (!sheet) throw new Error(`${tab}: no balance row for ${account}`);
  const gap = Math.round((actual - sheet.value) * 100) / 100;
  if (gap === 0) return [text(`${account} matches the sheet (${fmt(actual)}). Nothing logged.`)];
  const category = d.acc.balCategory(account) || UNTRACKED;
  const res = await writeEntry(d.sheets, {
    date: today, type: "Expense", category, description: "bal check", amounts: { [account]: gap }, id,
  }, d.acc);
  if (res.duplicate) return [text(`Already logged (${res.tab} row ${res.row}).`)];
  await log(d.sheets, "write", res.tab, id, `bal ${account} ${gap}`);
  const dir = gap < 0 ? "-" : "+";
  return [text(`${account} gap ${dir}${fmt(gap)} (sheet ${fmt(sheet.value)}, real ${fmt(actual)}). Logged as ${category}.`, rowButtons(res.tab, id))];
}

function signed(n: number): string {
  return `${n < 0 ? "-" : ""}${fmt(n)}`;
}

async function balances(d: Ctx, today: Ymd): Promise<LineMessage[]> {
  const tab = await ensureQuarter(d.sheets, today, d.acc);
  const u = await readUsable(d.sheets, tab, d.acc);
  if (!u.lines.length) return [text(`No balances found in ${tab} C2:D14.`)];
  const perDay = await recentDailySpend(d.sheets, d.acc, today);
  const line = (l: BalanceLine) => `${l.name} (${l.code}): ${signed(l.value)}${l.value < 0 ? " ⚠️" : ""}`;
  const other = u.lines.filter((l) => !l.usable);
  return [text([
    `💳 Usable: ${signed(u.usable)}`,
    runwayText(u.usable, perDay),
    "",
    ...u.lines.filter((l) => l.usable).map(line),
    ...(other.length ? ["", "🔒 Not usable", ...other.map(line)] : []),
    "",
    `Total, all accounts: ${signed(u.total)}`,
    `Off? Send bal ${d.acc.default.code} <real amount>`,
  ].join("\n"))];
}

async function stats(d: Ctx): Promise<LineMessage[]> {
  if (!d.notify.enabled) return [text("Discord isn't set up. Add DISCORD_WEBHOOK_URL in Vercel.")];
  await d.notify.postEmbed(await buildStats(d.sheets, d.acc, now(d)));
  return [text("📊 Stats sent to Discord.")];
}

async function undo(d: Ctx, cmdId: string) {
  const entries = await readLog(d.sheets);
  if (entries.some((e) => e.kind === "undo" && e.detail === cmdId)) return [text("Already undone.")];
  const last = lastLiveWrite(entries);
  if (!last) return [text("Nothing to undo.")];
  const view = await readQuarter(d.sheets, last.tab, d.acc);
  const row = findRowById(view, last.id);
  await log(d.sheets, "undo", last.tab, last.id, cmdId);
  if (!row) return [text("Last bot row is already gone from the sheet.")];
  const p = readRow(view, row);
  await clearRow(d.sheets, view, row);
  return [text(`Undone: ${p ? summary(p) : last.detail}`)];
}

async function noSpend(d: Ctx, cmdId: string, today: Ymd) {
  const date = isoDate(today);
  const entries = await readLog(d.sheets);
  if (entries.some((e) => e.kind === "nospend" && e.detail === date)) return [text(`${date} is already a no-spend day.`)];
  await log(d.sheets, "nospend", "", cmdId, date);
  return [text(`✓ No-spend day: ${date}`)];
}

// ---------- postbacks ----------

async function onPostback(d: Ctx, data: string): Promise<LineMessage[]> {
  const p = new URLSearchParams(data);
  const a = p.get("a");
  if (a === "slip") return slipConfirmed(d, p);
  if (a === "slipno") return [text("Not logged. Send it as text instead, e.g. 120 lunch")];

  const tab = p.get("t") ?? "";
  const id = p.get("id") ?? "";
  const view = await readQuarter(d.sheets, tab, d.acc);
  const row = findRowById(view, id);
  const cur = row ? readRow(view, row) : null;
  if (!row || !cur) return [text("That row is gone.")];

  switch (a) {
    case "ma":
      return [text("Move to which account?", accountButtons(d.acc, tab, id))];
    case "mc":
      return [text("Which category?", categoryButtons(tab, id, await readCategories(d.sheets, tab)))];
    case "del":
      await clearRow(d.sheets, view, row);
      await log(d.sheets, "delete", tab, id, "button");
      return [text(`Deleted: ${summary(cur)}`)];
    case "newcat":
    case "cat": {
      let cat = p.get("v") ?? "";
      let created = false;
      if (a === "newcat") {
        const before = await readCategories(d.sheets, tab);
        cat = await createCategory(d, tab, cat);
        created = !before.includes(cat);
      } else if (!(await readCategories(d.sheets, tab)).includes(cat)) return [text(`Unknown category ${cat}.`)];
      if (cur.type === "Transfer") return [text("Transfers have no category.")];
      if (cur.type === "Income") {
        // Income with a category becomes a refund: positive Expense
        await updateCells(d.sheets, tab, row, new Map([[1, "Expense"], [2, cat]]));
        cur.type = "Expense";
      } else {
        await updateCells(d.sheets, tab, row, new Map([[2, cat]]));
      }
      cur.category = cat;
      if (cur.description) await saveRule(d.sheets, cur.description, cat);
      await log(d.sheets, "edit", tab, id, `category ${cat}`);
      return [text(`✓ ${summary(cur)}${created ? `\n🆕 New category: ${cat}` : ""}`, rowButtons(tab, id))];
    }
    case "acct": {
      const to = d.acc.byCode(p.get("v") ?? "");
      const entries = Object.entries(cur.amounts) as [AccountName, number][];
      if (!to) return [text("Unknown account.")];
      if (cur.type === "Transfer" || entries.length !== 1) return [text("Can't move this row. Delete it and send it again.")];
      const [from, amt] = entries[0];
      if (from !== to) {
        await updateCells(d.sheets, tab, row, new Map<number, Cell>([[view.accountCols.get(from)!, ""], [view.accountCols.get(to)!, amt]]));
        cur.amounts = { [to]: amt };
      }
      await log(d.sheets, "edit", tab, id, `account ${to}`);
      return [text(`✓ ${summary(cur)}`, rowButtons(tab, id))];
    }
  }
  return [text("Unknown button.")];
}

// ---------- slips ----------

export type SlipPlan = {
  date: Ymd;
  amount: number;
  from: AccountName;
  to: AccountName | null; // own account: transfer
  category: string;
  description: string;
  id: string;
  notes: string[];
};

async function onImage(d: Ctx, messageId: string): Promise<LineMessage[]> {
  const today = bkkToday(now(d));
  const { categories } = await categoriesFor(d, today);
  const img = await d.line.getContent(messageId);
  const s = await d.ai.readSlip(img.data, img.mimeType, categories);
  if (!s.is_slip) return [text("That doesn't look like a payment slip. Nothing logged.")];
  const amount = Math.round(Number(s.amount?.value) * 100) / 100;
  if (!(amount > 0)) return [text("Couldn't read the amount. Send it as text, e.g. 120 lunch")];

  const notes: string[] = [];
  let from = s.source_bank.confidence >= FIELD_MIN_CONFIDENCE ? d.acc.fromLoose(s.source_bank.value) : null;
  if (!from) {
    from = d.acc.default.name;
    notes.push(`source "${s.source_bank.value || "?"}" unknown, used ${from}`);
  }
  let date = s.datetime.confidence >= FIELD_MIN_CONFIDENCE ? parseIso(s.datetime.value) : null;
  if (!date || isoDate(date) > isoDate(today)) {
    if (s.datetime.value) notes.push(`date unclear, used today`);
    date = today;
  }
  const ref = s.transaction_ref.confidence >= FIELD_MIN_CONFIDENCE ? s.transaction_ref.value.replace(/[^A-Za-z0-9]/g, "") : "";
  const id = ref.length >= 6 ? `S${ref}` : `L${messageId}`;

  const own = await readOwnAccounts(d.sheets, d.acc);
  const to = matchOwnAccount(own, s.recipient_name.value ?? "", s.recipient_account.value ?? "");
  const recipient = (s.recipient_name.value || s.recipient_account.value || "").trim().slice(0, 40);

  let category = "";
  if (!to || to === from) {
    const rules = await readRules(d.sheets);
    category = matchRule(rules, recipient, categories) ??
      (s.category.value && categories.includes(s.category.value) && s.category.confidence >= CATEGORY_MIN_CONFIDENCE ? s.category.value : "");
  }
  const plan: SlipPlan = { date, amount, from, to: to && to !== from ? to : null, category, description: recipient, id, notes };

  // A wrong amount is worse than a missing row.
  if ((s.amount.confidence ?? 0) < AMOUNT_MIN_CONFIDENCE) {
    const data = pb({
      a: "slip", amt: String(amount), f: d.acc.codeOf(plan.from), to: plan.to ? d.acc.codeOf(plan.to) : "",
      d: isoDate(date), id, c: category, desc: recipient.slice(0, 30),
    });
    return [text(`Read ${fmt(amount)} from ${plan.from}${recipient ? ` to ${recipient}` : ""}. Is the amount right?`, [
      { label: `Yes, ${fmt(amount)}`, data },
      { label: "No", data: pb({ a: "slipno" }) },
    ])];
  }
  return commitSlip(d, plan);
}

async function slipConfirmed(d: Ctx, p: URLSearchParams): Promise<LineMessage[]> {
  const date = parseIso(p.get("d") ?? "");
  const from = d.acc.byCode(p.get("f") ?? "");
  const amount = Number(p.get("amt"));
  if (!date || !from || !(amount > 0)) return [text("Slip data is broken. Send it as text.")];
  return commitSlip(d, {
    date, amount, from, to: d.acc.byCode(p.get("to") ?? ""), category: p.get("c") ?? "",
    description: p.get("desc") ?? "", id: p.get("id") ?? "", notes: [],
  });
}

async function commitSlip(d: Ctx, s: SlipPlan): Promise<LineMessage[]> {
  const e: Entry = s.to
    ? { date: s.date, type: "Transfer", category: "", description: s.description, amounts: { [s.from]: -s.amount, [s.to]: s.amount }, id: s.id }
    : { date: s.date, type: "Expense", category: s.category, description: s.description, amounts: { [s.from]: -s.amount }, id: s.id };
  const { msgs, duplicate } = await commitEntry(d, e);
  if (s.notes.length && !duplicate) {
    await log(d.sheets, "lowconf", quarterTabName(s.date), s.id, s.notes.join("; "));
    msgs[0].text += `\nNote: ${s.notes.join("; ")}`;
  }
  return msgs;
}

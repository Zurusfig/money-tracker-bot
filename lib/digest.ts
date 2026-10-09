import { fmt } from "./bot";
import { get, type SheetsApi } from "./sheets";
import { ensureBotTabs, readAccounts, readLog } from "./state";
import { bkkToday, bkkWeekday, daysInMonth, isoDate, quarterTabName, sameDay } from "./time";
import { UNTRACKED, allRows, readBalances, readQuarter, type ParsedRow } from "./workbook";

export const NEAR_BUDGET = 0.9;

function spent(rows: ParsedRow[]): number {
  // Net expense: refunds (positive Expense rows) reduce it
  let s = 0;
  for (const r of rows) if (r.type === "Expense") for (const v of Object.values(r.amounts)) s -= v ?? 0;
  return Math.round(s * 100) / 100;
}

function rowLine(r: ParsedRow): string {
  const [acct, amt] = (Object.entries(r.amounts)[0] ?? ["?", 0]) as [string, number];
  return `${isoDate(r.date)} ${amt > 0 ? "+" : ""}${amt} ${acct}${r.description ? ` "${r.description}"` : ""} (row ${r.row})`;
}

export async function buildDigest(api: SheetsApi, nowDate: Date = new Date()): Promise<string> {
  const today = bkkToday(nowDate);
  const tab = quarterTabName(today);
  await ensureBotTabs(api);
  const tabs = await api.listTabs();
  const hasTab = tabs.some((t) => t.title === tab);
  const acc = await readAccounts(api);
  const rows = hasTab ? allRows(await readQuarter(api, tab, acc)) : [];
  const logRows = tabs.some((t) => t.title === "_BotLog") ? await readLog(api) : [];
  const out: string[] = [`**Money digest ${isoDate(today)}**`];

  // Today
  const todays = rows.filter((r) => sameDay(r.date, today));
  const noSpendDates = new Set(logRows.filter((l) => l.kind === "nospend").map((l) => l.detail || l.date));
  const noSpendToday = noSpendDates.has(isoDate(today));
  if (todays.length === 0 && !noSpendToday) {
    out.push("❗ No entries today and no `0` sent. Log what you spent, or send `0` if nothing.");
  } else if (todays.length === 0) {
    out.push("No-spend day ✓");
  } else {
    out.push(`Today: ${todays.length} ${todays.length === 1 ? "entry" : "entries"}, spent ${fmt(spent(todays))}`);
  }

  // Budget (monthly targets vs month-to-date)
  const monthRows = rows.filter((r) => r.date.y === today.y && r.date.m === today.m);
  const budget = tabs.some((t) => t.title === "Budget") ? await get(api, "Budget!B6:C25") : [];
  const flags: string[] = [];
  for (const [name, target] of budget) {
    const cat = String(name ?? "").trim();
    const t = typeof target === "number" ? target : Number(target);
    if (!cat || !(t > 0)) continue;
    const s = spent(monthRows.filter((r) => r.category === cat));
    const pct = s / t;
    if (pct >= NEAR_BUDGET) flags.push(`${pct >= 1 ? "🔴 over" : "🟡 near"} ${cat}: ${fmt(s)} / ${fmt(t)} (${Math.round(pct * 100)}%)`);
  }
  if (flags.length) out.push("**Budget this month**", ...flags);

  // Review
  const liveIds = new Set(rows.map((r) => r.id).filter(Boolean));
  const edited = new Set(logRows.filter((l) => l.kind === "edit").map((l) => l.id));
  const lowConf = new Map(
    logRows.filter((l) => l.kind === "lowconf" && l.detail !== "category" && liveIds.has(l.id) && !edited.has(l.id)).map((l) => [l.id, l.detail]),
  );
  const review = rows
    .filter((r) => (r.type === "Expense" && !r.category) || lowConf.has(r.id))
    .sort((a, b) => isoDate(b.date).localeCompare(isoDate(a.date)) || b.row - a.row);
  if (review.length) {
    out.push(`**Needs review (${review.length})**`);
    for (const r of review.slice(0, 10)) out.push(`- ${rowLine(r)}${lowConf.has(r.id) ? `: ${lowConf.get(r.id)}` : r.category ? "" : ": no category"}`);
    if (review.length > 10) out.push(`- ...and ${review.length - 10} more in ${tab}`);
  }

  // Sunday balance check
  if (bkkWeekday(nowDate) === 0 && hasTab) {
    const bal = await readBalances(api, tab, acc);
    out.push("**Weekly balance check**");
    for (const a of acc.list) {
      const b = bal.get(a.name);
      if (b) out.push(`- ${a.name} (${a.code}): ${fmt(b.value)}${b.value < 0 ? " (negative)" : ""}`);
    }
    out.push(`Off? Send \`bal <code> <real amount>\`, e.g. \`bal ${acc.default.code} 3200\``);
  }

  // Monthly summary on the last day of the month
  if (today.d === daysInMonth(today.y, today.m)) {
    const prefix = isoDate(today).slice(0, 7);
    const days = new Set(monthRows.map((r) => isoDate(r.date)));
    for (const d of noSpendDates) if (d.startsWith(prefix)) days.add(d);
    const untracked = spent(monthRows.filter((r) => r.category === UNTRACKED));
    const blank = monthRows.filter((r) => r.type === "Expense" && !r.category).length;
    out.push(
      "**Month summary**",
      `- Days with an entry or \`0\`: ${days.size} / ${today.d}`,
      `- Untracked total: ${fmt(untracked)}`,
      `- Expense rows without a category: ${blank}`,
    );
  }
  return out.join("\n");
}

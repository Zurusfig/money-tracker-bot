import type { Accounts } from "./accounts";
import type { Embed, EmbedField } from "./discord";
import { readBudget, spent } from "./digest";
import { fmt } from "./bot";
import type { SheetsApi } from "./sheets";
import { readLog } from "./state";
import {
  MONTHS, addDays, bkkToday, isoDate, prevQuarterTabName, quarterTabName, weekdayOf, type Ymd,
} from "./time";
import { UNTRACKED, allRows, readQuarter, type ParsedRow } from "./workbook";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const label = (d: Ymd) => `${DAYS[weekdayOf(d)]} ${d.d} ${MONTHS[d.m - 1].slice(0, 3).replace(/^./, (c) => c.toUpperCase())}`;
const baht = (n: number) => `฿${fmt(n)}`;

function between(rows: ParsedRow[], from: Ymd, to: Ymd): ParsedRow[] {
  const a = isoDate(from);
  const b = isoDate(to);
  return rows.filter((r) => {
    const d = isoDate(r.date);
    return d >= a && d <= b;
  });
}

// Baht difference reads better than % when the earlier period was tiny
function change(now: number, before: number, what: string): string {
  if (before <= 0 && now <= 0) return "";
  const diff = Math.round(now - before);
  if (diff === 0) return `\nsame as ${what}`;
  return `\n${diff > 0 ? "▲" : "▼"} ${baht(Math.abs(diff))} ${diff > 0 ? "more" : "less"} than ${what}`;
}

function bar(ratio: number, width = 10): string {
  const filled = Math.max(0, Math.min(width, Math.round(ratio * width)));
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function entries(n: number) {
  return `${n} ${n === 1 ? "entry" : "entries"}`;
}

// Dashboard-style Discord embed: today, this week (Mon to today), this month.
export async function buildStats(api: SheetsApi, acc: Accounts, now: Date = new Date()): Promise<Embed> {
  const today = bkkToday(now);
  const tabs = new Set((await api.listTabs()).map((t) => t.title));
  const rows: ParsedRow[] = [];
  // Previous quarter covers last week / last month across a quarter boundary
  for (const tab of [prevQuarterTabName(today), quarterTabName(today)]) {
    if (tabs.has(tab)) rows.push(...allRows(await readQuarter(api, tab, acc)));
  }
  const log = tabs.has("_BotLog") ? await readLog(api) : [];
  const noSpend = new Set(log.filter((l) => l.kind === "nospend").map((l) => l.detail || l.date));

  const weekStart = addDays(today, -((weekdayOf(today) + 6) % 7)); // Monday
  const monthStart = { y: today.y, m: today.m, d: 1 };
  const lastWeekStart = addDays(weekStart, -7);
  const lastWeekSameDay = addDays(today, -7);
  const lastMonthStart = today.m === 1 ? { y: today.y - 1, m: 12, d: 1 } : { y: today.y, m: today.m - 1, d: 1 };
  const lastMonthSameDay = addDays(monthStart, -1).d < today.d ? addDays(monthStart, -1) : { ...lastMonthStart, d: today.d };

  const todayRows = between(rows, today, today);
  const weekRows = between(rows, weekStart, today);
  const monthRows = between(rows, monthStart, today);
  const spentToday = spent(todayRows);
  const spentWeek = spent(weekRows);
  const spentMonth = spent(monthRows);
  const spentLastWeek = spent(between(rows, lastWeekStart, lastWeekSameDay));
  const spentLastMonth = spent(between(rows, lastMonthStart, lastMonthSameDay));

  const fields: EmbedField[] = [
    {
      name: "📅 Today",
      value: todayRows.length
        ? `**${baht(spentToday)}**\n${entries(todayRows.length)}`
        : noSpend.has(isoDate(today)) ? "**฿0**\nno-spend day ✓" : "**฿0**\nnothing logged yet",
      inline: true,
    },
    {
      name: "🗓️ This week",
      value: `**${baht(spentWeek)}**\n${entries(weekRows.length)}${change(spentWeek, spentLastWeek, "last week")}`,
      inline: true,
    },
    {
      name: "📆 This month",
      value: `**${baht(spentMonth)}**\n≈ ${baht(Math.round(spentMonth / today.d))}/day${change(spentMonth, spentLastMonth, "last month")}`,
      inline: true,
    },
  ];

  // Categories this month, with monthly target when Budget has one
  const budget = await readBudget(api);
  const byCat = new Map<string, number>();
  for (const r of monthRows) {
    if (r.type !== "Expense") continue;
    const cat = r.category || "(no category)";
    byCat.set(cat, (byCat.get(cat) ?? 0) + spent([r]));
  }
  const cats = [...byCat].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (cats.length) {
    const w = Math.min(16, Math.max(...cats.map(([c]) => c.length)));
    const lines = cats.map(([c, v]) => {
      const name = (c.length > w ? c.slice(0, w - 1) + "…" : c).padEnd(w);
      const target = budget.get(c);
      return target
        ? `${name} ${bar(v / target)} ${fmt(v)} / ${fmt(target)}${v > target ? " ⚠" : ""}`
        : `${name} ${bar(v / spentMonth)} ${fmt(v)}`;
    });
    fields.push({ name: "🏷️ Categories this month", value: "```\n" + lines.join("\n") + "\n```" });
  }

  const biggest = weekRows
    .filter((r) => r.type === "Expense")
    .map((r) => ({ r, v: spent([r]) }))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v)
    .slice(0, 3);
  if (biggest.length) {
    fields.push({
      name: "💸 Biggest this week",
      value: biggest
        .map(({ r, v }) => `${baht(v)} · ${r.category || "no category"}${r.description ? ` · ${r.description}` : ""} (${DAYS[weekdayOf(r.date)]})`)
        .join("\n"),
    });
  }

  let income = 0;
  for (const r of monthRows) if (r.type === "Income") for (const v of Object.values(r.amounts)) income += v ?? 0;
  const days = new Set(monthRows.map((r) => isoDate(r.date)));
  for (const d of noSpend) if (d.startsWith(isoDate(today).slice(0, 7))) days.add(d);
  const blank = monthRows.filter((r) => r.type === "Expense" && !r.category).length;
  const untracked = spent(monthRows.filter((r) => r.category === UNTRACKED));
  fields.push(
    { name: "💰 Income this month", value: baht(income), inline: true },
    { name: "✍️ Days logged", value: `${days.size} / ${today.d}`, inline: true },
    { name: "❓ Needs a category", value: `${blank} rows${untracked > 0 ? `\nUntracked ${baht(untracked)}` : ""}`, inline: true },
  );

  return {
    title: `📊 Spending · ${label(today)} ${today.y}`,
    description: `Week from ${label(weekStart)} · Month from ${label(monthStart)}`,
    color: 0x2ecc71,
    fields,
    footer: { text: "Spending = expenses minus refunds. Transfers and income not included." },
  };
}

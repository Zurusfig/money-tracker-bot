import { quarterTabsBetween, type Tx } from "./dash";
export { quarterTabsBetween };
import type { SheetsApi } from "./sheets";
import { ensureBotTabs, readAccounts, readBudgetTab, readLog, setBudgetTarget } from "./state";
import { bkkToday, isoDate, parseIso, quarterTabName, type Ymd } from "./time";
import { buildReport } from "./accuracyReport";
import { readUsable, recentDailySpend, recentTxs } from "./usable";
import { TEMPLATE, allRows, readCategories, readQuarter } from "./workbook";

export type DashData = {
  today: string;
  from: string;
  to: string;
  txs: Tx[];
  categories: string[];
  budget: Record<string, number>;
  balances: { name: string; code: string; value: number; usable: boolean }[];
  usable: { now: number; total: number; perDay30: number; source: "sheet" | "default" };
  accuracy: {
    lastChecked: Record<string, string | null>; // usable accounts
    drift: number; // usable could be this much lower
    neverChecked: string[];
    missPerDay: number;
  };
  noSpend: string[];
  skipped: string[]; // quarter tabs in an older layout the bot can't read
  covered: string[]; // quarter tabs read successfully
};

export const MAX_RANGE_DAYS = 800;

export function parseRange(fromS: string | null, toS: string | null): { from: Ymd; to: Ymd } {
  const from = parseIso(fromS ?? "");
  const to = parseIso(toS ?? "");
  if (!from || !to || isoDate(from) > isoDate(to)) throw new Error("Bad date range");
  const days = (Date.UTC(to.y, to.m - 1, to.d) - Date.UTC(from.y, from.m - 1, from.d)) / 86400000;
  if (days > MAX_RANGE_DAYS) throw new Error(`Range too long (max ${MAX_RANGE_DAYS} days)`);
  return { from, to };
}

export async function loadDashData(api: SheetsApi, from: Ymd, to: Ymd, now = new Date()): Promise<DashData> {
  await ensureBotTabs(api);
  const acc = await readAccounts(api);
  const today = bkkToday(now);
  const titles = new Set((await api.listTabs()).map((t) => t.title));
  const txs: Tx[] = [];
  const skipped: string[] = [];
  const covered: string[] = [];
  const a = isoDate(from);
  const b = isoDate(to);
  for (const tab of quarterTabsBetween(from, to)) {
    if (!titles.has(tab)) continue;
    try {
      for (const r of allRows(await readQuarter(api, tab, acc))) {
        const date = isoDate(r.date);
        if (date < a || date > b) continue;
        txs.push({
          date, type: r.type, category: r.category, description: r.description,
          amounts: r.amounts as Record<string, number>, tab, row: r.row,
        });
      }
      covered.push(tab);
    } catch {
      skipped.push(tab);
    }
  }
  txs.sort((x, y) => (x.date === y.date ? x.row - y.row : x.date < y.date ? -1 : 1));

  const current = quarterTabName(today);
  const catTab = titles.has(current) ? current : TEMPLATE;
  const u = titles.has(current) ? await readUsable(api, current, acc) : null;
  const recent = await recentTxs(api, acc, today);
  const perDay30 = await recentDailySpend(api, acc, today, 30, recent);
  const report = await buildReport(api, acc, today, { txs: recent });
  const budget: Record<string, number> = {};
  for (const [cat, { target }] of await readBudgetTab(api)) if (target > 0) budget[cat] = target;
  const log = titles.has("_BotLog") ? await readLog(api) : [];

  return {
    today: isoDate(today),
    from: a,
    to: b,
    txs,
    categories: await readCategories(api, catTab),
    budget,
    balances: u ? u.lines : [],
    accuracy: {
      lastChecked: Object.fromEntries(report.usableAccounts.map((a) => [a, report.last.get(a) ?? null])),
      drift: report.drift.amount,
      neverChecked: report.drift.neverChecked,
      missPerDay: Math.round(report.missPerDay * 100) / 100,
    },
    usable: { now: u?.usable ?? 0, total: u?.total ?? 0, perDay30: Math.round(perDay30 * 100) / 100, source: u?.source ?? "default" },
    noSpend: [...new Set(log.filter((l) => l.kind === "nospend").map((l) => l.detail || l.date))],
    skipped,
    covered,
  };
}

export async function saveBudget(api: SheetsApi, category: string, target: number): Promise<void> {
  await ensureBotTabs(api);
  await setBudgetTarget(api, category, target);
}

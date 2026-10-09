import { ACCOUNTS, accountFromHeader, type AccountName } from "./accounts";
import { colLetter, get, q, type Cell, type SheetsApi } from "./sheets";
import { MONTHS, fromSerial, isoDate, prevQuarterTabName, quarterOf, quarterTabName, type Ymd } from "./time";

export const HEADER_ROW = 18;
export const FIRST_DATA_ROW = 20;
export const ID_COL = 14; // O
export const TEMPLATE = "_Template";
export const UNTRACKED = "Untracked";
export const UNTRACKED_ROW = 5; // P5/Q5, chosen with the owner

export type EntryType = "Income" | "Expense" | "Transfer" | "Recalibrate";

export type Entry = {
  date: Ymd;
  type: EntryType;
  category: string;
  description: string;
  amounts: Partial<Record<AccountName, number>>;
  id: string;
};

export type QuarterView = {
  tab: string;
  rows: Cell[][]; // rows[0] is sheet row 1, columns A..O
  accountCols: Map<AccountName, number>;
  dividers: { row: number; month: number }[]; // month 1-12
  lastRow: number; // last row covered by the tab's formulas
};

export function cell(rows: Cell[][], row: number, col: number): Cell {
  return rows[row - 1]?.[col] ?? null;
}

function isEmpty(v: Cell): boolean {
  return v === null || v === "";
}

export function isDateCell(v: Cell): boolean {
  // UNFORMATTED_VALUE + SERIAL_NUMBER renders dates as numbers. 2000-01-01 .. 2100-01-01
  return typeof v === "number" && v > 36526 && v < 73051;
}

export function parseView(tab: string, rows: Cell[][], f2Formula: Cell): QuarterView {
  const accountCols = new Map<AccountName, number>();
  const header = rows[HEADER_ROW - 1] ?? [];
  header.forEach((h, i) => {
    const a = accountFromHeader(h);
    if (a && i >= 4 && !accountCols.has(a)) accountCols.set(a, i);
  });
  const missing = ACCOUNTS.filter((a) => !accountCols.has(a.name)).map((a) => a.name);
  if (missing.length) throw new Error(`${tab}: header row ${HEADER_ROW} is missing ${missing.join(", ")}`);

  const m = typeof f2Formula === "string" ? /\$(\d+),\$A\$\d+:\$A\$(\d+)/.exec(f2Formula) : null;
  const lastRow = m ? Number(m[2]) : 901;

  const dividers: { row: number; month: number }[] = [];
  for (let r = FIRST_DATA_ROW - 1; r <= Math.max(lastRow, rows.length); r++) {
    const v = cell(rows, r, 0);
    if (typeof v !== "string") continue;
    const idx = MONTHS.indexOf(v.trim().toLowerCase());
    if (idx >= 0) dividers.push({ row: r, month: idx + 1 });
  }
  return { tab, rows, accountCols, dividers, lastRow };
}

export async function readQuarter(api: SheetsApi, tab: string): Promise<QuarterView> {
  const [[rows], [f2]] = await Promise.all([
    api.batchGet([`${q(tab)}!A1:O`]),
    api.batchGet([`${q(tab)}!F2`], "FORMULA"),
  ]);
  return parseView(tab, rows, f2?.[0]?.[0] ?? null);
}

function rowHasContent(view: QuarterView, row: number): boolean {
  for (let c = 0; c <= ID_COL; c++) if (!isEmpty(cell(view.rows, row, c))) return true;
  return false;
}

export type AppendPos = { row: number; insert: boolean };

// Rows live in the section of their month (between month divider rows).
// Next row = first empty row after the last dated row in that section.
// If the section is full, a row is inserted before the next divider.
export function findAppendRow(view: QuarterView, date: Ymd): AppendPos {
  const div = view.dividers.find((d) => d.month === date.m);
  let start: number;
  let end: number; // inclusive last usable row
  if (div) {
    const next = view.dividers.find((d) => d.row > div.row);
    start = div.row + 1;
    end = next ? next.row - 1 : view.lastRow;
  } else {
    // No divider for this month: fall back to the whole data area.
    start = FIRST_DATA_ROW;
    end = view.lastRow;
  }
  start = Math.max(start, FIRST_DATA_ROW);

  let lastDated = start - 1;
  for (let r = start; r <= end; r++) if (isDateCell(cell(view.rows, r, 0))) lastDated = r;

  let row = lastDated + 1;
  while (row <= end && rowHasContent(view, row)) row++;
  if (row <= end) return { row, insert: false };
  return { row: end + 1, insert: true };
}

function safeText(s: string): string {
  // Keep user text literal under USER_ENTERED
  return /^[=+\-@']/.test(s) || /^\d[\d,.\s/-]*$/.test(s) ? `'${s}` : s;
}

// One sheet row A..O for USER_ENTERED.
export function buildRow(view: QuarterView, e: Entry): Cell[] {
  const row: Cell[] = new Array(ID_COL + 1).fill("");
  row[0] = isoDate(e.date);
  row[1] = e.type;
  row[2] = e.category ? safeText(e.category) : "";
  row[3] = e.description ? safeText(e.description) : "";
  for (const [acct, amt] of Object.entries(e.amounts)) {
    if (amt === undefined || amt === 0) continue;
    const col = view.accountCols.get(acct as AccountName);
    if (col === undefined) throw new Error(`No column for ${acct} in ${view.tab}`);
    row[col] = Math.round(amt * 100) / 100;
  }
  row[ID_COL] = safeText(e.id);
  return row;
}

export function findRowById(view: QuarterView, id: string): number | null {
  for (let r = FIRST_DATA_ROW; r <= view.rows.length; r++) {
    const v = cell(view.rows, r, ID_COL);
    if (v !== null && String(v) === id) return r;
  }
  return null;
}

export type ParsedRow = {
  row: number;
  date: Ymd;
  type: string;
  category: string;
  description: string;
  amounts: Partial<Record<AccountName, number>>;
  id: string;
};

export function readRow(view: QuarterView, r: number): ParsedRow | null {
  const d = cell(view.rows, r, 0);
  if (!isDateCell(d)) return null;
  const amounts: Partial<Record<AccountName, number>> = {};
  for (const [a, c] of view.accountCols) {
    const v = cell(view.rows, r, c);
    if (typeof v === "number" && v !== 0) amounts[a] = v;
  }
  return {
    row: r,
    date: fromSerial(d as number),
    type: String(cell(view.rows, r, 1) ?? ""),
    category: String(cell(view.rows, r, 2) ?? ""),
    description: String(cell(view.rows, r, 3) ?? ""),
    amounts,
    id: String(cell(view.rows, r, ID_COL) ?? ""),
  };
}

export function allRows(view: QuarterView): ParsedRow[] {
  const out: ParsedRow[] = [];
  for (let r = FIRST_DATA_ROW; r <= view.rows.length; r++) {
    const p = readRow(view, r);
    if (p) out.push(p);
  }
  return out;
}

export function rowRange(view: QuarterView, row: number): string {
  return `${q(view.tab)}!A${row}:${colLetter(ID_COL)}${row}`;
}

export type WriteResult = { tab: string; row: number; duplicate: boolean };

// Idempotent on e.id. Verifies the write and retries if a parallel webhook took the row.
export async function writeEntry(api: SheetsApi, e: Entry): Promise<WriteResult> {
  const tab = await ensureQuarter(api, e.date);
  for (let attempt = 0; attempt < 4; attempt++) {
    const view = await readQuarter(api, tab);
    const existing = findRowById(view, e.id);
    if (existing) return { tab, row: existing, duplicate: true };
    const pos = findAppendRow(view, e.date);
    if (pos.insert) await api.insertRows(tab, pos.row, 1);
    await api.update(rowRange(view, pos.row), [buildRow(view, e)]);
    const [check] = await api.batchGet([`${q(tab)}!O${pos.row}`]);
    if (String(check?.[0]?.[0] ?? "") === e.id) return { tab, row: pos.row, duplicate: false };
  }
  throw new Error(`Could not place row ${e.id} in ${tab}`);
}

// Writes only the given cells (0-based column -> value), leaving the rest of the row alone.
export async function updateCells(api: SheetsApi, tab: string, row: number, patch: Map<number, Cell>) {
  for (const [col, v] of patch) {
    const range = `${q(tab)}!${colLetter(col)}${row}`;
    if (v === null || v === "") await api.clear(range);
    else await api.update(range, [[typeof v === "string" ? safeText(v) : v]]);
  }
}

export async function clearRow(api: SheetsApi, view: QuarterView, row: number) {
  await api.clear(rowRange(view, row));
}

export async function readCategories(api: SheetsApi, tab: string): Promise<string[]> {
  const rows = await get(api, `${q(tab)}!P2:P51`);
  return rows.map((r) => String(r[0] ?? "").trim()).filter(Boolean);
}

export async function readBalances(api: SheetsApi, tab: string): Promise<Map<AccountName, { row: number; value: number }>> {
  const rows = await get(api, `${q(tab)}!C2:D14`);
  const out = new Map<AccountName, { row: number; value: number }>();
  rows.forEach((r, i) => {
    const a = accountFromHeader(r[1]);
    if (a) out.set(a, { row: i + 2, value: typeof r[0] === "number" ? r[0] : Number(r[0]) || 0 });
  });
  return out;
}

// --- New quarter + Untracked category ---

export async function ensureUntracked(api: SheetsApi, tab: string): Promise<void> {
  const [[p], [q2]] = await Promise.all([
    api.batchGet([`${q(tab)}!P2:P51`]),
    api.batchGet([`${q(tab)}!Q2`], "FORMULA"),
  ]);
  const cats = p.map((r) => String(r[0] ?? "").trim());
  if (cats.includes(UNTRACKED)) return;
  const slot = cats[UNTRACKED_ROW - 2] ?? "";
  if (slot) throw new Error(`${tab}!P${UNTRACKED_ROW} is "${slot}", cannot add ${UNTRACKED}`);
  const f = q2?.[0]?.[0];
  if (typeof f !== "string" || !f.includes(",P2,")) throw new Error(`${tab}!Q2 formula not recognised`);
  await api.update(`${q(tab)}!P${UNTRACKED_ROW}:Q${UNTRACKED_ROW}`, [[UNTRACKED, f.split(",P2,").join(`,P${UNTRACKED_ROW},`)]]);
}

export async function ensureQuarter(api: SheetsApi, date: Ymd): Promise<string> {
  const name = quarterTabName(date);
  const tabs = await api.listTabs();
  if (tabs.some((t) => t.title === name)) return name;

  const budget = tabs.find((t) => t.title === "Budget");
  try {
    await api.duplicateSheet(TEMPLATE, name, budget ? budget.index + 1 : 0);
  } catch (err) {
    // A parallel request may have created it already
    if ((await api.listTabs()).some((t) => t.title === name)) return name;
    throw err;
  }
  await api.update(`${q(name)}!R1:R2`, [[date.y], [quarterOf(date)]]);
  await ensureUntracked(api, name);

  const prev = prevQuarterTabName(date);
  if ((await api.listTabs()).some((t) => t.title === prev)) {
    const bal = await readBalances(api, prev);
    const [dNames, eVals] = await api.batchGet([`${q(name)}!D2:D14`, `${q(name)}!E2:E14`]);
    const col: Cell[][] = [];
    for (let i = 0; i < 13; i++) {
      const a = accountFromHeader(dNames[i]?.[0] ?? null);
      // Rows without an account name keep whatever the template has
      col.push([a && bal.has(a) ? Math.round(bal.get(a)!.value * 100) / 100 : (eVals[i]?.[0] ?? "")]);
    }
    await api.update(`${q(name)}!E2:E14`, col);
  }
  return name;
}


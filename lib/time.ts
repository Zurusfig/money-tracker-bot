// All dates are Asia/Bangkok (UTC+7, no DST).
const BKK_OFFSET_MS = 7 * 3600 * 1000;

export type Ymd = { y: number; m: number; d: number }; // m: 1-12

export function bkkToday(now: Date = new Date()): Ymd {
  const t = new Date(now.getTime() + BKK_OFFSET_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

export function bkkWeekday(now: Date = new Date()): number {
  return new Date(now.getTime() + BKK_OFFSET_MS).getUTCDay(); // 0 = Sunday
}

export function isoDate(d: Ymd): string {
  return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
}

export function parseIso(s: string): Ymd | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s.trim());
  if (!m) return null;
  let y = +m[1];
  if (y > 2400) y -= 543; // Thai Buddhist year
  const out = { y, m: +m[2], d: +m[3] };
  if (out.m < 1 || out.m > 12 || out.d < 1 || out.d > 31) return null;
  return out;
}

export function quarterOf(d: Ymd): number {
  return Math.floor((d.m - 1) / 3) + 1;
}

export function quarterTabName(d: Ymd): string {
  return `${d.y} Q${quarterOf(d)}`;
}

export function prevQuarterTabName(d: Ymd): string {
  const q = quarterOf(d);
  return q === 1 ? `${d.y - 1} Q4` : `${d.y} Q${q - 1}`;
}

const EPOCH = Date.UTC(1899, 11, 30);

// Google Sheets / Excel serial day number
export function toSerial(d: Ymd): number {
  return Math.round((Date.UTC(d.y, d.m - 1, d.d) - EPOCH) / 86400000);
}

export function fromSerial(n: number): Ymd {
  const t = new Date(EPOCH + Math.floor(n) * 86400000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

export function addDays(d: Ymd, n: number): Ymd {
  const t = new Date(Date.UTC(d.y, d.m - 1, d.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

// 0 = Sunday
export function weekdayOf(d: Ymd): number {
  return new Date(Date.UTC(d.y, d.m - 1, d.d)).getUTCDay();
}

export function sameDay(a: Ymd, b: Ymd): boolean {
  return a.y === b.y && a.m === b.m && a.d === b.d;
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

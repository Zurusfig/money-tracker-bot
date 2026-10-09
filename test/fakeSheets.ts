import type { Cell, Render, SheetsApi, TabInfo } from "@/lib/sheets";
import { colIndex } from "@/lib/sheets";
import { parseIso, toSerial } from "@/lib/time";

type Stored = { v: Cell; f?: string };
export type FakeTab = { title: string; hidden: boolean; cells: Map<string, Stored> };
export type TabDump = { title: string; hidden?: boolean; cells: [number, number, Cell, string?][] }; // row, col (1-based row, 0-based col)

const key = (r: number, c: number) => `${r},${c}`;

type Bounds = { tab: string; r1: number; c1: number; r2: number | null; c2: number | null };

export function parseRange(range: string): Bounds {
  const m = /^(?:'((?:[^']|'')+)'|([^!]+))!(.+)$/.exec(range);
  if (!m) throw new Error(`bad range ${range}`);
  const tab = (m[1] ?? m[2]).replace(/''/g, "'");
  const [a, b] = m[3].split(":");
  const pa = /^([A-Z]*)(\d*)$/.exec(a)!;
  const pb = b ? /^([A-Z]*)(\d*)$/.exec(b)! : pa;
  return {
    tab,
    r1: pa[2] ? +pa[2] : 1,
    c1: pa[1] ? colIndex(pa[1]) : 0,
    r2: pb[2] ? +pb[2] : null,
    c2: pb[1] ? colIndex(pb[1]) : null,
  };
}

// In-memory stand-in for Google Sheets with USER_ENTERED-like parsing.
export class FakeSheets implements SheetsApi {
  tabs: FakeTab[] = [];
  calls: string[] = [];

  static from(dump: TabDump[]): FakeSheets {
    const f = new FakeSheets();
    for (const t of dump) {
      const cells = new Map<string, Stored>();
      for (const [r, c, v, formula] of t.cells) cells.set(key(r, c), formula ? { v, f: formula } : { v });
      f.tabs.push({ title: t.title, hidden: !!t.hidden, cells });
    }
    return f;
  }

  tab(title: string): FakeTab {
    const t = this.tabs.find((x) => x.title === title);
    if (!t) throw new Error(`Unable to parse range: no tab ${title}`);
    return t;
  }

  getCell(title: string, row: number, col: number): Cell {
    return this.tab(title).cells.get(key(row, col))?.v ?? null;
  }

  getFormula(title: string, row: number, col: number): string | undefined {
    return this.tab(title).cells.get(key(row, col))?.f;
  }

  setCell(title: string, row: number, col: number, v: Cell) {
    const t = this.tab(title);
    const cur = t.cells.get(key(row, col));
    t.cells.set(key(row, col), { ...cur, v });
  }

  private maxRow(t: FakeTab): number {
    let m = 0;
    for (const k of t.cells.keys()) m = Math.max(m, +k.split(",")[0]);
    return m;
  }

  async listTabs(): Promise<TabInfo[]> {
    return this.tabs.map((t, i) => ({ title: t.title, sheetId: i + 1, index: i, hidden: t.hidden }));
  }

  async batchGet(ranges: string[], render: Render = "UNFORMATTED_VALUE"): Promise<Cell[][][]> {
    return ranges.map((range) => {
      const b = parseRange(range);
      const t = this.tab(b.tab);
      const r2 = b.r2 ?? this.maxRow(t);
      const c2 = b.c2 ?? b.c1;
      const rows: Cell[][] = [];
      for (let r = b.r1; r <= r2; r++) {
        const row: Cell[] = [];
        for (let c = b.c1; c <= c2; c++) {
          const s = t.cells.get(key(r, c));
          row.push(render === "FORMULA" ? (s?.f ?? s?.v ?? null) : (s?.v ?? null));
        }
        while (row.length && (row[row.length - 1] === null || row[row.length - 1] === "")) row.pop();
        rows.push(row);
      }
      while (rows.length && rows[rows.length - 1].length === 0) rows.pop();
      return rows.map((r) => r.map((v) => (v === null ? "" : v)));
    });
  }

  private parseInput(v: Cell): Stored | null {
    if (v === null || v === "") return null;
    if (typeof v !== "string") return { v };
    if (v.startsWith("'")) return { v: v.slice(1) };
    if (v.startsWith("=")) return { v: null, f: v };
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return { v: toSerial(parseIso(v)!) };
    if (/^-?\d+(\.\d+)?$/.test(v)) return { v: Number(v) };
    return { v };
  }

  async update(range: string, values: Cell[][]): Promise<void> {
    this.calls.push(`update ${range}`);
    const b = parseRange(range);
    const t = this.tab(b.tab);
    values.forEach((row, i) =>
      row.forEach((v, j) => {
        const s = this.parseInput(v);
        const k = key(b.r1 + i, b.c1 + j);
        if (s) t.cells.set(k, s);
        else t.cells.delete(k);
      }),
    );
  }

  async append(range: string, values: Cell[][]): Promise<void> {
    this.calls.push(`append ${range}`);
    const b = parseRange(range);
    const t = this.tab(b.tab);
    let last = 0;
    for (const k of t.cells.keys()) {
      const [r, c] = k.split(",").map(Number);
      if (c >= b.c1 && c <= (b.c2 ?? b.c1)) last = Math.max(last, r);
    }
    await this.update(`'${b.tab}'!${String.fromCharCode(65 + b.c1)}${last + 1}`, values);
  }

  async clear(range: string): Promise<void> {
    this.calls.push(`clear ${range}`);
    const b = parseRange(range);
    const t = this.tab(b.tab);
    const r2 = b.r2 ?? this.maxRow(t);
    const c2 = b.c2 ?? b.c1;
    for (let r = b.r1; r <= r2; r++) for (let c = b.c1; c <= c2; c++) t.cells.delete(key(r, c));
  }

  async addSheet(title: string, hidden: boolean): Promise<void> {
    this.calls.push(`addSheet ${title}`);
    if (this.tabs.some((t) => t.title === title)) throw new Error("exists");
    this.tabs.push({ title, hidden, cells: new Map() });
  }

  async duplicateSheet(source: string, title: string, index: number): Promise<void> {
    this.calls.push(`duplicate ${source} ${title}`);
    if (this.tabs.some((t) => t.title === title)) throw new Error("exists");
    const s = this.tab(source);
    this.tabs.splice(index, 0, { title, hidden: s.hidden, cells: new Map([...s.cells].map(([k, v]) => [k, { ...v }])) });
  }

  async insertRows(title: string, beforeRow: number, count: number): Promise<void> {
    this.calls.push(`insertRows ${title} ${beforeRow} ${count}`);
    const t = this.tab(title);
    const moved = new Map<string, Stored>();
    for (const [k, s] of t.cells) {
      const [r, c] = k.split(",").map(Number);
      const f = s.f?.replace(/(\$?[A-Z]{1,2}\$?)(\d+)/g, (m, p, n) => (+n >= beforeRow ? `${p}${+n + count}` : m));
      moved.set(key(r >= beforeRow ? r + count : r, c), f ? { ...s, f } : s);
    }
    t.cells = moved;
  }
}

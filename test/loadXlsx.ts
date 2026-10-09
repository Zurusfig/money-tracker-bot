import ExcelJS from "exceljs";
import type { Cell } from "@/lib/sheets";
import type { TabDump } from "./fakeSheets";

const EPOCH = Date.UTC(1899, 11, 30);

function toCell(v: unknown): { v: Cell; f?: string } {
  if (v === null || v === undefined) return { v: null };
  if (v instanceof Date) return { v: Math.round((v.getTime() - EPOCH) / 86400000) };
  if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") return { v };
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("formula" in o || "sharedFormula" in o) {
      const r = o.result instanceof Date ? toCell(o.result).v : (o.result as Cell) ?? null;
      const res = typeof r === "object" && r !== null ? null : r;
      return { v: res, f: typeof o.formula === "string" ? `=${o.formula}` : undefined };
    }
    if ("richText" in o) return { v: (o.richText as { text: string }[]).map((x) => x.text).join("") };
    if ("text" in o) return { v: String(o.text) };
    if ("error" in o) return { v: String(o.error) };
  }
  return { v: null };
}

export async function loadXlsx(path: string, only?: string[]): Promise<TabDump[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const out: TabDump[] = [];
  wb.eachSheet((ws) => {
    if (only && !only.includes(ws.name)) return;
    const cells: TabDump["cells"] = [];
    ws.eachRow({ includeEmpty: false }, (row, r) => {
      row.eachCell({ includeEmpty: false }, (c, col) => {
        // Sheets returns merged values only in the top-left cell
        if (c.isMerged && c.master.address !== c.address) return;
        const formula = c.type === ExcelJS.ValueType.Formula ? c.formula : undefined;
        const { v, f } = formula ? { v: toCell({ formula, result: c.result }).v, f: `=${formula}` } : toCell(c.value);
        if (v !== null || f) cells.push(f ? [r, col - 1, v, f] : [r, col - 1, v]);
      });
    });
    out.push({ title: ws.name, hidden: ws.state !== "visible", cells });
  });
  return out;
}

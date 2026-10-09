// Builds test/fixtures/workbook.json from reference/Budget_V3_1.xlsx.
// Keeps layout (headers, dividers, formulas, categories, dates, types) and drops personal data.
import { writeFileSync, mkdirSync } from "node:fs";
import { loadXlsx } from "../test/loadXlsx";
import type { TabDump } from "../test/fakeSheets";

const SRC = process.argv[2] ?? "reference/Budget_V3_1.xlsx";
const TABS = ["Budget", "2026 Q4", "2026 Q3", "_Template"];

const tabs = await loadXlsx(SRC, TABS);
for (const t of tabs) {
  t.cells = t.cells.flatMap(([r, c, v, f]): TabDump["cells"] => {
    if (f) return [[r, c, typeof v === "number" ? 100 : v, f]];
    if (t.title === "Budget") return [[r, c, typeof v === "number" ? 1000 : v]];
    if (r === 1 || r === 2) {
      if (c === 17) return [[r, c, v]]; // R1 year, R2 quarter
      if (c === 0) return []; // personal goal text
    }
    if (r < 20) return [[r, c, typeof v === "number" ? 100 : v]];
    if (c === 0 || c === 1 || c === 2) return [[r, c, v]]; // date, type, category, month dividers
    if (c >= 4 && c <= 13 && typeof v === "number") return [[r, c, v < 0 ? -10 : 10]];
    return []; // descriptions and anything else
  });
}
mkdirSync("test/fixtures", { recursive: true });
writeFileSync("test/fixtures/workbook.json", JSON.stringify(tabs));
console.log("wrote test/fixtures/workbook.json", tabs.map((t) => `${t.title}:${t.cells.length}`).join(" "));

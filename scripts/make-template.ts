// Builds template/Budget_Template.xlsx: a blank workbook the bot understands.
// Edit template/template.config.json, then: npm run template
import ExcelJS from "exceljs";
import { readFileSync } from "node:fs";
import { validateAccounts, type AccountDef } from "../lib/accounts";
import { colLetter } from "../lib/sheets";

type Config = {
  year: number;
  quarter: number;
  accounts: { code: string; name: string; default?: boolean; balCategory?: string; slipNames?: string[] }[];
  categories: { name: string; monthlyTarget?: number }[];
};

const cfg = JSON.parse(readFileSync(process.argv[2] ?? "template/template.config.json", "utf8")) as Config;
const OUT = process.argv[3] ?? "template/Budget_Template.xlsx";
const MAX_ACCOUNTS = 10; // columns E..N; O holds the bot's row ID
const LAST = 901;
const DIVIDERS = [19, 101, 201];

const defs: AccountDef[] = cfg.accounts.map((a) => ({
  code: a.code, name: a.name, isDefault: !!a.default, balCategory: a.balCategory ?? "", aliases: [], slipNames: a.slipNames ?? [],
}));
const errors = validateAccounts(defs);
if (cfg.accounts.length > MAX_ACCOUNTS) errors.push(`max ${MAX_ACCOUNTS} accounts`);
if (cfg.categories.length > 50) errors.push("max 50 categories");
if (errors.length) throw new Error(errors.join("; "));

const wb = new ExcelJS.Workbook();
const bold = { bold: true };
const acctCols = Array.from({ length: MAX_ACCOUNTS }, (_, i) => colLetter(4 + i)); // E..N
const monthStart = (k: number) => `DATE($R$1,($R$2-1)*3+${k},1)`;
const monthEnd = (k: number) => (k < 3 ? monthStart(k + 1) : `IF($R$2=4,DATE($R$1+1,1,1),DATE($R$1,$R$2*3+1,1))`);

// ---- _Template ----
const t = wb.addWorksheet("_Template");
t.getCell("C1").value = "Balance";
t.getCell("D1").value = "Account";
t.getCell("E1").value = "Start";
["F", "G", "H"].forEach((c, k) => (t.getCell(`${c}1`).value = { formula: `TEXT(${monthStart(k + 1)},"mmmm")` }));
t.getCell("P1").value = "Category";
t.getCell("Q1").value = "Spent";
t.getCell("R1").value = cfg.year;
t.getCell("R2").value = cfg.quarter;
t.getCell("S1").value = "← year";
t.getCell("S2").value = "← quarter";
for (const c of ["C1", "D1", "E1", "F1", "G1", "H1", "P1", "Q1"]) t.getCell(c).font = bold;

acctCols.forEach((col, i) => {
  const r = i + 2;
  t.getCell(`D${r}`).value = { formula: `IF(${col}$18="","",${col}$18)` };
  t.getCell(`E${r}`).value = 0;
  ["F", "G", "H"].forEach((c, k) => {
    t.getCell(`${c}${r}`).value = {
      formula: `IF($D${r}="","",SUMIFS(${col}$20:${col}$${LAST},$A$20:$A$${LAST},">="&${monthStart(k + 1)},$A$20:$A$${LAST},"<"&${monthEnd(k + 1)}))`,
    };
  });
  t.getCell(`C${r}`).value = { formula: `IF($D${r}="","",SUM(E${r}:H${r}))` };
});
const totalRow = MAX_ACCOUNTS + 3;
t.getCell(`D${totalRow}`).value = "Total";
t.getCell(`D${totalRow}`).font = bold;
for (const c of ["C", "E", "F", "G", "H"]) t.getCell(`${c}${totalRow}`).value = { formula: `SUM(${c}2:${c}${MAX_ACCOUNTS + 1})` };

for (let r = 2; r <= 51; r++) {
  const cat = cfg.categories[r - 2];
  if (cat) t.getCell(`P${r}`).value = cat.name;
  const sums = acctCols.map((c) => `SUMIFS(${c}$20:${c}$${LAST},$C$20:$C$${LAST},P${r},$B$20:$B$${LAST},"Expense")`).join("+");
  t.getCell(`Q${r}`).value = { formula: `IF(P${r}="","",-(${sums}))` };
}

["Date", "Type", "Category", "Description"].forEach((h, i) => (t.getCell(18, i + 1).value = h));
cfg.accounts.forEach((a, i) => (t.getCell(18, 5 + i).value = a.name));
t.getCell("O18").value = "ID (bot)";
t.getRow(18).font = bold;
DIVIDERS.forEach((r, k) => {
  t.getCell(`A${r}`).value = { formula: `TEXT(${monthStart(k + 1)},"mmmm")` };
  t.getCell(`A${r}`).font = bold;
});
// exceljs supports range validations at runtime but doesn't type them
const dv = (t as unknown as { dataValidations: { add(range: string, v: object): void } }).dataValidations;
dv.add(`B20:B${LAST}`, { type: "list", allowBlank: true, formulae: ['"Income,Expense,Transfer,Recalibrate"'] });
dv.add(`C20:C${LAST}`, { type: "list", allowBlank: true, formulae: ["$P$2:$P$51"] });
for (let r = 20; r <= LAST; r++) t.getCell(`A${r}`).numFmt = "yyyy-mm-dd";
t.getColumn(1).width = 12;
t.getColumn(3).width = 16;
t.getColumn(4).width = 24;
t.getColumn(16).width = 18;

// ---- Budget ----
const b = wb.addWorksheet("Budget");
b.getCell("B2").value = "Monthly budget targets (the nightly digest flags categories at 90%+)";
b.getCell("B5").value = "Category";
b.getCell("C5").value = "Monthly target";
b.getRow(5).font = bold;
cfg.categories.forEach((c, i) => {
  b.getCell(`B${6 + i}`).value = c.name;
  if (c.monthlyTarget) b.getCell(`C${6 + i}`).value = c.monthlyTarget;
});
b.getColumn(2).width = 20;

// ---- _Config ----
const k = wb.addWorksheet("_Config");
k.addRow(["Code", "Account (row 18 header)", "Default (x)", "bal category (blank = Untracked)", "Also called (comma separated)", "Slip names (comma separated)"]);
k.getRow(1).font = bold;
for (const a of defs) k.addRow([a.code, a.name, a.isDefault ? "x" : "", a.balCategory, a.aliases.join(", "), a.slipNames.join(", ")]);
k.columns.forEach((c) => (c.width = 24));

// ---- _ReadMe ----
const m = wb.addWorksheet("_ReadMe");
[
  "money-tracker-bot template",
  "",
  "1. Put your current balances in _Template E2:E11 (Start column) before your first message.",
  "2. Accounts: type names in _Template row 18 (E..N, max 10), and add a row in _Config with the same name and a short code.",
  "3. Categories: _Template P2:P51. Monthly targets: Budget B6:C25.",
  "4. The bot creates quarter tabs (e.g. 2026 Q4) from _Template on the first entry of each quarter.",
  "5. Do not rename _Template, Budget or _Config, and keep the row 18 headers and month rows (19, 101, 201).",
].forEach((line) => m.addRow([line]));
m.getColumn(1).width = 110;

await wb.xlsx.writeFile(OUT);
console.log(`wrote ${OUT}`);

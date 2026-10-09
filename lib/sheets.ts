import { sheets as sheetsApi, auth as gauth, type sheets_v4 } from "@googleapis/sheets";
import { config } from "./config";

export type Cell = string | number | boolean | null;
export type Render = "UNFORMATTED_VALUE" | "FORMULA";
export type TabInfo = { title: string; sheetId: number; index: number; hidden: boolean };

// The subset of the Sheets API the bot uses. Mocked in tests.
export interface SheetsApi {
  listTabs(): Promise<TabInfo[]>;
  batchGet(ranges: string[], render?: Render): Promise<Cell[][][]>;
  update(range: string, values: Cell[][]): Promise<void>; // USER_ENTERED
  append(range: string, values: Cell[][]): Promise<void>; // USER_ENTERED, after last row with data
  clear(range: string): Promise<void>;
  addSheet(title: string, hidden: boolean): Promise<void>;
  duplicateSheet(sourceTitle: string, newTitle: string, insertIndex: number): Promise<void>;
  insertRows(title: string, beforeRow: number, count: number): Promise<void>; // 1-based row
}

export async function get(api: SheetsApi, range: string, render: Render = "UNFORMATTED_VALUE"): Promise<Cell[][]> {
  return (await api.batchGet([range], render))[0];
}

export function q(tab: string): string {
  return `'${tab.replace(/'/g, "''")}'`;
}

export function colLetter(i: number): string {
  // 0-based index -> letter
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export class GoogleSheets implements SheetsApi {
  private api: sheets_v4.Sheets;
  private tabs: TabInfo[] | null = null;

  constructor(private spreadsheetId: string = config.sheetId) {
    const sa = config.googleServiceAccount;
    const auth = new gauth.JWT({
      email: sa.client_email,
      key: sa.private_key,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    this.api = sheetsApi({ version: "v4", auth });
  }

  async listTabs(): Promise<TabInfo[]> {
    if (this.tabs) return this.tabs;
    const res = await this.api.spreadsheets.get({
      spreadsheetId: this.spreadsheetId,
      fields: "sheets.properties(title,sheetId,index,hidden)",
    });
    this.tabs = (res.data.sheets ?? []).map((s) => ({
      title: s.properties!.title!,
      sheetId: s.properties!.sheetId!,
      index: s.properties!.index!,
      hidden: !!s.properties!.hidden,
    }));
    return this.tabs;
  }

  async batchGet(ranges: string[], render: Render = "UNFORMATTED_VALUE"): Promise<Cell[][][]> {
    const res = await this.api.spreadsheets.values.batchGet({
      spreadsheetId: this.spreadsheetId,
      ranges,
      valueRenderOption: render,
      dateTimeRenderOption: "SERIAL_NUMBER",
    });
    return (res.data.valueRanges ?? []).map((v) => (v.values ?? []) as Cell[][]);
  }

  async update(range: string, values: Cell[][]): Promise<void> {
    await this.api.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range,
      valueInputOption: "USER_ENTERED",
      requestBody: { values },
    });
  }

  async append(range: string, values: Cell[][]): Promise<void> {
    await this.api.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values },
    });
  }

  async clear(range: string): Promise<void> {
    await this.api.spreadsheets.values.clear({ spreadsheetId: this.spreadsheetId, range });
  }

  private async sheetId(title: string): Promise<number> {
    const tab = (await this.listTabs()).find((t) => t.title === title);
    if (!tab) throw new Error(`Tab not found: ${title}`);
    return tab.sheetId;
  }

  private async batchUpdate(requests: sheets_v4.Schema$Request[]) {
    await this.api.spreadsheets.batchUpdate({ spreadsheetId: this.spreadsheetId, requestBody: { requests } });
    this.tabs = null;
  }

  async addSheet(title: string, hidden: boolean): Promise<void> {
    await this.batchUpdate([{ addSheet: { properties: { title, hidden } } }]);
  }

  async duplicateSheet(sourceTitle: string, newTitle: string, insertIndex: number): Promise<void> {
    await this.batchUpdate([
      { duplicateSheet: { sourceSheetId: await this.sheetId(sourceTitle), newSheetName: newTitle, insertSheetIndex: insertIndex } },
    ]);
  }

  async insertRows(title: string, beforeRow: number, count: number): Promise<void> {
    const sheetId = await this.sheetId(title);
    await this.batchUpdate([
      {
        insertDimension: {
          range: { sheetId, dimension: "ROWS", startIndex: beforeRow - 1, endIndex: beforeRow - 1 + count },
          inheritFromBefore: true,
        },
      },
    ]);
  }
}

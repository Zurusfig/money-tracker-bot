# money-tracker-bot

LINE Official Account bot that logs spending into a Google Sheets budget workbook. Send `65 lunch` or a bank slip image, get a row in the current quarter tab in about a second.

- Next.js App Router on Vercel Hobby: `POST /api/line/webhook`, `GET /api/cron/daily`
- Google Sheets is the only datastore
- Gemini Flash (`gemini-3.5-flash` by default) for unknown words and slip reading
- Discord webhook for the nightly digest and error alerts
- All dates are Asia/Bangkok

## Commands

| Send | Result |
|---|---|
| `65 lunch` | Expense 65 from K-Bank |
| `65 lunch m` | Expense from Make. Last word is an account only if it is exactly a code |
| `+7000 allowance` | Income |
| `+134 food` | Refund: positive Expense in Food & Drinks (only when the word is a known category or rule) |
| `t k m 5000` | Transfer K-Bank to Make (optional description after the amount) |
| `bal k 3200` | Compare with sheet balance, log the gap as Expense / Untracked (Rabbit: Transportation) |
| `undo` | Remove the last bot-written row |
| `0` | Mark today as a no-spend day |
| `help` | Command list |
| slip image | Read amount, bank, recipient, date, ref. Own-account recipient becomes a Transfer |

Codes: `k` K-Bank, `m` Make, `s` SCB, `c` Cash-Wallet, `h` Head, `r` Rabbit, `l` Line Pay, `t` True-money, `g` GWallet, `sv` Savings.

Every confirmation looks like `✓ 65 Food & Drinks · K-Bank · lunch` with buttons [Account] [Category] [Delete]. Buttons carry the row ID, so there is no pending state. Picking a category saves `description -> category` to `_Rules`.

Category order: `_Rules` match, then category name match (`coffee` -> Coffee & Tea), then Gemini restricted to the sheet's category list. Below 0.75 confidence the row is written with a blank category and the bot asks with category buttons.

Slips: amount confidence below 0.9 means nothing is written until you tap "Yes". Unknown source bank falls back to K-Bank and says so.

## Setup

### 1. Copy the sheet
Make a copy of your budget sheet in Google Drive and use its ID while testing (`docs.google.com/spreadsheets/d/<SHEET_ID>/edit`). Switch `SHEET_ID` to the real one after checking.

### 2. Google service account
1. Google Cloud Console > create a project > enable **Google Sheets API**.
2. IAM & Admin > Service Accounts > create one > Keys > Add key > JSON. Download it.
3. Open the sheet > Share > paste the service account email (`...@...iam.gserviceaccount.com`) > **Editor**.
4. Put the JSON in `GOOGLE_SERVICE_ACCOUNT_JSON` (one line, or `base64 -w0 key.json`).

### 3. LINE
1. [LINE Developers Console](https://developers.line.biz/console/) > provider > **Messaging API** channel (this creates the Official Account).
2. Basic settings: copy **Channel secret** -> `LINE_CHANNEL_SECRET`, and **Your user ID** -> `LINE_USER_ID`.
3. Messaging API tab: issue a **Channel access token (long-lived)** -> `LINE_CHANNEL_ACCESS_TOKEN`.
4. LINE Official Account Manager > Response settings: turn **off** auto-reply and greeting messages, turn **on** webhooks.
5. After deploy (step 6): Messaging API tab > Webhook URL = `https://<your-app>.vercel.app/api/line/webhook` > **Verify** > enable **Use webhook**. Turning on **Webhook redelivery** is safe, writes are idempotent.

### 4. Gemini
[Google AI Studio](https://aistudio.google.com/apikey) > Create API key -> `GEMINI_API_KEY`. Free-tier limits change often and differ per model; check AI Studio > Rate limits. Rules and category-name matches skip Gemini, so calls drop as `_Rules` grows. If the default model's free quota is too small, set `GEMINI_MODEL` (e.g. a Flash-Lite model).

### 5. Discord
Server settings > Integrations > Webhooks > New Webhook > copy URL -> `DISCORD_WEBHOOK_URL`.

### 6. Deploy to Vercel
1. Import the repo in Vercel.
2. Add every variable from `.env.example` in Project > Settings > Environment Variables. `CRON_SECRET`: any long random string (`openssl rand -hex 32`). Vercel sends it as `Authorization: Bearer <CRON_SECRET>` to the cron route.
3. Deploy. `vercel.json` schedules `/api/cron/daily` at 14:30 UTC (21:30 Bangkok). Hobby crons may fire anywhere inside that hour.
4. Set the LINE webhook URL (step 3.5).

### 7. Fill `_Accounts`
The first message creates hidden tabs `_Rules`, `_Accounts`, `_BotLog` (right-click tab bar > show to edit). In `_Accounts`:

| Match | Account | Note |
|---|---|---|
| `1234` | Make | digits visible on slips for your own account (`xxx-x-x1234-x`) |
| `Paotang top up` | g | wallet top-up recipient name as printed on slips |

Account column takes a code (`m`) or name (`Make`). Digit matches need at least 4 digits.

### Local dev
```bash
npm install
cp .env.example .env.local   # fill in
npm run dev                  # then expose with a tunnel (e.g. ngrok) for LINE
npm test
npm run typecheck
```

Trigger the digest manually:
```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<your-app>.vercel.app/api/cron/daily
```

## How rows are written

- Tab = `YYYY QN` for the entry date. Columns resolved by reading row 18 (`Bank` is treated as K-Bank).
- Quarter tabs have month divider rows (Oct at 19, Nov at 101, Dec at 201; `_Template` uses 19/102/202). A row goes into its month's section, after the last row with a date. Rows with content but no date are skipped, never overwritten. If a section is full, one row is inserted before the next divider (Sheets extends the formula ranges). A month with no divider falls back to after the last dated row.
- `USER_ENTERED`, date as `YYYY-MM-DD` so it becomes a real date. Text that looks like a formula or number is kept literal.
- Column O holds the row ID: `L<LINE message id>` or `S<slip transaction ref>`. A repeated ID is reported as "Already logged".
- After writing, the bot reads column O back. If a parallel request took the row, it retries on the next one.
- `undo` and [Delete] clear A:O of that row (values only) instead of deleting the sheet row, so dividers and formula ranges never shift.
- New quarter: duplicates `_Template` after `Budget`, sets R1/R2, copies the previous quarter's C2:C14 balances into E2:E14 for each named account.
- `Untracked` is added at P5 with a Q5 formula copied from Q2 (current quarter and `_Template`). Budget row 8 shows it.

## Nightly digest (Discord, 21:30)

- Today's entry count and net spend. If nothing and no `0`: says so explicitly.
- Categories at 90%+ of the monthly target in `Budget!B6:C25` (month to date).
- Rows needing review: Expense rows with blank category, and slip rows with unclear fields. Newest first, max 10.
- Sundays: every account's sheet balance, with a reminder to send `bal`.
- Last day of the month: days with an entry or `0`, Untracked total, blank-category count.

## Workbook notes (found while inspecting, not changed)

- `Q16:Q51` category formulas and `U3`/`U5` inflow/outflow formulas skip SCB (G) and GWallet (M).
- `Budget` and `Dashboard` still point at `2026 Q3`.
- The Apps Script in `_ReadMe` writes year/quarter to P1/P2, but the template uses R1/R2.
- 2024 Q1 to 2026 Q2 also use an older layout (header not on row 18). The bot only writes to the tab for the entry date, so it never touches them.

## Tests

`npm test` runs against `test/fixtures/workbook.json`, a sanitized copy of the workbook structure (headers, dividers, formulas, categories; amounts replaced, descriptions removed). LINE, Sheets and Gemini are mocked (`test/fakeSheets.ts` is an in-memory Sheets). If `reference/Budget_V3_1.xlsx` exists locally, layout tests also run against it. The xlsx is gitignored.

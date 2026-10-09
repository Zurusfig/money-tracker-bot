# Notes on the original workbook

Found while building the bot against the original Budget_V3 workbook. Not changed by the bot.

- `Q16:Q51` category formulas and `U3`/`U5` inflow/outflow formulas skip SCB (G) and GWallet (M).
- `Budget` and `Dashboard` still point at `2026 Q3`.
- The Apps Script in `_ReadMe` writes year/quarter to P1/P2, but the template uses R1/R2.
- 2024 Q1 to 2026 Q2 also use an older layout (header not on row 18). The bot only writes to the tab for the entry date, so it never touches them.

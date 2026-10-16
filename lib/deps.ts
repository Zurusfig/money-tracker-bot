import type { Deps } from "./bot";
import { DiscordNotifier } from "./discord";
import { Gemini } from "./gemini";
import { LineClient } from "./line";
import { GoogleSheets, withReadCache } from "./sheets";

// One read cache per request: repeated reads of the same range cost one Sheets API call
export function realDeps(): Deps {
  return { sheets: withReadCache(new GoogleSheets()), line: new LineClient(), ai: new Gemini(), notify: new DiscordNotifier() };
}

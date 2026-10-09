import type { Deps } from "./bot";
import { DiscordNotifier } from "./discord";
import { Gemini } from "./gemini";
import { LineClient } from "./line";
import { GoogleSheets } from "./sheets";

export function realDeps(): Deps {
  return { sheets: new GoogleSheets(), line: new LineClient(), ai: new Gemini(), notify: new DiscordNotifier() };
}

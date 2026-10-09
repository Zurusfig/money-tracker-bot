import { config } from "./config";

export interface Notifier {
  post(content: string): Promise<void>;
}

export class DiscordNotifier implements Notifier {
  async post(content: string): Promise<void> {
    const url = config.discordWebhookUrl;
    if (!url) return;
    // Discord caps messages at 2000 chars
    for (let i = 0; i < content.length; i += 1900) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: content.slice(i, i + 1900), allowed_mentions: { parse: [] } }),
      });
      if (!res.ok) throw new Error(`Discord ${res.status}`);
    }
  }
}

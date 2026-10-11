import { config } from "./config";

export type EmbedField = { name: string; value: string; inline?: boolean };
export type Embed = { title: string; description?: string; color?: number; fields: EmbedField[]; footer?: { text: string } };

export interface Notifier {
  post(content: string): Promise<void>;
  postEmbed(embed: Embed): Promise<void>;
  readonly enabled: boolean;
}

export class DiscordNotifier implements Notifier {
  get enabled() {
    return !!config.discordWebhookUrl;
  }

  private async send(body: object): Promise<void> {
    const url = config.discordWebhookUrl;
    if (!url) return;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, allowed_mentions: { parse: [] } }),
    });
    if (!res.ok) throw new Error(`Discord ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  async post(content: string): Promise<void> {
    // Discord caps messages at 2000 chars
    for (let i = 0; i < content.length; i += 1900) await this.send({ content: content.slice(i, i + 1900) });
  }

  async postEmbed(embed: Embed): Promise<void> {
    await this.send({ embeds: [embed] });
  }
}

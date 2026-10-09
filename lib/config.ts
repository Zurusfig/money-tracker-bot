function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

export const config = {
  get lineChannelSecret() { return need("LINE_CHANNEL_SECRET"); },
  get lineAccessToken() { return need("LINE_CHANNEL_ACCESS_TOKEN"); },
  get lineUserId() { return need("LINE_USER_ID"); },
  get sheetId() { return need("SHEET_ID"); },
  get googleServiceAccount(): { client_email: string; private_key: string } {
    const raw = need("GOOGLE_SERVICE_ACCOUNT_JSON");
    const json = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    return JSON.parse(json);
  },
  get geminiApiKey() { return need("GEMINI_API_KEY"); },
  get geminiModel() { return process.env.GEMINI_MODEL || "gemini-3.5-flash"; },
  get discordWebhookUrl() { return process.env.DISCORD_WEBHOOK_URL || ""; },
  get cronSecret() { return need("CRON_SECRET"); },
};

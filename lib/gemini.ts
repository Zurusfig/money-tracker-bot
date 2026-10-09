import { config } from "./config";

export type Field<T> = { value: T; confidence: number };
export type CategoryGuess = { category: string; confidence: number };
export type SlipData = {
  is_slip: boolean;
  amount: Field<number>;
  source_bank: Field<string>;
  recipient_name: Field<string>;
  recipient_account: Field<string>;
  datetime: Field<string>;
  transaction_ref: Field<string>;
  category: Field<string>;
};

export interface Ai {
  categorize(description: string, categories: string[]): Promise<CategoryGuess>;
  readSlip(image: Buffer, mimeType: string, categories: string[]): Promise<SlipData>;
}

const field = (value: object) => ({
  type: "object",
  properties: { value, confidence: { type: "number", minimum: 0, maximum: 1 } },
  required: ["value", "confidence"],
});

export class Gemini implements Ai {
  private async generate(parts: unknown[], schema: object): Promise<unknown> {
    const model = config.geminiModel;
    const thinking = model.startsWith("gemini-2") ? { thinkingBudget: 0 } : { thinkingLevel: "low" };
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": config.geminiApiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          responseJsonSchema: schema,
          thinkingConfig: thinking,
        },
      }),
    });
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const out = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    return JSON.parse(out);
  }

  async categorize(description: string, categories: string[]): Promise<CategoryGuess> {
    const schema = {
      type: "object",
      properties: {
        category: { type: "string", enum: [...categories, ""] },
        confidence: { type: "number", minimum: 0, maximum: 1 },
      },
      required: ["category", "confidence"],
    };
    const prompt = [
      "Pick the spending category for a personal expense logged in Bangkok, Thailand.",
      "Descriptions are short, may be Thai, English, brand names or slang.",
      `Categories: ${categories.join(" | ")}`,
      'If none fits or you are unsure, use "" with low confidence. Confidence is your probability of being right.',
      `Description: ${JSON.stringify(description)}`,
    ].join("\n");
    const r = (await this.generate([{ text: prompt }], schema)) as CategoryGuess;
    return { category: categories.includes(r.category) ? r.category : "", confidence: Number(r.confidence) || 0 };
  }

  async readSlip(image: Buffer, mimeType: string, categories: string[]): Promise<SlipData> {
    const str = { type: "string" };
    const schema = {
      type: "object",
      properties: {
        is_slip: { type: "boolean" },
        amount: field({ type: "number" }),
        source_bank: field(str),
        recipient_name: field(str),
        recipient_account: field(str),
        datetime: field(str),
        transaction_ref: field(str),
        category: field({ type: "string", enum: [...categories, ""] }),
      },
      required: ["is_slip", "amount", "source_bank", "recipient_name", "recipient_account", "datetime", "transaction_ref", "category"],
    };
    const prompt = [
      "This should be a Thai bank or e-wallet transfer/payment slip. Extract fields exactly as printed.",
      "is_slip: false if the image is not a payment slip.",
      "amount: the transferred amount in THB, excluding fees. Number only.",
      "source_bank: the payer's bank or wallet app (e.g. K PLUS, Make by KBank, SCB, TrueMoney, LINE Pay, Paotang).",
      "recipient_name / recipient_account: the payee as printed (account numbers are often masked, keep the visible digits).",
      "datetime: 'YYYY-MM-DD HH:mm' in the Gregorian calendar. Slips often print Buddhist years (2569 = 2026) and Thai month abbreviations.",
      "transaction_ref: the transaction/reference number printed on the slip.",
      `category: the most likely spending category for this payee, from: ${categories.join(" | ")}. Use "" if unsure.`,
      "Use empty string and confidence 0 for anything you cannot read. Confidence is your probability that the value is exactly right.",
    ].join("\n");
    return (await this.generate([{ inlineData: { mimeType, data: image.toString("base64") } }, { text: prompt }], schema)) as SlipData;
  }
}

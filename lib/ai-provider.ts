import { generateWithGemini, isGeminiConfigured, getResolvedModel } from "./gemini";

export type AIProviderType = "gemini" | "anthropic" | "openai";

export interface AIProvider {
  generate(systemPrompt: string, userPrompt: string, key?: string, model?: string): Promise<string | null>;
  listModels(key?: string): Promise<string[]>;
  isConfigured(key?: string): boolean;
  getActiveModel(): string | null;
}

// --- Gemini adapter (wraps existing lib/gemini.ts) ---

const geminiProvider: AIProvider = {
  async generate(systemPrompt, userPrompt, key, model) {
    return generateWithGemini(systemPrompt, userPrompt, key, model || undefined);
  },
  async listModels(_key) {
    return [
      "gemini-2.5-flash",
      "gemini-2.5-pro",
      "gemini-2.0-flash",
      "gemini-1.5-flash",
      "gemini-1.5-pro",
    ];
  },
  isConfigured(key) {
    return isGeminiConfigured(key);
  },
  getActiveModel() {
    return getResolvedModel();
  },
};

// --- Anthropic adapter ---

const anthropicProvider: AIProvider = {
  async generate(systemPrompt, userPrompt, key, model) {
    const apiKey = key || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return null;

    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });

    try {
      const message = await client.messages.create({
        model: model || "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      });
      const block = message.content[0];
      return block.type === "text" ? block.text : null;
    } catch (err) {
      console.error("Anthropic API error:", err);
      return null;
    }
  },

  async listModels(key) {
    const apiKey = key || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return [];

    try {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey });
      const response = await client.models.list({ limit: 100 });
      return response.data.map((m) => m.id);
    } catch (err) {
      console.error("Anthropic list models error:", err);
      return [
        "claude-sonnet-4-20250514",
        "claude-opus-4-20250514",
        "claude-3-5-haiku-20241022",
      ];
    }
  },

  isConfigured(key) {
    return !!(key || process.env.ANTHROPIC_API_KEY);
  },

  getActiveModel() {
    return null;
  },
};

// --- OpenAI adapter ---

const openaiProvider: AIProvider = {
  async generate(systemPrompt, userPrompt, key, model) {
    const apiKey = key || process.env.OPENAI_API_KEY;
    if (!apiKey) return null;

    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey });

    try {
      const completion = await client.chat.completions.create({
        model: model || "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 4096,
      });
      return completion.choices[0]?.message?.content || null;
    } catch (err) {
      console.error("OpenAI API error:", err);
      return null;
    }
  },

  async listModels(key) {
    const apiKey = key || process.env.OPENAI_API_KEY;
    if (!apiKey) return [];

    try {
      const { default: OpenAI } = await import("openai");
      const client = new OpenAI({ apiKey });
      const response = await client.models.list();
      const models: string[] = [];
      for await (const model of response) {
        if (model.id.startsWith("gpt-")) {
          models.push(model.id);
        }
      }
      return models.sort();
    } catch (err) {
      console.error("OpenAI list models error:", err);
      return ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"];
    }
  },

  isConfigured(key) {
    return !!(key || process.env.OPENAI_API_KEY);
  },

  getActiveModel() {
    return null;
  },
};

// --- Provider registry ---

const providers: Record<AIProviderType, AIProvider> = {
  gemini: geminiProvider,
  anthropic: anthropicProvider,
  openai: openaiProvider,
};

export function getAIProvider(type: AIProviderType): AIProvider {
  return providers[type] || providers.gemini;
}

export function isAnyAIConfigured(
  aiProvider?: AIProviderType,
  geminiKey?: string,
  anthropicKey?: string,
  openaiKey?: string
): boolean {
  const provider = aiProvider || "gemini";
  switch (provider) {
    case "gemini": return isGeminiConfigured(geminiKey);
    case "anthropic": return anthropicProvider.isConfigured(anthropicKey);
    case "openai": return openaiProvider.isConfigured(openaiKey);
    default: return isGeminiConfigured(geminiKey);
  }
}

export function resolveAIKey(
  aiProvider?: AIProviderType,
  geminiKey?: string,
  anthropicKey?: string,
  openaiKey?: string
): string | undefined {
  const provider = aiProvider || "gemini";
  switch (provider) {
    case "gemini": return geminiKey;
    case "anthropic": return anthropicKey;
    case "openai": return openaiKey;
    default: return geminiKey;
  }
}

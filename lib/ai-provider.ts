import { generateWithGemini, isGeminiConfigured, getResolvedModel } from "./gemini";

export type AIProviderType = "gemini" | "anthropic" | "openai";

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema object
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface AIProvider {
  generate(systemPrompt: string, userPrompt: string, key?: string, model?: string): Promise<string | null>;
  generateStream?(systemPrompt: string, userPrompt: string, key?: string, model?: string): AsyncGenerator<string>;
  generateWithTools?(
    systemPrompt: string,
    messages: { role: "user" | "assistant"; content: string }[],
    tools: ToolDefinition[],
    key?: string,
    model?: string
  ): Promise<{ text: string | null; toolCalls: ToolCall[] }>;
  embed?(texts: string[], key?: string): Promise<number[][] | null>;
  listModels(key?: string): Promise<string[]>;
  isConfigured(key?: string): boolean;
  getActiveModel(): string | null;
}

// --- Simple LRU map (insertion-order eviction) ---
function lruSet<K, V>(map: Map<K, V>, key: K, value: V, maxSize: number): void {
  map.delete(key); // remove so re-insert goes to end
  map.set(key, value);
  if (map.size > maxSize) map.delete(map.keys().next().value as K);
}
function lruGet<K, V>(map: Map<K, V>, key: K): V | undefined {
  const v = map.get(key);
  if (v !== undefined) { map.delete(key); map.set(key, v); } // bump to end
  return v;
}

// --- Embedding cache (shared across providers) ---
const _embeddingCache = new Map<string, number[]>();
const EMBED_CACHE_MAX = 2000;
function embCacheKey(text: string, model: string): string {
  return `${model}:${text.length}:${text.slice(0, 64)}`;
}

// --- Gemini adapter (wraps existing lib/gemini.ts) ---

const FALLBACK_GEMINI_MODELS = [
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
];

const geminiProvider: AIProvider = {
  async generate(systemPrompt, userPrompt, key, model) {
    return generateWithGemini(systemPrompt, userPrompt, key, model || undefined);
  },

  async *generateStream(systemPrompt, userPrompt, key, model) {
    const apiKey = key || process.env.GEMINI_API_KEY;
    if (!apiKey) return;
    const modelId = model || "gemini-2.5-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:streamGenerateContent?key=${apiKey}&alt=sse`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      }),
    });
    if (!res.ok || !res.body) return;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr || jsonStr === "[DONE]") continue;
        try {
          const chunk = JSON.parse(jsonStr) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
          const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
          if (text) yield text;
        } catch { /* skip malformed chunk */ }
      }
    }
  },

  async embed(texts, key) {
    const apiKey = key || process.env.GEMINI_API_KEY;
    if (!apiKey || texts.length === 0) return null;
    const model = "text-embedding-004";

    // Separate cached from uncached
    const results: (number[] | null)[] = new Array(texts.length).fill(null);
    const uncached: { idx: number; text: string }[] = [];
    texts.forEach((text, i) => {
      const cached = lruGet(_embeddingCache, embCacheKey(text, model));
      if (cached) results[i] = cached;
      else uncached.push({ idx: i, text });
    });

    // Batch uncached via batchEmbedContents (100 per call)
    const BATCH = 100;
    for (let b = 0; b < uncached.length; b += BATCH) {
      const slice = uncached.slice(b, b + BATCH);
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents?key=${apiKey}`,
          { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ requests: slice.map((u) => ({ model: `models/${model}`, content: { parts: [{ text: u.text }] } })) }) }
        );
        if (!res.ok) { slice.forEach(({ idx }) => { results[idx] = []; }); continue; }
        const data = await res.json() as { embeddings?: { values?: number[] }[] };
        (data.embeddings ?? []).forEach((emb, j) => {
          const { idx, text } = slice[j];
          const vec = emb.values ?? [];
          lruSet(_embeddingCache, embCacheKey(text, model), vec, EMBED_CACHE_MAX);
          results[idx] = vec;
        });
      } catch { slice.forEach(({ idx }) => { results[idx] = []; }); }
    }

    const filled = results.map((r) => r ?? []);
    return filled.some((v) => v.length > 0) ? filled : null;
  },
  async listModels(key) {
    const apiKey = key || process.env.GEMINI_API_KEY;
    if (!apiKey) return [];
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=100`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
      const models = (data.models ?? [])
        .filter((m) =>
          m.name.includes("gemini") &&
          (m.supportedGenerationMethods ?? []).includes("generateContent")
        )
        .map((m) => m.name.replace("models/", ""))
        .sort();
      return models.length > 0 ? models : FALLBACK_GEMINI_MODELS;
    } catch (err) {
      console.error("Gemini list models error:", err);
      return FALLBACK_GEMINI_MODELS;
    }
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

  async *generateStream(systemPrompt, userPrompt, key, model) {
    const apiKey = key || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return;
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });
    const stream = client.messages.stream({
      model: model || "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield event.delta.text;
      }
    }
  },

  async generateWithTools(systemPrompt, messages, tools, key, model) {
    const apiKey = key || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return { text: null, toolCalls: [] };
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });
    try {
      const resp = await client.messages.create({
        model: model || "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: systemPrompt,
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters as { type: "object"; properties: Record<string, unknown>; required?: string[] },
        })),
        messages,
      });
      const toolCalls: ToolCall[] = resp.content
        .filter((b) => b.type === "tool_use")
        .map((b) => {
          const tb = b as { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
          return { id: tb.id, name: tb.name, input: tb.input };
        });
      const textBlock = resp.content.find((b) => b.type === "text");
      const text = textBlock?.type === "text" ? textBlock.text : null;
      return { text, toolCalls };
    } catch (err) {
      console.error("Anthropic tool call error:", err);
      return { text: null, toolCalls: [] };
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

  async *generateStream(systemPrompt, userPrompt, key, model) {
    const apiKey = key || process.env.OPENAI_API_KEY;
    if (!apiKey) return;
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey });
    const stream = await client.chat.completions.create({
      model: model || "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 4096,
      stream: true,
    });
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content ?? "";
      if (text) yield text;
    }
  },

  async embed(texts, key) {
    const apiKey = key || process.env.OPENAI_API_KEY;
    if (!apiKey || texts.length === 0) return null;
    const model = "text-embedding-3-small";
    const uncached: { idx: number; text: string }[] = [];
    const results: (number[] | null)[] = new Array(texts.length).fill(null);
    texts.forEach((t, i) => {
      const ck = embCacheKey(t, model);
      const cached = lruGet(_embeddingCache, ck);
      if (cached) results[i] = cached;
      else uncached.push({ idx: i, text: t });
    });
    if (uncached.length > 0) {
      try {
        const { default: OpenAI } = await import("openai");
        const client = new OpenAI({ apiKey });
        const resp = await client.embeddings.create({ model, input: uncached.map((u) => u.text) });
        resp.data.forEach((d, j) => {
          const { idx, text } = uncached[j];
          lruSet(_embeddingCache, embCacheKey(text, model), d.embedding, EMBED_CACHE_MAX);
          results[idx] = d.embedding;
        });
      } catch { return null; }
    }
    return results.every((r) => r !== null) ? (results as number[][]) : null;
  },

  async generateWithTools(systemPrompt, messages, tools, key, model) {
    const apiKey = key || process.env.OPENAI_API_KEY;
    if (!apiKey) return { text: null, toolCalls: [] };
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey });
    try {
      const resp = await client.chat.completions.create({
        model: model || "gpt-4o",
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        tools: tools.map((t) => ({
          type: "function" as const,
          function: { name: t.name, description: t.description, parameters: t.parameters },
        })),
        tool_choice: "auto",
        max_tokens: 4096,
      });
      const choice = resp.choices[0];
      const toolCalls: ToolCall[] = (choice?.message?.tool_calls ?? []).map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        input: JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>,
      }));
      return { text: choice?.message?.content ?? null, toolCalls };
    } catch (err) {
      console.error("OpenAI tool call error:", err);
      return { text: null, toolCalls: [] };
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

/**
 * Shared generation-config presets.  Import the right preset at each call site so
 * intent is explicit and settings don't drift between callers.
 */
import type { GenerateOpts } from "./ai-provider";

/** Structured-output classification (enrichment, intent detection). */
export const CLASSIFICATION: GenerateOpts = {
  json: true,
  temperature: 0,
  maxOutputTokens: 4096,
};

/** Reranking: tiny JSON response, strict determinism. */
export const RERANK: GenerateOpts = {
  json: true,
  temperature: 0,
  maxOutputTokens: 256,
};

/** AI insights: slight creativity, still structured JSON. */
export const INSIGHTS: GenerateOpts = {
  json: true,
  temperature: 0.2,
  maxOutputTokens: 4096,
};

/** Agent chat: conversational prose, no JSON mode. */
export const CHAT: GenerateOpts = {
  temperature: 0.4,
  maxOutputTokens: 4096,
};

/** Summarization: light creativity, natural prose. */
export const SUMMARIZATION: GenerateOpts = {
  temperature: 0.3,
  maxOutputTokens: 2048,
};

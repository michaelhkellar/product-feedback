import { AttentionCall } from "./types";

/**
 * Strip server-only fields before sending an AttentionCall to the client.
 *
 * Currently removes the full `transcript` field. Transcripts are sensitive
 * customer content fetched from Grain and used server-side only for AI
 * extraction (lib/enrichment.ts) and vector store indexing (lib/vector-store.ts).
 * They should never be serialized into API responses — the `summary` snippet
 * is the appropriate UI-facing preview.
 */
export function sanitizeCallForClient(call: AttentionCall): AttentionCall {
  if (!call.transcript) return call;
  // Destructure to drop transcript without mutating the original.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { transcript, ...rest } = call;
  return rest;
}

export function sanitizeCallsForClient(calls: AttentionCall[]): AttentionCall[] {
  return calls.map(sanitizeCallForClient);
}

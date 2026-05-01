import { AttentionCall, Sentiment } from "./types";
import { DEMO_ATTENTION_CALLS } from "./demo-data";

const API_BASE = "https://api.grain.com";
const API_VERSION = "2025-10-31";
const MAX_ITEMS = 500;
const TRANSCRIPT_CONCURRENCY = 5;

interface GrainRecording {
  id: string;
  title?: string;
  start_datetime?: string;
  duration_ms?: number;
  participants?: { name?: string; email?: string }[];
  tags?: string[];
  url?: string;
  share_url?: string;
}

/**
 * Recording detail response. Grain's API exposes pre-extracted intelligence
 * (action items, highlights, summary). We probe several reasonable field
 * shapes since the schema isn't fully versioned in their public docs.
 */
interface GrainRecordingDetail {
  id?: string;
  // summary text shapes
  summary?: string;
  intelligence_summary?: string;
  // action items shapes — could be string[] or object[] with .text/.body
  action_items?: unknown;
  intelligence_action_items?: unknown;
  // highlights / key moments shapes — could be on root or nested
  highlights?: unknown;
  intelligence_notes?: unknown;
  key_moments?: unknown;
}

interface GrainListResponse {
  cursor: string | null;
  recordings: GrainRecording[];
}

function grainHeaders(key: string): Record<string, string> {
  return {
    Authorization: `Bearer ${key}`,
    "Public-Api-Version": API_VERSION,
    "Content-Type": "application/json",
  };
}

async function listRecordings(key: string): Promise<GrainRecording[]> {
  const all: GrainRecording[] = [];
  let cursor: string | null = null;

  while (all.length < MAX_ITEMS) {
    const body: Record<string, unknown> = { include: { participants: true } };
    if (cursor) body.cursor = cursor;

    try {
      const res = await fetch(`${API_BASE}/_/public-api/v2/recordings`, {
        method: "POST",
        headers: grainHeaders(key),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        console.error(`Grain list error: ${res.status}`);
        break;
      }
      const page = await res.json() as GrainListResponse;
      all.push(...(page.recordings ?? []));
      if (!page.cursor || (page.recordings ?? []).length === 0) break;
      cursor = page.cursor;
    } catch (err) {
      console.error("Grain list failed:", err);
      break;
    }
  }

  return all.slice(0, MAX_ITEMS);
}

async function fetchTranscript(id: string, key: string): Promise<string> {
  try {
    const res = await fetch(`${API_BASE}/_/public-api/v2/recordings/${id}/transcript.txt`, {
      headers: { Authorization: `Bearer ${key}`, "Public-Api-Version": API_VERSION },
    });
    if (!res.ok) return "";
    return await res.text();
  } catch {
    return "";
  }
}

interface GrainExtractedSignals {
  summary?: string;
  actionItems: string[];
  keyMoments: { timestamp: string; text: string; sentiment: Sentiment }[];
}

/**
 * Fetch the recording detail object and extract structured intelligence data
 * (action items, key moments, summary) that Grain pre-computes server-side.
 *
 * Defensive parsing: Grain's response shape isn't fully versioned in their
 * public docs, so we probe several reasonable field names. If nothing matches,
 * returns empty arrays — the AI fallback in `extractCallSignals` will still run.
 *
 * Returns `undefined` only on hard failures (network/auth) so callers can
 * distinguish "Grain returned nothing useful" from "we didn't ask".
 */
async function fetchRecordingDetail(id: string, key: string): Promise<GrainExtractedSignals | undefined> {
  try {
    // Request with includes for any structured data Grain offers; unsupported
    // params are typically ignored, so it's safe to over-request.
    const url = new URL(`${API_BASE}/_/public-api/v2/recordings/${id}`);
    url.searchParams.append("include[]", "intelligence_notes");
    url.searchParams.append("include[]", "highlights");
    url.searchParams.append("include[]", "action_items");
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${key}`, "Public-Api-Version": API_VERSION },
    });
    if (!res.ok) return undefined;
    const detail = (await res.json()) as GrainRecordingDetail;
    return parseRecordingSignals(detail);
  } catch {
    return undefined;
  }
}

/** Pure parser — defensive against shape variation. Exported for tests if added later. */
function parseRecordingSignals(detail: GrainRecordingDetail): GrainExtractedSignals {
  return {
    summary: typeof detail.summary === "string" ? detail.summary
      : typeof detail.intelligence_summary === "string" ? detail.intelligence_summary
      : undefined,
    actionItems: parseActionItems(detail),
    keyMoments: parseKeyMoments(detail),
  };
}

function asString(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  return null;
}

/** Action items might be: string[], or object[] with .text / .body / .description / .title. */
function parseActionItems(detail: GrainRecordingDetail): string[] {
  const candidates: unknown[] = [
    detail.action_items,
    detail.intelligence_action_items,
    // Sometimes nested under intelligence_notes
    typeof detail.intelligence_notes === "object" && detail.intelligence_notes !== null
      ? (detail.intelligence_notes as { action_items?: unknown }).action_items
      : null,
  ];
  for (const c of candidates) {
    if (!Array.isArray(c)) continue;
    const out: string[] = [];
    for (const entry of c) {
      const s =
        asString(entry) ||
        (entry && typeof entry === "object"
          ? asString((entry as Record<string, unknown>).text) ||
            asString((entry as Record<string, unknown>).body) ||
            asString((entry as Record<string, unknown>).description) ||
            asString((entry as Record<string, unknown>).title)
          : null);
      if (s) out.push(s.slice(0, 200));
      if (out.length >= 6) break;
    }
    if (out.length > 0) return out;
  }
  return [];
}

const VALID_SENTIMENTS: Sentiment[] = ["positive", "negative", "neutral", "mixed"];

/** Key moments / highlights might come in many shapes — probe defensively. */
function parseKeyMoments(detail: GrainRecordingDetail): { timestamp: string; text: string; sentiment: Sentiment }[] {
  const candidates: unknown[] = [
    detail.highlights,
    detail.key_moments,
    typeof detail.intelligence_notes === "object" && detail.intelligence_notes !== null
      ? (detail.intelligence_notes as { highlights?: unknown }).highlights
      : null,
  ];
  for (const c of candidates) {
    if (!Array.isArray(c)) continue;
    const out: { timestamp: string; text: string; sentiment: Sentiment }[] = [];
    for (const entry of c) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      const text = asString(e.text) || asString(e.body) || asString(e.description) || asString(e.title);
      if (!text) continue;
      // Timestamp could be `timestamp_seconds` (number), `timestamp` (string MM:SS), `start_seconds`, etc.
      let timestamp = "";
      const tsRaw = e.timestamp_seconds ?? e.start_seconds ?? e.startTime;
      if (typeof tsRaw === "number" && Number.isFinite(tsRaw)) {
        const m = Math.floor(tsRaw / 60);
        const s = Math.floor(tsRaw % 60);
        timestamp = `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
      } else if (typeof e.timestamp === "string") {
        timestamp = e.timestamp.slice(0, 12);
      }
      const sent = asString(e.sentiment)?.toLowerCase() ?? "";
      const sentiment = VALID_SENTIMENTS.includes(sent as Sentiment) ? (sent as Sentiment) : "neutral";
      out.push({ timestamp, text: text.slice(0, 280), sentiment });
      if (out.length >= 6) break;
    }
    if (out.length > 0) return out;
  }
  return [];
}

function formatDuration(ms?: number): string {
  if (!ms || ms <= 0) return "Unknown";
  return `${Math.round(ms / 60000)} min`;
}

// Per-call transcript cap. Env-tunable, but bounded — a typo (e.g. 5_000_000) shouldn't
// be able to allocate gigabytes of transcript per call across the data cache.
const TRANSCRIPT_CAP_DEFAULT = 50_000;
const TRANSCRIPT_CAP_HARD_LIMIT = 200_000;
const TRANSCRIPT_CAP = (() => {
  const raw = Number(process.env.GRAIN_MAX_TRANSCRIPT_CHARS);
  if (!Number.isFinite(raw) || raw <= 0) return TRANSCRIPT_CAP_DEFAULT;
  return Math.min(raw, TRANSCRIPT_CAP_HARD_LIMIT);
})();

/**
 * Gentle whitespace cleanup that preserves newlines (so timestamps and speaker turns stay
 * structured) and trims spaces/tabs. Used for the `transcript` field that downstream
 * chunkers and citation logic read.
 */
function cleanTranscript(raw: string): string {
  return raw.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/** Aggressive whitespace collapse for the UI `summary` snippet (single-line preview). */
function snippetSummary(raw: string, max = 800): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, max);
}

/** Prefer Grain-provided URLs (workspace-aware) over a constructed fallback. */
function recordingUrl(r: GrainRecording): string {
  return r.url || r.share_url || `https://grain.com/recordings/${r.id}`;
}

export async function getGrainCalls(
  overrideKey?: string,
  useDemoFallback = true
): Promise<{ data: AttentionCall[]; isDemo: boolean }> {
  const key = overrideKey || process.env.GRAIN_API_KEY;
  if (!key) {
    return { data: useDemoFallback ? DEMO_ATTENTION_CALLS : [], isDemo: useDemoFallback && DEMO_ATTENTION_CALLS.length > 0 };
  }

  const recordings = await listRecordings(key);
  if (recordings.length === 0) {
    return { data: useDemoFallback ? DEMO_ATTENTION_CALLS : [], isDemo: useDemoFallback && DEMO_ATTENTION_CALLS.length > 0 };
  }

  // Fetch transcript AND structured intelligence (action items, highlights) concurrently
  // per recording. The intelligence endpoint is what backs Grain's own UI showing
  // pre-extracted action items — using it bypasses our AI extraction for those calls
  // and gets higher-quality results.
  const transcripts = new Map<string, string>();
  const signals = new Map<string, GrainExtractedSignals | undefined>();
  let nativeActionItemCalls = 0;

  for (let i = 0; i < recordings.length; i += TRANSCRIPT_CONCURRENCY) {
    const batch = recordings.slice(i, i + TRANSCRIPT_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (r) => {
        const [transcript, detail] = await Promise.all([
          fetchTranscript(r.id, key),
          fetchRecordingDetail(r.id, key),
        ]);
        return { id: r.id, transcript, detail };
      })
    );
    for (const { id, transcript, detail } of results) {
      transcripts.set(id, transcript);
      signals.set(id, detail);
      if (detail && detail.actionItems.length > 0) nativeActionItemCalls++;
    }
  }

  if (nativeActionItemCalls > 0) {
    console.log(`[grain] ${nativeActionItemCalls}/${recordings.length} calls have native action items from Grain (AI extraction will be skipped for these)`);
  }

  return {
    data: recordings.map((r) => {
      const rawTranscript = transcripts.get(r.id) ?? "";
      const cleanedTranscript = cleanTranscript(rawTranscript).slice(0, TRANSCRIPT_CAP);
      const sig = signals.get(r.id);
      // Prefer Grain's curated summary; fall back to a transcript snippet for the UI preview.
      const summary = sig?.summary
        ? snippetSummary(sig.summary)
        : snippetSummary(rawTranscript);
      return {
        id: r.id,
        title: r.title || "Untitled Call",
        date: r.start_datetime || "",
        duration: formatDuration(r.duration_ms),
        participants: (r.participants ?? []).map((p) => p.name || p.email || "").filter(Boolean),
        summary,
        transcript: cleanedTranscript || undefined,
        url: recordingUrl(r),
        // Use Grain's native intelligence when present. The skip-if-already-populated
        // rule in extractCallSignals will then bypass AI extraction for these calls.
        keyMoments: sig?.keyMoments ?? [],
        actionItems: sig?.actionItems ?? [],
        themes: r.tags ?? [],
        // callType populated later by extractCallSignals when an AI provider is configured
      };
    }),
    isDemo: false,
  };
}

export function isGrainConfigured(overrideKey?: string): boolean {
  return !!(overrideKey || process.env.GRAIN_API_KEY);
}

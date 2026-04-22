import { AttentionCall } from "./types";
import { DEMO_ATTENTION_CALLS } from "./demo-data";

const API_BASE = "https://api.grain.com";
const API_VERSION = "2025-10-31";
const MAX_ITEMS = 200;
const TRANSCRIPT_CONCURRENCY = 5;

interface GrainRecording {
  id: string;
  title?: string;
  start_datetime?: string;
  duration_ms?: number;
  participants?: { name?: string; email?: string }[];
  tags?: string[];
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

function formatDuration(ms?: number): string {
  if (!ms || ms <= 0) return "Unknown";
  return `${Math.round(ms / 60000)} min`;
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

  const transcripts = new Map<string, string>();
  for (let i = 0; i < recordings.length; i += TRANSCRIPT_CONCURRENCY) {
    const batch = recordings.slice(i, i + TRANSCRIPT_CONCURRENCY);
    const texts = await Promise.all(batch.map((r) => fetchTranscript(r.id, key)));
    batch.forEach((r, idx) => transcripts.set(r.id, texts[idx]));
  }

  return {
    data: recordings.map((r) => ({
      id: r.id,
      title: r.title || "Untitled Call",
      date: r.start_datetime || "",
      duration: formatDuration(r.duration_ms),
      participants: (r.participants ?? []).map((p) => p.name || p.email || "").filter(Boolean),
      summary: (transcripts.get(r.id) ?? "").slice(0, 800).replace(/\s+/g, " ").trim(),
      keyMoments: [],
      actionItems: [],
      themes: r.tags ?? [],
    })),
    isDemo: false,
  };
}

export function isGrainConfigured(overrideKey?: string): boolean {
  return !!(overrideKey || process.env.GRAIN_API_KEY);
}

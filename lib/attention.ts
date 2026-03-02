import { AttentionCall } from "./types";
import { DEMO_ATTENTION_CALLS } from "./demo-data";

const API_BASE = "https://api.attention.tech/v1";

async function attentionFetch(path: string, overrideKey?: string) {
  const key = overrideKey || process.env.ATTENTION_API_KEY;
  if (!key) return null;

  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    console.error(`Attention API error: ${res.status} ${res.statusText}`);
    return null;
  }
  return res.json();
}

export async function getCalls(
  overrideKey?: string,
  useDemoFallback = true
): Promise<{ data: AttentionCall[]; isDemo: boolean }> {
  const data = await attentionFetch("/conversations", overrideKey);

  if (!data) {
    return {
      data: useDemoFallback ? DEMO_ATTENTION_CALLS : [],
      isDemo: useDemoFallback && DEMO_ATTENTION_CALLS.length > 0,
    };
  }

  return {
    data: (data.conversations || []).map(
      (c: Record<string, unknown>) => ({
        id: c.id as string,
        title: (c.title as string) || "Untitled Call",
        date: (c.date as string) || new Date().toISOString(),
        duration: (c.duration as string) || "Unknown",
        participants: (c.participants as string[]) || [],
        summary: (c.summary as string) || "",
        keyMoments: [],
        actionItems: (c.action_items as string[]) || [],
        themes: [],
      })
    ),
    isDemo: false,
  };
}

export function isAttentionConfigured(overrideKey?: string): boolean {
  return !!(overrideKey || process.env.ATTENTION_API_KEY);
}

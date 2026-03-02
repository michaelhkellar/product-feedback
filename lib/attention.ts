import { AttentionCall } from "./types";
import { DEMO_ATTENTION_CALLS } from "./demo-data";

const API_BASE = "https://api.attention.tech/v1";
const MAX_ITEMS = 1000;
const PAGE_SIZE = 100;

async function attentionFetchPage(url: string, key: string) {
  const res = await fetch(url, {
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

async function attentionFetchAll(path: string, overrideKey?: string): Promise<Record<string, unknown>[] | null> {
  const key = overrideKey || process.env.ATTENTION_API_KEY;
  if (!key) return null;

  const allItems: Record<string, unknown>[] = [];
  let url = `${API_BASE}${path}?limit=${PAGE_SIZE}`;

  while (url && allItems.length < MAX_ITEMS) {
    const page = await attentionFetchPage(url, key);
    if (!page) return allItems.length > 0 ? allItems : null;

    const items = page.conversations || page.data || [];
    allItems.push(...items);

    const nextCursor = page.next_cursor || page.pagination?.next_cursor;
    if (nextCursor && items.length === PAGE_SIZE && allItems.length < MAX_ITEMS) {
      url = `${API_BASE}${path}?limit=${PAGE_SIZE}&cursor=${nextCursor}`;
    } else {
      break;
    }
  }

  return allItems;
}

export async function getCalls(
  overrideKey?: string,
  useDemoFallback = true
): Promise<{ data: AttentionCall[]; isDemo: boolean }> {
  const items = await attentionFetchAll("/conversations", overrideKey);

  if (!items) {
    return {
      data: useDemoFallback ? DEMO_ATTENTION_CALLS : [],
      isDemo: useDemoFallback && DEMO_ATTENTION_CALLS.length > 0,
    };
  }

  return {
    data: items.map(
      (c) => ({
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

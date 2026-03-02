import { ProductboardFeature, FeedbackItem } from "./types";
import { DEMO_PRODUCTBOARD_FEATURES, DEMO_FEEDBACK } from "./demo-data";

const API_BASE = "https://api.productboard.com";
const MAX_ITEMS = 1000;
const PAGE_SIZE = 100;

async function pbFetchPage(url: string, token: string) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Version": "1",
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    console.error(`Productboard API error: ${res.status} ${res.statusText}`);
    return null;
  }
  return res.json();
}

async function pbFetchAll(path: string, overrideKey?: string): Promise<Record<string, unknown>[] | null> {
  const token = overrideKey || process.env.PRODUCTBOARD_API_TOKEN;
  if (!token) return null;

  const allItems: Record<string, unknown>[] = [];
  let url = `${API_BASE}${path}?pageLimit=${PAGE_SIZE}`;

  while (url && allItems.length < MAX_ITEMS) {
    const page = await pbFetchPage(url, token);
    if (!page) return allItems.length > 0 ? allItems : null;

    const items = page.data || [];
    allItems.push(...items);

    const nextLink = page.links?.next;
    if (nextLink && items.length === PAGE_SIZE && allItems.length < MAX_ITEMS) {
      url = typeof nextLink === "string" && nextLink.startsWith("http")
        ? nextLink
        : `${API_BASE}${nextLink}`;
    } else {
      break;
    }
  }

  return allItems;
}

export async function getFeatures(
  overrideKey?: string,
  useDemoFallback = true
): Promise<{ data: ProductboardFeature[]; isDemo: boolean }> {
  const items = await pbFetchAll("/features", overrideKey);

  if (!items) {
    return {
      data: useDemoFallback ? DEMO_PRODUCTBOARD_FEATURES : [],
      isDemo: useDemoFallback && DEMO_PRODUCTBOARD_FEATURES.length > 0,
    };
  }

  return {
    data: items.map((f) => ({
      id: f.id as string,
      name: (f.name as string) || "Untitled Feature",
      description: (f.description as string) || "",
      status: mapStatus(f.status as Record<string, unknown>),
      votes: (f.votes as number) || 0,
      customerRequests: 0,
      themes: [],
    })),
    isDemo: false,
  };
}

export async function getNotes(
  overrideKey?: string,
  useDemoFallback = true
): Promise<{ data: FeedbackItem[]; isDemo: boolean }> {
  const items = await pbFetchAll("/notes", overrideKey);

  if (!items) {
    const demoNotes = DEMO_FEEDBACK.filter((f) => f.source === "productboard");
    return {
      data: useDemoFallback ? demoNotes : [],
      isDemo: useDemoFallback && demoNotes.length > 0,
    };
  }

  return {
    data: items.map((n) => ({
      id: n.id as string,
      source: "productboard" as const,
      title: (n.title as string) || "Untitled Note",
      content: (n.content as string) || "",
      customer: "",
      sentiment: "neutral" as const,
      themes: [],
      date: (n.createdAt as string) || new Date().toISOString(),
      priority: "medium" as const,
    })),
    isDemo: false,
  };
}

function mapStatus(
  status: Record<string, unknown> | undefined
): ProductboardFeature["status"] {
  const name = (status?.name as string)?.toLowerCase() || "";
  if (name.includes("progress")) return "in_progress";
  if (name.includes("plan")) return "planned";
  if (name.includes("done") || name.includes("complete")) return "done";
  return "new";
}

export function isProductboardConfigured(overrideKey?: string): boolean {
  return !!(overrideKey || process.env.PRODUCTBOARD_API_TOKEN);
}

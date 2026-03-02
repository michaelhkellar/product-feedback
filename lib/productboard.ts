import { ProductboardFeature, FeedbackItem } from "./types";
import { DEMO_PRODUCTBOARD_FEATURES, DEMO_FEEDBACK } from "./demo-data";

const API_BASE = "https://api.productboard.com";

async function pbFetch(path: string) {
  const token = process.env.PRODUCTBOARD_API_TOKEN;
  if (!token) return null;

  const res = await fetch(`${API_BASE}${path}`, {
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

export async function getFeatures(): Promise<ProductboardFeature[]> {
  const data = await pbFetch("/features");

  if (!data) return DEMO_PRODUCTBOARD_FEATURES;

  return (data.data || []).map((f: Record<string, unknown>) => ({
    id: f.id as string,
    name: (f.name as string) || "Untitled Feature",
    description: (f.description as string) || "",
    status: mapStatus(f.status as Record<string, unknown>),
    votes: (f.votes as number) || 0,
    customerRequests: 0,
    themes: [],
  }));
}

export async function getNotes(): Promise<FeedbackItem[]> {
  const data = await pbFetch("/notes");

  if (!data) return DEMO_FEEDBACK.filter((f) => f.source === "productboard");

  return (data.data || []).map((n: Record<string, unknown>) => ({
    id: n.id as string,
    source: "productboard" as const,
    title: (n.title as string) || "Untitled Note",
    content: (n.content as string) || "",
    customer: "",
    sentiment: "neutral" as const,
    themes: [],
    date: (n.createdAt as string) || new Date().toISOString(),
    priority: "medium" as const,
  }));
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

export function isProductboardConfigured(): boolean {
  return !!process.env.PRODUCTBOARD_API_TOKEN;
}

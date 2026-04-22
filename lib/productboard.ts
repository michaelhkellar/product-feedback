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

async function pbFetchAll(
  path: string,
  overrideKey?: string,
  maxItems = MAX_ITEMS
): Promise<Record<string, unknown>[] | null> {
  const token = overrideKey || process.env.PRODUCTBOARD_API_TOKEN;
  if (!token) return null;

  const allItems: Record<string, unknown>[] = [];
  let url: string | null = `${API_BASE}${path}?pageLimit=${PAGE_SIZE}`;

  while (url && allItems.length < maxItems) {
    const page = await pbFetchPage(url, token);
    if (!page) return allItems.length > 0 ? allItems : null;

    const items = page.data || [];
    allItems.push(...items);

    if (items.length === 0) break;

    let nextUrl: string | null = null;
    if (page.links?.next) {
      const link = page.links.next;
      nextUrl = typeof link === "string" && link.startsWith("http") ? link : `${API_BASE}${link}`;
    } else if (page.pageCursor || page.nextPageCursor) {
      const cursor = page.pageCursor || page.nextPageCursor;
      nextUrl = `${API_BASE}${path}?pageLimit=${PAGE_SIZE}&pageCursor=${cursor}`;
    }

    if (nextUrl && allItems.length < maxItems && items.length >= PAGE_SIZE) {
      url = nextUrl;
    } else {
      break;
    }
  }

  console.log(`Productboard ${path}: fetched ${allItems.length} items`);
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
      name: (f.name as string) || (f.title as string) || "Untitled Feature",
      description: (f.description as string) || "",
      status: mapStatus(f.status as Record<string, unknown>),
      votes: (f.votes as number) || 0,
      customerRequests: (f.customerRequests as number) || (f.customer_requests as number) || 0,
      themes: extractThemes(f),
    })),
    isDemo: false,
  };
}

export async function getNotes(
  overrideKey?: string,
  useDemoFallback = true,
  maxItems = MAX_ITEMS
): Promise<{ data: FeedbackItem[]; isDemo: boolean }> {
  const items = await pbFetchAll("/notes", overrideKey, maxItems);

  if (!items) {
    const demoNotes = DEMO_FEEDBACK.filter((f) => f.source === "productboard");
    return {
      data: useDemoFallback ? demoNotes : [],
      isDemo: useDemoFallback && demoNotes.length > 0,
    };
  }

  const mapped = items.map((n) => ({
    id: (n.id as string) || (n.uuid as string) || "",
    source: "productboard" as const,
    title: (n.title as string) || (n.note_title as string) || "Untitled Note",
    content: (n.content as string) || (n.note_text as string) || "",
    customer: (n.user_name as string) || (n.user_email as string) || "",
    company: (n.company_name as string) || undefined,
    sentiment: "neutral" as const,
    themes: extractNoteTags(n),
    date: (n.createdAt as string) || (n.created_at as string) || (n.created as string) || (n.dateCreated as string) || (n.inserted_at as string) || (n.createdTime as string) || "",
    priority: mapNotePriority(n),
    metadata: buildNoteMetadata(n),
  }));

  logDateDistribution("Productboard notes", mapped);
  return { data: mapped, isDemo: false };
}

/**
 * Log a quick age histogram so we can tell at a glance whether Productboard
 * is returning fresh `createdAt` values for most notes (an ingest-time
 * artifact that makes items look falsely "today") or truly-distributed
 * historical dates. Only runs in dev / serverless logs.
 */
function logDateDistribution(label: string, items: { date: string }[]): void {
  if (items.length === 0) return;
  const now = Date.now();
  const DAY = 1000 * 60 * 60 * 24;
  const buckets = { today: 0, this_week: 0, this_month: 0, older: 0, unknown: 0 };
  const sampleToday: string[] = [];
  for (const it of items) {
    if (!it.date) { buckets.unknown++; continue; }
    const t = new Date(it.date).getTime();
    if (isNaN(t)) { buckets.unknown++; continue; }
    const days = (now - t) / DAY;
    if (days < 1) {
      buckets.today++;
      if (sampleToday.length < 3) sampleToday.push(it.date);
    } else if (days < 7) buckets.this_week++;
    else if (days < 30) buckets.this_month++;
    else buckets.older++;
  }
  const pctToday = Math.round((buckets.today / items.length) * 100);
  console.log(
    `[dates] ${label}: today=${buckets.today} (${pctToday}%) / week=${buckets.this_week} / month=${buckets.this_month} / older=${buckets.older} / unknown=${buckets.unknown}`
  );
  if (pctToday >= 40) {
    console.warn(
      `[dates] ⚠ ${pctToday}% of ${label} are dated within the last 24h — likely an ingest-time artifact, not true creation time. Sample: ${sampleToday.join(", ")}`
    );
  }
}

function extractThemes(f: Record<string, unknown>): string[] {
  const themes: string[] = [];
  if (Array.isArray(f.tags)) {
    for (const t of f.tags) {
      if (typeof t === "string") themes.push(t);
      else if (t && typeof t === "object" && "name" in t) themes.push((t as { name: string }).name);
    }
  }
  if (Array.isArray(f.labels)) {
    for (const l of f.labels) {
      if (typeof l === "string") themes.push(l);
      else if (l && typeof l === "object" && "name" in l) themes.push((l as { name: string }).name);
    }
  }
  return themes;
}

function extractNoteTags(n: Record<string, unknown>): string[] {
  const tags: string[] = [];
  if (Array.isArray(n.tags)) {
    for (const t of n.tags) {
      if (typeof t === "string") tags.push(t);
      else if (t && typeof t === "object" && "name" in t) tags.push((t as { name: string }).name);
    }
  }
  return tags;
}

function mapNotePriority(n: Record<string, unknown>): FeedbackItem["priority"] {
  const state = (n.state as string)?.toLowerCase() || "";
  if (state === "unprocessed") return "high";
  return "medium";
}

function buildNoteMetadata(n: Record<string, unknown>): Record<string, string> {
  const meta: Record<string, string> = {};
  // Prefer a direct link to the note INSIDE Productboard so users can jump to
  // the source. The Productboard API exposes this under several field names
  // depending on version/response shape:
  //   - links.html  (common in v1 responses)
  //   - display_url (alternative)
  //   - url         (bare field some endpoints return)
  // Fall back to source_url (external origin like Zendesk) only if no internal
  // Productboard link is available.
  const links = n.links as Record<string, unknown> | undefined;
  const pbDisplayUrl =
    (typeof links?.html === "string" && links.html) ||
    (typeof n.display_url === "string" && n.display_url) ||
    (typeof n.url === "string" && n.url) ||
    (typeof n.source_url === "string" && n.source_url) ||
    "";
  if (pbDisplayUrl) meta.sourceUrl = pbDisplayUrl;
  if (n.source_id) meta.sourceId = n.source_id as string;
  if (n.state) meta.state = n.state as string;
  if (n.company_domain) meta.companyDomain = n.company_domain as string;
  if (n.user_email) meta.userEmail = n.user_email as string;
  return meta;
}

function mapStatus(
  status: Record<string, unknown> | undefined
): ProductboardFeature["status"] {
  if (!status) return "new";
  const name = ((status.name as string) || (status as unknown as string) || "").toLowerCase();
  if (name.includes("progress")) return "in_progress";
  if (name.includes("plan")) return "planned";
  if (name.includes("done") || name.includes("complete") || name.includes("released") || name.includes("shipped")) return "done";
  return "new";
}

export function isProductboardConfigured(overrideKey?: string): boolean {
  return !!(overrideKey || process.env.PRODUCTBOARD_API_TOKEN);
}

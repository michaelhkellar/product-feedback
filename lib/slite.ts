const SLITE_BASE = "https://api.slite.com/v1";
const NOTE_CAP = 500;

export interface SliteNote {
  id: string;
  title: string;
  excerpt: string;
  parentId: string | null;
  lastModified: string;
  author: string;
  url: string;
}

function sliteHeaders(key: string): Record<string, string> {
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

function buildExcerpt(markdown: string): string {
  return markdown
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`[^`]+`/g, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\n+/g, " ")
    .trim()
    .slice(0, 300);
}

export function isSliteConfigured(overrideKey?: string): boolean {
  return !!(overrideKey || process.env.SLITE_API_KEY);
}

export async function validateSliteKey(overrideKey?: string): Promise<boolean> {
  const key = overrideKey || process.env.SLITE_API_KEY;
  if (!key) return false;
  try {
    const res = await fetch(`${SLITE_BASE}/notes?limit=1`, { headers: sliteHeaders(key) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function getSliteTopLevelNotes(overrideKey?: string): Promise<{ id: string; title: string }[]> {
  const key = overrideKey || process.env.SLITE_API_KEY;
  if (!key) return [];
  try {
    const res = await fetch(`${SLITE_BASE}/notes?limit=50`, { headers: sliteHeaders(key) });
    if (!res.ok) return [];
    const json = await res.json() as { notes?: { id: string; title: string; parentNoteId?: string | null }[] };
    return (json.notes || [])
      .filter((n) => !n.parentNoteId)
      .map((n) => ({ id: n.id, title: n.title }));
  } catch {
    return [];
  }
}

export async function getSliteNotes(
  overrideKey?: string,
  useDemoFallback?: boolean
): Promise<{ data: SliteNote[]; isDemo: boolean; error?: string }> {
  const key = overrideKey || process.env.SLITE_API_KEY;
  if (!key) {
    if (useDemoFallback) return { data: DEMO_SLITE_NOTES, isDemo: true };
    return { data: [], isDemo: false };
  }

  try {
    const notes: SliteNote[] = [];
    let cursor: string | null = null;

    while (notes.length < NOTE_CAP) {
      const url = cursor
        ? `${SLITE_BASE}/notes?limit=50&cursor=${encodeURIComponent(cursor)}`
        : `${SLITE_BASE}/notes?limit=50`;
      const res = await fetch(url, { headers: sliteHeaders(key) });
      if (!res.ok) {
        if (notes.length === 0) {
          const errorMsg =
            res.status === 401 || res.status === 403
              ? "Unauthorized — check your Slite API key"
              : res.status === 429
              ? "Rate limited by Slite"
              : `Slite API returned ${res.status}`;
          return { data: [], isDemo: false, error: errorMsg };
        }
        break;
      }

      const json = await res.json() as {
        notes?: { id: string; title: string; parentNoteId?: string | null; updatedAt?: string; createdBy?: { name?: string }; url?: string; markdown?: string }[];
        hasNextPage?: boolean;
        nextCursor?: string;
      };

      for (const n of json.notes || []) {
        notes.push({
          id: n.id,
          title: n.title || "Untitled",
          excerpt: n.markdown ? buildExcerpt(n.markdown) : "",
          parentId: n.parentNoteId || null,
          lastModified: n.updatedAt || "",
          author: n.createdBy?.name || "",
          url: n.url || `https://app.slite.com/app/note/${n.id}`,
        });
      }

      if (!json.hasNextPage || !json.nextCursor) break;
      cursor = json.nextCursor;
    }

    return { data: notes, isDemo: false };
  } catch (err) {
    console.error("Slite fetch error:", err);
    if (useDemoFallback) return { data: DEMO_SLITE_NOTES, isDemo: true };
    return { data: [], isDemo: false, error: "Failed to fetch Slite notes" };
  }
}

export async function createSliteNote(
  title: string,
  markdown: string,
  parentNoteId: string | undefined,
  overrideKey?: string
): Promise<{ id: string; url: string }> {
  const key = overrideKey || process.env.SLITE_API_KEY;
  if (!key) throw new Error("Slite API key not configured");

  const body: Record<string, unknown> = { title, markdown };
  if (parentNoteId) body.parentNoteId = parentNoteId;

  const res = await fetch(`${SLITE_BASE}/notes`, {
    method: "POST",
    headers: sliteHeaders(key),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Slite API returned ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
  }

  const data = await res.json() as { id: string; url?: string };
  return {
    id: data.id,
    url: data.url || `https://app.slite.com/app/note/${data.id}`,
  };
}

const DEMO_SLITE_NOTES: SliteNote[] = [
  {
    id: "slite-001",
    title: "Product Roadmap H1 2026",
    excerpt: "Overview of planned features and initiatives for H1 2026. Focuses on performance improvements, mobile redesign, and enterprise onboarding.",
    parentId: null,
    lastModified: "2026-03-15",
    author: "Demo User",
    url: "https://app.slite.com/app/note/slite-001",
  },
  {
    id: "slite-002",
    title: "Engineering Handbook",
    excerpt: "Development processes, code review standards, and deployment procedures for the engineering team.",
    parentId: null,
    lastModified: "2026-02-20",
    author: "Demo User",
    url: "https://app.slite.com/app/note/slite-002",
  },
  {
    id: "slite-003",
    title: "Customer Onboarding Playbook",
    excerpt: "Step-by-step guide for onboarding new enterprise customers including setup, training, and success milestones.",
    parentId: null,
    lastModified: "2026-01-10",
    author: "Demo User",
    url: "https://app.slite.com/app/note/slite-003",
  },
];

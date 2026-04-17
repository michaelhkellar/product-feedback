import { NextRequest, NextResponse } from "next/server";
import { createJiraIssue } from "@/lib/atlassian";
import { createLinearIssue } from "@/lib/linear";
import { sanitizeForProvider, markdownToADF } from "@/lib/ticket-provider";
import { TicketProviderType } from "@/lib/api-keys";

const COOLDOWN_MS = 10_000;
const RATE_LIMIT_TTL_MS = 120_000;
const lastCreation = new Map<string, number>();

function evictExpired(map: Map<string, number>, ttlMs: number): void {
  const cutoff = Date.now() - ttlMs;
  Array.from(map.entries()).forEach(([key, ts]) => {
    if (ts < cutoff) map.delete(key);
  });
}

function getRateLimitKey(req: NextRequest): string {
  return req.ip || "unknown";
}

export async function POST(req: NextRequest) {
  try {
    const clientKey = getRateLimitKey(req);
    const now = Date.now();
    const lastTime = lastCreation.get(clientKey) || 0;
    if (now - lastTime < COOLDOWN_MS) {
      return NextResponse.json(
        { error: "Rate limit: please wait before creating another ticket" },
        { status: 429 }
      );
    }

    evictExpired(lastCreation, RATE_LIMIT_TTL_MS);

    const body = await req.json();
    const { title, description, projectKey, teamId, priority } = body;

    if (!title || typeof title !== "string") {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    const provider = (req.headers.get("x-ticket-provider") || "atlassian") as TicketProviderType;

    if (provider === "linear" && (!teamId || typeof teamId !== "string")) {
      return NextResponse.json({ error: "Team ID is required for Linear" }, { status: 400 });
    }
    if (provider !== "linear" && (!projectKey || typeof projectKey !== "string")) {
      return NextResponse.json({ error: "Project key is required for Jira" }, { status: 400 });
    }

    if (provider === "linear") {
      const linearKey = req.headers.get("x-linear-key") || process.env.LINEAR_API_KEY;
      if (!linearKey) {
        return NextResponse.json({ error: "Linear API key not configured" }, { status: 400 });
      }

      const sanitized = sanitizeForProvider(description || "", "linear");
      const priorityMap: Record<string, number> = { critical: 1, high: 2, medium: 3, low: 4 };
      const linearPriority = priority ? priorityMap[priority.toLowerCase()] : undefined;

      const result = await createLinearIssue(
        title,
        sanitized,
        teamId || "",
        linearKey,
        linearPriority
      );

      lastCreation.set(clientKey, now);
      return NextResponse.json(result);
    }

    // Atlassian (Jira)
    const domain = req.headers.get("x-atlassian-domain") || undefined;
    const email = req.headers.get("x-atlassian-email") || undefined;
    const token = req.headers.get("x-atlassian-token") || undefined;

    if (!domain && !process.env.ATLASSIAN_DOMAIN) {
      return NextResponse.json({ error: "Atlassian credentials not configured" }, { status: 400 });
    }

    const sanitized = sanitizeForProvider(description || "", "atlassian");
    const adf = markdownToADF(sanitized);

    const result = await createJiraIssue(
      title,
      adf,
      projectKey || "",
      "Task",
      priority,
      domain,
      email,
      token
    );

    lastCreation.set(clientKey, now);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Ticket creation error:", error);
    return NextResponse.json(
      { error: "Ticket creation failed. Check your credentials and try again." },
      { status: 500 }
    );
  }
}

// Multi-hop agent tool definitions and dispatcher.
// All tools read from in-memory AgentData — no external API calls per tool round.
// This keeps latency and cost bounded within the 3-round / 15s budget.

import { AgentData } from "./agent";
import { ToolDefinition, ToolCall } from "./ai-provider";
import { InMemoryVectorStore } from "./vector-store";

export interface ToolContext {
  data: AgentData;
  store: InMemoryVectorStore;
}

export interface ToolResult {
  toolCallId: string;
  result: unknown;
}

// Tool definitions (JSON Schema)
export const AGENT_TOOLS: ToolDefinition[] = [
  {
    name: "findFeedback",
    description: "Search feedback items by theme, company, sentiment, and/or date range. Returns matching items with snippet and date.",
    parameters: {
      type: "object",
      properties: {
        theme: { type: "string", description: "Keyword or theme to search for" },
        company: { type: "string", description: "Customer company name" },
        sentiment: { type: "string", enum: ["positive", "negative", "neutral", "mixed"], description: "Sentiment filter" },
        since: { type: "string", description: "ISO date string — only return items on or after this date" },
        until: { type: "string", description: "ISO date string — only return items on or before this date" },
        limit: { type: "number", description: "Max results (default 10, max 20)" },
      },
    },
  },
  {
    name: "compareWindows",
    description: "Compare feedback volume and top companies for a theme across two date windows.",
    parameters: {
      type: "object",
      properties: {
        theme: { type: "string", description: "Theme or keyword to compare" },
        windowA: {
          type: "object",
          properties: { start: { type: "string" }, end: { type: "string" } },
          required: ["start", "end"],
          description: "Earlier time window",
        },
        windowB: {
          type: "object",
          properties: { start: { type: "string" }, end: { type: "string" } },
          required: ["start", "end"],
          description: "Later time window",
        },
      },
      required: ["theme", "windowA", "windowB"],
    },
  },
  {
    name: "findAnalytics",
    description: "Look up analytics signals (events, pages, features) by name or keyword from the configured analytics provider.",
    parameters: {
      type: "object",
      properties: {
        feature: { type: "string", description: "Feature or page name to look up" },
        event: { type: "string", description: "Event name to look up" },
      },
    },
  },
  {
    name: "findAccountHistory",
    description: "Return all feedback, calls, and tickets associated with a specific customer company.",
    parameters: {
      type: "object",
      properties: {
        company: { type: "string", description: "Customer company name" },
      },
      required: ["company"],
    },
  },
];

function inWindow(date: string, since?: string, until?: string): boolean {
  if (!date) return true;
  const d = new Date(date).getTime();
  if (since && d < new Date(since).getTime()) return false;
  if (until && d > new Date(until).getTime()) return false;
  return true;
}

function runFindFeedback(
  input: Record<string, unknown>,
  data: AgentData
): unknown {
  const theme = (input.theme as string | undefined)?.toLowerCase();
  const company = (input.company as string | undefined)?.toLowerCase();
  const sentiment = input.sentiment as string | undefined;
  const since = input.since as string | undefined;
  const until = input.until as string | undefined;
  const limit = Math.min(Number(input.limit) || 10, 20);

  if (!theme && !company && !sentiment && !since && !until) {
    return { items: [], total: 0, note: "provide at least one of theme, company, sentiment, since, or until" };
  }

  const items = data.feedback
    .filter((f) => {
      if (theme && !(`${f.title} ${f.content} ${f.themes.join(" ")}`).toLowerCase().includes(theme)) return false;
      if (company && !(f.company || "").toLowerCase().includes(company)) return false;
      if (sentiment && f.sentiment !== sentiment) return false;
      if (!inWindow(f.date, since, until)) return false;
      return true;
    })
    .slice(0, limit)
    .map((f) => ({
      id: f.id,
      label: f.company || f.customer,
      snippet: f.content.slice(0, 200),
      date: f.date,
      sentiment: f.sentiment,
    }));

  return { items, total: items.length };
}

function runCompareWindows(
  input: Record<string, unknown>,
  data: AgentData
): unknown {
  const theme = ((input.theme as string) || "").toLowerCase();
  const wA = input.windowA as { start: string; end: string };
  const wB = input.windowB as { start: string; end: string };
  if (!wA || !wB) return { error: "windowA and windowB are required" };

  const match = (f: { title: string; content: string; themes: string[]; date: string }, since: string, until: string) =>
    (`${f.title} ${f.content} ${f.themes.join(" ")}`).toLowerCase().includes(theme) &&
    inWindow(f.date, since, until);

  const aItems = data.feedback.filter((f) => match(f, wA.start, wA.end));
  const bItems = data.feedback.filter((f) => match(f, wB.start, wB.end));

  const topCompanies = (items: typeof aItems) =>
    Array.from(
      items.reduce((m, f) => m.set(f.company || "unknown", (m.get(f.company || "unknown") || 0) + 1), new Map<string, number>())
    )
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([c]) => c);

  return {
    aCount: aItems.length,
    bCount: bItems.length,
    delta: bItems.length - aItems.length,
    aTopCompanies: topCompanies(aItems),
    bTopCompanies: topCompanies(bItems),
    windowA: wA,
    windowB: wB,
  };
}

function runFindAnalytics(
  input: Record<string, unknown>,
  data: AgentData
): unknown {
  const ao = data.analyticsOverview;
  if (!ao) return { signals: [], note: "No analytics data available" };

  const keyword = ((input.feature as string) || (input.event as string) || "").toLowerCase();

  const allItems = [
    ...ao.topEvents.map((i) => ({ ...i, kind: "event" })),
    ...ao.topPages.map((i) => ({ ...i, kind: "page" })),
    ...ao.topFeatures.map((i) => ({ ...i, kind: "feature" })),
  ];

  const matched = keyword
    ? allItems.filter((i) => i.name.toLowerCase().includes(keyword))
    : allItems.slice(0, 10);

  return {
    signals: matched.slice(0, 10).map((i) => ({
      label: `${ao.provider} ${i.kind} ${i.name}`,
      value: i.count,
      window: "last 30 days",
    })),
  };
}

function runFindAccountHistory(
  input: Record<string, unknown>,
  data: AgentData
): unknown {
  const company = ((input.company as string) || "").toLowerCase();
  if (!company) return { error: "company is required" };

  const feedback = data.feedback
    .filter((f) => (f.company || "").toLowerCase().includes(company))
    .slice(0, 10)
    .map((f) => ({ id: f.id, label: f.title.slice(0, 80), date: f.date, sentiment: f.sentiment }));

  const calls = data.calls
    .filter((c) => c.participants.some((p) => p.toLowerCase().includes(company)))
    .slice(0, 5)
    .map((c) => ({ id: c.id, label: c.title, date: c.date }));

  const tickets = data.jiraIssues
    .filter((j) => {
      const hay = `${j.summary} ${j.description || ""} ${j.labels.join(" ")} ${j.reporter}`.toLowerCase();
      return hay.includes(company);
    })
    .slice(0, 5)
    .map((j) => ({ id: j.id, label: `${j.key}: ${j.summary.slice(0, 60)}`, date: j.created }));

  const topEvents = data.analyticsOverview?.topEvents.slice(0, 3).map((e) => e.name) ?? [];

  return {
    feedback,
    calls,
    tickets,
    analytics: topEvents.length ? { topEvents } : undefined,
    note: "Linear issues are internally assigned and not filtered by customer company.",
  };
}

/** Run a single tool call. Returns a ToolResult — never throws. */
export async function runTool(
  tc: ToolCall,
  ctx: ToolContext
): Promise<ToolResult> {
  // Simple dedup cache is maintained by the caller (multi-hop loop) not here.
  try {
    let result: unknown;
    switch (tc.name) {
      case "findFeedback":
        result = runFindFeedback(tc.input, ctx.data);
        break;
      case "compareWindows":
        result = runCompareWindows(tc.input, ctx.data);
        break;
      case "findAnalytics":
        result = runFindAnalytics(tc.input, ctx.data);
        break;
      case "findAccountHistory":
        result = runFindAccountHistory(tc.input, ctx.data);
        break;
      default:
        result = { error: `unknown_tool: ${tc.name}` };
    }
    return { toolCallId: tc.id, result };
  } catch (err) {
    return { toolCallId: tc.id, result: { error: String(err) } };
  }
}

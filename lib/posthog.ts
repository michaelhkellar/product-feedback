import { FeedbackItem, AnalyticsOverview, AnalyticsLookupContext, FullAnalyticsResult } from "./types";

const DEFAULT_HOST = "https://app.posthog.com";

// Only these hosts are accepted as user-supplied overrides to prevent SSRF.
// The server-configured POSTHOG_HOST env var is always trusted regardless.
const KNOWN_POSTHOG_HOSTS = new Set([
  "https://app.posthog.com",
  "https://eu.posthog.com",
  "https://us.posthog.com",
]);

function parsePostHogKey(compositeKey: string): { apiKey: string; projectId: string } | null {
  const parts = compositeKey.split(":");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { apiKey: parts[0], projectId: parts[1] };
}

function resolveHost(overrideHost?: string): string {
  if (overrideHost) {
    const normalized = overrideHost.replace(/\/+$/, "");
    const serverConfigured = (process.env.POSTHOG_HOST || "").replace(/\/+$/, "");
    if (KNOWN_POSTHOG_HOSTS.has(normalized) || (serverConfigured && normalized === serverConfigured)) {
      return normalized;
    }
    return DEFAULT_HOST;
  }
  const h = process.env.POSTHOG_HOST || DEFAULT_HOST;
  return h.replace(/\/+$/, "");
}

export function isPostHogConfigured(overrideKey?: string): boolean {
  const key = overrideKey || process.env.POSTHOG_API_KEY;
  if (!key) return false;
  return parsePostHogKey(key) !== null;
}

async function posthogFetch<T>(
  path: string,
  apiKey: string,
  host: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(`${host}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const message = await res.text().catch(() => "");
    throw new Error(`PostHog API ${res.status}: ${message || res.statusText}`);
  }

  return res.json() as Promise<T>;
}

export async function getPostHogOverview(
  overrideKey?: string,
  days?: number,
  overrideHost?: string
): Promise<AnalyticsOverview | null> {
  const compositeKey = overrideKey || process.env.POSTHOG_API_KEY;
  if (!compositeKey) return null;
  const creds = parsePostHogKey(compositeKey);
  if (!creds) return null;
  const effectiveDays = days || 30;
  const host = resolveHost(overrideHost);

  try {
    const [pageData, eventData] = await Promise.all([
      posthogFetch<Record<string, unknown>>(
        `/api/projects/${creds.projectId}/query/`,
        creds.apiKey,
        host,
        {
          method: "POST",
          body: JSON.stringify({
            query: {
              kind: "HogQLQuery",
              query: `SELECT properties.$current_url AS page, count() AS events, uniq(distinct_id) AS users FROM events WHERE timestamp >= now() - interval ${effectiveDays} day AND event = '$pageview' GROUP BY page ORDER BY events DESC LIMIT 200`,
            },
          }),
        }
      ),
      posthogFetch<Record<string, unknown>>(
        `/api/projects/${creds.projectId}/query/`,
        creds.apiKey,
        host,
        {
          method: "POST",
          body: JSON.stringify({
            query: {
              kind: "HogQLQuery",
              query: `SELECT event, count() AS events, uniq(distinct_id) AS users FROM events WHERE timestamp >= now() - interval ${effectiveDays} day AND event NOT LIKE '$%' GROUP BY event ORDER BY events DESC LIMIT 200`,
            },
          }),
        }
      ).catch(() => null),
    ]);

    const pageResults = ((pageData.results || []) as unknown[][]);
    const topPages = pageResults.slice(0, 10).map((row, i) => ({
      id: String(row[0] || `page-${i}`),
      name: String(row[0] || `Page ${i + 1}`),
      count: Number(row[1]) || 0,
    }));

    const allPageNames = pageResults.map((row) => String(row[0] || ""));
    let topEvents: AnalyticsOverview["topEvents"] = [];
    let allEventNames: string[] = [];
    if (eventData) {
      const eventResults = ((eventData.results || []) as unknown[][]);
      allEventNames = eventResults.map((row) => String(row[0] || ""));
      topEvents = eventResults.slice(0, 10).map((row, i) => ({
        id: String(row[0] || `event-${i}`),
        name: String(row[0] || `Event ${i + 1}`),
        count: Number(row[1]) || 0,
      }));
    }

    return {
      provider: "posthog",
      topPages,
      topFeatures: [],
      topEvents,
      topAccounts: [],
      totalTrackedPages: pageResults.length,
      totalTrackedFeatures: 0,
      generatedAt: new Date().toISOString(),
      limitations: [
        "Feature tagging requires PostHog feature flags integration",
      ],
      allPageNames,
      allEventNames,
    };
  } catch (error) {
    console.error("Failed to load PostHog overview:", error);
    return null;
  }
}

export async function getFullPostHogAnalytics(
  overrideKey?: string,
  days?: number,
  limit = 200,
  overrideHost?: string
): Promise<FullAnalyticsResult | null> {
  const compositeKey = overrideKey || process.env.POSTHOG_API_KEY;
  if (!compositeKey) return null;
  const creds = parsePostHogKey(compositeKey);
  if (!creds) return null;
  const effectiveDays = days || 7;
  const cap = Math.min(limit, 500);
  const host = resolveHost(overrideHost);

  try {
    const [pageData, eventData] = await Promise.all([
      posthogFetch<Record<string, unknown>>(
        `/api/projects/${creds.projectId}/query/`,
        creds.apiKey, host,
        {
          method: "POST",
          body: JSON.stringify({
            query: {
              kind: "HogQLQuery",
              query: `SELECT properties.$current_url AS page, count() AS events, uniq(distinct_id) AS users FROM events WHERE timestamp >= now() - interval ${effectiveDays} day AND event = '$pageview' GROUP BY page ORDER BY events DESC LIMIT ${cap}`,
            },
          }),
        }
      ),
      posthogFetch<Record<string, unknown>>(
        `/api/projects/${creds.projectId}/query/`,
        creds.apiKey, host,
        {
          method: "POST",
          body: JSON.stringify({
            query: {
              kind: "HogQLQuery",
              query: `SELECT event, count() AS events, uniq(distinct_id) AS users FROM events WHERE timestamp >= now() - interval ${effectiveDays} day AND event NOT LIKE '$%' GROUP BY event ORDER BY events DESC LIMIT ${cap}`,
            },
          }),
        }
      ).catch(() => null),
    ]);

    const pageResults = ((pageData.results || []) as unknown[][]);
    const pages = pageResults.map((row, i) => ({
      id: String(row[0] || `page-${i}`),
      name: String(row[0] || `Page ${i + 1}`),
      count: Number(row[1]) || 0,
    }));

    let events: FullAnalyticsResult["events"] = [];
    if (eventData) {
      const eventResults = ((eventData.results || []) as unknown[][]);
      events = eventResults.map((row, i) => ({
        id: String(row[0] || `event-${i}`),
        name: String(row[0] || `Event ${i + 1}`),
        count: Number(row[1]) || 0,
      }));
    }

    return { pages, features: [], events, accounts: [] };
  } catch (error) {
    console.error("Failed to load full PostHog analytics:", error);
    return null;
  }
}

export async function getRelevantPostHogContext(
  query: string,
  relatedFeedback: FeedbackItem[],
  overrideKey?: string,
  days?: number,
  overrideHost?: string
): Promise<AnalyticsLookupContext | null> {
  const compositeKey = overrideKey || process.env.POSTHOG_API_KEY;
  if (!compositeKey) return null;
  const creds = parsePostHogKey(compositeKey);
  if (!creds) return null;
  const effectiveDays = days || 30;
  const host = resolveHost(overrideHost);

  const emails = query.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  const feedbackEmails = relatedFeedback
    .slice(0, 5)
    .map((fb) => fb.metadata?.userEmail || (/\S+@\S+/.test(fb.customer) ? fb.customer : ""))
    .filter(Boolean);

  const candidates = Array.from(new Set([...emails, ...feedbackEmails]));

  const lines: string[] = ["PostHog usage context:"];
  const sources: { type: string; id: string; title: string }[] = [];

  try {
    const q = query.toLowerCase();

    const eventBreakdown = await posthogFetch<Record<string, unknown>>(
      `/api/projects/${creds.projectId}/query/`,
      creds.apiKey, host,
      {
        method: "POST",
        body: JSON.stringify({
          query: {
            kind: "HogQLQuery",
            query: `SELECT event, count() AS events, uniq(distinct_id) AS users FROM events WHERE timestamp >= now() - interval ${effectiveDays} day AND event NOT LIKE '$%' GROUP BY event ORDER BY events DESC LIMIT 200`,
          },
        }),
      }
    ).catch(() => null);

    if (eventBreakdown) {
      const eventRows = ((eventBreakdown.results || []) as unknown[][]);
      const matchedEvents = eventRows
        .map((row) => ({ name: String(row[0] || ""), count: Number(row[1]) || 0, users: Number(row[2]) || 0 }))
        .filter((e) => e.name.length >= 3 && q.includes(e.name.toLowerCase()));

      for (const e of matchedEvents.slice(0, 5)) {
        lines.push(`Event "${e.name}": ${e.count} occurrences, ${e.users} unique users in the last ${effectiveDays} days.`);
        sources.push({ type: "posthog", id: `event:${e.name}`, title: `${e.name} (PostHog event)` });
      }
    }

    if (candidates.length > 0) {
      const userId = candidates[0];
      const data = await posthogFetch<Record<string, unknown>>(
        `/api/projects/${creds.projectId}/query/`,
        creds.apiKey, host,
        {
          method: "POST",
          body: JSON.stringify({
            query: {
              kind: "HogQLQuery",
              query: `SELECT event, timestamp, properties.$current_url AS url FROM events WHERE distinct_id = '${userId.replace(/'/g, "''")}' AND timestamp >= now() - interval ${effectiveDays} day ORDER BY timestamp DESC LIMIT 15`,
            },
          }),
        }
      );

      const results = ((data.results || []) as unknown[][]);
      lines.push(`User activity for ${userId}:`);

      if (results.length > 0) {
        lines.push(`Recent ${results.length} events:`);
        for (const row of results.slice(0, 8)) {
          const event = String(row[0] || "unknown");
          const time = String(row[1] || "");
          const url = String(row[2] || "");
          lines.push(`  - ${event} at ${time}${url ? ` on ${url}` : ""}`);
        }
      } else {
        lines.push("No recent events found.");
      }
      sources.push({ type: "posthog", id: `user:${userId}`, title: `${userId} (PostHog user)` });
    }

    if (lines.length === 1 && sources.length === 0) {
      if (/\b(trends?|overview|analytics|usage|adoption|engagement|posthog)\b/i.test(query)) {
        const overview = await getPostHogOverview(compositeKey, effectiveDays, overrideHost).catch(() => null);
        if (overview) {
          lines[0] = "PostHog product analytics overview:";
          if (overview.topPages.length > 0)
            lines.push(`Top pages: ${overview.topPages.slice(0, 5).map((p) => `${p.name} (${p.count} events)`).join(", ")}`);
          if (overview.topEvents.length > 0)
            lines.push(`Top events: ${overview.topEvents.slice(0, 5).map((e) => `${e.name} (${e.count})`).join(", ")}`);
          if (overview.topAccounts.length > 0)
            lines.push(`Top accounts by activity: ${overview.topAccounts.slice(0, 3).map((a) => a.id).join(", ")}`);
          sources.push({ type: "posthog", id: "posthog-overview", title: "PostHog analytics overview" });
        } else {
          lines.push("No matching events or users could be identified from the question.");
        }
      } else {
        lines.push("No matching events or users could be identified from the question. Ask about a specific event name or include a user email.");
      }
    }

    return { context: lines.join("\n"), sources };
  } catch (error) {
    console.error("PostHog lookup failed:", error);
    return {
      context: `PostHog lookup failed: ${error instanceof Error ? error.message : "unknown error"}`,
      sources: [],
    };
  }
}

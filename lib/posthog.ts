import { FeedbackItem, AnalyticsOverview, AnalyticsLookupContext, FullAnalyticsResult } from "./types";

const DEFAULT_HOST = "https://app.posthog.com";

function parsePostHogKey(compositeKey: string): { apiKey: string; projectId: string } | null {
  const parts = compositeKey.split(":");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { apiKey: parts[0], projectId: parts[1] };
}

function resolveHost(overrideHost?: string): string {
  const h = overrideHost || process.env.POSTHOG_HOST || DEFAULT_HOST;
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
  const effectiveDays = days || 7;
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
              query: `SELECT properties.$current_url AS page, count() AS events, uniq(distinct_id) AS users FROM events WHERE timestamp >= now() - interval ${effectiveDays} day AND event = '$pageview' GROUP BY page ORDER BY events DESC LIMIT 20`,
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
              query: `SELECT event, count() AS events, uniq(distinct_id) AS users FROM events WHERE timestamp >= now() - interval ${effectiveDays} day AND event NOT LIKE '$%' GROUP BY event ORDER BY events DESC LIMIT 10`,
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

    let topEvents: AnalyticsOverview["topEvents"] = [];
    if (eventData) {
      const eventResults = ((eventData.results || []) as unknown[][]);
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

  if (candidates.length === 0) {
    return {
      context: "PostHog lookup: no user candidate could be inferred from the question or matched feedback. Ask with an exact email or user ID.",
      sources: [],
    };
  }

  try {
    const userId = candidates[0];

    const data = await posthogFetch<Record<string, unknown>>(
      `/api/projects/${creds.projectId}/query/`,
      creds.apiKey,
      host,
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
    const lines = [`PostHog user activity for ${userId}:`];

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

    return {
      context: lines.join("\n"),
      sources: [{ type: "posthog", id: `user:${userId}`, title: `PostHog user ${userId}` }],
    };
  } catch (error) {
    console.error("PostHog lookup failed:", error);
    return {
      context: `PostHog lookup failed for ${candidates[0]}: ${error instanceof Error ? error.message : "unknown error"}`,
      sources: [],
    };
  }
}

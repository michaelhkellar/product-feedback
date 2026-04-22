import { FeedbackItem, AnalyticsOverview, AnalyticsLookupContext, FullAnalyticsResult } from "./types";

const API_BASE = "https://amplitude.com/api/2";
const EU_API_BASE = "https://analytics.eu.amplitude.com/api/2";

function getBase(key?: string): string {
  if (key && key.startsWith("eu-")) return EU_API_BASE;
  return API_BASE;
}

async function amplitudeFetch<T>(
  path: string,
  apiKey: string,
  secretKey: string,
  init?: RequestInit
): Promise<T> {
  const encoded = Buffer.from(`${apiKey}:${secretKey}`).toString("base64");
  const res = await fetch(`${getBase(apiKey)}${path}`, {
    ...init,
    headers: {
      Authorization: `Basic ${encoded}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const message = await res.text().catch(() => "");
    throw new Error(`Amplitude API ${res.status}: ${message || res.statusText}`);
  }

  return res.json() as Promise<T>;
}

function parseAmplitudeKey(compositeKey: string): { apiKey: string; secretKey: string } | null {
  const parts = compositeKey.split(":");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { apiKey: parts[0], secretKey: parts[1] };
}

export function isAmplitudeConfigured(overrideKey?: string): boolean {
  const key = overrideKey || process.env.AMPLITUDE_API_KEY;
  if (!key) return false;
  return parseAmplitudeKey(key) !== null;
}

export async function getAmplitudeOverview(
  overrideKey?: string,
  days?: number
): Promise<AnalyticsOverview | null> {
  const compositeKey = overrideKey || process.env.AMPLITUDE_API_KEY;
  if (!compositeKey) return null;
  const creds = parseAmplitudeKey(compositeKey);
  if (!creds) return null;
  const effectiveDays = days || 30;

  try {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - effectiveDays);

    const startStr = start.toISOString().split("T")[0].replace(/-/g, "");
    const endStr = end.toISOString().split("T")[0].replace(/-/g, "");

    const [activeData, eventsData] = await Promise.all([
      amplitudeFetch<Record<string, unknown>>(
        `/events/segmentation?e=${encodeURIComponent(JSON.stringify({ event_type: "_active" }))}&start=${startStr}&end=${endStr}`,
        creds.apiKey,
        creds.secretKey
      ),
      amplitudeFetch<Record<string, unknown>>(
        `/events/segmentation?e=${encodeURIComponent(JSON.stringify({ event_type: "_all" }))}&start=${startStr}&end=${endStr}&m=uniques`,
        creds.apiKey,
        creds.secretKey
      ).catch(() => null),
    ]);

    const seriesLabels = ((activeData.data as Record<string, unknown>)?.seriesLabels as string[]) || [];
    const series = ((activeData.data as Record<string, unknown>)?.series as number[][]) || [];

    const topPages = seriesLabels.slice(0, 10).map((label, i) => ({
      id: label,
      name: label,
      count: (series[i] || []).reduce((a, b) => a + b, 0),
    }));

    let topEvents: AnalyticsOverview["topEvents"] = [];
    let allEventNames: string[] = [];
    if (eventsData) {
      const eventLabels = ((eventsData.data as Record<string, unknown>)?.seriesLabels as string[]) || [];
      const eventSeries = ((eventsData.data as Record<string, unknown>)?.series as number[][]) || [];
      allEventNames = eventLabels;
      topEvents = eventLabels.map((label, i) => ({
        id: label,
        name: label,
        count: (eventSeries[i] || []).reduce((a, b) => a + b, 0),
      })).sort((a, b) => b.count - a.count).slice(0, 10);
    }

    return {
      provider: "amplitude",
      topPages,
      topFeatures: [],
      topEvents,
      topAccounts: [],
      totalTrackedPages: seriesLabels.length,
      totalTrackedFeatures: 0,
      generatedAt: new Date().toISOString(),
      limitations: [
        "Feature-level and account-level analytics require Amplitude Taxonomy add-on",
      ],
      allPageNames: seriesLabels,
      allEventNames,
    };
  } catch (error) {
    console.error("Failed to load Amplitude overview:", error);
    return null;
  }
}

export async function getFullAmplitudeAnalytics(
  overrideKey?: string,
  days?: number,
  limit = 200
): Promise<FullAnalyticsResult | null> {
  const compositeKey = overrideKey || process.env.AMPLITUDE_API_KEY;
  if (!compositeKey) return null;
  const creds = parseAmplitudeKey(compositeKey);
  if (!creds) return null;
  const effectiveDays = days || 7;
  const cap = Math.min(limit, 500);

  try {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - effectiveDays);
    const startStr = start.toISOString().split("T")[0].replace(/-/g, "");
    const endStr = end.toISOString().split("T")[0].replace(/-/g, "");

    const [activeData, eventsData] = await Promise.all([
      amplitudeFetch<Record<string, unknown>>(
        `/events/segmentation?e=${encodeURIComponent(JSON.stringify({ event_type: "_active" }))}&start=${startStr}&end=${endStr}`,
        creds.apiKey, creds.secretKey
      ),
      amplitudeFetch<Record<string, unknown>>(
        `/events/segmentation?e=${encodeURIComponent(JSON.stringify({ event_type: "_all" }))}&start=${startStr}&end=${endStr}&m=uniques`,
        creds.apiKey, creds.secretKey
      ).catch(() => null),
    ]);

    const seriesLabels = ((activeData.data as Record<string, unknown>)?.seriesLabels as string[]) || [];
    const series = ((activeData.data as Record<string, unknown>)?.series as number[][]) || [];

    const pages = seriesLabels.slice(0, cap).map((label, i) => ({
      id: label, name: label,
      count: (series[i] || []).reduce((a, b) => a + b, 0),
    }));

    let events: FullAnalyticsResult["events"] = [];
    if (eventsData) {
      const eventLabels = ((eventsData.data as Record<string, unknown>)?.seriesLabels as string[]) || [];
      const eventSeries = ((eventsData.data as Record<string, unknown>)?.series as number[][]) || [];
      events = eventLabels.map((label, i) => ({
        id: label, name: label,
        count: (eventSeries[i] || []).reduce((a, b) => a + b, 0),
      })).sort((a, b) => b.count - a.count).slice(0, cap);
    }

    return { pages, features: [], events, accounts: [] };
  } catch (error) {
    console.error("Failed to load full Amplitude analytics:", error);
    return null;
  }
}

export async function getRelevantAmplitudeContext(
  query: string,
  relatedFeedback: FeedbackItem[],
  overrideKey?: string,
  days?: number
): Promise<AnalyticsLookupContext | null> {
  const compositeKey = overrideKey || process.env.AMPLITUDE_API_KEY;
  if (!compositeKey) return null;
  const creds = parseAmplitudeKey(compositeKey);
  if (!creds) return null;
  const effectiveDays = days || 30;

  const emails = query.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  const feedbackEmails = relatedFeedback
    .slice(0, 5)
    .map((fb) => fb.metadata?.userEmail || (/\S+@\S+/.test(fb.customer) ? fb.customer : ""))
    .filter(Boolean);

  const candidates = Array.from(new Set([...emails, ...feedbackEmails]));

  const lines: string[] = ["Amplitude usage context:"];
  const sources: { type: string; id: string; title: string }[] = [];

  try {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - effectiveDays);
    const startStr = start.toISOString().split("T")[0].replace(/-/g, "");
    const endStr = end.toISOString().split("T")[0].replace(/-/g, "");

    const q = query.toLowerCase();
    const eventSegData = await amplitudeFetch<Record<string, unknown>>(
      `/events/segmentation?e=${encodeURIComponent(JSON.stringify({ event_type: "_all" }))}&start=${startStr}&end=${endStr}&m=uniques`,
      creds.apiKey, creds.secretKey
    ).catch(() => null);

    if (eventSegData) {
      const eventLabels = ((eventSegData.data as Record<string, unknown>)?.seriesLabels as string[]) || [];
      const eventSeries = ((eventSegData.data as Record<string, unknown>)?.series as number[][]) || [];
      const matchedEvents = eventLabels
        .map((label, i) => ({ name: label, count: (eventSeries[i] || []).reduce((a, b) => a + b, 0) }))
        .filter((e) => e.name.length >= 3 && q.includes(e.name.toLowerCase()));

      if (matchedEvents.length > 0) {
        for (const e of matchedEvents.slice(0, 5)) {
          lines.push(`Event "${e.name}": ${e.count} unique users in the last ${effectiveDays} days.`);
          sources.push({ type: "amplitude", id: `event:${e.name}`, title: `Amplitude event ${e.name}` });
        }
      }
    }

    if (candidates.length > 0) {
      const userId = candidates[0];
      const data = await amplitudeFetch<Record<string, unknown>>(
        `/useractivity?user=${encodeURIComponent(userId)}&start=${startStr}&end=${endStr}`,
        creds.apiKey, creds.secretKey
      );

      const events = ((data.events || []) as Record<string, unknown>[]).slice(0, 15);
      lines.push(`User activity for ${userId}:`);

      if (events.length > 0) {
        lines.push(`Recent ${events.length} events:`);
        for (const event of events.slice(0, 8)) {
          const type = (event.event_type as string) || "unknown";
          const time = (event.event_time as string) || "";
          lines.push(`  - ${type} at ${time}`);
        }
      } else {
        lines.push("No recent events found.");
      }
      sources.push({ type: "amplitude", id: `user:${userId}`, title: `Amplitude user ${userId}` });
    }

    if (lines.length === 1 && sources.length === 0) {
      if (/\b(trends?|overview|analytics|usage|adoption|engagement|amplitude)\b/i.test(query)) {
        const overview = await getAmplitudeOverview(compositeKey, effectiveDays).catch(() => null);
        if (overview) {
          lines[0] = "Amplitude product analytics overview:";
          if (overview.topEvents.length > 0)
            lines.push(`Top events: ${overview.topEvents.slice(0, 5).map((e) => `${e.name} (${e.count})`).join(", ")}`);
          if (overview.topFeatures.length > 0)
            lines.push(`Top features: ${overview.topFeatures.slice(0, 5).map((f) => `${f.name} (${f.count} events)`).join(", ")}`);
          if (overview.topAccounts.length > 0)
            lines.push(`Top accounts by activity: ${overview.topAccounts.slice(0, 3).map((a) => a.id).join(", ")}`);
          sources.push({ type: "amplitude", id: "amplitude-overview", title: "Amplitude analytics overview" });
        } else {
          lines.push("No matching events or users could be identified from the question.");
        }
      } else {
        lines.push("No matching events or users could be identified from the question. Ask about a specific event name or include a user email.");
      }
    }

    return { context: lines.join("\n"), sources };
  } catch (error) {
    console.error("Amplitude lookup failed:", error);
    return {
      context: `Amplitude lookup failed: ${error instanceof Error ? error.message : "unknown error"}`,
      sources: [],
    };
  }
}

import { FeedbackItem, AnalyticsOverview, AnalyticsLookupContext } from "./types";

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
  const effectiveDays = days || 7;

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

    const topPages = seriesLabels.slice(0, 5).map((label, i) => ({
      id: label,
      name: label,
      count: (series[i] || []).reduce((a, b) => a + b, 0),
    }));

    let topEvents: AnalyticsOverview["topEvents"] = [];
    if (eventsData) {
      const eventLabels = ((eventsData.data as Record<string, unknown>)?.seriesLabels as string[]) || [];
      const eventSeries = ((eventsData.data as Record<string, unknown>)?.series as number[][]) || [];
      topEvents = eventLabels.slice(0, 10).map((label, i) => ({
        id: label,
        name: label,
        count: (eventSeries[i] || []).reduce((a, b) => a + b, 0),
      })).sort((a, b) => b.count - a.count).slice(0, 5);
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
    };
  } catch (error) {
    console.error("Failed to load Amplitude overview:", error);
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

  if (candidates.length === 0) {
    return {
      context: "Amplitude lookup: no user candidate could be inferred from the question or matched feedback. Ask with an exact email or user ID.",
      sources: [],
    };
  }

  try {
    const userId = candidates[0];
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - effectiveDays);

    const startStr = start.toISOString().split("T")[0].replace(/-/g, "");
    const endStr = end.toISOString().split("T")[0].replace(/-/g, "");

    const data = await amplitudeFetch<Record<string, unknown>>(
      `/useractivity?user=${encodeURIComponent(userId)}&start=${startStr}&end=${endStr}`,
      creds.apiKey,
      creds.secretKey
    );

    const events = ((data.events || []) as Record<string, unknown>[]).slice(0, 10);
    const lines = [`Amplitude user activity for ${userId}:`];

    if (events.length > 0) {
      lines.push(`Recent ${events.length} events:`);
      for (const event of events.slice(0, 5)) {
        const type = (event.event_type as string) || "unknown";
        const time = (event.event_time as string) || "";
        lines.push(`  - ${type} at ${time}`);
      }
    } else {
      lines.push("No recent events found.");
    }

    return {
      context: lines.join("\n"),
      sources: [{ type: "amplitude", id: `user:${userId}`, title: `Amplitude user ${userId}` }],
    };
  } catch (error) {
    console.error("Amplitude lookup failed:", error);
    return {
      context: `Amplitude lookup failed for ${candidates[0]}: ${error instanceof Error ? error.message : "unknown error"}`,
      sources: [],
    };
  }
}

import { AgentData, getDemoData } from "./agent";
import { getFeatures, getNotes, isProductboardConfigured } from "./productboard";
import { getCalls, isAttentionConfigured } from "./attention";
import { getGrainCalls, isGrainConfigured } from "./grain";
import { getJiraIssues, getConfluencePages, isAtlassianConfigured } from "./atlassian";
import { getPendoOverview, isPendoConfigured } from "./pendo";
import { getAmplitudeOverview, isAmplitudeConfigured } from "./amplitude";
import { getPostHogOverview, isPostHogConfigured } from "./posthog";
import { getLinearIssues, isLinearConfigured } from "./linear";
import { getSliteNotes, isSliteConfigured } from "./slite";
import { AnalyticsProviderType, CallProviderType, DocProviderType } from "./api-keys";
import { AIProviderType } from "./ai-provider";
import { enrichFeedback, extractCallSignals } from "./enrichment";
import { callsToFeedback } from "./call-feedback";
import { createHash } from "crypto";
import {
  DEMO_FEEDBACK,
  DEMO_PRODUCTBOARD_FEATURES,
  DEMO_ATTENTION_CALLS,
  DEMO_INSIGHTS,
  DEMO_JIRA_ISSUES,
  DEMO_CONFLUENCE_PAGES,
  DEMO_PENDO_OVERVIEW,
  DEMO_AMPLITUDE_OVERVIEW,
} from "./demo-data";

interface CachedData {
  data: AgentData;
  timestamp: number;
  enriched: boolean;
}

const dataCache = new Map<string, CachedData>();
const CACHE_TTL_MS = 5 * 60 * 1000;
const inflightFetches = new Map<string, Promise<AgentData>>();
const bgEnrichmentInflight = new Set<string>();

/**
 * Synchronously merge call-derived feedback into AgentData.
 * Idempotent — dedupes by id, so safe to run before AND after AI extraction.
 * No-op when calls have no actionItems / keyMoments populated.
 */
function mergeCallDerivedFeedback(data: AgentData): AgentData {
  const derived = callsToFeedback(data.calls);
  if (derived.length === 0) return data;
  const seen = new Set(data.feedback.map((f) => f.id));
  const merged = [...data.feedback];
  for (const item of derived) {
    if (!seen.has(item.id)) {
      merged.push(item);
      seen.add(item.id);
    }
  }
  return { ...data, feedback: merged };
}

function kickoffBackgroundEnrichment(
  key: string,
  snapshot: CachedData,
  aiProvider: AIProviderType | undefined,
  geminiKey: string | undefined,
  anthropicKey: string | undefined,
  openaiKey: string | undefined
): void {
  if (snapshot.enriched) return;
  if (bgEnrichmentInflight.has(key)) return;
  bgEnrichmentInflight.add(key);
  console.log(`[enrichment] starting background enrichment for ${snapshot.data.feedback.length} feedback items, ${snapshot.data.calls.length} calls`);

  Promise.allSettled([
    enrichFeedback(snapshot.data.feedback, aiProvider, geminiKey, anthropicKey, openaiKey),
    extractCallSignals(snapshot.data.calls, aiProvider, geminiKey, anthropicKey, openaiKey),
  ])
    .then(([feedbackRes, callsRes]) => {
      const enrichedFeedback = feedbackRes.status === "fulfilled" ? feedbackRes.value : snapshot.data.feedback;
      const enrichedCalls = callsRes.status === "fulfilled" ? callsRes.value : snapshot.data.calls;
      if (feedbackRes.status === "rejected") console.warn("[enrichment] feedback pass failed:", feedbackRes.reason);
      if (callsRes.status === "rejected") console.warn("[enrichment] call signals pass failed:", callsRes.reason);

      const current = dataCache.get(key);
      if (current && current.timestamp === snapshot.timestamp) {
        const merged = mergeCallDerivedFeedback({
          ...current.data,
          feedback: enrichedFeedback,
          calls: enrichedCalls,
        });
        dataCache.set(key, {
          data: merged,
          timestamp: current.timestamp,
          enriched: true,
        });
        const fromCalls = merged.feedback.length - enrichedFeedback.length;
        console.log(`[enrichment] background enrichment complete (${merged.feedback.length} feedback total, +${fromCalls} from calls)`);
      }
    })
    .catch((err) => console.warn(`[enrichment] background enrichment failed:`, err))
    .finally(() => bgEnrichmentInflight.delete(key));
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function cacheKey(
  pbKey: string | undefined,
  attKey: string | undefined,
  pendoKey: string | undefined,
  atlDomain: string | undefined,
  demo: boolean,
  atlJiraFilter?: string,
  atlConfluenceFilter?: string,
  amplitudeKey?: string,
  analyticsProvider?: string,
  posthogKey?: string,
  analyticsDays?: number,
  posthogHost?: string,
  aiProvider?: string,
  grainKey?: string,
  callProvider?: string,
  sliteKey?: string,
  docProvider?: string
): string {
  const parts = [
    pbKey ? `pb:${shortHash(pbKey)}` : "",
    attKey ? `att:${shortHash(attKey)}` : "",
    pendoKey ? `pendo:${shortHash(pendoKey)}` : "",
    amplitudeKey ? `amp:${shortHash(amplitudeKey)}` : "",
    posthogKey ? `ph:${shortHash(posthogKey)}` : "",
    posthogHost ? `phhost:${shortHash(posthogHost)}` : "",
    atlDomain ? `atl:${shortHash(atlDomain)}` : "",
    `demo:${demo}`,
    `ap:${analyticsProvider || "pendo"}`,
    analyticsDays ? `days:${analyticsDays}` : "",
    `ai:${aiProvider || "gemini"}`,
    grainKey ? `grain:${shortHash(grainKey)}` : "",
    `cp:${callProvider || "attention"}`,
    sliteKey ? `slite:${shortHash(sliteKey)}` : "",
    `dp:${docProvider || "atlassian"}`,
    atlJiraFilter || "",
    atlConfluenceFilter || "",
  ];
  return parts.join("|");
}

async function fetchLiveData(
  pbKey: string | undefined,
  attKey: string | undefined,
  pendoKey: string | undefined,
  atlDomain: string | undefined,
  atlEmail: string | undefined,
  atlToken: string | undefined,
  useDemoFallback: boolean,
  atlJiraFilter?: string,
  atlConfluenceFilter?: string,
  analyticsProvider?: AnalyticsProviderType,
  amplitudeKey?: string,
  posthogKey?: string,
  analyticsDays?: number,
  posthogHost?: string,
  linearKey?: string,
  linearTeamId?: string,
  grainKey?: string,
  callProvider?: CallProviderType,
  sliteKey?: string,
  docProvider?: DocProviderType
): Promise<AgentData> {
  const feedback = [...(useDemoFallback ? DEMO_FEEDBACK : [])];
  let features = useDemoFallback ? [...DEMO_PRODUCTBOARD_FEATURES] : [];
  let calls = useDemoFallback ? [...DEMO_ATTENTION_CALLS] : [];
  const insights = useDemoFallback ? [...DEMO_INSIGHTS] : [];
  let jiraIssues: AgentData["jiraIssues"] = useDemoFallback ? [...DEMO_JIRA_ISSUES] : [];
  const effectiveDocProvider = docProvider || "atlassian";
  let confluencePages: AgentData["confluencePages"] = (useDemoFallback && effectiveDocProvider === "atlassian") ? [...DEMO_CONFLUENCE_PAGES] : [];
  let linearIssues: AgentData["linearIssues"] = [];
  let analyticsOverview: AgentData["analyticsOverview"] = null;

  const fetches: Promise<void>[] = [];

  if (isProductboardConfigured(pbKey)) {
    fetches.push(
      (async () => {
        const [featResult, notesResult] = await Promise.all([
          getFeatures(pbKey, false),
          getNotes(pbKey, false, 1000),
        ]);
        if (!featResult.isDemo && featResult.data.length > 0) features = featResult.data;
        if (!notesResult.isDemo && notesResult.data.length > 0) {
          for (const note of notesResult.data) {
            if (!feedback.some((f) => f.id === note.id)) feedback.push(note);
          }
        }
      })()
    );
  }

  const effectiveCallProvider = callProvider || "attention";
  if (effectiveCallProvider === "grain" && isGrainConfigured(grainKey)) {
    fetches.push(
      (async () => {
        const callResult = await getGrainCalls(grainKey, false);
        if (!callResult.isDemo && callResult.data.length > 0) calls = callResult.data;
      })()
    );
  } else if (isAttentionConfigured(attKey)) {
    fetches.push(
      (async () => {
        const callResult = await getCalls(attKey, false);
        if (!callResult.isDemo && callResult.data.length > 0) calls = callResult.data;
      })()
    );
  }

  const effectiveAnalyticsProvider = analyticsProvider || "pendo";
  // Seed demo analytics based on the selected analytics provider
  if (useDemoFallback) {
    analyticsOverview = effectiveAnalyticsProvider === "amplitude" ? DEMO_AMPLITUDE_OVERVIEW : DEMO_PENDO_OVERVIEW;
  }
  if (effectiveAnalyticsProvider === "posthog" && isPostHogConfigured(posthogKey)) {
    fetches.push(
      (async () => {
        const overview = await getPostHogOverview(posthogKey, analyticsDays, posthogHost);
        if (overview) analyticsOverview = overview;
      })()
    );
  } else if (effectiveAnalyticsProvider === "amplitude" && isAmplitudeConfigured(amplitudeKey)) {
    fetches.push(
      (async () => {
        const overview = await getAmplitudeOverview(amplitudeKey, analyticsDays);
        if (overview) analyticsOverview = overview;
      })()
    );
  } else if (isPendoConfigured(pendoKey)) {
    fetches.push(
      (async () => {
        const overview = await getPendoOverview(pendoKey, analyticsDays);
        if (overview) analyticsOverview = overview;
      })()
    );
  }

  if (isAtlassianConfigured(atlDomain, atlEmail, atlToken)) {
    fetches.push(
      (async () => {
        const fetchConf = effectiveDocProvider === "atlassian"
          ? getConfluencePages(atlDomain, atlEmail, atlToken, atlConfluenceFilter)
          : Promise.resolve({ data: [] as AgentData["confluencePages"] });
        const [jiraResult, confResult] = await Promise.all([
          getJiraIssues(atlDomain, atlEmail, atlToken, atlJiraFilter),
          fetchConf,
        ]);
        if (jiraResult.data.length > 0) jiraIssues = jiraResult.data;
        if (confResult.data.length > 0) confluencePages = confResult.data;
      })()
    );
  }

  if (isLinearConfigured(linearKey)) {
    fetches.push(
      (async () => {
        const result = await getLinearIssues(linearKey, linearTeamId, useDemoFallback);
        if (result.data.length > 0) linearIssues = result.data;
      })()
    );
  }

  if (effectiveDocProvider === "slite") {
    fetches.push(
      (async () => {
        const result = await getSliteNotes(sliteKey, useDemoFallback);
        if (result.data.length > 0) {
          confluencePages = result.data.map((n) => ({
            id: n.id,
            title: n.title,
            excerpt: n.excerpt,
            space: "Slite",
            lastModified: n.lastModified,
            author: n.author,
            url: n.url,
          }));
        }
      })()
    );
  }

  if (fetches.length > 0) {
    const results = await Promise.allSettled(fetches);
    results.forEach((result, i) => {
      if (result.status === "rejected") {
        console.warn(`Data fetch ${i} failed:`, result.reason);
      }
    });
  }

  return { feedback, features, calls, insights, jiraIssues, confluencePages, linearIssues, analyticsOverview };
}

export async function getData(
  pbKey: string | undefined,
  attKey: string | undefined,
  pendoKey: string | undefined,
  useDemoData: boolean,
  atlDomain?: string,
  atlEmail?: string,
  atlToken?: string,
  atlJiraFilter?: string,
  atlConfluenceFilter?: string,
  analyticsProvider?: AnalyticsProviderType,
  amplitudeKey?: string,
  posthogKey?: string,
  analyticsDays?: number,
  posthogHost?: string,
  linearKey?: string,
  linearTeamId?: string,
  aiProvider?: AIProviderType,
  geminiKey?: string,
  anthropicKey?: string,
  openaiKey?: string,
  grainKey?: string,
  callProvider?: CallProviderType,
  sliteKey?: string,
  docProvider?: DocProviderType
): Promise<AgentData> {
  const hasPb = isProductboardConfigured(pbKey);
  const hasAtt = isAttentionConfigured(attKey);
  const hasGrain = isGrainConfigured(grainKey);
  const hasPendo = isPendoConfigured(pendoKey);
  const hasAmplitude = isAmplitudeConfigured(amplitudeKey);
  const hasPostHog = isPostHogConfigured(posthogKey);
  const hasAtl = isAtlassianConfigured(atlDomain, atlEmail, atlToken);
  const hasLinear = isLinearConfigured(linearKey);
  const hasSlite = isSliteConfigured(sliteKey);
  const hasAnyLiveKey = hasPb || hasAtt || hasGrain || hasPendo || hasAmplitude || hasPostHog || hasAtl || hasLinear || hasSlite;

  if (!hasAnyLiveKey && useDemoData) return mergeCallDerivedFeedback(getDemoData());
  if (!hasAnyLiveKey && !useDemoData) {
    return { feedback: [], features: [], calls: [], insights: [], jiraIssues: [], confluencePages: [], linearIssues: [], analyticsOverview: null };
  }

  const key = cacheKey(pbKey, attKey, pendoKey, atlDomain, useDemoData, atlJiraFilter, atlConfluenceFilter, amplitudeKey, analyticsProvider, posthogKey, analyticsDays, posthogHost, aiProvider, grainKey, callProvider, sliteKey, docProvider);
  const cached = dataCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    // Warm the enrichment cache in background if this entry was served raw.
    kickoffBackgroundEnrichment(key, cached, aiProvider, geminiKey, anthropicKey, openaiKey);
    return cached.data;
  }

  const inflight = inflightFetches.get(key);
  if (inflight) return inflight;

  const fetchPromise = (async (): Promise<AgentData> => {
    try {
      const fetched = await fetchLiveData(pbKey, attKey, pendoKey, atlDomain, atlEmail, atlToken, useDemoData, atlJiraFilter, atlConfluenceFilter, analyticsProvider, amplitudeKey, posthogKey, analyticsDays, posthogHost, linearKey, linearTeamId, grainKey, callProvider, sliteKey, docProvider);
      // Merge any call-derived feedback synchronously (handles the demo case where calls already
      // have signals; for live data this is a no-op until AI extraction runs in the background).
      const raw = mergeCallDerivedFeedback(fetched);

      const total = raw.feedback.length + raw.features.length + raw.calls.length + raw.insights.length + raw.jiraIssues.length + raw.confluencePages.length + raw.linearIssues.length;
      console.log(`Data loaded: ${total} items (${raw.feedback.length} feedback, ${raw.features.length} features, ${raw.calls.length} calls, ${raw.jiraIssues.length} jira, ${raw.linearIssues.length} linear, ${raw.confluencePages.length} confluence, ${raw.insights.length} insights${raw.analyticsOverview ? ", analytics overview" : ""})`);

      // Store raw data immediately and return it — enrichment runs in background.
      const snapshot: CachedData = { data: raw, timestamp: Date.now(), enriched: useDemoData };
      dataCache.set(key, snapshot);

      if (!useDemoData && raw.feedback.length > 0) {
        kickoffBackgroundEnrichment(key, snapshot, aiProvider, geminiKey, anthropicKey, openaiKey);
      }

      return raw;
    } finally {
      inflightFetches.delete(key);
    }
  })();

  inflightFetches.set(key, fetchPromise);
  return fetchPromise;
}

export function invalidateCache(): void {
  dataCache.clear();
}

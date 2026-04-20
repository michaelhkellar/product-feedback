import { AgentData, getDemoData } from "./agent";
import { getFeatures, getNotes, isProductboardConfigured } from "./productboard";
import { getCalls, isAttentionConfigured } from "./attention";
import { getJiraIssues, getConfluencePages, isAtlassianConfigured } from "./atlassian";
import { getPendoOverview, isPendoConfigured } from "./pendo";
import { getAmplitudeOverview, isAmplitudeConfigured } from "./amplitude";
import { getPostHogOverview, isPostHogConfigured } from "./posthog";
import { getLinearIssues, isLinearConfigured } from "./linear";
import { AnalyticsProviderType } from "./api-keys";
import { AIProviderType } from "./ai-provider";
import { enrichFeedback } from "./enrichment";
import { createHash } from "crypto";
import {
  DEMO_FEEDBACK,
  DEMO_PRODUCTBOARD_FEATURES,
  DEMO_ATTENTION_CALLS,
  DEMO_INSIGHTS,
  DEMO_JIRA_ISSUES,
  DEMO_CONFLUENCE_PAGES,
  DEMO_PENDO_OVERVIEW,
} from "./demo-data";

interface CachedData {
  data: AgentData;
  timestamp: number;
}

const dataCache = new Map<string, CachedData>();
const CACHE_TTL_MS = 5 * 60 * 1000;

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
  posthogHost?: string
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
  linearTeamId?: string
): Promise<AgentData> {
  const feedback = [...(useDemoFallback ? DEMO_FEEDBACK : [])];
  let features = useDemoFallback ? [...DEMO_PRODUCTBOARD_FEATURES] : [];
  let calls = useDemoFallback ? [...DEMO_ATTENTION_CALLS] : [];
  const insights = useDemoFallback ? [...DEMO_INSIGHTS] : [];
  let jiraIssues: AgentData["jiraIssues"] = useDemoFallback ? [...DEMO_JIRA_ISSUES] : [];
  let confluencePages: AgentData["confluencePages"] = useDemoFallback ? [...DEMO_CONFLUENCE_PAGES] : [];
  let linearIssues: AgentData["linearIssues"] = [];
  let analyticsOverview: AgentData["analyticsOverview"] = useDemoFallback ? DEMO_PENDO_OVERVIEW : null;

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

  if (isAttentionConfigured(attKey)) {
    fetches.push(
      (async () => {
        const callResult = await getCalls(attKey, false);
        if (!callResult.isDemo && callResult.data.length > 0) calls = callResult.data;
      })()
    );
  }

  const effectiveAnalyticsProvider = analyticsProvider || "pendo";
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
        const [jiraResult, confResult] = await Promise.all([
          getJiraIssues(atlDomain, atlEmail, atlToken, atlJiraFilter),
          getConfluencePages(atlDomain, atlEmail, atlToken, atlConfluenceFilter),
        ]);
        if (jiraResult.data.length > 0) jiraIssues = jiraResult.data;
        if (confResult.data.length > 0) confluencePages = confResult.data;
      })()
    );
  }

  if (isLinearConfigured(linearKey)) {
    fetches.push(
      (async () => {
        const issues = await getLinearIssues(linearKey, linearTeamId);
        if (issues.length > 0) linearIssues = issues;
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
  openaiKey?: string
): Promise<AgentData> {
  const hasPb = isProductboardConfigured(pbKey);
  const hasAtt = isAttentionConfigured(attKey);
  const hasPendo = isPendoConfigured(pendoKey);
  const hasAmplitude = isAmplitudeConfigured(amplitudeKey);
  const hasPostHog = isPostHogConfigured(posthogKey);
  const hasAtl = isAtlassianConfigured(atlDomain, atlEmail, atlToken);
  const hasLinear = isLinearConfigured(linearKey);
  const hasAnyLiveKey = hasPb || hasAtt || hasPendo || hasAmplitude || hasPostHog || hasAtl || hasLinear;

  if (!hasAnyLiveKey && useDemoData) return getDemoData();
  if (!hasAnyLiveKey && !useDemoData) {
    return { feedback: [], features: [], calls: [], insights: [], jiraIssues: [], confluencePages: [], linearIssues: [], analyticsOverview: null };
  }

  const key = cacheKey(pbKey, attKey, pendoKey, atlDomain, useDemoData, atlJiraFilter, atlConfluenceFilter, amplitudeKey, analyticsProvider, posthogKey, analyticsDays, posthogHost);
  const cached = dataCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) return cached.data;

  const raw = await fetchLiveData(pbKey, attKey, pendoKey, atlDomain, atlEmail, atlToken, useDemoData, atlJiraFilter, atlConfluenceFilter, analyticsProvider, amplitudeKey, posthogKey, analyticsDays, posthogHost, linearKey, linearTeamId);

  // AI-powered sentiment and theme enrichment (skipped for demo data)
  const enrichedFeedback = (!useDemoData && raw.feedback.length > 0)
    ? await enrichFeedback(raw.feedback, aiProvider, geminiKey, anthropicKey, openaiKey).catch(() => raw.feedback)
    : raw.feedback;
  const data: AgentData = { ...raw, feedback: enrichedFeedback };

  dataCache.set(key, { data, timestamp: Date.now() });

  const total = data.feedback.length + data.features.length + data.calls.length + data.insights.length + data.jiraIssues.length + data.confluencePages.length + data.linearIssues.length;
  console.log(`Data loaded: ${total} items (${data.feedback.length} feedback, ${data.features.length} features, ${data.calls.length} calls, ${data.jiraIssues.length} jira, ${data.linearIssues.length} linear, ${data.confluencePages.length} confluence, ${data.insights.length} insights${data.analyticsOverview ? ", analytics overview" : ""})`);

  return data;
}

export function invalidateCache(): void {
  dataCache.clear();
}

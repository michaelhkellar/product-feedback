import { InMemoryVectorStore } from "./vector-store";
import { getAIProvider, isAnyAIConfigured, resolveAIKey, AIProviderType } from "./ai-provider";
import { getRelevantPendoContext, getFullPendoAnalytics } from "./pendo";
import { getRelevantAmplitudeContext, getFullAmplitudeAnalytics } from "./amplitude";
import { getRelevantPostHogContext, getFullPostHogAnalytics } from "./posthog";
import {
  DEMO_FEEDBACK, DEMO_PRODUCTBOARD_FEATURES, DEMO_ATTENTION_CALLS, DEMO_INSIGHTS,
  DEMO_JIRA_ISSUES, DEMO_CONFLUENCE_PAGES, DEMO_PENDO_OVERVIEW,
} from "./demo-data";
import {
  FeedbackItem, ProductboardFeature, AttentionCall, Insight, JiraIssue, ConfluencePage,
  AnalyticsOverview, FullAnalyticsResult, LinearIssue,
} from "./types";
import { ContextMode } from "./api-keys";

export type InteractionMode = "summarize" | "prd" | "ticket";

export interface AgentKeys {
  geminiKey?: string;
  productboardKey?: string;
  attentionKey?: string;
  pendoKey?: string;
  atlassianDomain?: string;
  atlassianEmail?: string;
  atlassianToken?: string;
  aiProvider?: AIProviderType;
  aiModel?: string;
  anthropicKey?: string;
  openaiKey?: string;
  analyticsProvider?: string;
  amplitudeKey?: string;
  posthogKey?: string;
  posthogHost?: string;
  linearKey?: string;
  linearTeamId?: string;
}

export interface AgentData {
  feedback: FeedbackItem[];
  features: ProductboardFeature[];
  calls: AttentionCall[];
  insights: Insight[];
  jiraIssues: JiraIssue[];
  confluencePages: ConfluencePage[];
  linearIssues: LinearIssue[];
  analyticsOverview: AnalyticsOverview | null;
}

export interface ChatTrace {
  detectedIntent: "summarize" | "prd" | "ticket";
  queryType: "detailed" | "conversational" | "comparison" | "count" | "list";
  timeRange?: { label: string; start?: string; end?: string };
  themesDetected: string[];
  retrieval: { query: string; topResults: { id: string; type: string; score: number }[] };
  contextMode: "focused" | "standard" | "deep";
  tokensUsed: { input: number; output: number; total: number };
  pivotExcluded?: string[];
}

export interface ChatResult {
  response: string;
  sources: { type: string; id: string; title: string; url?: string }[];
  tokenEstimate: { input: number; output: number; total: number };
  trace?: ChatTrace;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

let cachedStore: { fingerprint: string; store: InMemoryVectorStore } | null = null;

function dataFingerprint(data: AgentData): string {
  return `${data.feedback.length}:${data.features.length}:${data.calls.length}:${data.insights.length}:${data.jiraIssues.length}:${data.confluencePages.length}:${data.linearIssues.length}:${data.feedback[0]?.id || ""}:${data.feedback[data.feedback.length - 1]?.id || ""}:${data.jiraIssues[0]?.id || ""}`;
}

function buildStore(data: AgentData): InMemoryVectorStore {
  const fp = dataFingerprint(data);
  if (cachedStore && cachedStore.fingerprint === fp) return cachedStore.store;

  const store = new InMemoryVectorStore();
  if (data.feedback.length) store.addFeedback(data.feedback);
  if (data.features.length) store.addFeatures(data.features);
  if (data.calls.length) store.addCalls(data.calls);
  if (data.insights.length) store.addInsights(data.insights);
  if (data.jiraIssues.length) store.addJiraIssues(data.jiraIssues);
  if (data.linearIssues.length) store.addLinearIssues(data.linearIssues);
  if (data.confluencePages.length) store.addConfluencePages(data.confluencePages);
  store.buildIndex();
  cachedStore = { fingerprint: fp, store };
  return store;
}

export function getDemoData(): AgentData {
  return {
    feedback: DEMO_FEEDBACK, features: DEMO_PRODUCTBOARD_FEATURES,
    calls: DEMO_ATTENTION_CALLS, insights: DEMO_INSIGHTS,
    jiraIssues: DEMO_JIRA_ISSUES, confluencePages: DEMO_CONFLUENCE_PAGES,
    linearIssues: [],
    analyticsOverview: DEMO_PENDO_OVERVIEW,
  };
}

const DETAIL_KEYWORDS = ["specific", "details", "feedback", "tickets", "what are we seeing", "what are customers saying", "show me", "list", "quotes", "verbatim", "exact"];

function wantsDetail(query: string): boolean {
  const q = query.toLowerCase();
  return DETAIL_KEYWORDS.some((kw) => q.includes(kw));
}

function atlassianIssueUrl(issueKey: string, keys: AgentKeys): string | undefined {
  const domain = keys.atlassianDomain || process.env.ATLASSIAN_DOMAIN || "";
  if (!domain) return undefined;
  return `https://${domain.replace(/\.atlassian\.net\/?$/, "")}.atlassian.net/browse/${issueKey}`;
}

function looksLikeOpaqueId(value: string): boolean {
  const v = value.trim();
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v) ||
    /^productboard\s+note\s*-\s*[0-9a-f-]{20,}$/i.test(v)
  );
}

function snippetFromContent(content: string, max = 80): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (!normalized) return "Untitled note";
  const firstSentence = normalized.split(/[.!?]/)[0]?.trim() || normalized;
  return firstSentence.length > max ? `${firstSentence.slice(0, max - 1)}…` : firstSentence;
}

function cleanFeedbackTitle(fb: FeedbackItem): string {
  const raw = (fb.title || "").replace(/\s+/g, " ").trim();
  if (!raw || looksLikeOpaqueId(raw)) return snippetFromContent(fb.content);
  return raw;
}

function feedbackContactRef(fb: FeedbackItem): string {
  const explicitEmail = fb.metadata?.userEmail || "";
  const customerLooksLikeEmail = /\S+@\S+/.test(fb.customer) ? fb.customer : "";
  const email = explicitEmail || customerLooksLikeEmail;
  const name = fb.customer && fb.customer !== email ? fb.customer : "";
  if (name && email) return `${name} <${email}>`;
  if (email) return email;
  if (name) return name;
  if (fb.company) return fb.company;
  return "";
}

function feedbackSourceRef(fb: FeedbackItem): string {
  const title = cleanFeedbackTitle(fb);
  const url = fb.metadata?.sourceUrl;
  if (fb.source === "productboard") {
    return url ? `Productboard note "${title}" (link: ${url})` : `Productboard note "${title}"`;
  }
  return fb.source;
}

function lookupDetails(ids: string[], data: AgentData, detailed = false, keys: AgentKeys = {}): string[] {
  const contentLen = detailed ? 500 : 200;
  const descLen = detailed ? 400 : 0;
  const details: string[] = [];
  for (const id of ids) {
    const fb = data.feedback.find((f) => f.id === id);
    if (fb) {
      const w = shortDate(fb as unknown as Record<string, unknown>);
      const contact = feedbackContactRef(fb);
      details.push(`[Source: ${feedbackSourceRef(fb)}, ${w}] "${cleanFeedbackTitle(fb)}" — customer: ${contact || "unknown"}${fb.company ? ` @ ${fb.company}` : ""}: "${fb.content.slice(0, contentLen)}"`);
      continue;
    }
    const feat = data.features.find((f) => f.id === id);
    if (feat) {
      const desc = detailed && feat.description ? `: ${feat.description.slice(0, descLen)}` : "";
      details.push(`[Source: productboard feature] "${feat.name}" — ${feat.status}, ${feat.votes} votes${desc}`);
      continue;
    }
    const call = data.calls.find((c) => c.id === id);
    if (call) {
      details.push(`[Call, ${call.date}] ${call.title} — ${call.summary.slice(0, contentLen)}`);
      continue;
    }
    const insight = data.insights.find((i) => i.id === id);
    if (insight) { details.push(`[Insight] ${insight.title} — ${insight.description.slice(0, contentLen)}`); continue; }
    const jira = data.jiraIssues.find((j) => j.id === id);
    if (jira) {
      const w = shortDate(jira as unknown as Record<string, unknown>);
      const link = atlassianIssueUrl(jira.key, keys);
      const desc = detailed && jira.description ? `\n  Description: "${jira.description.slice(0, descLen)}"` : "";
      details.push(`[Jira ${jira.key}${link ? ` (${link})` : ""}, ${w}] ${jira.summary} — ${jira.status}/${jira.priority}, assigned: ${jira.assignee}${desc}`);
      continue;
    }
    const linear = data.linearIssues.find((l) => l.id === id);
    if (linear) {
      const w = shortDate(linear as unknown as Record<string, unknown>);
      const desc = detailed && linear.description ? `\n  Description: "${linear.description.slice(0, descLen)}"` : "";
      details.push(`[Linear ${linear.identifier}, ${w}] ${linear.title} — ${linear.status}/${linear.priority}, assigned: ${linear.assignee}${desc}`);
      continue;
    }
    const page = data.confluencePages.find((p) => p.id === id);
    if (page) {
      const excerpt = detailed && page.excerpt ? `: ${page.excerpt.slice(0, descLen)}` : "";
      details.push(`[Confluence] ${page.title} — ${page.space}${excerpt}`);
    }
  }
  return details;
}

const SYSTEM_PROMPT = `You are a concise product intelligence analyst. Synthesize data into brief, actionable insights. Focus on recent changes unless the user asks for historical totals/counts. Be opinionated. Include direct customer quotes when available.

DATA SOURCE RULES:
- Productboard notes/features = CUSTOMER FEEDBACK. This is the primary voice-of-customer source. Prioritize this.
- Jira CX tickets (CX- prefix) = CUSTOMER SUCCESS issues. These reflect real customer problems. Prioritize these alongside Productboard.
- Jira ENG tickets (ENG- prefix) = ENGINEERING/internal work. These are implementation details, not customer feedback. Reference only when the user asks about engineering status or what's being built.
- Linear issues = ENGINEERING/PROJECT WORK from Linear. Treat like Jira engineering tickets — reference when the user asks about engineering status, sprints, or what's being worked on.
- Confluence pages = INTERNAL DOCUMENTATION. Only reference when the user specifically asks about docs, guides, or internal processes. Don't include in general feedback summaries.
- Product analytics (Pendo/Amplitude/PostHog) = PRODUCT USAGE ANALYTICS. Use it to explain what users/accounts are doing in the product or how engaged they appear, but don't treat usage alone as proof of customer intent.
- Feedback arrives in Productboard through pipelines (Zapier, email, CRM). Zapier/email is the delivery mechanism, NOT the subject. Read the actual TITLE and CONTENT to understand what the customer wants.
- Source is shown in brackets like [Source: productboard] or [Jira CX-1234]. A note titled "Integration Request (Salesforce)" = customer wants Salesforce integration, NOT feedback about Salesforce as a tool.
- Prefer source citations that are directly actionable: Jira key/link, Productboard note link, and customer name/email from the note.
- If the user asks for a number/count/how many, prioritize numeric accuracy over recency and compute from matching items in the provided context.`;

const BROAD_KEYWORDS = ["summary", "overview", "brief", "executive", "all", "comprehensive", "status", "what's happening", "state of", "pulse", "report"];
const CONFLUENCE_KEYWORDS = ["confluence", "docs", "documentation", "guide", "wiki", "internal doc", "runbook", "playbook", "process"];
const ENG_KEYWORDS = ["engineering", "eng ticket", "eng-", "development", "sprint", "what's being built", "implementation", "technical"];
const COUNT_KEYWORDS = ["how many", "number of", "count", "total", "how much"];
const FOLLOW_UP_KEYWORDS = ["both", "either", "them", "those", "that", "these", "it", "same", "else", "besides", "otherwise", "anything else", "something else", "what other", "other accounts", "other themes"];
const LIST_KEYWORDS = [
  "show me", "list", "show the", "give me",
  "recent feedback", "top accounts", "top themes", "top issues", "top requests",
  "what are the", "which accounts", "which customers", "which companies", "which features",
  "what feedback", "what requests", "feedback from", "feedback about", "any feedback", "any requests",
  "who's", "who is", "what's happening with", "tell me about", "anything about", "what about",
  "details on", "breakdown", "any churn", "any risks", "customers asking", "accounts asking", "tickets related",
];
const PLURAL_ITEM_NOUNS = ["accounts", "customers", "tickets", "issues", "items", "feedback", "requests", "themes", "companies", "notes", "complaints", "feature requests"];
const INSIGHT_DRILLDOWN_KEYWORDS = ["tell me more about", "tell me more", "deep dive", "drill down", "more detail", "more context"];
const USAGE_KEYWORDS = ["pendo", "usage", "activity", "history", "adoption", "behavior", "journey", "what are they doing", "what is this user doing", "what's this user doing", "engagement", "visited", "using the product", "how is", "how often", "who uses", "how many users", "usage of", "clicked", "feature usage", "page usage"];

// --- Time range extraction ---

interface TimeRange {
  start: Date;
  end: Date;
  label: string;
  compare?: { start: Date; end: Date; label: string };
}

export function extractTimeRange(message: string): TimeRange | null {
  const q = message.toLowerCase();
  const now = new Date();

  const compareParts = q.match(/(.+?)\s+(?:vs\.?|versus|compared?\s+to|against)\s+(.+)/i);
  if (compareParts) {
    const a = parseSingleTimeRange(compareParts[1].trim(), now);
    const b = parseSingleTimeRange(compareParts[2].trim(), now);
    if (a && b) return { ...a, compare: b };
  }

  return parseSingleTimeRange(q, now);
}

function parseSingleTimeRange(text: string, now: Date): TimeRange | null {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (/\byesterday\b/.test(text)) {
    const start = new Date(today); start.setDate(start.getDate() - 1);
    return { start, end: today, label: "yesterday" };
  }
  if (/\btoday\b/.test(text)) {
    return { start: today, end: now, label: "today" };
  }
  if (/\bthis\s+week\b/.test(text)) {
    const start = new Date(today); start.setDate(start.getDate() - start.getDay());
    return { start, end: now, label: "this week" };
  }
  if (/\bthis\s+month\b/.test(text)) {
    return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: now, label: "this month" };
  }
  if (/\bthis\s+quarter\b/.test(text)) {
    const qMonth = Math.floor(now.getMonth() / 3) * 3;
    return { start: new Date(now.getFullYear(), qMonth, 1), end: now, label: "this quarter" };
  }
  if (/\bytd\b|\byear\s+to\s+date\b/.test(text)) {
    return { start: new Date(now.getFullYear(), 0, 1), end: now, label: "YTD" };
  }

  const lastN = text.match(/(?:last|past)\s+(\d+)\s+(day|week|month|quarter)s?/);
  if (lastN) {
    const n = parseInt(lastN[1], 10);
    const unit = lastN[2];
    const start = new Date(today);
    if (unit === "day") start.setDate(start.getDate() - n);
    else if (unit === "week") start.setDate(start.getDate() - n * 7);
    else if (unit === "month") start.setMonth(start.getMonth() - n);
    else if (unit === "quarter") start.setMonth(start.getMonth() - n * 3);
    return { start, end: now, label: `last ${n} ${unit}${n > 1 ? "s" : ""}` };
  }

  if (/\blast\s+week\b/.test(text)) {
    const end = new Date(today); end.setDate(end.getDate() - end.getDay());
    const start = new Date(end); start.setDate(start.getDate() - 7);
    return { start, end, label: "last week" };
  }
  if (/\blast\s+month\b/.test(text)) {
    const end = new Date(now.getFullYear(), now.getMonth(), 1);
    const start = new Date(end); start.setMonth(start.getMonth() - 1);
    return { start, end, label: "last month" };
  }
  if (/\blast\s+quarter\b/.test(text)) {
    const qMonth = Math.floor(now.getMonth() / 3) * 3;
    const end = new Date(now.getFullYear(), qMonth, 1);
    const start = new Date(end); start.setMonth(start.getMonth() - 3);
    return { start, end, label: "last quarter" };
  }

  const monthNames = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const monthAbbrevs = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

  const rangeMatch = text.match(new RegExp(`(${monthNames.join("|")}|${monthAbbrevs.join("|")})\\s+(?:to|through|-)\\s+(${monthNames.join("|")}|${monthAbbrevs.join("|")})`, "i"));
  if (rangeMatch) {
    const startIdx = monthNames.indexOf(rangeMatch[1].toLowerCase()) !== -1 ? monthNames.indexOf(rangeMatch[1].toLowerCase()) : monthAbbrevs.indexOf(rangeMatch[1].toLowerCase());
    const endIdx = monthNames.indexOf(rangeMatch[2].toLowerCase()) !== -1 ? monthNames.indexOf(rangeMatch[2].toLowerCase()) : monthAbbrevs.indexOf(rangeMatch[2].toLowerCase());
    if (startIdx >= 0 && endIdx >= 0) {
      const start = new Date(now.getFullYear(), startIdx, 1);
      const end = new Date(now.getFullYear(), endIdx + 1, 0, 23, 59, 59);
      return { start, end, label: `${monthNames[startIdx]} to ${monthNames[endIdx]}` };
    }
  }

  const inMonth = text.match(new RegExp(`(?:in|during|for)\\s+(${monthNames.join("|")}|${monthAbbrevs.join("|")})`, "i"));
  if (inMonth) {
    const idx = monthNames.indexOf(inMonth[1].toLowerCase()) !== -1 ? monthNames.indexOf(inMonth[1].toLowerCase()) : monthAbbrevs.indexOf(inMonth[1].toLowerCase());
    if (idx >= 0) {
      const year = idx > now.getMonth() ? now.getFullYear() - 1 : now.getFullYear();
      return { start: new Date(year, idx, 1), end: new Date(year, idx + 1, 0, 23, 59, 59), label: monthNames[idx] };
    }
  }

  const sinceMonth = text.match(new RegExp(`since\\s+(${monthNames.join("|")}|${monthAbbrevs.join("|")})`, "i"));
  if (sinceMonth) {
    const idx = monthNames.indexOf(sinceMonth[1].toLowerCase()) !== -1 ? monthNames.indexOf(sinceMonth[1].toLowerCase()) : monthAbbrevs.indexOf(sinceMonth[1].toLowerCase());
    if (idx >= 0) {
      const year = idx > now.getMonth() ? now.getFullYear() - 1 : now.getFullYear();
      return { start: new Date(year, idx, 1), end: now, label: `since ${monthNames[idx]}` };
    }
  }

  const inQ = text.match(/(?:in|during|for)\s+q([1-4])/i);
  if (inQ) {
    const qNum = parseInt(inQ[1], 10);
    const qMonth = (qNum - 1) * 3;
    return { start: new Date(now.getFullYear(), qMonth, 1), end: new Date(now.getFullYear(), qMonth + 3, 0, 23, 59, 59), label: `Q${qNum}` };
  }

  return null;
}

function timeRangeDays(range: TimeRange): number {
  return Math.max(1, Math.ceil((range.end.getTime() - range.start.getTime()) / (1000 * 60 * 60 * 24)));
}

// --- Data filtering by time range ---

function filterByTimeRange(data: AgentData, range: TimeRange): AgentData {
  const inRange = (item: Record<string, unknown>): boolean => {
    const d = parseDate(item);
    if (!d) return true;
    return d >= range.start && d <= range.end;
  };

  return {
    feedback: data.feedback.filter((fb) => inRange(fb as unknown as Record<string, unknown>)),
    features: data.features,
    calls: data.calls.filter((c) => inRange(c as unknown as Record<string, unknown>)),
    insights: data.insights,
    jiraIssues: data.jiraIssues.filter((j) => inRange(j as unknown as Record<string, unknown>)),
    confluencePages: data.confluencePages.filter((p) => inRange(p as unknown as Record<string, unknown>)),
    linearIssues: data.linearIssues.filter((l) => inRange(l as unknown as Record<string, unknown>)),
    analyticsOverview: data.analyticsOverview,
  };
}

// --- Comparison context ---

function buildComparisonBlock(data: AgentData, range: TimeRange): string {
  if (!range.compare) return "";

  const a = filterByTimeRange(data, range);
  const b = filterByTimeRange(data, { start: range.compare.start, end: range.compare.end, label: range.compare.label });

  const themesA = extractTopThemes(a.feedback, 8);
  const themesB = extractTopThemes(b.feedback, 8);
  const themeNamesA = new Set(themesA.map((t) => t[0]));
  const themeNamesB = new Set(themesB.map((t) => t[0]));
  const gained = Array.from(themeNamesB).filter((t) => !themeNamesA.has(t));
  const lost = Array.from(themeNamesA).filter((t) => !themeNamesB.has(t));

  const sentA = sentimentBreakdown(a.feedback);
  const sentB = sentimentBreakdown(b.feedback);

  const lines = [
    `\n---\nPERIOD COMPARISON`,
    `\nPERIOD A: ${range.label} (${a.feedback.length} feedback, ${a.jiraIssues.length} Jira issues)`,
    `Top themes: ${themesA.map(([t, c]) => `${t} (${c})`).join(", ") || "none"}`,
    `Sentiment: ${sentA}`,
    `\nPERIOD B: ${range.compare.label} (${b.feedback.length} feedback, ${b.jiraIssues.length} Jira issues)`,
    `Top themes: ${themesB.map(([t, c]) => `${t} (${c})`).join(", ") || "none"}`,
    `Sentiment: ${sentB}`,
    `\nCHANGES: ${b.feedback.length - a.feedback.length >= 0 ? "+" : ""}${b.feedback.length - a.feedback.length} feedback items`,
  ];
  if (gained.length) lines.push(`Themes gained: ${gained.join(", ")}`);
  if (lost.length) lines.push(`Themes lost: ${lost.join(", ")}`);

  return lines.join("\n");
}

function extractTopThemes(feedback: FeedbackItem[], limit: number): [string, number][] {
  const counts: Record<string, number> = {};
  for (const fb of feedback) {
    for (const t of fb.themes) {
      const lower = t.toLowerCase().trim();
      if (lower.length > 1 && lower.length < 50 && !NOISE_THEMES.test(lower)) {
        counts[lower] = (counts[lower] || 0) + 1;
      }
    }
  }
  return Object.entries(counts).sort(([, a], [, b]) => b - a).slice(0, limit);
}

function sentimentBreakdown(feedback: FeedbackItem[]): string {
  const counts: Record<string, number> = {};
  for (const fb of feedback) counts[fb.sentiment] = (counts[fb.sentiment] || 0) + 1;
  return Object.entries(counts).map(([s, c]) => `${s}: ${c}`).join(", ") || "no data";
}

// --- Query classification ---

type QueryType = "detailed" | "conversational" | "comparison" | "count" | "list";

function isListQuery(query: string): boolean {
  const q = query.toLowerCase();
  return LIST_KEYWORDS.some((kw) => q.includes(kw));
}

function hasPluralItemNoun(query: string): boolean {
  const q = query.toLowerCase();
  return PLURAL_ITEM_NOUNS.some((noun) => q.includes(noun));
}

function classifyQueryType(
  message: string,
  conversationHistory: { role: "user" | "assistant"; content: string }[],
  hasComparison: boolean
): QueryType {
  if (hasComparison) return "comparison";
  if (wantsCount(message)) return "count";
  // List detection runs before the mid-conversation fallback so enumeration
  // questions still get a table even deep into a thread.
  if (isListQuery(message)) return "list";
  if (hasPluralItemNoun(message) && !wantsCount(message)) return "list";
  if (isLikelyFollowUp(message) || conversationHistory.filter((m) => m.role === "user").length >= 2) return "conversational";
  if (isBroadQuery(message) || message.length > 60) return "detailed";
  return "conversational";
}

// --- Adaptive format variants ---

const DETAILED_FORMAT = `USE THIS FORMAT (skip sections that would be empty or forced):

**[1-2 sentence answer to the question. Be specific.]**

| Source | What | When |
| --- | --- | --- |
[max 5 rows. Include this table whenever citing 2+ distinct sources or when the question asks about feedback items, accounts, or requests. Source = Jira key/link, customer name/email, or Productboard note title. What = actual request/issue (with inline [n] citation if applicable). When = relative date. Skip if 0-1 sources.]

## [Heading]

[1-2 paragraphs. What's new, what changed, what matters. Reference dates.]

> "[direct customer quote if available]" — Customer Name or Email. Source: [Jira CX-123](link) or [Productboard note title](link if available)

## Next Steps

1. [owner] [action] [by when]

Include Next Steps only if the answer implies actionable follow-up. Skip if the question is purely informational.

CONSTRAINTS: 300 words max. No :--- in tables. Every quote MUST include a specific source. Skip quote section if none available. For count questions, start with the numeric count. Where evidence is available, add inline [n] citation markers (e.g. "SSO login failures affect 4 enterprise accounts [1][3]") matching the numbered evidence list. If the response covers 3 or more distinct sub-topics (e.g. different accounts, themes, or time periods), wrap each sub-topic in a <details><summary>Sub-topic title</summary>...content...</details> block to allow progressive disclosure.`;

const LIST_FORMAT = `USE THIS FORMAT for list/show-me queries:

**[1 sentence naming what you found and how many items.]**

| Source | What | When |
| --- | --- | --- |
[3-8 rows. Always include this table. Source = customer name/email OR Jira key/Productboard link. What = the specific request, complaint, or issue — be concrete, not generic. When = relative date (e.g. "3d ago", "1w ago"). Add inline [n] citation markers in the What column where evidence is numbered.]

[Optional: 1-2 sentence pattern or theme across the items above. Skip if self-evident from the table.]

CONSTRAINTS: Table is mandatory — do not omit it. No :--- in tables. No Next Steps unless explicitly asked. 200 words max total. Use actual customer/source names, not placeholders.`;

const CONVERSATIONAL_FORMAT = `Respond naturally in 1-3 paragraphs. Be direct and concise. Where evidence supports a claim, add an inline [n] citation marker matching the numbered evidence list (e.g. "three accounts mentioned this [2]"). Include source citations inline (e.g., "per [Jira CX-123]" or "as noted by customer@example.com in Productboard"). Use a quote block only if a specific customer quote is highly relevant. ALWAYS include a compact "| Source | What | When |" table (up to 5 rows) whenever your answer enumerates 3 or more specific feedback items, accounts, tickets, or customer quotes — even if the user did not explicitly ask for a list. Skip the table only when the answer is a pure opinion/recommendation with fewer than 3 concrete sources. No Next Steps unless the user asks "what should we do." 150 words max.`;

const COMPARISON_FORMAT = `Structure the response as a comparison:

## [Period/Dimension A] vs [Period/Dimension B]

| Dimension | [A label] | [B label] |
| --- | --- | --- |
[rows for volume, top themes, sentiment, key items]

### Key Changes
[2-3 bullet points highlighting what shifted and why it matters]

CONSTRAINTS: Focus on what changed, not what stayed the same. 250 words max. No :--- in tables.`;

const HIGHLIGHT_RULE = `HIGHLIGHTS: Use inline **bold** for the 1-3 most important facts in the body — critical numbers (e.g. "**7 accounts**"), named risks ("**churn risk at Acme**"), pivotal dates ("**Q4 renewal**"), or decisive outcomes. Do NOT bold entire sentences or more than 3 phrases. This is for scanability, not emphasis on everything.`;

function isBroadQuery(query: string): boolean {
  const q = query.toLowerCase();
  return BROAD_KEYWORDS.some((kw) => q.includes(kw));
}

function wantsConfluence(query: string): boolean {
  const q = query.toLowerCase();
  return CONFLUENCE_KEYWORDS.some((kw) => q.includes(kw));
}

function wantsEngineering(query: string): boolean {
  const q = query.toLowerCase();
  return ENG_KEYWORDS.some((kw) => q.includes(kw));
}

function wantsCount(query: string): boolean {
  const q = query.toLowerCase();
  return COUNT_KEYWORDS.some((kw) => q.includes(kw));
}

function wantsInsightDrilldown(query: string): boolean {
  const q = query.toLowerCase();
  return INSIGHT_DRILLDOWN_KEYWORDS.some((kw) => q.includes(kw));
}

const ANALYTICS_KEYWORDS = [
  "posthog", "amplitude", "analytics", "product analytics",
  "session", "sessions", "dau", "mau", "wau",
  "funnel", "retention", "clicks", "pageview", "page view",
  "telemetry", "instrumentation", "tracks", "events",
  "feature flag", "feature flags",
  "feature", "page", "event",
];

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

function wantsAnalyticsContext(query: string): boolean {
  const q = query.toLowerCase();
  if (USAGE_KEYWORDS.some((kw) => q.includes(kw))) return true;
  if (ANALYTICS_KEYWORDS.some((kw) => q.includes(kw))) return true;
  if (EMAIL_RE.test(query)) return true;
  return false;
}

const BROAD_ANALYTICS_KEYWORDS = [
  "all pages", "all features", "every page", "every feature",
  "least used", "lowest usage", "low traffic", "underperforming",
  "full breakdown", "rank pages", "rank features", "ranking",
  "compare pages", "compare features", "bottom pages", "bottom features",
  "which pages", "which features", "list pages", "list features",
  "page usage", "feature usage", "full analytics", "complete breakdown",
];

const BROAD_DATA_KEYWORDS = [
  "all feedback", "every ticket", "all jira", "all tickets",
  "complete list", "full list", "everything about",
  "comprehensive", "every customer", "all calls", "all issues",
  "list all", "show all", "every issue",
];

function wantsDeepDive(query: string): { analytics: boolean; data: boolean } {
  const q = query.toLowerCase();
  const analytics = BROAD_ANALYTICS_KEYWORDS.some((kw) => q.includes(kw));
  const data = BROAD_DATA_KEYWORDS.some((kw) => q.includes(kw));
  return { analytics, data };
}

function formatFullAnalytics(result: FullAnalyticsResult, label: string): string {
  const lines: string[] = [`\n--- Full ${label} Analytics ---`];
  if (result.pages.length > 0) {
    lines.push(`\nAll pages (${result.pages.length}, ranked by usage):`);
    for (const p of result.pages) lines.push(`  ${p.name}: ${p.count} events${p.minutes ? `, ${p.minutes}m` : ""}`);
  }
  if (result.features.length > 0) {
    lines.push(`\nAll features (${result.features.length}, ranked by usage):`);
    for (const f of result.features) lines.push(`  ${f.name}: ${f.count} events${f.minutes ? `, ${f.minutes}m` : ""}`);
  }
  if (result.events.length > 0) {
    lines.push(`\nAll events (${result.events.length}, ranked by count):`);
    for (const e of result.events) lines.push(`  ${e.name}: ${e.count}`);
  }
  if (result.accounts.length > 0) {
    lines.push(`\nAll accounts (${result.accounts.length}, ranked by activity):`);
    for (const a of result.accounts) lines.push(`  ${a.id}: ${a.count} events${a.minutes ? `, ${a.minutes}m` : ""}`);
  }
  return lines.join("\n");
}

function buildExpandedDataContext(data: AgentData, limit = 100): string {
  const parts: string[] = [];
  if (data.feedback.length > 0) {
    const items = data.feedback.slice(0, limit);
    parts.push(`\n--- Expanded feedback (${items.length} of ${data.feedback.length}) ---`);
    for (const fb of items) {
      parts.push(`- ${fb.title} [${fb.source}/${fb.priority}] ${fb.customer}${fb.company ? ` @ ${fb.company}` : ""}`);
    }
  }
  if (data.jiraIssues.length > 0) {
    const items = data.jiraIssues.slice(0, limit);
    parts.push(`\n--- Expanded Jira (${items.length} of ${data.jiraIssues.length}) ---`);
    for (const j of items) {
      parts.push(`- ${j.key} ${j.summary} [${j.status}/${j.issueType}/${j.priority}]`);
    }
  }
  if (data.features.length > 0) {
    const items = [...data.features].sort((a, b) => b.votes - a.votes).slice(0, limit);
    parts.push(`\n--- Expanded features (${items.length} of ${data.features.length}) ---`);
    for (const f of items) {
      parts.push(`- ${f.name} — ${f.status}, ${f.votes} votes`);
    }
  }
  if (data.calls.length > 0) {
    const items = data.calls.slice(0, Math.min(limit, 20));
    parts.push(`\n--- Expanded calls (${items.length} of ${data.calls.length}) ---`);
    for (const c of items) {
      parts.push(`- ${c.title} (${c.date}) — ${c.summary.slice(0, 80)}`);
    }
  }
  if (data.linearIssues.length > 0) {
    const items = data.linearIssues.slice(0, limit);
    parts.push(`\n--- Expanded Linear (${items.length} of ${data.linearIssues.length}) ---`);
    for (const l of items) {
      parts.push(`- ${l.identifier} ${l.title} [${l.status}/${l.priority}]`);
    }
  }
  if (data.confluencePages.length > 0) {
    const items = data.confluencePages.slice(0, Math.min(limit, 30));
    parts.push(`\n--- Expanded Confluence (${items.length} of ${data.confluencePages.length}) ---`);
    for (const p of items) {
      parts.push(`- ${p.title} [${p.space}]`);
    }
  }
  return parts.join("\n");
}

function isLikelyFollowUp(query: string): boolean {
  const q = query.toLowerCase();
  const hasFollowUpWord = FOLLOW_UP_KEYWORDS.some((kw) => q.includes(kw));
  // Catch mid-sentence "what else", "anything else", "what other"
  const hasElsePattern = /\b(what else|anything else|something else|what other|any other)\b/.test(q);
  const startsWithContinuation = /^(and|also|what about|how about|those|them|it)\b/.test(q.trim());
  return hasFollowUpWord || hasElsePattern || startsWithContinuation;
}

/**
 * Detects when the user wants to pivot away from a known entity.
 * e.g. "connectwise is in progress, what else?" → { isPivot: true, excluded: ["connectwise"] }
 *       "besides SSO, what are people asking?" → { isPivot: true, excluded: ["sso"] }
 */
function detectPivot(message: string): { isPivot: boolean; excluded: string[] } {
  const q = message.toLowerCase().trim();
  const excluded: string[] = [];

  // Pattern 1: "<entity> is (in progress|done|handled|covered|known|addressed|sorted|resolved), what else..."
  const statusPattern = /^(.+?)\s+(?:is|are|was|were)\s+(?:in progress|done|handled|covered|known|addressed|sorted|resolved|being handled|taken care of)[,.]?\s+(?:what|anything|anything else|so what|now what)/i;
  const statusMatch = message.match(statusPattern);
  if (statusMatch) {
    excluded.push(statusMatch[1].trim().toLowerCase());
  }

  // Pattern 2: "besides/other than/aside from/except <entity>" anywhere in message
  const besidesPattern = /(?:besides|other than|aside from|except for?|not counting|ignoring|excluding)\s+([a-zA-Z0-9 _/-]{2,40})(?:\s*[,?!.]|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = besidesPattern.exec(message)) !== null) {
    const entity = m[1].trim().toLowerCase();
    if (entity && !["that", "this", "it", "them", "me", "us"].includes(entity)) {
      excluded.push(entity);
    }
  }

  // Pattern 3: "what else do you have" or "what else is there" after mentioning an entity in the same message
  const whatElsePattern = /\bwhat else\b/i;
  if (whatElsePattern.test(q) && !statusMatch) {
    // Try to find a proper noun / capitalized entity in the original (non-lowercased) message
    const entityHint = message.match(/\b([A-Z][a-zA-Z0-9](?:[a-zA-Z0-9 ]*[a-zA-Z0-9])?)\b/);
    if (entityHint && !["I", "A", "The", "Is", "Are", "What", "How", "Who", "Why", "When", "Where"].includes(entityHint[1])) {
      excluded.push(entityHint[1].toLowerCase());
    }
  }

  const unique = Array.from(new Set(excluded)).filter(Boolean);
  return { isPivot: unique.length > 0, excluded: unique };
}

function buildSearchQueries(
  userMessage: string,
  conversationHistory: { role: "user" | "assistant"; content: string }[],
  includeHistory: boolean,
  pivot?: { isPivot: boolean; excluded: string[] }
): string[] {
  const queries: string[] = [];

  if (pivot?.isPivot && pivot.excluded.length > 0) {
    // Strip excluded entities from the message so the vector search doesn't latch onto them
    let stripped = userMessage;
    for (const ex of pivot.excluded) {
      stripped = stripped.replace(new RegExp(`\\b${ex.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), "").trim();
    }
    // Add a broadener to pull diverse results
    const broadener = "top themes feedback requests accounts issues features risks";
    queries.push(stripped || broadener);
    queries.push(broadener);
  } else {
    queries.push(userMessage.trim());
  }

  if (!includeHistory) return Array.from(new Set(queries.map((q) => q.toLowerCase())));

  const priorUserTurns = conversationHistory
    .filter((m) => m.role === "user")
    .map((m) => m.content.trim())
    .filter(Boolean);

  const lastUserTurn = priorUserTurns[priorUserTurns.length - 1];
  if (!lastUserTurn) return Array.from(new Set(queries.map((q) => q.toLowerCase())));

  if (isLikelyFollowUp(userMessage)) {
    queries.push(`${lastUserTurn}\n${userMessage}`);
  }

  if (wantsCount(userMessage)) {
    queries.push(lastUserTurn);
  }

  return Array.from(new Set(queries.map((q) => q.toLowerCase())));
}

function extractInsightTopic(userMessage: string): string {
  const patterns = [
    /tell me more about\s*:?\s*(.+)$/i,
    /deep dive on\s*:?\s*(.+)$/i,
    /drill down on\s*:?\s*(.+)$/i,
  ];
  for (const pattern of patterns) {
    const match = userMessage.match(pattern);
    if (match && match[1]) return match[1].trim();
  }
  return userMessage.trim();
}

function normalizeTheme(theme: string): string {
  return theme.toLowerCase().replace(/\s+/g, " ").trim();
}

function recurringThemeGaps(data: AgentData): Array<{ theme: string; count: number; ids: string[] }> {
  if (data.features.length === 0 || data.feedback.length === 0) return [];

  const feedbackThemeStats: Record<string, { count: number; ids: string[] }> = {};
  for (const fb of data.feedback) {
    for (const theme of fb.themes) {
      const key = normalizeTheme(theme);
      if (!key || NOISE_THEMES.test(key)) continue;
      if (!feedbackThemeStats[key]) feedbackThemeStats[key] = { count: 0, ids: [] };
      feedbackThemeStats[key].count++;
      feedbackThemeStats[key].ids.push(fb.id);
    }
  }

  const featureThemes = new Set<string>();
  for (const feature of data.features) {
    for (const theme of feature.themes) {
      const key = normalizeTheme(theme);
      if (!key || NOISE_THEMES.test(key)) continue;
      featureThemes.add(key);
    }
  }

  const minMentions =
    data.feedback.length >= 1000 ? 10 :
    data.feedback.length >= 300 ? 6 :
    data.feedback.length >= 100 ? 4 : 2;

  return Object.entries(feedbackThemeStats)
    .filter(([theme, stats]) => stats.count >= minMentions && !featureThemes.has(theme))
    .sort(([, a], [, b]) => b.count - a.count)
    .map(([theme, stats]) => ({ theme, count: stats.count, ids: stats.ids }));
}

function buildInsightDrilldownContext(
  userMessage: string,
  data: AgentData,
  matchedInsightIds: string[],
  keys: AgentKeys
): string {
  if (!wantsInsightDrilldown(userMessage)) return "";

  const topic = extractInsightTopic(userMessage).toLowerCase();
  const insights = data.insights.filter(
    (insight) =>
      matchedInsightIds.includes(insight.id) ||
      insight.title.toLowerCase().includes(topic) ||
      topic.includes(insight.title.toLowerCase())
  );

  const parts: string[] = [];

  if (insights.length > 0) {
    parts.push("Insight drilldown:");
    for (const insight of insights.slice(0, 3)) {
      parts.push(`- ${insight.title}: ${insight.description}`);
      if (insight.relatedFeedbackIds.length > 0) {
        const examples = lookupDetails(insight.relatedFeedbackIds.slice(0, 6), data, true, keys);
        for (const ex of examples.slice(0, 6)) {
          parts.push(`  - Evidence: ${ex}`);
        }
      }
    }
  }

  if (topic.includes("theme") && topic.includes("not on any feature")) {
    const gaps = recurringThemeGaps(data).slice(0, 5);
    if (gaps.length > 0) {
      parts.push("Recurring feedback themes not mapped to feature themes:");
      for (const gap of gaps) {
        parts.push(`- ${gap.theme} (${gap.count} mentions)`);
      }
      const evidenceIds = gaps.flatMap((gap) => gap.ids).slice(0, 8);
      const evidence = lookupDetails(evidenceIds, data, true, keys);
      for (const ex of evidence.slice(0, 8)) {
        parts.push(`  - Evidence: ${ex}`);
      }
    }
  }

  return parts.join("\n");
}

function recentItems<T extends { date?: string; created?: string; updated?: string }>(items: T[], limit: number): T[] {
  const withDate = items.map((item) => {
    const raw = (item as Record<string, unknown>);
    const dateStr = (raw.date || raw.updated || raw.created || raw.lastModified || "") as string;
    return { item, ts: dateStr ? new Date(dateStr).getTime() : 0 };
  });
  withDate.sort((a, b) => b.ts - a.ts);
  return withDate.slice(0, limit).map((x) => x.item);
}

function parseDate(item: Record<string, unknown>): Date | null {
  const str = (item.date || item.updated || item.created || item.lastModified || item.createdAt || "") as string;
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function dateBucket(d: Date, now: Date): "today" | "this_week" | "last_2_weeks" | "this_month" | "older" {
  const diff = now.getTime() - d.getTime();
  const days = diff / (1000 * 60 * 60 * 24);
  if (days < 1) return "today";
  if (days < 7) return "this_week";
  if (days < 14) return "last_2_weeks";
  if (days < 30) return "this_month";
  return "older";
}

function temporalSummary(items: Record<string, unknown>[], label: string): string {
  if (items.length === 0) return "";
  const now = new Date();
  const buckets: Record<string, number> = { today: 0, this_week: 0, last_2_weeks: 0, this_month: 0, older: 0 };
  let oldest: Date | null = null;
  let newest: Date | null = null;

  for (const item of items) {
    const d = parseDate(item);
    if (d) {
      buckets[dateBucket(d, now)]++;
      if (!oldest || d < oldest) oldest = d;
      if (!newest || d > newest) newest = d;
    } else {
      buckets["older"]++;
    }
  }

  const dateRange = oldest && newest
    ? `${oldest.toLocaleDateString()} – ${newest.toLocaleDateString()}`
    : "unknown range";

  const recentCount = buckets.today + buckets.this_week + buckets.last_2_weeks;
  const parts = [];
  if (buckets.today) parts.push(`${buckets.today} today`);
  if (buckets.this_week) parts.push(`${buckets.this_week} this week`);
  if (buckets.last_2_weeks) parts.push(`${buckets.last_2_weeks} last 2 weeks`);
  if (buckets.this_month) parts.push(`${buckets.this_month} this month`);
  if (buckets.older) parts.push(`${buckets.older} older`);

  return `${label}: ${items.length} total (${parts.join(", ")}). Range: ${dateRange}. ${recentCount} in last 14 days.`;
}

const NOISE_THEMES = /^\d+(\.\d+)?\s*stars?$|^\d+\/\d+$|^(g2|capterra|trustpilot|review|reviews|rating|ratings|stars|n\/a|na|none|other|misc|general|unknown|yes|no)$/i;

function topThemesRecent(feedback: FeedbackItem[], days: number): string {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const themes: Record<string, number> = {};
  let count = 0;
  for (const fb of feedback) {
    const d = parseDate(fb as unknown as Record<string, unknown>);
    if (d && d >= cutoff) {
      count++;
      for (const t of fb.themes) {
        const lower = t.toLowerCase().trim();
        if (lower.length > 1 && lower.length < 50 && !NOISE_THEMES.test(lower)) {
          themes[lower] = (themes[lower] || 0) + 1;
        }
      }
    }
  }
  const top = Object.entries(themes).sort(([, a], [, b]) => b - a).slice(0, 8);
  if (top.length === 0) return "";
  return `Top themes (last ${days}d, ${count} items): ${top.map(([t, c]) => `${t} (${c})`).join(", ")}`;
}

function buildStatsHeader(data: AgentData, analyticsLabel = "Analytics"): string {
  const { feedback, features, calls, insights, jiraIssues, confluencePages, linearIssues, analyticsOverview } = data;
  const parts: string[] = [];

  parts.push(`Today: ${new Date().toLocaleDateString()}`);
  parts.push(temporalSummary(feedback as unknown as Record<string, unknown>[], "Feedback"));

  if (features.length > 0) {
    const byStatus: Record<string, number> = {};
    for (const f of features) byStatus[f.status] = (byStatus[f.status] || 0) + 1;
    parts.push(`Features: ${features.length} total (${Object.entries(byStatus).map(([s, c]) => `${s}: ${c}`).join(", ")})`);
  }

  if (jiraIssues.length > 0) {
    parts.push(temporalSummary(jiraIssues as unknown as Record<string, unknown>[], "Jira"));
    const byStatus: Record<string, number> = {};
    for (const j of jiraIssues) byStatus[j.status] = (byStatus[j.status] || 0) + 1;
    parts.push(`Jira statuses: ${Object.entries(byStatus).sort(([, a], [, b]) => b - a).slice(0, 6).map(([s, c]) => `${s}: ${c}`).join(", ")}`);
  }

  if (linearIssues.length > 0) {
    parts.push(temporalSummary(linearIssues as unknown as Record<string, unknown>[], "Linear"));
    const byStatus: Record<string, number> = {};
    for (const l of linearIssues) byStatus[l.status] = (byStatus[l.status] || 0) + 1;
    parts.push(`Linear statuses: ${Object.entries(byStatus).sort(([, a], [, b]) => b - a).slice(0, 6).map(([s, c]) => `${s}: ${c}`).join(", ")}`);
  }

  if (calls.length > 0) parts.push(temporalSummary(calls as unknown as Record<string, unknown>[], "Calls"));
  if (confluencePages.length > 0) parts.push(`Confluence: ${confluencePages.length} pages`);
  if (insights.length > 0) parts.push(`Insights: ${insights.length}`);
  if (analyticsOverview) {
    const ao = analyticsOverview;
    const pageSummary = ao.topPages.slice(0, 5).map((p) => `${p.name} (${p.count})`).join(", ");
    const featureSummary = ao.topFeatures.slice(0, 5).map((f) => `${f.name} (${f.count})`).join(", ");
    const eventSummary = ao.topEvents.slice(0, 5).map((e) => `${e.name} (${e.count})`).join(", ");
    const accountSummary = ao.topAccounts.slice(0, 3).map((a) => `${a.id} (${a.count})`).join(", ");
    parts.push(`${analyticsLabel}: ${ao.totalTrackedPages} tracked pages, ${ao.totalTrackedFeatures} tracked features.`);
    if (pageSummary) parts.push(`${analyticsLabel} top pages: ${pageSummary}`);
    if (featureSummary) parts.push(`${analyticsLabel} top features: ${featureSummary}`);
    if (eventSummary) parts.push(`${analyticsLabel} top events: ${eventSummary}`);
    if (accountSummary) parts.push(`${analyticsLabel} top accounts: ${accountSummary}`);
    if (ao.allPageNames && ao.allPageNames.length > ao.topPages.length) {
      parts.push(`${analyticsLabel} all known pages (${ao.allPageNames.length}): ${ao.allPageNames.join(", ")}`);
    }
    if (ao.allFeatureNames && ao.allFeatureNames.length > ao.topFeatures.length) {
      parts.push(`${analyticsLabel} all known features (${ao.allFeatureNames.length}): ${ao.allFeatureNames.join(", ")}`);
    }
    if (ao.allEventNames && ao.allEventNames.length > ao.topEvents.length) {
      parts.push(`${analyticsLabel} all known events (${ao.allEventNames.length}): ${ao.allEventNames.join(", ")}`);
    }
    if (ao.limitations?.length) parts.push(`${analyticsLabel} note: ${ao.limitations.join(". ")}`);
  }

  const recentThemes = topThemesRecent(feedback, 14);
  if (recentThemes) parts.push(recentThemes);

  const allTimeThemes = topThemesRecent(feedback, 365);
  if (allTimeThemes && recentThemes !== allTimeThemes) parts.push(allTimeThemes.replace(`last 365d`, "all-time"));

  return parts.join("\n");
}

function buildFocusedContext(data: AgentData, searchResults: string, analyticsLabel = "Analytics"): string {
  const parts: string[] = [];
  parts.push(buildStatsHeader(data, analyticsLabel));
  parts.push(`\n---\nRelevant items:\n${searchResults || "(No matches)"}`);
  return parts.join("\n");
}

function buildComputedCounts(data: AgentData): string {
  const lines: string[] = ["\n---\nCOMPUTED COUNTS (use these exact numbers — do not estimate from context):"];

  lines.push(`Total feedback items: ${data.feedback.length}`);
  lines.push(`Total features: ${data.features.length}`);
  lines.push(`Total calls: ${data.calls.length}`);
  lines.push(`Total Jira issues: ${data.jiraIssues.length}`);
  lines.push(`Total Linear issues: ${data.linearIssues.length}`);
  lines.push(`Total Confluence pages: ${data.confluencePages.length}`);
  lines.push(`Total insights: ${data.insights.length}`);

  const bySource: Record<string, number> = {};
  const byPriority: Record<string, number> = {};
  const bySentiment: Record<string, number> = {};
  const byTheme: Record<string, number> = {};
  for (const fb of data.feedback) {
    bySource[fb.source] = (bySource[fb.source] || 0) + 1;
    byPriority[fb.priority] = (byPriority[fb.priority] || 0) + 1;
    bySentiment[fb.sentiment] = (bySentiment[fb.sentiment] || 0) + 1;
    for (const t of fb.themes) byTheme[t] = (byTheme[t] || 0) + 1;
  }

  lines.push(`Feedback by source: ${Object.entries(bySource).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  lines.push(`Feedback by priority: ${Object.entries(byPriority).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  lines.push(`Feedback by sentiment: ${Object.entries(bySentiment).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  const topThemes = Object.entries(byTheme).sort(([, a], [, b]) => b - a).slice(0, 15);
  lines.push(`Top feedback themes: ${topThemes.map(([k, v]) => `${k}=${v}`).join(", ")}`);

  const byStatus: Record<string, number> = {};
  for (const f of data.features) byStatus[f.status] = (byStatus[f.status] || 0) + 1;
  lines.push(`Features by status: ${Object.entries(byStatus).map(([k, v]) => `${k}=${v}`).join(", ")}`);

  const companies = new Set(data.feedback.map((fb) => fb.company).filter(Boolean));
  lines.push(`Distinct companies in feedback: ${companies.size}`);

  return lines.join("\n");
}

function shortDate(item: Record<string, unknown>): string {
  const d = parseDate(item);
  if (!d) return "";
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function filterJiraForContext(issues: JiraIssue[], includeEng: boolean): JiraIssue[] {
  if (includeEng) return issues;
  return issues.filter((j) => !/^ENG-/i.test(j.key));
}

function buildStandardContext(data: AgentData, searchResults: string, includeEng = false, includeConfluence = false, analyticsLabel = "Analytics"): string {
  const parts: string[] = [];
  parts.push(buildStatsHeader(data, analyticsLabel));

  const recentFb = recentItems(data.feedback, 15);
  if (recentFb.length > 0) {
    parts.push(`\nRecent customer feedback (${recentFb.length} of ${data.feedback.length}):`);
    for (const fb of recentFb) {
      const when = shortDate(fb as unknown as Record<string, unknown>);
      parts.push(`- [${when}] ${fb.title} [${fb.source}/${fb.priority}] ${fb.customer}${fb.company ? ` @ ${fb.company}` : ""}`);
    }
  }

  if (data.features.length > 0) {
    const top = [...data.features].sort((a, b) => b.votes - a.votes).slice(0, 8);
    parts.push(`\nTop features: ${top.map((f) => `${f.name} (${f.votes}v, ${f.status})`).join("; ")}`);
  }

  const jiraFiltered = filterJiraForContext(data.jiraIssues, includeEng);
  if (jiraFiltered.length > 0) {
    const recent = recentItems(jiraFiltered, 12);
    const label = includeEng ? "Jira" : "Jira (CX/customer)";
    parts.push(`\nRecent ${label} (${recent.length} of ${jiraFiltered.length}):`);
    for (const j of recent) {
      const when = shortDate(j as unknown as Record<string, unknown>);
      parts.push(`- [${when}] ${j.key} ${j.summary} [${j.status}/${j.priority}]`);
    }
  }

  if (data.linearIssues.length > 0) {
    const recent = recentItems(data.linearIssues, 12);
    parts.push(`\nLinear issues (${recent.length} of ${data.linearIssues.length}):`);
    for (const l of recent) {
      const when = shortDate(l as unknown as Record<string, unknown>);
      parts.push(`- [${when}] ${l.identifier} ${l.title} [${l.status}/${l.priority}]`);
    }
  }

  if (includeConfluence && data.confluencePages.length > 0) {
    parts.push(`\nConfluence (${data.confluencePages.length} pages): ${data.confluencePages.slice(0, 8).map((p) => p.title).join(", ")}`);
  }

  parts.push(`\n---\nSearch results:\n${searchResults || "(No matches)"}`);
  return parts.join("\n");
}

function buildDeepContext(data: AgentData, searchResults: string, includeEng = false, includeConfluence = false, analyticsLabel = "Analytics"): string {
  const parts: string[] = [];
  parts.push(buildStatsHeader(data, analyticsLabel));

  const recentFb = recentItems(data.feedback, 40);
  if (recentFb.length > 0) {
    parts.push(`\nCustomer feedback (${recentFb.length} of ${data.feedback.length}):`);
    for (const fb of recentFb) {
      const when = shortDate(fb as unknown as Record<string, unknown>);
      parts.push(`- [${when}] **${fb.title}** [${fb.source}/${fb.priority}] ${fb.customer}${fb.company ? ` @ ${fb.company}` : ""}: ${fb.content.slice(0, 100)}`);
    }
  }

  if (data.features.length > 0) {
    const active = data.features.filter((f) => f.status === "in_progress" || f.status === "planned");
    const top = [...data.features].sort((a, b) => b.votes - a.votes).slice(0, 12);
    parts.push(`\nFeatures (${active.length} active of ${data.features.length}):`);
    for (const f of top) parts.push(`- ${f.name} — ${f.status}, ${f.votes} votes`);
  }

  const jiraFiltered = filterJiraForContext(data.jiraIssues, includeEng);
  if (jiraFiltered.length > 0) {
    const recent = recentItems(jiraFiltered, 20);
    const label = includeEng ? "Jira (all)" : "Jira (CX/customer)";
    parts.push(`\n${label} (${recent.length} of ${jiraFiltered.length}):`);
    for (const j of recent) {
      const when = shortDate(j as unknown as Record<string, unknown>);
      parts.push(`- [${when}] ${j.key} ${j.summary} [${j.status}/${j.issueType}/${j.priority}] → ${j.assignee}`);
    }
  }

  if (data.calls.length > 0) {
    const recent = recentItems(data.calls, 5);
    parts.push(`\nCalls:`);
    for (const c of recent) parts.push(`- [${shortDate(c as unknown as Record<string, unknown>)}] ${c.title} — ${c.summary.slice(0, 100)}`);
  }

  if (data.linearIssues.length > 0) {
    const recent = recentItems(data.linearIssues, 20);
    parts.push(`\nLinear issues (${recent.length} of ${data.linearIssues.length}):`);
    for (const l of recent) {
      const when = shortDate(l as unknown as Record<string, unknown>);
      parts.push(`- [${when}] ${l.identifier} ${l.title} [${l.status}/${l.priority}] → ${l.assignee}`);
    }
  }

  if (includeConfluence && data.confluencePages.length > 0) {
    parts.push(`\nConfluence (${data.confluencePages.length} pages): ${data.confluencePages.slice(0, 8).map((p) => p.title).join(", ")}${data.confluencePages.length > 8 ? ` +${data.confluencePages.length - 8} more` : ""}`);
  }

  if (data.insights.length > 0) {
    parts.push(`\nInsights:`);
    for (const i of data.insights.slice(0, 6)) parts.push(`- [${i.type}] ${i.title}`);
  }

  parts.push(`\n---\nSearch results:\n${searchResults || "(No matches)"}`);
  return parts.join("\n");
}

const MAX_CONTEXT_TOKENS: Record<string, number> = { focused: 4000, standard: 6000, deep: 10000 };

export async function chat(
  userMessage: string,
  conversationHistory: { role: "user" | "assistant"; content: string }[],
  data: AgentData,
  keys: AgentKeys = {},
  contextMode: ContextMode = "focused",
  mode: InteractionMode = "summarize",
  accumulatedSourceIds?: string[]
): Promise<ChatResult> {
  const timeRange = extractTimeRange(userMessage);
  const scopedData = timeRange ? filterByTimeRange(data, timeRange) : data;

  const store = buildStore(scopedData);
  const countQuery = wantsCount(userMessage);
  const drilldownQuery = wantsInsightDrilldown(userMessage);
  const deepDiveEarly = wantsDeepDive(userMessage);
  const wideQuery = countQuery || drilldownQuery || deepDiveEarly.analytics || deepDiveEarly.data;
  const pivot = detectPivot(userMessage);
  const baseSearchLimit = contextMode === "focused" ? 10 : contextMode === "standard" ? 15 : 20;
  // Use a wider search limit for pivot queries so we get enough non-excluded results
  const searchLimit = wideQuery || pivot.isPivot ? Math.max(baseSearchLimit * 5, 50) : baseSearchLimit;
  const searchQueries = buildSearchQueries(userMessage, conversationHistory, wideQuery || isLikelyFollowUp(userMessage), pivot);

  const merged = new Map<string, { document: (ReturnType<InMemoryVectorStore["search"]>[number])["document"]; score: number }>();
  for (const q of searchQueries) {
    for (const r of store.search(q, { limit: searchLimit })) {
      const key = `${r.document.type}:${r.document.id}`;
      const existing = merged.get(key);
      if (!existing || r.score > existing.score) merged.set(key, r);
    }
  }
  let rawResults = Array.from(merged.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, searchLimit);

  // For pivot queries, deprioritize docs that mention excluded entities
  if (pivot.isPivot && pivot.excluded.length > 0) {
    const excludeRegex = new RegExp(`\\b(${pivot.excluded.map((e) => e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "i");
    const mentionsExcluded = (r: (typeof rawResults)[number]) =>
      excludeRegex.test(r.document.text.slice(0, 200));
    const preferred = rawResults.filter((r) => !mentionsExcluded(r));
    // Only filter if we have enough remaining results; otherwise sort excluded docs last
    if (preferred.length >= Math.min(8, rawResults.length / 2)) {
      rawResults = preferred;
    } else {
      rawResults = [
        ...rawResults.filter((r) => !mentionsExcluded(r)),
        ...rawResults.filter((r) => mentionsExcluded(r)),
      ];
    }
  }

  const includeConfluence = wantsConfluence(userMessage);
  const includeEng = wantsEngineering(userMessage);

  const results = rawResults.filter((r) => {
    if (r.document.type === "confluence" && !includeConfluence && contextMode === "focused") return false;
    if (r.document.type === "jira") {
      const j = scopedData.jiraIssues.find((j) => j.id === r.document.id);
      if (j && /^ENG-/i.test(j.key) && !includeEng) return false;
    }
    return true;
  });

  const relatedFeedback = results
    .filter((r) => r.document.type === "feedback")
    .map((r) => scopedData.feedback.find((f) => f.id === r.document.id))
    .filter((item): item is FeedbackItem => !!item);

  const analyticsProvider = keys.analyticsProvider || "pendo";
  let analyticsLookup: { context: string; sources: { type: string; id: string; title: string }[] } | null = null;
  if (wantsAnalyticsContext(userMessage)) {
    const lookupDays = timeRange ? Math.min(timeRangeDays(timeRange), 90) : undefined;
    if (analyticsProvider === "amplitude") {
      analyticsLookup = await getRelevantAmplitudeContext(userMessage, relatedFeedback, keys.amplitudeKey, lookupDays);
    } else if (analyticsProvider === "posthog") {
      analyticsLookup = await getRelevantPostHogContext(userMessage, relatedFeedback, keys.posthogKey, lookupDays, keys.posthogHost);
    } else {
      analyticsLookup = await getRelevantPendoContext(userMessage, relatedFeedback, keys.pendoKey, lookupDays);
    }
  }

  const sources: { type: string; id: string; title: string; url?: string }[] = [];
  const searchParts: string[] = [];
  const recentItemIds = new Set<string>();
  const detailed = wantsDetail(userMessage) || drilldownQuery;

  for (const r of results) {
    const doc = r.document;
    const details = lookupDetails([doc.id], scopedData, detailed, keys);
    if (details.length > 0) searchParts.push(details[0]);
    recentItemIds.add(doc.id);

    let title = doc.id;
    let url: string | undefined;
    if (doc.type === "feedback") {
      const fb = scopedData.feedback.find((f) => f.id === doc.id);
      const email = fb?.metadata?.userEmail || (fb?.customer && /\S+@\S+/.test(fb.customer) ? fb.customer : "");
      const contact = email || fb?.customer || fb?.company || "";
      title = fb ? `${cleanFeedbackTitle(fb)}${contact ? ` — ${contact}` : ""}` : title;
      if (fb?.metadata?.sourceUrl) url = fb.metadata.sourceUrl;
    } else if (doc.type === "feature") {
      title = scopedData.features.find((f) => f.id === doc.id)?.name || title;
    } else if (doc.type === "call") {
      title = scopedData.calls.find((c) => c.id === doc.id)?.title || title;
    } else if (doc.type === "insight") {
      title = scopedData.insights.find((i) => i.id === doc.id)?.title || title;
    } else if (doc.type === "jira") {
      const j = scopedData.jiraIssues.find((j) => j.id === doc.id);
      if (j) {
        title = `${j.key}: ${j.summary}`;
        const domain = keys.atlassianDomain || process.env.ATLASSIAN_DOMAIN || "";
        if (domain) url = `https://${domain.replace(/\.atlassian\.net\/?$/, "")}.atlassian.net/browse/${j.key}`;
      }
    } else if (doc.type === "confluence") {
      const p = scopedData.confluencePages.find((p) => p.id === doc.id);
      if (p) { title = p.title; url = p.url; }
    } else if (doc.type === "linear") {
      const l = scopedData.linearIssues.find((l) => l.id === doc.id);
      if (l) { title = `${l.identifier}: ${l.title}`; url = l.url; }
    }
    sources.push({ type: doc.type, id: doc.id, title, url });
  }

  if (analyticsLookup?.sources.length) {
    for (const source of analyticsLookup.sources) sources.push(source);
  }

  const matchedInsightIds = results.filter((r) => r.document.type === "insight").map((r) => r.document.id);
  const drilldownContext = buildInsightDrilldownContext(userMessage, scopedData, matchedInsightIds, keys);

  const isPrdOrTicket = mode === "prd" || mode === "ticket";

  if (isPrdOrTicket && accumulatedSourceIds && accumulatedSourceIds.length > 0) {
    const uniqueAccIds = accumulatedSourceIds.filter((id) => !recentItemIds.has(id));
    if (uniqueAccIds.length > 0) {
      const accDetails = lookupDetails(uniqueAccIds, scopedData, true, keys);
      if (accDetails.length > 0) {
        searchParts.push("Previously referenced items from conversation:\n" + accDetails.join("\n"));
      }
    }
  }

  let fullAnalyticsBlock = "";
  if (deepDiveEarly.analytics) {
    const lookupDays = timeRange ? Math.min(timeRangeDays(timeRange), 90) : undefined;
    let fullResult: FullAnalyticsResult | null = null;
    if (analyticsProvider === "amplitude") {
      fullResult = await getFullAmplitudeAnalytics(keys.amplitudeKey, lookupDays);
    } else if (analyticsProvider === "posthog") {
      fullResult = await getFullPostHogAnalytics(keys.posthogKey, lookupDays, 200, keys.posthogHost);
    } else {
      fullResult = await getFullPendoAnalytics(keys.pendoKey, lookupDays);
    }
    if (fullResult) {
      const label = analyticsProvider === "amplitude" ? "Amplitude" : analyticsProvider === "posthog" ? "PostHog" : "Pendo";
      fullAnalyticsBlock = formatFullAnalytics(fullResult, label);
    }
  }

  let expandedDataBlock = "";
  if (deepDiveEarly.data) {
    expandedDataBlock = buildExpandedDataContext(scopedData);
  }

  const searchContext = [searchParts.join("\n"), drilldownContext, analyticsLookup?.context || "", fullAnalyticsBlock, expandedDataBlock].filter(Boolean).join("\n");

  const analyticsLabel = analyticsProvider === "amplitude" ? "Amplitude" : analyticsProvider === "posthog" ? "PostHog" : "Pendo";

  const hasDeepDive = deepDiveEarly.analytics || deepDiveEarly.data;
  const effectiveContextMode = isPrdOrTicket
    ? "deep"
    : hasDeepDive
      ? "deep"
      : (countQuery || drilldownQuery) && contextMode === "focused"
        ? "deep"
        : isBroadQuery(userMessage) && contextMode === "focused"
          ? "standard"
          : contextMode;

  let context: string;
  switch (effectiveContextMode) {
    case "deep": context = buildDeepContext(scopedData, searchContext, isPrdOrTicket || includeEng, isPrdOrTicket || includeConfluence, analyticsLabel); break;
    case "standard": context = buildStandardContext(scopedData, searchContext, includeEng, includeConfluence, analyticsLabel); break;
    default: context = buildFocusedContext(scopedData, searchContext, analyticsLabel);
  }

  if (timeRange) {
    const totalItems = data.feedback.length + data.jiraIssues.length + data.calls.length;
    const scopedItems = scopedData.feedback.length + scopedData.jiraIssues.length + scopedData.calls.length;
    context = `Time scope: ${timeRange.label} (${timeRange.start.toLocaleDateString()} – ${timeRange.end.toLocaleDateString()}). Showing ${scopedItems} of ${totalItems} time-sensitive items in this range.\n\n` + context;
  }

  if (timeRange?.compare) {
    context += buildComparisonBlock(data, timeRange);
  }

  if (countQuery) {
    context += buildComputedCounts(scopedData);
  }

  const budget = MAX_CONTEXT_TOKENS[effectiveContextMode] || 6000;
  if (estimateTokens(context) > budget) {
    context = context.slice(0, Math.floor(budget * 3.5));
  }

  const total = scopedData.feedback.length + scopedData.features.length + scopedData.calls.length + scopedData.insights.length + scopedData.jiraIssues.length + scopedData.confluencePages.length + scopedData.linearIssues.length;

  const isPrdOrTicketHistory = isPrdOrTicket;
  const followUp = isLikelyFollowUp(userMessage);
  const priorUserTurns = conversationHistory.filter((m) => m.role === "user").length;
  const skipHistory = !isPrdOrTicketHistory && !followUp && priorUserTurns < 2;

  // Smarter history: if > 6 turns, summarize older turns into a single assistant note
  let historySlice = isPrdOrTicketHistory ? conversationHistory : skipHistory ? [] : conversationHistory.slice(-3);
  let summaryPreamble = "";
  if (!skipHistory && conversationHistory.length > 6) {
    const older = conversationHistory.slice(0, -4);
    const recent = conversationHistory.slice(-4);
    const topicsInOlder = older
      .filter((m) => m.role === "user")
      .map((m) => m.content.slice(0, 80))
      .join("; ");
    summaryPreamble = `Earlier in this conversation the user asked about: ${topicsInOlder}\n`;
    historySlice = recent;
  }

  const historyText = (summaryPreamble + historySlice
    .map((m) => `${m.role === "user" ? "Q" : "A"}: ${m.content.slice(0, isPrdOrTicketHistory ? 500 : 200)}`)
    .join("\n")).trim();

  const systemPrompt = getSystemPrompt(mode);
  const hasComparison = !!timeRange?.compare;
  const formatInstructions = getFormatInstructions(mode, userMessage, conversationHistory, hasComparison);

  const evidencePack = sources.length > 0
    ? "\n---\nAvailable Evidence (cite by ID only — do not reference sources not in this list):\n" +
      sources.map((s, i) => `[${i + 1}] ${s.id}: ${s.title} (${s.type})`).join("\n")
    : "";

  const pivotAddendum = pivot.isPivot && pivot.excluded.length > 0
    ? `\nPIVOT INSTRUCTION: The user already knows about "${pivot.excluded.join('", "')}". Do NOT summarize, repeat, or elaborate on ${pivot.excluded.map((e) => `"${e}"`).join(" or ")}. Focus ENTIRELY on OTHER topics, accounts, themes, or items found in the evidence above. If the evidence mentions ${pivot.excluded[0]} only incidentally, skip those items and highlight everything else.\n`
    : "";

  const prompt = `${context}${evidencePack}
${historyText ? `\nHistory:\n${historyText}\n` : ""}
Q: ${userMessage}
${pivotAddendum}
${formatInstructions}`;

  const inputTokens = estimateTokens(systemPrompt) + estimateTokens(prompt);

  const aiProvider = keys.aiProvider || "gemini";
  const aiKey = resolveAIKey(aiProvider, keys.geminiKey, keys.anthropicKey, keys.openaiKey);

  // Build trace metadata
  const detectedThemes = Array.from(
    new Set(
      results
        .filter((r) => r.document.type === "feedback")
        .flatMap((r) => scopedData.feedback.find((f) => f.id === r.document.id)?.themes || [])
        .concat(
          results
            .filter((r) => r.document.type === "insight")
            .flatMap((r) => scopedData.insights.find((i) => i.id === r.document.id)?.themes || [])
        )
    )
  ).slice(0, 10);

  const queryTypeLabel: ChatTrace["queryType"] = timeRange?.compare
    ? "comparison"
    : countQuery
      ? "count"
      : isListQuery(userMessage)
        ? "list"
        : detailed
          ? "detailed"
          : "conversational";

  const trace: ChatTrace = {
    detectedIntent: mode as "summarize" | "prd" | "ticket",
    queryType: queryTypeLabel,
    timeRange: timeRange ? { label: timeRange.label, start: timeRange.start.toISOString(), end: timeRange.end.toISOString() } : undefined,
    themesDetected: detectedThemes,
    retrieval: {
      query: searchQueries[0] || userMessage,
      topResults: rawResults.slice(0, 8).map((r) => ({ id: r.document.id, type: r.document.type, score: Math.round(r.score * 100) / 100 })),
    },
    contextMode: effectiveContextMode,
    tokensUsed: { input: inputTokens, output: 0, total: inputTokens },
    ...(pivot.isPivot && pivot.excluded.length > 0 ? { pivotExcluded: pivot.excluded } : {}),
  };

  if (isAnyAIConfigured(aiProvider, keys.geminiKey, keys.anthropicKey, keys.openaiKey)) {
    const provider = getAIProvider(aiProvider);
    const aiResponse = await provider.generate(systemPrompt, prompt, aiKey, keys.aiModel || undefined);
    if (aiResponse) {
      const outputTokens = estimateTokens(aiResponse);
      const finalTrace = { ...trace, tokensUsed: { input: inputTokens, output: outputTokens, total: inputTokens + outputTokens } };
      return {
        response: aiResponse,
        sources,
        tokenEstimate: { input: inputTokens, output: outputTokens, total: inputTokens + outputTokens },
        trace: finalTrace,
      };
    }
  }

  if (total === 0) {
    return {
      response: `I don't have any data loaded. Add API keys in Settings or enable demo data.`,
      sources: [],
      tokenEstimate: { input: 0, output: 0, total: 0 },
    };
  }

  const builtIn = generateBuiltInResponse(userMessage, searchContext, sources, scopedData);
  return { response: builtIn, sources, tokenEstimate: { input: 0, output: 0, total: 0 }, trace };
}

function getSystemPrompt(mode: InteractionMode): string {
  if (mode === "prd") return PRD_SYSTEM_PROMPT;
  if (mode === "ticket") return TICKET_SYSTEM_PROMPT;
  return SYSTEM_PROMPT;
}

function getFormatInstructions(
  mode: InteractionMode,
  message?: string,
  history?: { role: "user" | "assistant"; content: string }[],
  hasComparison?: boolean
): string {
  if (mode === "prd") return PRD_FORMAT;
  if (mode === "ticket") return TICKET_FORMAT;
  if (message && history) {
    const qType = classifyQueryType(message, history, !!hasComparison);
    switch (qType) {
      case "comparison": return `${COMPARISON_FORMAT}\n\n${HIGHLIGHT_RULE}`;
      case "list": return `${LIST_FORMAT}\n\n${HIGHLIGHT_RULE}`;
      case "conversational": return `${CONVERSATIONAL_FORMAT}\n\n${HIGHLIGHT_RULE}`;
      case "count": return SUMMARIZE_FORMAT;
      default: return `${DETAILED_FORMAT}\n\n${HIGHLIGHT_RULE}`;
    }
  }
  return SUMMARIZE_FORMAT;
}

const PRD_SYSTEM_PROMPT = `You are a senior product manager writing a product pitch — a concise, opinionated document that presents a bet worth making. Follow these principles:

- Write like a Shape Up pitch: start with the problem story, not the feature. Never present a solution without first establishing why the status quo is broken.
- Title the document around the outcome you want to achieve, not the feature you want to build. Bad: "Add Tags to Work Orders." Good: "Help maintenance coordinators process work orders 50% faster."
- Set appetite to constrain scope. State how much time you'd invest, and let that shape the solution. A six-week solution looks very different from a two-week one.
- Surface rabbit holes and no-gos explicitly. Call out known risks worth avoiding and scope you are intentionally excluding. This prevents scope creep and protects the team.
- Include both qualitative success criteria (what users should think, feel, and do differently) and quantitative metrics. Don't skip qualitative goals just because they're hard to measure.
- Ground every claim in specific customer evidence from the provided data. Include direct quotes with source attribution. State how many customers are affected when possible.
- Ask "why" one more time than feels necessary. If you're describing a symptom, dig into the underlying cause.

Synthesize ALL provided feedback data, analytics context, and conversation history into the pitch. Be opinionated about priorities and honest about unknowns.`;

const TICKET_SYSTEM_PROMPT = `You are a senior product manager drafting a concise, actionable engineering ticket. Follow these principles:

- Start with why this matters, not what to build. Never present a solution without first establishing the problem it solves and who is affected.
- Be precise about scope boundaries. Explicitly state what is out of scope so engineers don't gold-plate or expand the work beyond the intended investment.
- Flag rabbit holes — known technical or UX pitfalls where the team could get stuck. This is not a risk register; these are concrete "watch out for X" warnings.
- Ground the priority in customer impact data, not opinion. State how many customers are affected and what the user impact is. If you'd run a query to find affected users, describe that query.
- Acceptance criteria must be specific and testable. Each one should unambiguously pass or fail — avoid subjective language like "should feel fast."
- Keep the title concise and actionable. Describe what changes, not what the feature is called.

Synthesize the provided feedback data, analytics, and conversation history into a well-structured ticket. Be precise and avoid ambiguity.`;

const SUMMARIZE_FORMAT = `USE THIS EXACT FORMAT:

**[1-2 sentence answer to the question. Be specific.]**

## [Heading]

[1-2 paragraphs. What's new, what changed, what matters. Reference dates.]

> "[direct customer quote if available]" — Customer Name or Email. Source: [Jira CX-123](link) or [Productboard note title](link if available)

| Source | What | When |
| --- | --- | --- |
[max 5 rows. Source must be specific and searchable: include Jira key (prefer link) or Productboard note title (plus link when available). Put customer/email in the quote attribution, not duplicated in Source. Never use generic "Productboard" alone. What = the actual request/issue. When = relative date.]

## Next Steps

1. [owner] [action] [by when]
2. [owner] [action] [by when]
3. [owner] [action] [by when]

CONSTRAINTS: 300 words max. No :--- in tables. No multi-sentence action items. Every quote MUST include a specific, searchable source. Never show an unattributed quote. Do not cite Zapier/portal as the source identity; cite the actual customer identity from the note. Do not duplicate the same name/email in both quote attribution and Source field. When the question asks for specific feedback or ticket details, show the actual content. For "how many"/count questions, start with the numeric count and only say "no data" if there are zero matching items in context. Skip the quote section if none available.`;

const PRD_FORMAT = `Generate a product pitch in markdown using this structure:

# [Outcome-Oriented Title — describe the change you want to see, not the feature to build]

## Problem
Tell the story of what's broken today using a specific customer example from the data. Why does this matter now? What is the cost of inaction — what happens if we don't solve this in the next quarter? Who is affected and how many? Establish a clear baseline so we can judge whether any solution actually improves the status quo.

## Appetite
Suggest a scope constraint: Small Batch (1-2 weeks) or Big Batch (up to 6 weeks). Explain what this time box means for the solution — what level of ambition fits this investment? A better solution always exists; the question is whether THIS solution is good enough for THIS time box.

## Solution
Describe the key elements of the proposed approach at the right level of abstraction — concrete enough that engineers and designers can "get it," but rough enough that they have room to make implementation decisions. Focus on how users will experience the change (flows and affordances), not pixel-level details.

## Rabbit Holes
Call out specific risks, technical complexities, or edge cases worth flagging. These are the parts of the solution where teams could get stuck or waste time if they aren't warned. Include any decisions you've already made to avoid these traps.

## No Gos
Explicitly list what we are NOT doing in this scope. What use cases, features, or user segments are intentionally excluded to fit the appetite? Being clear about boundaries prevents scope creep and keeps the team focused.

## Success Metrics
| Metric | Current Baseline | Target |
| --- | --- | --- |
[Include 3-5 rows. Mix quantitative KPIs with qualitative goals — what should users think, feel, or do differently? If a metric is hard to measure exactly, describe what "awesome" looks like instead.]

## Customer Evidence
Summarize the key feedback themes and volume. Include direct customer quotes with specific source attribution (Jira key, Productboard note title, feedback item). State how many customers raised each theme when the data supports it.

## Open Questions
List unresolved decisions and assumptions that need validation. For each, note who might have the answer or what experiment could close the gap.

CONSTRAINTS: Be thorough but concise. Every claim MUST trace to customer evidence from the provided data. Title must describe an outcome, not a feature. Include direct quotes with source attribution. Rabbit Holes and No Gos sections must not be empty — if there are truly none, explain why.`;

const TICKET_FORMAT = `Generate a structured ticket in markdown using this structure:

## Title
[Concise, actionable — max 80 chars. Describe what changes, not the feature name.]

## Problem
1-2 sentences: what is broken and who is affected. Ground in customer evidence from the data. State how many customers raised this issue when the data supports it.

## Proposed Solution
What to build, at the right level of abstraction. Be concrete enough that an engineer understands the intent, but leave room for implementation decisions. Focus on user-facing behavior, not internal architecture.

## Acceptance Criteria
- [ ] [Specific, testable — should unambiguously pass or fail]
- [ ] [Specific, testable]
- [ ] [Specific, testable]

## Out of Scope
- [What is explicitly excluded from this ticket]
- [Prevents scope creep — list at least one item]

## Rabbit Holes
- [Known risks, technical complexities, or edge cases to watch for]
- [Concrete "watch out for X" warnings, not generic risk statements]

## Priority
[Critical / High / Medium / Low] — [Justification grounded in customer impact and volume. State who is affected and how many.]

## Customer Evidence
- [N customers affected. Direct quote with specific source attribution (Jira key, Productboard note, feedback item)]
- [Additional quotes/references with sources]

CONSTRAINTS: Be concise and actionable. Every acceptance criterion must be testable. Out of Scope and Rabbit Holes must not be empty. Ground priority in customer data. Keep title under 80 characters. Every claim must trace to evidence from the provided data.`;

function generateBuiltInResponse(
  query: string, context: string,
  sources: { type: string; id: string; title: string }[], data: AgentData
): string {
  const total = data.feedback.length + data.features.length + data.calls.length + data.insights.length + data.jiraIssues.length + data.confluencePages.length + data.linearIssues.length;
  const rows = sources.slice(0, 8).map((s) => `| ${s.type} | ${s.title} |`).join("\n");

  return `**Found ${sources.length} relevant items across ${total} total${data.analyticsOverview ? " (plus analytics)" : ""}.**

| Source | Item |
|--------|------|
${rows}

${context.slice(0, 1200)}

---
Connect an AI provider key in Settings for AI-powered analysis.`;
}


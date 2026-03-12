import { InMemoryVectorStore } from "./vector-store";
import { generateWithGemini, isGeminiConfigured } from "./gemini";
import { getRelevantPendoContext, PendoUsageOverview } from "./pendo";
import {
  DEMO_FEEDBACK, DEMO_PRODUCTBOARD_FEATURES, DEMO_ATTENTION_CALLS, DEMO_INSIGHTS,
} from "./demo-data";
import {
  FeedbackItem, ProductboardFeature, AttentionCall, Insight, JiraIssue, ConfluencePage,
} from "./types";
import { ContextMode } from "./api-keys";

export interface AgentKeys {
  geminiKey?: string;
  productboardKey?: string;
  attentionKey?: string;
  pendoKey?: string;
  atlassianDomain?: string;
  atlassianEmail?: string;
  atlassianToken?: string;
}

export interface AgentData {
  feedback: FeedbackItem[];
  features: ProductboardFeature[];
  calls: AttentionCall[];
  insights: Insight[];
  jiraIssues: JiraIssue[];
  confluencePages: ConfluencePage[];
  pendoOverview: PendoUsageOverview | null;
}

export interface ChatResult {
  response: string;
  sources: { type: string; id: string; title: string; url?: string }[];
  tokenEstimate: { input: number; output: number; total: number };
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

function buildStore(data: AgentData): InMemoryVectorStore {
  const store = new InMemoryVectorStore();
  if (data.feedback.length) store.addFeedback(data.feedback);
  if (data.features.length) store.addFeatures(data.features);
  if (data.calls.length) store.addCalls(data.calls);
  if (data.insights.length) store.addInsights(data.insights);
  if (data.jiraIssues.length) store.addJiraIssues(data.jiraIssues);
  if (data.confluencePages.length) store.addConfluencePages(data.confluencePages);
  store.buildIndex();
  return store;
}

export function getDemoData(): AgentData {
  return {
    feedback: DEMO_FEEDBACK, features: DEMO_PRODUCTBOARD_FEATURES,
    calls: DEMO_ATTENTION_CALLS, insights: DEMO_INSIGHTS,
    jiraIssues: [], confluencePages: [], pendoOverview: null,
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
- Confluence pages = INTERNAL DOCUMENTATION. Only reference when the user specifically asks about docs, guides, or internal processes. Don't include in general feedback summaries.
- Pendo = PRODUCT USAGE ANALYTICS. Use it to explain what users/accounts are doing in the product or how engaged they appear, but don't treat usage alone as proof of customer intent.
- Feedback arrives in Productboard through pipelines (Zapier, email, CRM). Zapier/email is the delivery mechanism, NOT the subject. Read the actual TITLE and CONTENT to understand what the customer wants.
- Source is shown in brackets like [Source: productboard] or [Jira CX-1234]. A note titled "Integration Request (Salesforce)" = customer wants Salesforce integration, NOT feedback about Salesforce as a tool.
- Prefer source citations that are directly actionable: Jira key/link, Productboard note link, and customer name/email from the note.
- If the user asks for a number/count/how many, prioritize numeric accuracy over recency and compute from matching items in the provided context.`;

const BROAD_KEYWORDS = ["summary", "overview", "brief", "executive", "all", "comprehensive", "status", "what's happening", "state of", "pulse", "report"];
const CONFLUENCE_KEYWORDS = ["confluence", "docs", "documentation", "guide", "wiki", "internal doc", "runbook", "playbook", "process"];
const ENG_KEYWORDS = ["engineering", "eng ticket", "eng-", "development", "sprint", "what's being built", "implementation", "technical"];
const COUNT_KEYWORDS = ["how many", "number of", "count", "total", "how much"];
const FOLLOW_UP_KEYWORDS = ["both", "either", "them", "those", "that", "these", "it", "same"];
const INSIGHT_DRILLDOWN_KEYWORDS = ["tell me more about", "tell me more", "deep dive", "drill down", "more detail", "more context"];
const PENDO_KEYWORDS = ["pendo", "usage", "activity", "history", "adoption", "behavior", "journey", "what are they doing", "what is this user doing", "what's this user doing", "engagement", "visited", "using the product"];

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

function wantsPendoContext(query: string): boolean {
  const q = query.toLowerCase();
  if (q.includes("pendo")) return true;
  return PENDO_KEYWORDS.some((kw) => q.includes(kw));
}

function isLikelyFollowUp(query: string): boolean {
  const q = query.toLowerCase();
  const hasFollowUpWord = FOLLOW_UP_KEYWORDS.some((kw) => q.includes(kw));
  const startsWithContinuation = /^(and|also|what about|how about|those|them|it)\b/.test(q.trim());
  return hasFollowUpWord || startsWithContinuation;
}

function buildSearchQueries(
  userMessage: string,
  conversationHistory: { role: "user" | "assistant"; content: string }[],
  includeHistory: boolean
): string[] {
  const queries = [userMessage.trim()];
  if (!includeHistory) return queries;

  const priorUserTurns = conversationHistory
    .filter((m) => m.role === "user")
    .map((m) => m.content.trim())
    .filter(Boolean);

  const lastUserTurn = priorUserTurns[priorUserTurns.length - 1];
  if (!lastUserTurn) return queries;

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

function buildStatsHeader(data: AgentData): string {
  const { feedback, features, calls, insights, jiraIssues, confluencePages, pendoOverview } = data;
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

  if (calls.length > 0) parts.push(temporalSummary(calls as unknown as Record<string, unknown>[], "Calls"));
  if (confluencePages.length > 0) parts.push(`Confluence: ${confluencePages.length} pages`);
  if (insights.length > 0) parts.push(`Insights: ${insights.length}`);
  if (pendoOverview) {
    const pageHotspots = pendoOverview.activePages.slice(0, 3).map((p) => `${p.name} (${p.totalEvents})`).join(", ");
    const featureHotspots = pendoOverview.activeFeatures.slice(0, 3).map((f) => `${f.name} (${f.totalEvents})`).join(", ");
    parts.push(`Pendo: ${pendoOverview.totalPages} tagged pages, ${pendoOverview.totalFeatures} tagged features.`);
    if (pageHotspots) parts.push(`Pendo top pages (last 7d): ${pageHotspots}`);
    if (featureHotspots) parts.push(`Pendo top features (last 7d): ${featureHotspots}`);
  }

  const recentThemes = topThemesRecent(feedback, 14);
  if (recentThemes) parts.push(recentThemes);

  const allTimeThemes = topThemesRecent(feedback, 365);
  if (allTimeThemes && recentThemes !== allTimeThemes) parts.push(allTimeThemes.replace(`last 365d`, "all-time"));

  return parts.join("\n");
}

function buildFocusedContext(data: AgentData, searchResults: string): string {
  const parts: string[] = [];
  parts.push(buildStatsHeader(data));
  parts.push(`\n---\nRelevant items:\n${searchResults || "(No matches)"}`);
  return parts.join("\n");
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

function buildStandardContext(data: AgentData, searchResults: string, includeEng = false, includeConfluence = false): string {
  const parts: string[] = [];
  parts.push(buildStatsHeader(data));

  const recentFb = recentItems(data.feedback, 10);
  if (recentFb.length > 0) {
    parts.push(`\nRecent customer feedback (${recentFb.length} of ${data.feedback.length}):`);
    for (const fb of recentFb) {
      const when = shortDate(fb as unknown as Record<string, unknown>);
      parts.push(`- [${when}] ${fb.title} [${fb.source}/${fb.priority}] ${fb.customer}${fb.company ? ` @ ${fb.company}` : ""}`);
    }
  }

  if (data.features.length > 0) {
    const top = [...data.features].sort((a, b) => b.votes - a.votes).slice(0, 5);
    parts.push(`\nTop features: ${top.map((f) => `${f.name} (${f.votes}v, ${f.status})`).join("; ")}`);
  }

  const jiraFiltered = filterJiraForContext(data.jiraIssues, includeEng);
  if (jiraFiltered.length > 0) {
    const recent = recentItems(jiraFiltered, 8);
    const label = includeEng ? "Jira" : "Jira (CX/customer)";
    parts.push(`\nRecent ${label} (${recent.length} of ${jiraFiltered.length}):`);
    for (const j of recent) {
      const when = shortDate(j as unknown as Record<string, unknown>);
      parts.push(`- [${when}] ${j.key} ${j.summary} [${j.status}/${j.priority}]`);
    }
  }

  if (includeConfluence && data.confluencePages.length > 0) {
    parts.push(`\nConfluence (${data.confluencePages.length} pages): ${data.confluencePages.slice(0, 5).map((p) => p.title).join(", ")}`);
  }

  parts.push(`\n---\nSearch results:\n${searchResults || "(No matches)"}`);
  return parts.join("\n");
}

function buildDeepContext(data: AgentData, searchResults: string, includeEng = false, includeConfluence = false): string {
  const parts: string[] = [];
  parts.push(buildStatsHeader(data));

  const recentFb = recentItems(data.feedback, 25);
  if (recentFb.length > 0) {
    parts.push(`\nCustomer feedback (${recentFb.length} of ${data.feedback.length}):`);
    for (const fb of recentFb) {
      const when = shortDate(fb as unknown as Record<string, unknown>);
      parts.push(`- [${when}] **${fb.title}** [${fb.source}/${fb.priority}] ${fb.customer}${fb.company ? ` @ ${fb.company}` : ""}: ${fb.content.slice(0, 100)}`);
    }
  }

  if (data.features.length > 0) {
    const active = data.features.filter((f) => f.status === "in_progress" || f.status === "planned");
    const top = [...data.features].sort((a, b) => b.votes - a.votes).slice(0, 8);
    parts.push(`\nFeatures (${active.length} active of ${data.features.length}):`);
    for (const f of top) parts.push(`- ${f.name} — ${f.status}, ${f.votes} votes`);
  }

  const jiraFiltered = filterJiraForContext(data.jiraIssues, includeEng);
  if (jiraFiltered.length > 0) {
    const recent = recentItems(jiraFiltered, 12);
    const label = includeEng ? "Jira (all)" : "Jira (CX/customer)";
    parts.push(`\n${label} (${recent.length} of ${jiraFiltered.length}):`);
    for (const j of recent) {
      const when = shortDate(j as unknown as Record<string, unknown>);
      parts.push(`- [${when}] ${j.key} ${j.summary} [${j.status}/${j.issueType}/${j.priority}] → ${j.assignee}`);
    }
  }

  if (data.calls.length > 0) {
    const recent = recentItems(data.calls, 3);
    parts.push(`\nCalls:`);
    for (const c of recent) parts.push(`- [${shortDate(c as unknown as Record<string, unknown>)}] ${c.title} — ${c.summary.slice(0, 100)}`);
  }

  if (includeConfluence && data.confluencePages.length > 0) {
    parts.push(`\nConfluence (${data.confluencePages.length} pages): ${data.confluencePages.slice(0, 5).map((p) => p.title).join(", ")}${data.confluencePages.length > 5 ? ` +${data.confluencePages.length - 5} more` : ""}`);
  }

  if (data.insights.length > 0) {
    parts.push(`\nInsights:`);
    for (const i of data.insights.slice(0, 4)) parts.push(`- [${i.type}] ${i.title}`);
  }

  parts.push(`\n---\nSearch results:\n${searchResults || "(No matches)"}`);
  return parts.join("\n");
}

export async function chat(
  userMessage: string,
  conversationHistory: { role: "user" | "assistant"; content: string }[],
  data: AgentData,
  keys: AgentKeys = {},
  contextMode: ContextMode = "focused"
): Promise<ChatResult> {
  const store = buildStore(data);
  const countQuery = wantsCount(userMessage);
  const drilldownQuery = wantsInsightDrilldown(userMessage);
  const baseSearchLimit = contextMode === "focused" ? 10 : contextMode === "standard" ? 15 : 20;
  const searchLimit = countQuery || drilldownQuery ? Math.max(baseSearchLimit * 3, 30) : baseSearchLimit;
  const searchQueries = buildSearchQueries(userMessage, conversationHistory, countQuery || drilldownQuery || isLikelyFollowUp(userMessage));

  const merged = new Map<string, { document: (ReturnType<InMemoryVectorStore["search"]>[number])["document"]; score: number }>();
  for (const q of searchQueries) {
    for (const r of store.search(q, { limit: searchLimit })) {
      const key = `${r.document.type}:${r.document.id}`;
      const existing = merged.get(key);
      if (!existing || r.score > existing.score) merged.set(key, r);
    }
  }
  const rawResults = Array.from(merged.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, searchLimit);

  const includeConfluence = wantsConfluence(userMessage);
  const includeEng = wantsEngineering(userMessage);

  const results = rawResults.filter((r) => {
    if (r.document.type === "confluence" && !includeConfluence) return false;
    if (r.document.type === "jira") {
      const j = data.jiraIssues.find((j) => j.id === r.document.id);
      if (j && /^ENG-/i.test(j.key) && !includeEng) return false;
    }
    return true;
  });

  const relatedFeedback = results
    .filter((r) => r.document.type === "feedback")
    .map((r) => data.feedback.find((f) => f.id === r.document.id))
    .filter((item): item is FeedbackItem => !!item);

  const pendoLookup = wantsPendoContext(userMessage)
    ? await getRelevantPendoContext(userMessage, relatedFeedback, keys.pendoKey)
    : null;

  const sources: { type: string; id: string; title: string; url?: string }[] = [];
  const searchParts: string[] = [];
  const detailed = wantsDetail(userMessage) || drilldownQuery;

  for (const r of results) {
    const doc = r.document;
    const details = lookupDetails([doc.id], data, detailed, keys);
    if (details.length > 0) searchParts.push(details[0]);

    let title = doc.id;
    let url: string | undefined;
    if (doc.type === "feedback") {
      const fb = data.feedback.find((f) => f.id === doc.id);
      const email = fb?.metadata?.userEmail || (fb?.customer && /\S+@\S+/.test(fb.customer) ? fb.customer : "");
      const contact = email || fb?.customer || fb?.company || "";
      title = fb ? `${cleanFeedbackTitle(fb)}${contact ? ` — ${contact}` : ""}` : title;
      if (fb?.metadata?.sourceUrl) url = fb.metadata.sourceUrl;
    } else if (doc.type === "feature") {
      title = data.features.find((f) => f.id === doc.id)?.name || title;
    } else if (doc.type === "call") {
      title = data.calls.find((c) => c.id === doc.id)?.title || title;
    } else if (doc.type === "insight") {
      title = data.insights.find((i) => i.id === doc.id)?.title || title;
    } else if (doc.type === "jira") {
      const j = data.jiraIssues.find((j) => j.id === doc.id);
      if (j) {
        title = `${j.key}: ${j.summary}`;
        const domain = keys.atlassianDomain || process.env.ATLASSIAN_DOMAIN || "";
        if (domain) url = `https://${domain.replace(/\.atlassian\.net\/?$/, "")}.atlassian.net/browse/${j.key}`;
      }
    } else if (doc.type === "confluence") {
      const p = data.confluencePages.find((p) => p.id === doc.id);
      if (p) { title = p.title; url = p.url; }
    }
    sources.push({ type: doc.type, id: doc.id, title, url });
  }

  if (pendoLookup?.sources.length) {
    for (const source of pendoLookup.sources) {
      sources.push(source);
    }
  }

  const matchedInsightIds = results.filter((r) => r.document.type === "insight").map((r) => r.document.id);
  const drilldownContext = buildInsightDrilldownContext(userMessage, data, matchedInsightIds, keys);
  const searchContext = [searchParts.join("\n"), drilldownContext, pendoLookup?.context || ""].filter(Boolean).join("\n");

  const effectiveMode =
    (countQuery || drilldownQuery) && contextMode === "focused"
      ? "deep"
      : isBroadQuery(userMessage) && contextMode === "focused"
        ? "standard"
        : contextMode;

  let context: string;
  switch (effectiveMode) {
    case "deep": context = buildDeepContext(data, searchContext, includeEng, includeConfluence); break;
    case "standard": context = buildStandardContext(data, searchContext, includeEng, includeConfluence); break;
    default: context = buildFocusedContext(data, searchContext);
  }

  const total = data.feedback.length + data.features.length + data.calls.length + data.insights.length + data.jiraIssues.length + data.confluencePages.length + (data.pendoOverview ? data.pendoOverview.totalPages + data.pendoOverview.totalFeatures : 0);

  const historyText = conversationHistory
    .slice(-3)
    .map((m) => `${m.role === "user" ? "Q" : "A"}: ${m.content.slice(0, 200)}`)
    .join("\n");

  const prompt = `${context}
${historyText ? `\nHistory:\n${historyText}\n` : ""}
Q: ${userMessage}

USE THIS EXACT FORMAT:

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

  const inputTokens = estimateTokens(SYSTEM_PROMPT) + estimateTokens(prompt);

  if (isGeminiConfigured(keys.geminiKey)) {
    const geminiResponse = await generateWithGemini(SYSTEM_PROMPT, prompt, keys.geminiKey);
    if (geminiResponse) {
      const outputTokens = estimateTokens(geminiResponse);
      return {
        response: geminiResponse,
        sources,
        tokenEstimate: { input: inputTokens, output: outputTokens, total: inputTokens + outputTokens },
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

  const builtIn = generateBuiltInResponse(userMessage, searchContext, sources, data);
  return { response: builtIn, sources, tokenEstimate: { input: 0, output: 0, total: 0 } };
}

function generateBuiltInResponse(
  query: string, context: string,
  sources: { type: string; id: string; title: string }[], data: AgentData
): string {
  const total = data.feedback.length + data.features.length + data.calls.length + data.insights.length + data.jiraIssues.length + data.confluencePages.length + (data.pendoOverview ? data.pendoOverview.totalPages + data.pendoOverview.totalFeatures : 0);
  const rows = sources.slice(0, 8).map((s) => `| ${s.type} | ${s.title} |`).join("\n");

  return `**Found ${sources.length} relevant items across ${total} total.**

| Source | Item |
|--------|------|
${rows}

${context.slice(0, 1200)}

---
Connect your Gemini API key in Settings for AI-powered analysis.`;
}

export function getInsights(useDemoData = true): Insight[] {
  return useDemoData ? DEMO_INSIGHTS : [];
}

export function searchFeedback(
  query: string, data: AgentData, options?: { limit?: number; type?: string }
): { type: string; id: string; title: string; score: number }[] {
  const store = buildStore(data);
  return store.search(query, {
    limit: options?.limit || 10,
    type: options?.type as "feedback" | "feature" | "call" | "insight" | "jira" | "confluence" | undefined,
  }).map((r) => {
    let title = r.document.id;
    if (r.document.type === "feedback") title = data.feedback.find((f) => f.id === r.document.id)?.title || title;
    else if (r.document.type === "feature") title = data.features.find((f) => f.id === r.document.id)?.name || title;
    else if (r.document.type === "call") title = data.calls.find((c) => c.id === r.document.id)?.title || title;
    else if (r.document.type === "insight") title = data.insights.find((i) => i.id === r.document.id)?.title || title;
    else if (r.document.type === "jira") { const j = data.jiraIssues.find((j) => j.id === r.document.id); title = j ? `${j.key}: ${j.summary}` : title; }
    else if (r.document.type === "confluence") title = data.confluencePages.find((p) => p.id === r.document.id)?.title || title;
    return { type: r.document.type, id: r.document.id, title, score: r.score };
  });
}

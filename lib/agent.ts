import { InMemoryVectorStore } from "./vector-store";
import { generateWithGemini, isGeminiConfigured } from "./gemini";
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
}

export interface ChatResult {
  response: string;
  sources: { type: string; id: string; title: string }[];
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
    jiraIssues: [], confluencePages: [],
  };
}

function lookupDetails(ids: string[], data: AgentData): string[] {
  const details: string[] = [];
  for (const id of ids) {
    const fb = data.feedback.find((f) => f.id === id);
    if (fb) { details.push(`[Feedback] ${fb.title} — ${fb.customer}${fb.company ? ` (${fb.company})` : ""}: ${fb.content.slice(0, 150)}`); continue; }
    const feat = data.features.find((f) => f.id === id);
    if (feat) { details.push(`[Feature] ${feat.name} — ${feat.status}, ${feat.votes} votes`); continue; }
    const call = data.calls.find((c) => c.id === id);
    if (call) { details.push(`[Call] ${call.title} (${call.date}) — ${call.summary.slice(0, 150)}`); continue; }
    const insight = data.insights.find((i) => i.id === id);
    if (insight) { details.push(`[Insight] ${insight.title} — ${insight.description.slice(0, 150)}`); continue; }
    const jira = data.jiraIssues.find((j) => j.id === id);
    if (jira) { details.push(`[Jira ${jira.key}] ${jira.summary} — ${jira.status}/${jira.priority}, ${jira.assignee}`); continue; }
    const page = data.confluencePages.find((p) => p.id === id);
    if (page) { details.push(`[Confluence] ${page.title} — ${page.space}`); }
  }
  return details;
}

const SYSTEM_PROMPT = `You are a concise Customer Feedback Intelligence Agent.

HARD RULES (violating any = bad response):
- MAXIMUM 400 words. Count them. Stop at 400.
- First line: bold 1-2 sentence TL;DR
- Tables: simple format only. | Header | Header | then | --- | --- | then rows. NO colon alignment.
- Max 2 headings (##). Don't over-structure short responses.
- NEVER list more than 5 items. If more, say "and X more".
- End with exactly 3 numbered action items, one line each.
- No filler phrases. Jump straight to insights.

ANALYSIS RULES:
- Synthesize patterns. Do NOT walk through items one by one.
- Lead with impact, not description.
- Cross-reference sources when possible.
- Be opinionated about what matters most.`;

const BROAD_KEYWORDS = ["summary", "overview", "brief", "executive", "all", "comprehensive", "status", "what's happening", "state of", "pulse", "report"];

function isBroadQuery(query: string): boolean {
  const q = query.toLowerCase();
  return BROAD_KEYWORDS.some((kw) => q.includes(kw));
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

function buildStatsHeader(data: AgentData): string {
  const { feedback, features, calls, insights, jiraIssues, confluencePages } = data;
  const parts: string[] = [];
  parts.push(`Data: ${feedback.length} feedback, ${features.length} features, ${calls.length} calls, ${jiraIssues.length} Jira, ${confluencePages.length} Confluence, ${insights.length} insights`);

  if (features.length > 0) {
    const byStatus: Record<string, number> = {};
    for (const f of features) byStatus[f.status] = (byStatus[f.status] || 0) + 1;
    parts.push(`Features: ${Object.entries(byStatus).map(([s, c]) => `${s}: ${c}`).join(", ")}`);
  }
  if (jiraIssues.length > 0) {
    const byStatus: Record<string, number> = {};
    for (const j of jiraIssues) byStatus[j.status] = (byStatus[j.status] || 0) + 1;
    parts.push(`Jira: ${Object.entries(byStatus).sort(([,a],[,b]) => b - a).slice(0, 6).map(([s, c]) => `${s}: ${c}`).join(", ")}`);
  }
  return parts.join("\n");
}

function buildFocusedContext(data: AgentData, searchResults: string): string {
  const parts: string[] = [];
  parts.push(buildStatsHeader(data));
  parts.push(`\n---\nRelevant items:\n${searchResults || "(No matches)"}`);
  return parts.join("\n");
}

function buildStandardContext(data: AgentData, searchResults: string): string {
  const parts: string[] = [];
  parts.push(buildStatsHeader(data));

  const recentFb = recentItems(data.feedback, 10);
  if (recentFb.length > 0) {
    parts.push(`\nRecent feedback (${recentFb.length} of ${data.feedback.length}):`);
    for (const fb of recentFb) parts.push(`- ${fb.title} [${fb.source}/${fb.priority}] ${fb.customer}${fb.company ? ` @ ${fb.company}` : ""}`);
  }

  if (data.features.length > 0) {
    const top = [...data.features].sort((a, b) => b.votes - a.votes).slice(0, 5);
    parts.push(`\nTop features: ${top.map((f) => `${f.name} (${f.votes}v, ${f.status})`).join("; ")}`);
  }

  if (data.jiraIssues.length > 0) {
    const recent = recentItems(data.jiraIssues, 8);
    parts.push(`\nRecent Jira (${recent.length} of ${data.jiraIssues.length}):`);
    for (const j of recent) parts.push(`- ${j.key} ${j.summary} [${j.status}/${j.priority}]`);
  }

  parts.push(`\n---\nSearch results:\n${searchResults || "(No matches)"}`);
  return parts.join("\n");
}

function buildDeepContext(data: AgentData, searchResults: string): string {
  const parts: string[] = [];
  parts.push(buildStatsHeader(data));

  const recentFb = recentItems(data.feedback, 25);
  if (recentFb.length > 0) {
    parts.push(`\nFeedback (${recentFb.length} of ${data.feedback.length}):`);
    for (const fb of recentFb) parts.push(`- **${fb.title}** [${fb.source}/${fb.priority}] ${fb.customer}${fb.company ? ` @ ${fb.company}` : ""}: ${fb.content.slice(0, 100)}`);
  }

  if (data.features.length > 0) {
    const active = data.features.filter((f) => f.status === "in_progress" || f.status === "planned");
    const top = [...data.features].sort((a, b) => b.votes - a.votes).slice(0, 8);
    parts.push(`\nFeatures (${active.length} active of ${data.features.length}):`);
    for (const f of top) parts.push(`- ${f.name} — ${f.status}, ${f.votes} votes`);
  }

  if (data.jiraIssues.length > 0) {
    const recent = recentItems(data.jiraIssues, 12);
    parts.push(`\nJira (${recent.length} of ${data.jiraIssues.length}):`);
    for (const j of recent) parts.push(`- ${j.key} ${j.summary} [${j.status}/${j.issueType}/${j.priority}] → ${j.assignee}`);
  }

  if (data.calls.length > 0) {
    const recent = recentItems(data.calls, 3);
    parts.push(`\nCalls:`);
    for (const c of recent) parts.push(`- ${c.title} (${c.date}) — ${c.summary.slice(0, 100)}`);
  }

  if (data.confluencePages.length > 0) {
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
  const searchLimit = contextMode === "focused" ? 8 : contextMode === "standard" ? 12 : 15;
  const results = store.search(userMessage, { limit: searchLimit });

  const sources: { type: string; id: string; title: string }[] = [];
  const searchParts: string[] = [];

  for (const r of results) {
    const doc = r.document;
    const details = lookupDetails([doc.id], data);
    if (details.length > 0) searchParts.push(details[0]);

    let title = doc.id;
    if (doc.type === "feedback") title = data.feedback.find((f) => f.id === doc.id)?.title || title;
    else if (doc.type === "feature") title = data.features.find((f) => f.id === doc.id)?.name || title;
    else if (doc.type === "call") title = data.calls.find((c) => c.id === doc.id)?.title || title;
    else if (doc.type === "insight") title = data.insights.find((i) => i.id === doc.id)?.title || title;
    else if (doc.type === "jira") { const j = data.jiraIssues.find((j) => j.id === doc.id); title = j ? `${j.key}: ${j.summary}` : title; }
    else if (doc.type === "confluence") title = data.confluencePages.find((p) => p.id === doc.id)?.title || title;
    sources.push({ type: doc.type, id: doc.id, title });
  }

  const searchContext = searchParts.join("\n");

  const effectiveMode = isBroadQuery(userMessage) && contextMode === "focused" ? "standard" : contextMode;

  let context: string;
  switch (effectiveMode) {
    case "deep": context = buildDeepContext(data, searchContext); break;
    case "standard": context = buildStandardContext(data, searchContext); break;
    default: context = buildFocusedContext(data, searchContext);
  }

  const total = data.feedback.length + data.features.length + data.calls.length + data.insights.length + data.jiraIssues.length + data.confluencePages.length;

  const historyText = conversationHistory
    .slice(-3)
    .map((m) => `${m.role === "user" ? "Q" : "A"}: ${m.content.slice(0, 200)}`)
    .join("\n");

  const prompt = `${context}
${historyText ? `\nHistory:\n${historyText}\n` : ""}
Q: ${userMessage}

400 words max. TL;DR first. Tables for 3+ items. 3 action items.`;

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
  const total = data.feedback.length + data.features.length + data.calls.length + data.insights.length + data.jiraIssues.length + data.confluencePages.length;
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

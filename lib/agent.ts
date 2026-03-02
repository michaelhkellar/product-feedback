import { InMemoryVectorStore } from "./vector-store";
import { generateWithGemini, isGeminiConfigured } from "./gemini";
import {
  DEMO_FEEDBACK,
  DEMO_PRODUCTBOARD_FEATURES,
  DEMO_ATTENTION_CALLS,
  DEMO_INSIGHTS,
} from "./demo-data";
import {
  FeedbackItem,
  ProductboardFeature,
  AttentionCall,
  Insight,
  JiraIssue,
  ConfluencePage,
} from "./types";

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
    feedback: DEMO_FEEDBACK,
    features: DEMO_PRODUCTBOARD_FEATURES,
    calls: DEMO_ATTENTION_CALLS,
    insights: DEMO_INSIGHTS,
    jiraIssues: [],
    confluencePages: [],
  };
}

function lookupDetails(ids: string[], data: AgentData): string[] {
  const details: string[] = [];
  for (const id of ids) {
    const fb = data.feedback.find((f) => f.id === id);
    if (fb) { details.push(`[Feedback: ${fb.title}] ${fb.customer}${fb.company ? ` (${fb.company})` : ""} — ${fb.content.slice(0, 200)}`); continue; }
    const feat = data.features.find((f) => f.id === id);
    if (feat) { details.push(`[Feature: ${feat.name}] ${feat.status}, ${feat.votes} votes — ${feat.description.slice(0, 200)}`); continue; }
    const call = data.calls.find((c) => c.id === id);
    if (call) { details.push(`[Call: ${call.title}] ${call.date} — ${call.summary.slice(0, 200)}`); continue; }
    const insight = data.insights.find((i) => i.id === id);
    if (insight) { details.push(`[Insight: ${insight.title}] ${insight.description.slice(0, 200)}`); continue; }
    const jira = data.jiraIssues.find((j) => j.id === id);
    if (jira) { details.push(`[Jira ${jira.key}: ${jira.summary}] ${jira.status}, ${jira.issueType}, assigned: ${jira.assignee}`); continue; }
    const page = data.confluencePages.find((p) => p.id === id);
    if (page) { details.push(`[Confluence: ${page.title}] Space: ${page.space} — ${page.excerpt.slice(0, 200)}`); }
  }
  return details;
}

const SYSTEM_PROMPT = `You are an expert Customer Feedback Intelligence Agent for a SaaS company.

You have access to: customer feedback, Productboard features, Attention calls, Jira tickets, and Confluence pages.

**CRITICAL FORMATTING RULES — follow these on EVERY response:**

1. **Start with a 2-sentence TL;DR** in bold
2. **Keep total response under 600 words** — be ruthlessly concise
3. **Use tables** for any list of 3+ items (accounts, issues, features)
4. **Max 3 section headers** — don't over-segment
5. **No item-by-item walkthroughs** — synthesize patterns, don't enumerate every data point
6. **End with 3-5 numbered action items** — each one line with owner and timeline
7. **Bold key numbers** ($revenue, counts, dates)

**Analysis approach:**
- Synthesize themes across data points — don't list each item individually
- Lead with the "so what" — impact and action, not description
- Quantify: revenue at risk, customer count, time urgency
- Cross-reference across sources (feedback → feature → Jira ticket)
- Be opinionated about priorities`;

function buildContextFromSearch(
  query: string,
  data: AgentData,
  store: InMemoryVectorStore
): { context: string; sources: { type: string; id: string; title: string }[] } {
  const results = store.search(query, { limit: 15 });
  const sources: { type: string; id: string; title: string }[] = [];
  const contextParts: string[] = [];

  for (const r of results) {
    const doc = r.document;
    const fullDetails = lookupDetails([doc.id], data);
    if (fullDetails.length > 0) contextParts.push(fullDetails[0]);

    let title = doc.id;
    if (doc.type === "feedback") title = data.feedback.find((f) => f.id === doc.id)?.title || title;
    else if (doc.type === "feature") title = data.features.find((f) => f.id === doc.id)?.name || title;
    else if (doc.type === "call") title = data.calls.find((c) => c.id === doc.id)?.title || title;
    else if (doc.type === "insight") title = data.insights.find((i) => i.id === doc.id)?.title || title;
    else if (doc.type === "jira") { const j = data.jiraIssues.find((j) => j.id === doc.id); title = j ? `${j.key}: ${j.summary}` : title; }
    else if (doc.type === "confluence") title = data.confluencePages.find((p) => p.id === doc.id)?.title || title;

    sources.push({ type: doc.type, id: doc.id, title });
  }

  return { context: contextParts.join("\n"), sources };
}

function buildCompactContext(data: AgentData): string {
  const parts: string[] = [];
  const { feedback, features, calls, insights, jiraIssues, confluencePages } = data;
  const total = feedback.length + features.length + calls.length + insights.length + jiraIssues.length + confluencePages.length;

  if (total === 0) return "No data loaded. User needs to configure API keys or enable demo data.";

  parts.push(`**Data available:** ${feedback.length} feedback, ${features.length} features, ${calls.length} calls, ${jiraIssues.length} Jira issues, ${confluencePages.length} Confluence pages, ${insights.length} insights\n`);

  if (feedback.length > 0) {
    parts.push(`## Recent Feedback (showing ${Math.min(feedback.length, 30)} of ${feedback.length})`);
    for (const fb of feedback.slice(0, 30)) {
      parts.push(`- **${fb.title}** [${fb.source}/${fb.priority}] ${fb.customer}${fb.company ? ` @ ${fb.company}` : ""}: ${fb.content.slice(0, 150)}`);
    }
  }

  if (features.length > 0) {
    const active = features.filter((f) => f.status === "in_progress" || f.status === "planned");
    const topVoted = [...features].sort((a, b) => b.votes - a.votes).slice(0, 10);
    parts.push(`\n## Features (${active.length} active of ${features.length} total)`);
    parts.push("Top by votes:");
    for (const f of topVoted) {
      parts.push(`- **${f.name}** — ${f.status}, ${f.votes} votes`);
    }
  }

  if (jiraIssues.length > 0) {
    const byStatus: Record<string, number> = {};
    const byType: Record<string, number> = {};
    for (const j of jiraIssues) {
      byStatus[j.status] = (byStatus[j.status] || 0) + 1;
      byType[j.issueType] = (byType[j.issueType] || 0) + 1;
    }
    parts.push(`\n## Jira (${jiraIssues.length} issues)`);
    parts.push(`By status: ${Object.entries(byStatus).sort(([,a],[,b]) => b - a).slice(0, 8).map(([s, c]) => `${s}: ${c}`).join(", ")}`);
    parts.push(`By type: ${Object.entries(byType).sort(([,a],[,b]) => b - a).map(([t, c]) => `${t}: ${c}`).join(", ")}`);
    parts.push("Recent/important:");
    for (const j of jiraIssues.slice(0, 15)) {
      parts.push(`- **${j.key}** ${j.summary} [${j.status}/${j.issueType}/${j.priority}] → ${j.assignee}`);
    }
  }

  if (calls.length > 0) {
    parts.push(`\n## Calls (${calls.length})`);
    for (const c of calls.slice(0, 5)) {
      parts.push(`- **${c.title}** (${c.date}) — ${c.summary.slice(0, 120)}`);
    }
  }

  if (confluencePages.length > 0) {
    parts.push(`\n## Confluence (${confluencePages.length} pages)`);
    for (const p of confluencePages.slice(0, 10)) {
      parts.push(`- **${p.title}** [${p.space}] — ${p.excerpt.slice(0, 100)}`);
    }
  }

  if (insights.length > 0) {
    parts.push(`\n## Insights (${insights.length})`);
    for (const i of insights.slice(0, 5)) {
      parts.push(`- [${i.type}/${i.impact}] **${i.title}**: ${i.description.slice(0, 120)}`);
    }
  }

  return parts.join("\n");
}

export async function chat(
  userMessage: string,
  conversationHistory: { role: "user" | "assistant"; content: string }[],
  data: AgentData,
  keys: AgentKeys = {}
): Promise<{
  response: string;
  sources: { type: string; id: string; title: string }[];
}> {
  const store = buildStore(data);
  const { context: searchContext, sources } = buildContextFromSearch(userMessage, data, store);
  const compactContext = buildCompactContext(data);
  const total = data.feedback.length + data.features.length + data.calls.length + data.insights.length + data.jiraIssues.length + data.confluencePages.length;

  const historyText = conversationHistory
    .slice(-4)
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.slice(0, 300)}`)
    .join("\n\n");

  const enrichedPrompt = `DATABASE (${total} items):

${compactContext}

---
SEARCH RESULTS for "${userMessage}":

${searchContext || "(No exact matches)"}

---
CONVERSATION:
${historyText}

---
USER QUESTION: ${userMessage}

Remember: max 600 words, start with TL;DR, use tables, end with action items.`;

  if (isGeminiConfigured(keys.geminiKey)) {
    const geminiResponse = await generateWithGemini(SYSTEM_PROMPT, enrichedPrompt, keys.geminiKey);
    if (geminiResponse) return { response: geminiResponse, sources };
  }

  if (total === 0) {
    return {
      response: `I don't have any data loaded right now. To get started:\n\n1. **Add API keys** in Settings (gear icon) to connect live data\n2. **Enable demo data** in Settings to explore with sample data`,
      sources: [],
    };
  }

  return { response: generateBuiltInResponse(userMessage, searchContext, sources, data), sources };
}

function generateBuiltInResponse(
  query: string,
  context: string,
  sources: { type: string; id: string; title: string }[],
  data: AgentData
): string {
  const total = data.feedback.length + data.features.length + data.calls.length + data.insights.length + data.jiraIssues.length + data.confluencePages.length;

  const searchResults = sources.slice(0, 8).map((s) => `| ${s.type} | ${s.title} |`).join("\n");

  return `**Found ${sources.length} relevant items across ${total} total in your database.**

| Source | Item |
|--------|------|
${searchResults}

### Key Context

${context.slice(0, 1500)}

---

**Next steps:** Connect your Gemini API key in Settings for deeper AI-powered analysis, or try more specific queries like "What Jira tickets are blocking?" or "Summarize recent customer churn signals."`;
}

export function getInsights(useDemoData = true): Insight[] {
  return useDemoData ? DEMO_INSIGHTS : [];
}

export function searchFeedback(
  query: string,
  data: AgentData,
  options?: { limit?: number; type?: string }
): { type: string; id: string; title: string; score: number }[] {
  const store = buildStore(data);
  const results = store.search(query, {
    limit: options?.limit || 10,
    type: options?.type as "feedback" | "feature" | "call" | "insight" | "jira" | "confluence" | undefined,
  });

  return results.map((r) => {
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

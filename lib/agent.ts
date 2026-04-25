import { InMemoryVectorStore } from "./vector-store";
import { getAIProvider, isAnyAIConfigured, resolveAIKey, AIProviderType, ToolDefinition } from "./ai-provider";
import { CHAT } from "./ai-presets";
import { shouldRerank, rerankResults } from "./reranker";
import { clusterFeedback, annotateClusters } from "./clustering";
import { getRelevantPendoContext, getFullPendoAnalytics } from "./pendo";
import { getRelevantAmplitudeContext, getFullAmplitudeAnalytics } from "./amplitude";
import { getRelevantPostHogContext, getFullPostHogAnalytics } from "./posthog";
import {
  DEMO_FEEDBACK, DEMO_PRODUCTBOARD_FEATURES, DEMO_ATTENTION_CALLS, DEMO_INSIGHTS,
  DEMO_JIRA_ISSUES, DEMO_CONFLUENCE_PAGES, DEMO_PENDO_OVERVIEW,
} from "./demo-data";
import {
  FeedbackItem, ProductboardFeature, AttentionCall, Insight, JiraIssue, ConfluencePage,
  AnalyticsOverview, FullAnalyticsResult, LinearIssue, FollowupSuggestion,
} from "./types";
import { ContextMode } from "./api-keys";
import { searchWeb } from "./web-search";
import { enrichSubset } from "./enrichment";
import { cleanResponseTables } from "./response-cleaner";
import { synthesizeAnalyticsDocs } from "./analytics-docs";
import { scoreDoc } from "./signal-score";
import { ThreadState, updateState } from "./conversation-state";
import { AGENT_TOOLS, runTool, ToolContext } from "./agent-tools";
import { findContradictions, Contradiction } from "./contradictions";
import type { ChatFilters } from "./types";

// "learn" is internal — surfaced as "Catch Up" in the UI
export type InteractionMode = "summarize" | "prd" | "ticket" | "learn";

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
  braveSearchKey?: string;
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
  aiError?: boolean;
  toolCalls?: { name: string; query: string; resultCount: number }[];
}

export interface ChatResult {
  response: string;
  sources: { type: string; id: string; title: string; url?: string }[];
  tokenEstimate: { input: number; output: number; total: number };
  trace?: ChatTrace;
  followupSuggestions?: FollowupSuggestion[];
  updatedState?: ThreadState;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

let cachedStore: { fingerprint: string; store: InMemoryVectorStore; embeddingMap: Map<string, number[]> } | null = null;

function pickEmbedder(keys: AgentKeys): { provider: ReturnType<typeof getAIProvider>; key: string | undefined; id: string } | null {
  const aiProvider = keys.aiProvider || "gemini";
  const primaryProvider = getAIProvider(aiProvider);
  const primaryKey = resolveAIKey(aiProvider, keys.geminiKey, keys.anthropicKey, keys.openaiKey);
  if (primaryProvider.embed && primaryProvider.isConfigured(primaryKey)) {
    return { provider: primaryProvider, key: primaryKey, id: `${aiProvider}:${(primaryKey || "").slice(-6)}` };
  }
  if (aiProvider !== "gemini" && keys.geminiKey) {
    const gp = getAIProvider("gemini");
    if (gp.embed && gp.isConfigured(keys.geminiKey)) {
      return { provider: gp, key: keys.geminiKey, id: `gemini:${keys.geminiKey.slice(-6)}` };
    }
  }
  if (aiProvider !== "openai" && keys.openaiKey) {
    const op = getAIProvider("openai");
    if (op.embed && op.isConfigured(keys.openaiKey)) {
      return { provider: op, key: keys.openaiKey, id: `openai:${keys.openaiKey.slice(-6)}` };
    }
  }
  return null;
}

function analyticsFingerprint(data: AgentData, analyticsDays?: number): string {
  const overview = data.analyticsOverview;
  if (!overview) return `analytics:none:${analyticsDays || "default"}`;
  const top = [...overview.topPages, ...overview.topFeatures, ...overview.topEvents, ...overview.topAccounts]
    .slice(0, 12)
    .map((item) => `${item.id}:${item.count}:${item.priorCount ?? ""}:${item.deltaPct ?? ""}`)
    .join(",");
  return [
    "analytics",
    overview.provider,
    analyticsDays || "default",
    overview.generatedAt,
    overview.totalTrackedPages,
    overview.totalTrackedFeatures,
    top,
  ].join(":");
}

function dataFingerprint(data: AgentData, embedderId: string, analyticsDays?: number): string {
  return `${data.feedback.length}:${data.features.length}:${data.calls.length}:${data.insights.length}:${data.jiraIssues.length}:${data.confluencePages.length}:${data.linearIssues.length}:${data.feedback[0]?.id || ""}:${data.feedback[data.feedback.length - 1]?.id || ""}:${data.jiraIssues[0]?.id || ""}:${embedderId}:${analyticsFingerprint(data, analyticsDays)}`;
}

async function buildStore(data: AgentData, keys?: AgentKeys, analyticsDays?: number): Promise<{ store: InMemoryVectorStore; embeddingMap: Map<string, number[]>; enrichedData: AgentData }> {
  const embedder = keys ? pickEmbedder(keys) : null;
  const fp = dataFingerprint(data, embedder?.id || "none", analyticsDays);

  if (cachedStore && cachedStore.fingerprint === fp) {
    return { store: cachedStore.store, embeddingMap: cachedStore.embeddingMap, enrichedData: data };
  }

  const store = new InMemoryVectorStore();
  let enrichedData = data;

  // Step 1: pre-compute feedback embeddings for clustering (must happen before store build)
  const feedbackEmbMap = new Map<string, number[]>();
  if (embedder && data.feedback.length > 0) {
    try {
      const feedbackItems = data.feedback.map((f) => ({
        id: f.id, text: `${f.title}. ${f.content.slice(0, 400)}`,
      }));
      const EMBED_BATCH = 64;
      for (let i = 0; i < feedbackItems.length; i += EMBED_BATCH) {
        const batch = feedbackItems.slice(i, i + EMBED_BATCH);
        const vecs = await embedder.provider.embed!(batch.map((b) => b.text), embedder.key);
        if (vecs) batch.forEach((item, j) => { if (vecs[j]?.length) feedbackEmbMap.set(item.id, vecs[j]); });
      }
      if (feedbackEmbMap.size > 0) {
        const { clusters, clusterMap } = clusterFeedback(data.feedback, feedbackEmbMap);
        enrichedData = { ...data, feedback: annotateClusters(data.feedback, clusterMap, clusters) };
      }
    } catch { /* non-fatal: proceed without cluster annotations */ }
  }

  // Step 2: add all items to store — long docs get chunked into sub-documents
  if (enrichedData.feedback.length) store.addFeedback(enrichedData.feedback);
  if (enrichedData.features.length) store.addFeatures(enrichedData.features);
  if (enrichedData.calls.length) store.addCalls(enrichedData.calls);
  if (enrichedData.insights.length) store.addInsights(enrichedData.insights);
  if (enrichedData.jiraIssues.length) store.addJiraIssues(enrichedData.jiraIssues);
  if (enrichedData.linearIssues.length) store.addLinearIssues(enrichedData.linearIssues);
  if (enrichedData.confluencePages.length) store.addConfluencePages(enrichedData.confluencePages);

  // Step 2b: synthesize analytics docs so events/pages are semantically searchable
  if (enrichedData.analyticsOverview) {
    const analyticsWindow = analyticsDays ? `last ${analyticsDays} days` : "recent activity";
    const analyticsDocs = synthesizeAnalyticsDocs(
      enrichedData.analyticsOverview,
      enrichedData.analyticsOverview.provider,
      analyticsWindow
    );
    store.addAnalytics(analyticsDocs);
  }

  store.buildIndex();

  // Step 3: apply signal scores to all search-candidate documents
  // For feedback docs, pass raw content so FILLER_PATTERN anchors work on item text, not the concatenated doc string
  const feedbackContentMap = new Map(enrichedData.feedback.map((f) => [f.id, `${f.title} ${f.content}`]));
  for (const doc of store.getAllDocuments()) {
    const rawContent = doc.type === "feedback" ? feedbackContentMap.get(doc.id) : undefined;
    doc.signalScore = scoreDoc({ text: doc.text, rawContent, sourceType: doc.type as Parameters<typeof scoreDoc>[0]["sourceType"] });
  }

  // Step 4: compute embeddings for ALL store documents (including chunks)
  const embeddingMap = new Map<string, number[]>();
  if (embedder) {
    try {
      // Reuse feedback embeddings — feedback is never chunked so doc.id == item.id
      feedbackEmbMap.forEach((vec, id) => embeddingMap.set(id, vec));

      // Embed everything else (chunks from calls/jira/confluence/linear + features + analytics docs)
      const needsEmbed = store.getAllDocuments().filter((d) => !embeddingMap.has(d.id));
      const EMBED_BATCH = 64;
      for (let i = 0; i < needsEmbed.length; i += EMBED_BATCH) {
        const batch = needsEmbed.slice(i, i + EMBED_BATCH);
        try {
          const vecs = await embedder.provider.embed!(batch.map((d) => d.text.slice(0, 512)), embedder.key);
          if (vecs) batch.forEach((doc, j) => { if (vecs[j]?.length) embeddingMap.set(doc.id, vecs[j]); });
        } catch { /* non-fatal per-batch; TF-IDF covers missing docs */ }
      }
    } catch { /* non-fatal: TF-IDF fallback covers all docs */ }
  }

  if (embeddingMap.size > 0) store.setEmbeddings(embeddingMap);
  cachedStore = { fingerprint: fp, store, embeddingMap };
  return { store, embeddingMap, enrichedData };
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

/**
 * Replace `|` with `›` in titles so they don't break markdown tables when
 * the model copies them into a Source cell. Pendo/Amplitude page names often
 * use `|` as a path separator (e.g. "Findings | Finding Detail Page"), which
 * GFM interprets as a cell boundary.
 */
function sanitizeTitleForTable(title: string): string {
  return title.replace(/\s*\|\s*/g, " › ").replace(/\s+/g, " ").trim();
}

function cleanFeedbackTitle(fb: FeedbackItem): string {
  const raw = (fb.title || "").replace(/\s+/g, " ").trim();
  const base = !raw || looksLikeOpaqueId(raw) ? snippetFromContent(fb.content) : raw;
  return sanitizeTitleForTable(base);
}

const GENERIC_TITLE_RE = /^(?:[A-Z][\w ]+ Portal\s*[-–—]\s*vote for |Direct feedback for|Feature Request$|Untitled Note|Note \d+)/i;

/**
 * Resolve the best-available user-facing identity for a feedback item's Source cell.
 * Preference order: company > email (any field) > non-email customer name > linked feature
 * > source integration name > short id. Returns `skip: true` only for truly unattributable
 * portal-vote rows (generic title AND no feature link AND no other identity).
 */
function resolveFeedbackIdentity(fb: FeedbackItem | undefined): { identity: string; skip: boolean } {
  if (!fb) return { identity: "unknown", skip: false };

  if (fb.company) return { identity: fb.company, skip: false };

  const email = (fb.metadata?.userEmail?.match(EMAIL_RE)?.[0])
    || (fb.customer?.match(EMAIL_RE)?.[0])
    || (fb.title?.match(EMAIL_RE)?.[0])
    || (fb.content?.match(EMAIL_RE)?.[0])
    || "";
  if (email) return { identity: email, skip: false };

  const customerName = (fb.customer || "").trim();
  if (customerName && customerName.toLowerCase() !== "unknown") {
    return { identity: customerName, skip: false };
  }

  // Productboard exposes a nested user display name on some note shapes (votes, imports).
  const metaName = (fb.metadata?.userName || "").trim();
  if (metaName && metaName.toLowerCase() !== "unknown") {
    return { identity: metaName, skip: false };
  }

  const domain = fb.metadata?.companyDomain;
  const featureName = fb.metadata?.featureName;
  const rawTitle = fb.title || "";
  const isPortalVote = /Portal\s*[-–—]\s*vote for/i.test(rawTitle);
  // For portal votes, prefer "domain · vote: Feature" when a domain is available so the row
  // attributes the ask to at least a company-level identity instead of an anonymous feature name.
  if (isPortalVote && featureName) {
    return { identity: domain ? `${domain} · vote: ${featureName}` : `vote: ${featureName}`, skip: false };
  }
  if (domain) return { identity: domain, skip: false };
  if (featureName) return { identity: `feedback on: ${featureName}`, skip: false };

  // Truly unattributable portal-vote junk (no featureName, no customer) — skip the row entirely.
  if (GENERIC_TITLE_RE.test(rawTitle)) return { identity: "", skip: true };

  // Last-resort: use the integration name so the Source cell is at least specific.
  const src = fb.source;
  if (src && src !== "manual") {
    return { identity: `via ${src}`, skip: false };
  }

  // Still no identity — use a short deterministic id so downstream dedup works.
  return { identity: fb.id ? `note ${fb.id.slice(0, 8)}` : "unknown", skip: false };
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
  const fbById = new Map(data.feedback.map((f) => [f.id, f]));
  const featById = new Map(data.features.map((f) => [f.id, f]));
  const callById = new Map(data.calls.map((c) => [c.id, c]));
  const insightById = new Map(data.insights.map((i) => [i.id, i]));
  const jiraById = new Map(data.jiraIssues.map((j) => [j.id, j]));
  const linearById = new Map(data.linearIssues.map((l) => [l.id, l]));
  const pageById = new Map(data.confluencePages.map((p) => [p.id, p]));
  const details: string[] = [];
  for (const id of ids) {
    const fb = fbById.get(id);
    if (fb) {
      const w = shortDate(fb as unknown as Record<string, unknown>);
      const contact = feedbackContactRef(fb);
      details.push(`[Source: ${feedbackSourceRef(fb)}, ${w}] "${cleanFeedbackTitle(fb)}" — customer: ${contact || "unknown"}${fb.company ? ` @ ${fb.company}` : ""}: "${fb.content.slice(0, contentLen)}"`);
      continue;
    }
    const feat = featById.get(id);
    if (feat) {
      const desc = detailed && feat.description ? `: ${feat.description.slice(0, descLen)}` : "";
      details.push(`(internal roadmap item — do not cite as Source) "${feat.name}" — ${feat.status}, ${feat.votes} votes${desc}`);
      continue;
    }
    const call = callById.get(id);
    if (call) {
      details.push(`[Call, ${call.date}] ${call.title} — ${call.summary.slice(0, contentLen)}`);
      continue;
    }
    const insight = insightById.get(id);
    if (insight) { details.push(`[Insight] ${insight.title} — ${insight.description.slice(0, contentLen)}`); continue; }
    const jira = jiraById.get(id);
    if (jira) {
      const w = shortDate(jira as unknown as Record<string, unknown>);
      const link = atlassianIssueUrl(jira.key, keys);
      const desc = detailed && jira.description ? `\n  Description: "${jira.description.slice(0, descLen)}"` : "";
      details.push(`[Jira ${jira.key}${link ? ` (${link})` : ""}, ${w}] ${jira.summary} — ${jira.status}/${jira.priority}, assigned: ${jira.assignee}${desc}`);
      continue;
    }
    const linear = linearById.get(id);
    if (linear) {
      const w = shortDate(linear as unknown as Record<string, unknown>);
      const desc = detailed && linear.description ? `\n  Description: "${linear.description.slice(0, descLen)}"` : "";
      details.push(`[Linear ${linear.identifier}, ${w}] ${linear.title} — ${linear.status}/${linear.priority}, assigned: ${linear.assignee}${desc}`);
      continue;
    }
    const page = pageById.get(id);
    if (page) {
      const excerpt = detailed && page.excerpt ? `: ${page.excerpt.slice(0, descLen)}` : "";
      const pageLabel = page.space === "Slite" ? "Slite" : "Confluence";
      details.push(`[${pageLabel}] ${page.title} — ${page.space}${excerpt}`);
    }
  }
  return details;
}

const MARKDOWN_FORMATTING_RULES = `MARKDOWN FORMATTING RULES (CRITICAL — violations break rendering):
- Every \`## Heading\` or \`### Heading\` MUST start a new line with a blank line before AND after it. NEVER write "sentence. ## Heading" on the same line — always break.
- Every table MUST be preceded by a blank line and followed by a blank line before any prose or heading.
- Table cells MUST NOT contain a raw \`|\` character. If a page/feature name contains \`|\` (e.g. from Pendo hierarchy), write it as \`Findings › Finding Detail Page\` (use \`›\` or \`/\` as the separator) instead.
- Never embed multi-sentence prose in a Source cell. If there's no valid source for a row, drop the row rather than writing a sentence there.
- Section opening sentences are NOT wrapped in bold. Use bold only for short data spans (numbers, account names, feature names) — never wrap an entire clause or sentence.`;

const SYSTEM_PROMPT = `You are a senior product intelligence analyst. Synthesize data into insightful, actionable analysis for product managers. Be concise but don't sacrifice depth when the evidence warrants it. Focus on recent changes unless the user asks for historical totals/counts. Be opinionated. Include direct customer quotes when available.

DEPTH DIMENSIONS (consider each; surface the ones the evidence supports):
- Jobs-to-be-done: what is the customer actually trying to get done? What job is the current workflow failing?
- Segmentation: do signals differ by account tier, role, industry, use case, or adoption stage? Call out divergence explicitly.
- Counter-signals: what evidence disagrees, is isolated, or challenges the dominant pattern? A skeptic's read of the same data.
- Strategic stance: when the evidence supports it, state an opinionated recommendation — what would you do, with what confidence, and why. Differentiate "here's what the data says" from "here's what I'd do about it."
- Unmet demand vs noise: distinguish repeat / cross-account signals from one-off requests, and say so.
- Trend direction: when the analytics context includes "climbing surfaces" or "declining surfaces" OR when an item's evidence carries a ±% vs prior period, PREFER delta language ("MSP Portal up 34% to 9,628 events vs prior 30 days") over snapshot counts. Static counts ("854 high-priority items") are backlog size, not insight — a climb/fall is the insight.

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
- If the user asks for a number/count/how many, prioritize numeric accuracy over recency and compute from matching items in the provided context.
- Evidence items annotated "(1 of N from Company)" mean that company has N total feedback items. Treat all N as one customer signal, not N independent requests.

DATE RULES (STRICT — violations are detected and corrected server-side):
- Every evidence item in context carries a When label in square brackets, e.g. "[Source: Jira CX-1234, 6d ago]" or "[Source: Productboard note "...", 2w ago]" or "[Source: ..., updated 3mo ago]" or "[Source: ..., date unknown]".
- When you place a row in a Source|What|When table, the When cell MUST be the EXACT label from that item's bracket in the context. "6d ago" stays "6d ago". "2w ago" stays "2w ago". Do NOT round, rewrite, or substitute "today" for items whose bracketed label is anything other than "today".
- "updated Xd ago" does NOT mean the issue was first raised that recently — it reflects a modification timestamp. Do not imply recency from update times.
- If an item's label is "date unknown", write "—" in the When column.
- Analytics signals (Pendo/Amplitude/PostHog pages, features, events) have NO per-item date. Write "—" in the When column for any analytics row, never "today".
- Do not explain these timestamp limitations in your prose unless the user directly asks about date accuracy.

AUTHORING RULES:
- Structure: answer first, evidence second, caveats last (if any). An opinionated recommendation or stance is welcome when evidence supports it — clearly separated from the descriptive answer.
- Don't meta-narrate your ranking process. Phrases like "I'm prioritizing volume over recency...", "I synthesize these because...", "I'll focus on..." are out. Present findings; let the ranking speak for itself. This rule is about process narration, not about opinions — stating your recommendation or confidence is encouraged.
- Counter-signals are valuable, but only when substantive. If a counter-signal is isolated noise, omit it. If it materially challenges the main finding, surface it in a short paragraph or "## Counter-signals" section.
- Explaining why findings matter is encouraged. Explaining why you chose what to show is not.

${MARKDOWN_FORMATTING_RULES}`;

const BROAD_KEYWORDS = ["summary", "overview", "brief", "executive", "all", "comprehensive", "status", "what's happening", "state of", "pulse", "report", "trends", "emerging", "what's new", "what changed"];
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
  "trends", "patterns", "emerging", "shifts", "what's new", "what changed",
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

// Return the offset in ms between local TZ and UTC at the given instant (local - UTC).
function getTimezoneOffsetMs(tz: string, at: Date): number {
  try {
    const utcDate = new Date(at.toLocaleString("en-US", { timeZone: "UTC" }));
    const tzDate = new Date(at.toLocaleString("en-US", { timeZone: tz }));
    return tzDate.getTime() - utcDate.getTime();
  } catch {
    return 0;
  }
}

// Midnight of the current calendar day expressed as a UTC Date, adjusted for the client TZ.
function midnightInTZ(tz: string, now: Date): Date {
  try {
    const dateStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(now); // "YYYY-MM-DD"
    const [y, m, d] = dateStr.split("-").map(Number);
    const offset = getTimezoneOffsetMs(tz, now);
    return new Date(Date.UTC(y, m - 1, d) - offset);
  } catch {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
}

// Year and 0-indexed month for the client TZ.
function datePartsInTZ(tz: string, now: Date): { y: number; m: number } {
  try {
    const dateStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit",
    }).format(now);
    const [y, m] = dateStr.split("-").map(Number);
    return { y, m: m - 1 };
  } catch {
    return { y: now.getFullYear(), m: now.getMonth() };
  }
}

export function extractTimeRange(message: string, clientTz = "UTC"): TimeRange | null {
  const q = message.toLowerCase();
  const now = new Date();

  const compareParts = q.match(/(.+?)\s+(?:vs\.?|versus|compared?\s+to|against)\s+(.+)/i);
  if (compareParts) {
    const a = parseSingleTimeRange(compareParts[1].trim(), now, clientTz);
    const b = parseSingleTimeRange(compareParts[2].trim(), now, clientTz);
    if (a && b) return { ...a, compare: b };
  }

  return parseSingleTimeRange(q, now, clientTz);
}

function parseSingleTimeRange(text: string, now: Date, clientTz = "UTC"): TimeRange | null {
  const today = midnightInTZ(clientTz, now);
  const { y: nowYear, m: nowMonth } = datePartsInTZ(clientTz, now);
  const tzOffset = getTimezoneOffsetMs(clientTz, now);

  if (/\byesterday\b/.test(text)) {
    const start = new Date(today); start.setUTCDate(start.getUTCDate() - 1);
    return { start, end: today, label: "yesterday" };
  }
  if (/\btoday\b/.test(text)) {
    return { start: today, end: now, label: "today" };
  }
  if (/\bthis\s+week\b/.test(text)) {
    const start = new Date(today); start.setUTCDate(start.getUTCDate() - start.getUTCDay());
    return { start, end: now, label: "this week" };
  }
  if (/\bthis\s+month\b/.test(text)) {
    return { start: new Date(Date.UTC(nowYear, nowMonth, 1) - tzOffset), end: now, label: "this month" };
  }
  if (/\bthis\s+quarter\b/.test(text)) {
    const qMonth = Math.floor(nowMonth / 3) * 3;
    return { start: new Date(Date.UTC(nowYear, qMonth, 1) - tzOffset), end: now, label: "this quarter" };
  }
  if (/\bytd\b|\byear\s+to\s+date\b/.test(text)) {
    return { start: new Date(Date.UTC(nowYear, 0, 1) - tzOffset), end: now, label: "YTD" };
  }

  const lastN = text.match(/(?:last|past)\s+(\d+)\s+(day|week|month|quarter)s?/);
  if (lastN) {
    const n = parseInt(lastN[1], 10);
    const unit = lastN[2];
    const start = new Date(today);
    if (unit === "day") start.setUTCDate(start.getUTCDate() - n);
    else if (unit === "week") start.setUTCDate(start.getUTCDate() - n * 7);
    else if (unit === "month") start.setUTCMonth(start.getUTCMonth() - n);
    else if (unit === "quarter") start.setUTCMonth(start.getUTCMonth() - n * 3);
    return { start, end: now, label: `last ${n} ${unit}${n > 1 ? "s" : ""}` };
  }

  if (/\blast\s+week\b/.test(text)) {
    const end = new Date(today); end.setUTCDate(end.getUTCDate() - end.getUTCDay());
    const start = new Date(end); start.setUTCDate(start.getUTCDate() - 7);
    return { start, end, label: "last week" };
  }
  if (/\blast\s+month\b/.test(text)) {
    const end = new Date(Date.UTC(nowYear, nowMonth, 1) - tzOffset);
    const start = new Date(end); start.setUTCMonth(start.getUTCMonth() - 1);
    return { start, end, label: "last month" };
  }
  if (/\blast\s+quarter\b/.test(text)) {
    const qMonth = Math.floor(nowMonth / 3) * 3;
    const end = new Date(Date.UTC(nowYear, qMonth, 1) - tzOffset);
    const start = new Date(end); start.setUTCMonth(start.getUTCMonth() - 3);
    return { start, end, label: "last quarter" };
  }

  const monthNames = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const monthAbbrevs = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

  const rangeMatch = text.match(new RegExp(`(${monthNames.join("|")}|${monthAbbrevs.join("|")})\\s+(?:to|through|-)\\s+(${monthNames.join("|")}|${monthAbbrevs.join("|")})`, "i"));
  if (rangeMatch) {
    const startIdx = monthNames.indexOf(rangeMatch[1].toLowerCase()) !== -1 ? monthNames.indexOf(rangeMatch[1].toLowerCase()) : monthAbbrevs.indexOf(rangeMatch[1].toLowerCase());
    const endIdx = monthNames.indexOf(rangeMatch[2].toLowerCase()) !== -1 ? monthNames.indexOf(rangeMatch[2].toLowerCase()) : monthAbbrevs.indexOf(rangeMatch[2].toLowerCase());
    if (startIdx >= 0 && endIdx >= 0) {
      const start = new Date(Date.UTC(nowYear, startIdx, 1) - tzOffset);
      const end = new Date(Date.UTC(nowYear, endIdx + 1, 0, 23, 59, 59) - tzOffset);
      return { start, end, label: `${monthNames[startIdx]} to ${monthNames[endIdx]}` };
    }
  }

  const inMonth = text.match(new RegExp(`(?:in|during|for)\\s+(${monthNames.join("|")}|${monthAbbrevs.join("|")})`, "i"));
  if (inMonth) {
    const idx = monthNames.indexOf(inMonth[1].toLowerCase()) !== -1 ? monthNames.indexOf(inMonth[1].toLowerCase()) : monthAbbrevs.indexOf(inMonth[1].toLowerCase());
    if (idx >= 0) {
      const year = idx > nowMonth ? nowYear - 1 : nowYear;
      return { start: new Date(Date.UTC(year, idx, 1) - tzOffset), end: new Date(Date.UTC(year, idx + 1, 0, 23, 59, 59) - tzOffset), label: monthNames[idx] };
    }
  }

  const sinceMonth = text.match(new RegExp(`since\\s+(${monthNames.join("|")}|${monthAbbrevs.join("|")})`, "i"));
  if (sinceMonth) {
    const idx = monthNames.indexOf(sinceMonth[1].toLowerCase()) !== -1 ? monthNames.indexOf(sinceMonth[1].toLowerCase()) : monthAbbrevs.indexOf(sinceMonth[1].toLowerCase());
    if (idx >= 0) {
      const year = idx > nowMonth ? nowYear - 1 : nowYear;
      return { start: new Date(Date.UTC(year, idx, 1) - tzOffset), end: now, label: `since ${monthNames[idx]}` };
    }
  }

  const inQ = text.match(/(?:in|during|for)\s+q([1-4])/i);
  if (inQ) {
    const qNum = parseInt(inQ[1], 10);
    const qMonth = (qNum - 1) * 3;
    return { start: new Date(Date.UTC(nowYear, qMonth, 1) - tzOffset), end: new Date(Date.UTC(nowYear, qMonth + 3, 0, 23, 59, 59) - tzOffset), label: `Q${qNum}` };
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

const DETAILED_FORMAT = `Use this format as a guide. Include sections the evidence actually supports; omit any section that would be empty or forced. The order below is recommended, not mandatory — adapt if the question needs a different shape.

[1-2 sentence answer to the question. Be specific. Do NOT wrap the entire opening sentence in **bold** — but **bold** on 1-2 short data spans within it is encouraged (e.g. "**Three accounts** reported SSO failures this week.")]

| Source | What | When |
| --- | --- | --- |
[max 5 rows. Include this table whenever citing 2+ distinct sources or when the question asks about feedback items, accounts, or requests. SOURCE CELL RULES: The Available Evidence list has the format "[N] IDENTITY: full-title (type)". Copy the IDENTITY (everything before the colon) verbatim — it is the company name, customer email, Jira/Linear key, "vote: FeatureName", or "feedback on: FeatureName" that identifies who said it or what ticket it is. VALID = Jira/Linear key ("CX-1234" or "[CX-1234](url)"), customer email, company name, "vote: X", "feedback on: X", or a specific analytics signal as "<Page/Feature/Event name> (Pendo page)" / "(Pendo feature)" / "(Amplitude event)" / "(PostHog event)" (use EXACT phrasing from the evidence list). NEVER use the feedback title that appears after the " — " in the evidence list as the Source cell value. BANNED = any generic portal title ("Blumira Portal", "vote for ...", "Direct feedback for ..."), "known feature", "roadmap item", bare numbers, [n] citation markers, theme names, bare platform name alone. What = actual request/issue (inline [n] citation goes here, not in Source). When = relative date (Xd ago, Xw ago, Xmo ago, today/yesterday — no absolute dates). Skip table if 0-1 sources.]

## [Heading]

[1-3 paragraphs. What's new, what changed, what matters. Reference dates. If there are distinct sub-themes, call them out.]

> "[direct customer quote if available]" — Customer Name or Email. Source: [Jira CX-123](link) or [Productboard note title](link if available)

## Segmentation
[OPTIONAL. Include when signals differ meaningfully by account tier, industry, role, or use case. 1-3 sentences or a short sub-table. Skip when the data is uniform or there are too few distinct segments.]

## Counter-signals
[OPTIONAL. Include when a non-trivial portion of the evidence disagrees with, complicates, or challenges the main finding. 1-3 sentences. Skip entirely when there is no meaningful disconfirming signal — do not invent one.]

## Take
[OPTIONAL but encouraged when evidence supports an opinionated call. 1-3 sentences stating what you'd do and the confidence level. Example: "I'd prioritize SSO reliability for the next cycle — high confidence, three enterprise accounts, one at renewal."]

## Next Steps
1. [owner] [action] [by when]
[1-5 action items scaled to the answer's scope. Include only when the answer implies actionable follow-up. Skip entirely for purely informational questions.]

## Confidence
[Only include when EVIDENCE FACTS are present in context. Format: "Sample: N items from M accounts, newest Xd ago. Skew: [one phrase]. Confidence: High / Medium / Low — [one phrase reason]." Omit entirely if EVIDENCE FACTS are not in context.]

CONSTRAINTS: 600 words max. No :--- in tables. Tables MUST be preceded by a blank line — never start a table header on the same line as prose. Every quote MUST include a specific source. Skip quote section if none available. For count questions, start with the numeric count. Where evidence is available, add inline [n] citation markers (e.g. "SSO login failures affect 4 enterprise accounts [1][3]") matching the numbered evidence list. If the response covers 3 or more distinct sub-topics, wrap each sub-topic in a <details><summary>Sub-topic title</summary>...content...</details> block to allow progressive disclosure.`;

const LIST_FORMAT = `Use this format for list/show-me queries:

[1 sentence naming what you found and how many items. Do NOT wrap the entire sentence in bold — but **bold** on a key number or name within it is fine.]

| Source | What | When |
| --- | --- | --- |
[3-10 rows. Always include this table. SOURCE CELL RULES: The Available Evidence list has the format "[N] IDENTITY: full-title (type)". Copy the IDENTITY (everything before the colon) verbatim — it is the company name, customer email, Jira/Linear key, "vote: FeatureName", or "feedback on: FeatureName". VALID = Jira/Linear key, customer email, company name, "vote: X", "feedback on: X", or analytics signal as "<Name> (Pendo page)" / "(Pendo feature)" etc. Prefer a mix of source types over Jira-only. NEVER use the feedback title after the " — " as a Source cell value. BANNED = generic portal titles, "known feature", "roadmap item", bare numbers, [n] citation markers, theme names, bare platform name alone. Citation markers belong in the What column only. What = the specific request, complaint, or issue — be concrete, not generic. When = relative date (Xd ago, Xw ago, Xmo ago, today/yesterday) — no absolute dates.]

[Optional: 1-3 sentence pattern or theme across the items above. Call out the dominant thread, any meaningful outlier, and how segments differ if they do. Skip if self-evident from the table.]

[Optional: a short "Take" — a single opinionated sentence about what this list suggests, if evidence supports one.]

CONSTRAINTS: Table is mandatory — do not omit it. Tables MUST be preceded by a blank line — never start a table header on the same line as prose. No :--- in tables. No Next Steps unless explicitly asked. 400 words max total. Use actual customer/source names, not placeholders.`;

const ANALYTICS_FORMAT = `Use this format for product-analytics-centric questions (e.g. "what does pendo show", "top features by usage", "how is X being used"):

[1-2 sentence direct answer naming the headline finding. **Bold** 1-2 short data spans (numbers, page/feature names) inline, not the whole sentence.]

## Usage Signals

| Page / Feature / Event | Volume | Note |
| --- | --- | --- |
[3-8 rows. ONE row per distinct page, feature, or event from the analytics context. Volume = the event count or rank from the analytics overview (e.g. "53,895 events" or "#1 page"). Note = a short, specific observation — what role this surface plays, who's using it, or what changed. Do NOT include a Source column here; analytics is the source. Cite supporting customer evidence with inline [n] markers in the Note cell where relevant.]

## What This Suggests
[1-3 short paragraphs. Tie the usage data to user intent: which jobs-to-be-done it implies, where users are spending effort, what the disparities mean. Reference customer feedback that corroborates or contradicts the usage pattern via inline [n] citations.]

## Customer Evidence
[OPTIONAL. Include only if 2+ customer feedback items in the Available Evidence list directly relate to the analytics finding. Use the canonical Source|What|When table here. SOURCE CELL RULES: Copy the IDENTITY from the Available Evidence list (everything before the colon) — company name, email, Jira/Linear key, "vote: X", "feedback on: X", or analytics signal as "<Name> (Pendo page)" etc. BANNED = generic portal titles, bare platform name alone, theme names, prose, [n] citation markers. Skip this section entirely if there is no specific evidence to cite.]

## Take
[OPTIONAL. 1-2 opinionated sentences with a confidence phrase. Skip if the question is purely descriptive.]

CONSTRAINTS: 500 words max. EVERY \`## Heading\` MUST be on its own line with a blank line before AND after it — never write "text. ## Heading" on the same line. Tables MUST be preceded by a blank line. No :--- in tables. Use absolute event/page counts where the analytics overview provides them — never guess. The Volume column is for analytics metrics; the Source column (if used in Customer Evidence) is for customer-facing artifacts only.`;

const CONVERSATIONAL_FORMAT = `Respond naturally in 1-4 paragraphs. Be direct but don't over-compress. Where evidence supports a claim, add an inline [n] citation marker matching the numbered evidence list (e.g. "three accounts mentioned this [2]"). Include source citations inline (e.g., "per [Jira CX-123]" or "as noted by customer@example.com in Productboard"). Use a quote block only if a specific customer quote is highly relevant. No Next Steps unless the user asks "what should we do." 300 words max.

If your answer enumerates 3 or more specific feedback items, accounts, tickets, or customer quotes, include the following table (on its own lines, preceded by a blank line) — otherwise omit it:

| Source | What | When |
| --- | --- | --- |
[up to 5 rows. SOURCE CELL RULES: Copy the IDENTITY from the Available Evidence list (everything before the colon) — company name, email, Jira/Linear key, "vote: X", or "feedback on: X". VALID = Jira/Linear key, customer email, company name, "vote: X", "feedback on: X", or analytics signal as "<Name> (Pendo page)" etc. NEVER use the feedback title after the " — ". BANNED = generic portal titles, "known feature", "roadmap item", bare numbers, [n] citation markers, theme names, bare platform name alone. What = specific request/issue (inline [n] citation goes here). When = relative date (Xd ago, Xw ago, Xmo ago, today/yesterday) — no absolute dates.]

A short opinionated closing sentence (a "Take") is welcome when the evidence supports one — keep it to one sentence and separate it from the descriptive answer.`;

const COMPARISON_FORMAT = `Structure the response as a comparison:

## [Period/Dimension A] vs [Period/Dimension B]

| Dimension | [A label] | [B label] |
| --- | --- | --- |
[rows for volume, top themes, sentiment, key items, notable new accounts or issues]

### Key Changes
[3-5 bullet points highlighting what shifted, including at least one counter-movement (something that went the other way or stayed stubbornly flat when you'd expect movement). Explain why it matters.]

### Take (optional)
[1-2 sentences on what you'd do with this comparison — an opinionated read, not just description. Skip if the evidence doesn't support a clear call.]

CONSTRAINTS: Focus on what changed, not what stayed the same — unless the thing that stayed the same is itself surprising. 400 words max. No :--- in tables.`;

const HIGHLIGHT_RULE = `HIGHLIGHTS: Use inline **bold** to draw the reader's eye to 1-3 concrete, reader-scannable data spans. Bolding a short span in the opening sentence is encouraged — that's where the reader looks first.

WHAT TO BOLD — the substantive data:
- Specific counts attached to a specific thing: "**14 customers** requested ..." (not "**three dominant themes**")
- Customer/company names: "**Prosek Partners**", "**tanthony@nex-tech.com**"
- Product areas / feature names: "**MSP Portal**", "**Always-On Automated Response**"
- Dates / recency: "**last 14 days**", "**yesterday**"
- Absolute metrics: "**54,034 events**", "**$2.3M ARR at risk**"

WHAT NOT TO BOLD — meta-phrases and framing words:
- NEVER: "**three dominant themes**", "**key findings**", "**major patterns**", "**significant signals**", "**common asks**", "**top insights**" — these are analytical framing, not data.
- NEVER: whole clauses, sentences, or paragraphs.
- NEVER: generic adjectives ("**high-priority**", "**critical**") without a specific noun they modify.
- If the sentence only contains meta-phrases and framing, skip bold entirely.

Rules: (1) Max 3 bolded spans per response. (2) Each bolded span should be ≤4 words and contain either a proper noun or a number. (3) Ask yourself: "Could a reader act on this specific span alone?" If not, don't bold it.`;

const WHAT_COLUMN_RULE = `WHAT COLUMN STYLE: The "What" column in every Source|What|When table must be a SHORT concrete phrase — not a full sentence. Target ≤12 words. Prefer a noun phrase or verb phrase that names the ask or issue. If a verbatim fragment from the evidence is short enough, use it in quotes.

OK (short, specific): "Can't filter findings by severity", "Request: 'go back' button in workflow", "Missing SSO group sync for Okta"
NOT OK (full sentence, paraphrased): "The customer requires automated monthly usage reports for sub-account billing.", "Needs a single view to see alerts across all customers."

Rules:
(1) No trailing period on a cell ending in a noun phrase.
(2) No em-dash narrative — cells are phrases, not paragraphs.
(3) Keep inline [n] citation at the END of the cell.
(4) When the evidence has a short verbatim excerpt (≤12 words) that captures the ask, quote it in the cell — this is the most faithful form.
(5) If the ask genuinely needs a sentence to make sense, write a HEADLINE first (≤12 words) and reserve the long form for the prose/quote block below the table — never put a full sentence in a table cell.

WHEN COLUMN RULE: The "When" column MUST carry a real date for feedback, call, and ticket rows.
- Feedback / call / Jira / Linear rows: use a short relative ("3d ago", "2w ago", "6mo ago") or a short absolute ("Sep 24", "Mar 13", "Jan 13"). Take the date VERBATIM from the evidence — every numbered evidence item includes a "[timeframe]" or date near the identity. NEVER write "—" for these rows.
- Analytics rows (Source ends in "(Pendo page)", "(Amplitude event)", "(PostHog event)", etc.): use "—" — analytics signals have no item-level timestamp.
- Feature rows (Source ends in "(Productboard feature)"): use "—" unless the evidence provides a related-feedback date.
If you are unsure of a specific row's date, check the evidence list again rather than defaulting to "—".`;

const QUOTES_RULE = `CUSTOMER QUOTES: Include 1-3 verbatim customer quotes in EVERY response that has at least one feedback or call item in the Available Evidence list. Quotes are the most valuable output of this tool — do not skip them when they exist.

STRICT FORMATTING — blockquotes MUST be on their own line:
- Put a BLANK LINE before the \`>\` character.
- Put a BLANK LINE after the quote line (before the next paragraph or table).
- The \`>\` MUST be the first non-whitespace character on its line. NEVER inline "> \\"..."" mid-sentence.
- One quote per blockquote line; do NOT concatenate multiple quotes on the same line.

Canonical shape (three lines, with the blank lines on either side):

> "[20-45 word verbatim excerpt from evidence]" — [identity] ([short date])

When to include:
- 1 quote when there are 2-4 feedback/call items in the evidence pack.
- 2 quotes when there are 5-9 items (pick from different customers/themes).
- 3 quotes when there are 10+ items and they represent distinct angles.
- 0 quotes only when the evidence pack contains no feedback/call items (pure analytics answer).

Picking the excerpt:
- Prefer concrete asks, specific complaints, or numbers over vague praise.
- Keep 20-45 words; use \`…\` only when trimming from the middle.
- Verbatim — do not paraphrase, smooth grammar, or change word choice.

Attribution:
- Use the identity from the Source column verbatim (email, company, "vote: X", etc.).
- Include a short date in parens: "3d ago", "2w ago", "Sep 24", "Jan 13".
- Never leave a quote orphaned with no attribution.

Placement:
- Place quotes immediately after the paragraph that makes the claim they support, OR as a dedicated block before the final table.
- Do NOT put a quote inside a table cell.
- Do NOT duplicate text that already appears verbatim in the What column — pick a longer or different excerpt.`;

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
function verifyCitations(text: string, validCount: number): { cleaned: string; orphaned: number[] } {
  const orphaned: number[] = [];
  const cleaned = text.replace(/\[(\d+)\]/g, (match, n) => {
    const idx = parseInt(n, 10);
    if (idx >= 1 && idx <= validCount) return match;
    orphaned.push(idx);
    return "";
  }).replace(/\[\s*\]/g, "").replace(/\s{2,}/g, " ").trim();
  return { cleaned, orphaned };
}

function detectUrgencyFilter(query: string): { minUrgency?: "high"; requireActionable?: boolean } {
  const q = query.toLowerCase();
  const highUrgencyKeywords = ["urgent", "critical", "blocking", "blocker", "asap", "p1", "high priority", "must fix", "show stopper"];
  const actionableKeywords = ["what should we fix", "what should we build", "actionable", "top priorities", "prioritize", "what to build", "recommend"];
  const minUrgency = highUrgencyKeywords.some((k) => q.includes(k)) ? "high" as const : undefined;
  const requireActionable = actionableKeywords.some((k) => q.includes(k)) ? true : undefined;
  return { minUrgency, requireActionable };
}

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

/**
 * Prefer true creation date. Only fall back to `updated` if no creation-time
 * field is present — and tag it so callers can label it honestly.
 */
function parseDateInfo(item: Record<string, unknown>): { date: Date; isUpdateOnly: boolean } | null {
  const created = (item.date || item.created || item.createdAt || item.dateCreated || item.inserted_at || item.createdTime || "") as string;
  if (created) {
    const d = new Date(created);
    if (!isNaN(d.getTime())) return { date: d, isUpdateOnly: false };
  }
  const updated = (item.updated || item.lastModified || item.updatedAt || "") as string;
  if (updated) {
    const d = new Date(updated);
    if (!isNaN(d.getTime())) return { date: d, isUpdateOnly: true };
  }
  return null;
}

function recentItems<T extends { date?: string; created?: string; updated?: string }>(items: T[], limit: number): T[] {
  const withDate = items.map((item) => {
    const info = parseDateInfo(item as Record<string, unknown>);
    return { item, ts: info ? info.date.getTime() : 0 };
  });
  withDate.sort((a, b) => b.ts - a.ts);
  return withDate.slice(0, limit).map((x) => x.item);
}

function parseDate(item: Record<string, unknown>): Date | null {
  const info = parseDateInfo(item);
  return info ? info.date : null;
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
  if (confluencePages.length > 0) {
    const docLabel = confluencePages.some((p) => p.space === "Slite") ? "Slite" : "Confluence";
    parts.push(`${docLabel}: ${confluencePages.length} pages`);
  }
  if (insights.length > 0) parts.push(`Insights: ${insights.length}`);
  if (analyticsOverview) {
    const ao = analyticsOverview;
    // Pendo/Amplitude/PostHog often use `|` as a hierarchy separator inside
    // page/feature/event names (e.g. "Findings | Finding Detail Page"). Left
    // alone, those pipes break markdown tables when the model copies the name
    // into a cell. Replace with `›` for display and citation.
    const sp = sanitizeTitleForTable;
    const pageSummary = ao.topPages.slice(0, 5).map((p) => `${sp(p.name)} (${p.count})`).join(", ");
    const featureSummary = ao.topFeatures.slice(0, 5).map((f) => `${sp(f.name)} (${f.count})`).join(", ");
    const eventSummary = ao.topEvents.slice(0, 5).map((e) => `${sp(e.name)} (${e.count})`).join(", ");
    const accountSummary = ao.topAccounts.slice(0, 3).map((a) => `${sp(a.id)} (${a.count})`).join(", ");
    parts.push(`${analyticsLabel}: ${ao.totalTrackedPages} tracked pages, ${ao.totalTrackedFeatures} tracked features.`);
    if (pageSummary) parts.push(`${analyticsLabel} top pages: ${pageSummary}`);
    if (featureSummary) parts.push(`${analyticsLabel} top features: ${featureSummary}`);
    if (eventSummary) parts.push(`${analyticsLabel} top events: ${eventSummary}`);
    if (accountSummary) parts.push(`${analyticsLabel} top accounts: ${accountSummary}`);
    if (ao.allPageNames && ao.allPageNames.length > ao.topPages.length) {
      parts.push(`${analyticsLabel} tracked page names (${ao.allPageNames.length} — use these ONLY as "<Name> (${analyticsLabel} page)" in Source cells, never the bare platform name): ${ao.allPageNames.map(sp).join(", ")}`);
    }
    if (ao.allFeatureNames && ao.allFeatureNames.length > ao.topFeatures.length) {
      parts.push(`${analyticsLabel} tracked feature names (${ao.allFeatureNames.length} — use these ONLY as "<Name> (${analyticsLabel} feature)" in Source cells, never the bare platform name): ${ao.allFeatureNames.map(sp).join(", ")}`);
    }
    if (ao.allEventNames && ao.allEventNames.length > ao.topEvents.length) {
      parts.push(`${analyticsLabel} tracked event names (${ao.allEventNames.length} — use these ONLY as "<Name> (${analyticsLabel} event)" in Source cells, never the bare platform name): ${ao.allEventNames.map(sp).join(", ")}`);
    }
    if (ao.limitations?.length) parts.push(`${analyticsLabel} note: ${ao.limitations.join(". ")}`);

    // Surface period-over-period trends so the model can cite them directly.
    if (ao.windowLabel && ao.priorWindowLabel) {
      parts.push(`${analyticsLabel} window: ${ao.windowLabel} vs ${ao.priorWindowLabel}`);
    }
    if (ao.risingItems?.length) {
      const rising = ao.risingItems.map((r) => `${sp(r.name)} (${r.kind}, ${r.count.toLocaleString()} events, +${r.deltaPct}% vs prior)`).join("; ");
      parts.push(`${analyticsLabel} climbing surfaces: ${rising}`);
    }
    if (ao.fallingItems?.length) {
      const falling = ao.fallingItems.map((f) => `${sp(f.name)} (${f.kind}, ${f.count.toLocaleString()} events, ${f.deltaPct}% vs prior)`).join("; ");
      parts.push(`${analyticsLabel} declining surfaces: ${falling}`);
    }
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

function relDays(d: Date): string {
  const now = new Date();
  const days = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function shortDate(item: Record<string, unknown>): string {
  const info = parseDateInfo(item);
  if (!info) return "date unknown";
  const rel = relDays(info.date);
  return info.isUpdateOnly ? `updated ${rel}` : rel;
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
    parts.push(`\nTop features: ${top.map((f) => {
      const desc = f.description ? ` — ${f.description.slice(0, 200)}` : "";
      return `${f.name} (${f.votes}v, ${f.status})${desc}`;
    }).join("\n- ")}`);
  }

  const jiraFiltered = filterJiraForContext(data.jiraIssues, includeEng);
  if (jiraFiltered.length > 0) {
    const recent = recentItems(jiraFiltered, 12);
    const label = includeEng ? "Jira" : "Jira (CX/customer)";
    parts.push(`\nRecent ${label} (${recent.length} of ${jiraFiltered.length}):`);
    for (const j of recent) {
      const when = shortDate(j as unknown as Record<string, unknown>);
      const desc = j.description ? ` — ${j.description.slice(0, 250)}` : "";
      parts.push(`- [${when}] ${j.key} ${j.summary} [${j.status}/${j.priority}]${desc}`);
    }
  }

  if (data.linearIssues.length > 0) {
    const recent = recentItems(data.linearIssues, 12);
    parts.push(`\nLinear issues (${recent.length} of ${data.linearIssues.length}):`);
    for (const l of recent) {
      const when = shortDate(l as unknown as Record<string, unknown>);
      const desc = l.description ? ` — ${l.description.slice(0, 250)}` : "";
      parts.push(`- [${when}] ${l.identifier} ${l.title} [${l.status}/${l.priority}]${desc}`);
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
    for (const f of top) {
      const desc = f.description ? ` — ${f.description.slice(0, 200)}` : "";
      parts.push(`- ${f.name} — ${f.status}, ${f.votes} votes${desc}`);
    }
  }

  const jiraFiltered = filterJiraForContext(data.jiraIssues, includeEng);
  if (jiraFiltered.length > 0) {
    const recent = recentItems(jiraFiltered, 20);
    const label = includeEng ? "Jira (all)" : "Jira (CX/customer)";
    parts.push(`\n${label} (${recent.length} of ${jiraFiltered.length}):`);
    for (const j of recent) {
      const when = shortDate(j as unknown as Record<string, unknown>);
      const desc = j.description ? ` — ${j.description.slice(0, 250)}` : "";
      parts.push(`- [${when}] ${j.key} ${j.summary} [${j.status}/${j.issueType}/${j.priority}] → ${j.assignee}${desc}`);
    }
  }

  if (data.calls.length > 0) {
    const recent = recentItems(data.calls, 5);
    parts.push(`\nCalls:`);
    for (const c of recent) {
      parts.push(`- [${shortDate(c as unknown as Record<string, unknown>)}] ${c.title} — ${c.summary.slice(0, 100)}`);
      const negMoments = c.keyMoments
        .filter((m) => m.sentiment === "negative")
        .slice(0, 3);
      const otherMoments = c.keyMoments
        .filter((m) => m.sentiment !== "negative")
        .slice(0, Math.max(0, 6 - negMoments.length));
      for (const m of [...negMoments, ...otherMoments]) {
        parts.push(`  > "${m.text.slice(0, 100)}"${m.sentiment === "negative" ? " ⚠" : ""}`);
      }
    }
  }

  if (data.linearIssues.length > 0) {
    const recent = recentItems(data.linearIssues, 20);
    parts.push(`\nLinear issues (${recent.length} of ${data.linearIssues.length}):`);
    for (const l of recent) {
      const when = shortDate(l as unknown as Record<string, unknown>);
      const desc = l.description ? ` — ${l.description.slice(0, 250)}` : "";
      parts.push(`- [${when}] ${l.identifier} ${l.title} [${l.status}/${l.priority}] → ${l.assignee}${desc}`);
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

function computeEvidenceFacts(
  relatedFeedback: FeedbackItem[],
  sources: { type: string; id: string; title: string }[]
): string {
  if (sources.length < 3) return "";
  const now = Date.now();
  const fbItems = sources.filter((s) => s.type === "feedback").length;
  const jiraItems = sources.filter((s) => s.type === "jira").length;
  const callItems = sources.filter((s) => s.type === "call").length;
  const otherItems = sources.length - fbItems - jiraItems - callItems;

  const uniqueAccounts = new Set(relatedFeedback.filter((f) => f.company).map((f) => f.company!)).size;

  const ages = relatedFeedback
    .map((f) => {
      const d = f.date ? new Date(f.date) : null;
      return d && !isNaN(d.getTime()) ? Math.floor((now - d.getTime()) / 86400000) : null;
    })
    .filter((d): d is number => d !== null && d >= 0)
    .sort((a, b) => a - b);

  const medianAge = ages.length > 0 ? ages[Math.floor(ages.length / 2)] : null;
  const newestAge = ages.length > 0 ? ages[0] : null;

  const companyCounts: Record<string, number> = {};
  for (const fb of relatedFeedback) {
    if (fb.company) companyCounts[fb.company] = (companyCounts[fb.company] || 0) + 1;
  }
  const topCount = Math.max(...Object.values(companyCounts), 0);
  const topShare = relatedFeedback.length > 0 && topCount > 0
    ? Math.round((topCount / relatedFeedback.length) * 100)
    : 0;

  const sourceParts = [
    fbItems > 0 ? `${fbItems} customer feedback` : "",
    jiraItems > 0 ? `${jiraItems} jira/support` : "",
    callItems > 0 ? `${callItems} calls` : "",
    otherItems > 0 ? `${otherItems} other` : "",
  ].filter(Boolean);

  const lines = [
    `- Sources: ${sourceParts.join(", ")} (${sources.length} total)`,
    uniqueAccounts > 0 ? `- Unique accounts: ${uniqueAccounts}` : null,
    newestAge !== null ? `- Freshness: newest ${newestAge}d ago${medianAge !== null ? `, median ${medianAge}d ago` : ""}` : null,
    topShare > 0 ? `- Concentration: top account = ${topShare}% of feedback items` : null,
  ].filter(Boolean);

  return `\nEVIDENCE FACTS (populate the ## Confidence section from these):\n${lines.join("\n")}\n`;
}

function buildFollowupSuggestions(
  userMessage: string,
  mode: InteractionMode,
  qType: string,
  sourcesCount: number,
  relatedFeedback: FeedbackItem[]
): FollowupSuggestion[] {
  if (mode === "prd" || mode === "ticket") return [];
  if (/^10x thinking:/i.test(userMessage.trimStart())) return [];

  const suggestions: FollowupSuggestion[] = [];

  if ((qType === "detailed" || qType === "list" || qType === "conversational") && sourcesCount >= 3) {
    suggestions.push({
      kind: "tenx",
      label: "10x thinking",
      prompt: `10x thinking: For the above — propose 3 bold bets that would meaningfully change the product experience (not incremental fixes).

Render the 3 bets as a numbered list. Each bet MUST be its own list item on its own line, with a BLANK LINE between items. Start each item with "1. **Title** — ", "2. **Title** — ", "3. **Title** — " (bold title, em-dash, then the body). Keep each bet to 2-4 sentences covering: the customer job it serves, the strongest evidence from the data, and what we'd need to see to fully commit. No markdown headings (###, ##) for the bets.

Do NOT include a Customer Evidence table unless you have specific dated evidence to cite — if you do, use the canonical Source|What|When table AFTER the bets with a blank line before it. Use the actual dates provided in the evidence (e.g. "3d ago", "2w ago") for the When column — do NOT substitute "—" or "recent" when real dates are available.`,
    });
  }

  const companies = Array.from(new Set(relatedFeedback.filter((f) => f.company).map((f) => f.company!)));
  if (companies.length >= 2 && (qType === "detailed" || qType === "list" || qType === "conversational")) {
    suggestions.push({
      kind: "cohort",
      label: "Compare by account",
      prompt: `For the above: break down by account — which companies are most affected, which experience it differently, and are there any notable outlier signals worth noting?`,
    });
  }

  if (qType !== "count") {
    suggestions.push({
      kind: "gaps",
      label: "What are we missing?",
      prompt: `For the above: what questions would close the evidence gaps? What is ambiguous, potentially skewed, or missing entirely? What would a skeptic challenge?`,
    });
  }

  return suggestions.slice(0, 3);
}

export async function chat(
  userMessage: string,
  conversationHistory: { role: "user" | "assistant"; content: string }[],
  data: AgentData,
  keys: AgentKeys = {},
  contextMode: ContextMode = "focused",
  mode: InteractionMode = "summarize",
  accumulatedSourceIds?: string[],
  onChunk?: (chunk: string) => void,
  clientTz = "UTC",
  incomingState?: ThreadState,
  filters?: ChatFilters,
  learnSinceIso?: string | null,
  themeDeltas?: { theme: string; count: number; priorCount: number; delta: number; trend: string }[],
  insightDeltas?: { id: string; title: string; isNew?: boolean; trend?: string }[]
): Promise<ChatResult> {
  const isLearn = mode === "learn";
  const timeRange = extractTimeRange(userMessage, clientTz);
  // Fall back in priority order: explicit message time > visible filter bar > thread state window > learn anchor > no filter
  const STATE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
  const stateAgeMs = incomingState ? Date.now() - new Date(incomingState.updatedAt).getTime() : Infinity;
  const windowUsable = incomingState?.timeWindow && stateAgeMs < STATE_MAX_AGE_MS;

  // Resolve filter bar time range to a concrete window
  const filterBarWindow = (() => {
    if (!filters || filters.timeRange === "all") return null;
    const days = { "7d": 7, "14d": 14, "30d": 30, "90d": 90 }[filters.timeRange];
    if (!days) return null;
    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    return { start, end, label: `last ${days} days` };
  })();

  const stateWindow = windowUsable
    ? {
        start: new Date(incomingState!.timeWindow!.start),
        end: new Date(incomingState!.timeWindow!.end),
        label: incomingState!.timeWindow!.label,
      }
    : null;

  // For learn mode, default to "since last opened" window when no explicit time in message
  const learnWindow = isLearn && learnSinceIso && !timeRange && !filterBarWindow && !stateWindow
    ? { start: new Date(learnSinceIso), end: new Date(), label: "since last visit" }
    : null;

  const activeTimeRange = timeRange ?? filterBarWindow ?? stateWindow ?? learnWindow;
  const _rawScopedData = activeTimeRange ? filterByTimeRange(data, activeTimeRange) : data;

  // buildStore enriches feedback with cluster annotations and builds embeddings
  const _analyticsDays = activeTimeRange
    ? Math.ceil((activeTimeRange.end.getTime() - activeTimeRange.start.getTime()) / 86400000)
    : undefined;
  const { store, embeddingMap, enrichedData: scopedData } = await buildStore(_rawScopedData, keys, _analyticsDays);
  const countQuery = wantsCount(userMessage);
  const drilldownQuery = wantsInsightDrilldown(userMessage);
  const deepDiveEarly = wantsDeepDive(userMessage);
  const wideQuery = countQuery || drilldownQuery || isBroadQuery(userMessage) || deepDiveEarly.analytics || deepDiveEarly.data;
  const rawPivot = detectPivot(userMessage);
  // Merge persisted excluded entities from conversation state with current-turn pivot detection
  const pivot = incomingState?.excludedEntities?.length
    ? {
        isPivot: rawPivot.isPivot || incomingState.excludedEntities.length > 0,
        excluded: Array.from(new Set([...rawPivot.excluded, ...incomingState.excludedEntities])),
      }
    : rawPivot;
  const baseSearchLimit = contextMode === "focused" ? 10 : contextMode === "standard" ? 15 : 20;
  // Use a wider search limit for pivot queries so we get enough non-excluded results
  const searchLimit = wideQuery || pivot.isPivot ? Math.max(baseSearchLimit * 5, 50) : baseSearchLimit;
  const searchQueries = buildSearchQueries(userMessage, conversationHistory, wideQuery || isLikelyFollowUp(userMessage), pivot);
  // Boost focal companies from conversation state — per-company so mentioning one doesn't suppress boosts for others
  if (incomingState?.focalCompanies?.length) {
    const msgLower = userMessage.toLowerCase();
    for (const company of incomingState.focalCompanies) {
      if (msgLower.includes(company.toLowerCase())) continue;
      const boost = `${userMessage} ${company}`;
      if (!searchQueries.includes(boost)) searchQueries.push(boost);
    }
  }

  // Compute query embedding for semantic search (non-fatal if unavailable)
  let queryEmbedding: number[] | undefined;
  if (embeddingMap.size > 0) {
    const aiProvider = keys.aiProvider || "gemini";
    const aiKey = resolveAIKey(aiProvider, keys.geminiKey, keys.anthropicKey, keys.openaiKey);
    const provider = getAIProvider(aiProvider);
    if (provider.embed) {
      try {
        const vecs = await provider.embed([userMessage], aiKey);
        if (vecs?.[0]?.length) queryEmbedding = vecs[0];
      } catch { /* use TF-IDF */ }
    }
  }

  // Detect urgency/actionability intent for optional retrieval filters
  const urgencyFilter = detectUrgencyFilter(userMessage);

  // Apply theme filter from filter bar when themes are active
  const themeFilter = filters?.themes?.length ? { themes: filters.themes } : {};

  const merged = new Map<string, ReturnType<InMemoryVectorStore["search"]>[number]>();
  for (const q of searchQueries) {
    for (const r of store.search(q, { limit: searchLimit, queryEmbedding, applySignalBoost: !countQuery, ...urgencyFilter, ...themeFilter })) {
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

  // LLM rerank: improves precision on ambiguous queries (non-fatal, falls back to RRF order)
  if (shouldRerank(userMessage, rawResults, countQuery, drilldownQuery) && embeddingMap.size > 0) {
    const aiProvider = keys.aiProvider || "gemini";
    const aiKey = resolveAIKey(aiProvider, keys.geminiKey, keys.anthropicKey, keys.openaiKey);
    rawResults = await rerankResults(userMessage, rawResults, aiProvider, aiKey);
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

  let relatedFeedback = results
    .filter((r) => r.document.type === "feedback")
    .map((r) => scopedData.feedback.find((f) => f.id === r.document.id))
    .filter((item): item is FeedbackItem => !!item);

  // Opportunistically enrich retrieved feedback that slipped through the first-load cap.
  // This ensures query-relevant items always have sentiment/themes, non-blocking on failure.
  if (relatedFeedback.length > 0) {
    relatedFeedback = await enrichSubset(
      relatedFeedback,
      keys.aiProvider,
      keys.geminiKey,
      keys.anthropicKey,
      keys.openaiKey
    ).catch(() => relatedFeedback);
  }

  const analyticsProvider = keys.analyticsProvider || "pendo";
  let analyticsLookup: { context: string; sources: { type: string; id: string; title: string }[] } | null = null;
  if (wantsAnalyticsContext(userMessage)) {
    const lookupDays = activeTimeRange ? Math.min(timeRangeDays(activeTimeRange), 90) : undefined;
    if (analyticsProvider === "amplitude") {
      analyticsLookup = await getRelevantAmplitudeContext(userMessage, relatedFeedback, keys.amplitudeKey, lookupDays);
    } else if (analyticsProvider === "posthog") {
      analyticsLookup = await getRelevantPostHogContext(userMessage, relatedFeedback, keys.posthogKey, lookupDays, keys.posthogHost);
    } else {
      analyticsLookup = await getRelevantPendoContext(userMessage, relatedFeedback, keys.pendoKey, lookupDays);
    }
  }

  // Build per-company feedback counts for evidence annotation
  const companyFeedbackCount: Record<string, number> = {};
  for (const fb of scopedData.feedback) {
    const co = fb.company || "";
    if (co) companyFeedbackCount[co] = (companyFeedbackCount[co] || 0) + 1;
  }

  const sources: { type: string; id: string; title: string; url?: string; when?: string }[] = [];
  const searchEntries: { detail: string; score: number }[] = [];
  const recentItemIds = new Set<string>();
  const detailed = wantsDetail(userMessage) || drilldownQuery;

  for (const r of results) {
    const doc = r.document;

    let title = doc.id;
    let url: string | undefined;
    // Ground-truth When label for this source, computed from actual data.
    // The cleaner uses this to correct any drift where the model writes
    // "today" for items that are not actually from today.
    let when: string | undefined;
    if (doc.type === "feedback") {
      const fb = scopedData.feedback.find((f) => f.id === doc.id);
      const resolved = resolveFeedbackIdentity(fb);
      if (resolved.skip) continue;
      const identity = resolved.identity;
      const coCount = fb?.company ? (companyFeedbackCount[fb.company] || 1) : 1;
      const coNote = coCount >= 2 ? ` (${coCount} items)` : "";
      const core = fb ? cleanFeedbackTitle(fb) : doc.id;
      title = `${identity}${coNote} — ${core}`;
      if (fb?.metadata?.sourceUrl) url = fb.metadata.sourceUrl;
      if (fb) when = shortDate(fb as unknown as Record<string, unknown>);
    } else if (doc.type === "feature") {
      const feat = scopedData.features.find((f) => f.id === doc.id);
      if (feat) {
        const statusLabel = feat.status === "in_progress" ? "in progress" : feat.status;
        const voteStr = feat.votes > 0 ? `${feat.votes} votes` : "";
        const reqStr = feat.customerRequests > 0 ? `${feat.customerRequests} requests` : "";
        const meta = [voteStr, reqStr, statusLabel].filter(Boolean).join(" · ");
        title = meta ? `${feat.name} (${meta})` : feat.name;
        // Features have no createdAt/updatedAt in our type; surface the newest
        // related-feedback date as the ground-truth When so rows don't stay blank.
        const related = scopedData.feedback
          .filter((fb) => fb.themes?.some((t) => feat.themes?.includes(t)))
          .map((fb) => fb as unknown as Record<string, unknown>);
        if (related.length > 0) {
          const newest = related
            .map((r) => shortDate(r))
            .find((d) => d && d !== "date unknown");
          if (newest) when = newest;
        }
      }
    } else if (doc.type === "call") {
      const c = scopedData.calls.find((c) => c.id === doc.id);
      title = c?.title || title;
      if (c) when = shortDate(c as unknown as Record<string, unknown>);
    } else if (doc.type === "insight") {
      const ins = scopedData.insights.find((i) => i.id === doc.id);
      title = ins?.title || title;
      if (ins) when = shortDate(ins as unknown as Record<string, unknown>);
    } else if (doc.type === "jira") {
      const j = scopedData.jiraIssues.find((j) => j.id === doc.id);
      if (j) {
        title = `${j.key}: ${j.summary}`;
        const domain = keys.atlassianDomain || process.env.ATLASSIAN_DOMAIN || "";
        if (domain) url = `https://${domain.replace(/\.atlassian\.net\/?$/, "")}.atlassian.net/browse/${j.key}`;
        when = shortDate(j as unknown as Record<string, unknown>);
      }
    } else if (doc.type === "confluence") {
      const p = scopedData.confluencePages.find((p) => p.id === doc.id);
      if (p) {
        const isSlite = p.space === "Slite";
        title = p.title?.trim() || `Untitled (${isSlite ? "Slite page" : "Confluence page"})`;
        url = p.url;
        when = shortDate(p as unknown as Record<string, unknown>);
      }
    } else if (doc.type === "linear") {
      const l = scopedData.linearIssues.find((l) => l.id === doc.id);
      if (l) {
        title = `${l.identifier}: ${l.title}`;
        url = l.url;
        when = shortDate(l as unknown as Record<string, unknown>);
      }
    } else if (doc.type === "analytics") {
      const label = (doc.metadata?.label as string) || "";
      if (!label) continue;
      title = label;
      when = "—";
    }
    // Fallback: when the lookup failed or returned an empty/UUID-shaped title,
    // give the model a meaningful handle in "<Untitled> (<Source kind>)" form so
    // it has something specific to put in the Source column instead of just the
    // bare platform name.
    if (!title || title === doc.id) {
      const typeLabel: Record<string, string> = {
        feedback: "Productboard note",
        feature: "Productboard feature",
        call: "Call recording",
        insight: "Generated insight",
        confluence: "Confluence page",
        linear: "Linear issue",
        jira: "Jira ticket",
      };
      title = `Untitled (${typeLabel[doc.type] || doc.type})`;
    }
    // Only add context + source row for items that survived identity resolution.
    const details = lookupDetails([doc.id], scopedData, detailed, keys);
    if (details.length > 0) {
      const detail = r.highlightSpan
        ? `Most relevant excerpt: "${r.highlightSpan}"\n${details[0]}`
        : details[0];
      searchEntries.push({ detail, score: r.score });
    }
    recentItemIds.add(doc.id);
    if (doc.type !== "insight") {
      sources.push({ type: doc.type, id: doc.id, title: sanitizeTitleForTable(title), url, when });
    }
  }

  if (analyticsLookup?.sources.length) {
    const existingIds = new Set(sources.map((s) => s.id));
    const existingTitles = new Set(sources.filter((s) => s.type === "analytics").map((s) => s.title));
    for (const source of analyticsLookup.sources) {
      const cleanTitle = sanitizeTitleForTable(source.title);
      // Dedup against analytics docs already added via the main results loop
      if (existingIds.has(source.id) || existingTitles.has(cleanTitle)) continue;
      sources.push({ ...source, title: cleanTitle, when: "—" });
    }
  }

  const matchedInsightIds = results.filter((r) => r.document.type === "insight").map((r) => r.document.id);
  const drilldownContext = buildInsightDrilldownContext(userMessage, scopedData, matchedInsightIds, keys);

  // For broad/trends queries, inject pre-computed trend insights directly into context
  let broadTrendContext = "";
  if (isBroadQuery(userMessage) || isListQuery(userMessage)) {
    const trendIns = scopedData.insights.filter((i) => i.type === "trend").slice(0, 3);
    if (trendIns.length > 0) {
      broadTrendContext = "Trend insights (recent):\n" + trendIns.map((i) => `- ${i.title}: ${i.description}`).join("\n");
    }
  }

  const isPrdOrTicket = mode === "prd" || mode === "ticket";

  // Sort by retrieval score so highest-signal items appear first in the assembled context.
  // Model attention is biased toward the top, so this improves answer quality without
  // changing which items are included.
  searchEntries.sort((a, b) => b.score - a.score);
  const searchParts: string[] = searchEntries.map((e) => e.detail);

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

  const searchContext = [searchParts.join("\n"), drilldownContext, broadTrendContext, analyticsLookup?.context || "", fullAnalyticsBlock, expandedDataBlock].filter(Boolean).join("\n");

  const analyticsLabel = analyticsProvider === "amplitude" ? "Amplitude" : analyticsProvider === "posthog" ? "PostHog" : "Pendo";

  const hasDeepDive = deepDiveEarly.analytics || deepDiveEarly.data;
  const effectiveContextMode = isPrdOrTicket || isLearn
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

  if (activeTimeRange) {
    const totalItems = data.feedback.length + data.jiraIssues.length + data.calls.length;
    const scopedItems = scopedData.feedback.length + scopedData.jiraIssues.length + scopedData.calls.length;
    context = `Time scope: ${activeTimeRange.label} (${activeTimeRange.start.toLocaleDateString()} – ${activeTimeRange.end.toLocaleDateString()}). Showing ${scopedItems} of ${totalItems} time-sensitive items in this range.\n\n` + context;
  }

  if (timeRange?.compare) {
    context += buildComparisonBlock(data, timeRange);
  }

  if (countQuery) {
    context += buildComputedCounts(scopedData);
  }

  const budget = MAX_CONTEXT_TOKENS[effectiveContextMode] || 6000;
  if (estimateTokens(context) > budget) {
    const cutoff = Math.floor(budget * 3.5);
    const lastNewline = context.lastIndexOf("\n", cutoff);
    context = context.slice(0, lastNewline > 0 ? lastNewline : cutoff);
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
    ? "\n---\nAvailable Evidence (cite by [n] citation marker; for Source cells copy the IDENTITY shown before the colon — this is the company, email, Jira key, ticket identifier, vote: feature, or feedback on: feature that identifies the source. Never use the feedback title after the em-dash or any generic label as the Source cell value):\n" +
      sources.map((s, i) => {
        // Identity = title up to first " — " (strips the feedback title we
        // added after the em-dash for context). This is exactly what should
        // go in the Source column — not the full compound title.
        const identity = s.title.split(/\s+—\s+/)[0].trim();
        return `[${i + 1}] ${identity}: ${s.title} (${s.type})`;
      }).join("\n")
    : "";

  const pivotAddendum = pivot.isPivot && pivot.excluded.length > 0
    ? `\nPIVOT INSTRUCTION: The user already knows about "${pivot.excluded.join('", "')}". Do NOT summarize, repeat, or elaborate on ${pivot.excluded.map((e) => `"${e}"`).join(" or ")}. Focus ENTIRELY on OTHER topics, accounts, themes, or items found in the evidence above. If the evidence mentions ${pivot.excluded[0]} only incidentally, skip those items and highlight everything else.\n`
    : "";

  // Filter-active note: tell the agent what scope it's operating in when filters are active
  const filterNote = (() => {
    const parts: string[] = [];
    if (activeTimeRange && !timeRange) {
      parts.push(`time=${activeTimeRange.label}`);
    }
    if (filters?.themes?.length) parts.push(`themes=${filters.themes.join(", ")}`);
    return parts.length
      ? `\nActive filters: ${parts.join("; ")}. Treat the dataset above as already scoped to this context — do not apologize for missing data outside this scope.\n`
      : "";
  })();

  // Contradiction + delta pre-context for learn mode
  const contradictionBlock = (() => {
    if (!isLearn) return "";
    const parts: string[] = [];
    const contradictions = findContradictions(scopedData);
    if (contradictions.length > 0) {
      const lines = contradictions
        .slice(0, 5)
        .map((c: Contradiction, i: number) => `${i + 1}. [${c.severity.toUpperCase()}] ${c.title}\n   Evidence: ${c.evidence.slice(0, 2).join(" | ")}`)
        .join("\n");
      parts.push(`## Detected contradictions (pre-computed — reason about these in "What's contradicting"):\n${lines}`);
    }
    if (themeDeltas && themeDeltas.length > 0) {
      const lines = themeDeltas
        .map((d) => `  - "${d.theme}": ${d.trend} (${d.count} now, ${d.priorCount} prior, delta ${d.delta > 0 ? "+" : ""}${d.delta})`)
        .join("\n");
      parts.push(`## Theme frequency changes (pre-computed — surface in "What changed"):\n${lines}`);
    }
    if (insightDeltas && insightDeltas.length > 0) {
      const lines = insightDeltas
        .map((i) => `  - "${i.title}": ${i.isNew ? "new" : i.trend}`)
        .join("\n");
      parts.push(`## Insight signal changes (pre-computed — surface in "What changed"):\n${lines}`);
    }
    return parts.length > 0 ? `\n${parts.join("\n\n")}\n` : "";
  })();

  const is10xQuery = /^10x thinking:/i.test(userMessage.trimStart());
  const tenxAddendum = is10xQuery
    ? `\nTHINKING MODE: The user is requesting 10x (order-of-magnitude) thinking — not incremental improvements. Propose bold, ambitious ideas even with limited evidence. For each bet, explicitly state your confidence (e.g. "Weak signal, high upside"). Do not default to safe, obvious recommendations.
FORMAT RULES (strict):
- Render the 3 bets as an ordered list. Each of "1.", "2.", "3." MUST start a NEW line with a BLANK LINE before and after the item. Never write "...point. 2. **Next bet**" on the same line.
- Each item: "1. **Bold title** — " then 2-4 sentences (the customer job, the strongest evidence, what we'd need to see to commit). Keep bets tight; do NOT write a wall of text.
- No markdown headings (###, ##) for individual bets.
- DATE HONESTY: if your evidence items all carry "today" in their When label, that likely reflects a Productboard ingest/sync time rather than when the customer originally raised it. Do NOT claim the concern is from today. Use "recent" or "—" in the When column, or write "from a long-standing request" in the body of the bet instead.\n`
    : "";

  const factsBlock = mode !== "prd" && mode !== "ticket"
    ? computeEvidenceFacts(relatedFeedback, sources)
    : "";

  const prompt = `${context}${contradictionBlock}${evidencePack}${factsBlock}
${historyText ? `\nHistory:\n${historyText}\n` : ""}
Q: ${userMessage}
${pivotAddendum}${filterNote}${tenxAddendum}
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

  // Compute structured conversation state for this turn (persisted back by the client)
  const retrievedCompanies = Array.from(new Set([
    ...results
      .filter((r) => r.document.type === "feedback")
      .flatMap((r) => {
        const fb = scopedData.feedback.find((f) => f.id === r.document.id);
        return fb?.company ? [fb.company] : [];
      }),
    // Also extract company-like tokens from call participants (domain-part of emails)
    ...results
      .filter((r) => r.document.type === "call")
      .flatMap((r) => {
        const c = scopedData.calls.find((ca) => ca.id === r.document.id);
        return (c?.participants ?? [])
          .map((p) => {
            const atIdx = p.indexOf("@");
            if (atIdx > 0) return p.slice(atIdx + 1).split(".")[0];
            return "";
          })
          .filter((s) => s.length > 2);
      }),
  ])).slice(0, 5);
  const updatedState = updateState(incomingState, {
    retrievedThemes: detectedThemes,
    retrievedCompanies,
    extractedTimeRange: timeRange,
    pivotExcluded: rawPivot.excluded,
    mode,
  });

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

  let aiAttemptedButFailed = false;
  if (isAnyAIConfigured(aiProvider, keys.geminiKey, keys.anthropicKey, keys.openaiKey)) {
    const provider = getAIProvider(aiProvider);

    const braveKey = keys.braveSearchKey || process.env.BRAVE_SEARCH_KEY;
    const agentTools: ToolDefinition[] = [
      {
        name: "search_feedback",
        description: "Search customer feedback, feature requests, and call summaries by topic. Use when you need more specific evidence on a topic not fully covered by the provided context.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Topic or keywords to search" },
            limit: { type: "number", description: "Max results to return (1-10, default 5)" },
          },
          required: ["query"],
        },
      },
      {
        name: "search_issues",
        description: "Search Linear and Jira engineering issues by topic or status. Use when the user asks about tickets, bugs, or roadmap items not already in the provided context.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Topic or keywords to search" },
            limit: { type: "number", description: "Max results to return (1-10, default 5)" },
          },
          required: ["query"],
        },
      },
      ...(braveKey ? [{
        name: "web_search",
        description: "Search the public web for competitor product behavior, industry benchmarks, or external context not available in internal data. Use ONLY for questions about the external world — competitors, standards, industry trends. Do NOT use for questions answerable from internal feedback or tickets.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
            num_results: { type: "number", description: "Number of results to return (1-5, default 3)" },
          },
          required: ["query"],
        },
      }] : []),
      // Multi-hop tools: structured cross-source queries — gated to comparison/causal queries to avoid unnecessary round-trips
      ...(queryTypeLabel === "comparison" || queryTypeLabel === "detailed" || /\b(why|what caused|what changed|explain|correlate|compared to|vs\.?)\b/i.test(userMessage) ? AGENT_TOOLS : []),
    ];

    const webSources: { type: string; id: string; title: string; url?: string }[] = [];

    const executeAgentTool = async (name: string, input: Record<string, unknown>): Promise<{ text: string; count: number }> => {
      const query = String(input.query || "");
      const limit = Math.min(Math.max(Number(input.limit) || 5, 1), 10);
      if (name === "search_feedback") {
        const hits = store.search(query, { limit });
        if (hits.length === 0) return { text: "No feedback found for that query.", count: 0 };
        return {
          text: hits.map((h) => {
            const fb = scopedData.feedback.find((f) => f.id === h.document.id);
            return fb
              ? `[${fb.customer}] ${cleanFeedbackTitle(fb)}: ${fb.content.slice(0, 200)}`
              : h.document.text.slice(0, 200);
          }).join("\n---\n"),
          count: hits.length,
        };
      }
      if (name === "search_issues") {
        const linearHits = store.search(query, { limit: Math.ceil(limit / 2), type: "linear" });
        const jiraHits = store.search(query, { limit: Math.floor(limit / 2), type: "jira" });
        const allHits = [...linearHits, ...jiraHits];
        if (allHits.length === 0) return { text: "No issues found for that query.", count: 0 };
        return {
          text: allHits.map((h) => {
            const meta = h.document.metadata;
            return `[${meta.key || h.document.id}] ${h.document.text.slice(0, 200)} (${meta.status || "unknown"})`;
          }).join("\n---\n"),
          count: allHits.length,
        };
      }
      if (name === "web_search") {
        if (!braveKey) return { text: "Web search not configured.", count: 0 };
        const numResults = Math.min(Math.max(Number(input.num_results) || 3, 1), 5);
        const results = await searchWeb(query, braveKey, numResults);
        if (results.length === 0) return { text: "No web results found.", count: 0 };
        for (const r of results) {
          if (!webSources.some((s) => s.id === r.url)) {
            webSources.push({ type: "web", id: r.url, title: r.title, url: r.url });
          }
        }
        return {
          text: results.map((r) => `[${r.domain}] ${r.title} — ${r.description} (${r.url})`).join("\n---\n"),
          count: results.length,
        };
      }
      // Dispatch multi-hop structured tools (findFeedback, compareWindows, findAnalytics, findAccountHistory)
      if (["findFeedback", "compareWindows", "findAnalytics", "findAccountHistory"].includes(name)) {
        const toolCtx: ToolContext = { data: scopedData, store };
        const result = await runTool({ id: `tool-${Date.now()}`, name, input }, toolCtx);
        const text = JSON.stringify(result.result);
        const count = Array.isArray((result.result as Record<string, unknown>)?.items)
          ? ((result.result as Record<string, unknown>).items as unknown[]).length
          : 1;
        return { text: text.slice(0, 2000), count };
      }
      return { text: "Unknown tool.", count: 0 };
    };

    let aiResponse: string | null = null;
    const recordedToolCalls: { name: string; query: string; resultCount: number }[] = [];

    if (provider.generateWithTools) {
      const toolMessages: { role: "user" | "assistant"; content: string }[] = [{ role: "user", content: prompt }];
      const toolCallCache = new Map<string, string>();
      const MULTI_HOP_DEADLINE_MS = 15_000;
      const multiHopStart = Date.now();

      for (let round = 0; round < 3 && Date.now() - multiHopStart < MULTI_HOP_DEADLINE_MS; round++) {
        const result = await provider.generateWithTools(systemPrompt, toolMessages, agentTools, aiKey, keys.aiModel || undefined);

        if (result.toolCalls.length === 0) {
          // No tools — fake-stream the text we already have (avoids a second API call)
          if (onChunk && result.text) onChunk(result.text);
          aiResponse = result.text;
          break;
        }

        // Execute tool calls, dedup by name+input, record for trace
        toolMessages.push({ role: "assistant", content: result.text || "" });
        const toolResultParts: string[] = [];
        for (const tc of result.toolCalls) {
          const cacheKey = `${tc.name}:${JSON.stringify(tc.input)}`;
          let output: string;
          let count: number;
          if (toolCallCache.has(cacheKey)) {
            output = toolCallCache.get(cacheKey)!;
            count = 0;
          } else {
            ({ text: output, count } = await executeAgentTool(tc.name, tc.input));
            toolCallCache.set(cacheKey, output);
          }
          recordedToolCalls.push({
            name: tc.name,
            query: String(tc.input.query || ""),
            resultCount: count!,
          });
          toolResultParts.push(`Tool: ${tc.name}\nResult: ${output}`);
        }
        toolMessages.push({ role: "user", content: `Tool results:\n${toolResultParts.join("\n\n")}\n\nNow answer the original question using these additional results.` });
      }

      if (!aiResponse) {
        // Loop exhausted — inline collected tool evidence so the AI can actually use it
        const toolEvidence = toolMessages
          .filter((m, i) => i > 0 && m.role === "user" && m.content.startsWith("Tool results:"))
          .map((m) => m.content)
          .join("\n\n");
        const finalPrompt = toolEvidence
          ? `${prompt}\n\n--- Evidence from tool calls ---\n${toolEvidence}`
          : prompt;
        if (onChunk && provider.generateStream) {
          let fullText = "";
          for await (const chunk of provider.generateStream(systemPrompt, finalPrompt, aiKey, keys.aiModel || undefined, CHAT)) {
            onChunk(chunk);
            fullText += chunk;
          }
          aiResponse = fullText || null;
        } else {
          aiResponse = await provider.generate(systemPrompt, finalPrompt, aiKey, keys.aiModel || undefined);
        }
      }
    } else if (onChunk && provider.generateStream) {
      let fullText = "";
      for await (const chunk of provider.generateStream(systemPrompt, prompt, aiKey, keys.aiModel || undefined, CHAT)) {
        onChunk(chunk);
        fullText += chunk;
      }
      aiResponse = fullText || null;
    } else {
      aiResponse = await provider.generate(systemPrompt, prompt, aiKey, keys.aiModel || undefined);
    }

    if (aiResponse) {
      // Strip any [n] citation markers that weren't in the retrieved context.
      // Citations are numbered against `sources` only — web results aren't numbered in the prompt.
      const { cleaned, orphaned } = verifyCitations(aiResponse, sources.length);
      if (orphaned.length > 0) console.warn(`[citations] Stripped orphaned: [${orphaned.join(",")}]`);
      aiResponse = cleaned;

      // Validate and repair Source cells in the Source|What|When table.
      aiResponse = cleanResponseTables(aiResponse, sources);

      const outputTokens = estimateTokens(aiResponse);
      const finalTrace: ChatTrace = {
        ...trace,
        tokensUsed: { input: inputTokens, output: outputTokens, total: inputTokens + outputTokens },
        ...(recordedToolCalls.length > 0 ? { toolCalls: recordedToolCalls } : {}),
      };
      const followupSuggestions = buildFollowupSuggestions(userMessage, mode, queryTypeLabel, sources.length, relatedFeedback);
      return {
        response: aiResponse,
        sources: [...sources, ...webSources],
        tokenEstimate: { input: inputTokens, output: outputTokens, total: inputTokens + outputTokens },
        trace: finalTrace,
        ...(followupSuggestions.length > 0 ? { followupSuggestions } : {}),
        updatedState,
      };
    }
    aiAttemptedButFailed = true;
  }

  if (total === 0) {
    return {
      response: `I don't have any data loaded. Add API keys in Settings or enable demo data.`,
      sources: [],
      tokenEstimate: { input: 0, output: 0, total: 0 },
    };
  }

  const builtIn = generateBuiltInResponse(userMessage, searchContext, sources, scopedData);
  const builtInResponse = aiAttemptedButFailed
    ? `> **Note:** The configured ${aiProvider} provider didn't return a response — check your API key, quota, or network connection. Showing built-in fallback.\n\n${builtIn}`
    : builtIn;
  return { response: cleanResponseTables(builtInResponse, sources), sources, tokenEstimate: { input: 0, output: 0, total: 0 }, trace: { ...trace, aiError: aiAttemptedButFailed } };
}

function getSystemPrompt(mode: InteractionMode): string {
  if (mode === "prd") return PRD_SYSTEM_PROMPT;
  if (mode === "ticket") return TICKET_SYSTEM_PROMPT;
  if (mode === "learn") return LEARN_SYSTEM_PROMPT;
  return SYSTEM_PROMPT;
}

const THEME_KEYWORDS = [
  "emerging theme", "emerging themes", "themes", "theme", "patterns", "pattern",
  "signals", "signal", "trends", "trend", "common threads", "top themes",
  "what are we hearing", "what are customers saying", "what do customers want",
  "recurring", "recurring feedback", "key topics", "main topics",
];

function isThemeQuery(query: string): boolean {
  const q = query.toLowerCase();
  return THEME_KEYWORDS.some((kw) => q.includes(kw));
}

// Heuristic: queries primarily about product analytics (Pendo / Amplitude /
// PostHog usage data) should use ANALYTICS_FORMAT, which has a Page/Feature
// table instead of forcing analytics into a customer-source schema.
const ANALYTICS_QUERY_KEYWORDS = [
  "pendo", "amplitude", "posthog", "usage data", "usage signals",
  "page views", "pageviews", "events data", "feature usage", "page usage",
  "most used feature", "top features", "top pages", "least used",
  "click data", "clicks data", "telemetry", "instrumentation", "session data",
  "what does pendo", "what does amplitude", "what does posthog",
  "from pendo", "from amplitude", "from posthog",
  "engagement data", "adoption metrics", "active users",
];

function isAnalyticsQuery(query: string): boolean {
  const q = query.toLowerCase();
  return ANALYTICS_QUERY_KEYWORDS.some((kw) => q.includes(kw));
}

function getFormatInstructions(
  mode: InteractionMode,
  message?: string,
  history?: { role: "user" | "assistant"; content: string }[],
  hasComparison?: boolean
): string {
  if (mode === "prd") return PRD_FORMAT;
  if (mode === "ticket") return TICKET_FORMAT;
  if (mode === "learn") return `${LEARN_FORMAT}\n\n${HIGHLIGHT_RULE}\n\n${MARKDOWN_FORMATTING_RULES}\n\n${QUOTES_RULE}`;
  if (message && history) {
    const qType = classifyQueryType(message, history, !!hasComparison);
    // Analytics-centric queries get a dedicated format with a Page/Feature
    // table. This keeps "Pendo" out of the Source column and gives the model a
    // shape that fits product-usage data instead of customer-source data.
    if (isAnalyticsQuery(message)) {
      return `${ANALYTICS_FORMAT}\n\n${HIGHLIGHT_RULE}\n\n${WHAT_COLUMN_RULE}\n\n${QUOTES_RULE}`;
    }
    // Theme/pattern queries always get the detailed format regardless of qType,
    // because a conversational route gives a thin 300-word response.
    if (qType === "conversational" && isThemeQuery(message)) {
      return `${DETAILED_FORMAT}\n\n${HIGHLIGHT_RULE}\n\n${WHAT_COLUMN_RULE}\n\n${QUOTES_RULE}`;
    }
    switch (qType) {
      case "comparison": return `${COMPARISON_FORMAT}\n\n${HIGHLIGHT_RULE}\n\n${WHAT_COLUMN_RULE}\n\n${QUOTES_RULE}`;
      case "list": return `${LIST_FORMAT}\n\n${HIGHLIGHT_RULE}\n\n${WHAT_COLUMN_RULE}\n\n${QUOTES_RULE}`;
      case "conversational": return `${CONVERSATIONAL_FORMAT}\n\n${HIGHLIGHT_RULE}\n\n${WHAT_COLUMN_RULE}\n\n${QUOTES_RULE}`;
      case "count": return SUMMARIZE_FORMAT;
      default: return `${DETAILED_FORMAT}\n\n${HIGHLIGHT_RULE}\n\n${WHAT_COLUMN_RULE}\n\n${QUOTES_RULE}`;
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

const LEARN_SYSTEM_PROMPT = `You are a senior product intelligence analyst running a regular review for someone catching up after time away.

Your job is to surface what changed — not everything that exists. Structure your response in this exact order:

## What's new
Concrete signals (feedback, calls, tickets, doc updates) from the active time window. Cite [n]. Lead with the most significant; skip noise. If nothing is meaningfully new, say "Nothing notable this window" and move on.

## What changed
Insights or themes whose signal shifted — growing, shrinking, or newly appearing. Reference the specific direction and evidence. If the system flagged theme deltas or shifting insight confidence, surface those here. Skip if no meaningful shifts.

## What's contradicting
When sources disagree: customer praise vs. declining usage, open stale tickets vs. active demand, high-vote features with no engineering traction. Be specific — name the feature and both conflicting signals. If no contradictions were detected, say so briefly.

## What to watch next
1-3 questions the user should ask on their next review, based on the gaps or open threads in the current data.

Authoring constraints:
- Lead with the headline in each section. No "Based on the data..." preambles.
- Quote customer language directly when it sharpens a point.
- Do not widen the time window or scope beyond what's filtered without explicitly noting you're doing so.
- Sections with no signal get one sentence — don't pad them.
- Format discipline: section headings are markdown ## on their own line. Do not wrap the opening sentence of a section in bold.`;

const LEARN_FORMAT = `Output the four sections below in this exact order. Each section heading is its own line, surrounded by blank lines.

## What's new
[1-3 paragraphs OR a short bulleted list of concrete signals from the active time window. Cite [n]. Lead with the most significant find.]

## What changed
[1-2 paragraphs. Cite specific deltas — confidence shifts on insights, theme frequency moves. If themeDeltas/insightDeltas are in the pre-context, surface them here.]

## What's contradicting
[1-2 paragraphs OR a numbered list. When the pre-context flagged contradictions, surface the strongest 1-3 with explicit "Source A says X / Source B says Y" framing. If none, write one sentence and move on.]

## What to watch next
[1-3 short bullets — open questions or follow-up reviews.]

CRITICAL FORMAT RULES:
- Every "## Heading" is on its OWN LINE with a BLANK LINE before and after. Never "...sentence. ## Heading" or "## Heading content..." — always a hard break.
- Section opening sentences are NOT wrapped in bold. Use bold only for short data spans (numbers, account names, feature names) — never an entire clause.
- Empty sections still render the heading; write "Nothing notable this window" as the body and move on.
- Target 400-700 words total.

EXAMPLE — wrong vs right shape (catch-up sections must follow this):

WRONG (entire section wrapped as one bold paragraph — do not do this):
**What's new The most significant signal this window is the surge in MSP-portal demand. In the last 14 days, 8 new feedback entries were logged.**

RIGHT (heading and body are separate; bold only on short data spans):
## What's new

The most significant signal this window is a surge in MSP-portal demand. In the last 14 days, **8 new feedback entries** were logged.`;

const SUMMARIZE_FORMAT = `Use this format as a guide. Include sections the evidence supports; omit any that would be empty or forced.

[1-2 sentence answer to the question. Be specific. Do NOT wrap the entire opening sentence in **bold** — but **bold** on 1-2 short data spans within it is encouraged.]

## [Heading]

[1-3 paragraphs. What's new, what changed, what matters. Reference dates. Name distinct sub-themes if they exist.]

> "[direct customer quote if available]" — Customer Name or Email. Source: [Jira CX-123](link) or [Productboard note title](link if available)

| Source | What | When |
| --- | --- | --- |
[max 5 rows. SOURCE CELL RULES: Copy the IDENTITY from the Available Evidence list (everything before the colon) — company name, Jira/Linear key, "vote: X", "feedback on: X". VALID = Jira/Linear key (prefer linked "[CX-1234](url)"), company name, "vote: X", "feedback on: X", or analytics signal as "<Name> (Pendo page)" etc. Prefer a mix of source types. NEVER use customer email in Source (use in quote attribution only) and NEVER use the feedback title after the " — ". BANNED = generic portal titles, "known feature", "roadmap item", bare numbers, [n] citation markers, theme names, bare platform name alone. What = the actual request/issue. When = relative date (Xd ago, Xw ago, Xmo ago, today/yesterday) — no absolute dates.]

## Segmentation
[OPTIONAL. Include when signals differ meaningfully across account tier, industry, role, or use case. 1-3 sentences. Skip when the data is uniform.]

## Counter-signals
[OPTIONAL. Include when non-trivial evidence complicates the main finding (e.g., a subset of accounts experience the opposite, or a recent shift pushes the other way). 1-3 sentences. Skip if no meaningful disconfirming evidence exists.]

## Take
[OPTIONAL but encouraged. 1-3 sentences stating an opinionated recommendation or call, including a confidence phrase (e.g. "high confidence", "weak signal, high upside"). Differentiate from the descriptive answer above. Skip if the question is purely factual or evidence is too thin for a call.]

## Next Steps
1. [owner] [action] [by when]
[1-5 action items scaled to the answer's scope. Each on one line, single sentence. Skip this section entirely for purely informational questions.]

## Confidence
[Only include when EVIDENCE FACTS are present in context. Format: "Sample: N items from M accounts, newest Xd ago. Skew: [one phrase — e.g. "enterprise-heavy", "spread across segments", "mostly support tickets"]. Confidence: High / Medium / Low — [one phrase reason]." Example: "Sample: 9 items from 5 accounts, newest 2d ago. Skew: 60% enterprise. Confidence: Medium — fresh but skewed toward one segment." Omit entirely if EVIDENCE FACTS are not in context.]

CONSTRAINTS: 500 words max. No :--- in tables. Tables MUST be preceded by a blank line — never start a table header on the same line as prose. No multi-sentence action items. Every quote MUST include a specific, searchable source. Never show an unattributed quote. Do not cite Zapier/portal as the source identity; cite the actual customer identity from the note. Do not duplicate the same name/email in both quote attribution and Source field. When the question asks for specific feedback or ticket details, show the actual content. For "how many"/count questions, start with the numeric count and only say "no data" if there are zero matching items in context. Skip the quote section if none available.`;

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
  _query: string, context: string,
  sources: { type: string; id: string; title: string }[], data: AgentData
): string {
  const total = data.feedback.length + data.features.length + data.calls.length + data.insights.length + data.jiraIssues.length + data.confluencePages.length + data.linearIssues.length;
  const rows = sources.slice(0, 8).map((s) => `| ${s.type} | ${s.title} |`).join("\n");

  return `Found **${sources.length} relevant items** across ${total} total${data.analyticsOverview ? " (plus analytics)" : ""}.

| Source | Item |
|--------|------|
${rows}

${context.slice(0, 1200)}

---
Connect an AI provider key in Settings for AI-powered analysis.`;
}


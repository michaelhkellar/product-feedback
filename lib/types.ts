export type FeedbackSource = "productboard" | "attention" | "pendo" | "zendesk" | "slack" | "intercom" | "jira" | "linear" | "confluence" | "manual";
export type Sentiment = "positive" | "negative" | "neutral" | "mixed";
export type Priority = "critical" | "high" | "medium" | "low";
export type InsightType =
  | "trend"
  | "theme"
  | "anomaly"
  | "recommendation"
  | "risk"
  | "opportunity"
  | "segment"
  | "contradiction";

export interface FeedbackItem {
  id: string;
  source: FeedbackSource;
  title: string;
  content: string;
  customer: string;
  company?: string;
  sentiment: Sentiment;
  themes: string[];
  date: string;
  priority: Priority;
  metadata?: Record<string, string>;
  // Enrichment-derived fields (optional, populated by AI enrichment)
  urgency?: "high" | "medium" | "low";
  actionability?: "high" | "medium" | "low";
  topicArea?: string;
  enrichmentConfidence?: number;
}

export interface ProductboardFeature {
  id: string;
  name: string;
  description: string;
  status: "new" | "planned" | "in_progress" | "done";
  votes: number;
  customerRequests: number;
  themes: string[];
}

export interface AttentionCall {
  id: string;
  title: string;
  date: string;
  duration: string;
  participants: string[];
  summary: string;
  keyMoments: { timestamp: string; text: string; sentiment: Sentiment }[];
  actionItems: string[];
  themes: string[];
}

export interface JiraIssue {
  id: string;
  key: string;
  summary: string;
  description: string;
  status: string;
  issueType: string;
  priority: string;
  assignee: string;
  reporter: string;
  labels: string[];
  created: string;
  updated: string;
  project: string;
  resolution: string;
}

export interface ConfluencePage {
  id: string;
  title: string;
  excerpt: string;
  space: string;
  lastModified: string;
  author: string;
  url: string;
}

export interface Insight {
  id: string;
  type: InsightType;
  title: string;
  description: string;
  confidence: number;
  relatedFeedbackIds: string[];
  themes: string[];
  impact: "high" | "medium" | "low";
  createdAt: string;
  // Optional richer fields populated by AI insight generation for better depth.
  segment?: string;
  evidence?: { type: "feedback" | "jira" | "call" | "analytics"; id: string; label: string }[];
  counterSignal?: string;
  suggestedAction?: string;
}

export interface AnalyticsOverviewItem {
  id: string;
  name: string;
  count: number;
  minutes?: number;
  /** Count from the immediately-preceding equal-length window, when trend data is available. */
  priorCount?: number;
  /** Signed percentage change vs priorCount; undefined when no prior data. */
  deltaPct?: number;
}

export interface AnalyticsAccountItem {
  id: string;
  count: number;
  minutes?: number;
  priorCount?: number;
  deltaPct?: number;
}

export interface AnalyticsOverview {
  provider: "pendo" | "amplitude" | "posthog";
  topPages: AnalyticsOverviewItem[];
  topFeatures: AnalyticsOverviewItem[];
  topEvents: AnalyticsOverviewItem[];
  topAccounts: AnalyticsAccountItem[];
  totalTrackedPages: number;
  totalTrackedFeatures: number;
  generatedAt: string;
  limitations?: string[];
  allPageNames?: string[];
  allFeatureNames?: string[];
  allEventNames?: string[];
  /** Window used for the primary (current) period — e.g. "last 30 days" */
  windowLabel?: string;
  /** Window used for comparison — e.g. "30 days prior" — populated when trends computed */
  priorWindowLabel?: string;
  /** Biggest climbers by deltaPct (filtered to items with meaningful volume) */
  risingItems?: { name: string; kind: "page" | "feature" | "event"; count: number; priorCount: number; deltaPct: number }[];
  /** Biggest decliners */
  fallingItems?: { name: string; kind: "page" | "feature" | "event"; count: number; priorCount: number; deltaPct: number }[];
}

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  assignee: string;
  labels: string[];
  created: string;
  updated: string;
  team: string;
  url: string;
}

export interface AnalyticsLookupContext {
  context: string;
  sources: { type: string; id: string; title: string }[];
}

export interface FullAnalyticsResult {
  pages: AnalyticsOverviewItem[];
  features: AnalyticsOverviewItem[];
  events: AnalyticsOverviewItem[];
  accounts: AnalyticsAccountItem[];
}

export interface ChatMessageTrace {
  detectedIntent: string;
  queryType: string;
  timeRange?: { label: string; start?: string; end?: string };
  themesDetected: string[];
  retrieval: { query: string; topResults: { id: string; type: string; score: number }[] };
  contextMode: string;
  tokensUsed: { input: number; output: number; total: number };
  pivotExcluded?: string[];
  aiError?: boolean;
  toolCalls?: { name: string; query: string; resultCount: number }[];
}

export type FollowupSuggestion = {
  label: string;
  prompt: string;
  kind: "tenx" | "counter" | "gaps" | "cohort" | "custom";
};

export interface ChatFilters {
  timeRange: string; // TimeRangeOption: "7d" | "14d" | "30d" | "90d" | "all"
  themes: string[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  sources?: { type: string; id: string; title: string; url?: string }[];
  trace?: ChatMessageTrace;
  isStreaming?: boolean;
  followupSuggestions?: FollowupSuggestion[];
  /** Optional short label to render in the UI instead of `content`.
   *  Used when a follow-up chip sends a long prompt to the model but we
   *  want the chat bubble to show a compact label (e.g. "10x thinking"). */
  displayContent?: string;
}

export interface DataSourceStatus {
  name: string;
  source: FeedbackSource;
  connected: boolean;
  lastSync?: string;
  itemCount: number;
  icon: string;
}

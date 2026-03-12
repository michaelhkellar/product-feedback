export type FeedbackSource = "productboard" | "attention" | "pendo" | "zendesk" | "slack" | "intercom" | "jira" | "confluence" | "manual";
export type Sentiment = "positive" | "negative" | "neutral" | "mixed";
export type Priority = "critical" | "high" | "medium" | "low";
export type InsightType = "trend" | "theme" | "anomaly" | "recommendation" | "risk";

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
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  sources?: { type: string; id: string; title: string; url?: string }[];
  isStreaming?: boolean;
}

export interface DataSourceStatus {
  name: string;
  source: FeedbackSource;
  connected: boolean;
  lastSync?: string;
  itemCount: number;
  icon: string;
}

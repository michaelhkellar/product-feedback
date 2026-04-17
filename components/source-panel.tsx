"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useApiKeys } from "./api-key-provider";
import { useEntityDrawer } from "./entity-drawer-provider";
import { useFilters, timeRangeToDays } from "./filter-provider";
import {
  DEMO_DATA_SOURCES,
  DEMO_FEEDBACK,
  DEMO_PRODUCTBOARD_FEATURES,
  DEMO_ATTENTION_CALLS,
  DEMO_JIRA_ISSUES,
  DEMO_CONFLUENCE_PAGES,
} from "@/lib/demo-data";
import {
  FeedbackItem,
  ProductboardFeature,
  AttentionCall,
  JiraIssue,
  ConfluencePage,
  DataSourceStatus,
} from "@/lib/types";
import type { AnalyticsOverview } from "@/lib/types";
import {
  ClipboardList,
  Phone,
  Headphones,
  MessageCircle,
  Hash,
  CheckCircle2,
  Circle,
  ChevronRight,
  Database,
  RefreshCcw,
  ArrowUpRight,
  X,
  Clock,
  Users,
  ThumbsUp,
  ThumbsDown,
  Minus,
  AlertTriangle,
  Settings,
  Loader2,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";

const SOURCE_ICONS: Record<string, typeof ClipboardList> = {
  "clipboard-list": ClipboardList,
  phone: Phone,
  headphones: Headphones,
  "message-circle": MessageCircle,
  hash: Hash,
};

interface SourcePanelProps {
  className?: string;
  onQuerySource?: (query: string) => void;
  onOpenSettings?: () => void;
}

type DetailView =
  | { type: "feedback"; data: FeedbackItem }
  | { type: "feature"; data: ProductboardFeature }
  | { type: "call"; data: AttentionCall }
  | { type: "jira"; data: JiraIssue }
  | { type: "confluence"; data: ConfluencePage }
  | { type: "pendo"; data: AnalyticsFinding }
  | { type: "amplitude"; data: AnalyticsFinding }
  | { type: "posthog"; data: AnalyticsFinding }
  | null;

type AnalyticsFinding = {
  id: string;
  provider: string;
  kind: "page" | "feature" | "account";
  title: string;
  subtitle: string;
  totalEvents: number;
  totalMinutes: number;
  loadedAt: string;
};

// Keep for backwards compat within this file
type PendoFinding = AnalyticsFinding;

function formatPendoMinutes(totalMinutes: number): string {
  if (totalMinutes >= 60) return `${(totalMinutes / 60).toFixed(1)}h`;
  if (totalMinutes > 0) return `${totalMinutes.toFixed(1)}m`;
  return "0m";
}

function buildAnalyticsFindings(overview: AnalyticsOverview | null, provider: string): AnalyticsFinding[] {
  if (!overview) return [];

  const findings: AnalyticsFinding[] = [
    ...overview.topPages.map((item) => ({
      id: `page:${item.id}`,
      provider,
      kind: "page" as const,
      title: item.name,
      subtitle: "Page activity",
      totalEvents: item.count,
      totalMinutes: item.minutes || 0,
      loadedAt: overview.generatedAt,
    })),
    ...overview.topFeatures.map((item) => ({
      id: `feature:${item.id}`,
      provider,
      kind: "feature" as const,
      title: item.name,
      subtitle: "Feature activity",
      totalEvents: item.count,
      totalMinutes: item.minutes || 0,
      loadedAt: overview.generatedAt,
    })),
    ...overview.topEvents.map((item) => ({
      id: `event:${item.id}`,
      provider,
      kind: "feature" as const,
      title: item.name,
      subtitle: "Event activity",
      totalEvents: item.count,
      totalMinutes: 0,
      loadedAt: overview.generatedAt,
    })),
    ...overview.topAccounts.map((item) => ({
      id: `account:${item.id}`,
      provider,
      kind: "account" as const,
      title: item.id,
      subtitle: "Account-level product usage",
      totalEvents: item.count,
      totalMinutes: item.minutes || 0,
      loadedAt: overview.generatedAt,
    })),
  ];

  return findings.sort((a, b) => b.totalEvents - a.totalEvents);
}

// Keep the old name as an alias so callers don't need updating
function buildPendoFindings(overview: AnalyticsOverview | null): AnalyticsFinding[] {
  return buildAnalyticsFindings(overview, "pendo");
}

export function SourcePanel({
  className,
  onQuerySource,
  onOpenSettings,
}: SourcePanelProps) {
  const { keys, status, useDemoData, keyHeaders } = useApiKeys();
  const { openEntity } = useEntityDrawer();
  const { filters } = useFilters();

  const [activeTab, setActiveTab] = useState<
    "sources" | "feedback" | "features" | "calls" | "pendo" | "amplitude" | "posthog" | "jira" | "confluence"
  >("sources");
  const [detail, setDetail] = useState<DetailView>(null);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const [feedback, setFeedback] = useState<FeedbackItem[]>([]);
  const [features, setFeatures] = useState<ProductboardFeature[]>([]);
  const [calls, setCalls] = useState<AttentionCall[]>([]);
  const [jiraIssues, setJiraIssues] = useState<JiraIssue[]>([]);
  const [confluencePages, setConfluencePages] = useState<ConfluencePage[]>([]);
  const [pendoFindings, setPendoFindings] = useState<AnalyticsFinding[]>([]);
  const [amplitudeFindings, setAmplitudeFindings] = useState<AnalyticsFinding[]>([]);
  const [posthogFindings, setPosthogFindings] = useState<AnalyticsFinding[]>([]);
  const [dataSources, setDataSources] = useState<DataSourceStatus[]>([]);
  const [dataIsDemo, setDataIsDemo] = useState(true);
  const [pendoItemCount, setPendoItemCount] = useState(0);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const demoHeader = useDemoData ? "true" : "false";
      const headers = { ...keyHeaders, "x-use-demo": demoHeader };

      const fetches = [
        fetch("/api/sources/productboard", { headers }).then((r) => r.json()),
        fetch("/api/sources/attention", { headers }).then((r) => r.json()),
        fetch("/api/sources/atlassian", { headers }).then((r) => r.json()).catch(() => ({ connected: false, jiraIssues: [], confluencePages: [] })),
        fetch("/api/sources/pendo", { headers }).then((r) => r.json()).catch(() => ({ connected: false, overview: null })),
        fetch("/api/sources/amplitude", { headers }).then((r) => r.json()).catch(() => ({ connected: false, overview: null })),
        fetch("/api/sources/posthog", { headers }).then((r) => r.json()).catch(() => ({ connected: false, overview: null })),
      ];
      const [pbRes, attRes, atlRes, pendoRes, ampRes, phRes] = await Promise.all(fetches);

      const newFeatures: ProductboardFeature[] = pbRes.features || [];
      const newFeedback: FeedbackItem[] = pbRes.notes || [];
      const newCalls: AttentionCall[] = attRes.calls || [];
      const newJira: JiraIssue[] = atlRes.jiraIssues || [];
      const newConfluence: ConfluencePage[] = atlRes.confluencePages || [];
      const atlConnected = atlRes.connected === true;
      const isDemo = pbRes.featuresIsDemo || attRes.callsIsDemo;
      const newPendoFindings = buildPendoFindings(pendoRes.overview || null);
      const newPendoCount = newPendoFindings.length;
      const newAmplitudeFindings = buildAnalyticsFindings(ampRes.overview || null, "amplitude");
      const newPosthogFindings = buildAnalyticsFindings(phRes.overview || null, "posthog");

      if (useDemoData && isDemo && !atlConnected) {
        setFeedback(DEMO_FEEDBACK);
        setFeatures(DEMO_PRODUCTBOARD_FEATURES);
        setCalls(DEMO_ATTENTION_CALLS);
        setJiraIssues(DEMO_JIRA_ISSUES);
        setConfluencePages(DEMO_CONFLUENCE_PAGES);
      } else {
        setFeedback(newFeedback);
        setFeatures(newFeatures);
        setCalls(newCalls);
        setJiraIssues(newJira);
        setConfluencePages(newConfluence);
      }
      setPendoFindings(newPendoFindings);
      setAmplitudeFindings(newAmplitudeFindings);
      setPosthogFindings(newPosthogFindings);
      setPendoItemCount(newPendoCount);
      setDataIsDemo(isDemo && useDemoData && !atlConnected);

      const sources: DataSourceStatus[] = [];
      if (status.productboardKey.configured) {
        sources.push({ name: "Productboard", source: "productboard", connected: pbRes.connected, lastSync: pbRes.connected ? "just now" : undefined, itemCount: newFeatures.length + newFeedback.length, icon: "clipboard-list" });
      }
      if (status.attentionKey.configured) {
        sources.push({ name: "Attention", source: "attention", connected: attRes.connected, lastSync: attRes.connected ? "just now" : undefined, itemCount: newCalls.length, icon: "phone" });
      }
      if (status.pendoKey?.configured || pendoRes.connected) {
        sources.push({
          name: "Pendo",
          source: "pendo",
          connected: pendoRes.connected,
          lastSync: pendoRes.connected ? "just now" : undefined,
          itemCount: newPendoCount,
          icon: "hash",
        });
      }
      if (status.amplitudeKey?.configured || ampRes.connected) {
        sources.push({
          name: "Amplitude",
          source: "amplitude" as "pendo",
          connected: ampRes.connected,
          lastSync: ampRes.connected ? "just now" : undefined,
          itemCount: newAmplitudeFindings.length,
          icon: "hash",
        });
      }
      if (status.posthogKey?.configured || phRes.connected) {
        sources.push({
          name: "PostHog",
          source: "posthog" as "pendo",
          connected: phRes.connected,
          lastSync: phRes.connected ? "just now" : undefined,
          itemCount: newPosthogFindings.length,
          icon: "hash",
        });
      }
      if (status.atlassianKey?.configured || atlConnected) {
        const jiraStatus = atlRes.jiraError ? `Error: ${String(atlRes.jiraError).slice(0, 100)}` : atlConnected ? "just now" : undefined;
        const confStatus = atlRes.confluenceError ? `Error: ${String(atlRes.confluenceError).slice(0, 100)}` : atlConnected ? "just now" : undefined;
        sources.push({ name: "Jira", source: "jira", connected: atlConnected && !atlRes.jiraError, lastSync: jiraStatus, itemCount: newJira.length, icon: "clipboard-list" });
        sources.push({ name: "Confluence", source: "confluence", connected: atlConnected && !atlRes.confluenceError, lastSync: confStatus, itemCount: newConfluence.length, icon: "clipboard-list" });
      }

      if (useDemoData && isDemo && sources.length === 0) {
        setDataSources(DEMO_DATA_SOURCES);
      } else if (sources.length > 0) {
        setDataSources(sources);
      } else {
        setDataSources([]);
      }
    } catch {
      if (useDemoData) {
        setFeedback(DEMO_FEEDBACK);
        setFeatures(DEMO_PRODUCTBOARD_FEATURES);
        setCalls(DEMO_ATTENTION_CALLS);
        setJiraIssues(DEMO_JIRA_ISSUES);
        setConfluencePages(DEMO_CONFLUENCE_PAGES);
        setPendoFindings([]);
        setAmplitudeFindings([]);
        setPosthogFindings([]);
        setDataSources(DEMO_DATA_SOURCES);
        setDataIsDemo(true);
        setPendoItemCount(0);
      }
    } finally {
      setLoading(false);
    }
  }, [keys, keyHeaders, status, useDemoData]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const sq = searchQuery.toLowerCase().trim();

  // Compute cutoff timestamp from global time filter
  const filterCutoffMs = useMemo(() => {
    const days = timeRangeToDays(filters.timeRange);
    if (!days) return null;
    return Date.now() - days * 24 * 60 * 60 * 1000;
  }, [filters.timeRange]);

  function itemIsInTimeRange(dateStr: string | undefined): boolean {
    if (!filterCutoffMs || !dateStr) return true;
    const t = new Date(dateStr).getTime();
    return !isNaN(t) && t >= filterCutoffMs;
  }

  const filteredFeedback = useMemo(() => {
    let items = feedback;
    if (filterCutoffMs) items = items.filter((fb) => itemIsInTimeRange(fb.date));
    if (filters.themes.length > 0) items = items.filter((fb) => fb.themes.some((t) => filters.themes.includes(t)));
    if (!sq) return items;
    return items.filter(
      (fb) =>
        fb.title.toLowerCase().includes(sq) ||
        fb.content.toLowerCase().includes(sq) ||
        fb.customer.toLowerCase().includes(sq) ||
        (fb.company || "").toLowerCase().includes(sq) ||
        fb.themes.some((t) => t.toLowerCase().includes(sq))
    );
  }, [feedback, sq, filterCutoffMs, filters.themes]);

  const filteredFeatures = useMemo(() => {
    if (!sq) return features;
    return features.filter(
      (f) =>
        f.name.toLowerCase().includes(sq) ||
        f.description.toLowerCase().includes(sq) ||
        f.status.toLowerCase().includes(sq) ||
        f.themes.some((t) => t.toLowerCase().includes(sq))
    );
  }, [features, sq]);

  const filteredCalls = useMemo(() => {
    let items = calls;
    if (filterCutoffMs) items = items.filter((c) => itemIsInTimeRange(c.date));
    if (filters.themes.length > 0) items = items.filter((c) => c.themes.some((t) => filters.themes.includes(t)));
    if (!sq) return items;
    return items.filter(
      (c) =>
        c.title.toLowerCase().includes(sq) ||
        c.summary.toLowerCase().includes(sq) ||
        c.participants.some((p) => p.toLowerCase().includes(sq)) ||
        c.themes.some((t) => t.toLowerCase().includes(sq))
    );
  }, [calls, sq, filterCutoffMs, filters.themes]);

  const filteredJira = useMemo(() => {
    if (!sq) return jiraIssues;
    return jiraIssues.filter(
      (j) =>
        j.key.toLowerCase().includes(sq) ||
        j.summary.toLowerCase().includes(sq) ||
        j.status.toLowerCase().includes(sq) ||
        j.issueType.toLowerCase().includes(sq) ||
        j.project.toLowerCase().includes(sq) ||
        j.assignee.toLowerCase().includes(sq) ||
        j.labels.some((l) => l.toLowerCase().includes(sq))
    );
  }, [jiraIssues, sq]);

  const filteredConfluence = useMemo(() => {
    if (!sq) return confluencePages;
    return confluencePages.filter(
      (p) =>
        p.title.toLowerCase().includes(sq) ||
        p.excerpt.toLowerCase().includes(sq) ||
        p.space.toLowerCase().includes(sq)
    );
  }, [confluencePages, sq]);

  const filteredPendo = useMemo(() => {
    if (!sq) return pendoFindings;
    return pendoFindings.filter(
      (item) =>
        item.title.toLowerCase().includes(sq) ||
        item.subtitle.toLowerCase().includes(sq) ||
        item.kind.toLowerCase().includes(sq)
    );
  }, [pendoFindings, sq]);

  const filteredAmplitude = useMemo(() => {
    if (!sq) return amplitudeFindings;
    return amplitudeFindings.filter(
      (item) =>
        item.title.toLowerCase().includes(sq) ||
        item.subtitle.toLowerCase().includes(sq) ||
        item.kind.toLowerCase().includes(sq)
    );
  }, [amplitudeFindings, sq]);

  const filteredPosthog = useMemo(() => {
    if (!sq) return posthogFindings;
    return posthogFindings.filter(
      (item) =>
        item.title.toLowerCase().includes(sq) ||
        item.subtitle.toLowerCase().includes(sq) ||
        item.kind.toLowerCase().includes(sq)
    );
  }, [posthogFindings, sq]);

  const totalItems = feedback.length + features.length + calls.length + jiraIssues.length + confluencePages.length + pendoItemCount + amplitudeFindings.length + posthogFindings.length;

  function formatDate(dateStr: string | undefined): string {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "";
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days === 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days}d ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
  }

  function getItemDate(item: Record<string, unknown>): number {
    const str = (item.date || item.updated || item.created || item.lastModified || item.createdAt || "") as string;
    if (!str) return 0;
    const d = new Date(str);
    return isNaN(d.getTime()) ? 0 : d.getTime();
  }

  function sortByDate<T>(items: T[]): T[] {
    return [...items].sort((a, b) => getItemDate(b as unknown as Record<string, unknown>) - getItemDate(a as unknown as Record<string, unknown>));
  }

  const sortedFeedback = useMemo(() => sortByDate(filteredFeedback), [filteredFeedback]);
  const sortedFeatures = useMemo(() => sortByDate(filteredFeatures), [filteredFeatures]);
  const sortedCalls = useMemo(() => sortByDate(filteredCalls), [filteredCalls]);
  const sortedJira = useMemo(() => sortByDate(filteredJira), [filteredJira]);
  const sortedConfluence = useMemo(() => sortByDate(filteredConfluence), [filteredConfluence]);
  const sortedPendo = useMemo(() => [...filteredPendo].sort((a, b) => b.totalEvents - a.totalEvents), [filteredPendo]);
  const sortedAmplitude = useMemo(() => [...filteredAmplitude].sort((a, b) => b.totalEvents - a.totalEvents), [filteredAmplitude]);
  const sortedPosthog = useMemo(() => [...filteredPosthog].sort((a, b) => b.totalEvents - a.totalEvents), [filteredPosthog]);

  const sentimentIcon = (s: string) => {
    if (s === "positive")
      return <ThumbsUp className="w-3 h-3 text-green-500" />;
    if (s === "negative")
      return <ThumbsDown className="w-3 h-3 text-red-500" />;
    return <Minus className="w-3 h-3 text-muted-foreground" />;
  };

  const showSearch = activeTab !== "sources";

  return (
    <div className={cn("flex flex-col h-full", className)}>
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Database className="w-4 h-4 text-blue-500" />
            Data Sources
          </h2>
          <div className="flex items-center gap-2">
            {dataIsDemo && (
              <span className="text-[9px] bg-amber-500/10 text-amber-600 px-2 py-0.5 rounded-full font-medium">
                Demo
              </span>
            )}
            <span className="text-[10px] bg-green-500/10 text-green-600 px-2 py-0.5 rounded-full font-medium">
              {totalItems} items
            </span>
          </div>
        </div>
        <div className="flex gap-1 flex-wrap">
          {(
            [
              { key: "sources" as const, label: "Sources" },
              { key: "feedback" as const, label: `Feedback (${feedback.length})` },
              { key: "features" as const, label: `Features (${features.length})` },
              ...(calls.length > 0 ? [{ key: "calls" as const, label: `Calls (${calls.length})` }] : []),
              ...(pendoFindings.length > 0 || status.pendoKey?.configured ? [{ key: "pendo" as const, label: `Pendo (${pendoFindings.length})` }] : []),
              ...(amplitudeFindings.length > 0 || status.amplitudeKey?.configured ? [{ key: "amplitude" as const, label: `Amplitude (${amplitudeFindings.length})` }] : []),
              ...(posthogFindings.length > 0 || status.posthogKey?.configured ? [{ key: "posthog" as const, label: `PostHog (${posthogFindings.length})` }] : []),
              ...(jiraIssues.length > 0 || status.atlassianKey?.configured ? [{ key: "jira" as const, label: `Jira (${jiraIssues.length})` }] : []),
              ...(confluencePages.length > 0 || status.atlassianKey?.configured ? [{ key: "confluence" as const, label: `Docs (${confluencePages.length})` }] : []),
            ]
          ).map((tab) => (
            <button
              key={tab.key}
              onClick={() => { setActiveTab(tab.key); setSearchQuery(""); }}
              className={cn(
                "px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors",
                activeTab === tab.key
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {showSearch && (
        <div className="px-3 py-2 border-b border-border">
          <div className="flex items-center gap-2 bg-muted rounded-lg px-2.5 py-1.5">
            <Search className="w-3 h-3 text-muted-foreground flex-shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`Search ${activeTab}...`}
              className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/60"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          {sq && (
            <p className="text-[10px] text-muted-foreground mt-1 px-1">
              {activeTab === "feedback" && `${filteredFeedback.length} of ${feedback.length} results`}
              {activeTab === "features" && `${filteredFeatures.length} of ${features.length} results`}
              {activeTab === "calls" && `${filteredCalls.length} of ${calls.length} results`}
              {activeTab === "pendo" && `${filteredPendo.length} of ${pendoFindings.length} results`}
              {activeTab === "amplitude" && `${filteredAmplitude.length} of ${amplitudeFindings.length} results`}
              {activeTab === "posthog" && `${filteredPosthog.length} of ${posthogFindings.length} results`}
              {activeTab === "jira" && `${filteredJira.length} of ${jiraIssues.length} results`}
              {activeTab === "confluence" && `${filteredConfluence.length} of ${confluencePages.length} results`}
            </p>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {loading && (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
            <span className="text-xs">Loading data...</span>
          </div>
        )}

        {!loading && activeTab === "sources" && (
          <div className="p-3 space-y-2">
            {dataSources.length > 0 ? (
              dataSources.map((source) => {
                const Icon = SOURCE_ICONS[source.icon] || Database;
                return (
                  <div
                    key={source.name}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-border bg-card hover:bg-accent/30 transition-colors"
                  >
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Icon className="w-4 h-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium">
                          {source.name}
                        </span>
                        {source.connected ? (
                          <CheckCircle2 className="w-3 h-3 text-green-500" />
                        ) : (
                          <Circle className="w-3 h-3 text-muted-foreground" />
                        )}
                        {dataIsDemo && (
                          <span className="text-[8px] bg-amber-500/10 text-amber-600 px-1 py-0.5 rounded font-medium">
                            DEMO
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        <span>{source.itemCount} items</span>
                        {source.lastSync && (
                          <>
                            <span>·</span>
                            <span>Synced {source.lastSync}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={loadData}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      title="Refresh data"
                    >
                      <RefreshCcw className="w-3 h-3" />
                    </button>
                  </div>
                );
              })
            ) : (
              <div className="text-center py-6 text-muted-foreground">
                <Database className="w-6 h-6 mx-auto mb-2 opacity-40" />
                <p className="text-xs">No data sources connected</p>
              </div>
            )}
            <div
              className="mt-3 p-3 rounded-xl border border-dashed border-border text-center cursor-pointer hover:bg-accent/30 transition-colors"
              onClick={onOpenSettings}
            >
              <div className="flex items-center justify-center gap-2 mb-1">
                <Settings className="w-3 h-3 text-muted-foreground" />
                <p className="text-[10px] text-muted-foreground font-medium">
                  {status.geminiKey.configured ||
                  status.anthropicKey?.configured ||
                  status.openaiKey?.configured ||
                  status.productboardKey.configured ||
                  status.attentionKey.configured ||
                  status.pendoKey?.configured ||
                  status.amplitudeKey?.configured ||
                  status.posthogKey?.configured ||
                  status.atlassianKey?.configured ||
                  status.linearKey?.configured
                    ? "Manage API keys"
                    : "Add API keys to connect live data"}
                </p>
              </div>
              <div className="flex items-center justify-center gap-2 text-[9px] flex-wrap">
                {[
                  { label: "Gemini", configured: status.geminiKey.configured },
                  { label: "Anthropic", configured: status.anthropicKey?.configured },
                  { label: "OpenAI", configured: status.openaiKey?.configured },
                  { label: "Productboard", configured: status.productboardKey.configured },
                  { label: "Attention", configured: status.attentionKey.configured },
                  { label: "Pendo", configured: status.pendoKey?.configured },
                  { label: "Amplitude", configured: status.amplitudeKey?.configured },
                  { label: "PostHog", configured: status.posthogKey?.configured },
                  { label: "Atlassian", configured: status.atlassianKey?.configured },
                  { label: "Linear", configured: status.linearKey?.configured },
                ].map((s) => (
                  <span
                    key={s.label}
                    className={cn(
                      "px-1.5 py-0.5 rounded",
                      s.configured ? "bg-green-500/10 text-green-600" : "bg-muted text-muted-foreground"
                    )}
                  >
                    {s.label} {s.configured ? "\u2713" : "\u2014"}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {!loading && activeTab === "feedback" && (
          <div>
            {sortedFeedback.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <AlertTriangle className="w-5 h-5 mx-auto mb-2 opacity-40" />
                <p className="text-xs mb-1">{sq ? "No matching feedback" : "No feedback data"}</p>
                {!sq && <p className="text-[10px]">Connect API keys or enable demo data in Settings</p>}
              </div>
            ) : (
              sortedFeedback.map((fb) => {
                const dt = formatDate(fb.date);
                return (
                  <button key={fb.id} onClick={() => setDetail({ type: "feedback", data: fb })}
                    className="w-full text-left px-4 py-3 border-b border-border hover:bg-accent/30 transition-colors group">
                    <div className="flex items-start gap-2.5">
                      {sentimentIcon(fb.sentiment)}
                      <div className="flex-1 min-w-0">
                        <h4 className="text-xs font-medium line-clamp-1">{fb.title}</h4>
                        <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-muted-foreground">
                          {dt && <><span className="text-foreground/50">{dt}</span><span>·</span></>}
                          <span className="capitalize">{fb.source}</span>
                          {fb.customer && <><span>·</span><span>{fb.customer}</span></>}
                        </div>
                      </div>
                      <ChevronRight className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity mt-0.5" />
                    </div>
                  </button>
                );
              })
            )}
          </div>
        )}

        {!loading && activeTab === "features" && (
          <div>
            {sortedFeatures.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <AlertTriangle className="w-5 h-5 mx-auto mb-2 opacity-40" />
                <p className="text-xs mb-1">{sq ? "No matching features" : "No feature data"}</p>
                {!sq && <p className="text-[10px]">Connect Productboard or enable demo data in Settings</p>}
              </div>
            ) : (
              sortedFeatures.map((feat) => (
                <button key={feat.id} onClick={() => setDetail({ type: "feature", data: feat })}
                  className="w-full text-left px-4 py-3 border-b border-border hover:bg-accent/30 transition-colors group">
                  <div className="flex items-start gap-2.5">
                    <div className={cn("w-2 h-2 rounded-full mt-1.5 flex-shrink-0",
                      feat.status === "in_progress" && "bg-blue-500", feat.status === "planned" && "bg-amber-500",
                      feat.status === "new" && "bg-muted-foreground", feat.status === "done" && "bg-green-500")} />
                    <div className="flex-1 min-w-0">
                      <h4 className="text-xs font-medium line-clamp-1">{feat.name}</h4>
                      <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground">
                        <span className="capitalize">{feat.status.replace("_", " ")}</span>
                        {feat.votes > 0 && <><span>·</span><span>{feat.votes} votes</span></>}
                      </div>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        )}

        {!loading && activeTab === "calls" && (
          <div>
            {sortedCalls.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <AlertTriangle className="w-5 h-5 mx-auto mb-2 opacity-40" />
                <p className="text-xs mb-1">{sq ? "No matching calls" : "No call data"}</p>
                {!sq && (
                  <p className="text-[10px]">
                    Connect Attention or enable demo data in Settings
                  </p>
                )}
              </div>
            ) : (
              sortedCalls.map((call) => {
                const dt = formatDate(call.date);
                return (
                  <button key={call.id} onClick={() => setDetail({ type: "call", data: call })}
                    className="w-full text-left px-4 py-3 border-b border-border hover:bg-accent/30 transition-colors group">
                    <div className="flex items-start gap-2.5">
                      <Phone className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <h4 className="text-xs font-medium line-clamp-1">{call.title}</h4>
                        <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground">
                          {dt && <><span className="text-foreground/50">{dt}</span><span>·</span></>}
                          <span>{call.duration}</span><span>·</span>
                          <Users className="w-2.5 h-2.5" /><span>{call.participants.length}</span>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        )}
        {!loading && activeTab === "pendo" && (
          <div>
            {sortedPendo.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground px-4">
                <AlertTriangle className="w-5 h-5 mx-auto mb-2 opacity-40" />
                <p className="text-xs mb-1">{sq ? "No matching Pendo findings" : "No Pendo findings loaded"}</p>
                {!sq && <p className="text-[10px]">Connect Pendo to review recent page, feature, and account activity</p>}
              </div>
            ) : (
              sortedPendo.map((item) => (
                <button key={item.id} onClick={() => setDetail({ type: "pendo", data: item })}
                  className="w-full text-left px-4 py-3 border-b border-border hover:bg-accent/30 transition-colors group">
                  <div className="flex items-start gap-2.5">
                    <Hash className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <h4 className="text-xs font-medium line-clamp-1">{item.title}</h4>
                      <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-muted-foreground">
                        <span className="capitalize">{item.kind}</span>
                        <span>·</span>
                        <span>{item.totalEvents} events</span>
                        <span>·</span>
                        <span>{formatPendoMinutes(item.totalMinutes)}</span>
                      </div>
                    </div>
                    <ChevronRight className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity mt-0.5" />
                  </div>
                </button>
              ))
            )}
          </div>
        )}

        {!loading && activeTab === "amplitude" && (
          <div>
            {sortedAmplitude.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground px-4">
                <AlertTriangle className="w-5 h-5 mx-auto mb-2 opacity-40" />
                <p className="text-xs mb-1">{sq ? "No matching Amplitude findings" : "No Amplitude data loaded"}</p>
                {!sq && <p className="text-[10px]">Connect Amplitude to review top events and user activity</p>}
              </div>
            ) : (
              sortedAmplitude.map((item) => (
                <button key={item.id} onClick={() => setDetail({ type: "amplitude", data: item })}
                  className="w-full text-left px-4 py-3 border-b border-border hover:bg-accent/30 transition-colors group">
                  <div className="flex items-start gap-2.5">
                    <Hash className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <h4 className="text-xs font-medium line-clamp-1">{item.title}</h4>
                      <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-muted-foreground">
                        <span className="capitalize">{item.kind}</span>
                        <span>·</span>
                        <span>{item.totalEvents} events</span>
                        {item.totalMinutes > 0 && <><span>·</span><span>{formatPendoMinutes(item.totalMinutes)}</span></>}
                      </div>
                    </div>
                    <ChevronRight className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity mt-0.5" />
                  </div>
                </button>
              ))
            )}
          </div>
        )}

        {!loading && activeTab === "posthog" && (
          <div>
            {sortedPosthog.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground px-4">
                <AlertTriangle className="w-5 h-5 mx-auto mb-2 opacity-40" />
                <p className="text-xs mb-1">{sq ? "No matching PostHog findings" : "No PostHog data loaded"}</p>
                {!sq && <p className="text-[10px]">Connect PostHog to review top events and page activity</p>}
              </div>
            ) : (
              sortedPosthog.map((item) => (
                <button key={item.id} onClick={() => setDetail({ type: "posthog", data: item })}
                  className="w-full text-left px-4 py-3 border-b border-border hover:bg-accent/30 transition-colors group">
                  <div className="flex items-start gap-2.5">
                    <Hash className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <h4 className="text-xs font-medium line-clamp-1">{item.title}</h4>
                      <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-muted-foreground">
                        <span className="capitalize">{item.kind}</span>
                        <span>·</span>
                        <span>{item.totalEvents} events</span>
                        {item.totalMinutes > 0 && <><span>·</span><span>{formatPendoMinutes(item.totalMinutes)}</span></>}
                      </div>
                    </div>
                    <ChevronRight className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity mt-0.5" />
                  </div>
                </button>
              ))
            )}
          </div>
        )}
        {!loading && activeTab === "jira" && (
          <div>
            {sortedJira.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground px-4">
                <AlertTriangle className="w-5 h-5 mx-auto mb-2 opacity-40" />
                <p className="text-xs mb-1">{sq ? "No matching issues" : "No Jira issues loaded"}</p>
                {!sq && status.atlassianKey?.configured && (
                  <p className="text-[10px]">Check your Jira project filter in Settings. Try leaving it blank to fetch all projects, or use exact project keys (e.g. PROD, ENG).</p>
                )}
              </div>
            ) : (
              sortedJira.map((issue) => {
                const dt = formatDate(issue.updated || issue.created);
                return (
                  <button key={issue.id} onClick={() => setDetail({ type: "jira", data: issue })}
                    className="w-full text-left px-4 py-3 border-b border-border hover:bg-accent/30 transition-colors group">
                    <div className="flex items-start gap-2.5">
                      <div className={cn("w-2 h-2 rounded-full mt-1.5 flex-shrink-0",
                        issue.status.toLowerCase().includes("done") && "bg-green-500",
                        issue.status.toLowerCase().includes("progress") && "bg-blue-500",
                        !issue.status.toLowerCase().includes("done") && !issue.status.toLowerCase().includes("progress") && "bg-muted-foreground")} />
                      <div className="flex-1 min-w-0">
                        <h4 className="text-xs font-medium line-clamp-1"><span className="text-muted-foreground">{issue.key}</span> {issue.summary}</h4>
                        <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-muted-foreground">
                          {dt && <><span className="text-foreground/50">{dt}</span><span>·</span></>}
                          <span>{issue.issueType}</span><span>·</span><span>{issue.status}</span>
                          {issue.assignee !== "Unassigned" && <><span>·</span><span>{issue.assignee}</span></>}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        )}

        {!loading && activeTab === "confluence" && (
          <div>
            {sortedConfluence.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground px-4">
                <AlertTriangle className="w-5 h-5 mx-auto mb-2 opacity-40" />
                <p className="text-xs mb-1">{sq ? "No matching pages" : "No Confluence pages loaded"}</p>
                {!sq && status.atlassianKey?.configured && (
                  <p className="text-[10px]">Check your Confluence space filter in Settings. Try leaving it blank to fetch all spaces, or use exact space keys (e.g. PROD, KB).</p>
                )}
              </div>
            ) : (
              sortedConfluence.map((page) => {
                const dt = formatDate(page.lastModified);
                return (
                  <button key={page.id} onClick={() => setDetail({ type: "confluence", data: page })}
                    className="w-full text-left px-4 py-3 border-b border-border hover:bg-accent/30 transition-colors group">
                    <div className="flex-1 min-w-0">
                      <h4 className="text-xs font-medium line-clamp-1">{page.title}</h4>
                      <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-muted-foreground">
                        {dt && <><span className="text-foreground/50">{dt}</span><span>·</span></>}
                        <span>{page.space}</span>
                        {page.author && <><span>·</span><span>{page.author}</span></>}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>

      {detail && (
        <div className="absolute inset-0 bg-background/95 backdrop-blur-sm z-10 flex flex-col">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {detail.type} Detail
            </span>
            <button
              onClick={() => setDetail(null)}
              className="w-6 h-6 rounded-md hover:bg-muted flex items-center justify-center"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {detail.type === "feedback" && (
              <>
                <h3 className="text-sm font-semibold">{detail.data.title}</h3>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground flex-wrap">
                  <span className="capitalize">{detail.data.source}</span>
                  {detail.data.customer && <><span>·</span><span>{detail.data.customer}</span></>}
                  {detail.data.company && <><span>·</span><span>{detail.data.company}</span></>}
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {detail.data.content}
                </p>
                {detail.data.themes.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {detail.data.themes.map((t) => (
                      <button key={t} onClick={() => openEntity({ kind: "theme", name: t })}
                        className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-medium hover:bg-primary/20 transition-colors" title={`Explore "${t}"`}>
                        {t}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
            {detail.type === "feature" && (
              <>
                <h3 className="text-sm font-semibold">{detail.data.name}</h3>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span className="capitalize">{detail.data.status.replace("_", " ")}</span>
                  {detail.data.votes > 0 && <><span>·</span><span>{detail.data.votes} votes</span></>}
                  {detail.data.customerRequests > 0 && <><span>·</span><span>{detail.data.customerRequests} requests</span></>}
                </div>
                {detail.data.description && (
                  <p className="text-xs text-muted-foreground leading-relaxed">{detail.data.description}</p>
                )}
                {detail.data.themes.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {detail.data.themes.map((t) => (
                      <button key={t} onClick={() => openEntity({ kind: "theme", name: t })}
                        className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-medium hover:bg-primary/20 transition-colors" title={`Explore "${t}"`}>
                        {t}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
            {detail.type === "call" && (
              <>
                <h3 className="text-sm font-semibold">{detail.data.title}</h3>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span>{detail.data.date}</span>
                  <span>·</span>
                  <span>{detail.data.duration}</span>
                </div>
                {detail.data.summary && (
                  <p className="text-xs text-muted-foreground leading-relaxed">{detail.data.summary}</p>
                )}
                {detail.data.keyMoments.length > 0 && (
                  <div>
                    <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Key Moments</h4>
                    <div className="space-y-2">
                      {detail.data.keyMoments.map((m, i) => (
                        <div key={i} className="flex gap-2 text-xs">
                          <span className="text-muted-foreground font-mono text-[10px] pt-0.5">{m.timestamp}</span>
                          <div className="flex-1">
                            <span className="italic">&ldquo;{m.text}&rdquo;</span>
                            <span className="ml-1.5">{sentimentIcon(m.sentiment)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {detail.data.actionItems.length > 0 && (
                  <div>
                    <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Action Items</h4>
                    <ul className="space-y-1">
                      {detail.data.actionItems.map((item, i) => (
                        <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                          <CheckCircle2 className="w-3 h-3 mt-0.5 text-primary flex-shrink-0" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
            {detail.type === "jira" && (
              <>
                <h3 className="text-sm font-semibold"><span className="text-muted-foreground">{detail.data.key}</span> {detail.data.summary}</h3>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground flex-wrap">
                  <span>{detail.data.issueType}</span><span>·</span>
                  <span>{detail.data.status}</span><span>·</span>
                  <span>{detail.data.priority}</span><span>·</span>
                  <span>{detail.data.project}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  <div><span className="text-muted-foreground">Assignee:</span> {detail.data.assignee}</div>
                  <div><span className="text-muted-foreground">Reporter:</span> {detail.data.reporter}</div>
                </div>
                {detail.data.description && <p className="text-xs text-muted-foreground leading-relaxed">{detail.data.description.slice(0, 500)}</p>}
                {detail.data.labels.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {detail.data.labels.map((l) => (
                      <button key={l} onClick={() => openEntity({ kind: "theme", name: l })}
                        className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-medium hover:bg-primary/20 transition-colors" title={`Explore "${l}"`}>
                        {l}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
            {detail.type === "confluence" && (
              <>
                <h3 className="text-sm font-semibold">{detail.data.title}</h3>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span>{detail.data.space}</span><span>·</span><span>{detail.data.author}</span>
                  {detail.data.lastModified && <><span>·</span><span>{new Date(detail.data.lastModified).toLocaleDateString()}</span></>}
                </div>
                {detail.data.excerpt && <p className="text-xs text-muted-foreground leading-relaxed">{detail.data.excerpt.slice(0, 800)}</p>}
                {detail.data.url && <a href={detail.data.url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">Open in Confluence</a>}
              </>
            )}
            {(detail.type === "pendo" || detail.type === "amplitude" || detail.type === "posthog") && (
              <>
                <h3 className="text-sm font-semibold">{detail.data.title}</h3>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground flex-wrap">
                  <span className="capitalize">{detail.data.provider}</span>
                  <span>·</span>
                  <span className="capitalize">{detail.data.kind}</span>
                  <span>·</span>
                  <span>{detail.data.totalEvents} events</span>
                  {detail.data.totalMinutes > 0 && <><span>·</span><span>{formatPendoMinutes(detail.data.totalMinutes)}</span></>}
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {detail.data.subtitle}. This is one of the recent usage signals loaded from {detail.data.provider}.
                </p>
              </>
            )}
            {onQuerySource && (
              <button
                onClick={() => {
                  const isAnalytics = detail.type === "pendo" || detail.type === "amplitude" || detail.type === "posthog";
                  const title =
                    detail.type === "feedback" ? detail.data.title
                    : detail.type === "feature" ? detail.data.name
                    : isAnalytics ? `${detail.data.kind} ${detail.data.title}`
                    : detail.type === "jira" ? `${detail.data.key}: ${detail.data.summary}`
                    : detail.type === "confluence" ? detail.data.title
                    : detail.data.title;
                  onQuerySource(
                    isAnalytics
                      ? `Use ${detail.data.provider} to explain the recent ${detail.data.kind} activity for ${detail.data.title}, including what this usage might mean and any related customer feedback.`
                      : `Tell me more about: ${title}`
                  );
                  setDetail(null);
                }}
                className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
              >
                <ArrowUpRight className="w-3.5 h-3.5" />
                Ask Agent About This
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

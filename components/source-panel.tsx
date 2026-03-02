"use client";

import { useState, useEffect, useCallback } from "react";
import { useApiKeys } from "./api-key-provider";
import {
  DEMO_DATA_SOURCES,
  DEMO_FEEDBACK,
  DEMO_PRODUCTBOARD_FEATURES,
  DEMO_ATTENTION_CALLS,
} from "@/lib/demo-data";
import {
  FeedbackItem,
  ProductboardFeature,
  AttentionCall,
  DataSourceStatus,
} from "@/lib/types";
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
  | null;

export function SourcePanel({
  className,
  onQuerySource,
  onOpenSettings,
}: SourcePanelProps) {
  const { keys, status, useDemoData, keyHeaders } = useApiKeys();

  const [activeTab, setActiveTab] = useState<
    "sources" | "feedback" | "features" | "calls"
  >("sources");
  const [detail, setDetail] = useState<DetailView>(null);
  const [loading, setLoading] = useState(false);

  const [feedback, setFeedback] = useState<FeedbackItem[]>([]);
  const [features, setFeatures] = useState<ProductboardFeature[]>([]);
  const [calls, setCalls] = useState<AttentionCall[]>([]);
  const [dataSources, setDataSources] = useState<DataSourceStatus[]>([]);
  const [dataIsDemo, setDataIsDemo] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const demoHeader = useDemoData ? "true" : "false";
      const headers = { ...keyHeaders, "x-use-demo": demoHeader };

      const [pbRes, attRes] = await Promise.all([
        fetch("/api/sources/productboard", { headers }).then((r) => r.json()),
        fetch("/api/sources/attention", { headers }).then((r) => r.json()),
      ]);

      const newFeatures: ProductboardFeature[] = pbRes.features || [];
      const newFeedback: FeedbackItem[] = pbRes.notes || [];
      const newCalls: AttentionCall[] = attRes.calls || [];
      const isDemo = pbRes.featuresIsDemo || attRes.callsIsDemo;

      if (useDemoData && isDemo) {
        setFeedback(DEMO_FEEDBACK);
        setFeatures(DEMO_PRODUCTBOARD_FEATURES);
        setCalls(DEMO_ATTENTION_CALLS);
      } else {
        setFeedback(newFeedback);
        setFeatures(newFeatures);
        setCalls(newCalls);
      }

      setDataIsDemo(isDemo && useDemoData);

      const sources: DataSourceStatus[] = [];
      if (status.productboardKey.configured) {
        sources.push({
          name: "Productboard",
          source: "productboard",
          connected: pbRes.connected,
          lastSync: pbRes.connected ? "just now" : undefined,
          itemCount: newFeatures.length,
          icon: "clipboard-list",
        });
      }
      if (status.attentionKey.configured) {
        sources.push({
          name: "Attention",
          source: "attention",
          connected: attRes.connected,
          lastSync: attRes.connected ? "just now" : undefined,
          itemCount: newCalls.length,
          icon: "phone",
        });
      }

      if (useDemoData && isDemo) {
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
        setDataSources(DEMO_DATA_SOURCES);
        setDataIsDemo(true);
      }
    } finally {
      setLoading(false);
    }
  }, [keys, keyHeaders, status, useDemoData]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const totalItems = feedback.length + features.length + calls.length;

  const sentimentIcon = (s: string) => {
    if (s === "positive")
      return <ThumbsUp className="w-3 h-3 text-green-500" />;
    if (s === "negative")
      return <ThumbsDown className="w-3 h-3 text-red-500" />;
    return <Minus className="w-3 h-3 text-muted-foreground" />;
  };

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
              {totalItems} items{!dataIsDemo ? " synced" : ""}
            </span>
          </div>
        </div>
        <div className="flex gap-1">
          {(
            [
              { key: "sources", label: "Connected" },
              { key: "feedback", label: `Feedback (${feedback.length})` },
              { key: "features", label: `Features (${features.length})` },
              { key: "calls", label: `Calls (${calls.length})` },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
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
                  status.productboardKey.configured ||
                  status.attentionKey.configured
                    ? "Manage API keys"
                    : "Add API keys to connect live data"}
                </p>
              </div>
              <div className="flex items-center justify-center gap-2 text-[9px]">
                <span
                  className={cn(
                    "px-1.5 py-0.5 rounded",
                    status.geminiKey.configured
                      ? "bg-green-500/10 text-green-600"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  Gemini{" "}
                  {status.geminiKey.configured ? "✓" : "—"}
                </span>
                <span
                  className={cn(
                    "px-1.5 py-0.5 rounded",
                    status.productboardKey.configured
                      ? "bg-green-500/10 text-green-600"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  Productboard{" "}
                  {status.productboardKey.configured ? "✓" : "—"}
                </span>
                <span
                  className={cn(
                    "px-1.5 py-0.5 rounded",
                    status.attentionKey.configured
                      ? "bg-green-500/10 text-green-600"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  Attention{" "}
                  {status.attentionKey.configured ? "✓" : "—"}
                </span>
              </div>
            </div>
          </div>
        )}

        {!loading && activeTab === "feedback" && (
          <div>
            {feedback.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <AlertTriangle className="w-5 h-5 mx-auto mb-2 opacity-40" />
                <p className="text-xs mb-1">No feedback data</p>
                <p className="text-[10px]">
                  Connect API keys or enable demo data in Settings
                </p>
              </div>
            ) : (
              feedback.map((fb) => (
                <button
                  key={fb.id}
                  onClick={() => setDetail({ type: "feedback", data: fb })}
                  className="w-full text-left px-4 py-3 border-b border-border hover:bg-accent/30 transition-colors group"
                >
                  <div className="flex items-start gap-2.5">
                    {sentimentIcon(fb.sentiment)}
                    <div className="flex-1 min-w-0">
                      <h4 className="text-xs font-medium line-clamp-1">
                        {fb.title}
                      </h4>
                      <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-muted-foreground">
                        <span className="capitalize">{fb.source}</span>
                        <span>·</span>
                        <span>{fb.customer}</span>
                        <span>·</span>
                        <span
                          className={cn(
                            "font-medium",
                            fb.priority === "critical" && "text-red-500",
                            fb.priority === "high" && "text-amber-500"
                          )}
                        >
                          {fb.priority}
                        </span>
                      </div>
                    </div>
                    <ChevronRight className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity mt-0.5" />
                  </div>
                </button>
              ))
            )}
          </div>
        )}

        {!loading && activeTab === "features" && (
          <div>
            {features.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <AlertTriangle className="w-5 h-5 mx-auto mb-2 opacity-40" />
                <p className="text-xs mb-1">No feature data</p>
                <p className="text-[10px]">
                  Connect Productboard or enable demo data in Settings
                </p>
              </div>
            ) : (
              features.map((feat) => (
                <button
                  key={feat.id}
                  onClick={() => setDetail({ type: "feature", data: feat })}
                  className="w-full text-left px-4 py-3 border-b border-border hover:bg-accent/30 transition-colors group"
                >
                  <div className="flex items-start gap-2.5">
                    <div
                      className={cn(
                        "w-2 h-2 rounded-full mt-1.5 flex-shrink-0",
                        feat.status === "in_progress" && "bg-blue-500",
                        feat.status === "planned" && "bg-amber-500",
                        feat.status === "new" && "bg-muted-foreground",
                        feat.status === "done" && "bg-green-500"
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <h4 className="text-xs font-medium line-clamp-1">
                        {feat.name}
                      </h4>
                      <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground">
                        <span className="capitalize">
                          {feat.status.replace("_", " ")}
                        </span>
                        <span>·</span>
                        <span>{feat.votes} votes</span>
                        <span>·</span>
                        <span>{feat.customerRequests} requests</span>
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
            {calls.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <AlertTriangle className="w-5 h-5 mx-auto mb-2 opacity-40" />
                <p className="text-xs mb-1">No call data</p>
                <p className="text-[10px]">
                  Connect Attention or enable demo data in Settings
                </p>
              </div>
            ) : (
              calls.map((call) => (
                <button
                  key={call.id}
                  onClick={() => setDetail({ type: "call", data: call })}
                  className="w-full text-left px-4 py-3 border-b border-border hover:bg-accent/30 transition-colors group"
                >
                  <div className="flex items-start gap-2.5">
                    <Phone className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <h4 className="text-xs font-medium line-clamp-1">
                        {call.title}
                      </h4>
                      <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground">
                        <Clock className="w-2.5 h-2.5" />
                        <span>{call.date}</span>
                        <span>·</span>
                        <span>{call.duration}</span>
                        <span>·</span>
                        <Users className="w-2.5 h-2.5" />
                        <span>{call.participants.length}</span>
                      </div>
                    </div>
                  </div>
                </button>
              ))
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
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span className="capitalize">{detail.data.source}</span>
                  <span>·</span>
                  <span>{detail.data.customer}</span>
                  {detail.data.company && (
                    <>
                      <span>·</span>
                      <span>{detail.data.company}</span>
                    </>
                  )}
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {detail.data.content}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {detail.data.themes.map((t) => (
                    <span
                      key={t}
                      className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-medium"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </>
            )}
            {detail.type === "feature" && (
              <>
                <h3 className="text-sm font-semibold">{detail.data.name}</h3>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span className="capitalize">
                    {detail.data.status.replace("_", " ")}
                  </span>
                  <span>·</span>
                  <span>{detail.data.votes} votes</span>
                  <span>·</span>
                  <span>{detail.data.customerRequests} requests</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {detail.data.description}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {detail.data.themes.map((t) => (
                    <span
                      key={t}
                      className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-medium"
                    >
                      {t}
                    </span>
                  ))}
                </div>
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
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {detail.data.summary}
                </p>
                <div>
                  <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                    Key Moments
                  </h4>
                  <div className="space-y-2">
                    {detail.data.keyMoments.map((m, i) => (
                      <div key={i} className="flex gap-2 text-xs">
                        <span className="text-muted-foreground font-mono text-[10px] pt-0.5">
                          {m.timestamp}
                        </span>
                        <div className="flex-1">
                          <span className="italic">
                            &ldquo;{m.text}&rdquo;
                          </span>
                          <span className="ml-1.5">
                            {sentimentIcon(m.sentiment)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                {detail.data.actionItems.length > 0 && (
                  <div>
                    <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                      Action Items
                    </h4>
                    <ul className="space-y-1">
                      {detail.data.actionItems.map((item, i) => (
                        <li
                          key={i}
                          className="text-xs text-muted-foreground flex items-start gap-1.5"
                        >
                          <CheckCircle2 className="w-3 h-3 mt-0.5 text-primary flex-shrink-0" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
            {onQuerySource && (
              <button
                onClick={() => {
                  const title =
                    detail.type === "feedback"
                      ? detail.data.title
                      : detail.type === "feature"
                        ? detail.data.name
                        : detail.data.title;
                  onQuerySource(`Tell me more about: ${title}`);
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

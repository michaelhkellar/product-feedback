"use client";

import { useState } from "react";
import { DEMO_DATA_SOURCES, DEMO_FEEDBACK, DEMO_PRODUCTBOARD_FEATURES, DEMO_ATTENTION_CALLS } from "@/lib/demo-data";
import { FeedbackItem, ProductboardFeature, AttentionCall } from "@/lib/types";
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
  FileText,
  ArrowUpRight,
  X,
  Clock,
  Users,
  ThumbsUp,
  ThumbsDown,
  Minus,
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
}

type DetailView =
  | { type: "feedback"; data: FeedbackItem }
  | { type: "feature"; data: ProductboardFeature }
  | { type: "call"; data: AttentionCall }
  | null;

export function SourcePanel({ className, onQuerySource }: SourcePanelProps) {
  const [activeTab, setActiveTab] = useState<"sources" | "feedback" | "features" | "calls">("sources");
  const [detail, setDetail] = useState<DetailView>(null);

  const totalItems =
    DEMO_FEEDBACK.length +
    DEMO_PRODUCTBOARD_FEATURES.length +
    DEMO_ATTENTION_CALLS.length;

  const sentimentIcon = (s: string) => {
    if (s === "positive") return <ThumbsUp className="w-3 h-3 text-green-500" />;
    if (s === "negative") return <ThumbsDown className="w-3 h-3 text-red-500" />;
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
          <span className="text-[10px] bg-green-500/10 text-green-600 px-2 py-0.5 rounded-full font-medium">
            {totalItems} items synced
          </span>
        </div>
        <div className="flex gap-1">
          {(
            [
              { key: "sources", label: "Connected" },
              { key: "feedback", label: "Feedback" },
              { key: "features", label: "Features" },
              { key: "calls", label: "Calls" },
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
        {activeTab === "sources" && (
          <div className="p-3 space-y-2">
            {DEMO_DATA_SOURCES.map((source) => {
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
                      <span className="text-xs font-medium">{source.name}</span>
                      {source.connected ? (
                        <CheckCircle2 className="w-3 h-3 text-green-500" />
                      ) : (
                        <Circle className="w-3 h-3 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span>{source.itemCount} items</span>
                      <span>·</span>
                      <span>Synced {source.lastSync}</span>
                    </div>
                  </div>
                  <RefreshCcw className="w-3 h-3 text-muted-foreground" />
                </div>
              );
            })}
            <div className="mt-3 p-3 rounded-xl border border-dashed border-border text-center">
              <p className="text-[10px] text-muted-foreground mb-1">
                Add API keys to connect live data
              </p>
              <p className="text-[9px] text-muted-foreground">
                GEMINI_API_KEY · PRODUCTBOARD_API_TOKEN · ATTENTION_API_KEY
              </p>
            </div>
          </div>
        )}

        {activeTab === "feedback" && (
          <div>
            {DEMO_FEEDBACK.map((fb) => (
              <button
                key={fb.id}
                onClick={() => setDetail({ type: "feedback", data: fb })}
                className="w-full text-left px-4 py-3 border-b border-border hover:bg-accent/30 transition-colors group"
              >
                <div className="flex items-start gap-2.5">
                  {sentimentIcon(fb.sentiment)}
                  <div className="flex-1 min-w-0">
                    <h4 className="text-xs font-medium line-clamp-1">{fb.title}</h4>
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
            ))}
          </div>
        )}

        {activeTab === "features" && (
          <div>
            {DEMO_PRODUCTBOARD_FEATURES.map((feat) => (
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
                    <h4 className="text-xs font-medium line-clamp-1">{feat.name}</h4>
                    <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground">
                      <span className="capitalize">{feat.status.replace("_", " ")}</span>
                      <span>·</span>
                      <span>{feat.votes} votes</span>
                      <span>·</span>
                      <span>{feat.customerRequests} requests</span>
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {activeTab === "calls" && (
          <div>
            {DEMO_ATTENTION_CALLS.map((call) => (
              <button
                key={call.id}
                onClick={() => setDetail({ type: "call", data: call })}
                className="w-full text-left px-4 py-3 border-b border-border hover:bg-accent/30 transition-colors group"
              >
                <div className="flex items-start gap-2.5">
                  <Phone className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <h4 className="text-xs font-medium line-clamp-1">{call.title}</h4>
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
            ))}
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
                          <span className="italic">&ldquo;{m.text}&rdquo;</span>
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

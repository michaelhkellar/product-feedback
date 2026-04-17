"use client";

import { useState, useEffect, useCallback } from "react";
import { useEntityDrawer } from "./entity-drawer-provider";
import { useApiKeys } from "./api-key-provider";
import { FeedbackItem, AttentionCall, JiraIssue, LinearIssue } from "@/lib/types";
import { X, ThumbsUp, ThumbsDown, Minus, MessageCircle, Phone, Ticket, ArrowUpRight, Loader2, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { feedbackVolumeByWeek } from "@/lib/temporal";
import { Sparkline, SentimentBar } from "./sparkline";

type Tab = "quotes" | "calls" | "tickets" | "usage";

interface EntityData {
  feedback: FeedbackItem[];
  calls: AttentionCall[];
  tickets: (JiraIssue & { _kind?: "jira" } | LinearIssue & { _kind?: "linear" })[];
  sentimentCounts: Record<string, number>;
  totalFeedback: number;
  totalCalls: number;
  totalTickets: number;
  analyticsContext?: string | null;
}


function sentimentIcon(s: string) {
  if (s === "positive") return <ThumbsUp className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />;
  if (s === "negative") return <ThumbsDown className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />;
  return <Minus className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />;
}

function isJiraIssue(t: JiraIssue | LinearIssue): boolean {
  return "key" in t && "summary" in t;
}

export function EntityDrawer({ onQueryEntity }: { onQueryEntity?: (q: string) => void }) {
  const { entity, closeEntity } = useEntityDrawer();
  const { keyHeaders, useDemoData } = useApiKeys();
  const [tab, setTab] = useState<Tab>("quotes");
  const [data, setData] = useState<EntityData | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    if (!entity) return;
    setLoading(true);
    setData(null);
    try {
      const res = await fetch("/api/entity", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...keyHeaders, "x-use-demo": useDemoData ? "true" : "false" },
        body: JSON.stringify({ kind: entity.kind, name: entity.name }),
      });
      if (res.ok) setData(await res.json());
    } catch {
      // silent fail
    } finally {
      setLoading(false);
    }
  }, [entity, keyHeaders, useDemoData]);

  useEffect(() => {
    if (entity) {
      setTab("quotes");
      fetchData();
    }
  }, [entity, fetchData]);

  if (!entity) return null;

  const kindLabel = entity.kind.charAt(0).toUpperCase() + entity.kind.slice(1);

  const tabs: { key: Tab; label: string; icon: typeof MessageCircle; count?: number }[] = [
    { key: "quotes", label: "Quotes", icon: MessageCircle, count: data?.totalFeedback },
    { key: "calls", label: "Calls", icon: Phone, count: data?.totalCalls },
    { key: "tickets", label: "Tickets", icon: Ticket, count: data?.totalTickets },
    ...(entity.kind === "account" ? [{ key: "usage" as Tab, label: "Usage", icon: BarChart3 }] : []),
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={closeEntity} />
      <div
        className="relative z-10 w-[420px] max-w-full bg-background border-l border-border shadow-2xl flex flex-col h-full"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-border flex items-center justify-between flex-shrink-0">
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{kindLabel}</span>
            <h2 className="text-sm font-semibold leading-snug mt-0.5 line-clamp-1">{entity.name}</h2>
          </div>
          <div className="flex items-center gap-2">
            {onQueryEntity && (
              <button
                onClick={() => {
                  onQueryEntity(`Tell me everything about the ${entity.kind} "${entity.name}" — include feedback, usage, tickets, and sentiment.`);
                  closeEntity();
                }}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-medium bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <ArrowUpRight className="w-3 h-3" />
                Ask Agent
              </button>
            )}
            <button onClick={closeEntity} className="w-7 h-7 rounded-lg hover:bg-muted flex items-center justify-center">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Sparkline + Sentiment summary */}
        {data && (
          <div className="px-4 py-2.5 border-b border-border flex-shrink-0 space-y-2">
            {data.feedback.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-muted-foreground uppercase tracking-wider flex-shrink-0">12w trend</span>
                <Sparkline data={feedbackVolumeByWeek(data.feedback)} color="hsl(var(--primary))" height={20} />
              </div>
            )}
            {Object.keys(data.sentimentCounts).length > 0 && (
              <SentimentBar
                positive={data.sentimentCounts.positive || 0}
                negative={data.sentimentCounts.negative || 0}
                neutral={data.sentimentCounts.neutral || 0}
                mixed={data.sentimentCounts.mixed || 0}
              />
            )}
          </div>
        )}

        {/* Tabs */}
        <div className="px-4 py-2 border-b border-border flex gap-1 flex-shrink-0">
          {tabs.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-medium transition-colors",
                  tab === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                <Icon className="w-3 h-3" />
                {t.label}
                {t.count !== undefined && t.count > 0 && (
                  <span className={cn("px-1 rounded text-[9px] font-bold", tab === t.key ? "bg-white/20" : "bg-muted")}>
                    {t.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
              <span className="text-xs">Loading...</span>
            </div>
          )}

          {!loading && data && tab === "quotes" && (
            <div>
              {data.feedback.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-8">No feedback found for this {entity.kind}.</p>
              ) : (
                data.feedback.map((fb) => (
                  <div key={fb.id} className="px-4 py-3 border-b border-border">
                    <div className="flex items-start gap-2">
                      {sentimentIcon(fb.sentiment)}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-[10px] font-medium text-foreground truncate">{fb.customer}{fb.company ? ` @ ${fb.company}` : ""}</span>
                          <span className="text-[9px] text-muted-foreground flex-shrink-0">{new Date(fb.date).toLocaleDateString()}</span>
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">"{fb.content}"</p>
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {fb.themes.slice(0, 4).map((theme) => (
                            <span key={theme} className="px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[9px] font-medium">{theme}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {!loading && data && tab === "calls" && (
            <div>
              {data.calls.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-8">No calls found for this {entity.kind}.</p>
              ) : (
                data.calls.map((call) => (
                  <div key={call.id} className="px-4 py-3 border-b border-border">
                    <div className="text-xs font-medium mb-0.5">{call.title}</div>
                    <div className="text-[10px] text-muted-foreground mb-1">{call.date} · {call.duration}</div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2">{call.summary}</p>
                    {call.actionItems.length > 0 && (
                      <div className="mt-1.5">
                        <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Action items: </span>
                        <span className="text-[10px] text-muted-foreground">{call.actionItems.slice(0, 2).join(" · ")}</span>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {!loading && data && tab === "tickets" && (
            <div>
              {data.tickets.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-8">No tickets found for this {entity.kind}.</p>
              ) : (
                data.tickets.map((ticket, i) => {
                    const isJira = isJiraIssue(ticket);
                  const jira = isJira ? (ticket as JiraIssue) : null;
                  const linear = !isJira ? (ticket as LinearIssue) : null;
                  return (
                    <div key={jira?.id || linear?.id || i} className="px-4 py-3 border-b border-border">
                      <div className="flex items-start gap-2">
                        <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 mt-0.5", isJira ? "bg-orange-500/10 text-orange-600" : "bg-violet-500/10 text-violet-600")}>
                          {isJira ? jira!.key : linear!.identifier}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium line-clamp-1">{isJira ? jira!.summary : linear!.title}</div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">
                            {isJira ? jira!.status : linear!.status} · {isJira ? jira!.priority : linear!.priority}
                          </div>
                        </div>
                        {(jira?.resolution && jira.resolution !== "Unresolved") || linear?.url ? (
                          <a href={linear?.url || "#"} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground">
                            <ArrowUpRight className="w-3 h-3" />
                          </a>
                        ) : null}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {!loading && data && tab === "usage" && (
            <div className="px-4 py-4">
              {data.analyticsContext ? (
                <div className="space-y-3">
                  <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Analytics — last 30 days</p>
                  <pre className="text-xs text-foreground whitespace-pre-wrap leading-relaxed font-sans">{data.analyticsContext}</pre>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground text-center py-8">
                  No analytics data available. Configure an analytics provider (Pendo, Amplitude, or PostHog) to see usage data here.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

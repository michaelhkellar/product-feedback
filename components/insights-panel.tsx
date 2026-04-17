"use client";

import { useState, useEffect, useCallback } from "react";
import { useApiKeys } from "./api-key-provider";
import { useEntityDrawer } from "./entity-drawer-provider";
import { Insight } from "@/lib/types";
import { DEMO_INSIGHTS } from "@/lib/demo-data";
import { saveSnapshot, loadYesterdaySnapshot, diffInsights, TaggedInsight } from "@/lib/insight-snapshots";
import { useFilters, filterTimeHeaders } from "./filter-provider";
import { pinInsight, unpinInsight, listPinnedIds } from "@/lib/pins";
import {
  TrendingUp,
  AlertTriangle,
  Lightbulb,
  Target,
  Zap,
  ChevronRight,
  Flame,
  Shield,
  ArrowUpRight,
  X,
  Loader2,
  Pin,
  PinOff,
} from "lucide-react";
import { cn } from "@/lib/utils";

const INSIGHT_CONFIG: Record<
  string,
  { icon: typeof TrendingUp; color: string; bg: string }
> = {
  trend: { icon: TrendingUp, color: "text-blue-500", bg: "bg-blue-500/10" },
  risk: { icon: AlertTriangle, color: "text-red-500", bg: "bg-red-500/10" },
  recommendation: {
    icon: Lightbulb,
    color: "text-amber-500",
    bg: "bg-amber-500/10",
  },
  theme: { icon: Target, color: "text-green-500", bg: "bg-green-500/10" },
  anomaly: { icon: Zap, color: "text-purple-500", bg: "bg-purple-500/10" },
};

interface InsightsPanelProps {
  className?: string;
  onQueryInsight?: (query: string) => void;
}

export function InsightsPanel({
  className,
  onQueryInsight,
}: InsightsPanelProps) {
  const { useDemoData, keyHeaders } = useApiKeys();
  const { openEntity } = useEntityDrawer();
  const { filters } = useFilters();

  const [insights, setInsights] = useState<TaggedInsight[]>([]);
  const [isDemo, setIsDemo] = useState(true);
  const [loading, setLoading] = useState(false);
  const [selectedInsight, setSelectedInsight] = useState<TaggedInsight | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [newCount, setNewCount] = useState(0);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());

  const loadInsights = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/insights", {
        headers: {
          ...keyHeaders,
          "x-use-demo": useDemoData ? "true" : "false",
          ...filterTimeHeaders(filters.timeRange),
        },
      });
      const data = await res.json();
      const rawInsights: Insight[] = data.insights || [];
      // Save snapshot and diff with yesterday
      if (!useDemoData && rawInsights.length > 0) {
        await saveSnapshot(rawInsights);
        const yesterday = await loadYesterdaySnapshot();
        if (yesterday) {
          const tagged = diffInsights(rawInsights, yesterday.insights);
          setInsights(tagged);
          setNewCount(tagged.filter((i) => i.isNew).length);
        } else {
          setInsights(rawInsights as TaggedInsight[]);
        }
      } else {
        setInsights(rawInsights as TaggedInsight[]);
      }
      setIsDemo(data.isDemo);
    } catch {
      if (useDemoData) {
        setInsights(DEMO_INSIGHTS);
        setIsDemo(true);
      }
    } finally {
      setLoading(false);
    }
  }, [keyHeaders, useDemoData, filters.timeRange]);

  useEffect(() => {
    loadInsights();
    listPinnedIds().then((ids) => setPinnedIds(new Set(ids))).catch(() => {});
  }, [loadInsights]);

  const filtered = insights
    .filter((i) => {
      if (filter === "pinned") return pinnedIds.has(i.id);
      if (filter !== "all" && i.type !== filter) return false;
      // Local theme filter: show insight only if at least one theme overlaps
      if (filters.themes.length > 0 && !i.themes.some((t) => filters.themes.includes(t))) return false;
      return true;
    })
    .sort((a, b) => {
      // Pinned insights float to the top
      const aPin = pinnedIds.has(a.id) ? 1 : 0;
      const bPin = pinnedIds.has(b.id) ? 1 : 0;
      return bPin - aPin;
    });

  return (
    <div className={cn("flex flex-col h-full", className)}>
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Flame className="w-4 h-4 text-orange-500" />
            Live Insights
          </h2>
          <div className="flex items-center gap-2">
            {isDemo && (
              <span className="text-[9px] bg-amber-500/10 text-amber-600 px-2 py-0.5 rounded-full font-medium">
                Demo
              </span>
            )}
            <div className="flex items-center gap-1.5">
              {newCount > 0 && (
                <span className="text-[9px] bg-green-500/10 text-green-600 px-2 py-0.5 rounded-full font-semibold">
                  {newCount} new
                </span>
              )}
              <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
                {insights.length} active
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-1">
          {[
            { key: "all", label: "All" },
            { key: "risk", label: "Risks" },
            { key: "trend", label: "Trends" },
            { key: "recommendation", label: "Recs" },
            { key: "theme", label: "Themes" },
            { key: "anomaly", label: "Anomalies" },
            { key: "pinned", label: `Pinned${pinnedIds.size > 0 ? ` (${pinnedIds.size})` : ""}` },
          ].map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors",
                filter === f.key
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {loading && (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
            <span className="text-xs">Loading insights...</span>
          </div>
        )}

        {!loading && insights.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <AlertTriangle className="w-5 h-5 mx-auto mb-2 opacity-40" />
            <p className="text-xs mb-1">No insights available</p>
            <p className="text-[10px]">
              Connect API keys or enable demo data in Settings
            </p>
          </div>
        )}

        {!loading &&
          filtered.map((insight) => {
            const config =
              INSIGHT_CONFIG[insight.type] || INSIGHT_CONFIG.theme;
            const Icon = config.icon;
            return (
              <div
                key={insight.id}
                className="w-full text-left px-4 py-3 border-b border-border hover:bg-accent/30 transition-colors group flex items-start gap-2.5"
              >
                <div
                  className={cn(
                    "flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center",
                    config.bg
                  )}
                >
                  <Icon className={cn("w-3.5 h-3.5", config.color)} />
                </div>
                <button
                  className="flex-1 min-w-0 text-left"
                  onClick={() => setSelectedInsight(insight)}
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span
                      className={cn(
                        "text-[9px] font-semibold uppercase tracking-wider",
                        config.color
                      )}
                    >
                      {insight.type}
                    </span>
                    {insight.impact === "high" && (
                      <Shield className="w-3 h-3 text-red-400" />
                    )}
                    {insight.isNew && (
                      <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-green-500/15 text-green-600">NEW</span>
                    )}
                    {insight.trend === "growing" && (
                      <span className="text-[8px] text-green-500">↑</span>
                    )}
                    {insight.trend === "shrinking" && (
                      <span className="text-[8px] text-red-500">↓</span>
                    )}
                  </div>
                  <h3 className="text-xs font-medium leading-snug line-clamp-2">
                    {insight.title}
                  </h3>
                  <div className="flex items-center gap-2 mt-1.5">
                    <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          config.bg.replace("/10", "/40")
                        )}
                        style={{
                          width: `${insight.confidence * 100}%`,
                        }}
                      />
                    </div>
                    <span className="text-[9px] text-muted-foreground">
                      {(insight.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                </button>
                <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const isPinned = pinnedIds.has(insight.id);
                      if (isPinned) {
                        unpinInsight(insight.id).then(() => setPinnedIds((p) => { const n = new Set(p); n.delete(insight.id); return n; }));
                      } else {
                        pinInsight(insight.id).then(() => setPinnedIds((p) => { const n = new Set(p); n.add(insight.id); return n; }));
                      }
                    }}
                    className={cn(
                      "w-6 h-6 rounded flex items-center justify-center transition-colors",
                      pinnedIds.has(insight.id)
                        ? "text-primary"
                        : "text-muted-foreground opacity-0 group-hover:opacity-100"
                    )}
                    title={pinnedIds.has(insight.id) ? "Unpin insight" : "Pin insight"}
                  >
                    {pinnedIds.has(insight.id)
                      ? <PinOff className="w-3 h-3" />
                      : <Pin className="w-3 h-3" />
                    }
                  </button>
                  <ChevronRight
                    onClick={() => setSelectedInsight(insight)}
                    className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                  />
                </div>
              </div>
            );
          })}
      </div>

      {selectedInsight && (
        <div className="absolute inset-0 bg-background/95 backdrop-blur-sm z-10 flex flex-col">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              {(() => {
                const config =
                  INSIGHT_CONFIG[selectedInsight.type] ||
                  INSIGHT_CONFIG.theme;
                const Icon = config.icon;
                return (
                  <div
                    className={cn(
                      "w-7 h-7 rounded-lg flex items-center justify-center",
                      config.bg
                    )}
                  >
                    <Icon className={cn("w-3.5 h-3.5", config.color)} />
                  </div>
                );
              })()}
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {selectedInsight.type} Detail
              </span>
            </div>
            <button
              onClick={() => setSelectedInsight(null)}
              className="w-6 h-6 rounded-md hover:bg-muted flex items-center justify-center"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            <h3 className="text-sm font-semibold leading-snug">
              {selectedInsight.title}
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {selectedInsight.description}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {selectedInsight.themes.map((theme) => (
                <button
                  key={theme}
                  onClick={() => openEntity({ kind: "theme", name: theme })}
                  className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-medium hover:bg-primary/20 transition-colors"
                  title={`Explore "${theme}"`}
                >
                  {theme}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2 pt-2">
              <div className="px-3 py-2 rounded-lg bg-muted">
                <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-0.5">
                  Confidence
                </div>
                <div className="text-sm font-semibold">
                  {(selectedInsight.confidence * 100).toFixed(0)}%
                </div>
              </div>
              <div className="px-3 py-2 rounded-lg bg-muted">
                <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-0.5">
                  Impact
                </div>
                <div className="text-sm font-semibold capitalize">
                  {selectedInsight.impact}
                </div>
              </div>
            </div>
            {onQueryInsight && (
              <button
                onClick={() => {
                  onQueryInsight(
                    `Tell me more about: ${selectedInsight.title}. Include concrete examples with customer-identifiable sources and direct evidence from feedback/tickets.`
                  );
                  setSelectedInsight(null);
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

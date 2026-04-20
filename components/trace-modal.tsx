"use client";

import { useState } from "react";
import { X, FlaskConical, Clock, Tag, Search, Layers, Coins, ArrowRightLeft, AlertTriangle, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChatMessageTrace } from "@/lib/types";

interface TraceModalProps {
  trace: ChatMessageTrace;
}

const typeColors: Record<string, string> = {
  feedback: "bg-blue-500/10 text-blue-600",
  feature: "bg-green-500/10 text-green-600",
  call: "bg-amber-500/10 text-amber-600",
  jira: "bg-orange-500/10 text-orange-600",
  linear: "bg-violet-500/10 text-violet-600",
  confluence: "bg-cyan-500/10 text-cyan-600",
  pendo: "bg-fuchsia-500/10 text-fuchsia-600",
  amplitude: "bg-fuchsia-500/10 text-fuchsia-600",
  posthog: "bg-fuchsia-500/10 text-fuchsia-600",
  insight: "bg-purple-500/10 text-purple-600",
};

export function TraceModal({ trace }: TraceModalProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors mt-1"
        title="Why this answer?"
      >
        <FlaskConical className="w-3 h-3" />
        Why this answer?
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div
            className="relative bg-background border border-border rounded-xl shadow-2xl w-full max-w-md max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-border flex items-center justify-between sticky top-0 bg-background z-10">
              <div className="flex items-center gap-2">
                <FlaskConical className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold">Evidence & Trace</h3>
              </div>
              <button onClick={() => setOpen(false)} className="w-6 h-6 rounded-md hover:bg-muted flex items-center justify-center">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              {/* AI error banner */}
              {trace.aiError && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-700">AI provider returned no response — this is a built-in fallback answer. Check your API key, quota, or network.</p>
                </div>
              )}

              {/* Intent */}
              <section className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <Search className="w-3 h-3" />
                  Detected Intent
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-medium">{trace.detectedIntent}</span>
                  <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-[10px] font-medium">{trace.queryType} response</span>
                </div>
              </section>

              {/* Context mode */}
              <section className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <Layers className="w-3 h-3" />
                  Context Mode
                </div>
                <span className={cn(
                  "px-2 py-0.5 rounded-full text-[10px] font-medium",
                  trace.contextMode === "deep" ? "bg-violet-500/10 text-violet-600" :
                    trace.contextMode === "standard" ? "bg-blue-500/10 text-blue-600" :
                      "bg-green-500/10 text-green-600"
                )}>
                  {trace.contextMode}
                </span>
              </section>

              {/* Time range */}
              {trace.timeRange && (
                <section className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <Clock className="w-3 h-3" />
                    Time Scope
                  </div>
                  <p className="text-xs text-foreground">{trace.timeRange.label}</p>
                  {trace.timeRange.start && (
                    <p className="text-[10px] text-muted-foreground">
                      {new Date(trace.timeRange.start).toLocaleDateString()} – {trace.timeRange.end ? new Date(trace.timeRange.end).toLocaleDateString() : "now"}
                    </p>
                  )}
                </section>
              )}

              {/* Themes */}
              {trace.themesDetected.length > 0 && (
                <section className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <Tag className="w-3 h-3" />
                    Themes Detected
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {trace.themesDetected.map((t) => (
                      <span key={t} className="px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground text-[9px] font-medium">{t}</span>
                    ))}
                  </div>
                </section>
              )}

              {/* Pivot exclusions */}
              {trace.pivotExcluded && trace.pivotExcluded.length > 0 && (
                <section className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <ArrowRightLeft className="w-3 h-3" />
                    Pivot — Excluded
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {trace.pivotExcluded.map((e) => (
                      <span key={e} className="px-2 py-0.5 rounded-full bg-red-500/10 text-red-600 text-[9px] font-medium line-through">{e}</span>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground">Agent focused on other topics instead.</p>
                </section>
              )}

              {/* Tool calls */}
              {trace.toolCalls && trace.toolCalls.length > 0 && (
                <section className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <Wrench className="w-3 h-3" />
                    Mid-chat Tool Calls
                  </div>
                  <div className="space-y-1">
                    {trace.toolCalls.map((tc, i) => (
                      <div key={i} className="flex items-start gap-2 text-[10px]">
                        <span className="px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-600 font-medium flex-shrink-0">{tc.name}</span>
                        <span className="text-muted-foreground italic truncate flex-1">"{tc.query}"</span>
                        <span className="text-muted-foreground flex-shrink-0">{tc.resultCount} result{tc.resultCount !== 1 ? "s" : ""}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Retrieval */}
              <section className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <Search className="w-3 h-3" />
                  Retrieved Evidence
                </div>
                <p className="text-[10px] text-muted-foreground italic">"{trace.retrieval.query}"</p>
                <div className="space-y-1">
                  {trace.retrieval.topResults.map((r, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className={cn("px-1.5 py-0.5 rounded text-[9px] font-medium flex-shrink-0", typeColors[r.type] || "bg-muted text-muted-foreground")}>
                        {r.type}
                      </span>
                      <span className="text-[10px] text-muted-foreground font-mono truncate flex-1">{r.id}</span>
                      <span className="text-[9px] text-muted-foreground flex-shrink-0">score: {r.score}</span>
                    </div>
                  ))}
                </div>
              </section>

              {/* Tokens */}
              <section className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <Coins className="w-3 h-3" />
                  Token Usage
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: "Input", value: trace.tokensUsed.input },
                    { label: "Output", value: trace.tokensUsed.output },
                    { label: "Total", value: trace.tokensUsed.total },
                  ].map((t) => (
                    <div key={t.label} className="text-center px-2 py-2 rounded-lg bg-muted">
                      <div className="text-xs font-semibold">{t.value > 1000 ? `${(t.value / 1000).toFixed(1)}k` : t.value}</div>
                      <div className="text-[9px] text-muted-foreground mt-0.5">{t.label}</div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

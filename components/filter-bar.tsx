"use client";

import { useFilters, TimeRangeOption } from "./filter-provider";
import { cn } from "@/lib/utils";
import { SlidersHorizontal, X } from "lucide-react";

const TIME_OPTIONS: { value: TimeRangeOption; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "7d", label: "7d" },
  { value: "14d", label: "14d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
];

const SENTIMENT_OPTIONS = [
  { value: "positive", label: "Positive", color: "text-green-600 bg-green-500/10" },
  { value: "negative", label: "Negative", color: "text-red-600 bg-red-500/10" },
  { value: "neutral", label: "Neutral", color: "text-muted-foreground bg-muted" },
];

export function FilterBar() {
  const { filters, setTimeRange, toggleSentiment, clearFilters } = useFilters();
  const isActive = filters.timeRange !== "all" || filters.sentiments.length > 0 || filters.themes.length > 0;

  return (
    <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border bg-muted/30 flex-shrink-0 overflow-x-auto scrollbar-none">
      <SlidersHorizontal className="w-3 h-3 text-muted-foreground flex-shrink-0" />

      {/* Time range */}
      <div className="flex items-center gap-0.5 flex-shrink-0">
        {TIME_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setTimeRange(opt.value)}
            className={cn(
              "px-2 py-1 rounded text-[10px] font-medium transition-colors whitespace-nowrap",
              filters.timeRange === opt.value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="w-px h-4 bg-border flex-shrink-0" />

      {/* Sentiment */}
      <div className="flex items-center gap-0.5 flex-shrink-0">
        {SENTIMENT_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => toggleSentiment(opt.value)}
            className={cn(
              "px-2 py-1 rounded text-[10px] font-medium transition-colors whitespace-nowrap",
              filters.sentiments.includes(opt.value) ? opt.color : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Active themes */}
      {filters.themes.length > 0 && (
        <>
          <div className="w-px h-4 bg-border flex-shrink-0" />
          <div className="flex items-center gap-1">
            {filters.themes.map((t) => (
              <span key={t} className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[9px] font-medium">
                {t}
              </span>
            ))}
          </div>
        </>
      )}

      {/* Clear */}
      {isActive && (
        <button
          onClick={clearFilters}
          className="ml-auto flex items-center gap-1 px-2 py-1 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted flex-shrink-0"
        >
          <X className="w-2.5 h-2.5" />
          Clear
        </button>
      )}
    </div>
  );
}

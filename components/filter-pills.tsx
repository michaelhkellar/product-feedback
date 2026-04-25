"use client";

import { X } from "lucide-react";
import { useFilters, timeRangeToShort } from "./filter-provider";

export function FilterPills() {
  const { filters, setTimeRange, toggleTheme, clearFilters } = useFilters();
  const shortRange = timeRangeToShort(filters.timeRange);
  const hasTime = filters.timeRange !== "all";
  const hasThemes = filters.themes.length > 0;
  if (!hasTime && !hasThemes) return null;
  const totalActive = (hasTime ? 1 : 0) + filters.themes.length;

  return (
    <div className="px-4 pt-1 pb-1">
      <div className="max-w-2xl mx-auto flex flex-wrap items-center gap-1.5 text-[10px]">
        <span className="text-muted-foreground">Filtered:</span>
        {hasTime && (
          <button
            onClick={() => setTimeRange("all")}
            className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium hover:bg-primary/20 transition-colors"
            title={`Time range: ${shortRange} — click to clear`}
          >
            {shortRange}
            <X className="w-2.5 h-2.5" />
          </button>
        )}
        {filters.themes.map((t) => (
          <button
            key={t}
            onClick={() => toggleTheme(t)}
            className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium hover:bg-primary/20 transition-colors"
            title={`Theme: ${t} — click to clear`}
          >
            {t}
            <X className="w-2.5 h-2.5" />
          </button>
        ))}
        {totalActive > 1 && (
          <button
            onClick={clearFilters}
            className="px-1.5 py-0.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            Clear all
          </button>
        )}
      </div>
    </div>
  );
}

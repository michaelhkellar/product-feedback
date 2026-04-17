"use client";

import { useState, useRef, useEffect } from "react";
import { useFilters, TimeRangeOption } from "./filter-provider";
import { cn } from "@/lib/utils";
import { X, Plus } from "lucide-react";

const TIME_OPTIONS: { value: TimeRangeOption; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "7d", label: "7d" },
  { value: "14d", label: "14d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
];

const ALL_THEMES = [
  "SSO", "Billing", "API", "Reporting", "Performance",
  "Onboarding", "AI", "Integrations", "Mobile", "Security",
];

export function FilterBar() {
  const { filters, setTimeRange, toggleTheme, clearFilters } = useFilters();
  const isActive = filters.timeRange !== "all" || filters.themes.length > 0;
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Close picker when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setThemePickerOpen(false);
      }
    }
    if (themePickerOpen) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [themePickerOpen]);

  return (
    <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border bg-muted/30 flex-shrink-0 overflow-x-auto scrollbar-none">
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

      {/* Active theme chips */}
      {filters.themes.map((t) => (
        <span
          key={t}
          className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-medium flex-shrink-0"
        >
          {t}
          <button
            onClick={() => toggleTheme(t)}
            className="ml-0.5 hover:text-primary/60 transition-colors"
            aria-label={`Remove ${t} filter`}
          >
            <X className="w-2.5 h-2.5" />
          </button>
        </span>
      ))}

      {/* Theme picker */}
      <div className="relative flex-shrink-0" ref={pickerRef}>
        <button
          onClick={() => setThemePickerOpen((o) => !o)}
          className={cn(
            "flex items-center gap-0.5 px-2 py-1 rounded text-[10px] font-medium transition-colors",
            themePickerOpen
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          )}
        >
          <Plus className="w-2.5 h-2.5" />
          Theme
        </button>

        {themePickerOpen && (
          <div className="absolute top-full left-0 mt-1 z-50 bg-background border border-border rounded-lg shadow-lg p-1 min-w-[120px]">
            {ALL_THEMES.map((theme) => (
              <button
                key={theme}
                onClick={() => { toggleTheme(theme); setThemePickerOpen(false); }}
                className={cn(
                  "w-full text-left px-2.5 py-1.5 rounded text-xs transition-colors",
                  filters.themes.includes(theme)
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-foreground hover:bg-muted"
                )}
              >
                {theme}
                {filters.themes.includes(theme) && (
                  <span className="ml-1 text-[10px]">✓</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

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

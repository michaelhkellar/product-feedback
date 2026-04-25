"use client";

import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";

export type TimeRangeOption = "7d" | "14d" | "30d" | "90d" | "all";

export interface GlobalFilters {
  timeRange: TimeRangeOption;
  themes: string[];
}

interface FilterContextValue {
  filters: GlobalFilters;
  filtersVisible: boolean;
  toggleFiltersVisible: () => void;
  setTimeRange: (v: TimeRangeOption) => void;
  toggleTheme: (t: string) => void;
  clearFilters: () => void;
}

const DEFAULT_FILTERS: GlobalFilters = { timeRange: "all", themes: [] };
const STORAGE_KEY = "global-filters-v2";

const FilterContext = createContext<FilterContextValue>({
  filters: DEFAULT_FILTERS,
  filtersVisible: false,
  toggleFiltersVisible: () => {},
  setTimeRange: () => {},
  toggleTheme: () => {},
  clearFilters: () => {},
});

export function FilterProvider({ children }: { children: ReactNode }) {
  const [filters, setFilters] = useState<GlobalFilters>(() => {
    if (typeof window === "undefined") return DEFAULT_FILTERS;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? { ...DEFAULT_FILTERS, ...JSON.parse(stored) } : DEFAULT_FILTERS;
    } catch {
      return DEFAULT_FILTERS;
    }
  });

  const [filtersVisible, setFiltersVisible] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return false;
      return JSON.parse(stored).filtersVisible === true;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...filters, filtersVisible }));
    } catch {}
  }, [filters, filtersVisible]);

  const setTimeRange = useCallback((v: TimeRangeOption) => {
    setFilters((f) => ({ ...f, timeRange: v }));
  }, []);

  const toggleTheme = useCallback((t: string) => {
    setFilters((f) => ({
      ...f,
      themes: f.themes.includes(t) ? f.themes.filter((x) => x !== t) : [...f.themes, t],
    }));
  }, []);

  const toggleFiltersVisible = useCallback(() => {
    setFiltersVisible((v) => !v);
  }, []);

  const clearFilters = useCallback(() => setFilters(DEFAULT_FILTERS), []);

  return (
    <FilterContext.Provider value={{ filters, filtersVisible, toggleFiltersVisible, setTimeRange, toggleTheme, clearFilters }}>
      {children}
    </FilterContext.Provider>
  );
}

export function useFilters() {
  return useContext(FilterContext);
}

/** Short label for a time range pill (empty string for "all") */
export function timeRangeToShort(range: TimeRangeOption): string {
  const map: Record<TimeRangeOption, string> = {
    "7d": "7d", "14d": "14d", "30d": "30d", "90d": "90d", "all": "",
  };
  return map[range];
}

/** Convert TimeRangeOption to a natural-language string the agent can parse */
export function timeRangeToNL(range: TimeRangeOption): string {
  const map: Record<TimeRangeOption, string> = {
    "7d": "last 7 days",
    "14d": "last 14 days",
    "30d": "last 30 days",
    "90d": "last 90 days",
    "all": "",
  };
  return map[range];
}

/** Days for each TimeRangeOption, undefined means no restriction */
export function timeRangeToDays(range: TimeRangeOption): number | undefined {
  const map: Record<TimeRangeOption, number | undefined> = {
    "7d": 7,
    "14d": 14,
    "30d": 30,
    "90d": 90,
    "all": undefined,
  };
  return map[range];
}

/**
 * Returns ISO start/end date strings for the given time range, or null/null if "all".
 */
export function timeRangeToISOBounds(range: TimeRangeOption): { start: string | null; end: string | null } {
  const days = timeRangeToDays(range);
  if (!days) return { start: null, end: null };
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

/**
 * Build extra HTTP headers for API calls that respect the global time filter.
 */
export function filterTimeHeaders(range: TimeRangeOption): Record<string, string> {
  const { start, end } = timeRangeToISOBounds(range);
  if (!start) return {};
  return { "x-time-start": start, "x-time-end": end! };
}

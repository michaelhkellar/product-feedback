import { InteractionMode } from "./agent";

export interface ThreadState {
  activeThemes: string[];       // up to 5 most recently active themes (LRU)
  focalCompanies: string[];     // up to 3 most recently focused companies
  timeWindow?: { start: string; end: string; label: string };
  excludedEntities: string[];   // from pivot detection; capped at 10 (FIFO)
  lastMode: InteractionMode;
  updatedAt: string;            // ISO timestamp
}

const MAX_THEMES = 5;
const MAX_COMPANIES = 3;
const MAX_EXCLUDED = 10;

function lruMerge(prev: string[], incoming: string[], max: number): string[] {
  const merged = [...prev, ...incoming];
  // Dedup preserving LAST-seen order: iterate backwards, keep first occurrence
  const seen = new Set<string>();
  const result: string[] = [];
  for (let i = merged.length - 1; i >= 0; i--) {
    if (!seen.has(merged[i])) {
      seen.add(merged[i]);
      result.unshift(merged[i]);
    }
  }
  return result.slice(-max);
}

/** Reset focus context (companies + excluded) while keeping time window and active themes. */
export function clearFocus(state: ThreadState): ThreadState {
  return {
    ...state,
    focalCompanies: [],
    excludedEntities: [],
    updatedAt: new Date().toISOString(),
  };
}

export function updateState(
  prev: ThreadState | undefined,
  turn: {
    retrievedThemes: string[];
    retrievedCompanies: string[];
    extractedTimeRange?: { start: Date; end: Date; label: string } | null;
    pivotExcluded: string[];
    mode: InteractionMode;
  }
): ThreadState {
  // Active themes: LRU — most recently seen themes stay, oldest evicted
  const activeThemes = lruMerge(prev?.activeThemes ?? [], turn.retrievedThemes, MAX_THEMES);

  // Focal companies: same LRU pattern
  const focalCompanies = lruMerge(prev?.focalCompanies ?? [], turn.retrievedCompanies, MAX_COMPANIES);

  // Time window: overwrite if turn extracted one; else keep prior
  const timeWindow = turn.extractedTimeRange
    ? {
        start: turn.extractedTimeRange.start.toISOString(),
        end: turn.extractedTimeRange.end.toISOString(),
        label: turn.extractedTimeRange.label,
      }
    : prev?.timeWindow;

  // Excluded entities: append new, cap at MAX_EXCLUDED (FIFO — oldest first, drop oldest)
  const combined = [...(prev?.excludedEntities ?? []), ...turn.pivotExcluded];
  const excludedEntities = Array.from(new Set(combined)).slice(-MAX_EXCLUDED);

  return {
    activeThemes,
    focalCompanies,
    timeWindow,
    excludedEntities,
    lastMode: turn.mode,
    updatedAt: new Date().toISOString(),
  };
}

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
  // Active themes: union with prior, keep last MAX_THEMES (newest at end, evict oldest)
  const themeSet = new Set([...(prev?.activeThemes ?? []), ...turn.retrievedThemes]);
  const activeThemes = Array.from(themeSet).slice(-MAX_THEMES);

  // Focal companies: same LRU pattern
  const companySet = new Set([...(prev?.focalCompanies ?? []), ...turn.retrievedCompanies]);
  const focalCompanies = Array.from(companySet).slice(-MAX_COMPANIES);

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

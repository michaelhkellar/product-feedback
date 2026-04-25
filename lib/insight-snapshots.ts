import { Insight } from "./types";

const DB_NAME = "feedback-agent-snapshots";
const DB_VERSION = 2;
const STORE_NAME = "insight-snapshots";
const THEME_STORE_NAME = "theme-snapshots";
const MAX_SNAPSHOTS = 14;

export interface InsightSnapshot {
  date: string; // YYYY-MM-DD
  insights: Insight[];
  capturedAt: string;
}

export interface TaggedInsight extends Insight {
  isNew?: boolean;
  trend?: "growing" | "shrinking" | "stable";
}

export interface ThemeFrequency {
  theme: string;
  count: number;
}

export interface ThemeSnapshot {
  date: string; // YYYY-MM-DD
  themes: ThemeFrequency[];
  capturedAt: string;
}

export type ThemeTrend = "new" | "growing" | "shrinking" | "stable";

export interface ThemeDelta {
  theme: string;
  count: number;
  priorCount: number;
  delta: number;
  trend: ThemeTrend;
}

// Returns YYYY-MM-DD in the user's local calendar for a given Date object.
function localDateKey(d: Date, tz?: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(d);
}

// Returns YYYY-MM-DD for yesterday in the user's local calendar.
function yesterdayKey(tz?: string): string {
  const todayKey = localDateKey(new Date(), tz);
  const [y, m, d] = todayKey.split("-").map(Number);
  const yest = new Date(Date.UTC(y, m - 1, d - 1));
  return yest.toISOString().slice(0, 10);
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "date" });
      }
      if (!db.objectStoreNames.contains(THEME_STORE_NAME)) {
        db.createObjectStore(THEME_STORE_NAME, { keyPath: "date" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveSnapshot(insights: Insight[], tz?: string): Promise<void> {
  try {
    const db = await openDB();
    const date = localDateKey(new Date(), tz);
    const snapshot: InsightSnapshot = { date, insights, capturedAt: new Date().toISOString() };
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.put(snapshot);
      // Prune old snapshots
      const getAllReq = store.getAllKeys();
      getAllReq.onsuccess = () => {
        const keys = (getAllReq.result as string[]).sort();
        while (keys.length > MAX_SNAPSHOTS) {
          store.delete(keys.shift()!);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error("[insight-snapshots] saveSnapshot failed:", err);
  }
}

export async function loadYesterdaySnapshot(tz?: string): Promise<InsightSnapshot | null> {
  try {
    const db = await openDB();
    const yesterday = yesterdayKey(tz);
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(yesterday);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (err) {
    console.warn("[insight-snapshots] loadYesterdaySnapshot failed:", err);
    return null;
  }
}

export function diffInsights(current: Insight[], previous: Insight[]): TaggedInsight[] {
  const prevMap = new Map(previous.map((i) => [i.id, i]));
  return current.map((insight) => {
    const prev = prevMap.get(insight.id);
    if (!prev) return { ...insight, isNew: true };
    const delta = insight.confidence - prev.confidence;
    const trend: TaggedInsight["trend"] = delta > 0.05 ? "growing" : delta < -0.05 ? "shrinking" : "stable";
    return { ...insight, trend };
  });
}

export async function saveThemeSnapshot(themes: ThemeFrequency[], tz?: string): Promise<void> {
  try {
    const db = await openDB();
    const date = localDateKey(new Date(), tz);
    const snapshot: ThemeSnapshot = { date, themes, capturedAt: new Date().toISOString() };
    return new Promise((resolve, reject) => {
      const tx = db.transaction(THEME_STORE_NAME, "readwrite");
      const store = tx.objectStore(THEME_STORE_NAME);
      store.put(snapshot);
      const getAllReq = store.getAllKeys();
      getAllReq.onsuccess = () => {
        const keys = (getAllReq.result as string[]).sort();
        while (keys.length > MAX_SNAPSHOTS) {
          store.delete(keys.shift()!);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error("[insight-snapshots] saveThemeSnapshot failed:", err);
  }
}

export async function loadYesterdayThemeSnapshot(tz?: string): Promise<ThemeSnapshot | null> {
  try {
    const db = await openDB();
    const yesterday = yesterdayKey(tz);
    return new Promise((resolve) => {
      const tx = db.transaction(THEME_STORE_NAME, "readonly");
      const req = tx.objectStore(THEME_STORE_NAME).get(yesterday);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (err) {
    console.warn("[insight-snapshots] loadYesterdayThemeSnapshot failed:", err);
    return null;
  }
}

export async function loadTodaySnapshot(tz?: string): Promise<InsightSnapshot | null> {
  try {
    const db = await openDB();
    const today = localDateKey(new Date(), tz);
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(today);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (err) {
    console.warn("[insight-snapshots] loadTodaySnapshot failed:", err);
    return null;
  }
}

export async function loadTodayThemeSnapshot(tz?: string): Promise<ThemeSnapshot | null> {
  try {
    const db = await openDB();
    const today = localDateKey(new Date(), tz);
    return new Promise((resolve) => {
      const tx = db.transaction(THEME_STORE_NAME, "readonly");
      const req = tx.objectStore(THEME_STORE_NAME).get(today);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (err) {
    console.warn("[insight-snapshots] loadTodayThemeSnapshot failed:", err);
    return null;
  }
}

export function diffThemes(current: ThemeFrequency[], prev: ThemeSnapshot | null): ThemeDelta[] {
  const prevMap = new Map((prev?.themes ?? []).map((t) => [t.theme, t.count]));
  return current.map((t) => {
    const priorCount = prevMap.get(t.theme) ?? 0;
    const delta = t.count - priorCount;
    const denom = Math.max(priorCount, t.count, 1);
    const ratio = delta / denom;
    let trend: ThemeTrend;
    if (priorCount === 0) trend = "new";
    else if (ratio >= 0.25 && delta >= 2) trend = "growing";
    else if (ratio <= -0.25 && delta <= -2) trend = "shrinking";
    else trend = "stable";
    return { theme: t.theme, count: t.count, priorCount, delta, trend };
  });
}

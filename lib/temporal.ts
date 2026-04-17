import { FeedbackItem, AttentionCall } from "./types";
import { Insight } from "./types";

/**
 * Returns feedback volume bucketed by ISO week (last N weeks), most-recent last.
 */
export function feedbackVolumeByWeek(feedback: FeedbackItem[], weeks = 12): number[] {
  const buckets = new Array(weeks).fill(0);
  const now = new Date();
  for (const fb of feedback) {
    const d = new Date(fb.date);
    const diffMs = now.getTime() - d.getTime();
    const diffWeeks = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
    if (diffWeeks >= 0 && diffWeeks < weeks) {
      buckets[weeks - 1 - diffWeeks]++;
    }
  }
  return buckets;
}

/**
 * Returns calls volume bucketed by week (last N weeks).
 */
export function callsVolumeByWeek(calls: AttentionCall[], weeks = 12): number[] {
  const buckets = new Array(weeks).fill(0);
  const now = new Date();
  for (const c of calls) {
    const d = new Date(c.date);
    const diffMs = now.getTime() - d.getTime();
    const diffWeeks = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
    if (diffWeeks >= 0 && diffWeeks < weeks) {
      buckets[weeks - 1 - diffWeeks]++;
    }
  }
  return buckets;
}

/**
 * Returns sentiment breakdown counts from a list of feedback items.
 */
export function sentimentBreakdown(feedback: FeedbackItem[]): { positive: number; negative: number; neutral: number; mixed: number } {
  const counts = { positive: 0, negative: 0, neutral: 0, mixed: 0 };
  for (const fb of feedback) {
    const s = fb.sentiment as keyof typeof counts;
    if (s in counts) counts[s]++;
  }
  return counts;
}

/**
 * Returns insight confidence counts by type for summarizing.
 */
export function insightBreakdown(insights: Insight[]): { trend: number; risk: number; recommendation: number; theme: number; anomaly: number } {
  const counts = { trend: 0, risk: 0, recommendation: 0, theme: 0, anomaly: 0 };
  for (const ins of insights) {
    const t = ins.type as keyof typeof counts;
    if (t in counts) counts[t]++;
  }
  return counts;
}

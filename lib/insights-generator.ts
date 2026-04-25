import { Insight, FeedbackItem, ProductboardFeature, AttentionCall, JiraIssue, LinearIssue } from "./types";
import { findContradictions, Contradiction } from "./contradictions";
import { AgentData } from "./agent";
import { getAIProvider, isAnyAIConfigured, resolveAIKey, AIProviderType } from "./ai-provider";
import { INSIGHTS } from "./ai-presets";
import { isNoiseTheme, cleanThemes } from "./theme-utils";

function normalizeTheme(theme: string): string {
  return theme.toLowerCase().replace(/\s+/g, " ").trim();
}

function parseDate(value: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function countRecentFeedback(feedback: FeedbackItem[], days: number): number {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return feedback.reduce((count, item) => {
    const d = parseDate(item.date);
    return d && d >= cutoff ? count + 1 : count;
  }, 0);
}

function topFeedbackThemes(
  feedback: FeedbackItem[],
  limit: number,
  minCount: number
): Array<{ theme: string; count: number }> {
  const counts: Record<string, number> = {};
  for (const fb of feedback) {
    for (const t of cleanThemes(fb.themes)) {
      const key = normalizeTheme(t);
      counts[key] = (counts[key] || 0) + 1;
    }
  }
  return Object.entries(counts)
    .filter(([, count]) => count >= minCount)
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit)
    .map(([theme, count]) => ({ theme, count }));
}

export async function generateInsights(
  data: AgentData,
  geminiKey?: string,
  aiProvider?: AIProviderType,
  anthropicKey?: string,
  openaiKey?: string,
  aiModel?: string
): Promise<Insight[]> {
  const programmatic = generateProgrammaticInsights(data);
  const provider = aiProvider || "gemini";

  if (isAnyAIConfigured(provider, geminiKey, anthropicKey, openaiKey) && data.feedback.length + data.features.length > 0) {
    try {
      const key = resolveAIKey(provider, geminiKey, anthropicKey, openaiKey);
      const aiInsights = await Promise.race([
        generateAIInsights(data, provider, key, aiModel),
        new Promise<Insight[]>((resolve) => setTimeout(() => resolve([]), 20_000)),
      ]);
      if (aiInsights.length > 0) {
        const seen = new Set(programmatic.map((i) => i.id));
        for (const ai of aiInsights) {
          if (!seen.has(ai.id)) {
            programmatic.push(ai);
          }
        }
      }
    } catch (err) {
      console.error("AI insight generation failed, using programmatic only:", err);
    }
  }

  return programmatic;
}

export function generateProgrammaticInsights(data: AgentData): Insight[] {
  const insights: Insight[] = [];
  const now = new Date().toISOString();

  if (data.features.length > 0) {
    insights.push(...featureInsights(data.features, now));
    insights.push(...topVotedInsights(data.features, now));
  }

  if (data.feedback.length > 0) {
    insights.push(...feedbackVolumeInsight(data.feedback, now));
    insights.push(...themeInsights(data.feedback, data.features, now));
    insights.push(...companyInsights(data.feedback, now));
  }

  if (data.calls.length > 0) {
    insights.push(...callInsights(data.calls, now));
  }

  if (data.features.length > 0 && data.feedback.length > 0) {
    insights.push(...gapInsights(data.features, data.feedback, now));
  }

  if (data.feedback.length > 0) {
    insights.push(...trendInsights(data.feedback, now));
  }

  if (data.jiraIssues.length > 0 || data.linearIssues.length > 0) {
    insights.push(...staleInsights(data.jiraIssues, data.linearIssues, data.feedback, now));
  }

  insights.push(...contradictionInsights(data, now));

  if (data.jiraIssues.length > 0) {
    insights.push(...jiraInsights(data.jiraIssues, now));
  }

  if (data.analyticsOverview) {
    insights.push(...analyticsInsights(data.analyticsOverview, now));
  }

  return insights;
}

function featureInsights(features: ProductboardFeature[], now: string): Insight[] {
  const insights: Insight[] = [];
  const byStatus: Record<string, ProductboardFeature[]> = {};
  for (const f of features) {
    if (!byStatus[f.status]) byStatus[f.status] = [];
    byStatus[f.status].push(f);
  }

  const inProgress = byStatus["in_progress"] || [];
  const planned = byStatus["planned"] || [];
  const newFeatures = byStatus["new"] || [];
  const done = byStatus["done"] || [];

  const activeCount = inProgress.length + planned.length;
  if (activeCount > 0) {
    const topActive = [...inProgress, ...planned]
      .sort((a, b) => b.votes - a.votes)
      .slice(0, 5);
    insights.push({
      id: "gen-active-pipeline",
      type: "trend",
      title: `${activeCount} Active Features: ${inProgress.length} In Progress, ${planned.length} Planned`,
      description: `Currently active pipeline includes ${inProgress.length} features in progress and ${planned.length} planned. Top active by votes: ${topActive
        .map((f) => `"${f.name}" (${f.votes} votes)`)
        .join(", ")}. Additionally, ${done.length} features have shipped.`,
      confidence: 0.95,
      relatedFeedbackIds: topActive.map((f) => f.id),
      themes: ["roadmap", "active-development"],
      impact: "medium",
      createdAt: now,
    });
  }

  if (newFeatures.length > features.length * 0.5 && newFeatures.length > 20) {
    const staleCount = newFeatures.filter((f) => f.votes === 0).length;
    insights.push({
      id: "gen-backlog-cleanup",
      type: "recommendation",
      title: `Backlog Cleanup Needed: ${newFeatures.length} Unplanned Features (${Math.round(newFeatures.length / features.length * 100)}% of total)`,
      description: `${newFeatures.length} of ${features.length} features sit in "new" without being planned or started${staleCount > 0 ? `, including ${staleCount} with zero votes` : ""}. This suggests accumulated backlog that may need grooming. Consider archiving stale items and triaging the rest to keep the roadmap focused on what matters now.`,
      confidence: 0.9,
      relatedFeedbackIds: [],
      themes: ["backlog-hygiene", "prioritization"],
      impact: "medium",
      createdAt: now,
    });

    const highVoteNew = newFeatures
      .filter((f) => f.votes > 0)
      .sort((a, b) => b.votes - a.votes)
      .slice(0, 5);
    if (highVoteNew.length > 0) {
      insights.push({
        id: "gen-overlooked-requests",
        type: "risk",
        title: `${highVoteNew.length} Popular Requests Still Unplanned`,
        description: `These customer-requested features have votes but haven't been planned or started: ${highVoteNew
          .map((f) => `"${f.name}" (${f.votes} votes)`)
          .join(", ")}. These represent unmet customer demand that competitors could address.`,
        confidence: 0.88,
        relatedFeedbackIds: highVoteNew.map((f) => f.id),
        themes: ["customer-demand", "competitive-risk"],
        impact: "high",
        createdAt: now,
      });
    }
  }

  return insights;
}

function topVotedInsights(features: ProductboardFeature[], now: string): Insight[] {
  const insights: Insight[] = [];
  const active = features.filter((f) => f.status !== "done");
  const sorted = [...active].sort((a, b) => b.votes - a.votes);
  const top = sorted.slice(0, 5).filter((f) => f.votes > 0);

  if (top.length > 0) {
    const notStarted = top.filter((f) => f.status === "new" || f.status === "planned");
    if (notStarted.length > 0) {
      insights.push({
        id: "gen-top-voted-gap",
        type: "recommendation",
        title: `${notStarted.length} of Top 5 Voted Features Not Yet In Progress`,
        description: `The most requested active features include items that haven't been started: ${notStarted
          .map((f) => `"${f.name}" (${f.votes} votes, ${f.status})`)
          .join("; ")}. Accelerating these could reduce churn and competitive pressure.`,
        confidence: 0.9,
        relatedFeedbackIds: notStarted.map((f) => f.id),
        themes: ["prioritization", "customer-demand"],
        impact: "high",
        createdAt: now,
      });
    }
  }

  return insights;
}

function feedbackVolumeInsight(feedback: FeedbackItem[], now: string): Insight[] {
  const insights: Insight[] = [];

  const bySource: Record<string, number> = {};
  for (const fb of feedback) {
    bySource[fb.source] = (bySource[fb.source] || 0) + 1;
  }
  const sourceBreakdown = Object.entries(bySource)
    .sort(([, a], [, b]) => b - a)
    .map(([s, c]) => `${s}: ${c}`)
    .join(", ");
  const sourceCount = Object.keys(bySource).length;
  const recent14d = countRecentFeedback(feedback, 14);
  const topThemes = topFeedbackThemes(
    feedback,
    3,
    Math.max(2, Math.floor(feedback.length * 0.01))
  );

  if (sourceCount > 1 || feedback.length < 150) {
    insights.push({
      id: "gen-feedback-volume",
      type: "trend",
      title: `Feedback intake: ${feedback.length} items across ${sourceCount} sources`,
      description: `Breakdown by source: ${sourceBreakdown}. Recent activity: ${recent14d} items in the last 14 days.${
        topThemes.length > 0
          ? ` Top recurring themes: ${topThemes.map((t) => `${t.theme} (${t.count})`).join(", ")}.`
          : ""
      }`,
      confidence: 0.93,
      relatedFeedbackIds: feedback.slice(0, 8).map((f) => f.id),
      themes: ["feedback-volume", ...topThemes.map((t) => t.theme).slice(0, 2)],
      impact: feedback.length > 200 ? "high" : "medium",
      createdAt: now,
    });
  }

  // Time-aware critical-priority insight: only surface when there's an actual
  // recency shift — the absolute backlog count ("854 high-priority items") is
  // not an insight, it's just backlog size. Fire when critical arrivals in the
  // last 14 days exceed the prior 14 days by a meaningful margin.
  const critical = feedback.filter((f) => f.priority === "critical" || f.priority === "high");
  const parseTs = (f: FeedbackItem): number => {
    const d = f.date ? new Date(f.date).getTime() : NaN;
    return isNaN(d) ? 0 : d;
  };
  const nowMs = Date.now();
  const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
  const recentCritical = critical.filter((f) => {
    const t = parseTs(f);
    return t > 0 && nowMs - t <= fourteenDaysMs;
  });
  const priorCritical = critical.filter((f) => {
    const t = parseTs(f);
    return t > 0 && nowMs - t > fourteenDaysMs && nowMs - t <= 2 * fourteenDaysMs;
  });
  const delta = recentCritical.length - priorCritical.length;
  const meaningfulShift = recentCritical.length >= 3 && (priorCritical.length === 0 ? true : recentCritical.length / Math.max(priorCritical.length, 1) >= 1.5);

  if (meaningfulShift) {
    const sortedRecent = [...recentCritical].sort((a, b) => parseTs(b) - parseTs(a));
    const sign = delta >= 0 ? "+" : "";
    const trendText = priorCritical.length === 0
      ? `${recentCritical.length} new in the last 14 days (none in the prior 14)`
      : `${recentCritical.length} new in the last 14 days, ${sign}${delta} vs prior 14 (${priorCritical.length})`;
    insights.push({
      id: "gen-critical-feedback",
      type: "risk",
      title: `Critical feedback spike: ${recentCritical.length} new in last 14 days`,
      description: `${trendText}. Top: ${sortedRecent
        .slice(0, 3)
        .map((f) => `"${f.title}" (${f.customer}${f.company ? ` @ ${f.company}` : ""})`)
        .join("; ")}.`,
      confidence: 0.85,
      relatedFeedbackIds: sortedRecent.slice(0, 10).map((f) => f.id),
      themes: ["urgency", "customer-risk"],
      impact: "high",
      createdAt: now,
    });
  }

  return insights;
}

function themeInsights(feedback: FeedbackItem[], features: ProductboardFeature[], now: string): Insight[] {
  const insights: Insight[] = [];

  const themeCounts: Record<string, { count: number; score: number; neg: number; pos: number; ids: string[] }> = {};
  for (const fb of feedback) {
    const sentimentWeight = fb.sentiment === "negative" ? 1.5 : fb.sentiment === "positive" ? 0.5 : 1.0;
    for (const t of cleanThemes(fb.themes)) {
      const key = normalizeTheme(t);
      if (!themeCounts[key]) themeCounts[key] = { count: 0, score: 0, neg: 0, pos: 0, ids: [] };
      themeCounts[key].count++;
      themeCounts[key].score += sentimentWeight;
      if (fb.sentiment === "negative") themeCounts[key].neg++;
      if (fb.sentiment === "positive") themeCounts[key].pos++;
      themeCounts[key].ids.push(fb.id);
    }
  }
  for (const f of features) {
    for (const t of cleanThemes(f.themes)) {
      const key = normalizeTheme(t);
      if (!themeCounts[key]) themeCounts[key] = { count: 0, score: 0, neg: 0, pos: 0, ids: [] };
      themeCounts[key].count++;
      themeCounts[key].score += 1.0;
      themeCounts[key].ids.push(f.id);
    }
  }

  const topThemes = Object.entries(themeCounts)
    .filter(([, d]) => d.count >= 2)
    .sort(([, a], [, b]) => b.score - a.score)
    .slice(0, 8);

  if (topThemes.length > 0) {
    insights.push({
      id: "gen-top-themes",
      type: "theme",
      title: `Top Themes: ${topThemes.slice(0, 4).map(([t, d]) => `${t} (${d.count})`).join(", ")}`,
      description: `Sentiment-weighted signals across feedback and features: ${topThemes
        .map(([t, d]) => {
          const sentNote = d.neg > 0 ? ` ${d.neg} neg` : "";
          return `**${t}** (${d.count}x${sentNote})`;
        })
        .join(", ")}. Themes weighted by negative sentiment surface urgent pain points first.`,
      confidence: 0.88,
      relatedFeedbackIds: topThemes.flatMap(([, d]) => d.ids).slice(0, 10),
      themes: topThemes.map(([t]) => t),
      impact: "medium",
      createdAt: now,
    });
  }

  return insights;
}

function companyInsights(feedback: FeedbackItem[], now: string): Insight[] {
  const insights: Insight[] = [];

  const companyCounts: Record<string, { count: number; items: FeedbackItem[] }> = {};
  for (const fb of feedback) {
    const company = fb.company || fb.customer || "Unknown";
    if (!companyCounts[company]) companyCounts[company] = { count: 0, items: [] };
    companyCounts[company].count++;
    companyCounts[company].items.push(fb);
  }

  const topCompanies = Object.entries(companyCounts)
    .filter(([name]) => name !== "Unknown" && name !== "Internal" && name !== "")
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, 5);

  if (topCompanies.length > 0 && topCompanies[0][1].count >= 3) {
    insights.push({
      id: "gen-vocal-accounts",
      type: "theme",
      title: `Most Vocal Accounts: ${topCompanies.slice(0, 3).map(([c, d]) => `${c} (${d.count})`).join(", ")}`,
      description: `These accounts have the most feedback. High volume can signal engagement or frustration — review whether their top concerns align with the roadmap.`,
      confidence: 0.82,
      relatedFeedbackIds: topCompanies.flatMap(([, d]) => d.items.map((i) => i.id)).slice(0, 10),
      themes: ["customer-engagement", "account-health"],
      impact: "medium",
      createdAt: now,
    });
  }

  return insights;
}

function callInsights(calls: AttentionCall[], now: string): Insight[] {
  const insights: Insight[] = [];

  if (calls.length > 0) {
    const totalActionItems = calls.reduce((sum, c) => sum + c.actionItems.length, 0);
    insights.push({
      id: "gen-call-summary",
      type: "trend",
      title: `${calls.length} Calls Tracked with ${totalActionItems} Action Items`,
      description: `Across ${calls.length} recorded calls, there are ${totalActionItems} action items. Recent: ${calls
        .slice(0, 3)
        .map((c) => `"${c.title}" (${c.date})`)
        .join(", ")}.`,
      confidence: 0.9,
      relatedFeedbackIds: calls.slice(0, 5).map((c) => c.id),
      themes: ["calls", "follow-up"],
      impact: totalActionItems > 10 ? "high" : "medium",
      createdAt: now,
    });
  }

  return insights;
}

function gapInsights(features: ProductboardFeature[], feedback: FeedbackItem[], now: string): Insight[] {
  const insights: Insight[] = [];

  const feedbackThemeStats: Record<string, { count: number; ids: string[] }> = {};
  for (const fb of feedback) {
    for (const t of cleanThemes(fb.themes)) {
      const key = normalizeTheme(t);
      if (!feedbackThemeStats[key]) feedbackThemeStats[key] = { count: 0, ids: [] };
      feedbackThemeStats[key].count++;
      feedbackThemeStats[key].ids.push(fb.id);
    }
  }

  const featureThemes = new Set<string>();
  for (const f of features) {
    for (const t of cleanThemes(f.themes)) featureThemes.add(normalizeTheme(t));
  }

  const minGapMentions =
    feedback.length >= 1000 ? 10 :
    feedback.length >= 300 ? 6 :
    feedback.length >= 100 ? 4 : 2;

  const unaddressed = Object.entries(feedbackThemeStats)
    .filter(([theme, stats]) => stats.count >= minGapMentions && !featureThemes.has(theme))
    .sort(([, a], [, b]) => b.count - a.count);

  if (unaddressed.length > 0) {
    const top = unaddressed.slice(0, 5);
    const titleThemes = top
      .slice(0, 3)
      .map(([theme, stats]) => `${theme} (${stats.count})`)
      .join(", ");
    const related = top.flatMap(([, stats]) => stats.ids).slice(0, 15);
    insights.push({
      id: "gen-theme-gaps",
      type: "anomaly",
      title: `Unmapped feedback demand: ${titleThemes}`,
      description: `${unaddressed.length} recurring themes appear in customer feedback (${minGapMentions}+ mentions each) but are not represented in current feature themes. Top gaps: ${top
        .map(([theme, stats]) => `${theme} (${stats.count})`)
        .join(", ")}. These are better candidates for follow-up than one-off tags.`,
      confidence: 0.84,
      relatedFeedbackIds: related,
      themes: top.map(([theme]) => theme),
      impact: top[0][1].count >= minGapMentions * 2 || unaddressed.length >= 6 ? "high" : "medium",
      createdAt: now,
    });
  }

  return insights;
}

function jiraInsights(issues: JiraIssue[], now: string): Insight[] {
  const insights: Insight[] = [];
  const byStatus: Record<string, number> = {};
  const byType: Record<string, number> = {};
  for (const j of issues) {
    byStatus[j.status] = (byStatus[j.status] || 0) + 1;
    byType[j.issueType] = (byType[j.issueType] || 0) + 1;
  }

  const inProgress = issues.filter((j) => {
    const s = j.status.toLowerCase();
    return s.includes("progress") || s.includes("review") || s.includes("dev");
  });
  const backlog = issues.filter((j) => {
    const s = j.status.toLowerCase();
    return s.includes("backlog") || s.includes("to do") || s.includes("todo") || s.includes("open");
  });
  const bugs = issues.filter((j) => j.issueType.toLowerCase() === "bug");
  const highPriority = issues.filter((j) => {
    const p = j.priority.toLowerCase();
    return p.includes("highest") || p.includes("critical") || p.includes("blocker");
  });

  insights.push({
    id: "gen-jira-overview",
    type: "trend",
    title: `Jira: ${inProgress.length} In Flight, ${backlog.length} Backlog, ${bugs.length} Bugs`,
    description: `Across ${issues.length} Jira issues: ${Object.entries(byStatus).sort(([,a],[,b]) => b - a).slice(0, 5).map(([s, c]) => `${s}: ${c}`).join(", ")}. Types: ${Object.entries(byType).sort(([,a],[,b]) => b - a).slice(0, 4).map(([t, c]) => `${t}: ${c}`).join(", ")}.`,
    confidence: 0.95,
    relatedFeedbackIds: inProgress.slice(0, 5).map((j) => j.id),
    themes: ["jira", "engineering"],
    impact: highPriority.length > 5 ? "high" : "medium",
    createdAt: now,
  });

  if (highPriority.length > 0) {
    insights.push({
      id: "gen-jira-critical",
      type: "risk",
      title: `${highPriority.length} Critical/Blocker Jira Issues`,
      description: `High-priority items: ${highPriority.slice(0, 4).map((j) => `${j.key} "${j.summary}" (${j.status})`).join("; ")}${highPriority.length > 4 ? ` and ${highPriority.length - 4} more` : ""}.`,
      confidence: 0.92,
      relatedFeedbackIds: highPriority.slice(0, 10).map((j) => j.id),
      themes: ["blockers", "urgency"],
      impact: "high",
      createdAt: now,
    });
  }

  if (bugs.length > issues.length * 0.3 && bugs.length > 10) {
    insights.push({
      id: "gen-jira-bug-ratio",
      type: "risk",
      title: `${Math.round(bugs.length / issues.length * 100)}% of Jira Issues Are Bugs (${bugs.length} total)`,
      description: `Bug-to-feature ratio is high. This may indicate quality issues or technical debt. Consider a bug bash or dedicated stability sprint.`,
      confidence: 0.85,
      relatedFeedbackIds: bugs.slice(0, 5).map((j) => j.id),
      themes: ["quality", "technical-debt"],
      impact: "medium",
      createdAt: now,
    });
  }

  return insights;
}

function staleInsights(
  jiraIssues: JiraIssue[],
  linearIssues: LinearIssue[],
  feedback: FeedbackItem[],
  now: string
): Insight[] {
  const insights: Insight[] = [];
  const STALE_DAYS = 90;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - STALE_DAYS);

  const staleStatuses = ["planned", "in_progress", "in progress", "todo", "to do", "backlog", "open"];
  const isStale = (updated: string, status: string) => {
    const d = parseDate(updated);
    return d && d < cutoff && staleStatuses.some((s) => status.toLowerCase().includes(s));
  };

  const staleItems: { key: string; title: string; updatedDays: number }[] = [];
  for (const j of jiraIssues) {
    if (isStale(j.updated, j.status)) {
      const days = Math.floor((Date.now() - new Date(j.updated).getTime()) / 86400000);
      staleItems.push({ key: j.key, title: j.summary, updatedDays: days });
    }
  }
  for (const l of linearIssues) {
    if (isStale(l.updated, l.status)) {
      const days = Math.floor((Date.now() - new Date(l.updated).getTime()) / 86400000);
      staleItems.push({ key: l.identifier, title: l.title, updatedDays: days });
    }
  }

  if (staleItems.length === 0) return insights;

  // Cross-reference stale item titles with feedback via token overlap
  const staleTokens = new Set<string>(
    staleItems.flatMap((i) =>
      i.title.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 3)
    )
  );
  const relatedIds = feedback
    .filter((fb) => {
      const fbText = `${fb.title} ${fb.content}`.toLowerCase().replace(/[^a-z0-9 ]/g, " ");
      const fbTokens = fbText.split(/\s+/).filter((w) => w.length > 3);
      return fbTokens.some((t) => staleTokens.has(t));
    })
    .slice(0, 8)
    .map((fb) => fb.id);

  const top = staleItems.sort((a, b) => b.updatedDays - a.updatedDays).slice(0, 4);
  insights.push({
    id: "gen-stale-commitments",
    type: "risk",
    title: `${staleItems.length} Issues Stagnant for ${STALE_DAYS}+ Days`,
    description: `These planned or in-progress items haven't been updated in over ${STALE_DAYS} days: ${top
      .map((i) => `${i.key} "${i.title}" (${i.updatedDays}d)`)
      .join("; ")}${staleItems.length > 4 ? ` and ${staleItems.length - 4} more` : ""}. Stale commitments erode customer trust when they reference actively requested features.`,
    confidence: 0.87,
    relatedFeedbackIds: relatedIds,
    themes: ["stale-backlog", "delivery-risk"],
    impact: relatedIds.length >= 3 ? "high" : "medium",
    createdAt: now,
  });

  return insights;
}

function trendInsights(feedback: FeedbackItem[], now: string): Insight[] {
  const insights: Insight[] = [];
  const WINDOW = 14;
  const recent = new Date();
  recent.setDate(recent.getDate() - WINDOW);
  const prior = new Date();
  prior.setDate(prior.getDate() - WINDOW * 2);

  const recentCounts: Record<string, { count: number; ids: string[] }> = {};
  const priorCounts: Record<string, number> = {};

  for (const fb of feedback) {
    const d = parseDate(fb.date);
    if (!d) continue;
    for (const t of cleanThemes(fb.themes)) {
      const key = normalizeTheme(t);
      if (d >= recent) {
        if (!recentCounts[key]) recentCounts[key] = { count: 0, ids: [] };
        recentCounts[key].count++;
        recentCounts[key].ids.push(fb.id);
      } else if (d >= prior) {
        priorCounts[key] = (priorCounts[key] || 0) + 1;
      }
    }
  }

  // Scale threshold to the windowed population (recent + prior), not total corpus size
  const windowedCount =
    Object.values(recentCounts).reduce((s, v) => s + v.count, 0) +
    Object.values(priorCounts).reduce((s, v) => s + v, 0);
  const minEmergingCount = Math.max(2, Math.ceil(Math.log10(Math.max(windowedCount, 10)) * 1.5));
  const minResolvingCount = Math.max(3, minEmergingCount + 1);

  const emerging: { theme: string; recent: number; prior: number; ids: string[] }[] = [];
  const resolving: { theme: string; recent: number; prior: number }[] = [];

  for (const [theme, { count: rCount, ids }] of Object.entries(recentCounts)) {
    const pCount = priorCounts[theme] || 0;
    if (rCount >= minEmergingCount && pCount > 0 && rCount >= pCount * 2) {
      emerging.push({ theme, recent: rCount, prior: pCount, ids });
    }
  }
  for (const [theme, pCount] of Object.entries(priorCounts)) {
    const rCount = recentCounts[theme]?.count || 0;
    if (pCount >= minResolvingCount && rCount <= pCount * 0.25) {
      resolving.push({ theme, recent: rCount, prior: pCount });
    }
  }

  if (emerging.length > 0) {
    const top = emerging.sort((a, b) => b.recent - a.recent).slice(0, 3);
    insights.push({
      id: "gen-emerging-themes",
      type: "trend",
      title: `Emerging: ${top.map((e) => `${e.theme} (+${Math.round((e.recent / (e.prior || 1)) * 100 - 100)}%)`).join(", ")}`,
      description: `These themes spiked in the last ${WINDOW} days vs. the prior ${WINDOW}: ${top
        .map((e) => `**${e.theme}** (${e.recent} recent vs ${e.prior} prior)`)
        .join(", ")}. Worth monitoring for emerging pain points or a new customer segment.`,
      confidence: 0.82,
      relatedFeedbackIds: top.flatMap((e) => e.ids).slice(0, 10),
      themes: top.map((e) => e.theme),
      impact: "high",
      createdAt: now,
    });
  }

  if (resolving.length > 0) {
    const top = resolving.sort((a, b) => b.prior - a.prior).slice(0, 3);
    insights.push({
      id: "gen-resolving-themes",
      type: "trend",
      title: `Declining: ${top.map((e) => `${e.theme} (↓${Math.round((1 - e.recent / e.prior) * 100)}%)`).join(", ")}`,
      description: `These previously active themes have dropped significantly in the last ${WINDOW} days: ${top
        .map((e) => `**${e.theme}** (${e.prior} prior → ${e.recent} recent)`)
        .join(", ")}. May indicate a fix took hold or customer interest shifted.`,
      confidence: 0.78,
      relatedFeedbackIds: [],
      themes: top.map((e) => e.theme),
      impact: "medium",
      createdAt: now,
    });
  }

  return insights;
}

function analyticsInsights(data: NonNullable<AgentData["analyticsOverview"]>, now: string): Insight[] {
  const insights: Insight[] = [];
  const label = data.provider.charAt(0).toUpperCase() + data.provider.slice(1);

  if (data.topPages.length > 0) {
    const topPages = data.topPages.slice(0, 3);
    insights.push({
      id: "gen-analytics-top-pages",
      type: "trend",
      title: `Top pages: ${topPages.map((p) => `${p.name} (${p.count})`).join(", ")}`,
      description: `${label} shows usage concentrating on ${topPages.map((p) => `"${p.name}"`).join(", ")} recently. Across ${data.totalTrackedPages} tracked pages, these led by total events and are good places to validate friction, onboarding gaps, or follow-up opportunities mentioned in feedback.`,
      confidence: 0.86,
      relatedFeedbackIds: [],
      themes: ["analytics", "page-usage", "engagement"],
      impact: "medium",
      createdAt: now,
    });
  }

  if (data.topFeatures.length > 0) {
    const topFeatures = data.topFeatures.slice(0, 3);
    insights.push({
      id: "gen-analytics-top-features",
      type: "theme",
      title: `Feature usage leaders: ${topFeatures.map((f) => `${f.name} (${f.count})`).join(", ")}`,
      description: `Recent feature activity (${label}) is strongest around ${topFeatures.map((f) => `"${f.name}"`).join(", ")}. High-traffic features deserve closer inspection when customers report friction or ask for adjacent improvements.`,
      confidence: 0.84,
      relatedFeedbackIds: [],
      themes: ["analytics", "feature-adoption", "usage"],
      impact: "medium",
      createdAt: now,
    });
  }

  if (data.topEvents.length > 0) {
    const topEvents = data.topEvents.slice(0, 3);
    insights.push({
      id: "gen-analytics-top-events",
      type: "trend",
      title: `Top events: ${topEvents.map((e) => `${e.name} (${e.count})`).join(", ")}`,
      description: `${label} shows the most popular custom events are ${topEvents.map((e) => `"${e.name}"`).join(", ")}. Cross-reference these with feedback themes to identify where product usage aligns or conflicts with customer requests.`,
      confidence: 0.82,
      relatedFeedbackIds: [],
      themes: ["analytics", "events", "engagement"],
      impact: "medium",
      createdAt: now,
    });
  }

  return insights;
}

async function generateAIInsights(data: AgentData, providerType: AIProviderType = "gemini", key?: string, model?: string): Promise<Insight[]> {
  const summaryParts: string[] = [];
  summaryParts.push(`Data: ${data.feedback.length} feedback, ${data.features.length} features, ${data.calls.length} calls, ${data.jiraIssues.length} Jira issues.`);

  const activeFeatures = data.features.filter((f) => f.status !== "done" && f.status !== "new");
  if (activeFeatures.length > 0) {
    summaryParts.push(`\nActive features (in progress/planned), top 10 by votes:\n${activeFeatures.sort((a, b) => b.votes - a.votes).slice(0, 10).map((f) => `- ${f.name} (${f.votes} votes, ${f.status})`).join("\n")}`);
  }

  if (data.feedback.length > 0) {
    const sortedFeedback = [...data.feedback].sort((a, b) => {
      const da = a.date ? new Date(a.date).getTime() : 0;
      const db = b.date ? new Date(b.date).getTime() : 0;
      return db - da;
    });
    summaryParts.push(`\nRecent 20 feedback:\n${sortedFeedback.slice(0, 20).map((f) => `- [${f.source}] ${f.title}${f.company ? ` (${f.company})` : ""} — ${f.content.slice(0, 120)}`).join("\n")}`);
  }

  if (data.calls.length > 0) {
    summaryParts.push(`\nRecent 5 calls:\n${data.calls.slice(0, 5).map((c) => `- ${c.title} (${c.date}) — ${c.summary.slice(0, 120)}`).join("\n")}`);
  }

  if (data.jiraIssues.length > 0) {
    const highPri = data.jiraIssues.filter((j) => j.priority.toLowerCase().includes("high") || j.priority.toLowerCase().includes("critical"));
    summaryParts.push(`\nJira (${data.jiraIssues.length} issues, ${highPri.length} high/critical):\n${data.jiraIssues.slice(0, 10).map((j) => `- ${j.key} ${j.summary} [${j.status}/${j.issueType}/${j.priority}]`).join("\n")}`);
  }

  if (data.linearIssues.length > 0) {
    const highPri = data.linearIssues.filter((l) => l.priority.toLowerCase().includes("urgent") || l.priority.toLowerCase().includes("high"));
    summaryParts.push(`\nLinear (${data.linearIssues.length} issues, ${highPri.length} urgent/high):\n${data.linearIssues.slice(0, 10).map((l) => `- ${l.identifier} ${l.title} [${l.status}/${l.priority}]`).join("\n")}`);
  }

  if (data.analyticsOverview) {
    const ao = data.analyticsOverview;
    const parts = [`\nAnalytics (${ao.provider}):`];
    if (ao.topPages.length > 0)
      parts.push(`Top pages: ${ao.topPages.slice(0, 5).map((p) => `${p.name} (${p.count})`).join(", ")}`);
    if (ao.topFeatures.length > 0)
      parts.push(`Top features: ${ao.topFeatures.slice(0, 5).map((f) => `${f.name} (${f.count})`).join(", ")}`);
    if (ao.topEvents.length > 0)
      parts.push(`Top events: ${ao.topEvents.slice(0, 5).map((e) => `${e.name} (${e.count})`).join(", ")}`);
    if (ao.topAccounts.length > 0)
      parts.push(`Top accounts: ${ao.topAccounts.slice(0, 5).map((a) => `${a.id} (${a.count})`).join(", ")}`);
    if (ao.limitations?.length)
      parts.push(`Note: ${ao.limitations.join(". ")}`);
    summaryParts.push(parts.join("\n"));
  }

  const prompt = `Analyze this customer feedback data and generate 6-10 meaningful insights for a product manager. Focus on real product signals — NOT ratings/stars/review scores. Span the list across several distinct themes; do not cluster 5 insights on the same topic.

Each insight should land in one of these categories. Aim for variety across the list:
- trend: a direction or shift observable in the data (growing, declining, accelerating)
- risk: something that could hurt adoption, retention, or trust if ignored
- theme: a recurring customer need, job-to-be-done, or complaint pattern
- anomaly: an unexpected spike, drop, or divergence that deserves a closer look
- recommendation: a specific, opinionated call — what you'd do next and why
- opportunity: an unmet or under-served job, adjacency, or expansion angle worth exploring
- segment: a signal specific to one account tier, industry, role, or cohort

For each insight, return a JSON object with:
- id: unique string starting with "ai-"
- type: one of the categories above
- title: concise but informative (80-120 chars). Write it like a headline a PM would scan, not a cryptic label.
- description: 3-6 sentences. Start with the finding, then supporting specifics (how many accounts, how recent, representative example/quote if available), then what it implies. Name customers by name/email when the evidence supports it. Be concrete — avoid generic phrases like "users want better UX."
- confidence: 0.0-1.0. Be honest. A single-account signal is not high confidence.
- themes: 1-3 topic-level theme strings (NOT star ratings)
- impact: "high" | "medium" | "low"
- segment: OPTIONAL string — the specific cohort this applies to (e.g., "enterprise", "self-serve trials", "field technicians") when the insight is segment-specific
- counterSignal: OPTIONAL string — a sentence on disconfirming evidence or a caveat, when meaningful
- suggestedAction: OPTIONAL string — a single-sentence "what to do next" for recommendation / opportunity / risk insights

Quality bar:
- Prefer cross-source patterns (e.g., same pain showing up in Jira CX AND Productboard AND calls) over single-item observations.
- If a signal is segment-specific, say so explicitly.
- If you are proposing an opportunity or recommendation, link it to jobs the customer is trying to get done, not just features to build.
- Don't pad. Fewer, sharper insights beat more, vaguer ones — but the floor is 6 when the data supports it.

Return ONLY a JSON array, no markdown or explanation.

${summaryParts.join("\n")}`;

  const provider = getAIProvider(providerType);
  const response = await provider.generate(
    "You are a product analytics expert. Respond with valid JSON only. Focus on actionable product insights, not review metrics.",
    prompt,
    key,
    model,
    INSIGHTS
  );

  if (!response) return [];

  try {
    const cleaned = response.trim().replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];

    const ALLOWED_TYPES = new Set([
      "trend", "risk", "recommendation", "theme", "anomaly", "opportunity", "segment",
    ]);
    return parsed.map((item: Record<string, unknown>) => {
      const rawType = typeof item.type === "string" ? item.type.toLowerCase() : "theme";
      const type = ALLOWED_TYPES.has(rawType) ? rawType : "theme";
      return {
        id: (item.id as string) || `ai-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type,
        title: (item.title as string) || "AI-Generated Insight",
        description: (item.description as string) || "",
        confidence: typeof item.confidence === "number" ? item.confidence : 0.7,
        relatedFeedbackIds: [],
        themes: Array.isArray(item.themes) ? item.themes.filter((t: string) => !isNoiseTheme(t)) : [],
        impact: (item.impact as string) || "medium",
        createdAt: new Date().toISOString(),
        ...(typeof item.segment === "string" && item.segment ? { segment: item.segment } : {}),
        ...(typeof item.counterSignal === "string" && item.counterSignal ? { counterSignal: item.counterSignal } : {}),
        ...(typeof item.suggestedAction === "string" && item.suggestedAction ? { suggestedAction: item.suggestedAction } : {}),
      };
    }) as Insight[];
  } catch {
    console.error("Failed to parse AI insights response");
    return [];
  }
}

function contradictionInsights(data: AgentData, now: string): Insight[] {
  const severityToImpact: Record<Contradiction["severity"], Insight["impact"]> = {
    high: "high", medium: "medium", low: "low",
  };
  const counterSignalByKind: Record<Contradiction["kind"], string> = {
    "praise-vs-falling-usage": "Usage is falling despite positive feedback",
    "stale-open-jira": "Engineering ticket is stale while customers keep filing related feedback",
    "high-vote-no-feature": "Highly-voted request has no engineering ticket",
  };
  return findContradictions(data).map((c): Insight => ({
    id: `contradiction-${c.id}`,
    type: "contradiction",
    title: c.title,
    description: c.evidence.join(" • "),
    confidence: c.severity === "high" ? 0.85 : c.severity === "medium" ? 0.65 : 0.45,
    relatedFeedbackIds: c.relatedFeedbackIds,
    themes: [],
    impact: severityToImpact[c.severity],
    createdAt: now,
    counterSignal: counterSignalByKind[c.kind],
  }));
}

import { Insight, FeedbackItem, ProductboardFeature, AttentionCall, JiraIssue } from "./types";
import { AgentData } from "./agent";
import { generateWithGemini, isGeminiConfigured } from "./gemini";

const NOISE_THEMES = new Set([
  "5 stars", "4.5 stars", "4 stars", "3.5 stars", "3 stars", "2.5 stars",
  "2 stars", "1.5 stars", "1 star", "0.5 stars", "0 stars",
  "5/5", "4/5", "3/5", "2/5", "1/5",
  "g2", "g2 crowd", "capterra", "trustpilot",
  "review", "reviews", "rating", "ratings", "stars",
  "n/a", "na", "none", "other", "misc", "general", "unknown",
  "yes", "no", "true", "false",
]);

function isNoiseTheme(theme: string): boolean {
  const lower = theme.toLowerCase().trim();
  if (NOISE_THEMES.has(lower)) return true;
  if (/^\d+(\.\d+)?\s*stars?$/i.test(lower)) return true;
  if (/^\d+\/\d+$/i.test(lower)) return true;
  if (/^\d+(\.\d+)?$/.test(lower)) return true;
  if (lower.length <= 1) return true;
  if (lower.length > 60) return true;
  return false;
}

function cleanThemes(themes: string[]): string[] {
  return themes.filter((t) => !isNoiseTheme(t));
}

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
  geminiKey?: string
): Promise<Insight[]> {
  const programmatic = generateProgrammaticInsights(data);

  if (isGeminiConfigured(geminiKey) && data.feedback.length + data.features.length > 0) {
    try {
      const aiInsights = await generateAIInsights(data, geminiKey);
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

  if (data.jiraIssues.length > 0) {
    insights.push(...jiraInsights(data.jiraIssues, now));
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

  const critical = feedback.filter((f) => f.priority === "critical" || f.priority === "high");
  if (critical.length > 0) {
    insights.push({
      id: "gen-critical-feedback",
      type: "risk",
      title: `${critical.length} High/Critical Priority Feedback Items`,
      description: `${critical.length} items flagged as critical or high priority. Top: ${critical
        .slice(0, 3)
        .map((f) => `"${f.title}" (${f.customer}${f.company ? ` @ ${f.company}` : ""})`)
        .join("; ")}.`,
      confidence: 0.9,
      relatedFeedbackIds: critical.slice(0, 10).map((f) => f.id),
      themes: ["urgency", "customer-risk"],
      impact: "high",
      createdAt: now,
    });
  }

  return insights;
}

function themeInsights(feedback: FeedbackItem[], features: ProductboardFeature[], now: string): Insight[] {
  const insights: Insight[] = [];

  const themeCounts: Record<string, { count: number; ids: string[] }> = {};
  for (const fb of feedback) {
    for (const t of cleanThemes(fb.themes)) {
      const key = normalizeTheme(t);
      if (!themeCounts[key]) themeCounts[key] = { count: 0, ids: [] };
      themeCounts[key].count++;
      themeCounts[key].ids.push(fb.id);
    }
  }
  for (const f of features) {
    for (const t of cleanThemes(f.themes)) {
      const key = normalizeTheme(t);
      if (!themeCounts[key]) themeCounts[key] = { count: 0, ids: [] };
      themeCounts[key].count++;
      themeCounts[key].ids.push(f.id);
    }
  }

  const topThemes = Object.entries(themeCounts)
    .filter(([, d]) => d.count >= 2)
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, 8);

  if (topThemes.length > 0) {
    insights.push({
      id: "gen-top-themes",
      type: "theme",
      title: `Top Themes: ${topThemes.slice(0, 4).map(([t, d]) => `${t} (${d.count})`).join(", ")}`,
      description: `The strongest signals across feedback and features: ${topThemes
        .map(([t, d]) => `**${t}** (${d.count}x)`)
        .join(", ")}. These should drive roadmap prioritization.`,
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

async function generateAIInsights(data: AgentData, geminiKey?: string): Promise<Insight[]> {
  const summaryParts: string[] = [];
  summaryParts.push(`Data: ${data.feedback.length} feedback, ${data.features.length} features, ${data.calls.length} calls, ${data.jiraIssues.length} Jira issues.`);

  const activeFeatures = data.features.filter((f) => f.status !== "done" && f.status !== "new");
  if (activeFeatures.length > 0) {
    summaryParts.push(`\nActive features (in progress/planned), top 10 by votes:\n${activeFeatures.sort((a, b) => b.votes - a.votes).slice(0, 10).map((f) => `- ${f.name} (${f.votes} votes, ${f.status})`).join("\n")}`);
  }

  if (data.feedback.length > 0) {
    summaryParts.push(`\nRecent 20 feedback:\n${data.feedback.slice(0, 20).map((f) => `- [${f.source}] ${f.title}${f.company ? ` (${f.company})` : ""} — ${f.content.slice(0, 120)}`).join("\n")}`);
  }

  if (data.calls.length > 0) {
    summaryParts.push(`\nRecent 5 calls:\n${data.calls.slice(0, 5).map((c) => `- ${c.title} (${c.date}) — ${c.summary.slice(0, 120)}`).join("\n")}`);
  }

  if (data.jiraIssues.length > 0) {
    const highPri = data.jiraIssues.filter((j) => j.priority.toLowerCase().includes("high") || j.priority.toLowerCase().includes("critical"));
    summaryParts.push(`\nJira (${data.jiraIssues.length} issues, ${highPri.length} high/critical):\n${data.jiraIssues.slice(0, 10).map((j) => `- ${j.key} ${j.summary} [${j.status}/${j.issueType}/${j.priority}]`).join("\n")}`);
  }

  const prompt = `Analyze this customer feedback data and generate 3-5 actionable insights. Focus on real product trends, risks, and opportunities — NOT ratings/stars/review scores.

For each insight, provide a JSON object:
- id: unique string starting with "ai-"
- type: "trend" | "risk" | "recommendation" | "theme" | "anomaly"
- title: concise title (under 80 chars)
- description: 2-3 sentence analysis with specifics
- confidence: 0.0-1.0
- themes: array of topic-level theme strings (NOT star ratings)
- impact: "high" | "medium" | "low"

Return ONLY a JSON array, no markdown or explanation.

${summaryParts.join("\n")}`;

  const response = await generateWithGemini(
    "You are a product analytics expert. Respond with valid JSON only. Focus on actionable product insights, not review metrics.",
    prompt,
    geminiKey
  );

  if (!response) return [];

  try {
    const cleaned = response.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];

    return parsed.map((item: Record<string, unknown>) => ({
      id: (item.id as string) || `ai-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: (item.type as string) || "theme",
      title: (item.title as string) || "AI-Generated Insight",
      description: (item.description as string) || "",
      confidence: typeof item.confidence === "number" ? item.confidence : 0.7,
      relatedFeedbackIds: [],
      themes: Array.isArray(item.themes) ? item.themes.filter((t: string) => !isNoiseTheme(t)) : [],
      impact: (item.impact as string) || "medium",
      createdAt: new Date().toISOString(),
    })) as Insight[];
  } catch {
    console.error("Failed to parse AI insights response");
    return [];
  }
}

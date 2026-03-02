import { Insight, FeedbackItem, ProductboardFeature, AttentionCall } from "./types";
import { AgentData } from "./agent";
import { generateWithGemini, isGeminiConfigured } from "./gemini";

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

function generateProgrammaticInsights(data: AgentData): Insight[] {
  const insights: Insight[] = [];
  const now = new Date().toISOString();

  if (data.features.length > 0) {
    insights.push(...featureStatusInsights(data.features, now));
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

  return insights;
}

function featureStatusInsights(features: ProductboardFeature[], now: string): Insight[] {
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

  if (features.length > 0) {
    insights.push({
      id: "gen-status-overview",
      type: "trend",
      title: `Feature Pipeline: ${inProgress.length} In Progress, ${planned.length} Planned, ${newFeatures.length} New`,
      description: `Across ${features.length} features: ${done.length} shipped, ${inProgress.length} in progress, ${planned.length} planned, and ${newFeatures.length} new/unplanned. ${
        newFeatures.length > planned.length
          ? "There are more unplanned features than planned ones — the backlog may need prioritization."
          : "The pipeline looks well-organized with a healthy ratio of planned to new items."
      }`,
      confidence: 0.95,
      relatedFeedbackIds: [],
      themes: ["roadmap", "planning"],
      impact: inProgress.length === 0 && planned.length > 5 ? "high" : "medium",
      createdAt: now,
    });
  }

  if (newFeatures.length > 10) {
    insights.push({
      id: "gen-backlog-growth",
      type: "risk",
      title: `${newFeatures.length} Features in Backlog Without Status`,
      description: `${newFeatures.length} features are sitting in "new" status without being planned or started. Top by votes: ${newFeatures
        .sort((a, b) => b.votes - a.votes)
        .slice(0, 3)
        .map((f) => `"${f.name}" (${f.votes} votes)`)
        .join(", ")}. Consider triaging the backlog to ensure high-value items aren't being missed.`,
      confidence: 0.85,
      relatedFeedbackIds: newFeatures.slice(0, 5).map((f) => f.id),
      themes: ["backlog", "prioritization"],
      impact: "medium",
      createdAt: now,
    });
  }

  return insights;
}

function topVotedInsights(features: ProductboardFeature[], now: string): Insight[] {
  const insights: Insight[] = [];
  const sorted = [...features].sort((a, b) => b.votes - a.votes);
  const top = sorted.slice(0, 5).filter((f) => f.votes > 0);

  if (top.length > 0) {
    const notStarted = top.filter((f) => f.status === "new" || f.status === "planned");
    if (notStarted.length > 0) {
      insights.push({
        id: "gen-top-voted-gap",
        type: "recommendation",
        title: `${notStarted.length} of Top 5 Voted Features Not Yet In Progress`,
        description: `The most requested features by vote count include items that haven't been started: ${notStarted
          .map((f) => `"${f.name}" (${f.votes} votes, status: ${f.status})`)
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

  insights.push({
    id: "gen-feedback-volume",
    type: "trend",
    title: `${feedback.length} Feedback Items Across ${Object.keys(bySource).length} Sources`,
    description: `Feedback breakdown by source: ${sourceBreakdown}. ${
      feedback.length > 100
        ? "High volume — consider automated categorization to keep up."
        : "Manageable volume for manual review."
    }`,
    confidence: 0.95,
    relatedFeedbackIds: feedback.slice(0, 5).map((f) => f.id),
    themes: ["feedback-volume", "operations"],
    impact: feedback.length > 200 ? "high" : "medium",
    createdAt: now,
  });

  const negative = feedback.filter((f) => f.sentiment === "negative");
  const critical = feedback.filter((f) => f.priority === "critical" || f.priority === "high");
  if (critical.length > 0) {
    insights.push({
      id: "gen-critical-feedback",
      type: "risk",
      title: `${critical.length} High/Critical Priority Feedback Items`,
      description: `${critical.length} items flagged as critical or high priority${negative.length > 0 ? `, including ${negative.length} with negative sentiment` : ""}. Top items: ${critical
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
    for (const t of fb.themes) {
      if (!themeCounts[t]) themeCounts[t] = { count: 0, ids: [] };
      themeCounts[t].count++;
      themeCounts[t].ids.push(fb.id);
    }
  }
  for (const f of features) {
    for (const t of f.themes) {
      if (!themeCounts[t]) themeCounts[t] = { count: 0, ids: [] };
      themeCounts[t].count++;
      themeCounts[t].ids.push(f.id);
    }
  }

  const topThemes = Object.entries(themeCounts)
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, 5);

  if (topThemes.length > 0) {
    insights.push({
      id: "gen-top-themes",
      type: "theme",
      title: `Top Themes: ${topThemes.map(([t, d]) => `${t} (${d.count})`).join(", ")}`,
      description: `The most common themes across feedback and features: ${topThemes
        .map(([t, d]) => `**${t}** appears ${d.count} times`)
        .join(", ")}. These represent the strongest signals from your customers and should drive prioritization.`,
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
      description: `These accounts have the most feedback items. High feedback volume can signal engagement, but also frustration. Review whether their top concerns align with the current roadmap.`,
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
      description: `Across ${calls.length} recorded calls, there are ${totalActionItems} action items to follow up on. Recent calls: ${calls
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

  const feedbackThemes = new Set<string>();
  for (const fb of feedback) {
    for (const t of fb.themes) feedbackThemes.add(t.toLowerCase());
  }

  const featureThemes = new Set<string>();
  for (const f of features) {
    for (const t of f.themes) featureThemes.add(t.toLowerCase());
  }

  const unaddressed = Array.from(feedbackThemes).filter((t) => !featureThemes.has(t));
  if (unaddressed.length > 0) {
    insights.push({
      id: "gen-theme-gaps",
      type: "anomaly",
      title: `${unaddressed.length} Feedback Themes Not Covered by Any Feature`,
      description: `Feedback mentions themes that don't appear in any Productboard feature: ${unaddressed.slice(0, 8).join(", ")}${unaddressed.length > 8 ? ` and ${unaddressed.length - 8} more` : ""}. These may represent unaddressed customer needs or opportunities for new features.`,
      confidence: 0.75,
      relatedFeedbackIds: [],
      themes: unaddressed.slice(0, 5),
      impact: unaddressed.length > 5 ? "high" : "medium",
      createdAt: now,
    });
  }

  return insights;
}

async function generateAIInsights(data: AgentData, geminiKey?: string): Promise<Insight[]> {
  const summaryParts: string[] = [];
  summaryParts.push(`Data summary: ${data.feedback.length} feedback items, ${data.features.length} features, ${data.calls.length} calls.`);

  if (data.features.length > 0) {
    summaryParts.push(`\nTop 10 features by votes:\n${[...data.features].sort((a, b) => b.votes - a.votes).slice(0, 10).map((f) => `- ${f.name} (${f.votes} votes, status: ${f.status})`).join("\n")}`);
  }

  if (data.feedback.length > 0) {
    summaryParts.push(`\nRecent 20 feedback items:\n${data.feedback.slice(0, 20).map((f) => `- [${f.source}] ${f.title} (${f.sentiment}, ${f.priority}) — ${f.content.slice(0, 100)}`).join("\n")}`);
  }

  if (data.calls.length > 0) {
    summaryParts.push(`\nRecent 5 calls:\n${data.calls.slice(0, 5).map((c) => `- ${c.title} (${c.date}) — ${c.summary.slice(0, 100)}`).join("\n")}`);
  }

  const prompt = `Analyze this customer feedback data and generate 3-5 key insights. For each insight, provide a JSON object with these fields:
- id: unique string starting with "ai-"
- type: one of "trend", "risk", "recommendation", "theme", "anomaly"
- title: concise title (under 80 chars)
- description: 2-3 sentence analysis
- confidence: number 0.0-1.0
- themes: array of relevant theme strings
- impact: "high", "medium", or "low"

Return ONLY a JSON array of insight objects, no other text.

${summaryParts.join("\n")}`;

  const response = await generateWithGemini(
    "You are a data analyst. Respond with valid JSON only.",
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
      themes: Array.isArray(item.themes) ? item.themes : [],
      impact: (item.impact as string) || "medium",
      createdAt: new Date().toISOString(),
    })) as Insight[];
  } catch {
    console.error("Failed to parse AI insights response");
    return [];
  }
}

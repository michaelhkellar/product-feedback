import type { AgentData } from "./agent";

export interface Contradiction {
  id: string;
  kind: "praise-vs-falling-usage" | "stale-open-jira" | "high-vote-no-feature" | "high-usage-negative-feedback";
  title: string;
  evidence: string[];
  relatedFeedbackIds: string[];
  relatedFeatureNames: string[];
  severity: "low" | "medium" | "high";
}

const DONE_STATUSES = new Set(["done", "closed", "resolved", "won't fix", "wontfix", "cancelled", "canceled"]);
const STALE_JIRA_DAYS = 30;

function daysAgo(isoString: string): number {
  return (Date.now() - new Date(isoString).getTime()) / (1000 * 60 * 60 * 24);
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function textContains(text: string, needle: string): boolean {
  return normalize(text).includes(normalize(needle));
}

export function findContradictions(data: AgentData): Contradiction[] {
  const out: Contradiction[] = [];

  // Rule 1: praise-vs-falling-usage
  // High-positive feedback about a feature that shows in analytics fallingItems
  if (data.analyticsOverview?.fallingItems?.length) {
    for (const falling of data.analyticsOverview.fallingItems) {
      if (falling.kind !== "feature" && falling.kind !== "page") continue;
      const positiveFeedback = data.feedback.filter(
        (fb) =>
          fb.sentiment === "positive" &&
          (textContains(fb.title, falling.name) || textContains(fb.content, falling.name))
      );
      if (positiveFeedback.length >= 2) {
        const deltaPct = falling.deltaPct ?? 0;
        const severity: Contradiction["severity"] =
          positiveFeedback.length >= 5 ? "high" : deltaPct < -30 ? "high" : "medium";
        out.push({
          id: `praise-vs-falling-${falling.name.replace(/\s+/g, "-").toLowerCase()}`,
          kind: "praise-vs-falling-usage",
          title: `Customers praise "${falling.name}" but usage is falling (${deltaPct > 0 ? "+" : ""}${Math.round(deltaPct)}% vs prior period)`,
          evidence: [
            `${positiveFeedback.length} positive feedback item${positiveFeedback.length > 1 ? "s" : ""} mention "${falling.name}"`,
            `Analytics (${data.analyticsOverview!.provider}): ${falling.count} events, ${Math.round(deltaPct)}% vs prior period`,
            ...positiveFeedback.slice(0, 2).map((fb) => `"${fb.title}" — ${fb.company || fb.customer}`),
          ],
          relatedFeedbackIds: positiveFeedback.map((fb) => fb.id),
          relatedFeatureNames: [falling.name],
          severity,
        });
      }
    }
  }

  // Rule 2: stale-open-jira
  // Open Jira issues untouched for 30+ days that overlap with active feedback themes
  const allFeedbackThemes = new Set(data.feedback.flatMap((fb) => fb.themes.map(normalize)));
  for (const issue of data.jiraIssues) {
    if (DONE_STATUSES.has(issue.status.toLowerCase())) continue;
    if (daysAgo(issue.updated) < STALE_JIRA_DAYS) continue;
    const matchingThemes = issue.labels.filter((l) => allFeedbackThemes.has(normalize(l)));
    if (matchingThemes.length === 0 && !textContains(issue.summary, "feedback")) continue;
    const severity: Contradiction["severity"] =
      issue.priority.toLowerCase() === "high" || issue.priority.toLowerCase() === "critical" ? "high" : "medium";
    out.push({
      id: `stale-jira-${issue.key}`,
      kind: "stale-open-jira",
      title: `${issue.key} is open and stale (${Math.floor(daysAgo(issue.updated))}d since last update) — customers are still filing related feedback`,
      evidence: [
        `${issue.key}: "${issue.summary}" — status: ${issue.status}, priority: ${issue.priority}`,
        `Last updated: ${Math.floor(daysAgo(issue.updated))} days ago`,
        matchingThemes.length > 0
          ? `Overlapping themes: ${matchingThemes.slice(0, 3).join(", ")}`
          : "Summary overlaps with open feedback",
      ],
      relatedFeedbackIds: [],
      relatedFeatureNames: [],
      severity,
    });
  }

  // Rule 3: high-vote-no-feature
  // Highly-voted feature requests with status "new" — no Jira or Linear issue referencing them
  if (data.features.length > 0) {
    const voteCounts = data.features.map((f) => f.votes).sort((a, b) => b - a);
    const topQuartileThreshold = voteCounts[Math.floor(voteCounts.length * 0.25)] ?? 5;
    for (const feature of data.features) {
      if (feature.status !== "new") continue;
      if (feature.votes < topQuartileThreshold || feature.votes < 3) continue;
      const hasJira = data.jiraIssues.some((j) => textContains(j.summary, feature.name) || textContains(j.description ?? "", feature.name));
      const hasLinear = data.linearIssues.some((l) => textContains(l.title, feature.name) || textContains(l.description ?? "", feature.name));
      if (!hasJira && !hasLinear) {
        out.push({
          id: `high-vote-no-ticket-${feature.id}`,
          kind: "high-vote-no-feature",
          title: `"${feature.name}" has ${feature.votes} votes and no linked engineering ticket`,
          evidence: [
            `${feature.votes} votes, ${feature.customerRequests} customer request${feature.customerRequests !== 1 ? "s" : ""}`,
            `Status: ${feature.status} — no matching Jira or Linear issue found`,
          ],
          relatedFeedbackIds: [],
          relatedFeatureNames: [feature.name],
          severity: "medium",
        });
      }
    }
  }

  // Rule 4: high-usage-negative-feedback
  // Top-volume or rising features/pages that have ≥2 negative-sentiment feedback items
  // mentioning them by name. Mirror of Rule 1 with sentiment and signal direction flipped.
  if (data.analyticsOverview) {
    const hotItems: { name: string; kind: string; count: number; deltaPct?: number }[] = [
      ...(data.analyticsOverview.risingItems ?? []).filter((r) => r.kind === "feature" || r.kind === "page"),
      ...data.analyticsOverview.topPages.slice(0, 5).map((p) => ({ name: p.name, kind: "page", count: p.count, deltaPct: p.deltaPct })),
      ...data.analyticsOverview.topFeatures.slice(0, 5).map((f) => ({ name: f.name, kind: "feature", count: f.count, deltaPct: f.deltaPct })),
    ];
    const seen = new Set<string>();
    const dedup = hotItems.filter((i) => {
      const key = `${i.kind}:${normalize(i.name)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    for (const item of dedup) {
      const negativeFeedback = data.feedback.filter(
        (fb) =>
          fb.sentiment === "negative" &&
          (textContains(fb.title, item.name) || textContains(fb.content, item.name))
      );
      if (negativeFeedback.length >= 2) {
        const severity: Contradiction["severity"] =
          negativeFeedback.length >= 5 ? "high" : "medium";
        out.push({
          id: `high-usage-negative-${item.name.replace(/\s+/g, "-").toLowerCase()}`,
          kind: "high-usage-negative-feedback",
          title: `Customers complain about "${item.name}" but it's a top ${item.kind === "page" ? "page" : "feature"} by usage (${item.count.toLocaleString()} events)`,
          evidence: [
            `${negativeFeedback.length} negative feedback item${negativeFeedback.length > 1 ? "s" : ""} mention "${item.name}"`,
            `Analytics (${data.analyticsOverview!.provider}): ${item.count.toLocaleString()} events${item.deltaPct !== undefined ? `, ${item.deltaPct >= 0 ? "+" : ""}${Math.round(item.deltaPct)}% vs prior` : ""}`,
            ...negativeFeedback.slice(0, 2).map((fb) => `"${fb.title}" — ${fb.company || fb.customer}`),
          ],
          relatedFeedbackIds: negativeFeedback.map((fb) => fb.id),
          relatedFeatureNames: [item.name],
          severity,
        });
      }
    }
  }

  // Sort by severity, cap at 10
  const severityOrder = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]).slice(0, 10);
}

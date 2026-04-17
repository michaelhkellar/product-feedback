import { NextRequest, NextResponse } from "next/server";
import { getData } from "@/lib/data-fetcher";
import { FeedbackItem, AttentionCall, JiraIssue, LinearIssue } from "@/lib/types";
import { getRelevantPendoContext } from "@/lib/pendo";
import { getRelevantAmplitudeContext } from "@/lib/amplitude";
import { getRelevantPostHogContext } from "@/lib/posthog";

function lc(s: string) {
  return s.toLowerCase();
}

function matchesTheme(themes: string[], name: string): boolean {
  return themes.some((t) => lc(t) === lc(name) || lc(t).includes(lc(name)) || lc(name).includes(lc(t)));
}

function matchesAccount(item: FeedbackItem, name: string): boolean {
  const n = lc(name);
  return lc(item.company || "").includes(n) || lc(item.customer).includes(n);
}

function matchesFeature(themes: string[], name: string): boolean {
  return matchesTheme(themes, name);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { kind, name } = body;
    if (!kind || !name) {
      return NextResponse.json({ error: "kind and name are required" }, { status: 400 });
    }

    const useDemoData = req.headers.get("x-use-demo") === "true";
    const pbKey = req.headers.get("x-productboard-key") || undefined;
    const attKey = req.headers.get("x-attention-key") || undefined;
    const pendoKey = req.headers.get("x-pendo-integration-key") || undefined;
    const atlDomain = req.headers.get("x-atlassian-domain") || undefined;
    const atlEmail = req.headers.get("x-atlassian-email") || undefined;
    const atlToken = req.headers.get("x-atlassian-token") || undefined;
    const linearKey = req.headers.get("x-linear-key") || undefined;
    const linearTeamId = req.headers.get("x-linear-team-id") || undefined;
    const analyticsProvider = (req.headers.get("x-analytics-provider") as "pendo" | "amplitude" | "posthog") || undefined;
    const amplitudeKey = req.headers.get("x-amplitude-key") || undefined;
    const posthogKey = req.headers.get("x-posthog-key") || undefined;
    const posthogHost = req.headers.get("x-posthog-host") || undefined;

    const data = await getData(
      pbKey, attKey, pendoKey, useDemoData,
      atlDomain, atlEmail, atlToken,
      undefined, undefined,
      undefined, undefined, undefined, undefined, undefined,
      linearKey, linearTeamId
    );

    const feedback: FeedbackItem[] = [];
    const calls: AttentionCall[] = [];
    const tickets: (JiraIssue | LinearIssue)[] = [];

    if (kind === "theme") {
      feedback.push(...data.feedback.filter((f) => matchesTheme(f.themes, name)));
      calls.push(...data.calls.filter((c) => matchesTheme(c.themes, name) || lc(c.title).includes(lc(name)) || lc(c.summary).includes(lc(name))));
      tickets.push(
        ...data.jiraIssues.filter((j) => matchesTheme(j.labels, name) || lc(j.summary).includes(lc(name)) || lc(j.description).includes(lc(name))),
        ...data.linearIssues.filter((l) => matchesTheme(l.labels, name) || lc(l.title).includes(lc(name)) || lc(l.description).includes(lc(name))),
      );
    } else if (kind === "account") {
      feedback.push(...data.feedback.filter((f) => matchesAccount(f, name)));
      calls.push(...data.calls.filter((c) => lc(c.title).includes(lc(name)) || c.participants.some((p) => lc(p).includes(lc(name)))));
      tickets.push(
        ...data.jiraIssues.filter((j) => lc(j.summary).includes(lc(name)) || lc(j.description).includes(lc(name))),
      );
    } else if (kind === "feature") {
      feedback.push(...data.feedback.filter((f) => matchesFeature(f.themes, name) || lc(f.title).includes(lc(name)) || lc(f.content).includes(lc(name))));
      calls.push(...data.calls.filter((c) => lc(c.title).includes(lc(name)) || lc(c.summary).includes(lc(name))));
      tickets.push(
        ...data.jiraIssues.filter((j) => matchesTheme(j.labels, name) || lc(j.summary).includes(lc(name))),
        ...data.linearIssues.filter((l) => matchesTheme(l.labels, name) || lc(l.title).includes(lc(name))),
      );
    } else if (kind === "customer") {
      feedback.push(...data.feedback.filter((f) => matchesAccount(f, name)));
      calls.push(...data.calls.filter((c) => c.participants.some((p) => lc(p).includes(lc(name)))));
    }

    const sentimentCounts: Record<string, number> = {};
    for (const fb of feedback) {
      sentimentCounts[fb.sentiment] = (sentimentCounts[fb.sentiment] || 0) + 1;
    }

    // Fetch analytics usage context for account-level entities (30-day window)
    let analyticsContext: string | null = null;
    if (kind === "account" && analyticsProvider) {
      try {
        const query = `Show usage data for account: ${name}`;
        const relatedFeedback = feedback.slice(0, 10);
        let result = null;
        if (analyticsProvider === "pendo" && pendoKey) {
          result = await getRelevantPendoContext(query, relatedFeedback, pendoKey, 30);
        } else if (analyticsProvider === "amplitude" && amplitudeKey) {
          result = await getRelevantAmplitudeContext(query, relatedFeedback, amplitudeKey, 30);
        } else if (analyticsProvider === "posthog" && posthogKey) {
          result = await getRelevantPostHogContext(query, relatedFeedback, posthogKey, 30, posthogHost);
        }
        if (result) analyticsContext = result.context;
      } catch {
        // non-fatal
      }
    }

    return NextResponse.json({
      feedback: feedback.slice(0, 50),
      calls: calls.slice(0, 20),
      tickets: tickets.slice(0, 30),
      sentimentCounts,
      totalFeedback: feedback.length,
      totalCalls: calls.length,
      totalTickets: tickets.length,
      analyticsContext,
    });
  } catch (error) {
    console.error("Entity API error:", error);
    return NextResponse.json({ error: "Failed to fetch entity data" }, { status: 500 });
  }
}

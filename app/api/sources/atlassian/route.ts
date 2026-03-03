import { NextRequest, NextResponse } from "next/server";
import { getJiraIssues, getConfluencePages, isAtlassianConfigured } from "@/lib/atlassian";

export async function GET(req: NextRequest) {
  const domain = req.headers.get("x-atlassian-domain") || undefined;
  const email = req.headers.get("x-atlassian-email") || undefined;
  const token = req.headers.get("x-atlassian-token") || undefined;

  if (!isAtlassianConfigured(domain, email, token)) {
    return NextResponse.json({ connected: false, jiraIssues: [], confluencePages: [] });
  }

  const jiraFilter = req.headers.get("x-atlassian-jira-filter") || undefined;
  const confluenceFilter = req.headers.get("x-atlassian-confluence-filter") || undefined;

  try {
    const [jira, confluence] = await Promise.all([
      getJiraIssues(domain, email, token, jiraFilter),
      getConfluencePages(domain, email, token, confluenceFilter),
    ]);

    return NextResponse.json({
      connected: true,
      jiraIssues: jira.data,
      jiraError: jira.error || null,
      confluencePages: confluence.data,
      confluenceError: confluence.error || null,
    });
  } catch (err) {
    console.error("Atlassian route error:", err);
    return NextResponse.json({
      connected: true,
      jiraIssues: [],
      confluencePages: [],
      error: err instanceof Error ? err.message : "Failed to fetch Atlassian data",
    });
  }
}

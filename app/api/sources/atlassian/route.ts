import { NextRequest, NextResponse } from "next/server";
import { getJiraIssues, getConfluencePages, isAtlassianConfigured } from "@/lib/atlassian";

export async function GET(req: NextRequest) {
  const domain = req.headers.get("x-atlassian-domain") || undefined;
  const email = req.headers.get("x-atlassian-email") || undefined;
  const token = req.headers.get("x-atlassian-token") || undefined;

  if (!isAtlassianConfigured(domain, email, token)) {
    return NextResponse.json({ connected: false, jiraIssues: [], confluencePages: [] });
  }

  const [jira, confluence] = await Promise.all([
    getJiraIssues(domain, email, token),
    getConfluencePages(domain, email, token),
  ]);

  return NextResponse.json({
    connected: true,
    jiraIssues: jira.data,
    confluencePages: confluence.data,
  });
}

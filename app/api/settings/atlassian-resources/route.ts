import { NextRequest, NextResponse } from "next/server";
import { getJiraProjects, getConfluenceSpaces, isAtlassianConfigured } from "@/lib/atlassian";

export async function GET(req: NextRequest) {
  const domain = req.headers.get("x-atlassian-domain") || undefined;
  const email = req.headers.get("x-atlassian-email") || undefined;
  const token = req.headers.get("x-atlassian-token") || undefined;

  if (!isAtlassianConfigured(domain, email, token)) {
    return NextResponse.json({ projects: [], spaces: [] });
  }

  try {
    const [projects, spaces] = await Promise.all([
      getJiraProjects(domain, email, token),
      getConfluenceSpaces(domain, email, token),
    ]);
    return NextResponse.json({ projects, spaces });
  } catch (err) {
    console.error("Atlassian resources error:", err);
    return NextResponse.json({ projects: [], spaces: [], error: "Failed to fetch resources" });
  }
}

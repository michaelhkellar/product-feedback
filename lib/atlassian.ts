import { JiraIssue, ConfluencePage } from "./types";

const MAX_RESULTS = 1000;
const PAGE_SIZE = 100;

interface AtlassianAuth {
  domain: string;
  email: string;
  token: string;
}

function getAuth(
  overrideDomain?: string,
  overrideEmail?: string,
  overrideToken?: string
): AtlassianAuth | null {
  const domain = overrideDomain || process.env.ATLASSIAN_DOMAIN;
  const email = overrideEmail || process.env.ATLASSIAN_EMAIL;
  const token = overrideToken || process.env.ATLASSIAN_API_TOKEN;
  if (!domain || !email || !token) return null;
  const cleanDomain = domain.replace(/\.atlassian\.net\/?$/, "").replace(/^https?:\/\//, "");
  return { domain: cleanDomain, email, token };
}

function authHeader(auth: AtlassianAuth): string {
  const encoded = Buffer.from(`${auth.email}:${auth.token}`).toString("base64");
  return `Basic ${encoded}`;
}

async function jiraFetch(auth: AtlassianAuth, path: string) {
  const url = `https://${auth.domain}.atlassian.net/rest/api/3${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: authHeader(auth),
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    console.error(`Jira API error: ${res.status} ${res.statusText} for ${path}`);
    return null;
  }
  return res.json();
}

async function confluenceFetch(auth: AtlassianAuth, path: string) {
  const url = `https://${auth.domain}.atlassian.net/wiki/rest/api${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: authHeader(auth),
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    console.error(`Confluence API error: ${res.status} ${res.statusText} for ${path}`);
    return null;
  }
  return res.json();
}

export async function getJiraIssues(
  overrideDomain?: string,
  overrideEmail?: string,
  overrideToken?: string
): Promise<{ data: JiraIssue[]; isDemo: boolean }> {
  const auth = getAuth(overrideDomain, overrideEmail, overrideToken);
  if (!auth) return { data: [], isDemo: false };

  const allIssues: JiraIssue[] = [];
  let startAt = 0;

  while (allIssues.length < MAX_RESULTS) {
    const jql = encodeURIComponent("ORDER BY updated DESC");
    const data = await jiraFetch(
      auth,
      `/search?jql=${jql}&maxResults=${PAGE_SIZE}&startAt=${startAt}&fields=summary,description,status,issuetype,priority,assignee,reporter,labels,created,updated,project,resolution`
    );
    if (!data || !data.issues) break;

    for (const issue of data.issues) {
      const fields = issue.fields || {};
      allIssues.push({
        id: issue.id,
        key: issue.key,
        summary: fields.summary || "",
        description: extractTextFromADF(fields.description),
        status: fields.status?.name || "Unknown",
        issueType: fields.issuetype?.name || "Unknown",
        priority: fields.priority?.name || "Medium",
        assignee: fields.assignee?.displayName || "Unassigned",
        reporter: fields.reporter?.displayName || "",
        labels: fields.labels || [],
        created: fields.created || "",
        updated: fields.updated || "",
        project: fields.project?.name || fields.project?.key || "",
        resolution: fields.resolution?.name || "",
      });
    }

    if (data.issues.length < PAGE_SIZE || allIssues.length >= data.total) break;
    startAt += PAGE_SIZE;
  }

  console.log(`Jira: fetched ${allIssues.length} issues`);
  return { data: allIssues, isDemo: false };
}

export async function getConfluencePages(
  overrideDomain?: string,
  overrideEmail?: string,
  overrideToken?: string
): Promise<{ data: ConfluencePage[]; isDemo: boolean }> {
  const auth = getAuth(overrideDomain, overrideEmail, overrideToken);
  if (!auth) return { data: [], isDemo: false };

  const allPages: ConfluencePage[] = [];
  let start = 0;
  const limit = Math.min(PAGE_SIZE, 50);

  while (allPages.length < 500) {
    const data = await confluenceFetch(
      auth,
      `/content?type=page&orderby=lastmodified desc&limit=${limit}&start=${start}&expand=space,version,body.view`
    );
    if (!data || !data.results) break;

    for (const page of data.results) {
      const body = page.body?.view?.value || "";
      const excerpt = body
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 500);

      allPages.push({
        id: page.id,
        title: page.title || "Untitled",
        excerpt,
        space: page.space?.name || page.space?.key || "",
        lastModified: page.version?.when || "",
        author: page.version?.by?.displayName || "",
        url: `https://${auth.domain}.atlassian.net/wiki${page._links?.webui || ""}`,
      });
    }

    if (data.results.length < limit) break;
    start += limit;
  }

  console.log(`Confluence: fetched ${allPages.length} pages`);
  return { data: allPages, isDemo: false };
}

function extractTextFromADF(adf: unknown): string {
  if (!adf) return "";
  if (typeof adf === "string") return adf;
  if (typeof adf !== "object") return "";

  const node = adf as Record<string, unknown>;
  if (node.type === "text" && typeof node.text === "string") return node.text;

  let text = "";
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      text += extractTextFromADF(child) + " ";
    }
  }
  return text.trim();
}

export function isAtlassianConfigured(
  overrideDomain?: string,
  overrideEmail?: string,
  overrideToken?: string
): boolean {
  return !!getAuth(overrideDomain, overrideEmail, overrideToken);
}

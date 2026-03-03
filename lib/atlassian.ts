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

function parseFilterList(filter: string | undefined): string[] {
  if (!filter) return [];
  return filter
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function buildJiraJql(projectFilter: string | undefined): string {
  const projects = parseFilterList(projectFilter);
  if (projects.length === 0) return "ORDER BY updated DESC";
  const quoted = projects.map((p) => {
    const trimmed = p.trim();
    const upper = trimmed.toUpperCase();
    if (/^[A-Z][A-Z0-9_]+$/.test(upper)) return upper;
    return `"${trimmed.replace(/"/g, '\\"')}"`;
  });
  return `project IN (${quoted.join(", ")}) ORDER BY updated DESC`;
}

async function jiraFetch(auth: AtlassianAuth, path: string): Promise<{ data: unknown; error: string | null }> {
  const url = `https://${auth.domain}.atlassian.net/rest/api/3${path}`;
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: authHeader(auth),
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const msg = `Jira ${res.status}: ${res.statusText}${body ? ` — ${body.slice(0, 200)}` : ""}`;
      console.error(msg);
      return { data: null, error: msg };
    }
    return { data: await res.json(), error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Connection failed";
    console.error(`Jira fetch error: ${msg}`);
    return { data: null, error: msg };
  }
}

async function confluenceFetch(auth: AtlassianAuth, path: string): Promise<{ data: unknown; error: string | null }> {
  const url = `https://${auth.domain}.atlassian.net/wiki/rest/api${path}`;
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: authHeader(auth),
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const msg = `Confluence ${res.status}: ${res.statusText}${body ? ` — ${body.slice(0, 200)}` : ""}`;
      console.error(msg);
      return { data: null, error: msg };
    }
    return { data: await res.json(), error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Connection failed";
    console.error(`Confluence fetch error: ${msg}`);
    return { data: null, error: msg };
  }
}

export async function getJiraIssues(
  overrideDomain?: string,
  overrideEmail?: string,
  overrideToken?: string,
  projectFilter?: string
): Promise<{ data: JiraIssue[]; isDemo: boolean; error?: string }> {
  const auth = getAuth(overrideDomain, overrideEmail, overrideToken);
  if (!auth) return { data: [], isDemo: false };

  const allIssues: JiraIssue[] = [];
  let startAt = 0;
  const jqlRaw = buildJiraJql(projectFilter);
  const jql = encodeURIComponent(jqlRaw);
  let lastError: string | null = null;

  while (allIssues.length < MAX_RESULTS) {
    const { data, error } = await jiraFetch(
      auth,
      `/search?jql=${jql}&maxResults=${PAGE_SIZE}&startAt=${startAt}&fields=summary,description,status,issuetype,priority,assignee,reporter,labels,created,updated,project,resolution`
    );
    if (error) { lastError = error; break; }
    const result = data as Record<string, unknown>;
    const issues = result?.issues as Record<string, unknown>[];
    if (!issues) break;

    for (const issue of issues) {
      const fields = (issue.fields || {}) as Record<string, unknown>;
      const status = fields.status as Record<string, unknown> | undefined;
      const issuetype = fields.issuetype as Record<string, unknown> | undefined;
      const priority = fields.priority as Record<string, unknown> | undefined;
      const assignee = fields.assignee as Record<string, unknown> | undefined;
      const reporter = fields.reporter as Record<string, unknown> | undefined;
      const project = fields.project as Record<string, unknown> | undefined;
      const resolution = fields.resolution as Record<string, unknown> | undefined;

      allIssues.push({
        id: issue.id as string,
        key: issue.key as string,
        summary: (fields.summary as string) || "",
        description: extractTextFromADF(fields.description),
        status: (status?.name as string) || "Unknown",
        issueType: (issuetype?.name as string) || "Unknown",
        priority: (priority?.name as string) || "Medium",
        assignee: (assignee?.displayName as string) || "Unassigned",
        reporter: (reporter?.displayName as string) || "",
        labels: (fields.labels as string[]) || [],
        created: (fields.created as string) || "",
        updated: (fields.updated as string) || "",
        project: (project?.name as string) || (project?.key as string) || "",
        resolution: (resolution?.name as string) || "",
      });
    }

    const total = result?.total as number;
    if (issues.length < PAGE_SIZE || allIssues.length >= (total || MAX_RESULTS)) break;
    startAt += PAGE_SIZE;
  }

  const filterDesc = projectFilter ? ` (filter: ${projectFilter})` : "";
  console.log(`Jira: fetched ${allIssues.length} issues${filterDesc}${lastError ? ` [error: ${lastError}]` : ""}`);
  return { data: allIssues, isDemo: false, error: lastError || undefined };
}

export async function getConfluencePages(
  overrideDomain?: string,
  overrideEmail?: string,
  overrideToken?: string,
  spaceFilter?: string
): Promise<{ data: ConfluencePage[]; isDemo: boolean; error?: string }> {
  const auth = getAuth(overrideDomain, overrideEmail, overrideToken);
  if (!auth) return { data: [], isDemo: false };

  const spaces = parseFilterList(spaceFilter);
  const allPages: ConfluencePage[] = [];
  const limit = Math.min(PAGE_SIZE, 50);
  let lastError: string | null = null;

  async function fetchSpace(spaceKey?: string) {
    let start = 0;
    const spaceParam = spaceKey ? `&spaceKey=${encodeURIComponent(spaceKey.toUpperCase())}` : "";
    while (allPages.length < 500) {
      const { data, error } = await confluenceFetch(
        auth!,
        `/content?type=page${spaceParam}&orderby=lastmodified desc&limit=${limit}&start=${start}&expand=space,version,body.view`
      );
      if (error) {
        lastError = error;
        if (spaceKey) {
          const { data: cqlData, error: cqlError } = await confluenceFetch(
            auth!,
            `/content/search?cql=${encodeURIComponent(`space.title = "${spaceKey}" ORDER BY lastmodified DESC`)}&limit=${limit}&expand=space,version,body.view`
          );
          if (cqlError) { lastError = cqlError; return; }
          const results = (cqlData as Record<string, unknown>)?.results as Record<string, unknown>[];
          if (results) {
            for (const page of results) addPage(allPages, page, auth!.domain);
          }
        }
        return;
      }
      const result = data as Record<string, unknown>;
      const results = result?.results as Record<string, unknown>[];
      if (!results) break;
      for (const page of results) addPage(allPages, page, auth!.domain);
      if (results.length < limit) break;
      start += limit;
    }
  }

  if (spaces.length > 0) {
    for (const space of spaces) await fetchSpace(space);
  } else {
    await fetchSpace();
  }

  const filterDesc = spaceFilter ? ` (filter: ${spaceFilter})` : "";
  console.log(`Confluence: fetched ${allPages.length} pages${filterDesc}${lastError ? ` [error: ${lastError}]` : ""}`);
  return { data: allPages, isDemo: false, error: lastError || undefined };
}

function addPage(allPages: ConfluencePage[], page: Record<string, unknown>, domain: string) {
  const bodyObj = page.body as Record<string, unknown> | undefined;
  const viewObj = bodyObj?.view as Record<string, unknown> | undefined;
  const body = (viewObj?.value as string) || "";
  const excerpt = body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);

  const space = page.space as Record<string, unknown> | undefined;
  const version = page.version as Record<string, unknown> | undefined;
  const links = page._links as Record<string, unknown> | undefined;
  const by = version?.by as Record<string, unknown> | undefined;

  allPages.push({
    id: page.id as string,
    title: (page.title as string) || "Untitled",
    excerpt,
    space: (space?.name as string) || (space?.key as string) || "",
    lastModified: (version?.when as string) || "",
    author: (by?.displayName as string) || "",
    url: `https://${domain}.atlassian.net/wiki${(links?.webui as string) || ""}`,
  });
}

function extractTextFromADF(adf: unknown): string {
  if (!adf) return "";
  if (typeof adf === "string") return adf;
  if (typeof adf !== "object") return "";
  const node = adf as Record<string, unknown>;
  if (node.type === "text" && typeof node.text === "string") return node.text;
  let text = "";
  if (Array.isArray(node.content)) {
    for (const child of node.content) text += extractTextFromADF(child) + " ";
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

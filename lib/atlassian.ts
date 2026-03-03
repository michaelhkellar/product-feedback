import { JiraIssue, ConfluencePage } from "./types";

const MAX_RESULTS = 1000;
const PAGE_SIZE = 100;

interface AtlassianAuth {
  domain: string;
  email: string;
  token: string;
}

interface ResolvedAuth extends AtlassianAuth {
  cloudId: string | null;
  useScoped: boolean;
}

const resolvedAuthCache = new Map<string, ResolvedAuth>();

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

function basicAuthHeader(auth: AtlassianAuth): string {
  return `Basic ${Buffer.from(`${auth.email}:${auth.token}`).toString("base64")}`;
}

async function resolveAuth(auth: AtlassianAuth): Promise<ResolvedAuth> {
  const cacheKey = `${auth.domain}:${auth.email.slice(0, 4)}`;
  const cached = resolvedAuthCache.get(cacheKey);
  if (cached) return cached;

  let cloudId: string | null = null;
  try {
    const tenantRes = await fetch(`https://${auth.domain}.atlassian.net/_edge/tenant_info`);
    if (tenantRes.ok) cloudId = ((await tenantRes.json()) as Record<string, string>).cloudId || null;
  } catch { /* ignore */ }

  const classicRes = await fetch(`https://${auth.domain}.atlassian.net/rest/api/3/myself`, {
    headers: { Authorization: basicAuthHeader(auth), Accept: "application/json" },
  }).catch(() => null);

  if (classicRes?.ok) {
    const resolved: ResolvedAuth = { ...auth, cloudId, useScoped: false };
    resolvedAuthCache.set(cacheKey, resolved);
    console.log(`Atlassian: classic auth OK for ${auth.domain}`);
    return resolved;
  }

  if (cloudId) {
    const scopedRes = await fetch(`https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/myself`, {
      headers: { Authorization: basicAuthHeader(auth), Accept: "application/json" },
    }).catch(() => null);

    if (scopedRes?.ok) {
      const resolved: ResolvedAuth = { ...auth, cloudId, useScoped: true };
      resolvedAuthCache.set(cacheKey, resolved);
      console.log(`Atlassian: scoped auth OK for ${auth.domain} (cloudId: ${cloudId})`);
      return resolved;
    }
  }

  const resolved: ResolvedAuth = { ...auth, cloudId, useScoped: false };
  resolvedAuthCache.set(cacheKey, resolved);
  return resolved;
}

function jiraBase(auth: ResolvedAuth): string {
  if (auth.useScoped && auth.cloudId) return `https://api.atlassian.com/ex/jira/${auth.cloudId}/rest/api/3`;
  return `https://${auth.domain}.atlassian.net/rest/api/3`;
}

function confluenceV2Base(auth: ResolvedAuth): string {
  if (auth.useScoped && auth.cloudId) return `https://api.atlassian.com/ex/confluence/${auth.cloudId}/wiki/api/v2`;
  return `https://${auth.domain}.atlassian.net/wiki/api/v2`;
}

function confluenceV1Base(auth: ResolvedAuth): string {
  if (auth.useScoped && auth.cloudId) return `https://api.atlassian.com/ex/confluence/${auth.cloudId}/wiki/rest/api`;
  return `https://${auth.domain}.atlassian.net/wiki/rest/api`;
}

function sanitizeErrorBody(text: string): string {
  return text
    .replace(/[A-Za-z0-9+/=]{20,}/g, "[REDACTED]")
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/Basic\s+\S+/gi, "Basic [REDACTED]")
    .slice(0, 200);
}

async function atlFetch(url: string, auth: ResolvedAuth, method = "GET", body?: unknown): Promise<{ data: unknown; error: string | null }> {
  try {
    const opts: RequestInit = {
      method,
      headers: {
        Authorization: basicAuthHeader(auth),
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    if (!res.ok) {
      const rawText = await res.text().catch(() => "");
      const safeText = sanitizeErrorBody(rawText);
      let hint = "";
      if (res.status === 401 || res.status === 403) hint = " — Check token permissions/scopes.";
      if (res.status === 410) hint = " — Endpoint deprecated.";
      const msg = `${res.status} ${res.statusText}${hint}${safeText ? ` — ${safeText}` : ""}`;
      return { data: null, error: msg };
    }
    return { data: await res.json(), error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : "Connection failed" };
  }
}

function parseFilterList(filter: string | undefined): string[] {
  if (!filter) return [];
  return filter.split(/[,;\n]+/).map((s) => s.trim()).filter((s) => s.length > 0);
}

function buildJiraJql(projectFilter: string | undefined): string {
  const projects = parseFilterList(projectFilter);
  if (projects.length === 0) return "ORDER BY updated DESC";
  const quoted = projects.map((p) => {
    const upper = p.trim().toUpperCase();
    if (/^[A-Z][A-Z0-9_]+$/.test(upper)) return upper;
    return `"${p.trim().replace(/"/g, '\\"')}"`;
  });
  return `project IN (${quoted.join(", ")}) ORDER BY updated DESC`;
}

export async function getJiraProjects(
  overrideDomain?: string, overrideEmail?: string, overrideToken?: string
): Promise<{ key: string; name: string }[]> {
  const rawAuth = getAuth(overrideDomain, overrideEmail, overrideToken);
  if (!rawAuth) return [];
  const auth = await resolveAuth(rawAuth);
  const { data, error } = await atlFetch(`${jiraBase(auth)}/project/search?maxResults=200&orderBy=name`, auth);
  if (error || !data) return [];
  const result = data as Record<string, unknown>;
  const values = (result.values || result) as Record<string, unknown>[];
  if (!Array.isArray(values)) return [];
  return values.map((p) => ({ key: (p.key as string) || "", name: (p.name as string) || "" })).filter((p) => p.key);
}

export async function getConfluenceSpaces(
  overrideDomain?: string, overrideEmail?: string, overrideToken?: string
): Promise<{ key: string; name: string }[]> {
  const rawAuth = getAuth(overrideDomain, overrideEmail, overrideToken);
  if (!rawAuth) return [];
  const auth = await resolveAuth(rawAuth);

  const { data, error } = await atlFetch(`${confluenceV2Base(auth)}/spaces?limit=200&sort=name`, auth);
  if (!error && data) {
    const result = data as Record<string, unknown>;
    const results = (result.results || []) as Record<string, unknown>[];
    return results.map((s) => ({ key: (s.key as string) || "", name: (s.name as string) || "" })).filter((s) => s.key);
  }

  const { data: v1Data } = await atlFetch(`${confluenceV1Base(auth)}/space?limit=200`, auth);
  if (v1Data) {
    const results = ((v1Data as Record<string, unknown>).results || []) as Record<string, unknown>[];
    return results.map((s) => ({ key: (s.key as string) || "", name: (s.name as string) || "" })).filter((s) => s.key);
  }

  return [];
}

export async function getJiraIssues(
  overrideDomain?: string, overrideEmail?: string, overrideToken?: string, projectFilter?: string
): Promise<{ data: JiraIssue[]; isDemo: boolean; error?: string }> {
  const rawAuth = getAuth(overrideDomain, overrideEmail, overrideToken);
  if (!rawAuth) return { data: [], isDemo: false };

  const auth = await resolveAuth(rawAuth);
  const base = jiraBase(auth);
  const allIssues: JiraIssue[] = [];
  let startAt = 0;
  const jqlStr = buildJiraJql(projectFilter);
  let lastError: string | null = null;
  const fields = ["summary", "description", "status", "issuetype", "priority", "assignee", "reporter", "labels", "created", "updated", "project", "resolution"];

  while (allIssues.length < MAX_RESULTS) {
    let result: Record<string, unknown> | null = null;

    const { data: postData, error: postError } = await atlFetch(
      `${base}/search/jql`, auth, "POST",
      { jql: jqlStr, maxResults: PAGE_SIZE, startAt, fields }
    );
    if (!postError && postData) {
      result = postData as Record<string, unknown>;
    } else {
      const jql = encodeURIComponent(jqlStr);
      const { data: getData, error: getError } = await atlFetch(
        `${base}/search?jql=${jql}&maxResults=${PAGE_SIZE}&startAt=${startAt}&fields=${fields.join(",")}`, auth
      );
      if (getError) { lastError = getError; break; }
      if (getData) result = getData as Record<string, unknown>;
    }

    if (!result) break;
    const issues = result.issues as Record<string, unknown>[];
    if (!issues || issues.length === 0) break;

    for (const issue of issues) {
      const f = (issue.fields || {}) as Record<string, unknown>;
      allIssues.push({
        id: issue.id as string,
        key: issue.key as string,
        summary: (f.summary as string) || "",
        description: extractTextFromADF(f.description),
        status: ((f.status as Record<string, unknown>)?.name as string) || "Unknown",
        issueType: ((f.issuetype as Record<string, unknown>)?.name as string) || "Unknown",
        priority: ((f.priority as Record<string, unknown>)?.name as string) || "Medium",
        assignee: ((f.assignee as Record<string, unknown>)?.displayName as string) || "Unassigned",
        reporter: ((f.reporter as Record<string, unknown>)?.displayName as string) || "",
        labels: (f.labels as string[]) || [],
        created: (f.created as string) || "",
        updated: (f.updated as string) || "",
        project: ((f.project as Record<string, unknown>)?.name as string) || ((f.project as Record<string, unknown>)?.key as string) || "",
        resolution: ((f.resolution as Record<string, unknown>)?.name as string) || "",
      });
    }

    const total = result.total as number;
    if (issues.length < PAGE_SIZE || allIssues.length >= (total || MAX_RESULTS)) break;
    startAt += PAGE_SIZE;
  }

  console.log(`Jira [${auth.useScoped ? "scoped" : "classic"}]: ${allIssues.length} issues${projectFilter ? ` (${projectFilter})` : ""}${lastError ? ` [err]` : ""}`);
  return { data: allIssues, isDemo: false, error: lastError || undefined };
}

export async function getConfluencePages(
  overrideDomain?: string, overrideEmail?: string, overrideToken?: string, spaceFilter?: string
): Promise<{ data: ConfluencePage[]; isDemo: boolean; error?: string }> {
  const rawAuth = getAuth(overrideDomain, overrideEmail, overrideToken);
  if (!rawAuth) return { data: [], isDemo: false };

  const auth = await resolveAuth(rawAuth);
  const v2Base = confluenceV2Base(auth);
  const spaces = parseFilterList(spaceFilter);
  const allPages: ConfluencePage[] = [];
  let lastError: string | null = null;

  let spaceIdMap: Record<string, string> = {};
  if (spaces.length > 0) {
    const { data: spacesData } = await atlFetch(`${v2Base}/spaces?limit=200`, auth);
    if (spacesData) {
      const results = ((spacesData as Record<string, unknown>).results || []) as Record<string, unknown>[];
      for (const s of results) {
        const key = ((s.key as string) || "").toUpperCase();
        const name = ((s.name as string) || "").toLowerCase();
        const id = String(s.id || "");
        if (id) {
          spaceIdMap[key] = id;
          spaceIdMap[name] = id;
        }
      }
    }
  }

  async function fetchV2Pages(spaceId?: string) {
    let cursor: string | null = null;
    const spaceParam = spaceId ? `&space-id=${spaceId}` : "";
    let page = 0;
    while (allPages.length < 500 && page < 20) {
      const cursorParam = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
      const { data, error } = await atlFetch(
        `${v2Base}/pages?limit=50&sort=-modified-date${spaceParam}${cursorParam}&body-format=storage`,
        auth
      );
      if (error) { lastError = error; return false; }
      const result = data as Record<string, unknown>;
      const results = (result.results || []) as Record<string, unknown>[];
      if (results.length === 0) break;

      for (const p of results) {
        const bodyObj = p.body as Record<string, unknown> | undefined;
        const storageObj = bodyObj?.storage as Record<string, unknown> | undefined;
        const rawBody = (storageObj?.value as string) || "";
        const excerpt = rawBody.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
        const spaceRef = p.spaceId as string || "";
        const version = p.version as Record<string, unknown> | undefined;

        allPages.push({
          id: String(p.id || ""),
          title: (p.title as string) || "Untitled",
          excerpt,
          space: spaceRef,
          lastModified: (version?.createdAt as string) || (p.createdAt as string) || "",
          author: ((version?.authorId as string) || ""),
          url: `https://${auth.domain}.atlassian.net/wiki${((p._links as Record<string, unknown>)?.webui as string) || ""}`,
        });
      }

      const links = result._links as Record<string, unknown> | undefined;
      const nextLink = links?.next as string | undefined;
      if (nextLink) {
        const match = nextLink.match(/cursor=([^&]+)/);
        cursor = match ? decodeURIComponent(match[1]) : null;
      } else {
        break;
      }
      page++;
    }
    return true;
  }

  if (spaces.length > 0) {
    for (const space of spaces) {
      const upper = space.toUpperCase();
      const lower = space.toLowerCase();
      const spaceId = spaceIdMap[upper] || spaceIdMap[lower];
      if (spaceId) {
        await fetchV2Pages(spaceId);
      } else {
        const ok = await fetchV2Pages();
        if (ok && allPages.length > 0) {
          const filtered = allPages.filter((p) =>
            p.space.toUpperCase() === upper || p.space.toLowerCase() === lower
          );
          allPages.length = 0;
          allPages.push(...filtered);
        }
      }
    }
  } else {
    await fetchV2Pages();
  }

  console.log(`Confluence [${auth.useScoped ? "scoped" : "classic"}]: ${allPages.length} pages${spaceFilter ? ` (${spaceFilter})` : ""}${lastError ? ` [err]` : ""}`);
  return { data: allPages, isDemo: false, error: lastError || undefined };
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

export function isAtlassianConfigured(d?: string, e?: string, t?: string): boolean {
  return !!getAuth(d, e, t);
}

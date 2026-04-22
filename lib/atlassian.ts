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

const VALID_DOMAIN_SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/i;

function normalizeDomain(raw: string): string | null {
  const slug = raw
    .replace(/^https?:\/\//, "")
    .replace(/\.atlassian\.net\/?$/, "")
    .trim()
    .toLowerCase();
  if (!VALID_DOMAIN_SLUG.test(slug)) return null;
  return slug;
}

function getAuth(d?: string, e?: string, t?: string): AtlassianAuth | null {
  const domain = d || process.env.ATLASSIAN_DOMAIN;
  const email = e || process.env.ATLASSIAN_EMAIL;
  const token = t || process.env.ATLASSIAN_API_TOKEN;
  if (!domain || !email || !token) return null;
  const slug = normalizeDomain(domain);
  if (!slug) return null;
  return { domain: slug, email, token };
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
    const r = await fetch(`https://${auth.domain}.atlassian.net/_edge/tenant_info`);
    if (r.ok) cloudId = ((await r.json()) as Record<string, string>).cloudId || null;
  } catch { /* ignore */ }

  const classicOk = await fetch(`https://${auth.domain}.atlassian.net/rest/api/3/myself`, {
    headers: { Authorization: basicAuthHeader(auth), Accept: "application/json" },
  }).then((r) => r.ok).catch(() => false);

  let useScoped = false;
  if (!classicOk && cloudId) {
    const scopedOk = await fetch(`https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/myself`, {
      headers: { Authorization: basicAuthHeader(auth), Accept: "application/json" },
    }).then((r) => r.ok).catch(() => false);
    useScoped = scopedOk;
  }

  const resolved: ResolvedAuth = { ...auth, cloudId, useScoped };
  resolvedAuthCache.set(cacheKey, resolved);
  console.log(`Atlassian auth: ${useScoped ? "scoped" : "classic"} for ${auth.domain}${cloudId ? ` (cloud: ${cloudId})` : ""}`);
  return resolved;
}

function classicJiraBase(domain: string): string {
  return `https://${domain}.atlassian.net/rest/api/3`;
}

function scopedJiraBase(cloudId: string): string {
  return `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3`;
}

function jiraBases(auth: ResolvedAuth): string[] {
  const bases: string[] = [];
  if (auth.useScoped && auth.cloudId) {
    bases.push(scopedJiraBase(auth.cloudId));
    bases.push(classicJiraBase(auth.domain));
  } else {
    bases.push(classicJiraBase(auth.domain));
    if (auth.cloudId) bases.push(scopedJiraBase(auth.cloudId));
  }
  return bases;
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
  return text.replace(/[A-Za-z0-9+/=]{20,}/g, "[REDACTED]").replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]").replace(/Basic\s+\S+/gi, "Basic [REDACTED]").slice(0, 200);
}

const ATLASSIAN_FETCH_TIMEOUT_MS = 20_000;

async function atlFetch(url: string, auth: ResolvedAuth, method = "GET", body?: unknown): Promise<{ data: unknown; error: string | null; status?: number }> {
  try {
    const opts: RequestInit = {
      method,
      headers: { Authorization: basicAuthHeader(auth), Accept: "application/json", "Content-Type": "application/json" },
      signal: AbortSignal.timeout(ATLASSIAN_FETCH_TIMEOUT_MS),
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    if (!res.ok) {
      const raw = await res.text().catch(() => "");
      let hint = "";
      if (res.status === 401 || res.status === 403) hint = " — Check token permissions/scopes.";
      if (res.status === 410) hint = " — Endpoint deprecated.";
      return { data: null, error: `${res.status} ${res.statusText}${hint} — ${sanitizeErrorBody(raw)}`, status: res.status };
    }
    return { data: await res.json(), error: null, status: res.status };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : "Connection failed" };
  }
}

async function jiraSearchPage(
  auth: ResolvedAuth, jqlStr: string, pageSize: number, fields: string[], pageToken?: string
): Promise<{ data: unknown; error: string | null }> {
  const bases = jiraBases(auth);
  const jqlEncoded = encodeURIComponent(jqlStr);
  const fieldStr = fields.join(",");
  const errors: string[] = [];

  const tokenParam = pageToken ? `&nextPageToken=${encodeURIComponent(pageToken)}` : "";

  const attempts: { url: string; method: "GET" | "POST"; body?: unknown; label: string }[] = [];

  for (const b of bases) {
    attempts.push({ url: `${b}/search/jql?jql=${jqlEncoded}&maxResults=${pageSize}&fields=${fieldStr}${tokenParam}`, method: "GET", label: "v3 GET /search/jql" });
  }
  for (const b of bases) {
    const startAt = 0;
    attempts.push({ url: `${b}/search?jql=${jqlEncoded}&maxResults=${pageSize}&startAt=${startAt}&fields=${fieldStr}`, method: "GET", label: "v3 GET /search (legacy)" });
  }

  for (const attempt of attempts) {
    const { data, error } = await atlFetch(attempt.url, auth, attempt.method, attempt.body);
    if (!error && data) {
      if (!jiraSearchEndpoint) {
        jiraSearchEndpoint = attempt.label;
        console.log(`Jira: using ${attempt.label}`);
      }
      return { data, error: null };
    }
    if (error) errors.push(`${attempt.label}: ${error.slice(0, 60)}`);
  }

  return { data: null, error: `Jira search failed. ${errors.slice(-2).join("; ").slice(0, 150)}` };
}

let jiraSearchEndpoint: string | null = null;

function parseFilterList(filter: string | undefined): string[] {
  if (!filter) return [];
  return filter.split(/[,;\n]+/).map((s) => s.trim()).filter((s) => s.length > 0);
}

function buildJiraJql(projectFilter: string | undefined): string {
  const conditions: string[] = [];
  const projects = parseFilterList(projectFilter);
  if (projects.length > 0) {
    const quoted = projects.map((p) => {
      const upper = p.trim().toUpperCase();
      return /^[A-Z][A-Z0-9_]+$/.test(upper) ? upper : `"${p.trim().replace(/"/g, '\\"')}"`;
    });
    conditions.push(`project IN (${quoted.join(", ")})`);
  }
  return `${conditions.length > 0 ? conditions.join(" AND ") + " " : ""}ORDER BY updated DESC`;
}

export async function getJiraProjects(
  d?: string, e?: string, t?: string
): Promise<{ key: string; name: string }[]> {
  const rawAuth = getAuth(d, e, t);
  if (!rawAuth) return [];
  const auth = await resolveAuth(rawAuth);

  for (const base of jiraBases(auth)) {
    for (const path of ["/project/search?maxResults=200&orderBy=name", "/project?maxResults=200"]) {
      const { data } = await atlFetch(`${base}${path}`, auth);
      if (data) {
        const result = data as Record<string, unknown>;
        const arr = (result.values || (Array.isArray(result) ? result : null)) as Record<string, unknown>[] | null;
        if (arr && Array.isArray(arr)) {
          const projects = arr.map((p) => ({ key: (p.key as string) || "", name: (p.name as string) || "" })).filter((p) => p.key);
          if (projects.length > 0) return projects;
        }
      }
    }
  }
  return [];
}

export async function getConfluenceSpaces(
  d?: string, e?: string, t?: string
): Promise<{ key: string; name: string }[]> {
  const rawAuth = getAuth(d, e, t);
  if (!rawAuth) return [];
  const auth = await resolveAuth(rawAuth);

  const { data } = await atlFetch(`${confluenceV2Base(auth)}/spaces?limit=200&sort=name`, auth);
  if (data) {
    const results = ((data as Record<string, unknown>).results || []) as Record<string, unknown>[];
    const spaces = results.map((s) => ({ key: (s.key as string) || "", name: (s.name as string) || "" })).filter((s) => s.key);
    if (spaces.length > 0) return spaces;
  }

  const { data: v1 } = await atlFetch(`${confluenceV1Base(auth)}/space?limit=200`, auth);
  if (v1) {
    const results = ((v1 as Record<string, unknown>).results || []) as Record<string, unknown>[];
    return results.map((s) => ({ key: (s.key as string) || "", name: (s.name as string) || "" })).filter((s) => s.key);
  }
  return [];
}

function parseIssue(issue: Record<string, unknown>): JiraIssue {
  const f = (issue.fields || {}) as Record<string, unknown>;
  return {
    id: (issue.id as string) || "", key: (issue.key as string) || "",
    summary: (f.summary as string) || "",
    description: extractTextFromADF(f.description),
    status: ((f.status as Record<string, unknown>)?.name as string) || "Unknown",
    issueType: ((f.issuetype as Record<string, unknown>)?.name as string) || "Unknown",
    priority: ((f.priority as Record<string, unknown>)?.name as string) || "Medium",
    assignee: ((f.assignee as Record<string, unknown>)?.displayName as string) || "Unassigned",
    reporter: ((f.reporter as Record<string, unknown>)?.displayName as string) || "",
    labels: (f.labels as string[]) || [],
    created: (f.created as string) || "", updated: (f.updated as string) || "",
    project: ((f.project as Record<string, unknown>)?.name as string) || ((f.project as Record<string, unknown>)?.key as string) || "",
    resolution: ((f.resolution as Record<string, unknown>)?.name as string) || "",
  };
}

export async function getJiraIssues(
  d?: string, e?: string, t?: string, projectFilter?: string
): Promise<{ data: JiraIssue[]; isDemo: boolean; error?: string }> {
  const rawAuth = getAuth(d, e, t);
  if (!rawAuth) return { data: [], isDemo: false };

  const auth = await resolveAuth(rawAuth);
  const allIssues: JiraIssue[] = [];
  const jqlStr = buildJiraJql(projectFilter);
  let lastError: string | null = null;
  const fields = ["summary", "description", "status", "issuetype", "priority", "assignee", "reporter", "labels", "created", "updated", "project", "resolution"];
  let pageToken: string | undefined;
  let pageCount = 0;

  while (allIssues.length < MAX_RESULTS && pageCount < 20) {
    const { data, error } = await jiraSearchPage(auth, jqlStr, PAGE_SIZE, fields, pageToken);
    if (error) { lastError = error; break; }
    if (!data) break;

    const result = data as Record<string, unknown>;
    const issues = (result.issues || []) as Record<string, unknown>[];
    if (issues.length === 0) break;

    for (const issue of issues) allIssues.push(parseIssue(issue));

    const nextToken = result.nextPageToken as string | undefined;
    if (nextToken && issues.length >= PAGE_SIZE) {
      pageToken = nextToken;
    } else {
      const total = result.total as number | undefined;
      if (total && allIssues.length < total && issues.length >= PAGE_SIZE) {
        pageToken = undefined;
        break;
      }
      break;
    }
    pageCount++;
  }

  console.log(`Jira: ${allIssues.length} issues${projectFilter ? ` (${projectFilter})` : ""}${lastError ? " [err]" : ""}`);
  return { data: allIssues, isDemo: false, error: lastError || undefined };
}

export async function getConfluencePages(
  d?: string, e?: string, t?: string, spaceFilter?: string
): Promise<{ data: ConfluencePage[]; isDemo: boolean; error?: string }> {
  const rawAuth = getAuth(d, e, t);
  if (!rawAuth) return { data: [], isDemo: false };

  const auth = await resolveAuth(rawAuth);
  const v2Base = confluenceV2Base(auth);
  const spaces = parseFilterList(spaceFilter);
  const allPages: ConfluencePage[] = [];
  let lastError: string | null = null;

  let spaceIdMap: Record<string, string> = {};
  if (spaces.length > 0) {
    const { data } = await atlFetch(`${v2Base}/spaces?limit=200`, auth);
    if (data) {
      for (const s of ((data as Record<string, unknown>).results || []) as Record<string, unknown>[]) {
        const key = ((s.key as string) || "").toUpperCase();
        const name = ((s.name as string) || "").toLowerCase();
        const id = String(s.id || "");
        if (id) { spaceIdMap[key] = id; spaceIdMap[name] = id; }
      }
    }
  }

  async function fetchPages(spaceId?: string) {
    let cursor: string | null = null;
    const sp = spaceId ? `&space-id=${spaceId}` : "";
    for (let page = 0; allPages.length < 500 && page < 20; page++) {
      const cp = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
      const { data, error } = await atlFetch(`${v2Base}/pages?limit=50&sort=-modified-date${sp}${cp}&body-format=storage`, auth);
      if (error) { lastError = error; return; }
      const results = ((data as Record<string, unknown>)?.results || []) as Record<string, unknown>[];
      if (results.length === 0) break;
      for (const p of results) addPage(allPages, p, auth.domain);
      const next = ((data as Record<string, unknown>)?._links as Record<string, unknown>)?.next as string | undefined;
      if (next) { const m = next.match(/cursor=([^&]+)/); cursor = m ? decodeURIComponent(m[1]) : null; }
      else break;
    }
  }

  if (spaces.length > 0) {
    for (const space of spaces) {
      const id = spaceIdMap[space.toUpperCase()] || spaceIdMap[space.toLowerCase()];
      if (id) await fetchPages(id);
      else await fetchPages();
    }
  } else {
    await fetchPages();
  }

  console.log(`Confluence: ${allPages.length} pages${spaceFilter ? ` (${spaceFilter})` : ""}${lastError ? " [err]" : ""}`);
  return { data: allPages, isDemo: false, error: lastError || undefined };
}

function addPage(pages: ConfluencePage[], p: Record<string, unknown>, domain: string) {
  const bodyVal = ((p.body as Record<string, unknown>)?.storage as Record<string, unknown>)?.value as string || "";
  const excerpt = bodyVal.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
  const space = p.spaceId as string || "";
  const version = p.version as Record<string, unknown> | undefined;
  pages.push({
    id: String(p.id || ""), title: (p.title as string) || "Untitled", excerpt, space,
    lastModified: (version?.createdAt as string) || (p.createdAt as string) || "",
    author: (version?.authorId as string) || "",
    url: `https://${domain}.atlassian.net/wiki${((p._links as Record<string, unknown>)?.webui as string) || ""}`,
  });
}

function extractTextFromADF(adf: unknown): string {
  if (!adf || typeof adf === "string") return (adf as string) || "";
  if (typeof adf !== "object") return "";
  const node = adf as Record<string, unknown>;
  if (node.type === "text" && typeof node.text === "string") return node.text;
  let text = "";
  if (Array.isArray(node.content)) for (const c of node.content) text += extractTextFromADF(c) + " ";
  return text.trim();
}

export async function createJiraIssue(
  summary: string,
  description: Record<string, unknown>,
  projectKey: string,
  issueType = "Task",
  priority?: string,
  d?: string,
  e?: string,
  t?: string
): Promise<{ id: string; key: string; url: string }> {
  const rawAuth = getAuth(d, e, t);
  if (!rawAuth) throw new Error("Atlassian credentials not configured");

  const auth = await resolveAuth(rawAuth);
  const bases = jiraBases(auth);

  const body = {
    fields: {
      project: { key: projectKey },
      summary,
      description,
      issuetype: { name: issueType },
      ...(priority ? { priority: { name: priority } } : {}),
    },
  };

  for (const base of bases) {
    const { data, error } = await atlFetch(`${base}/issue`, auth, "POST", body);
    if (data && !error) {
      const result = data as Record<string, unknown>;
      const key = (result.key as string) || "";
      const id = (result.id as string) || "";
      const url = `https://${auth.domain}.atlassian.net/browse/${key}`;
      return { id, key, url };
    }
  }

  throw new Error("Failed to create Jira issue across all API endpoints");
}

export async function createConfluencePage(
  title: string,
  spaceId: string,
  body: string,
  d?: string,
  e?: string,
  t?: string
): Promise<{ id: string; url: string }> {
  const rawAuth = getAuth(d, e, t);
  if (!rawAuth) throw new Error("Atlassian credentials not configured");

  const auth = await resolveAuth(rawAuth);
  const base = confluenceV2Base(auth);

  const payload = {
    spaceId,
    status: "current",
    title,
    body: {
      representation: "storage",
      value: body,
    },
  };

  const { data, error } = await atlFetch(`${base}/pages`, auth, "POST", payload);
  if (error || !data) {
    throw new Error(`Failed to create Confluence page: ${error || "No response"}`);
  }

  const result = data as Record<string, unknown>;
  const id = String(result.id || "");
  const webui = ((result._links as Record<string, unknown>)?.webui as string) || "";
  const url = `https://${auth.domain}.atlassian.net/wiki${webui}`;

  return { id, url };
}

export function isAtlassianConfigured(d?: string, e?: string, t?: string): boolean {
  return !!getAuth(d, e, t);
}

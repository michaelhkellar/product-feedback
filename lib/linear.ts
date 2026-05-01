import { CreateTicketResult } from "./ticket-provider";
import { LinearIssue, FeedbackItem, ProductboardFeature } from "./types";

const API_URL = "https://api.linear.app/graphql";
const MAX_ISSUES = 1000;

export const DEMO_LINEAR_ISSUES: LinearIssue[] = [
  { id: "li-1", identifier: "ENG-101", title: "Refactor authentication middleware", description: "Break out JWT validation and session refresh into separate modules for easier testing.", status: "In Progress", priority: "High", assignee: "Alice Chen", labels: ["backend", "auth"], created: "2026-03-15T10:00:00Z", updated: "2026-04-10T14:00:00Z", team: "Platform", url: "https://linear.app/demo/issue/ENG-101" },
  { id: "li-2", identifier: "ENG-102", title: "Add rate limiting to public API endpoints", description: "Implement per-IP and per-key rate limiting to prevent abuse on /api/v2/* routes.", status: "Todo", priority: "High", assignee: "Bob Kim", labels: ["security", "api"], created: "2026-03-20T09:00:00Z", updated: "2026-04-08T11:00:00Z", team: "Platform", url: "https://linear.app/demo/issue/ENG-102" },
  { id: "li-3", identifier: "ENG-103", title: "Multi-region data residency support", description: "Allow enterprise customers to pin their data to EU or US regions. Required for GDPR compliance.", status: "In Review", priority: "Urgent", assignee: "Clara Santos", labels: ["infrastructure", "compliance"], created: "2026-02-28T08:00:00Z", updated: "2026-04-12T16:00:00Z", team: "Infrastructure", url: "https://linear.app/demo/issue/ENG-103" },
  { id: "li-4", identifier: "ENG-104", title: "SSO SAML 2.0 integration improvements", description: "Fix edge cases where IdP-initiated SSO fails for Okta and Azure AD customers.", status: "In Progress", priority: "High", assignee: "Alice Chen", labels: ["auth", "enterprise"], created: "2026-03-01T07:00:00Z", updated: "2026-04-14T10:00:00Z", team: "Platform", url: "https://linear.app/demo/issue/ENG-104" },
  { id: "li-5", identifier: "ENG-105", title: "Webhook delivery reliability improvements", description: "Implement exponential backoff and dead-letter queue for failed webhook deliveries.", status: "Todo", priority: "Medium", assignee: "David Park", labels: ["reliability", "integrations"], created: "2026-03-10T11:00:00Z", updated: "2026-04-05T09:00:00Z", team: "Integrations", url: "https://linear.app/demo/issue/ENG-105" },
  { id: "li-6", identifier: "ENG-106", title: "Improve detection rule performance for large tenants", description: "Query planner optimisation for tenants with >100k events/day — current P99 is 8s.", status: "In Progress", priority: "High", assignee: "Eva Nguyen", labels: ["performance", "detections"], created: "2026-03-18T13:00:00Z", updated: "2026-04-11T17:00:00Z", team: "Core", url: "https://linear.app/demo/issue/ENG-106" },
  { id: "li-7", identifier: "ENG-107", title: "MSP multi-tenancy: parent-child account hierarchy", description: "Enable MSP partner accounts to manage sub-tenant configurations from a single pane.", status: "In Review", priority: "Urgent", assignee: "Frank Lee", labels: ["msp", "enterprise"], created: "2026-02-15T10:00:00Z", updated: "2026-04-13T15:00:00Z", team: "Enterprise", url: "https://linear.app/demo/issue/ENG-107" },
  { id: "li-8", identifier: "ENG-108", title: "CLI tooling for bulk rule import/export", description: "Allow security ops teams to manage detection rules via YAML config and CI/CD pipelines.", status: "Todo", priority: "Medium", assignee: "Grace Wu", labels: ["cli", "devops"], created: "2026-04-01T08:00:00Z", updated: "2026-04-09T10:00:00Z", team: "Platform", url: "https://linear.app/demo/issue/ENG-108" },
  { id: "li-9", identifier: "ENG-109", title: "Automated response playbook engine", description: "Allow customers to configure automatic containment actions triggered by high-confidence detections.", status: "In Progress", priority: "High", assignee: "Henry Zhao", labels: ["automation", "response"], created: "2026-03-05T12:00:00Z", updated: "2026-04-15T11:00:00Z", team: "Core", url: "https://linear.app/demo/issue/ENG-109" },
  { id: "li-10", identifier: "ENG-110", title: "Dashboard customisation: saved layouts", description: "Let users pin widgets, save custom views, and set a default dashboard per team.", status: "Todo", priority: "Low", assignee: "Unassigned", labels: ["ux", "dashboard"], created: "2026-04-05T09:00:00Z", updated: "2026-04-05T09:00:00Z", team: "Product", url: "https://linear.app/demo/issue/ENG-110" },
];

const PRIORITY_LABELS: Record<number, string> = {
  0: "No priority",
  1: "Urgent",
  2: "High",
  3: "Medium",
  4: "Low",
};

async function linearFetch<T>(
  apiKey: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`Linear API ${res.status}`);
  }

  const json = await res.json();
  if (json.errors) {
    throw new Error(`Linear API error (${json.errors.length} error${json.errors.length === 1 ? "" : "s"})`);
  }

  return json.data as T;
}

export function isLinearConfigured(overrideKey?: string): boolean {
  return !!(overrideKey || process.env.LINEAR_API_KEY);
}

export async function getLinearTeams(
  overrideKey?: string
): Promise<{ id: string; name: string; key: string }[]> {
  const apiKey = overrideKey || process.env.LINEAR_API_KEY;
  if (!apiKey) return [];

  try {
    const data = await linearFetch<{
      teams: { nodes: { id: string; name: string; key: string }[] };
    }>(apiKey, `query { teams { nodes { id name key } } }`);
    return data.teams.nodes;
  } catch (error) {
    console.error("Failed to fetch Linear teams:", error);
    return [];
  }
}

/**
 * Parse the `teamId` arg into an array of trimmed, non-empty IDs.
 * Accepts either a single ID, or a comma-separated list (the multi-select UI
 * stores the chosen team IDs as a comma-separated string in the same field).
 * Empty / undefined → empty array (= no team filter, fetch all teams).
 */
function parseTeamIds(raw?: string): string[] {
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export async function getLinearIssues(
  overrideKey?: string,
  teamId?: string,
  useDemoFallback?: boolean
): Promise<{ data: LinearIssue[]; isDemo: boolean }> {
  const apiKey = overrideKey || process.env.LINEAR_API_KEY;
  if (!apiKey) {
    if (useDemoFallback) return { data: DEMO_LINEAR_ISSUES, isDemo: true };
    return { data: [], isDemo: false };
  }

  const teamIds = parseTeamIds(teamId);
  const allIssues: LinearIssue[] = [];
  let cursor: string | null = null;

  type IssuesPage = {
    issues: {
      nodes: {
        id: string;
        identifier: string;
        title: string;
        description: string | null;
        state: { name: string } | null;
        priority: number;
        assignee: { name: string } | null;
        labels: { nodes: { name: string }[] };
        createdAt: string;
        updatedAt: string;
        team: { name: string } | null;
        url: string;
      }[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  };

  try {
    for (let page = 0; allIssues.length < MAX_ISSUES && page < 5; page++) {
      const variables: Record<string, unknown> = { after: cursor };

      // Pick the simplest query that satisfies the selection:
      //   - 0 team IDs → no filter (fastest path)
      //   - 1 team ID  → `id: { eq }`
      //   - 2+ IDs     → `id: { in }` (Linear's filter spec supports this)
      let query: string;
      if (teamIds.length === 0) {
        query = `query Issues($after: String) {
          issues(first: 250, orderBy: updatedAt, after: $after) {
            nodes { id identifier title description state { name } priority assignee { name } labels { nodes { name } } createdAt updatedAt team { name } url }
            pageInfo { hasNextPage endCursor }
          }
        }`;
      } else if (teamIds.length === 1) {
        variables.teamId = teamIds[0];
        query = `query IssuesFiltered($after: String, $teamId: ID!) {
          issues(first: 250, orderBy: updatedAt, after: $after, filter: { team: { id: { eq: $teamId } } }) {
            nodes { id identifier title description state { name } priority assignee { name } labels { nodes { name } } createdAt updatedAt team { name } url }
            pageInfo { hasNextPage endCursor }
          }
        }`;
      } else {
        variables.teamIds = teamIds;
        query = `query IssuesFiltered($after: String, $teamIds: [ID!]!) {
          issues(first: 250, orderBy: updatedAt, after: $after, filter: { team: { id: { in: $teamIds } } }) {
            nodes { id identifier title description state { name } priority assignee { name } labels { nodes { name } } createdAt updatedAt team { name } url }
            pageInfo { hasNextPage endCursor }
          }
        }`;
      }

      const data: IssuesPage = await linearFetch<IssuesPage>(apiKey, query, variables);

      for (const node of data.issues.nodes) {
        allIssues.push({
          id: node.id,
          identifier: node.identifier,
          title: node.title,
          description: node.description || "",
          status: node.state?.name || "Unknown",
          priority: PRIORITY_LABELS[node.priority] || "Unknown",
          assignee: node.assignee?.name || "Unassigned",
          labels: node.labels.nodes.map((l) => l.name),
          created: node.createdAt,
          updated: node.updatedAt,
          team: node.team?.name || "",
          url: node.url,
        });
      }

      if (!data.issues.pageInfo.hasNextPage || !data.issues.pageInfo.endCursor) break;
      cursor = data.issues.pageInfo.endCursor;
    }

    return { data: allIssues, isDemo: false };
  } catch (error) {
    console.error("Failed to fetch Linear issues:", error);
    return { data: [], isDemo: false };
  }
}

export async function createLinearIssue(
  title: string,
  description: string,
  teamId: string,
  overrideKey?: string,
  priority?: number
): Promise<CreateTicketResult> {
  const apiKey = overrideKey || process.env.LINEAR_API_KEY;
  if (!apiKey) throw new Error("Linear API key not configured");

  const data = await linearFetch<{
    issueCreate: {
      success: boolean;
      issue: { id: string; identifier: string; url: string };
    };
  }>(
    apiKey,
    `mutation CreateIssue($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue { id identifier url }
      }
    }`,
    {
      input: {
        title,
        description,
        teamId,
        ...(priority != null ? { priority } : {}),
      },
    }
  );

  if (!data.issueCreate.success) {
    throw new Error("Linear issue creation failed");
  }

  return {
    id: data.issueCreate.issue.id,
    key: data.issueCreate.issue.identifier,
    url: data.issueCreate.issue.url,
  };
}

export async function validateLinearKey(overrideKey?: string): Promise<boolean> {
  const apiKey = overrideKey || process.env.LINEAR_API_KEY;
  if (!apiKey) return false;

  try {
    await linearFetch(apiKey, `query { viewer { id } }`);
    return true;
  } catch {
    return false;
  }
}

const FEATURE_LABELS = ["feature", "epic", "roadmap", "enhancement", "improvement"];
const FEEDBACK_LABELS = ["customer-request", "feedback", "bug", "support", "user-request", "cx"];

export function isFeatureIssue(i: LinearIssue): boolean {
  const labels = i.labels.map((l) => l.toLowerCase());
  return labels.some((l) => FEATURE_LABELS.some((f) => l.includes(f)));
}

export function isFeedbackIssue(i: LinearIssue): boolean {
  const labels = i.labels.map((l) => l.toLowerCase());
  return labels.some((l) => FEEDBACK_LABELS.some((f) => l.includes(f)));
}

function mapLinearPriorityToFeedback(p: string): FeedbackItem["priority"] {
  switch (p) {
    case "Urgent": return "critical";
    case "High": return "high";
    case "Medium": return "medium";
    default: return "low";
  }
}

function mapLinearStatusToFeature(s: string): ProductboardFeature["status"] {
  const v = s.toLowerCase();
  if (v.includes("done") || v.includes("complete") || v.includes("closed")) return "done";
  if (v.includes("progress") || v.includes("started")) return "in_progress";
  if (v.includes("backlog") || v.includes("todo") || v.includes("triage")) return "new";
  return "planned";
}

export function linearToFeedback(i: LinearIssue): FeedbackItem {
  return {
    id: `linear-${i.id}`,
    source: "linear",
    title: i.title,
    content: i.description ?? "",
    customer: i.assignee || "Unknown",
    sentiment: "neutral",
    themes: i.labels,
    date: i.created,
    priority: mapLinearPriorityToFeedback(i.priority),
    metadata: { linearId: i.identifier, status: i.status, url: i.url },
  };
}

export function linearToFeature(i: LinearIssue): ProductboardFeature {
  return {
    id: `linear-${i.id}`,
    name: i.title,
    description: i.description ?? "",
    status: mapLinearStatusToFeature(i.status),
    votes: 0,
    customerRequests: 0,
    themes: i.labels,
  };
}

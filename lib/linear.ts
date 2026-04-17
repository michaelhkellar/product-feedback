import { CreateTicketResult } from "./ticket-provider";
import { LinearIssue } from "./types";

const API_URL = "https://api.linear.app/graphql";
const MAX_ISSUES = 1000;

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

export async function getLinearIssues(
  overrideKey?: string,
  teamId?: string
): Promise<LinearIssue[]> {
  const apiKey = overrideKey || process.env.LINEAR_API_KEY;
  if (!apiKey) return [];

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
      if (teamId) variables.teamId = teamId;

      const query = teamId
        ? `query IssuesFiltered($after: String, $teamId: ID!) {
            issues(first: 250, orderBy: updatedAt, after: $after, filter: { team: { id: { eq: $teamId } } }) {
              nodes { id identifier title description state { name } priority assignee { name } labels { nodes { name } } createdAt updatedAt team { name } url }
              pageInfo { hasNextPage endCursor }
            }
          }`
        : `query Issues($after: String) {
            issues(first: 250, orderBy: updatedAt, after: $after) {
              nodes { id identifier title description state { name } priority assignee { name } labels { nodes { name } } createdAt updatedAt team { name } url }
              pageInfo { hasNextPage endCursor }
            }
          }`;

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

    return allIssues;
  } catch (error) {
    console.error("Failed to fetch Linear issues:", error);
    return [];
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

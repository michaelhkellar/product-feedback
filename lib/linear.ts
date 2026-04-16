import { CreateTicketResult } from "./ticket-provider";

const API_URL = "https://api.linear.app/graphql";

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
    const text = await res.text().catch(() => "");
    throw new Error(`Linear API ${res.status}: ${text || res.statusText}`);
  }

  const json = await res.json();
  if (json.errors) {
    throw new Error(`Linear API: ${json.errors.map((e: { message: string }) => e.message).join(", ")}`);
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

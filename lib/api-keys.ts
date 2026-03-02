export interface ApiKeyState {
  geminiKey: string;
  productboardKey: string;
  attentionKey: string;
  atlassianDomain: string;
  atlassianEmail: string;
  atlassianToken: string;
  atlassianJiraFilter: string;
  atlassianConfluenceFilter: string;
}

export interface ApiKeyStatus {
  geminiKey: { configured: boolean; source: "app" | "env" | null };
  productboardKey: { configured: boolean; source: "app" | "env" | null };
  attentionKey: { configured: boolean; source: "app" | "env" | null };
  atlassianKey: { configured: boolean; source: "app" | "env" | null };
}

const STORAGE_KEY = "feedback-agent-api-keys";

const EMPTY_KEYS: ApiKeyState = {
  geminiKey: "",
  productboardKey: "",
  attentionKey: "",
  atlassianDomain: "",
  atlassianEmail: "",
  atlassianToken: "",
  atlassianJiraFilter: "",
  atlassianConfluenceFilter: "",
};

export function loadKeys(): ApiKeyState {
  if (typeof window === "undefined") return { ...EMPTY_KEYS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY_KEYS };
    const parsed = JSON.parse(raw);
    return {
      geminiKey: parsed.geminiKey || "",
      productboardKey: parsed.productboardKey || "",
      attentionKey: parsed.attentionKey || "",
      atlassianDomain: parsed.atlassianDomain || "",
      atlassianEmail: parsed.atlassianEmail || "",
      atlassianToken: parsed.atlassianToken || "",
      atlassianJiraFilter: parsed.atlassianJiraFilter || "",
      atlassianConfluenceFilter: parsed.atlassianConfluenceFilter || "",
    };
  } catch {
    return { ...EMPTY_KEYS };
  }
}

export function saveKeys(keys: ApiKeyState): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
}

export function clearKeys(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

export function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";
  return key.slice(0, 4) + "\u2022\u2022\u2022\u2022" + key.slice(-4);
}

export function buildKeyHeaders(keys: ApiKeyState): Record<string, string> {
  const headers: Record<string, string> = {};
  if (keys.geminiKey) headers["x-gemini-key"] = keys.geminiKey;
  if (keys.productboardKey) headers["x-productboard-key"] = keys.productboardKey;
  if (keys.attentionKey) headers["x-attention-key"] = keys.attentionKey;
  if (keys.atlassianDomain) headers["x-atlassian-domain"] = keys.atlassianDomain;
  if (keys.atlassianEmail) headers["x-atlassian-email"] = keys.atlassianEmail;
  if (keys.atlassianToken) headers["x-atlassian-token"] = keys.atlassianToken;
  if (keys.atlassianJiraFilter) headers["x-atlassian-jira-filter"] = keys.atlassianJiraFilter;
  if (keys.atlassianConfluenceFilter) headers["x-atlassian-confluence-filter"] = keys.atlassianConfluenceFilter;
  return headers;
}

export function getKeyFromHeader(
  headers: Headers,
  headerName: string,
  envVar: string
): string | null {
  const fromHeader = headers.get(headerName);
  if (fromHeader) return fromHeader;
  const fromEnv = process.env[envVar];
  if (fromEnv) return fromEnv;
  return null;
}

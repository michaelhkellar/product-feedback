export interface ApiKeyState {
  geminiKey: string;
  productboardKey: string;
  attentionKey: string;
}

export interface ApiKeyStatus {
  geminiKey: { configured: boolean; source: "app" | "env" | null };
  productboardKey: { configured: boolean; source: "app" | "env" | null };
  attentionKey: { configured: boolean; source: "app" | "env" | null };
}

const STORAGE_KEY = "feedback-agent-api-keys";

export function loadKeys(): ApiKeyState {
  if (typeof window === "undefined") {
    return { geminiKey: "", productboardKey: "", attentionKey: "" };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { geminiKey: "", productboardKey: "", attentionKey: "" };
    const parsed = JSON.parse(raw);
    return {
      geminiKey: parsed.geminiKey || "",
      productboardKey: parsed.productboardKey || "",
      attentionKey: parsed.attentionKey || "",
    };
  } catch {
    return { geminiKey: "", productboardKey: "", attentionKey: "" };
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
  if (key.length <= 8) return "••••••••";
  return key.slice(0, 4) + "••••" + key.slice(-4);
}

export function buildKeyHeaders(keys: ApiKeyState): Record<string, string> {
  const headers: Record<string, string> = {};
  if (keys.geminiKey) headers["x-gemini-key"] = keys.geminiKey;
  if (keys.productboardKey) headers["x-productboard-key"] = keys.productboardKey;
  if (keys.attentionKey) headers["x-attention-key"] = keys.attentionKey;
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

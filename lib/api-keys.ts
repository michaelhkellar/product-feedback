import { AIProviderType } from "./ai-provider";

export type ContextMode = "focused" | "standard" | "deep";
export type AnalyticsProviderType = "pendo" | "amplitude" | "posthog";
export type TicketProviderType = "atlassian" | "linear";
export type CallProviderType = "attention" | "grain";

export interface ApiKeyState {
  geminiKey: string;
  productboardKey: string;
  attentionKey: string;
  pendoKey: string;
  atlassianDomain: string;
  atlassianEmail: string;
  atlassianToken: string;
  atlassianJiraFilter: string;
  atlassianConfluenceFilter: string;
  contextMode: ContextMode;
  aiProvider: AIProviderType;
  aiModel: string;
  anthropicKey: string;
  openaiKey: string;
  analyticsProvider: AnalyticsProviderType;
  amplitudeKey: string;
  ticketProvider: TicketProviderType;
  linearKey: string;
  posthogKey: string;
  posthogHost: string;
  linearTeamId: string;
  braveSearchKey: string;
  grainKey: string;
  callProvider: CallProviderType;
}

export interface ApiKeyStatus {
  geminiKey: { configured: boolean; source: "app" | "env" | null };
  productboardKey: { configured: boolean; source: "app" | "env" | null };
  attentionKey: { configured: boolean; source: "app" | "env" | null };
  pendoKey: { configured: boolean; source: "app" | "env" | null };
  atlassianKey: { configured: boolean; source: "app" | "env" | null };
  anthropicKey: { configured: boolean; source: "app" | "env" | null };
  openaiKey: { configured: boolean; source: "app" | "env" | null };
  amplitudeKey: { configured: boolean; source: "app" | "env" | null };
  linearKey: { configured: boolean; source: "app" | "env" | null };
  posthogKey: { configured: boolean; source: "app" | "env" | null };
  grainKey: { configured: boolean; source: "app" | "env" | null };
  braveSearchKey: { configured: boolean; source: "app" | "env" | null };
}

const LEGACY_STORAGE_KEY = "feedback-agent-api-keys";
const SECURE_DB_NAME = "feedback-agent-secure-storage";
const SECURE_DB_VERSION = 1;
const META_STORE = "meta";
const RECORD_STORE = "records";
const MASTER_KEY_ID = "master-key";
const KEY_RECORD_ID = "api-keys";

const EMPTY_KEYS: ApiKeyState = {
  geminiKey: "",
  productboardKey: "",
  attentionKey: "",
  pendoKey: "",
  atlassianDomain: "",
  atlassianEmail: "",
  atlassianToken: "",
  atlassianJiraFilter: "",
  atlassianConfluenceFilter: "",
  contextMode: "focused",
  aiProvider: "gemini",
  aiModel: "",
  anthropicKey: "",
  openaiKey: "",
  analyticsProvider: "pendo",
  amplitudeKey: "",
  ticketProvider: "atlassian",
  linearKey: "",
  posthogKey: "",
  posthogHost: "",
  linearTeamId: "",
  braveSearchKey: "",
  grainKey: "",
  callProvider: "attention",
};

interface EncryptedPayload {
  iv: string;
  cipherText: string;
}

function normalizeKeys(parsed: Partial<ApiKeyState> | null | undefined): ApiKeyState {
  return {
    geminiKey: parsed?.geminiKey || "",
    productboardKey: parsed?.productboardKey || "",
    attentionKey: parsed?.attentionKey || "",
    pendoKey: parsed?.pendoKey || "",
    atlassianDomain: parsed?.atlassianDomain || "",
    atlassianEmail: parsed?.atlassianEmail || "",
    atlassianToken: parsed?.atlassianToken || "",
    atlassianJiraFilter: parsed?.atlassianJiraFilter || "",
    atlassianConfluenceFilter: parsed?.atlassianConfluenceFilter || "",
    contextMode: parsed?.contextMode || "focused",
    aiProvider: (parsed?.aiProvider as ApiKeyState["aiProvider"]) || "gemini",
    aiModel: parsed?.aiModel || "",
    anthropicKey: parsed?.anthropicKey || "",
    openaiKey: parsed?.openaiKey || "",
    analyticsProvider: (parsed?.analyticsProvider as ApiKeyState["analyticsProvider"]) || "pendo",
    amplitudeKey: parsed?.amplitudeKey || "",
    ticketProvider: (parsed?.ticketProvider as ApiKeyState["ticketProvider"]) || "atlassian",
    linearKey: parsed?.linearKey || "",
    posthogKey: parsed?.posthogKey || "",
    posthogHost: parsed?.posthogHost || "",
    linearTeamId: parsed?.linearTeamId || "",
    braveSearchKey: parsed?.braveSearchKey || "",
    grainKey: parsed?.grainKey || "",
    callProvider: (parsed?.callProvider as CallProviderType) || "attention",
  };
}

export function isBraveConfigured(key?: string): boolean {
  return !!(key || process.env.BRAVE_SEARCH_KEY);
}

export function isGrainKeyConfigured(key?: string): boolean {
  return !!(key || process.env.GRAIN_API_KEY);
}

function hasStoredValues(keys: ApiKeyState): boolean {
  return !!(
    keys.geminiKey ||
    keys.productboardKey ||
    keys.attentionKey ||
    keys.pendoKey ||
    keys.atlassianDomain ||
    keys.atlassianEmail ||
    keys.atlassianToken ||
    keys.atlassianJiraFilter ||
    keys.atlassianConfluenceFilter ||
    keys.contextMode !== "focused" ||
    keys.aiProvider !== "gemini" ||
    keys.aiModel ||
    keys.anthropicKey ||
    keys.openaiKey ||
    keys.analyticsProvider !== "pendo" ||
    keys.amplitudeKey ||
    keys.ticketProvider !== "atlassian" ||
    keys.linearKey ||
    keys.posthogKey ||
    keys.linearTeamId
  );
}

function supportsSecureStorage(): boolean {
  return typeof window !== "undefined" && !!window.crypto?.subtle && !!window.indexedDB;
}

function loadLegacyKeys(): ApiKeyState {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return { ...EMPTY_KEYS };
    return normalizeKeys(JSON.parse(raw) as Partial<ApiKeyState>);
  } catch {
    return { ...EMPTY_KEYS };
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function openSecureDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(SECURE_DB_NAME, SECURE_DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
      if (!db.objectStoreNames.contains(RECORD_STORE)) db.createObjectStore(RECORD_STORE);
    };
    request.onsuccess = () => resolve(request.result);
  });
}

function withStore<T>(
  db: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const request = operation(store);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
  });
}

async function getStoredMasterKey(db: IDBDatabase): Promise<CryptoKey> {
  const existing = await withStore<CryptoKey>(db, META_STORE, "readonly", (store) => store.get(MASTER_KEY_ID));
  if (existing) return existing;

  const generated = await window.crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
  await withStore(db, META_STORE, "readwrite", (store) => store.put(generated, MASTER_KEY_ID));
  return generated;
}

async function encryptKeys(keys: ApiKeyState, key: CryptoKey): Promise<EncryptedPayload> {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(keys));
  const cipherBuffer = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(encoded)
  );
  return {
    iv: bytesToBase64(iv),
    cipherText: bytesToBase64(new Uint8Array(cipherBuffer)),
  };
}

async function decryptKeys(payload: EncryptedPayload, key: CryptoKey): Promise<ApiKeyState> {
  const iv = base64ToBytes(payload.iv);
  const cipherText = base64ToBytes(payload.cipherText);
  const plainBuffer = await window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(cipherText)
  );
  const json = new TextDecoder().decode(plainBuffer);
  try {
    return normalizeKeys(JSON.parse(json) as Partial<ApiKeyState>);
  } catch {
    return { ...EMPTY_KEYS };
  }
}

export async function loadKeys(): Promise<ApiKeyState> {
  if (typeof window === "undefined") return { ...EMPTY_KEYS };

  if (!supportsSecureStorage()) {
    return loadLegacyKeys();
  }

  try {
    const db = await openSecureDb();
    const encrypted = await withStore<EncryptedPayload>(
      db,
      RECORD_STORE,
      "readonly",
      (store) => store.get(KEY_RECORD_ID)
    );

    if (encrypted?.iv && encrypted?.cipherText) {
      const key = await getStoredMasterKey(db);
      return await decryptKeys(encrypted, key);
    }

    const legacy = loadLegacyKeys();
    if (hasStoredValues(legacy)) {
      await saveKeys(legacy);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    }
    return legacy;
  } catch {
    return loadLegacyKeys();
  }
}

export async function saveKeys(keys: ApiKeyState): Promise<void> {
  if (typeof window === "undefined") return;

  localStorage.removeItem(LEGACY_STORAGE_KEY);
  if (!supportsSecureStorage()) return;

  try {
    const db = await openSecureDb();
    if (!hasStoredValues(keys)) {
      await withStore(db, RECORD_STORE, "readwrite", (store) => store.delete(KEY_RECORD_ID));
      return;
    }

    const masterKey = await getStoredMasterKey(db);
    const encrypted = await encryptKeys(keys, masterKey);
    await withStore(db, RECORD_STORE, "readwrite", (store) => store.put(encrypted, KEY_RECORD_ID));
  } catch (error) {
    console.error("Failed to persist encrypted API keys:", error);
  }
}

export async function clearKeys(): Promise<void> {
  if (typeof window === "undefined") return;
  localStorage.removeItem(LEGACY_STORAGE_KEY);
  if (!supportsSecureStorage()) return;

  try {
    const db = await openSecureDb();
    await Promise.all([
      withStore(db, RECORD_STORE, "readwrite", (store) => store.delete(KEY_RECORD_ID)),
      withStore(db, META_STORE, "readwrite", (store) => store.delete(MASTER_KEY_ID)),
    ]);
  } catch (error) {
    console.error("Failed to clear encrypted API keys:", error);
  }
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
  if (keys.pendoKey) headers["x-pendo-integration-key"] = keys.pendoKey;
  if (keys.atlassianDomain) headers["x-atlassian-domain"] = keys.atlassianDomain;
  if (keys.atlassianEmail) headers["x-atlassian-email"] = keys.atlassianEmail;
  if (keys.atlassianToken) headers["x-atlassian-token"] = keys.atlassianToken;
  if (keys.atlassianJiraFilter) headers["x-atlassian-jira-filter"] = keys.atlassianJiraFilter;
  if (keys.atlassianConfluenceFilter) headers["x-atlassian-confluence-filter"] = keys.atlassianConfluenceFilter;
  if (keys.aiProvider) headers["x-ai-provider"] = keys.aiProvider;
  if (keys.aiModel) headers["x-ai-model"] = keys.aiModel;
  if (keys.anthropicKey) headers["x-anthropic-key"] = keys.anthropicKey;
  if (keys.openaiKey) headers["x-openai-key"] = keys.openaiKey;
  if (keys.analyticsProvider) headers["x-analytics-provider"] = keys.analyticsProvider;
  if (keys.amplitudeKey) headers["x-amplitude-key"] = keys.amplitudeKey;
  if (keys.ticketProvider) headers["x-ticket-provider"] = keys.ticketProvider;
  if (keys.linearKey) headers["x-linear-key"] = keys.linearKey;
  if (keys.posthogKey) headers["x-posthog-key"] = keys.posthogKey;
  if (keys.posthogHost) headers["x-posthog-host"] = keys.posthogHost;
  if (keys.linearTeamId) headers["x-linear-team-id"] = keys.linearTeamId;
  if (keys.braveSearchKey) headers["x-brave-search-key"] = keys.braveSearchKey;
  if (keys.grainKey) headers["x-grain-key"] = keys.grainKey;
  if (keys.callProvider) headers["x-call-provider"] = keys.callProvider;
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

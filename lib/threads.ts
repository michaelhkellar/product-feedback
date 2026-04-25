import { ChatMessage } from "./types";
import { InteractionMode } from "./agent";
import { ThreadState } from "./conversation-state";

export type { ThreadState };

export interface Thread {
  id: string;
  title: string;
  messages: ChatMessage[];
  accumulatedSourceIds: string[];
  mode: InteractionMode;
  createdAt: string;
  updatedAt: string;
  /** Structured conversation context persisted across turns. Optional — absent on old threads. */
  state?: ThreadState;
  /** ISO timestamp of the last time this thread was opened. Used by learn mode to anchor "since last time". */
  lastOpenedAt?: string;
}

const DB_NAME = "feedback-agent-threads";
// Version 3: added optional `lastOpenedAt` field on Thread (no schema migration needed; field is optional).
const DB_VERSION = 3;
const STORE_NAME = "threads";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function listThreads(): Promise<Thread[]> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => {
        const threads: Thread[] = req.result || [];
        threads.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        resolve(threads);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function saveThread(thread: Thread): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(thread);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {}
}

export async function deleteThread(id: string): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {}
}

export async function markThreadOpened(id: string): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const thread: Thread | undefined = getReq.result;
        if (thread) {
          store.put({ ...thread, lastOpenedAt: new Date().toISOString() });
        }
        resolve();
      };
      getReq.onerror = () => reject(getReq.error);
      tx.onerror = () => reject(tx.error);
    });
  } catch {}
}

export function generateThreadTitle(messages: ChatMessage[]): string {
  const firstUserMsg = messages.find((m) => m.role === "user");
  if (!firstUserMsg) return "New Thread";
  const content = firstUserMsg.content.replace(/\s+/g, " ").trim();
  return content.length > 60 ? content.slice(0, 60) + "…" : content;
}

export function createThread(mode: InteractionMode): Thread {
  const now = new Date().toISOString();
  return {
    id: `thread-${Date.now()}`,
    title: "New Thread",
    messages: [],
    accumulatedSourceIds: [],
    mode,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
  };
}

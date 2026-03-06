"use client";

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { ApiKeyState, ApiKeyStatus, loadKeys, saveKeys, clearKeys, buildKeyHeaders } from "@/lib/api-keys";

interface ApiKeyContextValue {
  keys: ApiKeyState;
  status: ApiKeyStatus;
  useDemoData: boolean;
  setKey: (name: keyof ApiKeyState, value: string) => void;
  removeKey: (name: keyof ApiKeyState) => void;
  clearAllKeys: () => void;
  setUseDemoData: (v: boolean) => void;
  refreshStatus: (overrideKeys?: Partial<ApiKeyState>) => Promise<void>;
  keyHeaders: Record<string, string>;
  hasAnyKey: boolean;
}

const ApiKeyContext = createContext<ApiKeyContextValue | null>(null);

export function useApiKeys(): ApiKeyContextValue {
  const ctx = useContext(ApiKeyContext);
  if (!ctx) throw new Error("useApiKeys must be used within ApiKeyProvider");
  return ctx;
}

const EMPTY: ApiKeyState = {
  geminiKey: "", productboardKey: "", attentionKey: "", pendoKey: "",
  atlassianDomain: "", atlassianEmail: "", atlassianToken: "",
  atlassianJiraFilter: "", atlassianConfluenceFilter: "",
  contextMode: "focused",
};

const EMPTY_STATUS: ApiKeyStatus = {
  geminiKey: { configured: false, source: null },
  productboardKey: { configured: false, source: null },
  attentionKey: { configured: false, source: null },
  pendoKey: { configured: false, source: null },
  atlassianKey: { configured: false, source: null },
};

export function ApiKeyProvider({ children }: { children: ReactNode }) {
  const [keys, setKeys] = useState<ApiKeyState>({ ...EMPTY });
  const [status, setStatus] = useState<ApiKeyStatus>({ ...EMPTY_STATUS });
  const [useDemoData, setUseDemoData] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await loadKeys();
      if (cancelled) return;
      setKeys(stored);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshStatus = useCallback(async (overrideKeys?: Partial<ApiKeyState>) => {
    try {
      const effectiveKeys = { ...keys, ...overrideKeys };
      const res = await fetch("/api/settings/status", { headers: buildKeyHeaders(effectiveKeys) });
      if (res.ok) {
        const data = await res.json();
        setStatus(data.status);
      }
    } catch { /* keep current */ }
  }, [keys]);

  useEffect(() => {
    if (loaded) refreshStatus();
  }, [loaded, refreshStatus]);

  const setKey = useCallback((name: keyof ApiKeyState, value: string) => {
    setKeys((prev) => {
      const next = { ...prev, [name]: value };
      void saveKeys(next);
      return next;
    });
  }, []);

  const removeKey = useCallback((name: keyof ApiKeyState) => {
    setKeys((prev) => {
      const next = { ...prev, [name]: "" };
      void saveKeys(next);
      return next;
    });
  }, []);

  const clearAllKeysHandler = useCallback(() => {
    setKeys({ ...EMPTY });
    void clearKeys();
  }, []);

  const keyHeaders = buildKeyHeaders(keys);
  const hasAnyKey = !!(keys.geminiKey || keys.productboardKey || keys.attentionKey || keys.pendoKey || keys.atlassianToken);

  return (
    <ApiKeyContext.Provider
      value={{
        keys, status, useDemoData,
        setKey, removeKey, clearAllKeys: clearAllKeysHandler, setUseDemoData,
        refreshStatus, keyHeaders, hasAnyKey,
      }}
    >
      {children}
    </ApiKeyContext.Provider>
  );
}

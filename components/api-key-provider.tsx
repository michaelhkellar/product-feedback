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
  refreshStatus: () => Promise<void>;
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
  geminiKey: "", productboardKey: "", attentionKey: "",
  atlassianDomain: "", atlassianEmail: "", atlassianToken: "",
  atlassianJiraFilter: "", atlassianConfluenceFilter: "",
};

const EMPTY_STATUS: ApiKeyStatus = {
  geminiKey: { configured: false, source: null },
  productboardKey: { configured: false, source: null },
  attentionKey: { configured: false, source: null },
  atlassianKey: { configured: false, source: null },
};

export function ApiKeyProvider({ children }: { children: ReactNode }) {
  const [keys, setKeys] = useState<ApiKeyState>({ ...EMPTY });
  const [status, setStatus] = useState<ApiKeyStatus>({ ...EMPTY_STATUS });
  const [useDemoData, setUseDemoData] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const stored = loadKeys();
    setKeys(stored);
    setLoaded(true);
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/status", { headers: buildKeyHeaders(keys) });
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
      saveKeys(next);
      return next;
    });
  }, []);

  const removeKey = useCallback((name: keyof ApiKeyState) => {
    setKeys((prev) => {
      const next = { ...prev, [name]: "" };
      saveKeys(next);
      return next;
    });
  }, []);

  const clearAllKeysHandler = useCallback(() => {
    setKeys({ ...EMPTY });
    clearKeys();
  }, []);

  const keyHeaders = buildKeyHeaders(keys);
  const hasAnyKey = !!(keys.geminiKey || keys.productboardKey || keys.attentionKey || keys.atlassianToken);

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

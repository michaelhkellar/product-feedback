"use client";

import { useState, useEffect, useCallback } from "react";
import { useApiKeys } from "./api-key-provider";
import { maskKey, buildKeyHeaders, ApiKeyState } from "@/lib/api-keys";
import {
  X, Settings, Key, CheckCircle2, XCircle, Loader2,
  Eye, EyeOff, Trash2, Save, AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface SettingsDialogProps { open: boolean; onClose: () => void; }

interface KeyFieldState {
  value: string; visible: boolean; dirty: boolean;
  validating: boolean; valid: boolean | null; error: string | null;
}

const SIMPLE_KEYS: { id: keyof ApiKeyState; label: string; placeholder: string; description: string }[] = [
  { id: "geminiKey", label: "Gemini API Key", placeholder: "AIza...", description: "Powers AI analysis. Get one at ai.google.dev" },
  { id: "productboardKey", label: "Productboard API Token", placeholder: "pb_...", description: "Fetches features and notes from Productboard" },
  { id: "attentionKey", label: "Attention API Key", placeholder: "att_...", description: "Fetches call recordings from Attention" },
];

const ATLASSIAN_FIELDS: { id: keyof ApiKeyState; label: string; placeholder: string; type: string }[] = [
  { id: "atlassianDomain", label: "Domain", placeholder: "mycompany (or mycompany.atlassian.net)", type: "text" },
  { id: "atlassianEmail", label: "Email", placeholder: "you@company.com", type: "email" },
  { id: "atlassianToken", label: "API Token", placeholder: "Your Atlassian API token", type: "password" },
];

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const { keys, status, setKey, removeKey, clearAllKeys, useDemoData, setUseDemoData, refreshStatus } = useApiKeys();
  const [fields, setFields] = useState<Record<string, KeyFieldState>>({});
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      const initial: Record<string, KeyFieldState> = {};
      for (const cfg of SIMPLE_KEYS) {
        initial[cfg.id] = { value: keys[cfg.id], visible: false, dirty: false, validating: false, valid: keys[cfg.id] ? true : null, error: null };
      }
      for (const cfg of ATLASSIAN_FIELDS) {
        initial[cfg.id] = { value: keys[cfg.id], visible: cfg.type !== "password", dirty: false, validating: false, valid: keys[cfg.id] ? true : null, error: null };
      }
      setFields(initial);
      setSaveMessage(null);
    }
  }, [open, keys]);

  const updateField = useCallback((id: string, updates: Partial<KeyFieldState>) => {
    setFields((prev) => ({ ...prev, [id]: { ...prev[id], ...updates } }));
  }, []);

  function showSave(msg: string) {
    setSaveMessage(msg);
    setTimeout(() => setSaveMessage(null), 2000);
    setTimeout(() => refreshStatus(), 500);
  }

  async function handleValidate(id: string) {
    const field = fields[id];
    if (!field?.value.trim()) return;
    updateField(id, { validating: true, valid: null, error: null });
    try {
      const testKeys = { ...keys };
      if (id in testKeys) (testKeys as Record<string, string>)[id] = field.value;
      for (const af of ATLASSIAN_FIELDS) {
        const afField = fields[af.id];
        if (afField) (testKeys as Record<string, string>)[af.id] = afField.value;
      }
      const validationKey = id.startsWith("atlassian") ? "atlassianToken" : id;
      const res = await fetch("/api/settings/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...buildKeyHeaders(testKeys) },
        body: JSON.stringify({ keyName: validationKey }),
      });
      const data = await res.json();
      updateField(id, { validating: false, valid: data.valid, error: data.valid ? null : data.error || "Validation failed" });
    } catch {
      updateField(id, { validating: false, valid: false, error: "Could not reach validation endpoint" });
    }
  }

  function handleSave(id: string) {
    const field = fields[id];
    if (!field) return;
    const trimmed = field.value.trim();
    if (trimmed) setKey(id as keyof ApiKeyState, trimmed);
    else removeKey(id as keyof ApiKeyState);
    updateField(id, { dirty: false });
  }

  function handleRemove(id: string) {
    removeKey(id as keyof ApiKeyState);
    updateField(id, { value: "", dirty: false, valid: null, error: null });
  }

  function handleSaveAtlassian() {
    for (const af of ATLASSIAN_FIELDS) {
      const field = fields[af.id];
      if (field) {
        const trimmed = field.value.trim();
        if (trimmed) setKey(af.id, trimmed);
        else removeKey(af.id);
        updateField(af.id, { dirty: false });
      }
    }
    showSave("Atlassian settings saved");
  }

  function handleRemoveAtlassian() {
    for (const af of ATLASSIAN_FIELDS) {
      removeKey(af.id);
      updateField(af.id, { value: "", dirty: false, valid: null, error: null });
    }
    showSave("Atlassian settings removed");
  }

  if (!open) return null;

  const atlDirty = ATLASSIAN_FIELDS.some((af) => fields[af.id]?.dirty);
  const atlConfigured = !!(keys.atlassianDomain && keys.atlassianEmail && keys.atlassianToken);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-background border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
              <Settings className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">API Key Settings</h2>
              <p className="text-[10px] text-muted-foreground">Configure keys to connect live data sources</p>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {saveMessage && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-500/10 text-green-600 text-xs font-medium">
              <CheckCircle2 className="w-3.5 h-3.5" />{saveMessage}
            </div>
          )}

          <div className="p-3 rounded-xl bg-muted/50 border border-border">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium">Show Demo Data</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Display sample data when no API keys are configured</p>
              </div>
              <button onClick={() => setUseDemoData(!useDemoData)} className={cn("relative w-10 h-5 rounded-full transition-colors", useDemoData ? "bg-primary" : "bg-muted-foreground/30")}>
                <div className={cn("absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform", useDemoData ? "translate-x-5" : "translate-x-0.5")} />
              </button>
            </div>
          </div>

          {SIMPLE_KEYS.map((cfg) => {
            const field = fields[cfg.id];
            if (!field) return null;
            const envConfigured = (status as unknown as Record<string, { source: string | null }>)[cfg.id]?.source === "env";
            return (
              <div key={cfg.id} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Key className="w-3.5 h-3.5 text-muted-foreground" />
                    <label className="text-xs font-medium">{cfg.label}</label>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {envConfigured && <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500 font-medium">ENV</span>}
                    {field.valid === true && <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />}
                    {field.valid === false && <XCircle className="w-3.5 h-3.5 text-red-500" />}
                    {keys[cfg.id] && !field.dirty && <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-600 font-medium">Saved</span>}
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground">{cfg.description}</p>
                <div className="flex gap-2">
                  <div className="flex-1 relative">
                    <input type={field.visible ? "text" : "password"} value={field.value}
                      onChange={(e) => updateField(cfg.id, { value: e.target.value, dirty: true })}
                      placeholder={cfg.placeholder}
                      className="w-full px-3 py-2 rounded-lg border border-border bg-card text-xs font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 pr-8" />
                    <button type="button" onClick={() => updateField(cfg.id, { visible: !field.visible })} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      {field.visible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  <button onClick={() => { handleSave(cfg.id); showSave(`${cfg.label} saved`); }}
                    disabled={!field.dirty && !!keys[cfg.id]}
                    className={cn("px-3 py-2 rounded-lg text-[10px] font-medium flex items-center gap-1.5 transition-colors",
                      field.dirty || !keys[cfg.id] ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-muted text-muted-foreground cursor-not-allowed")}>
                    <Save className="w-3 h-3" />Save
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => handleValidate(cfg.id)} disabled={!field.value.trim() || field.validating}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium bg-muted hover:bg-accent transition-colors disabled:opacity-50">
                    {field.validating ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}Test
                  </button>
                  {keys[cfg.id] && (
                    <button onClick={() => { handleRemove(cfg.id); showSave(`${cfg.label} removed`); }}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium text-red-500 bg-red-500/10 hover:bg-red-500/20 transition-colors">
                      <Trash2 className="w-3 h-3" />Remove
                    </button>
                  )}
                  {keys[cfg.id] && !field.dirty && <span className="text-[10px] text-muted-foreground font-mono">{maskKey(keys[cfg.id])}</span>}
                </div>
                {field.error && <div className="flex items-center gap-1.5 text-[10px] text-red-500"><AlertTriangle className="w-3 h-3" />{field.error}</div>}
              </div>
            );
          })}

          <div className="pt-3 border-t border-border space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Key className="w-3.5 h-3.5 text-muted-foreground" />
                <label className="text-xs font-medium">Atlassian (Jira + Confluence)</label>
              </div>
              <div className="flex items-center gap-1.5">
                {status.atlassianKey?.source === "env" && <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500 font-medium">ENV</span>}
                {atlConfigured && !atlDirty && <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-600 font-medium">Saved</span>}
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">One Atlassian API token connects both Jira and Confluence. Create a token at id.atlassian.com/manage-profile/security/api-tokens</p>
            {ATLASSIAN_FIELDS.map((af) => {
              const field = fields[af.id];
              if (!field) return null;
              return (
                <div key={af.id} className="space-y-1">
                  <label className="text-[10px] text-muted-foreground font-medium">{af.label}</label>
                  <div className="relative">
                    <input
                      type={af.type === "password" && !field.visible ? "password" : "text"}
                      value={field.value}
                      onChange={(e) => updateField(af.id, { value: e.target.value, dirty: true })}
                      placeholder={af.placeholder}
                      className="w-full px-3 py-2 rounded-lg border border-border bg-card text-xs font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 pr-8"
                    />
                    {af.type === "password" && (
                      <button type="button" onClick={() => updateField(af.id, { visible: !field.visible })} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                        {field.visible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            <div className="flex items-center gap-2">
              <button onClick={handleSaveAtlassian} disabled={!atlDirty && atlConfigured}
                className={cn("px-3 py-1.5 rounded-lg text-[10px] font-medium flex items-center gap-1.5 transition-colors",
                  atlDirty || !atlConfigured ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-muted text-muted-foreground cursor-not-allowed")}>
                <Save className="w-3 h-3" />Save Atlassian
              </button>
              <button onClick={() => handleValidate("atlassianToken")}
                disabled={!fields.atlassianToken?.value.trim() || !fields.atlassianDomain?.value.trim() || !fields.atlassianEmail?.value.trim() || fields.atlassianToken?.validating}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium bg-muted hover:bg-accent transition-colors disabled:opacity-50">
                {fields.atlassianToken?.validating ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}Test
              </button>
              {atlConfigured && (
                <button onClick={handleRemoveAtlassian}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium text-red-500 bg-red-500/10 hover:bg-red-500/20 transition-colors">
                  <Trash2 className="w-3 h-3" />Remove
                </button>
              )}
            </div>
            {fields.atlassianToken?.valid === true && <div className="flex items-center gap-1.5 text-[10px] text-green-600"><CheckCircle2 className="w-3 h-3" />Connected</div>}
            {fields.atlassianToken?.error && <div className="flex items-center gap-1.5 text-[10px] text-red-500"><AlertTriangle className="w-3 h-3" />{fields.atlassianToken.error}</div>}
          </div>

          <div className="pt-2 border-t border-border">
            <button onClick={() => {
              clearAllKeys();
              const initial: Record<string, KeyFieldState> = {};
              for (const cfg of SIMPLE_KEYS) initial[cfg.id] = { value: "", visible: false, dirty: false, validating: false, valid: null, error: null };
              for (const af of ATLASSIAN_FIELDS) initial[af.id] = { value: "", visible: af.type !== "password", dirty: false, validating: false, valid: null, error: null };
              setFields(initial);
              showSave("All keys cleared");
            }} className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-red-500 hover:bg-red-500/10 transition-colors">
              <Trash2 className="w-3.5 h-3.5" />Clear All Keys
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

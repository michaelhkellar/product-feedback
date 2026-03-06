"use client";

import { useState, useEffect, useCallback } from "react";
import { useApiKeys } from "./api-key-provider";
import { buildKeyHeaders, ApiKeyState } from "@/lib/api-keys";
import {
  X, Settings, Key, CheckCircle2, XCircle, Loader2,
  Trash2, Save, AlertTriangle,
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
  { id: "pendoKey", label: "Pendo Integration Key", placeholder: "pendo_...", description: "Adds product usage insights and on-demand visitor/account history from Pendo" },
];

const ATLASSIAN_AUTH_FIELDS: { id: keyof ApiKeyState; label: string; placeholder: string; type: string }[] = [
  { id: "atlassianDomain", label: "Domain", placeholder: "mycompany (or mycompany.atlassian.net)", type: "text" },
  { id: "atlassianEmail", label: "Email", placeholder: "you@company.com", type: "email" },
  { id: "atlassianToken", label: "API Token", placeholder: "Your Atlassian API token", type: "password" },
];

const ATLASSIAN_FILTER_FIELDS: { id: keyof ApiKeyState; label: string; placeholder: string; help: string }[] = [
  { id: "atlassianJiraFilter", label: "Jira Projects", placeholder: "PROD, ENG, SUP", help: "Comma-separated project keys or names. Leave blank for all." },
  { id: "atlassianConfluenceFilter", label: "Confluence Spaces", placeholder: "PROD, ENG, KB", help: "Comma-separated space keys. Leave blank for all." },
];

const ATLASSIAN_FIELDS = [...ATLASSIAN_AUTH_FIELDS, ...ATLASSIAN_FILTER_FIELDS.map((f) => ({ ...f, type: "text" }))];

interface AtlassianResource { key: string; name: string; }

function parseFilterList(filter: string | undefined): string[] {
  if (!filter) return [];
  return filter.split(/[,;\n]+/).map((s) => s.trim()).filter((s) => s.length > 0);
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const { keys, status, setKey, removeKey, clearAllKeys, useDemoData, setUseDemoData, refreshStatus } = useApiKeys();
  const [fields, setFields] = useState<Record<string, KeyFieldState>>({});
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [jiraProjects, setJiraProjects] = useState<AtlassianResource[]>([]);
  const [confluenceSpaces, setConfluenceSpaces] = useState<AtlassianResource[]>([]);
  const [loadingResources, setLoadingResources] = useState(false);
  const [jiraSearch, setJiraSearch] = useState("");
  const [confluenceSearch, setConfluenceSearch] = useState("");

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
      if (keys.atlassianDomain && keys.atlassianEmail && keys.atlassianToken) {
        fetchAtlassianResources();
      }
    }
  }, [open, keys]);

  const updateField = useCallback((id: string, updates: Partial<KeyFieldState>) => {
    setFields((prev) => ({ ...prev, [id]: { ...prev[id], ...updates } }));
  }, []);

  async function fetchAtlassianResources(overrideKeys?: Partial<ApiKeyState>) {
    setLoadingResources(true);
    try {
      const testKeys = { ...keys, ...overrideKeys };
      const res = await fetch("/api/settings/atlassian-resources", {
        headers: buildKeyHeaders(testKeys),
      });
      if (res.ok) {
        const data = await res.json();
        setJiraProjects(data.projects || []);
        setConfluenceSpaces(data.spaces || []);
      }
    } catch { /* ignore */ }
    setLoadingResources(false);
  }

  function showSave(msg: string, nextKeys?: Partial<ApiKeyState>) {
    setSaveMessage(msg);
    setTimeout(() => setSaveMessage(null), 2000);
    refreshStatus(nextKeys);
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
      if (data.valid && id.startsWith("atlassian")) {
        const testKeys: Partial<ApiKeyState> = {};
        for (const af of ATLASSIAN_FIELDS) {
          const afField = fields[af.id];
          if (afField) (testKeys as Record<string, string>)[af.id] = afField.value;
        }
        fetchAtlassianResources(testKeys);
      }
    } catch {
      updateField(id, { validating: false, valid: false, error: "Could not reach validation endpoint" });
    }
  }

  function handleSave(id: string) {
    const field = fields[id];
    if (!field) return;
    const trimmed = field.value.trim();
    const nextKeys: Partial<ApiKeyState> = { [id]: trimmed } as Partial<ApiKeyState>;
    if (trimmed) setKey(id as keyof ApiKeyState, trimmed);
    else removeKey(id as keyof ApiKeyState);
    updateField(id, { dirty: false });
    showSave(`${SIMPLE_KEYS.find((cfg) => cfg.id === id)?.label || "Key"} ${trimmed ? "saved" : "removed"}`, nextKeys);
  }

  function handleRemove(id: string) {
    removeKey(id as keyof ApiKeyState);
    updateField(id, { value: "", dirty: false, valid: null, error: null });
    showSave(`${SIMPLE_KEYS.find((cfg) => cfg.id === id)?.label || "Key"} removed`, { [id]: "" } as Partial<ApiKeyState>);
  }

  function handleSaveAtlassian() {
    const nextKeys: Partial<ApiKeyState> = {};
    for (const af of ATLASSIAN_FIELDS) {
      const field = fields[af.id];
      if (field) {
        const trimmed = field.value.trim();
        if (trimmed) setKey(af.id, trimmed);
        else removeKey(af.id);
        (nextKeys as Record<string, string>)[af.id] = trimmed;
        updateField(af.id, { dirty: false });
      }
    }
    showSave("Atlassian settings saved", nextKeys);
  }

  function handleRemoveAtlassian() {
    const nextKeys: Partial<ApiKeyState> = {};
    for (const af of ATLASSIAN_FIELDS) {
      removeKey(af.id);
      (nextKeys as Record<string, string>)[af.id] = "";
      updateField(af.id, { value: "", dirty: false, valid: null, error: null });
    }
    showSave("Atlassian settings removed", nextKeys);
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

          <div className="p-3 rounded-xl bg-muted/50 border border-border space-y-2">
            <p className="text-xs font-medium">AI Context Mode</p>
            <p className="text-[10px] text-muted-foreground">Controls how much data is sent to Gemini per query. Less = cheaper + faster.</p>
            <div className="flex gap-1.5">
              {([
                { key: "focused" as const, label: "Focused", desc: "Search results only (~500 tokens)" },
                { key: "standard" as const, label: "Standard", desc: "Recent items + search (~1.5k tokens)" },
                { key: "deep" as const, label: "Deep", desc: "Broad context + search (~3k tokens)" },
              ]).map((m) => (
                <button key={m.key}
                  onClick={() => { setKey("contextMode", m.key); showSave(`Context mode: ${m.label}`); }}
                  className={cn(
                    "flex-1 px-2 py-2 rounded-lg text-center transition-colors border",
                    keys.contextMode === m.key
                      ? "bg-primary/10 border-primary/30 text-primary"
                      : "bg-card border-border text-muted-foreground hover:text-foreground"
                  )}>
                  <div className="text-[10px] font-medium">{m.label}</div>
                  <div className="text-[8px] mt-0.5 opacity-70">{m.desc}</div>
                </button>
              ))}
            </div>
            <p className="text-[9px] text-muted-foreground">Broad queries (like &ldquo;executive summary&rdquo;) auto-upgrade from Focused to Standard.</p>
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
                    <input type="password" value={field.value}
                      onChange={(e) => updateField(cfg.id, { value: e.target.value, dirty: true })}
                      placeholder={cfg.placeholder}
                      className="w-full px-3 py-2 rounded-lg border border-border bg-card text-xs font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40" />
                  </div>
                  <button onClick={() => { handleSave(cfg.id); }}
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
                    <button onClick={() => { handleRemove(cfg.id); }}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium text-red-500 bg-red-500/10 hover:bg-red-500/20 transition-colors">
                      <Trash2 className="w-3 h-3" />Remove
                    </button>
                  )}
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
            <p className="text-[10px] text-muted-foreground">Supports both classic (full access) and scoped tokens. Create one at id.atlassian.com/manage-profile/security/api-tokens. For scoped tokens, enable <strong>read:jira-work</strong> and <strong>read:confluence-content.all</strong> scopes.</p>
            {ATLASSIAN_AUTH_FIELDS.map((af) => {
              const field = fields[af.id];
              if (!field) return null;
              return (
                <div key={af.id} className="space-y-1">
                  <label className="text-[10px] text-muted-foreground font-medium">{af.label}</label>
                  <div className="relative">
                    <input
                      type={af.type === "password" ? "password" : "text"}
                      value={field.value}
                      onChange={(e) => updateField(af.id, { value: e.target.value, dirty: true })}
                      placeholder={af.placeholder}
                      className="w-full px-3 py-2 rounded-lg border border-border bg-card text-xs font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
                    />
                  </div>
                </div>
              );
            })}

            <div className="mt-2 p-2.5 rounded-lg bg-muted/30 border border-border space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-medium text-muted-foreground">Scope to specific projects/spaces</p>
                {loadingResources && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] text-muted-foreground font-medium">Jira Projects</label>
                {jiraProjects.length > 0 ? (
                  <>
                    <input type="text" value={jiraSearch} onChange={(e) => setJiraSearch(e.target.value)}
                      placeholder="Search projects..." className="w-full px-2.5 py-1 rounded-md border border-border bg-card text-[10px] placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/20" />
                    <div className="max-h-36 overflow-y-auto rounded-lg border border-border bg-card p-1.5 space-y-0.5">
                      {jiraProjects
                        .filter((p) => !jiraSearch || p.key.toLowerCase().includes(jiraSearch.toLowerCase()) || p.name.toLowerCase().includes(jiraSearch.toLowerCase()))
                        .map((p) => {
                          const selected = parseFilterList(fields.atlassianJiraFilter?.value).map((s) => s.toUpperCase()).includes(p.key.toUpperCase());
                          return (
                            <label key={p.key} className={cn("flex items-center gap-2 px-2 py-1 rounded text-xs cursor-pointer hover:bg-accent/50 transition-colors", selected && "bg-primary/10")}>
                              <input type="checkbox" checked={selected} onChange={() => {
                                const current = parseFilterList(fields.atlassianJiraFilter?.value);
                                const next = selected ? current.filter((s) => s.toUpperCase() !== p.key.toUpperCase()) : [...current, p.key];
                                updateField("atlassianJiraFilter", { value: next.join(", "), dirty: true });
                              }} className="rounded flex-shrink-0" />
                              <span className="truncate">{p.name}</span>
                              <span className="font-mono text-[9px] text-muted-foreground flex-shrink-0 ml-auto">{p.key}</span>
                            </label>
                          );
                        })}
                    </div>
                  </>
                ) : (
                  <input type="text" value={fields.atlassianJiraFilter?.value || ""}
                    onChange={(e) => updateField("atlassianJiraFilter", { value: e.target.value, dirty: true })}
                    placeholder="PROD, ENG, SUP (or Test Connection to see projects)"
                    className="w-full px-3 py-1.5 rounded-lg border border-border bg-card text-xs placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40" />
                )}
                <p className="text-[9px] text-muted-foreground">
                  {fields.atlassianJiraFilter?.value ? `Selected: ${fields.atlassianJiraFilter.value}` : "Leave blank for all projects"}
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] text-muted-foreground font-medium">Confluence Spaces</label>
                {confluenceSpaces.length > 0 ? (
                  <>
                    <input type="text" value={confluenceSearch} onChange={(e) => setConfluenceSearch(e.target.value)}
                      placeholder="Search spaces..." className="w-full px-2.5 py-1 rounded-md border border-border bg-card text-[10px] placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/20" />
                    <div className="max-h-36 overflow-y-auto rounded-lg border border-border bg-card p-1.5 space-y-0.5">
                      {confluenceSpaces
                        .filter((s) => !confluenceSearch || s.key.toLowerCase().includes(confluenceSearch.toLowerCase()) || s.name.toLowerCase().includes(confluenceSearch.toLowerCase()))
                        .map((s) => {
                          const selected = parseFilterList(fields.atlassianConfluenceFilter?.value).map((f) => f.toUpperCase()).includes(s.key.toUpperCase());
                          return (
                            <label key={s.key} className={cn("flex items-center gap-2 px-2 py-1 rounded text-xs cursor-pointer hover:bg-accent/50 transition-colors", selected && "bg-primary/10")}>
                              <input type="checkbox" checked={selected} onChange={() => {
                                const current = parseFilterList(fields.atlassianConfluenceFilter?.value);
                                const next = selected ? current.filter((f) => f.toUpperCase() !== s.key.toUpperCase()) : [...current, s.key];
                                updateField("atlassianConfluenceFilter", { value: next.join(", "), dirty: true });
                              }} className="rounded flex-shrink-0" />
                              <span className="truncate">{s.name}</span>
                              <span className="font-mono text-[9px] text-muted-foreground flex-shrink-0 ml-auto">{s.key.length > 10 ? s.key.slice(0, 10) + "…" : s.key}</span>
                            </label>
                          );
                        })}
                    </div>
                  </>
                ) : (
                  <input type="text" value={fields.atlassianConfluenceFilter?.value || ""}
                    onChange={(e) => updateField("atlassianConfluenceFilter", { value: e.target.value, dirty: true })}
                    placeholder="PROD, ENG, KB (or Test Connection to see spaces)"
                    className="w-full px-3 py-1.5 rounded-lg border border-border bg-card text-xs placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40" />
                )}
                <p className="text-[9px] text-muted-foreground">
                  {fields.atlassianConfluenceFilter?.value ? `Selected: ${fields.atlassianConfluenceFilter.value}` : "Leave blank for all spaces"}
                </p>
              </div>
            </div>
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
              showSave("All keys cleared", {
                geminiKey: "",
                productboardKey: "",
                attentionKey: "",
                pendoKey: "",
                atlassianDomain: "",
                atlassianEmail: "",
                atlassianToken: "",
                atlassianJiraFilter: "",
                atlassianConfluenceFilter: "",
              });
            }} className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-red-500 hover:bg-red-500/10 transition-colors">
              <Trash2 className="w-3.5 h-3.5" />Clear All Keys
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

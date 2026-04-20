"use client";

import React, { useState, useRef, useEffect, KeyboardEvent, useCallback, forwardRef, useImperativeHandle, memo, useMemo } from "react";
import { useApiKeys } from "./api-key-provider";
import { ChatMessage } from "@/lib/types";
import { InteractionMode } from "@/lib/agent";
import {
  Send,
  Sparkles,
  Bot,
  User,
  Loader2,
  Search,
  Zap,
  MessageSquare,
  BarChart3,
  AlertTriangle,
  ExternalLink,
  FileText,
  Ticket,
  Copy,
  Download,
  Check,
  ChevronDown,
  ChevronUp,
  Globe,
  Pencil,
} from "lucide-react";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { CitationMarker } from "./citation-marker";
import { TraceModal } from "./trace-modal";
import { useFilters, timeRangeToNL } from "./filter-provider";
import { ThreadMenu } from "./thread-menu";
import { saveThread, generateThreadTitle, Thread } from "@/lib/threads";
import { useEntityDrawer, EntityKind } from "./entity-drawer-provider";

const SUMMARIZE_QUERIES = [
  {
    icon: AlertTriangle,
    label: "Churn Risks",
    query: "What accounts are at risk of churning and what's the revenue impact?",
    color: "text-red-500",
  },
  {
    icon: BarChart3,
    label: "Executive Brief",
    query: "Give me an executive summary of all customer feedback from the last 2 weeks",
    color: "text-blue-500",
  },
  {
    icon: Zap,
    label: "AI Gap",
    query: "What are we hearing about AI features and the competitive landscape?",
    color: "text-amber-500",
  },
  {
    icon: MessageSquare,
    label: "SSO Issues",
    query: "Break down the SSO reliability issue — who's affected and what's the revenue impact?",
    color: "text-purple-500",
  },
];

const PRD_QUERIES = [
  {
    icon: FileText,
    label: "Top Request PRD",
    query: "Write a PRD for the most requested feature based on feedback",
    color: "text-blue-500",
  },
  {
    icon: BarChart3,
    label: "Pain Point PRD",
    query: "Write a PRD addressing the biggest customer pain point",
    color: "text-red-500",
  },
];

const TICKET_QUERIES = [
  {
    icon: Ticket,
    label: "Top Bug Ticket",
    query: "Create a ticket for the most urgent bug based on recent feedback",
    color: "text-red-500",
  },
  {
    icon: Zap,
    label: "Feature Ticket",
    query: "Create a ticket for the highest-voted feature request",
    color: "text-amber-500",
  },
];

const MODE_CONFIG: Record<InteractionMode, { label: string; icon: typeof MessageSquare; queries: typeof SUMMARIZE_QUERIES }> = {
  summarize: { label: "Summarize", icon: MessageSquare, queries: SUMMARIZE_QUERIES },
  prd: { label: "Write PRD", icon: FileText, queries: PRD_QUERIES },
  ticket: { label: "Write Ticket", icon: Ticket, queries: TICKET_QUERIES },
};

interface ChatInterfaceProps {
  className?: string;
}

export interface ChatInterfaceHandle {
  sendMessage: (msg: string) => void;
}

const remarkPlugins = [remarkGfm];

// Allow details/summary and standard HTML while blocking scripts, iframes, on* handlers
const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames || []),
    "details",
    "summary",
  ],
  attributes: {
    ...defaultSchema.attributes,
    "*": [
      ...(defaultSchema.attributes?.["*"] || []),
      "className",
      "class",
    ],
  },
};

const rehypePlugins = [rehypeRaw, [rehypeSanitize, sanitizeSchema]] as Parameters<typeof ReactMarkdown>[0]["rehypePlugins"];

type MsgSource = { type: string; id: string; title: string; url?: string };

type KnownEntity = { name: string; kind: EntityKind };

/**
 * Recursively walks React children and wraps known entity name occurrences
 * with clickable spans that open the entity drawer.
 */
function injectEntitySpans(
  children: React.ReactNode,
  entities: KnownEntity[],
  openEntity: (e: { name: string; kind: EntityKind }) => void
): React.ReactNode {
  if (!entities.length) return children;
  return React.Children.map(children, (child) => {
    if (typeof child === "string" && child.trim()) {
      // Build a regex matching any known entity name (longest first, word-boundary anchored)
      const sorted = [...entities].sort((a, b) => b.name.length - a.name.length);
      const pattern = new RegExp(
        `\\b(${sorted.map((e) => e.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
        "gi"
      );
      const parts = child.split(pattern);
      if (parts.length === 1) return child;
      return parts.map((part, i) => {
        const match = entities.find((e) => e.name.toLowerCase() === part.toLowerCase());
        if (match) {
          return (
            <button
              key={i}
              type="button"
              onClick={() => openEntity({ name: match.name, kind: match.kind })}
              className="underline decoration-dotted underline-offset-2 cursor-pointer hover:text-primary transition-colors"
              title={`View ${match.kind}: ${match.name}`}
            >
              {part}
            </button>
          );
        }
        return part;
      });
    }
    if (React.isValidElement(child) && child.props) {
      const el = child as React.ReactElement<{ children?: React.ReactNode }>;
      const newChildren = injectEntitySpans(el.props.children, entities, openEntity);
      if (newChildren !== el.props.children) {
        return React.cloneElement(el, {}, newChildren);
      }
    }
    return child;
  });
}

/** Recursively walks React children and replaces "[n]" text tokens with CitationMarker components. */
function injectCitations(children: React.ReactNode, sources: MsgSource[]): React.ReactNode {
  if (!sources.length) return children;
  return React.Children.map(children, (child) => {
    if (typeof child === "string") {
      const parts = child.split(/(\[\d+\])/g);
      if (parts.length === 1) return child;
      return parts.map((part, i) => {
        const m = part.match(/^\[(\d+)\]$/);
        if (m) return <CitationMarker key={i} index={parseInt(m[1], 10)} sources={sources} />;
        return part;
      });
    }
    // Recurse into React elements so [n] inside <strong>, <em>, <code>, etc. is processed
    if (React.isValidElement(child) && child.props) {
      const el = child as React.ReactElement<{ children?: React.ReactNode }>;
      const newChildren = injectCitations(el.props.children, sources);
      if (newChildren !== el.props.children) {
        return React.cloneElement(el, {}, newChildren);
      }
    }
    return child;
  });
}

const MemoizedMarkdown = memo(function MemoizedMarkdown({
  content,
  sources,
  entities,
  openEntity,
}: {
  content: string;
  sources?: MsgSource[];
  entities?: KnownEntity[];
  openEntity?: (e: { name: string; kind: EntityKind }) => void;
}) {
  const processed = useMemo(() => fixMarkdown(content), [content]);
  const srcs = sources || [];
  const ents = entities || [];

  function enrich(children: React.ReactNode): React.ReactNode {
    let result = injectCitations(children, srcs);
    if (ents.length && openEntity) result = injectEntitySpans(result, ents, openEntity);
    return result;
  }

  return (
    <div className="prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={{
          p: ({ children }) => <p>{enrich(children)}</p>,
          li: ({ children }) => <li>{enrich(children)}</li>,
          td: ({ children }) => <td>{enrich(children)}</td>,
          details: ({ children }) => (
            <details className="group my-2 rounded-lg border border-border overflow-hidden [&>*:not(summary)]:px-4 [&>*:not(summary)]:py-3 [&>*:not(summary)]:bg-card [&>*:not(summary)]:text-sm [&>*:not(summary)]:leading-relaxed">
              {children}
            </details>
          ),
          summary: ({ children }) => (
            <summary className="flex items-center justify-between px-3 py-2 cursor-pointer text-xs font-semibold bg-muted hover:bg-accent transition-colors list-none [&::-webkit-details-marker]:hidden select-none">
              <span className="flex items-center gap-2">
                <ChevronDown className="w-3 h-3 text-muted-foreground transition-transform group-open:rotate-180 flex-shrink-0" />
                {children}
              </span>
            </summary>
          ),
        }}
      >
        {processed}
      </ReactMarkdown>
    </div>
  );
});

function fixMarkdown(text: string): string {
  if (!text.includes("|")) return text;

  // Preserve code blocks so pipes inside them don't trigger table detection
  const codeBlocks: string[] = [];
  const withPlaceholders = text.replace(/```[\s\S]*?```/g, (m) => {
    codeBlocks.push(m);
    return `\x00CODEBLOCK${codeBlocks.length - 1}\x00`;
  });
  if (!withPlaceholders.includes("|")) return text;

  let result = withPlaceholders;

  const tablePattern = /(\|[^|\n]+(?:\|[^|\n]+)+\|)\s*(\|\s*-{2,}\s*(?:\|\s*-{2,}\s*)+\|)\s*((?:\|[^|\n]+(?:\|[^|\n]+)+\|\s*)+)/g;

  result = result.replace(tablePattern, (match) => {
    const allPipes = match.split(/(?<=\|)\s+(?=\|)/g).join("\n");
    return allPipes;
  });

  if (result === text && (text.includes("|---|") || text.includes("| --- |"))) {
    const pipeCount = (text.match(/\|/g) || []).length;
    if (pipeCount > 10) {
      result = text.replace(/\|\s*\|/g, "|\n|");
    }
  }

  const isPipeRow = (line: string) => {
    const trimmed = line.trim();
    return (
      trimmed.startsWith("|") &&
      trimmed.endsWith("|") &&
      trimmed.split("|").length - 2 >= 2
    );
  };

  const isSeparatorRow = (line: string) => {
    const trimmed = line.trim();
    return /^\|\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|$/.test(trimmed);
  };

  const columnCount = (line: string) =>
    Math.max(0, line.trim().split("|").length - 2);

  const lines = result.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!isPipeRow(lines[i])) continue;
    if (i > 0 && isPipeRow(lines[i - 1])) continue;

    let j = i;
    while (j < lines.length && isPipeRow(lines[j])) j++;

    const blockSize = j - i;
    if (blockSize < 2) continue;
    if (isSeparatorRow(lines[i + 1])) continue;

    const cols = columnCount(lines[i]);
    if (cols < 2) continue;
    lines.splice(i + 1, 0, `| ${Array.from({ length: cols }, () => "---").join(" | ")} |`);
    i++;
  }

  result = lines.join("\n");

  // Restore code blocks
  if (codeBlocks.length > 0) {
    result = result.replace(/\x00CODEBLOCK(\d+)\x00/g, (_, i) => codeBlocks[parseInt(i)]);
  }

  return result;
}

function SourcesUsed({ sources }: { sources: { type: string; id: string; title: string; url?: string }[] }) {
  const [open, setOpen] = useState(false);
  if (!sources.length) return null;

  return (
    <div className="mt-2 border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 text-[10px] font-medium text-muted-foreground hover:bg-accent/50 transition-colors"
      >
        <span>Sources used ({sources.length})</span>
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>
      {open && (
        <div className="px-3 pb-2 flex flex-wrap gap-1.5">
          {sources.map((src, i) => {
            const label = src.title.length > 50 ? src.title.slice(0, 50) + "…" : src.title;
            return (
              <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-medium bg-muted text-muted-foreground">
                {src.type}: {label}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TicketPreview({
  content,
  sources,
  onCreateTicket,
  ticketProvider,
}: {
  content: string;
  sources: { type: string; id: string; title: string; url?: string }[];
  onCreateTicket: (title: string, description: string, priority?: string) => Promise<{ url: string; key: string } | { error: string }>;
  ticketProvider: string;
}) {
  const [editing, setEditing] = useState(false);
  const titleMatch = content.match(/## Title\n+(.+)/);
  const descMatch = content.match(/## Description\n+([\s\S]*?)(?=\n## |$)/);
  const prioMatch = content.match(/## Priority\n+(\w+)/);

  const [title, setTitle] = useState(titleMatch?.[1]?.trim() || "");
  const [description, setDescription] = useState(descMatch?.[1]?.trim() || content);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ url: string; key: string } | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const providerLabel = ticketProvider === "linear" ? "Linear" : "Jira";

  async function handleCreate() {
    setCreating(true);
    setCreateError(null);
    try {
      const result = await onCreateTicket(title, description, prioMatch?.[1]);
      if ("error" in result) {
        setCreateError(result.error);
      } else {
        setCreated(result);
      }
    } finally {
      setCreating(false);
    }
  }

  if (created) {
    return (
      <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-green-500/10 text-green-600 text-xs font-medium">
        <Check className="w-3.5 h-3.5" />
        Ticket created in {providerLabel}{created.key !== "Created" ? ` (${created.key})` : ""}
        {created.url && created.url !== "#" && (
          <a href={created.url} target="_blank" rel="noopener noreferrer" className="underline ml-1">View</a>
        )}
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      {createError && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 text-red-600 text-xs font-medium">
          {createError}
        </div>
      )}
      {editing ? (
        <div className="space-y-2 p-3 rounded-lg border border-border bg-card">
          <div>
            <label className="text-[10px] font-medium text-muted-foreground">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full mt-1 px-3 py-1.5 rounded-md border border-border bg-background text-xs focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <div>
            <label className="text-[10px] font-medium text-muted-foreground">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={6}
              className="w-full mt-1 px-3 py-1.5 rounded-md border border-border bg-background text-xs font-mono resize-y focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <SourcesUsed sources={sources} />
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={creating || !title.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {creating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
              Confirm & Create in {providerLabel}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-muted text-muted-foreground hover:bg-accent"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button
            onClick={() => setEditing(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Ticket className="w-3 h-3" />
            Create in {providerLabel}
          </button>
        </div>
      )}
    </div>
  );
}

function PrdPreview({
  content,
  sources,
  hasAtlassian,
  onCreateConfluence,
}: {
  content: string;
  sources: { type: string; id: string; title: string; url?: string }[];
  hasAtlassian: boolean;
  onCreateConfluence: (title: string, content: string) => Promise<{ url: string; title: string } | { error: string }>;
}) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(content);
  const [confluenceState, setConfluenceState] = useState<{ url: string; title: string } | { error: string } | null>(null);
  const [confluenceLoading, setConfluenceLoading] = useState(false);

  const titleMatch = content.match(/^# (.+)$/m);
  const prdTitle = titleMatch?.[1] || "Untitled PRD";

  function handleCopy() {
    navigator.clipboard.writeText(editing ? editContent : content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleDownload() {
    const blob = new Blob([editing ? editContent : content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${prdTitle.replace(/[^a-zA-Z0-9 ]/g, "").trim().replace(/\s+/g, "-")}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handlePublishConfluence() {
    setConfluenceLoading(true);
    setConfluenceState(null);
    const result = await onCreateConfluence(prdTitle, editing ? editContent : content);
    setConfluenceState(result);
    setConfluenceLoading(false);
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setEditing(!editing)}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
            editing ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground hover:bg-accent"
          )}
        >
          <Pencil className="w-3 h-3" />
          {editing ? "Preview" : "Edit"}
        </button>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-muted text-muted-foreground hover:bg-accent"
        >
          {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
        <button
          onClick={handleDownload}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-muted text-muted-foreground hover:bg-accent"
        >
          <Download className="w-3 h-3" />
          Download .md
        </button>
        {hasAtlassian && (
          <button
            onClick={handlePublishConfluence}
            disabled={confluenceLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            <Globe className="w-3 h-3" />
            {confluenceLoading ? "Publishing…" : "Create Confluence Page"}
          </button>
        )}
      </div>
      {confluenceState && "url" in confluenceState && (
        <p className="text-xs text-green-600">
          Published:{" "}
          <a href={confluenceState.url} target="_blank" rel="noopener noreferrer" className="underline">
            {confluenceState.title}
          </a>
        </p>
      )}
      {confluenceState && "error" in confluenceState && (
        <p className="text-xs text-red-600">{confluenceState.error}</p>
      )}
      {editing && (
        <textarea
          value={editContent}
          onChange={(e) => setEditContent(e.target.value)}
          rows={16}
          className="w-full px-3 py-2 rounded-lg border border-border bg-card text-xs font-mono resize-y focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      )}
      <SourcesUsed sources={sources} />
    </div>
  );
}

export const ChatInterface = forwardRef<ChatInterfaceHandle, ChatInterfaceProps>(function ChatInterface({ className }, ref) {
  const { keys, keyHeaders, useDemoData, status, hasAnyKey } = useApiKeys();
  const { filters } = useFilters();
  const { openEntity } = useEntityDrawer();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [sessionTokens, setSessionTokens] = useState(0);
  const [mode, setMode] = useState<InteractionMode>("summarize");
  const [accumulatedSourceIds, setAccumulatedSourceIds] = useState<Set<string>>(new Set());
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const aiProviderLabel = (() => {
    const p = keys.aiProvider || "gemini";
    const model = keys.aiModel;
    const labels: Record<string, string> = { gemini: "Gemini", anthropic: "Anthropic", openai: "OpenAI" };
    const base = labels[p] || "Gemini";
    if (model) return `${base} ${model}`;
    return `${base} AI`;
  })();

  const isAIConfigured = (() => {
    const p = keys.aiProvider || "gemini";
    if (p === "gemini") return status.geminiKey.configured;
    if (p === "anthropic") return status.anthropicKey?.configured || false;
    if (p === "openai") return status.openaiKey?.configured || false;
    return status.geminiKey.configured;
  })();

  useEffect(() => {
    const configuredSources: string[] = [];
    if (isAIConfigured) configuredSources.push(aiProviderLabel);
    if (status.productboardKey.configured) configuredSources.push("Productboard");
    if (status.attentionKey.configured) configuredSources.push("Attention");
    if (status.pendoKey?.configured) configuredSources.push("Pendo");
    if (status.amplitudeKey?.configured) configuredSources.push("Amplitude");
    if (status.atlassianKey?.configured) configuredSources.push("Jira + Confluence");
    if (status.linearKey?.configured) configuredSources.push("Linear");

    const sourceInfo =
      configuredSources.length > 0
        ? `\n\nConnected sources: **${configuredSources.join(", ")}**`
        : "";
    const demoInfo = useDemoData
      ? "\n\n*Currently showing demo data. You can manage API keys and data settings via the gear icon in the header.*"
      : !hasAnyKey
        ? "\n\n*No API keys configured and demo data is off. Open Settings (gear icon) to add keys or enable demo data.*"
        : "";

    const welcomeContent = `Welcome! I'm your **Customer Feedback Intelligence Agent**. I can analyze themes, identify churn risks, surface opportunities, write PRDs, and create tickets — all grounded in your feedback data.${sourceInfo}${demoInfo}

Try one of the suggested queries below to get started.`;

    setMessages((prev) => {
      if (prev.length <= 1 && prev[0]?.id === "welcome") {
        return [{ id: "welcome", role: "assistant" as const, content: welcomeContent, timestamp: new Date().toISOString() }];
      }
      if (prev.length === 0) {
        return [{ id: "welcome", role: "assistant" as const, content: welcomeContent, timestamp: new Date().toISOString() }];
      }
      return prev.map((m) => m.id === "welcome" ? { ...m, content: welcomeContent } : m);
    });
  }, [status, useDemoData, hasAnyKey, aiProviderLabel, isAIConfigured]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height =
        Math.min(inputRef.current.scrollHeight, 120) + "px";
    }
  }, [input]);

  const handleCreateTicket = useCallback(async (title: string, description: string, priority?: string): Promise<{ url: string; key: string } | { error: string }> => {
    try {
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...keyHeaders },
        body: JSON.stringify({
          title,
          description,
          priority,
          projectKey: keys.atlassianJiraFilter?.split(",")[0]?.trim() || "",
          teamId: keys.linearTeamId || "",
        }),
      });
      const data = await res.json();
      if (!res.ok) return { error: data?.error || `Failed (${res.status})` };
      return { url: data.url || "#", key: data.key || data.id || "Created" };
    } catch (error) {
      console.error("Failed to create ticket:", error);
      return { error: "Network error. Please check your connection and try again." };
    }
  }, [keyHeaders, keys.atlassianJiraFilter]);

  const handleCreateConfluence = useCallback(async (title: string, content: string): Promise<{ url: string; title: string } | { error: string }> => {
    try {
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...keyHeaders },
        body: JSON.stringify({ title, content, spaceId: keys.atlassianConfluenceFilter?.split(",")[0]?.trim() || "" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { error: (data as { error?: string }).error || `Failed (${res.status})` };
      return { url: (data as { url?: string }).url || "#", title };
    } catch (error) {
      console.error("Failed to create Confluence page:", error);
      return { error: "Network error. Please check your connection and try again." };
    }
  }, [keyHeaders, keys.atlassianConfluenceFilter]);

  const handleSaveThread = useCallback(async () => {
    const relevantMessages = messages.filter((m) => m.id !== "welcome" && m.role !== "system");
    if (relevantMessages.length === 0) return;
    const id = currentThreadId || `thread-${Date.now()}`;
    const thread: Thread = {
      id,
      title: generateThreadTitle(relevantMessages),
      messages: relevantMessages,
      accumulatedSourceIds: Array.from(accumulatedSourceIds),
      mode,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await saveThread(thread);
    setCurrentThreadId(id);
  }, [messages, accumulatedSourceIds, mode, currentThreadId]);

  const handleLoadThread = useCallback((thread: Thread) => {
    setMessages([...thread.messages]);
    setAccumulatedSourceIds(new Set(thread.accumulatedSourceIds));
    setMode(thread.mode);
    setCurrentThreadId(thread.id);
    setShowSuggestions(false);
  }, []);

  const handleNewThread = useCallback(() => {
    setMessages([]);
    setAccumulatedSourceIds(new Set());
    setCurrentThreadId(null);
    setShowSuggestions(true);
  }, [mode]);

  // Keep a ref so the imperative handle always calls the latest sendMessage
  const sendMessageRef = useRef<((text?: string, opts?: { skipFilterSuffix?: boolean }) => void) | null>(null);

  useImperativeHandle(ref, () => ({ sendMessage: (msg: string) => sendMessageRef.current?.(msg, { skipFilterSuffix: true }) }), []);

  async function sendMessage(text?: string, opts?: { skipFilterSuffix?: boolean }) {
    let content = text || input.trim();
    if (!content || isLoading) return;

    // Append global time range and theme filters if not overridden
    if (!opts?.skipFilterSuffix) {
      const parts: string[] = [];
      const tlNL = timeRangeToNL(filters.timeRange);
      const hasTimeKeyword = /\b(day|week|month|last|past|ago|since|today|yesterday|recent|previous|period|compare|versus|\bvs\b)\b/i.test(content);
      if (tlNL && !hasTimeKeyword) parts.push(`for ${tlNL}`);
      if (filters.themes.length > 0) parts.push(`focused on ${filters.themes.join(", ")}`);
      if (parts.length) content = `${content} (${parts.join("; ")})`;
    }

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content,
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);
    setShowSuggestions(false);

    try {
      const history = messages
        .filter((m) => m.role !== "system" && m.id !== "welcome")
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-stream": "1",
          ...keyHeaders,
        },
        body: JSON.stringify({
          message: content,
          history,
          useDemoData,
          contextMode: keys.contextMode || "focused",
          mode,
          accumulatedSourceIds: Array.from(accumulatedSourceIds),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        const errorText = data?.error || `Request failed (${res.status}). Please try again.`;
        setMessages((prev) => [
          ...prev,
          {
            id: `error-${Date.now()}`,
            role: "assistant" as const,
            content: `**Error:** ${errorText}`,
            timestamp: new Date().toISOString(),
          },
        ]);
        return;
      }

      const contentType = res.headers.get("content-type") || "";

      if (contentType.includes("text/event-stream") && res.body) {
        const streamingId = `streaming-${Date.now()}`;
        setMessages((prev) => [...prev, {
          id: streamingId,
          role: "assistant" as const,
          content: "",
          isStreaming: true,
          timestamp: new Date().toISOString(),
        }]);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6).trim();
            if (!jsonStr) continue;
            try {
              const event = JSON.parse(jsonStr) as {
                type: string;
                text?: string;
                response?: string;
                sources?: ChatMessage["sources"];
                trace?: ChatMessage["trace"];
                tokenEstimate?: { input: number; output: number; total: number };
              };
              if (event.type === "delta" && event.text) {
                setMessages((prev) => prev.map((m) =>
                  m.id === streamingId ? { ...m, content: m.content + event.text! } : m
                ));
              } else if (event.type === "done") {
                if (event.tokenEstimate?.total && event.tokenEstimate.total > 0) {
                  setSessionTokens((prev) => prev + event.tokenEstimate!.total);
                }
                if (event.sources && Array.isArray(event.sources)) {
                  setAccumulatedSourceIds((prev) => {
                    const next = new Set(prev);
                    for (const src of event.sources!) { if (src.id) next.add(src.id); }
                    return next;
                  });
                }
                setMessages((prev) => prev.map((m) =>
                  m.id === streamingId ? {
                    ...m,
                    id: `assistant-${Date.now()}`,
                    isStreaming: false,
                    content: event.response || m.content || "No response generated. Please try again.",
                    sources: event.sources,
                    trace: event.trace,
                  } : m
                ));
              }
            } catch { /* skip malformed chunk */ }
          }
        }
      } else {
        const data = await res.json() as {
          response?: string;
          sources?: ChatMessage["sources"];
          trace?: ChatMessage["trace"];
          tokenEstimate?: { input: number; output: number; total: number };
        };

        if (data.tokenEstimate?.total && data.tokenEstimate.total > 0) {
          setSessionTokens((prev) => prev + data.tokenEstimate!.total);
        }

        if (data.sources && Array.isArray(data.sources)) {
          setAccumulatedSourceIds((prev) => {
            const next = new Set(prev);
            for (const src of data.sources!) { if (src.id) next.add(src.id); }
            return next;
          });
        }

        const assistantMessage: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: data.response || "No response generated. Please try again.",
          timestamp: new Date().toISOString(),
          sources: data.sources,
          trace: data.trace,
        };

        setMessages((prev) => [...prev, assistantMessage]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: "assistant" as const,
          content:
            "I encountered an error processing your request. Please try again.",
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  // Always keep the ref current so the imperative handle picks up latest state
  sendMessageRef.current = sendMessage;

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  const currentQueries = MODE_CONFIG[mode].queries;
  const hasAtlassian = status.atlassianKey?.configured || false;
  const ticketProvider = keys.ticketProvider || "atlassian";

  const placeholders: Record<InteractionMode, string> = {
    summarize: "Ask about customer feedback, churn risks, feature requests...",
    prd: "Any specific focus or instructions for the PRD?",
    ticket: "Any specific focus or instructions for the ticket?",
  };

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Thread menu bar */}
      <div className="px-4 pt-1.5 pb-0 flex items-center max-w-2xl mx-auto w-full">
        <ThreadMenu
          currentMessages={messages}
          currentMode={mode}
          currentThreadId={currentThreadId}
          onLoadThread={handleLoadThread}
          onNewThread={handleNewThread}
          onSaveThread={handleSaveThread}
        />
      </div>

      {/* Mode tabs */}
      <div className="px-4 pt-1 pb-0">
        <div className="flex gap-1 max-w-2xl mx-auto">
          {(Object.keys(MODE_CONFIG) as InteractionMode[]).map((m) => {
            const cfg = MODE_CONFIG[m];
            const Icon = cfg.icon;
            return (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-t-lg text-xs font-medium transition-colors border-b-2",
                  mode === m
                    ? "border-primary text-primary bg-primary/5"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/50"
                )}
              >
                <Icon className="w-3 h-3" />
                {cfg.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-4 space-y-6">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={cn(
              "flex gap-3 max-w-4xl",
              msg.role === "user" ? "ml-auto flex-row-reverse" : ""
            )}
          >
            <div
              className={cn(
                "flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center",
                msg.role === "user"
                  ? "bg-primary/10 text-primary"
                  : "bg-gradient-to-br from-violet-500 to-purple-600 text-white"
              )}
            >
              {msg.role === "user" ? (
                <User className="w-4 h-4" />
              ) : (
                <Bot className="w-4 h-4" />
              )}
            </div>
            <div
              className={cn(
                "flex-1 min-w-0",
                msg.role === "user" ? "text-right" : ""
              )}
            >
              <div
                className={cn(
                  "text-left rounded-2xl px-4 py-3 text-sm leading-relaxed",
                  msg.role === "user"
                    ? "inline-block bg-primary text-primary-foreground rounded-tr-sm"
                    : "bg-card border border-border rounded-tl-sm max-w-full overflow-x-auto"
                )}
              >
                <MemoizedMarkdown
                  content={msg.content}
                  sources={msg.sources}
                  entities={[
                    ...(msg.trace?.themesDetected || []).map((t) => ({ name: t, kind: "theme" as EntityKind })),
                    ...(msg.sources || []).filter((s) => s.type === "feature").map((s) => ({ name: s.title, kind: "feature" as EntityKind })),
                  ]}
                  openEntity={openEntity}
                />
              </div>

              {/* Trace (why this answer) + compare chip */}
              {msg.role === "assistant" && msg.id !== "welcome" && (msg.trace || msg.sources?.length) && (
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  {msg.trace && <TraceModal trace={msg.trace} />}
                  {msg.trace?.timeRange && (
                    <button
                      onClick={() => sendMessage(`Compare "${msg.trace!.timeRange!.label}" vs the previous period for the same topics`, { skipFilterSuffix: true })}
                      className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                      title="Compare vs previous period"
                    >
                      <BarChart3 className="w-3 h-3" />
                      Compare vs previous
                    </button>
                  )}
                </div>
              )}

              {/* Source badges */}
              {msg.sources && msg.sources.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {msg.sources.slice(0, 8).map((src, i) => {
                    const label = src.title.length > 40 ? src.title.slice(0, 40) + "…" : src.title;
                    const colorClass = cn(
                      "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors",
                      src.type === "feedback" && "bg-blue-500/10 text-blue-600",
                      src.type === "feature" && "bg-green-500/10 text-green-600",
                      src.type === "call" && "bg-amber-500/10 text-amber-600",
                      src.type === "pendo" && "bg-fuchsia-500/10 text-fuchsia-600",
                      src.type === "amplitude" && "bg-fuchsia-500/10 text-fuchsia-600",
                      src.type === "insight" && "bg-purple-500/10 text-purple-600",
                      src.type === "jira" && "bg-orange-500/10 text-orange-600",
                      src.type === "confluence" && "bg-cyan-500/10 text-cyan-600",
                      src.url && "hover:opacity-80 cursor-pointer"
                    );
                    return src.url ? (
                      <a key={i} href={src.url} target="_blank" rel="noopener noreferrer" className={colorClass}>
                        <ExternalLink className="w-2.5 h-2.5" />
                        {label}
                      </a>
                    ) : (
                      <span key={i} className={colorClass}>
                        <Search className="w-2.5 h-2.5" />
                        {label}
                      </span>
                    );
                  })}
                  {msg.sources.length > 8 && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-muted text-muted-foreground">
                      +{msg.sources.length - 8} more
                    </span>
                  )}
                </div>
              )}

              {/* PRD/Ticket preview actions — available on all non-welcome assistant messages */}
              {msg.role === "assistant" && msg.id !== "welcome" && (
                <>
                  {mode === "ticket" && (
                    <TicketPreview
                      content={msg.content}
                      sources={msg.sources || []}
                      onCreateTicket={handleCreateTicket}
                      ticketProvider={ticketProvider}
                    />
                  )}
                  {mode === "prd" && (
                    <PrdPreview
                      content={msg.content}
                      sources={msg.sources || []}
                      hasAtlassian={hasAtlassian}
                      onCreateConfluence={handleCreateConfluence}
                    />
                  )}
                </>
              )}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex gap-3 max-w-4xl">
            <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-gradient-to-br from-violet-500 to-purple-600 text-white">
              <Bot className="w-4 h-4" />
            </div>
            <div className="bg-card border border-border rounded-2xl rounded-tl-sm px-4 py-3">
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>
                  {mode === "prd" ? "Generating PRD" : mode === "ticket" ? "Drafting ticket" : "Analyzing feedback data"}
                </span>
                <span className="flex gap-1">
                  <span className="w-1 h-1 bg-muted-foreground rounded-full typing-dot" />
                  <span className="w-1 h-1 bg-muted-foreground rounded-full typing-dot" />
                  <span className="w-1 h-1 bg-muted-foreground rounded-full typing-dot" />
                </span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {showSuggestions && messages.length <= 1 && (
        <div className="px-4 pb-2">
          <div className="grid grid-cols-2 gap-2 max-w-2xl mx-auto">
            {currentQueries.map((sq, i) => (
              <button
                key={i}
                onClick={() => sendMessage(sq.query)}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-border bg-card hover:bg-accent/50 transition-colors text-left group"
              >
                <sq.icon
                  className={cn("w-4 h-4 flex-shrink-0", sq.color)}
                />
                <div>
                  <div className="text-xs font-medium">{sq.label}</div>
                  <div className="text-[10px] text-muted-foreground line-clamp-1">
                    {sq.query}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="px-4 pb-4 pt-2">
        <div className="max-w-2xl mx-auto relative">
          <div className="flex items-end gap-2 bg-card border border-border rounded-2xl px-4 py-2 focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/40 transition-all">
            <Sparkles className="w-4 h-4 text-muted-foreground flex-shrink-0 mb-2" />
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholders[mode]}
              rows={1}
              className="flex-1 bg-transparent border-none outline-none resize-none text-sm placeholder:text-muted-foreground min-h-[36px] py-1.5"
            />
            <button
              onClick={() => sendMessage()}
              disabled={!input.trim() || isLoading}
              className={cn(
                "flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-all mb-0.5",
                input.trim() && !isLoading
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-muted text-muted-foreground"
              )}
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex items-center justify-center gap-3 mt-2 text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              {isAIConfigured ? aiProviderLabel : "Built-in"}
              {" · "}
              {mode === "summarize"
                ? `${keys.contextMode === "deep" ? "Deep" : keys.contextMode === "standard" ? "Standard" : "Focused"} context`
                : "Full context"
              }
            </span>
            {sessionTokens > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-muted font-mono">
                ~{sessionTokens > 1000 ? `${(sessionTokens / 1000).toFixed(1)}k` : sessionTokens} tokens this session
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

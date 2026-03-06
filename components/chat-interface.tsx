"use client";

import { useState, useRef, useEffect, KeyboardEvent } from "react";
import { useApiKeys } from "./api-key-provider";
import { ChatMessage } from "@/lib/types";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const SUGGESTED_QUERIES = [
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

interface ChatInterfaceProps {
  className?: string;
}

function fixMarkdown(text: string): string {
  if (!text.includes("|")) return text;

  let result = text;

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
    if (i > 0 && isPipeRow(lines[i - 1])) continue; // only inspect start of each table block

    let j = i;
    while (j < lines.length && isPipeRow(lines[j])) j++;

    const blockSize = j - i;
    if (blockSize < 2) continue;
    if (isSeparatorRow(lines[i + 1])) continue;

    const cols = columnCount(lines[i]);
    if (cols < 2) continue;
    lines.splice(i + 1, 0, `| ${Array.from({ length: cols }, () => "---").join(" | ")} |`);
    i++; // skip inserted separator
  }

  result = lines.join("\n");

  return result;
}

export function ChatInterface({ className }: ChatInterfaceProps) {
  const { keys, keyHeaders, useDemoData, status, hasAnyKey } = useApiKeys();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [sessionTokens, setSessionTokens] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const configuredSources: string[] = [];
    if (status.geminiKey.configured) configuredSources.push("Gemini AI");
    if (status.productboardKey.configured)
      configuredSources.push("Productboard");
    if (status.attentionKey.configured) configuredSources.push("Attention");
    if (status.pendoKey?.configured) configuredSources.push("Pendo");
    if (status.atlassianKey?.configured) configuredSources.push("Jira + Confluence");

    const sourceInfo =
      configuredSources.length > 0
        ? `\n\nConnected sources: **${configuredSources.join(", ")}**`
        : "";
    const demoInfo = useDemoData
      ? "\n\n*Currently showing demo data. You can manage API keys and data settings via the gear icon in the header.*"
      : !hasAnyKey
        ? "\n\n*No API keys configured and demo data is off. Open Settings (gear icon) to add keys or enable demo data.*"
        : "";

    setMessages([
      {
        id: "welcome",
        role: "assistant",
        content: `Welcome! I'm your **Customer Feedback Intelligence Agent**. I can analyze themes, identify churn risks, surface opportunities, and cross-reference data across all your feedback sources.${sourceInfo}${demoInfo}

Try one of the suggested queries below to get started.`,
        timestamp: new Date().toISOString(),
      },
    ]);
  }, [status, useDemoData, hasAnyKey]);

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

  async function sendMessage(text?: string) {
    const content = text || input.trim();
    if (!content || isLoading) return;

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
        .filter((m) => m.role !== "system")
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...keyHeaders,
        },
        body: JSON.stringify({
          message: content,
          history,
          useDemoData,
          contextMode: keys.contextMode || "focused",
        }),
      });

      const data = await res.json();

      if (data.tokenEstimate?.total > 0) {
        setSessionTokens((prev) => prev + data.tokenEstimate.total);
      }

      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: data.response,
        timestamp: new Date().toISOString(),
        sources: data.sources,
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: "assistant",
          content:
            "I encountered an error processing your request. Please try again.",
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  return (
    <div className={cn("flex flex-col h-full", className)}>
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
                <div className="prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {fixMarkdown(msg.content)}
                  </ReactMarkdown>
                </div>
              </div>
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
                <span>Analyzing feedback data</span>
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
            {SUGGESTED_QUERIES.map((sq, i) => (
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
              placeholder="Ask about customer feedback, churn risks, feature requests..."
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
            <span>
              {status.geminiKey.configured ? "Gemini AI" : "Built-in"}{" "}
              · {keys.contextMode === "deep" ? "Deep" : keys.contextMode === "standard" ? "Standard" : "Focused"} context
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
}

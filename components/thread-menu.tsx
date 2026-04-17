"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Thread, listThreads, saveThread, deleteThread, generateThreadTitle } from "@/lib/threads";
import { ChatMessage } from "@/lib/types";
import { InteractionMode } from "@/lib/agent";
import { History, Plus, Pencil, Trash2, ChevronDown, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ThreadMenuProps {
  currentMessages: ChatMessage[];
  currentMode: InteractionMode;
  currentThreadId: string | null;
  onLoadThread: (thread: Thread) => void;
  onNewThread: () => void;
  onSaveThread: () => void;
}

export function ThreadMenu({
  currentMessages,
  currentMode,
  currentThreadId,
  onLoadThread,
  onNewThread,
  onSaveThread,
}: ThreadMenuProps) {
  const [open, setOpen] = useState(false);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    const ts = await listThreads();
    setThreads(ts);
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  async function handleRename(id: string, newTitle: string) {
    const t = threads.find((t) => t.id === id);
    if (!t) return;
    await saveThread({ ...t, title: newTitle, updatedAt: new Date().toISOString() });
    setEditingId(null);
    refresh();
  }

  async function handleDelete(id: string) {
    await deleteThread(id);
    refresh();
  }

  const hasMessages = currentMessages.filter((m) => m.id !== "welcome" && m.role !== "system").length > 0;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        title="Thread history"
      >
        <History className="w-3.5 h-3.5" />
        Threads
        <ChevronDown className={cn("w-3 h-3 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-72 bg-popover border border-border rounded-xl shadow-xl z-50 overflow-hidden">
          <div className="px-3 py-2 border-b border-border flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Thread History</span>
            <div className="flex items-center gap-1">
              {hasMessages && (
                <button
                  onClick={() => { onSaveThread(); setOpen(false); }}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                >
                  <Check className="w-3 h-3" />
                  Save current
                </button>
              )}
              <button
                onClick={() => { onNewThread(); setOpen(false); }}
                className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-muted-foreground hover:bg-muted transition-colors"
              >
                <Plus className="w-3 h-3" />
                New
              </button>
            </div>
          </div>

          <div className="max-h-72 overflow-y-auto">
            {threads.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                No saved threads yet.
                <br />
                <span className="text-[10px]">Save this conversation to start.</span>
              </div>
            ) : (
              threads.map((t) => (
                <div
                  key={t.id}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 border-b border-border/50 hover:bg-accent/30 transition-colors group",
                    t.id === currentThreadId && "bg-primary/5"
                  )}
                >
                  {editingId === t.id ? (
                    <div className="flex-1 flex items-center gap-1">
                      <input
                        autoFocus
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleRename(t.id, editTitle);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        className="flex-1 text-xs bg-background border border-border rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-primary/20"
                      />
                      <button onClick={() => handleRename(t.id, editTitle)} className="text-primary hover:text-primary/80">
                        <Check className="w-3 h-3" />
                      </button>
                      <button onClick={() => setEditingId(null)} className="text-muted-foreground hover:text-foreground">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={() => { onLoadThread(t); setOpen(false); }}
                        className="flex-1 text-left"
                      >
                        <div className="text-xs font-medium line-clamp-1">{t.title || generateThreadTitle(t.messages)}</div>
                        <div className="text-[9px] text-muted-foreground mt-0.5">
                          {new Date(t.updatedAt).toLocaleDateString()} · {t.messages.length} msgs · {t.mode}
                        </div>
                      </button>
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => { setEditingId(t.id); setEditTitle(t.title || generateThreadTitle(t.messages)); }}
                          className="w-5 h-5 rounded hover:bg-muted flex items-center justify-center text-muted-foreground"
                        >
                          <Pencil className="w-2.5 h-2.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(t.id)}
                          className="w-5 h-5 rounded hover:bg-red-500/10 flex items-center justify-center text-muted-foreground hover:text-red-500"
                        >
                          <Trash2 className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useState, useRef, useEffect } from "react";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

interface Source {
  type: string;
  id: string;
  title: string;
  url?: string;
}

interface CitationMarkerProps {
  index: number;
  sources: Source[];
}

export function CitationMarker({ index, sources }: CitationMarkerProps) {
  const source = sources[index - 1];
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  if (!source) {
    return (
      <sup className="text-[9px] font-medium text-muted-foreground px-0.5 rounded cursor-default">[{index}]</sup>
    );
  }

  const typeColors: Record<string, string> = {
    feedback: "bg-blue-500/10 text-blue-600",
    feature: "bg-green-500/10 text-green-600",
    call: "bg-amber-500/10 text-amber-600",
    jira: "bg-orange-500/10 text-orange-600",
    linear: "bg-violet-500/10 text-violet-600",
    confluence: "bg-cyan-500/10 text-cyan-600",
    pendo: "bg-fuchsia-500/10 text-fuchsia-600",
    amplitude: "bg-fuchsia-500/10 text-fuchsia-600",
    posthog: "bg-fuchsia-500/10 text-fuchsia-600",
    insight: "bg-purple-500/10 text-purple-600",
  };
  const colorClass = typeColors[source.type] || "bg-muted text-muted-foreground";

  return (
    <span ref={ref} className="relative inline-block align-super">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "text-[9px] font-bold px-1 py-0.5 rounded cursor-pointer hover:opacity-80 transition-opacity",
          colorClass
        )}
        title={source.title}
      >
        {index}
      </button>
      {open && (
        <span className="absolute bottom-full left-0 mb-1 z-50 w-56 rounded-lg border border-border bg-popover shadow-lg p-2.5 text-left block">
          <span className={cn("text-[8px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded", colorClass)}>
            {source.type}
          </span>
          <span className="block text-[11px] font-medium mt-1 leading-snug line-clamp-2">{source.title}</span>
          {source.url && source.url !== "#" && (
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1.5 flex items-center gap-1 text-[10px] text-primary hover:underline"
            >
              <ExternalLink className="w-2.5 h-2.5" />
              Open source
            </a>
          )}
        </span>
      )}
    </span>
  );
}


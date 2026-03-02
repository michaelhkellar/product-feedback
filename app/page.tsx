"use client";

import { useState, useRef } from "react";
import { ApiKeyProvider } from "@/components/api-key-provider";
import { ChatInterface } from "@/components/chat-interface";
import { InsightsPanel } from "@/components/insights-panel";
import { SourcePanel } from "@/components/source-panel";
import { SettingsDialog } from "@/components/settings-dialog";
import {
  Bot,
  PanelLeftClose,
  PanelRightClose,
  PanelLeft,
  PanelRight,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";

function AppContent() {
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const chatRef = useRef<{ sendMessage: (msg: string) => void }>(null);

  function handleQueryFromPanel(query: string) {
    const textarea = document.querySelector("textarea");
    if (textarea) {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value"
      )?.set;
      nativeInputValueSetter?.call(textarea, query);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      setTimeout(() => {
        const sendBtn = textarea
          .closest("div")
          ?.querySelector("button:last-child");
        if (sendBtn) (sendBtn as HTMLButtonElement).click();
      }, 100);
    }
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      <header className="h-14 border-b border-border flex items-center justify-between px-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
            <Bot className="w-4.5 h-4.5 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-semibold leading-none">
              Feedback Intelligence Agent
            </h1>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Powered by RAG · Productboard · Attention · Gemini
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setSettingsOpen(true)}
            className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
            title="API Key Settings"
          >
            <Settings className="w-4 h-4" />
          </button>
          <div className="w-px h-5 bg-border" />
          <div className="flex items-center gap-1">
            <button
              onClick={() => setLeftOpen(!leftOpen)}
              className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
              title="Toggle data sources"
            >
              {leftOpen ? (
                <PanelLeftClose className="w-4 h-4" />
              ) : (
                <PanelLeft className="w-4 h-4" />
              )}
            </button>
            <button
              onClick={() => setRightOpen(!rightOpen)}
              className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
              title="Toggle insights"
            >
              {rightOpen ? (
                <PanelRightClose className="w-4 h-4" />
              ) : (
                <PanelRight className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <div
          className={cn(
            "border-r border-border flex-shrink-0 relative overflow-hidden transition-all duration-300",
            leftOpen ? "w-80" : "w-0"
          )}
        >
          <SourcePanel
            className="w-80"
            onQuerySource={handleQueryFromPanel}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        </div>

        <div className="flex-1 min-w-0">
          <ChatInterface />
        </div>

        <div
          className={cn(
            "border-l border-border flex-shrink-0 relative overflow-hidden transition-all duration-300",
            rightOpen ? "w-80" : "w-0"
          )}
        >
          <InsightsPanel
            className="w-80"
            onQueryInsight={handleQueryFromPanel}
          />
        </div>
      </div>

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}

export default function Home() {
  return (
    <ApiKeyProvider>
      <AppContent />
    </ApiKeyProvider>
  );
}

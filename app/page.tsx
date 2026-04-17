"use client";

import { useState, useRef } from "react";
import { ApiKeyProvider, useApiKeys } from "@/components/api-key-provider";
import { ChatInterface, ChatInterfaceHandle } from "@/components/chat-interface";
import { InsightsPanel } from "@/components/insights-panel";
import { SourcePanel } from "@/components/source-panel";
import { SettingsDialog } from "@/components/settings-dialog";
import { EntityDrawerProvider } from "@/components/entity-drawer-provider";
import { EntityDrawer } from "@/components/entity-drawer";
import { FilterProvider, useFilters } from "@/components/filter-provider";
import { FilterBar } from "@/components/filter-bar";
import {
  Bot,
  PanelLeftClose,
  PanelRightClose,
  PanelLeft,
  PanelRight,
  Settings,
  SlidersHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";

function AppContent() {
  const { status, keys } = useApiKeys();
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const chatRef = useRef<ChatInterfaceHandle>(null);
  const { filters, filtersVisible, toggleFiltersVisible } = useFilters();
  const hasActiveFilters = filters.timeRange !== "all" || filters.themes.length > 0;

  function handleQueryFromPanel(query: string) {
    chatRef.current?.sendMessage(query);
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
              {(() => {
                const sources = [
                  status.productboardKey.configured && "Productboard",
                  status.attentionKey.configured && "Attention",
                  status.pendoKey?.configured && "Pendo",
                  status.amplitudeKey?.configured && "Amplitude",
                  status.posthogKey?.configured && "PostHog",
                  status.atlassianKey?.configured && "Atlassian",
                  status.linearKey?.configured && "Linear",
                ].filter(Boolean) as string[];
                const ai = keys.aiProvider === "anthropic" ? "Anthropic"
                  : keys.aiProvider === "openai" ? "OpenAI"
                  : "Gemini";
                return ["RAG", ...sources, ai].join(" · ");
              })()}
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
          <div className="relative">
            <button
              onClick={toggleFiltersVisible}
              className={cn(
                "w-8 h-8 rounded-lg flex items-center justify-center transition-colors",
                filtersVisible
                  ? "bg-primary/10 text-primary hover:bg-primary/20"
                  : "hover:bg-muted text-muted-foreground hover:text-foreground"
              )}
              title="Toggle filters"
            >
              <SlidersHorizontal className="w-4 h-4" />
            </button>
            {hasActiveFilters && (
              <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-primary" />
            )}
          </div>
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

      {filtersVisible && <FilterBar />}

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
          <ChatInterface ref={chatRef} />
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
      <EntityDrawer onQueryEntity={handleQueryFromPanel} />
    </div>
  );
}

export default function Home() {
  return (
    <ApiKeyProvider>
      <FilterProvider>
        <EntityDrawerProvider>
          <AppContent />
        </EntityDrawerProvider>
      </FilterProvider>
    </ApiKeyProvider>
  );
}

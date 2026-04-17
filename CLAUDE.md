# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start Next.js dev server (http://localhost:3000)
npm run build    # Production build
npm run lint     # ESLint via Next.js
```

No test suite is configured.

## Environment Setup

Copy `.env.example` to `.env.local`. The app works without any keys (uses demo data). To enable live data, set keys for any combination of:
- **AI**: `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, or `OPENAI_API_KEY`
- **Feedback**: `PRODUCTBOARD_API_KEY`, `ATTENTION_API_KEY`
- **Analytics**: `PENDO_INTEGRATION_KEY`, `AMPLITUDE_API_KEY`/`AMPLITUDE_SECRET_KEY`, `POSTHOG_API_KEY`/`POSTHOG_PROJECT_ID`
- **Tickets**: `JIRA_*` vars, `LINEAR_API_KEY`

Client-entered keys are stored in encrypted IndexedDB (AES-GCM via SubtleCrypto) and transmitted via request headers. Server-side env vars are a fallback for deployment.

## Architecture

Next.js 14 App Router. Three-panel UI (`app/page.tsx`) — sources sidebar, chat center, insights right panel — backed by API routes.

### Request Path

1. User sends message in `components/chat-interface.tsx`
2. POST `/api/chat` with message, history, mode (`summarize` | `prd` | `ticket`), and accumulated source IDs
3. `lib/data-fetcher.ts` aggregates live data (or demo fallback). Results are cached in-memory for 5 min keyed by SHA256 of API key combination.
4. `lib/vector-store.ts` builds an in-memory TF-IDF index over feedback, features, calls, issues, Confluence pages
5. `lib/agent.ts` classifies query intent, extracts time ranges, retrieves top-K docs, builds a mode-aware system prompt, dispatches to AI provider
6. `lib/ai-provider.ts` routes to Gemini / Anthropic / OpenAI via a shared `generate()` interface
7. Response includes bold highlights, citation markers (`[n]`), and adaptive formatting

### Key Abstractions

**AI Providers** (`lib/ai-provider.ts`) — Gemini, Anthropic, OpenAI all implement `{ generate, listModels, isConfigured, getActiveModel }`. Switch provider via settings UI or env vars.

**Analytics Providers** (`lib/pendo.ts`, `lib/amplitude.ts`, `lib/posthog.ts`) — each exposes `getOverview()`, `getRelevantContext(query)`, `getFullAnalytics(entityNames, days)`.

**Ticket Providers** (`lib/ticket-provider.ts`) — Jira (markdown → Atlassian Document Format) and Linear (markdown). Both sanitize content before write to strip injection patterns.

**Vector Store** (`lib/vector-store.ts`) — pure in-memory TF-IDF, no external service. Rebuilt on each request from the cached data payload.

### Agent Behavior

- **Query classification**: detects list / count / comparison / conversational / detailed intent via keyword matching and adjusts response format constraints accordingly
- **Context modes** (summarize only): Focused (~200 tokens), Standard (~500), Deep (full history + all sources). PRD and Ticket modes always use full context.
- **Pivot detection**: phrases like "what else?" exclude recently mentioned entities from the next retrieval pass
- **Time range extraction**: parses natural language ("last 30 days", "Q1", "since March") into absolute date windows

### Write Flows

All external writes (tickets, Confluence pages) go through a preview → edit → confirm flow in the UI before any API call. Write endpoints (`/api/tickets`, `/api/documents`) enforce per-client rate limiting (2–10 sec cooldowns).

### Client-Side Persistence

- **Threads** (`lib/threads.ts`): full conversation history in IndexedDB, auto-titled via AI
- **Pins** (`lib/pins.ts`): pinned insights in IndexedDB
- **Snapshots** (`lib/insight-snapshots.ts`): daily insight snapshots for trend arrows and "New" badges
- **Filters**: time range, sentiment, themes persisted to localStorage

### Middleware

`middleware.ts` enforces optional HTTP Basic Auth. Fail-closed: if any auth env keys are set, a password must also be configured or all requests are blocked.

## Adding a New Provider

To add an AI, analytics, or ticket provider:
1. Implement the relevant interface in `lib/` (mirror an existing provider file)
2. Register it in the dispatch switch in `lib/ai-provider.ts` or the relevant aggregator
3. Add env var docs to `.env.example`
4. Surface the option in `components/settings-modal.tsx`

# Customer Feedback Intelligence Agent

An AI-powered feedback intelligence platform that aggregates customer feedback from Productboard and Attention — then lets you query it through a conversational agent with built-in RAG (Retrieval-Augmented Generation). Supports three interaction modes: **Summarize** feedback, **Write PRDs** (product pitches), and **Write Tickets** — with configurable AI, analytics, and ticket providers. Connects to Pendo, Amplitude, or PostHog for product analytics, and Jira or Linear for issue tracking (read and write).

> Demo data in this repository is synthetic and intentionally fictionalized for safe demos and public code sharing.

## What's New

- **Richer AI context** — feature descriptions, Jira/Linear issue details, and call key moments (with negative-sentiment prioritization) now flow into the AI context, giving it substantially more signal to reason from
- **Sentiment-weighted themes** — the Insights panel now ranks themes by urgency (negative mentions weighted 1.5×), surfacing pain points above popularity
- **Emerging trend detection** — new insight rule flags themes that doubled in the last 14 days vs. the prior 14, and highlights declining themes that may indicate a fix took hold
- **Stale commitment detection** — new insight rule flags Jira/Linear issues stuck in "planned" or "in-progress" for 90+ days with customer feedback overlap
- **Account signal annotation** — when multiple feedback items from the same company appear in evidence, they're annotated `(1 of N from Company)` so the AI correctly treats them as one customer voice
- **Live Gemini model list** — the Gemini model dropdown now fetches available models directly from the Google AI API (with fallback), so new models appear without a code change
- **Complete connection status** — the "What's connected" indicator in the Sources panel now shows all 10 integrations (Gemini, Anthropic, OpenAI, Productboard, Attention, Pendo, Amplitude, PostHog, Atlassian, Linear)
- **Linear in AI insights** — Linear issues now included in the AI-generated insights prompt alongside Jira
- **Conversation threads** — save, name, and resume previous chat sessions via the thread history menu
- **Inline citations** — every AI claim links back to its source with `[n]` markers; hover to preview
- **Entity drawer** — click any customer or feature name in the chat to open a side panel with their full history, analytics context, and sentiment breakdown
- **Global filter bar** — scope the entire app by time range, sentiment, or theme; persists across sessions
- **Pivot detection** — say "ConnectWise is in progress, what else?" and the agent correctly shifts focus to other topics
- **Bold highlights** — the AI bolds 1–3 key facts per response (counts, risks, dates) for at-a-glance scanning
- **Pinned insights** — pin any insight card in the Insights panel to surface it first
- **Answer provenance** — open the trace modal on any message to see which query type was chosen, which sources were retrieved, and why

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                       Next.js Frontend                           │
│  ┌──────────┐  ┌────────────────────┐  ┌──────────────────────┐ │
│  │  Source   │  │  Chat Agent        │  │  Insights Panel      │ │
│  │  Panel    │  │  Interface         │  │  (Live Analysis)     │ │
│  │          │  │  ┌──────────────┐  │  │                      │ │
│  │          │  │  │ Mode Tabs:   │  │  │                      │ │
│  │          │  │  │ Summarize    │  │  │                      │ │
│  │          │  │  │ Write PRD    │  │  │                      │ │
│  │          │  │  │ Write Ticket │  │  │                      │ │
│  │          │  │  └──────────────┘  │  │                      │ │
│  └──────────┘  └────────────────────┘  └──────────────────────┘ │
├──────────────────────────────────────────────────────────────────┤
│                       API Layer                                  │
│  /api/chat  ·  /api/insights  ·  /api/sources/*                 │
│  /api/tickets  ·  /api/documents  ·  /api/settings/*            │
├──────────────────────────────────────────────────────────────────┤
│                Provider Abstraction Layer                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  AI Providers         │  Analytics     │  Tickets        │   │
│  │  ├─ Google Gemini     │  ├─ Pendo      │  ├─ Jira (R/W)  │   │
│  │  ├─ Anthropic Claude  │  ├─ Amplitude  │  └─ Linear (R/W)│   │
│  │  └─ OpenAI GPT       │  └─ PostHog    │                  │   │
│  └──────────────────────────────────────────────────────────┘   │
├──────────────────────────────────────────────────────────────────┤
│                   Intelligence Layer                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ TF-IDF Vector│  │  AI Provider │  │  Built-in Agent      │  │
│  │ Store (RAG)  │  │  (Dispatch)  │  │  (Fallback)          │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
├──────────────────────────────────────────────────────────────────┤
│              Data Source Integrations                             │
│  Productboard  ·  Attention  ·  Jira  ·  Linear  ·  Demo Data  │
│  Pendo  ·  Amplitude  ·  PostHog  ·  Confluence                 │
├──────────────────────────────────────────────────────────────────┤
│              Write Path (Preview → Confirm → Create)            │
│  Jira Issues  ·  Linear Issues  ·  Confluence Pages             │
└──────────────────────────────────────────────────────────────────┘
```

## Features

### Core Intelligence
- **RAG Agent**: TF-IDF vector store indexes all feedback, features, calls, Jira issues, Linear issues, and insights for semantic search
- **Deep Context**: Feature descriptions, Jira/Linear issue details, and call key moments (negative-sentiment first) all flow into AI context — not just titles and summaries
- **Multi-Provider AI**: Choose between Google Gemini, Anthropic Claude, or OpenAI GPT — with live model lists fetched from each provider's API
- **Cross-Source Intelligence**: Links feedback to features to calls — surfaces revenue impact, churn risk, and competitive signals
- **Catalog Awareness**: The AI knows about all tracked pages, features, and events across analytics providers — not just the top 10
- **Targeted Lookups**: Ask about a specific feature or event by name and the agent runs scoped queries against Pendo, Amplitude, or PostHog to retrieve its usage data
- **Time Scoping**: Natural language time ranges ("last 30 days", "Q1", "since March") scope feedback, analytics, and ticket data — with period comparison support
- **Token Optimization**: Context budgeting, deduplication, and adaptive response formatting to manage AI costs
- **Rich Demo Data**: 12 synthetic feedback items, 8 Productboard features, 4 Attention calls, 6 pre-computed insights — all ready to explore without any API keys. Demo data auto-disables when real data source keys are configured

### Interaction Modes
- **Summarize**: Query and analyze feedback with configurable context depth (quick, balanced, or full)
- **Write PRD**: Generate product pitches using a blended methodology from Shape Up, Front's 1-Pager, Figma's PRD process, and Cutler's one-pager principles — with preview, edit, copy, download, and Confluence publish
- **Write Ticket**: Generate structured engineering tickets with problem-first framing, scope boundaries, and rabbit holes — with preview, edit, and creation via Jira or Linear

### Data Sources
- **Productboard Integration**: Pull features and notes directly from the Productboard API
- **Attention Integration**: Pull call recordings, summaries, and action items from Attention
- **Pendo Analytics**: Full catalog awareness, targeted feature/page lookups by name, track event aggregation, visitor/account history, 30-day default window with on-demand deep dives (up to 500 items)
- **Amplitude Analytics**: Event analytics, user behavior data, targeted event lookups by name, full event catalog
- **PostHog Analytics**: HogQL-powered queries, event/page analytics, targeted lookups, full catalog
- **Jira Integration**: Pull all issues (open and closed) for cross-referencing; create new issues; Confluence page search and publishing
- **Linear Integration**: Pull issues via GraphQL (up to 1000, with team filtering and pagination); create tickets from generated content

### Write Capabilities
- **Ticket Creation**: Create Jira or Linear issues from AI-generated tickets with a preview/edit step before submission
- **PRD Publishing**: Push generated PRDs to Confluence as wiki pages, or copy/download as markdown
- **Content Sanitization**: All content is sanitized before writing to external systems to prevent injection attacks
- **Rate Limiting**: Write endpoints enforce rate limits to prevent abuse

### Conversation & Navigation
- **Conversation Threads**: Save, name, rename, and reload past chat sessions — stored locally in IndexedDB via a thread history dropdown
- **Entity Drawer**: Click any customer or feature name in a chat response to open a detail panel with feedback history, analytics context, and a sentiment breakdown
- **Inline Citations**: Every factual claim includes a numbered `[n]` marker; hover to preview the source without leaving the chat
- **Answer Provenance**: Every message has a trace button that shows which query type the agent chose, which documents were retrieved, and any pivot/exclusion decisions
- **Pivot Detection**: Phrases like "ConnectWise is in progress, what else?" are detected and the agent excludes the mentioned entity from retrieval, giving diverse results
- **Progressive Disclosure**: Long responses wrap distinct sub-topics in collapsible `<details>` blocks to reduce visual noise

### Layout & UX
- **Three-Panel Layout**: Data sources (left), chat agent (center), live insights (right)
- **Global Filter Bar**: Scope all panels simultaneously by time range, sentiment, and/or theme — persisted to localStorage
- **Pinned Insights**: Pin important insight cards to keep them pinned to the top of the Insights panel
- **Change Detection**: Insight cards show trend arrows and "New" / "Changed" badges when data shifts day-over-day
- **Bold Highlights**: The AI bolds 1–3 key facts per response (counts, risks, pivotal dates) for fast scanning
- **Smarter Tables**: A Source / What / When table is automatically included whenever an answer enumerates 3+ concrete items — even mid-conversation
- **Preview & Edit**: All generated PRDs and tickets include a preview step with inline editing before creation
- **Data Transparency**: Active AI provider and model displayed in the chat interface
- **v0-Ready**: Built with Next.js 14 + Tailwind + shadcn-style components, designed to run in Vercel's v0

## Quick Start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The app works immediately with demo data — no API keys required.

## Environment Variables

Copy `.env.example` to `.env.local` and add your keys:

```bash
cp .env.example .env.local
```

### AI Providers (configure at least one for AI-powered responses)

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | Optional | Google Gemini API key |
| `ANTHROPIC_API_KEY` | Optional | Anthropic Claude API key |
| `OPENAI_API_KEY` | Optional | OpenAI GPT API key |

### Data Sources

| Variable | Required | Description |
|----------|----------|-------------|
| `PRODUCTBOARD_API_TOKEN` | Optional | Pulls live features/notes from Productboard (falls back to demo data) |
| `ATTENTION_API_KEY` | Optional | Pulls live call data from Attention (falls back to demo data) |

### Analytics Providers (configure one)

| Variable | Required | Description |
|----------|----------|-------------|
| `PENDO_INTEGRATION_KEY` | Optional | Enables Pendo usage insights, feature/page lookups, and visitor/account history |
| `AMPLITUDE_API_KEY` | Optional | Amplitude analytics (format: `apiKey:secretKey`) |
| `POSTHOG_API_KEY` | Optional | PostHog analytics (format: `apiKey:projectId`) |
| `POSTHOG_HOST` | Optional | PostHog instance URL (defaults to `https://app.posthog.com`) |

### Ticket & Issue Providers

| Variable | Required | Description |
|----------|----------|-------------|
| `ATLASSIAN_DOMAIN` | Optional | Atlassian instance domain (enables Jira + Confluence read/write) |
| `ATLASSIAN_EMAIL` | Optional | Atlassian account email for Jira/Confluence access |
| `ATLASSIAN_API_TOKEN` | Optional | Atlassian API token for Jira/Confluence access |
| `LINEAR_API_KEY` | Optional | Linear API key (enables issue reading and ticket creation) |

### Authentication

| Variable | Required | Description |
|----------|----------|-------------|
| `APP_BASIC_AUTH_USERNAME` | Optional | Username for HTTP Basic Auth (default: `viewer`) |
| `APP_BASIC_AUTH_PASSWORD` | Optional | If set, requires HTTP Basic Auth for the app and all API routes |

All keys can also be configured at runtime through the in-app Settings dialog with encrypted client-side storage.

## Deploying to v0 / Vercel

This project is structured as a standard Next.js 14 app and can be deployed directly:

1. Push to GitHub
2. Import into Vercel (or paste components into v0)
3. Add environment variables in the Vercel dashboard
4. Deploy

### Public Deployment Safety

If you deploy this app publicly and connect real data sources:

- **Set `APP_BASIC_AUTH_PASSWORD`** to require HTTP Basic Auth — this is especially important now that the app has write capabilities (ticket creation, Confluence publishing)
- **Avoid exposing live provider credentials** in an unauthenticated environment
- **Be aware that write endpoints** (`/api/tickets`, `/api/documents`) create real issues and pages in your connected systems; they are rate-limited but not separately authenticated beyond Basic Auth
- **Content sanitization** is applied to all write operations, but defense-in-depth with authentication is strongly recommended
- The app surfaces customer feedback, tickets, docs, and usage context — treat it as sensitive data

## Try These Queries

Once the app is running, try asking the agent:

### Summarize Mode
- "What accounts are at risk of churning?"
- "Show me all feedback from enterprise accounts in the last 30 days"
- "What's happening with SSO — who's affected and what's the revenue impact?"
- "Tell me about the AI competitive gap"
- "Which customers are asking about reporting?"
- "ConnectWise is in progress — what else do you have?" *(pivot detection)*
- "Any churn risks I should know about this week?"

### Write PRD Mode
- "Write a PRD for the SSO issues our enterprise customers are facing"
- "Create a pitch for improving the onboarding experience based on recent feedback"
- "Draft a PRD addressing the reporting gaps customers keep mentioning"

### Write Ticket Mode
- "Create a ticket for the SSO login failure that's affecting enterprise accounts"
- "Write a ticket to address the most commonly reported bug"
- "Draft tickets for the top 3 feature requests from this quarter"

## Project Structure

```
├── app/
│   ├── api/
│   │   ├── chat/route.ts                   # Chat endpoint (agent + RAG, mode-aware)
│   │   ├── documents/route.ts              # Confluence page creation (rate-limited)
│   │   ├── entity/route.ts                 # Entity detail lookups (feedback + analytics)
│   │   ├── insights/route.ts               # Pre-computed + AI insights (time-filtered)
│   │   ├── tickets/route.ts                # Jira/Linear ticket creation (rate-limited)
│   │   ├── settings/
│   │   │   ├── atlassian-resources/route.ts # Fetch Jira projects & Confluence spaces
│   │   │   ├── invalidate-cache/route.ts   # Clear cached data on config change
│   │   │   ├── linear-teams/route.ts       # Fetch Linear teams for team selector
│   │   │   ├── models/route.ts             # Dynamic AI model list per provider
│   │   │   ├── status/route.ts             # API key status check
│   │   │   └── validate/route.ts           # API key validation (all providers)
│   │   └── sources/
│   │       ├── atlassian/route.ts          # Jira ticket source
│   │       ├── attention/route.ts          # Attention call data
│   │       ├── pendo/route.ts              # Pendo analytics
│   │       └── productboard/route.ts       # Productboard features/notes
│   ├── layout.tsx
│   ├── page.tsx                            # Three-panel layout
│   └── globals.css                         # Tailwind + dark theme
├── components/
│   ├── api-key-provider.tsx                # Encrypted client-side key storage
│   ├── chat-interface.tsx                  # Chat UX, mode tabs, citations, entity spans, threads
│   ├── citation-marker.tsx                 # Inline [n] citation markers with hover preview
│   ├── entity-drawer.tsx                   # Detail panel for customer/feature entities
│   ├── entity-drawer-provider.tsx          # Context for cross-panel entity navigation
│   ├── filter-bar.tsx                      # Global filter bar (time, sentiment, theme)
│   ├── filter-provider.tsx                 # Filter state context + localStorage persistence
│   ├── insights-panel.tsx                  # Live insights with filtering and pinned cards
│   ├── settings-dialog.tsx                 # Provider & model configuration
│   ├── source-panel.tsx                    # Data sources browser (filter-aware)
│   ├── sparkline.tsx                       # Reusable SVG sparkline + SentimentBar components
│   ├── thread-menu.tsx                     # Conversation thread history dropdown
│   └── trace-modal.tsx                     # Answer provenance / agent trace viewer
├── lib/
│   ├── agent.ts                            # Core agent logic, prompts, RAG, pivot detection
│   ├── ai-provider.ts                      # AI provider abstraction (Gemini/Anthropic/OpenAI)
│   ├── amplitude.ts                        # Amplitude analytics client (overview + targeted lookups)
│   ├── api-keys.ts                         # Client-side key management & header building
│   ├── atlassian.ts                        # Jira + Confluence API client (read/write)
│   ├── attention.ts                        # Attention API client
│   ├── data-fetcher.ts                     # Data aggregation + caching layer
│   ├── demo-data.ts                        # Rich synthetic demo dataset
│   ├── gemini.ts                           # Gemini API client
│   ├── insight-snapshots.ts                # Daily insight snapshots + change detection
│   ├── insights-generator.ts               # Programmatic + AI insight generation
│   ├── linear.ts                           # Linear API client (issue reading + ticket creation)
│   ├── pendo.ts                            # Pendo API client (overview + targeted lookups)
│   ├── pins.ts                             # IndexedDB storage for pinned insight IDs
│   ├── posthog.ts                          # PostHog analytics client (HogQL queries)
│   ├── productboard.ts                     # Productboard API client
│   ├── temporal.ts                         # Time-series aggregation for sparklines
│   ├── threads.ts                          # IndexedDB conversation thread storage
│   ├── ticket-provider.ts                  # Ticket provider abstraction + sanitization
│   ├── types.ts                            # TypeScript types
│   ├── utils.ts                            # Tailwind utilities
│   └── vector-store.ts                     # In-memory TF-IDF vector store
├── middleware.ts                            # Basic Auth middleware
├── .env.example
└── package.json
```

## Security

### Content Sanitization
All user-generated and AI-generated content is sanitized before being written to external systems (Jira, Linear, Confluence). The sanitization layer in `lib/ticket-provider.ts` strips potentially dangerous content while preserving markdown formatting.

### Rate Limiting
Write endpoints (`/api/tickets`, `/api/documents`) and the chat endpoint enforce in-memory per-client rate limiting to prevent abuse. Rate limit maps include TTL-based eviction to prevent unbounded memory growth. Requests exceeding the limit receive a `429 Too Many Requests` response. Client identity is derived from the connection IP, not from the `x-forwarded-for` header, to prevent spoofing.

### Data Transparency
The chat interface displays the active AI provider and model name so users always know where their data is being sent. The Settings dialog includes notices when selecting AI providers about data being transmitted to third-party services.

### API Key Storage
When keys are configured through the in-app Settings dialog (rather than environment variables), they are stored in encrypted IndexedDB on the client side and transmitted via request headers — never persisted server-side.

### Authentication
Optional HTTP Basic Auth can be enabled via `APP_BASIC_AUTH_PASSWORD` to protect the entire application and all API routes. This is strongly recommended for any deployment connected to real data sources, especially given the write capabilities.

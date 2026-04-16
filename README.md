# Customer Feedback Intelligence Agent

An AI-powered feedback intelligence platform that aggregates customer feedback from Productboard, Attention, Zendesk, Intercom, and Slack — then lets you query it through a conversational agent with built-in RAG (Retrieval-Augmented Generation). Supports three interaction modes: **Summarize** feedback, **Write PRDs** (product pitches), and **Write Tickets** — with configurable AI, analytics, and ticket providers.

> Demo data in this repository is synthetic and intentionally fictionalized for safe demos and public code sharing.

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
│  │  ├─ Google Gemini     │  ├─ Pendo      │  ├─ Jira        │   │
│  │  ├─ Anthropic Claude  │  └─ Amplitude  │  └─ Linear      │   │
│  │  └─ OpenAI GPT       │               │                  │   │
│  └──────────────────────────────────────────────────────────┘   │
├──────────────────────────────────────────────────────────────────┤
│                   Intelligence Layer                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ TF-IDF Vector│  │  AI Provider │  │  Built-in Agent      │  │
│  │ Store (RAG)  │  │  (Dispatch)  │  │  (Fallback)          │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
├──────────────────────────────────────────────────────────────────┤
│              Data Source Integrations                             │
│  Productboard API  ·  Attention API  ·  Jira API  ·  Demo Data │
├──────────────────────────────────────────────────────────────────┤
│              Write Path (Preview → Confirm → Create)            │
│  Jira Issues  ·  Linear Issues  ·  Confluence Pages             │
└──────────────────────────────────────────────────────────────────┘
```

## Features

### Core Intelligence
- **RAG Agent**: TF-IDF vector store indexes all feedback, features, calls, and insights for semantic search
- **Multi-Provider AI**: Choose between Google Gemini, Anthropic Claude, or OpenAI GPT — with dynamic model selection per provider
- **Cross-Source Intelligence**: Links feedback to features to calls — surfaces revenue impact, churn risk, and competitive signals
- **Rich Demo Data**: 12 synthetic feedback items, 8 Productboard features, 4 Attention calls, 6 pre-computed insights — all ready to explore without any API keys

### Interaction Modes
- **Summarize**: Query and analyze feedback with configurable context depth (quick, balanced, or full)
- **Write PRD**: Generate product pitches using a blended methodology from Shape Up, Front's 1-Pager, Figma's PRD process, and Cutler's one-pager principles — with preview, edit, copy, download, and Confluence publish
- **Write Ticket**: Generate structured engineering tickets with problem-first framing, scope boundaries, and rabbit holes — with preview, edit, and creation via Jira or Linear

### Data Sources
- **Productboard Integration**: Pull features and notes directly from the Productboard API
- **Attention Integration**: Pull call recordings, summaries, and action items from Attention
- **Pendo Analytics**: Usage insights and on-demand visitor/account history
- **Amplitude Analytics**: Event analytics and user behavior data
- **Jira Integration**: Pull existing tickets for cross-referencing; create new issues
- **Linear Integration**: Create tickets directly from generated content

### Write Capabilities
- **Ticket Creation**: Create Jira or Linear issues from AI-generated tickets with a preview/edit step before submission
- **PRD Publishing**: Push generated PRDs to Confluence as wiki pages, or copy/download as markdown
- **Content Sanitization**: All content is sanitized before writing to external systems to prevent injection attacks
- **Rate Limiting**: Write endpoints enforce rate limits to prevent abuse

### Layout & UX
- **Three-Panel Layout**: Data sources (left), chat agent (center), live insights (right)
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
| `PENDO_INTEGRATION_KEY` | Optional | Enables Pendo usage insights and on-demand visitor/account history |
| `AMPLITUDE_API_KEY` | Optional | Amplitude analytics (format: `apiKey:secretKey`) |

### Ticket Providers

| Variable | Required | Description |
|----------|----------|-------------|
| `ATLASSIAN_DOMAIN` | Optional | Atlassian instance domain (enables Jira + Confluence read/write) |
| `ATLASSIAN_EMAIL` | Optional | Atlassian account email for Jira/Confluence access |
| `ATLASSIAN_API_TOKEN` | Optional | Atlassian API token for Jira/Confluence access |
| `LINEAR_API_KEY` | Optional | Linear API key (enables Linear ticket creation) |

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
- "Give me an executive summary of all feedback"
- "What's happening with SSO — who's affected and what's the revenue impact?"
- "Tell me about the AI competitive gap"

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
│   │   ├── insights/route.ts               # Pre-computed + AI insights
│   │   ├── tickets/route.ts                # Jira/Linear ticket creation (rate-limited)
│   │   ├── settings/
│   │   │   ├── atlassian-resources/route.ts # Fetch Jira projects & Confluence spaces
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
│   ├── chat-interface.tsx                  # Chat UX, mode tabs, preview/edit flows
│   ├── insights-panel.tsx                  # Live insights with filtering
│   ├── settings-dialog.tsx                 # Provider & model configuration
│   └── source-panel.tsx                    # Data sources browser
├── lib/
│   ├── agent.ts                            # Core agent logic, prompts, RAG orchestration
│   ├── ai-provider.ts                      # AI provider abstraction (Gemini/Anthropic/OpenAI)
│   ├── amplitude.ts                        # Amplitude analytics client
│   ├── api-keys.ts                         # Client-side key management & header building
│   ├── atlassian.ts                        # Jira + Confluence API client (read/write)
│   ├── attention.ts                        # Attention API client
│   ├── data-fetcher.ts                     # Data aggregation + caching layer
│   ├── demo-data.ts                        # Rich synthetic demo dataset
│   ├── gemini.ts                           # Gemini API client
│   ├── insights-generator.ts              # Programmatic + AI insight generation
│   ├── linear.ts                           # Linear API client (ticket creation)
│   ├── pendo.ts                            # Pendo API client
│   ├── productboard.ts                     # Productboard API client
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
Write endpoints (`/api/tickets` and `/api/documents`) enforce in-memory rate limiting to prevent abuse. Requests exceeding the limit receive a `429 Too Many Requests` response.

### Data Transparency
The chat interface displays the active AI provider and model name so users always know where their data is being sent. The Settings dialog includes notices when selecting AI providers about data being transmitted to third-party services.

### API Key Storage
When keys are configured through the in-app Settings dialog (rather than environment variables), they are stored in encrypted IndexedDB on the client side and transmitted via request headers — never persisted server-side.

### Authentication
Optional HTTP Basic Auth can be enabled via `APP_BASIC_AUTH_PASSWORD` to protect the entire application and all API routes. This is strongly recommended for any deployment connected to real data sources, especially given the write capabilities.

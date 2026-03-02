# Customer Feedback Intelligence Agent

An AI-powered feedback intelligence platform that aggregates customer feedback from Productboard, Attention, Zendesk, Intercom, and Slack — then lets you query it through a conversational agent with built-in RAG (Retrieval-Augmented Generation).

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Next.js Frontend                      │
│  ┌──────────┐  ┌────────────────┐  ┌──────────────────┐ │
│  │  Source   │  │  Chat Agent    │  │  Insights Panel  │ │
│  │  Panel    │  │  Interface     │  │  (Live Analysis) │ │
│  └──────────┘  └────────────────┘  └──────────────────┘ │
├─────────────────────────────────────────────────────────┤
│                    API Layer                              │
│  /api/chat  ·  /api/insights  ·  /api/sources/*         │
├─────────────────────────────────────────────────────────┤
│                Intelligence Layer                        │
│  ┌──────────────┐  ┌───────────┐  ┌──────────────────┐  │
│  │ TF-IDF Vector│  │  Gemini   │  │  Built-in Agent  │  │
│  │ Store (RAG)  │  │  LLM API  │  │  (Fallback)      │  │
│  └──────────────┘  └───────────┘  └──────────────────┘  │
├─────────────────────────────────────────────────────────┤
│              Data Source Integrations                     │
│  Productboard API  ·  Attention API  ·  Demo Data       │
└─────────────────────────────────────────────────────────┘
```

## Features

- **Three-Panel Layout**: Data sources (left), chat agent (center), live insights (right)
- **RAG Agent**: TF-IDF vector store indexes all feedback, features, calls, and insights for semantic search
- **Gemini Integration**: Connect your Gemini API key for deep, nuanced AI analysis; falls back to rich built-in intelligence
- **Productboard Integration**: Pull features and notes directly from the Productboard API
- **Attention Integration**: Pull call recordings, summaries, and action items from Attention
- **Rich Demo Data**: 12 feedback items, 8 Productboard features, 4 Attention calls, 6 pre-computed insights — all ready to explore without any API keys
- **Cross-Source Intelligence**: Links feedback to features to calls — surfaces revenue impact, churn risk, and competitive signals
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

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | Optional | Enables Gemini-powered AI responses (falls back to built-in intelligence) |
| `PRODUCTBOARD_API_TOKEN` | Optional | Pulls live features/notes from Productboard (falls back to demo data) |
| `ATTENTION_API_KEY` | Optional | Pulls live call data from Attention (falls back to demo data) |

## Deploying to v0 / Vercel

This project is structured as a standard Next.js 14 app and can be deployed directly:

1. Push to GitHub
2. Import into Vercel (or paste components into v0)
3. Add environment variables in the Vercel dashboard
4. Deploy

## Try These Queries

Once the app is running, try asking the agent:

- "What accounts are at risk of churning?"
- "Give me an executive summary of all feedback"
- "What's happening with SSO — who's affected and what's the revenue impact?"
- "Tell me about the AI competitive gap"
- "How should we prioritize the next sprint?"

## Project Structure

```
├── app/
│   ├── api/
│   │   ├── chat/route.ts              # Chat endpoint (agent + RAG)
│   │   ├── insights/route.ts          # Pre-computed insights
│   │   └── sources/                   # Productboard & Attention APIs
│   ├── layout.tsx
│   ├── page.tsx                       # Three-panel layout
│   └── globals.css                    # Tailwind + dark theme
├── components/
│   ├── chat-interface.tsx             # Full chat UX with suggestions
│   ├── insights-panel.tsx             # Live insights with filtering
│   └── source-panel.tsx               # Data sources browser
├── lib/
│   ├── agent.ts                       # Core agent logic + built-in responses
│   ├── attention.ts                   # Attention API client
│   ├── demo-data.ts                   # Rich demo dataset
│   ├── gemini.ts                      # Gemini API client
│   ├── productboard.ts               # Productboard API client
│   ├── types.ts                       # TypeScript types
│   ├── utils.ts                       # Tailwind utilities
│   └── vector-store.ts               # In-memory TF-IDF vector store
└── .env.example
```

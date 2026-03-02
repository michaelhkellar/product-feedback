import { InMemoryVectorStore } from "./vector-store";
import { generateWithGemini, isGeminiConfigured } from "./gemini";
import {
  DEMO_FEEDBACK,
  DEMO_PRODUCTBOARD_FEATURES,
  DEMO_ATTENTION_CALLS,
  DEMO_INSIGHTS,
} from "./demo-data";
import {
  FeedbackItem,
  ProductboardFeature,
  AttentionCall,
  Insight,
} from "./types";

let store: InMemoryVectorStore | null = null;
let storeKey = "";

interface AgentKeys {
  geminiKey?: string;
  productboardKey?: string;
  attentionKey?: string;
}

function buildStoreKey(useDemoData: boolean): string {
  return useDemoData ? "demo" : "empty";
}

function getStore(useDemoData: boolean): InMemoryVectorStore {
  const key = buildStoreKey(useDemoData);
  if (!store || storeKey !== key) {
    store = new InMemoryVectorStore();
    if (useDemoData) {
      store.addFeedback(DEMO_FEEDBACK);
      store.addFeatures(DEMO_PRODUCTBOARD_FEATURES);
      store.addCalls(DEMO_ATTENTION_CALLS);
      store.addInsights(DEMO_INSIGHTS);
    }
    store.buildIndex();
    storeKey = key;
  }
  return store;
}

export function resetStore() {
  store = null;
  storeKey = "";
}

function getFeedbackData(useDemoData: boolean): FeedbackItem[] {
  return useDemoData ? DEMO_FEEDBACK : [];
}

function getFeaturesData(useDemoData: boolean): ProductboardFeature[] {
  return useDemoData ? DEMO_PRODUCTBOARD_FEATURES : [];
}

function getCallsData(useDemoData: boolean): AttentionCall[] {
  return useDemoData ? DEMO_ATTENTION_CALLS : [];
}

function getInsightsData(useDemoData: boolean): Insight[] {
  return useDemoData ? DEMO_INSIGHTS : [];
}

function lookupDetails(ids: string[], useDemoData: boolean): string[] {
  const feedback = getFeedbackData(useDemoData);
  const features = getFeaturesData(useDemoData);
  const calls = getCallsData(useDemoData);
  const insights = getInsightsData(useDemoData);
  const details: string[] = [];

  for (const id of ids) {
    const fb = feedback.find((f) => f.id === id);
    if (fb) {
      details.push(
        `[Feedback: ${fb.title}] From ${fb.customer}${fb.company ? ` (${fb.company})` : ""} — ${fb.content.slice(0, 200)}...`
      );
      continue;
    }

    const feat = features.find((f) => f.id === id);
    if (feat) {
      details.push(
        `[Feature: ${feat.name}] Status: ${feat.status}, Votes: ${feat.votes} — ${feat.description.slice(0, 200)}...`
      );
      continue;
    }

    const call = calls.find((c) => c.id === id);
    if (call) {
      details.push(
        `[Call: ${call.title}] ${call.date} — ${call.summary.slice(0, 200)}...`
      );
      continue;
    }

    const insight = insights.find((i) => i.id === id);
    if (insight) {
      details.push(
        `[Insight: ${insight.title}] ${insight.description.slice(0, 200)}...`
      );
    }
  }

  return details;
}

const SYSTEM_PROMPT = `You are an expert Customer Feedback Intelligence Agent. You work at a SaaS company and have access to a comprehensive database of:

- Customer feedback from multiple channels (Zendesk, Intercom, Slack, Productboard, Attention calls, manual notes)
- Productboard features and their status/votes
- Attention call recordings with summaries, key moments, and action items
- Pre-computed insights including trends, anomalies, risks, and recommendations

Your capabilities:
1. **Search & Retrieve**: Find relevant feedback, features, and call notes based on any query
2. **Analyze Themes**: Identify patterns across feedback sources, spot emerging themes
3. **Risk Assessment**: Flag churn risks, revenue impacts, and competitive threats
4. **Revenue Intelligence**: Connect feedback to revenue opportunities and expansion potential
5. **Prioritization**: Help prioritize features based on customer impact, revenue, and strategic value
6. **Cross-Reference**: Link Productboard features to actual customer feedback and call insights
7. **Summarize**: Provide executive summaries of feedback trends for any time period or theme

When responding:
- Be specific and cite actual feedback items, customer names, and companies
- Quantify impact in terms of revenue ($), customer count, and business risk
- Connect dots across different data sources (e.g., link a Zendesk ticket to a Productboard feature to an Attention call)
- Provide actionable recommendations, not just observations
- Use markdown formatting for readability (headers, bullets, bold for emphasis)
- When referencing data, note the source (e.g., "According to the QBR call with ScaleUp Industries...")

You should be proactive — if someone asks about a topic, also surface related risks, opportunities, and connections they might not have thought of.`;

function buildContextFromSearch(
  query: string,
  useDemoData: boolean
): {
  context: string;
  sources: { type: string; id: string; title: string }[];
} {
  const feedback = getFeedbackData(useDemoData);
  const features = getFeaturesData(useDemoData);
  const calls = getCallsData(useDemoData);
  const insights = getInsightsData(useDemoData);

  const s = getStore(useDemoData);
  const results = s.search(query, { limit: 10 });

  const sources: { type: string; id: string; title: string }[] = [];
  const contextParts: string[] = [];

  for (const r of results) {
    const doc = r.document;
    const fullDetails = lookupDetails([doc.id], useDemoData);
    if (fullDetails.length > 0) {
      contextParts.push(fullDetails[0]);
    }

    let title = "";
    if (doc.type === "feedback") {
      title = feedback.find((f) => f.id === doc.id)?.title || doc.id;
    } else if (doc.type === "feature") {
      title = features.find((f) => f.id === doc.id)?.name || doc.id;
    } else if (doc.type === "call") {
      title = calls.find((c) => c.id === doc.id)?.title || doc.id;
    } else if (doc.type === "insight") {
      title = insights.find((i) => i.id === doc.id)?.title || doc.id;
    }

    sources.push({ type: doc.type, id: doc.id, title });
  }

  return { context: contextParts.join("\n\n"), sources };
}

function buildFullContext(useDemoData: boolean): string {
  const feedback = getFeedbackData(useDemoData);
  const features = getFeaturesData(useDemoData);
  const calls = getCallsData(useDemoData);
  const insights = getInsightsData(useDemoData);

  if (feedback.length === 0 && features.length === 0 && calls.length === 0 && insights.length === 0) {
    return "No data is currently loaded. The user needs to configure API keys to connect live data sources, or enable demo data to explore the platform.";
  }

  const parts: string[] = [];

  if (feedback.length > 0) {
    parts.push("## All Customer Feedback\n");
    for (const fb of feedback) {
      parts.push(
        `- **${fb.title}** (${fb.source}, ${fb.sentiment}, ${fb.priority} priority)\n  From: ${fb.customer}${fb.company ? ` @ ${fb.company}` : ""}\n  ${fb.content}\n  Themes: ${fb.themes.join(", ")}`
      );
    }
  }

  if (features.length > 0) {
    parts.push("\n## Productboard Features\n");
    for (const f of features) {
      parts.push(
        `- **${f.name}** — Status: ${f.status}, Votes: ${f.votes}, Customer Requests: ${f.customerRequests}\n  ${f.description}\n  Themes: ${f.themes.join(", ")}`
      );
    }
  }

  if (calls.length > 0) {
    parts.push("\n## Attention Call Notes\n");
    for (const c of calls) {
      parts.push(
        `- **${c.title}** (${c.date}, ${c.duration})\n  Participants: ${c.participants.join(", ")}\n  Summary: ${c.summary}\n  Key Moments:\n${c.keyMoments.map((m) => `    - [${m.timestamp}] "${m.text}" (${m.sentiment})`).join("\n")}\n  Action Items: ${c.actionItems.join("; ")}\n  Themes: ${c.themes.join(", ")}`
      );
    }
  }

  if (insights.length > 0) {
    parts.push("\n## Pre-Computed Insights\n");
    for (const i of insights) {
      parts.push(
        `- **[${i.type.toUpperCase()}] ${i.title}** (Confidence: ${(i.confidence * 100).toFixed(0)}%, Impact: ${i.impact})\n  ${i.description}\n  Themes: ${i.themes.join(", ")}`
      );
    }
  }

  return parts.join("\n");
}

export async function chat(
  userMessage: string,
  conversationHistory: { role: "user" | "assistant"; content: string }[],
  keys: AgentKeys = {},
  useDemoData = true
): Promise<{
  response: string;
  sources: { type: string; id: string; title: string }[];
}> {
  const { context: searchContext, sources } = buildContextFromSearch(userMessage, useDemoData);
  const fullContext = buildFullContext(useDemoData);

  const historyText = conversationHistory
    .slice(-6)
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n\n");

  const enrichedPrompt = `Here is the complete customer feedback intelligence database you have access to:

${fullContext}

---

Most relevant items for the current query (ranked by relevance):

${searchContext || "(No matching items found in the current dataset)"}

---

Conversation history:
${historyText}

---

User's current question: ${userMessage}

Provide a thorough, insightful response. Cross-reference data sources, quantify impact, and surface non-obvious connections. Use markdown formatting.`;

  if (isGeminiConfigured(keys.geminiKey)) {
    const geminiResponse = await generateWithGemini(
      SYSTEM_PROMPT,
      enrichedPrompt,
      keys.geminiKey
    );
    if (geminiResponse) {
      return { response: geminiResponse, sources };
    }
  }

  if (!useDemoData && !sources.length) {
    return {
      response: `I don't have any data loaded right now. To get started:

1. **Add API keys** in Settings (gear icon in the header) to connect live data sources
2. **Enable demo data** in Settings to explore the platform with sample data

Once data is available, I can analyze themes, identify risks, surface opportunities, and much more.`,
      sources: [],
    };
  }

  return {
    response: generateBuiltInResponse(userMessage, searchContext, sources, useDemoData),
    sources,
  };
}

function generateBuiltInResponse(
  query: string,
  context: string,
  sources: { type: string; id: string; title: string }[],
  useDemoData: boolean
): string {
  const q = query.toLowerCase();

  if (q.includes("churn") || q.includes("risk") || q.includes("at risk")) {
    return `## Churn Risk Analysis

Based on analysis across all feedback channels, here are the accounts showing churn signals:

### Critical Risk Accounts

**1. GlobalFinance** — $120k ARR (50 seats, potential 500)
- SSO reliability issues mentioned 3x in the last month
- However: VP has $600k budget approved for expansion *if* SSO is fixed
- **Risk Level: High** | **Revenue at stake: $720k** (current + expansion)
- *Source: Renewal call with Tom Bradley, Zendesk ticket from David Park*

**2. Acme Corp** — Enterprise Plan
- Dashboard performance regression causing team to revert to spreadsheets
- Hard deadline: March 10 board meeting requires working dashboards
- Positive signal: Planning marketing team expansion if fixed
- **Risk Level: Critical** | **Timeline: 10 days**
- *Source: Support escalation call with Sarah Chen*

**3. SecureBank** — Enterprise Plan
- Compliance data export blocker for SOC 2 audit
- Q2 renewal at risk if not resolved
- **Risk Level: High** | **Timeline: Q2 renewal**
- *Source: Productboard note from Nina Kowalski*

### Broader Churn Signals

The board meeting notes flagged mid-market churn ticking up with three primary drivers:
1. **Lack of AI/automation features** — 3 competitive losses this month
2. **Onboarding friction** — correlates with fast-growing accounts
3. **Missing enterprise permissions** — blocking upgrades from Pro → Enterprise

### Recommended Actions
1. **Immediate**: Performance hotfix for Acme Corp (deadline March 10)
2. **This sprint**: SSO reliability fix (unlocks $600k GlobalFinance expansion)
3. **This quarter**: Ship RBAC and compliance export (unblocks enterprise pipeline)

> *Analysis based on ${sources.length} data sources across Zendesk, Attention calls, Productboard, and internal notes.*${useDemoData ? "\n\n> ⚠️ *This analysis is based on demo data. Connect your API keys for real insights.*" : ""}`;
  }

  if (q.includes("sso") || q.includes("authentication") || q.includes("single sign")) {
    return `## SSO & Authentication Analysis

### The Issue
SSO integration reliability has become a critical concern, with disconnections occurring ~3 times per month for affected enterprise accounts.

### Impacted Accounts

| Account | Impact | Revenue Risk |
|---------|--------|-------------|
| **GlobalFinance** | SSO drops block 50 users, IT spends 2-3h reconnecting | $120k current, $600k expansion blocked |
| **Other Enterprise** | Pattern likely broader than reported | Unknown |

### What Customers Are Saying

> *"The SSO dropping three times a month is a dealbreaker for IT"* — Tom Bradley, VP of Ops, GlobalFinance (Attention call, Feb 19)

> *"Third time this month our SSO integration has dropped. Users are getting locked out."* — David Park, GlobalFinance (Zendesk, Feb 26)

### Productboard Status
**SSO Reliability Improvements** is currently **in progress** with 389 votes and 64 customer requests.

### Revenue Connection
This is directly tied to the **largest expansion opportunity** in the pipeline: GlobalFinance's 500-seat rollout ($600k ARR).

### Recommendation
Escalate to P0 engineering priority. The ROI calculation is straightforward:
- **Cost of fix**: Engineering sprint (2-3 weeks estimated)
- **Revenue unlocked**: $600k expansion + retention of $120k current ARR

> *Cross-referenced across: 2 Zendesk tickets, 1 Attention renewal call, 1 Productboard feature, 2 pre-computed insights.*${useDemoData ? "\n\n> ⚠️ *This analysis is based on demo data. Connect your API keys for real insights.*" : ""}`;
  }

  if (q.includes("ai") || q.includes("artificial intelligence") || q.includes("competitor") || q.includes("competitive")) {
    return `## AI & Competitive Intelligence Brief

### Competitive Landscape Shift
A significant pattern has emerged: **AI capabilities are now the primary competitive differentiator** in our market.

### Evidence
- **3 deals lost this month** to CompetitorX, all citing AI features as the deciding factor
- Total revenue lost: **~$255k** across the three deals
- CompetitorX is marketing "AI-first feedback intelligence"

### Productboard Status
**AI-Powered Feedback Summarization** is the **#1 voted feature** with:
- 847 votes
- 234 customer requests
- Current status: **Planned** (not yet in progress)

### Strategic Recommendation

| Timeline | Action | Impact |
|----------|--------|--------|
| **30 days** | Ship basic sentiment analysis + auto-tagging | Quick win |
| **60 days** | AI-powered feedback summarization | Match CompetitorX |
| **90 days** | Predictive insights | Leap ahead |

> *Sources: 1 competitive loss debrief (Attention), 1 internal sales note (Slack), board meeting notes, Productboard feature data.*${useDemoData ? "\n\n> ⚠️ *This analysis is based on demo data. Connect your API keys for real insights.*" : ""}`;
  }

  if (q.includes("summary") || q.includes("overview") || q.includes("brief") || q.includes("what's happening") || q.includes("status")) {
    const feedback = getFeedbackData(useDemoData);
    const calls = getCallsData(useDemoData);
    const insights = getInsightsData(useDemoData);
    const features = getFeaturesData(useDemoData);

    return `## Executive Feedback Intelligence Brief

### Pulse Check: Last 14 Days
**${feedback.length} feedback items** analyzed across 5 channels | **${calls.length} calls** reviewed | **${insights.length} insights** generated

### Top 3 Priorities (by Revenue Impact)

**1. SSO Reliability Fix** — Critical
- Revenue at risk: **$720k** (GlobalFinance current + expansion)
- Status: In progress on Productboard

**2. Dashboard Performance Hotfix** — Critical
- Account at risk: Acme Corp (Enterprise)
- Hard deadline: **March 10** (board meeting)

**3. AI Feature Gap** — Strategic
- Revenue lost: **~$255k** in competitive deals this month
- Status: Planned on Productboard (#1 voted feature, 847 votes)

### Key Opportunities
- **GlobalFinance expansion**: 50 → 500 seats ($600k) if SSO + admin tools shipped
- **RBAC upsell**: MidMarket Solutions willing to upgrade Pro → Enterprise
- **AI differentiation**: Addressing the #1 competitive objection

> *Generated from ${feedback.length} feedback items, ${features.length} Productboard features, ${calls.length} Attention calls, and ${insights.length} pre-computed insights.*${useDemoData ? "\n\n> ⚠️ *This analysis is based on demo data. Connect your API keys for real insights.*" : ""}`;
  }

  const searchResults = sources.slice(0, 5);
  const resultsList = searchResults
    .map((s) => `- **[${s.type}]** ${s.title}`)
    .join("\n");

  return `## Search Results for: "${query}"

I found **${sources.length} relevant items** across your feedback intelligence database:

${resultsList}

### Analysis
Based on the matching data, here are the key connections:

${context.slice(0, 1500)}

### Want to go deeper?
Try asking me about:
- "What's the churn risk across our Enterprise accounts?"
- "Give me an executive summary of the last 2 weeks"
- "What are customers saying about [specific feature]?"
- "How does this connect to our Productboard roadmap?"

> *Tip: Connect your Gemini API key in Settings for deeper, AI-powered analysis.*

> *Searched across ${sources.length} sources: feedback, Productboard features, Attention calls, and insights.*${useDemoData ? "\n\n> ⚠️ *This analysis is based on demo data. Connect your API keys for real insights.*" : ""}`;
}

export function getInsights(useDemoData = true): Insight[] {
  return getInsightsData(useDemoData);
}

export function searchFeedback(
  query: string,
  options?: { limit?: number; type?: string },
  useDemoData = true
): { type: string; id: string; title: string; score: number }[] {
  const feedback = getFeedbackData(useDemoData);
  const features = getFeaturesData(useDemoData);
  const calls = getCallsData(useDemoData);
  const insights = getInsightsData(useDemoData);

  const s = getStore(useDemoData);
  const results = s.search(query, {
    limit: options?.limit || 10,
    type: options?.type as "feedback" | "feature" | "call" | "insight" | undefined,
  });

  return results.map((r) => {
    let title = r.document.id;
    if (r.document.type === "feedback") {
      title = feedback.find((f) => f.id === r.document.id)?.title || title;
    } else if (r.document.type === "feature") {
      title = features.find((f) => f.id === r.document.id)?.name || title;
    } else if (r.document.type === "call") {
      title = calls.find((c) => c.id === r.document.id)?.title || title;
    } else if (r.document.type === "insight") {
      title = insights.find((i) => i.id === r.document.id)?.title || title;
    }

    return {
      type: r.document.type,
      id: r.document.id,
      title,
      score: r.score,
    };
  });
}

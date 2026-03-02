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

function getStore(): InMemoryVectorStore {
  if (!store) {
    store = new InMemoryVectorStore();
    store.addFeedback(DEMO_FEEDBACK);
    store.addFeatures(DEMO_PRODUCTBOARD_FEATURES);
    store.addCalls(DEMO_ATTENTION_CALLS);
    store.addInsights(DEMO_INSIGHTS);
    store.buildIndex();
  }
  return store;
}

export function resetStore() {
  store = null;
}

function lookupDetails(ids: string[]): string[] {
  const details: string[] = [];

  for (const id of ids) {
    const fb = DEMO_FEEDBACK.find((f) => f.id === id);
    if (fb) {
      details.push(
        `[Feedback: ${fb.title}] From ${fb.customer}${fb.company ? ` (${fb.company})` : ""} — ${fb.content.slice(0, 200)}...`
      );
      continue;
    }

    const feat = DEMO_PRODUCTBOARD_FEATURES.find((f) => f.id === id);
    if (feat) {
      details.push(
        `[Feature: ${feat.name}] Status: ${feat.status}, Votes: ${feat.votes} — ${feat.description.slice(0, 200)}...`
      );
      continue;
    }

    const call = DEMO_ATTENTION_CALLS.find((c) => c.id === id);
    if (call) {
      details.push(
        `[Call: ${call.title}] ${call.date} — ${call.summary.slice(0, 200)}...`
      );
      continue;
    }

    const insight = DEMO_INSIGHTS.find((i) => i.id === id);
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

function buildContextFromSearch(query: string): {
  context: string;
  sources: { type: string; id: string; title: string }[];
} {
  const s = getStore();
  const results = s.search(query, { limit: 10 });

  const sources: { type: string; id: string; title: string }[] = [];
  const contextParts: string[] = [];

  for (const r of results) {
    const doc = r.document;
    const fullDetails = lookupDetails([doc.id]);
    if (fullDetails.length > 0) {
      contextParts.push(fullDetails[0]);
    }

    let title = "";
    if (doc.type === "feedback") {
      const fb = DEMO_FEEDBACK.find((f) => f.id === doc.id);
      title = fb?.title || doc.id;
    } else if (doc.type === "feature") {
      const feat = DEMO_PRODUCTBOARD_FEATURES.find((f) => f.id === doc.id);
      title = feat?.name || doc.id;
    } else if (doc.type === "call") {
      const call = DEMO_ATTENTION_CALLS.find((c) => c.id === doc.id);
      title = call?.title || doc.id;
    } else if (doc.type === "insight") {
      const insight = DEMO_INSIGHTS.find((i) => i.id === doc.id);
      title = insight?.title || doc.id;
    }

    sources.push({ type: doc.type, id: doc.id, title });
  }

  return { context: contextParts.join("\n\n"), sources };
}

function buildFullContext(): string {
  const parts: string[] = [];

  parts.push("## All Customer Feedback\n");
  for (const fb of DEMO_FEEDBACK) {
    parts.push(
      `- **${fb.title}** (${fb.source}, ${fb.sentiment}, ${fb.priority} priority)\n  From: ${fb.customer}${fb.company ? ` @ ${fb.company}` : ""}\n  ${fb.content}\n  Themes: ${fb.themes.join(", ")}`
    );
  }

  parts.push("\n## Productboard Features\n");
  for (const f of DEMO_PRODUCTBOARD_FEATURES) {
    parts.push(
      `- **${f.name}** — Status: ${f.status}, Votes: ${f.votes}, Customer Requests: ${f.customerRequests}\n  ${f.description}\n  Themes: ${f.themes.join(", ")}`
    );
  }

  parts.push("\n## Attention Call Notes\n");
  for (const c of DEMO_ATTENTION_CALLS) {
    parts.push(
      `- **${c.title}** (${c.date}, ${c.duration})\n  Participants: ${c.participants.join(", ")}\n  Summary: ${c.summary}\n  Key Moments:\n${c.keyMoments.map((m) => `    - [${m.timestamp}] "${m.text}" (${m.sentiment})`).join("\n")}\n  Action Items: ${c.actionItems.join("; ")}\n  Themes: ${c.themes.join(", ")}`
    );
  }

  parts.push("\n## Pre-Computed Insights\n");
  for (const i of DEMO_INSIGHTS) {
    parts.push(
      `- **[${i.type.toUpperCase()}] ${i.title}** (Confidence: ${(i.confidence * 100).toFixed(0)}%, Impact: ${i.impact})\n  ${i.description}\n  Themes: ${i.themes.join(", ")}`
    );
  }

  return parts.join("\n");
}

export async function chat(
  userMessage: string,
  conversationHistory: { role: "user" | "assistant"; content: string }[]
): Promise<{
  response: string;
  sources: { type: string; id: string; title: string }[];
}> {
  const { context: searchContext, sources } = buildContextFromSearch(userMessage);

  const fullContext = buildFullContext();

  const historyText = conversationHistory
    .slice(-6)
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n\n");

  const enrichedPrompt = `Here is the complete customer feedback intelligence database you have access to:

${fullContext}

---

Most relevant items for the current query (ranked by relevance):

${searchContext}

---

Conversation history:
${historyText}

---

User's current question: ${userMessage}

Provide a thorough, insightful response. Cross-reference data sources, quantify impact, and surface non-obvious connections. Use markdown formatting.`;

  if (isGeminiConfigured()) {
    const geminiResponse = await generateWithGemini(SYSTEM_PROMPT, enrichedPrompt);
    if (geminiResponse) {
      return { response: geminiResponse, sources };
    }
  }

  return {
    response: generateBuiltInResponse(userMessage, searchContext, sources),
    sources,
  };
}

function generateBuiltInResponse(
  query: string,
  context: string,
  sources: { type: string; id: string; title: string }[]
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

> *Analysis based on ${sources.length} data sources across Zendesk, Attention calls, Productboard, and internal notes.*`;
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
**SSO Reliability Improvements** is currently **in progress** with 389 votes and 64 customer requests. The feature includes:
- Connection health monitoring
- Automatic reconnection
- Proactive alerts
- Additional IdP support

### Revenue Connection
This is directly tied to the **largest expansion opportunity** in the pipeline: GlobalFinance's 500-seat rollout ($600k ARR). Tom Bradley explicitly stated on the renewal call that SSO fix + admin console = committed expansion.

### Recommendation
Escalate to P0 engineering priority. The ROI calculation is straightforward:
- **Cost of fix**: Engineering sprint (2-3 weeks estimated)
- **Revenue unlocked**: $600k expansion + retention of $120k current ARR
- **Risk of inaction**: Loss of $720k + competitive damage

> *Cross-referenced across: 2 Zendesk tickets, 1 Attention renewal call, 1 Productboard feature, 2 pre-computed insights.*`;
  }

  if (q.includes("ai") || q.includes("artificial intelligence") || q.includes("competitor") || q.includes("competitive")) {
    return `## AI & Competitive Intelligence Brief

### Competitive Landscape Shift
A significant pattern has emerged: **AI capabilities are now the primary competitive differentiator** in our market.

### Evidence
- **3 deals lost this month** to CompetitorX, all citing AI features as the deciding factor
- Total revenue lost: **~$255k** across the three deals
- CompetitorX is marketing "AI-first feedback intelligence" — auto-generated themes, sentiment analysis, and smart categorization

### Key Quotes

> *"They showed the prospect auto-generated themes and sentiment analysis — we had nothing comparable"* — Jordan Blake, Sales AE (Competitive Loss Debrief, Feb 21)

> *"The prospect said our product was better in every other way, but AI was the tiebreaker"* — same debrief

### Internal Pressure
The **board meeting feedback** (Feb 17) explicitly called out AI/automation as a top-3 churn driver and requested a 90-day action plan.

### Productboard Status
**AI-Powered Feedback Summarization** is the **#1 voted feature** with:
- 847 votes
- 234 customer requests
- Current status: **Planned** (not yet in progress)

### Strategic Recommendation

| Timeline | Action | Impact |
|----------|--------|--------|
| **30 days** | Ship basic sentiment analysis + auto-tagging | Quick win, neutralizes #1 competitive objection |
| **60 days** | AI-powered feedback summarization | Matches CompetitorX capabilities |
| **90 days** | Predictive insights (churn risk, expansion signals) | Leap ahead of competition |

The irony: **you're building this AI feedback agent right now**. This is exactly the kind of capability the market is demanding.

> *Sources: 1 competitive loss debrief (Attention), 1 internal sales note (Slack), board meeting notes, Productboard feature data.*`;
  }

  if (q.includes("onboard") || q.includes("training") || q.includes("ramp")) {
    return `## Onboarding & Training Analysis

### The Pattern
Onboarding friction is **correlated with account growth** — accounts that grew 50%+ in seats show 3x more onboarding complaints.

### Spotlight: ScaleUp Industries
- Grew 60% this quarter (hiring surge)
- Each new user takes **a full week** to become productive
- Requested: interactive tutorials, role-based paths, sandbox environment
- CSM Andrea Lopez has committed to sharing onboarding roadmap by March 15

### Key Moment from QBR Call (Feb 24)
> *"We love the product but onboarding 30 people was a nightmare"* — James Mitchell, ScaleUp Industries

> *"If you had guided tours like Pendo does, that would cut our ramp time in half"*

### Productboard Feature Status
**Interactive Onboarding Flows** — Status: Planned
- 523 votes, 189 customer requests
- Includes: role-based paths, interactive tutorials, progress tracking, sandbox

### Business Impact
- Onboarding is the **#2 cited reason** for mid-market churn (per board feedback)
- Fast-growing accounts = highest expansion potential but also highest onboarding friction
- Self-serve onboarding would reduce CSM load by an estimated 40%

### Recommendations
1. **Quick win**: Create 5 role-based getting-started guides (content, not code)
2. **Medium term**: Build interactive product tour (integrate Pendo or build native)
3. **Long term**: Sandbox environment for safe experimentation

> *Sources: ScaleUp QBR call, board meeting notes, Productboard, 2 pre-computed insights.*`;
  }

  if (q.includes("performance") || q.includes("dashboard") || q.includes("slow") || q.includes("load")) {
    return `## Dashboard Performance Analysis

### Critical Situation
Dashboard load times have regressed to **15-20 seconds** since the v3.2 release, affecting Enterprise accounts.

### Primary Account Impact: Acme Corp
- **45 users** have stopped using dashboards and reverted to spreadsheets
- **Hard deadline**: March 10 board presentation requires working dashboards
- Post-resolution: Acme is planning to expand to marketing team (positive signal)

### From the Escalation Call (Feb 28)
> *"My entire team has stopped using the dashboards — we're back to spreadsheets"* — Sarah Chen

> *"We have a board presentation March 10th and we need this fixed by then"*

### Engineering Status
**Performance Optimization — Dashboard** is **in progress** on Productboard:
- 398 votes, 87 customer requests
- Targets: sub-2-second load times, query optimization, caching, lazy loading

### Action Items (from Support Lead Mike Torres)
1. Engineering hotfix by **March 5** (5 days from escalation)
2. Daily status updates to Acme Corp
3. Post-mortem after fix deployed

### Risk Assessment
- **Immediate risk**: Acme Corp relationship if not fixed by March 10
- **Broader risk**: Other Enterprise accounts likely experiencing similar degradation but haven't reported yet
- **Opportunity**: Fix + expansion could add marketing team seats

> *Sources: Zendesk escalation (ZD-4521), Attention support call, Productboard feature status.*`;
  }

  if (q.includes("summary") || q.includes("overview") || q.includes("brief") || q.includes("what's happening") || q.includes("status")) {
    return `## Executive Feedback Intelligence Brief

### Pulse Check: Last 14 Days
**${DEMO_FEEDBACK.length} feedback items** analyzed across 5 channels | **${DEMO_ATTENTION_CALLS.length} calls** reviewed | **${DEMO_INSIGHTS.length} insights** generated

### Top 3 Priorities (by Revenue Impact)

**1. SSO Reliability Fix** — 🔴 Critical
- Revenue at risk: **$720k** (GlobalFinance current + expansion)
- Status: In progress on Productboard
- Timeline: Must resolve before Q2 for expansion commitment

**2. Dashboard Performance Hotfix** — 🔴 Critical
- Account at risk: Acme Corp (Enterprise)
- Hard deadline: **March 10** (board meeting)
- Status: In progress, hotfix targeted for March 5

**3. AI Feature Gap** — 🟡 Strategic
- Revenue lost: **~$255k** in competitive deals this month
- Board has requested 90-day plan
- Status: Planned on Productboard (#1 voted feature, 847 votes)

### Sentiment Distribution
- 🟢 Positive: 2 items (17%) — reporting feature love, expansion signals
- 🔴 Negative: 7 items (58%) — performance, SSO, mobile, competitive
- 🟡 Mixed: 3 items (25%) — feature requests with positive intent

### Key Opportunities
- **GlobalFinance expansion**: 50 → 500 seats ($600k) if SSO + admin tools shipped
- **RBAC upsell**: MidMarket Solutions willing to upgrade Pro → Enterprise for permissions
- **AI differentiation**: Addressing the #1 competitive objection

### Themes Heatmap
| Theme | Mentions | Trend |
|-------|----------|-------|
| Enterprise readiness | 6 | ↑ Growing |
| AI/Automation | 4 | ↑↑ Accelerating |
| Performance | 3 | → Stable |
| Onboarding | 3 | ↑ Growing |
| API/Integration | 3 | ↑ Growing |

> *Generated from ${DEMO_FEEDBACK.length} feedback items, ${DEMO_PRODUCTBOARD_FEATURES.length} Productboard features, ${DEMO_ATTENTION_CALLS.length} Attention calls, and ${DEMO_INSIGHTS.length} pre-computed insights.*`;
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

> *Tip: Connect your Gemini API key for deeper, more nuanced analysis powered by AI.*

> *Searched across ${sources.length} sources: feedback, Productboard features, Attention calls, and insights.*`;
}

export function getInsights(): Insight[] {
  return DEMO_INSIGHTS;
}

export function searchFeedback(
  query: string,
  options?: { limit?: number; type?: string }
): { type: string; id: string; title: string; score: number }[] {
  const s = getStore();
  const results = s.search(query, {
    limit: options?.limit || 10,
    type: options?.type as "feedback" | "feature" | "call" | "insight" | undefined,
  });

  return results.map((r) => {
    let title = r.document.id;
    if (r.document.type === "feedback") {
      title = DEMO_FEEDBACK.find((f) => f.id === r.document.id)?.title || title;
    } else if (r.document.type === "feature") {
      title = DEMO_PRODUCTBOARD_FEATURES.find((f) => f.id === r.document.id)?.name || title;
    } else if (r.document.type === "call") {
      title = DEMO_ATTENTION_CALLS.find((c) => c.id === r.document.id)?.title || title;
    } else if (r.document.type === "insight") {
      title = DEMO_INSIGHTS.find((i) => i.id === r.document.id)?.title || title;
    }

    return {
      type: r.document.type,
      id: r.document.id,
      title,
      score: r.score,
    };
  });
}

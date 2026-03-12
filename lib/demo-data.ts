import {
  FeedbackItem,
  ProductboardFeature,
  AttentionCall,
  Insight,
  DataSourceStatus,
} from "./types";

// Synthetic demo data only. These names, companies, timelines, and business details
// are intentionally fictionalized for safe public sharing and product demos.
export const DEMO_FEEDBACK: FeedbackItem[] = [
  {
    id: "fb-001",
    source: "zendesk",
    title: "Dashboard loading times are unacceptable",
    content:
      "This synthetic demo account is seeing dashboard load times of 15-20 seconds after a recent update. Multiple users reported the same slowdown, and it is disrupting a quarterly review workflow in the sample environment.",
    customer: "Avery Example",
    company: "ExampleCorp",
    sentiment: "negative",
    themes: ["performance", "dashboard", "enterprise"],
    date: "2026-02-28",
    priority: "critical",
    metadata: { ticketId: "ZD-4521", plan: "Enterprise" },
  },
  {
    id: "fb-002",
    source: "intercom",
    title: "Love the new reporting feature",
    content:
      "The new custom reporting builder is fantastic for this demo workspace. We already created a dozen reports that replaced manual spreadsheet work. The drag-and-drop interface feels intuitive, and scheduled email delivery would make it even better.",
    customer: "Jordan Sample",
    company: "Northwind Demo",
    sentiment: "positive",
    themes: ["reporting", "ux", "feature-request"],
    date: "2026-02-27",
    priority: "low",
    metadata: { plan: "Pro" },
  },
  {
    id: "fb-003",
    source: "slack",
    title: "SSO integration keeps breaking",
    content:
      "In this synthetic scenario, the SSO integration dropped for the third time this month. Users are getting locked out and the reconnect process takes hours for the IT team. This is framed as a security and productivity concern in the demo dataset.",
    customer: "Casey Demo",
    company: "SampleBank",
    sentiment: "negative",
    themes: ["sso", "authentication", "reliability", "churn-risk"],
    date: "2026-02-26",
    priority: "critical",
    metadata: { plan: "Enterprise", accountTier: "Strategic" },
  },
  {
    id: "fb-004",
    source: "productboard",
    title: "API rate limits too restrictive",
    content:
      "We're building a deep integration in this demo scenario, but the current rate limits are too low for the sync process. We need much higher throughput to keep systems aligned in near real time.",
    customer: "Morgan Example",
    company: "DemoSync Labs",
    sentiment: "mixed",
    themes: ["api", "integration", "developer-experience"],
    date: "2026-02-25",
    priority: "high",
    metadata: { plan: "Enterprise", integration: "REST API" },
  },
  {
    id: "fb-005",
    source: "attention",
    title: "Need better onboarding for new team members",
    content:
      "During this sample QBR call, the customer expressed frustration with onboarding. Their team has grown quickly and each new user takes roughly a week to become productive. They requested interactive tutorials, role-based onboarding paths, and a sandbox environment.",
    customer: "Taylor Placeholder",
    company: "DemoScale Co",
    sentiment: "negative",
    themes: ["onboarding", "ux", "training", "growth"],
    date: "2026-02-24",
    priority: "high",
    metadata: { callType: "QBR", accountSize: "200 seats" },
  },
  {
    id: "fb-006",
    source: "zendesk",
    title: "Mobile app crashes on Android 14",
    content:
      "The mobile app consistently crashes when trying to view analytics on Android 14 devices in this demo account. The crash happens within seconds of opening a chart view, affecting a field team that relies on mobile access.",
    customer: "Jamie Example",
    company: "Placeholder Field Ops",
    sentiment: "negative",
    themes: ["mobile", "bug", "android", "analytics"],
    date: "2026-02-23",
    priority: "critical",
    metadata: { ticketId: "ZD-4498", devices: "Android 14" },
  },
  {
    id: "fb-007",
    source: "intercom",
    title: "Would pay more for advanced permissions",
    content:
      "We love the product in this synthetic example but need granular role-based access control. Right now it's admin or viewer; we need custom roles with field-level permissions. This is positioned as a likely upgrade trigger in the demo dataset.",
    customer: "Riley Sample",
    company: "DemoMarket Solutions",
    sentiment: "mixed",
    themes: ["permissions", "rbac", "upsell", "enterprise"],
    date: "2026-02-22",
    priority: "medium",
    metadata: { plan: "Pro", potentialUpgrade: "Enterprise" },
  },
  {
    id: "fb-008",
    source: "slack",
    title: "Competitor just launched AI summaries",
    content:
      "Synthetic internal note: lost a sample deal to Competitor Alpha. The prospect said AI-powered feedback summaries and auto-categorization were the deciding factor. This demo record is meant to simulate repeated competitive pressure around AI capabilities.",
    customer: "Internal — Demo GTM Team",
    company: "Internal (Synthetic)",
    sentiment: "negative",
    themes: ["competitive", "ai", "product-gap", "churn-risk"],
    date: "2026-02-21",
    priority: "critical",
    metadata: { source: "internal-demo", dealsLost: "multiple" },
  },
  {
    id: "fb-009",
    source: "productboard",
    title: "Bulk data export needed for compliance",
    content:
      "As part of a sample compliance review, we need to export all customer interaction data in a structured format. The current export is limited and the demo scenario asks for full JSON or Parquet export with no row limits.",
    customer: "Sam Example",
    company: "SampleBank",
    sentiment: "negative",
    themes: ["compliance", "export", "data", "enterprise", "churn-risk"],
    date: "2026-02-20",
    priority: "high",
    metadata: { plan: "Enterprise", renewalWindow: "Upcoming" },
  },
  {
    id: "fb-010",
    source: "attention",
    title: "Expansion opportunity — 500 additional seats",
    content:
      "During a synthetic renewal call, the VP of Ops mentioned they want to roll out to all departments. The key blockers are SSO reliability and needing an admin console for department-level management. If fixed soon, they would commit to a broader rollout.",
    customer: "Parker Demo",
    company: "SampleBank",
    sentiment: "positive",
    themes: ["expansion", "sso", "admin", "upsell"],
    date: "2026-02-19",
    priority: "high",
    metadata: { currentSeats: "Pilot", potentialSeats: "Multi-team", accountTier: "Strategic" },
  },
  {
    id: "fb-011",
    source: "zendesk",
    title: "Webhook delivery is unreliable",
    content:
      "We've set up webhooks for real-time sync in this demo scenario, but a noticeable share of events are never delivered. No retry mechanism is visible, which breaks downstream automation. The request is for reliable delivery, retries, and a dead letter queue.",
    customer: "Cameron Sample",
    company: "Demo Automations",
    sentiment: "negative",
    themes: ["webhooks", "reliability", "api", "integration"],
    date: "2026-02-18",
    priority: "high",
    metadata: { ticketId: "ZD-4467", failureRate: "noticeable" },
  },
  {
    id: "fb-012",
    source: "manual",
    title: "Executive feedback from board meeting",
    content:
      "Synthetic executive feedback: Customers love the core product but churn is ticking up among mid-market accounts. Top cited reasons in this demo narrative are lack of AI and automation features, onboarding friction, and missing enterprise-grade permissions.",
    customer: "Internal — Demo Leadership",
    company: "Internal (Synthetic)",
    sentiment: "mixed",
    themes: ["churn", "ai", "onboarding", "permissions", "strategy"],
    date: "2026-02-17",
    priority: "critical",
    metadata: { source: "synthetic-board-meeting" },
  },
];

export const DEMO_PRODUCTBOARD_FEATURES: ProductboardFeature[] = [
  {
    id: "pb-001",
    name: "AI-Powered Feedback Summarization",
    description:
      "Automatically summarize and categorize incoming customer feedback using LLM technology. Group similar requests, extract sentiment, and surface trends without manual effort.",
    status: "planned",
    votes: 847,
    customerRequests: 234,
    themes: ["ai", "automation", "feedback"],
  },
  {
    id: "pb-002",
    name: "Role-Based Access Control (RBAC)",
    description:
      "Granular permission system with custom roles, field-level access control, and department-scoped visibility. Essential for enterprise customers with complex org structures.",
    status: "in_progress",
    votes: 612,
    customerRequests: 156,
    themes: ["permissions", "rbac", "enterprise"],
  },
  {
    id: "pb-003",
    name: "Interactive Onboarding Flows",
    description:
      "Role-based onboarding paths with interactive tutorials, progress tracking, sandbox environments, and contextual help. Reduce time-to-value for new users.",
    status: "planned",
    votes: 523,
    customerRequests: 189,
    themes: ["onboarding", "ux", "training"],
  },
  {
    id: "pb-004",
    name: "Performance Optimization — Dashboard",
    description:
      "Major performance overhaul for dashboard rendering. Target: sub-2-second load times for complex dashboards. Includes query optimization, caching, and lazy loading.",
    status: "in_progress",
    votes: 398,
    customerRequests: 87,
    themes: ["performance", "dashboard"],
  },
  {
    id: "pb-005",
    name: "Advanced API — Higher Rate Limits & Webhooks v2",
    description:
      "Increase rate limits to 1000 req/min for Enterprise, implement webhook retry logic with exponential backoff, dead letter queue, and delivery status dashboard.",
    status: "new",
    votes: 334,
    customerRequests: 98,
    themes: ["api", "webhooks", "integration", "developer-experience"],
  },
  {
    id: "pb-006",
    name: "Compliance Data Export",
    description:
      "Enterprise-grade data export with no row limits, multiple formats (JSON, Parquet, CSV), scheduled exports, and audit trail. Required for SOC 2, GDPR, and HIPAA compliance.",
    status: "new",
    votes: 267,
    customerRequests: 72,
    themes: ["compliance", "export", "data", "enterprise"],
  },
  {
    id: "pb-007",
    name: "Mobile App Stability — Android",
    description:
      "Fix critical crashes on Android 14+ devices. Overhaul chart rendering engine for mobile, implement offline mode, and improve overall mobile performance.",
    status: "in_progress",
    votes: 445,
    customerRequests: 112,
    themes: ["mobile", "android", "bug", "analytics"],
  },
  {
    id: "pb-008",
    name: "SSO Reliability Improvements",
    description:
      "Resolve intermittent SSO disconnection issues. Implement connection health monitoring, automatic reconnection, and proactive alerts. Add support for additional IdPs.",
    status: "in_progress",
    votes: 389,
    customerRequests: 64,
    themes: ["sso", "authentication", "reliability", "enterprise"],
  },
];

export const DEMO_ATTENTION_CALLS: AttentionCall[] = [
  {
    id: "ac-001",
    title: "QBR — DemoScale Co",
    date: "2026-02-24",
    duration: "45 min",
    participants: ["Taylor Placeholder (DemoScale)", "Our CSM: Avery Support"],
    summary:
      "This synthetic customer expressed strong frustration with onboarding for new hires. Their team has grown quickly and each new user takes about a week to become productive. They requested interactive tutorials and a sandbox environment. The sample call frames this as a renewal risk if not addressed.",
    keyMoments: [
      {
        timestamp: "05:30",
        text: "We love the product but onboarding a wave of new hires was a nightmare",
        sentiment: "negative",
      },
      {
        timestamp: "12:15",
        text: "If you had guided tours, that would cut our ramp time in half",
        sentiment: "mixed",
      },
      {
        timestamp: "28:00",
        text: "We're committed to renewing but need to see onboarding improvements soon",
        sentiment: "positive",
      },
    ],
    actionItems: [
      "Share onboarding roadmap with customer next sprint",
      "Set up sandbox environment pilot for DemoScale",
      "Schedule follow-up in 30 days",
    ],
    themes: ["onboarding", "ux", "training", "growth", "renewal"],
  },
  {
    id: "ac-002",
    title: "Renewal Call — SampleBank",
    date: "2026-02-19",
    duration: "35 min",
    participants: ["Parker Demo (SampleBank)", "Our AE: Jordan Seller"],
    summary:
      "Very positive synthetic renewal conversation. The customer wants to expand from a pilot to a broader multi-team rollout. Key blockers are SSO reliability and a department-level admin console. The sample account indicates budget is available if those issues are addressed soon.",
    keyMoments: [
      {
        timestamp: "03:00",
        text: "Leadership is bought in — we want this company-wide",
        sentiment: "positive",
      },
      {
        timestamp: "15:45",
        text: "But the SSO dropping three times a month is a dealbreaker for IT",
        sentiment: "negative",
      },
      {
        timestamp: "22:30",
        text: "We have expansion budget approved if you fix the SSO and give us admin tools",
        sentiment: "positive",
      },
    ],
    actionItems: [
      "Escalate SSO fix to P0 priority",
      "Share admin console mockups within 2 weeks",
      "Draft expansion proposal for broader rollout",
      "Weekly check-in calls until SSO resolved",
    ],
    themes: ["expansion", "sso", "admin", "upsell", "enterprise"],
  },
  {
    id: "ac-003",
    title: "Competitive Loss Debrief — ProspectCo",
    date: "2026-02-21",
    duration: "20 min",
    participants: ["Internal: Sales AE Jordan Blake", "Sales Manager Pat Kim"],
    summary:
      "Lost a synthetic mid-market deal to Competitor Alpha. The prospect cited AI-powered feedback analysis and auto-categorization as the primary differentiators. This sample call is meant to model repeated losses where AI capabilities are the deciding factor.",
    keyMoments: [
      {
        timestamp: "02:00",
        text: "They showed the prospect auto-generated themes and sentiment analysis — we had nothing comparable",
        sentiment: "negative",
      },
      {
        timestamp: "08:30",
        text: "The prospect said our product was stronger in other areas, but AI was the tiebreaker",
        sentiment: "mixed",
      },
      {
        timestamp: "14:00",
        text: "We need to fast-track AI features or we're going to keep losing these deals",
        sentiment: "negative",
      },
    ],
    actionItems: [
      "Document all competitive losses citing AI gap",
      "Create competitive battle card for CompetitorX",
      "Escalate AI feature priority to product leadership",
    ],
    themes: ["competitive", "ai", "product-gap", "churn-risk"],
  },
  {
    id: "ac-004",
    title: "Support Escalation — ExampleCorp",
    date: "2026-02-28",
    duration: "25 min",
    participants: ["Avery Example (ExampleCorp)", "Support Lead: Morgan Support"],
    summary:
      "Critical synthetic escalation about dashboard performance. The customer's team is experiencing 15-20 second load times, making the product unusable for a review workflow. The sample issue is framed as starting after a recent release and needing urgent resolution.",
    keyMoments: [
      {
        timestamp: "01:30",
        text: "My entire team has stopped using the dashboards — we're back to spreadsheets",
        sentiment: "negative",
      },
      {
        timestamp: "10:00",
        text: "We have an important review coming up and we need this fixed before then",
        sentiment: "negative",
      },
      {
        timestamp: "20:00",
        text: "If you can fix this, we're still planning to expand to the marketing team",
        sentiment: "positive",
      },
    ],
    actionItems: [
      "Engineering hotfix for dashboard performance this sprint",
      "Daily status updates to ExampleCorp",
      "Post-mortem after fix deployed",
    ],
    themes: ["performance", "dashboard", "enterprise", "escalation"],
  },
];

export const DEMO_INSIGHTS: Insight[] = [
  {
    id: "ins-001",
    type: "risk",
    title: "SSO Reliability Threatens Strategic Expansion",
    description:
      "SSO reliability issues are mentioned by several enterprise accounts in the synthetic demo dataset. One strategic account has a broader rollout contingent on SSO fixes, and another renewal scenario is framed as at risk. Immediate engineering attention is still the takeaway.",
    confidence: 0.95,
    relatedFeedbackIds: ["fb-003", "fb-010"],
    themes: ["sso", "reliability", "enterprise", "churn-risk"],
    impact: "high",
    createdAt: "2026-03-01",
  },
  {
    id: "ins-002",
    type: "trend",
    title: "AI Feature Gap Driving Competitive Pressure",
    description:
      "Multiple synthetic deals are marked as lost due to competitor AI capabilities. The demo internal notes and leadership feedback both flag this as critical. AI summarization remains the top-voted feature in the sample roadmap data.",
    confidence: 0.92,
    relatedFeedbackIds: ["fb-008", "fb-012"],
    themes: ["ai", "competitive", "product-gap"],
    impact: "high",
    createdAt: "2026-03-01",
  },
  {
    id: "ins-003",
    type: "theme",
    title: "Enterprise Readiness Is the Common Thread",
    description:
      "6 out of 12 recent feedback items relate to enterprise-grade requirements: RBAC, SSO, compliance exports, and admin tools. The pattern suggests the product is hitting a growth ceiling with mid-market and enterprise customers who need more sophisticated controls.",
    confidence: 0.88,
    relatedFeedbackIds: ["fb-003", "fb-007", "fb-009", "fb-010", "fb-012"],
    themes: ["enterprise", "permissions", "compliance", "sso"],
    impact: "high",
    createdAt: "2026-03-01",
  },
  {
    id: "ins-004",
    type: "recommendation",
    title: "Prioritize: Performance → SSO → AI Features",
    description:
      "Based on urgency and impact analysis in the synthetic demo data: (1) dashboard performance needs immediate attention, (2) SSO reliability unlocks a strategic expansion scenario, and (3) AI features address competitive positioning and longer-term churn reduction.",
    confidence: 0.85,
    relatedFeedbackIds: ["fb-001", "fb-003", "fb-008", "fb-010"],
    themes: ["performance", "sso", "ai", "strategy"],
    impact: "high",
    createdAt: "2026-03-01",
  },
  {
    id: "ins-005",
    type: "anomaly",
    title: "Onboarding Friction Correlates with Account Growth",
    description:
      "Accounts that have grown 50%+ in seats show a 3x higher rate of onboarding-related complaints. ScaleUp Industries (60% growth) and 4 other expanding accounts report the same pattern. Current onboarding scales linearly — need a self-serve approach.",
    confidence: 0.79,
    relatedFeedbackIds: ["fb-005", "fb-012"],
    themes: ["onboarding", "growth", "ux"],
    impact: "medium",
    createdAt: "2026-03-01",
  },
  {
    id: "ins-006",
    type: "trend",
    title: "Developer Experience Requests Rising",
    description:
      "API-related feedback has increased 40% month-over-month. Rate limits, webhook reliability, and integration depth are the top themes. This signals a shift toward platform-play customers who want to build on top of the product.",
    confidence: 0.82,
    relatedFeedbackIds: ["fb-004", "fb-011"],
    themes: ["api", "developer-experience", "integration", "webhooks"],
    impact: "medium",
    createdAt: "2026-03-01",
  },
];

export const DEMO_DATA_SOURCES: DataSourceStatus[] = [
  {
    name: "Productboard",
    source: "productboard",
    connected: true,
    lastSync: "2 min ago",
    itemCount: DEMO_PRODUCTBOARD_FEATURES.length,
    icon: "clipboard-list",
  },
  {
    name: "Attention",
    source: "attention",
    connected: true,
    lastSync: "5 min ago",
    itemCount: DEMO_ATTENTION_CALLS.length,
    icon: "phone",
  },
  {
    name: "Zendesk",
    source: "zendesk",
    connected: true,
    lastSync: "1 min ago",
    itemCount: DEMO_FEEDBACK.filter((f) => f.source === "zendesk").length,
    icon: "headphones",
  },
  {
    name: "Intercom",
    source: "intercom",
    connected: true,
    lastSync: "3 min ago",
    itemCount: DEMO_FEEDBACK.filter((f) => f.source === "intercom").length,
    icon: "message-circle",
  },
  {
    name: "Slack",
    source: "slack",
    connected: true,
    lastSync: "30 sec ago",
    itemCount: DEMO_FEEDBACK.filter((f) => f.source === "slack").length,
    icon: "hash",
  },
];

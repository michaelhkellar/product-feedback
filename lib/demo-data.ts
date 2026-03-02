import {
  FeedbackItem,
  ProductboardFeature,
  AttentionCall,
  Insight,
  DataSourceStatus,
} from "./types";

export const DEMO_FEEDBACK: FeedbackItem[] = [
  {
    id: "fb-001",
    source: "zendesk",
    title: "Dashboard loading times are unacceptable",
    content:
      "We've been experiencing dashboard load times of 15-20 seconds since the last update. This is severely impacting our team's workflow. Multiple users on our account have reported the same issue. We're on the Enterprise plan and this is a blocker for our quarterly review process.",
    customer: "Sarah Chen",
    company: "Acme Corp",
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
      "The new custom reporting builder is fantastic! We've already created 12 reports that replaced our manual Excel process. The drag-and-drop interface is intuitive. Would love to see scheduled email delivery of reports added next.",
    customer: "Marcus Johnson",
    company: "TechFlow Inc",
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
      "Third time this month our SSO integration has dropped. Users are getting locked out and it takes 2-3 hours for our IT team to reconnect. This is a security and productivity concern. We need a permanent fix or we'll need to evaluate alternatives.",
    customer: "David Park",
    company: "GlobalFinance",
    sentiment: "negative",
    themes: ["sso", "authentication", "reliability", "churn-risk"],
    date: "2026-02-26",
    priority: "critical",
    metadata: { plan: "Enterprise", arr: "$120k" },
  },
  {
    id: "fb-004",
    source: "productboard",
    title: "API rate limits too restrictive",
    content:
      "We're building a deep integration with your platform but the current rate limits (100 req/min) are insufficient for our sync process. We need at least 500 req/min to keep our systems in real-time sync. Happy to discuss our use case in detail.",
    customer: "Lisa Wang",
    company: "DataSync Solutions",
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
      "During our QBR call, the customer expressed frustration with onboarding. They've hired 30 new people this quarter and each one takes a full week to get productive on the platform. They're requesting interactive tutorials, role-based onboarding paths, and a sandbox environment.",
    customer: "James Mitchell",
    company: "ScaleUp Industries",
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
      "The mobile app consistently crashes when trying to view analytics on Android 14 devices. We've tested on Samsung Galaxy S24 and Pixel 8 Pro. The crash happens within 5 seconds of opening any chart view. This affects our field sales team who rely on mobile access.",
    customer: "Rachel Torres",
    company: "FieldForce Co",
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
      "We love the product but need granular role-based access control. Right now it's admin or viewer — we need custom roles with field-level permissions. We'd upgrade to Enterprise for this. Several other companies in our network have the same request.",
    customer: "Alex Petrov",
    company: "MidMarket Solutions",
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
      "Internal note from sales: Lost a deal to CompetitorX today. The prospect said their AI-powered feedback summaries and auto-categorization were the deciding factor. We're hearing this more frequently in competitive deals. Three losses this month citing AI capabilities.",
    customer: "Internal — Sales Team",
    company: "Internal",
    sentiment: "negative",
    themes: ["competitive", "ai", "product-gap", "churn-risk"],
    date: "2026-02-21",
    priority: "critical",
    metadata: { source: "internal", dealsLost: "3" },
  },
  {
    id: "fb-009",
    source: "productboard",
    title: "Bulk data export needed for compliance",
    content:
      "As part of our SOC 2 audit, we need to export all customer interaction data in a structured format. The current export is limited to CSV with 10k rows. We need full JSON/Parquet export with no row limits. This is a compliance blocker for Q2 renewal.",
    customer: "Nina Kowalski",
    company: "SecureBank",
    sentiment: "negative",
    themes: ["compliance", "export", "data", "enterprise", "churn-risk"],
    date: "2026-02-20",
    priority: "high",
    metadata: { plan: "Enterprise", renewalDate: "2026-06-01" },
  },
  {
    id: "fb-010",
    source: "attention",
    title: "Expansion opportunity — 500 additional seats",
    content:
      "During renewal call, VP of Ops mentioned they want to roll out to all departments. Currently at 50 seats, potential for 500+. Key blocker is the SSO reliability issue and needing an admin console for department-level management. If fixed by Q2, they'll commit to full rollout.",
    customer: "Tom Bradley",
    company: "GlobalFinance",
    sentiment: "positive",
    themes: ["expansion", "sso", "admin", "upsell"],
    date: "2026-02-19",
    priority: "high",
    metadata: { currentSeats: "50", potentialSeats: "500", arr: "$120k" },
  },
  {
    id: "fb-011",
    source: "zendesk",
    title: "Webhook delivery is unreliable",
    content:
      "We've set up webhooks for real-time sync but about 15% of events are never delivered. No retry mechanism visible. This breaks our downstream automation pipeline. Need reliable webhook delivery with retry logic and a dead letter queue.",
    customer: "Kevin Huang",
    company: "AutomateAll",
    sentiment: "negative",
    themes: ["webhooks", "reliability", "api", "integration"],
    date: "2026-02-18",
    priority: "high",
    metadata: { ticketId: "ZD-4467", failureRate: "15%" },
  },
  {
    id: "fb-012",
    source: "manual",
    title: "Executive feedback from board meeting",
    content:
      "Board feedback: Customers love the core product but churn is ticking up among mid-market accounts. Top cited reasons: (1) lack of AI/automation features, (2) onboarding friction, (3) missing enterprise-grade permissions. Board wants a 90-day action plan.",
    customer: "Internal — Executive Team",
    company: "Internal",
    sentiment: "mixed",
    themes: ["churn", "ai", "onboarding", "permissions", "strategy"],
    date: "2026-02-17",
    priority: "critical",
    metadata: { source: "board-meeting" },
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
    title: "QBR — ScaleUp Industries",
    date: "2026-02-24",
    duration: "45 min",
    participants: ["James Mitchell (ScaleUp)", "Our CSM: Andrea Lopez"],
    summary:
      "Customer expressed strong frustration with onboarding experience for new hires. They've grown 60% this quarter and each new user takes a full week to become productive. Requested interactive tutorials and sandbox environment. Overall satisfied with core product but this is becoming a renewal risk if not addressed.",
    keyMoments: [
      {
        timestamp: "05:30",
        text: "We love the product but onboarding 30 people was a nightmare",
        sentiment: "negative",
      },
      {
        timestamp: "12:15",
        text: "If you had guided tours like Pendo does, that would cut our ramp time in half",
        sentiment: "mixed",
      },
      {
        timestamp: "28:00",
        text: "We're committed to renewing but need to see onboarding improvements by Q3",
        sentiment: "positive",
      },
    ],
    actionItems: [
      "Share onboarding roadmap with customer by March 15",
      "Set up sandbox environment pilot for ScaleUp",
      "Schedule follow-up in 30 days",
    ],
    themes: ["onboarding", "ux", "training", "growth", "renewal"],
  },
  {
    id: "ac-002",
    title: "Renewal Call — GlobalFinance",
    date: "2026-02-19",
    duration: "35 min",
    participants: ["Tom Bradley (GlobalFinance)", "Our AE: Chris Nguyen"],
    summary:
      "Very positive renewal conversation. Customer wants to expand from 50 to 500 seats across all departments. Key blockers: SSO reliability needs to be fixed, and they need department-level admin console. VP mentioned $600k budget approved if we can deliver by Q2.",
    keyMoments: [
      {
        timestamp: "03:00",
        text: "Our CEO is bought in — we want this company-wide",
        sentiment: "positive",
      },
      {
        timestamp: "15:45",
        text: "But the SSO dropping three times a month is a dealbreaker for IT",
        sentiment: "negative",
      },
      {
        timestamp: "22:30",
        text: "We have budget approved for 500 seats if you fix the SSO and give us admin tools",
        sentiment: "positive",
      },
    ],
    actionItems: [
      "Escalate SSO fix to P0 priority",
      "Share admin console mockups within 2 weeks",
      "Draft expansion proposal for 500 seats",
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
      "Lost $85k deal to CompetitorX. Prospect cited AI-powered feedback analysis and auto-categorization as primary differentiators. This is the third loss this month where AI capabilities were the deciding factor. Competitor is marketing heavily around 'AI-first feedback intelligence.'",
    keyMoments: [
      {
        timestamp: "02:00",
        text: "They showed the prospect auto-generated themes and sentiment analysis — we had nothing comparable",
        sentiment: "negative",
      },
      {
        timestamp: "08:30",
        text: "The prospect said our product was better in every other way, but AI was the tiebreaker",
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
    title: "Support Escalation — Acme Corp",
    date: "2026-02-28",
    duration: "25 min",
    participants: ["Sarah Chen (Acme Corp)", "Support Lead: Mike Torres"],
    summary:
      "Critical escalation about dashboard performance. Customer's team of 45 users is experiencing 15-20 second load times, making the product unusable for their quarterly review process. They've identified the issue started after the v3.2 release. Deadline: must be resolved before March board meeting.",
    keyMoments: [
      {
        timestamp: "01:30",
        text: "My entire team has stopped using the dashboards — we're back to spreadsheets",
        sentiment: "negative",
      },
      {
        timestamp: "10:00",
        text: "We have a board presentation March 10th and we need this fixed by then",
        sentiment: "negative",
      },
      {
        timestamp: "20:00",
        text: "If you can fix this, we're still planning to expand to the marketing team",
        sentiment: "positive",
      },
    ],
    actionItems: [
      "Engineering hotfix for dashboard performance by March 5",
      "Daily status updates to Acme Corp",
      "Post-mortem after fix deployed",
    ],
    themes: ["performance", "dashboard", "enterprise", "escalation"],
  },
];

export const DEMO_INSIGHTS: Insight[] = [
  {
    id: "ins-001",
    type: "risk",
    title: "SSO Reliability Threatens $720k in Revenue",
    description:
      "SSO reliability issues are mentioned by 3 enterprise accounts representing $720k in combined ARR. GlobalFinance has a $600k expansion contingent on SSO fixes. SecureBank renewal at risk. Immediate engineering attention required.",
    confidence: 0.95,
    relatedFeedbackIds: ["fb-003", "fb-010"],
    themes: ["sso", "reliability", "enterprise", "churn-risk"],
    impact: "high",
    createdAt: "2026-03-01",
  },
  {
    id: "ins-002",
    type: "trend",
    title: "AI Feature Gap Causing Competitive Losses",
    description:
      "3 deals lost this month citing competitor AI capabilities. Internal sales team and board both flagging this as critical. CompetitorX's AI-first positioning is resonating with prospects. AI summarization is the #1 voted feature on Productboard with 847 votes.",
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
    title: "Prioritize: Performance Hotfix → SSO → AI Features",
    description:
      "Based on urgency and revenue impact analysis: (1) Dashboard performance hotfix needed before March 10 for Acme Corp board meeting, (2) SSO reliability fix unlocks $600k GlobalFinance expansion, (3) AI features address competitive positioning and long-term churn reduction.",
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

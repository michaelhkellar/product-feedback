import {
  FeedbackItem,
  ProductboardFeature,
  AttentionCall,
  Insight,
  DataSourceStatus,
  JiraIssue,
  ConfluencePage,
  AnalyticsOverview,
} from "./types";

// Synthetic demo data only. These names, companies, timelines, and business details
// are intentionally fictionalized for safe public sharing and product demos.

// ---- Demo date helpers ---------------------------------------------------
//
// Demo timestamps are computed relative to "today" so demo content always feels
// fresh — a "last 2 weeks" query at any point in time finds the recent items.
// Module-load is fine: server restarts pick up new dates; in-memory caches
// expire at ttl boundaries.
const DEMO_NOW = new Date();
function daysAgo(n: number): string {
  const d = new Date(DEMO_NOW);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export const DEMO_FEEDBACK: FeedbackItem[] = [
  {
    id: "fb-001",
    source: "productboard",
    title: "Dashboard loading times are unacceptable",
    content:
      "This synthetic demo account is seeing dashboard load times of 15-20 seconds after a recent update. Multiple users reported the same slowdown, and it is disrupting a quarterly review workflow in the sample environment.",
    customer: "Avery Example",
    company: "ExampleCorp",
    sentiment: "negative",
    themes: ["performance", "dashboard", "enterprise"],
    date: daysAgo(7),
    priority: "critical",
    metadata: { ticketId: "ZD-4521", plan: "Enterprise", userEmail: "avery@examplecorp.demo" },
  },
  {
    id: "fb-002",
    source: "productboard",
    title: "Love the new reporting feature",
    content:
      "The new custom reporting builder is fantastic for this demo workspace. We already created a dozen reports that replaced manual spreadsheet work. The drag-and-drop interface feels intuitive, and scheduled email delivery would make it even better.",
    customer: "Jordan Sample",
    company: "Northwind Demo",
    sentiment: "positive",
    themes: ["reporting", "ux", "feature-request"],
    date: daysAgo(8),
    priority: "low",
    metadata: { plan: "Pro", userEmail: "jordan@northwind.demo" },
  },
  {
    id: "fb-003",
    source: "productboard",
    title: "SSO integration keeps breaking",
    content:
      "In this synthetic scenario, the SSO integration dropped for the third time this month. Users are getting locked out and the reconnect process takes hours for the IT team. This is framed as a security and productivity concern in the demo dataset.",
    customer: "Casey Demo",
    company: "SampleBank",
    sentiment: "negative",
    themes: ["sso", "authentication", "reliability", "churn-risk"],
    date: daysAgo(9),
    priority: "critical",
    metadata: { plan: "Enterprise", accountTier: "Strategic", userEmail: "casey@samplebank.demo" },
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
    date: daysAgo(10),
    priority: "high",
    metadata: { plan: "Enterprise", integration: "REST API", sourceUrl: "https://demo.productboard.com/notes/fb-004", userEmail: "morgan@demosync.demo" },
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
    date: daysAgo(11),
    priority: "high",
    metadata: { callType: "QBR", accountSize: "200 seats", userEmail: "taylor@demoscale.demo" },
  },
  {
    id: "fb-006",
    source: "productboard",
    title: "Mobile app crashes on Android 14",
    content:
      "The mobile app consistently crashes when trying to view analytics on Android 14 devices in this demo account. The crash happens within seconds of opening a chart view, affecting a field team that relies on mobile access.",
    customer: "Jamie Example",
    company: "Placeholder Field Ops",
    sentiment: "negative",
    themes: ["mobile", "bug", "android", "analytics"],
    date: daysAgo(12),
    priority: "critical",
    metadata: { ticketId: "ZD-4498", devices: "Android 14", userEmail: "jamie@fieldops.demo" },
  },
  {
    id: "fb-007",
    source: "productboard",
    title: "Would pay more for advanced permissions",
    content:
      "We love the product in this synthetic example but need granular role-based access control. Right now it's admin or viewer; we need custom roles with field-level permissions. This is positioned as a likely upgrade trigger in the demo dataset.",
    customer: "Riley Sample",
    company: "DemoMarket Solutions",
    sentiment: "mixed",
    themes: ["permissions", "rbac", "upsell", "enterprise"],
    date: daysAgo(13),
    priority: "medium",
    metadata: { plan: "Pro", potentialUpgrade: "Enterprise", userEmail: "riley@demomarket.demo" },
  },
  {
    id: "fb-008",
    source: "manual",
    title: "Competitor just launched AI summaries",
    content:
      "Synthetic internal note: lost a sample deal to Competitor Alpha. The prospect said AI-powered feedback summaries and auto-categorization were the deciding factor. This demo record is meant to simulate repeated competitive pressure around AI capabilities.",
    customer: "Internal — Demo GTM Team",
    company: "Internal (Synthetic)",
    sentiment: "negative",
    themes: ["competitive", "ai", "product-gap", "churn-risk"],
    date: daysAgo(14),
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
    date: daysAgo(15),
    priority: "high",
    metadata: { plan: "Enterprise", renewalWindow: "Upcoming", sourceUrl: "https://demo.productboard.com/notes/fb-009", userEmail: "sam@samplebank.demo" },
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
    date: daysAgo(16),
    priority: "high",
    metadata: { currentSeats: "Pilot", potentialSeats: "Multi-team", accountTier: "Strategic", userEmail: "parker@samplebank.demo" },
  },
  {
    id: "fb-011",
    source: "productboard",
    title: "Webhook delivery is unreliable",
    content:
      "We've set up webhooks for real-time sync in this demo scenario, but a noticeable share of events are never delivered. No retry mechanism is visible, which breaks downstream automation. The request is for reliable delivery, retries, and a dead letter queue.",
    customer: "Cameron Sample",
    company: "Demo Automations",
    sentiment: "negative",
    themes: ["webhooks", "reliability", "api", "integration"],
    date: daysAgo(17),
    priority: "high",
    metadata: { ticketId: "ZD-4467", failureRate: "noticeable", userEmail: "cameron@demoauto.demo" },
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
    date: daysAgo(18),
    priority: "critical",
    metadata: { source: "synthetic-board-meeting" },
  },
  {
    id: "fb-013",
    source: "productboard",
    title: "Search returns irrelevant results and is painfully slow",
    content:
      "Our team relies on search to find past feedback and feature requests across thousands of records. In this demo scenario, queries take 8-10 seconds and the results are often unrelated to what was typed. We need full-text search with filters for source, date range, and sentiment.",
    customer: "Drew Example",
    company: "Northwind Demo",
    sentiment: "negative",
    themes: ["search", "performance", "ux"],
    date: daysAgo(5),
    priority: "high",
    metadata: { ticketId: "ZD-4534", plan: "Pro", userEmail: "drew@northwind.demo" },
  },
  {
    id: "fb-014",
    source: "productboard",
    title: "Notification overload — need better controls",
    content:
      "We get hundreds of notifications a day and there is no way to filter or customize them. In this demo scenario the team has started ignoring all notifications, which means critical alerts get missed. We need per-channel controls, digest mode, and severity-based routing.",
    customer: "Alex Placeholder",
    company: "DemoScale Co",
    sentiment: "negative",
    themes: ["notifications", "ux", "productivity"],
    date: daysAgo(4),
    priority: "medium",
    metadata: { plan: "Growth", userEmail: "alex@demoscale.demo" },
  },
  {
    id: "fb-015",
    source: "manual",
    title: "Lost another deal — prospect wanted native Salesforce integration",
    content:
      "Synthetic internal note: prospect evaluated us against Competitor Beta. We scored higher on analytics and UI but lost because Competitor Beta has a native Salesforce integration and a marketplace with 40+ connectors. Our integration story is too thin for enterprise buyers.",
    customer: "Internal — Demo Sales",
    company: "Internal (Synthetic)",
    sentiment: "negative",
    themes: ["integrations", "competitive", "salesforce", "churn-risk"],
    date: daysAgo(6),
    priority: "high",
    metadata: { source: "internal-demo", competitor: "Competitor Beta" },
  },
  {
    id: "fb-016",
    source: "productboard",
    title: "Need team collaboration — comments, @mentions, shared views",
    content:
      "Right now there is no way for our product and CS teams to collaborate inside the tool. In this demo scenario we are copying and pasting feedback into Slack threads, which loses context. We need inline comments, @mentions on feedback items, shared saved views, and activity logs.",
    customer: "Sage Sample",
    company: "ExampleCorp",
    sentiment: "mixed",
    themes: ["collaboration", "ux", "feature-request", "enterprise"],
    date: daysAgo(3),
    priority: "medium",
    metadata: { plan: "Enterprise", userEmail: "sage@examplecorp.demo" },
  },
  {
    id: "fb-017",
    source: "productboard",
    title: "Custom fields and workflows for different departments",
    content:
      "Our product, CS, and engineering teams all use this tool differently in the demo scenario. Product wants priority scoring and roadmap views. CS wants customer health and sentiment dashboards. Engineering wants severity and component tagging. We need configurable fields and workflow states per team.",
    customer: "Quinn Example",
    company: "DemoMarket Solutions",
    sentiment: "mixed",
    themes: ["customization", "workflows", "enterprise", "feature-request"],
    date: daysAgo(2),
    priority: "medium",
    metadata: { plan: "Pro", sourceUrl: "https://demo.productboard.com/notes/fb-017", userEmail: "quinn@demomarket.demo" },
  },
  {
    id: "fb-018",
    source: "productboard",
    title: "Charts are too basic — need scatter plots, funnels, cohort analysis",
    content:
      "The current chart types are limited to bar, line, and pie. In this demo scenario our data team needs scatter plots for correlation analysis, funnel charts for conversion tracking, and cohort analysis for retention. Without these, we export to Looker which defeats the purpose.",
    customer: "Rowan Placeholder",
    company: "DemoSync Labs",
    sentiment: "negative",
    themes: ["analytics", "reporting", "data-visualization", "feature-request"],
    date: daysAgo(1),
    priority: "medium",
    metadata: { ticketId: "ZD-4547", plan: "Enterprise", userEmail: "rowan@demosync.demo" },
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
  {
    id: "pb-009",
    name: "Notification Center & Digest Controls",
    description:
      "Centralized notification management with per-channel controls, severity routing, daily/weekly digest mode, and quiet hours. Replace the current all-or-nothing notification system.",
    status: "new",
    votes: 291,
    customerRequests: 83,
    themes: ["notifications", "ux", "productivity"],
  },
  {
    id: "pb-010",
    name: "Custom Report Builder v1",
    description:
      "First version of the drag-and-drop custom report builder shipped. Supports bar, line, and pie charts with basic filtering. Scheduled email delivery and additional chart types planned for v2.",
    status: "done",
    votes: 756,
    customerRequests: 312,
    themes: ["reporting", "analytics", "ux"],
  },
];

export const DEMO_ATTENTION_CALLS: AttentionCall[] = [
  {
    id: "ac-001",
    title: "QBR — DemoScale Co",
    date: daysAgo(11),
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
    themes: ["onboarding-friction", "training", "growth", "renewal-risk"],
    url: "https://grain.com/recordings/demo-ac-001",
    callType: "qbr",
    transcript:
      "[00:00] Avery Support: Hi Taylor, thanks for joining the QBR. How are things going on your end this quarter?\n" +
      "[00:35] Taylor Placeholder: Generally good — but we doubled the team and the onboarding has been a real pain point.\n" +
      "[05:30] Taylor Placeholder: We love the product but onboarding a wave of new hires was a nightmare. Each new user spends a week clicking around with no clear path.\n" +
      "[08:10] Avery Support: That maps to other accounts we're hearing from. What would help most?\n" +
      "[12:15] Taylor Placeholder: If you had guided tours, that would cut our ramp time in half. We've literally built our own internal Loom library because the in-app help isn't enough.\n" +
      "[18:40] Avery Support: We have a sandbox environment in private beta — would your team be a good pilot candidate?\n" +
      "[19:05] Taylor Placeholder: Yes, definitely. Send me the details.\n" +
      "[22:00] Taylor Placeholder: Honestly, the other gap is role-based onboarding paths. Our analysts and our PMs have totally different needs.\n" +
      "[28:00] Taylor Placeholder: We're committed to renewing but need to see onboarding improvements soon. The CFO is asking hard questions about what we're paying per seat.\n" +
      "[35:00] Avery Support: Okay, here's what I'll commit to: I'll share our onboarding roadmap with you next sprint, set up the sandbox pilot, and we'll have a follow-up in 30 days.\n" +
      "[40:30] Taylor Placeholder: Perfect. If we see real movement, this is an easy renewal.\n",
  },
  {
    id: "ac-002",
    title: "Renewal Call — SampleBank",
    date: daysAgo(16),
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
    themes: ["sso-reliability", "admin-console", "expansion-opportunity", "enterprise"],
    url: "https://grain.com/recordings/demo-ac-002",
    callType: "renewal",
    transcript:
      "[00:00] Jordan Seller: Parker, great to have you on. Walk me through where SampleBank's at heading into renewal.\n" +
      "[03:00] Parker Demo: Leadership is bought in — we want this company-wide. Honestly the pilot blew the doors off.\n" +
      "[07:25] Jordan Seller: That's terrific. What's the gating factor on a broader rollout?\n" +
      "[15:45] Parker Demo: But the SSO dropping three times a month is a dealbreaker for IT. They've actually started flagging us in our security review.\n" +
      "[18:30] Jordan Seller: I hear you. Anything else on the blocker list?\n" +
      "[19:50] Parker Demo: Yeah — admin console. Right now I can't manage department-level users without a support ticket. That's not going to fly at company-scale.\n" +
      "[22:30] Parker Demo: We have expansion budget approved if you fix the SSO and give us admin tools. That's a six-figure delta to the contract.\n" +
      "[28:00] Jordan Seller: Understood. I'm escalating the SSO work to P0 today, and I'll have admin console mockups in your inbox within two weeks.\n" +
      "[31:15] Parker Demo: One more thing — let's do weekly check-ins until SSO is solved. I want this on a tight loop.\n" +
      "[34:00] Jordan Seller: Done. I'll draft the expansion proposal alongside.\n",
  },
  {
    id: "ac-003",
    title: "Competitive Loss Debrief — ProspectCo",
    date: daysAgo(14),
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
      "Create competitive battle card for Competitor Alpha",
      "Escalate AI feature priority to product leadership",
    ],
    themes: ["competitive-loss", "ai-features", "auto-categorization", "feature-gap"],
    url: "https://grain.com/recordings/demo-ac-003",
    callType: "internal-sync",
    transcript:
      "[00:00] Pat Kim: Walk me through the loss. What did the prospect say in the close-out?\n" +
      "[02:00] Jordan Blake: They showed the prospect auto-generated themes and sentiment analysis — we had nothing comparable. It was a side-by-side demo and we lost on that single feature.\n" +
      "[05:30] Pat Kim: Was pricing a factor at all?\n" +
      "[06:15] Jordan Blake: No. Pricing came up but the prospect was fine with our number.\n" +
      "[08:30] Jordan Blake: The prospect said our product was stronger in other areas, but AI was the tiebreaker. They're under board pressure to show \"AI-powered\" something — and we don't have anything to put on a slide.\n" +
      "[11:00] Pat Kim: This is the third one this quarter, right?\n" +
      "[11:20] Jordan Blake: Fourth, actually. All same shape — auto-tagging, summary, sentiment.\n" +
      "[14:00] Jordan Blake: We need to fast-track AI features or we're going to keep losing these deals. I can't keep walking into rooms knowing we're going to lose on this axis.\n" +
      "[17:30] Pat Kim: Document everything. I'll take this up to product leadership directly. We need a battle card and a roadmap commitment.\n",
  },
  {
    id: "ac-004",
    title: "Support Escalation — ExampleCorp",
    date: daysAgo(7),
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
    themes: ["dashboard-performance", "regression", "enterprise-blocker"],
    url: "https://grain.com/recordings/demo-ac-004",
    callType: "customer-support",
    transcript:
      "[00:00] Morgan Support: Avery, I want to start by saying we know this is severe. Walk me through what's happening.\n" +
      "[01:30] Avery Example: My entire team has stopped using the dashboards — we're back to spreadsheets. Our analysts gave up two days ago.\n" +
      "[03:45] Morgan Support: When did this start?\n" +
      "[04:00] Avery Example: Right after your last release. Friday afternoon. Loads went from instant to 15-20 seconds.\n" +
      "[07:30] Avery Example: The board review dashboards are the most affected. Those are the highest-cardinality views, which we know is hard, but they were fine before.\n" +
      "[10:00] Avery Example: We have an important review coming up and we need this fixed before then. I have CFO eyes on these dashboards on Tuesday.\n" +
      "[14:20] Morgan Support: Let me be direct: we're committing to a hotfix this sprint. I'll give you daily status updates. Engineering is already on it.\n" +
      "[20:00] Avery Example: If you can fix this, we're still planning to expand to the marketing team. Don't blow that goodwill — we like the product.\n" +
      "[23:15] Morgan Support: Got it. I'll commit to a post-mortem after the fix lands so you can share it with your team.\n",
  },
  {
    id: "ac-005",
    title: "Upsell Discovery — DemoMarket Solutions",
    date: daysAgo(3),
    duration: "30 min",
    participants: ["Riley Sample (DemoMarket)", "Quinn Example (DemoMarket)", "Our AE: Sage Closer"],
    summary:
      "Synthetic upsell call with DemoMarket Solutions. They are on the Pro plan but need Enterprise features — specifically RBAC and custom workflows. Two department heads joined to describe conflicting needs: Product wants priority scoring while CS wants sentiment dashboards. They confirmed willingness to upgrade if custom roles and configurable fields ship this quarter.",
    keyMoments: [
      {
        timestamp: "04:00",
        text: "We have 3 departments using this tool and everyone sees everything — it's chaos",
        sentiment: "negative",
      },
      {
        timestamp: "14:30",
        text: "Product team needs different fields and views than CS — one size doesn't fit all",
        sentiment: "mixed",
      },
      {
        timestamp: "25:00",
        text: "If you can give us custom roles and per-team views, we'll upgrade to Enterprise this quarter",
        sentiment: "positive",
      },
    ],
    actionItems: [
      "Send RBAC beta access timeline to DemoMarket",
      "Share custom fields roadmap with both department leads",
      "Schedule Enterprise upgrade scoping call for next week",
    ],
    themes: ["rbac", "custom-fields", "multi-team", "enterprise-tier"],
    url: "https://grain.com/recordings/demo-ac-005",
    callType: "discovery",
    transcript:
      "[00:00] Sage Closer: Riley, Quinn — thanks for making time. Walk me through how DemoMarket is using us today.\n" +
      "[01:30] Riley Sample: We're on the Pro plan but it's getting awkward. Three departments now use it.\n" +
      "[04:00] Quinn Example: We have 3 departments using this tool and everyone sees everything — it's chaos. Product is looking at CS data they shouldn't, CS is looking at our pipeline.\n" +
      "[09:00] Sage Closer: That's exactly what RBAC solves. We have a beta available.\n" +
      "[14:30] Riley Sample: Product team needs different fields and views than CS — one size doesn't fit all. We need custom fields, badly.\n" +
      "[17:00] Quinn Example: Right, and we want different default views per role. CS wants sentiment-first. Product wants priority-first.\n" +
      "[20:00] Sage Closer: Both are on the Enterprise tier roadmap. Let me share the timeline.\n" +
      "[25:00] Riley Sample: If you can give us custom roles and per-team views, we'll upgrade to Enterprise this quarter. That's a real commitment.\n" +
      "[28:30] Sage Closer: Great. I'll send the RBAC beta access details, the custom fields roadmap to both of you, and we'll book the scoping call for next week.\n",
  },
  {
    id: "ac-006",
    title: "Post-Churn Interview — BrightPath Analytics",
    date: daysAgo(0),
    duration: "20 min",
    participants: ["Hayden Former (BrightPath)", "Our CSM: Alex Retention"],
    summary:
      "Synthetic post-churn interview with BrightPath Analytics, a former mid-market customer. They churned after 14 months and switched to Competitor Alpha. Primary reasons: onboarding was too difficult for their growing team, the lack of AI features made manual categorization unsustainable at scale, and they wanted a Salesforce integration that didn't exist. They left on good terms and would reconsider if those gaps are addressed.",
    keyMoments: [
      {
        timestamp: "03:00",
        text: "We loved the core product but couldn't get new team members up to speed fast enough",
        sentiment: "mixed",
      },
      {
        timestamp: "09:00",
        text: "Manually categorizing 200+ feedback items a week just wasn't sustainable — Competitor Alpha auto-tags everything",
        sentiment: "negative",
      },
      {
        timestamp: "16:00",
        text: "If you ship AI categorization and a Salesforce connector, honestly we'd come back",
        sentiment: "positive",
      },
    ],
    actionItems: [
      "Add BrightPath to win-back list when AI features ship",
      "Document churn reasons for product leadership review",
      "Include Salesforce integration in competitive gap analysis",
    ],
    themes: ["onboarding-friction", "ai-categorization", "salesforce-integration", "win-back-candidate"],
    url: "https://grain.com/recordings/demo-ac-006",
    callType: "churn-debrief",
    transcript:
      "[00:00] Alex Retention: Hayden, I appreciate you taking this call. We want to learn from this honestly.\n" +
      "[03:00] Hayden Former: We loved the core product but couldn't get new team members up to speed fast enough. We hired six analysts in two quarters and onboarding was just brutal.\n" +
      "[06:30] Alex Retention: Was that the primary driver?\n" +
      "[07:00] Hayden Former: It was one of three. The bigger one really was the AI gap.\n" +
      "[09:00] Hayden Former: Manually categorizing 200+ feedback items a week just wasn't sustainable — Competitor Alpha auto-tags everything. My team got 12 hours a week back.\n" +
      "[12:30] Alex Retention: Anything on integrations?\n" +
      "[13:00] Hayden Former: Yeah. We use Salesforce for everything customer-facing. The lack of a connector meant data was always slightly out of date in your tool. Small thing, but daily annoyance.\n" +
      "[16:00] Hayden Former: If you ship AI categorization and a Salesforce connector, honestly we'd come back. Our team likes the UX better than where we are now.\n" +
      "[18:30] Alex Retention: That's good to hear. I'm going to put BrightPath on the win-back list and document everything you've shared for product leadership.\n",
  },
];

export const DEMO_JIRA_ISSUES: JiraIssue[] = [
  {
    id: "jira-001",
    key: "CX-1234",
    summary: "SSO disconnection affecting SampleBank — 3rd occurrence this month",
    description:
      "SampleBank's SSO (Okta) drops authentication intermittently. Users are locked out for 2-4 hours each time. IT team has to manually re-authenticate. This is a strategic account with expansion budget contingent on reliability. See ZD tickets and renewal call notes for full context.",
    status: "In Progress",
    issueType: "Bug",
    priority: "Critical",
    assignee: "Demo Engineer A",
    reporter: "Morgan Support",
    labels: ["sso", "enterprise", "strategic-account", "p0"],
    created: "2026-02-26",
    updated: "2026-03-05",
    project: "CX",
    resolution: "Unresolved",
  },
  {
    id: "jira-002",
    key: "CX-1245",
    summary: "Dashboard performance regression after v3.2 release",
    description:
      "Dashboard load times increased from ~2s to 15-20s after the v3.2 release for accounts with large datasets. Primarily affecting ExampleCorp and other Enterprise accounts with 50k+ records. Engineering identified a missing query index as likely cause.",
    status: "In Progress",
    issueType: "Bug",
    priority: "Critical",
    assignee: "Demo Engineer B",
    reporter: "Avery Support",
    labels: ["performance", "dashboard", "regression", "p0"],
    created: "2026-02-28",
    updated: "2026-03-04",
    project: "CX",
    resolution: "Unresolved",
  },
  {
    id: "jira-003",
    key: "CX-1256",
    summary: "Mobile app crash on Android 14 — chart rendering",
    description:
      "The Android app crashes immediately when opening any chart view on Android 14+ devices. Reproducible 100% of the time. The chart rendering library has a known incompatibility with Android 14's new graphics API. Workaround: use the web app on mobile browser.",
    status: "In Progress",
    issueType: "Bug",
    priority: "High",
    assignee: "Demo Engineer C",
    reporter: "Jamie Support",
    labels: ["mobile", "android", "crash", "charts"],
    created: "2026-02-23",
    updated: "2026-03-01",
    project: "CX",
    resolution: "Unresolved",
  },
  {
    id: "jira-004",
    key: "CX-1267",
    summary: "API rate limit increase request — DemoSync Labs integration blocked",
    description:
      "DemoSync Labs needs 1000+ req/min for their real-time sync integration. Current limit is 100 req/min on Enterprise. They are considering building a competing internal tool if we can't accommodate this. Related to webhook reliability issues as well.",
    status: "Open",
    issueType: "Story",
    priority: "High",
    assignee: "Unassigned",
    reporter: "Morgan Support",
    labels: ["api", "rate-limits", "enterprise", "integration"],
    created: "2026-02-25",
    updated: "2026-02-25",
    project: "CX",
    resolution: "Unresolved",
  },
  {
    id: "jira-005",
    key: "CX-1278",
    summary: "Onboarding documentation outdated — new users confused",
    description:
      "Multiple customers report that the onboarding docs reference features that have been renamed or moved. Screenshots are from 2 major versions ago. DemoScale Co specifically called this out in their QBR as contributing to slow user ramp time.",
    status: "Open",
    issueType: "Task",
    priority: "Medium",
    assignee: "Demo Tech Writer",
    reporter: "Taylor Support",
    labels: ["onboarding", "documentation", "ux"],
    created: "2026-02-24",
    updated: "2026-02-27",
    project: "CX",
    resolution: "Unresolved",
  },
  {
    id: "jira-006",
    key: "CX-1289",
    summary: "Bulk export times out for datasets over 100k rows",
    description:
      "SampleBank's compliance team needs to export all interaction data but the export job times out at approximately 100k rows. They need this for SOC 2 audit happening next quarter. No workaround available — they are currently exporting in chunks manually.",
    status: "Open",
    issueType: "Bug",
    priority: "High",
    assignee: "Unassigned",
    reporter: "Sam Support",
    labels: ["export", "compliance", "enterprise", "performance"],
    created: "2026-02-20",
    updated: "2026-02-22",
    project: "CX",
    resolution: "Unresolved",
  },
  {
    id: "jira-007",
    key: "CX-1301",
    summary: "Webhook events silently dropped — no retry or dead letter queue",
    description:
      "Demo Automations reports that a significant percentage of webhook events are never delivered. There is no retry mechanism and no way to see what was dropped. This breaks their downstream automation pipeline and requires manual reconciliation.",
    status: "Open",
    issueType: "Bug",
    priority: "High",
    assignee: "Unassigned",
    reporter: "Cameron Support",
    labels: ["webhooks", "reliability", "api", "integration"],
    created: "2026-02-18",
    updated: "2026-02-20",
    project: "CX",
    resolution: "Unresolved",
  },
  {
    id: "jira-008",
    key: "CX-1315",
    summary: "Search relevance poor — customers can't find their own feedback",
    description:
      "Multiple customers on Pro and Enterprise plans report that search returns irrelevant results and takes 8-10 seconds for large accounts. Northwind Demo provided specific examples of searches that return zero results for known items. Need full-text search with filtering.",
    status: "Open",
    issueType: "Story",
    priority: "Medium",
    assignee: "Unassigned",
    reporter: "Drew Support",
    labels: ["search", "ux", "performance"],
    created: "2026-03-02",
    updated: "2026-03-03",
    project: "CX",
    resolution: "Unresolved",
  },
];

export const DEMO_CONFLUENCE_PAGES: ConfluencePage[] = [
  {
    id: "conf-001",
    title: "Product Roadmap — Q2 2026",
    excerpt:
      "Quarterly roadmap with three tracks: Platform Reliability (SSO, performance, webhooks), Enterprise Features (RBAC, compliance export, custom fields), and AI & Intelligence (feedback summarization, auto-categorization, smart search). Priority order based on customer impact and revenue opportunity.",
    space: "PRODUCT",
    lastModified: "2026-03-01",
    author: "Demo PM Lead",
    url: "https://demo.atlassian.net/wiki/spaces/PRODUCT/pages/conf-001",
  },
  {
    id: "conf-002",
    title: "SSO Architecture & Troubleshooting Guide",
    excerpt:
      "Technical documentation for the SSO integration layer. Covers supported IdPs (Okta, Azure AD, OneLogin), the token refresh flow, known failure modes, and the monitoring/alerting setup. Includes a troubleshooting runbook for the recurring disconnection issue affecting enterprise accounts.",
    space: "ENG",
    lastModified: "2026-02-27",
    author: "Demo Engineer A",
    url: "https://demo.atlassian.net/wiki/spaces/ENG/pages/conf-002",
  },
  {
    id: "conf-003",
    title: "API Rate Limiting Policy & Tier Definitions",
    excerpt:
      "Defines rate limits by plan tier: Free (10 req/min), Pro (50 req/min), Enterprise (100 req/min). Includes the proposal to increase Enterprise to 1000 req/min, cost analysis of the infrastructure changes needed, and the webhook v2 reliability improvements roadmap.",
    space: "ENG",
    lastModified: "2026-02-25",
    author: "Demo Engineer D",
    url: "https://demo.atlassian.net/wiki/spaces/ENG/pages/conf-003",
  },
  {
    id: "conf-004",
    title: "Onboarding Redesign RFC — Interactive Guided Flows",
    excerpt:
      "RFC proposing a complete overhaul of the user onboarding experience. Includes role-based paths (Admin, Analyst, Viewer), interactive step-by-step tutorials, a sandbox environment for safe exploration, and progress tracking. Based on feedback from DemoScale Co QBR and 189 customer requests in Productboard.",
    space: "PRODUCT",
    lastModified: "2026-03-03",
    author: "Demo PM Lead",
    url: "https://demo.atlassian.net/wiki/spaces/PRODUCT/pages/conf-004",
  },
];

export const DEMO_PENDO_OVERVIEW: AnalyticsOverview = {
  provider: "pendo",
  topPages: [
    { id: "page-001", name: "Dashboard — Main", count: 48720, minutes: 12450 },
    { id: "page-002", name: "Feedback List", count: 31200, minutes: 8930 },
    { id: "page-003", name: "Reports — Custom Builder", count: 22150, minutes: 6780 },
    { id: "page-004", name: "Settings — Integrations", count: 15400, minutes: 3200 },
    { id: "page-005", name: "Search Results", count: 12800, minutes: 2140 },
    { id: "page-006", name: "Admin — Team Management", count: 8900, minutes: 1560 },
  ],
  topFeatures: [
    { id: "feat-001", name: "Custom Report Builder", count: 18500, minutes: 5620 },
    { id: "feat-002", name: "Feedback Search", count: 14200, minutes: 2890 },
    { id: "feat-003", name: "Data Export", count: 9800, minutes: 1240 },
    { id: "feat-004", name: "Notification Preferences", count: 7600, minutes: 890 },
    { id: "feat-005", name: "API Key Management", count: 5400, minutes: 620 },
  ],
  topEvents: [],
  topAccounts: [
    { id: "ExampleCorp", count: 24500, minutes: 6800 },
    { id: "SampleBank", count: 19200, minutes: 5400 },
    { id: "DemoScale Co", count: 16800, minutes: 4200 },
    { id: "DemoSync Labs", count: 12400, minutes: 3100 },
    { id: "DemoMarket Solutions", count: 9600, minutes: 2400 },
    { id: "Northwind Demo", count: 8100, minutes: 2000 },
    { id: "Placeholder Field Ops", count: 4300, minutes: 1100 },
    { id: "Demo Automations", count: 3800, minutes: 950 },
  ],
  totalTrackedPages: 12,
  totalTrackedFeatures: 8,
  generatedAt: "2026-03-07T12:00:00Z",
};

export const DEMO_AMPLITUDE_OVERVIEW: AnalyticsOverview = {
  provider: "amplitude",
  topPages: [
    { id: "dashboard", name: "Dashboard", count: 52300 },
    { id: "detections", name: "Detections", count: 38100 },
    { id: "response-playbooks", name: "Response Playbooks", count: 21900 },
    { id: "integrations", name: "Settings — Integrations", count: 14700 },
    { id: "reports", name: "Reports", count: 11200 },
    { id: "admin-users", name: "Admin — Users", count: 7800 },
  ],
  topFeatures: [],
  topEvents: [
    { id: "detection_triggered", name: "detection_triggered", count: 143200 },
    { id: "playbook_executed", name: "playbook_executed", count: 28400 },
    { id: "rule_created", name: "rule_created", count: 19600 },
    { id: "report_exported", name: "report_exported", count: 12300 },
    { id: "api_key_generated", name: "api_key_generated", count: 4100 },
  ],
  topAccounts: [],
  totalTrackedPages: 18,
  totalTrackedFeatures: 0,
  generatedAt: "2026-03-07T12:00:00Z",
  limitations: ["Feature-level and account-level analytics require Amplitude Taxonomy add-on"],
  allPageNames: ["Dashboard", "Detections", "Response Playbooks", "Settings — Integrations", "Reports", "Admin — Users"],
  allEventNames: ["detection_triggered", "playbook_executed", "rule_created", "report_exported", "api_key_generated"],
};

export const DEMO_INSIGHTS: Insight[] = [
  {
    id: "ins-001",
    type: "risk",
    title: "SSO Reliability Threatens Strategic Expansion",
    description:
      "SSO reliability issues are mentioned by several enterprise accounts in the synthetic demo dataset. SampleBank has a broader rollout contingent on SSO fixes, and their IT team flags the recurring disconnections as a dealbreaker. Jira CX-1234 tracks the engineering work. Immediate resolution unlocks significant expansion revenue.",
    confidence: 0.95,
    relatedFeedbackIds: ["fb-003", "fb-010"],
    themes: ["sso", "reliability", "enterprise", "churn-risk"],
    impact: "high",
    createdAt: "2026-03-01",
  },
  {
    id: "ins-002",
    type: "trend",
    title: "AI Feature Gap Driving Competitive Losses",
    description:
      "Multiple synthetic deals lost to Competitor Alpha, with AI-powered feedback analysis cited as the deciding factor. BrightPath Analytics churned specifically due to the lack of auto-categorization. Internal GTM notes and board-level feedback both flag this as critical. AI summarization remains the top-voted feature in the roadmap with 847 votes.",
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
      "8 out of 18 feedback items relate to enterprise-grade requirements: RBAC, SSO, compliance exports, custom workflows, and admin tools. The pattern suggests the product is hitting a growth ceiling with mid-market and enterprise customers who need more sophisticated controls. DemoMarket Solutions is ready to upgrade if RBAC ships this quarter.",
    confidence: 0.88,
    relatedFeedbackIds: ["fb-003", "fb-007", "fb-009", "fb-010", "fb-012", "fb-017"],
    themes: ["enterprise", "permissions", "compliance", "sso"],
    impact: "high",
    createdAt: "2026-03-01",
  },
  {
    id: "ins-004",
    type: "recommendation",
    title: "Prioritize: Performance → SSO → AI Features",
    description:
      "Based on urgency and impact analysis in the synthetic demo data: (1) dashboard performance needs an immediate hotfix — ExampleCorp has stopped using dashboards entirely, (2) SSO reliability unlocks SampleBank's expansion, and (3) AI features address competitive positioning and churn. This sequence maximizes revenue protection before investing in growth features.",
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
      "Accounts that have grown significantly in seats show disproportionate onboarding complaints. DemoScale Co (200 seats, rapid growth) reports each new user takes a week to ramp, and BrightPath Analytics listed onboarding difficulty as a primary churn reason. Pendo usage data shows the Admin — Team Management page has high traffic but low engagement time, suggesting admins struggle with the setup flow.",
    confidence: 0.79,
    relatedFeedbackIds: ["fb-005", "fb-012", "fb-014"],
    themes: ["onboarding", "growth", "ux"],
    impact: "medium",
    createdAt: "2026-03-01",
  },
  {
    id: "ins-006",
    type: "trend",
    title: "Developer Experience Requests Rising",
    description:
      "API-related feedback spans 4 customers across rate limits, webhook reliability, and integration depth. DemoSync Labs and Demo Automations both have critical workflows blocked by current limitations. Jira tracks 3 open API-related issues (CX-1267, CX-1301, CX-1315). This signals a shift toward platform-play customers who want to build on top of the product.",
    confidence: 0.82,
    relatedFeedbackIds: ["fb-004", "fb-011"],
    themes: ["api", "developer-experience", "integration", "webhooks"],
    impact: "medium",
    createdAt: "2026-03-01",
  },
  {
    id: "ins-007",
    type: "risk",
    title: "Integration Gap Losing Deals to Competitor Beta",
    description:
      "A separate competitive threat from Competitor Beta, which has a native Salesforce integration and a marketplace with 40+ connectors. BrightPath Analytics also cited missing Salesforce integration as a churn factor. The integration story is too thin for enterprise buyers evaluating against established platforms.",
    confidence: 0.78,
    relatedFeedbackIds: ["fb-015"],
    themes: ["integrations", "competitive", "salesforce", "churn-risk"],
    impact: "high",
    createdAt: "2026-03-07",
  },
  {
    id: "ins-008",
    type: "theme",
    title: "Collaboration Features Missing for Multi-Team Adoption",
    description:
      "ExampleCorp and DemoMarket Solutions both describe scenarios where product and CS teams cannot collaborate effectively inside the tool. Teams resort to copying feedback into Slack, losing context and attribution. Inline comments, @mentions, and shared views would reduce friction for accounts expanding across departments.",
    confidence: 0.75,
    relatedFeedbackIds: ["fb-016", "fb-017"],
    themes: ["collaboration", "enterprise", "ux", "feature-request"],
    impact: "medium",
    createdAt: "2026-03-07",
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
    name: "Jira",
    source: "jira",
    connected: true,
    lastSync: "1 min ago",
    itemCount: DEMO_JIRA_ISSUES.length,
    icon: "ticket",
  },
];

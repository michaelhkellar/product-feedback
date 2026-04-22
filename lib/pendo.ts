import { FeedbackItem, AnalyticsOverview, AnalyticsLookupContext, FullAnalyticsResult } from "./types";

const API_BASE = "https://app.pendo.io/api/v1";
const OVERVIEW_DAYS = 30;
const LOOKUP_DAYS = 30;

export interface PendoUsageItem {
  id: string;
  name: string;
  totalEvents: number;
  totalMinutes: number;
}

export interface PendoAccountUsageItem {
  accountId: string;
  totalEvents: number;
  totalMinutes: number;
}

export type { AnalyticsOverview, AnalyticsLookupContext };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (isRecord(value)) {
    for (const key of ["results", "result", "data", "items"]) {
      const nested = value[key];
      if (Array.isArray(nested)) return nested.filter(isRecord);
    }
  }
  return [];
}

function stringifyValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function numericValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function formatMinutes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0m";
  if (value >= 60) return `${(value / 60).toFixed(1)}h`;
  return `${value.toFixed(1)}m`;
}

function pickString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = stringifyValue(record[key]);
    if (value) return value;
  }
  return "";
}

async function pendoFetchJson<T>(
  path: string,
  integrationKey: string,
  init?: RequestInit
): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("x-pendo-integration-key", integrationKey);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });

  if (!res.ok) {
    const message = await res.text().catch(() => "");
    throw new Error(`Pendo API ${res.status}: ${message || res.statusText}`);
  }

  return res.json() as Promise<T>;
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => cleanText(v)).filter(Boolean)));
}

function escapeFilterValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/`/g, "\\`");
}

async function aggregate(
  integrationKey: string,
  payload: Record<string, unknown>
): Promise<Record<string, unknown>[]> {
  const data = await pendoFetchJson<unknown>("/aggregation", integrationKey, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return asArray(data);
}

async function fetchTaggedObjects(
  integrationKey: string,
  path: "/page" | "/feature"
): Promise<Map<string, string>> {
  const data = await pendoFetchJson<unknown>(path, integrationKey);
  const rows = asArray(data);
  const map = new Map<string, string>();

  for (const row of rows) {
    const id = pickString(row, ["id", "pageId", "featureId"]);
    const name = pickString(row, ["name", "title"]);
    if (id) map.set(id, name || id);
  }

  return map;
}

function sourceRequest(
  sourceName: string,
  days: number
): Record<string, unknown> {
  return {
    source: {
      [sourceName]: null,
      timeSeries: {
        period: "dayRange",
        first: "now()",
        count: -Math.max(1, days),
      },
    },
  };
}

async function topUsageForSource(
  integrationKey: string,
  sourceName: "pageEvents" | "featureEvents",
  groupField: "pageId" | "featureId",
  names: Map<string, string>,
  days = OVERVIEW_DAYS,
  filter?: string,
  limit = 10
): Promise<PendoUsageItem[]> {
  const rows = await aggregate(integrationKey, {
    response: { mimeType: "application/json" },
    request: {
      name: `${sourceName}-top-usage`,
      pipeline: [
        sourceRequest(sourceName, days),
        { identified: "visitorId" },
        ...(filter ? [{ filter }] : []),
        {
          group: {
            group: [groupField],
            fields: [
              { totalEvents: { sum: "numEvents" } },
              { totalMinutes: { sum: "numMinutes" } },
            ],
          },
        },
        { sort: ["-totalEvents"] },
      ],
    },
  });

  return rows
    .map((row) => {
      const id = pickString(row, [groupField]);
      if (!id) return null;
      return {
        id,
        name: names.get(id) || id,
        totalEvents: numericValue(row.totalEvents),
        totalMinutes: numericValue(row.totalMinutes),
      };
    })
    .filter((item): item is PendoUsageItem => !!item)
    .slice(0, limit);
}

async function topAccounts(
  integrationKey: string,
  days = OVERVIEW_DAYS,
  limit = 10
): Promise<PendoAccountUsageItem[]> {
  const rows = await aggregate(integrationKey, {
    response: { mimeType: "application/json" },
    request: {
      name: "events-by-account-top-usage",
      pipeline: [
        sourceRequest("events", days),
        { identified: "visitorId" },
        { filter: "!isNil(accountId) && accountId != ``" },
        {
          group: {
            group: ["accountId"],
            fields: [
              { totalEvents: { sum: "numEvents" } },
              { totalMinutes: { sum: "numMinutes" } },
            ],
          },
        },
        { sort: ["-totalEvents"] },
      ],
    },
  });

  return rows
    .map((row) => {
      const accountId = pickString(row, ["accountId"]);
      if (!accountId) return null;
      return {
        accountId,
        totalEvents: numericValue(row.totalEvents),
        totalMinutes: numericValue(row.totalMinutes),
      };
    })
    .filter((item): item is PendoAccountUsageItem => !!item)
    .slice(0, limit);
}

function entityFilter(kind: "visitorId" | "accountId", id: string): string {
  return `${kind} == \`${escapeFilterValue(id)}\``;
}

async function entityTotals(
  integrationKey: string,
  kind: "visitorId" | "accountId",
  id: string,
  days = LOOKUP_DAYS
): Promise<{ totalEvents: number; totalMinutes: number }> {
  const rows = await aggregate(integrationKey, {
    response: { mimeType: "application/json" },
    request: {
      name: `${kind}-events-total`,
      pipeline: [
        sourceRequest("events", days),
        { identified: "visitorId" },
        { filter: entityFilter(kind, id) },
        {
          reduce: [
            { totalEvents: { sum: "numEvents" } },
            { totalMinutes: { sum: "numMinutes" } },
          ],
        },
      ],
    },
  });

  const first = rows[0] || {};
  return {
    totalEvents: numericValue(first.totalEvents),
    totalMinutes: numericValue(first.totalMinutes),
  };
}

async function getEntityById(
  integrationKey: string,
  kind: "visitor" | "account",
  id: string
): Promise<Record<string, unknown> | null> {
  try {
    return await pendoFetchJson<Record<string, unknown>>(
      `/${kind}/${encodeURIComponent(id)}`,
      integrationKey
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("404")) return null;
    throw error;
  }
}

async function getVisitorHistory(
  integrationKey: string,
  visitorId: string
): Promise<Record<string, unknown>[]> {
  const starttime = Date.now() - (24 * 60 * 60 * 1000);
  try {
    const data = await pendoFetchJson<unknown>(
      `/visitor/${encodeURIComponent(visitorId)}/history?starttime=${starttime}`,
      integrationKey,
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }
    );
    return asArray(data).slice(0, 5);
  } catch {
    return [];
  }
}

function flattenStrings(
  value: unknown,
  prefix = "",
  depth = 0,
  output: Record<string, string> = {}
): Record<string, string> {
  if (depth > 2 || !isRecord(value)) return output;
  for (const [key, raw] of Object.entries(value)) {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
      output[nextKey] = cleanText(String(raw));
    } else if (Array.isArray(raw)) {
      const first = raw[0];
      if (typeof first === "string" || typeof first === "number" || typeof first === "boolean") {
        output[nextKey] = cleanText(raw.slice(0, 3).map(String).join(", "));
      } else if (isRecord(first)) {
        flattenStrings(first, nextKey, depth + 1, output);
      }
    } else if (isRecord(raw)) {
      flattenStrings(raw, nextKey, depth + 1, output);
    }
  }
  return output;
}

function interestingFields(entity: Record<string, unknown>): Array<[string, string]> {
  const flattened = flattenStrings(entity);
  const preferred = Object.entries(flattened)
    .filter(([key, value]) => value && /(^id$|name|email|account|company|role|visitor|segment)/i.test(key))
    .slice(0, 8);

  if (preferred.length > 0) return preferred;
  return Object.entries(flattened).filter(([, value]) => value).slice(0, 6);
}

function entityDisplay(entity: Record<string, unknown>, fallback: string): string {
  return pickString(entity, ["id", "visitorId", "accountId", "name", "displayName"]) || fallback;
}

function extractAccountId(entity: Record<string, unknown>): string {
  const direct = pickString(entity, ["accountId"]);
  if (direct) return direct;

  const flattened = flattenStrings(entity);
  for (const [key, value] of Object.entries(flattened)) {
    if (/accountid$/i.test(key) && value) return value;
  }
  return "";
}

function summarizeHistoryItem(item: Record<string, unknown>): string {
  const pageId = pickString(item, ["pageId"]);
  const featureId = pickString(item, ["featureId"]);
  const eventType = pickString(item, ["type", "eventType"]);
  const when = pickString(item, ["time", "timestamp", "day", "date"]);
  const eventCount = numericValue(item.numEvents || item.count);
  const minutes = numericValue(item.numMinutes);

  const parts: string[] = [];
  if (eventType) parts.push(eventType);
  if (pageId) parts.push(`page=${pageId}`);
  if (featureId) parts.push(`feature=${featureId}`);
  if (eventCount) parts.push(`${eventCount} events`);
  if (minutes) parts.push(formatMinutes(minutes));
  if (when) parts.push(when);
  return parts.join(", ");
}

function collectCandidates(
  query: string,
  relatedFeedback: FeedbackItem[]
): { visitorCandidates: string[]; accountCandidates: string[]; notes: string[] } {
  const visitorCandidates: string[] = [];
  const accountCandidates: string[] = [];
  const notes: string[] = [];

  const emails = query.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  visitorCandidates.push(...emails);
  if (emails.length > 0) notes.push(`explicit email in question: ${emails[0]}`);

  for (const fb of relatedFeedback.slice(0, 5)) {
    const email = fb.metadata?.userEmail || (/\S+@\S+/.test(fb.customer) ? fb.customer : "");
    if (email) visitorCandidates.push(email);
    if (fb.company) accountCandidates.push(fb.company);
    if (email || fb.company) {
      notes.push(`matched feedback source "${fb.title}"`);
    }
  }

  return {
    visitorCandidates: dedupe(visitorCandidates),
    accountCandidates: dedupe(accountCandidates),
    notes: dedupe(notes),
  };
}

function buildUsageSummary(
  label: string,
  totals: { totalEvents: number; totalMinutes: number },
  pages: PendoUsageItem[],
  features: PendoUsageItem[],
  days = LOOKUP_DAYS
): string[] {
  const lines = [
    `${label}: ${totals.totalEvents} events and ${formatMinutes(totals.totalMinutes)} in the last ${days} days.`,
  ];

  if (pages.length > 0) {
    lines.push(
      `Top pages: ${pages
        .slice(0, 5)
        .map((item) => `${item.name} (${item.totalEvents} events, ${formatMinutes(item.totalMinutes)})`)
        .join("; ")}.`
    );
  }

  if (features.length > 0) {
    lines.push(
      `Top features: ${features
        .slice(0, 5)
        .map((item) => `${item.name} (${item.totalEvents} clicks, ${formatMinutes(item.totalMinutes)})`)
        .join("; ")}.`
    );
  }

  return lines;
}

export function isPendoConfigured(overrideKey?: string): boolean {
  return !!(overrideKey || process.env.PENDO_INTEGRATION_KEY);
}

export async function getPendoOverview(
  overrideKey?: string,
  days?: number
): Promise<AnalyticsOverview | null> {
  const integrationKey = overrideKey || process.env.PENDO_INTEGRATION_KEY;
  if (!integrationKey) return null;
  const effectiveDays = days || OVERVIEW_DAYS;

  try {
    const [pages, features] = await Promise.all([
      fetchTaggedObjects(integrationKey, "/page"),
      fetchTaggedObjects(integrationKey, "/feature"),
    ]);

    const [activePages, activeFeatures, activeAccounts, trackEventRows] = await Promise.all([
      topUsageForSource(integrationKey, "pageEvents", "pageId", pages, effectiveDays),
      topUsageForSource(integrationKey, "featureEvents", "featureId", features, effectiveDays),
      topAccounts(integrationKey, effectiveDays),
      aggregate(integrationKey, {
        response: { mimeType: "application/json" },
        request: {
          name: "trackEvents-top-usage",
          pipeline: [
            sourceRequest("trackEvents", effectiveDays),
            { identified: "visitorId" },
            { group: { group: ["type"], fields: [{ totalEvents: { sum: "numEvents" } }] } },
            { sort: ["-totalEvents"] },
          ],
        },
      }).catch(() => [] as Record<string, unknown>[]),
    ]);

    const topEvents = trackEventRows
      .map((row) => {
        const type = pickString(row, ["type"]);
        if (!type) return null;
        return { id: type, name: type, count: numericValue(row.totalEvents) };
      })
      .filter((item): item is { id: string; name: string; count: number } => !!item)
      .slice(0, 10);

    return {
      provider: "pendo",
      topPages: activePages.map((p) => ({ id: p.id, name: p.name, count: p.totalEvents, minutes: p.totalMinutes })),
      topFeatures: activeFeatures.map((f) => ({ id: f.id, name: f.name, count: f.totalEvents, minutes: f.totalMinutes })),
      topEvents,
      topAccounts: activeAccounts.map((a) => ({ id: a.accountId, count: a.totalEvents, minutes: a.totalMinutes })),
      totalTrackedPages: pages.size,
      totalTrackedFeatures: features.size,
      generatedAt: new Date().toISOString(),
      allPageNames: Array.from(pages.values()),
      allFeatureNames: Array.from(features.values()),
      allEventNames: topEvents.map((e) => e.name),
    };
  } catch (error) {
    console.error("Failed to load Pendo overview:", error);
    return null;
  }
}

export async function getFullPendoAnalytics(
  overrideKey?: string,
  days?: number,
  limit = 200
): Promise<FullAnalyticsResult | null> {
  const integrationKey = overrideKey || process.env.PENDO_INTEGRATION_KEY;
  if (!integrationKey) return null;
  const effectiveDays = days || OVERVIEW_DAYS;
  const cap = Math.min(limit, 500);

  try {
    const [pages, features] = await Promise.all([
      fetchTaggedObjects(integrationKey, "/page"),
      fetchTaggedObjects(integrationKey, "/feature"),
    ]);

    const [allPages, allFeatures, allAccounts, trackEventRows] = await Promise.all([
      topUsageForSource(integrationKey, "pageEvents", "pageId", pages, effectiveDays, undefined, cap),
      topUsageForSource(integrationKey, "featureEvents", "featureId", features, effectiveDays, undefined, cap),
      topAccounts(integrationKey, effectiveDays, cap),
      aggregate(integrationKey, {
        response: { mimeType: "application/json" },
        request: {
          name: "trackEvents-full",
          pipeline: [
            sourceRequest("trackEvents", effectiveDays),
            { identified: "visitorId" },
            { group: { group: ["type"], fields: [{ totalEvents: { sum: "numEvents" } }] } },
            { sort: ["-totalEvents"] },
          ],
        },
      }).catch(() => [] as Record<string, unknown>[]),
    ]);

    const events = trackEventRows
      .map((row) => {
        const type = pickString(row, ["type"]);
        if (!type) return null;
        return { id: type, name: type, count: numericValue(row.totalEvents) };
      })
      .filter((item): item is { id: string; name: string; count: number } => !!item)
      .slice(0, cap);

    return {
      pages: allPages.map((p) => ({ id: p.id, name: p.name, count: p.totalEvents, minutes: p.totalMinutes })),
      features: allFeatures.map((f) => ({ id: f.id, name: f.name, count: f.totalEvents, minutes: f.totalMinutes })),
      events,
      accounts: allAccounts.map((a) => ({ id: a.accountId, count: a.totalEvents, minutes: a.totalMinutes })),
    };
  } catch (error) {
    console.error("Failed to load full Pendo analytics:", error);
    return null;
  }
}

function matchCatalogNames(query: string, catalog: Map<string, string>): { id: string; name: string }[] {
  const q = query.toLowerCase();
  const matches: { id: string; name: string }[] = [];
  catalog.forEach((name, id) => {
    if (name.length >= 3 && q.includes(name.toLowerCase())) {
      matches.push({ id, name });
    }
  });
  return matches;
}

async function lookupNamedItems(
  integrationKey: string,
  pageNames: Map<string, string>,
  featureNames: Map<string, string>,
  matchedPages: { id: string; name: string }[],
  matchedFeatures: { id: string; name: string }[],
  days: number,
): Promise<{ lines: string[]; sources: { type: string; id: string; title: string }[] }> {
  const lines: string[] = [];
  const sources: { type: string; id: string; title: string }[] = [];

  for (const p of matchedPages.slice(0, 5)) {
    const filter = `pageId == \`${escapeFilterValue(p.id)}\``;
    const usage = await topUsageForSource(integrationKey, "pageEvents", "pageId", pageNames, days, filter, 1);
    if (usage.length > 0) {
      const u = usage[0];
      lines.push(`Page "${p.name}": ${u.totalEvents} events, ${formatMinutes(u.totalMinutes)} in the last ${days} days.`);
    } else {
      lines.push(`Page "${p.name}": no usage recorded in the last ${days} days.`);
    }
    sources.push({ type: "pendo", id: `page:${p.id}`, title: `${p.name} (Pendo page)` });
  }

  for (const f of matchedFeatures.slice(0, 5)) {
    const filter = `featureId == \`${escapeFilterValue(f.id)}\``;
    const usage = await topUsageForSource(integrationKey, "featureEvents", "featureId", featureNames, days, filter, 1);
    if (usage.length > 0) {
      const u = usage[0];
      lines.push(`Feature "${f.name}": ${u.totalEvents} events, ${formatMinutes(u.totalMinutes)} in the last ${days} days.`);
    } else {
      lines.push(`Feature "${f.name}": no usage recorded in the last ${days} days.`);
    }
    sources.push({ type: "pendo", id: `feature:${f.id}`, title: `${f.name} (Pendo feature)` });
  }

  return { lines, sources };
}

export async function getRelevantPendoContext(
  query: string,
  relatedFeedback: FeedbackItem[],
  overrideKey?: string,
  days?: number
): Promise<AnalyticsLookupContext | null> {
  const integrationKey = overrideKey || process.env.PENDO_INTEGRATION_KEY;
  const effectiveLookupDays = days || LOOKUP_DAYS;
  if (!integrationKey) return null;

  const [pageNames, featureNames] = await Promise.all([
    fetchTaggedObjects(integrationKey, "/page"),
    fetchTaggedObjects(integrationKey, "/feature"),
  ]);

  const matchedPages = matchCatalogNames(query, pageNames);
  const matchedFeatures = matchCatalogNames(query, featureNames);
  const hasNameMatches = matchedPages.length > 0 || matchedFeatures.length > 0;

  const { visitorCandidates, accountCandidates, notes } = collectCandidates(query, relatedFeedback);
  const hasIdentityCandidates = visitorCandidates.length > 0 || accountCandidates.length > 0;

  if (!hasIdentityCandidates && !hasNameMatches) {
    if (/\b(trends?|overview|analytics|usage|adoption|engagement|pendo)\b/i.test(query)) {
      const overview = await getPendoOverview(overrideKey, effectiveLookupDays).catch(() => null);
      if (overview) {
        const lines = ["Pendo product analytics overview:"];
        if (overview.topPages.length > 0)
          lines.push(`Top pages: ${overview.topPages.slice(0, 5).map((p) => `${p.name} (${p.count} events)`).join(", ")}`);
        if (overview.topFeatures.length > 0)
          lines.push(`Top features: ${overview.topFeatures.slice(0, 5).map((f) => `${f.name} (${f.count} events)`).join(", ")}`);
        if (overview.topEvents.length > 0)
          lines.push(`Top events: ${overview.topEvents.slice(0, 5).map((e) => `${e.name} (${e.count})`).join(", ")}`);
        if (overview.topAccounts.length > 0)
          lines.push(`Top accounts by activity: ${overview.topAccounts.slice(0, 3).map((a) => a.id).join(", ")}`);
        return {
          context: lines.join("\n"),
          sources: [{ type: "pendo", id: "pendo-overview", title: "Pendo analytics overview" }],
        };
      }
    }
    return {
      context: "Pendo lookup: no matching page, feature, visitor, or account could be inferred from the question. Ask about a specific page/feature name, or include an email or account ID.",
      sources: [],
    };
  }

  const lines: string[] = ["Pendo usage context:"];
  const sources: { type: string; id: string; title: string }[] = [];

  if (hasNameMatches) {
    const namedResult = await lookupNamedItems(integrationKey, pageNames, featureNames, matchedPages, matchedFeatures, effectiveLookupDays);
    lines.push(...namedResult.lines);
    sources.push(...namedResult.sources);
  }

  if (hasIdentityCandidates) {
    let matchedVisitor: { id: string; entity: Record<string, unknown> } | null = null;
    for (const candidate of visitorCandidates) {
      const entity = await getEntityById(integrationKey, "visitor", candidate);
      if (entity) {
        matchedVisitor = { id: candidate, entity };
        break;
      }
    }

    let matchedAccount: { id: string; entity: Record<string, unknown> } | null = null;
    const allAccountCandidates = [...accountCandidates];
    if (matchedVisitor) {
      const accountFromVisitor = extractAccountId(matchedVisitor.entity);
      if (accountFromVisitor) allAccountCandidates.unshift(accountFromVisitor);
    }

    for (const candidate of dedupe(allAccountCandidates)) {
      const entity = await getEntityById(integrationKey, "account", candidate);
      if (entity) {
        matchedAccount = { id: candidate, entity };
        break;
      }
    }

    if (matchedVisitor) {
      const visitorLabel = entityDisplay(matchedVisitor.entity, matchedVisitor.id);
      lines.push(`Matched visitor: ${visitorLabel}.`);
      const fields = interestingFields(matchedVisitor.entity)
        .map(([key, value]) => `${key}=${value}`)
        .slice(0, 5);
      if (fields.length > 0) lines.push(`Visitor metadata: ${fields.join("; ")}.`);

      const [totals, pages, features, history] = await Promise.all([
        entityTotals(integrationKey, "visitorId", matchedVisitor.id, effectiveLookupDays),
        topUsageForSource(integrationKey, "pageEvents", "pageId", pageNames, effectiveLookupDays, entityFilter("visitorId", matchedVisitor.id)),
        topUsageForSource(integrationKey, "featureEvents", "featureId", featureNames, effectiveLookupDays, entityFilter("visitorId", matchedVisitor.id)),
        getVisitorHistory(integrationKey, matchedVisitor.id),
      ]);

      lines.push(...buildUsageSummary("Visitor activity", totals, pages, features, effectiveLookupDays));
      if (history.length > 0) {
        lines.push(`Recent visitor history sample (last 24h summary): ${history.map(summarizeHistoryItem).filter(Boolean).slice(0, 5).join("; ")}.`);
      }

      sources.push({ type: "pendo", id: `visitor:${matchedVisitor.id}`, title: `${visitorLabel} (Pendo visitor)` });
    }

    if (matchedAccount) {
      const accountLabel = entityDisplay(matchedAccount.entity, matchedAccount.id);
      lines.push(`Matched account: ${accountLabel}.`);
      const fields = interestingFields(matchedAccount.entity)
        .map(([key, value]) => `${key}=${value}`)
        .slice(0, 5);
      if (fields.length > 0) lines.push(`Account metadata: ${fields.join("; ")}.`);

      const [totals, pages, features] = await Promise.all([
        entityTotals(integrationKey, "accountId", matchedAccount.id, effectiveLookupDays),
        topUsageForSource(integrationKey, "pageEvents", "pageId", pageNames, effectiveLookupDays, entityFilter("accountId", matchedAccount.id)),
        topUsageForSource(integrationKey, "featureEvents", "featureId", featureNames, effectiveLookupDays, entityFilter("accountId", matchedAccount.id)),
      ]);

      lines.push(...buildUsageSummary("Account activity", totals, pages, features, effectiveLookupDays));
      sources.push({ type: "pendo", id: `account:${matchedAccount.id}`, title: `${accountLabel} (Pendo account)` });
    }

    if (!matchedVisitor && !matchedAccount && !hasNameMatches) {
      const tried = dedupe([...visitorCandidates, ...accountCandidates]).join(", ");
      lines.push(`Identity lookup: no matching visitor/account was found for ${tried}.`);
    }
  }

  if (notes.length > 0) {
    lines.push(`Match context: ${notes.join("; ")}.`);
  }

  return {
    context: lines.join("\n"),
    sources,
  };
}

import { AnalyticsOverview, AnalyticsOverviewItem } from "./types";
import { VectorDocument } from "./vector-store";

const MAX_EVENTS = 50;
const MAX_PAGES = 50;
const MAX_FEATURES = 50;

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function renderItem(
  item: AnalyticsOverviewItem,
  entityType: string,
  providerLabel: string,
  window: string
): string {
  const parts = [`"${item.name}" (${providerLabel} ${entityType}) — ${item.count.toLocaleString()} events in ${window}`];
  if (item.minutes !== undefined && item.minutes > 0) {
    parts.push(`${item.minutes.toFixed(0)} avg minutes`);
  }
  if (item.deltaPct !== undefined && item.priorCount !== undefined && item.deltaPct !== 999) {
    const sign = item.deltaPct >= 0 ? "+" : "";
    parts.push(`${sign}${item.deltaPct}% vs prior period (${item.priorCount.toLocaleString()})`);
  } else if (item.deltaPct === 999) {
    parts.push(`new this period (no prior activity)`);
  }
  return parts.join(", ") + ".";
}

export function synthesizeAnalyticsDocs(
  overview: AnalyticsOverview,
  provider: "pendo" | "amplitude" | "posthog",
  window = "recent activity"
): VectorDocument[] {
  const docs: VectorDocument[] = [];
  const providerLabel = provider.charAt(0).toUpperCase() + provider.slice(1);

  const addItems = (
    items: AnalyticsOverviewItem[],
    entityType: string,
    maxN: number
  ) => {
    for (const item of items.slice(0, maxN)) {
      if (!item.name) continue;
      const id = `analytics:${provider}:${entityType}:${slug(item.name)}`;
      const label = `${item.name} (${providerLabel} ${entityType})`;
      const text = renderItem(item, entityType, providerLabel, window);
      docs.push({
        id,
        type: "analytics",
        text,
        themes: [],
        metadata: {
          provider,
          entityType,
          label,
          name: item.name,
          count: String(item.count),
          window,
        },
      });
    }
  };

  addItems(overview.topEvents, "event", MAX_EVENTS);
  addItems(overview.topPages, "page", MAX_PAGES);
  addItems(overview.topFeatures, "feature", MAX_FEATURES);

  // De-duplicate by id in case topPages and topFeatures overlap
  const seen = new Set<string>();
  return docs.filter((d) => {
    if (seen.has(d.id)) return false;
    seen.add(d.id);
    return true;
  });
}

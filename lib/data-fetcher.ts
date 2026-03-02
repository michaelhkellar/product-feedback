import { AgentData, getDemoData } from "./agent";
import { getFeatures, getNotes, isProductboardConfigured } from "./productboard";
import { getCalls, isAttentionConfigured } from "./attention";
import {
  DEMO_FEEDBACK,
  DEMO_PRODUCTBOARD_FEATURES,
  DEMO_ATTENTION_CALLS,
  DEMO_INSIGHTS,
} from "./demo-data";

interface CachedData {
  data: AgentData;
  timestamp: number;
}

const dataCache = new Map<string, CachedData>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function cacheKey(pbKey: string | undefined, attKey: string | undefined, demo: boolean): string {
  return `${pbKey ? "pb" : ""}:${attKey ? "att" : ""}:${demo}`;
}

async function fetchLiveData(
  pbKey: string | undefined,
  attKey: string | undefined,
  useDemoFallback: boolean
): Promise<AgentData> {
  const feedback = [...(useDemoFallback ? DEMO_FEEDBACK : [])];
  let features = useDemoFallback ? [...DEMO_PRODUCTBOARD_FEATURES] : [];
  let calls = useDemoFallback ? [...DEMO_ATTENTION_CALLS] : [];
  const insights = useDemoFallback ? [...DEMO_INSIGHTS] : [];

  const hasPb = isProductboardConfigured(pbKey);
  const hasAtt = isAttentionConfigured(attKey);

  const fetches: Promise<void>[] = [];

  if (hasPb) {
    fetches.push(
      (async () => {
        const [featResult, notesResult] = await Promise.all([
          getFeatures(pbKey, false),
          getNotes(pbKey, false, 1000),
        ]);
        if (!featResult.isDemo && featResult.data.length > 0) {
          features = featResult.data;
        }
        if (!notesResult.isDemo && notesResult.data.length > 0) {
          for (const note of notesResult.data) {
            if (!feedback.some((f) => f.id === note.id)) {
              feedback.push(note);
            }
          }
        }
      })()
    );
  }

  if (hasAtt) {
    fetches.push(
      (async () => {
        const callResult = await getCalls(attKey, false);
        if (!callResult.isDemo && callResult.data.length > 0) {
          calls = callResult.data;
        }
      })()
    );
  }

  if (fetches.length > 0) {
    await Promise.allSettled(fetches);
  }

  return { feedback, features, calls, insights };
}

export async function getData(
  pbKey: string | undefined,
  attKey: string | undefined,
  useDemoData: boolean
): Promise<AgentData> {
  const hasPb = isProductboardConfigured(pbKey);
  const hasAtt = isAttentionConfigured(attKey);
  const hasAnyLiveKey = hasPb || hasAtt;

  if (!hasAnyLiveKey && useDemoData) {
    return getDemoData();
  }

  if (!hasAnyLiveKey && !useDemoData) {
    return { feedback: [], features: [], calls: [], insights: [] };
  }

  const key = cacheKey(pbKey, attKey, useDemoData);
  const cached = dataCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  const data = await fetchLiveData(pbKey, attKey, useDemoData);

  dataCache.set(key, { data, timestamp: Date.now() });

  const total = data.feedback.length + data.features.length + data.calls.length + data.insights.length;
  console.log(`Data loaded: ${total} items (${data.feedback.length} feedback, ${data.features.length} features, ${data.calls.length} calls, ${data.insights.length} insights)`);

  return data;
}

export function invalidateCache(): void {
  dataCache.clear();
}

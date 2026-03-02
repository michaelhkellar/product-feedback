import { NextRequest, NextResponse } from "next/server";
import { chat, getDemoData, AgentData } from "@/lib/agent";
import { getFeatures, getNotes, isProductboardConfigured } from "@/lib/productboard";
import { getCalls, isAttentionConfigured } from "@/lib/attention";
import {
  DEMO_FEEDBACK,
  DEMO_PRODUCTBOARD_FEATURES,
  DEMO_ATTENTION_CALLS,
  DEMO_INSIGHTS,
} from "@/lib/demo-data";

interface CachedData {
  data: AgentData;
  timestamp: number;
}

const dataCache = new Map<string, CachedData>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

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
          getNotes(pbKey, false),
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

async function getData(
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
  console.log(`Chat data loaded: ${total} items (${data.feedback.length} feedback, ${data.features.length} features, ${data.calls.length} calls, ${data.insights.length} insights)`);

  return data;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { message, history, useDemoData } = body;

    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 }
      );
    }

    const keys = {
      geminiKey: req.headers.get("x-gemini-key") || undefined,
      productboardKey: req.headers.get("x-productboard-key") || undefined,
      attentionKey: req.headers.get("x-attention-key") || undefined,
    };

    const data = await getData(
      keys.productboardKey,
      keys.attentionKey,
      useDemoData !== false
    );

    const result = await chat(
      message,
      Array.isArray(history) ? history : [],
      data,
      keys
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error("Chat API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

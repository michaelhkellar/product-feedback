import { AttentionCall, FeedbackItem, Priority, Sentiment } from "./types";

// Internal email domains we won't treat as the "customer" on a call.
// Heuristic only — anything not on this list AND that has an @ becomes a customer candidate.
const INTERNAL_EMAIL_HINTS = ["evoke", "anthropic"];

const URGENT_ACTION_PATTERNS = /\b(asap|immediately|escalate|p0|critical|blocker|urgent|today|by tomorrow|deadline)\b/i;

interface DerivedCustomer {
  customer: string;
  company?: string;
}

function looksInternal(participant: string): boolean {
  const at = participant.indexOf("@");
  if (at < 0) return false;
  const domain = participant.slice(at + 1).toLowerCase();
  return INTERNAL_EMAIL_HINTS.some((hint) => domain.includes(hint));
}

function companyFromEmail(participant: string): string | undefined {
  const at = participant.indexOf("@");
  if (at < 0) return undefined;
  const host = participant.slice(at + 1).split(".")[0];
  if (!host) return undefined;
  return host.charAt(0).toUpperCase() + host.slice(1);
}

function deriveCustomer(participants: string[]): DerivedCustomer {
  const cleaned = participants.map((p) => p.trim()).filter(Boolean);
  // Prefer external participants with a name (contains a space, no @)
  const namedExternal = cleaned.find((p) => !p.includes("@") && p.includes(" "));
  if (namedExternal) return { customer: namedExternal };
  // Then prefer external email
  const externalEmail = cleaned.find((p) => p.includes("@") && !looksInternal(p));
  if (externalEmail) {
    const namePart = externalEmail.split("@")[0].replace(/[._-]+/g, " ").trim();
    return {
      customer: namePart.charAt(0).toUpperCase() + namePart.slice(1),
      company: companyFromEmail(externalEmail),
    };
  }
  // Fall back to first non-empty participant
  return { customer: cleaned[0] || "Unknown" };
}

/**
 * Regex-based fallback for the no-AI-key path.
 * Returns canonical kebab-case (matching the AI-extracted callType vocabulary)
 * so downstream filters and metadata stay consistent regardless of which path produced the value.
 */
function inferCallType(title: string): string | undefined {
  const t = title.toLowerCase();
  if (/\bqbr\b/.test(t)) return "qbr";
  if (/\brenewal\b/.test(t)) return "renewal";
  if (/\bchurn|loss\b/.test(t)) return "churn-debrief";
  if (/\bdiscovery\b/.test(t)) return "discovery";
  if (/\bdemo\b/.test(t)) return "demo";
  if (/\bonboard/.test(t)) return "onboarding";
  if (/\bescalat/.test(t)) return "customer-support";
  return undefined;
}

/** Both AI extraction and the regex fallback emit canonical kebab-case. */
function effectiveCallType(call: { callType?: string; title: string }): string | undefined {
  return call.callType || inferCallType(call.title);
}

/**
 * Pretty-print a canonical callType for UI display.
 * "qbr" → "QBR", "churn-debrief" → "Churn debrief", "customer-support" → "Customer support"
 */
export function displayCallType(canonical: string | undefined): string | undefined {
  if (!canonical) return undefined;
  // Common acronyms keep all-caps treatment.
  const acronyms = new Set(["qbr"]);
  if (acronyms.has(canonical)) return canonical.toUpperCase();
  const words = canonical.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function durationMin(duration: string): string | undefined {
  const m = duration.match(/(\d+)\s*min/i);
  if (m) return m[1];
  return undefined;
}

function actionItemPriority(text: string): Priority {
  return URGENT_ACTION_PATTERNS.test(text) ? "high" : "medium";
}

function momentPriority(sentiment: Sentiment): Priority {
  return sentiment === "negative" ? "high" : "medium";
}

function truncateTitle(text: string, max = 80): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  // Cut at word boundary if possible
  const cut = flat.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
}

/**
 * Convert each call's actionItems and non-neutral keyMoments into discrete FeedbackItem entries
 * so they participate in clustering, theme analysis, gap detection, and the Feedback tab.
 *
 * - Each actionItem → 1 feedback item (sentiment: neutral, priority: high if commitment language else medium).
 * - Each non-neutral keyMoment → 1 feedback item (sentiment from the moment, priority: high for negative).
 * - Returns [] when calls have no extracted signals (gracefully handles transcript fetch failures).
 */
export function callsToFeedback(calls: AttentionCall[]): FeedbackItem[] {
  const out: FeedbackItem[] = [];
  for (const call of calls) {
    const { customer, company } = deriveCustomer(call.participants);
    const callType = effectiveCallType(call);
    const dur = durationMin(call.duration);
    const baseMetadata: Record<string, string> = { callId: call.id };
    if (callType) baseMetadata.callType = callType;
    if (dur) baseMetadata.durationMin = dur;

    (call.actionItems || []).forEach((ai, idx) => {
      const text = ai.trim();
      if (!text) return;
      out.push({
        id: `${call.id}-action-${idx}`,
        source: "attention",
        title: truncateTitle(text),
        content: `${text}\n\nFrom call: ${call.title}`,
        customer,
        company,
        sentiment: "neutral",
        themes: call.themes,
        date: call.date,
        priority: actionItemPriority(text),
        metadata: { ...baseMetadata, signalKind: "actionItem" },
      });
    });

    (call.keyMoments || []).forEach((km, idx) => {
      if (km.sentiment === "neutral") return;
      const text = km.text.trim();
      if (!text) return;
      const ts = km.timestamp ? `[${km.timestamp}] ` : "";
      out.push({
        id: `${call.id}-moment-${idx}`,
        source: "attention",
        title: truncateTitle(text),
        content: `${text}\n\n${ts}from ${call.title}`,
        customer,
        company,
        sentiment: km.sentiment,
        themes: call.themes,
        date: call.date,
        priority: momentPriority(km.sentiment),
        metadata: { ...baseMetadata, signalKind: "keyMoment", ...(km.timestamp ? { timestamp: km.timestamp } : {}) },
      });
    });
  }
  return out;
}

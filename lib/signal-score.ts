// Heuristic signal scoring for retrieved documents.
// Returns a multiplier in [0.7, 1.3] applied to RRF scores for non-count queries.
// All thresholds are named constants — tune freely.

const SPECIFICITY_LONG_THRESHOLD = 120;
const SPECIFICITY_SHORT_THRESHOLD = 30;
const LENGTH_BONUS = 0.1;
const LENGTH_PENALTY = -0.1;
const DIGIT_BONUS = 0.05;
const NAMED_ENTITY_BONUS = 0.05;
const ACTIONABLE_BONUS = 0.1;
const CALL_SOURCE_BONUS = 0.05;
const ANALYTICS_SOURCE_BONUS = 0.05;
const FILLER_PENALTY = -0.3;
const TEST_ARTIFACT_PENALTY = -0.2;

const ACTIONABLE_PATTERNS = /\b(should|can't|cannot|doesn't|don't|won't|because|needs? to|have to|has to|impossible|broken|missing|blocks?|prevents?|fails?)\b/i;
const FILLER_PATTERN = /^(love it|looks good|\+1|👍|thanks|nice|great|cool|awesome|perfect|good job|well done)[!.\s]*$/i;
const TEST_ARTIFACT_PATTERN = /\b(test|tesst|asdf|foo|bar|baz|lorem ipsum)\b/i;
// Rough named-entity heuristic: a capitalized word not at the start of a sentence, preceded by a space
const NAMED_ENTITY_PATTERN = /(?<=[a-z.,;] )[A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?/;

type SourceType = "feedback" | "call" | "jira" | "linear" | "confluence" | "feature" | "insight" | "analytics";

export function scoreDoc(params: {
  text: string;
  sourceType: SourceType;
}): number {
  const { text, sourceType } = params;
  if (!text || text.trim().length === 0) return 1.0;

  let score = 0;

  // Length
  if (text.length > SPECIFICITY_LONG_THRESHOLD) score += LENGTH_BONUS;
  if (text.length < SPECIFICITY_SHORT_THRESHOLD) score += LENGTH_PENALTY;

  // Specificity signals
  if (/\d/.test(text)) score += DIGIT_BONUS;
  if (NAMED_ENTITY_PATTERN.test(text)) score += NAMED_ENTITY_BONUS;

  // Actionability
  if (ACTIONABLE_PATTERNS.test(text)) score += ACTIONABLE_BONUS;

  // Source bonus
  if (sourceType === "call") score += CALL_SOURCE_BONUS;
  if (sourceType === "analytics") score += ANALYTICS_SOURCE_BONUS;

  // Low-signal penalties
  if (FILLER_PATTERN.test(text.trim())) score += FILLER_PENALTY;
  if (TEST_ARTIFACT_PATTERN.test(text)) score += TEST_ARTIFACT_PENALTY;

  // Map to [0.7, 1.3] around a neutral baseline of 1.0
  return Math.max(0.7, Math.min(1.3, 1.0 + score));
}

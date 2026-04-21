const NOISE_THEMES_SET = new Set([
  "5 stars", "4.5 stars", "4 stars", "3.5 stars", "3 stars", "2.5 stars",
  "2 stars", "1.5 stars", "1 star", "0.5 stars", "0 stars",
  "5/5", "4/5", "3/5", "2/5", "1/5",
  "g2", "g2 crowd", "capterra", "trustpilot",
  "review", "reviews", "rating", "ratings", "stars",
  "n/a", "na", "none", "other", "misc", "general", "unknown",
  "yes", "no", "true", "false",
]);

export function isNoiseTheme(theme: string): boolean {
  const lower = theme.toLowerCase().trim();
  if (NOISE_THEMES_SET.has(lower)) return true;
  if (/^\d+(\.\d+)?\s*stars?$/i.test(lower)) return true;
  if (/^\d+\/\d+$/i.test(lower)) return true;
  if (/^\d+(\.\d+)?$/.test(lower)) return true;
  if (lower.length <= 1) return true;
  if (lower.length > 60) return true;
  return false;
}

export function cleanThemes(themes: string[]): string[] {
  return themes.filter((t) => !isNoiseTheme(t));
}

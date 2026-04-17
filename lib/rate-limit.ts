import { NextRequest } from "next/server";

export function getClientKey(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return req.ip || "unknown";
}

export function evictExpired(map: Map<string, number>, ttlMs: number): void {
  const cutoff = Date.now() - ttlMs;
  Array.from(map.entries()).forEach(([key, ts]) => {
    if (ts < cutoff) map.delete(key);
  });
}

// Returns true if the request is rate-limited. Evicts expired entries first, then
// records the current timestamp if not limited (so a successful call "uses" the slot).
export function checkRateLimit(
  map: Map<string, number>,
  key: string,
  cooldownMs: number,
  ttlMs: number
): boolean {
  evictExpired(map, ttlMs);
  const now = Date.now();
  const last = map.get(key) || 0;
  if (now - last < cooldownMs) return true;
  map.set(key, now);
  return false;
}

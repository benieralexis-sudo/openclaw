// Token bucket rate-limit in-memory.
// 60 req/min/IP par défaut. Mono-instance → Map en RAM suffit
// (si redémarrage Next.js, buckets reset → acceptable).
//
// Pour usage Edge runtime (middleware) : pas de timers, on calcule
// les tokens à régénérer à chaque check via timestamp.

type Bucket = {
  tokens: number;
  lastRefillMs: number;
};

const BUCKETS = new Map<string, Bucket>();
const DEFAULT_CAPACITY = 60;
const DEFAULT_REFILL_PER_SEC = 1; // 60 par minute
const TTL_MS = 5 * 60 * 1000;

let lastSweepMs = Date.now();

function sweep(now: number) {
  if (now - lastSweepMs < TTL_MS) return;
  lastSweepMs = now;
  for (const [key, b] of BUCKETS) {
    if (now - b.lastRefillMs > TTL_MS) BUCKETS.delete(key);
  }
}

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
};

export function checkRateLimit(
  key: string,
  capacity = DEFAULT_CAPACITY,
  refillPerSec = DEFAULT_REFILL_PER_SEC,
): RateLimitResult {
  const now = Date.now();
  sweep(now);

  let b = BUCKETS.get(key);
  if (!b) {
    b = { tokens: capacity, lastRefillMs: now };
    BUCKETS.set(key, b);
  } else {
    const elapsedSec = (now - b.lastRefillMs) / 1000;
    b.tokens = Math.min(capacity, b.tokens + elapsedSec * refillPerSec);
    b.lastRefillMs = now;
  }

  if (b.tokens >= 1) {
    b.tokens -= 1;
    return { allowed: true, remaining: Math.floor(b.tokens), retryAfterSec: 0 };
  }

  const deficit = 1 - b.tokens;
  const retryAfterSec = Math.ceil(deficit / refillPerSec);
  return { allowed: false, remaining: 0, retryAfterSec };
}

export function extractClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

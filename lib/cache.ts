// Server-side response cache with TTL. Provides a safe, graceful optimization
// for read-only endpoints whose data changes infrequently (e.g. dropdown
// "options" payloads). On serverless instances the cache is in-memory and
// ephemeral, so every instance stays correct — it can only ever serve data
// that is at most TTL old, it never serves stale-across-instance data that
// would be wrong.

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const store = new Map<string, CacheEntry<unknown>>();

// Basic size guard to avoid unbounded growth on long-lived instances.
const MAX_ENTRIES = 200;

export function cacheGet<T>(key: string): T | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() >= entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.value as T;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) return;
  if (store.size >= MAX_ENTRIES) {
    // Evict the oldest entry.
    const oldestKey = store.keys().next().value;
    if (oldestKey !== undefined) store.delete(oldestKey);
  }
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function cacheDelete(key: string): void {
  store.delete(key);
}

export function cacheClear(): void {
  store.clear();
}

/**
 * Memoize an async producer with a TTL. On a cache hit the producer is not
 * invoked. `key` must fully capture the request scope (e.g. user role + sorted
 * assigned campaign ids + relevant params) so different users never share
 * another user's scoped data.
 */
export async function memoize<T>(
  key: string,
  ttlMs: number,
  producer: () => Promise<T>
): Promise<T> {
  const cached = cacheGet<T>(key);
  if (cached !== undefined) return cached;
  const value = await producer();
  cacheSet(key, value, ttlMs);
  return value;
}

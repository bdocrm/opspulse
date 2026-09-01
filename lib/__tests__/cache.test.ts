import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cacheGet, cacheSet, cacheDelete, cacheClear, memoize } from "@/lib/cache";

describe("cache", () => {
  beforeEach(() => {
    cacheClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stores and retrieves values", () => {
    cacheSet("a", { x: 1 }, 1000);
    expect(cacheGet("a")).toEqual({ x: 1 });
  });

  it("expires entries after TTL", () => {
    cacheSet("a", 1, 1000);
    vi.advanceTimersByTime(1001);
    expect(cacheGet("a")).toBeUndefined();
  });

  it("deletes entries", () => {
    cacheSet("a", 1, 1000);
    cacheDelete("a");
    expect(cacheGet("a")).toBeUndefined();
  });

  it("memoize invokes the producer only once within TTL", async () => {
    const producer = vi.fn(async () => Date.now());
    const first = await memoize("k", 1000, producer);
    const second = await memoize("k", 1000, producer);
    expect(producer).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it("memoize re-runs producer after TTL", async () => {
    const producer = vi.fn(async () => Date.now());
    await memoize("k", 1000, producer);
    vi.advanceTimersByTime(1001);
    await memoize("k", 1000, producer);
    expect(producer).toHaveBeenCalledTimes(2);
  });

  it("ignores non-positive TTL", () => {
    cacheSet("a", 1, 0);
    cacheSet("b", 1, -5);
    expect(cacheGet("a")).toBeUndefined();
    expect(cacheGet("b")).toBeUndefined();
  });
});

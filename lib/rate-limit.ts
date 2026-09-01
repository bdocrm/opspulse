import { prisma } from "@/lib/prisma";

// Brute-force / credential-stuffing protection for the Credentials provider.
//
// Two layers:
//   1. An in-memory sliding window (fast, ideal for single-instance / local dev).
//   2. A Prisma `LoginAttempt` persistence backstop (survives ephemeral
//      serverless function instances). The DB layer is best-effort: if the
//      `LoginAttempt` model is not yet migrated, the in-memory limiter still
//      protects the app and the app does not crash.

export const LOGIN_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
export const LOGIN_MAX_ATTEMPTS = 5; // allowed per window
export const LOGIN_LOCKOUT_MS = 10 * 60 * 1000; // lockout after exceeding

interface MemEntry {
  count: number;
  firstAt: number;
  lockedUntil: number;
}

const inMemory = new Map<string, MemEntry>();

function keyFor(ip?: string | null, email?: string | null): string {
  const ipPart = ip || "global";
  const emailPart = (email || "").toLowerCase();
  return `${ipPart}|${emailPart}`;
}

function checkInMemory(key: string, now: number): { allowed: boolean; remaining: number; lockedUntil: number } {
  let entry = inMemory.get(key);
  if (!entry) {
    entry = { count: 0, firstAt: now, lockedUntil: 0 };
    inMemory.set(key, entry);
  }

  if (now - entry.firstAt > LOGIN_WINDOW_MS) {
    entry.count = 0;
    entry.firstAt = now;
    entry.lockedUntil = 0;
  }

  if (entry.lockedUntil > now) {
    return { allowed: false, remaining: 0, lockedUntil: entry.lockedUntil };
  }

  const remaining = Math.max(0, LOGIN_MAX_ATTEMPTS - entry.count);
  return { allowed: true, remaining, lockedUntil: 0 };
}

function recordInMemory(key: string, now: number): { remaining: number } {
  const entry = inMemory.get(key) ?? { count: 0, firstAt: now, lockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= LOGIN_MAX_ATTEMPTS) {
    entry.lockedUntil = now + LOGIN_LOCKOUT_MS;
  }
  inMemory.set(key, entry);
  return { remaining: Math.max(0, LOGIN_MAX_ATTEMPTS - entry.count) };
}

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  lockedUntil: number;
};

/**
 * Check (and, when `record` is true, record) a login attempt against the
 * in-memory window. Returns whether the attempt is allowed.
 */
export function consumeLoginAttempt(ip?: string | null, email?: string | null): RateLimitResult {
  const now = Date.now();
  const key = keyFor(ip, email);
  const check = checkInMemory(key, now);
  if (!check.allowed) {
    return { allowed: false, remaining: 0, lockedUntil: check.lockedUntil };
  }
  const { remaining } = recordInMemory(key, now);
  return { allowed: true, remaining, lockedUntil: 0 };
}

/** Persist a login attempt to the database (best-effort). */
export async function recordLoginAttempt(opts: {
  email: string;
  ip?: string | null;
  success: boolean;
}): Promise<void> {
  try {
    await prisma.loginAttempt.create({
      data: {
        email: (opts.email || "").toLowerCase(),
        ip: opts.ip || null,
        success: opts.success,
      },
    });
  } catch {
    // Model not migrated yet, or DB unavailable — the in-memory limiter still
    // provides protection. Swallow silently.
  }
}

/** Best-effort DB lookup of recent failed attempts for an email+IP. */
export async function getRecentFailedAttempts(
  email: string,
  ip?: string | null,
  withinMs: number = LOGIN_WINDOW_MS
): Promise<number> {
  try {
    const since = new Date(Date.now() - withinMs);
    const where: { email: string; success: boolean; createdAt: { gte: Date } } | Record<string, never> = {
      email: (email || "").toLowerCase(),
      success: false,
      createdAt: { gte: since },
    };
    if (ip) {
      return await prisma.loginAttempt.count({
        where: { ...where, ip },
      });
    }
    return await prisma.loginAttempt.count({ where });
  } catch {
    return 0;
  }
}

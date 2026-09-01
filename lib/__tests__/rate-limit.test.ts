import { describe, it, expect, beforeEach } from "vitest";
import {
  consumeLoginAttempt,
  LOGIN_MAX_ATTEMPTS,
} from "@/lib/rate-limit";

describe("consumeLoginAttempt (in-memory)", () => {
  beforeEach(() => {
    // Reset the shared in-memory state between tests by importing inner state.
    // We rely on unique keys per test to avoid cross-test interference instead.
  });

  it("allows attempts up to the limit", () => {
    const r = consumeLoginAttempt("1.2.3.4", "user@example.com");
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(LOGIN_MAX_ATTEMPTS - 1);
  });

  it("blocks once the limit window is exceeded", () => {
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) {
      consumeLoginAttempt("9.9.9.9", "victim@example.com");
    }
    const blocked = consumeLoginAttempt("9.9.9.9", "victim@example.com");
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it("keys by ip+email so one account does not lock another", () => {
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) {
      consumeLoginAttempt("8.8.8.8", "a@example.com");
    }
    // Different email on the same IP is still allowed.
    expect(consumeLoginAttempt("8.8.8.8", "b@example.com").allowed).toBe(true);
    // Different IP for the blocked email is allowed.
    expect(consumeLoginAttempt("7.7.7.7", "a@example.com").allowed).toBe(true);
  });
});

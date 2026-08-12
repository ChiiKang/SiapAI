// Unit tests for the pure event logic. Run with: deno test supabase/functions/events/logic_test.ts

import { notificationText, shouldNotify, validateEvent } from "./logic.ts";

// Local asserts: keeps the test runnable with zero remote imports.
function assert(condition: unknown, message = "assertion failed"): asserts condition {
  if (!condition) throw new Error(message);
}
function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`expected ${e}, got ${a}`);
}

const VALID = {
  eventId: "6f1d0e9a-3b7c-4d2e-8f5a-1b2c3d4e5f60",
  sessionId: "0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9",
  displayName: "Auth refactor",
  machineName: "MacBook Pro",
  agentKind: "Codex",
  status: "READY",
  occurredAt: "2026-08-12T12:30:00Z",
};

Deno.test("valid payload passes", () => {
  const result = validateEvent(VALID);
  assert("event" in result);
  assertEquals(result.event.agentKind, "Codex");
});

Deno.test("agentKind is optional and defaults", () => {
  const { agentKind: _dropped, ...withoutKind } = VALID;
  const result = validateEvent(withoutKind);
  assert("event" in result);
  assertEquals(result.event.agentKind, "agent");
});

Deno.test("rejects bad UUIDs, names, status, timestamp", () => {
  const cases: Array<Record<string, unknown>> = [
    { ...VALID, eventId: "not-a-uuid" },
    { ...VALID, sessionId: 42 },
    { ...VALID, displayName: "" },
    { ...VALID, displayName: "x".repeat(201) },
    { ...VALID, machineName: undefined },
    { ...VALID, status: "STALE" }, // the CLI must never send STALE
    { ...VALID, status: "DONE" },
    { ...VALID, occurredAt: "yesterday" },
  ];
  for (const c of cases) {
    assert("error" in validateEvent(c), JSON.stringify(c));
  }
});

Deno.test("notify only on stored RUNNING -> incoming READY", () => {
  assertEquals(shouldNotify("RUNNING", "READY"), true);
  assertEquals(shouldNotify("READY", "READY"), false); // repeated READY
  assertEquals(shouldNotify("RUNNING", "RUNNING"), false);
  assertEquals(shouldNotify("READY", "RUNNING"), false); // reset, no notify
  assertEquals(shouldNotify(null, "READY"), false); // brand-new session
  assertEquals(shouldNotify(null, "RUNNING"), false);
});

Deno.test("notification copy matches the spec", () => {
  const result = validateEvent(VALID);
  assert("event" in result);
  const { title, body } = notificationText(result.event);
  assertEquals(title, "Auth refactor is ready");
  assertEquals(body, "Codex finished its current turn on MacBook Pro.");
});

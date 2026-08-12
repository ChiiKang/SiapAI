// Cross-surface contract test: replays the exact payloads the CLI put on the
// wire (captured by mac/tests/lifecycle.test.js into the shared fixture)
// through the real validator and the real notify rule.
//
// If the CLI ever sends a field the backend rejects — or a lifecycle stops
// producing the expected notifications — this fails here rather than on the
// owner's Mac.
//
// Run: deno test --allow-read supabase/functions/events/contract_test.ts

import { shouldNotify, validateEvent } from "./logic.ts";

const FIXTURE = new URL(
  "../../../mac/tests/fixtures/captured-events.json",
  import.meta.url
);

function assert(condition: unknown, message = "assertion failed"): asserts condition {
  if (!condition) throw new Error(message);
}
function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`expected ${e}, got ${a}`);
}

const captured: unknown[] = JSON.parse(await Deno.readTextFile(FIXTURE));

Deno.test("every payload the CLI sends passes backend validation", () => {
  assert(captured.length > 0, "fixture is empty");
  for (const raw of captured) {
    const result = validateEvent(raw);
    assert(
      "event" in result,
      `CLI payload rejected by backend: ${JSON.stringify(raw)} -> ${
        "error" in result ? result.error : ""
      }`
    );
  }
});

// Mirrors the stored-state machine in index.ts: eventId dedupe, out-of-order
// rejection by occurredAt, then the RUNNING -> READY notify rule.
function replay(events: unknown[]): number {
  let storedStatus: "RUNNING" | "READY" | null = null;
  let lastEventId: string | null = null;
  let storedOccurredAt: string | null = null;
  let notifications = 0;

  for (const raw of events) {
    const result = validateEvent(raw);
    assert("event" in result);
    const event = result.event;

    if (lastEventId === event.eventId) continue; // idempotent retry
    if (
      storedOccurredAt &&
      Date.parse(event.occurredAt) < Date.parse(storedOccurredAt)
    ) {
      continue; // arrived out of order
    }
    if (shouldNotify(storedStatus, event.status)) notifications += 1;
    storedStatus = event.status;
    lastEventId = event.eventId;
    storedOccurredAt = event.occurredAt;
  }
  return notifications;
}

Deno.test("captured lifecycle notifies exactly once per completed turn", () => {
  // The captured lifecycle is RUNNING, READY, RUNNING, READY: two turns.
  assertEquals(
    captured.map((e) => (e as { status: string }).status),
    ["RUNNING", "READY", "RUNNING", "READY"]
  );
  assertEquals(replay(captured), 2);
});

Deno.test("replaying the whole lifecycle again adds no notifications", () => {
  // Simulates every event being redelivered after a network blip. The
  // repeats are either eventId duplicates or older-than-stored events, so
  // none of them may produce a second round of notifications.
  assertEquals(replay([...captured, ...captured]), 2);
});

Deno.test("a delayed early event cannot rewind state and re-notify", () => {
  // The dangerous ordering: the first RUNNING is delivered late, landing
  // after the session has already reached READY.
  const [running1, ready1, running2, ready2] = captured;
  assertEquals(replay([running1, ready1, running2, ready2, running1]), 2);
  // …and a subsequent READY still must not double-count.
  assertEquals(replay([running1, ready1, running2, ready2, running1, ready2]), 2);
});

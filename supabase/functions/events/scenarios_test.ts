// The same scenario table the local server is tested against
// (mac/tests/scenarios.json), executed here against the edge function's
// logic. The two backends implement one contract; if they drift, one of
// these suites fails.
//
// Run: deno test --allow-read supabase/functions/events/scenarios_test.ts

import { shouldNotify, validateEvent } from "./logic.ts";

const SCENARIOS_PATH = new URL(
  "../../../mac/tests/scenarios.json",
  import.meta.url
);

interface Step {
  eventId: string;
  status: "RUNNING" | "READY";
  occurredAt: string;
  expect: { notified?: boolean; duplicate?: boolean; stale?: boolean };
}
interface Scenario {
  name: string;
  events: Step[];
  expectedNotifications: number;
}

const table: {
  scenarios: Scenario[];
  rejected: Array<{ name: string; patch: Record<string, unknown> }>;
} = JSON.parse(await Deno.readTextFile(SCENARIOS_PATH));

function assertEquals(actual: unknown, expected: unknown, message = ""): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message} expected ${e}, got ${a}`);
}

const UUIDS = new Map<string, string>();
function uuidFor(key: string): string {
  if (!UUIDS.has(key)) UUIDS.set(key, crypto.randomUUID());
  return UUIDS.get(key)!;
}

function buildEvent(step: Step, sessionId: string): Record<string, unknown> {
  const index = Number(step.occurredAt.slice(1));
  return {
    eventId: uuidFor(step.eventId),
    sessionId,
    displayName: "Auth refactor",
    machineName: "Test Mac",
    agentKind: "Codex",
    status: step.status,
    occurredAt: new Date(Date.UTC(2026, 7, 12, 12, index)).toISOString(),
  };
}

// Mirrors the stored-state machine in index.ts.
interface Stored {
  status: "RUNNING" | "READY";
  lastEventId: string;
  occurredAt: string;
}

for (const scenario of table.scenarios) {
  Deno.test(`edge function: ${scenario.name}`, () => {
    UUIDS.clear();
    const sessionId = crypto.randomUUID();
    let stored: Stored | null = null;
    let notifications = 0;

    for (const step of scenario.events) {
      const validated = validateEvent(buildEvent(step, sessionId));
      if ("error" in validated) throw new Error(`rejected: ${validated.error}`);
      const event = validated.event;

      let duplicate = false;
      let stale = false;
      let notified = false;

      if (stored && stored.lastEventId === event.eventId) {
        duplicate = true;
      } else if (
        stored &&
        Date.parse(event.occurredAt) < Date.parse(stored.occurredAt)
      ) {
        stale = true;
      } else {
        notified = shouldNotify(stored?.status ?? null, event.status);
        if (notified) notifications += 1;
        stored = {
          status: event.status,
          lastEventId: event.eventId,
          occurredAt: event.occurredAt,
        };
      }

      const actual = { notified, duplicate, stale };
      for (const [key, expected] of Object.entries(step.expect)) {
        assertEquals(
          actual[key as keyof typeof actual],
          expected,
          `${scenario.name}: ${step.eventId} ${key}:`
        );
      }
    }

    assertEquals(
      notifications,
      scenario.expectedNotifications,
      `${scenario.name}: notification count:`
    );
  });
}

Deno.test("edge function: rejects the same malformed events", () => {
  const valid = {
    eventId: crypto.randomUUID(),
    sessionId: crypto.randomUUID(),
    displayName: "Auth refactor",
    machineName: "Test Mac",
    agentKind: "Codex",
    status: "RUNNING",
    occurredAt: new Date().toISOString(),
  };
  for (const bad of table.rejected) {
    const result = validateEvent({ ...valid, ...bad.patch });
    if (!("error" in result)) throw new Error(`should have been rejected: ${bad.name}`);
  }
});

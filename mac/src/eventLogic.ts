// Pure event logic for the local server.
//
// TWIN FILE: supabase/functions/events/logic.ts holds the same rules for the
// cloud path. They run in different runtimes (Node vs Deno) so they cannot
// share a module, but they must never disagree — mac/tests/scenarios.json
// is executed against BOTH (mac/tests/server.test.js drives this one over
// real HTTP, supabase/functions/events/scenarios_test.ts drives the other).
// Change one, change the other, and the scenario tests will tell you.

export interface AgentEvent {
  eventId: string;
  sessionId: string;
  displayName: string;
  machineName: string;
  agentKind: string;
  status: "RUNNING" | "READY";
  occurredAt: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_NAME_LENGTH = 200;

export function validateEvent(
  raw: unknown
): { event: AgentEvent } | { error: string } {
  if (typeof raw !== "object" || raw === null) {
    return { error: "body must be a JSON object" };
  }
  const body = raw as Record<string, unknown>;

  for (const field of ["eventId", "sessionId"]) {
    if (typeof body[field] !== "string" || !UUID_RE.test(body[field] as string)) {
      return { error: `${field} must be a UUID` };
    }
  }
  for (const field of ["displayName", "machineName"]) {
    const value = body[field];
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      value.length > MAX_NAME_LENGTH
    ) {
      return { error: `${field} must be a non-empty string (max ${MAX_NAME_LENGTH})` };
    }
  }
  if (body.status !== "RUNNING" && body.status !== "READY") {
    return { error: "status must be RUNNING or READY" };
  }
  if (
    typeof body.occurredAt !== "string" ||
    Number.isNaN(Date.parse(body.occurredAt))
  ) {
    return { error: "occurredAt must be an ISO-8601 timestamp" };
  }

  const agentKind =
    typeof body.agentKind === "string" &&
    body.agentKind.length > 0 &&
    body.agentKind.length <= MAX_NAME_LENGTH
      ? body.agentKind
      : "agent";

  return {
    event: {
      eventId: body.eventId as string,
      sessionId: body.sessionId as string,
      displayName: body.displayName as string,
      machineName: body.machineName as string,
      agentKind,
      status: body.status,
      occurredAt: body.occurredAt as string,
    },
  };
}

// Notify only when the stored status was RUNNING and the incoming status is
// READY. A new session going straight to READY, a repeated READY, or any
// transition to RUNNING never notifies.
export function shouldNotify(
  storedStatus: "RUNNING" | "READY" | null,
  incomingStatus: "RUNNING" | "READY"
): boolean {
  return storedStatus === "RUNNING" && incomingStatus === "READY";
}

export function notificationText(event: AgentEvent): {
  title: string;
  body: string;
} {
  return {
    title: `${event.displayName} is ready`,
    body: `${event.agentKind} finished its current turn on ${event.machineName}.`,
  };
}

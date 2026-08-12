// POST /events — the single write endpoint (plan §5).
//
// Behavior: authenticate by device key; validate payload; deduplicate by
// eventId; upsert the session row; notify exactly once on RUNNING -> READY;
// respond quickly. Logs contain metadata only.

import { createClient } from "npm:@supabase/supabase-js@2";
import { shouldNotify, validateEvent } from "./logic.ts";
import { providerFromEnv } from "./notify.ts";

const MAX_BODY_BYTES = 4096;

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json(405, { error: "method not allowed" });
  }

  const deviceKey = Deno.env.get("DEVICE_KEY");
  const auth = req.headers.get("authorization") ?? "";
  if (!deviceKey || auth !== `Bearer ${deviceKey}`) {
    return json(401, { error: "unknown device key" });
  }

  const rawBody = await req.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return json(413, { error: "payload too large" });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return json(400, { error: "invalid JSON" });
  }

  const validated = validateEvent(parsed);
  if ("error" in validated) {
    return json(400, { error: validated.error });
  }
  const event = validated.event;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: existing, error: readError } = await supabase
    .from("agents")
    .select("status, last_event_id, started_at")
    .eq("session_id", event.sessionId)
    .maybeSingle();
  if (readError) {
    console.error(`agents read failed: ${readError.message}`);
    return json(500, { error: "storage read failed" });
  }

  // Idempotency: a retried event carries the same eventId as the attempt
  // that may already have been applied. Acknowledge without re-applying.
  if (existing && existing.last_event_id === event.eventId) {
    return json(200, { ok: true, duplicate: true, notified: false });
  }

  const notify = shouldNotify(existing?.status ?? null, event.status);

  const { error: writeError } = await supabase.from("agents").upsert({
    session_id: event.sessionId,
    display_name: event.displayName,
    machine_name: event.machineName,
    agent_kind: event.agentKind,
    status: event.status,
    started_at: existing?.started_at ?? event.occurredAt,
    updated_at: new Date().toISOString(),
    last_event_id: event.eventId,
  });
  if (writeError) {
    console.error(`agents upsert failed: ${writeError.message}`);
    return json(500, { error: "storage write failed" });
  }

  let notified = false;
  if (notify) {
    try {
      await providerFromEnv().sendReadyNotification(event);
      notified = true;
    } catch (err) {
      // The state is already stored; a delivery failure must not fail the
      // event. Metadata-only log.
      console.error(
        `notification delivery failed for session ${event.sessionId}: ${err}`
      );
    }
  }

  console.log(
    `event session=${event.sessionId} status=${event.status} notified=${notified}`
  );
  return json(200, { ok: true, duplicate: false, notified });
});

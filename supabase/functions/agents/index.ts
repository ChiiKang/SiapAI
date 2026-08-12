// The narrow read endpoint for the iOS app (plan §12: "Use Row Level
// Security or a narrow read endpoint"). Also handles the destructive swipe
// on a stale row.
//
//   GET    /agents                     -> current state of every session
//   DELETE /agents?session_id=<uuid>   -> remove one session row
//
// Auth is the same device key the CLI uses — one personal identity for the
// whole system (plan §11: no multi-user auth). The service-role key never
// leaves this function.

import { createClient } from "npm:@supabase/supabase-js@2";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const deviceKey = Deno.env.get("DEVICE_KEY");
  const auth = req.headers.get("authorization") ?? "";
  if (!deviceKey || auth !== `Bearer ${deviceKey}`) {
    return json(401, { error: "unknown device key" });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  if (req.method === "GET") {
    const { data, error } = await supabase
      .from("agents")
      .select(
        "session_id, display_name, machine_name, agent_kind, status, started_at, updated_at"
      )
      .order("updated_at", { ascending: false });
    if (error) {
      console.error(`agents read failed: ${error.message}`);
      return json(500, { error: "storage read failed" });
    }
    // camelCase for the iOS client, per the contract.
    return json(
      200,
      data.map((row) => ({
        sessionId: row.session_id,
        displayName: row.display_name,
        machineName: row.machine_name,
        agentKind: row.agent_kind,
        status: row.status,
        startedAt: row.started_at,
        updatedAt: row.updated_at,
      }))
    );
  }

  if (req.method === "DELETE") {
    const sessionId = new URL(req.url).searchParams.get("session_id") ?? "";
    if (!UUID_RE.test(sessionId)) {
      return json(400, { error: "session_id must be a UUID" });
    }
    const { error } = await supabase
      .from("agents")
      .delete()
      .eq("session_id", sessionId);
    if (error) {
      console.error(`agents delete failed: ${error.message}`);
      return json(500, { error: "storage delete failed" });
    }
    return json(200, { ok: true });
  }

  return json(405, { error: "method not allowed" });
});

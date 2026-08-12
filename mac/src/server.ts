// The local backend: `agent-ready serve`.
//
// Implements exactly the contract in docs/contract.md — POST /events,
// GET /agents, DELETE /agents — against a JSON file on this Mac. No cloud
// account, no deployment, no internet required. The Supabase Edge Functions
// are the same contract for later; swapping between them is one line in
// ~/.agent-ready/config.json.
//
// It listens on the LAN so the iPhone can read the list over Wi-Fi, and
// every request must present the device key.

import * as http from "node:http";
import * as os from "node:os";
import { Config } from "./config";
import { shouldNotify, validateEvent } from "./eventLogic";
import { makeProvider, NotificationProvider } from "./notifier";
import { Store, StoredSession } from "./store";

const MAX_BODY_BYTES = 4096;

function stamp(): string {
  return new Date().toTimeString().slice(0, 8);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) {
        reject(new Error("payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function publicShape(session: StoredSession) {
  return {
    sessionId: session.sessionId,
    displayName: session.displayName,
    machineName: session.machineName,
    agentKind: session.agentKind,
    status: session.status,
    startedAt: session.startedAt,
    updatedAt: session.updatedAt,
  };
}

// The address to type into the phone: the first non-internal IPv4 on this Mac.
export function lanAddress(): string | null {
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) return address.address;
    }
  }
  return null;
}

export interface ServerHandle {
  port: number;
  close(): Promise<void>;
}

export function startServer(options: {
  config: Config;
  port: number;
  host?: string;
  store?: Store;
  provider?: NotificationProvider;
  log?: (line: string) => void;
}): Promise<ServerHandle> {
  const store = options.store ?? new Store();
  const provider = options.provider ?? makeProvider(options.config);
  const log = options.log ?? ((line: string) => process.stdout.write(line + "\n"));
  const deviceKey = options.config.deviceKey;

  const json = (
    res: http.ServerResponse,
    status: number,
    body: Record<string, unknown> | unknown[]
  ) => {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
    });
    res.end(payload);
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.headers.authorization !== `Bearer ${deviceKey}`) {
      json(res, 401, { error: "unknown device key" });
      return;
    }

    try {
      if (req.method === "POST" && url.pathname === "/events") {
        await handleEvent(req, res);
        return;
      }
      if (req.method === "GET" && url.pathname === "/agents") {
        json(res, 200, store.list().map(publicShape));
        return;
      }
      if (req.method === "DELETE" && url.pathname === "/agents") {
        const sessionId = url.searchParams.get("session_id") ?? "";
        store.delete(sessionId);
        json(res, 200, { ok: true });
        return;
      }
      json(res, 404, { error: "not found" });
    } catch (err) {
      log(`request failed: ${err}`);
      json(res, 500, { error: "internal error" });
    }
  });

  async function handleEvent(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    let raw: string;
    try {
      raw = await readBody(req);
    } catch {
      json(res, 413, { error: "payload too large" });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      json(res, 400, { error: "invalid JSON" });
      return;
    }

    const validated = validateEvent(parsed);
    if ("error" in validated) {
      json(res, 400, { error: validated.error });
      return;
    }
    const event = validated.event;
    const existing = store.get(event.sessionId);

    // Idempotency: a retried event carries the eventId of an attempt that may
    // already have been applied.
    if (existing && existing.lastEventId === event.eventId) {
      json(res, 200, { ok: true, duplicate: true, notified: false });
      return;
    }

    // Out-of-order protection: a delayed delivery of an older event must not
    // rewind the stored state and let the next READY notify twice.
    if (
      existing &&
      Date.parse(event.occurredAt) < Date.parse(existing.occurredAt)
    ) {
      json(res, 200, { ok: true, stale: true, notified: false });
      return;
    }

    const notify = shouldNotify(existing?.status ?? null, event.status);

    store.put({
      sessionId: event.sessionId,
      displayName: event.displayName,
      machineName: event.machineName,
      agentKind: event.agentKind,
      status: event.status,
      startedAt: existing?.startedAt ?? event.occurredAt,
      updatedAt: new Date().toISOString(),
      occurredAt: event.occurredAt,
      lastEventId: event.eventId,
    });

    let notified = false;
    if (notify) {
      try {
        await provider.sendReadyNotification(event);
        notified = true;
      } catch (err) {
        // State is stored; a delivery failure must not fail the event.
        log(`${stamp()}  notification failed for ${event.displayName}: ${err}`);
      }
    }

    log(
      `${stamp()}  ${event.status.padEnd(7)} ${event.displayName}` +
        (notified ? "  → notified" : "")
    );
    json(res, 200, { ok: true, duplicate: false, notified });
  }

  return new Promise((resolve, reject) => {
    // Before listen succeeds an error (a taken port, a bad host) must reject
    // the promise; afterwards it must only be logged, never thrown, so a
    // stray socket error cannot take the server down mid-session.
    let listening = false;
    server.on("error", (err) => {
      if (listening) log(`server error: ${err.message}`);
      else reject(err);
    });

    server.listen(options.port, options.host ?? "0.0.0.0", () => {
      listening = true;
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : options.port;
      resolve({
        port,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

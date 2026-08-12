// Acceptance tests for the local server (`agent-ready serve`).
//
// The shared scenario table in scenarios.json is executed here over real
// HTTP, and against the Deno edge-function logic in
// supabase/functions/events/scenarios_test.ts — so the local and cloud
// backends cannot drift apart.

"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { startServer } = require("../dist/server");
const { Store } = require("../dist/store");

const SCENARIOS = JSON.parse(
  fs.readFileSync(path.join(__dirname, "scenarios.json"), "utf8")
);

const DEVICE_KEY = "dk_local_test_key";

// Collects notifications instead of posting them to Notification Center.
function recordingProvider() {
  const sent = [];
  return {
    sent,
    async sendReadyNotification(event) {
      sent.push(event);
    },
  };
}

async function withServer(run, options = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agent-ready-server-"));
  const provider = options.provider ?? recordingProvider();
  const handle = await startServer({
    config: { apiBaseUrl: "", deviceKey: DEVICE_KEY, machineName: "Test Mac" },
    port: 0,
    host: "127.0.0.1",
    store: new Store(path.join(home, "state.json")),
    provider,
    log: () => {},
  });
  const base = `http://127.0.0.1:${handle.port}`;
  try {
    return await run({ base, provider, home });
  } finally {
    await handle.close();
  }
}

function post(base, body, key = DEVICE_KEY) {
  return fetch(`${base}/events`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Turns the scenario placeholders into a concrete event.
function buildEvent(step, ids, sessionId) {
  const index = Number(step.occurredAt.slice(1));
  return {
    eventId: ids[step.eventId],
    sessionId,
    displayName: "Auth refactor",
    machineName: "Test Mac",
    agentKind: "Codex",
    status: step.status,
    // T1..T9 -> increasing timestamps one minute apart.
    occurredAt: new Date(Date.UTC(2026, 7, 12, 12, index)).toISOString(),
  };
}

for (const scenario of SCENARIOS.scenarios) {
  test(`local server: ${scenario.name}`, async () => {
    await withServer(async ({ base, provider }) => {
      const sessionId = randomUUID();
      const ids = {};
      for (const step of scenario.events) {
        ids[step.eventId] ??= randomUUID();
      }

      for (const step of scenario.events) {
        const response = await post(base, buildEvent(step, ids, sessionId));
        assert.equal(response.status, 200, `${step.eventId} should be accepted`);
        const body = await response.json();
        for (const [key, expected] of Object.entries(step.expect)) {
          assert.equal(
            body[key] ?? false,
            expected,
            `${scenario.name}: ${step.eventId} expected ${key}=${expected}, got ${body[key]}`
          );
        }
      }

      assert.equal(
        provider.sent.length,
        scenario.expectedNotifications,
        `${scenario.name}: notification count`
      );
    });
  });
}

test("local server: a taken port fails cleanly instead of crashing", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agent-ready-server-"));
  const config = { apiBaseUrl: "", deviceKey: DEVICE_KEY, machineName: "Test Mac" };
  const options = {
    config,
    host: "127.0.0.1",
    store: new Store(path.join(home, "state.json")),
    provider: recordingProvider(),
    log: () => {},
  };

  const first = await startServer({ ...options, port: 0 });
  // A second server on the same port must reject, not throw an unhandled
  // 'error' event (which would print a Node stack trace at the owner).
  await assert.rejects(
    () => startServer({ ...options, port: first.port }),
    (err) => err.code === "EADDRINUSE"
  );
  await first.close();
});

test("local server: rejects malformed events", async () => {
  await withServer(async ({ base }) => {
    const valid = {
      eventId: randomUUID(),
      sessionId: randomUUID(),
      displayName: "Auth refactor",
      machineName: "Test Mac",
      agentKind: "Codex",
      status: "RUNNING",
      occurredAt: new Date().toISOString(),
    };
    for (const bad of SCENARIOS.rejected) {
      const response = await post(base, { ...valid, ...bad.patch });
      assert.equal(response.status, 400, bad.name);
    }
  });
});

test("local server: rejects a wrong or missing device key", async () => {
  await withServer(async ({ base }) => {
    const response = await post(base, {}, "dk_wrong");
    assert.equal(response.status, 401);

    const noHeader = await fetch(`${base}/agents`);
    assert.equal(noHeader.status, 401);
  });
});

test("local server: GET /agents returns the app's payload shape", async () => {
  await withServer(async ({ base }) => {
    const sessionId = randomUUID();
    const occurredAt = new Date().toISOString();
    await post(base, {
      eventId: randomUUID(),
      sessionId,
      displayName: "Auth refactor",
      machineName: "MacBook Pro",
      agentKind: "Codex",
      status: "RUNNING",
      occurredAt,
    });

    const response = await fetch(`${base}/agents`, {
      headers: { Authorization: `Bearer ${DEVICE_KEY}` },
    });
    assert.equal(response.status, 200);
    const [session] = await response.json();

    // Exactly the fields ios/AgentReady/Models/AgentSession.swift decodes.
    assert.deepEqual(Object.keys(session).sort(), [
      "agentKind",
      "displayName",
      "machineName",
      "sessionId",
      "startedAt",
      "status",
      "updatedAt",
    ]);
    assert.equal(session.sessionId, sessionId);
    assert.equal(session.status, "RUNNING");
    assert.equal(session.startedAt, occurredAt);
  });
});

test("local server: DELETE removes a session", async () => {
  await withServer(async ({ base }) => {
    const sessionId = randomUUID();
    await post(base, {
      eventId: randomUUID(),
      sessionId,
      displayName: "Stale one",
      machineName: "Test Mac",
      agentKind: "Codex",
      status: "RUNNING",
      occurredAt: new Date().toISOString(),
    });

    const deleted = await fetch(`${base}/agents?session_id=${sessionId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${DEVICE_KEY}` },
    });
    assert.equal(deleted.status, 200);

    const listed = await fetch(`${base}/agents`, {
      headers: { Authorization: `Bearer ${DEVICE_KEY}` },
    });
    assert.deepEqual(await listed.json(), []);
  });
});

test("local server: state survives a restart", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agent-ready-server-"));
  const statePath = path.join(home, "state.json");
  const config = { apiBaseUrl: "", deviceKey: DEVICE_KEY, machineName: "Test Mac" };
  const sessionId = randomUUID();

  const first = await startServer({
    config,
    port: 0,
    host: "127.0.0.1",
    store: new Store(statePath),
    provider: recordingProvider(),
    log: () => {},
  });
  await post(`http://127.0.0.1:${first.port}`, {
    eventId: randomUUID(),
    sessionId,
    displayName: "Auth refactor",
    machineName: "Test Mac",
    agentKind: "Codex",
    status: "READY",
    occurredAt: new Date().toISOString(),
  });
  await first.close();

  // A fresh server reading the same file still knows about the session.
  const second = await startServer({
    config,
    port: 0,
    host: "127.0.0.1",
    store: new Store(statePath),
    provider: recordingProvider(),
    log: () => {},
  });
  const response = await fetch(`http://127.0.0.1:${second.port}/agents`, {
    headers: { Authorization: `Bearer ${DEVICE_KEY}` },
  });
  const sessions = await response.json();
  await second.close();

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].sessionId, sessionId);
  assert.equal(sessions[0].status, "READY");
});

test("end to end: the CLI drives the local server and one turn notifies once", async () => {
  await withServer(async ({ base, provider, home }) => {
    // A real wrapper session pointed at the real local server.
    fs.writeFileSync(
      path.join(home, "config.json"),
      JSON.stringify({
        apiBaseUrl: base,
        deviceKey: DEVICE_KEY,
        machineName: "MacBook Pro",
      })
    );

    const { runWrapper } = require("./helpers");
    const result = await runWrapper({
      args: [
        "run",
        "--name",
        "Auth refactor",
        "--adapter",
        "codex",
        "--",
        process.execPath,
        path.join(__dirname, "fake-codex.js"),
      ],
      steps: ["turn", "exit"],
      home,
    });

    assert.equal(result.code, 0);
    assert.match(result.stdout, /status\s+READY/);
    assert.match(result.stdout, /notify\s+queued → phone/);

    // Exactly one notification, with the copy from the spec.
    assert.equal(provider.sent.length, 1);
    assert.equal(provider.sent[0].displayName, "Auth refactor");
    assert.equal(provider.sent[0].status, "READY");

    // And the app would see the session as READY.
    const response = await fetch(`${base}/agents`, {
      headers: { Authorization: `Bearer ${DEVICE_KEY}` },
    });
    const [session] = await response.json();
    assert.equal(session.displayName, "Auth refactor");
    assert.equal(session.status, "READY");
  });
});

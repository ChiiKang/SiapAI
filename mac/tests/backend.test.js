// Milestone 2/5 acceptance tests for the CLI event path: events reach a fake
// backend in order, carry the contract fields, keep their eventId across
// retries, and retries are bounded.

"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { runWrapper, count } = require("./helpers");

const FAKE_CODEX = path.join(__dirname, "fake-codex.js");

// Starts a fake /events backend. `plan` is a function(requestCount) -> http
// status to respond with. Returns { url, requests, close }.
function startFakeBackend(plan) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const record = {
        url: req.url,
        auth: req.headers.authorization,
        body: JSON.parse(body),
      };
      requests.push(record);
      const status = plan(requests.length);
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ ok: status < 300, notified: record.body.status === "READY" })
      );
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        requests,
        close: () => server.close(),
      });
    });
  });
}

function writeConfig(baseUrl) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agent-ready-test-"));
  fs.writeFileSync(
    path.join(home, "config.json"),
    JSON.stringify({
      apiBaseUrl: baseUrl,
      deviceKey: "dk_test_key",
      machineName: "Test Mac",
    })
  );
  return home;
}

function runConfiguredCodex(steps, home) {
  return runWrapper({
    args: [
      "run",
      "--name",
      "Auth refactor",
      "--adapter",
      "codex",
      "--",
      process.execPath,
      FAKE_CODEX,
    ],
    steps,
    home,
    env: { AGENT_READY_RETRY_BASE_MS: "10" },
  });
}

test("RUNNING then READY events reach the backend with contract fields", async () => {
  const backend = await startFakeBackend(() => 200);
  const result = await runConfiguredCodex(["turn", "exit"], writeConfig(backend.url));
  backend.close();

  assert.equal(result.code, 0);
  assert.equal(backend.requests.length, 2);

  const [running, ready] = backend.requests.map((r) => r.body);
  assert.equal(running.status, "RUNNING");
  assert.equal(ready.status, "READY");
  for (const event of [running, ready]) {
    assert.equal(event.displayName, "Auth refactor");
    assert.equal(event.machineName, "Test Mac");
    assert.equal(event.agentKind, "Codex");
    assert.equal(event.sessionId, running.sessionId); // same session for both
    assert.match(event.eventId, /^[0-9a-f-]{36}$/);
    assert.ok(!Number.isNaN(Date.parse(event.occurredAt)));
  }
  assert.notEqual(running.eventId, ready.eventId);
  assert.equal(backend.requests[0].auth, "Bearer dk_test_key");
  assert.match(result.stdout, /notify\s+queued → phone/);
});

test("retries reuse the same eventId and announce delivery", async () => {
  // First two attempts fail with 500, third succeeds.
  const backend = await startFakeBackend((n) => (n <= 2 ? 500 : 200));
  const result = await runConfiguredCodex(["exit"], writeConfig(backend.url));
  backend.close();

  // One RUNNING event, attempted three times, same eventId throughout.
  assert.equal(backend.requests.length, 3);
  const ids = new Set(backend.requests.map((r) => r.body.eventId));
  assert.equal(ids.size, 1);
  assert.match(result.stdout, /retry 1\/5/);
  assert.match(result.stdout, /retry 2\/5/);
  assert.match(result.stdout, /delivered .* \(same eventId .*no duplicate notification\)/);
});

test("retries are bounded: event dropped after 5 retries", async () => {
  const backend = await startFakeBackend(() => 500);
  const result = await runConfiguredCodex(["exit"], writeConfig(backend.url));
  backend.close();

  // Initial attempt + 5 retries = 6 requests, then the event is dropped.
  assert.equal(backend.requests.length, 6);
  assert.match(result.stdout, /dropped after 5 retries/);
  assert.equal(result.code, 0); // wrapper still exits cleanly
});

test("4xx responses are not retried (configuration errors)", async () => {
  const backend = await startFakeBackend(() => 401);
  const result = await runConfiguredCodex(["exit"], writeConfig(backend.url));
  backend.close();

  assert.equal(backend.requests.length, 1);
  assert.match(result.stdout, /rejected \(401\)/);
});

test("without a config the wrapper is local-only and sends nothing", async () => {
  const result = await runWrapper({
    args: [
      "run",
      "--adapter",
      "codex",
      "--",
      process.execPath,
      FAKE_CODEX,
    ],
    steps: ["turn", "exit"],
  });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /local-only mode/);
  assert.equal(count(result.stdout, /status\s+READY/g), 1);
});

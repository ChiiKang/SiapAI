// Pre-ship acceptance tests for the paths the owner's walkthrough exercises:
// setup/config, five concurrent sessions, signal handling, and the exact
// wire payloads (captured as a fixture the backend's own test replays).

"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { runWrapper, count, CLI } = require("./helpers");

const FAKE_CODEX = path.join(__dirname, "fake-codex.js");
const FIXTURE_PATH = path.join(__dirname, "fixtures", "captured-events.json");

function startFakeBackend() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      requests.push(JSON.parse(body));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, duplicate: false, notified: false }));
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

function writeConfig(baseUrl, machineName = "Test Mac") {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agent-ready-test-"));
  fs.writeFileSync(
    path.join(home, "config.json"),
    JSON.stringify({ apiBaseUrl: baseUrl, deviceKey: "dk_test_key", machineName })
  );
  return home;
}

function runSetup(args, home) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, "setup", ...args], {
      env: { ...process.env, AGENT_READY_HOME: home },
    });
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.on("exit", (code) => resolve({ code, stdout }));
  });
}

test("setup writes a 0600 config and rotates the key on re-run", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agent-ready-test-"));
  const configPath = path.join(home, "config.json");

  const first = await runSetup(
    ["--api-base-url", "https://example.supabase.co/functions/v1/", "--machine", "MacBook Pro"],
    home
  );
  assert.equal(first.code, 0);

  const config1 = JSON.parse(fs.readFileSync(configPath, "utf8"));
  assert.equal(config1.apiBaseUrl, "https://example.supabase.co/functions/v1"); // trailing slash trimmed
  assert.equal(config1.machineName, "MacBook Pro");
  assert.match(config1.deviceKey, /^dk_[0-9a-f]{48}$/);
  assert.match(first.stdout, /device key dk_/);

  // Owner-only permissions: the key is a bearer credential.
  assert.equal(fs.statSync(configPath).mode & 0o777, 0o600);

  // Re-running rotates the key and keeps the machine label.
  const second = await runSetup(
    ["--api-base-url", "https://example.supabase.co/functions/v1"],
    home
  );
  assert.equal(second.code, 0);
  const config2 = JSON.parse(fs.readFileSync(configPath, "utf8"));
  assert.notEqual(config2.deviceKey, config1.deviceKey);
  assert.equal(config2.machineName, "MacBook Pro");
});

test("setup without --api-base-url fails with usage", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agent-ready-test-"));
  const result = await runSetup([], home);
  assert.equal(result.code, 2);
});

test("the wrapper uses the machine name from config, not the hostname", async () => {
  const backend = await startFakeBackend();
  await runWrapper({
    args: ["run", "--name", "Auth refactor", "--adapter", "codex", "--", process.execPath, FAKE_CODEX],
    steps: ["exit"],
    home: writeConfig(backend.url, "Studio Mac"),
  });
  backend.close();
  assert.equal(backend.requests[0].machineName, "Studio Mac");
});

test("five concurrent sessions stay distinct (plan acceptance test)", async () => {
  const backend = await startFakeBackend();
  const names = ["Auth refactor", "Payments tests", "Dashboard bug", "Docs pass", "Nightly batch"];

  const results = await Promise.all(
    names.map((name) =>
      runWrapper({
        args: ["run", "--name", name, "--adapter", "codex", "--", process.execPath, FAKE_CODEX],
        steps: ["turn", "exit"],
        home: writeConfig(backend.url),
      })
    )
  );
  backend.close();

  for (const result of results) assert.equal(result.code, 0);

  // Five sessions x (RUNNING + READY), five distinct session ids.
  assert.equal(backend.requests.length, 10);
  const sessionIds = new Set(backend.requests.map((r) => r.sessionId));
  assert.equal(sessionIds.size, 5);

  // Each session sent exactly one RUNNING and one READY under its own name,
  // with no cross-talk between sessions.
  for (const name of names) {
    const events = backend.requests.filter((r) => r.displayName === name);
    assert.equal(events.length, 2, `${name} should have 2 events`);
    assert.equal(events.filter((e) => e.status === "RUNNING").length, 1);
    assert.equal(events.filter((e) => e.status === "READY").length, 1);
    assert.equal(new Set(events.map((e) => e.sessionId)).size, 1);
  }
  // Every event id is unique across all sessions.
  assert.equal(new Set(backend.requests.map((r) => r.eventId)).size, 10);
});

test("an interrupted process reports no READY", async () => {
  // A long-running child killed by a signal was interrupted, not finished.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agent-ready-test-"));
  const child = spawn(
    process.execPath,
    [CLI, "run", "--name", "Long job", "--", process.execPath, "-e", "setInterval(() => {}, 1000)"],
    { env: { ...process.env, AGENT_READY_HOME: home }, stdio: ["ignore", "pipe", "pipe"] }
  );

  let stdout = "";
  child.stdout.on("data", (d) => (stdout += d));

  const exited = new Promise((resolve) => child.on("exit", resolve));
  // Wait for launch output, then interrupt.
  await new Promise((resolve) => setTimeout(resolve, 500));
  child.kill("SIGINT");
  await exited;

  assert.match(stdout, /status\s+RUNNING/);
  assert.equal(count(stdout, /status\s+READY/g), 0);
  assert.match(stdout, /exited/);
});

test("captures the exact wire payloads for the backend contract test", async () => {
  const backend = await startFakeBackend();
  // A full Codex lifecycle: launch, turn done, next turn starts, turn done.
  const result = await runWrapper({
    args: ["run", "--name", "Auth refactor", "--adapter", "codex", "--", process.execPath, FAKE_CODEX],
    steps: ["turn", "approval", "turn", "exit"],
    home: writeConfig(backend.url, "MacBook Pro"),
  });
  backend.close();

  assert.equal(result.code, 0);
  assert.deepEqual(
    backend.requests.map((r) => r.status),
    ["RUNNING", "READY", "RUNNING", "READY"]
  );

  // Shared fixture: supabase/functions/events/contract_test.ts replays these
  // exact payloads through the real validator and notify rule, so a drift
  // between what the CLI sends and what the backend accepts fails a test
  // instead of failing on the owner's Mac.
  fs.mkdirSync(path.dirname(FIXTURE_PATH), { recursive: true });
  fs.writeFileSync(FIXTURE_PATH, JSON.stringify(backend.requests, null, 2) + "\n");
});

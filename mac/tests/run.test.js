// Milestone 1 acceptance tests. The wrapper runs against fake-codex.js,
// which reproduces Codex's documented notify behavior.

"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CLI = path.join(__dirname, "..", "dist", "cli.js");
const FAKE = path.join(__dirname, "fake-codex.js");

function runWrapper(steps) {
  return new Promise((resolve, reject) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "agent-ready-test-"));
    const child = spawn(
      process.execPath,
      [CLI, "run", "--name", "Test session", "--", process.execPath, FAKE],
      {
        env: { ...process.env, AGENT_READY_HOME: home },
        stdio: ["pipe", "pipe", "pipe"],
      }
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));

    // Feed steps one at a time; each step's hook invocation completes before
    // fake-codex reads the next line, so no artificial sleeps are needed.
    child.stdin.write(steps.map((s) => s + "\n").join(""));
    child.stdin.end();

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`wrapper timed out.\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, 15000);

    child.on("exit", (code) => {
      clearTimeout(timer);
      const logDir = path.join(home, "sessions");
      const logFiles = fs.existsSync(logDir) ? fs.readdirSync(logDir) : [];
      const log =
        logFiles.length > 0
          ? fs.readFileSync(path.join(logDir, logFiles[0]), "utf8")
          : "";
      resolve({ code, stdout, stderr, log });
    });
  });
}

function count(haystack, regex) {
  return (haystack.match(regex) ?? []).length;
}

test("exactly one READY per completed turn; duplicates ignored", async () => {
  const result = await runWrapper(["turn", "turn", "dup", "turn", "exit"]);

  assert.equal(result.code, 0);
  // 3 distinct turns -> exactly 3 READY transitions; the replayed turn-id adds none.
  assert.equal(count(result.stdout, /status\s+READY/g), 3);
  // RUNNING appears once, at launch (no approval event in this script).
  assert.equal(count(result.stdout, /status\s+RUNNING/g), 1);
  // The duplicate was seen and recorded as ignored.
  assert.match(result.log, /duplicate turn=turn-2 ignored/);
  // Every notify event type received is logged for the empirical record.
  assert.equal(count(result.log, /notify event type=agent-turn-complete/g), 4);
});

test("approval-requested resets READY back to RUNNING", async () => {
  const result = await runWrapper(["turn", "approval", "turn", "exit"]);

  assert.equal(result.code, 0);
  assert.equal(count(result.stdout, /status\s+READY/g), 2);
  // Launch RUNNING + reset RUNNING after the approval signal.
  assert.equal(count(result.stdout, /status\s+RUNNING/g), 2);
  assert.match(result.stdout, /approval requested — turn in progress/);
  // With the reset observed, the second READY carries no gap marker.
  assert.doesNotMatch(result.stdout, /no RUNNING reset observed/);
});

test("consecutive READY without a reset is marked explicitly", async () => {
  const result = await runWrapper(["turn", "turn", "exit"]);

  assert.equal(result.code, 0);
  assert.equal(count(result.stdout, /no RUNNING reset observed/g), 1);
});

test("process exit is never treated as READY", async () => {
  const result = await runWrapper(["exit"]);

  assert.equal(result.code, 0);
  assert.equal(count(result.stdout, /status\s+READY/g), 0);
  assert.match(result.stdout, /exited \(code 0\)/);
});

test("no prompt or output content reaches stdout or the session log", async () => {
  const result = await runWrapper(["turn", "dup", "approval", "turn", "exit"]);

  for (const channel of [result.stdout, result.stderr, result.log]) {
    assert.doesNotMatch(channel, /SECRET/);
  }
});

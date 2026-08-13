// Milestone 1 acceptance tests: the Codex adapter against fake-codex.js,
// which reproduces Codex's documented notify behavior.

"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const path = require("node:path");
const { runWrapper, count } = require("./helpers");

const FAKE = path.join(__dirname, "fake-codex.js");

function runCodex(steps) {
  return runWrapper({
    args: [
      "run",
      "--name",
      "Test session",
      "--adapter",
      "codex",
      "--",
      process.execPath,
      FAKE,
    ],
    steps,
  });
}

test("exactly one READY per completed turn; duplicates ignored", async () => {
  const result = await runCodex(["turn", "turn", "dup", "turn", "exit"]);

  assert.equal(result.code, 0);
  // 3 distinct turns -> exactly 3 READY transitions; the replayed turn-id adds none.
  assert.equal(count(result.stdout, /status\s+READY/g), 3);
  // Launch RUNNING, plus a reset before each of the 2 later turns. The
  // replayed turn-id is not a new turn and must not add one.
  assert.equal(count(result.stdout, /status\s+RUNNING/g), 3);
  assert.equal(count(result.stdout, /new turn observed/g), 2);
  // The duplicate was seen and recorded as ignored.
  assert.match(result.log, /duplicate turn=turn-2 ignored/);
  // Every notify event type received is logged for the empirical record.
  assert.equal(count(result.log, /notify event type=agent-turn-complete/g), 4);
});

test("approval-requested resets READY back to RUNNING", async () => {
  const result = await runCodex(["turn", "approval", "turn", "exit"]);

  assert.equal(result.code, 0);
  assert.equal(count(result.stdout, /status\s+READY/g), 2);
  // Launch RUNNING + reset RUNNING after the approval signal.
  assert.equal(count(result.stdout, /status\s+RUNNING/g), 2);
  assert.match(result.stdout, /approval requested — turn in progress/);
  // With the reset observed, the second READY carries no gap marker.
  assert.doesNotMatch(result.stdout, /no RUNNING reset observed/);
});

// Regression guard for the bug real Codex 0.147 exhibited (docs/handover.md
// § 5): every turn completed and was detected, but only the first one ever
// notified, because nothing reset the session out of READY in between.
test("a new turn-id resets to RUNNING, so every turn is a fresh transition", async () => {
  const result = await runCodex(["turn", "turn", "turn", "exit"]);

  assert.equal(result.code, 0);
  assert.equal(count(result.stdout, /status\s+READY/g), 3);
  // Launch + one reset per later turn: three RUNNING -> READY transitions,
  // which is three notifications rather than one.
  assert.equal(count(result.stdout, /status\s+RUNNING/g), 3);
  // Every READY is a genuine transition, so none carries the gap marker.
  assert.doesNotMatch(result.stdout, /no RUNNING reset observed/);
});

test("process exit is never treated as READY (codex adapter)", async () => {
  const result = await runCodex(["exit"]);

  assert.equal(result.code, 0);
  assert.equal(count(result.stdout, /status\s+READY/g), 0);
  assert.match(result.stdout, /exited \(code 0\)/);
});

test("no prompt or output content reaches stdout or the session log", async () => {
  const result = await runCodex(["turn", "dup", "approval", "turn", "exit"]);

  for (const channel of [result.stdout, result.stderr, result.log]) {
    assert.doesNotMatch(channel, /SECRET/);
  }
});

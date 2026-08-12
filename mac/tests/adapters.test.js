// Milestone 1.5 acceptance tests: Claude Code adapter (against fake-claude.js)
// and the generic process adapter.

"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const path = require("node:path");
const { runWrapper, count } = require("./helpers");

const FAKE_CLAUDE = path.join(__dirname, "fake-claude.js");

function runClaude(steps) {
  return runWrapper({
    args: [
      "run",
      "--name",
      "Docs pass",
      "--adapter",
      "claude",
      "--",
      process.execPath,
      FAKE_CLAUDE,
    ],
    steps,
  });
}

test("claude: Stop -> READY, UserPromptSubmit -> RUNNING reset", async () => {
  const result = await runClaude(["prompt", "stop", "prompt", "stop", "exit"]);

  assert.equal(result.code, 0);
  assert.equal(count(result.stdout, /status\s+READY/g), 2);
  // Launch RUNNING + one observed reset (first "prompt" arrives while already RUNNING).
  assert.equal(count(result.stdout, /status\s+RUNNING/g), 2);
  assert.match(result.stdout, /prompt submitted — turn in progress/);
  // Claude Code has a real turn-start signal, so no gap marker ever appears.
  assert.doesNotMatch(result.stdout, /no RUNNING reset observed/);
});

test("claude: no prompt content or transcript path leaks", async () => {
  const result = await runClaude(["prompt", "stop", "exit"]);

  for (const channel of [result.stdout, result.stderr, result.log]) {
    assert.doesNotMatch(channel, /SECRET/);
  }
});

test("claude: exit without Stop produces no READY", async () => {
  const result = await runClaude(["prompt", "exit"]);

  assert.equal(result.code, 0);
  assert.equal(count(result.stdout, /status\s+READY/g), 0);
});

test("generic: process exit is the completion signal", async () => {
  const result = await runWrapper({
    args: [
      "run",
      "--name",
      "Batch job",
      "--adapter",
      "generic",
      "--",
      process.execPath,
      "-e",
      "setTimeout(() => process.exit(0), 50)",
    ],
  });

  assert.equal(result.code, 0);
  assert.equal(count(result.stdout, /status\s+READY/g), 1);
  assert.match(result.stdout, /exited \(code 0\)/);
});

test("adapter is inferred from the command name", async () => {
  // `node -e …` is neither codex nor claude, so the generic adapter applies
  // without any --adapter flag: one READY on exit.
  const result = await runWrapper({
    args: ["run", "--", process.execPath, "-e", "process.exit(0)"],
  });

  assert.equal(result.code, 0);
  assert.equal(count(result.stdout, /status\s+READY/g), 1);
});

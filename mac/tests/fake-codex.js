#!/usr/bin/env node
// Behavior-faithful stand-in for Codex's notify mechanism, used by the
// automated acceptance tests (this container cannot run real Codex).
//
// Like real Codex it: receives `-c notify=["prog", args…]` on its argv,
// and invokes that program once per notification event with the event JSON
// appended as the final argument. Payloads deliberately include fake
// prompt/output content so the tests can assert it never leaks anywhere.
//
// Driven by lines on stdin:
//   turn      complete a new turn        -> agent-turn-complete, new turn-id
//   dup       replay the last completion -> agent-turn-complete, same turn-id
//   approval  request an approval        -> approval-requested
//   exit      exit 0

"use strict";

const { execFile } = require("node:child_process");
const readline = require("node:readline");

function parseNotifyArgv() {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "-c" && argv[i + 1] && argv[i + 1].startsWith("notify=")) {
      // The wrapper emits the value with JSON.stringify, so JSON.parse is a
      // faithful reader here (real Codex parses it as TOML).
      return JSON.parse(argv[i + 1].slice("notify=".length));
    }
  }
  process.stderr.write("fake-codex: no -c notify=[...] found\n");
  process.exit(1);
}

const notify = parseNotifyArgv();

function invokeHook(payload) {
  return new Promise((resolve) => {
    execFile(
      notify[0],
      [...notify.slice(1), JSON.stringify(payload)],
      () => resolve()
    );
  });
}

let turnCounter = 0;
let lastTurnId = null;
let queue = Promise.resolve();

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const step = line.trim();
  queue = queue.then(async () => {
    if (step === "turn") {
      turnCounter += 1;
      lastTurnId = `turn-${turnCounter}`;
      await invokeHook({
        type: "agent-turn-complete",
        "turn-id": lastTurnId,
        "input-messages": ["SECRET-PROMPT-CONTENT"],
        "last-assistant-message": "SECRET-OUTPUT-CONTENT",
      });
    } else if (step === "dup") {
      await invokeHook({
        type: "agent-turn-complete",
        "turn-id": lastTurnId,
        "last-assistant-message": "SECRET-OUTPUT-CONTENT",
      });
    } else if (step === "approval") {
      await invokeHook({ type: "approval-requested" });
    } else if (step === "exit") {
      process.exit(0);
    }
  });
});

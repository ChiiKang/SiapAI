#!/usr/bin/env node
// Behavior-faithful stand-in for Claude Code's hook mechanism. Like the real
// thing it: receives `--settings <path>` on argv, reads the hook commands
// from that settings JSON, and runs the matching command with the event
// payload as JSON on stdin. Payloads include fake prompt content so tests
// can assert it never leaks.
//
// Driven by lines on stdin:
//   prompt    user submits a prompt   -> UserPromptSubmit hook
//   stop      claude finishes a turn  -> Stop hook
//   exit      exit 0

"use strict";

const { exec } = require("node:child_process");
const fs = require("node:fs");
const readline = require("node:readline");

function loadSettings() {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--settings" && argv[i + 1]) {
      return JSON.parse(fs.readFileSync(argv[i + 1], "utf8"));
    }
  }
  process.stderr.write("fake-claude: no --settings found\n");
  process.exit(1);
}

const settings = loadSettings();

function invokeHook(eventName, payload) {
  const entries = (settings.hooks ?? {})[eventName] ?? [];
  const invocations = [];
  for (const entry of entries) {
    for (const hook of entry.hooks ?? []) {
      invocations.push(
        new Promise((resolve) => {
          const child = exec(hook.command, () => resolve());
          child.stdin.write(JSON.stringify({ hook_event_name: eventName, ...payload }));
          child.stdin.end();
        })
      );
    }
  }
  return Promise.all(invocations);
}

let queue = Promise.resolve();
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const step = line.trim();
  queue = queue.then(async () => {
    if (step === "prompt") {
      await invokeHook("UserPromptSubmit", { prompt: "SECRET-PROMPT-CONTENT" });
    } else if (step === "stop") {
      await invokeHook("Stop", { transcript_path: "/SECRET/path.jsonl" });
    } else if (step === "exit") {
      process.exit(0);
    }
  });
});

#!/usr/bin/env node
// The command Claude Code runs on its hook events (configured via
// --settings). Claude Code passes the event payload as JSON on stdin; the
// only field forwarded to the wrapper is hook_event_name. Prompt text,
// transcript paths, and everything else stop here. Always exits 0 quickly so
// it can never block or break the wrapped session.

import * as net from "node:net";

const socketPath = process.argv[2];

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  let type = "unparseable";
  try {
    const payload = JSON.parse(input);
    type = String(payload.hook_event_name ?? "unknown");
  } catch {
    // fall through with "unparseable"
  }

  if (!socketPath) process.exit(0);
  const connection = net.connect(socketPath);
  connection.on("connect", () => {
    connection.end(JSON.stringify({ type }) + "\n");
  });
  connection.on("close", () => process.exit(0));
  connection.on("error", () => process.exit(0));
});

setTimeout(() => process.exit(0), 2000).unref();

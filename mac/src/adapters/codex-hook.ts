#!/usr/bin/env node
// The program Codex invokes via its `notify` config once per notification
// event. Codex passes the event JSON as the final argv argument.
//
// This hook forwards ONLY { type, turn-id } to the wrapper's Unix socket.
// Everything else in the payload (last-assistant-message, input-messages —
// i.e. prompt and output content) is deliberately dropped here, before it
// crosses even the local IPC boundary. It must always exit 0 quickly so it
// can never break the wrapped Codex session.

import * as net from "node:net";

const argv = process.argv.slice(2);
const socketPath = argv[0];
const rawPayload = argv[argv.length - 1];

let message: { type: string; "turn-id"?: string };
try {
  const payload = JSON.parse(rawPayload);
  message = { type: String(payload.type ?? "unknown") };
  if (typeof payload["turn-id"] === "string") {
    message["turn-id"] = payload["turn-id"];
  }
} catch {
  message = { type: "unparseable" };
}

if (!socketPath) {
  process.exit(0);
}

const connection = net.connect(socketPath);
connection.on("connect", () => {
  connection.end(JSON.stringify(message) + "\n");
});
connection.on("close", () => process.exit(0));
connection.on("error", () => process.exit(0));

// Never hang Codex if the wrapper is gone.
setTimeout(() => process.exit(0), 2000).unref();

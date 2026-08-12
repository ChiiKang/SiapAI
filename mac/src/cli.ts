#!/usr/bin/env node
// agent-ready CLI — Milestone 1.
//
//   agent-ready run [--name "Auth refactor"] -- codex [codex args…]
//
// Wraps the agent process, detects RUNNING → READY via the Codex adapter, and
// prints transitions locally. No backend is involved in this milestone.

import * as os from "node:os";
import * as path from "node:path";
import { CodexAdapter } from "./adapters/codex";
import { Session } from "./session";

const USAGE = `usage: agent-ready run [--name <display name>] -- <command> [args…]

example: agent-ready run --name "Auth refactor" -- codex`;

function fail(message: string): never {
  process.stderr.write(message + "\n");
  process.exit(2);
}

function main(): void {
  const argv = process.argv.slice(2);
  if (argv[0] !== "run") fail(USAGE);

  let name: string | undefined;
  let command: string | undefined;
  let commandArgs: string[] = [];

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--name") {
      name = argv[++i];
      if (name === undefined) fail(USAGE);
    } else if (arg === "--") {
      command = argv[i + 1];
      commandArgs = argv.slice(i + 2);
      break;
    } else {
      fail(USAGE);
    }
  }

  if (command === undefined) fail(USAGE);

  const agentLabel = path.basename(command);
  const session = new Session(
    name ?? agentLabel,
    os.hostname(),
    agentLabel
  );

  // Milestone 1 ships the Codex adapter only; adapter selection by agent kind
  // arrives with Milestone 1.5.
  const adapter = new CodexAdapter((line) => session.log(line));

  adapter.onReady((info) => session.markReady(info.turnId));
  adapter.onRunning((reason) => session.markRunning(reason));
  adapter.onExit((code) => {
    session.close(code);
    process.exit(code ?? 1);
  });

  session.announceLaunch();
  const agent = adapter.start(command, commandArgs);

  const forward = () => agent.stop();
  process.on("SIGINT", forward);
  process.on("SIGTERM", forward);
}

main();

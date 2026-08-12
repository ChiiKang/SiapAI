#!/usr/bin/env node
// agent-ready CLI.
//
//   agent-ready setup --api-base-url <url> [--machine <name>]
//   agent-ready run [--name "Auth refactor"] [--adapter codex|claude|generic] -- <command> [args…]
//
// Wraps the agent process, detects RUNNING → READY through the selected
// adapter, prints transitions locally, and (when configured) sends events to
// POST /events. Without a config it runs in local-only mode.

import * as os from "node:os";
import * as path from "node:path";
import { AgentAdapter } from "./adapters/adapter";
import { ClaudeCodeAdapter } from "./adapters/claude-code";
import { CodexAdapter } from "./adapters/codex";
import { GenericProcessAdapter } from "./adapters/generic";
import { ApiClient } from "./apiClient";
import { loadConfig, runSetup } from "./config";
import { Session } from "./session";

const USAGE = `usage:
  agent-ready setup --api-base-url <url> [--machine <name>]
  agent-ready run [--name <display name>] [--adapter codex|claude|generic] -- <command> [args…]

examples:
  agent-ready run --name "Auth refactor" -- codex
  agent-ready run --name "Docs pass" -- claude
  agent-ready run --name "Nightly batch" -- python3 batch.py`;

function fail(message: string): never {
  process.stderr.write(message + "\n");
  process.exit(2);
}

// Codex and Claude Code get their hook-based adapters; anything else is a
// run-to-completion program where process exit is the completion signal.
function pickAdapter(
  kindArg: string | undefined,
  commandBase: string,
  logEvent: (line: string) => void
): { adapter: AgentAdapter; agentKind: string } {
  const kind = kindArg ?? inferKind(commandBase);
  switch (kind) {
    case "codex":
      return { adapter: new CodexAdapter(logEvent), agentKind: "Codex" };
    case "claude":
      return {
        adapter: new ClaudeCodeAdapter(logEvent),
        agentKind: "Claude Code",
      };
    case "generic":
      return {
        adapter: new GenericProcessAdapter(logEvent),
        agentKind: commandBase,
      };
    default:
      fail(`unknown adapter "${kind}" (expected codex, claude, or generic)`);
  }
}

function inferKind(commandBase: string): string {
  if (commandBase === "codex") return "codex";
  if (commandBase === "claude") return "claude";
  return "generic";
}

function runCommand(argv: string[]): void {
  let name: string | undefined;
  let adapterArg: string | undefined;
  let command: string | undefined;
  let commandArgs: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--name") {
      name = argv[++i];
      if (name === undefined) fail(USAGE);
    } else if (arg === "--adapter") {
      adapterArg = argv[++i];
      if (adapterArg === undefined) fail(USAGE);
    } else if (arg === "--") {
      command = argv[i + 1];
      commandArgs = argv.slice(i + 2);
      break;
    } else {
      fail(USAGE);
    }
  }

  if (command === undefined) fail(USAGE);

  const commandBase = path.basename(command);
  const config = loadConfig();
  const session = new Session(
    name ?? commandBase,
    config?.machineName ?? os.hostname(),
    commandBase
  );

  const { adapter, agentKind } = pickAdapter(adapterArg, commandBase, (line) =>
    session.log(line)
  );
  const api = config ? new ApiClient(config, session, agentKind) : null;

  session.announceLaunch();
  if (!api) {
    session.announce(
      "local-only mode — no config found; run `agent-ready setup` to send events"
    );
  }

  adapter.onReady((info) => {
    session.markReady(info.turnId);
    api?.sendEvent("READY");
  });
  adapter.onRunning?.((reason) => {
    if (session.markRunning(reason)) {
      api?.sendEvent("RUNNING");
    }
  });
  adapter.onExit(async (code) => {
    if (api) await api.flush();
    session.close(code);
    process.exit(code ?? 1);
  });

  api?.sendEvent("RUNNING");
  const agent = adapter.start(command, commandArgs);

  const forward = () => agent.stop();
  process.on("SIGINT", forward);
  process.on("SIGTERM", forward);
}

function main(): void {
  const argv = process.argv.slice(2);
  if (argv[0] === "setup") {
    runSetup(argv.slice(1));
  } else if (argv[0] === "run") {
    runCommand(argv.slice(1));
  } else {
    fail(USAGE);
  }
}

main();

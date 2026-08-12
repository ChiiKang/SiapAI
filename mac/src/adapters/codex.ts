// CodexAdapter — the only Codex-specific code in the system.
//
// Detection uses Codex's official notification hook: the wrapped process is
// launched with `-c notify=["node", <hook>, <socket>]`, so Codex itself
// invokes our hook once per notification event (documented event:
// agent-turn-complete, fired when the agent finishes a turn). The hook
// forwards { type, turn-id } over a per-session Unix socket.
//
// No polling, no output parsing, no process-exit guessing. The agent's stdio
// is inherited untouched. READY is deduped by turn-id so a repeated hook
// invocation for the same turn emits nothing.

import { spawn } from "node:child_process";
import * as path from "node:path";
import { AgentAdapter, AgentProcess, ReadyInfo } from "./adapter";
import { createHookServer } from "./hook-server";

export class CodexAdapter implements AgentAdapter {
  private readyCallbacks: Array<(info: ReadyInfo) => void> = [];
  private runningCallbacks: Array<(reason: string) => void> = [];
  private exitCallbacks: Array<(code: number | null) => void> = [];
  private seenTurnIds = new Set<string>();

  // Every notify event type received is recorded here (metadata only) so
  // real sessions tell us empirically what Codex emits. See docs/contract.md.
  constructor(private logEvent: (line: string) => void) {}

  onReady(callback: (info: ReadyInfo) => void): void {
    this.readyCallbacks.push(callback);
  }

  onRunning(callback: (reason: string) => void): void {
    this.runningCallbacks.push(callback);
  }

  onExit(callback: (code: number | null) => void): void {
    this.exitCallbacks.push(callback);
  }

  start(command: string, args: string[]): AgentProcess {
    const server = createHookServer(
      (message) => this.handleHookMessage(message),
      () => this.logEvent("hook message unparseable")
    );

    const hookPath = path.join(__dirname, "codex-hook.js");
    // JSON.stringify output is also a valid TOML array of strings, which is
    // what `codex -c key=value` expects on the right-hand side.
    const notifyValue = JSON.stringify([
      process.execPath,
      hookPath,
      server.socketPath,
    ]);

    // The -c override is appended after the user's args so that wrapping
    // works for any command shape (clap accepts options after positionals).
    const child = spawn(command, [...args, "-c", `notify=${notifyValue}`], {
      stdio: "inherit",
    });

    child.on("error", (err) => {
      this.logEvent(`spawn error: ${err.message}`);
      server.close();
      for (const cb of this.exitCallbacks) cb(null);
    });

    child.on("exit", (code) => {
      // Give in-flight hook connections a moment to be received before the
      // socket goes away.
      setTimeout(() => {
        server.close();
        for (const cb of this.exitCallbacks) cb(code);
      }, 100);
    });

    return {
      pid: child.pid,
      stop: () => child.kill(),
    };
  }

  private handleHookMessage(message: Record<string, unknown>): void {
    const type = String(message.type ?? "unknown");
    const turnId =
      typeof message["turn-id"] === "string"
        ? (message["turn-id"] as string)
        : undefined;
    this.logEvent(`notify event type=${type}${turnId ? ` turn=${turnId}` : ""}`);

    if (type === "agent-turn-complete") {
      if (turnId !== undefined) {
        if (this.seenTurnIds.has(turnId)) {
          this.logEvent(`duplicate turn=${turnId} ignored`);
          return;
        }
        this.seenTurnIds.add(turnId);
      }
      for (const cb of this.readyCallbacks) cb({ turnId });
      return;
    }

    if (type === "approval-requested") {
      // Official proof that a turn is in progress.
      for (const cb of this.runningCallbacks) cb("approval requested");
      return;
    }

    // Unknown types are logged above and otherwise ignored — they feed the
    // empirical investigation in docs/contract.md § Known risks.
  }
}

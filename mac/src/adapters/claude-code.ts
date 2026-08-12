// ClaudeCodeAdapter — detection via Claude Code's official hooks, injected
// with --settings so the user's own configuration files are untouched.
//
//   UserPromptSubmit -> RUNNING (official turn-start signal; Claude Code has
//                       one, unlike Codex, so the READY -> RUNNING reset is
//                       fully observed here)
//   Stop             -> READY  (fires when Claude finishes responding)
//
// All other hook events (Notification, SubagentStop, …) are logged for the
// empirical record and otherwise ignored: Notification cannot distinguish
// "waiting for permission" from "idle waiting for input" without reading its
// message text, which would be a heuristic.

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AgentAdapter, AgentProcess, ReadyInfo } from "./adapter";
import { createHookServer } from "./hook-server";

export class ClaudeCodeAdapter implements AgentAdapter {
  private readyCallbacks: Array<(info: ReadyInfo) => void> = [];
  private runningCallbacks: Array<(reason: string) => void> = [];
  private exitCallbacks: Array<(code: number | null) => void> = [];

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

    const hookPath = path.join(__dirname, "claude-hook.js");
    const hookCommand = `"${process.execPath}" "${hookPath}" "${server.socketPath}"`;
    const hookEntry = [{ hooks: [{ type: "command", command: hookCommand }] }];
    const settings = {
      hooks: {
        UserPromptSubmit: hookEntry,
        Stop: hookEntry,
      },
    };

    const settingsDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "agent-ready-claude-")
    );
    const settingsPath = path.join(settingsDir, "settings.json");
    fs.writeFileSync(settingsPath, JSON.stringify(settings));

    const child = spawn(command, [...args, "--settings", settingsPath], {
      stdio: "inherit",
    });

    const cleanup = () => {
      server.close();
      fs.rmSync(settingsDir, { recursive: true, force: true });
    };

    child.on("error", (err) => {
      this.logEvent(`spawn error: ${err.message}`);
      cleanup();
      for (const cb of this.exitCallbacks) cb(null);
    });

    child.on("exit", (code) => {
      setTimeout(() => {
        cleanup();
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
    this.logEvent(`hook event type=${type}`);

    if (type === "Stop") {
      for (const cb of this.readyCallbacks) cb({});
      return;
    }
    if (type === "UserPromptSubmit") {
      for (const cb of this.runningCallbacks) cb("prompt submitted");
      return;
    }
  }
}

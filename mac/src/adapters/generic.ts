// GenericProcessAdapter — for run-to-completion programs (scripts, batch
// jobs, one-shot CLIs) that have no notification hook.
//
// For these programs, process exit IS the completion signal: a script that
// exited is done by definition. This is the one integration mode where
// exit == READY is true, which is why the plan's warning against equating
// the two (aimed at interactive TUIs that stay alive between turns) does not
// apply here. Interactive agents must use a hook-based adapter instead.

import { spawn } from "node:child_process";
import { AgentAdapter, AgentProcess, ReadyInfo } from "./adapter";

export class GenericProcessAdapter implements AgentAdapter {
  private readyCallbacks: Array<(info: ReadyInfo) => void> = [];
  private exitCallbacks: Array<(code: number | null) => void> = [];

  constructor(private logEvent: (line: string) => void) {}

  onReady(callback: (info: ReadyInfo) => void): void {
    this.readyCallbacks.push(callback);
  }

  onExit(callback: (code: number | null) => void): void {
    this.exitCallbacks.push(callback);
  }

  start(command: string, args: string[]): AgentProcess {
    const child = spawn(command, args, { stdio: "inherit" });

    child.on("error", (err) => {
      this.logEvent(`spawn error: ${err.message}`);
      for (const cb of this.exitCallbacks) cb(null);
    });

    child.on("exit", (code, signal) => {
      this.logEvent(
        `process exited code=${code ?? "unknown"}${signal ? ` signal=${signal}` : ""}`
      );
      // One turn per process lifetime: a normal exit is the completion
      // signal. A process killed by a signal (Ctrl-C, SIGTERM) was
      // interrupted, not finished, so it must not report READY.
      if (signal === null) {
        for (const cb of this.readyCallbacks) cb({});
      }
      for (const cb of this.exitCallbacks) cb(code);
    });

    return {
      pid: child.pid,
      stop: () => child.kill(),
    };
  }
}

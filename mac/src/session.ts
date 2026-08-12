// Session identity plus the two-state machine. Prints transitions to stdout
// and appends them to ~/.agent-ready/sessions/<short-id>.log — Codex's TUI
// owns the screen while running, so the log file is what you tail from a
// second terminal.
//
// Log lines contain metadata only: states, timestamps, event types, turn ids.
// Never prompt text, agent output, or file names.

import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type AgentStatus = "RUNNING" | "READY";

function clock(): string {
  return new Date().toTimeString().slice(0, 8);
}

export class Session {
  readonly id = randomUUID();
  readonly shortId = this.id.slice(0, 8);
  status: AgentStatus = "RUNNING";
  private turnCount = 0;
  private readonly logPath: string;

  constructor(
    readonly displayName: string,
    readonly machineName: string,
    readonly agentLabel: string
  ) {
    const home = process.env.AGENT_READY_HOME ?? path.join(os.homedir(), ".agent-ready");
    const dir = path.join(home, "sessions");
    fs.mkdirSync(dir, { recursive: true });
    this.logPath = path.join(dir, `${this.shortId}.log`);
  }

  log(line: string): void {
    fs.appendFileSync(this.logPath, `${new Date().toISOString()} ${line}\n`);
  }

  // Prints to stdout and appends to the session log.
  announce(line: string): void {
    process.stdout.write(line + "\n");
    this.log(line);
  }

  private say(line: string): void {
    this.announce(line);
  }

  announceLaunch(): void {
    this.say(`agent-ready · session ${this.shortId} · "${this.displayName}"`);
    this.say(`machine   ${this.machineName}`);
    this.say(`status    RUNNING   ${clock()}`);
    this.say(`watching for completion signal… (log: ${this.logPath})`);
  }

  markReady(turnId?: string): void {
    this.turnCount += 1;
    const wasReady = this.status === "READY";
    this.status = "READY";
    this.say(`${this.agentLabel} finished its turn`);
    this.say(
      `status    READY     ${clock()}   turn ${this.turnCount}` +
        (turnId ? ` (${turnId})` : "") +
        (wasReady
          ? "   [no RUNNING reset observed since last READY — see docs/contract.md § Known risks]"
          : "")
    );
    if (this.turnCount === 1) {
      this.say(`next turn resets status to RUNNING`);
    }
  }

  // Returns true when this actually changed state (READY -> RUNNING), so the
  // caller knows whether an event should be sent.
  markRunning(reason: string): boolean {
    if (this.status === "RUNNING") return false;
    this.status = "RUNNING";
    this.say(`status    RUNNING   ${clock()}   (${reason} — turn in progress)`);
    return true;
  }

  close(code: number | null): void {
    this.say(
      `${this.agentLabel} exited (code ${code ?? "unknown"}) · session ${this.shortId} closed`
    );
  }
}

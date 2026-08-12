// Adapter interface per plan §4. All agent-specific detection lives behind
// this boundary so it can be replaced without touching anything downstream.

export interface AgentProcess {
  pid: number | undefined;
  stop(): void;
}

export interface ReadyInfo {
  // Adapter-specific turn identifier, when the agent provides one.
  turnId?: string;
}

export interface AgentAdapter {
  start(command: string, args: string[]): AgentProcess;
  onReady(callback: (info: ReadyInfo) => void): void;
  onExit(callback: (code: number | null) => void): void;
  // Optional: official signals proving a turn is in progress (e.g. Codex
  // approval-requested). Lets the wrapper reset READY → RUNNING without
  // heuristics. See docs/contract.md.
  onRunning?(callback: (reason: string) => void): void;
}

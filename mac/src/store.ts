// Current state for every session, in one JSON file — the local stand-in for
// the Postgres `agents` table. Latest state only, no event history, same as
// the cloud path.

import * as fs from "node:fs";
import * as path from "node:path";
import { configHome } from "./config";

export interface StoredSession {
  sessionId: string;
  displayName: string;
  machineName: string;
  agentKind: string;
  status: "RUNNING" | "READY";
  startedAt: string;
  updatedAt: string;
  occurredAt: string;
  lastEventId: string;
}

export class Store {
  private sessions = new Map<string, StoredSession>();

  constructor(private filePath = path.join(configHome(), "state.json")) {
    this.load();
  }

  private load(): void {
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      for (const session of raw.sessions ?? []) {
        this.sessions.set(session.sessionId, session);
      }
    } catch {
      // No state yet (or unreadable): start empty. State is disposable —
      // the next event from any wrapper re-creates its session row.
    }
  }

  // Written via a temp file + rename so a crash mid-write cannot leave a
  // truncated state file behind.
  private save(): void {
    const payload = JSON.stringify(
      { sessions: [...this.sessions.values()] },
      null,
      2
    );
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tempPath, payload + "\n", { mode: 0o600 });
    fs.renameSync(tempPath, this.filePath);
  }

  get(sessionId: string): StoredSession | undefined {
    return this.sessions.get(sessionId);
  }

  put(session: StoredSession): void {
    this.sessions.set(session.sessionId, session);
    this.save();
  }

  delete(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.save();
  }

  // Most recently updated first; the app applies its own display sort.
  list(): StoredSession[] {
    return [...this.sessions.values()].sort((a, b) =>
      a.updatedAt < b.updatedAt ? 1 : -1
    );
  }
}

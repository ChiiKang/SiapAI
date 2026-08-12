// Per-session Unix socket server that receives one-line JSON messages from
// the tiny hook programs the wrapped agent invokes. Shared by the Codex and
// Claude Code adapters.

import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";

export interface HookServer {
  socketPath: string;
  close(): void;
}

export function createHookServer(
  onMessage: (message: Record<string, unknown>) => void,
  onBadMessage: () => void
): HookServer {
  const socketDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-ready-"));
  const socketPath = path.join(socketDir, "hook.sock");

  const server = net.createServer((connection) => {
    let buffered = "";
    connection.on("data", (chunk) => {
      buffered += chunk.toString("utf8");
    });
    connection.on("end", () => {
      for (const line of buffered.split("\n")) {
        if (line.trim() === "") continue;
        try {
          onMessage(JSON.parse(line));
        } catch {
          onBadMessage();
        }
      }
    });
    connection.on("error", () => {});
  });
  server.listen(socketPath);

  return {
    socketPath,
    close() {
      server.close();
      fs.rmSync(socketDir, { recursive: true, force: true });
    },
  };
}

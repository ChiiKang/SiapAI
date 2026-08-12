// Local configuration per plan §4: ~/.agent-ready/config.json with
// { apiBaseUrl, deviceKey, machineName }. Created by `agent-ready setup`.
// Without a config the wrapper runs in local-only mode (Milestone 1
// behavior): transitions print but no events are sent.

import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface Config {
  apiBaseUrl: string;
  deviceKey: string;
  machineName: string;
  // Local-server settings; absent when pointing at the cloud backend.
  serverPort?: number;
  notify?: "mac" | "telegram" | "none";
  telegramBotToken?: string;
  telegramChatId?: string;
}

export const DEFAULT_PORT = 8787;

export function configHome(): string {
  return process.env.AGENT_READY_HOME ?? path.join(os.homedir(), ".agent-ready");
}

function configPath(): string {
  return path.join(configHome(), "config.json");
}

export function loadConfig(): Config | null {
  try {
    const raw = fs.readFileSync(configPath(), "utf8");
    const parsed = JSON.parse(raw);
    if (
      typeof parsed.apiBaseUrl === "string" &&
      typeof parsed.deviceKey === "string" &&
      typeof parsed.machineName === "string"
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

const SETUP_USAGE = `usage:
  agent-ready setup --local [--port <n>] [--machine <name>] [--notify mac|telegram|none]
  agent-ready setup --api-base-url https://<project>.supabase.co/functions/v1 [--machine <name>]

--local runs everything on this Mac: no account, no deployment, no internet.
Re-running setup rotates the device key.`;

export function runSetup(args: string[]): void {
  let apiBaseUrl: string | undefined;
  let machineName: string | undefined;
  let local = false;
  let port = DEFAULT_PORT;
  let notify: Config["notify"] | undefined;
  let telegramBotToken: string | undefined;
  let telegramChatId: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--api-base-url") apiBaseUrl = args[++i];
    else if (arg === "--machine") machineName = args[++i];
    else if (arg === "--local") local = true;
    else if (arg === "--port") port = Number(args[++i]);
    else if (arg === "--notify") notify = args[++i] as Config["notify"];
    else if (arg === "--telegram-bot-token") telegramBotToken = args[++i];
    else if (arg === "--telegram-chat-id") telegramChatId = args[++i];
  }

  if (!local && !apiBaseUrl) {
    process.stderr.write(SETUP_USAGE + "\n");
    process.exit(2);
  }
  if (local && !Number.isInteger(port)) {
    process.stderr.write("--port must be a whole number\n");
    process.exit(2);
  }
  if (notify && !["mac", "telegram", "none"].includes(notify)) {
    process.stderr.write("--notify must be mac, telegram, or none\n");
    process.exit(2);
  }

  const existing = loadConfig();
  const config: Config = {
    apiBaseUrl: local
      ? `http://127.0.0.1:${port}`
      : apiBaseUrl!.replace(/\/$/, ""),
    deviceKey: `dk_${randomBytes(24).toString("hex")}`,
    machineName: machineName ?? existing?.machineName ?? os.hostname(),
  };
  if (local) {
    config.serverPort = port;
    config.notify = notify ?? "mac";
    if (telegramBotToken) config.telegramBotToken = telegramBotToken;
    if (telegramChatId) config.telegramChatId = telegramChatId;
  }

  fs.mkdirSync(configHome(), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2) + "\n", {
    mode: 0o600,
  });

  process.stdout.write(`config written to ${configPath()}\n`);
  process.stdout.write(`machine    ${config.machineName}\n`);
  process.stdout.write(`device key ${config.deviceKey}\n`);

  if (local) {
    process.stdout.write(`notify     ${config.notify}\n`);
    process.stdout.write(
      `\nStart the local server:  agent-ready serve\n` +
        `Then run agents:         agent-ready run --name "Auth refactor" -- codex\n` +
        `\nFor the iPhone app, use the LAN address printed by \`agent-ready serve\`\n` +
        `and the device key above. Re-running setup rotates the key.\n`
    );
  } else {
    process.stdout.write(
      "\nSet this key as the DEVICE_KEY secret on the Supabase project\n" +
        "(supabase secrets set DEVICE_KEY=<key>) and paste it into the iOS app.\n" +
        "Re-running setup generates a NEW key (rotation): update both places.\n"
    );
  }
}

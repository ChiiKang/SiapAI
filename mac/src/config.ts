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
}

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

export function runSetup(args: string[]): void {
  let apiBaseUrl: string | undefined;
  let machineName: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--api-base-url") apiBaseUrl = args[++i];
    else if (args[i] === "--machine") machineName = args[++i];
  }

  if (!apiBaseUrl) {
    process.stderr.write(
      "usage: agent-ready setup --api-base-url https://<project>.supabase.co/functions/v1 [--machine <name>]\n" +
        "Re-running setup rotates the device key.\n"
    );
    process.exit(2);
  }

  const existing = loadConfig();
  const config: Config = {
    apiBaseUrl: apiBaseUrl.replace(/\/$/, ""),
    deviceKey: `dk_${randomBytes(24).toString("hex")}`,
    machineName: machineName ?? existing?.machineName ?? os.hostname(),
  };

  fs.mkdirSync(configHome(), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2) + "\n", {
    mode: 0o600,
  });

  process.stdout.write(`config written to ${configPath()}\n`);
  process.stdout.write(`machine    ${config.machineName}\n`);
  process.stdout.write(`device key ${config.deviceKey}\n`);
  process.stdout.write(
    "\nSet this key as the DEVICE_KEY secret on the Supabase project\n" +
      "(supabase secrets set DEVICE_KEY=<key>) and paste it into the iOS app.\n" +
      "Re-running setup generates a NEW key (rotation): update both places.\n"
  );
}

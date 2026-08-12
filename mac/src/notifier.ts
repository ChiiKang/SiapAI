// Notification delivery for the local server, behind the same provider
// interface the cloud path uses (plan §6), so swapping in APNs later touches
// only this file.
//
//   mac       macOS Notification Center — instant, zero accounts, no internet.
//             Perfect while you are at or near the Mac.
//   telegram  reaches your phone anywhere; needs a free bot token, no Apple
//             membership.
//   none      state only, no notifications.

import { execFile } from "node:child_process";
import { AgentEvent, notificationText } from "./eventLogic";

export interface NotificationProvider {
  sendReadyNotification(event: AgentEvent): Promise<void>;
}

// AppleScript string literals escape backslash and double quote only.
function escapeAppleScript(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export class MacNotificationProvider implements NotificationProvider {
  sendReadyNotification(event: AgentEvent): Promise<void> {
    const { title, body } = notificationText(event);
    const script =
      `display notification "${escapeAppleScript(body)}" ` +
      `with title "${escapeAppleScript(title)}" sound name "Glass"`;
    return new Promise((resolve, reject) => {
      execFile("osascript", ["-e", script], (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

export class TelegramNotificationProvider implements NotificationProvider {
  constructor(
    private botToken: string,
    private chatId: string
  ) {}

  async sendReadyNotification(event: AgentEvent): Promise<void> {
    const { title, body } = notificationText(event);
    const response = await fetch(
      `https://api.telegram.org/bot${this.botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: this.chatId, text: `${title}\n${body}` }),
        signal: AbortSignal.timeout(10_000),
      }
    );
    if (!response.ok) {
      throw new Error(`telegram sendMessage failed: ${response.status}`);
    }
  }
}

export class NoNotificationProvider implements NotificationProvider {
  async sendReadyNotification(): Promise<void> {}
}

export function makeProvider(config: {
  notify?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
}): NotificationProvider {
  switch (config.notify) {
    case "telegram":
      if (config.telegramBotToken && config.telegramChatId) {
        return new TelegramNotificationProvider(
          config.telegramBotToken,
          config.telegramChatId
        );
      }
      return new NoNotificationProvider();
    case "none":
      return new NoNotificationProvider();
    default:
      return new MacNotificationProvider();
  }
}

// Notification delivery behind a provider interface (plan §6) so the
// temporary Telegram path can be swapped for APNs in Milestone 6 without
// touching the event handler.

import { AgentEvent, notificationText } from "./logic.ts";

export interface NotificationProvider {
  sendReadyNotification(event: AgentEvent): Promise<void>;
}

// Phase A: Telegram bot — a zero-App-Store path for the personal MVP.
// Requires secrets TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.
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
        body: JSON.stringify({
          chat_id: this.chatId,
          text: `${title}\n${body}`,
        }),
      }
    );
    if (!response.ok) {
      throw new Error(`telegram sendMessage failed: ${response.status}`);
    }
  }
}

// Used when Telegram secrets are not configured yet: the event path still
// works end-to-end and the would-be notification is visible in function logs.
export class LogOnlyNotificationProvider implements NotificationProvider {
  // deno-lint-ignore require-await
  async sendReadyNotification(event: AgentEvent): Promise<void> {
    const { title, body } = notificationText(event);
    console.log(`[notify] ${title} — ${body}`);
  }
}

export function providerFromEnv(): NotificationProvider {
  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chatId = Deno.env.get("TELEGRAM_CHAT_ID");
  if (botToken && chatId) {
    return new TelegramNotificationProvider(botToken, chatId);
  }
  return new LogOnlyNotificationProvider();
}

// Sends state-transition events to POST /events with bounded exponential
// retry (plan §12: bound retries; wireframe C: "retry 1/5 in 2s … 5 max").
//
// Events for one session are sent strictly in order through a promise chain,
// and each event keeps its eventId across retries so the backend can
// deduplicate. There is no persistent queue — bounded retry plus database
// idempotency is the whole reliability story by design (guardrails §11).

import { randomUUID } from "node:crypto";
import { Config } from "./config";
import { Session } from "./session";

const MAX_RETRIES = 5;
const RETRY_BASE_MS = Number(process.env.AGENT_READY_RETRY_BASE_MS ?? 2000);

function clock(): string {
  return new Date().toTimeString().slice(0, 8);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ApiClient {
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private config: Config,
    private session: Session,
    private agentKind: string
  ) {}

  // Queues an event; returns immediately. Ordering is preserved per session.
  sendEvent(status: "RUNNING" | "READY"): void {
    const event = {
      eventId: randomUUID(),
      sessionId: this.session.id,
      displayName: this.session.displayName,
      machineName: this.config.machineName,
      agentKind: this.agentKind,
      status,
      occurredAt: new Date().toISOString(),
    };
    // The catch keeps one unexpected failure from rejecting the chain and
    // taking every later event (and the process) down with it.
    this.chain = this.chain
      .then(() => this.deliver(event))
      .catch((err) => this.session.log(`event delivery error: ${err}`));
  }

  // Resolves when every queued event has been delivered or dropped.
  flush(): Promise<void> {
    return this.chain;
  }

  private async deliver(event: {
    eventId: string;
    status: string;
    [key: string]: string;
  }): Promise<void> {
    const shortId = event.eventId.slice(0, 8);
    let retriedOffline = false;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(`${this.config.apiBaseUrl}/events`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.config.deviceKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(event),
          signal: AbortSignal.timeout(10_000),
        });

        if (response.ok) {
          const body = (await response.json().catch(() => ({}))) as {
            notified?: boolean;
          };
          if (retriedOffline) {
            this.session.announce(
              `delivered ${clock()} (same eventId ${shortId}…, no duplicate notification)`
            );
          } else {
            this.session.announce(
              `event     ${shortId}…  (accepted ${response.status})`
            );
          }
          if (event.status === "READY" && body.notified) {
            this.session.announce("notify    queued → phone");
          }
          return;
        }

        if (response.status >= 400 && response.status < 500) {
          // Configuration problem (bad key, bad payload): retrying cannot fix it.
          this.session.announce(
            `event     ${shortId}…  rejected (${response.status}) — check device key / setup`
          );
          return;
        }
        // 5xx falls through to retry below.
      } catch {
        // Network failure falls through to retry below.
      }

      if (attempt === MAX_RETRIES) break;
      const delayMs = RETRY_BASE_MS * 2 ** attempt;
      retriedOffline = true;
      this.session.announce(
        `network unreachable — retry ${attempt + 1}/${MAX_RETRIES} in ${
          delayMs / 1000
        }s`
      );
      await sleep(delayMs);
    }

    this.session.announce(
      `event     ${shortId}…  dropped after ${MAX_RETRIES} retries — backend state may lag until the next event`
    );
  }
}

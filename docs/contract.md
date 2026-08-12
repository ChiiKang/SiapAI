# Agent Ready — Contract (Milestone 0)

This is the one page every surface (Mac CLI, Supabase backend, iOS app) is built
against. Source of truth for scope is `Agent_Ready_MVP_Implementation_Plan (1).docx`;
this file restates the contract and records decisions made on top of it.

## States

Exactly two product states exist. The CLI may only ever send these two.

| State | Meaning | User action |
| --- | --- | --- |
| `RUNNING` | Agent is actively working on its current turn. | None. |
| `READY` | Agent finished the current turn; human attention may be useful. Does **not** necessarily mean the process exited. | Notification; check when convenient. |

`STALE` is a **derived display state** computed on the iOS client from
`updated_at` (RUNNING with no event for 30 minutes). It is never stored and the
CLI must never send it.

## Transition and notification rule

- CLI sends `RUNNING` at launch, `READY` on the adapter's completion signal,
  `RUNNING` again when the next turn is observed.
- The backend notifies **only** when the stored status was `RUNNING` and the
  incoming status is `READY`.
- A repeated `READY`, a retried event with the same `eventId`, or an app
  refresh must produce **no** notification.
- `STALE` never notifies.

## Event contract — `POST /events` (implemented in Milestone 2)

```
POST /events
Authorization: Bearer <device-key>
Content-Type: application/json

{
  "eventId":     "uuid",                   // unique per event; retries reuse it
  "sessionId":   "uuid",                   // unique per wrapped agent session
  "displayName": "Auth refactor",
  "machineName": "MacBook Pro",
  "agentKind":   "Codex",                  // optional; notification body copy;
                                           // defaults to "agent"
  "status":      "RUNNING" | "READY",
  "occurredAt":  "2026-08-12T12:30:00Z"    // generated on the Mac
}
```

Server behavior: validate fields and allowed status values; reject unknown
device keys; use `eventId` for idempotency; upsert the session row; notify
exactly once on RUNNING → READY; return 200/202 quickly.

Response: `{ "ok": true, "duplicate": bool, "notified": bool }`.

### Read/delete endpoints — `/agents` (for the iOS app)

Same `Authorization: Bearer <device-key>` header.

```
GET    /agents                     -> [{ sessionId, displayName, machineName,
                                         agentKind, status, startedAt, updatedAt }]
DELETE /agents?session_id=<uuid>   -> { "ok": true }    (stale-row swipe)
```

This is the plan §12 "narrow read endpoint": the iOS app never holds a
database credential, and the service-role key never leaves the Edge
Functions.

### Database schema (`agents`, one row per session)

```
session_id     uuid primary key
display_name   text not null
machine_name   text not null
status         text check in ('RUNNING', 'READY')
started_at     timestamptz
updated_at     timestamptz not null
last_event_id  uuid not null
```

No event-history table in V1.

## Adapters

Detection is agent-specific and lives entirely behind:

```ts
interface AgentAdapter {
  start(command, args): AgentProcess
  onReady(callback): void
  onExit(callback): void
  onRunning?(callback): void   // optional: official "turn in progress" signals
}
```

`onRunning` is a small deliberate extension of the plan's interface: it carries
official mid-session signals (e.g. Codex `approval-requested`) that prove a
turn is in progress, allowing the READY → RUNNING reset without heuristics. It
introduces no new product state.

| Agent | Adapter | Turn start (→ RUNNING) | Completion (→ READY) |
| --- | --- | --- | --- |
| Codex | `CodexAdapter` | `approval-requested` only (no official turn-start event — see Known risks) | `notify` hook, `agent-turn-complete`, deduped by `turn-id` |
| Claude Code | `ClaudeCodeAdapter` | `UserPromptSubmit` hook (a real turn-start signal) | `Stop` hook |
| Any batch script | `GenericProcessAdapter` | launch | Process exit (legitimate for run-to-completion programs, unlike interactive TUIs) |

Adapter selection: inferred from the command basename (`codex`, `claude`,
anything else → generic), overridable with `--adapter`.

## Privacy

The following never leave the Mac, are never logged, and never cross even the
local hook IPC: prompts, terminal output, file names, source code, repository
contents, `last-assistant-message`, `input-messages`. The Codex hook forwards
only `{ type, turn-id }`.

## Known risks (Milestone 1, to be resolved empirically)

1. **No official turn-start signal in Codex interactive mode.** `notify` fires
   on `agent-turn-complete` (and possibly `approval-requested`), but nothing
   fires when the user submits the next prompt. Consequence: after READY, the
   wrapper cannot always observe the reset to RUNNING; a second completed turn
   may arrive as READY → READY. Locally this is printed with an explicit
   marker. Per the guardrails we do **not** infer turn start from stdin or
   terminal output. The session log records every notify event type received
   from real Codex sessions; if the gap persists, it is a decision point
   before Milestone 2 (it affects whether turn 2+ can notify under the
   RUNNING → READY rule).
2. **`-c notify=[...]` overrides any user-configured notify program** for the
   wrapped session only. Acceptable for MVP; chaining can be added later.

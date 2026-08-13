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

## Two backends, one contract

The contract below has two interchangeable implementations. Which one is in
use is decided by `apiBaseUrl` in `~/.agent-ready/config.json` — nothing else
in the system knows the difference.

| | Local (`agent-ready serve`) | Cloud (Supabase) |
| --- | --- | --- |
| Setup | `agent-ready setup --local` | project + deploy + secrets |
| State | `~/.agent-ready/state.json` | Postgres `agents` table |
| Notifications | macOS Notification Center, or Telegram | Telegram |
| Phone reach | same Wi-Fi | anywhere |
| Accounts needed | none | Supabase (free) |

Behavior is identical and kept that way by `mac/tests/scenarios.json`, which
is executed against **both** implementations (`mac/tests/server.test.js` over
real HTTP, `supabase/functions/events/scenarios_test.ts` over the edge
logic). The pure logic is duplicated on purpose — the runtimes differ — and
those tests are what stop the copies from drifting.

## Event contract — `POST /events`

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
device keys; use `eventId` for idempotency; ignore events whose `occurredAt`
predates the stored row's (a delayed delivery must not rewind the state and
let the next READY notify twice); upsert the session row; notify exactly once
on RUNNING → READY; return 200/202 quickly.

Response: `{ "ok": true, "duplicate": bool, "notified": bool }`, or
`{ "ok": true, "stale": true, "notified": false }` for an out-of-order event.

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
| Codex | `CodexAdapter` | a previously unseen `turn-id` on `agent-turn-complete` (Codex has no turn-start event — see Known risks) | `notify` hook, `agent-turn-complete`, deduped by `turn-id` |
| Claude Code | `ClaudeCodeAdapter` | `UserPromptSubmit` hook (a real turn-start signal) | `Stop` hook |
| Any batch script | `GenericProcessAdapter` | launch | Process exit (legitimate for run-to-completion programs, unlike interactive TUIs) |

Adapter selection: inferred from the command basename (`codex`, `claude`,
anything else → generic), overridable with `--adapter`.

## Privacy

The following never leave the Mac, are never logged, and never cross even the
local hook IPC: prompts, terminal output, file names, source code, repository
contents, `last-assistant-message`, `input-messages`. The Codex hook forwards
only `{ type, turn-id }`.

## Known risks

1. **No official turn-start signal in Codex interactive mode — resolved.**
   `notify` fires on `agent-turn-complete` and nothing fires when the user
   submits the next prompt, so after READY there is no event that resets the
   session to RUNNING. Measured against real Codex 0.147 (docs/handover.md
   § 5): three completed turns produced three `agent-turn-complete` events
   and exactly one notification. `approval-requested` was never emitted at
   all.

   Resolution: a completion carrying a `turn-id` the adapter has never seen
   is itself official evidence that a further turn ran, and therefore that
   the session left READY. `CodexAdapter` reports RUNNING at that moment,
   immediately before the new READY, so RUNNING → READY happens once per
   distinct completed turn. This stays inside Codex's own signals — no
   polling, no output parsing, no inference from stdin.

   The cost is that the RUNNING for turn *n* is reported when turn *n*
   finishes rather than when it starts, so a Codex session shows READY while
   a later turn is actually in progress. That is invisible in the
   notification path (which only cares about the transition) but it does mean
   the iOS list can briefly read READY for a Codex session that is working.
   Claude Code is unaffected: `UserPromptSubmit` is a real turn-start signal
   and its sessions cycle correctly in real time.

2. **Codex does have a hooks system** (`~/.codex/hooks.json`:
   `UserPromptSubmit`, `Stop`, `PreToolUse`, …) which would give a true
   turn-start signal. It is not used, because a hook injected per-invocation
   with `-c` is silently ignored unless Codex is launched with
   `--dangerously-bypass-hook-trust`, which un-gates every other untrusted
   hook for that run. Worth revisiting if Codex gains a scoped way to supply
   a trusted hook for one invocation.

3. **`-c notify=[...]` overrides any user-configured notify program** for the
   wrapped session only. Acceptable for MVP; chaining can be added later.

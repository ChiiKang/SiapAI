# Agent Ready

Know the moment a local coding agent stops working and wants you. Two states
only — RUNNING and READY — one event, one notification.

A developer starts coding agents (Codex first) in terminals on a Mac, walks
away, and gets a phone notification on each RUNNING → READY transition. One
iOS screen shows the current state of every monitored session.

## Repository layout

```
mac/        agent-ready CLI (TypeScript/Node) — wraps the agent, detects READY
supabase/   Edge Function + agents table            (Milestone 2)
ios/        SwiftUI app                             (Milestone 4)
docs/       contract.md — states, event contract, adapter table, known risks
```

## Status

- [x] **Milestone 0 — contract** (`docs/contract.md`)
- [x] **Milestone 1 — prove READY detection locally.** CLI wrapper + Codex
  adapter print RUNNING/READY transitions to stdout and a session log. No
  backend involved.
- [ ] Milestone 1.5 — Claude Code + generic process adapters
- [ ] Milestone 2 — Supabase `POST /events` + `agents` table
- [ ] Milestone 3 — phone notification on RUNNING → READY
- [ ] Milestone 4 — iOS status screen (SwiftUI)
- [ ] Milestone 5 — hardening (bounded retries, offline queue)

## Milestone 1: run the proof

Automated (no real Codex needed — uses a behavior-faithful fake):

```
cd mac
npm install
npm test
```

Manual proof on a Mac with Codex installed (the real acceptance test):

```
cd mac && npm install && npm run build && npm link
agent-ready run --name "Auth refactor" -- codex
```

Codex runs normally and owns the terminal. From a second terminal:

```
tail -f ~/.agent-ready/sessions/<short-session-id>.log
```

Run two or three real turns. Pass criteria:

- exactly **one `READY` per completed turn** — none mid-turn, none duplicated;
- the log records every notify event type Codex sent (this tells us whether
  `approval-requested` fires and whether any turn-start signal exists — see
  `docs/contract.md` § Known risks);
- no prompt text, output text, or file names anywhere in the log.

## How detection works (and what it never does)

The wrapper launches Codex with its official notification hook:
`codex -c 'notify=["node", <hook>, <socket>]'`. Codex itself invokes the hook
once per `agent-turn-complete`; the hook forwards only `{ type, turn-id }`
over a local Unix socket to the wrapper, which dedupes by `turn-id` and prints
the transition. No polling, no output parsing, no process-exit guessing, and
the agent's own stdio passes through untouched.

Privacy: no prompts, terminal output, file names, or source code ever leave
the Mac — they are not even read by the wrapper.

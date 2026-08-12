# Agent Ready

Know the moment a local coding agent stops working and wants you. Two states
only — RUNNING and READY — one event, one notification.

A developer starts coding agents (Codex, Claude Code, or any script) in
terminals on a Mac, walks away, and gets a phone notification on each
RUNNING → READY transition. One iOS screen shows the current state of every
monitored session.

## Repository layout

```
mac/        agent-ready CLI (TypeScript/Node, zero runtime deps)
supabase/   POST /events + GET/DELETE /agents Edge Functions, agents table
ios/        SwiftUI app — on branch claude/agent-ready-ios
scripts/    test-backend.sh — curl integration test for the deployed backend
docs/       contract.md (states + event contract) · testing.md (how to test everything)
.claude/    commands/go.md — /go prompt for the next agent session
```

## Status

- [x] **Milestone 0 — contract** (`docs/contract.md`)
- [x] **Milestone 1 — READY detection locally** (Codex `notify` hook; 5 tests)
      — *pending: owner's manual run against real Codex, see docs/testing.md §3*
- [x] **Milestone 1.5 — more adapters**: Claude Code (`UserPromptSubmit`/`Stop`
      hooks), generic process (exit = READY for batch jobs)
- [x] **Milestone 2 — backend event path**: `agents` table, `POST /events`
      with device-key auth + eventId idempotency; CLI sends events
- [x] **Milestone 3 — phone notification**: Telegram provider behind a
      provider interface, fired only on RUNNING → READY
      — *pending: owner creates the bot + sets secrets, see docs/testing.md §4*
- [x] **Milestone 4 — iOS status screen** (branch `claude/agent-ready-ios`)
      — *pending: owner builds/runs via Xcode, see ios/README.md*
- [x] **Milestone 5 — hardening**: bounded exponential retry (5 max, same
      eventId), 4xx no-retry, graceful local-only mode, structured logs
- [ ] Milestone 6 — native APNs push (after Apple Developer enrollment)

All code milestones are implemented and tested: **21 Node tests** (CLI,
adapters, retry/idempotency semantics, five concurrent sessions, privacy),
**9 Deno tests** (backend validation, notify rule, and a cross-surface
contract test replaying the CLI's real payloads), and an **Xcode test target**
(Cmd-U) for the iOS display logic. What remains is deployment + on-device
verification, which needs the owner's accounts and hardware:
**`docs/testing.md` is the step-by-step guide.**

## Quick start

```bash
# 1. CLI on the Mac
cd mac && npm install && npm run build && npm link

# 2. Try it locally, no backend at all (Milestone 1 behavior)
agent-ready run --name "Auth refactor" -- codex
agent-ready run --name "Docs pass"     -- claude
agent-ready run --name "Nightly job"   -- python3 batch.py

# 3. Deploy backend + configure (docs/testing.md §4)
supabase db push && supabase functions deploy events && supabase functions deploy agents
agent-ready setup --api-base-url https://<ref>.supabase.co/functions/v1 --machine "MacBook Pro"
supabase secrets set DEVICE_KEY=dk_…   # printed by setup
# optional Telegram secrets for notifications — docs/testing.md §4

# 4. iOS app (branch claude/agent-ready-ios): ios/README.md
```

## How detection works (and what it never does)

Each agent gets an adapter that listens for the agent's **official**
completion signal — Codex's `notify` hook, Claude Code's `Stop` hook, or
process exit for run-to-completion scripts. Hooks forward only
`{type, turn-id}` over a local Unix socket. No polling, no output parsing,
no exit-guessing for interactive agents, and the agent's own stdio passes
through untouched.

Privacy: no prompts, terminal output, file names, or source code ever leave
the Mac — they are not even read by the wrapper.

## For the next agent session

Type `/go` (the prompt lives in `.claude/commands/go.md`). It reorients from
the docs, runs the test suites, and continues from whatever state the
checklist above shows.

# Agent Ready

Know the moment a local coding agent stops working and wants you. Two states
only — RUNNING and READY — one event, one notification.

Start agents (Codex, Claude Code, or any script) in terminals on your Mac,
walk away, and get notified when one finishes its turn. One iOS screen shows
the current state of every monitored session.

**It runs entirely on your Mac.** No account, no deployment, no internet —
`agent-ready serve` is the whole backend. The Supabase path exists for later,
when you want notifications away from home; the same contract serves both, so
switching is one line of config.

## Repository layout

```
mac/        agent-ready CLI + local server (TypeScript/Node, zero runtime deps)
supabase/   optional cloud backend: POST /events + GET/DELETE /agents
ios/        SwiftUI app — on branch claude/agent-ready-ios
scripts/    test-backend.sh — curl integration test for a deployed backend
docs/       contract.md (states + event contract) · testing.md (how to test everything)
.claude/    commands/go.md, commands/goal.md — prompts for the next session
```

## Quick start — fully local, about five minutes

```bash
cd mac && npm install && npm run build && npm link

agent-ready setup --local --machine "MacBook Pro"   # prints your device key
agent-ready serve                                    # leave running; prints a LAN URL

# in other terminals — as many as you like:
agent-ready run --name "Auth refactor" -- codex
agent-ready run --name "Docs pass"     -- claude
agent-ready run --name "Nightly job"   -- python3 batch.py
```

Each completed turn raises a macOS notification and updates the session list.
`--notify telegram` (with `--telegram-bot-token` / `--telegram-chat-id`)
sends to your phone instead, still with no Apple membership.

For the iPhone app, point it at the LAN URL `serve` prints plus the device
key: branch `claude/agent-ready-ios`, see `ios/README.md`.

## Status

- [x] **Milestone 0 — contract** (`docs/contract.md`)
- [x] **Milestone 1 — READY detection locally** (Codex `notify` hook)
      — *pending: your manual run against real Codex, `docs/testing.md` §3*
- [x] **Milestone 1.5 — more adapters**: Claude Code (`UserPromptSubmit`/`Stop`
      hooks), generic process (exit = READY for batch jobs)
- [x] **Milestone 2 — event path**: local server (`agent-ready serve`) and the
      optional Supabase backend, both with device-key auth, `eventId`
      idempotency and out-of-order protection
- [x] **Milestone 3 — notification**: macOS Notification Center locally,
      Telegram for away-from-desk, behind one provider interface
- [x] **Milestone 4 — iOS status screen** (branch `claude/agent-ready-ios`)
      — *pending: your Xcode build, `ios/README.md`*
- [x] **Milestone 5 — hardening**: bounded exponential retry (5 max, same
      eventId), 4xx no-retry, atomic state writes, clean port-conflict and
      offline behavior
- [ ] Milestone 6 — native APNs push (only if this proves itself worth the
      Apple Developer enrollment)

Tested with **35 Node tests**, **17 Deno tests**, and an **Xcode test target**
(Cmd-U). The behavioral contract lives in `mac/tests/scenarios.json` and runs
against both backends, so they cannot drift apart.

## How detection works (and what it never does)

Each agent gets an adapter that listens for that agent's **official**
completion signal — Codex's `notify` hook, Claude Code's `Stop` hook, or
process exit for run-to-completion scripts. Hooks forward only
`{type, turn-id}` over a local Unix socket. No polling, no output parsing, no
exit-guessing for interactive agents, and the agent's own stdio passes through
untouched.

Privacy: no prompts, terminal output, file names, or source code ever leave
your Mac — they are not even read by the wrapper. In local mode nothing
leaves the machine at all.

## For the next agent session

`/go` continues the build from wherever it stands; `/goal` runs the full
pre-ship verification sweep. Both live in `.claude/commands/`.

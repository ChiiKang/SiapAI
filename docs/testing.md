# Agent Ready — How it works & how to test it

The handoff document. Written for the owner and for the next agent who picks
this repository up. Read `docs/contract.md` first (the states and the event
contract), then this file. Scope and guardrails come from
`Agent_Ready_MVP_Implementation_Plan (1).docx` in the design bundle.

## 1. How the system works (three surfaces, one contract)

```
Mac terminal                        Supabase                      iPhone
agent-ready run -- codex            POST /events                  Telegram notification (V1)
  └─ adapter detects READY   ───►     └─ upsert agents row  ───►  AgentReady app reads GET /agents
```

1. **CLI (`mac/`)** wraps the agent process. An adapter detects turn
   completion from the agent's *official* signal — never from polling, output
   parsing, or (for interactive agents) process exit:
   - **Codex**: launched with `-c notify=[…]`; Codex invokes our hook once per
     `agent-turn-complete`. Deduped by `turn-id`.
   - **Claude Code**: launched with `--settings` injecting `UserPromptSubmit`
     (→ RUNNING) and `Stop` (→ READY) hooks.
   - **Generic** (any script/batch job): process exit *is* completion.
   The hook programs forward only `{type, turn-id}` over a local Unix socket;
   prompt/output content is dropped before it crosses even local IPC.
2. **CLI → backend**: on each transition the CLI POSTs the event (see
   contract) with a fresh `eventId`, retrying up to 5 times with exponential
   backoff (2s→32s), *reusing the same `eventId`* so retries can never
   double-notify. No config file → local-only mode (prints transitions,
   sends nothing).
3. **Backend (`supabase/`)**: `events` function authenticates the device key,
   validates, dedupes by `eventId`, upserts the one `agents` row per session,
   and calls the notification provider **only** when stored status was
   RUNNING and incoming is READY. `agents` function serves GET (list) and
   DELETE (stale-row swipe) to the iOS app.
4. **Notification (V1)**: Telegram bot (provider interface `notify.ts`;
   swap for APNs in Milestone 6 without touching the event handler).
5. **iOS app (`ios/`, branch `claude/agent-ready-ios`)**: one SwiftUI list —
   READY first, then RUNNING, then STALE (derived on the client: RUNNING with
   no event for 30 min). Refresh on appear/foreground/pull. No timers, no
   sockets, no background polling.

## 2. Prerequisites for a full end-to-end test

- Mac with Node 20+, and Codex and/or Claude Code installed.
- A Supabase project (free tier fine): https://supabase.com/dashboard
- A Telegram account (for V1 notifications).
- Xcode 15+ (for the iOS app; optional until Milestone 4 testing).

## 3. Component tests (no deployment needed)

### CLI — automated (already green in CI-less form)

```bash
cd mac && npm install && npm test          # 21 tests
```

Covers: one READY per turn, `turn-id` dedupe, approval reset, exit≠READY for
Codex, Claude Stop/UserPromptSubmit mapping, generic exit=READY, interrupted
process reports no READY, contract fields on the wire, same-`eventId`
retries, bounded retry (5 max), 4xx no-retry, local-only mode, `setup`
config (0600 permissions, key rotation), five concurrent sessions staying
distinct, and zero content leakage (asserted on stdout, stderr, and the
session log).

### Backend — logic and cross-surface contract

```bash
deno test --allow-read supabase/functions/events/   # 9 tests
```

Covers: payload validation (STALE rejected — it must never be stored), the
notify rule truth table, notification copy, and a **contract test that
replays the exact payloads the CLI put on the wire** (captured as a fixture
by the Node suite) through the real validator and notify rule — including
redelivery and out-of-order arrival. If the CLI and the backend ever drift
apart, this fails here instead of on your Mac.

> Run the Node suite before the Deno suite when you change the CLI's event
> shape: it regenerates `mac/tests/fixtures/captured-events.json`.

### CLI — manual, against real Codex (the Milestone 1 gate)

```bash
cd mac && npm install && npm run build && npm link
agent-ready run --name "Test" -- codex        # no config -> local-only mode
# second terminal:
tail -f ~/.agent-ready/sessions/<short-id>.log
```

Run 2–3 real turns. Pass: exactly one `READY` line per completed turn; the
log records every notify event type Codex emitted; no prompt/output text
anywhere. Same for Claude Code: `agent-ready run --name "Test" -- claude`.

## 4. Deploying the backend (Milestones 2–3)

```bash
# once: npm install -g supabase
supabase login
supabase link --project-ref <your-project-ref>
supabase db push                    # applies migrations/001_agents.sql
supabase functions deploy events    # config.toml already sets verify_jwt=false
supabase functions deploy agents
```

Create the device key and configure the CLI:

```bash
agent-ready setup --api-base-url https://<project-ref>.supabase.co/functions/v1 --machine "MacBook Pro"
# prints dk_… ; then:
supabase secrets set DEVICE_KEY=dk_…
```

Telegram (V1 notifications):

1. Talk to @BotFather → `/newbot` → copy the bot token.
2. Send your new bot any message, then visit
   `https://api.telegram.org/bot<token>/getUpdates` and copy `chat.id`.
3. `supabase secrets set TELEGRAM_BOT_TOKEN=<token> TELEGRAM_CHAT_ID=<chat-id>`

(Until those secrets exist the backend logs the would-be notification instead
of sending it — the event path is testable without Telegram.)

### Backend integration test

```bash
./scripts/test-backend.sh https://<project-ref>.supabase.co/functions/v1 dk_…
```

10 checks: bad key rejected, STALE rejected, RUNNING stores without
notification, READY notifies, retried `eventId` is a no-op duplicate,
repeated READY does not re-notify, a late-arriving older event is ignored,
GET lists, DELETE removes. Manual part: **exactly one** Telegram message
must have arrived for the whole run.

## 5. End-to-end acceptance tests (plan §10)

| Test | Steps | Pass |
| --- | --- | --- |
| Single session | `agent-ready run --name "Auth refactor" -- codex`, give it a task, walk away | Phone buzzes once shortly after the turn completes; app shows READY |
| No duplicate | Let the CLI retry (toggle Wi-Fi off during a turn, back on after) | One notification only; CLI prints `same eventId, no duplicate notification` |
| Five sessions | Five `agent-ready run` in five terminals with distinct `--name` | Five rows, independent transitions, five distinguishable notifications |
| Temporary network loss | Wi-Fi off; finish a turn; Wi-Fi on within ~1 min | `retry n/5 in …s` lines, then delivery; notification arrives late but once |
| Backend restart | Redeploy functions mid-session | No state lost (it lives in Postgres) |
| iOS list | Open the app during the above | Correct states/timestamps; READY visually distinct; pull-to-refresh works |
| Privacy | `grep -riE 'secret|prompt' ~/.agent-ready/sessions/` + check Supabase table | Only names/ids/timestamps anywhere |
| Walk-away (the payoff) | Start a long task, leave the Mac, go for a walk | Notification arrives on your phone while away |

## 6. iOS app (branch `claude/agent-ready-ios`)

```bash
git checkout claude/agent-ready-ios     # superset branch: also has mac/ and supabase/
cd ios
# needs XcodeGen (once: brew install xcodegen)
xcodegen generate
open AgentReady.xcodeproj
```

**Press Cmd-U first.** The `AgentReadyTests` target checks the display logic
that can only be verified in Xcode: timestamp parsing against every shape
Postgres returns, the 30-minute STALE boundary, sort order, metadata copy,
and decoding a real `GET /agents` payload. Green there means the remaining
risk is plumbing, not logic.

Then run on your iPhone with free development signing (Xcode → Signing: your
personal team). First launch shows the connect screen: paste the API base URL
and device key (stored in the Keychain, never UserDefaults). Full manual test
checklist is in `ios/README.md`.

## 7. Known limitations (documented, not hidden)

1. **Codex multi-turn notifications.** Codex has no official turn-start
   event. After the first READY, the backend sees the session as READY, so a
   second completed turn (READY → READY) does **not** notify unless an
   `approval-requested` reset the state to RUNNING in between. Claude Code
   does not have this problem (`UserPromptSubmit` is a real turn-start
   signal). Decision point if it hurts in practice — options are an official
   Codex signal (if one appears) or relaxing the notify rule; we chose not to
   guess with heuristics.
2. **One device key** for CLI and iOS (plan: no multi-user auth in V1).
   Rotate by re-running `agent-ready setup`, updating the `DEVICE_KEY`
   secret, and re-pasting into the app.
3. **No offline queue.** 5 bounded retries (~1 min); if the Mac is offline
   longer, the event drops and state catches up on the next transition. By
   design (guardrails §11).
4. **Pairing** is manual paste (URL + key) rather than the wireframe's
   auto-pairing code exchange: the plan's endpoint contract has no pairing
   endpoint, and the plan wins on architecture.
5. **iOS build is untested in this container** (no Xcode, and no Swift
   toolchain reachable through the proxy). The Swift is deliberately plain
   SwiftUI with no dependencies, and the logic most likely to be wrong is
   covered by the Cmd-U tests — but expect at most minor compile fixes on
   first `xcodegen generate` + build. Paste any error and run `/go`.

## 8. What the next agent should NOT do

The over-engineering guardrails (plan §11) still bind: no queues, no
WebSockets, no event sourcing, no multi-user auth, no plugin SDK, no new
agent states (READY/RUNNING stored, STALE derived client-side only), no
transmitting terminal output or source code, no polling/output heuristics for
detection. When in doubt, the smaller implementation wins.

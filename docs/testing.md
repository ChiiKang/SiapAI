# Agent Ready — How it works & how to test it

The handoff document. Written for the owner and for the next agent who picks
this repository up. Read `docs/contract.md` first (the states and the event
contract), then this file. Scope and guardrails come from
`Agent_Ready_MVP_Implementation_Plan (1).docx` in the design bundle.

## 1. How the system works (one contract, two backends)

Local — the default, nothing leaves the Mac:

```
Mac terminal                      Mac (same machine)              iPhone
agent-ready run -- codex          agent-ready serve               AgentReady app
  └─ adapter detects READY ─────►   POST /events ──► notification   reads GET /agents
                                    state.json                      over Wi-Fi
```

Cloud — the same contract, for notifications away from home:

```
Mac terminal                        Supabase                      iPhone
agent-ready run -- codex            POST /events                  Telegram notification
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
3. **Backend — local (`mac/src/server.ts`, `agent-ready serve`)**: same
   machine, no account. Authenticates the device key, validates, dedupes by
   `eventId`, ignores out-of-order events, keeps one record per session in
   `~/.agent-ready/state.json`, and notifies **only** when stored status was
   RUNNING and incoming is READY. Serves GET/DELETE `/agents` to the app on
   the LAN.
   **Backend — cloud (`supabase/`)**: the identical contract over Postgres,
   for when you want notifications away from home.
4. **Notification**: macOS Notification Center (local, instant, no accounts)
   or Telegram (reaches your phone anywhere, no Apple membership). Both sit
   behind one provider interface, so APNs later is a drop-in.
5. **iOS app (`ios/`, branch `claude/agent-ready-ios`)**: one SwiftUI list —
   READY first, then RUNNING, then STALE (derived on the client: RUNNING with
   no event for 30 min). Refresh on appear/foreground/pull. No timers, no
   sockets, no background polling.

## 2. Prerequisites

**For the local path (everything below except §7):** a Mac with Node 20+,
and Codex and/or Claude Code installed. That is all — no accounts.

Optional extras: Xcode 15+ for the iPhone app (§6); a free Telegram bot if
you want notifications away from your desk (§4); a Supabase project only if
you later want the cloud backend (§7).

## 3. Component tests (nothing to set up)

### CLI and local server — automated

```bash
cd mac && npm install && npm test          # 35 tests
```

Covers: one READY per turn, `turn-id` dedupe, approval reset, exit≠READY for
Codex, Claude Stop/UserPromptSubmit mapping, generic exit=READY, interrupted
process reports no READY, contract fields on the wire, same-`eventId`
retries, bounded retry (5 max), 4xx no-retry, local-only mode, `setup`
config (0600 permissions, key rotation), five concurrent sessions staying
distinct, zero content leakage (asserted on stdout, stderr, and the session
log), and the **local server**: the whole scenario table, malformed-event
rejection, auth, the app's payload shape, delete, state surviving a restart,
a clean failure on a taken port, and a full CLI→server→notification run.

### Backend logic — both implementations, one table

```bash
deno test --allow-read supabase/functions/events/   # 17 tests
```

Covers: payload validation (STALE rejected — it must never be stored), the
notify rule truth table, notification copy, a **contract test replaying the
exact payloads the CLI put on the wire**, and the **shared scenario table**
(`mac/tests/scenarios.json`) — the same seven lifecycles the local server is
tested against, so the local and cloud backends cannot behave differently.

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

## 4. Running it for real, locally (no accounts, ~5 minutes)

```bash
agent-ready setup --local --machine "MacBook Pro"   # writes config, prints your device key
agent-ready serve                                   # leave this running
```

`serve` prints the port, the notification mode, and a LAN address like
`http://192.168.1.24:8787` — that address is what the iPhone app uses.

In other terminals:

```bash
agent-ready run --name "Auth refactor" -- codex
agent-ready run --name "Docs pass"     -- claude
```

Each completed turn: a macOS notification appears, and the `serve` terminal
logs `READY  Auth refactor  → notified`. That is the product working.

**Notifications on your phone without Apple enrollment** (optional): create a
Telegram bot via @BotFather, send it any message, read your `chat.id` from
`https://api.telegram.org/bot<token>/getUpdates`, then:

```bash
agent-ready setup --local --machine "MacBook Pro" \
  --notify telegram --telegram-bot-token <token> --telegram-chat-id <chat-id>
```

(Re-running `setup` rotates the device key — re-paste it into the app.)

## 5. End-to-end acceptance tests (plan §10)

Local mode unless noted:

| Test | Steps | Pass |
| --- | --- | --- |
| Single session | `agent-ready run --name "Auth refactor" -- codex`, give it a real task | One notification shortly after the turn completes; `serve` logs one `→ notified`; app shows READY |
| No duplicate | Stop `serve` mid-turn, restart it within a minute | CLI prints `retry n/5 in …s` then `delivered … same eventId`; still exactly one notification |
| Five sessions | Five `agent-ready run` in five terminals with distinct `--name` | Five rows, independent transitions, five distinguishable notifications |
| Backend restart | Ctrl-C `serve`, start it again | Session list intact (it lives in `~/.agent-ready/state.json`) |
| Interrupted job | Ctrl-C a wrapped script | No READY, no notification |
| iOS list | Open the app during the above | Correct states/timestamps; READY visually distinct; pull-to-refresh works |
| Privacy | `grep -riE 'secret|prompt' ~/.agent-ready/` | Only names, ids and timestamps — no prompts, output, or file names |
| Walk-away (the payoff) | Long task, leave the desk; Telegram mode if leaving the house | Notification arrives while you are away |

## 6. Optional: the cloud backend (only for notifications away from home)

Skip this entirely while validating locally. Everything above works without
it, and switching later changes one line of config.

```bash
# once: npm install -g supabase
supabase login
supabase link --project-ref <your-project-ref>
supabase db push                    # applies migrations/001_agents.sql
supabase functions deploy events    # config.toml already sets verify_jwt=false
supabase functions deploy agents

agent-ready setup --api-base-url https://<project-ref>.supabase.co/functions/v1 --machine "MacBook Pro"
supabase secrets set DEVICE_KEY=dk_…                       # the key setup printed
supabase secrets set TELEGRAM_BOT_TOKEN=<token> TELEGRAM_CHAT_ID=<chat-id>
```

(Without the Telegram secrets the function logs the would-be notification, so
the event path is still testable.) Then:

```bash
./scripts/test-backend.sh https://<project-ref>.supabase.co/functions/v1 dk_…
```

10 checks: bad key rejected, STALE rejected, RUNNING stores without
notification, READY notifies, retried `eventId` is a no-op duplicate,
repeated READY does not re-notify, a late-arriving older event is ignored,
GET lists, DELETE removes. Manual part: **exactly one** Telegram message
must have arrived for the whole run.

## 7. iOS app (branch `claude/agent-ready-ios`)

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
personal team). First launch shows the connect screen: paste the URL and
device key (stored in the Keychain, never UserDefaults):

- **local mode** — the LAN address `agent-ready serve` printed, e.g.
  `http://192.168.1.24:8787`. The phone must be on the same Wi-Fi, `serve`
  must be running, and iOS asks once for Local Network permission — allow it.
- **cloud mode** — the `https://<ref>.supabase.co/functions/v1` URL.

Full manual test checklist is in `ios/README.md`.

## 8. Known limitations (documented, not hidden)

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
   secret (cloud only), and re-pasting into the app.
3. **No offline queue.** 5 bounded retries (~1 min); if the backend is
   unreachable longer, the event drops and state catches up on the next
   transition. By design (guardrails §11).
4. **Local mode reaches the phone only on the same Wi-Fi**, and only while
   `agent-ready serve` is running and the Mac is awake. For notifications
   away from home use `--notify telegram` (still no Apple membership), or the
   cloud backend in §6. The local server listens on the LAN, so anyone on
   your network can reach the port — the device key is what protects it; it
   is not meant for untrusted networks.
5. **Pairing** is manual paste (URL + key) rather than the wireframe's
   auto-pairing code exchange: the plan's endpoint contract has no pairing
   endpoint, and the plan wins on architecture.
6. **iOS build is untested in this container** (no Xcode, and no Swift
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

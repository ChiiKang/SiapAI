# Handover — Agent Ready

You are picking this up **on the owner's Mac**. Everything that could be
built and verified without Mac hardware is done and pushed. What is left
needs real Codex, real Xcode, and a real iPhone — which is why it is yours.

Read `docs/contract.md` (states + event contract) and `docs/testing.md`
(how it works, how to test it) before changing code. This file is the
sequence, the decision authority, and the boundaries.

---

## 1. Where things stand

Two branches, both pushed:

| Branch | Contents |
| --- | --- |
| `claude/agent-ready-mvp-5deun8` | CLI, local server, optional Supabase backend, docs |
| `claude/agent-ready-ios` | everything above **plus** `ios/` (superset — work here if you touch the app) |

**Proven by automated tests** (35 Node, 17 Deno, all green):

- Codex adapter emits exactly one READY per completed turn, deduped by
  `turn-id`; a duplicate hook invocation adds nothing.
- Claude Code adapter maps `Stop` → READY and `UserPromptSubmit` → RUNNING.
- Generic adapter treats a normal process exit as READY, and a
  signal-killed process as *not* READY.
- Process exit is never READY for interactive agents.
- The CLI sends the contract fields, retries with the same `eventId`
  (bounded at 5), does not retry 4xx, and runs local-only without a config.
- The local server and the Supabase logic behave identically on the shared
  scenario table (`mac/tests/scenarios.json`): duplicate suppression,
  out-of-order rejection, notify only on RUNNING → READY.
- No prompt text, agent output, or file names reach stdout, the session
  log, or the wire.

**Not yet proven — your job:**

1. Real Codex emits the notify hook as expected, once per turn.
2. Real Claude Code does the same via its hooks.
3. The iOS app compiles in Xcode and runs on the owner's iPhone.
4. The whole thing works end to end while the owner walks away.

---

## 2. Do this in order

### Step 1 — environment and baseline (~5 min)

```bash
git checkout claude/agent-ready-mvp-5deun8 && git pull
cd mac && npm install && npm test          # expect 35 passing
deno test --allow-read ../supabase/functions/events/   # expect 17 passing
npm run build && npm link                  # puts `agent-ready` on PATH
```

If Deno is missing: `brew install deno` (or skip — it only covers the
optional cloud backend's logic).

### Step 2 — the gate: real Codex detection (~15 min)

This is the milestone the whole product rests on. Do not proceed past a
failure here by adding polling or output parsing — see §4.

```bash
agent-ready setup --local --machine "<their Mac's name>"
agent-ready serve                     # leave running in its own terminal
# another terminal:
agent-ready run --name "Codex test" -- codex
```

Give Codex two or three real tasks, completing a turn each time. Watch the
`serve` terminal and `~/.agent-ready/sessions/<short-id>.log`.

**Pass:** exactly one `READY` per completed turn, one macOS notification
each, no READY mid-turn.

**Record in this file (§5) regardless of outcome:** every `notify event
type=…` line the log shows. That is the empirical evidence for the open
question in §3.

Then the same for Claude Code:

```bash
agent-ready run --name "Claude test" -- claude
```

Claude Code has a real turn-start signal, so it should show clean
RUNNING ↔ READY cycling across many turns.

### Step 3 — the acceptance tests (~20 min)

Work through the table in `docs/testing.md` §5: five concurrent sessions,
restart persistence, interrupted job, retry behaviour (stop `serve`
mid-turn and restart it), privacy grep.

### Step 4 — the iPhone app (~30 min)

```bash
git checkout claude/agent-ready-ios && git pull
cd ios && xcodegen generate && open AgentReady.xcodeproj
```

Press **Cmd-U first** — the unit tests cover timestamp parsing, the STALE
boundary, sort order, URL validation, and payload decoding. Fix compile
errors as they come; the Swift was written without Xcode, so small fixes
are expected and are not a design problem.

Then run on the iPhone (free personal-team signing), pair with the LAN
address `serve` printed plus the device key, allow the Local Network
prompt, and work through `ios/README.md`'s manual checklist.

### Step 5 — the payoff

Owner starts a long Codex task, walks away, and gets notified. If they want
alerts away from the house, set up Telegram (`docs/testing.md` §4) — still
no Apple membership needed.

---

## 3. The one open question

**Codex has no official turn-start event.** The wrapper learns a new turn
started only from `approval-requested`. Consequence: after a READY, if the
next turn produces no approval request, the session is still stored as
READY when that turn completes — and the notify rule (`RUNNING → READY`
only) means **no notification for that turn**.

Claude Code is unaffected (`UserPromptSubmit` is a real turn-start signal).

Step 2's log tells you whether this bites in practice. If it does, the
options, in order of preference:

1. A genuine Codex signal we missed — check the notify event types actually
   observed, and current Codex docs/config for anything turn-scoped.
2. Treat a new `turn-id` on `agent-turn-complete` as proof that a new turn
   ran, and reset to RUNNING at that moment (i.e. notify per *distinct*
   completed turn). This stays inside official signals — no heuristics, no
   polling — and is a small change in `CodexAdapter` plus the notify rule's
   interpretation. **Requires the owner's agreement**, because it slightly
   redefines the transition rule in the plan.
3. Do nothing and document it.

Do not adopt option 2 unilaterally. Present the evidence and let the owner
choose.

---

## 4. Boundaries (from the plan's guardrails — they still bind)

- **Local first.** The owner runs everything on the Mac and will only pay
  for Apple Developer enrolment if the product proves itself. Never make
  the cloud backend, a paid account, or APNs a prerequisite for anything.
- **Detection comes from official agent signals only** — never polling,
  never parsing terminal output, never exit-as-READY for interactive
  agents. If detection is uncertain, isolate and document it (§3 is the
  model); do not paper over it.
- **Two stored states**, RUNNING and READY. STALE is derived on the iOS
  client from `updated_at` and is never stored or sent.
- **Notify only** when stored status was RUNNING and incoming is READY;
  `eventId` dedupes retries; out-of-order events are ignored.
- **Never transmit or log** prompts, terminal output, file names, or source
  code. The hook programs forward `{type, turn-id}` and nothing else.
- **The local server and the Supabase functions are one contract.** Change
  one, change the other, and keep `mac/tests/scenarios.json` green in both
  suites.
- **No new architecture**: no queues, WebSockets, event sourcing,
  multi-user auth, plugin SDKs, or dependencies. Smallest reliable
  implementation wins; boring readable code.
- Secrets: device key in the Keychain on iOS and a 0600 config on the Mac;
  the Supabase service-role key never leaves the Edge Functions.

## 5. Findings log — append as you go

Keep this section current; it is what the next session (and the owner)
reads first.

```
DATE        WHO      FINDING
----------  -------  --------------------------------------------------
(pending)   local    Codex notify event types observed:
(pending)   local    Codex multi-turn notification behaviour:
(pending)   local    Claude Code multi-turn behaviour:
(pending)   local    Xcode build result / fixes applied:
(pending)   local    Acceptance tests passed / failed:
```

## 6. Definition of done for this handover

- Steps 2–5 completed, with results written into §5.
- Any code fixes committed and pushed to the branch they belong to
  (`ios/` changes → `claude/agent-ready-ios`; everything else →
  `claude/agent-ready-mvp-5deun8`).
- `npm test` and the Deno suite still green after your changes.
- The §3 question either closed with evidence, or escalated to the owner
  with a recommendation.
- README status boxes updated to reflect what is now verified on hardware.

---
description: Continue building/verifying the Agent Ready MVP from wherever it stands
---

You are continuing the Agent Ready MVP. Work autonomously, milestone by
milestone; only stop when blocked on something a human must provide
(credentials, a physical device, an approval). Do not stop to ask permission
for work the plan already calls for.

## Orient (do this first, every time)

1. Read `docs/contract.md` — the states, event contract, and known risks.
2. Read `docs/testing.md` — how everything works and is tested.
3. Read `README.md` — the milestone status checklist.
4. `git log --oneline -10` on this branch AND `claude/agent-ready-ios`
   (the iOS app lives there; CLI + backend + docs live on the MVP branch).
5. Run the automated tests to establish ground truth:
   `cd mac && npm install && npm test` and
   `deno test --allow-read supabase/functions/events/`.

## Then continue, in this priority order

1. Anything red: fix failing tests before new work.
2. Feedback in the user's message that invoked /go — including results from
   their local/manual testing — takes precedence over the list below.
3. Remaining milestones, in the plan's order (check README for what's done):
   backend deploy verification (`scripts/test-backend.sh`), E2E acceptance
   tests (docs/testing.md §5), iOS build fixes from real Xcode output,
   Milestone 6 (APNs, only when the user says enrollment is done — swap the
   provider in `supabase/functions/events/notify.ts`, add device-token
   registration, keep the provider interface).
4. Update `README.md` status boxes and `docs/testing.md` when a milestone
   completes; commit and push to the SAME branch the work belongs to.

## Hard rules (from the plan's guardrails — they still bind)

- **The owner runs everything locally** (`agent-ready serve`) and will only
  pay for Apple Developer enrollment if the product proves itself. Never make
  the cloud backend, a paid account, or APNs a prerequisite for anything.
- The local server and the Supabase functions implement ONE contract. Change
  one, change the other, and keep `mac/tests/scenarios.json` passing in both
  suites — that table is what stops them drifting.
- Two stored states only (RUNNING/READY); STALE is derived on the iOS client.
- Detection only from official agent signals inside adapters — never polling,
  never output parsing, never exit-as-READY for interactive agents.
- Never transmit or log prompts, terminal output, file names, or source code.
- Notify only on stored RUNNING → incoming READY; eventId dedupes retries.
- The service-role key never leaves the Edge Functions; device key in
  Keychain on iOS, config file (0600) on Mac.
- No queues, WebSockets, event sourcing, multi-user auth, or new frameworks.
  Prefer the smallest reliable implementation; boring readable code.
- iOS: strictly native SwiftUI, system colors, SF Pro, status = label +
  shape, never color alone. The wireframe HTML is reference only.

## Definition of done for any change

Tests green (`npm test`, deno logic tests), docs updated, committed and
pushed to the correct branch, and the final reply tells the user exactly
what to test manually and how.

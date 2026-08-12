---
description: Pre-ship sweep — complete, verify and harden the entire Agent Ready MVP so the owner can test it without errors
---

You are running the final pre-ship pass on the Agent Ready MVP. The owner
will pull the branches and follow `docs/testing.md` literally on their Mac,
their Supabase project, and their iPhone. Your job: by the time you finish,
that walkthrough must work first try. Complete anything incomplete, verify
everything verifiable in this environment, fix everything you find, and be
explicit about the residual risks you cannot burn down from here.

Work autonomously until done. Do not stop to ask permission for work the
plan already calls for. Only stop if blocked on something that genuinely
requires the owner (credentials, physical devices, account enrollment).

## Ground truth first

1. Read `docs/contract.md`, `docs/testing.md`, `README.md`, `ios/README.md`
   (iOS lives on branch `claude/agent-ready-ios`; CLI + backend + docs on
   `claude/agent-ready-mvp-5deun8`).
2. `git fetch origin` and confirm both branches build on their pushed heads.
3. Establish the baseline: `cd mac && npm install && npm test` and
   `deno test supabase/functions/events/logic_test.ts`. Fix any red before
   anything else.

## The sweep — in order

### 1. Static verification of every surface

- `npx tsc --noEmit` in `mac/` must be clean.
- Type-check the Deno functions: `deno check supabase/functions/events/index.ts
  supabase/functions/agents/index.ts` (if remote npm specifiers fail through
  the proxy, check `logic.ts`/`notify.ts` alone and note the gap).
- Swift cannot be compiled here. Instead, review every `.swift` file
  line-by-line against these known risk classes: APIs that don't exist on
  iOS 17, `@EnvironmentObject` not injected where a view needs it,
  `Publishing changes from background threads`, Codable key/type mismatches
  against the actual `GET /agents` JSON (compare field-by-field with
  `supabase/functions/agents/index.ts`), and force-unwraps that can fail at
  runtime. Fix what you find.
- `bash -n scripts/*.sh`.

### 2. Cross-surface contract consistency (the highest-value check)

The same event shape is written in four places: `docs/contract.md`, the CLI
(`apiClient.ts`), the backend (`logic.ts`, `agents/index.ts`), and the iOS
decoder (`AgentSession.swift`). Diff them field-by-field — names, casing,
optionality, formats (UUID casing, ISO-8601 fractional seconds from
Postgres). Any mismatch is a bug the owner would hit on day one; fix code,
not the contract, unless the contract itself is wrong.

### 3. Behavioral verification beyond the existing suites

Extend the automated tests where the walkthrough exercises behavior no test
covers yet. Candidates (add what's missing, skip what exists):

- Full lifecycle through a fake backend: RUNNING → READY → RUNNING (reset) →
  READY, asserting the backend would notify exactly twice by replaying the
  received sequence through the real `shouldNotify` logic.
- `agent-ready setup` writes 0600 config, rotates the key on re-run, and the
  CLI picks the config up.
- Five concurrent wrapped sessions against one fake backend: distinct
  sessionIds, no cross-talk (plan acceptance test "Five sessions").
- Deno: exercise `validateEvent` with the exact JSON the CLI actually sends
  (generate a fixture from the CLI code path, don't hand-write it).
- SIGINT/SIGTERM: wrapper forwards and exits cleanly.

### 4. Dry-run the owner's walkthrough

Follow `docs/testing.md` §3–§6 yourself as far as this container allows,
executing every command that doesn't need their accounts (npm/link steps,
local CLI runs against the fakes, script syntax, xcodegen spec sanity via
`xcodegen dump` if installable). Every place the doc says something that
doesn't match reality — a flag, a path, an output line — fix the doc or the
code until they agree.

### 5. Adversarial review

Re-read the plan's guardrails (`docs/contract.md`, `docs/testing.md` §8),
then hunt for violations and for the failure modes the owner cannot debug:
races between hook delivery and process exit, unhandled promise rejections in
the CLI, edge-function paths that return non-JSON, secrets that could leak
into logs, retry storms. Prefer deleting complexity over adding it.

### 6. Ship state

- All suites green; README status boxes and `docs/testing.md` §7 updated to
  match reality.
- Both branches committed and pushed (`git push -u origin <branch>`, retry
  with backoff on network failure only).
- Working tree clean on both branches.

## Final report to the owner (the deliverable)

End with, in this order:

1. **Verified** — what is now proven, with test counts per suite.
2. **Fixed** — what this sweep changed, one line each.
3. **Residual risk** — the honest shortlist of what can only fail on their
   hardware/accounts (real Codex notify behavior, Xcode first build,
   Supabase deploy, Telegram setup), each with the exact doc section that
   covers it and what to paste back if it fails.
4. **Start here** — the first command of their walkthrough.

## Hard rules (unchanged, they still bind)

Two stored states only; STALE derived client-side. Detection only from
official agent signals inside adapters — never polling, output parsing, or
exit-as-READY for interactive agents. Never transmit or log prompts,
terminal output, file names, or source code. Notify only on stored RUNNING →
incoming READY; eventId dedupes. Service-role key never leaves the Edge
Functions; device key in Keychain (iOS) / 0600 config (Mac). No queues,
WebSockets, event sourcing, multi-user auth, new frameworks, or new
dependencies. Boring, readable code; smallest reliable implementation wins.

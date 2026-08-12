# Agent Ready — iOS app (Milestone 4)

One SwiftUI screen answering "which agents need me?", plus a settings leaf
and an onboarding connect screen. Strictly native: SF Pro via SwiftUI
defaults, system colors, automatic light/dark, one accent color in the asset
catalog. Status always reads from a text label plus a shape, never color
alone.

## Build & run

Requires Xcode 15+ and [XcodeGen](https://github.com/yonaskolb/XcodeGen)
(`brew install xcodegen`).

```bash
cd ios
xcodegen generate
open AgentReady.xcodeproj
```

In Xcode: select the AgentReady target → Signing & Capabilities → choose your
personal team (free development signing works — no paid membership needed),
then run on your iPhone.

**Run the unit tests first (Cmd-U).** `AgentReadyTests` covers the logic that
decides what you see and cannot be verified without Xcode: timestamp parsing
against every shape Postgres returns (including the microsecond form that
would otherwise break the whole list), the derived STALE rule at the 30-minute
boundary, sort order, row metadata copy, which server URLs are accepted (local
HTTP vs public HTTPS), and decoding the exact `GET /agents` payload. If those
pass, the app's display logic is sound and anything left is plumbing.

> This Swift code was written without access to Xcode (Linux container), so
> expect at most minor compile fixes on first build. The code is deliberately
> plain SwiftUI with no dependencies. If something doesn't compile, paste the
> error and run `/go` — it's a one-line fix class, not a design problem.

## First launch — local mode (no accounts)

1. On the Mac:
   ```bash
   agent-ready setup --local --machine "MacBook Pro"   # prints the device key
   agent-ready serve                                   # prints http://192.168.x.x:8787
   ```
2. Keep the phone on the same Wi-Fi, then paste both values into the connect
   screen. The key is stored in the Keychain, never in UserDefaults.
3. iOS asks once for **Local Network** permission — allow it, or the list
   cannot reach your Mac. (Settings › Agent Ready › Local Network if you
   dismiss it by accident.)

The app accepts plain `http://` only for local addresses (private IPs,
`localhost`, `*.local`); anything on the public internet must be `https://`.
That matches the `NSAllowsLocalNetworking` exception in Info.plist — iOS
would block cleartext otherwise.

For the optional cloud backend, paste the
`https://<ref>.supabase.co/functions/v1` URL instead; nothing else changes.

## What's implemented (per the design README)

- **Agent list**: READY → RUNNING → STALE sort, most recent first per group;
  row = name (headline) over `machine · state time` metadata; trailing 8pt
  shape + monospaced tracked label (filled square READY in accent, hollow
  RUNNING in secondary, dashed STALE); READY rows on secondary background.
- **Subheader**: `UPDATED NOW · 4 SESSIONS`, `LOADING…` during first fetch.
- **Refresh**: on appear, on foreground, pull-to-refresh. No timers polling
  the network (the only timer re-renders relative timestamps once a minute,
  display-only).
- **Loading**: skeleton rows on first fetch only.
- **Empty**: "No monitored agents yet" + the run command, monospaced.
- **Error/stale data**: hairline banner ("Can't reach the service / Showing
  last known state from 12:44." + Retry with in-flight spinner), list dims to
  55%, metadata switches to `machine · stale · 12:44`. Never blanks the list,
  no alerts, self-dismisses on next good fetch.
- **Stale sessions**: RUNNING with no event for 30 min displays as STALE
  (derived client-side, never stored); destructive swipe deletes the row
  locally and via `DELETE /agents`.
- **Settings**: machine label, masked device key (reveal/copy/rotate with
  confirmation alert), API URL, notify toggle, delivery row, privacy text.
- **Connect screen**: steps + paste URL/key, skip-for-now path.

## Deviations from the wireframes (documented, deliberate)

- **Pairing is manual paste**, not an auto-exchanging pairing code — the
  plan's endpoint contract has no pairing endpoint and the plan wins on
  architecture.
- **No local/lock-screen notification code**: V1 notifications arrive via
  the Telegram bot (plan §6 Phase A). The lock-screen spec in the design
  README describes the Milestone 6 APNs alert; `threadIdentifier = sessionId`
  applies then.
- "Notify on READY" toggle is stored but only takes effect with native push
  (the footnote in Settings says so).

## Manual test checklist

Run Cmd-U first (see above). Then, with `agent-ready serve` running on the
Mac and a couple of `agent-ready run` sessions active:

- [ ] List shows sessions with correct states; READY rows first and visually
      distinct in both light and dark mode.
- [ ] Complete a turn on the Mac → pull to refresh → row flips to READY with
      "ready N min ago" metadata.
- [ ] Kill the wrapper (Ctrl-C) and wait 30+ min (or temporarily lower
      `DisplayState.staleThreshold`) → row shows dashed STALE, sorts last,
      swipe deletes it everywhere.
- [ ] Stop `agent-ready serve` (or turn on airplane mode) → pull → banner
      appears, list dims but keeps its data, Retry shows a spinner; start
      `serve` again → Retry → banner clears.
- [ ] Fresh install → connect screen → Skip → empty state; Settings shows
      unpaired key row; Connect again → paste values → list loads.
- [ ] Dynamic Type XXL: names wrap to two lines, status labels never wrap.

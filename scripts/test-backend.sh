#!/usr/bin/env bash
# Integration test for the deployed (or locally served) backend.
#
#   ./scripts/test-backend.sh https://<project>.supabase.co/functions/v1 <device-key>
#
# Exercises the full contract: auth, validation, RUNNING -> READY transition,
# eventId idempotency, repeated READY, read endpoint, delete endpoint.
# Exactly ONE notification (Telegram message / log line) must result.

set -euo pipefail

BASE_URL="${1:?usage: test-backend.sh <api-base-url> <device-key>}"
DEVICE_KEY="${2:?usage: test-backend.sh <api-base-url> <device-key>}"

SESSION_ID=$(uuidgen | tr 'A-Z' 'a-z')
EVENT_1=$(uuidgen | tr 'A-Z' 'a-z')
EVENT_2=$(uuidgen | tr 'A-Z' 'a-z')
NOW() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

PASS=0; FAIL=0
check() { # check <name> <expected-substring> <actual>
  if [[ "$3" == *"$2"* ]]; then PASS=$((PASS+1)); echo "ok   $1"
  else FAIL=$((FAIL+1)); echo "FAIL $1: expected «$2» in: $3"; fi
}

post() { # post <auth-key> <json>
  curl -s -X POST "$BASE_URL/events" \
    -H "Authorization: Bearer $1" -H "Content-Type: application/json" -d "$2"
}

event_json() { # event_json <event-id> <status>
  cat <<EOF
{"eventId":"$1","sessionId":"$SESSION_ID","displayName":"Backend test",
 "machineName":"Test Mac","agentKind":"Codex","status":"$2","occurredAt":"$(NOW)"}
EOF
}

echo "session: $SESSION_ID"

check "rejects wrong device key" '"error"' \
  "$(post "dk_wrong_key" "$(event_json "$EVENT_1" RUNNING)")"

check "rejects bad status" 'status must be' \
  "$(post "$DEVICE_KEY" "$(event_json "$EVENT_1" STALE)")"

check "RUNNING accepted, no notification" '"notified":false' \
  "$(post "$DEVICE_KEY" "$(event_json "$EVENT_1" RUNNING)")"

check "READY notifies exactly once" '"notified":true' \
  "$(post "$DEVICE_KEY" "$(event_json "$EVENT_2" READY)")"

check "same eventId retried -> duplicate, no notification" '"duplicate":true' \
  "$(post "$DEVICE_KEY" "$(event_json "$EVENT_2" READY)")"

check "repeated READY (new eventId) -> no notification" '"notified":false' \
  "$(post "$DEVICE_KEY" "$(event_json "$(uuidgen | tr 'A-Z' 'a-z')" READY)")"

# A late-arriving older event must not rewind the state (which would let the
# next READY notify a second time).
OLD_JSON=$(cat <<EOF
{"eventId":"$(uuidgen | tr 'A-Z' 'a-z')","sessionId":"$SESSION_ID","displayName":"Backend test",
 "machineName":"Test Mac","agentKind":"Codex","status":"RUNNING","occurredAt":"2000-01-01T00:00:00Z"}
EOF
)
check "out-of-order older event ignored" '"stale":true' \
  "$(post "$DEVICE_KEY" "$OLD_JSON")"

check "GET /agents shows the session as READY" '"status":"READY"' \
  "$(curl -s "$BASE_URL/agents" -H "Authorization: Bearer $DEVICE_KEY")"

check "DELETE /agents removes the session" '"ok":true' \
  "$(curl -s -X DELETE "$BASE_URL/agents?session_id=$SESSION_ID" \
      -H "Authorization: Bearer $DEVICE_KEY")"

check "deleted session is gone" "" \
  "$(curl -s "$BASE_URL/agents" -H "Authorization: Bearer $DEVICE_KEY" | grep -c "$SESSION_ID" || true)"

echo
echo "passed $PASS, failed $FAIL"
echo "manual check: exactly ONE Telegram message should have arrived."
[[ $FAIL -eq 0 ]]

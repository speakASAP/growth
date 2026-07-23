#!/usr/bin/env bash
# S1a owner manual check (F-001 §"Owner manual check").
#
# growth-core is ClusterIP-only, so every call goes through the pod rather than a public URL.
# Nothing here is a test double: this writes real decision artefacts to the production database,
# which is the point — the check is whether the record reads back as the story of a real decision.
#
# The hypothesis, rationale and reasons are arguments rather than defaults on purpose. A defaulted
# reason looks complete and carries nothing, which is exactly the failure the artefact exists to
# prevent; if this script wrote them for you it would be checking itself, not the record.
#
#   ./scripts/s1a-verify.sh launch  "<hypothesis>" "<rationale>"
#   ./scripts/s1a-verify.sh edit                       # step 2 — must be refused
#   ./scripts/s1a-verify.sh budget  "<reason>" 2500.00 # step 5
#   ./scripts/s1a-verify.sh stop-bare                  # step 4 — must be refused
#   ./scripts/s1a-verify.sh stop    "<reason>"         # step 6
#   ./scripts/s1a-verify.sh cap                        # the effective cap, rebuilt from the chain
#   ./scripts/s1a-verify.sh story                      # read the chain back
#
# Every step declares the status the contract requires and CHECKS it, exiting non-zero when the
# server answers something else. Steps 2 and 4 exist to prove a refusal happens; a refusal that
# quietly stopped happening would otherwise look exactly like a passing run.
#
# This writes to a THROWAWAY experiment id by default (exp-verify-<UTC date>), never the real
# exp-001 — a verification run must not spend the first experiment's append-only history on a test.
# All steps run the same day share that id, so re-running a step is a duplicate as designed; a
# different day gets a clean slate. To exercise a real experiment, set EXPERIMENT_ID explicitly.
set -euo pipefail

NS=statex-apps
EXPERIMENT="${EXPERIMENT_ID:-exp-verify-$(date -u +%Y%m%d)}"
VERSION="${EXPERIMENT_VERSION:-v1}"
WORKSPACE="${WORKSPACE_ID:-bazos}"
WHO="${DECIDED_BY:-ssf}"

# Stable ids per experiment version, so re-running a step is a duplicate rather than a second
# artefact — the endpoint answers 200 instead of 201 and the record stays honest.
uuid_for() { printf '%s' "$1" | md5sum | sed -E 's/^(.{8})(.{4})(.{3})(.{3})(.{12}).*/\1-\2-4\3-8\4-\5/'; }
LAUNCH_ID=$(uuid_for "$EXPERIMENT-$VERSION-launch")
CHANGE_ID=$(uuid_for "$EXPERIMENT-$VERSION-budget")
STOP_ID=$(uuid_for "$EXPERIMENT-$VERSION-stop")

# Free-text fields, collapsed to single-spaced trimmed text and then JSON-encoded. A multi-line
# shell paste inserts a literal newline plus the continuation indent into the argument; without
# this it lands inside an append-only artefact, permanently, mid-sentence. `split()` folds every
# run of whitespace (newlines included) to one space and trims the ends; json.dumps then makes any
# quote or unicode safe. The text carries the same meaning, just without the stray break.
jstr() { printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(" ".join(sys.stdin.read().split())))'; }

# A money value, stored with cents. Whole numbers are convenient to type, but a chain that mixes
# "1100" and "1000.00" reads as if the amounts were entered differently when they are equal. The
# contract accepts either form (schema `^\d+(\.\d{1,4})?$`; the server compares them equal via
# normaliseDecimal), so this is presentation only — a whole number gains ".00", a short fraction is
# padded to two places, and an already-precise 3–4dp value is left untouched.
money() {
  case "$1" in
    *.*) local i="${1%.*}" f="${1#*.}"; while [ "${#f}" -lt 2 ]; do f="${f}0"; done; printf '%s.%s' "$i" "$f" ;;
    *)   printf '%s.00' "$1" ;;
  esac
}

# The stored chain for this experiment/version, as raw JSON. Exit 2 on any failure to reach it,
# which every caller treats as "cannot confirm" rather than as "nothing is there".
chain() {
  kubectl -n "$NS" exec deploy/growth-core -c app -- node -e '
    const http = require("http");
    http.get({ host: "localhost", port: 3376, path: process.argv[1] }, (res) => {
      let d = ""; res.on("data", (c) => (d += c));
      res.on("end", () => {
        if (res.statusCode !== 200) process.exit(2);
        process.stdout.write(d);
      });
    }).on("error", () => process.exit(2));
  ' "/governance/decisions?experimentId=$EXPERIMENT&experimentVersion=$VERSION"
}

# Exit 0 iff a launch artefact already exists for this experiment/version. Used to stop the `edit`
# probe from being the FIRST write of the launch id: that id is deterministic, so an edit run before
# launch would create the artefact carrying its sentinel text as canonical — the exact incident of
# 2026-07-23. A failed query is "cannot confirm", and the probe refuses then too.
launch_exists() {
  local body
  body=$(chain) || return 2
  printf '%s' "$body" | python3 -c '
import json, sys
try:
    a = json.load(sys.stdin)
except Exception:
    sys.exit(2)
sys.exit(0 if any(x.get("decisionType") == "experiment.launch" for x in a) else 1)
'
}

# The artefact that currently holds the budget cap, printed as "<id> <value> <currency>".
#
# Read from the server rather than assumed, because the alternative is asking the operator to
# remember. `previousBudgetCap` used to come from $BUDGET: correct only while the same shell that
# launched also raises the budget, and rule V7 rejects a mismatch — so a verification run could
# fail on the operator's environment while the server was behaving perfectly. The current cap is
# the artefact nothing supersedes, which is the same definition the contract uses (C-001 V6), so
# this also targets a second budget change at the first one instead of always at the launch.
current_cap() {
  local body
  body=$(chain) || return 2
  printf '%s' "$body" | python3 -c '
import json, sys
try:
    artefacts = json.load(sys.stdin)
except Exception:
    sys.exit(2)

superseded = {a.get("supersedesArtefactId") for a in artefacts if a.get("supersedesArtefactId")}

def cap(a):
    if a.get("decisionType") == "experiment.launch":
        return a["plannedAction"]["budgetCap"]
    if a.get("decisionType") == "experiment.budget_change":
        return a["newBudgetCap"]
    return None

holders = [a for a in artefacts if cap(a) and a["decisionArtefactId"] not in superseded]
if not holders:
    sys.exit(1)

# One is the only correct answer (a partial unique index enforces it). Sorting keeps the script
# deterministic rather than accidentally right if that ever stops holding.
holder = sorted(holders, key=lambda a: a["decidedAt"])[-1]
money = cap(holder)
print(holder["decisionArtefactId"], money["value"], money["currency"])
'
}

# call METHOD PATH [BODY] [EXPECTED_STATUS]
#
# The expected status is checked here rather than printed for the reader to check. A step whose
# server answered 200 where the contract says 409 used to look identical to a passing one: same
# output, same exit code, and the eye slides over a number it already believes. The whole point of
# steps 2 and 4 is that a REFUSAL happens, so a refusal that silently stopped happening is exactly
# the regression this script exists to catch.
call() {
  # DRY_RUN=1 prints what would be sent and stops. Worth using once first: decision_artefact is
  # append-only, so anything this writes to production is there permanently — including a typo.
  if [ -n "${DRY_RUN:-}" ]; then
    echo "[dry-run] $1 $2"
    [ -n "${3:-}" ] && printf '%s\n' "$3" | python3 -m json.tool
    return 0
  fi

  local out status
  out=$(kubectl -n "$NS" exec deploy/growth-core -c app -- node -e '
    const http = require("http");
    const [method, path, body] = process.argv.slice(1);
    const opts = { host: "localhost", port: 3376, path, method,
      headers: body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {} };
    const req = http.request(opts, (res) => {
      let d = ""; res.on("data", (c) => (d += c));
      res.on("end", () => {
        console.log("HTTP", res.statusCode);
        try { console.log(JSON.stringify(JSON.parse(d), null, 2)); } catch { console.log(d); }
      });
    });
    req.on("error", (e) => { console.log("ERROR", e.message); process.exit(1); });
    if (body) req.write(body);
    req.end();
  ' "$1" "$2" "${3:-}")
  printf '%s\n' "$out"
  LAST_BODY="$out"

  local expected="${4:-}"
  [ -n "$expected" ] || return 0

  status=$(printf '%s' "$out" | sed -n 's/^HTTP \([0-9]*\).*/\1/p' | head -1)
  if [ "$status" = "$expected" ]; then
    echo "   ✓ HTTP $status, as the contract requires"
  else
    echo "   ✗ EXPECTED HTTP $expected, GOT ${status:-no status at all}" >&2
    return 1
  fi
}

common() { cat <<JSON
  "artefactVersion": 1,
  "workspaceId": "$WORKSPACE",
  "experimentId": "$EXPERIMENT",
  "experimentVersion": "$VERSION",
  "evidenceReferences": [],
  "policyVersion": "policy-v1",
  "decidedByType": "human",
  "decidedById": "$WHO",
  "decidedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
JSON
}

case "${1:-}" in
  launch)
    [ $# -eq 3 ] || { echo "usage: $0 launch \"<hypothesis>\" \"<rationale>\"" >&2; exit 1; }
    echo "── step 1: launch (expect 201, or 200 if you have run this already)"
    call POST /governance/decisions "{
      $(common),
      \"decisionArtefactId\": \"$LAUNCH_ID\",
      \"decisionType\": \"experiment.launch\",
      \"hypothesis\": $(jstr "$2"),
      \"rationale\": $(jstr "$3"),
      \"plannedAction\": {
        \"platform\": \"google_ads\",
        \"budgetCap\": { \"value\": \"$(money "${BUDGET:-1000.00}")\", \"currency\": \"CZK\" },
        \"startAt\": \"$(date -u +%Y-%m-%dT00:00:00Z)\",
        \"endAt\": \"$(date -u -d '+7 days' +%Y-%m-%dT00:00:00Z)\"
      }
    }"
    # 201 and 200 are both correct here — the second is an identical re-run, which is exactly what
    # a client-generated id is for — so this one step checks the pair rather than a single value.
    if [ -z "${DRY_RUN:-}" ]; then
      case "$(printf '%s' "$LAST_BODY" | sed -n 's/^HTTP \([0-9]*\).*/\1/p' | head -1)" in
        201) echo "   ✓ HTTP 201 — the launch artefact was written" ;;
        200) echo "   ✓ HTTP 200 — identical re-run, the stored artefact is unchanged" ;;
        *)   echo "   ✗ EXPECTED HTTP 201 (or 200 on a re-run)" >&2; exit 1 ;;
      esac
    fi
    ;;

  edit)
    echo "── step 2: attempt an edit — MUST be refused"
    echo "   Re-submitting the same id with different words. A 200 'duplicate' is not an edit:"
    echo "   the stored artefact must still carry the ORIGINAL hypothesis. Check with 'story'."
    if [ -z "${DRY_RUN:-}" ] && ! launch_exists; then
      echo >&2
      echo "   REFUSED: no launch artefact exists yet for $EXPERIMENT/$VERSION." >&2
      echo "   The edit probe must never be the FIRST write of this id — run 'launch' first." >&2
      echo "   Otherwise this sentinel text would BECOME the canonical launch (the 2026-07-23" >&2
      echo "   incident). Nothing was sent. See TASKS.md." >&2
      exit 1
    fi
    call POST /governance/decisions "{
      $(common),
      \"decisionArtefactId\": \"$LAUNCH_ID\",
      \"decisionType\": \"experiment.launch\",
      \"hypothesis\": \"EDITED — this text must never appear in the stored record.\",
      \"rationale\": \"EDITED — this text must never appear either.\",
      \"plannedAction\": {
        \"platform\": \"google_ads\",
        \"budgetCap\": { \"value\": \"999999.00\", \"currency\": \"CZK\" },
        \"startAt\": \"$(date -u +%Y-%m-%dT00:00:00Z)\",
        \"endAt\": \"$(date -u -d '+7 days' +%Y-%m-%dT00:00:00Z)\"
      }
    }" 409
    echo "   A 409 is the append-only guarantee answering: same id, different content, refused."
    ;;

  budget)
    [ $# -eq 3 ] || { echo "usage: $0 budget \"<reason>\" <newCap e.g. 2500.00>" >&2; exit 1; }
    echo "── step 5: raise the budget mid-run (expect 201)"

    # Read the cap being replaced from the record instead of from $BUDGET. Rule V7 rejects a
    # previousBudgetCap that disagrees with the artefact being superseded, so the old version
    # failed whenever the budget step ran in a different shell from the launch — a verification
    # run reporting a problem that was the operator's environment, not the server's behaviour.
    SUPERSEDES="$LAUNCH_ID"
    PREV_VALUE=$(money "${BUDGET:-1000.00}")
    PREV_CURRENCY="CZK"

    if [ -z "${DRY_RUN:-}" ]; then
      set +e
      CAP=$(current_cap); CAP_STATUS=$?
      set -e
      case "$CAP_STATUS" in
        0) read -r SUPERSEDES PREV_VALUE PREV_CURRENCY <<<"$CAP"
           echo "   current cap, read back from the record: $PREV_VALUE $PREV_CURRENCY (held by $SUPERSEDES)" ;;
        1) echo "   REFUSED: no artefact holds a budget cap for $EXPERIMENT/$VERSION — run 'launch' first." >&2
           exit 1 ;;
        *) echo "   REFUSED: could not read the decision chain, so the cap being replaced is unknown." >&2
           echo "   Sending a guessed previousBudgetCap would either be rejected by rule V7 or, worse," >&2
           echo "   be accepted against an artefact you did not mean. Nothing was sent." >&2
           exit 1 ;;
      esac
    fi

    call POST /governance/decisions "{
      $(common),
      \"decisionArtefactId\": \"$CHANGE_ID\",
      \"decisionType\": \"experiment.budget_change\",
      \"reason\": $(jstr "$2"),
      \"supersedesArtefactId\": \"$SUPERSEDES\",
      \"previousBudgetCap\": { \"value\": \"$(money "$PREV_VALUE")\", \"currency\": \"$PREV_CURRENCY\" },
      \"newBudgetCap\": { \"value\": \"$(money "$3")\", \"currency\": \"$PREV_CURRENCY\" },
      \"effectiveFrom\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
    }" 201
    ;;

  stop-bare)
    echo "── step 4: stop with no reason — MUST be refused (expect 422)"
    call POST /governance/decisions "{
      $(common),
      \"decisionArtefactId\": \"$STOP_ID\",
      \"decisionType\": \"experiment.stop\",
      \"reason\": \"   \",
      \"stoppedAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
    }" 422
    # A 422 alone would not prove this step. The server also answers 422 when no launch exists for
    # the experiment (rule V5), so on a fresh throwaway id this could pass while the blank-reason
    # rule was never exercised at all — the step would be checking the operator's ordering instead
    # of the contract.
    if [ -z "${DRY_RUN:-}" ]; then
      if printf '%s' "$LAST_BODY" | grep -q '"path": "/reason"'; then
        echo "   ✓ refused on /reason — blank free text is rejected, not defaulted"
      else
        echo "   ✗ 422, but NOT for the blank reason — read the failures above" >&2
        exit 1
      fi
    fi
    ;;

  stop)
    [ $# -eq 2 ] || { echo "usage: $0 stop \"<reason>\"" >&2; exit 1; }
    echo "── step 6: stop with a reason (expect 201)"
    call POST /governance/decisions "{
      $(common),
      \"decisionArtefactId\": \"$STOP_ID\",
      \"decisionType\": \"experiment.stop\",
      \"reason\": $(jstr "$2"),
      \"stoppedAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
    }" 201
    ;;

  cap)
    # F-001 step 5 asks for more than "the change was recorded": the effective cap has to be
    # RECONSTRUCTABLE from the chain. This prints what the record says it is, by the contract's own
    # definition — the artefact nothing supersedes — rather than by anyone's memory of the raise.
    echo "── the effective budget cap for $EXPERIMENT/$VERSION, rebuilt from the chain"
    set +e
    CAP=$(current_cap); CAP_STATUS=$?
    set -e
    case "$CAP_STATUS" in
      0) read -r HOLDER VALUE CURRENCY <<<"$CAP"
         # Printed exactly as stored, NOT through money(). This command answers "what does the
         # record say", and padding "1100" to "1100.00" here would hide a scale inconsistency
         # instead of showing it — which is the opposite of what an audit read is for.
         echo "   $VALUE $CURRENCY"
         echo "   established by $HOLDER, superseded by nothing" ;;
      1) echo "   no artefact holds a cap — nothing has been launched for this experiment/version" ;;
      *) echo "   could not read the decision chain" >&2; exit 1 ;;
    esac
    ;;

  story)
    echo "── read the chain back (steps 3 and 6)"
    echo "   Does this explain WHY, without needing your memory of the day?"
    call GET "/governance/decisions?experimentId=$EXPERIMENT&experimentVersion=$VERSION"
    ;;

  *)
    sed -n '2,22p' "$0"
    exit 1
    ;;
esac

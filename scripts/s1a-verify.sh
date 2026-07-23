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
#   ./scripts/s1a-verify.sh story                      # read the chain back
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

# Exit 0 iff a launch artefact already exists for this experiment/version. Used to stop the `edit`
# probe from being the FIRST write of the launch id: that id is deterministic, so an edit run before
# launch would create the artefact carrying its sentinel text as canonical — the exact incident of
# 2026-07-23. Exit 2 (query failed) is treated as "cannot confirm", and the probe refuses too.
launch_exists() {
  kubectl -n "$NS" exec deploy/growth-core -c app -- node -e '
    const http = require("http");
    const [path, id] = process.argv.slice(1);
    http.get({ host: "localhost", port: 3376, path }, (res) => {
      let d = ""; res.on("data", (c) => (d += c));
      res.on("end", () => {
        try { const a = JSON.parse(d); process.exit(Array.isArray(a) && a.some((x) => x.decisionArtefactId === id) ? 0 : 1); }
        catch { process.exit(2); }
      });
    }).on("error", () => process.exit(2));
  ' "/governance/decisions?experimentId=$EXPERIMENT&experimentVersion=$VERSION" "$LAUNCH_ID"
}

call() { # method path [body]
  # DRY_RUN=1 prints what would be sent and stops. Worth using once first: decision_artefact is
  # append-only, so anything this writes to production is there permanently — including a typo.
  if [ -n "${DRY_RUN:-}" ]; then
    echo "[dry-run] $1 $2"
    [ -n "${3:-}" ] && printf '%s\n' "$3" | python3 -m json.tool
    return 0
  fi
  kubectl -n "$NS" exec deploy/growth-core -c app -- node -e '
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
  ' "$1" "$2" "${3:-}"
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
    }"
    echo
    echo "   Expected: 409 conflict (same id, different content)."
    ;;

  budget)
    [ $# -eq 3 ] || { echo "usage: $0 budget \"<reason>\" <newCap e.g. 2500.00>" >&2; exit 1; }
    echo "── step 5: raise the budget mid-run (expect 201)"
    call POST /governance/decisions "{
      $(common),
      \"decisionArtefactId\": \"$CHANGE_ID\",
      \"decisionType\": \"experiment.budget_change\",
      \"reason\": $(jstr "$2"),
      \"supersedesArtefactId\": \"$LAUNCH_ID\",
      \"previousBudgetCap\": { \"value\": \"$(money "${BUDGET:-1000.00}")\", \"currency\": \"CZK\" },
      \"newBudgetCap\": { \"value\": \"$(money "$3")\", \"currency\": \"CZK\" },
      \"effectiveFrom\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
    }"
    ;;

  stop-bare)
    echo "── step 4: stop with no reason — MUST be refused (expect 422)"
    call POST /governance/decisions "{
      $(common),
      \"decisionArtefactId\": \"$STOP_ID\",
      \"decisionType\": \"experiment.stop\",
      \"reason\": \"   \",
      \"stoppedAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
    }"
    echo
    echo "   Expected: 422. Blank free text is rejected, not defaulted."
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
    }"
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

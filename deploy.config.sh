# deploy.config.sh — declaration consumed by shared/scripts/deploy.sh.
# See shared/docs/DEPLOY_STANDARD.md for the full format and permanent hooks.
# Prove changes with `shared/scripts/deploy.sh growth --dry-run` before a real deploy.
#
# One repository, several containers — the auth-microservice / monitoring-microservice
# pattern. The platform's slices are separate deployables (growth-core now, growth-web at
# S5) but not separate repositories: the contracts in docs/ and the code implementing them
# have to move together, and splitting them across repos is what lets a document and its
# implementation drift apart unnoticed.

SERVICE_NAME="growth"
PORT="3376"
# NAMESPACE="statex-apps"    # optional, this is already the default
# REGISTRY="localhost:5000"  # optional, this is already the default

# image[i] = "image-name|build-context|dockerfile|extra-docker-args"
# build-context and dockerfile are both relative to the repo root.
#
# The context is the repo root, not services/core: the build regenerates the JSON schema
# from the contract in docs/, so it needs both trees. See services/core/Dockerfile.
IMAGES=(
  "growth-core|.|services/core/Dockerfile|"
  # S5: "growth-web|.|services/web/Dockerfile|"
)

# deployment[i] = "k8s-deployment|container|image-name"
DEPLOYMENTS=(
  "growth-core|app|growth-core"
  # S5: "growth-web|app|growth-web"
)

# No ingress.yaml — growth-core is ClusterIP-only, deliberately.
#
# POST /governance/decisions writes the audit record of why money was spent, and S1a ships
# no authentication (none was in scope: the only caller is the owner, from inside the
# cluster). A public ingress would let anyone author entries in that record.
#
# When S5 adds growth-web, the ingress arrives with it and routes growth.alfares.cz/ to the
# web container only — growth-core stays off the public routing table. Sharing a repository
# does not put it on the internet; only a path in an ingress does that.
MANIFESTS=(configmap.yaml external-secret.yaml deployment.yaml service.yaml)

# Optional hooks — uncomment and implement only what you actually need.

# deploy_post_manifests() {
#   # TODO (TASKS.md): pin the migrate init container to the build tag. The runner's
#   # `kubectl set image` targets the app container only, so migrate stays on :latest —
#   # a rollback to an older tag would run new migrations against old application code.
#   :
# }

deploy_post_verify() {
  # SERVICE_NAME is "growth" (the repository), but the pods are labelled per deployable.
  # The runner's built-in check looks for app=growth and finds nothing, so it passes
  # vacuously — every container in this repo needs its own explicit health check here.
  local deployable
  for deployable in growth-core; do
    local pod
    pod=$(kubectl get pod -n "$NAMESPACE" -l app="$deployable" \
      -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
    if [ -z "$pod" ]; then
      echo "No pod found for ${deployable} — deploy did not produce a running container." >&2
      return 1
    fi
    kubectl exec -n "$NAMESPACE" "$pod" -- \
      node -e "require('http').get('http://localhost:3376/health',(r)=>{let b='';r.on('data',d=>b+=d);r.on('end',()=>{if(r.statusCode!==200)process.exit(1);process.stdout.write(b+'\n')})}).on('error',()=>process.exit(1))" \
      || { echo "${deployable} health check failed." >&2; return 1; }
  done
}

#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/lib/deploy-config.sh"

DEPLOY_ENV_FILE="${DEPLOY_ENV_FILE:-$ROOT_DIR/deploy/deploy.env}"
TARGET_ARG=""
TAG_ARG=""

usage() {
  cat <<EOF
Usage:
  scripts/deploy-images.sh --target <user@host> --tag <tag>
  scripts/deploy-images.sh --tag <tag>
  scripts/deploy-images.sh <user@host> <tag>

Deployment target can also be set in deploy/deploy.env:
  PROXYPARSER_DEPLOY_TARGET=root@example.com

Options:
  --target <user@host>    SSH target for upload and remote compose commands.
  --tag <tag>             Image tag to deploy. Defaults to the current git short SHA.
  --env-file <path>       Local deploy env file. Defaults to deploy/deploy.env.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      [[ $# -ge 2 ]] || { echo "--target requires a value" >&2; exit 2; }
      TARGET_ARG="${2:-}"
      shift 2
      ;;
    --tag)
      [[ $# -ge 2 ]] || { echo "--tag requires a value" >&2; exit 2; }
      TAG_ARG="${2:-}"
      shift 2
      ;;
    --env-file)
      [[ $# -ge 2 ]] || { echo "--env-file requires a value" >&2; exit 2; }
      DEPLOY_ENV_FILE="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      break
      ;;
    *)
      if [[ -z "$TARGET_ARG" ]]; then
        TARGET_ARG="$1"
      elif [[ -z "$TAG_ARG" ]]; then
        TAG_ARG="$1"
      else
        echo "Unexpected argument: $1" >&2
        usage >&2
        exit 2
      fi
      shift
      ;;
  esac
done

DEPLOY_CONFIG="$(resolve_deploy_config "$TARGET_ARG" "$TAG_ARG" "$DEPLOY_ENV_FILE")"
while IFS='=' read -r key value; do
  case "$key" in
    TARGET) TARGET="$value" ;;
    TAG) TAG="$value" ;;
    REMOTE_ROOT) REMOTE_ROOT="$value" ;;
    OUTPUT_DIR) OUTPUT_DIR="$value" ;;
  esac
done <<< "$DEPLOY_CONFIG"

validate_image_tag "$TAG"
validate_remote_root "$REMOTE_ROOT"

REMOTE_IMAGE_DIR="$REMOTE_ROOT/images"
REMOTE_DEPLOY_DIR="$REMOTE_ROOT/deploy"

BACKEND_ARCHIVE="$OUTPUT_DIR/proxyparser-backend-$TAG.tar.gz"
FRONTEND_ARCHIVE="$OUTPUT_DIR/proxyparser-frontend-$TAG.tar.gz"

if [[ ! -f "$BACKEND_ARCHIVE" || ! -f "$FRONTEND_ARCHIVE" ]]; then
  cat >&2 <<EOF
Image archives not found for tag $TAG.
Expected:
  $BACKEND_ARCHIVE
  $FRONTEND_ARCHIVE

Build them first:
  $ROOT_DIR/scripts/build-images.sh $TAG
EOF
  exit 1
fi

if ! ssh "$TARGET" 'test "$(id -u)" -eq 0'; then
  echo "ProxyParser archive deployment currently requires a root SSH target so host data ownership remains consistent with the root-running backend container." >&2
  exit 2
fi

ssh "$TARGET" "mkdir -p '$REMOTE_IMAGE_DIR' '$REMOTE_DEPLOY_DIR'"
scp "$BACKEND_ARCHIVE" "$FRONTEND_ARCHIVE" "$TARGET:$REMOTE_IMAGE_DIR/"
scp \
  "$ROOT_DIR/deploy/docker-compose.yml" \
  "$ROOT_DIR/deploy/.env.example" \
  "$ROOT_DIR/scripts/lib/deploy-config.sh" \
  "$TARGET:$REMOTE_DEPLOY_DIR/"

NGINX_CONFIG_UPLOADED=0
if [[ -f "$ROOT_DIR/deploy/nginx-proxyparser.conf" ]]; then
  scp "$ROOT_DIR/deploy/nginx-proxyparser.conf" "$TARGET:$REMOTE_DEPLOY_DIR/"
  NGINX_CONFIG_UPLOADED=1
else
  cat >&2 <<EOF
Skipping host Nginx config upload because deploy/nginx-proxyparser.conf is not present.
Copy deploy/nginx-proxyparser.conf.example to deploy/nginx-proxyparser.conf and fill in local values if this deploy should update host Nginx.
EOF
fi

ssh "$TARGET" "TAG='$TAG' REMOTE_ROOT='$REMOTE_ROOT' bash -s" <<'REMOTE_SCRIPT'
set -euo pipefail
if [[ "$(id -u)" -ne 0 ]]; then
  echo "Remote deployment must run as root." >&2
  exit 2
fi
cd "$REMOTE_ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed on the server. Install Docker first, then rerun deploy-images.sh." >&2
  exit 1
fi

if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
else
  echo "Docker Compose is not installed on the server. Install the compose plugin first." >&2
  exit 1
fi

cd deploy
source ./deploy-config.sh
validate_image_tag "$TAG"
validate_remote_root "$REMOTE_ROOT"
clear_compose_runtime_overrides

if [[ ! -f .env ]]; then
  create_runtime_env_file .env.example .env
fi
secure_runtime_env_file .env
validate_runtime_env_file .env
validate_runtime_env_configuration .env

PUBLIC_BASE_URL_VALUE="$(read_env_assignment .env PUBLIC_BASE_URL)"
validate_public_base_url "$PUBLIC_BASE_URL_VALUE" "$PWD/.env"

PERSISTENT_DATA_DIR="$(read_env_assignment .env PROXYPARSER_DATA_DIR)"
PERSISTENT_DATA_DIR="${PERSISTENT_DATA_DIR:-/var/lib/proxyparser}"
assert_container_data_mount proxyparser-backend "$PERSISTENT_DATA_DIR"
assert_no_versioned_database_artifacts "$PERSISTENT_DATA_DIR"
ensure_secure_data_dir "$PERSISTENT_DATA_DIR"

PP_SECRET_KEY_VALUE="$(read_env_assignment .env PP_SECRET_KEY)"
migrate_legacy_container_secret_key \
  proxyparser-backend \
  "$PERSISTENT_DATA_DIR" \
  "$PP_SECRET_KEY_VALUE"

# Pin the effective persisted key into the protected .env before replacement.
# This keeps rollback to images that still read /app/backend/data/.secret-key safe.
if PERSISTED_SECRET_KEY="$(read_secret_key_file "$PERSISTENT_DATA_DIR/.secret-key" 2>/dev/null)"; then
  set_env_assignment_atomically .env PP_SECRET_KEY "$PERSISTED_SECRET_KEY"
fi
validate_runtime_env_configuration .env

cd "$REMOTE_ROOT"
gunzip -c "images/proxyparser-backend-$TAG.tar.gz" | docker load
gunzip -c "images/proxyparser-frontend-$TAG.tar.gz" | docker load

cd deploy
PREVIOUS_IMAGE_TAG="$(read_env_assignment .env IMAGE_TAG)"
set_env_assignment_atomically .env IMAGE_TAG "$TAG"
validate_runtime_env_configuration .env
if ! "${COMPOSE[@]}" up -d; then
  set_env_assignment_atomically .env IMAGE_TAG "$PREVIOUS_IMAGE_TAG"
  echo "Compose failed to apply tag $TAG; restored IMAGE_TAG in .env to its previous value." >&2
  exit 2
fi
"${COMPOSE[@]}" ps

# A brand-new deployment with no explicit key creates /data/.secret-key during
# backend startup. Pin it for future rollback once it appears.
if [[ -z "$(read_env_assignment .env PP_SECRET_KEY)" ]]; then
  for ((attempt = 0; attempt < 40; attempt += 1)); do
    if PERSISTED_SECRET_KEY="$(read_secret_key_file "$PERSISTENT_DATA_DIR/.secret-key" 2>/dev/null)"; then
      set_env_assignment_atomically .env PP_SECRET_KEY "$PERSISTED_SECRET_KEY"
      break
    fi
    sleep 0.25
  done
  if [[ -z "$(read_env_assignment .env PP_SECRET_KEY)" ]]; then
    echo "Backend did not create a persistent encryption key; refusing to declare deployment complete." >&2
    exit 2
  fi
fi
ensure_secure_data_dir "$PERSISTENT_DATA_DIR"
secure_runtime_env_file .env
if ! wait_for_http_health proxyparser-backend http://127.0.0.1:3001/api/health Backend ||
   ! wait_for_http_health proxyparser-backend http://frontend/ Frontend; then
  echo "Tag $TAG failed post-deploy health checks; rolling back to $PREVIOUS_IMAGE_TAG." >&2
  if [[ -z "$PREVIOUS_IMAGE_TAG" ]]; then
    echo "No previous image tag exists for automatic rollback." >&2
    exit 2
  fi
  set_env_assignment_atomically .env IMAGE_TAG "$PREVIOUS_IMAGE_TAG"
  validate_runtime_env_configuration .env
  "${COMPOSE[@]}" up -d
  wait_for_http_health proxyparser-backend http://127.0.0.1:3001/api/health "Rolled-back backend"
  wait_for_http_health proxyparser-backend http://frontend/ "Rolled-back frontend"
  exit 2
fi
REMOTE_SCRIPT

cat <<EOF
Uploaded and started ProxyParser tag $TAG on $TARGET.
EOF

if [[ "$NGINX_CONFIG_UPLOADED" == "1" ]]; then
  cat <<EOF
Next, install/reload Nginx config if needed:
  ssh $TARGET 'cp $REMOTE_DEPLOY_DIR/nginx-proxyparser.conf /etc/nginx/conf.d/proxyparser.conf && nginx -t && systemctl reload nginx'
EOF
else
  cat <<EOF
Host Nginx config was not uploaded. To manage it with this deploy flow, copy deploy/nginx-proxyparser.conf.example to deploy/nginx-proxyparser.conf, fill in local values, and rerun the script.
EOF
fi

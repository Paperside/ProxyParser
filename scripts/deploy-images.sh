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
  PROXYPARSER_DEPLOY_TARGET=user@example.com

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

ssh "$TARGET" "mkdir -p '$REMOTE_IMAGE_DIR' '$REMOTE_DEPLOY_DIR' /var/lib/proxyparser"
scp "$BACKEND_ARCHIVE" "$FRONTEND_ARCHIVE" "$TARGET:$REMOTE_IMAGE_DIR/"
scp "$ROOT_DIR/deploy/docker-compose.yml" "$ROOT_DIR/deploy/.env.example" "$TARGET:$REMOTE_DEPLOY_DIR/"

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

gunzip -c "images/proxyparser-backend-$TAG.tar.gz" | docker load
gunzip -c "images/proxyparser-frontend-$TAG.tar.gz" | docker load

cd deploy
if [[ ! -f .env ]]; then
  cp .env.example .env
  SECRET="$(openssl rand -hex 32 2>/dev/null || tr -dc A-Za-z0-9 </dev/urandom | head -c 64)"
  sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$SECRET/" .env
fi
sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=$TAG/" .env

"${COMPOSE[@]}" up -d
"${COMPOSE[@]}" ps
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

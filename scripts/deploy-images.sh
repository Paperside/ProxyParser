#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${1:-root@59.110.154.29}"
TAG="${2:-$(git -C "$ROOT_DIR" rev-parse --short HEAD)}"
OUTPUT_DIR="${OUTPUT_DIR:-$ROOT_DIR/dist/images}"
REMOTE_ROOT="${REMOTE_ROOT:-/opt/proxyparser}"
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
scp "$ROOT_DIR/deploy/docker-compose.yml" "$ROOT_DIR/deploy/.env.example" "$ROOT_DIR/deploy/nginx-proxyparser.conf" "$TARGET:$REMOTE_DEPLOY_DIR/"

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
Next, install/reload Nginx config if needed:
  ssh $TARGET 'cp $REMOTE_DEPLOY_DIR/nginx-proxyparser.conf /etc/nginx/conf.d/proxyparser.conf && nginx -t && systemctl reload nginx'
EOF

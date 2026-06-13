#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TAG="${1:-$(git -C "$ROOT_DIR" rev-parse --short HEAD)}"
PLATFORM="${PLATFORM:-linux/amd64}"
OUTPUT_DIR="${OUTPUT_DIR:-$ROOT_DIR/dist/images}"
VITE_API_BASE_URL="${VITE_API_BASE_URL:-}"

mkdir -p "$OUTPUT_DIR"

cd "$ROOT_DIR"
if [[ ! -d "$ROOT_DIR/frontend/dist" ]]; then
  echo "Building frontend dist on the host before packaging the nginx image."
  VITE_API_BASE_URL="$VITE_API_BASE_URL" bun run --filter @proxyparser/frontend build
fi

if ! docker info >/dev/null 2>&1; then
  cat >&2 <<'MSG'
Docker is not reachable. If you use Colima, start it first:

  colima start
  docker context use colima   # if your Docker context is not already wired to Colima

MSG
  exit 1
fi

echo "Building ProxyParser images"
echo "  tag:      $TAG"
echo "  platform: $PLATFORM"
echo "  output:   $OUTPUT_DIR"

build_image_archive() {
  local name="$1"
  local dockerfile="$2"
  local archive="$3"
  shift 3

  if docker buildx version >/dev/null 2>&1; then
    docker buildx build \
      --platform "$PLATFORM" \
      -f "$dockerfile" \
      -t "$name:$TAG" \
      --output "type=docker,dest=$archive" \
      "$@" \
      "$ROOT_DIR"
  else
    echo "docker buildx is not installed; falling back to docker build + docker save."
    docker build \
      --platform "$PLATFORM" \
      -f "$dockerfile" \
      -t "$name:$TAG" \
      "$@" \
      "$ROOT_DIR"
    docker save "$name:$TAG" -o "$archive"
  fi
}

build_image_archive \
  "proxyparser-backend" \
  "$ROOT_DIR/backend/Dockerfile" \
  "$OUTPUT_DIR/proxyparser-backend-$TAG.tar"

gzip -f "$OUTPUT_DIR/proxyparser-backend-$TAG.tar"

build_image_archive \
  "proxyparser-frontend" \
  "$ROOT_DIR/frontend/Dockerfile" \
  "$OUTPUT_DIR/proxyparser-frontend-$TAG.tar" \
  --build-arg "VITE_API_BASE_URL=$VITE_API_BASE_URL"

gzip -f "$OUTPUT_DIR/proxyparser-frontend-$TAG.tar"

cat <<EOF
Built image archives:
  $OUTPUT_DIR/proxyparser-backend-$TAG.tar.gz
  $OUTPUT_DIR/proxyparser-frontend-$TAG.tar.gz

Deploy with:
  $ROOT_DIR/scripts/deploy-images.sh --target <user@host> --tag $TAG

Or copy deploy/deploy.env.example to deploy/deploy.env, set PROXYPARSER_DEPLOY_TARGET,
and run:
  $ROOT_DIR/scripts/deploy-images.sh --tag $TAG
EOF

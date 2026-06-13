#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/scripts/lib/deploy-config.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_eq() {
  local expected="$1"
  local actual="$2"
  local label="$3"

  [[ "$actual" == "$expected" ]] || fail "$label: expected '$expected', got '$actual'"
}

with_tmpdir() {
  local tmpdir
  tmpdir="$(mktemp -d)"
  "$@" "$tmpdir"
  rm -rf "$tmpdir"
}

test_requires_target_without_config() {
  local tmpdir="$1"
  local output

  if output="$(resolve_deploy_config "" "test-tag" "$tmpdir/missing.env" 2>&1)"; then
    fail "resolve_deploy_config should fail when no target is configured"
  fi

  [[ "$output" == *"PROXYPARSER_DEPLOY_TARGET"* ]] || fail "missing target error should mention PROXYPARSER_DEPLOY_TARGET"
}

test_reads_target_from_env_file() {
  local tmpdir="$1"
  local env_file="$tmpdir/deploy.env"
  local output

  cat > "$env_file" <<'ENV'
PROXYPARSER_DEPLOY_TARGET=deploy@example.internal
PROXYPARSER_REMOTE_ROOT=/srv/proxyparser
ENV

  output="$(resolve_deploy_config "" "test-tag" "$env_file")"

  assert_eq "deploy@example.internal" "$(printf '%s\n' "$output" | awk -F= '$1 == "TARGET" { print $2 }')" "target from env file"
  assert_eq "/srv/proxyparser" "$(printf '%s\n' "$output" | awk -F= '$1 == "REMOTE_ROOT" { print $2 }')" "remote root from env file"
}

test_explicit_target_overrides_env_file() {
  local tmpdir="$1"
  local env_file="$tmpdir/deploy.env"
  local output

  cat > "$env_file" <<'ENV'
PROXYPARSER_DEPLOY_TARGET=deploy@example.internal
PROXYPARSER_REMOTE_ROOT=/srv/proxyparser
ENV

  output="$(resolve_deploy_config "deploy@override.internal" "test-tag" "$env_file")"

  assert_eq "deploy@override.internal" "$(printf '%s\n' "$output" | awk -F= '$1 == "TARGET" { print $2 }')" "explicit target"
}

with_tmpdir test_requires_target_without_config
with_tmpdir test_reads_target_from_env_file
with_tmpdir test_explicit_target_overrides_env_file

echo "deploy-config tests passed"

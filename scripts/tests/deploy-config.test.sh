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
  tmpdir="$(cd "$tmpdir" && pwd -P)"
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

test_runtime_env_value_and_public_url_validation() {
  local tmpdir="$1"
  local env_file="$tmpdir/runtime.env"
  local output

  cat > "$env_file" <<'ENV'
PUBLIC_BASE_URL=
PROXYPARSER_DATA_DIR="/srv/proxyparser data"
ENV

  assert_eq "" "$(read_env_assignment "$env_file" PUBLIC_BASE_URL)" "empty public URL"
  assert_eq "/srv/proxyparser data" "$(read_env_assignment "$env_file" PROXYPARSER_DATA_DIR)" "quoted runtime env value"

  if output="$(validate_public_base_url "" "$env_file" 2>&1)"; then
    fail "empty PUBLIC_BASE_URL should fail"
  fi
  [[ "$output" == *"PUBLIC_BASE_URL"* ]] || fail "empty URL error should mention PUBLIC_BASE_URL"

  if validate_public_base_url "https://proxyparser.example.com" "$env_file" >/dev/null 2>&1; then
    fail "example.com PUBLIC_BASE_URL should fail"
  fi
  validate_public_base_url "https://proxy.example.internal" "$env_file"

  local invalid_url
  for invalid_url in \
    "https://proxy.example.internal/" \
    "https://proxy.example.internal/prefix" \
    "https://proxy.example.internal:bad" \
    "https://proxy.example.internal:65536" \
    "https://user@proxy.example.internal" \
    "https://[:::]" \
    "https://[:]" \
    "https://999.999.999.999"; do
    if validate_public_base_url "$invalid_url" "$env_file" >/dev/null 2>&1; then
      fail "non-canonical PUBLIC_BASE_URL should fail: $invalid_url"
    fi
  done
  validate_public_base_url "https://proxy.example.internal:8443" "$env_file"
}

test_secure_runtime_env_bootstrap_and_validation() {
  local tmpdir="$1"
  local example_file="$tmpdir/.env.example"
  local env_file="$tmpdir/.env"
  local mode jwt_secret

  cat > "$example_file" <<'ENV'
IMAGE_TAG=local
PROXYPARSER_DATA_DIR=/var/lib/proxyparser
PUBLIC_BASE_URL=
JWT_SECRET=replace-with-a-long-random-secret
PP_SECRET_KEY=
ENV

  create_runtime_env_file "$example_file" "$env_file" definitely-missing-openssl
  mode="$(read_path_mode "$env_file")"
  assert_eq "600" "$mode" "runtime env permissions"
  jwt_secret="$(read_env_assignment "$env_file" JWT_SECRET)"
  validate_jwt_secret "$jwt_secret" "$env_file"
  [[ "$jwt_secret" != "replace-with-a-long-random-secret" ]] || fail "JWT placeholder must be replaced"

  set_env_assignment_atomically "$env_file" PUBLIC_BASE_URL https://proxy.example.internal
  set_env_assignment_atomically "$env_file" IMAGE_TAG release-123
  validate_runtime_env_configuration "$env_file"

  set_env_assignment_atomically "$env_file" JWT_SECRET replace-with-a-long-random-secret
  if validate_runtime_env_configuration "$env_file" >/dev/null 2>&1; then
    fail "placeholder JWT_SECRET should fail every deployment"
  fi
}

test_runtime_env_rejects_ambiguous_syntax() {
  local tmpdir="$1"
  local env_file="$tmpdir/.env"

  cat > "$env_file" <<'ENV'
PUBLIC_BASE_URL=https://proxy.example.internal # inline comment
JWT_SECRET=0123456789abcdef0123456789abcdef
ENV
  chmod 600 "$env_file"
  if validate_runtime_env_file "$env_file" >/dev/null 2>&1; then
    fail "inline comments must be rejected to match Compose preflight semantics"
  fi

  cat > "$env_file" <<'ENV'
PUBLIC_BASE_URL=https://proxy.example.internal
PUBLIC_BASE_URL=https://other.example.internal
ENV
  if validate_runtime_env_file "$env_file" >/dev/null 2>&1; then
    fail "duplicate runtime keys must be rejected"
  fi

  cat > "$env_file" <<'ENV'
COMPOSE_FILE=attacker.yml
ENV
  if validate_runtime_env_file "$env_file" >/dev/null 2>&1; then
    fail "reserved Compose keys in .env must be rejected"
  fi
}

test_secure_data_dir_permissions() {
  local tmpdir="$1"
  local data_dir="$tmpdir/data"

  mkdir -m 755 "$data_dir"
  printf 'db' > "$data_dir/proxyparser.sqlite"
  printf 'key' > "$data_dir/.secret-key"
  ensure_secure_data_dir "$data_dir"
  assert_eq "700" "$(read_path_mode "$data_dir")" "persistent data directory permissions"
  assert_eq "600" "$(read_path_mode "$data_dir/proxyparser.sqlite")" "database permissions"
  assert_eq "600" "$(read_path_mode "$data_dir/.secret-key")" "key permissions"
  assert_eq "600" "$(read_path_mode "$data_dir/.proxyparser-data-dir")" "data directory marker permissions"

  local unsafe_path
  for unsafe_path in / /etc /var /var/lib /home /var/lib/../etc /var//lib/proxyparser /var/lib/proxyparser/; do
    if validate_persistent_data_dir "$unsafe_path" >/dev/null 2>&1; then
      fail "unsafe persistent path should fail: $unsafe_path"
    fi
  done

  local unrelated_dir="$tmpdir/unrelated"
  mkdir -p "$unrelated_dir"
  printf 'do not touch' > "$unrelated_dir/host-config"
  chmod 755 "$unrelated_dir"
  if ensure_secure_data_dir "$unrelated_dir" >/dev/null 2>&1; then
    fail "an existing unrelated directory must not be claimed as ProxyParser data"
  fi
  assert_eq "755" "$(read_path_mode "$unrelated_dir")" "unrelated directory permissions remain unchanged"

  local symlink_dir="$tmpdir/symlink-data"
  mkdir -p "$symlink_dir"
  ln -s "$tmpdir/missing-marker-target" "$symlink_dir/.proxyparser-data-dir"
  if ensure_secure_data_dir "$symlink_dir" >/dev/null 2>&1; then
    fail "a dangling data marker symlink must fail closed"
  fi
  [[ ! -e "$tmpdir/missing-marker-target" ]] || fail "marker validation must not follow dangling symlinks"

  local real_parent="$tmpdir/real-parent"
  local linked_parent="$tmpdir/linked-parent"
  mkdir -p "$real_parent"
  ln -s "$real_parent" "$linked_parent"
  if ensure_secure_data_dir "$linked_parent/proxyparser" >/dev/null 2>&1; then
    fail "a symlink in a parent path component must fail closed"
  fi
  [[ ! -e "$real_parent/proxyparser" ]] || fail "parent symlink validation must happen before mkdir/chmod"
}

test_runtime_numeric_validation() {
  local tmpdir="$1"
  local env_file="$tmpdir/.env"

  cat > "$env_file" <<'ENV'
IMAGE_TAG=release-123
PROXYPARSER_DATA_DIR=/var/lib/proxyparser
PUBLIC_BASE_URL=https://proxy.example.internal
JWT_SECRET=0123456789abcdef0123456789abcdef
PP_SECRET_KEY=
JWT_ACCESS_TTL_SECONDS=900
JWT_REFRESH_TTL_SECONDS=2592000
SUBSCRIPTION_TEMP_TOKEN_TTL_SECONDS=86400
SOURCE_SYNC_INTERVAL_MINUTES=360
ENV
  chmod 600 "$env_file"
  validate_runtime_env_configuration "$env_file"

  set_env_assignment_atomically "$env_file" SOURCE_SYNC_INTERVAL_MINUTES nope
  if validate_runtime_env_configuration "$env_file" >/dev/null 2>&1; then
    fail "non-numeric source sync interval must fail"
  fi
  set_env_assignment_atomically "$env_file" SOURCE_SYNC_INTERVAL_MINUTES 360
  set_env_assignment_atomically "$env_file" SUBSCRIPTION_TEMP_TOKEN_TTL_SECONDS 3599
  if validate_runtime_env_configuration "$env_file" >/dev/null 2>&1; then
    fail "too-short temporary token TTL must fail"
  fi
}

test_versioned_database_preflight_and_health() {
  local tmpdir="$1"
  local data_dir="$tmpdir/data"
  local fake_docker="$tmpdir/docker"

  mkdir -p "$data_dir"
  assert_no_versioned_database_artifacts "$data_dir"
  printf 'wal' > "$data_dir/proxyparser.v2.sqlite-wal"
  if assert_no_versioned_database_artifacts "$data_dir" >/dev/null 2>&1; then
    fail "versioned database sidecars must block deployment"
  fi
  rm -f "$data_dir/proxyparser.v2.sqlite-wal"

  write_fake_docker "$fake_docker"
  export FAKE_HEALTHY=1
  wait_for_http_health proxyparser-backend http://backend/health Backend "$fake_docker" 1 0
  export FAKE_HEALTHY=0
  if wait_for_http_health proxyparser-backend http://backend/health Backend "$fake_docker" 1 0 >/dev/null 2>&1; then
    fail "failed backend health should block deployment completion"
  fi

  export FAKE_CONTAINER_EXISTS=1
  export FAKE_DATA_MOUNT="$data_dir"
  assert_container_data_mount proxyparser-backend "$data_dir" "$fake_docker"
  export FAKE_DATA_MOUNT="$tmpdir/other-data"
  if assert_container_data_mount proxyparser-backend "$data_dir" "$fake_docker" >/dev/null 2>&1; then
    fail "changing an existing container data mount must fail closed"
  fi
}

test_clear_compose_overrides() {
  local _tmpdir="$1"
  export PUBLIC_BASE_URL=https://wrong.example.internal
  export PROXYPARSER_DATA_DIR=/wrong
  export PP_SECRET_KEY=abcdef
  export COMPOSE_FILE=wrong.yml
  clear_compose_runtime_overrides
  [[ -z "${PUBLIC_BASE_URL+x}${PROXYPARSER_DATA_DIR+x}${PP_SECRET_KEY+x}${COMPOSE_FILE+x}" ]] ||
    fail "compose runtime overrides should be unset before preflight and compose"
}

test_deploy_path_and_tag_validation() {
  local _tmpdir="$1"
  validate_image_tag release-20260711
  validate_remote_root /opt/proxyparser
  if validate_image_tag "bad tag" >/dev/null 2>&1; then
    fail "image tag with whitespace should fail"
  fi
  if validate_remote_root "/opt/proxyparser/../escape" >/dev/null 2>&1; then
    fail "remote root traversal should fail"
  fi
}

write_fake_docker() {
  local path="$1"
  cat > "$path" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail

case "${1:-}" in
  inspect)
    [[ "${FAKE_CONTAINER_EXISTS:-0}" == "1" ]] || exit 1
    if [[ "${2:-}" == "--format" && "${3:-}" == *".Mounts"* ]]; then
      printf '%s\n' "${FAKE_DATA_MOUNT:-}"
    elif [[ "${2:-}" == "--format" && "${FAKE_ENV_KEY_PRESENT:-0}" == "1" ]]; then
      printf 'PP_SECRET_KEY=%s\n' "${FAKE_ENV_KEY:-}"
    fi
    ;;
  cp)
    case "${2:-}" in
      *:/app/backend/data/.secret-key)
        [[ "${FAKE_LEGACY_KEY_COPYABLE:-0}" == "1" ]] || exit 1
        printf '%s' "${FAKE_LEGACY_KEY:-}" > "${3:?destination required}"
        ;;
      *:/data/.secret-key)
        [[ "${FAKE_PERSISTENT_KEY_COPYABLE:-0}" == "1" ]] || exit 1
        printf '%s' "${FAKE_PERSISTENT_KEY:-}" > "${3:?destination required}"
        ;;
      *)
        exit 1
        ;;
    esac
    ;;
  exec)
    [[ "${FAKE_HEALTHY:-0}" == "1" ]] || exit 1
    ;;
  *)
    exit 2
    ;;
esac
SCRIPT
  chmod +x "$path"
}

test_legacy_key_migration() {
  local tmpdir="$1"
  local fake_docker="$tmpdir/docker"
  local data_dir="$tmpdir/data"
  local key="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  local mode

  mkdir -p "$data_dir"
  write_fake_docker "$fake_docker"
  export FAKE_CONTAINER_EXISTS=1
  export FAKE_ENV_KEY_PRESENT=0
  export FAKE_LEGACY_KEY_COPYABLE=1
  export FAKE_PERSISTENT_KEY_COPYABLE=0
  export FAKE_LEGACY_KEY="$key"

  migrate_legacy_container_secret_key proxyparser-backend "$data_dir" "" "$fake_docker" >/dev/null
  assert_eq "$key" "$(read_secret_key_file "$data_dir/.secret-key")" "migrated legacy key"
  mode="$(stat -f '%Lp' "$data_dir/.secret-key" 2>/dev/null || stat -c '%a' "$data_dir/.secret-key")"
  assert_eq "600" "$mode" "migrated key permissions"
}

test_legacy_key_migration_fails_closed() {
  local tmpdir="$1"
  local fake_docker="$tmpdir/docker"
  local data_dir="$tmpdir/data"
  local legacy_key="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  local configured_key="abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"

  mkdir -p "$data_dir"
  write_fake_docker "$fake_docker"
  export FAKE_CONTAINER_EXISTS=1
  export FAKE_ENV_KEY_PRESENT=0
  export FAKE_LEGACY_KEY_COPYABLE=1
  export FAKE_PERSISTENT_KEY_COPYABLE=0
  export FAKE_LEGACY_KEY="$legacy_key"

  if migrate_legacy_container_secret_key \
    proxyparser-backend "$data_dir" "$configured_key" "$fake_docker" \
    >/dev/null 2>&1; then
    fail "mismatched configured and legacy keys should fail"
  fi
  [[ ! -e "$data_dir/.secret-key" ]] || fail "failed migration must not install a key"

  export FAKE_LEGACY_KEY_COPYABLE=0
  export FAKE_PERSISTENT_KEY_COPYABLE=0
  if migrate_legacy_container_secret_key \
    proxyparser-backend "$data_dir" "" "$fake_docker" \
    >/dev/null 2>&1; then
    fail "unreadable legacy key should fail"
  fi
}

test_existing_database_without_recoverable_key_fails_closed() {
  local tmpdir="$1"
  local fake_docker="$tmpdir/docker"
  local data_dir="$tmpdir/data"

  mkdir -p "$data_dir"
  write_fake_docker "$fake_docker"
  export FAKE_CONTAINER_EXISTS=0
  printf 'existing sqlite content' > "$data_dir/proxyparser.sqlite"

  if migrate_legacy_container_secret_key \
    proxyparser-backend "$data_dir" "" "$fake_docker" \
    >/dev/null 2>&1; then
    fail "a non-empty existing database without any recoverable key must fail closed"
  fi

  : > "$data_dir/proxyparser.sqlite"
  migrate_legacy_container_secret_key \
    proxyparser-backend "$data_dir" "" "$fake_docker" >/dev/null
}

test_existing_persistent_key_matches_container() {
  local tmpdir="$1"
  local fake_docker="$tmpdir/docker"
  local data_dir="$tmpdir/data"
  local persistent_key="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  local other_key="abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"

  mkdir -p "$data_dir"
  printf '%s' "$persistent_key" > "$data_dir/.secret-key"
  write_fake_docker "$fake_docker"
  export FAKE_CONTAINER_EXISTS=1
  export FAKE_ENV_KEY_PRESENT=0
  export FAKE_LEGACY_KEY_COPYABLE=1
  export FAKE_PERSISTENT_KEY_COPYABLE=0
  export FAKE_LEGACY_KEY="$persistent_key"

  migrate_legacy_container_secret_key \
    proxyparser-backend "$data_dir" "" "$fake_docker" >/dev/null

  migrate_legacy_container_secret_key \
    proxyparser-backend "$data_dir" "$(printf '%s' "$persistent_key" | tr '[:lower:]' '[:upper:]')" "$fake_docker" >/dev/null

  export FAKE_LEGACY_KEY="$other_key"
  if migrate_legacy_container_secret_key \
    proxyparser-backend "$data_dir" "" "$fake_docker" \
    >/dev/null 2>&1; then
    fail "persistent and effective container key mismatch should fail"
  fi
  assert_eq "$persistent_key" "$(read_secret_key_file "$data_dir/.secret-key")" "mismatch leaves persistent key untouched"
}

test_new_container_key_path_and_env_precedence() {
  local tmpdir="$1"
  local fake_docker="$tmpdir/docker"
  local data_dir="$tmpdir/data"
  local data_key="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  local env_key="abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"

  mkdir -p "$data_dir"
  write_fake_docker "$fake_docker"
  export FAKE_CONTAINER_EXISTS=1
  export FAKE_ENV_KEY_PRESENT=1
  export FAKE_ENV_KEY=
  export FAKE_LEGACY_KEY_COPYABLE=0
  export FAKE_PERSISTENT_KEY_COPYABLE=1
  export FAKE_PERSISTENT_KEY="$data_key"

  migrate_legacy_container_secret_key \
    proxyparser-backend "$data_dir" "" "$fake_docker" >/dev/null
  assert_eq "$data_key" "$(read_secret_key_file "$data_dir/.secret-key")" "new container /data key"
  migrate_legacy_container_secret_key \
    proxyparser-backend "$data_dir" "" "$fake_docker" >/dev/null
  assert_eq "$data_key" "$(read_secret_key_file "$data_dir/.secret-key")" "empty env repeated deploy"

  rm -f "$data_dir/.secret-key"
  export FAKE_ENV_KEY_PRESENT=1
  export FAKE_ENV_KEY="$env_key"
  export FAKE_LEGACY_KEY_COPYABLE=1
  export FAKE_LEGACY_KEY="$data_key"

  migrate_legacy_container_secret_key \
    proxyparser-backend "$data_dir" "$env_key" "$fake_docker" >/dev/null
  assert_eq "$env_key" "$(read_secret_key_file "$data_dir/.secret-key")" "container PP_SECRET_KEY precedence"
}

with_tmpdir test_requires_target_without_config
with_tmpdir test_reads_target_from_env_file
with_tmpdir test_explicit_target_overrides_env_file
with_tmpdir test_runtime_env_value_and_public_url_validation
with_tmpdir test_secure_runtime_env_bootstrap_and_validation
with_tmpdir test_runtime_env_rejects_ambiguous_syntax
with_tmpdir test_secure_data_dir_permissions
with_tmpdir test_runtime_numeric_validation
with_tmpdir test_versioned_database_preflight_and_health
with_tmpdir test_legacy_key_migration
with_tmpdir test_legacy_key_migration_fails_closed
with_tmpdir test_existing_database_without_recoverable_key_fails_closed
with_tmpdir test_existing_persistent_key_matches_container
with_tmpdir test_new_container_key_path_and_env_precedence
with_tmpdir test_clear_compose_overrides
with_tmpdir test_deploy_path_and_tag_validation

echo "deploy-config tests passed"

#!/usr/bin/env bash

deploy_config_root_dir() {
  if [[ -n "${ROOT_DIR:-}" ]]; then
    printf '%s\n' "$ROOT_DIR"
    return
  fi

  cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd
}

trim_deploy_config_value() {
  local value="$1"
  value="${value%$'\r'}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

decode_runtime_env_value() {
  local raw_value="${1-}"
  local inner

  if [[ -z "$raw_value" ]]; then
    printf '%s' ""
    return
  fi

  if [[ "${raw_value:0:1}" == "'" ]]; then
    [[ "${#raw_value}" -ge 2 && "${raw_value: -1}" == "'" ]] || return 2
    inner="${raw_value:1:${#raw_value}-2}"
    [[ "$inner" != *"'"* ]] || return 2
    printf '%s' "$inner"
    return
  fi

  if [[ "${raw_value:0:1}" == '"' ]]; then
    [[ "${#raw_value}" -ge 2 && "${raw_value: -1}" == '"' ]] || return 2
    inner="${raw_value:1:${#raw_value}-2}"
    [[ "$inner" != *'"'* && "$inner" != *'$'* && "$inner" != *"\\"* ]] || return 2
    printf '%s' "$inner"
    return
  fi

  [[ "$raw_value" != *[[:space:]]* ]] || return 2
  [[ "$raw_value" != *'#'* && "$raw_value" != *'$'* ]] || return 2
  [[ "$raw_value" != *'"'* && "$raw_value" != *"'"* && "$raw_value" != *"\\"* ]] || return 2
  printf '%s' "$raw_value"
}

read_env_assignment() {
  local env_file="$1"
  local requested_key="$2"
  local line key raw_value value result=""

  [[ "$requested_key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || {
    echo "Invalid environment key: $requested_key" >&2
    return 2
  }
  [[ -f "$env_file" ]] || {
    printf '%s' "$result"
    return
  }

  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -z "$line" || "${line:0:1}" == "#" ]] && continue
    [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue

    key="${BASH_REMATCH[1]}"
    [[ "$key" == "$requested_key" ]] || continue
    raw_value="${BASH_REMATCH[2]}"
    value="$(decode_runtime_env_value "$raw_value")" || {
      echo "Unsupported value syntax for $requested_key in $env_file." >&2
      return 2
    }
    result="$value"
  done < "$env_file"

  printf '%s' "$result"
}

validate_runtime_env_file() {
  local env_file="$1"
  local line key raw_value seen_keys=""

  [[ -f "$env_file" && ! -L "$env_file" ]] || {
    echo "Runtime environment file $env_file must be a regular, non-symlink file." >&2
    return 2
  }

  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -z "$line" || "${line:0:1}" == "#" ]] && continue

    if [[ "$line" != "$(trim_deploy_config_value "$line")" ]] ||
      [[ ! "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      echo "Unsupported runtime env line in $env_file. Use exact KEY=value assignments without surrounding whitespace." >&2
      return 2
    fi

    key="${BASH_REMATCH[1]}"
    raw_value="${BASH_REMATCH[2]}"
    case "$key" in
      COMPOSE_*|DOCKER_*)
        echo "Reserved runtime env key '$key' is not allowed in $env_file." >&2
        return 2
        ;;
    esac
    case "|$seen_keys|" in
      *"|$key|"*)
        echo "Duplicate runtime env key '$key' in $env_file." >&2
        return 2
        ;;
    esac
    seen_keys="${seen_keys:+$seen_keys|}$key"

    decode_runtime_env_value "$raw_value" >/dev/null || {
      echo "Unsupported value syntax for $key in $env_file. Inline comments, interpolation, and escape processing are intentionally disabled." >&2
      return 2
    }
  done < "$env_file"
}

read_path_mode() {
  local path="$1"
  local mode

  if mode="$(stat -c '%a' "$path" 2>/dev/null)"; then
    printf '%s' "$mode"
    return
  fi
  if mode="$(stat -f '%Lp' "$path" 2>/dev/null)"; then
    printf '%s' "$mode"
    return
  fi
  echo "Could not read permissions for $path." >&2
  return 2
}

secure_runtime_env_file() {
  local env_file="$1"
  local mode

  [[ -f "$env_file" && ! -L "$env_file" ]] || {
    echo "Runtime environment file $env_file must be a regular, non-symlink file." >&2
    return 2
  }
  chmod 600 "$env_file"
  mode="$(read_path_mode "$env_file")"
  [[ "$mode" == "600" ]] || {
    echo "Runtime environment file $env_file must have mode 0600 (found $mode)." >&2
    return 2
  }
}

validate_persistent_data_dir() {
  local data_dir="$1"

  [[ "$data_dir" == /* && "$data_dir" != "/" && "$data_dir" != */ &&
    "$data_dir" != *:* && "$data_dir" != *"//"* &&
    "$data_dir" != *"/../"* && "$data_dir" != */.. &&
    "$data_dir" != *"/./"* && "$data_dir" != */. ]] || {
    echo "PROXYPARSER_DATA_DIR must be a normalized, non-root absolute host path without ':' so the Compose mount and encryption-key migration are unambiguous." >&2
    return 2
  }

  case "$data_dir" in
    /bin|/boot|/dev|/etc|/home|/lib|/lib64|/media|/mnt|/opt|/proc|/root|/run|/sbin|/srv|/sys|/tmp|/usr|/var|/var/lib|/var/log)
      echo "PROXYPARSER_DATA_DIR must be a dedicated application directory, not a system directory." >&2
      return 2
      ;;
  esac
}

ensure_secure_data_dir() {
  local data_dir="$1"
  local mode data_file entry entry_name component component_path=""
  local -a path_components

  validate_persistent_data_dir "$data_dir" || return
  IFS='/' read -r -a path_components <<< "${data_dir#/}"
  for component in "${path_components[@]}"; do
    component_path="$component_path/$component"
    if [[ -L "$component_path" ]]; then
      echo "Persistent data path component $component_path must not be a symlink." >&2
      return 2
    fi
  done
  if [[ -L "$data_dir" ]]; then
    echo "Persistent data directory $data_dir must not be a symlink." >&2
    return 2
  fi
  if [[ -e "$data_dir" && ! -d "$data_dir" ]]; then
    echo "Persistent data path $data_dir exists but is not a directory." >&2
    return 2
  fi

  if [[ -d "$data_dir" ]]; then
    # Prove this is a ProxyParser data directory before changing any permissions.
    # This prevents a typo such as /etc or /var/lib from being chmodded by root.
    for entry in "$data_dir"/.[!.]* "$data_dir"/..?* "$data_dir"/*; do
      [[ -e "$entry" || -L "$entry" ]] || continue
      entry_name="${entry##*/}"
      case "$entry_name" in
        .proxyparser-data-dir|.secret-key|proxyparser*.sqlite|proxyparser*.sqlite-wal|proxyparser*.sqlite-shm|proxyparser*.sqlite-journal)
          if [[ -L "$entry" || ! -f "$entry" ]]; then
            echo "Persistent data entry $entry must be a regular, non-symlink file." >&2
            return 2
          fi
          ;;
        *)
          echo "Existing persistent data directory $data_dir contains unrecognized entry $entry_name; refusing to change its permissions." >&2
          return 2
          ;;
      esac
    done
  else
    mkdir -p "$data_dir"
  fi

  chmod 700 "$data_dir"
  if [[ -L "$data_dir/.proxyparser-data-dir" ]]; then
    echo "Persistent data marker $data_dir/.proxyparser-data-dir must be a regular, non-symlink file." >&2
    return 2
  elif [[ ! -e "$data_dir/.proxyparser-data-dir" ]]; then
    (umask 077 && : > "$data_dir/.proxyparser-data-dir")
  elif [[ ! -f "$data_dir/.proxyparser-data-dir" ]]; then
    echo "Persistent data marker $data_dir/.proxyparser-data-dir must be a regular, non-symlink file." >&2
    return 2
  fi
  mode="$(read_path_mode "$data_dir")"
  [[ "$mode" == "700" ]] || {
    echo "Persistent data directory $data_dir must have mode 0700 (found $mode)." >&2
    return 2
  }

  for data_file in \
    "$data_dir"/proxyparser*.sqlite \
    "$data_dir"/proxyparser*.sqlite-wal \
    "$data_dir"/proxyparser*.sqlite-shm \
    "$data_dir"/proxyparser*.sqlite-journal \
    "$data_dir"/.secret-key \
    "$data_dir"/.proxyparser-data-dir; do
    [[ -e "$data_file" || -L "$data_file" ]] || continue
    if [[ -L "$data_file" || ! -f "$data_file" ]]; then
      echo "Persistent data file $data_file must be a regular, non-symlink file." >&2
      return 2
    fi
    chmod 600 "$data_file"
  done
}

assert_no_versioned_database_artifacts() {
  local data_dir="$1"
  local artifact found=""

  for artifact in \
    "$data_dir/proxyparser.v2.sqlite" \
    "$data_dir/proxyparser.v2.sqlite-wal" \
    "$data_dir/proxyparser.v2.sqlite-shm"; do
    if [[ -e "$artifact" ]]; then
      found="${found:+$found, }$artifact"
    fi
  done
  if [[ -n "$found" ]]; then
    echo "Versioned database artifacts were found: $found" >&2
    echo "Stop ProxyParser, back up the complete data directory, and migrate the main/WAL/SHM file group to proxyparser.sqlite before deploying. No files were moved automatically." >&2
    return 2
  fi
}

assert_container_data_mount() {
  local container_name="$1"
  local expected_data_dir="$2"
  local docker_bin="${3:-docker}"
  local mounted_data_dir

  if ! "$docker_bin" inspect "$container_name" >/dev/null 2>&1; then
    return 0
  fi
  mounted_data_dir="$(
    "$docker_bin" inspect --format \
      '{{range .Mounts}}{{if eq .Destination "/data"}}{{println .Source}}{{end}}{{end}}' \
      "$container_name" 2>/dev/null
  )" || {
    echo "Could not inspect the /data mount for $container_name." >&2
    return 2
  }
  mounted_data_dir="$(trim_deploy_config_value "$mounted_data_dir")"
  if [[ -z "$mounted_data_dir" ]]; then
    echo "Existing $container_name has no persistent /data mount; refusing to replace it and risk losing its database." >&2
    return 2
  fi
  if [[ "$mounted_data_dir" != "$expected_data_dir" ]]; then
    echo "Existing $container_name uses /data from $mounted_data_dir, but .env requests $expected_data_dir. Refusing to start with a different database." >&2
    return 2
  fi
}

wait_for_http_health() {
  local container_name="$1"
  local url="$2"
  local label="$3"
  local docker_bin="${4:-docker}"
  local attempts="${5:-40}"
  local delay_seconds="${6:-0.5}"
  local attempt

  for ((attempt = 0; attempt < attempts; attempt += 1)); do
    if "$docker_bin" exec "$container_name" bun -e \
      'const response = await fetch(process.argv[1], { signal: AbortSignal.timeout(5000) }); if (!response.ok) process.exit(1);' \
      "$url" \
      >/dev/null 2>&1; then
      return 0
    fi
    sleep "$delay_seconds"
  done
  echo "$label health check did not pass after deployment; inspect Docker logs." >&2
  return 2
}

validate_image_tag() {
  local tag="${1:-}"
  [[ "${#tag}" -le 128 && "$tag" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]*$ ]] || {
    echo "Image tag must match [A-Za-z0-9_][A-Za-z0-9_.-]{0,127}." >&2
    return 2
  }
}

validate_remote_root() {
  local path="${1:-}"
  [[ "$path" != "/" && "$path" != */ && "$path" =~ ^/[A-Za-z0-9._/-]+$ && "$path" != *"//"* &&
    "$path" != *"/../"* && "$path" != */.. &&
    "$path" != *"/./"* && "$path" != */. ]] || {
    echo "PROXYPARSER_REMOTE_ROOT must be a normalized absolute path using only letters, numbers, '.', '_', '-', and '/'." >&2
    return 2
  }
}

validate_public_base_url() {
  local value
  local source_label="${2:-deployment environment}"
  local normalized authority host port="" label port_number
  local -a host_labels

  value="${1:-}"
  normalized="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')"

  case "$normalized" in
    http://*|https://*) ;;
    *)
      echo "PUBLIC_BASE_URL in $source_label must be a non-empty http(s) URL for the real public deployment." >&2
      return 2
      ;;
  esac

  authority="${value#*://}"
  if [[ -z "$authority" || "$authority" == *'/'* || "$authority" == *'?'* ||
    "$authority" == *'#'* || "$authority" == *'@'* || "$authority" == *[[:space:]]* ]]; then
    echo "PUBLIC_BASE_URL in $source_label must be a canonical origin with no credentials, path, query, fragment, whitespace, or trailing slash." >&2
    return 2
  fi

  if [[ "$authority" == \[* ]]; then
    echo "PUBLIC_BASE_URL in $source_label uses bracketed IPv6, which this deployment validator does not support safely." >&2
    return 2
  else
    if [[ "$authority" == *:* ]]; then
      host="${authority%:*}"
      port="${authority##*:}"
    else
      host="$authority"
    fi

    if [[ "${#host}" -gt 253 || ! "$host" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ||
      "$host" == *..* ]]; then
      echo "PUBLIC_BASE_URL in $source_label contains an invalid host." >&2
      return 2
    fi
    IFS='.' read -r -a host_labels <<< "$host"
    for label in "${host_labels[@]}"; do
      if [[ "${#label}" -gt 63 || "$label" == -* || "$label" == *- ]]; then
        echo "PUBLIC_BASE_URL in $source_label contains an invalid host label." >&2
        return 2
      fi
    done

    if [[ "$host" =~ ^[0-9.]+$ ]]; then
      if [[ "${#host_labels[@]}" -ne 4 ]]; then
        echo "PUBLIC_BASE_URL in $source_label contains an invalid IPv4 address." >&2
        return 2
      fi
      for label in "${host_labels[@]}"; do
        if [[ ! "$label" =~ ^[0-9]+$ || "${#label}" -gt 3 || $((10#$label)) -gt 255 ]]; then
          echo "PUBLIC_BASE_URL in $source_label contains an invalid IPv4 address." >&2
          return 2
        fi
      done
    fi
  fi

  if [[ -n "$port" ]]; then
    if [[ ! "$port" =~ ^[0-9]+$ || "${#port}" -gt 5 ]]; then
      echo "PUBLIC_BASE_URL in $source_label contains an invalid port." >&2
      return 2
    fi
    port_number=$((10#$port))
    if (( port_number < 1 || port_number > 65535 )); then
      echo "PUBLIC_BASE_URL in $source_label contains an invalid port." >&2
      return 2
    fi
  fi

  host="$(printf '%s' "$host" | tr '[:upper:]' '[:lower:]')"
  if [[ -z "$host" || "$host" == "example.com" || "$host" == *.example.com ]]; then
    echo "PUBLIC_BASE_URL in $source_label still uses an empty or example.com placeholder. Set the real externally reachable URL before deploying." >&2
    return 2
  fi
}

validate_jwt_secret() {
  local value="${1:-}"
  local source_label="${2:-deployment environment}"
  local normalized unique_count

  normalized="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')"
  if [[ "${#value}" -lt 32 ]]; then
    echo "JWT_SECRET in $source_label must contain at least 32 characters." >&2
    return 2
  fi
  case "$normalized" in
    *replace-with*|*change-me*|*changeme*|*example*|*your-secret*|*secret-here*)
      echo "JWT_SECRET in $source_label still uses a known placeholder." >&2
      return 2
      ;;
  esac

  unique_count="$(printf '%s' "$value" | LC_ALL=C fold -w 1 | LC_ALL=C sort -u | wc -l | tr -d '[:space:]')"
  if [[ -z "$unique_count" ]] || (( unique_count < 8 )); then
    echo "JWT_SECRET in $source_label does not contain enough character diversity." >&2
    return 2
  fi
}

validate_integer_in_range() {
  local name="$1"
  local value="$2"
  local minimum="$3"
  local maximum="$4"

  if [[ ! "$value" =~ ^[0-9]+$ || "${#value}" -gt 10 ]]; then
    echo "$name must be an integer between $minimum and $maximum." >&2
    return 2
  fi
  local number=$((10#$value))
  if (( number < minimum || number > maximum )); then
    echo "$name must be an integer between $minimum and $maximum." >&2
    return 2
  fi
}

generate_jwt_secret() {
  local openssl_command="${1:-openssl}"
  local candidate=""

  if command -v "$openssl_command" >/dev/null 2>&1; then
    candidate="$("$openssl_command" rand -hex 32 2>/dev/null || true)"
    if validate_jwt_secret "$candidate" "generated secret" >/dev/null 2>&1; then
      printf '%s' "$candidate"
      return
    fi
  fi

  candidate="$(LC_ALL=C od -An -N32 -tx1 /dev/urandom | tr -d '[:space:]')"
  validate_jwt_secret "$candidate" "generated secret" >/dev/null || {
    echo "Could not generate a strong JWT_SECRET." >&2
    return 2
  }
  printf '%s' "$candidate"
}

validate_secret_key_value() {
  local value="${1:-}"
  [[ "$value" =~ ^[0-9A-Fa-f]{64}$ ]]
}

normalize_secret_key_value() {
  local value="$1"
  printf '%s' "$value" | tr '[:upper:]' '[:lower:]'
}

read_secret_key_file() {
  local key_file="$1"
  local value

  [[ -f "$key_file" && ! -L "$key_file" ]] || return 1
  value="$(<"$key_file")"
  validate_secret_key_value "$value" || return 1
  normalize_secret_key_value "$value"
}

set_env_assignment_atomically() {
  local env_file="$1"
  local key="$2"
  local value="$3"
  local temp_file

  [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || {
    echo "Invalid environment key: $key" >&2
    return 2
  }
  decode_runtime_env_value "$value" >/dev/null || {
    echo "Refusing to write a non-literal value for $key." >&2
    return 2
  }
  secure_runtime_env_file "$env_file" || return
  validate_runtime_env_file "$env_file" || return

  temp_file="$(mktemp "${env_file}.update.XXXXXX")"
  chmod 600 "$temp_file"
  if ! awk -v wanted_key="$key" -v wanted_value="$value" '
      BEGIN { found = 0 }
      index($0, wanted_key "=") == 1 {
        found += 1
        print wanted_key "=" wanted_value
        next
      }
      { print }
      END {
        if (found == 0) print wanted_key "=" wanted_value
        if (found > 1) exit 2
      }
    ' "$env_file" > "$temp_file"; then
    rm -f "$temp_file"
    echo "Could not update $key in $env_file." >&2
    return 2
  fi
  chmod 600 "$temp_file"
  validate_runtime_env_file "$temp_file" || {
    rm -f "$temp_file"
    return 2
  }
  mv "$temp_file" "$env_file"
  secure_runtime_env_file "$env_file"
}

create_runtime_env_file() {
  local example_file="$1"
  local env_file="$2"
  local openssl_command="${3:-openssl}"
  local secret temp_file

  [[ -f "$example_file" ]] || {
    echo "Runtime environment template $example_file does not exist." >&2
    return 2
  }
  [[ ! -e "$env_file" && ! -L "$env_file" ]] || {
    echo "Runtime environment file $env_file already exists; refusing to replace it." >&2
    return 2
  }
  validate_runtime_env_file "$example_file" || return
  secret="$(generate_jwt_secret "$openssl_command")" || return

  temp_file="$(mktemp "${env_file}.bootstrap.XXXXXX")"
  chmod 600 "$temp_file"
  if ! awk -v secret="$secret" '
      BEGIN { found = 0 }
      /^JWT_SECRET=/ {
        found += 1
        print "JWT_SECRET=" secret
        next
      }
      { print }
      END { if (found != 1) exit 2 }
    ' "$example_file" > "$temp_file"; then
    rm -f "$temp_file"
    echo "Runtime environment template must contain exactly one JWT_SECRET assignment." >&2
    return 2
  fi
  chmod 600 "$temp_file"
  validate_runtime_env_file "$temp_file" || {
    rm -f "$temp_file"
    return 2
  }
  validate_jwt_secret "$(read_env_assignment "$temp_file" JWT_SECRET)" "$temp_file" || {
    rm -f "$temp_file"
    return 2
  }

  if ! ln "$temp_file" "$env_file" 2>/dev/null; then
    rm -f "$temp_file"
    echo "Runtime environment file $env_file appeared concurrently; refusing to overwrite it." >&2
    return 2
  fi
  rm -f "$temp_file"
  secure_runtime_env_file "$env_file"
}

validate_runtime_env_configuration() {
  local env_file="$1"
  local public_base_url jwt_secret persistent_data_dir secret_key image_tag
  local jwt_access_ttl jwt_refresh_ttl temp_token_ttl source_sync_interval

  secure_runtime_env_file "$env_file" || return
  validate_runtime_env_file "$env_file" || return
  public_base_url="$(read_env_assignment "$env_file" PUBLIC_BASE_URL)" || return
  jwt_secret="$(read_env_assignment "$env_file" JWT_SECRET)" || return
  persistent_data_dir="$(read_env_assignment "$env_file" PROXYPARSER_DATA_DIR)" || return
  secret_key="$(read_env_assignment "$env_file" PP_SECRET_KEY)" || return
  image_tag="$(read_env_assignment "$env_file" IMAGE_TAG)" || return
  jwt_access_ttl="$(read_env_assignment "$env_file" JWT_ACCESS_TTL_SECONDS)" || return
  jwt_refresh_ttl="$(read_env_assignment "$env_file" JWT_REFRESH_TTL_SECONDS)" || return
  temp_token_ttl="$(read_env_assignment "$env_file" SUBSCRIPTION_TEMP_TOKEN_TTL_SECONDS)" || return
  source_sync_interval="$(read_env_assignment "$env_file" SOURCE_SYNC_INTERVAL_MINUTES)" || return

  validate_public_base_url "$public_base_url" "$env_file" || return
  validate_jwt_secret "$jwt_secret" "$env_file" || return
  validate_persistent_data_dir "${persistent_data_dir:-/var/lib/proxyparser}" || return
  validate_image_tag "${image_tag:-local}" || return
  validate_integer_in_range JWT_ACCESS_TTL_SECONDS "${jwt_access_ttl:-900}" 1 2147483647 || return
  validate_integer_in_range JWT_REFRESH_TTL_SECONDS "${jwt_refresh_ttl:-2592000}" 1 2147483647 || return
  validate_integer_in_range SUBSCRIPTION_TEMP_TOKEN_TTL_SECONDS "${temp_token_ttl:-86400}" 3600 2592000 || return
  validate_integer_in_range SOURCE_SYNC_INTERVAL_MINUTES "${source_sync_interval:-360}" 15 10080 || return
  if [[ -n "$secret_key" ]] && ! validate_secret_key_value "$secret_key"; then
    echo "PP_SECRET_KEY in $env_file must be empty or exactly 64 hexadecimal characters." >&2
    return 2
  fi
}

clear_compose_runtime_overrides() {
  unset \
    IMAGE_TAG \
    PROXYPARSER_DATA_DIR \
    PUBLIC_BASE_URL \
    JWT_SECRET \
    PP_SECRET_KEY \
    JWT_ISSUER \
    DEFAULT_LOCALE \
    JWT_ACCESS_TTL_SECONDS \
    JWT_REFRESH_TTL_SECONDS \
    SUBSCRIPTION_TEMP_TOKEN_TTL_SECONDS \
    SOURCE_SYNC_INTERVAL_MINUTES \
    COMPOSE_FILE \
    COMPOSE_ENV_FILES \
    COMPOSE_PATH_SEPARATOR \
    COMPOSE_PROFILES \
    COMPOSE_PROJECT_NAME
}

extract_container_effective_secret_key() {
  local container_name="$1"
  local output_file="$2"
  local docker_bin="${3:-docker}"
  local container_path env_key

  : > "$output_file"
  chmod 600 "$output_file"

  # Environment configuration has highest precedence and can be read from a
  # stopped container. sed filters every other container environment variable.
  "$docker_bin" inspect --format '{{range .Config.Env}}{{println .}}{{end}}' \
    "$container_name" 2>/dev/null \
    | sed -n 's/^PP_SECRET_KEY=//p' > "$output_file"
  env_key="$(<"$output_file")"
  if [[ -n "$env_key" ]]; then
    validate_secret_key_value "$env_key" || {
      echo "The existing $container_name container has an invalid PP_SECRET_KEY." >&2
      return 2
    }
    return 0
  fi

  # Images before the persistent-key cutover used the first path. New images
  # use /data. A legacy file cannot exist in new images because backend/data is
  # excluded from the build context, so this order reflects runtime precedence.
  for container_path in \
    /app/backend/data/.secret-key \
    /data/.secret-key; do
    : > "$output_file"
    chmod 600 "$output_file"
    if "$docker_bin" cp \
      "$container_name:$container_path" "$output_file" \
      >/dev/null 2>&1; then
      read_secret_key_file "$output_file" >/dev/null || {
        echo "The encryption key at $container_path in $container_name is invalid." >&2
        return 2
      }
      return 0
    fi
  done

  return 1
}

migrate_legacy_container_secret_key() {
  local container_name="$1"
  local persistent_data_dir="$2"
  local configured_key="${3:-}"
  local docker_bin="${4:-docker}"
  local destination="$persistent_data_dir/.secret-key"
  local destination_key legacy_key temp_key

  if [[ -n "$configured_key" ]] && ! validate_secret_key_value "$configured_key"; then
    echo "PP_SECRET_KEY must be exactly 64 hexadecimal characters." >&2
    return 2
  fi
  if [[ -n "$configured_key" ]]; then
    configured_key="$(normalize_secret_key_value "$configured_key")"
  fi

  if [[ -e "$destination" ]]; then
    if [[ ! -f "$destination" ]] || ! destination_key="$(read_secret_key_file "$destination")"; then
      echo "Persistent key $destination is not a valid 64-character hexadecimal .secret-key file." >&2
      return 2
    fi
    if [[ -n "$configured_key" && "$configured_key" != "$destination_key" ]]; then
      echo "PP_SECRET_KEY does not match the existing persistent .secret-key; refusing to replace the backend." >&2
      return 2
    fi
    chmod 600 "$destination"
  fi

  if ! "$docker_bin" inspect "$container_name" >/dev/null 2>&1; then
    if [[ -z "${destination_key:-}" && -z "$configured_key" ]]; then
      local database_artifact
      for database_artifact in \
        "$persistent_data_dir"/proxyparser*.sqlite \
        "$persistent_data_dir"/proxyparser*.sqlite-wal \
        "$persistent_data_dir"/proxyparser*.sqlite-shm \
        "$persistent_data_dir"/proxyparser*.sqlite-journal; do
        if [[ -f "$database_artifact" && -s "$database_artifact" ]]; then
          echo "Existing database artifact $database_artifact has no matching persistent/configured encryption key, and no old container is available for recovery. Refusing to start with a new key." >&2
          return 2
        fi
      done
    fi
    return 0
  fi

  temp_key="$(mktemp "$persistent_data_dir/.secret-key.migrate.XXXXXX")"
  chmod 600 "$temp_key"

  if ! extract_container_effective_secret_key \
    "$container_name" "$temp_key" "$docker_bin"; then
    rm -f "$temp_key"
    echo "An existing $container_name container was found, but its effective encryption key could not be copied safely. The backend was not replaced." >&2
    return 2
  fi

  if ! legacy_key="$(read_secret_key_file "$temp_key")"; then
    rm -f "$temp_key"
    echo "The legacy encryption key from $container_name is invalid; refusing to replace the backend." >&2
    return 2
  fi
  if [[ -n "$configured_key" && "$configured_key" != "$legacy_key" ]]; then
    rm -f "$temp_key"
    echo "PP_SECRET_KEY does not match the effective key used by $container_name; refusing to replace the backend." >&2
    return 2
  fi

  if [[ -n "${destination_key:-}" ]]; then
    if [[ "$destination_key" != "$legacy_key" ]]; then
      rm -f "$temp_key"
      echo "The persistent .secret-key does not match the effective key used by $container_name; refusing to replace the backend." >&2
      return 2
    fi
    rm -f "$temp_key"
    return 0
  fi

  mv "$temp_key" "$destination"
  chmod 600 "$destination"
  echo "Migrated the legacy backend encryption key to the persistent data directory."
}

apply_deploy_config_var() {
  local key="$1"
  local value="$2"
  local existing="${!key-}"

  if [[ -z "$existing" ]]; then
    printf -v "$key" '%s' "$value"
    export "$key"
  fi
}

load_deploy_env_file() {
  local env_file="$1"
  local line key value

  [[ -f "$env_file" ]] || return 0

  while IFS= read -r line || [[ -n "$line" ]]; do
    line="$(trim_deploy_config_value "$line")"
    [[ -z "$line" || "${line:0:1}" == "#" ]] && continue

    if [[ ! "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      echo "Invalid deploy env line in $env_file: $line" >&2
      return 2
    fi

    key="${BASH_REMATCH[1]}"
    value="$(trim_deploy_config_value "${BASH_REMATCH[2]}")"

    if [[ "${#value}" -ge 2 ]]; then
      if [[ "${value:0:1}" == '"' && "${value: -1}" == '"' ]]; then
        value="${value:1:${#value}-2}"
      elif [[ "${value:0:1}" == "'" && "${value: -1}" == "'" ]]; then
        value="${value:1:${#value}-2}"
      fi
    fi

    case "$key" in
      PROXYPARSER_DEPLOY_TARGET|PROXYPARSER_REMOTE_ROOT|OUTPUT_DIR)
        apply_deploy_config_var "$key" "$value"
        ;;
      *)
        echo "Unsupported deploy env key '$key' in $env_file" >&2
        return 2
        ;;
    esac
  done < "$env_file"
}

resolve_deploy_config() {
  local target_arg="${1:-}"
  local tag_arg="${2:-}"
  local env_file="${3:-}"
  local root_dir target tag remote_root output_dir

  root_dir="$(deploy_config_root_dir)"
  [[ -n "$env_file" ]] || env_file="$root_dir/deploy/deploy.env"

  load_deploy_env_file "$env_file"

  target="${target_arg:-${PROXYPARSER_DEPLOY_TARGET:-}}"
  if [[ -z "$target" ]]; then
    cat >&2 <<EOF
Missing deployment target.

Set PROXYPARSER_DEPLOY_TARGET in $env_file or pass it explicitly:
  scripts/deploy-images.sh --target user@example.com --tag <tag>
EOF
    return 2
  fi

  tag="${tag_arg:-$(git -C "$root_dir" rev-parse --short HEAD)}"
  remote_root="${PROXYPARSER_REMOTE_ROOT:-/opt/proxyparser}"
  output_dir="${OUTPUT_DIR:-$root_dir/dist/images}"

  printf 'TARGET=%s\n' "$target"
  printf 'TAG=%s\n' "$tag"
  printf 'REMOTE_ROOT=%s\n' "$remote_root"
  printf 'OUTPUT_DIR=%s\n' "$output_dir"
}

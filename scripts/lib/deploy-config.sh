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

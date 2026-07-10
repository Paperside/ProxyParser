# ProxyParser Deployment Guide

> **生产部署要点**
>
> 1. Nginx 必须把 `/api/*`、`/swagger*`、`/s/*`（订阅拉取）和 `/rs/*`（不可变规则快照）转发到 backend。
> 2. Compose 默认使用无版本文件名 `/data/proxyparser.sqlite`；`DATABASE_PATH` 可覆盖。
> 3. 必设 `PUBLIC_BASE_URL`（订阅链接与 rule-provider URL 的公开根地址）和 `JWT_SECRET`。
> 4. 不设 `PP_SECRET_KEY` 时，首启会在数据库同目录生成 `/data/.secret-key`；它必须与数据库一起持久化和备份。
> 5. backend 镜像构建期尝试内置 mihomo 校验内核；失败不阻断构建，运行时会降级为结构校验并在设置页提示。

This project is deployed as Docker images built away from the production server. The production host is intentionally small, so it must not run TypeScript checks, Vite builds, or Docker builds.

## Architecture

```text
https://proxyparser.example.com
  |
  | host Nginx, existing TLS cert for proxyparser.example.com
  |
  +-- /             -> 127.0.0.1:8080  frontend container, nginx static files
  +-- /api/*        -> 127.0.0.1:3001  backend container, Bun/Elysia
  +-- /swagger*     -> 127.0.0.1:3001
  +-- /s/*          -> 127.0.0.1:3001  订阅拉取（只读已发布版本）
  +-- /rs/*         -> 127.0.0.1:3001  不可变规则快照（可加 CDN/长缓存）

SQLite data lives outside the image:
  host /var/lib/proxyparser -> container /data
```

The images are stateless. Runtime state is in the host-mounted SQLite data directory.

## Server constraints

- Server architecture: `linux/amd64` / x86_64.
- Local developer machine may be macOS arm64 with Docker running through Colima.
- Always build production images with `--platform linux/amd64`.
- Do not build or typecheck on the production server.
- The archive deployment helper currently requires a `root@host` SSH target. The backend
  container runs as root, and using one ownership model prevents later deployments from
  losing access to the host-mounted database or encryption key.

## Local build prerequisites

Start Colima and verify Docker is reachable:

```bash
colima start
docker context show
docker info
```

If your context is not wired to Colima, switch it before building:

```bash
docker context use colima
```

## Build image archives locally

The frontend Docker image packages `frontend/dist`. The build script always rebuilds this directory on the host before packaging it into an nginx image, so an old `dist` cannot leak into a new release. This also avoids running the memory-heavy TypeScript/Vite build inside an amd64 emulated container on macOS arm64.

From the repository root:

```bash
scripts/build-images.sh
```

The script defaults to the current git short SHA as the image tag and writes archives to:

```text
dist/images/proxyparser-backend-<tag>.tar.gz
dist/images/proxyparser-frontend-<tag>.tar.gz
```

These archives are local release artifacts and must not be committed. `.gitignore` excludes `dist/`, `*.tar`, and `*.tar.gz`.

To use a custom tag:

```bash
scripts/build-images.sh 2026-06-11-1
```

## Upload and start on the server

```bash
scripts/deploy-images.sh --target root@example.com --tag <tag>
```

The target can also be stored in a local ignored env file:

```bash
cp deploy/deploy.env.example deploy/deploy.env
$EDITOR deploy/deploy.env
scripts/deploy-images.sh --tag <tag>
```

The script:

1. uploads image archives to `/opt/proxyparser/images`,
2. uploads Compose deployment files and the environment validator to `/opt/proxyparser/deploy`,
3. atomically creates `/opt/proxyparser/deploy/.env` with mode `0600` and a strong random `JWT_SECRET` if missing,
4. validates a canonical `PUBLIC_BASE_URL`, the JWT secret, literal Compose values, and the image tag before loading images,
5. verifies the existing `/data` mount, proves the target is a dedicated ProxyParser data directory, locks it to `0700`, preserves the effective encryption key, and pins it in the protected `.env` for rollback compatibility,
6. runs `docker load`, sets `IMAGE_TAG=<tag>`, and runs `docker compose up -d`.

If `deploy/nginx-proxyparser.conf` exists locally, the script also uploads it to the remote deploy directory. That file is ignored by git because it may contain real domains and certificate paths. Keep only `deploy/nginx-proxyparser.conf.example` tracked.

The generated `.env` includes a random `JWT_SECRET` on first deploy. Keep it stable after users exist, because changing it invalidates tokens. `PUBLIC_BASE_URL` is intentionally empty in the template: the first deploy stops safely until the real externally reachable URL has been configured on the server.

Use one literal `KEY=value` assignment per line. Inline comments, variable interpolation, duplicate keys, and shell overrides are rejected/cleared so deployment preflight and Compose cannot resolve different values. `PUBLIC_BASE_URL` must be a canonical origin such as `https://proxy.example.com`—no trailing slash, path, query, or fragment.

```bash
ssh -t root@example.com '${EDITOR:-vi} /opt/proxyparser/deploy/.env'
scripts/deploy-images.sh --target root@example.com --tag <tag>
```

`PP_SECRET_KEY` is optional. Leave it empty to use `/var/lib/proxyparser/.secret-key`; when upgrading an older image that kept this key inside the container, the deployment script copies the effective old key into the persistent data directory with mode `0600` before replacing the backend. It then records that same key in the mode-`0600` `.env`, so an older rollback image that still expects the environment key cannot silently generate a different one. If the old key cannot be recovered reliably, or configured/persisted/container keys disagree, deployment stops without replacing the container.

If a non-empty SQLite database already exists but both the persistent key and old container are missing, deployment also stops. Restore the database and key from the same backup set (or supply the original `PP_SECRET_KEY`); never let an existing database start with a newly generated key.

## Server bootstrap

Install Docker/Compose once on the server. Also add swap on small-memory instances:

```bash
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

Create the persistent data directory:

```bash
install -d -m 700 /var/lib/proxyparser
```

## Nginx

The repository includes the host Nginx vhost template:

```text
deploy/nginx-proxyparser.conf.example
```

Create the local ignored config and fill in the real server name and certificate paths:

```bash
cp deploy/nginx-proxyparser.conf.example deploy/nginx-proxyparser.conf
$EDITOR deploy/nginx-proxyparser.conf
```

Install/reload it on the server after upload:

```bash
cp /opt/proxyparser/deploy/nginx-proxyparser.conf /etc/nginx/conf.d/proxyparser.conf
nginx -t
systemctl reload nginx
```

The config expects an existing TLS certificate. Replace these example paths before deploying:

```text
/etc/nginx/ssl/example.com/fullchain.cer
/etc/nginx/ssl/example.com/example.key
```

The certificate must include the configured `server_name`.

## Health checks

After deploy:

```bash
curl -I https://proxyparser.example.com
curl https://proxyparser.example.com/api/health
ssh root@example.com 'cd /opt/proxyparser/deploy && docker compose ps'
ssh root@example.com 'docker logs --tail=100 proxyparser-backend'
```

Expected API health response includes `status: "ok"` and database health fields.

## Rollback

Keep older image archives both in the local `dist/images` output directory and under
`/opt/proxyparser/images`. The normal rollback command validates the matching local archives
before upload, then revalidates permissions, environment values, and encryption-key
compatibility before replacing the container:

```bash
scripts/deploy-images.sh --target root@example.com --tag <old-tag>
```

Do not switch `IMAGE_TAG` and run Compose directly across the key-storage cutover. Images predating persistent `/data/.secret-key` read `/app/backend/data/.secret-key`; without the pinned `PP_SECRET_KEY`, a direct rollback can generate a new key and create mixed ciphertext. The deployment script handles this boundary and loads the archived images automatically.

If an emergency server-local rollback is unavoidable, first verify that `.env` is mode `0600`, that `PP_SECRET_KEY` exactly matches `/var/lib/proxyparser/.secret-key`, and only then load the old archives and restart Compose:

```bash
set -euo pipefail
cd /opt/proxyparser/deploy
source ./deploy-config.sh
test "$(stat -c '%a' .env)" = 600
ENV_KEY="$(read_env_assignment .env PP_SECRET_KEY)"
FILE_KEY="$(read_secret_key_file /var/lib/proxyparser/.secret-key)"
validate_secret_key_value "$ENV_KEY"
test "$(normalize_secret_key_value "$ENV_KEY")" = "$FILE_KEY"
gunzip -c /opt/proxyparser/images/proxyparser-backend-<old-tag>.tar.gz | docker load
gunzip -c /opt/proxyparser/images/proxyparser-frontend-<old-tag>.tar.gz | docker load
sed -i 's/^IMAGE_TAG=.*/IMAGE_TAG=<old-tag>/' .env
docker compose up -d
```

## Data backup and restore

Persistent state is stored together under:

```text
/var/lib/proxyparser/
  proxyparser.sqlite
  .secret-key
```

The SQLite file and `.secret-key` are one recovery unit. Losing or replacing the key makes encrypted custom-node credentials and saved long-term subscription links unreadable. If `PP_SECRET_KEY` is supplied through the environment instead, back up that value in the deployment secret store rather than expecting `.secret-key`.

The safest filesystem backup briefly stops the backend so the SQLite WAL is fully closed:

```bash
umask 077
install -d -m 700 /var/backups/proxyparser
cd /opt/proxyparser/deploy
docker compose stop backend
tar -C /var/lib -czf /var/backups/proxyparser/proxyparser-$(date +%Y%m%d-%H%M%S).tar.gz proxyparser
chmod 600 /var/backups/proxyparser/proxyparser-*.tar.gz
docker compose start backend
```

Restore only while the backend is stopped, replace the complete directory from one backup set, verify ownership/permissions, and then start the backend. For a no-downtime database backup, use SQLite's online `.backup` API and copy the matching key into the same backup set; do not copy a live WAL database file by itself.

## Future registry-based deployment

The short-term flow uses tar archives and `scp`. For CI/CD, move to a registry:

- Aliyun ACR is preferable for China-hosted ECS pull speed.
- GHCR is preferable for GitHub integration.

Then replace local image names in `deploy/docker-compose.yml` with registry images and deploy with:

```bash
docker compose pull
docker compose up -d
```

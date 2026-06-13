# ProxyParser Deployment Guide

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
  +-- /subscribe/*  -> 127.0.0.1:3001

SQLite data lives outside the image:
  host /var/lib/proxyparser -> container /data
```

The images are stateless. Runtime state is in the host-mounted SQLite data directory.

## Server constraints

- Server architecture: `linux/amd64` / x86_64.
- Local developer machine may be macOS arm64 with Docker running through Colima.
- Always build production images with `--platform linux/amd64`.
- Do not build or typecheck on the production server.

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

The frontend Docker image packages `frontend/dist`. The build script creates this dist directory on the host first, then copies it into an nginx image. This avoids running the memory-heavy TypeScript/Vite build inside an amd64 emulated container on macOS arm64.

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
scripts/deploy-images.sh --target deploy@example.com --tag <tag>
```

The target can also be stored in a local ignored env file:

```bash
cp deploy/deploy.env.example deploy/deploy.env
$EDITOR deploy/deploy.env
scripts/deploy-images.sh --tag <tag>
```

The script:

1. uploads image archives to `/opt/proxyparser/images`,
2. uploads Compose deployment files to `/opt/proxyparser/deploy`,
3. runs `docker load`,
4. creates `/opt/proxyparser/deploy/.env` from `.env.example` if missing,
5. sets `IMAGE_TAG=<tag>`,
6. runs `docker compose up -d`.

If `deploy/nginx-proxyparser.conf` exists locally, the script also uploads it to the remote deploy directory. That file is ignored by git because it may contain real domains and certificate paths. Keep only `deploy/nginx-proxyparser.conf.example` tracked.

The generated `.env` includes a random `JWT_SECRET` on first deploy. Keep it stable after users exist, because changing it invalidates tokens.

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
mkdir -p /var/lib/proxyparser
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
ssh deploy@example.com 'cd /opt/proxyparser/deploy && docker compose ps'
ssh deploy@example.com 'docker logs --tail=100 proxyparser-backend'
```

Expected API health response includes `status: "ok"` and database health fields.

## Rollback

Keep older image archives under `/opt/proxyparser/images`. To roll back:

```bash
cd /opt/proxyparser/deploy
sed -i 's/^IMAGE_TAG=.*/IMAGE_TAG=<old-tag>/' .env
docker compose up -d
```

If the old images are not loaded anymore:

```bash
gunzip -c /opt/proxyparser/images/proxyparser-backend-<old-tag>.tar.gz | docker load
gunzip -c /opt/proxyparser/images/proxyparser-frontend-<old-tag>.tar.gz | docker load
cd /opt/proxyparser/deploy
docker compose up -d
```

## Database backup

SQLite data is stored at:

```text
/var/lib/proxyparser/proxyparser.sqlite
```

Basic backup while the app is quiet:

```bash
mkdir -p /var/backups/proxyparser
cp /var/lib/proxyparser/proxyparser.sqlite /var/backups/proxyparser/proxyparser-$(date +%Y%m%d-%H%M%S).sqlite
```

For a more robust live backup, use SQLite `.backup` from a container or install `sqlite3` on the host.

## Future registry-based deployment

The short-term flow uses tar archives and `scp`. For CI/CD, move to a registry:

- Aliyun ACR is preferable for China-hosted ECS pull speed.
- GHCR is preferable for GitHub integration.

Then replace local image names in `deploy/docker-compose.yml` with registry images and deploy with:

```bash
docker compose pull
docker compose up -d
```

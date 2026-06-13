# syntax=docker/dockerfile:1
FROM oven/bun:1.3.11 AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY package.json bun.lock ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN bun install --frozen-lockfile --production

COPY backend ./backend

WORKDIR /app/backend
ENV PORT=3001
ENV DATABASE_PATH=/data/proxyparser.sqlite

EXPOSE 3001
CMD ["bun", "src/index.ts"]

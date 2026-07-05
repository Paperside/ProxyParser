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

# 发布门禁：构建期内置 mihomo 内核（失败不阻断构建，运行时降级为结构校验）
RUN bun scripts/fetch-mihomo.ts || echo "mihomo fetch skipped; gate will degrade to structural validation"

ENV PORT=3001
ENV DATABASE_PATH=/data/proxyparser.v2.sqlite
# 生产必须设置：PUBLIC_BASE_URL（订阅链接与 /rs 端点的对外地址）、JWT_SECRET、PP_SECRET_KEY

EXPOSE 3001
CMD ["bun", "src/index.ts"]

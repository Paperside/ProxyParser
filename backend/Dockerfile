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

# 发布门禁：生产镜像必须包含可执行的 mihomo。下载或探测失败即终止构建，
# 避免部署一个只能在用户发布时才暴露缺陷的残缺镜像。
RUN bun scripts/fetch-mihomo.ts && /app/backend/data/bin/mihomo -v

ENV PORT=3001
ENV DATABASE_PATH=/data/proxyparser.sqlite
ENV PROXYPARSER_MIHOMO_PATH=/app/backend/data/bin/mihomo
# 生产必须设置：PUBLIC_BASE_URL（订阅链接与 /rs 端点的对外地址）、JWT_SECRET。
# PP_SECRET_KEY 可选；未设置时自动生成 /data/.secret-key，需随数据库一同持久化和备份。

EXPOSE 3001
CMD ["bun", "src/index.ts"]

import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { Elysia } from "elysia";

import { getDatabaseHealth, initializeDatabase } from "./lib/db";
import { logger } from "./lib/logging/logger";
import { getRuntimeConfig } from "./lib/runtime-config";
import { InMemoryRateLimiter } from "./lib/security/rate-limiter";
import { loadOrCreateSecretBox } from "./lib/security/secret-box";
import { Scheduler } from "./lib/scheduler/scheduler";
import { isMihomoAvailable } from "./lib/validate/mihomo-gate";
import { AuditLogRepository } from "./modules/audit/audit-log.repository";
import { AuditLogService } from "./modules/audit/audit-log.service";
import { AuthService } from "./modules/auth/auth.service";
import { createAuthRoutes } from "./modules/auth/routes";
import { EventRepository } from "./modules/events/event.repository";
import { RulesetRepository } from "./modules/rulesets/ruleset.repository";
import { RulesetService } from "./modules/rulesets/ruleset.service";
import { createRulesetRoutes } from "./modules/rulesets/routes";
import { SecretStore } from "./modules/subscriptions/secret-store";
import { SubscriptionRepository } from "./modules/subscriptions/subscription.repository";
import { SubscriptionService } from "./modules/subscriptions/subscription.service";
import { createSubscriptionRoutes } from "./modules/subscriptions/routes";
import { createDeliveryRoutes } from "./modules/subscriptions/delivery-routes";
import { TemplateRepository } from "./modules/templates/template.repository";
import { createTemplateRoutes } from "./modules/templates/routes";
import { UpstreamSourceRepository } from "./modules/upstream-sources/upstream-source.repository";
import { UpstreamSourceService } from "./modules/upstream-sources/upstream-source.service";
import { createUpstreamSourceRoutes } from "./modules/upstream-sources/routes";

const main = async () => {
  const runtimeConfig = getRuntimeConfig();
  const dbContext = initializeDatabase();
  const db = dbContext.db;

  const rateLimiter = new InMemoryRateLimiter();
  const auditLogService = new AuditLogService(new AuditLogRepository(db));
  const authService = new AuthService(db, runtimeConfig);
  const events = new EventRepository(db);

  const secretBox = loadOrCreateSecretBox({
    secretKeyHex: runtimeConfig.secretKey,
    dataDir: runtimeConfig.dataDir
  });
  const secretStore = new SecretStore(db, secretBox);

  const sourceRepository = new UpstreamSourceRepository(db);
  const sourceService = new UpstreamSourceService(sourceRepository, events);

  const rulesetRepository = new RulesetRepository(db);
  const rulesetService = new RulesetService(rulesetRepository, events);

  const templateRepository = new TemplateRepository(db);
  const subscriptionRepository = new SubscriptionRepository(db);
  const subscriptionService = new SubscriptionService(
    subscriptionRepository,
    sourceRepository,
    rulesetRepository,
    templateRepository,
    events,
    secretStore,
    {
      publicBaseUrl: runtimeConfig.publicBaseUrl,
      mihomo: {
        mihomoPath: runtimeConfig.mihomoPath,
        dataDir: runtimeConfig.dataDir,
        assetsDir: runtimeConfig.assetsDir
      }
    }
  );

  // 同步流 → 构建流：上游同步成功后吸收变化（技术方案 §6.2）
  sourceService.registerOnSynced((source, report) =>
    subscriptionService.onSourceSynced(source, report)
  );

  const scheduler = new Scheduler(sourceService, rulesetService, {
    rulesetCheckIntervalMinutes: runtimeConfig.rulesetCheckIntervalMinutes
  });

  const mihomoAvailable = isMihomoAvailable({
    mihomoPath: runtimeConfig.mihomoPath,
    dataDir: runtimeConfig.dataDir,
    assetsDir: runtimeConfig.assetsDir
  });

  const app = new Elysia()
    .use(cors({ origin: true }))
    .use(
      swagger({
        documentation: {
          info: { title: "ProxyParser API", version: "2.0.0" }
        }
      })
    )
    .use(createAuthRoutes(authService, auditLogService, rateLimiter))
    .use(createUpstreamSourceRoutes(authService, sourceService))
    .use(createRulesetRoutes(authService, rulesetService))
    .use(createSubscriptionRoutes(authService, subscriptionService, secretStore))
    .use(
      createTemplateRoutes(
        authService,
        templateRepository,
        subscriptionRepository,
        subscriptionService
      )
    )
    .use(createDeliveryRoutes(subscriptionService, rulesetService, rateLimiter))
    .get("/api/events", ({ headers, query }) => {
      const user = authService.authenticate(headers.authorization);
      const limit = Math.min(Number(query.limit) || 50, 200);
      return events.listByOwner(user.id, limit);
    })
    .get("/api/instance/health", ({ headers }) => {
      authService.authenticate(headers.authorization);
      return {
        database: getDatabaseHealth(),
        scheduler: { lastTickAt: scheduler.lastTickAt },
        mihomoGate: { available: mihomoAvailable },
        publicBaseUrl: runtimeConfig.publicBaseUrl
      };
    })
    .get("/", () => ({
      name: "ProxyParser backend",
      status: "ok",
      docs: "/swagger"
    }))
    .get("/api/health", () => ({
      status: "ok",
      time: new Date().toISOString(),
      database: getDatabaseHealth()
    }))
    .listen({
      hostname: runtimeConfig.host,
      port: runtimeConfig.port,
      reusePort: false
    });

  scheduler.start();

  logger.info({
    event: "backend.startup",
    port: app.server?.port ?? runtimeConfig.port,
    host: runtimeConfig.host,
    databasePath: dbContext.config.databasePath,
    appliedMigrationCount: dbContext.appliedMigrations.length,
    builtinRulesetSeedCount: dbContext.builtinRulesetSeedCount,
    builtinTemplateSeedCount: dbContext.builtinTemplateSeedCount,
    mihomoGateAvailable: mihomoAvailable
  });

  if (!mihomoAvailable) {
    logger.warn({
      event: "mihomo.gate.unavailable",
      message:
        "未找到 mihomo 二进制，发布门禁降级为仅结构校验。运行 bun scripts/fetch-mihomo.ts 可启用内核校验。"
    });
  }
  if (runtimeConfig.jwtSecret === "dev-insecure-change-me") {
    logger.warn({
      event: "security.jwt_secret.fallback",
      message: "JWT_SECRET is using the development fallback. Set a real value in production."
    });
  }
};

main().catch((error) => {
  logger.error({ event: "backend.startup.failed", error });
  process.exit(1);
});

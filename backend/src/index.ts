import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { Elysia } from "elysia";

import { getDatabaseHealth, initializeDatabase } from "./lib/db";
import { logger } from "./lib/logging/logger";
import { getRuntimeConfig } from "./lib/runtime-config";
import { InMemoryRateLimiter } from "./lib/security/rate-limiter";
import { AuditLogRepository } from "./modules/audit/audit-log.repository";
import { AuditLogService } from "./modules/audit/audit-log.service";
import { AuthService } from "./modules/auth/auth.service";
import { createAuthRoutes } from "./modules/auth/routes";
import { ManagedSubscriptionRepository } from "./modules/subscriptions/managed-subscription.repository";
import {
  createManagedSubscriptionRoutes,
  createPublicSubscriptionRoutes
} from "./modules/subscriptions/routes";
import { ManagedSubscriptionService } from "./modules/subscriptions/managed-subscription.service";
import { SubscriptionAccessRepository } from "./modules/subscriptions/subscription-access.repository";
import { GeneratedSubscriptionDraftRepository } from "./modules/generated-subscription-drafts/generated-subscription-draft.repository";
import { createGeneratedSubscriptionDraftRoutes } from "./modules/generated-subscription-drafts/routes";
import { GeneratedSubscriptionDraftService } from "./modules/generated-subscription-drafts/generated-subscription-draft.service";
import { MarketplaceRepository } from "./modules/marketplace/marketplace.repository";
import { RulesetCatalogService } from "./modules/marketplace/ruleset-catalog.service";
import { createMarketplaceRoutes, createRulesetCatalogRoutes } from "./modules/marketplace/routes";
import { RulesetSyncService } from "./modules/marketplace/ruleset-sync.service";
import { createSettingsRoutes } from "./modules/settings/routes";
import { SettingsService } from "./modules/settings/settings.service";
import { TemplateRepository } from "./modules/templates/template.repository";
import { createTemplateRoutes } from "./modules/templates/routes";
import { TemplateService } from "./modules/templates/template.service";
import { UserRepository } from "./modules/users/user.repository";
import { UpstreamSourceRepository } from "./modules/upstream-sources/upstream-source.repository";
import { createUpstreamSourceRoutes } from "./modules/upstream-sources/routes";
import { UpstreamSourceService } from "./modules/upstream-sources/upstream-source.service";

const main = async () => {
  const runtimeConfig = getRuntimeConfig();
  const dbContext = initializeDatabase();
  const auditLogService = new AuditLogService(new AuditLogRepository(dbContext.db));
  const rateLimiter = new InMemoryRateLimiter();
  const authService = new AuthService(dbContext.db, runtimeConfig);
  const upstreamSourceRepository = new UpstreamSourceRepository(dbContext.db);
  const templateRepository = new TemplateRepository(dbContext.db);
  const subscriptionAccessRepository = new SubscriptionAccessRepository(dbContext.db);
  const upstreamSourceService = new UpstreamSourceService(upstreamSourceRepository);
  const templateService = new TemplateService(templateRepository);
  const marketplaceRepository = new MarketplaceRepository(dbContext.db);
  const generatedSubscriptionDraftRepository = new GeneratedSubscriptionDraftRepository(dbContext.db);
  const generatedSubscriptionDraftService = new GeneratedSubscriptionDraftService(
    generatedSubscriptionDraftRepository,
    upstreamSourceRepository,
    upstreamSourceService,
    marketplaceRepository,
    templateRepository
  );
  const rulesetSyncService = new RulesetSyncService(marketplaceRepository);
  const rulesetCatalogService = new RulesetCatalogService(
    marketplaceRepository,
    rulesetSyncService
  );
  const settingsService = new SettingsService(
    new UserRepository(dbContext.db),
    subscriptionAccessRepository
  );
  const managedSubscriptionService = new ManagedSubscriptionService(
    new ManagedSubscriptionRepository(dbContext.db),
    upstreamSourceRepository,
    upstreamSourceService,
    templateRepository,
    subscriptionAccessRepository,
    generatedSubscriptionDraftService
  );

  const app = new Elysia()
    .use(
      cors({
        origin: true
      })
    )
    .use(
      swagger({
        documentation: {
          info: {
            title: "ProxyParser API",
            version: "1.0.0"
          }
        }
      })
    )
    .use(createAuthRoutes(authService, auditLogService, rateLimiter))
    .use(createUpstreamSourceRoutes(authService, upstreamSourceService))
    .use(createTemplateRoutes(authService, templateService))
    .use(
      createGeneratedSubscriptionDraftRoutes(
        authService,
        generatedSubscriptionDraftService,
        managedSubscriptionService,
        auditLogService
      )
    )
    .use(createManagedSubscriptionRoutes(authService, managedSubscriptionService, auditLogService))
    .use(createRulesetCatalogRoutes(authService, rulesetCatalogService))
    .use(createMarketplaceRoutes(marketplaceRepository))
    .use(createSettingsRoutes(authService, settingsService, auditLogService))
    .use(createPublicSubscriptionRoutes(managedSubscriptionService, rateLimiter))
    .get("/", () => ({
      name: "ProxyParser backend",
      status: "ok",
      docs: "/swagger",
      endpoints: {
        register: "/api/auth/register",
        login: "/api/auth/login",
        refreshToken: "/api/auth/refresh",
        logout: "/api/auth/logout",
        currentUser: "/api/me",
        upstreamSources: "/api/upstream-sources",
        templates: "/api/templates",
        generatedSubscriptionDrafts: "/api/generated-subscription-drafts",
        subscriptions: "/api/subscriptions",
        marketplaceTemplates: "/api/marketplace/templates",
        marketplaceRulesets: "/api/marketplace/rulesets",
        settings: "/api/settings",
        subscribe: "/subscribe/:id?token=<secret>",
        health: "/api/health"
      }
    }))
    .get("/api/health", () => ({
      status: "ok",
      time: new Date().toISOString(),
      database: getDatabaseHealth()
    }))
    .listen(runtimeConfig.port);

  void rulesetSyncService.syncDueRulesets("startup");

  const builtinRulesetSyncTimer = setInterval(() => {
    void rulesetSyncService.syncDueRulesets("scheduled");
  }, 60 * 60 * 1000);
  builtinRulesetSyncTimer.unref?.();

  logger.info({
    event: "backend.startup",
    port: app.server?.port ?? runtimeConfig.port,
    databasePath: dbContext.config.databasePath,
    appliedMigrationCount: dbContext.appliedMigrations.length,
    builtinRulesetSeedCount: dbContext.builtinRulesetSeedCount,
    builtinTemplateSeedCount: dbContext.builtinTemplateSeedCount
  });

  if (runtimeConfig.jwtSecret === "dev-insecure-change-me") {
    logger.warn({
      event: "security.jwt_secret.fallback",
      message: "JWT_SECRET is using the development fallback. Set a real value in production."
    });
  }
};

main().catch((error) => {
  logger.error({
    event: "backend.startup.failed",
    error
  });
  process.exit(1);
});

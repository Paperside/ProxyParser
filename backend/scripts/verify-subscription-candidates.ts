import { Database } from "bun:sqlite";
import { dirname, resolve } from "node:path";

import { listEncryptedSecretRecords } from "../src/lib/db";
import {
  loadOrCreateSecretBox,
  verifySecretBoxCiphertexts
} from "../src/lib/security/secret-box";
import { EventRepository } from "../src/modules/events/event.repository";
import { RulesetRepository } from "../src/modules/rulesets/ruleset.repository";
import { SecretStore } from "../src/modules/subscriptions/secret-store";
import { SubscriptionRepository } from "../src/modules/subscriptions/subscription.repository";
import { SubscriptionService } from "../src/modules/subscriptions/subscription.service";
import { TemplateRepository } from "../src/modules/templates/template.repository";
import { UpstreamSourceRepository } from "../src/modules/upstream-sources/upstream-source.repository";

const databasePath = process.env.DATABASE_PATH;
if (!databasePath) {
  throw new Error("必须显式设置 DATABASE_PATH；该脚本只用于只读 fixture 验证。");
}

const absoluteDatabasePath = resolve(databasePath);
const backendRoot = resolve(import.meta.dir, "..");
const db = new Database(absoluteDatabasePath, { readonly: true });
const encryptedSecrets = listEncryptedSecretRecords(db);
const secretBox = loadOrCreateSecretBox({
  secretKeyHex: process.env.PP_SECRET_KEY ?? null,
  dataDir: dirname(absoluteDatabasePath),
  requireExistingKey: encryptedSecrets.length > 0,
  legacyDataDir: resolve(backendRoot, "data")
});
verifySecretBoxCiphertexts(
  secretBox,
  encryptedSecrets.map((record) => record.ciphertext)
);

const repository = new SubscriptionRepository(db);
const sourceRepository = new UpstreamSourceRepository(db);
const rulesetRepository = new RulesetRepository(db);
const templateRepository = new TemplateRepository(db, secretBox);
const service = new SubscriptionService(
  repository,
  sourceRepository,
  rulesetRepository,
  templateRepository,
  new EventRepository(db),
  new SecretStore(db, secretBox),
  secretBox,
  {
    publicBaseUrl: "https://fixture.invalid",
    mihomo: {
      mihomoPath: process.env.PROXYPARSER_MIHOMO_PATH ?? null,
      dataDir: resolve(backendRoot, "data"),
      assetsDir: resolve(backendRoot, "assets"),
      timeoutMs: 60_000
    }
  }
);

const subscriptions = db
  .query<{ id: string; owner_user_id: string }>(
    "SELECT id, owner_user_id FROM subscriptions ORDER BY created_at"
  )
  .all();

let failures = 0;
for (const subscription of subscriptions) {
  const startedAt = Date.now();
  try {
    const candidate = service.preparePublishCandidate(
      subscription.owner_user_id,
      subscription.id
    );
    const validated = candidate.phase === "rendered"
      ? await service.validatePublishCandidate(
          subscription.owner_user_id,
          subscription.id,
          candidate.candidateId
        )
      : candidate;
    const passed = validated.phase === "validated" && validated.mihomo?.passed === true;
    if (!passed) failures += 1;
    console.log(JSON.stringify({
      subscriptionId: subscription.id,
      phase: validated.phase,
      nodeCount: validated.stats.nodeCount,
      groupCount: validated.stats.groupCount,
      ruleCount: validated.stats.ruleCount,
      providerCount: validated.stats.providerCount,
      yamlBytes: validated.yamlBytes,
      mihomoDurationMs: validated.mihomo?.durationMs ?? null,
      elapsedMs: Date.now() - startedAt,
      passed
    }));
    if (!passed && validated.mihomo?.output) {
      console.error(`${subscription.id}: ${validated.mihomo.output}`);
    }
  } catch (error) {
    failures += 1;
    console.error(`${subscription.id}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

db.close();
if (failures > 0) {
  throw new Error(`${failures} 个订阅候选验证失败。`);
}

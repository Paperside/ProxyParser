import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

import { Database } from "bun:sqlite";

import { ensureRuntimeDirectories, getRuntimeConfig, type RuntimeConfig } from "../runtime-config";
import { seedBuiltinRulesetCatalog } from "./seed-ruleset-catalog";
import { seedBuiltinTemplates } from "./seed-builtin-templates";

const MIGRATIONS_TABLE = "_schema_migrations";

interface MigrationFile {
  id: string;
  path: string;
}

interface CountRow {
  count: number;
}

interface TableNameRow {
  name: string;
}

export interface EncryptedSecretRecord {
  kind: "custom_node_secret" | "subscription_token";
  id: string;
  ciphertext: Uint8Array;
}

interface AppliedMigrationRow {
  id: string;
}

export interface DatabaseContext {
  db: Database;
  config: RuntimeConfig;
  appliedMigrations: string[];
  builtinRulesetSeedCount: number;
  builtinTemplateSeedCount: number;
}

export interface DatabaseHealth {
  path: string;
  migrationCount: number;
  tableCount: number;
  rulesetCatalogCount: number;
}

let databaseContext: DatabaseContext | null = null;

const configureDatabase = (db: Database) => {
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
};

const ensureMigrationsTable = (db: Database) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
};

export const assertKnownDatabaseBeforeMigrations = (
  db: Database,
  databasePath: string
) => {
  const userTables = db
    .query<TableNameRow>(
      `SELECT name
       FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name ASC`
    )
    .all()
    .map((row) => row.name);

  if (userTables.length === 0) {
    return;
  }

  if (userTables.includes(MIGRATIONS_TABLE)) {
    const nonMarkerTables = userTables.filter((name) => name !== MIGRATIONS_TABLE);
    if (nonMarkerTables.length === 0) return;
    const initialMigration = db
      .query<AppliedMigrationRow>(
        `SELECT id FROM ${MIGRATIONS_TABLE} WHERE id = '0001_schema.sql' LIMIT 1`
      )
      .get();
    if (initialMigration) return;

    throw new Error(
      [
        `数据库 ${databasePath} 包含迁移标记和业务表，但没有已应用的 0001_schema.sql。`,
        "它可能是中断迁移、旧版或伪装成 Next 的未知 schema；ProxyParser 已停止启动。",
        "请恢复同一备份集或完成显式迁移，不要让程序自动混合 schema。"
      ].join(" ")
    );
  }

  throw new Error(
    [
      `数据库 ${databasePath} 已包含表，但缺少 ${MIGRATIONS_TABLE} 迁移标记。`,
      "它可能是旧版或未知 schema；为避免把 Next 表和迁移混入原库，ProxyParser 已停止启动。",
      "请先备份完整数据库文件组，再按迁移文档确认或转换数据库；程序不会自动接管未知 schema。"
    ].join(" ")
  );
};

const listMigrationFiles = (migrationsDir: string): MigrationFile[] => {
  if (!existsSync(migrationsDir)) {
    return [];
  }

  return readdirSync(migrationsDir)
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right))
    .map((fileName) => ({
      id: fileName,
      path: resolve(migrationsDir, fileName)
    }));
};

const applyMigrations = (db: Database, migrationsDir: string) => {
  const migrations = listMigrationFiles(migrationsDir);
  const appliedMigrations = new Set(
    db
      .query<AppliedMigrationRow>(`SELECT id FROM ${MIGRATIONS_TABLE} ORDER BY id ASC`)
      .all()
      .map((row) => row.id)
  );
  const markMigration = db.query(
    `INSERT INTO ${MIGRATIONS_TABLE} (id, applied_at) VALUES (?, ?)`
  );
  const appliedThisRun: string[] = [];

  for (const migration of migrations) {
    if (appliedMigrations.has(migration.id)) {
      continue;
    }

    const sql = readFileSync(migration.path, "utf-8");

    db.exec("BEGIN");

    try {
      db.exec(sql);
      markMigration.run(migration.id, new Date().toISOString());
      db.exec("COMMIT");
      appliedThisRun.push(migration.id);
    } catch (error) {
      db.exec("ROLLBACK");

      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to apply migration ${basename(migration.path)}: ${reason}`);
    }
  }

  return appliedThisRun;
};

const countByQuery = (db: Database, sql: string) => {
  return db.query<CountRow>(sql).get()?.count ?? 0;
};

export const initializeDatabase = (): DatabaseContext => {
  if (databaseContext) {
    return databaseContext;
  }

  const config = getRuntimeConfig();
  ensureRuntimeDirectories(config);

  const db = new Database(config.databasePath, {
    create: true
  });
  try {
    assertKnownDatabaseBeforeMigrations(db, config.databasePath);
    configureDatabase(db);
    ensureMigrationsTable(db);

    const appliedMigrations = applyMigrations(db, config.migrationsDir);
    const builtinRulesetSeedCount = seedBuiltinRulesetCatalog(db);
    const builtinTemplateSeedCount = seedBuiltinTemplates(db);

    databaseContext = {
      db,
      config,
      appliedMigrations,
      builtinRulesetSeedCount,
      builtinTemplateSeedCount
    };

    return databaseContext;
  } catch (error) {
    db.close();
    throw error;
  }
};

export const getDatabase = () => {
  return initializeDatabase().db;
};

export const getDatabaseHealth = (): DatabaseHealth => {
  const { db, config } = initializeDatabase();

  return {
    path: config.databasePath,
    migrationCount: countByQuery(db, `SELECT COUNT(*) AS count FROM ${MIGRATIONS_TABLE}`),
    tableCount: countByQuery(
      db,
      "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
    ),
    rulesetCatalogCount: countByQuery(db, "SELECT COUNT(*) AS count FROM ruleset_catalog")
  };
};

// 单条查询取得所有依赖 SecretBox 的密文，避免“先 count、后 sample”间的观察窗口，
// 并让启动门禁覆盖自建节点与长期订阅 token 的每一条记录。
export const listEncryptedSecretRecords = (db: Database): EncryptedSecretRecord[] => {
  const hasTemplateSecrets = Boolean(
    db.query<{ present: number }>(
      "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'template_version_secrets'"
    ).get()
  );
  return db
    .query<EncryptedSecretRecord>(`
      SELECT 'custom_node_secret' AS kind, id, ciphertext
      FROM custom_node_secrets
      UNION ALL
      SELECT 'subscription_token' AS kind, id, token_ciphertext AS ciphertext
      FROM subscription_tokens
      WHERE token_ciphertext IS NOT NULL
      ${hasTemplateSecrets ? `UNION ALL
        SELECT 'template_version_secret' AS kind, template_version_id || ':' || node_id AS id, ciphertext
        FROM template_version_secrets` : ""}
      ORDER BY kind ASC, id ASC
    `)
    .all();
};

export const getBackendDataDir = () => {
  return dirname(getRuntimeConfig().databasePath);
};

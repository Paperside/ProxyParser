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

export const getBackendDataDir = () => {
  return dirname(getRuntimeConfig().databasePath);
};

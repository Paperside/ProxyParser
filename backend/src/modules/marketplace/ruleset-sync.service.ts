import { createHash } from "node:crypto";

import yaml from "js-yaml";

import { createId } from "../../lib/ids";
import {
  MarketplaceRepository,
  type RulesetCatalogMetadata
} from "./marketplace.repository";

const FAILURE_RETRY_SECONDS = 60 * 60;

const buildContentHash = (content: string) => {
  return createHash("sha256").update(content).digest("hex");
};

const buildExpiresAt = (seconds: number) => {
  return new Date(Date.now() + seconds * 1000).toISOString();
};

const normalizeRulesetText = (content: string) => {
  const trimmed = content.trim();

  if (!trimmed) {
    throw new Error("规则内容为空。");
  }

  const parsed = yaml.load(trimmed);

  if (
    typeof parsed === "object" &&
    parsed !== null &&
    Array.isArray((parsed as Record<string, unknown>).payload)
  ) {
    return `${trimmed}\n`;
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  if (lines.length === 0) {
    throw new Error("规则内容无法解析为 payload。");
  }

  return yaml.dump(
    {
      payload: lines
    },
    {
      noRefs: true,
      lineWidth: 120
    }
  );
};

const getUpdateIntervalSeconds = (metadata: RulesetCatalogMetadata) => {
  const value = metadata.updateIntervalSeconds;
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 24 * 60 * 60;
};

const isDueForSync = (entry: {
  latestExpiresAt: string | null;
  latestFetchStatus: "success" | "failed" | null;
}) => {
  if (!entry.latestExpiresAt) {
    return true;
  }

  if (entry.latestFetchStatus === "failed") {
    return new Date(entry.latestExpiresAt).getTime() <= Date.now();
  }

  return new Date(entry.latestExpiresAt).getTime() <= Date.now();
};

export class RulesetSyncService {
  private currentRun: Promise<{
    scanned: number;
    due: number;
    success: number;
    failed: number;
  }> | null = null;

  constructor(private readonly repository: MarketplaceRepository) {}

  async syncDueRulesets(reason: "startup" | "scheduled" | "manual" = "manual") {
    if (this.currentRun) {
      return this.currentRun;
    }

    this.currentRun = this.performSync(reason).finally(() => {
      this.currentRun = null;
    });

    return this.currentRun;
  }

  async syncRulesetById(rulesetId: string) {
    const entry = this.repository.findRulesetById(rulesetId);

    if (!entry) {
      throw new Error("未找到该规则源。");
    }

    await this.syncOne({
      ...entry,
      latestContentText: entry.latestContentText,
      latestContentHash: entry.latestContentHash,
      latestEtag: entry.latestEtag,
      latestLastModifiedHeader: entry.latestLastModifiedHeader
    });

    return this.repository.findRulesetById(rulesetId);
  }

  private async performSync(reason: "startup" | "scheduled" | "manual") {
    const candidates = this.repository.listSyncableRulesets();
    const dueItems = candidates.filter(isDueForSync);

    if (dueItems.length === 0) {
      return {
        scanned: candidates.length,
        due: 0,
        success: 0,
        failed: 0
      };
    }

    let success = 0;
    let failed = 0;

    for (const entry of dueItems) {
      try {
        await this.syncOne(entry);
        success += 1;
      } catch (error) {
        failed += 1;
        console.error(
          `[ruleset-sync:${reason}] failed to sync ${entry.slug}:`,
          error
        );
      }
    }

    console.log(
      `[ruleset-sync:${reason}] scanned=${candidates.length} due=${dueItems.length} success=${success} failed=${failed}`
    );

    return {
      scanned: candidates.length,
      due: dueItems.length,
      success,
      failed
    };
  }

  private async syncOne(entry: ReturnType<MarketplaceRepository["listSyncableRulesets"]>[number]) {
    if (!entry.sourceUrl) {
      throw new Error(`规则源 ${entry.slug} 缺少 sourceUrl。`);
    }

    const fetchedAt = new Date().toISOString();

    try {
      const response = await fetch(entry.sourceUrl, {
        headers: {
          "user-agent": "ProxyParser/1.0 (+https://github.com/lanjiasheng/ProxyParser)"
        }
      });

      const text = await response.text();

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const normalizedContent = normalizeRulesetText(text);

      this.repository.createRulesetCacheEntry({
        id: createId("rcache"),
        catalogItemId: entry.id,
        contentText: normalizedContent,
        contentHash: buildContentHash(normalizedContent),
        etag: response.headers.get("etag"),
        lastModifiedHeader: response.headers.get("last-modified"),
        fetchStatus: "success",
        errorMessage: null,
        fetchedAt,
        expiresAt: buildExpiresAt(getUpdateIntervalSeconds(entry.metadata))
      });
      this.repository.touchRulesetCatalog(entry.id, fetchedAt);
    } catch (error) {
      this.repository.createRulesetCacheEntry({
        id: createId("rcache"),
        catalogItemId: entry.id,
        contentText: entry.latestContentText ?? "",
        contentHash: entry.latestContentHash ?? null,
        etag: entry.latestEtag,
        lastModifiedHeader: entry.latestLastModifiedHeader,
        fetchStatus: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
        fetchedAt,
        expiresAt: buildExpiresAt(FAILURE_RETRY_SECONDS)
      });

      throw error;
    }
  }
}

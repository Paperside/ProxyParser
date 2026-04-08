import { createHash } from "node:crypto";

import type { ClashProxyDocument, UpstreamSourceDetail, UpstreamSourceSummary } from "../../types";
import { createId } from "../../lib/ids";
import { fetchSubscriptionByUrl } from "../../lib/fetch-subscription";
import { parseProxyWithString } from "../../lib/proxy-content";
import { parseSubscriptionUserInfo } from "../../lib/subscription-userinfo";
import {
  UpstreamSourceRepository,
  type UpstreamSourceRecord
} from "./upstream-source.repository";

interface CreateSourceInput {
  displayName: string;
  sourceUrl: string;
  visibility?: "private" | "unlisted" | "public";
  shareMode?: "disabled" | "view" | "fork";
}

interface UpdateSourceInput {
  displayName?: string;
  sourceUrl?: string;
  visibility?: "private" | "unlisted" | "public";
  shareMode?: "disabled" | "view" | "fork";
  isEnabled?: boolean;
}

const STALE_AFTER_MS = 36 * 60 * 60 * 1000;

export class UpstreamSourceError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

const parseDocument = (parsedJson: string | null): ClashProxyDocument | null => {
  if (!parsedJson) {
    return null;
  }

  return JSON.parse(parsedJson) as ClashProxyDocument;
};

const toSummary = (
  source: UpstreamSourceRecord,
  parsedConfig: ClashProxyDocument | null
): UpstreamSourceSummary => {
  const lastSuccessfulAt = source.lastSuccessfulSyncAt
    ? new Date(source.lastSuccessfulSyncAt).getTime()
    : null;
  const derivedStatus =
    source.lastSyncStatus !== "syncing" &&
    lastSuccessfulAt !== null &&
    Date.now() - lastSuccessfulAt >= STALE_AFTER_MS
      ? "stale"
      : source.lastSyncStatus;

  return {
    id: source.id,
    ownerUserId: source.ownerUserId,
    displayName: source.displayName,
    sourceUrl: source.sourceUrl,
    visibility: source.visibility,
    shareMode: source.shareMode,
    isEnabled: source.isEnabled,
    lastSyncStatus: derivedStatus,
    lastSyncAt: source.lastSyncAt,
    lastSuccessfulSyncAt: source.lastSuccessfulSyncAt,
    lastFailedSyncAt: source.lastFailedSyncAt,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    headers: source.latestHeaders,
    usage: source.latestUsage,
    proxyCount: parsedConfig?.proxies.length ?? 0,
    groupCount: parsedConfig?.["proxy-groups"].length ?? 0,
    ruleCount: parsedConfig?.rules?.length ?? 0
  };
};

export class UpstreamSourceService {
  constructor(private readonly repository: UpstreamSourceRepository) {}

  listByOwner(ownerUserId: string) {
    return this.repository.listByOwner(ownerUserId).map((source) => {
      const snapshot = source.lastSuccessfulSnapshotId
        ? this.repository.findSnapshotById(source.lastSuccessfulSnapshotId)
        : this.repository.findLatestSnapshot(source.id);

      return toSummary(source, parseDocument(snapshot?.parsedJson ?? null));
    });
  }

  getById(ownerUserId: string, sourceId: string): UpstreamSourceDetail {
    const source = this.repository.findByIdAndOwner(sourceId, ownerUserId);

    if (!source) {
      throw new UpstreamSourceError("未找到该上游订阅源。", 404);
    }

    const snapshot = source.lastSuccessfulSnapshotId
      ? this.repository.findSnapshotById(source.lastSuccessfulSnapshotId)
      : this.repository.findLatestSnapshot(source.id);
    const parsedConfig = parseDocument(snapshot?.parsedJson ?? null);

    return {
      ...toSummary(source, parsedConfig),
      latestSnapshotId: snapshot?.id ?? null,
      parsedConfig
    };
  }

  create(ownerUserId: string, input: CreateSourceInput) {
    if (!input.displayName.trim()) {
      throw new UpstreamSourceError("订阅源名称不能为空。", 400);
    }

    if (!/^https?:\/\//i.test(input.sourceUrl.trim())) {
      throw new UpstreamSourceError("订阅链接必须是 http 或 https 地址。", 400);
    }

    const created = this.repository.create({
      id: createId("src"),
      ownerUserId,
      displayName: input.displayName.trim(),
      sourceUrl: input.sourceUrl.trim(),
      visibility: input.visibility ?? "private",
      shareMode: input.shareMode ?? "disabled"
    });

    if (!created) {
      throw new UpstreamSourceError("创建上游订阅源失败。", 500);
    }

    return this.getById(ownerUserId, created.id);
  }

  update(ownerUserId: string, sourceId: string, input: UpdateSourceInput) {
    const updated = this.repository.update(sourceId, ownerUserId, {
      displayName: input.displayName?.trim(),
      sourceUrl: input.sourceUrl?.trim(),
      visibility: input.visibility,
      shareMode: input.shareMode,
      isEnabled: input.isEnabled
    });

    if (!updated) {
      throw new UpstreamSourceError("未找到该上游订阅源。", 404);
    }

    return this.getById(ownerUserId, updated.id);
  }

  async sync(ownerUserId: string, sourceId: string) {
    const source = this.repository.findByIdAndOwner(sourceId, ownerUserId);

    if (!source) {
      throw new UpstreamSourceError("未找到该上游订阅源。", 404);
    }

    const startedAt = new Date().toISOString();
    const syncLogId = createId("sync");

    this.repository.createSyncLog({
      id: syncLogId,
      sourceId,
      status: "syncing",
      startedAt
    });

    const latestSnapshot = this.repository.findLatestSnapshot(source.id);
    const response = await fetchSubscriptionByUrl(source.sourceUrl, {
      etag: latestSnapshot?.etag ?? null,
      lastModified: latestSnapshot?.lastModifiedHeader ?? null,
      timeoutMs: 12_000,
      retries: 2
    });
    const headersJson = response.headers ? JSON.stringify(response.headers) : null;

    if (response.status === "failed" || !response.text) {
      if (response.notModified && source.lastSuccessfulSnapshotId) {
        this.repository.updateSyncLog({
          id: syncLogId,
          sourceId,
          status: "success",
          httpStatus: response.httpStatus ?? 304,
          responseHeadersJson: headersJson,
          startedAt,
          finishedAt: new Date().toISOString()
        });
        this.repository.updateSyncResult({
          sourceId,
          status: "success",
          syncedAt: new Date().toISOString(),
          latestHeadersJson: headersJson
        });

        return this.getById(ownerUserId, sourceId);
      }

      this.repository.updateSyncLog({
        id: syncLogId,
        sourceId,
        status: "failed",
        httpStatus: response.httpStatus ?? null,
        errorMessage: response.errMsg ?? "拉取上游订阅失败。",
        responseHeadersJson: headersJson,
        startedAt,
        finishedAt: new Date().toISOString()
      });
      this.repository.updateSyncResult({
        sourceId,
        status: "failed",
        syncedAt: new Date().toISOString(),
        latestHeadersJson: headersJson
      });

      return this.getById(ownerUserId, sourceId);
    }

    const parsed = parseProxyWithString(response.text);
    const usage = parseSubscriptionUserInfo(response.headers?.["subscription-userinfo"]);
    const usageJson = usage ? JSON.stringify(usage) : null;
    const snapshotId = createId("snap");

    this.repository.createSnapshot({
      id: snapshotId,
      sourceId,
      syncLogId,
      rawContent: response.text,
      parsedJson: parsed ? JSON.stringify(parsed) : null,
      responseHeadersJson: headersJson,
      usageJson,
      contentHash: createHash("sha256").update(response.text).digest("hex"),
      etag: response.headers?.etag ?? null,
      lastModifiedHeader: response.headers?.["last-modified"] ?? null,
      createdAt: new Date().toISOString()
    });

    if (!parsed) {
      this.repository.updateSyncLog({
        id: syncLogId,
        sourceId,
        status: "failed",
        errorMessage: "订阅内容不是有效的 Mihomo / Clash YAML。",
        responseHeadersJson: headersJson,
        startedAt,
        finishedAt: new Date().toISOString()
      });
      this.repository.updateSyncResult({
        sourceId,
        status: "failed",
        syncedAt: new Date().toISOString(),
        latestHeadersJson: headersJson,
        latestUsageJson: usageJson
      });

      return this.getById(ownerUserId, sourceId);
    }

    this.repository.updateSyncLog({
      id: syncLogId,
      sourceId,
      status: "success",
      responseHeadersJson: headersJson,
      startedAt,
      finishedAt: new Date().toISOString()
    });
    this.repository.updateSyncResult({
      sourceId,
      status: "success",
      syncedAt: new Date().toISOString(),
      latestHeadersJson: headersJson,
      latestUsageJson: usageJson,
      lastSuccessfulSnapshotId: snapshotId
    });

    return this.getById(ownerUserId, sourceId);
  }

  delete(ownerUserId: string, sourceId: string) {
    const exists = this.repository.findByIdAndOwner(sourceId, ownerUserId);

    if (!exists) {
      throw new UpstreamSourceError("未找到该上游订阅源。", 404);
    }

    this.repository.delete(sourceId, ownerUserId);

    return {
      success: true
    };
  }
}

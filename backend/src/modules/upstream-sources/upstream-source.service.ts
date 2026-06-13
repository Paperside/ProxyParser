import { createHash } from "node:crypto";

import type { ClashProxyDocument, UpstreamSourceDetail, UpstreamSourceSummary } from "../../types";
import { createId } from "../../lib/ids";
import { fetchSubscriptionByUrl } from "../../lib/fetch-subscription";
import { parseProxyWithString } from "../../lib/proxy-content";
import {
  findSubscriptionUserInfoHeader,
  parseSubscriptionUserInfo
} from "../../lib/subscription-userinfo";
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

interface CreateUploadedSourceInput {
  displayName: string;
  yamlContent: string;
  uploadedFileName?: string | null;
  visibility?: "private" | "unlisted" | "public";
  shareMode?: "disabled" | "view" | "fork";
}

interface UpdateSourceInput {
  displayName?: string;
  sourceUrl?: string;
  yamlContent?: string;
  uploadedFileName?: string | null;
  visibility?: "private" | "unlisted" | "public";
  shareMode?: "disabled" | "view" | "fork";
  isEnabled?: boolean;
}

const STALE_AFTER_MS = 36 * 60 * 60 * 1000;
const UPLOADED_SOURCE_URL_PREFIX = "uploaded://";

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

const assertValidSourceUrl = (sourceUrl: string) => {
  if (!/^https?:\/\//i.test(sourceUrl.trim())) {
    throw new UpstreamSourceError("订阅链接必须是 http 或 https 地址。", 400);
  }
};

const normalizeUploadedFileName = (uploadedFileName: string | null | undefined) => {
  const normalized = uploadedFileName?.trim();
  return normalized ? normalized.slice(0, 255) : null;
};

const parseUploadedYaml = (yamlContent: string) => {
  const normalized = yamlContent.trim();

  if (!normalized) {
    throw new UpstreamSourceError("上传的 YAML 内容不能为空。", 400);
  }

  const parsed = parseProxyWithString(normalized);

  if (!parsed) {
    throw new UpstreamSourceError("上传的 YAML 不是有效的 Mihomo / Clash 订阅。", 400);
  }

  return {
    yamlContent: normalized,
    parsed
  };
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
    sourceKind: source.sourceKind,
    uploadedFileName: source.uploadedFileName,
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

    assertValidSourceUrl(input.sourceUrl);

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

  createFromUpload(ownerUserId: string, input: CreateUploadedSourceInput) {
    if (!input.displayName.trim()) {
      throw new UpstreamSourceError("订阅源名称不能为空。", 400);
    }

    const parsedUpload = parseUploadedYaml(input.yamlContent);
    const sourceId = createId("src");
    const created = this.repository.create({
      id: sourceId,
      ownerUserId,
      displayName: input.displayName.trim(),
      sourceUrl: `${UPLOADED_SOURCE_URL_PREFIX}${sourceId}`,
      sourceKind: "uploaded_yaml",
      uploadedFileName: normalizeUploadedFileName(input.uploadedFileName),
      visibility: input.visibility ?? "private",
      shareMode: input.shareMode ?? "disabled"
    });

    if (!created) {
      throw new UpstreamSourceError("创建上游订阅源失败。", 500);
    }

    this.createUploadedSnapshot(sourceId, parsedUpload.yamlContent, parsedUpload.parsed);

    return this.getById(ownerUserId, sourceId);
  }

  async createAndSync(ownerUserId: string, input: CreateSourceInput) {
    const created = this.create(ownerUserId, input);
    return this.sync(ownerUserId, created.id);
  }

  update(ownerUserId: string, sourceId: string, input: UpdateSourceInput) {
    const current = this.repository.findByIdAndOwner(sourceId, ownerUserId);

    if (!current) {
      throw new UpstreamSourceError("未找到该上游订阅源。", 404);
    }

    if (input.sourceUrl !== undefined) {
      if (current.sourceKind === "uploaded_yaml") {
        throw new UpstreamSourceError("上传文件来源不能改为远端订阅链接。", 400);
      }

      assertValidSourceUrl(input.sourceUrl);
    }

    if (input.yamlContent !== undefined && current.sourceKind !== "uploaded_yaml") {
      throw new UpstreamSourceError("远端链接来源不能直接替换为上传文件。", 400);
    }

    const updated = this.repository.update(sourceId, ownerUserId, {
      displayName: input.displayName?.trim(),
      sourceUrl: input.sourceUrl?.trim(),
      uploadedFileName:
        input.yamlContent === undefined
          ? input.uploadedFileName
          : normalizeUploadedFileName(input.uploadedFileName),
      visibility: input.visibility,
      shareMode: input.shareMode,
      isEnabled: input.isEnabled
    });

    if (!updated) {
      throw new UpstreamSourceError("未找到该上游订阅源。", 404);
    }

    if (input.yamlContent !== undefined) {
      const parsedUpload = parseUploadedYaml(input.yamlContent);
      this.createUploadedSnapshot(sourceId, parsedUpload.yamlContent, parsedUpload.parsed);
    }

    return this.getById(ownerUserId, updated.id);
  }

  async sync(ownerUserId: string, sourceId: string) {
    const source = this.repository.findByIdAndOwner(sourceId, ownerUserId);

    if (!source) {
      throw new UpstreamSourceError("未找到该上游订阅源。", 404);
    }

    if (source.sourceKind === "uploaded_yaml") {
      return this.getById(ownerUserId, sourceId);
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
      timeoutMs: 20_000,
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
    const usage = parseSubscriptionUserInfo(findSubscriptionUserInfoHeader(response.headers));
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

  private createUploadedSnapshot(
    sourceId: string,
    yamlContent: string,
    parsed: ClashProxyDocument
  ) {
    const now = new Date().toISOString();
    const syncLogId = createId("sync");
    const snapshotId = createId("snap");
    const headersJson = JSON.stringify({});

    this.repository.createSyncLog({
      id: syncLogId,
      sourceId,
      status: "success",
      httpStatus: null,
      responseHeadersJson: headersJson,
      startedAt: now,
      finishedAt: now
    });
    this.repository.createSnapshot({
      id: snapshotId,
      sourceId,
      syncLogId,
      rawContent: yamlContent,
      parsedJson: JSON.stringify(parsed),
      responseHeadersJson: headersJson,
      contentHash: createHash("sha256").update(yamlContent).digest("hex"),
      createdAt: now
    });
    this.repository.updateSyncResult({
      sourceId,
      status: "success",
      syncedAt: now,
      latestHeadersJson: headersJson,
      lastSuccessfulSnapshotId: snapshotId
    });
  }
}

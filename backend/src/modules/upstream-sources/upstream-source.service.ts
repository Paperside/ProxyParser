import { createHash } from "node:crypto";

import { createId } from "../../lib/ids";
import { fetchSubscriptionByUrl } from "../../lib/fetch-subscription";
import { identifyNodes } from "../../lib/build-config/node-identity";
import { logger } from "../../lib/logging/logger";
import { parseProxyWithString } from "../../lib/proxy-content";
import {
  findSubscriptionUserInfoHeader,
  parseSubscriptionUserInfo
} from "../../lib/subscription-userinfo";
import type { ClashProxyDocument } from "../../types";
import type { EventRepository } from "../events/event.repository";
import type {
  SourceRecord,
  SourceSnapshotRecord,
  SyncReportRecord,
  UpstreamSourceRepository
} from "./upstream-source.repository";

export class UpstreamSourceError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
  }
}

export type SourceSyncedHook = (
  source: SourceRecord,
  report: SyncReportRecord | null
) => Promise<void> | void;

const sha256Hex = (input: string) => createHash("sha256").update(input).digest("hex");

const isValidHttpUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

// 下一次同步时间：interval ± 10% 抖动，避免整点齐发（技术方案 §9）
const computeNextSyncAt = (intervalMinutes: number) => {
  const jitter = 1 + (Math.random() * 0.2 - 0.1);
  return new Date(Date.now() + intervalMinutes * 60_000 * jitter).toISOString();
};

export interface SourceWithStats extends SourceRecord {
  proxyCount: number;
  groupCount: number;
  ruleCount: number;
}

export class UpstreamSourceService {
  private onSyncedHooks: SourceSyncedHook[] = [];

  constructor(
    private readonly repository: UpstreamSourceRepository,
    private readonly events: EventRepository
  ) {}

  registerOnSynced(hook: SourceSyncedHook) {
    this.onSyncedHooks.push(hook);
  }

  listByOwner(ownerUserId: string): SourceWithStats[] {
    return this.repository.listByOwner(ownerUserId).map((source) => this.withStats(source));
  }

  getById(ownerUserId: string, id: string): SourceWithStats {
    const source = this.repository.findByIdAndOwner(id, ownerUserId);
    if (!source) {
      throw new UpstreamSourceError("订阅源不存在。", 404);
    }
    return this.withStats(source);
  }

  getLatestSnapshot(sourceId: string): SourceSnapshotRecord | null {
    return this.repository.findLatestSuccessfulSnapshot(sourceId);
  }

  listSyncReports(ownerUserId: string, id: string) {
    this.getById(ownerUserId, id);
    return this.repository.listSyncReports(id);
  }

  async create(
    ownerUserId: string,
    input: { displayName: string; sourceUrl: string; syncIntervalMinutes?: number }
  ): Promise<SourceWithStats> {
    if (!isValidHttpUrl(input.sourceUrl)) {
      throw new UpstreamSourceError("订阅链接必须是合法的 http(s) URL。");
    }
    const source = this.repository.create({
      id: createId("src"),
      ownerUserId,
      displayName: input.displayName || "未命名订阅源",
      sourceUrl: input.sourceUrl,
      sourceKind: "url",
      uploadedFileName: null,
      syncIntervalMinutes: input.syncIntervalMinutes ?? 360
    });
    await this.sync(source.id).catch(() => undefined);
    return this.getById(ownerUserId, source.id);
  }

  createFromUpload(
    ownerUserId: string,
    input: { displayName: string; yamlContent: string; uploadedFileName?: string }
  ): SourceWithStats {
    const parsed = parseProxyWithString(input.yamlContent);
    if (!parsed) {
      throw new UpstreamSourceError("上传内容不是合法的 Clash/Mihomo YAML（缺少 proxies）。");
    }
    const source = this.repository.create({
      id: createId("src"),
      ownerUserId,
      displayName: input.displayName || input.uploadedFileName || "上传的订阅",
      sourceUrl: `uploaded://${input.uploadedFileName ?? "config.yaml"}`,
      sourceKind: "uploaded_yaml",
      uploadedFileName: input.uploadedFileName ?? null,
      syncIntervalMinutes: 0
    });
    this.storeSnapshotAndReport(source, input.yamlContent, parsed, {}, null, null);
    return this.getById(ownerUserId, source.id);
  }

  replaceUpload(ownerUserId: string, id: string, yamlContent: string): SourceWithStats {
    const source = this.repository.findByIdAndOwner(id, ownerUserId);
    if (!source || source.sourceKind !== "uploaded_yaml") {
      throw new UpstreamSourceError("订阅源不存在或不是上传类型。", 404);
    }
    const parsed = parseProxyWithString(yamlContent);
    if (!parsed) {
      throw new UpstreamSourceError("上传内容不是合法的 Clash/Mihomo YAML（缺少 proxies）。");
    }
    this.storeSnapshotAndReport(source, yamlContent, parsed, {}, null, null);
    return this.getById(ownerUserId, id);
  }

  update(
    ownerUserId: string,
    id: string,
    patch: Partial<{
      displayName: string;
      sourceUrl: string;
      isEnabled: boolean;
      syncIntervalMinutes: number;
    }>
  ): SourceWithStats {
    const source = this.repository.findByIdAndOwner(id, ownerUserId);
    if (!source) {
      throw new UpstreamSourceError("订阅源不存在。", 404);
    }
    if (patch.sourceUrl !== undefined && !isValidHttpUrl(patch.sourceUrl)) {
      throw new UpstreamSourceError("订阅链接必须是合法的 http(s) URL。");
    }
    if (
      patch.syncIntervalMinutes !== undefined &&
      (patch.syncIntervalMinutes < 15 || patch.syncIntervalMinutes > 7 * 24 * 60)
    ) {
      throw new UpstreamSourceError("同步间隔必须在 15 分钟到 7 天之间。");
    }
    this.repository.update(id, patch);
    return this.getById(ownerUserId, id);
  }

  delete(ownerUserId: string, id: string) {
    const source = this.repository.findByIdAndOwner(id, ownerUserId);
    if (!source) {
      throw new UpstreamSourceError("订阅源不存在。", 404);
    }
    this.repository.delete(id);
    return { ok: true };
  }

  async syncByOwner(ownerUserId: string, id: string): Promise<SourceWithStats> {
    const source = this.repository.findByIdAndOwner(id, ownerUserId);
    if (!source) {
      throw new UpstreamSourceError("订阅源不存在。", 404);
    }
    if (source.sourceKind !== "url") {
      throw new UpstreamSourceError("上传类型的订阅源请直接替换内容。");
    }
    await this.sync(id);
    return this.getById(ownerUserId, id);
  }

  // 核心同步（调度器与手动共用）。成功后生成同步报告并触发 hooks。
  async sync(sourceId: string): Promise<void> {
    const source = this.repository.findById(sourceId);
    if (!source || source.sourceKind !== "url") {
      return;
    }
    if (!this.repository.tryBeginSync(sourceId)) {
      return; // 已有同步在进行
    }

    const nextSyncAt = computeNextSyncAt(source.syncIntervalMinutes || 360);
    const previousSnapshot = this.repository.findLatestSuccessfulSnapshot(sourceId);

    try {
      const result = await fetchSubscriptionByUrl(source.sourceUrl, {
        etag: previousSnapshot?.etag ?? null,
        lastModified: previousSnapshot?.lastModifiedHeader ?? null
      });

      if (result.status === "failed" || result.text === undefined) {
        if (result.notModified) {
          this.repository.finishSyncNotModified(sourceId, nextSyncAt);
          return;
        }
        throw new Error(result.errMsg ?? "抓取失败");
      }

      const parsed = parseProxyWithString(result.text);
      if (!parsed || !Array.isArray(parsed.proxies) || parsed.proxies.length === 0) {
        throw new Error("返回内容不是合法的 Clash/Mihomo 配置（缺少 proxies）。");
      }

      const headers = result.headers ?? {};
      const usage = parseSubscriptionUserInfo(findSubscriptionUserInfoHeader(headers));
      const refreshed = this.repository.findById(sourceId)!;
      const report = this.storeSnapshotAndReport(
        refreshed,
        result.text,
        parsed,
        headers,
        headers.etag ?? null,
        headers["last-modified"] ?? null,
        nextSyncAt
      );

      const finalSource = this.repository.findById(sourceId)!;
      for (const hook of this.onSyncedHooks) {
        try {
          await hook(finalSource, report);
        } catch (error) {
          logger.warn({
            event: "source.hook.failed",
            sourceId,
            reason: error instanceof Error ? error.message : String(error)
          });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.repository.finishSyncFailure(sourceId, message, nextSyncAt);
      this.events.insert({
        ownerUserId: source.ownerUserId,
        entityKind: "source",
        entityId: sourceId,
        kind: "source.sync_failed",
        payload: { displayName: source.displayName, error: message }
      });
      logger.warn({ event: "source.sync.failed", sourceId, reason: message });
      throw new UpstreamSourceError(`同步失败：${message}`, 502);
    }
  }

  listDue(limit: number) {
    return this.repository.listDue(limit);
  }

  private storeSnapshotAndReport(
    source: SourceRecord,
    rawContent: string,
    parsed: ClashProxyDocument,
    headers: Record<string, string>,
    etag: string | null,
    lastModifiedHeader: string | null,
    nextSyncAt?: string
  ): SyncReportRecord | null {
    const previousSnapshot = this.repository.findLatestSuccessfulSnapshot(source.id);
    const snapshotId = createId("snap");
    const usage = parseSubscriptionUserInfo(findSubscriptionUserInfoHeader(headers));

    this.repository.createSnapshot({
      id: snapshotId,
      sourceId: source.id,
      rawContent,
      parsedJson: JSON.stringify(parsed),
      headers,
      usage,
      contentHash: sha256Hex(rawContent),
      etag,
      lastModifiedHeader
    });
    this.repository.finishSyncSuccess({
      id: source.id,
      snapshotId,
      headers,
      usage,
      nextSyncAt: nextSyncAt ?? computeNextSyncAt(source.syncIntervalMinutes || 360)
    });

    // 结构化同步报告（按稳定 ID 对比，技术方案 §4.2 同步流）
    const report = this.buildSyncReport(source.id, previousSnapshot, snapshotId, parsed);
    if (report) {
      this.events.insert({
        ownerUserId: source.ownerUserId,
        entityKind: "source",
        entityId: source.id,
        kind: "source.synced",
        payload: {
          displayName: source.displayName,
          added: report.nodesAdded.length,
          removed: report.nodesRemoved.length,
          renamed: report.nodesRenamed.length,
          updated: report.nodesUpdated.length,
          nodeCount: parsed.proxies.length
        }
      });
    }
    return report;
  }

  private buildSyncReport(
    sourceId: string,
    previousSnapshot: SourceSnapshotRecord | null,
    toSnapshotId: string,
    parsed: ClashProxyDocument
  ): SyncReportRecord | null {
    const previousNodes = previousSnapshot?.parsed
      ? identifyNodes(previousSnapshot.parsed.proxies ?? [])
      : [];
    const nextNodes = identifyNodes(parsed.proxies ?? []);
    const prevById = new Map(previousNodes.map((item) => [item.id, item.node] as const));
    const nextById = new Map(nextNodes.map((item) => [item.id, item.node] as const));

    const added: SyncReportRecord["nodesAdded"] = [];
    const removed: SyncReportRecord["nodesRemoved"] = [];
    const renamed: SyncReportRecord["nodesRenamed"] = [];
    const updated: SyncReportRecord["nodesUpdated"] = [];

    for (const { id, node } of nextNodes) {
      const before = prevById.get(id);
      if (!before) {
        added.push({ id, name: String(node.name) });
      } else if (String(before.name) !== String(node.name)) {
        renamed.push({ id, from: String(before.name), to: String(node.name) });
      } else if (JSON.stringify(before) !== JSON.stringify(node)) {
        updated.push({ id, name: String(node.name) });
      }
    }
    for (const { id, node } of previousNodes) {
      if (!nextById.has(id)) {
        removed.push({ id, name: String(node.name) });
      }
    }

    if (
      previousSnapshot &&
      added.length === 0 &&
      removed.length === 0 &&
      renamed.length === 0 &&
      updated.length === 0
    ) {
      return null; // 无变化不产报告
    }

    const report: SyncReportRecord = {
      id: createId("rep"),
      upstreamSourceId: sourceId,
      fromSnapshotId: previousSnapshot?.id ?? null,
      toSnapshotId,
      nodesAdded: added,
      nodesRemoved: removed,
      nodesRenamed: renamed,
      nodesUpdated: updated,
      createdAt: new Date().toISOString()
    };
    this.repository.createSyncReport(report);
    return report;
  }

  private withStats(source: SourceRecord): SourceWithStats {
    const snapshot = source.lastSuccessfulSnapshotId
      ? this.repository.findSnapshotById(source.lastSuccessfulSnapshotId)
      : null;
    const parsed = snapshot?.parsed ?? null;
    return {
      ...source,
      proxyCount: parsed?.proxies?.length ?? 0,
      groupCount: parsed?.["proxy-groups"]?.length ?? 0,
      ruleCount: parsed?.rules?.length ?? 0
    };
  }
}

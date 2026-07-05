import { createHash, randomBytes } from "node:crypto";

import yaml from "js-yaml";

import { createId } from "../../lib/ids";
import { logger } from "../../lib/logging/logger";
import type { BuildConfig } from "../../lib/build-config/types";
import { validateBuildConfig } from "../../lib/build-config/validate";
import { instantiateTemplate } from "../../lib/build-config/template";
import {
  evaluate,
  type EvaluateInput,
  type EvaluateIssue,
  type EvaluateResult,
  type RulesetSnapshotData
} from "../../lib/render-v2/evaluate";
import { diffDocuments } from "../../lib/render-v2/release-diff";
import { traceQuery, type TraceResult } from "../../lib/trace/rule-tracer";
import {
  isMihomoAvailable,
  validateWithMihomo,
  type MihomoGateOptions
} from "../../lib/validate/mihomo-gate";
import type { SecretStore } from "./secret-store";
import type { SecretBox } from "../../lib/security/secret-box";
import type { ClashProxyDocument } from "../../types";
import type { EventRepository } from "../events/event.repository";
import type { RulesetRepository } from "../rulesets/ruleset.repository";
import type { TemplateRepository } from "../templates/template.repository";
import type {
  SourceRecord,
  SyncReportRecord,
  UpstreamSourceRepository
} from "../upstream-sources/upstream-source.repository";
import type {
  PublishPolicy,
  ReleaseRecord,
  SubscriptionRecord,
  SubscriptionRepository
} from "./subscription.repository";
import { RECOMMENDED_TEMPLATE_ID } from "../../lib/db/seed-builtin-templates";

export class SubscriptionError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly issues: EvaluateIssue[] = []
  ) {
    super(message);
  }
}

export type StartKind = "recommended" | "template" | "patch" | "blank";

export interface SubscriptionServiceOptions {
  publicBaseUrl: string;
  mihomo: MihomoGateOptions;
}

const sha256Hex = (input: string) => createHash("sha256").update(input).digest("hex");

const blankBuildConfig = (sourceIds: string[], mode: "rebuild" | "patch"): BuildConfig => ({
  version: 1,
  mode,
  sources: sourceIds.map((sourceId) => ({ sourceId, enabled: true })),
  nodes: { transforms: [], overrides: [], custom: [] },
  groups:
    mode === "rebuild"
      ? {
          generators: [
            { kind: "proxies-root", name: "Proxies", includeAuto: true, extraMembers: [] },
            { kind: "region-groups", groupType: "select", unclassified: "others" }
          ],
          custom: [],
          order: ["Proxies"]
        }
      : { generators: [], custom: [], order: [] },
  rules: {
    targets: [],
    order: [],
    prelude: [],
    final: { target: mode === "rebuild" ? "Proxies" : "DIRECT" }
  },
  config: { structured: {}, rawPatch: null }
});

export class SubscriptionService {
  constructor(
    private readonly repository: SubscriptionRepository,
    private readonly sourceRepository: UpstreamSourceRepository,
    private readonly rulesetRepository: RulesetRepository,
    private readonly templateRepository: TemplateRepository,
    private readonly events: EventRepository,
    private readonly secretStore: SecretStore,
    private readonly secretBox: SecretBox,
    private readonly options: SubscriptionServiceOptions
  ) {}

  // ── 查询 ───────────────────────────────────────────────────

  listByOwner(ownerUserId: string) {
    return this.repository.listByOwner(ownerUserId).map((record) => this.summarize(record));
  }

  getDetail(ownerUserId: string, id: string) {
    const record = this.requireOwned(ownerUserId, id);
    const activeRelease = record.activeReleaseId
      ? this.repository.findReleaseById(record.activeReleaseId)
      : null;
    return {
      ...this.summarize(record),
      buildConfig: record.buildConfig,
      draftBuildConfig: record.draftBuildConfig,
      activeRelease: activeRelease
        ? {
            id: activeRelease.id,
            seq: activeRelease.seq,
            createdAt: activeRelease.createdAt,
            trigger: activeRelease.trigger
          }
        : null,
      issues: this.repository.listOpenIssues(id)
    };
  }

  private summarize(record: SubscriptionRecord) {
    const issueCount = this.repository.countOpenIssues(record.id);
    const activeRelease = record.activeReleaseId
      ? this.repository.findReleaseById(record.activeReleaseId)
      : null;
    const sourceNames = (record.draftBuildConfig ?? record.buildConfig)?.sources
      .map((ref) => this.sourceRepository.findById(ref.sourceId)?.displayName ?? "已删除的源")
      ?? [];
    return {
      id: record.id,
      displayName: record.displayName,
      isEnabled: record.isEnabled,
      health: record.health,
      healthReasons: record.healthReasons,
      publishPolicy: record.publishPolicy,
      pendingUpstreamChange: record.pendingUpstreamChange,
      hasDraft: record.draftBuildConfig !== null,
      mode: (record.draftBuildConfig ?? record.buildConfig)?.mode ?? null,
      sourceNames,
      activeReleaseSeq: activeRelease?.seq ?? null,
      activeReleaseAt: activeRelease?.createdAt ?? null,
      lastPullAt: this.repository.lastPullAt(record.id),
      issueCount,
      usage: record.usage,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    };
  }

  private requireOwned(ownerUserId: string, id: string): SubscriptionRecord {
    const record = this.repository.findByIdAndOwner(id, ownerUserId);
    if (!record) {
      throw new SubscriptionError("订阅不存在。", 404);
    }
    return record;
  }

  // ── 创建（3 步向导第 3 步落库） ───────────────────────────────

  create(
    ownerUserId: string,
    input: {
      displayName: string;
      sourceIds: string[];
      start: { kind: StartKind; templateId?: string };
    }
  ) {
    if (input.sourceIds.length === 0) {
      throw new SubscriptionError("至少选择一个订阅源。");
    }
    for (const sourceId of input.sourceIds) {
      if (!this.sourceRepository.findByIdAndOwner(sourceId, ownerUserId)) {
        throw new SubscriptionError("包含无权访问的订阅源。", 403);
      }
    }
    if (input.start.kind === "patch" && input.sourceIds.length > 1) {
      throw new SubscriptionError("保留源配置模式只支持单一订阅源。");
    }

    let draft: BuildConfig;
    switch (input.start.kind) {
      case "recommended": {
        const payload = this.templateRepository.findLatestPayload(RECOMMENDED_TEMPLATE_ID);
        if (!payload) {
          throw new SubscriptionError("官方推荐方案不可用（内置资产缺失）。", 500);
        }
        draft = instantiateTemplate(payload, input.sourceIds);
        break;
      }
      case "template": {
        if (!input.start.templateId) {
          throw new SubscriptionError("缺少模板 ID。");
        }
        const payload = this.templateRepository.findLatestPayloadVisibleTo(
          input.start.templateId,
          ownerUserId
        );
        if (!payload) {
          throw new SubscriptionError("模板不存在或无权访问。", 404);
        }
        draft = instantiateTemplate(payload, input.sourceIds);
        break;
      }
      case "patch":
        draft = blankBuildConfig(input.sourceIds, "patch");
        break;
      case "blank":
        draft = blankBuildConfig(input.sourceIds, "rebuild");
        break;
    }

    const record = this.repository.create({
      id: createId("sub"),
      ownerUserId,
      displayName: input.displayName || "未命名订阅",
      draftBuildConfig: draft,
      publishPolicy: "auto"
    });

    const token = this.issueToken(record.id, "默认设备", null);
    return { subscription: this.getDetail(ownerUserId, record.id), token };
  }

  updateMeta(
    ownerUserId: string,
    id: string,
    patch: Partial<{ displayName: string; isEnabled: boolean; publishPolicy: PublishPolicy }>
  ) {
    this.requireOwned(ownerUserId, id);
    this.repository.updateMeta(id, patch);
    return this.getDetail(ownerUserId, id);
  }

  delete(ownerUserId: string, id: string) {
    this.requireOwned(ownerUserId, id);
    this.repository.delete(id);
    return { ok: true };
  }

  // ── 草稿与预览 ──────────────────────────────────────────────

  saveDraft(ownerUserId: string, id: string, rawConfig: unknown) {
    const record = this.requireOwned(ownerUserId, id);
    const result = validateBuildConfig(rawConfig);
    if (!result.ok) {
      throw new SubscriptionError(`构建配置不合法：${result.errors.join("；")}`, 422);
    }
    for (const source of result.value.sources) {
      if (!this.sourceRepository.findByIdAndOwner(source.sourceId, ownerUserId)) {
        throw new SubscriptionError("构建配置引用了无权访问的订阅源。", 403);
      }
    }
    // 与已发布配置一致的草稿视为无草稿
    const published = record.buildConfig;
    if (published && JSON.stringify(published) === JSON.stringify(result.value)) {
      this.repository.saveDraft(id, null);
    } else {
      this.repository.saveDraft(id, result.value);
    }
    return this.getDetail(ownerUserId, id);
  }

  discardDraft(ownerUserId: string, id: string) {
    this.requireOwned(ownerUserId, id);
    this.repository.saveDraft(id, null);
    return this.getDetail(ownerUserId, id);
  }

  preview(ownerUserId: string, id: string) {
    const record = this.requireOwned(ownerUserId, id);
    const config = record.draftBuildConfig ?? record.buildConfig;
    if (!config) {
      throw new SubscriptionError("尚无可预览的构建配置。", 409);
    }
    const result = this.evaluateConfig(config);
    const activeRelease = record.activeReleaseId
      ? this.repository.findReleaseById(record.activeReleaseId)
      : null;
    const diffVsActive = activeRelease
      ? diffDocuments(this.parseReleaseDocument(activeRelease), result.document)
      : null;
    return {
      yamlText: result.yamlText,
      issues: result.issues,
      stats: result.stats,
      nodeIndex: result.nodeIndex,
      groupIndex: result.groupIndex,
      diffVsActive,
      activeReleaseSeq: activeRelease?.seq ?? null
    };
  }

  // ── 发布管线（技术方案 §6.1） ─────────────────────────────────

  publish(
    ownerUserId: string | null,
    id: string,
    options: {
      trigger: ReleaseRecord["trigger"];
      triggerDetail?: string;
    }
  ) {
    const record = ownerUserId
      ? this.requireOwned(ownerUserId, id)
      : this.repository.findById(id);
    if (!record) {
      throw new SubscriptionError("订阅不存在。", 404);
    }
    const config = record.draftBuildConfig ?? record.buildConfig;
    if (!config) {
      throw new SubscriptionError("尚无构建配置，无法发布。", 409);
    }

    const result = this.evaluateConfig(config);
    this.repository.replaceIssues(id, result.issues);

    const errors = result.issues.filter((issue) => issue.severity === "error");
    if (errors.length > 0) {
      this.events.insert({
        ownerUserId: record.ownerUserId,
        entityKind: "subscription",
        entityId: id,
        kind: "release.blocked",
        payload: {
          displayName: record.displayName,
          reason: "结构校验未通过",
          errorCount: errors.length,
          firstError: errors[0]!.message
        }
      });
      this.refreshHealth(id);
      throw new SubscriptionError(
        `发布被阻断：存在 ${errors.length} 个必须处理的问题。`,
        409,
        errors
      );
    }

    // mihomo 内核门禁（可用时）
    const mihomo = isMihomoAvailable(this.options.mihomo)
      ? validateWithMihomo(result.yamlText, this.options.mihomo)
      : { available: false as const, passed: null, exitCode: null, output: null, durationMs: null };
    if (mihomo.available && mihomo.passed === false) {
      this.events.insert({
        ownerUserId: record.ownerUserId,
        entityKind: "subscription",
        entityId: id,
        kind: "release.blocked",
        payload: {
          displayName: record.displayName,
          reason: "mihomo 内核校验失败",
          output: mihomo.output
        }
      });
      this.refreshHealth(id);
      throw new SubscriptionError(
        `发布被阻断：mihomo 内核校验失败。\n${mihomo.output ?? ""}`,
        409
      );
    }

    const activeRelease = record.activeReleaseId
      ? this.repository.findReleaseById(record.activeReleaseId)
      : null;
    const diffSummary = diffDocuments(
      activeRelease ? this.parseReleaseDocument(activeRelease) : null,
      result.document
    );

    const sourceSnapshotIds: Record<string, string> = {};
    for (const source of config.sources) {
      const snapshot = this.sourceRepository.findLatestSuccessfulSnapshot(source.sourceId);
      if (snapshot) {
        sourceSnapshotIds[source.sourceId] = snapshot.id;
      }
    }

    const release = this.repository.createRelease({
      subscriptionId: id,
      buildConfig: config,
      sourceSnapshotIds,
      renderedYaml: result.yamlText,
      renderedHash: result.renderedHash,
      diffSummary,
      trigger: options.trigger,
      triggerDetail: options.triggerDetail ?? null,
      validation: { structuralErrors: 0, mihomo },
      createdBy: ownerUserId ?? "system"
    });

    // 透传主源的用量信息
    const primarySource = config.sources[0]
      ? this.sourceRepository.findById(config.sources[0].sourceId)
      : null;
    if (primarySource) {
      this.repository.setUsage(id, primarySource.headers, primarySource.usage);
    }

    this.events.insert({
      ownerUserId: record.ownerUserId,
      entityKind: "subscription",
      entityId: id,
      kind: "release.published",
      payload: {
        displayName: record.displayName,
        seq: release.seq,
        trigger: options.trigger,
        triggerDetail: options.triggerDetail ?? null,
        diff: {
          nodesAdded: diffSummary.nodes.added.length,
          nodesRemoved: diffSummary.nodes.removed.length,
          nodesRenamed: diffSummary.nodes.renamed.length,
          nodesUpdated: diffSummary.nodes.updated.length,
          ruleCountDelta: diffSummary.ruleCountDelta
        }
      }
    });
    this.refreshHealth(id);
    return release;
  }

  rollback(ownerUserId: string, id: string, releaseId: string) {
    const record = this.requireOwned(ownerUserId, id);
    const target = this.repository.findReleaseById(releaseId);
    if (!target || target.subscriptionId !== id) {
      throw new SubscriptionError("目标版本不存在。", 404);
    }
    // 历史产物不可变可信：直接复用其配置与 YAML（技术方案 §6.1）
    const release = this.repository.createRelease({
      subscriptionId: id,
      buildConfig: target.buildConfig,
      sourceSnapshotIds: target.sourceSnapshotIds,
      renderedYaml: target.renderedYaml,
      renderedHash: target.renderedHash,
      diffSummary: {},
      trigger: "rollback",
      triggerDetail: `回滚到 v${target.seq}`,
      validation: target.validation,
      createdBy: ownerUserId
    });
    this.events.insert({
      ownerUserId: record.ownerUserId,
      entityKind: "subscription",
      entityId: id,
      kind: "release.published",
      payload: { displayName: record.displayName, seq: release.seq, trigger: "rollback", rollbackOf: target.seq }
    });
    this.refreshHealth(id);
    return release;
  }

  listReleases(ownerUserId: string, id: string) {
    this.requireOwned(ownerUserId, id);
    return this.repository.listReleases(id).map((release) => ({
      id: release.id,
      seq: release.seq,
      trigger: release.trigger,
      triggerDetail: release.triggerDetail,
      diffSummary: release.diffSummary,
      validation: release.validation,
      createdBy: release.createdBy,
      createdAt: release.createdAt,
      isActive: this.repository.findById(id)?.activeReleaseId === release.id
    }));
  }

  getRelease(ownerUserId: string, id: string, releaseId: string) {
    this.requireOwned(ownerUserId, id);
    const release = this.repository.findReleaseById(releaseId);
    if (!release || release.subscriptionId !== id) {
      throw new SubscriptionError("版本不存在。", 404);
    }
    return release;
  }

  // ── 上游变化吸收（调度器回调，技术方案 §6.2） ───────────────────

  async onSourceSynced(source: SourceRecord, report: SyncReportRecord | null) {
    const subscriptions = this.repository.listBySource(source.id);
    for (const subscription of subscriptions) {
      if (!subscription.isEnabled || !subscription.buildConfig) continue;
      try {
        const result = this.evaluateConfig(subscription.buildConfig);
        const activeRelease = subscription.activeReleaseId
          ? this.repository.findReleaseById(subscription.activeReleaseId)
          : null;
        if (activeRelease && activeRelease.renderedHash === result.renderedHash) {
          continue; // 输出无变化
        }
        const hasErrors = result.issues.some((issue) => issue.severity === "error");
        if (subscription.publishPolicy === "auto" && !hasErrors) {
          this.publish(null, subscription.id, {
            trigger: "upstream_sync",
            triggerDetail: `订阅源「${source.displayName}」变化`
          });
        } else {
          this.repository.replaceIssues(subscription.id, result.issues);
          this.repository.setPendingUpstreamChange(subscription.id, true);
          this.events.insert({
            ownerUserId: subscription.ownerUserId,
            entityKind: "subscription",
            entityId: subscription.id,
            kind: hasErrors ? "release.blocked" : "subscription.pending_change",
            payload: {
              displayName: subscription.displayName,
              sourceName: source.displayName,
              reason: hasErrors ? "上游变化导致引用失效，需处理后发布" : "发布策略为确认模式",
              reportId: report?.id ?? null
            }
          });
          this.refreshHealth(subscription.id);
        }
      } catch (error) {
        logger.warn({
          event: "subscription.absorb.failed",
          subscriptionId: subscription.id,
          reason: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  // ── 健康状态机（技术方案 §6.4） ──────────────────────────────

  refreshHealth(id: string) {
    const record = this.repository.findById(id);
    if (!record) return;
    const reasons: string[] = [];
    let health: "ok" | "warn" | "error" = "ok";

    if (!record.activeReleaseId) {
      health = "error";
      reasons.push("尚未发布任何版本");
    } else {
      const config = record.buildConfig;
      for (const ref of config?.sources ?? []) {
        const source = this.sourceRepository.findById(ref.sourceId);
        if (!source) {
          health = "warn";
          reasons.push("引用的订阅源已被删除");
          continue;
        }
        if (source.sourceKind !== "url") continue;
        if (source.lastSyncStatus === "failed") {
          health = "warn";
          reasons.push(`订阅源「${source.displayName}」最近同步失败`);
        } else if (source.lastSuccessfulSyncAt) {
          const ageMs = Date.now() - new Date(source.lastSuccessfulSyncAt).getTime();
          if (ageMs > source.syncIntervalMinutes * 60_000 * 2) {
            health = "warn";
            reasons.push(`订阅源「${source.displayName}」已 ${Math.round(ageMs / 3_600_000)} 小时未成功同步`);
          }
        }
      }
      const issues = this.repository.countOpenIssues(id);
      if (issues.error > 0) {
        health = "warn";
        reasons.push(`${issues.error} 个待处理问题需要处理`);
      }
    }

    this.repository.setHealth(id, health, reasons);
  }

  // ── Token 与交付 ────────────────────────────────────────────

  issueToken(subscriptionId: string, label: string | null, rotatedFromId: string | null) {
    const plaintext = randomBytes(24).toString("hex");
    const record = this.repository.createToken({
      subscriptionId,
      tokenHash: sha256Hex(plaintext),
      tokenCiphertext: this.secretBox.encrypt({ token: plaintext }),
      label,
      rotatedFromId
    });
    return { ...record, token: plaintext, url: `${this.options.publicBaseUrl}/s/${subscriptionId}/${plaintext}` };
  }

  createToken(ownerUserId: string, id: string, label: string | null) {
    this.requireOwned(ownerUserId, id);
    return this.issueToken(id, label, null);
  }

  // 轮换：换掉明文本体，但保留原名字（用户不会感觉"改名"）；旧链接直接删除，不留历史行。
  rotateToken(ownerUserId: string, id: string, tokenId: string) {
    this.requireOwned(ownerUserId, id);
    const previous = this.repository.findTokenById(id, tokenId);
    this.repository.deleteToken(id, tokenId);
    return this.issueToken(id, previous?.label ?? null, tokenId);
  }

  // 长期链接「撤销」= 硬删除，删除后不再出现在列表里（短期分享链接维持软撤销 + 历史展示）。
  revokeToken(ownerUserId: string, id: string, tokenId: string) {
    this.requireOwned(ownerUserId, id);
    this.repository.deleteToken(id, tokenId);
    return { ok: true };
  }

  renameToken(ownerUserId: string, id: string, tokenId: string, label: string | null) {
    this.requireOwned(ownerUserId, id);
    this.repository.renameToken(id, tokenId, label);
    return { ok: true };
  }

  // 按需解密明文供"复制/查看二维码"使用：不常驻前端，每次点击即时请求一次。
  revealToken(ownerUserId: string, id: string, tokenId: string) {
    this.requireOwned(ownerUserId, id);
    const ciphertext = this.repository.getTokenCiphertext(id, tokenId);
    if (!ciphertext) {
      throw new SubscriptionError("链接不存在或已被删除。", 404);
    }
    const { token } = this.secretBox.decrypt(ciphertext) as { token: string };
    return { token, url: `${this.options.publicBaseUrl}/s/${id}/${token}` };
  }

  // 工作台卡片 / 订阅列表的「复制链接」快捷按钮：优先复用最早创建的长期链接（通常就是「默认设备」），
  // 一条都没有时（比如都被删除了）就地补建一条，始终保证点一下就能拿到可用链接。
  getOrCreatePrimaryLink(ownerUserId: string, id: string) {
    this.requireOwned(ownerUserId, id);
    const tokens = this.repository.listTokens(id);
    if (tokens.length === 0) {
      return this.issueToken(id, "默认设备", null);
    }
    const oldest = [...tokens].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]!;
    return this.revealToken(ownerUserId, id, oldest.id);
  }

  listAccess(ownerUserId: string, id: string) {
    this.requireOwned(ownerUserId, id);
    return {
      tokens: this.repository.listTokens(id),
      tempTokens: this.repository.listTempTokens(id),
      pullLogs: this.repository.listPullLogs(id, 30)
    };
  }

  createTempToken(
    ownerUserId: string,
    id: string,
    input: { label: string | null; ttlSeconds: number }
  ) {
    this.requireOwned(ownerUserId, id);
    if (input.ttlSeconds < 3600 || input.ttlSeconds > 30 * 24 * 3600) {
      throw new SubscriptionError("短期链接有效期必须在 1 小时到 30 天之间。");
    }
    const plaintext = randomBytes(16).toString("hex");
    const record = this.repository.createTempToken({
      subscriptionId: id,
      tokenHash: sha256Hex(plaintext),
      label: input.label,
      expiresAt: new Date(Date.now() + input.ttlSeconds * 1000).toISOString()
    });
    return {
      ...record,
      token: plaintext,
      url: `${this.options.publicBaseUrl}/s/${id}/t/${plaintext}`
    };
  }

  revokeTempToken(ownerUserId: string, id: string, tokenId: string) {
    this.requireOwned(ownerUserId, id);
    this.repository.revokeTempToken(tokenId);
    return { ok: true };
  }

  // 拉取（技术方案 §7.1）：只读 active release，零上游请求、零渲染
  deliver(
    subscriptionId: string,
    token: string,
    kind: "token" | "temp_token",
    clientIp: string | null,
    userAgent: string | null
  ): { yamlText: string; fileName: string; headers: Record<string, string> } {
    const record = this.repository.findById(subscriptionId);
    if (!record || !record.isEnabled) {
      throw new SubscriptionError("订阅不存在或已停用。", 404);
    }

    const tokenHash = sha256Hex(token);
    const tokenRecord =
      kind === "token"
        ? this.repository.findActiveTokenByHash(subscriptionId, tokenHash)
        : this.repository.findActiveTempTokenByHash(subscriptionId, tokenHash);
    if (!tokenRecord) {
      this.repository.createPullLog({
        subscriptionId,
        tokenKind: kind,
        tokenId: null,
        status: "denied",
        httpStatus: 403,
        servedReleaseId: null,
        clientIp,
        userAgent,
        errorMessage: "无效或已撤销的订阅链接"
      });
      throw new SubscriptionError("无效或已撤销的订阅链接。", 403);
    }

    const release = record.activeReleaseId
      ? this.repository.findReleaseById(record.activeReleaseId)
      : null;
    if (!release) {
      this.repository.createPullLog({
        subscriptionId,
        tokenKind: kind,
        tokenId: tokenRecord.id,
        status: "failed",
        httpStatus: 503,
        servedReleaseId: null,
        clientIp,
        userAgent,
        errorMessage: "该订阅还没有已发布的版本"
      });
      throw new SubscriptionError("该订阅还没有已发布的版本。", 503);
    }

    this.repository.createPullLog({
      subscriptionId,
      tokenKind: kind,
      tokenId: tokenRecord.id,
      status: "success",
      httpStatus: 200,
      servedReleaseId: release.id,
      clientIp,
      userAgent,
      errorMessage: null
    });

    const headers: Record<string, string> = {
      "profile-update-interval": "24"
    };
    const userInfo = record.usage;
    if (userInfo) {
      const parts: string[] = [];
      if (userInfo.upload !== null) parts.push(`upload=${userInfo.upload}`);
      if (userInfo.download !== null) parts.push(`download=${userInfo.download}`);
      if (userInfo.total !== null) parts.push(`total=${userInfo.total}`);
      if (userInfo.expire !== null) parts.push(`expire=${userInfo.expire}`);
      if (parts.length > 0) {
        headers["subscription-userinfo"] = parts.join("; ");
      }
    }

    return { yamlText: release.renderedYaml, fileName: `${record.displayName}.yaml`, headers };
  }

  // ── 规则追踪器 ─────────────────────────────────────────────

  trace(ownerUserId: string, id: string, query: string, useDraft: boolean): TraceResult {
    const record = this.requireOwned(ownerUserId, id);
    const config = useDraft
      ? record.draftBuildConfig ?? record.buildConfig
      : record.buildConfig ?? record.draftBuildConfig;
    if (!config) {
      throw new SubscriptionError("尚无可追踪的配置。", 409);
    }
    const result = this.evaluateConfig(config);
    const rulesetContentBySlug = new Map<string, { behavior: string; content: string }>();
    for (const block of config.rules.targets) {
      for (const item of block.items) {
        if (item.kind !== "snapshot") continue;
        const snapshot = this.rulesetRepository.findSnapshot(item.hash);
        if (snapshot) {
          rulesetContentBySlug.set(item.slug, {
            behavior: snapshot.behavior,
            content: snapshot.content
          });
        }
      }
    }
    return traceQuery({ document: result.document, rulesetContentBySlug, query });
  }

  // ── 规则源更新应用（技术方案 §8） ─────────────────────────────

  applyRulesetUpdate(
    ownerUserId: string,
    input: { catalogId: string; toHash: string; subscriptionIds: string[] }
  ) {
    const results: Array<{ subscriptionId: string; changed: boolean }> = [];
    for (const id of input.subscriptionIds) {
      const record = this.requireOwned(ownerUserId, id);
      const config = structuredClone(record.draftBuildConfig ?? record.buildConfig);
      if (!config) {
        results.push({ subscriptionId: id, changed: false });
        continue;
      }
      let changed = false;
      for (const block of config.rules.targets) {
        for (const item of block.items) {
          if (item.kind === "snapshot" && item.catalogId === input.catalogId && item.hash !== input.toHash) {
            item.hash = input.toHash;
            changed = true;
          }
        }
      }
      if (changed) {
        this.repository.saveDraft(id, config);
      }
      results.push({ subscriptionId: id, changed });
    }
    return results;
  }

  // 引用了某规则源的订阅（供前端"应用更新"多选）
  listReferencingRuleset(ownerUserId: string, catalogId: string) {
    return this.repository
      .listByOwner(ownerUserId)
      .filter((record) => {
        const config = record.draftBuildConfig ?? record.buildConfig;
        return config?.rules.targets.some((block) =>
          block.items.some((item) => item.kind === "snapshot" && item.catalogId === catalogId)
        );
      })
      .map((record) => ({ id: record.id, displayName: record.displayName }));
  }

  // ── 求值输入组装 ────────────────────────────────────────────

  private evaluateConfig(config: BuildConfig): EvaluateResult {
    return evaluate(this.buildEvaluateInput(config));
  }

  private buildEvaluateInput(config: BuildConfig): EvaluateInput {
    const sourceSnapshots = new Map<string, ClashProxyDocument>();
    const sourceLabels = new Map<string, string>();
    for (const ref of config.sources) {
      const source = this.sourceRepository.findById(ref.sourceId);
      if (source) {
        sourceLabels.set(ref.sourceId, source.displayName);
      }
      const snapshot = this.sourceRepository.findLatestSuccessfulSnapshot(ref.sourceId);
      if (snapshot?.parsed) {
        sourceSnapshots.set(ref.sourceId, snapshot.parsed);
      }
    }

    const rulesetSnapshots = new Map<string, RulesetSnapshotData>();
    for (const block of config.rules.targets) {
      for (const item of block.items) {
        if (item.kind !== "snapshot") continue;
        const snapshot = this.rulesetRepository.findSnapshot(item.hash);
        if (snapshot) {
          rulesetSnapshots.set(item.hash, {
            hash: snapshot.hash,
            slug: item.slug,
            behavior: snapshot.behavior,
            content: snapshot.content,
            isPublic: snapshot.isPublic
          });
        }
      }
    }

    const customNodeSecrets = new Map<string, Record<string, unknown>>();
    for (const node of config.nodes.custom) {
      if (!node.secretRef) continue;
      const fields = this.secretStore.resolve(node.secretRef);
      if (fields) {
        customNodeSecrets.set(node.secretRef, fields);
      }
    }

    return {
      buildConfig: config,
      sourceSnapshots,
      sourceLabels,
      rulesetSnapshots,
      customNodeSecrets,
      publicBaseUrl: this.options.publicBaseUrl
    };
  }

  private parseReleaseDocument(release: ReleaseRecord): ClashProxyDocument | null {
    try {
      return yaml.load(release.renderedYaml) as ClashProxyDocument;
    } catch {
      return null;
    }
  }
}

import type { ClashProxyDocument, ManagedSubscriptionDetail, ManagedSubscriptionSummary } from "../../types";
import { createId } from "../../lib/ids";
import { hashOpaqueToken, createOpaqueToken } from "../../lib/auth/tokens";
import { createDefaultTemplatePayload } from "../../lib/render/template-payload";
import { renderManagedConfig } from "../../lib/render/render-managed-config";
import { TemplateRepository } from "../templates/template.repository";
import { GeneratedSubscriptionDraftService } from "../generated-subscription-drafts/generated-subscription-draft.service";
import { UpstreamSourceRepository } from "../upstream-sources/upstream-source.repository";
import { UpstreamSourceService } from "../upstream-sources/upstream-source.service";
import { ManagedSubscriptionRepository } from "./managed-subscription.repository";
import { SubscriptionAccessRepository } from "./subscription-access.repository";

interface CreateManagedSubscriptionInput {
  upstreamSourceId: string;
  templateId: string;
  displayName: string;
  visibility?: "private" | "unlisted" | "public";
  shareMode?: "disabled" | "view" | "fork";
}

interface UpdateManagedSubscriptionInput {
  displayName?: string;
  visibility?: "private" | "unlisted" | "public";
  shareMode?: "disabled" | "view" | "fork";
  isEnabled?: boolean;
  upstreamSourceId?: string;
  templateId?: string;
}

interface PublishManagedSubscriptionFromDraftInput {
  displayName?: string;
  visibility?: "private" | "unlisted" | "public";
  shareMode?: "disabled" | "view" | "fork";
  isEnabled?: boolean;
}

export class ManagedSubscriptionError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

const parseSourceDocument = (json: string | null): ClashProxyDocument | null => {
  if (!json) {
    return null;
  }

  return JSON.parse(json) as ClashProxyDocument;
};

const deriveTemplatePayloadFromDocument = (document: ClashProxyDocument) => {
  const configPatch = Object.fromEntries(
    Object.entries(document).filter(
      ([key]) => key !== "proxies" && key !== "proxy-groups" && key !== "rules"
    )
  );

  return {
    ...createDefaultTemplatePayload(),
    rulesMode: "full_override" as const,
    groupsMode: "full_override" as const,
    configMode: "full_override" as const,
    customProxiesPolicy: "replace_same_name" as const,
    ruleProviderRefs: [],
    rules: [...(document.rules ?? [])],
    proxyGroups: [...document["proxy-groups"]],
    configPatch,
    customProxies: [...document.proxies]
  };
};

export class ManagedSubscriptionService {
  constructor(
    private readonly repository: ManagedSubscriptionRepository,
    private readonly upstreamSourceRepository: UpstreamSourceRepository,
    private readonly upstreamSourceService: UpstreamSourceService,
    private readonly templateRepository: TemplateRepository,
    private readonly accessRepository: SubscriptionAccessRepository,
    private readonly generatedSubscriptionDraftService: GeneratedSubscriptionDraftService
  ) {}

  listByOwner(ownerUserId: string): ManagedSubscriptionSummary[] {
    return this.repository.listByOwner(ownerUserId);
  }

  getById(ownerUserId: string, subscriptionId: string): ManagedSubscriptionDetail {
    const detail = this.repository.findByIdAndOwner(subscriptionId, ownerUserId);

    if (!detail) {
      throw new ManagedSubscriptionError("未找到该托管订阅。", 404);
    }

    return detail;
  }

  listSnapshots(ownerUserId: string, subscriptionId: string) {
    const subscription = this.repository.findByIdAndOwner(subscriptionId, ownerUserId);

    if (!subscription) {
      throw new ManagedSubscriptionError("未找到该生成订阅。", 404);
    }

    return this.repository.listSnapshots(subscriptionId);
  }

  compareSnapshots(
    ownerUserId: string,
    subscriptionId: string,
    baseSnapshotId: string,
    targetSnapshotId: string
  ) {
    const subscription = this.repository.findByIdAndOwner(subscriptionId, ownerUserId);

    if (!subscription) {
      throw new ManagedSubscriptionError("未找到该生成订阅。", 404);
    }

    const base = this.repository.findSnapshotById(baseSnapshotId);
    const target = this.repository.findSnapshotById(targetSnapshotId);

    if (
      !base ||
      !target ||
      base.managedSubscriptionId !== subscriptionId ||
      target.managedSubscriptionId !== subscriptionId
    ) {
      throw new ManagedSubscriptionError("快照不存在或不属于当前生成订阅。", 404);
    }

    const baseLines = base.renderedYaml.split(/\r?\n/);
    const targetLines = target.renderedYaml.split(/\r?\n/);
    const baseSet = new Set(baseLines);
    const targetSet = new Set(targetLines);
    const addedLines = targetLines.filter((line) => !baseSet.has(line));
    const removedLines = baseLines.filter((line) => !targetSet.has(line));

    return {
      baseSnapshot: base,
      targetSnapshot: target,
      summary: {
        addedLineCount: addedLines.length,
        removedLineCount: removedLines.length
      },
      addedLines,
      removedLines
    };
  }

  create(ownerUserId: string, input: CreateManagedSubscriptionInput) {
    if (!input.displayName.trim()) {
      throw new ManagedSubscriptionError("托管订阅名称不能为空。", 400);
    }

    const source = this.upstreamSourceRepository.findByIdAndOwner(input.upstreamSourceId, ownerUserId);
    const template = this.templateRepository.findByIdAndOwner(input.templateId, ownerUserId);

    if (!source) {
      throw new ManagedSubscriptionError("关联的上游订阅源不存在。", 400);
    }

    if (!template) {
      throw new ManagedSubscriptionError("关联的模板不存在。", 400);
    }

    const created = this.repository.create({
      id: createId("msub"),
      ownerUserId,
      upstreamSourceId: input.upstreamSourceId,
      templateId: input.templateId,
      draftId: null,
      renderMode: "template",
      displayName: input.displayName.trim(),
      visibility: input.visibility ?? "private",
      shareMode: input.shareMode ?? "disabled"
    });

    if (!created) {
      throw new ManagedSubscriptionError("创建托管订阅失败。", 500);
    }

    return created;
  }

  async publishFromDraft(
    ownerUserId: string,
    draftId: string,
    input: PublishManagedSubscriptionFromDraftInput
  ) {
    const preview = await this.generatedSubscriptionDraftService.preview(ownerUserId, draftId);
    const upstreamSourceId = preview.draft.upstreamSourceId;
    const displayName = input.displayName?.trim() || preview.draft.displayName.trim();

    if (!upstreamSourceId) {
      throw new ManagedSubscriptionError("请先选择外部订阅。", 400);
    }

    if (!displayName) {
      throw new ManagedSubscriptionError("生成订阅名称不能为空。", 400);
    }

    const existing = this.repository.findByDraftIdAndOwner(draftId, ownerUserId);
    const derivedTemplate = this.ensureDerivedBlueprintTemplate(
      ownerUserId,
      draftId,
      preview,
      existing?.templateId ?? null,
      displayName
    );

    if (existing) {
      const updated = this.repository.update(existing.id, ownerUserId, {
        displayName,
        visibility: input.visibility,
        shareMode: input.shareMode,
        isEnabled: input.isEnabled,
        upstreamSourceId,
        draftId,
        renderMode: "draft",
        templateId: derivedTemplate.id
      });

      if (!updated) {
        throw new ManagedSubscriptionError("更新生成订阅失败。", 500);
      }

      return this.renderInternal(updated);
    }

    const created = this.repository.create({
      id: createId("msub"),
      ownerUserId,
      upstreamSourceId,
      templateId: derivedTemplate.id,
      draftId,
      renderMode: "draft",
      displayName,
      visibility: input.visibility ?? "private",
      shareMode: input.shareMode ?? "disabled",
      isEnabled: input.isEnabled ?? true
    });

    if (!created) {
      throw new ManagedSubscriptionError("创建生成订阅失败。", 500);
    }

    return this.renderInternal(created);
  }

  update(ownerUserId: string, subscriptionId: string, input: UpdateManagedSubscriptionInput) {
    if (input.upstreamSourceId) {
      const source = this.upstreamSourceRepository.findByIdAndOwner(input.upstreamSourceId, ownerUserId);

      if (!source) {
        throw new ManagedSubscriptionError("新的上游订阅源不存在。", 400);
      }
    }

    if (input.templateId) {
      const template = this.templateRepository.findByIdAndOwner(input.templateId, ownerUserId);

      if (!template) {
        throw new ManagedSubscriptionError("新的模板不存在。", 400);
      }
    }

    const updated = this.repository.update(subscriptionId, ownerUserId, {
      displayName: input.displayName?.trim(),
      visibility: input.visibility,
      shareMode: input.shareMode,
      isEnabled: input.isEnabled,
      upstreamSourceId: input.upstreamSourceId,
      templateId: input.templateId
    });

    if (!updated) {
      throw new ManagedSubscriptionError("未找到该托管订阅。", 404);
    }

    return updated;
  }

  delete(ownerUserId: string, subscriptionId: string) {
    const current = this.repository.findByIdAndOwner(subscriptionId, ownerUserId);

    if (!current) {
      throw new ManagedSubscriptionError("未找到该生成订阅。", 404);
    }

    this.repository.delete(subscriptionId, ownerUserId);

    return {
      success: true
    };
  }

  async render(ownerUserId: string, subscriptionId: string) {
    const subscription = this.repository.findByIdAndOwner(subscriptionId, ownerUserId);

    if (!subscription) {
      throw new ManagedSubscriptionError("未找到该生成订阅。", 404);
    }

    return this.renderInternal(subscription);
  }

  rotateSecret(ownerUserId: string, subscriptionId: string) {
    const subscription = this.repository.findByIdAndOwner(subscriptionId, ownerUserId);

    if (!subscription) {
      throw new ManagedSubscriptionError("未找到该生成订阅。", 404);
    }

    const nextSecret = createOpaqueToken(48);
    this.accessRepository.rotateUserSecret(ownerUserId, hashOpaqueToken(nextSecret));

    return {
      secret: nextSecret
    };
  }

  createTempToken(ownerUserId: string, subscriptionId: string, expiresInSeconds = 24 * 60 * 60) {
    const subscription = this.repository.findByIdAndOwner(subscriptionId, ownerUserId);

    if (!subscription) {
      throw new ManagedSubscriptionError("未找到该生成订阅。", 404);
    }

    const token = createOpaqueToken(48);
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

    this.accessRepository.createTempToken({
      id: createId("stt"),
      userId: ownerUserId,
      managedSubscriptionId: subscriptionId,
      tokenHash: hashOpaqueToken(token),
      expiresAt
    });

    return {
      token,
      expiresAt
    };
  }

  async deliver(subscriptionId: string, token: string, clientIp?: string | null, userAgent?: string | null) {
    const subscription = this.repository.findById(subscriptionId);

    if (!subscription || !subscription.isEnabled) {
      throw new ManagedSubscriptionError("订阅不存在或已停用。", 404);
    }

    const access = this.verifySubscriptionAccess(subscription.ownerUserId, subscriptionId, token);
    let latestSubscription = subscription;
    let syncAttempted = false;

    try {
      syncAttempted = true;
      await this.upstreamSourceService.sync(subscription.ownerUserId, subscription.upstreamSourceId);
      latestSubscription = await this.renderInternal(
        this.repository.findById(subscriptionId) ?? subscription
      );
    } catch (error) {
      const fallback = this.repository.findLatestSuccessfulSnapshot(subscriptionId);

      if (!fallback) {
        this.repository.createPullLog({
          id: createId("pull"),
          managedSubscriptionId: subscriptionId,
          tokenKind: access.kind,
          tempTokenId: access.tempTokenId,
          status: "failed",
          httpStatus: 503,
          syncAttempted,
          clientIp,
          userAgent,
          errorMessage: error instanceof Error ? error.message : String(error)
        });
        throw new ManagedSubscriptionError("无法生成可用订阅，且不存在历史缓存。", 503);
      }

      this.repository.createPullLog({
        id: createId("pull"),
        managedSubscriptionId: subscriptionId,
        tokenKind: access.kind,
        tempTokenId: access.tempTokenId,
        status: "degraded",
        httpStatus: 200,
        syncAttempted,
        servedSnapshotId: fallback.id,
        clientIp,
        userAgent,
        errorMessage: error instanceof Error ? error.message : String(error)
      });

      return {
        yamlText: fallback.renderedYaml,
        headers: subscription.latestHeaders,
        status: "degraded" as const
      };
    }

    this.repository.createPullLog({
      id: createId("pull"),
      managedSubscriptionId: subscriptionId,
      tokenKind: access.kind,
      tempTokenId: access.tempTokenId,
      status: "success",
      httpStatus: 200,
      syncAttempted,
      servedSnapshotId: latestSubscription.currentSnapshotId,
      clientIp,
      userAgent
    });

    return {
      yamlText: latestSubscription.renderedYaml ?? "",
      headers: latestSubscription.latestHeaders,
      status: "success" as const
    };
  }

  private async renderInternal(subscription: ManagedSubscriptionDetail) {
    if (subscription.renderMode === "draft") {
      return this.renderDraftBackedSubscription(subscription);
    }

    const source = this.upstreamSourceRepository.findByIdAndOwner(
      subscription.upstreamSourceId,
      subscription.ownerUserId
    );
    const template = this.templateRepository.findDetailByIdAndOwner(
      subscription.templateId,
      subscription.ownerUserId
    );

    if (!source) {
      throw new ManagedSubscriptionError("关联的上游订阅源不存在。", 400);
    }

    if (!template) {
      throw new ManagedSubscriptionError("关联的模板不存在。", 400);
    }

    const sourceSnapshot = source.lastSuccessfulSnapshotId
      ? this.upstreamSourceRepository.findSnapshotById(source.lastSuccessfulSnapshotId)
      : this.upstreamSourceRepository.findLatestSnapshot(source.id);
    const sourceDocument = parseSourceDocument(sourceSnapshot?.parsedJson ?? null);

    if (!sourceDocument) {
      throw new ManagedSubscriptionError("当前没有可用于渲染的上游订阅快照。", 409);
    }

    const rendered = renderManagedConfig(sourceDocument, template.payload);
    const snapshotId = createId("msnap");
    const createdAt = new Date().toISOString();

    this.repository.createSnapshot({
      id: snapshotId,
      managedSubscriptionId: subscription.id,
      upstreamSourceSnapshotId: sourceSnapshot?.id ?? null,
      templateVersionId: template.latestVersionId,
      renderedYaml: rendered.yamlText,
      renderedJson: JSON.stringify(rendered.document),
      forwardedHeadersJson: JSON.stringify(source.latestHeaders),
      validationStatus: "success",
      createdAt
    });
    this.repository.markRenderSuccess({
      subscriptionId: subscription.id,
      snapshotId,
      syncedAt: source.lastSyncAt,
      renderedAt: createdAt,
      latestHeadersJson: JSON.stringify(source.latestHeaders),
      latestUsageJson: source.latestUsage ? JSON.stringify(source.latestUsage) : null
    });

    return this.getById(subscription.ownerUserId, subscription.id);
  }

  private async renderDraftBackedSubscription(subscription: ManagedSubscriptionDetail) {
    if (!subscription.draftId) {
      throw new ManagedSubscriptionError("该生成订阅缺少草稿引用。", 409);
    }

    const source = this.upstreamSourceRepository.findByIdAndOwner(
      subscription.upstreamSourceId,
      subscription.ownerUserId
    );

    if (!source) {
      throw new ManagedSubscriptionError("关联的上游订阅源不存在。", 400);
    }

    const preview = await this.generatedSubscriptionDraftService.preview(
      subscription.ownerUserId,
      subscription.draftId
    );
    const snapshotId = createId("msnap");
    const createdAt = new Date().toISOString();

    this.repository.createSnapshot({
      id: snapshotId,
      managedSubscriptionId: subscription.id,
      upstreamSourceSnapshotId: preview.sourceSnapshotId,
      templateVersionId: null,
      renderedYaml: preview.yamlText,
      renderedJson: JSON.stringify(preview.document),
      forwardedHeadersJson: JSON.stringify(source.latestHeaders),
      validationStatus: "success",
      createdAt
    });
    this.repository.markRenderSuccess({
      subscriptionId: subscription.id,
      snapshotId,
      syncedAt: source.lastSyncAt,
      renderedAt: createdAt,
      latestHeadersJson: JSON.stringify(source.latestHeaders),
      latestUsageJson: source.latestUsage ? JSON.stringify(source.latestUsage) : null
    });

    return this.getById(subscription.ownerUserId, subscription.id);
  }

  private ensureDerivedBlueprintTemplate(
    ownerUserId: string,
    draftId: string,
    preview: Awaited<ReturnType<GeneratedSubscriptionDraftService["preview"]>>,
    existingTemplateId: string | null,
    displayName: string
  ) {
    const payload = deriveTemplatePayloadFromDocument(preview.document);
    const sourceUrl = `/subscriptions/drafts/${draftId}`;
    const existingTemplate = existingTemplateId
      ? this.templateRepository.findByIdAndOwner(existingTemplateId, ownerUserId)
      : null;
    const visibility = "private" as const;
    const shareMode = "disabled" as const;
    const publishStatus = "draft" as const;
    const description =
      preview.shareabilityStatus === "shareable"
        ? `由生成订阅“${displayName}”自动沉淀的蓝图模板。`
        : `由生成订阅“${displayName}”自动沉淀的蓝图模板，包含源订阅专属修改。`;

    if (existingTemplate && existingTemplate.sourceUrl === sourceUrl) {
      const updated = this.templateRepository.update(existingTemplate.id, ownerUserId, {
        displayName: `${displayName} 蓝图`,
        slug: null,
        description,
        sourceTemplateId: null,
        sourceLabel: preview.draft.displayName,
        sourceUrl,
        visibility,
        shareMode,
        publishStatus,
        versionId: createId("tplv"),
        versionNote: "根据最新操作流自动更新",
        payloadJson: JSON.stringify(payload),
        exportedYaml: preview.yamlText
      });

      if (!updated) {
        throw new ManagedSubscriptionError("更新自动沉淀模板失败。", 500);
      }

      return updated;
    }

    const created = this.templateRepository.create({
      id: createId("tpl"),
      ownerUserId,
      displayName: `${displayName} 蓝图`,
      slug: null,
      description,
      sourceTemplateId: null,
      sourceLabel: preview.draft.displayName,
      sourceUrl,
      visibility,
      shareMode,
      publishStatus,
      isInternal: false,
      versionId: createId("tplv"),
      versionNote: "从生成订阅操作流自动沉淀",
      payloadJson: JSON.stringify(payload),
      exportedYaml: preview.yamlText
    });

    if (!created) {
      throw new ManagedSubscriptionError("创建自动沉淀模板失败。", 500);
    }

    return created;
  }

  private verifySubscriptionAccess(ownerUserId: string, subscriptionId: string, token: string) {
    const normalizedToken = token.trim();

    if (!normalizedToken) {
      throw new ManagedSubscriptionError("缺少订阅访问令牌。", 401);
    }

    const tokenHash = hashOpaqueToken(normalizedToken);
    const userSecret = this.accessRepository.findUserSecret(ownerUserId);

    if (userSecret && userSecret.secretHash === tokenHash) {
      return {
        kind: "user_secret" as const,
        tempTokenId: null
      };
    }

    const tempToken = this.accessRepository.findValidTempToken(tokenHash, subscriptionId);

    if (tempToken && !tempToken.revokedAt && new Date(tempToken.expiresAt).getTime() > Date.now()) {
      this.accessRepository.touchTempToken(tempToken.id);

      return {
        kind: "temp_token" as const,
        tempTokenId: tempToken.id
      };
    }

    throw new ManagedSubscriptionError("订阅访问令牌无效或已过期。", 401);
  }
}

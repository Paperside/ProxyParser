import { createId } from "../../lib/ids";
import { createDefaultTemplatePayload } from "../../lib/render/template-payload";
import { renderManagedConfig } from "../../lib/render/render-managed-config";
import { MarketplaceRepository } from "../marketplace/marketplace.repository";
import { TemplateRepository } from "../templates/template.repository";
import { UpstreamSourceRepository } from "../upstream-sources/upstream-source.repository";
import { UpstreamSourceService } from "../upstream-sources/upstream-source.service";
import {
  GeneratedSubscriptionDraftRepository,
  type GeneratedSubscriptionDraftDetail,
  type GeneratedSubscriptionDraftSummary
} from "./generated-subscription-draft.repository";
import { renderGeneratedSubscriptionDraftPreview } from "./draft-operations";

export class GeneratedSubscriptionDraftError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

type DraftStepKey = "source" | "proxies" | "groups_rules" | "settings";
type DraftCurrentStep = DraftStepKey | "preview";
type ShareabilityStatus = "unknown" | "shareable" | "source_locked";

interface CreateDraftInput {
  displayName: string;
  upstreamSourceId?: string | null;
}

interface UpdateDraftInput {
  displayName?: string;
  upstreamSourceId?: string | null;
  currentStep?: DraftCurrentStep;
  shareabilityStatus?: ShareabilityStatus;
  selectedSourceSnapshotId?: string | null;
  lastPreviewYaml?: string | null;
}

interface SaveStepInput {
  stepKey: DraftStepKey;
  patchMode?: "patch" | "full_override" | null;
  editorMode?: "visual" | "raw";
  operations?: unknown;
  raw?: unknown;
  summary?: Record<string, unknown> | null;
  currentStep?: DraftCurrentStep;
  shareabilityStatus?: ShareabilityStatus;
}

interface ExtractTemplateInput {
  displayName?: string;
  description?: string | null;
  visibility?: "private" | "unlisted" | "public";
  shareMode?: "disabled" | "view" | "fork";
  publishStatus?: "draft" | "published" | "archived";
}

const normalizeDisplayName = (value: string | undefined) => {
  return value?.trim();
};

export class GeneratedSubscriptionDraftService {
  constructor(
    private readonly repository: GeneratedSubscriptionDraftRepository,
    private readonly upstreamSourceRepository: UpstreamSourceRepository,
    private readonly upstreamSourceService: UpstreamSourceService,
    private readonly marketplaceRepository: MarketplaceRepository,
    private readonly templateRepository: TemplateRepository
  ) {}

  listByOwner(ownerUserId: string): GeneratedSubscriptionDraftSummary[] {
    return this.repository.listByOwner(ownerUserId);
  }

  getById(ownerUserId: string, draftId: string): GeneratedSubscriptionDraftDetail {
    const detail = this.repository.findByIdAndOwner(draftId, ownerUserId);

    if (!detail) {
      throw new GeneratedSubscriptionDraftError("未找到该生成订阅草稿。", 404);
    }

    return detail;
  }

  create(ownerUserId: string, input: CreateDraftInput) {
    const displayName = normalizeDisplayName(input.displayName);

    if (!displayName) {
      throw new GeneratedSubscriptionDraftError("草稿名称不能为空。", 400);
    }

    if (input.upstreamSourceId) {
      const source = this.upstreamSourceRepository.findByIdAndOwner(
        input.upstreamSourceId,
        ownerUserId
      );

      if (!source) {
        throw new GeneratedSubscriptionDraftError("选择的外部订阅不存在。", 400);
      }
    }

    const created = this.repository.create({
      id: createId("gsd"),
      ownerUserId,
      upstreamSourceId: input.upstreamSourceId ?? null,
      displayName,
      currentStep: "source",
      shareabilityStatus: "unknown",
      selectedSourceSnapshotId: null,
      lastPreviewYaml: null
    });

    if (!created) {
      throw new GeneratedSubscriptionDraftError("创建生成订阅草稿失败。", 500);
    }

    return created;
  }

  update(ownerUserId: string, draftId: string, input: UpdateDraftInput) {
    if (input.upstreamSourceId) {
      const source = this.upstreamSourceRepository.findByIdAndOwner(
        input.upstreamSourceId,
        ownerUserId
      );

      if (!source) {
        throw new GeneratedSubscriptionDraftError("选择的外部订阅不存在。", 400);
      }
    }

    const updated = this.repository.update(draftId, ownerUserId, {
      upstreamSourceId: input.upstreamSourceId,
      displayName: normalizeDisplayName(input.displayName),
      currentStep: input.currentStep,
      shareabilityStatus: input.shareabilityStatus,
      selectedSourceSnapshotId: input.selectedSourceSnapshotId,
      lastPreviewYaml: input.lastPreviewYaml
    });

    if (!updated) {
      throw new GeneratedSubscriptionDraftError("未找到该生成订阅草稿。", 404);
    }

    return updated;
  }

  saveStep(ownerUserId: string, draftId: string, input: SaveStepInput) {
    const current = this.repository.findByIdAndOwner(draftId, ownerUserId);

    if (!current) {
      throw new GeneratedSubscriptionDraftError("未找到该生成订阅草稿。", 404);
    }

    this.repository.upsertStep({
      id: createId("gsds"),
      draftId,
      stepKey: input.stepKey,
      patchMode: input.patchMode ?? null,
      editorMode: input.editorMode ?? "visual",
      operationsJson: JSON.stringify(input.operations ?? {}),
      rawJson: input.raw === undefined ? null : JSON.stringify(input.raw),
      summaryJson: input.summary === undefined ? null : JSON.stringify(input.summary)
    });

    const nextStep = input.currentStep ?? current.currentStep;
    const nextShareability = input.shareabilityStatus ?? current.shareabilityStatus;
    const updated = this.repository.update(draftId, ownerUserId, {
      currentStep: nextStep,
      shareabilityStatus: nextShareability
    });

    if (!updated) {
      throw new GeneratedSubscriptionDraftError("保存步骤失败。", 500);
    }

    return updated;
  }

  async preview(ownerUserId: string, draftId: string) {
    const draft = this.repository.findByIdAndOwner(draftId, ownerUserId);

    if (!draft) {
      throw new GeneratedSubscriptionDraftError("未找到该生成订阅草稿。", 404);
    }

    if (!draft.upstreamSourceId) {
      throw new GeneratedSubscriptionDraftError("请先选择外部订阅。", 400);
    }

    const source = this.upstreamSourceRepository.findByIdAndOwner(
      draft.upstreamSourceId,
      ownerUserId
    );

    if (!source) {
      throw new GeneratedSubscriptionDraftError("关联的外部订阅不存在。", 400);
    }

    let sourceSnapshot =
      (draft.selectedSourceSnapshotId
        ? this.upstreamSourceRepository.findSnapshotById(draft.selectedSourceSnapshotId)
        : null) ??
      (source.lastSuccessfulSnapshotId
        ? this.upstreamSourceRepository.findSnapshotById(source.lastSuccessfulSnapshotId)
        : null) ??
      this.upstreamSourceRepository.findLatestSnapshot(source.id);

    if (!sourceSnapshot?.parsedJson) {
      await this.upstreamSourceService.sync(ownerUserId, source.id);

      const refreshedSource = this.upstreamSourceRepository.findByIdAndOwner(source.id, ownerUserId);

      sourceSnapshot =
        (draft.selectedSourceSnapshotId
          ? this.upstreamSourceRepository.findSnapshotById(draft.selectedSourceSnapshotId)
          : null) ??
        (refreshedSource?.lastSuccessfulSnapshotId
          ? this.upstreamSourceRepository.findSnapshotById(refreshedSource.lastSuccessfulSnapshotId)
          : null) ??
        this.upstreamSourceRepository.findLatestSnapshot(source.id);
    }

    if (!sourceSnapshot?.parsedJson) {
      const latestSource = this.upstreamSourceRepository.findByIdAndOwner(source.id, ownerUserId);

      if (latestSource?.lastSyncStatus === "failed") {
        throw new GeneratedSubscriptionDraftError(
          "外部订阅同步失败，当前无法生成预览，请先检查订阅链接是否可用。",
          409
        );
      }

      throw new GeneratedSubscriptionDraftError("当前没有可用于预览的外部订阅快照。", 409);
    }

    const stepMap = new Map(draft.steps.map((step) => [step.stepKey, step] as const));
    const sourceDocument = JSON.parse(sourceSnapshot.parsedJson) as {
      proxies?: unknown;
      "proxy-groups"?: unknown;
      rules?: unknown;
      [key: string]: unknown;
    };

    const preview = renderGeneratedSubscriptionDraftPreview({
      sourceDocument: {
        ...sourceDocument,
        proxies: Array.isArray(sourceDocument.proxies) ? (sourceDocument.proxies as never[]) : [],
        "proxy-groups": Array.isArray(sourceDocument["proxy-groups"])
          ? (sourceDocument["proxy-groups"] as never[])
          : [],
        rules: Array.isArray(sourceDocument.rules) ? (sourceDocument.rules as string[]) : []
      },
      proxiesStep: stepMap.get("proxies")
        ? {
            patchMode: stepMap.get("proxies")!.patchMode,
            editorMode: stepMap.get("proxies")!.editorMode,
            operations: stepMap.get("proxies")!.operations,
            raw: stepMap.get("proxies")!.raw
          }
        : null,
      groupsRulesStep: stepMap.get("groups_rules")
        ? {
            patchMode: stepMap.get("groups_rules")!.patchMode,
            editorMode: stepMap.get("groups_rules")!.editorMode,
            operations: stepMap.get("groups_rules")!.operations,
            raw: stepMap.get("groups_rules")!.raw
          }
        : null,
      settingsStep: stepMap.get("settings")
        ? {
            patchMode: stepMap.get("settings")!.patchMode,
            editorMode: stepMap.get("settings")!.editorMode,
            operations: stepMap.get("settings")!.operations,
            raw: stepMap.get("settings")!.raw
          }
        : null,
      ruleProviderCatalog: this.marketplaceRepository.listAccessibleRulesets(ownerUserId)
    });

    const updated = this.repository.update(draftId, ownerUserId, {
      currentStep: "preview",
      shareabilityStatus: preview.shareabilityStatus,
      selectedSourceSnapshotId: sourceSnapshot.id,
      lastPreviewYaml: preview.yamlText
    });

    if (!updated) {
      throw new GeneratedSubscriptionDraftError("保存预览结果失败。", 500);
    }

    return {
      draft: updated,
      sourceSnapshotId: sourceSnapshot.id,
      shareabilityStatus: preview.shareabilityStatus,
      lockedReasons: preview.lockedReasons,
      stats: {
        proxyCount: preview.document.proxies.length,
        groupCount: preview.document["proxy-groups"].length,
        ruleCount: preview.document.rules?.length ?? 0
      },
      document: preview.document,
      yamlText: preview.yamlText
    };
  }

  async extractTemplate(ownerUserId: string, draftId: string, input: ExtractTemplateInput) {
    const preview = await this.preview(ownerUserId, draftId);
    const draft = preview.draft;
    const displayName = input.displayName?.trim() || `${draft.displayName} 模板`;

    if (!displayName) {
      throw new GeneratedSubscriptionDraftError("模板名称不能为空。", 400);
    }

    const payload = this.buildTemplatePayloadFromPreview(preview);
    const isShareable = preview.shareabilityStatus === "shareable";
    const created = this.templateRepository.create({
      id: createId("tpl"),
      ownerUserId,
      displayName,
      slug: null,
      description:
        input.description?.trim() ??
        (isShareable
          ? `从生成订阅草稿“${draft.displayName}”提炼而来。`
          : `从生成订阅草稿“${draft.displayName}”提炼而来，包含源订阅专属修改。`),
      sourceTemplateId: null,
      sourceLabel: draft.displayName,
      sourceUrl: `/subscriptions/drafts/${draft.id}`,
      visibility: isShareable ? input.visibility ?? "private" : "private",
      shareMode: isShareable ? input.shareMode ?? "disabled" : "disabled",
      publishStatus: isShareable ? input.publishStatus ?? "draft" : "draft",
      versionId: createId("tplv"),
      versionNote: "从生成订阅草稿提炼",
      payloadJson: JSON.stringify(payload),
      exportedYaml: renderManagedConfig(
        {
          proxies: payload.customProxies,
          "proxy-groups": payload.proxyGroups,
          rules: payload.rules,
          ...payload.configPatch
        },
        createDefaultTemplatePayload()
      ).yamlText
    });

    if (!created) {
      throw new GeneratedSubscriptionDraftError("提炼模板失败。", 500);
    }

    return created;
  }

  private buildTemplatePayloadFromPreview(
    preview: Awaited<ReturnType<GeneratedSubscriptionDraftService["preview"]>>
  ) {
    const document = preview.document;
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
  }
}
